from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections.abc import Callable
from typing import Any

from ..config import Settings
from ..events import EventBroker
from ..repository import JobRepo
from ..schemas import job_to_out
from .downloader import Downloader, DownloadError, JobCancelledError, to_download_error

log = logging.getLogger("worker")

_PROGRESS_MIN_INTERVAL = 0.4  # giây giữa hai lần ghi DB/phát sự kiện tiến trình


class JobWorker:
    """Lấy job ``queued`` từ DB và chạy lần lượt (số luồng song song = ``concurrency``)."""

    def __init__(
        self,
        repo: JobRepo,
        downloader: Downloader,
        broker: EventBroker,
        settings: Settings,
        recovery: Callable[[], bool] | None = None,
        on_finished: Callable[[dict[str, Any]], None] | None = None,
    ):
        self.repo = repo
        self.downloader = downloader
        self.broker = broker
        self.settings = settings
        # Gọi khi job lỗi "needs_update": True nếu đã chuyển sang yt-dlp mới hơn → tự thử lại 1 lần
        self.recovery = recovery
        self.on_finished = on_finished  # gọi khi job tải kết thúc (xong/lỗi) — dùng cho push
        self._recovered: set[str] = set()
        self._wake = asyncio.Event()
        self._tasks: list[asyncio.Task[None]] = []
        self._stopping = False
        self._cancel_flags: dict[str, threading.Event] = {}
        self._flags_lock = threading.Lock()

    # ---- vòng đời ----
    async def start(self) -> None:
        self._stopping = False
        for n in range(self.settings.concurrency):
            self._tasks.append(asyncio.create_task(self._loop(), name=f"job-worker-{n}"))

    async def stop(self) -> None:
        self._stopping = True
        with self._flags_lock:
            for flag in self._cancel_flags.values():
                flag.set()
        self._wake.set()
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

    def wake(self) -> None:
        self._wake.set()

    # ---- hủy ----
    def request_cancel(self, job_id: str) -> bool:
        """Hủy job. Trả về True nếu đã xử lý (đang chạy hoặc đang chờ)."""
        with self._flags_lock:
            flag = self._cancel_flags.get(job_id)
        if flag is not None:
            flag.set()
            return True
        job = self.repo.get(job_id)
        if job and job["status"] == "queued":
            self._finish(job_id, status="cancelled", progress=0)
            return True
        return False

    def is_running(self, job_id: str) -> bool:
        with self._flags_lock:
            return job_id in self._cancel_flags

    # ---- nội bộ ----
    async def _loop(self) -> None:
        while not self._stopping:
            job = await asyncio.to_thread(self.repo.claim_next)
            if job is None:
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=5)
                except TimeoutError:
                    pass
                continue
            self._emit(job["id"])
            try:
                await asyncio.to_thread(self._process, job["id"])
            except Exception:  # không để vòng lặp worker chết
                log.exception("Lỗi không mong đợi khi xử lý job %s", job["id"])

    def _emit(self, job_id: str) -> None:
        job = self.repo.get(job_id)
        if job:
            self.broker.publish({"type": "job", "job": job_to_out(job)})

    def _finish(self, job_id: str, **fields: Any) -> None:
        job = self.repo.update(job_id, finished_at=time.time(), seen=0, **fields)
        self._emit(job_id)
        if self.on_finished and job:
            try:
                self.on_finished(job)
            except Exception:
                log.exception("on_finished lỗi cho job %s", job_id)

    def _process(self, job_id: str) -> None:
        job = self.repo.get(job_id)
        if job is None:
            return
        flag = threading.Event()
        with self._flags_lock:
            self._cancel_flags[job_id] = flag

        last_emit = 0.0
        last_stage = ""

        def on_progress(stage: str, percent: float) -> None:
            nonlocal last_emit, last_stage
            now = time.monotonic()
            if stage == last_stage and percent < 100 and now - last_emit < _PROGRESS_MIN_INTERVAL:
                return
            last_emit, last_stage = now, stage
            self.repo.update(job_id, status=stage, progress=round(percent, 1))
            self._emit(job_id)

        out_base = self.settings.audio_dir / job_id
        try:
            info = self.downloader.fetch_info(job["url"])
            if flag.is_set():
                raise JobCancelledError()
            self.repo.update(
                job_id,
                status="downloading",
                progress=0,
                title=info.title,
                channel=info.channel,
                thumbnail=info.thumbnail or job["thumbnail"],
                duration=info.duration,
            )
            self._emit(job_id)

            path = self.downloader.download(
                job["url"], out_base, job["bitrate"] or self.settings.default_bitrate,
                on_progress, flag.is_set,
            )  # fmt: skip
            self._finish(
                job_id,
                status="done",
                progress=100,
                file_name=path.name,
                file_size=path.stat().st_size,
                ytdlp_version=self.downloader.version(),
                error_code=None,
                error_message=None,
            )
        except JobCancelledError:
            self._cleanup(job_id)
            self._finish(job_id, status="cancelled", progress=0)
        except DownloadError as exc:
            self._cleanup(job_id)
            if self._try_recover(job_id, exc):
                return
            self._finish(
                job_id, status="failed", error_code=exc.code, error_message=exc.message,
                ytdlp_version=self.downloader.version(),
            )  # fmt: skip
        except Exception as exc:
            log.exception("Job %s lỗi", job_id)
            err = to_download_error(exc)
            self._cleanup(job_id)
            self._finish(job_id, status="failed", error_code=err.code, error_message=err.message)
        finally:
            with self._flags_lock:
                self._cancel_flags.pop(job_id, None)

    def _try_recover(self, job_id: str, exc: DownloadError) -> bool:
        if exc.code != "needs_update" or self.recovery is None or job_id in self._recovered:
            return False
        self._recovered.add(job_id)
        try:
            updated = self.recovery()
        except Exception:
            log.exception("Tự cập nhật yt-dlp lỗi")
            return False
        if not updated:
            return False
        log.info("Đã cập nhật yt-dlp, thử lại job %s", job_id)
        self.repo.update(job_id, status="queued", progress=0, started_at=None)
        self._emit(job_id)
        self.wake_threadsafe()
        return True

    def wake_threadsafe(self) -> None:
        loop = self.broker._loop  # noqa: SLF001 - cùng event loop với broker
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self._wake.set)

    def _cleanup(self, job_id: str) -> None:
        for path in self.settings.audio_dir.glob(f"{job_id}.*"):
            path.unlink(missing_ok=True)
