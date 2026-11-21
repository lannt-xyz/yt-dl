from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ALLOWED_BITRATES = (128, 192, 256, 320)


def _opt_bool(value: str | None) -> bool | None:
    if value is None or value == "":
        return None
    return value.lower() in ("1", "true", "yes")


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    concurrency: int = 1
    default_bitrate: int = 192
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"
    static_dir: Path | None = None
    update_check_hours: float = 24.0
    fake_downloader: bool = False  # chỉ cho E2E
    password: str | None = None
    password_hash: str | None = None
    session_days: int = 30
    trust_proxy: bool = False
    cookie_secure: bool | None = None  # None = tự theo scheme của request
    retention_days: int = 30
    max_storage_gb: float = 0.0
    cleanup_interval_min: float = 60.0
    backup_keep: int = 7
    backup_interval_hours: float = 24.0
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
    def auth_enabled(self) -> bool:
        return bool(self.password or self.password_hash)

    @property
    def backup_dir(self) -> Path:
        return self.data_dir / "backups"

    @property
    def secret_key_path(self) -> Path:
        return self.data_dir / "secret.key"

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
            fake_downloader=os.environ.get("YT_FAKE_DOWNLOADER", "") in ("1", "true"),
            password=os.environ.get("YT_PASSWORD") or None,
            password_hash=os.environ.get("YT_PASSWORD_HASH") or None,
            session_days=int(os.environ.get("YT_SESSION_DAYS", "30")),
            trust_proxy=os.environ.get("YT_TRUST_PROXY", "").lower() in ("1", "true", "yes"),
            cookie_secure=_opt_bool(os.environ.get("YT_COOKIE_SECURE")),
            retention_days=int(os.environ.get("YT_RETENTION_DAYS", "30")),
            max_storage_gb=float(os.environ.get("YT_MAX_STORAGE_GB", "0")),
            cleanup_interval_min=float(os.environ.get("YT_CLEANUP_INTERVAL_MIN", "60")),
            backup_keep=int(os.environ.get("YT_BACKUP_KEEP", "7")),
            backup_interval_hours=float(os.environ.get("YT_BACKUP_INTERVAL_HOURS", "24")),
            vapid_subject=os.environ.get("YT_VAPID_SUBJECT", "mailto:admin@example.com"),
            push_extra_hosts=tuple(
                h.strip().lower()
                for h in os.environ.get("YT_PUSH_HOSTS", "").split(",")
                if h.strip()
            ),
            smoke_url=os.environ.get("YT_SMOKE_URL", "https://www.youtube.com/watch?v=jNQXAC9IVRw")
            or None,
        )
