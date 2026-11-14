"""Prebuilt data snapshot, so the API can start on a small host without a 35-minute bootstrap or any training.

`apply()` runs at start-up: when the SQLite database does not exist yet and `backend/seed/` holds a
snapshot, the snapshot database and model files are unpacked into the data directory.
    python -m app.seed export     # refresh backend/seed/ from the current database (after bootstrap/retrain)
"""
from __future__ import annotations
import gzip, os, shutil, sqlite3, sys, time
from pathlib import Path

SEED_DIR = Path(os.getenv("APEX_SEED_DIR", Path(__file__).resolve().parents[1] / "seed"))


def apply(data_dir: Path, database_url: str) -> bool:
    if os.getenv("APEX_SEED", "1") != "1" or not database_url.startswith("sqlite"):
        return False
    target = Path(database_url.replace("sqlite:///", ""))
    src = SEED_DIR / "apex.db.gz"
    if target.exists() or not src.exists():
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".seeding")
    with gzip.open(src, "rb") as a, open(tmp, "wb") as b:
        shutil.copyfileobj(a, b)
    os.replace(tmp, target)
    (data_dir / "models").mkdir(parents=True, exist_ok=True)
    for f in (SEED_DIR / "models").glob("*"):
        shutil.copy(f, data_dir / "models" / f.name)
    print(f"[seed] database and models restored from {SEED_DIR}", flush=True)
    return True


def info() -> str | None:
    f = SEED_DIR / "SEED_INFO.txt"
    return f.read_text().strip() if f.exists() else None


def export() -> None:
    from .config import DATA_DIR, DATABASE_URL
    assert DATABASE_URL.startswith("sqlite"), "export works from the SQLite database"
    (SEED_DIR / "models").mkdir(parents=True, exist_ok=True)
    tmp = DATA_DIR / "seed-export.db"
    tmp.unlink(missing_ok=True)
    s, d = sqlite3.connect(DATABASE_URL.replace("sqlite:///", "")), sqlite3.connect(tmp)
    s.backup(d); s.close()
    d.execute("DELETE FROM model_registry WHERE active=0")
    for f in (SEED_DIR / "models").glob("*.joblib"):
        f.unlink()
    for name, path in d.execute("SELECT name, path FROM model_registry").fetchall():
        fn = Path(path).name
        d.execute("UPDATE model_registry SET path=? WHERE name=?", (fn, name))
        shutil.copy(DATA_DIR / "models" / fn, SEED_DIR / "models" / fn)
    for f in (DATA_DIR / "models").glob("xgb_params_*.json"):
        shutil.copy(f, SEED_DIR / "models" / f.name)
    for t in ("source_errors", "prediction_snapshots", "source_health"):
        d.execute(f"DELETE FROM {t}")
    d.commit(); d.execute("PRAGMA journal_mode=DELETE"); d.execute("VACUUM"); d.commit()
    last = d.execute("SELECT year, round FROM f1db_race_results ORDER BY year DESC, round DESC LIMIT 1").fetchone()
    races = d.execute("SELECT COUNT(DISTINCT l.session_key) FROM of1_laps l JOIN of1_sessions s ON s.session_key=l.session_key WHERE s.session_name='Race'").fetchone()[0]
    d.close()
    with open(tmp, "rb") as a, gzip.open(SEED_DIR / "apex.db.gz", "wb", compresslevel=9) as b:
        shutil.copyfileobj(a, b)
    tmp.unlink()
    (SEED_DIR / "SEED_INFO.txt").write_text(
        f"Prebuilt snapshot created {time.strftime('%Y-%m-%d', time.gmtime())}.\n"
        f"F1DB results through {last[0]} round {last[1]}; {races} OpenF1 races with lap data; models trained on that data.\n"
        "Rebuild with: python -m app.bootstrap, then python -m app.seed export\n")
    print((SEED_DIR / "SEED_INFO.txt").read_text())


if __name__ == "__main__":
    export() if sys.argv[1:] == ["export"] else print(info())
