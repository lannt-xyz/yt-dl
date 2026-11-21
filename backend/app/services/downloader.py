from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

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


class YtDlpDownloader:
    """Triển khai ``Downloader`` bằng thư viện yt-dlp (chạy trong process hiện tại)."""

    def __init__(self, ffmpeg_location: str | None = None):
        self._ffmpeg_location = ffmpeg_location

    def version(self) -> str:
        from yt_dlp.version import __version__

        return __version__

    def _base_opts(self) -> dict[str, Any]:
        opts: dict[str, Any] = {
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "socket_timeout": 30,
            "retries": 3,
        }
        if self._ffmpeg_location:
            opts["ffmpeg_location"] = self._ffmpeg_location
        return opts

    def fetch_info(self, url: str) -> VideoInfo:
        import yt_dlp

        try:
            with yt_dlp.YoutubeDL({**self._base_opts(), "skip_download": True}) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception as exc:
            raise to_download_error(exc) from exc
        if not info:
            raise DownloadError("unavailable", "Không lấy được thông tin video")
        return VideoInfo(
            video_id=info.get("id") or "",
            title=info.get("title") or "Không có tiêu đề",
            channel=info.get("channel") or info.get("uploader"),
            thumbnail=info.get("thumbnail"),
            duration=float(info["duration"]) if info.get("duration") else None,
        )

    def download(
        self,
        url: str,
        out_base: Path,
        bitrate: int,
        on_progress: ProgressCb,
        should_cancel: CancelCheck,
    ) -> Path:
        import yt_dlp
        from yt_dlp.utils import DownloadCancelled

        class _Cancelled(DownloadCancelled):
            pass

        def check() -> None:
            if should_cancel():
                raise _Cancelled()

        def progress_hook(d: dict[str, Any]) -> None:
            check()
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                if total:
                    on_progress("downloading", min(99.0, d["downloaded_bytes"] / total * 100))
            elif d.get("status") == "finished":
                on_progress("downloading", 100.0)

        def pp_hook(d: dict[str, Any]) -> None:
            check()
            if d.get("postprocessor") == "ExtractAudio":
                on_progress("converting", 100.0 if d.get("status") == "finished" else 0.0)

        opts = {
            **self._base_opts(),
            "format": "bestaudio/best",
            "outtmpl": f"{out_base}.%(ext)s",
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": str(bitrate),
                }
            ],
            "progress_hooks": [progress_hook],
            "postprocessor_hooks": [pp_hook],
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
        except _Cancelled as exc:
            raise JobCancelledError() from exc
        except Exception as exc:
            if isinstance(exc, JobCancelledError):
                raise
            raise to_download_error(exc) from exc

        result = out_base.with_suffix(".mp3")
        if not result.exists():
            raise DownloadError("ffmpeg", "Không tìm thấy file MP3 sau khi chuyển đổi")
        return result
