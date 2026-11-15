"""Scheduled refresh: pull new results and race data, retrain if new races arrived (with the validation
gate in `retrain`), and re-export the committed snapshot only when something actually changed.

    python -m app.refresh            # prints a summary; writes changed=true|false to $GITHUB_OUTPUT when set
"""
from __future__ import annotations
import json, os, time
from . import db, retrain, seed


def fingerprint() -> dict:
    """What the snapshot contains: latest result, races with lap data, active model versions."""
    db.init()
    last = db.q("SELECT year, round FROM f1db_race_results ORDER BY year DESC, round DESC LIMIT 1") if db.has_table("f1db_race_results") else []
    races = db.q("SELECT COUNT(DISTINCT l.session_key) AS n FROM of1_laps l JOIN of1_sessions s ON s.session_key=l.session_key "
                 "WHERE s.session_name='Race'")[0]["n"] if db.has_table("of1_laps") else 0
    models = {r["name"]: r["version"] for r in db.q("SELECT name, version FROM model_registry WHERE active=1")}
    return {"latest_result": f"{last[0]['year']} R{last[0]['round']}" if last else None, "races_with_laps": races, "models": models}


def run() -> dict:
    t = time.time()
    before = fingerprint()
    result = retrain.run()
    after = fingerprint()
    changed = before != after
    if changed:
        seed.export()
    out = {"changed": changed, "before": before, "after": after, "actions": result["actions"], "minutes": round((time.time() - t) / 60, 1)}
    gh = os.getenv("GITHUB_OUTPUT")
    if gh:
        with open(gh, "a") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")
            f.write(f"summary={after['latest_result']}, {after['races_with_laps']} races with lap data\n")
    return out


if __name__ == "__main__":
    print(json.dumps(run(), indent=1))
