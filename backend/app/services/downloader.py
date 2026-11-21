from __future__ import annotations

import contextlib
import json
import os
import signal
import subprocess
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from .ytdlp_manager import YtDlpManager

ProgressCb = Callable[[str, float], None]  # (stage, percent 0..100)
CancelCheck = Callable[[], bool]


@dataclass
class VideoInfo:
    video_id: str
    title: str
    channel: str | None
    thumbnail: str | None
    duration: float | None


class JobCancelledError(Exception):
    """Job bị người dùng hủy giữa chừng."""


class DownloadError(Exception):
    """Lỗi tải/chuyển đổi, kèm mã lỗi để UI hiển thị gợi ý phù hợp."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# (mã lỗi, các đoạn khóa viết thường). Thứ tự quan trọng: khớp đầu tiên thắng.
_ERROR_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("age_restricted", ("confirm your age", "age-restricted", "age restricted")),
    ("private", ("private video", "members-only", "members only", "join this channel")),
    ("unavailable", ("video unavailable", "has been removed", "no longer available",
                     "this video is not available", "terminated", "copyright")),
    ("geo_blocked", ("in your country", "geo-restricted", "geo restricted")),
    ("needs_update", ("sign in to confirm", "http error 403", "unable to extract", "nsig",
                      "signature", "player response", "http error 429", "po token",
                      "requested format is not available", "unsupported url")),
    ("network", ("timed out", "timeout", "connection", "temporary failure", "name resolution",
                 "network is unreachable")),
)  # fmt: skip

_ERROR_HINTS = {
    "needs_update": "YouTube có thể đã đổi cách phát video. Hãy thử cập nhật yt-dlp rồi tải lại.",
    "age_restricted": "Video giới hạn độ tuổi, cần cookies đăng nhập.",
    "private": "Video riêng tư hoặc chỉ dành cho thành viên.",
    "unavailable": "Video không còn khả dụng.",
    "geo_blocked": "Video bị chặn ở khu vực của bạn.",
    "network": "Lỗi mạng khi kết nối YouTube.",
    "ffmpeg": "Lỗi chuyển đổi bằng ffmpeg.",
    "unknown": "Lỗi không xác định.",
}


def classify_error(message: str) -> str:
    text = (message or "").lower()
    for code, needles in _ERROR_RULES:
        if any(n in text for n in needles):
            return code
    if "ffmpeg" in text or "ffprobe" in text:
        return "ffmpeg"
    return "unknown"


def to_download_error(exc: BaseException) -> DownloadError:
    raw = str(exc).replace("\x1b[0;31mERROR:\x1b[0m", "").strip()
    code = classify_error(raw)
    hint = _ERROR_HINTS.get(code, "")
    message = f"{hint} ({raw[:300]})" if hint and raw else (hint or raw[:300] or "Lỗi")
    return DownloadError(code, message)


class Downloader(Protocol):
    def version(self) -> str: ...

    def fetch_info(self, url: str) -> VideoInfo: ...

    def download(
        self,
        url: str,
        out_base: Path,
        bitrate: int,
        on_progress: ProgressCb,
        should_cancel: CancelCheck,
    ) -> Path:
        """Tải và chuyển sang MP3, trả về đường dẫn file ``out_base.mp3``."""
        ...


class SubprocessDownloader:
    """Chạy yt-dlp trong tiến trình con, dùng python của venv yt-dlp đang active.

    Nhờ vậy đổi version yt-dlp không cần restart app, và hủy job bằng cách kill tiến trình.
    """

    INFO_TIMEOUT = 120
    DOWNLOAD_TIMEOUT = 2 * 3600

    def __init__(
        self,
        manager: YtDlpManager,
        *,
        ffmpeg_location: str | None = None,
        runner: Path | None = None,
    ):
        self._manager = manager
        self._ffmpeg = ffmpeg_location
        self._runner = runner or manager.runner

    def version(self) -> str:
        return self._manager.current().version

    # ---- gọi tiến trình con ----
    def _spawn(self, python: str, request: dict[str, Any]) -> subprocess.Popen[str]:
        return subprocess.Popen(
            [python, str(self._runner), json.dumps({**request, "ffmpeg": self._ffmpeg})],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,  # để kill được cả ffmpeg do yt-dlp sinh ra
        )

    @staticmethod
    def _kill(proc: subprocess.Popen[str]) -> None:
        with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
            os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
                os.killpg(proc.pid, signal.SIGKILL)

    def _run(
        self,
        request: dict[str, Any],
        *,
        timeout: float,
        on_event: Callable[[dict[str, Any]], None],
        should_cancel: CancelCheck = lambda: False,
    ) -> None:
        """Chạy một lệnh, gọi ``on_event`` cho từng sự kiện; ném lỗi tương ứng khi thất bại."""
        with self._manager.use() as runtime:
            proc = self._spawn(runtime.python, request)
            stderr_buf: list[str] = []
            drain = threading.Thread(
                target=lambda: stderr_buf.append(proc.stderr.read() if proc.stderr else ""),
                daemon=True,
            )
            drain.start()
            state = {"cancelled": False, "timed_out": False}
            done = threading.Event()

            def watchdog() -> None:
                deadline = time.monotonic() + timeout
                while not done.wait(0.2):
                    if should_cancel():
                        state["cancelled"] = True
                    elif time.monotonic() > deadline:
                        state["timed_out"] = True
                    else:
                        continue
                    self._kill(proc)
                    return

            threading.Thread(target=watchdog, daemon=True).start()
            error: str | None = None
            try:
                assert proc.stdout is not None
                for line in proc.stdout:
                    try:
                        event = json.loads(line)
                    except ValueError:
                        continue  # dòng rác không phải JSON
                    if event.get("type") == "error":
                        error = str(event.get("message", ""))
                    else:
                        on_event(event)
                proc.wait()
            finally:
                done.set()
                if proc.poll() is None:
                    self._kill(proc)
                drain.join(timeout=2)

            if state["cancelled"]:
                raise JobCancelledError()
            if state["timed_out"]:
                raise DownloadError("network", "Quá thời gian chờ khi chạy yt-dlp")
            if error is not None:
                raise to_download_error(RuntimeError(error))
            if proc.returncode != 0:
                tail = (stderr_buf[0] if stderr_buf else "").strip()[-300:]
                raise to_download_error(
                    RuntimeError(tail or f"yt-dlp thoát với mã {proc.returncode}")
                )

    def fetch_info(self, url: str) -> VideoInfo:
        info: dict[str, Any] = {}

        def on_event(e: dict[str, Any]) -> None:
            if e.get("type") == "info":
                info.update(e)

        self._run({"cmd": "info", "url": url}, timeout=self.INFO_TIMEOUT, on_event=on_event)
        if not info:
            raise DownloadError("unavailable", "Không lấy được thông tin video")
        return VideoInfo(
            video_id=info.get("video_id") or "",
            title=info.get("title") or "Không có tiêu đề",
            channel=info.get("channel"),
            thumbnail=info.get("thumbnail"),
            duration=info.get("duration"),
        )

    def download(
        self,
        url: str,
        out_base: Path,
        bitrate: int,
        on_progress: ProgressCb,
        should_cancel: CancelCheck,
    ) -> Path:
        def on_event(e: dict[str, Any]) -> None:
            if e.get("type") == "progress":
                on_progress(str(e["stage"]), float(e["percent"]))

        self._run(
            {"cmd": "download", "url": url, "out_base": str(out_base), "bitrate": bitrate},
            timeout=self.DOWNLOAD_TIMEOUT,
            on_event=on_event,
            should_cancel=should_cancel,
        )
        result = out_base.with_suffix(".mp3")
        if not result.exists():
            raise DownloadError("ffmpeg", "Không tìm thấy file MP3 sau khi chuyển đổi")
        return result
