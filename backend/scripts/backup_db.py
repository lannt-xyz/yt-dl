"""Sao lưu cơ sở dữ liệu thủ công / bằng cron:  python scripts/backup_db.py [data_dir]"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import Settings  # noqa: E402
from app.services.backup import backup_database  # noqa: E402


def main() -> int:
    settings = Settings.from_env()
    if len(sys.argv) > 1:
        settings = Settings(data_dir=Path(sys.argv[1]).resolve(), backup_keep=settings.backup_keep)
    if not settings.db_path.exists():
        print(f"Không thấy {settings.db_path}", file=sys.stderr)
        return 1
    dest = backup_database(settings.db_path, settings.backup_dir, settings.backup_keep)
    print(f"Đã sao lưu: {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
