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

HEARTBEAT_SECONDS = 15


@router.get("/health")
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
    return {
        "ytdlp_version": downloader.version(),
        "ffmpeg_available": shutil.which(cfg.ffmpeg_bin) is not None,
        "concurrency": cfg.concurrency,
        "disk": {"total": usage.total, "used": usage.used, "free": usage.free},
        "audio_bytes": audio_bytes,
        "counts": repo.counts(),
        "unseen": repo.unseen_count(),
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
