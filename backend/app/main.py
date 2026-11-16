"""APEX F1 Intelligence — API. Run: uvicorn app.main:app --port 8000"""
from __future__ import annotations
import asyncio, os, threading, time
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Body, Header
from fastapi.middleware.cors import CORSMiddleware
from . import db, live, racestate as rs, service as sv, weather, retrain, ingest, bootstrap, nextrace, clock, stream
from .config import CORS_ORIGINS


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    tasks = []
    # hosted deployments: build the database and models on first start (APEX_BOOTSTRAP=1 or "quick")
    mode = os.getenv("APEX_BOOTSTRAP", "0")
    if mode in ("1", "quick") and bootstrap.needed():
        tasks.append(asyncio.create_task(asyncio.to_thread(bootstrap.run, mode == "quick")))
    if os.getenv("APEX_LIVE", "1") == "1":
        tasks.append(asyncio.create_task(live.loop()))
    if os.getenv("APEX_WARM", "1") == "1" and not bootstrap.needed():
        tasks.append(asyncio.create_task(asyncio.to_thread(_warm)))
    if os.getenv("APEX_AUTO_RETRAIN", "0") == "1":
        tasks.append(asyncio.create_task(asyncio.to_thread(retrain.run)))
    yield
    for t in tasks:
        t.cancel()


def _warm() -> None:
    """Pre-compute the slow one-off pieces of the Next Race page right after start-up, so the first visitor
    does not wait for them (the upcoming-race prediction and each driver's recent race pace)."""
    try:
        with _slots:
            nextrace.overview()
        with _slots:
            nextrace.recent_pace()
    except Exception as e:      # warming is best-effort; requests compute on demand if it fails
        print(f"[warm] skipped: {type(e).__name__}: {e}", flush=True)


app = FastAPI(title="APEX F1 Intelligence", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


# Heavy requests (models, simulations) run a few at a time so memory stays bounded on small hosts.
_slots = threading.BoundedSemaphore(int(os.getenv("APEX_MAX_CONCURRENCY", "2")))


def guard(fn, *a, light: bool = False, **k):
    """Run a service call. Heavy calls (models, simulations) take a slot so memory stays bounded; `light` calls
    (timing, lap tables, status) skip the queue, so the timing screen stays current while predictions catch up."""
    try:
        if light:
            return sv.clean(fn(*a, **k))
        with _slots:
            return sv.clean(fn(*a, **k))
    except KeyError as e:
        raise HTTPException(404, str(e))
    except HTTPException:
        raise
    except Exception as e:  # surface the limitation instead of inventing data
        raise HTTPException(503, f"{type(e).__name__}: {e}")


def default_key() -> int:
    if clock.active() is not None:
        return clock.active()
    cur = live.current_session()
    if cur and cur.get("session_type") == "Race":       # Grand Prix or Sprint
        return cur["session_key"]
    k = ingest.latest_race_key() if db.has_table("of1_sessions") else None
    have = rs.race_sessions(1)
    if have:
        return have[0]["session_key"]
    if k:
        return k
    if bootstrap.state["running"]:
        raise HTTPException(503, f"First-time setup in progress — {bootstrap.state['step']}. The dashboard fills in when it finishes.")
    raise HTTPException(503, "No race sessions stored yet. Run `python -m app.bootstrap` (or set APEX_BOOTSTRAP=1).")


@app.get("/api/health")
def health():
    """Liveness probe for hosting platforms; also reports first-time setup progress."""
    from .config import SEEDED
    return {"ok": True, "bootstrap": bootstrap.state, "started_from_snapshot": SEEDED}


@app.get("/api/status")
def status():
    cur, nxt = live.current_session(), live.next_session()
    key = default_key()
    st = rs.state(key)
    return sv.clean({"now": time.time(), "default_session": key, "mode": st["mode"], "current_session": cur, "next_session": nxt,
                     "live_loop": live.state | {"current": None}, "openf1_authenticated": bool(os.getenv("OPENF1_USERNAME")),
                     "contenders": sv.contenders() if db.has_table("f1db_driver_standings") else []})


@app.get("/api/sessions")
def sessions():
    return rs.race_sessions()


@app.get("/api/command")
def command(session_key: int | None = None, lap: int | None = None):
    return guard(sv.command, session_key or default_key(), lap, light=True)


@app.get("/api/telemetry/laps")
def tel_laps(session_key: int | None = None, lap: int | None = None):
    return guard(sv.lap_table, session_key or default_key(), lap, light=True)


@app.get("/api/telemetry/compare")
def tel_compare(d1: int, l1: int, d2: int | None = None, l2: int | None = None, session_key: int | None = None):
    return guard(sv.telemetry_compare, session_key or default_key(), d1, l1, d2, l2)


@app.get("/api/telemetry/track")
def tel_track(session_key: int | None = None, lap: int | None = None):
    return guard(sv.track_map, session_key or default_key(), lap)


@app.get("/api/telemetry/cars")
def tel_cars(session_key: int | None = None):
    """Newest car positions from the real-time stream (empty when no stream is running — nothing is generated)."""
    key = session_key or default_key()
    cars = stream.live_cars(key)
    info = {}
    if cars:
        info = {r["driver_number"]: r for r in rs.state(key)["rows"]}
    return sv.clean({"streaming": stream.healthy(), "cars": [dict(c, code=info.get(c["driver_number"], {}).get("code"), team_colour=info.get(c["driver_number"], {}).get("team_colour"),
                                                               position=info.get(c["driver_number"], {}).get("position")) for c in cars]})


@app.get("/api/telemetry/pace")
def tel_pace(session_key: int | None = None, lap: int | None = None):
    return guard(sv.pace_comparison, session_key or default_key(), lap)


@app.get("/api/predict/prerace")
def predict_prerace(race_id: int | None = None):
    return guard(sv.prerace_prediction, race_id)


@app.get("/api/predict/inrace")
def predict_inrace(session_key: int | None = None, lap: int | None = None):
    return guard(sv.inrace_prediction, session_key or default_key(), lap)


@app.get("/api/strategy")
def strategy(session_key: int | None = None, lap: int | None = None, driver: int | None = None, parts: str = "overview,plans"):
    return guard(sv.strategy_view, session_key or default_key(), lap, driver, parts)


@app.get("/api/weather")
def weather_get(session_key: int | None = None, lap: int | None = None, driver: int | None = None):
    return guard(weather.intelligence, session_key or default_key(), lap, driver)


@app.post("/api/weather/scenario")
def weather_scenario(body: dict = Body(...)):
    return guard(weather.intelligence, body.get("session_key") or default_key(), body.get("lap"), body.get("driver"), body.get("what_if") or {})


@app.get("/api/weather/summary")
def weather_summary(session_key: int | None = None, lap: int | None = None):
    """Forecast headline only (no simulation) — used by the Command Centre tile."""
    return guard(weather.summary, session_key or default_key(), lap, light=True)


@app.get("/api/weather/next")
def weather_next():
    return guard(weather.next_race_forecast)


@app.post("/api/safetycar")
def safetycar(body: dict = Body(...)):
    return guard(sv.safety_car, body.get("session_key") or default_key(), body.get("lap"), body.get("driver"), body)


@app.post("/api/sim/run")
def sim_run(body: dict = Body(...)):
    return guard(sv.lab, body.get("session_key") or default_key(), body)


@app.get("/api/live")
def live_status():
    """What 'live' means right now: a real session in progress, a rehearsal, or nothing — plus the next session."""
    cur, nxt, reh = live.current_session(), live.next_session(), clock.info()
    from .connectors.openf1 import openf1
    if openf1.auth_state["configured"] and openf1.auth_state["ok"] is None:
        openf1.headers()        # first look: try the paid sign-in once so its result can be reported
    out = {"now": time.time(), "current_session": cur, "next_session": nxt, "rehearsal": reh, "openf1_auth": dict(openf1.auth_state),
           "stream": {**{k: stream.state[k] for k in ("enabled", "running", "connected", "last_message", "messages", "stored", "last_error", "connects")},
                      "healthy": stream.healthy(), "by_topic": dict(stream.state["by_topic"])},
           "openf1_authenticated": bool(os.getenv("OPENF1_USERNAME")), "live_loop": {k: live.state.get(k) for k in ("last_poll", "last_error", "polls")},
           "rehearsal_needs_code": bool(os.getenv("APEX_ADMIN_TOKEN")), "mode": None, "session_key": None, "lap": None}
    key = reh["session_key"] if reh else (cur["session_key"] if cur and cur.get("session_type") == "Race" else None)
    if key is not None:
        try:
            st = rs.state(key)
            out.update(mode=st["mode"], session_key=key, lap=st["lap"], total_laps=st["total_laps"], track_status=st["track_status"])
        except Exception as e:
            out["mode"] = {"mode": "DELAYED", "reason": f"Session found but no timing data stored yet ({type(e).__name__})."}; out["session_key"] = key
    return sv.clean(out)


def _admin(code: str | None) -> None:
    need = os.getenv("APEX_ADMIN_TOKEN")
    if need and code != need:
        raise HTTPException(403, "That admin code is not right.")


@app.post("/api/live/rehearsal")
def rehearsal_start(body: dict = Body(default={}), x_admin_code: str | None = Header(default=None)):
    """Replay a stored race through the live path (a labelled simulation). Everyone viewing the site sees it."""
    _admin(x_admin_code)
    try:
        info = live.start_rehearsal(int(body.get("session_key") or (rs.race_sessions(1)[0]["session_key"])), float(body.get("speed", 10)), int(body.get("start_lap", 1)))
    except (ValueError, KeyError, IndexError) as e:
        raise HTTPException(400, str(e))
    return sv.clean(info)


@app.post("/api/live/stream-test")
def stream_test(x_admin_code: str | None = Header(default=None)):
    """Check that this host can reach OpenF1's real-time broker with the configured account."""
    _admin(x_admin_code)
    if live.current_session():
        return sv.clean({"ok": stream.state["connected"], "note": "A session is in progress; reporting the running stream.",
                         **{k: stream.state[k] for k in ("running", "connected", "messages", "stored", "last_error")}})
    return sv.clean(stream.probe())


@app.delete("/api/live/rehearsal")
def rehearsal_stop(x_admin_code: str | None = Header(default=None)):
    _admin(x_admin_code)
    clock.stop()
    return {"stopped": True}


@app.get("/api/next")
def next_overview():
    """Upcoming Grand Prix: prediction, forecast, circuit history and the inputs the pre-race simulator will use."""
    return guard(nextrace.overview)


@app.post("/api/next/simulate")
def next_simulate(body: dict = Body(default={})):
    return guard(nextrace.simulate, body)


@app.get("/api/history/overview")
def h_overview():
    return guard(sv.history_overview)


@app.get("/api/history/search")
def h_search(q: str):
    return guard(sv.search, q)


@app.get("/api/history/season/{year}")
def h_season(year: int):
    return guard(sv.season, year)


@app.get("/api/history/circuit/{circuit_id}")
def h_circuit(circuit_id: str):
    return guard(sv.circuit, circuit_id)


@app.get("/api/history/driver/{driver_id}")
def h_driver(driver_id: str):
    return guard(sv.driver_history, driver_id)


@app.get("/api/history/similar")
def h_similar(session_key: int | None = None, lap: int | None = None):
    return guard(sv.similar, session_key or default_key(), lap)


@app.get("/api/analytics")
def analytics(year: int | None = None):
    return guard(sv.analytics, year)


@app.get("/api/advisor")
def advisor(session_key: int | None = None, lap: int | None = None, driver: int | None = None, parts: str = "weather,strategy,explain"):
    return guard(sv.advisor, session_key or default_key(), lap, driver, parts)


@app.get("/api/health/sources")
def health_sources():
    return guard(sv.sources)


@app.get("/api/models")
def models():
    return guard(sv.models)


@app.post("/api/admin/retrain")
async def admin_retrain(force: bool = False):
    return sv.clean(await asyncio.to_thread(retrain.run, force))


@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    """Pushes {type:'update'} whenever the live loop stores new laps, plus a heartbeat with the feed mode."""
    await ws.accept()
    live.subscribers.add(ws)
    try:
        while True:
            key = default_key()
            st = rs.state(key)
            await ws.send_json({"type": "heartbeat", "session_key": key, "mode": st["mode"]["mode"], "lap": st["lap"],
                                "track_status": st["track_status"], "now": time.time()})
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=15)
            except asyncio.TimeoutError:
                pass
    except (WebSocketDisconnect, Exception):
        live.subscribers.discard(ws)
