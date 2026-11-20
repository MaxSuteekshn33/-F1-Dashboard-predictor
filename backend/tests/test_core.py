"""Offline unit tests (no network, no database rows needed)."""
import numpy as np
import pandas as pd
from app import strategy as sg, sim
from app.prerace import normalise, wilson, pl_sample, ece
from app.connectors.openf1 import to_epoch


def model(pit=22.0):
    return {"compounds": {"SOFT": {"deg": 0.10, "offset": -0.6}, "MEDIUM": {"deg": 0.06, "offset": 0.0}, "HARD": {"deg": 0.035, "offset": 0.5}},
            "pit_loss": pit}


def test_timestamps_normalise_to_utc_epoch():
    s = pd.Series(["2026-11-08T17:00:00+00:00", "2026-11-08T14:00:00-03:00", None])
    e = to_epoch(s)
    assert e[0] == e[1] and np.isnan(e[2])


def test_optimiser_respects_two_compound_rule_and_distance():
    p = sg.optimise(model(), cur_lap=10, total_laps=60, comp="MEDIUM", age=10, used=["MEDIUM"], stops=1)
    assert p and p["rule_ok"] and len(p["plan"]) == 1
    assert p["plan"][0]["compound"] != "MEDIUM"                      # must run a second dry compound
    assert sum(s["laps"] for s in p["stints"]) == 50                 # covers exactly the remaining laps
    assert 10 < p["plan"][0]["lap"] < 60


def test_no_stop_is_illegal_with_one_compound_and_more_stops_cost_pit_time():
    m = model()
    p0 = sg.optimise(m, 10, 60, "MEDIUM", 10, ["MEDIUM"], 0)
    assert p0 is not None and not p0["rule_ok"]
    p1, p2 = sg.optimise(m, 10, 60, "MEDIUM", 10, ["MEDIUM"], 1), sg.optimise(m, 10, 60, "MEDIUM", 10, ["MEDIUM"], 2)
    assert p2["pit_time_lost"] == 2 * m["pit_loss"] and p1["pit_time_lost"] == m["pit_loss"]


def test_cheaper_pit_lane_favours_more_stops():
    cheap, dear = model(pit=8.0), model(pit=35.0)
    best = lambda m: min((sg.optimise(m, 5, 60, "SOFT", 5, ["SOFT"], k) for k in (1, 2, 3)), key=lambda p: p["rel_time"])["stops"]
    assert best(cheap) >= best(dear)


def test_pit_window_contains_the_optimum():
    m = model()
    p = sg.optimise(m, 10, 60, "MEDIUM", 10, ["MEDIUM"], 1)
    w = sg.window(m, p, 10, 60, "MEDIUM", 10)
    assert w["open"] <= w["optimal"] <= w["close"]


def test_wet_penalty_crossovers():
    f = lambda c, w: float(sim.wet_penalty(np.array(c), w))
    assert f(0, 0.0) == 0 and f(0, 0.1) < f(3, 0.1)                  # dry: slicks faster
    assert f(3, 0.45) < f(0, 0.45) and f(3, 0.45) < f(4, 0.45)       # damp: intermediates fastest
    assert f(4, 0.95) < f(3, 0.95) < f(0, 0.95)                      # soaked: full wets fastest
    assert f(0, sim.W_SLICK_TO_INTER - 0.05) < f(3, sim.W_SLICK_TO_INTER - 0.05)
    assert f(0, sim.W_SLICK_TO_INTER + 0.05) > f(3, sim.W_SLICK_TO_INTER + 0.05)


def test_wetness_path_wets_then_dries():
    path = sim.wetness_path(0.0, [0.8] * 5 + [0.0] * 30, 30, 2)
    assert path[4] > 0.5 and path[-1] < path[4] and (np.diff(path[5:]) <= 0).all()


def test_probability_helpers():
    p = normalise(np.array([0.2, 0.2, 0.1, 0.5, 0.5]), np.array([1, 1, 1, 2, 2]), 1.0)
    assert abs(p[:3].sum() - 1) < 1e-9 and abs(p[3:].sum() - 1) < 1e-2
    lo, hi = wilson(5, 50)
    assert 0 < lo < 0.1 < hi < 0.25
    pos = pl_sample(np.log(np.array([0.7, 0.2, 0.1])), 4000, np.random.default_rng(0))
    assert (pos == 1).mean(0)[0] > 0.6 and sorted(pos[0].tolist()) == [1, 2, 3]
    assert ece(np.array([0.1] * 100), np.array([1] * 10 + [0] * 90)) < 1e-9


def test_fast_planner_matches_cp_sat_optimum():
    m = model()
    for comp, age, used in (("MEDIUM", 10, ["MEDIUM"]), ("SOFT", 4, ["SOFT", "HARD"]), ("HARD", 18, ["HARD"]), (None, 0, ["INTERMEDIATE"])):
        f = sg.fast_plan(m, 12, 58, comp, age, used)
        legal = [o for o in (sg.optimise(m, 12, 58, comp, age, used, k) for k in (0, 1, 2, 3)) if o and o["rule_ok"]]
        best = min(legal, key=lambda o: o["rel_time"])
        assert abs(f["rel_time"] - best["rel_time"]) < 0.01
        assert f["stops"] == best["stops"]


def test_stream_handler_buffers_counts_and_tracks_cars():
    import json, time
    from app import stream
    stream.locations.clear(); stream._buf.clear()
    n0, r0 = stream.state["messages"], stream.state["rejected"]
    stream.handle("v1/laps", json.dumps({"session_key": 1, "driver_number": 4, "lap_number": 7, "date_start": "2026-01-01T00:00:00+00:00"}))
    stream.handle("v1/laps", json.dumps({"session_key": 1, "driver_number": 4, "lap_number": 7, "lap_duration": 90.1, "date_start": "2026-01-01T00:00:00+00:00"}))
    stream.handle("v1/location", json.dumps({"session_key": 1, "driver_number": 4, "x": 10, "y": 20, "z": 0}))
    stream.handle("v1/location", json.dumps({"session_key": 1, "driver_number": 5, "x": 0, "y": 0, "z": 0}))     # no fix yet: ignored
    stream.handle("v1/car_data", json.dumps({"session_key": 1, "driver_number": 4, "speed": 300}))               # not subscribed/stored
    stream.handle("v1/laps", b"{not json")
    assert stream.state["messages"] - n0 == 5 and stream.state["rejected"] - r0 == 1
    assert len(stream._buf["laps"]) == 2 and "car_data" not in stream._buf
    assert [c["driver_number"] for c in stream.live_cars(1)] == [4] and stream.live_cars(2) == []
    # both versions of the same lap collapse to the newest when normalised
    from app.connectors.openf1 import normalise
    f, _ = normalise("laps", list(stream._buf["laps"]))
    assert len(f) == 1 and float(f.lap_duration.iloc[0]) == 90.1
    stream._buf.clear(); stream.locations.clear()
    stream.state.update(connected=True, last_message=time.time()); assert stream.healthy()
    stream.state.update(last_message=time.time() - 300); assert not stream.healthy()
    stream.state.update(connected=False, last_message=None)


def test_exact_search_matches_cp_sat_for_every_stop_count():
    """Requests use the exact dynamic-programming search; CP-SAT is the reference it must agree with."""
    m = model()
    cases = [("MEDIUM", 10, ["MEDIUM"]), ("SOFT", 3, ["SOFT"]), ("HARD", 20, ["MEDIUM", "HARD"]), (None, 0, ["INTERMEDIATE"]), ("SOFT", 0, ["SOFT"])]
    for comp, age, used in cases:
        for cur, total in ((12, 58), (0, 50), (40, 57)):
            for k in (0, 1, 2, 3):
                a, b = sg.optimise(m, cur, total, comp, age, used, k), sg.exact(m, cur, total, comp, age, used, k)
                assert (a is None) == (b is None), (comp, age, used, cur, total, k)
                if a:
                    assert abs(a["rel_time"] - b["rel_time"]) < 0.01, (comp, cur, total, k, a["rel_time"], b["rel_time"])
                    assert a["rule_ok"] == b["rule_ok"] and len(b["plan"]) == k
                    assert sum(s["laps"] for s in b["stints"]) == total - cur
                    if k:
                        fa, fb = (f(m, cur, total, comp, age, used, k, forbid=[x["compound"] for x in a["plan"]]) for f in (sg.optimise, sg.exact))
                        assert (fa is None) == (fb is None)
                        if fa:
                            assert abs(fa["rel_time"] - fb["rel_time"]) < 0.01
                            assert [x["compound"] for x in fb["plan"]] != [x["compound"] for x in a["plan"]]


def test_missing_values_from_a_live_feed_do_not_break_whole_number_fields():
    """A stint announced before its tyre age is known must not crash the race state (seen live in Las Vegas FP2)."""
    from app import racestate as rs
    assert rs._i(float("nan"), 0) == 0 and rs._i(None) is None and rs._i(np.float64(7.0)) == 7
    n = 12                                                    # laps the car has completed
    age = rs._i(float("nan"), 0) + max(0, n - rs._i(10.0, n + 1) + 1)
    assert age == 3                                           # counted from the stint's first lap
    assert rs._i(float("nan"), 0) + max(0, n - rs._i(float("nan"), n + 1) + 1) == 0
