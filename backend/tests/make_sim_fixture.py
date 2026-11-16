"""Regenerate frontend/tests/sim-fixture.json: simulation packages from a stored race plus the Python engine's
results for them, which the browser engine must reproduce within Monte Carlo error (frontend/tests/sim-parity.mjs).
Run from backend/ after any change to the race model:  python -m tests.make_sim_fixture
"""
import json
from pathlib import Path
from app import sim, racestate as rs, service as sv

N = 20000
KEEP = ("p_win", "p_podium", "p_top5", "exp_pos", "p_dnf", "mean_stops", "exp_points", "exp_time", "time_sd", "blocked_laps", "exp_gap_to_winner")


def main() -> None:
    key = rs.race_sessions(1)[0]["session_key"]
    cases = []

    def add(name, lap, sc=None, plan=None):
        ctx = sim.context(key, lap)
        w = ctx["st"]["rows"][0]["driver_number"]
        sc = dict(sc or {})
        for k in ("overrides", "retirements", "hold"):
            if k in sc: sc[k] = {w: v for v in sc[k].values()}
        for k in ("manual", "no_reaction"):
            if k in sc: sc[k] = [w]
        plans = dict(sim.default_plans(ctx))
        if plan is not None: plans[w] = [(lap + a, c) for a, c in plan]
        pk = sim.package(ctx, plans, sc, n=N, seed=5, focus=w)
        r = sim.run_package(pk)
        cases.append({"name": name, "package": sv.clean(pk), "python": {"drivers": [{k: d[k] for k in KEEP} for d in r["drivers"]],
                                                                       "focus": {"risk": r["focus"]["risk"], "pos_hist": r["focus"]["pos_hist"]}}})
        print(name, "focus exp_pos", round(r["focus"]["exp_pos"], 3), flush=True)

    add("green race, base-rate incidents", 30)
    add("forced Safety Car", 25, {"safety_car": {"lap": 31, "type": "SC"}, "random_incidents": False})
    add("virtual Safety Car, manual two-stop", 28, {"safety_car": {"lap": 33, "type": "VSC"}, "random_incidents": False, "manual": ["W"]}, [(2, "HARD"), (22, "MEDIUM")])
    add("rain arrives, timing uncertain", 20, {"rain": [0.0] * 6 + [0.6] * 14, "rain_uncertainty_laps": 2})
    add("wet start drying out", 12, {"wetness": 0.5, "rain": [0.0] * 60, "overrides": {"W": {"compound": "INTERMEDIATE", "tyre_age": 4}}})
    add("hotter track, slow stops, retirement, pit lane closed", 40, {"track_temp_delta": 8, "pit_stop_extra": 2.0, "random_incidents": False,
                                                                     "retirements": {"W": 46}, "pit_closed_laps": [42, 43]})
    add("rival stays out to the flag", 35, {"no_reaction": ["W"]}, [])
    # whole-page answers: the response as the server defers it, and the same response finished by Python
    from app import nextrace, weather
    w = rs.state(key)["rows"][0]["driver_number"]
    deferred = []

    def big(d):
        for j in d["deferred"]["jobs"]:
            j["package"]["n"] = N
        return d

    def runs(d, keep=False):
        return weather.compare_finish(d["deferred"]["jobs"], [sim.run_package(j["package"]) for j in d["deferred"]["jobs"]], keep)

    def record(name, d, finish):
        d = big(d)
        sent = sv.clean(d)
        dd = d.pop("deferred")
        deferred.append({"name": name, "data": sent, "python": sv.clean(finish(d, dd))})
        print("deferred:", name, flush=True)

    for lap, drv in ((33, w), (20, 4)):
        record(f"strategy lap {lap} #{drv}", sv._strategy_view(sim.context(key, lap), key, drv, {"overview", "plans"}, defer=True),
               lambda d, dd: sv.strategy_finish(d, dd["opts"], dd["windows"], runs({"deferred": dd})))
    for lap, drv, body in ((33, w, {"duration": 4}), (45, 4, {"duration": 3, "pit_closed": True})):
        record(f"safety car lap {lap} #{drv}", sv.safety_car(key, lap, drv, body, defer=True), lambda d, dd: sv.safety_car_finish(d, runs({"deferred": dd})))
    for body in ({}, {"safety_car": {"lap": 20, "type": "SC"}, "rain_in_min": 20, "rain_intensity": 0.5, "rain_duration_min": 20, "grid_position": 5}):
        record(f"next race {json.dumps(body)[:40]}", nextrace._simulate(body, defer=True),
               lambda d, dd: nextrace.next_finish(d, dd["options"], dd["grid_of"], dd["n_sims"], runs({"deferred": dd}, True)))
    out = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "sim-fixture.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"n": N, "cases": cases, "deferred": deferred}, separators=(",", ":")))
    print("wrote", out, out.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
