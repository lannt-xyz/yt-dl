from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ALLOWED_BITRATES = (128, 192, 256, 320)


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    concurrency: int = 1
    default_bitrate: int = 192
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"
    static_dir: Path | None = None
    update_check_hours: float = 24.0
    vapid_subject: str = "mailto:admin@example.com"
    push_extra_hosts: tuple[str, ...] = ()
    smoke_url: str | None = "https://www.youtube.com/watch?v=jNQXAC9IVRw"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "app.db"

    @property
    def audio_dir(self) -> Path:
        return self.data_dir / "audio"

    @property
    def vapid_key_path(self) -> Path:
        return self.data_dir / "vapid_private.pem"

    @property
    def ytdlp_dir(self) -> Path:
        return self.data_dir / "ytdlp"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.audio_dir.mkdir(parents=True, exist_ok=True)

    @classmethod
    def from_env(cls) -> Settings:
        static = os.environ.get("YT_STATIC_DIR")
        return cls(
            data_dir=Path(os.environ.get("YT_DATA_DIR", "data")).resolve(),
            concurrency=max(1, int(os.environ.get("YT_CONCURRENCY", "1"))),
            default_bitrate=int(os.environ.get("YT_DEFAULT_BITRATE", "192")),
            ffmpeg_bin=os.environ.get("YT_FFMPEG", "ffmpeg"),
            ffprobe_bin=os.environ.get("YT_FFPROBE", "ffprobe"),
            static_dir=Path(static).resolve() if static else None,
            update_check_hours=float(os.environ.get("YT_UPDATE_CHECK_HOURS", "24")),
            vapid_subject=os.environ.get("YT_VAPID_SUBJECT", "mailto:admin@example.com"),
            push_extra_hosts=tuple(
                h.strip().lower()
                for h in os.environ.get("YT_PUSH_HOSTS", "").split(",")
                if h.strip()
            ),
            smoke_url=os.environ.get("YT_SMOKE_URL", "https://www.youtube.com/watch?v=jNQXAC9IVRw")
            or None,
        )
