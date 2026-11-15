"""OpenF1 connector — live + historical timing, 2023 onwards. Units: seconds, km/h, °C, m/s."""
from __future__ import annotations
import time
import pandas as pd
from .base import Connector
from ..config import OPENF1_BASE, OPENF1_USERNAME, OPENF1_PASSWORD

# Fixed column sets -> stable schemas, unknown fields are dropped, missing ones are NULL.
COLUMNS = {
    "sessions": ["session_key", "meeting_key", "session_type", "session_name", "date_start", "date_end", "circuit_key",
                 "circuit_short_name", "country_name", "country_code", "location", "year", "gmt_offset"],
    "drivers": ["session_key", "driver_number", "name_acronym", "full_name", "broadcast_name", "first_name", "last_name",
                "team_name", "team_colour", "country_code"],
    "laps": ["session_key", "driver_number", "lap_number", "date_start", "lap_duration", "duration_sector_1",
             "duration_sector_2", "duration_sector_3", "i1_speed", "i2_speed", "st_speed", "is_pit_out_lap"],
    "stints": ["session_key", "driver_number", "stint_number", "lap_start", "lap_end", "compound", "tyre_age_at_start"],
    "pit": ["session_key", "driver_number", "lap_number", "date", "pit_duration", "stop_duration", "lane_duration"],
    "position": ["session_key", "driver_number", "date", "position"],
    "intervals": ["session_key", "driver_number", "date", "gap_to_leader", "interval"],
    "weather": ["session_key", "date", "air_temperature", "track_temperature", "humidity", "pressure", "rainfall",
                "wind_speed", "wind_direction"],
    "race_control": ["session_key", "date", "lap_number", "category", "flag", "scope", "sector", "driver_number", "message"],
    "session_result": ["session_key", "driver_number", "position", "number_of_laps", "points", "dnf", "dns", "dsq",
                       "gap_to_leader", "duration"],
    "car_data": ["session_key", "driver_number", "date", "speed", "throttle", "brake", "n_gear", "rpm", "drs"],
    "location": ["session_key", "driver_number", "date", "x", "y", "z"],
}
DATE_COLS = {"date", "date_start", "date_end"}


def to_epoch(s: pd.Series) -> pd.Series:
    """ISO-8601 strings (any offset) -> UTC epoch seconds (float). Normalises all timestamps."""
    dt = pd.to_datetime(s, utc=True, errors="coerce", format="ISO8601")
    return (dt - pd.Timestamp("1970-01-01", tz="UTC")).dt.total_seconds().astype("float64")


def iso(epoch: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(epoch)) + f".{int((epoch % 1) * 1000):03d}"


class OpenF1(Connector):
    name = "openf1"
    base_url = OPENF1_BASE
    _token = None
    _token_exp = 0.0

    auth_state: dict = {"configured": bool(OPENF1_USERNAME and OPENF1_PASSWORD), "ok": None, "error": None, "checked": None}

    def headers(self) -> dict:
        """Bearer token for a paid OpenF1 account (real-time access). Falls back to anonymous access if sign-in
        fails, and records why, so the dashboard can say so instead of silently showing delayed data."""
        if not (OPENF1_USERNAME and OPENF1_PASSWORD) or time.time() < OpenF1._anonymous_until:
            return {}
        if not self._token or time.time() > self._token_exp - 60:
            st = OpenF1.auth_state
            if st["ok"] is False and st["checked"] and time.time() - st["checked"] < 120:
                return {}          # failed moments ago: do not hammer the sign-in endpoint on every request
            try:
                r = self.client.post("https://api.openf1.org/token",
                                     data={"username": OPENF1_USERNAME, "password": OPENF1_PASSWORD},
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
                if r.status_code >= 400:
                    raise RuntimeError(f"HTTP {r.status_code}: {r.text[:160]}")
                j = r.json()
                OpenF1._token, OpenF1._token_exp = j["access_token"], time.time() + float(j.get("expires_in", 3600))
                st.update(ok=True, error=None, checked=time.time())
            except Exception as e:
                OpenF1._token = None
                st.update(ok=False, error=f"{type(e).__name__}: {str(e)[:200]}", checked=time.time())
                return {}
        return {"Authorization": f"Bearer {self._token}"}

    _anonymous_until = 0.0

    def on_unauthorized(self) -> bool:
        """A token was rejected (expired early, revoked). First time: drop it and sign in again. If the fresh
        token is rejected too, use anonymous access for ten minutes rather than failing every request."""
        if not OpenF1._token:
            return False
        if OpenF1.auth_state.get("retried"):
            OpenF1._anonymous_until = time.time() + 600
            OpenF1.auth_state.update(ok=False, error="Token rejected twice by the API; using free access for 10 minutes.", checked=time.time(), retried=False)
            OpenF1._token = None
            return True
        OpenF1._token = None
        OpenF1.auth_state["retried"] = True
        return True

    def on_success(self) -> None:
        OpenF1.auth_state["retried"] = False      # a request went through: the next rejection gets a fresh sign-in again

    def min_interval(self) -> float:
        # paid accounts: 6 requests/s and 60/min (free: 3/s and 30/min)
        base = super().min_interval()
        return min(base, 1.05) if OpenF1.auth_state.get("ok") else base

    @property
    def authenticated(self) -> bool:
        return bool(OPENF1_USERNAME and OPENF1_PASSWORD)

    def fetch(self, endpoint: str, query: str, ttl: float = 0) -> tuple[pd.DataFrame, int]:
        """Returns (validated frame, rejected-row count). Dates become epoch seconds; numeric fields are
        coerced; rows without their key fields are rejected; duplicates are removed."""
        raw = self.get(endpoint, query, ttl=ttl, empty_404=True)
        cols = COLUMNS[endpoint]
        if not isinstance(raw, list) or not raw:
            return pd.DataFrame(columns=cols), 0
        f = pd.DataFrame(raw).reindex(columns=cols)
        for c in cols:
            if c in DATE_COLS:
                f[c] = to_epoch(f[c])
        num = {"laps": ["lap_number", "lap_duration", "duration_sector_1", "duration_sector_2", "duration_sector_3",
                        "i1_speed", "i2_speed", "st_speed"],
               "pit": ["lap_number", "pit_duration", "stop_duration", "lane_duration"],
               "intervals": [], "position": ["position"],
               "weather": ["air_temperature", "track_temperature", "humidity", "pressure", "rainfall", "wind_speed", "wind_direction"],
               "stints": ["lap_start", "lap_end", "tyre_age_at_start", "stint_number"],
               "session_result": ["position", "number_of_laps", "points", "duration"],
               "car_data": ["speed", "throttle", "brake", "n_gear", "rpm", "drs"], "location": ["x", "y", "z"]}
        for c in num.get(endpoint, []):
            f[c] = pd.to_numeric(f[c], errors="coerce")
        if endpoint in ("intervals", "session_result"):
            # "+1 LAP" style strings are kept as text; numeric gaps as text too -> parsed by consumers
            for c in ("gap_to_leader", "interval"):
                if c in f:
                    f[c] = f[c].astype(str).where(f[c].notna(), None)
        if endpoint == "laps":
            f["is_pit_out_lap"] = f["is_pit_out_lap"].fillna(False).astype(int)
        for c in ("dnf", "dns", "dsq"):
            if c in f:
                f[c] = f[c].fillna(False).astype(int)
        keys = {"sessions": ["session_key"], "drivers": ["session_key", "driver_number"],
                "laps": ["session_key", "driver_number", "lap_number"],
                "stints": ["session_key", "driver_number", "stint_number"], "pit": ["session_key", "driver_number", "date"],
                "position": ["session_key", "driver_number", "date"], "intervals": ["session_key", "driver_number", "date"],
                "weather": ["session_key", "date"], "race_control": ["session_key", "date", "message"],
                "session_result": ["session_key", "driver_number"], "car_data": ["session_key", "driver_number", "date"],
                "location": ["session_key", "driver_number", "date"]}[endpoint]
        n0 = len(f)
        f = f.dropna(subset=[k for k in keys if k != "message"]).drop_duplicates(subset=keys, keep="last")
        return f.reset_index(drop=True), n0 - len(f)


openf1 = OpenF1()
