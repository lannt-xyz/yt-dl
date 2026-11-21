from __future__ import annotations

import time
import uuid
from typing import Any

from .db import Database

ACTIVE_STATUSES = ("queued", "fetching_info", "downloading", "converting")
RUNNING_STATUSES = ("fetching_info", "downloading", "converting")
TERMINAL_STATUSES = ("done", "failed", "cancelled")
ALL_STATUSES = ACTIVE_STATUSES + TERMINAL_STATUSES

COLUMNS = {
    "kind", "parent_id", "url", "video_id", "title", "channel", "thumbnail", "duration",
    "status", "progress", "error_code", "error_message", "file_name", "file_size", "bitrate",
    "trim_start", "trim_end", "ytdlp_version", "seen", "created_at", "started_at", "finished_at",
}  # fmt: skip


def new_id() -> str:
    return uuid.uuid4().hex[:12]


class JobRepo:
    def __init__(self, db: Database):
        self.db = db

    # ---- tạo / đọc ----
    def create(self, *, kind: str = "download", **fields: Any) -> dict[str, Any]:
        self._check(fields)
        job_id = new_id()
        values = {
            "id": job_id,
            "kind": kind,
            "status": "queued",
            "progress": 0,
            "created_at": time.time(),
            **fields,
        }
        cols = ", ".join(values)
        marks = ", ".join("?" for _ in values)
        self.db.execute(f"INSERT INTO jobs ({cols}) VALUES ({marks})", values.values())
        return self.get(job_id)  # type: ignore[return-value]

    def get(self, job_id: str) -> dict[str, Any] | None:
        return self.db.query_one("SELECT * FROM jobs WHERE id = ?", (job_id,))

    def list(
        self,
        *,
        status: str | None = None,
        kind: str | None = None,
        q: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        where, params = self._filters(status, kind, q)
        total = self.db.query_one(f"SELECT COUNT(*) AS n FROM jobs{where}", params)["n"]  # type: ignore[index]
        rows = self.db.query(
            f"SELECT * FROM jobs{where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        )
        return rows, total

    @staticmethod
    def _filters(status: str | None, kind: str | None, q: str | None) -> tuple[str, list[Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if status == "active":
            clauses.append(f"status IN ({','.join('?' for _ in ACTIVE_STATUSES)})")
            params.extend(ACTIVE_STATUSES)
        elif status:
            clauses.append("status = ?")
            params.append(status)
        if kind:
            clauses.append("kind = ?")
            params.append(kind)
        if q:
            like = f"%{q.strip()}%"
            clauses.append("(title LIKE ? OR channel LIKE ? OR url LIKE ?)")
            params.extend([like, like, like])
        return (" WHERE " + " AND ".join(clauses)) if clauses else "", params

    def find_by_video(self, video_id: str, statuses: tuple[str, ...]) -> dict[str, Any] | None:
        marks = ",".join("?" for _ in statuses)
        return self.db.query_one(
            f"SELECT * FROM jobs WHERE video_id = ? AND kind = 'download' AND status IN ({marks}) "
            "ORDER BY created_at DESC LIMIT 1",
            [video_id, *statuses],
        )

    def children(self, parent_id: str) -> list[dict[str, Any]]:
        return self.db.query(
            "SELECT * FROM jobs WHERE parent_id = ? ORDER BY created_at DESC", (parent_id,)
        )

    # ---- cập nhật ----
    def update(self, job_id: str, **fields: Any) -> dict[str, Any] | None:
        if not fields:
            return self.get(job_id)
        self._check(fields)
        sets = ", ".join(f"{k} = ?" for k in fields)
        self.db.execute(f"UPDATE jobs SET {sets} WHERE id = ?", [*fields.values(), job_id])
        return self.get(job_id)

    def claim_next(self) -> dict[str, Any] | None:
        """Lấy job ``download`` cũ nhất đang chờ và chuyển sang ``fetching_info``."""
        with self.db.lock:
            row = self.db.query_one(
                "SELECT id FROM jobs WHERE status = 'queued' AND kind = 'download' "
                "ORDER BY created_at, rowid LIMIT 1"
            )
            if not row:
                return None
            return self.update(row["id"], status="fetching_info", started_at=time.time())

    def reset_running_to_queued(self) -> int:
        cur = self.db.execute(
            f"UPDATE jobs SET status = 'queued', progress = 0, started_at = NULL "
            f"WHERE status IN ({','.join('?' for _ in RUNNING_STATUSES)}) AND kind = 'download'",
            RUNNING_STATUSES,
        )
        return cur.rowcount

    def mark_all_seen(self) -> int:
        cur = self.db.execute(
            f"UPDATE jobs SET seen = 1 WHERE seen = 0 "
            f"AND status IN ({','.join('?' for _ in TERMINAL_STATUSES)})",
            TERMINAL_STATUSES,
        )
        return cur.rowcount

    def unseen_count(self) -> int:
        row = self.db.query_one(
            f"SELECT COUNT(*) AS n FROM jobs WHERE seen = 0 "
            f"AND status IN ({','.join('?' for _ in TERMINAL_STATUSES)})",
            TERMINAL_STATUSES,
        )
        return row["n"] if row else 0

    def delete(self, job_id: str) -> None:
        with self.db.lock:
            self.db.execute("UPDATE jobs SET parent_id = NULL WHERE parent_id = ?", (job_id,))
            self.db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))

    def counts(self) -> dict[str, int]:
        rows = self.db.query("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status")
        return {r["status"]: r["n"] for r in rows}

    @staticmethod
    def _check(fields: dict[str, Any]) -> None:
        unknown = set(fields) - COLUMNS
        if unknown:
            raise ValueError(f"Cột không hợp lệ: {sorted(unknown)}")
