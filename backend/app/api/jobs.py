from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from ..config import ALLOWED_BITRATES, Settings
from ..events import EventBroker
from ..repository import ACTIVE_STATUSES, ALL_STATUSES, RUNNING_STATUSES, JobRepo
from ..schemas import JobCreate, JobList, JobOut, Peaks, TrimRequest, job_to_out
from ..services import audio
from ..services.worker import JobWorker
from ..utils.filenames import safe_filename
from ..utils.timeparse import format_time, parse_time
from ..utils.urls import InvalidUrlError, normalize_youtube_url
from .deps import get_broker, get_repo, get_settings, get_worker

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

Repo = Annotated[JobRepo, Depends(get_repo)]
Cfg = Annotated[Settings, Depends(get_settings)]
Worker = Annotated[JobWorker, Depends(get_worker)]
Broker = Annotated[EventBroker, Depends(get_broker)]

PEAKS_PER_SECOND = 20


def _error(status: int, code: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


def _get_or_404(repo: JobRepo, job_id: str) -> dict[str, Any]:
    job = repo.get(job_id)
    if job is None:
        raise _error(404, "not_found", "Không tìm thấy job")
    return job


def _file_of(settings: Settings, job: dict[str, Any]) -> Path:
    if job["status"] != "done" or not job.get("file_name"):
        raise _error(409, "no_file", "Job chưa có file audio")
    path = settings.audio_dir / job["file_name"]
    if not path.is_file():
        raise _error(410, "file_missing", "File audio đã bị xóa khỏi máy chủ")
    return path


def _emit(broker: EventBroker, repo: JobRepo, job_id: str) -> dict[str, Any]:
    job = repo.get(job_id)
    out = job_to_out(job) if job else {}
    if job:
        broker.publish({"type": "job", "job": out})
    return out


# ---- tạo / liệt kê ----
@router.post("", status_code=201, response_model=JobOut)
async def create_job(body: JobCreate, repo: Repo, cfg: Cfg, worker: Worker, broker: Broker):
    try:
        video_id, url = normalize_youtube_url(body.url)
    except InvalidUrlError as exc:
        raise _error(422, "invalid_url", str(exc)) from exc

    bitrate = body.bitrate or cfg.default_bitrate
    if bitrate not in ALLOWED_BITRATES:
        raise _error(422, "invalid_bitrate", f"Bitrate hợp lệ: {list(ALLOWED_BITRATES)}")

    if not body.force:
        active = repo.find_by_video(video_id, ACTIVE_STATUSES)
        if active:
            raise _error(409, "already_queued", "Video này đang có trong hàng đợi",
                         job=job_to_out(active))  # fmt: skip
        done = repo.find_by_video(video_id, ("done",))
        if done and done.get("file_name") and (cfg.audio_dir / done["file_name"]).is_file():
            raise _error(409, "duplicate", "Video này đã được tải trước đó", job=job_to_out(done))

    job = repo.create(
        url=url,
        video_id=video_id,
        bitrate=bitrate,
        thumbnail=f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
    )
    worker.wake()
    return _emit(broker, repo, job["id"])


@router.get("", response_model=JobList)
async def list_jobs(
    repo: Repo,
    status: str | None = Query(default=None, description="một trạng thái, hoặc 'active'"),
    kind: str | None = Query(default=None, pattern="^(download|trim)$"),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    if status and status != "active" and status not in ALL_STATUSES:
        raise _error(422, "invalid_status", f"Trạng thái không hợp lệ: {status}")
    rows, total = repo.list(status=status, kind=kind, q=q, limit=limit, offset=offset)
    return {"items": [job_to_out(r) for r in rows], "total": total, "unseen": repo.unseen_count()}


@router.post("/mark-seen")
async def mark_seen(repo: Repo):
    return {"updated": repo.mark_all_seen(), "unseen": 0}


@router.get("/{job_id}", response_model=JobOut)
async def get_job(job_id: str, repo: Repo):
    return job_to_out(_get_or_404(repo, job_id))


@router.get("/{job_id}/children", response_model=list[JobOut])
async def get_children(job_id: str, repo: Repo):
    _get_or_404(repo, job_id)
    return [job_to_out(r) for r in repo.children(job_id)]


# ---- điều khiển ----
@router.post("/{job_id}/cancel", response_model=JobOut)
async def cancel_job(job_id: str, repo: Repo, worker: Worker, broker: Broker):
    job = _get_or_404(repo, job_id)
    if job["status"] not in ACTIVE_STATUSES:
        raise _error(409, "not_active", "Job không còn hoạt động")
    if not worker.request_cancel(job_id):
        raise _error(409, "not_active", "Không thể hủy job này lúc này")
    return _emit(broker, repo, job_id)


@router.post("/{job_id}/retry", response_model=JobOut)
async def retry_job(job_id: str, repo: Repo, worker: Worker, broker: Broker):
    job = _get_or_404(repo, job_id)
    if job["kind"] != "download" or job["status"] not in ("failed", "cancelled"):
        raise _error(409, "not_retryable", "Chỉ thử lại được job tải đã lỗi hoặc đã hủy")
    repo.update(
        job_id, status="queued", progress=0, error_code=None, error_message=None,
        started_at=None, finished_at=None, seen=0, created_at=time.time(),
    )  # fmt: skip
    worker.wake()
    return _emit(broker, repo, job_id)


@router.delete("/{job_id}", status_code=204)
async def delete_job(job_id: str, repo: Repo, cfg: Cfg, broker: Broker, delete_file: bool = True):
    job = _get_or_404(repo, job_id)
    if job["status"] in RUNNING_STATUSES:
        raise _error(409, "running", "Hãy hủy job đang chạy trước khi xóa")
    if delete_file:
        for path in cfg.audio_dir.glob(f"{job_id}.*"):
            path.unlink(missing_ok=True)
    repo.delete(job_id)
    broker.publish({"type": "deleted", "id": job_id})


# ---- file ----
@router.get("/{job_id}/audio")
async def stream_audio(job_id: str, repo: Repo, cfg: Cfg):
    path = _file_of(cfg, _get_or_404(repo, job_id))
    return FileResponse(path, media_type="audio/mpeg")


@router.get("/{job_id}/download")
async def download_audio(job_id: str, repo: Repo, cfg: Cfg):
    job = _get_or_404(repo, job_id)
    path = _file_of(cfg, job)
    return FileResponse(
        path, media_type="audio/mpeg", filename=safe_filename(job.get("title"), "mp3")
    )


@router.get("/{job_id}/peaks", response_model=Peaks)
async def get_peaks(job_id: str, repo: Repo, cfg: Cfg):
    job = _get_or_404(repo, job_id)
    path = _file_of(cfg, job)
    cache = path.with_suffix(".peaks.json")
    if cache.is_file():
        try:
            return json.loads(cache.read_text())
        except (OSError, ValueError):
            cache.unlink(missing_ok=True)
    try:
        peaks = await asyncio.to_thread(
            audio.compute_peaks, path, peaks_per_second=PEAKS_PER_SECOND, ffmpeg=cfg.ffmpeg_bin
        )
    except audio.AudioError as exc:
        raise _error(500, exc.code, exc.message) from exc
    data = {
        "peaks_per_second": PEAKS_PER_SECOND,
        "duration": job.get("duration"),
        "peaks": peaks,
    }
    cache.write_text(json.dumps(data))
    return data


# ---- trim ----
@router.post("/{job_id}/trim", status_code=201, response_model=JobOut)
async def trim_job(job_id: str, body: TrimRequest, repo: Repo, cfg: Cfg, broker: Broker):
    parent = _get_or_404(repo, job_id)
    src = _file_of(cfg, parent)
    try:
        start, end = parse_time(body.start), parse_time(body.end)
    except ValueError as exc:
        raise _error(422, "invalid_range", str(exc)) from exc
    bitrate = body.bitrate or parent.get("bitrate") or cfg.default_bitrate
    if bitrate not in ALLOWED_BITRATES:
        raise _error(422, "invalid_bitrate", f"Bitrate hợp lệ: {list(ALLOWED_BITRATES)}")

    try:
        duration = await asyncio.to_thread(audio.probe_duration, src, cfg.ffprobe_bin)
        audio.validate_range(start, end, duration)
    except audio.AudioError as exc:
        raise _error(422 if exc.code.startswith("invalid") else 500, exc.code, exc.message) from exc

    base_title = parent.get("title") or "Audio"
    title = (body.title or "").strip() or f"{base_title} [{format_time(start)}-{format_time(end)}]"
    child = repo.create(
        kind="trim",
        parent_id=parent["id"],
        url=parent["url"],
        video_id=parent.get("video_id"),
        title=title,
        channel=parent.get("channel"),
        thumbnail=parent.get("thumbnail"),
        duration=end - start,
        status="converting",
        bitrate=bitrate,
        trim_start=start,
        trim_end=end,
        started_at=time.time(),
    )
    dst = cfg.audio_dir / f"{child['id']}.mp3"
    metadata = {"title": title}
    if parent.get("channel"):
        metadata["artist"] = parent["channel"]
    try:
        await asyncio.to_thread(
            audio.trim_audio, src, dst, start, end,
            bitrate=bitrate, fade_in=body.fade_in, fade_out=body.fade_out,
            metadata=metadata, ffmpeg=cfg.ffmpeg_bin, duration=duration,
        )  # fmt: skip
    except audio.AudioError as exc:
        repo.delete(child["id"])
        raise _error(422 if exc.code.startswith("invalid") else 500, exc.code, exc.message) from exc

    repo.update(
        child["id"], status="done", progress=100, file_name=dst.name,
        file_size=dst.stat().st_size, finished_at=time.time(), seen=1,
    )  # fmt: skip
    return _emit(broker, repo, child["id"])
