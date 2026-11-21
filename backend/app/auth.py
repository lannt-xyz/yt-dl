from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from collections import deque
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .config import Settings
from .db import Database

COOKIE_NAME = "ytmp3_session"
TOKEN_PREFIX = "ytm_"
PBKDF2_ITERATIONS = 240_000
MAX_FAILURES = 5
FAILURE_WINDOW = 300.0  # giây


# ---- băm mật khẩu ----
def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str, iterations: int = PBKDF2_ITERATIONS) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"pbkdf2_sha256${iterations}${_b64(salt)}${_b64(digest)}"


def verify_password_hash(password: str, encoded: str) -> bool:
    try:
        scheme, iterations, salt, digest = encoded.split("$")
        if scheme != "pbkdf2_sha256":
            return False
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), _unb64(salt), int(iterations))
        return hmac.compare_digest(calc, _unb64(digest))
    except (ValueError, TypeError):
        return False


def load_or_create_secret(path: Path) -> bytes:
    if path.exists():
        return bytes.fromhex(path.read_text().strip())
    path.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_bytes(32)
    path.write_text(key.hex())
    path.chmod(0o600)
    return key


class AuthManager:
    def __init__(self, settings: Settings, db: Database, clock: Callable[[], float] = time.time):
        self.settings = settings
        self.db = db
        self._clock = clock
        self._secret = load_or_create_secret(settings.secret_key_path)
        self._failures: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return self.settings.auth_enabled

    # ---- mật khẩu ----
    def verify_password(self, password: str) -> bool:
        s = self.settings
        if s.password_hash:
            return verify_password_hash(password, s.password_hash)
        if s.password:
            return hmac.compare_digest(password.encode(), s.password.encode())
        return False

    # ---- chống dò mật khẩu ----
    def retry_after(self, ip: str) -> int:
        """Số giây phải chờ nếu IP này đã sai quá nhiều lần; 0 nếu được phép thử."""
        now = self._clock()
        with self._lock:
            q = self._failures.get(ip)
            if not q:
                return 0
            while q and now - q[0] > FAILURE_WINDOW:
                q.popleft()
            if len(q) >= MAX_FAILURES:
                return max(1, int(FAILURE_WINDOW - (now - q[0])) + 1)
            return 0

    def record_failure(self, ip: str) -> None:
        with self._lock:
            self._failures.setdefault(ip, deque()).append(self._clock())
            if len(self._failures) > 1000:  # giữ bộ nhớ có giới hạn
                oldest = min(self._failures, key=lambda k: self._failures[k][-1])
                self._failures.pop(oldest, None)

    def clear_failures(self, ip: str) -> None:
        with self._lock:
            self._failures.pop(ip, None)

    # ---- session cookie ----
    def _password_version(self) -> str:
        material = (self.settings.password_hash or self.settings.password or "").encode()
        return hashlib.sha256(self._secret + material).hexdigest()[:12]

    def _sign(self, payload: str) -> str:
        return _b64(hmac.new(self._secret, payload.encode(), hashlib.sha256).digest())

    def make_session(self) -> tuple[str, int]:
        now = int(self._clock())
        max_age = self.settings.session_days * 86400
        body = _b64(
            json.dumps({"iat": now, "exp": now + max_age, "pv": self._password_version()}).encode()
        )
        return f"{body}.{self._sign(body)}", max_age

    def check_session(self, token: str | None) -> bool:
        if not token or "." not in token:
            return False
        body, sig = token.rsplit(".", 1)
        if not hmac.compare_digest(sig, self._sign(body)):
            return False
        try:
            data: dict[str, Any] = json.loads(_unb64(body))
        except ValueError:
            return False
        # đổi mật khẩu → mọi session cũ mất hiệu lực
        return data.get("exp", 0) > self._clock() and data.get("pv") == self._password_version()

    # ---- API token (cho iOS Shortcut...) ----
    @staticmethod
    def _hash_token(raw: str) -> str:
        return hashlib.sha256(raw.encode()).hexdigest()

    def create_token(self, name: str) -> dict[str, Any]:
        raw = TOKEN_PREFIX + secrets.token_urlsafe(32)
        token_id = secrets.token_hex(6)
        self.db.execute(
            "INSERT INTO api_tokens (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)",
            (token_id, name.strip()[:80] or "Token", self._hash_token(raw), self._clock()),
        )
        return {"id": token_id, "name": name.strip()[:80] or "Token", "token": raw}

    def list_tokens(self) -> list[dict[str, Any]]:
        return self.db.query(
            "SELECT id, name, created_at, last_used_at FROM api_tokens ORDER BY created_at DESC"
        )

    def revoke_token(self, token_id: str) -> bool:
        return self.db.execute("DELETE FROM api_tokens WHERE id = ?", (token_id,)).rowcount > 0

    def check_api_token(self, raw: str) -> bool:
        if not raw.startswith(TOKEN_PREFIX):
            return False
        row = self.db.query_one(
            "SELECT id FROM api_tokens WHERE token_hash = ?", (self._hash_token(raw),)
        )
        if not row:
            return False
        self.db.execute(
            "UPDATE api_tokens SET last_used_at = ? WHERE id = ?", (self._clock(), row["id"])
        )
        return True
