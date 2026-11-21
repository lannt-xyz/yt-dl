from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class JobOut(BaseModel):
    id: str
    kind: str
    parent_id: str | None = None
    url: str
    video_id: str | None = None
    title: str | None = None
    channel: str | None = None
    thumbnail: str | None = None
    duration: float | None = None
    status: str
    progress: float = 0
    error_code: str | None = None
    error_message: str | None = None
    file_size: int | None = None
    bitrate: int | None = None
    trim_start: float | None = None
    trim_end: float | None = None
    ytdlp_version: str | None = None
    seen: bool = False
    created_at: float
    started_at: float | None = None
    finished_at: float | None = None
    has_file: bool = False
    audio_url: str | None = None
    download_url: str | None = None


def job_to_out(row: dict[str, Any]) -> dict[str, Any]:
    data = {k: v for k, v in row.items() if k != "file_name"}
    has_file = row["status"] == "done" and bool(row.get("file_name"))
    data["seen"] = bool(row.get("seen"))
    data["has_file"] = has_file
    data["audio_url"] = f"/api/jobs/{row['id']}/audio" if has_file else None
    data["download_url"] = f"/api/jobs/{row['id']}/download" if has_file else None
    return JobOut(**data).model_dump()


class JobCreate(BaseModel):
    url: str = Field(max_length=2048)
    bitrate: int | None = None
    force: bool = False


class TrimRequest(BaseModel):
    start: float | str
    end: float | str
    bitrate: int | None = None
    fade_in: float = 0.0
    fade_out: float = 0.0
    title: str | None = Field(default=None, max_length=300)


class JobList(BaseModel):
    items: list[JobOut]
    total: int
    unseen: int


class Peaks(BaseModel):
    peaks_per_second: int
    duration: float | None
    peaks: list[float]
