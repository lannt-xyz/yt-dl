from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..config import Settings
from ..repository import ACTIVE_STATUSES, JobRepo

log = logging.getLogger("cleanup")

ORPHAN_MIN_AGE = 3600.0  # chỉ xóa file mồ côi đã nằm yên > 1 giờ (tránh đụng file đang ghi)


@dataclass
class CleanupResult:
    removed_files: int = 0
    freed_bytes: int = 0
    orphan_files: int = 0
    job_ids: list[str] = field(default_factory=list)


def _unlink(path: Path) -> int:
    try:
        size = path.stat().st_size
        path.unlink()
        return size
    except FileNotFoundError:
        return 0


def _remove_job_file(settings: Settings, job: dict) -> int:
    path = settings.audio_dir / job["file_name"]
    freed = _unlink(path)
    _unlink(path.with_suffix(".peaks.json"))
    return freed


def run_cleanup(
    settings: Settings,
    repo: JobRepo,
    *,
    now: float | None = None,
    retention_days: int | None = None,
    max_bytes: int | None = None,
) -> CleanupResult:
    """Dọn file audio theo thời hạn lưu / hạn mức dung lượng, và file mồ côi.

    Dòng lịch sử được giữ nguyên (chỉ gỡ ``file_name``) nên vẫn xem được và có thể tải lại.
    """
    now = time.time() if now is None else now
    days = settings.retention_days if retention_days is None else retention_days
    cap = int(settings.max_storage_gb * 1024**3) if max_bytes is None else max_bytes
    result = CleanupResult()

    done = [
        j
        for j in repo.db.query("SELECT * FROM jobs WHERE status = 'done' AND file_name IS NOT NULL")
    ]
    done.sort(key=lambda j: j["finished_at"] or j["created_at"])  # cũ → mới

    def drop(job: dict) -> None:
        result.freed_bytes += _remove_job_file(settings, job)
        repo.update(job["id"], file_name=None, file_size=None)
        result.removed_files += 1
        result.job_ids.append(job["id"])

    remaining: list[dict] = []
    for job in done:
        age_days = (now - (job["finished_at"] or job["created_at"])) / 86400
        if days > 0 and age_days > days:
            drop(job)
        else:
            remaining.append(job)

    if cap > 0:
        sizes = {}
        for job in remaining:
            try:
                sizes[job["id"]] = (settings.audio_dir / job["file_name"]).stat().st_size
            except FileNotFoundError:
                sizes[job["id"]] = 0
        total = sum(sizes.values())
        for job in remaining:  # xóa file cũ nhất trước cho tới khi dưới hạn mức
            if total <= cap:
                break
            total -= sizes[job["id"]]
            drop(job)

    _remove_orphans(settings, repo, now, result)
    if result.removed_files or result.orphan_files:
        log.info(
            "Dọn dẹp: %d file, %d file mồ côi, giải phóng %d byte",
            result.removed_files, result.orphan_files, result.freed_bytes,
        )  # fmt: skip
    return result


def _remove_orphans(settings: Settings, repo: JobRepo, now: float, result: CleanupResult) -> None:
    referenced: set[str] = set()
    for row in repo.db.query("SELECT file_name FROM jobs WHERE file_name IS NOT NULL"):
        name = row["file_name"]
        referenced.add(name)
        referenced.add(Path(name).with_suffix(".peaks.json").name)
    active_ids = {
        r["id"]
        for r in repo.db.query(
            f"SELECT id FROM jobs WHERE status IN ({','.join('?' for _ in ACTIVE_STATUSES)})",
            ACTIVE_STATUSES,
        )
    }
    for path in settings.audio_dir.iterdir():
        if not path.is_file() or path.name in referenced:
            continue
        if path.name.split(".", 1)[0] in active_ids:
            continue  # đang tải/chuyển đổi
        try:
            if now - path.stat().st_mtime < ORPHAN_MIN_AGE:
                continue
        except FileNotFoundError:
            continue
        result.freed_bytes += _unlink(path)
        result.orphan_files += 1
