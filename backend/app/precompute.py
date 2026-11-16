"""Work out the common answers ahead of time: `python -m app.precompute`.

Runs while the container image is built (see the Dockerfile), where CPU is plentiful, and writes the results
to the durable store that ships inside the image. The running server then answers those requests from the
store instead of simulating on a small shared CPU. Results are produced by the same route functions the
API serves — same models, same number of simulations, same seeds — so a stored answer is identical to a
computed one. A time budget keeps the build short; anything not reached is simply computed on demand.
"""
from __future__ import annotations
import os, sys, time


def run(budget: float | None = None) -> dict:
    os.environ.setdefault("APEX_LIVE", "0")
    from . import main, racestate as rs, store
    budget = float(os.getenv("APEX_PRECOMPUTE_SECONDS", "300")) if budget is None else budget
    t0 = time.time()
    done = {"calls": 0, "errors": 0, "stopped_early": False}
    races = rs.race_sessions(1)
    if not races:
        print("[precompute] no stored race — nothing to do"); return done
    key = races[0]["session_key"]
    st = rs.state(key)
    if st["mode"]["mode"] != "HISTORICAL":
        print("[precompute] newest race is not finished — skipped"); return done
    total = st["total_laps"] or st["max_lap"]
    order = [r["driver_number"] for r in st["rows"]]          # finishing order: the winner is the dashboard's default driver
    laps = list(range(2, total))

    def call(fn, *a, **k) -> bool:
        if time.time() - t0 > budget:
            done["stopped_early"] = True
            return False
        try:
            fn(*a, **k); done["calls"] += 1
        except Exception as e:      # a failed pre-computation only means the request is computed on demand
            done["errors"] += 1
            if done["errors"] <= 3:
                print(f"[precompute] {getattr(fn, '__name__', fn)} {a} {k}: {type(e).__name__}: {e}", flush=True)
        return True

    def per_lap(lap: int) -> bool:
        return (call(main.predict_inrace, session_key=key, lap=lap) and call(main.tel_pace, session_key=key, lap=lap)
                and call(main.h_similar, session_key=key, lap=lap))

    def per_driver(lap: int, d: int) -> bool:
        return (call(main.strategy, session_key=key, lap=lap, driver=d, parts="overview")
                and call(main.strategy, session_key=key, lap=lap, driver=d, parts="plans")
                and call(main.advisor, session_key=key, lap=lap, driver=d, parts="strategy")
                and call(main.advisor, session_key=key, lap=lap, driver=d, parts="explain")
                and call(main.safetycar, {"session_key": key, "lap": lap, "driver": d}))

    # most likely first: every lap for the default driver, then the rest of the podium, then the field at wider spacing
    plan = [("lap", l, None) for l in laps] + [("drv", l, order[0]) for l in laps]
    plan += [("drv", l, d) for d in order[1:3] for l in laps[::2]]
    plan += [("drv", l, d) for d in order[3:] for l in laps[::6]]
    for kind, lap, d in plan:
        if not (per_lap(lap) if kind == "lap" else per_driver(lap, d)):
            break
    done.update(seconds=round(time.time() - t0, 1), stored=store.count(), race=key, laps=len(laps))
    print(f"[precompute] {done}", flush=True)
    return done


if __name__ == "__main__":
    run(float(sys.argv[1]) if len(sys.argv) > 1 else None)
