"""Live loop: discovers the current session, polls OpenF1 at a configurable cadence, stores new records
and notifies WebSocket subscribers. Outside a session it idles and only refreshes the session list."""
from __future__ import annotations
import asyncio, time
from . import db, ingest, racestate as rs, clock, stream
from .config import LIVE_POLL_SECONDS, IDLE_POLL_SECONDS
from .connectors.base import SourceError

subscribers: set = set()
state = {"current": None, "last_poll": None, "last_error": None, "weather_flag": None, "polls": 0}
LIVE_ENDPOINTS = ["laps", "stints", "pit", "position", "weather", "race_control", "drivers"]


def current_session() -> dict | None:
    """A session (any type) whose scheduled window contains now (with 15 min lead / 60 min overrun)."""
    if not db.has_table("of1_sessions"):
        return None
    now = time.time()
    r = db.q("SELECT * FROM of1_sessions WHERE date_start - 900 <= :n AND COALESCE(date_end, date_start + 7200) + 3600 >= :n "
             "ORDER BY date_start DESC LIMIT 1", n=now)
    return r[0] if r else None


def next_session() -> dict | None:
    if not db.has_table("of1_sessions"):
        return None
    r = db.q("SELECT * FROM of1_sessions WHERE date_start > :n ORDER BY date_start LIMIT 1", n=time.time())
    return r[0] if r else None


async def broadcast(msg: dict) -> None:
    dead = []
    for ws in list(subscribers):
        try:
            await ws.send_json(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        subscribers.discard(ws)


def _snapshot(cur: dict, new_laps: int) -> dict:
    st = rs.state(cur["session_key"])
    rain = (st.get("weather") or {}).get("rainfall")
    changed_weather = state["weather_flag"] is not None and rain != state["weather_flag"]
    state["weather_flag"] = rain
    return {"session_key": cur["session_key"], "new_laps": new_laps, "lap": st["lap"], "mode": st["mode"]["mode"],
            "track_status": st["track_status"], "weather_changed": changed_weather, "rainfall": rain}


def _poll_once() -> dict | None:
    """Full REST refresh of the current session (the fallback path, and the periodic reconciliation)."""
    cur = current_session()
    state["current"] = cur
    if not cur:
        return None
    before = db.q("SELECT COUNT(*) AS n FROM of1_laps WHERE session_key=:k", k=cur["session_key"])[0]["n"] if db.has_table("of1_laps") else 0
    ingest.ingest_session(cur["session_key"], LIVE_ENDPOINTS)
    rs.load.clear()
    after = db.q("SELECT COUNT(*) AS n FROM of1_laps WHERE session_key=:k", k=cur["session_key"])[0]["n"]
    state["last_rest_poll"] = time.time()
    return _snapshot(cur, after - before)


def _stream_tick() -> dict | None:
    """Store whatever the MQTT stream delivered since the last tick."""
    cur = current_session()
    state["current"] = cur
    if not cur:
        return None
    stored = stream.flush()
    fresh = stream.take_fresh()
    if not stored:
        return {"session_key": cur["session_key"], "new_laps": 0, "weather_changed": False, "quiet": True}
    rs.load.clear()
    snap = _snapshot(cur, fresh.get("laps", 0) + fresh.get("position", 0) + fresh.get("race_control", 0) + fresh.get("pit", 0))
    snap["stream"] = stored
    return snap


def start_rehearsal(session_key: int, speed: float = 10.0, start_lap: int = 1) -> dict:
    """Begin replaying a stored race as if it were live. Refused while a real session is in progress."""
    if current_session():
        raise ValueError("A real session is in progress — rehearsal is disabled while live data is arriving.")
    d = rs.load(int(session_key))
    lead = d["lead_end"]
    if not d["max_lap"] or d["session"]["session_name"] != "Race":
        raise ValueError("Pick a stored race that has lap data.")
    start_lap = int(min(max(1, start_lap), d["max_lap"] - 1))
    laps_ok = lead.index[lead.index >= start_lap]
    t0 = float(lead.loc[laps_ok.min()]) - 5.0        # just before the chosen lap is completed
    label = f"{d['session']['year']} {d['session']['location']}"
    state.update(rehearsal_lap=None, weather_flag=None)
    return clock.start(int(session_key), t0, float(lead.max()), float(min(max(speed, 1), 60)), label)


async def _rehearsal_tick() -> None:
    """Push an update whenever the rehearsal clock crosses into a new lap or the rain sensor flips."""
    key = clock.active()
    st = await asyncio.to_thread(rs.state, key)
    rain = (st.get("weather") or {}).get("rainfall")
    if st["lap"] != state.get("rehearsal_lap") or st["track_status"] != state.get("rehearsal_status"):
        state["rehearsal_lap"], state["rehearsal_status"] = st["lap"], st["track_status"]
        await broadcast({"type": "update", "session_key": key, "lap": st["lap"], "mode": "REHEARSAL", "track_status": st["track_status"]})
    if state.get("weather_flag") is not None and rain != state["weather_flag"]:
        await broadcast({"type": "weather_alert", "rainfall": rain, "session_key": key,
                         "message": "Track rain sensor changed state — weather scenarios recalculated."})
    state["weather_flag"] = rain


async def loop() -> None:
    last_sessions = 0.0
    while True:
        delay = IDLE_POLL_SECONDS
        try:
            if clock.active() is not None:
                await _rehearsal_tick()
                await asyncio.sleep(1.5)
                continue
            if time.time() - last_sessions > 6 * 3600:
                await asyncio.to_thread(ingest.ingest_sessions, time.gmtime().tm_year)
                last_sessions = time.time()
            cur = current_session()
            if cur and stream.ENABLED and not stream.state["running"]:
                await asyncio.to_thread(stream.start)            # a session is on: open the real-time stream
            if not cur and stream.state["running"]:
                await asyncio.to_thread(stream.stop)
            use_stream = bool(cur) and stream.healthy()
            # REST: every few seconds when it is the only source; every 90 s as a reconciliation when the stream is healthy
            rest_due = time.time() - (state.get("last_rest_poll") or 0) >= (90 if use_stream else LIVE_POLL_SECONDS)
            res, problem = None, None
            if cur:         # set first: a failure below must not turn a session into a five-minute wait
                delay = 1.5 if stream.state["running"] else LIVE_POLL_SECONDS
            if cur and stream.state["running"]:
                stream.refresh_token_if_needed()
                try:
                    res = await asyncio.to_thread(_stream_tick)
                except Exception as e:      # one unreadable record must not stop the reconciliation below
                    problem = f"stream tick: {type(e).__name__}: {e}"
            if cur and (rest_due or (problem and time.time() - (state.get("last_rest_poll") or 0) >= LIVE_POLL_SECONDS)):
                try:
                    rest = await asyncio.to_thread(_poll_once)
                    if rest and (rest["new_laps"] or rest["weather_changed"] or not res or res.get("quiet")):
                        res = rest
                except Exception as e:
                    problem = (problem + " | " if problem else "") + f"REST poll: {type(e).__name__}: {e}"
                    state["last_rest_poll"] = time.time()         # do not hammer the API while it is failing
            state["last_poll"] = time.time(); state["polls"] += 1; state["last_error"] = problem
            if cur:
                if res and (res.get("new_laps") or res.get("weather_changed")):
                    await broadcast({"type": "update", **{k: v for k, v in res.items() if k != "stream"}})   # clients refetch
                if res and res.get("weather_changed"):
                    await broadcast({"type": "weather_alert", "rainfall": res["rainfall"], "session_key": res["session_key"],
                                     "message": "Track rain sensor changed state — weather scenarios recalculated."})
            else:
                nxt = next_session()
                if nxt:
                    delay = max(LIVE_POLL_SECONDS, min(IDLE_POLL_SECONDS, nxt["date_start"] - 900 - time.time()))
        except (SourceError, Exception) as e:
            state["last_error"] = f"{type(e).__name__}: {e}"
        slept = 0.0
        while slept < delay and clock.active() is None:      # stay responsive to a rehearsal being started
            await asyncio.sleep(min(2.0, delay - slept)); slept += 2.0
