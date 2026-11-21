from __future__ import annotations

import logging
import sqlite3
import time
from pathlib import Path

log = logging.getLogger("backup")
PREFIX = "app-"


def list_backups(backup_dir: Path) -> list[Path]:
    return sorted(backup_dir.glob(f"{PREFIX}*.db"), reverse=True)  # mới → cũ (tên có timestamp)


def backup_database(
    db_path: Path, backup_dir: Path, keep: int = 7, *, now: float | None = None
) -> Path:
    """Sao lưu SQLite bằng API backup chính thức (an toàn khi app đang ghi).

    Giữ ``keep`` bản mới nhất.
    """
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(now if now is not None else time.time()))
    dest = backup_dir / f"{PREFIX}{stamp}.db"
    tmp = dest.with_suffix(".db.part")
    src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        dst = sqlite3.connect(tmp)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    tmp.replace(dest)
    for old in list_backups(backup_dir)[max(1, keep) :]:
        old.unlink(missing_ok=True)
    return dest


def latest_backup_age(backup_dir: Path, now: float | None = None) -> float | None:
    """Số giây kể từ bản sao lưu gần nhất; None nếu chưa có."""
    backups = list_backups(backup_dir)
    if not backups:
        return None
    return (time.time() if now is None else now) - backups[0].stat().st_mtime
