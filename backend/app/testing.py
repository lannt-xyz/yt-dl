"""Chế độ giả lập cho E2E (YT_FAKE_DOWNLOADER=1): không gọi YouTube hay PyPI thật.

ID video quyết định hành vi:
  ``needsUpdate`` : lỗi "cần cập nhật yt-dlp" cho tới khi yt-dlp được cập nhật (qua API thật)
  ``privateVid1`` : lỗi video riêng tư
  ``slow...``     : ID bắt đầu bằng "slow": chạy chậm ~3 giây có tiến trình (thử hàng đợi/hủy)
  còn lại          : xong ngay, file MP3 là sine 30 giây
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

from .services.downloader import (
    CancelCheck,
    DownloadError,
    JobCancelledError,
    ProgressCb,
    VideoInfo,
)
from .services.ytdlp_manager import YtDlpManager

SLOW_PREFIX = "slow"
SLOW_ID = "slowSlowSlo"
PRIVATE_ID = "privateVid1"
NEEDS_UPDATE_ID = "needsUpdate"
FAKE_LATEST = "9999.01.01"


class FakeE2EDownloader:
    def __init__(self, manager: YtDlpManager, ffmpeg: str = "ffmpeg", seconds: int = 30):
        self._manager = manager
        self._ffmpeg = ffmpeg
        self._seconds = seconds
        self._bundled = manager.current().version

    def version(self) -> str:
        return self._manager.current().version

    @staticmethod
    def _vid(url: str) -> str:
        return url.split("v=")[-1]

    def fetch_info(self, url: str) -> VideoInfo:
        vid = self._vid(url)
        self._maybe_fail(vid)
        return VideoInfo(
            vid, f"Video thử {vid}", "Kênh thử nghiệm", f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg",
            float(self._seconds),
        )  # fmt: skip

    def _maybe_fail(self, vid: str) -> None:
        if vid == PRIVATE_ID:
            raise DownloadError("private", "Video riêng tư hoặc chỉ dành cho thành viên.")
        if vid == NEEDS_UPDATE_ID and self._manager.current().version == self._bundled:
            raise DownloadError("needs_update", "YouTube có thể đã đổi cách phát video. (HTTP 403)")

    def download(
        self,
        url: str,
        out_base: Path,
        bitrate: int,
        on_progress: ProgressCb,
        should_cancel: CancelCheck,
    ) -> Path:
        vid = self._vid(url)
        slow = vid.startswith(SLOW_PREFIX)
        steps = 12 if slow else 2
        for i in range(steps):
            if should_cancel():
                raise JobCancelledError()
            on_progress("downloading", (i + 1) / steps * 100)
            time.sleep(0.25 if slow else 0.05)
        on_progress("converting", 100)
        dst = out_base.with_suffix(".mp3")
        subprocess.run(
            [self._ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
             "-i", f"sine=frequency=440:duration={self._seconds}",
             "-codec:a", "libmp3lame", "-b:a", f"{bitrate}k", str(dst)],
            check=True,
        )  # fmt: skip
        return dst


def fake_manager(root: Path) -> YtDlpManager:
    """YtDlpManager không đụng mạng: bản mới nhất luôn là FAKE_LATEST, cài đặt = tạo venv giả."""

    def installer(version: str, venv_dir: Path, pre: bool) -> None:
        py = venv_dir / "bin" / "python"
        py.parent.mkdir(parents=True)
        py.symlink_to(Path(sys.executable))

    return YtDlpManager(
        root,
        installer=installer,
        smoker=lambda python: (True, ""),
        latest_fetcher=lambda channel: FAKE_LATEST,
    )


def reset_state(settings, repo, manager: YtDlpManager | None = None) -> None:
    """Xóa toàn bộ job + file và đưa yt-dlp về bản cài sẵn (chỉ dùng cho E2E)."""
    import shutil

    repo.db.execute("DELETE FROM jobs")
    for path in settings.audio_dir.glob("*"):
        path.unlink(missing_ok=True)
    if manager is not None:
        shutil.rmtree(manager.versions_dir, ignore_errors=True)
        manager.versions_dir.mkdir(parents=True, exist_ok=True)
        manager.state_path.unlink(missing_ok=True)
        manager._state = manager._load()  # noqa: SLF001
