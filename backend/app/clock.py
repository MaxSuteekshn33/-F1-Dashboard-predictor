"""Rehearsal clock: replays a stored race through the live path at a chosen speed.

While a rehearsal is active for a session, "now" for that session is a virtual time that advances from
the first lap at `speed`× real time, and nothing timestamped after it is visible. It exercises the same
code a live race uses (state at the current moment, pushes on each new lap, recalculated predictions),
but it is a SIMULATION of a past race and is always labelled REHEARSAL — never LIVE.
"""
from __future__ import annotations
import time

_r: dict = {"session_key": None}


def start(session_key: int, t0: float, end: float, speed: float, label: str) -> dict:
    _r.update(session_key=int(session_key), t0=float(t0), end=float(end), speed=float(speed), started=time.time(), label=label)
    return info()


def stop() -> None:
    _r.clear(); _r["session_key"] = None


def active() -> int | None:
    if _r.get("session_key") is None:
        return None
    if _r["t0"] + (time.time() - _r["started"]) * _r["speed"] > _r["end"] + 120 * _r["speed"]:
        stop()          # the replay has run past the chequered flag: end it by itself
        return None
    return _r["session_key"]


def virtual_now(session_key: int) -> float | None:
    if active() != int(session_key):
        return None
    return min(_r["t0"] + (time.time() - _r["started"]) * _r["speed"], _r["end"] + 60)


def info() -> dict | None:
    if active() is None:
        return None
    return {"session_key": _r["session_key"], "speed": _r["speed"], "label": _r["label"], "started": _r["started"],
            "virtual_time": virtual_now(_r["session_key"])}
