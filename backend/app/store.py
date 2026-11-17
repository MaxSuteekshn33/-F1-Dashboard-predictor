"""Durable store for finished results, so a restart or a sleep does not throw away work already done.

Three layers sit behind the in-memory caches, cheapest first:
  1. a local SQLite file — filled while the container image is built (`python -m app.precompute`) and added to
     as requests are answered;
  2. optionally a Supabase table (`api_cache`, see supabase/cache.sql), which survives deploys and restarts
     when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set on the server;
  3. computing the result.

Only results that cannot change are stored: a finished race at a given lap, computed by this exact code from
this exact data snapshot. The code and data fingerprint is part of every key, so a new deploy or a refreshed
snapshot never serves an old answer. Stored values are the JSON responses themselves — nothing is recomputed
differently, shortened or approximated.
"""
from __future__ import annotations
import hashlib, json, os, sqlite3, threading, time, zlib
from pathlib import Path
import requests
from . import racestate as rs
from .config import DATA_DIR

APP = Path(__file__).resolve().parent
PATH = Path(os.getenv("APEX_STORE_PATH", APP.parent / "precomputed.db"))
SUPA_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPA_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
MAX_BYTES = 12_000             # compressed size; larger responses stay in the local store only
MAX_ROWS = 6000
_lock = threading.Lock()
_salt = {"v": ""}
_absent: dict = {}
_version: dict = {}
stats = {"local_hits": 0, "remote_hits": 0, "misses": 0, "writes": 0, "remote_errors": 0, "remote_paused_until": 0.0}


def version() -> str:
    """Fingerprint of the code and the data snapshot the results were computed from."""
    if "v" not in _version:
        h = hashlib.sha1()
        for f in sorted(APP.rglob("*.py")):
            h.update(f.name.encode()); h.update(f.read_bytes())
        seed = APP.parent / "seed"
        files = sorted(seed.rglob("*")) if seed.exists() else []
        if files:
            for f in files:
                if f.is_file():
                    h.update(f"{f.name}:{f.stat().st_size}".encode())
        else:
            dbf = DATA_DIR / "apex.db"
            h.update(f"{dbf.stat().st_size}:{int(dbf.stat().st_mtime)}".encode() if dbf.exists() else b"nodb")
        _version["v"] = h.hexdigest()[:16]
    return _version["v"] + _salt["v"]


def bump() -> None:
    """Data or models changed while running (retrain, late ingest): stop using results stored before now."""
    _salt["v"] = f"+{int(time.time())}"


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(PATH, timeout=5)
    c.execute("CREATE TABLE IF NOT EXISTS results (key TEXT PRIMARY KEY, version TEXT, name TEXT, value BLOB, created REAL)")
    return c


def state_key(name: str, session_key, lap, *rest) -> str | None:
    """Key for a result that depends on a race at a lap. None when the answer could still change (live, delayed
    or rehearsal data), in which case nothing is stored or read."""
    try:
        st = rs.state(session_key, lap)
    except Exception:
        return None
    if st["mode"]["mode"] != "HISTORICAL":
        return None
    return plain_key(name, session_key, st["lap"], st["max_lap"], round(st["T"] or 0, 1), *rest)


def plain_key(name: str, *parts) -> str:
    raw = json.dumps([version(), name, parts], sort_keys=True, default=str)
    return hashlib.sha1(raw.encode()).hexdigest()


def get(key: str | None, remote: bool = True):
    if not key:
        return None
    try:
        with _lock, _conn() as c:
            row = c.execute("SELECT value FROM results WHERE key=?", (key,)).fetchone()
        if row:
            stats["local_hits"] += 1
            return json.loads(zlib.decompress(row[0]))
    except Exception:
        pass
    if remote and _absent.get(key, 0) < time.time():
        val = _remote_get(key)
        if val is not None:
            stats["remote_hits"] += 1
            _local_put(key, "", val)
            return val
        if len(_absent) > 5000:
            _absent.clear()
        _absent[key] = time.time() + 900      # a miss is remembered, so the same question does not ask the network again
    stats["misses"] += 1
    return None


def put(key: str | None, name: str, value, remote: bool = True) -> None:
    if not key or value is None:
        return
    _absent.pop(key, None)
    blob = _local_put(key, name, value)
    if blob is not None and remote and _remote_on() and len(blob) < MAX_BYTES:
        threading.Thread(target=_remote_put, args=(key, name, value), daemon=True).start()


def _local_put(key: str, name: str, value):
    try:
        blob = zlib.compress(json.dumps(value, separators=(",", ":")).encode(), 6)
        with _lock, _conn() as c:
            c.execute("INSERT OR REPLACE INTO results VALUES (?,?,?,?,?)", (key, version(), name, blob, time.time()))
            stats["writes"] += 1
            if stats["writes"] % 200 == 0 and c.execute("SELECT COUNT(*) FROM results").fetchone()[0] > MAX_ROWS:
                c.execute("DELETE FROM results WHERE key IN (SELECT key FROM results ORDER BY created LIMIT ?)", (MAX_ROWS // 4,))
        return blob
    except Exception:
        return None


def count() -> int:
    try:
        with _lock, _conn() as c:
            return int(c.execute("SELECT COUNT(*) FROM results WHERE version=?", (version(),)).fetchone()[0])
    except Exception:
        return 0


# ---------------------------------------------------------------- Supabase layer (optional)
def _remote_on() -> bool:
    return bool(SUPA_URL and SUPA_KEY) and time.time() >= stats["remote_paused_until"]


def _headers() -> dict:
    return {"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}", "Content-Type": "application/json"}


def _fail() -> None:
    stats["remote_errors"] += 1
    stats["remote_paused_until"] = time.time() + 300        # do not let a slow or missing table delay requests


def _remote_get(key: str):
    if not _remote_on():
        return None
    try:
        r = requests.get(f"{SUPA_URL}/rest/v1/api_cache", params={"key": f"eq.{key}", "select": "value"}, headers=_headers(), timeout=2.5)
        if r.status_code != 200:
            _fail(); return None
        rows = r.json()
        return rows[0]["value"] if rows else None
    except Exception:
        _fail(); return None


def _remote_put(key: str, name: str, value) -> None:
    try:
        r = requests.post(f"{SUPA_URL}/rest/v1/api_cache", headers={**_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
                          data=json.dumps({"key": key, "version": version(), "name": name, "value": value}), timeout=6)
        if r.status_code >= 300:
            _fail()
    except Exception:
        _fail()


def remote_prune() -> None:
    """Once per start: drop rows written by other code/data versions so the table stays small."""
    if not _remote_on():
        return
    try:
        requests.delete(f"{SUPA_URL}/rest/v1/api_cache", params={"version": f"neq.{_version.get('v') or version()}"},
                        headers={**_headers(), "Prefer": "return=minimal"}, timeout=8)
    except Exception:
        pass


def status() -> dict:
    return {"path": str(PATH.name), "stored_for_this_version": count(), "version": version(),
            "supabase": "on" if _remote_on() else ("paused after an error" if (SUPA_URL and SUPA_KEY) else "not configured"),
            **{k: v for k, v in stats.items() if k != "remote_paused_until"}}
