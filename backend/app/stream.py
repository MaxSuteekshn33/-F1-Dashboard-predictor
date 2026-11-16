"""Real-time OpenF1 stream over MQTT (the provider's recommended route for live data).

The server — never the browser — holds the connection: it signs in for an access token, connects to
mqtt.openf1.org with the token as the password, and subscribes to the topics the dashboard uses. Messages
are buffered and written to the same tables the REST ingestion fills, so everything downstream is
unchanged. REST polling stays as a fallback and as a periodic reconciliation, because the stream only
carries what is published after the connection is made.

Car positions arrive several times a second; only the newest position per car is kept in memory (for the
moving circuit map) rather than stored.
"""
from __future__ import annotations
import json, os, ssl, threading, time
from collections import defaultdict
import pandas as pd
from . import db
from .connectors.openf1 import openf1, normalise, KEYS, OpenF1
from .config import OPENF1_USERNAME

HOST = os.getenv("OPENF1_MQTT_HOST", "mqtt.openf1.org")
PORT = int(os.getenv("OPENF1_MQTT_PORT", "8883"))
ENABLED = os.getenv("APEX_MQTT", "1") == "1"
STORED = ["laps", "stints", "pit", "position", "weather", "race_control", "drivers", "sessions"]   # written to the database
TOPICS = [f"v1/{t}" for t in STORED] + ["v1/location"]

state = {"enabled": ENABLED, "running": False, "connected": False, "last_message": None, "messages": 0, "stored": 0, "rejected": 0,
         "by_topic": {}, "last_error": None, "connects": 0, "connected_at": None, "last_flush": None}
_buf: dict[str, list] = defaultdict(list)
_lock = threading.Lock()
_client = None
locations: dict[int, dict] = {}      # driver_number -> newest {x, y, t, session_key}
_fresh = {"laps": 0, "position": 0, "race_control": 0, "pit": 0, "stints": 0, "weather": 0}   # new rows since last ask


def handle(topic: str, payload: bytes | str) -> None:
    """One message from the stream. Kept cheap: parse, count, buffer."""
    try:
        msg = json.loads(payload)
    except (ValueError, TypeError):
        state["rejected"] += 1
        return
    name = topic.split("/", 1)[-1]
    state["messages"] += 1
    state["last_message"] = time.time()
    state["by_topic"][name] = state["by_topic"].get(name, 0) + 1
    if not isinstance(msg, dict):
        return
    if name == "location":
        dn = msg.get("driver_number")
        if dn is not None and (msg.get("x") or msg.get("y")):
            locations[int(dn)] = {"x": msg.get("x"), "y": msg.get("y"), "t": time.time(), "session_key": msg.get("session_key"), "date": msg.get("date")}
        return
    if name in STORED:
        with _lock:
            _buf[name].append(msg)


def flush() -> dict:
    """Write buffered messages to the database. Returns the number of rows stored per dataset."""
    with _lock:
        batch = {k: v for k, v in _buf.items() if v}
        _buf.clear()
    out = {}
    for name, rows in batch.items():
        try:
            f, rej = normalise(name, rows)
            state["rejected"] += rej
            if len(f):
                db.upsert_rows(f"of1_{name}", f, KEYS[name])
                out[name] = len(f)
                state["stored"] += len(f)
                if name in _fresh:
                    _fresh[name] += len(f)
        except Exception as e:      # a bad batch must not stop the stream
            state["last_error"] = f"store {name}: {type(e).__name__}: {str(e)[:160]}"
    if out:
        state["last_flush"] = time.time()
    return out


def take_fresh() -> dict:
    """New rows per dataset since the last call (the live loop uses this to decide whether to notify browsers)."""
    out = {k: v for k, v in _fresh.items() if v}
    for k in _fresh:
        _fresh[k] = 0
    return out


def healthy(max_silence: float = 45.0) -> bool:
    """Connected and a message arrived recently — only then may REST polling be relaxed."""
    return bool(state["connected"] and state["last_message"] and time.time() - state["last_message"] < max_silence)


def live_cars(session_key: int, max_age: float = 6.0) -> list[dict]:
    now = time.time()
    return [{"driver_number": dn, "x": v["x"], "y": v["y"], "age_s": round(now - v["t"], 1)} for dn, v in locations.items()
            if v.get("session_key") == session_key and now - v["t"] <= max_age]


def _token() -> str | None:
    h = openf1.headers()
    return h.get("Authorization", "")[7:] or None


def start() -> bool:
    """Connect and subscribe. Returns False (and records why) if streaming is off or sign-in is unavailable."""
    global _client
    if not ENABLED or state["running"]:
        return state["running"]
    token = _token()
    if not token:
        state["last_error"] = "no access token (OpenF1 sign-in not configured or failing); using REST polling"
        return False
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        state["last_error"] = "paho-mqtt is not installed; using REST polling"
        return False

    def on_connect(client, userdata, flags, reason_code, properties=None):
        if getattr(reason_code, "is_failure", False) or (isinstance(reason_code, int) and reason_code != 0):
            state.update(connected=False, last_error=f"connect refused: {reason_code}")
            return
        state.update(connected=True, connected_at=time.time(), last_error=None)
        state["connects"] += 1
        for t in TOPICS:
            client.subscribe(t)

    def on_disconnect(client, userdata, flags=None, reason_code=None, properties=None):
        state["connected"] = False
        if reason_code is not None and str(reason_code) not in ("Normal disconnection", "0", "Success"):
            state["last_error"] = f"disconnected: {reason_code}"
        # the access token is the password and expires hourly: refresh it before the automatic reconnect
        try:
            OpenF1._token = None
            t = _token()
            if t:
                client.username_pw_set(OPENF1_USERNAME or "apex", t)
        except Exception:
            pass

    def on_message(client, userdata, msg):
        handle(msg.topic, msg.payload)

    try:
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"apex-f1-{os.getpid()}-{int(time.time())}")
        c.username_pw_set(OPENF1_USERNAME or "apex", token)
        c.tls_set(cert_reqs=ssl.CERT_REQUIRED, tls_version=ssl.PROTOCOL_TLS_CLIENT)
        c.reconnect_delay_set(min_delay=2, max_delay=60)
        c.on_connect, c.on_disconnect, c.on_message = on_connect, on_disconnect, on_message
        c.connect_async(HOST, PORT, keepalive=60)
        c.loop_start()
        _client = c
        state.update(running=True, last_error=None)
        return True
    except Exception as e:
        state.update(running=False, connected=False, last_error=f"{type(e).__name__}: {str(e)[:200]}")
        return False


def stop() -> None:
    global _client
    if _client is not None:
        try:
            _client.loop_stop(); _client.disconnect()
        except Exception:
            pass
    _client = None
    state.update(running=False, connected=False)
    locations.clear()


def refresh_token_if_needed() -> None:
    """Called from the live loop: reconnect with a fresh token a few minutes before the hourly expiry."""
    if _client is None or not state["connected"] or not state["connected_at"]:
        return
    if time.time() - state["connected_at"] > 50 * 60:
        try:
            OpenF1._token = None
            t = _token()
            if t:
                _client.username_pw_set(OPENF1_USERNAME or "apex", t)
                state["connected_at"] = time.time()
                _client.reconnect()
        except Exception as e:
            state["last_error"] = f"token refresh: {type(e).__name__}: {str(e)[:160]}"


def probe(seconds: float = 10.0) -> dict:
    """Connectivity check that can be run outside a session: connect, subscribe, wait briefly, disconnect.
    Proves the broker is reachable from this host and that the access token is accepted."""
    if state["running"]:
        return {"ok": state["connected"], "note": "stream already running", **{k: state[k] for k in ("connected", "messages", "last_error")}}
    n0 = state["messages"]
    started = start()
    t0 = time.time()
    while started and not state["connected"] and time.time() - t0 < seconds and not (state["last_error"] or "").startswith("connect refused"):
        time.sleep(0.25)
    connected = state["connected"]
    if connected:
        time.sleep(min(3.0, max(0.0, seconds - (time.time() - t0))))      # listen for a moment
    out = {"ok": bool(connected), "started": bool(started), "connected": bool(connected), "seconds_to_connect": round(time.time() - t0, 1) if connected else None,
           "messages_received": state["messages"] - n0, "error": state["last_error"], "host": f"{HOST}:{PORT}",
           "note": "Connected and subscribed. No messages is normal when no session is running." if connected else "Could not connect; the dashboard will use REST polling."}
    stop()
    return out
