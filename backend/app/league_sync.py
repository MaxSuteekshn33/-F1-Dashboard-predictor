"""Sync races to the Supabase project that holds accounts, predictions and leagues.

Upcoming races get their start time and entry list (so people can make picks); finished races get the
result the picks are scored against. Runs from the scheduled refresh job with the service-role key —
that key must never reach a browser.

    python -m app.league_sync            # needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
    python -m app.league_sync --sql      # print an equivalent SQL file instead (no key needed)
"""
from __future__ import annotations
import json, os, sys, time
import httpx
import pandas as pd
from . import db, service as sv


def _start_iso(date: str, tm: str | None) -> str:
    return f"{date}T{(tm or '13:00')}:00+00:00"


def race_rows(season: int | None = None) -> list[dict]:
    season = season or db.q("SELECT MAX(year) AS y FROM f1db_races")[0]["y"]
    races = db.q("SELECT r.id, r.year, r.round, r.date, r.time, g.full_name AS name, c.full_name AS circuit FROM f1db_races r "
                 "JOIN f1db_grands_prix g ON g.id=r.grand_prix_id JOIN f1db_circuits c ON c.id=r.circuit_id WHERE r.year=:y ORDER BY r.round", y=season)
    col = sv.colours()
    names = {r["id"]: r for r in db.q("SELECT id, name, abbreviation FROM f1db_drivers")}
    cons = {r["id"]: r["name"] for r in db.q("SELECT id, name FROM f1db_constructors")}
    last = db.q("SELECT MAX(race_id) AS r FROM f1db_race_results WHERE year=:y", y=season)[0]["r"]
    out = []
    for r in races:
        res = db.q("SELECT driver_id, constructor_id, position_number, pit_stops FROM f1db_race_results WHERE race_id=:r "
                   "AND position_text NOT IN ('DNQ','DNPQ','EX') ORDER BY position_display_order", r=r["id"])
        entry = res or (db.q("SELECT driver_id, constructor_id FROM f1db_race_results WHERE race_id=:r ORDER BY position_display_order", r=last) if last else [])
        drivers = [{"id": e["driver_id"], "code": names.get(e["driver_id"], {}).get("abbreviation"), "name": names.get(e["driver_id"], {}).get("name", e["driver_id"]),
                    "team": cons.get(e["constructor_id"]), "colour": col["driver"].get(e["driver_id"], {}).get("colour") or col["constructor"].get(e["constructor_id"], {}).get("colour")}
                   for e in entry]
        result = None
        if res:
            pos = {x["position_number"]: x for x in res if x["position_number"]}
            if all(k in pos for k in (1, 2, 3)):
                fl = db.q("SELECT driver_id FROM f1db_fastest_laps WHERE race_id=:r AND position_number=1", r=r["id"])
                sc = None
                if db.has_table("of1_race_control"):   # Safety Car (not VSC) deployed? known only for races with lap-level data
                    day = pd.Timestamp(r["date"])
                    for s in db.q("SELECT session_key, date_start FROM of1_sessions WHERE year=:y AND session_name='Race'", y=season):
                        if abs((pd.Timestamp(s["date_start"], unit="s").normalize() - day).days) <= 1 and db.q(
                                "SELECT 1 AS x FROM of1_laps WHERE session_key=:k LIMIT 1", k=s["session_key"]):
                            n = db.q("SELECT COUNT(*) AS n FROM of1_race_control WHERE session_key=:k AND category='SafetyCar' "
                                     "AND message LIKE '%SAFETY CAR DEPLOYED%' AND message NOT LIKE '%VIRTUAL%'", k=s["session_key"])[0]["n"]
                            sc = bool(n)
                stops = pos[1]["pit_stops"]
                result = {"winner": pos[1]["driver_id"], "p2": pos[2]["driver_id"], "p3": pos[3]["driver_id"], "fastest_lap": fl[0]["driver_id"] if fl else None,
                          "safety_car": sc, "winner_stops": None if stops is None or pd.isna(stops) else int(stops)}
        out.append({"id": int(r["id"]), "season": int(r["year"]), "round": int(r["round"]), "name": r["name"], "circuit": r["circuit"],
                    "starts_at": _start_iso(r["date"], r["time"]), "drivers": drivers, "result": result,
                    "scored_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()) if result else None})
    return out


def as_sql(rows: list[dict]) -> str:
    q = lambda s: "null" if s is None else "'" + str(s).replace("'", "''") + "'"
    lines = ["-- Race list for predictions and leagues. Paste into Supabase → SQL Editor → Run (after schema.sql). Safe to run again."]
    for r in rows:
        lines.append(
            "insert into public.races (id, season, round, name, circuit, starts_at, drivers, result, scored_at) values "
            f"({r['id']}, {r['season']}, {r['round']}, {q(r['name'])}, {q(r['circuit'])}, {q(r['starts_at'])}, {q(json.dumps(r['drivers']))}::jsonb, "
            f"{q(json.dumps(r['result'])) + '::jsonb' if r['result'] else 'null'}, {q(r['scored_at'])}) "
            "on conflict (id) do update set name=excluded.name, circuit=excluded.circuit, starts_at=excluded.starts_at, drivers=excluded.drivers, "
            "result=coalesce(excluded.result, public.races.result), scored_at=coalesce(public.races.scored_at, excluded.scored_at);")
    return "\n".join(lines) + "\n"


def push(rows: list[dict]) -> dict:
    url, key = os.getenv("SUPABASE_URL", "").rstrip("/"), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return {"synced": 0, "skipped": "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set"}
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}
    # never overwrite a stored result with null: send scored and unscored races separately
    scored = [r for r in rows if r["result"]]
    open_ = [{k: v for k, v in r.items() if k not in ("result", "scored_at")} for r in rows if not r["result"]]
    with httpx.Client(timeout=30) as c:
        for batch in (scored, open_):
            if batch:
                resp = c.post(f"{url}/rest/v1/races?on_conflict=id", headers=h, content=json.dumps(batch))
                resp.raise_for_status()
    return {"synced": len(rows), "scored": len(scored), "open": len(open_)}


if __name__ == "__main__":
    rows = race_rows()
    if "--sql" in sys.argv:
        print(as_sql(rows))
    else:
        print(json.dumps(push(rows)))
