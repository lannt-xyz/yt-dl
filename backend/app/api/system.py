from __future__ import annotations

import asyncio
import json
import shutil
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from ..config import Settings
from ..events import EventBroker
from ..repository import JobRepo
from ..services.downloader import Downloader
from .deps import get_broker, get_downloader, get_repo, get_settings

router = APIRouter(prefix="/api", tags=["system"])
public_router = APIRouter(prefix="/api", tags=["system"])

HEARTBEAT_SECONDS = 15


@public_router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/system")
async def system(
    repo: Annotated[JobRepo, Depends(get_repo)],
    cfg: Annotated[Settings, Depends(get_settings)],
    downloader: Annotated[Downloader, Depends(get_downloader)],
):
    usage = shutil.disk_usage(cfg.audio_dir)
    audio_bytes = sum(p.stat().st_size for p in cfg.audio_dir.glob("*.mp3"))
    from ..services.backup import latest_backup_age, list_backups

    backup_age = latest_backup_age(cfg.backup_dir)
    return {
        "storage": {
            "retention_days": cfg.retention_days,
            "max_storage_gb": cfg.max_storage_gb,
            "files": len(list(cfg.audio_dir.glob("*.mp3"))),
        },
        "backups": {"count": len(list_backups(cfg.backup_dir)), "latest_age_seconds": backup_age},
        "auth_enabled": cfg.auth_enabled,
        "ytdlp_version": downloader.version(),
        "ffmpeg_available": shutil.which(cfg.ffmpeg_bin) is not None,
        "concurrency": cfg.concurrency,
        "disk": {"total": usage.total, "used": usage.used, "free": usage.free},
        "audio_bytes": audio_bytes,
        "counts": repo.counts(),
        "unseen": repo.unseen_count(),
    }


@router.post("/system/cleanup")
async def cleanup_now(
    repo: Annotated[JobRepo, Depends(get_repo)],
    cfg: Annotated[Settings, Depends(get_settings)],
    broker: Annotated[EventBroker, Depends(get_broker)],
):
    """Dọn dẹp ngay theo cấu hình lưu trữ hiện tại."""
    from ..schemas import job_to_out
    from ..services.cleanup import run_cleanup

    result = await asyncio.to_thread(run_cleanup, cfg, repo)
    for job_id in result.job_ids:
        job = repo.get(job_id)
        if job:
            broker.publish({"type": "job", "job": job_to_out(job)})
    return {
        "removed_files": result.removed_files,
        "orphan_files": result.orphan_files,
        "freed_bytes": result.freed_bytes,
    }


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/events")
async def events(
    request: Request,
    repo: Annotated[JobRepo, Depends(get_repo)],
    broker: Annotated[EventBroker, Depends(get_broker)],
):
    async def stream() -> AsyncIterator[str]:
        queue = broker.open_queue()
        try:
            yield _sse("hello", {"unseen": repo.unseen_count()})
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
                except TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield _sse(event["type"], event)
        finally:
            broker.close_queue(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
