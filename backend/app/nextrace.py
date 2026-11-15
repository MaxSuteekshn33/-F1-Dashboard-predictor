"""Next Race hub: predictions, forecast and a pre-race strategy simulator for the upcoming Grand Prix.

No laps exist before a race, so the simulator starts every car from the grid with inputs that are all
*historical estimates* — tyre wear and pit loss from earlier races at the circuit, each driver's race pace
from the most recent races — or stated assumptions. Every payload says which is which.
"""
from __future__ import annotations
import time
import numpy as np
import pandas as pd
from . import db, racestate as rs, strategy as sg, sim, weather, service as sv
from .cache import cached


def _circuit_key(circuit_id: str, before_year: int) -> tuple[int | None, list[int]]:
    """OpenF1 circuit key for an F1DB circuit, via earlier races held there that have lap data."""
    keys, years = None, []
    for r in db.q("SELECT year, date FROM f1db_races WHERE circuit_id=:c AND year<=:y ORDER BY year DESC LIMIT 4", c=circuit_id, y=before_year):
        day = pd.Timestamp(r["date"])
        for s in db.q("SELECT session_key, circuit_key, date_start FROM of1_sessions WHERE year=:y AND session_name='Race'", y=r["year"]):
            if abs((pd.Timestamp(s["date_start"], unit="s").normalize() - day).days) <= 1 and db.q(
                    "SELECT 1 AS x FROM of1_laps WHERE session_key=:k LIMIT 1", k=s["session_key"]):
                keys = keys or s["circuit_key"]; years.append(r["year"])
    return keys, years


@cached(ttl=6 * 3600, maxsize=8)
def recent_pace(n: int = 4) -> dict:
    """Each driver's race-pace gap to the field median (s/lap), averaged over the last `n` stored races."""
    acc: dict[str, list[float]] = {}
    used = []
    for s in rs.race_sessions(n):
        try:
            m = sg.tyre_model(s["session_key"])
            dm = rs.driver_map(s["session_key"])
        except Exception:
            continue
        if not m["base"] or m["dry_laps"] < 150:
            continue
        med = float(np.median(list(m["base"].values())))
        for num, base in m["base"].items():
            if num in dm and m.get("n_by_driver", {}).get(num, 0) >= 8:
                acc.setdefault(dm[num][0], []).append(float(np.clip(base - med, -2.5, 3.5)))
        used.append(f"{s['year']} {s['location']}")
    return {"delta": {k: float(np.mean(v)) for k, v in acc.items()}, "races": used}


@cached(ttl=3600, maxsize=8)
def _reference(circuit_key: int | None, before: float) -> dict:
    """Typical dry race lap at the circuit from the most recent earlier race with lap data."""
    if circuit_key is None:
        return {"lap_s": None, "source": None}
    for r in db.q("SELECT session_key, year FROM of1_sessions WHERE circuit_key=:c AND session_name='Race' AND date_start<:b ORDER BY date_start DESC LIMIT 2",
                  c=circuit_key, b=before - 86400):
        try:
            cl = sg.clean_laps(rs.load(r["session_key"]), 9e12)
        except Exception:
            continue
        cl = cl[~cl.wet] if len(cl) else cl
        if len(cl) >= 150:
            return {"lap_s": float(cl.lap_duration.median()), "source": f"median green-flag lap, {r['year']} race here"}
    return {"lap_s": None, "source": None}


def _start_epoch(race: dict) -> float:
    return time.mktime(time.strptime(f"{race['date']} {race.get('time') or '13:00'}", "%Y-%m-%d %H:%M")) - time.timezone


@cached(ttl=600, maxsize=2)
def overview() -> dict:
    pred = sv.prerace_prediction()
    if not pred.get("available"):
        return {"available": False, "reason": pred.get("reason", "No upcoming race.")}
    race = pred["race"]
    info = db.q("SELECT r.laps, r.course_length, r.distance, r.turns, r.circuit_type, r.sprint_race_date, r.qualifying_date, c.full_name, c.place_name, c.latitude, c.longitude, "
                "c.total_races_held FROM f1db_races r JOIN f1db_circuits c ON c.id=r.circuit_id WHERE r.id=:i", i=race["race_id"])[0]
    start = _start_epoch(race)
    ck, years = _circuit_key(race["circuit_id"], race["year"] - 1)
    hz = sim.hazards(ck)
    prior = sg.circuit_prior(ck, start) if ck is not None else dict(sg.GENERIC, label="generic assumption (no earlier race here with lap data)")
    hist = sv.circuit(race["circuit_id"])
    prev_strat = []
    prof = sv.race_profiles()
    if len(prof) and ck is not None:
        p = prof[(prof.circuit_key == ck) & (prof.date_start < start)].sort_values("year", ascending=False).head(3)
        prev_strat = [{"year": int(r.year), "winner": r.winner, "strategy": r.winner_strategy, "avg_stops": None if pd.isna(r.avg_stops) else round(float(r.avg_stops), 2),
                       "sc": int(r.sc or 0), "vsc": int(r.vsc or 0), "track_temp": None if pd.isna(r.track_temp) else round(float(r.track_temp), 1),
                       "rain_share": None if pd.isna(r.rain_share) else round(float(r.rain_share), 2)} for r in p.itertuples()]
    fc = weather.next_race_forecast()
    return {
        "available": True, "race": race, "start": start, "days_to_go": round((start - time.time()) / 86400, 1),
        "circuit": {**info, "openf1_history_years": years}, "prediction": {k: pred[k] for k in ("variant", "model_version", "train_through", "grid_source", "drivers", "top5", "constructors", "notes", "method")},
        "grid_known": pred["variant"] == "pre_race",
        "forecast": fc,
        "history": {"races": (hist.get("races") or [])[:8], "wins_by_grid": hist.get("wins_by_grid"), "most_wins": hist.get("most_wins"), "recent_strategies": prev_strat},
        "base_rates": hz,
        "tyre_prior": {"compounds": {c: {"deg": round(prior["deg"][c], 3), "offset": round(prior["offset"][c], 2)} for c in sg.SLICKS},
                       "pit_loss": round(prior["pit_loss"], 1), "source": prior["label"]},
        "tags": {"prediction": "MODEL", "forecast": "FORECAST", "history": "OBSERVED", "tyre_prior": "HISTORICAL"},
    }


def _context(body: dict) -> tuple[dict, dict, list[str]]:
    """Synthetic lap-0 race state for the upcoming race."""
    pred = sv.prerace_prediction()
    if not pred.get("available"):
        raise KeyError(pred.get("reason", "No upcoming race."))
    race = pred["race"]
    total = db.q("SELECT laps FROM f1db_races WHERE id=:i", i=race["race_id"])[0]["laps"]
    if not total or pd.isna(total):
        raise KeyError("Scheduled race distance is not in the calendar data yet.")
    total = int(total)
    start = _start_epoch(race)
    ck, _ = _circuit_key(race["circuit_id"], race["year"] - 1)
    notes = []
    prior = sg.circuit_prior(ck, start) if ck is not None else dict(sg.GENERIC, label="generic assumption (no earlier race here with lap data)")
    ref = _reference(ck, start)
    lap_s = ref["lap_s"] or 90.0
    notes.append(f"HISTORICAL · tyre wear, compound offsets and pit loss ({prior['pit_loss']:.1f} s): {prior['label']}.")
    notes.append(f"HISTORICAL · reference lap {lap_s:.1f} s ({ref['source']})." if ref["lap_s"] else "ASSUMPTION · reference lap 90 s (no earlier race here with lap data).")
    pace = recent_pace()
    notes.append(f"HISTORICAL · each driver's race pace = gap to the field median over {', '.join(pace['races']) or 'no stored races'}; "
                 "it does not know about upgrades or this circuit's specific demands.")
    col = sv.colours()["driver"]
    order_known = pred["variant"] == "pre_race"
    drivers = sorted(pred["drivers"], key=lambda d: (d["grid"] if (order_known and d["grid"]) else d["pred_pos"]))
    notes.append(f"OBSERVED · starting order: {pred['grid_source']}." if order_known else
                 "MODEL · qualifying has not happened: cars start in the pre-race model's predicted finishing order.")
    focus_id = body.get("driver_id") or drivers[0]["driver_id"]
    if body.get("grid_position"):
        gp = int(np.clip(int(body["grid_position"]), 1, len(drivers)))
        me = next(d for d in drivers if d["driver_id"] == focus_id)
        drivers.remove(me); drivers.insert(gp - 1, me)
        notes.append(f"ASSUMPTION · {me['code']} moved to P{gp} on the grid.")
    m = {"compounds": {c: {"deg": prior["deg"][c], "offset": prior["offset"][c], "n_laps": 0, "source": prior["label"]} for c in sg.SLICKS},
         "fuel": prior["fuel"], "pit_loss": prior["pit_loss"], "pit_loss_source": prior["label"], "base": {}, "sigma": {}, "sigma_all": 0.45,
         "n_by_driver": {}, "field_base": lap_s}
    rows, id_of = [], {}
    for i, d in enumerate(drivers):
        num = col.get(d["driver_id"], {}).get("number") or (900 + i)
        id_of[num] = d["driver_id"]
        m["base"][num] = lap_s + 0.8 * pace["delta"].get(d["driver_id"], 0.8)     # shrink recent-race gaps towards the field
        m["sigma"][num] = 0.45
        rows.append({"driver_number": num, "code": d["code"], "name": d["name"], "team": d["constructor"], "team_colour": d["colour"], "position": i + 1,
                     "grid": i + 1, "status": "RUNNING", "gap_s": i * 0.35, "laps_done": 0, "last_lap": None, "interval_s": 0.35 if i else None,
                     "compound": "MEDIUM", "tyre_age": 0, "compounds_used": ["MEDIUM"], "pit_stops": 0, "driver_id": d["driver_id"]})
    notes.append("ASSUMPTION · standing start modelled as 0.35 s between grid slots; first-lap incidents come only from the base rates.")
    # each car starts on the compound of its own time-optimal plan
    start_best = None
    for c0 in sg.SLICKS:
        p = sg.fast_plan(m, 0, total, c0, 0, [c0])
        if p and (start_best is None or p["rel_time"] < start_best[1]["rel_time"]):
            start_best = (c0, p)
    c0 = start_best[0] if start_best else "MEDIUM"
    for r in rows:
        r["compound"], r["compounds_used"] = c0, [c0]
    fc = weather.next_race_forecast()
    rain, fsum = weather.rain_timeline(fc if fc.get("available") else {"rows": []}, start, total, lap_s)
    wx = None
    if fc.get("available") and fc.get("rows"):
        near = min(fc["rows"], key=lambda r: abs(r["t"] - start))
        wx = {"air_temperature": near.get("temp"), "track_temperature": None, "wind_speed": near.get("wind"), "rainfall": 0, "rain_share_15min": 0}
        notes.append(f"FORECAST · rain timeline from Open-Meteo (max probability {fsum['max_prob']}%, {fsum['total_mm']} mm in the race window); track temperature is not forecast and defaults to 25°C.")
    else:
        notes.append("FORECAST · unavailable: " + str(fc.get("reason", "no forecast")) + " The race is simulated dry unless you add rain.")
    st = {"session": {"session_key": -int(race["race_id"]), "circuit_key": ck, "year": race["year"]}, "lap": 0, "max_lap": 0, "total_laps": total,
          "T": start, "rows": rows, "weather": wx, "track_status": "GREEN", "f1db": race}
    ctx = {"st": st, "m": m, "hz": sim.hazards(ck), "wet": {"wetness": 0.0}, "forecast_rain": rain, "lap_s": lap_s, "race": race, "start_compound": c0, "id_of": id_of}
    return ctx, {"focus_id": focus_id, "pred": pred}, notes


def simulate(body: dict) -> dict:
    """Compare starting tyres and stop counts for one driver in the upcoming race, under optional what-ifs:
    {driver_id, grid_position, safety_car:{lap,type,duration}, rain_in_min, rain_intensity, rain_duration_min,
     use_forecast_rain, track_temp_delta, random_incidents, n_sims}."""
    ctx, meta, notes = _context(body)
    st, m = ctx["st"], ctx["m"]
    total, lap_s = st["total_laps"], ctx["lap_s"]
    me = next((r for r in st["rows"] if r["driver_id"] == meta["focus_id"]), st["rows"][0])
    num = me["driver_number"]
    scn: dict = {"random_incidents": bool(body.get("random_incidents", True))}
    if body.get("rain_in_min") is not None:
        a = int(round(float(body["rain_in_min"]) * 60 / lap_s)); dur = int(round(float(body.get("rain_duration_min", 20)) * 60 / lap_s))
        inten = float(body.get("rain_intensity", 0.5))
        scn["rain"] = [inten if a <= j < a + dur else 0.0 for j in range(total)]; scn["rain_uncertainty_laps"] = 2
        notes.append(f"ASSUMPTION · rain intensity {inten:.2f} from lap {a + 1} for {dur} laps (±2 laps).")
    elif body.get("use_forecast_rain", True) and any(x > 0.02 for x in ctx["forecast_rain"]):
        scn["rain"] = ctx["forecast_rain"]; scn["rain_uncertainty_laps"] = 3
        notes.append("FORECAST · rain follows the Open-Meteo timeline (±3 laps); a forecast is not a track measurement.")
    else:
        scn["rain"] = [0.0] * total
    if body.get("safety_car"):
        scn["safety_car"] = body["safety_car"]; scn["random_incidents"] = False
        notes.append(f"ASSUMPTION · {body['safety_car'].get('type', 'SC')} on lap {body['safety_car']['lap']}; no other random incidents.")
    elif scn["random_incidents"]:
        notes.append(f"HISTORICAL · Safety Car {ctx['hz']['sc_per_lap'] * 100:.1f}%/lap, VSC {ctx['hz']['vsc_per_lap'] * 100:.1f}%/lap, retirement "
                     f"{ctx['hz']['dnf_per_race'] * 100:.0f}%/car ({ctx['hz']['source']}).")
    if body.get("track_temp_delta"):
        scn["track_temp_delta"] = float(body["track_temp_delta"]); notes.append(f"ASSUMPTION · track {float(body['track_temp_delta']):+.0f}°C → tyre wear {float(body['track_temp_delta']) * 2:+.0f}%.")
    # candidate plans: best one- and two-stop for each starting compound (CP-SAT)
    options = []
    for c0 in sg.SLICKS:
        for k in (1, 2):
            p = sg.optimise(m, 0, total, c0, 0, [c0], k)
            if p and p["rule_ok"]:
                seq = "-".join([c0[0]] + [x["compound"][0] for x in p["plan"]])
                options.append({"label": f"{seq} · {k}-stop", "start": c0, "stops": k, "plan": [(x["lap"], x["compound"]) for x in p["plan"]],
                                "model_time": p["rel_time"], "scenario": {"overrides": {num: {"compound": c0, "tyre_age": 0}}}})
    best_model = min(o["model_time"] for o in options)
    table = weather.compare(ctx, num, options, scn, n=int(body.get("n_sims", 1000)))
    by = {o["label"]: o for o in options}
    for t in table:
        o = by[t["label"]]
        t["start"], t["stops"], t["model_delta"] = o["start"], o["stops"], round(o["model_time"] - best_model, 2)
    best = min(table, key=lambda t: (round(t["exp_pos"], 1), t["time_vs_best"] or 0)) if table else None
    # projected order for the whole field on everyone's own optimal plan under the same scenario
    base = sim.run(ctx, None, scn, n=int(body.get("n_sims", 1000)), seed=7, focus=num)
    field = sorted([{"code": d["code"], "team_colour": d["team_colour"], "p_win": round(d["p_win"], 4), "p_podium": round(d["p_podium"], 4),
                     "exp_pos": round(d["exp_pos"], 2), "grid": next(r["grid"] for r in st["rows"] if r["driver_number"] == d["driver_number"])}
                    for d in base.get("drivers", [])], key=lambda d: d["exp_pos"])
    return {"race": ctx["race"], "total_laps": total, "focus": {"driver_id": me["driver_id"], "code": me["code"], "grid": me["grid"]},
            "field_start_compound": ctx["start_compound"], "options": table, "best": best["label"] if best else None, "field": field,
            "wetness_path": base.get("wetness_path"), "n_sims": base.get("n_sims"), "notes": notes,
            "caveat": "A pre-race simulation: no car has turned a race lap yet. Treat it as a way to compare plans under stated conditions, not as a forecast of the result."}
