from __future__ import annotations

import base64
import json
import logging
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from ..db import Database

log = logging.getLogger("push")

# Chỉ gửi tới dịch vụ push của trình duyệt (chống SSRF: client không bắt server POST URL tùy ý).
ALLOWED_HOST_SUFFIXES = (
    "fcm.googleapis.com",
    "push.services.mozilla.com",
    "push.apple.com",
    "notify.windows.com",
)

Sender = Callable[..., Any]


class InvalidSubscriptionError(ValueError):
    pass


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def load_or_create_vapid(path: Path) -> tuple[Path, str]:
    """Trả về (đường dẫn khóa riêng PEM, khóa công khai base64url cho applicationServerKey)."""
    if path.exists():
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey):
            raise ValueError("Khóa VAPID phải là EC P-256")
    else:
        key = ec.generate_private_key(ec.SECP256R1())
        path.parent.mkdir(parents=True, exist_ok=True)
        pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        path.write_bytes(pem)
        path.chmod(0o600)
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return path, _b64url(public)


def validate_endpoint(endpoint: str, extra_hosts: tuple[str, ...] = ()) -> None:
    parsed = urlparse(endpoint)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host:
        raise InvalidSubscriptionError("Endpoint push phải là https")
    allowed = (*ALLOWED_HOST_SUFFIXES, *extra_hosts)
    if not any(host == s or host.endswith("." + s) for s in allowed):
        raise InvalidSubscriptionError("Endpoint push không thuộc dịch vụ push được hỗ trợ")


def _default_sender(**kwargs: Any) -> Any:
    from pywebpush import webpush

    return webpush(**kwargs)


class PushNotifier:
    def __init__(
        self,
        db: Database,
        vapid_key_path: Path,
        *,
        subject: str = "mailto:admin@example.com",
        extra_hosts: tuple[str, ...] = (),
        sender: Sender = _default_sender,
        executor: ThreadPoolExecutor | None = None,
    ):
        self.db = db
        self.key_path, self.public_key = load_or_create_vapid(vapid_key_path)
        self.subject = subject
        self.extra_hosts = extra_hosts
        self._sender = sender
        self._executor = executor or ThreadPoolExecutor(max_workers=2, thread_name_prefix="push")

    # ---- đăng ký ----
    def subscribe(
        self, endpoint: str, p256dh: str, auth: str, user_agent: str | None = None
    ) -> None:
        validate_endpoint(endpoint, self.extra_hosts)
        if not p256dh or not auth:
            raise InvalidSubscriptionError("Thiếu khóa mã hóa của subscription")
        self.db.execute(
            "INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET "
            "p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent",
            (endpoint, p256dh, auth, (user_agent or "")[:300], time.time()),
        )

    def unsubscribe(self, endpoint: str) -> bool:
        return (
            self.db.execute(
                "DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,)
            ).rowcount
            > 0
        )

    def count(self) -> int:
        row = self.db.query_one("SELECT COUNT(*) AS n FROM push_subscriptions")
        return row["n"] if row else 0

    def has(self, endpoint: str) -> bool:
        return (
            self.db.query_one(
                "SELECT 1 AS x FROM push_subscriptions WHERE endpoint = ?", (endpoint,)
            )
            is not None
        )

    # ---- gửi ----
    def notify(self, payload: dict[str, Any], *, wait: bool = False) -> int:
        """Gửi tới mọi thiết bị đã đăng ký.

        Trả về số subscription (khi ``wait=True``: số lần gửi thành công).
        """
        subs = self.db.query("SELECT * FROM push_subscriptions")
        if not subs:
            return 0
        data = json.dumps(payload, ensure_ascii=False)
        futures = [self._executor.submit(self._send_one, s, data) for s in subs]
        if not wait:
            return len(subs)
        return sum(1 for f in futures if f.result())

    def _send_one(self, sub: dict[str, Any], data: str) -> bool:
        try:
            self._sender(
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
                },
                data=data,
                vapid_private_key=str(self.key_path),
                vapid_claims={"sub": self.subject},
                ttl=3600,
                timeout=15,
            )
            return True
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):  # subscription đã hết hạn / bị thu hồi
                self.unsubscribe(sub["endpoint"])
                log.info("Xóa push subscription hết hạn (%s)", status)
            else:
                log.warning("Gửi push thất bại: %s", exc)
            return False

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)


def job_payload(job: dict[str, Any]) -> dict[str, Any] | None:
    """Nội dung thông báo cho một job vừa kết thúc; None nếu không cần báo."""
    if job.get("kind") != "download" or job.get("status") not in ("done", "failed"):
        return None
    name = job.get("title") or job.get("video_id") or "video"
    if job["status"] == "done":
        title, body = "Tải xong", name
    else:
        title, body = "Tải thất bại", f"{name} — {job.get('error_message') or 'có lỗi xảy ra'}"
    return {
        "title": title,
        "body": body[:200],
        "job_id": job["id"],
        "tag": f"job-{job['id']}",
        "url": f"/?tab=history&job={job['id']}",
        "icon": "/icons/icon-192.png",
    }
