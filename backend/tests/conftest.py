from __future__ import annotations

import subprocess
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.downloader import DownloadError, JobCancelledError, VideoInfo

VIDEO_A = "dQw4w9WgXcQ"
VIDEO_B = "9bZkp7q19f0"
VIDEO_C = "kJQP7kiw5Fk"


def make_sine_mp3(path: Path, seconds: float = 6.0, freq: int = 440) -> None:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
         "-i", f"sine=frequency={freq}:duration={seconds}", "-codec:a", "libmp3lame",
         "-b:a", "128k", str(path)],
        check=True,
    )  # fmt: skip


class FakeDownloader:
    """Downloader giả: sinh file sine bằng ffmpeg, có thể giả lập lỗi/chậm/hủy."""

    def __init__(self, seconds: float = 6.0):
        self.seconds = seconds
        self.fail_with: DownloadError | None = None
        self.delay = 0.0
        self.calls: list[str] = []
        self.release = threading.Event()
        self.release.set()  # đặt clear() để giữ job ở trạng thái đang chạy
        self.started = threading.Event()

    def version(self) -> str:
        return "9999.01.01"

    def fetch_info(self, url: str) -> VideoInfo:
        self.calls.append(url)
        if self.fail_with:
            raise self.fail_with
        vid = url.split("v=")[-1]
        return VideoInfo(vid, f"Video {vid}", "Kênh thử", f"https://img/{vid}.jpg", self.seconds)

    def download(self, url, out_base, bitrate, on_progress, should_cancel) -> Path:
        self.started.set()
        on_progress("downloading", 10)
        deadline = time.monotonic() + 10
        while not self.release.wait(0.02):
            if should_cancel():
                raise JobCancelledError()
            if time.monotonic() > deadline:
                raise RuntimeError("test timeout")
        if should_cancel():
            raise JobCancelledError()
        if self.delay:
            time.sleep(self.delay)
        on_progress("converting", 50)
        dst = out_base.with_suffix(".mp3")
        make_sine_mp3(dst, self.seconds)
        return dst


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "data")


@pytest.fixture
def fake() -> FakeDownloader:
    return FakeDownloader()


@pytest.fixture
def client(settings: Settings, fake: FakeDownloader) -> Iterator[TestClient]:
    app = create_app(settings, downloader=fake)
    with TestClient(app) as c:
        yield c


def wait_for_status(client: TestClient, job_id: str, statuses, timeout: float = 15.0) -> dict:
    if isinstance(statuses, str):
        statuses = (statuses,)
    deadline = time.monotonic() + timeout
    job: dict = {}
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in statuses:
            return job
        time.sleep(0.05)
    raise AssertionError(f"Job {job_id} không đạt {statuses}, hiện là {job.get('status')}")


@pytest.fixture
def done_job(client: TestClient) -> dict:
    r = client.post("/api/jobs", json={"url": f"https://youtu.be/{VIDEO_A}"})
    assert r.status_code == 201, r.text
    return wait_for_status(client, r.json()["id"], "done")
