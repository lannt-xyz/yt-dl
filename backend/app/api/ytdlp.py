from __future__ import annotations

import asyncio
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..events import EventBroker
from ..services.ytdlp_manager import UpdateError, YtDlpManager
from .deps import get_broker

router = APIRouter(prefix="/api/ytdlp", tags=["yt-dlp"])


def get_manager(request: Request) -> YtDlpManager:
    return request.app.state.ytdlp


Manager = Annotated[YtDlpManager, Depends(get_manager)]
Broker = Annotated[EventBroker, Depends(get_broker)]


class SettingsBody(BaseModel):
    channel: str | None = None
    auto_update: bool | None = None


class UpdateBody(BaseModel):
    version: str | None = None


def _err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message})


@router.get("")
async def status(manager: Manager) -> dict[str, Any]:
    return await asyncio.to_thread(manager.status)


@router.post("/check")
async def check(manager: Manager, broker: Broker) -> dict[str, Any]:
    try:
        await asyncio.to_thread(manager.check_latest)
    except UpdateError as exc:
        raise _err(502, "check_failed", f"Không kiểm tra được bản mới: {exc}") from exc
    result = await asyncio.to_thread(manager.status)
    broker.publish({"type": "ytdlp", "status": result})
    return result


@router.put("/settings")
async def settings(body: SettingsBody, manager: Manager, broker: Broker) -> dict[str, Any]:
    try:
        manager.configure(channel=body.channel, auto_update=body.auto_update)
    except ValueError as exc:
        raise _err(422, "invalid_channel", str(exc)) from exc
    result = await asyncio.to_thread(manager.status)
    broker.publish({"type": "ytdlp", "status": result})
    return result


@router.post("/update", status_code=202)
async def update(body: UpdateBody, request: Request, manager: Manager, broker: Broker):
    """Chạy nền: kết quả báo qua SSE (`ytdlp`) và GET /api/ytdlp."""
    if manager.status()["updating"]:
        raise _err(409, "updating", "Đang có một lần cập nhật khác đang chạy")

    async def run() -> None:
        broker.publish({"type": "ytdlp", "status": {**manager.status(), "updating": True}})
        try:
            await asyncio.to_thread(manager.update, body.version)
            message = None
        except UpdateError as exc:
            message = str(exc)
        status_now = await asyncio.to_thread(manager.status)
        broker.publish({"type": "ytdlp", "status": status_now, "error": message})

    tasks: set[asyncio.Task[None]] = request.app.state.background_tasks
    task = asyncio.create_task(run())
    tasks.add(task)
    task.add_done_callback(tasks.discard)
    return {"accepted": True}


@router.post("/rollback")
async def rollback(manager: Manager, broker: Broker) -> dict[str, Any]:
    try:
        await asyncio.to_thread(manager.rollback)
    except UpdateError as exc:
        raise _err(409, "no_previous", str(exc)) from exc
    result = await asyncio.to_thread(manager.status)
    broker.publish({"type": "ytdlp", "status": result})
    return result
