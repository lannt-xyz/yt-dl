import pytest
from fastapi.testclient import TestClient

from app.auth import (
    COOKIE_NAME,
    MAX_FAILURES,
    AuthManager,
    hash_password,
    load_or_create_secret,
    verify_password_hash,
)
from app.config import Settings
from app.db import Database
from app.main import create_app
from tests.conftest import FakeDownloader

PW = "mật khẩu đủ dài 123"


def make_client(tmp_path, **kw):
    settings = Settings(data_dir=tmp_path / "d", update_check_hours=0, password=PW, **kw)
    return TestClient(create_app(settings, downloader=FakeDownloader()))


@pytest.fixture
def locked(tmp_path):
    with make_client(tmp_path) as c:
        yield c


def login(c, password=PW, **kw):
    return c.post("/api/auth/login", json={"password": password}, **kw)


# ---- băm mật khẩu ----
def test_hash_roundtrip_and_uniqueness():
    h1, h2 = hash_password(PW, 1000), hash_password(PW, 1000)
    assert h1 != h2  # salt ngẫu nhiên
    assert verify_password_hash(PW, h1) and verify_password_hash(PW, h2)
    assert not verify_password_hash("sai", h1)


@pytest.mark.parametrize("bad", ["", "abc", "md5$1$a$b", "pbkdf2_sha256$x$a$b", "a$b$c$d$e"])
def test_verify_rejects_malformed_hash(bad):
    assert verify_password_hash(PW, bad) is False


def test_secret_key_persisted_with_private_mode(tmp_path):
    path = tmp_path / "k" / "secret.key"
    a, b = load_or_create_secret(path), load_or_create_secret(path)
    assert a == b and len(a) == 32
    assert oct(path.stat().st_mode & 0o777) == "0o600"


# ---- khi KHÔNG đặt mật khẩu: mở như cũ ----
def test_open_when_no_password_configured(client):
    assert client.get("/api/auth/status").json() == {"required": False, "authenticated": True}
    assert client.get("/api/jobs").status_code == 200


# ---- khi có mật khẩu ----
def test_status_before_login(locked):
    assert locked.get("/api/auth/status").json() == {"required": True, "authenticated": False}


def test_health_is_public_everything_else_is_not(locked):
    assert locked.get("/api/health").status_code == 200
    for path in ("/api/jobs", "/api/system", "/api/ytdlp", "/api/push/key", "/api/events"):
        r = locked.get(path)
        assert r.status_code == 401, path
        assert r.json()["detail"]["code"] == "unauthorized"
    assert locked.post("/api/jobs", json={"url": "https://youtu.be/dQw4w9WgXcQ"}).status_code == 401
    assert locked.get("/api/jobs/x/audio").status_code == 401


def test_login_sets_httponly_samesite_cookie_and_unlocks(locked):
    r = login(locked)
    assert r.status_code == 200 and r.json() == {"authenticated": True}
    cookie = r.headers["set-cookie"].lower()
    assert COOKIE_NAME in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert "secure" not in cookie  # http thường (test) thì không đặt Secure
    assert locked.get("/api/jobs").status_code == 200
    assert locked.get("/api/auth/status").json()["authenticated"] is True


def test_wrong_password_rejected(locked):
    r = login(locked, "sai")
    assert r.status_code == 401 and r.json()["detail"]["code"] == "bad_password"
    assert locked.get("/api/jobs").status_code == 401


def test_logout_locks_again(locked):
    login(locked)
    assert locked.post("/api/auth/logout").status_code == 200
    locked.cookies.clear()
    assert locked.get("/api/jobs").status_code == 401


def test_tampered_or_garbage_cookie_rejected(locked):
    login(locked)
    good = locked.cookies.get(COOKIE_NAME)
    for bad in (good[:-3] + "xyz", "abc.def", "not-a-cookie", good.split(".")[0] + ".AAAA"):
        locked.cookies.set(COOKIE_NAME, bad)
        assert locked.get("/api/jobs").status_code == 401


def test_cookie_secure_flag_follows_https_and_proxy(tmp_path):
    with make_client(tmp_path, trust_proxy=True) as c:
        r = login(c, headers={"x-forwarded-proto": "https"})
        assert "secure" in r.headers["set-cookie"].lower()
    with make_client(tmp_path / "b", cookie_secure=True) as c:
        assert "secure" in login(c).headers["set-cookie"].lower()


def test_session_expiry(tmp_path):
    db = Database(":memory:")
    now = [1000.0]
    s = Settings(data_dir=tmp_path, password=PW, session_days=1)
    mgr = AuthManager(s, db, clock=lambda: now[0])
    token, max_age = mgr.make_session()
    assert max_age == 86400 and mgr.check_session(token)
    now[0] += 86400 + 1
    assert not mgr.check_session(token)
    db.close()


def test_changing_password_invalidates_sessions(tmp_path):
    db = Database(":memory:")
    a = AuthManager(Settings(data_dir=tmp_path, password="mật khẩu cũ 1234"), db)
    token, _ = a.make_session()
    b = AuthManager(Settings(data_dir=tmp_path, password="mật khẩu mới 5678"), db)
    assert a.check_session(token) and not b.check_session(token)
    db.close()


def test_hashed_password_config_works(tmp_path):
    settings = Settings(
        data_dir=tmp_path / "d", update_check_hours=0, password_hash=hash_password(PW, 1000)
    )
    with TestClient(create_app(settings, downloader=FakeDownloader())) as c:
        assert login(c, "sai").status_code == 401
        assert login(c).status_code == 200


# ---- chống dò mật khẩu ----
def test_rate_limit_after_repeated_failures(locked):
    for _ in range(MAX_FAILURES):
        assert login(locked, "sai").status_code == 401
    r = login(locked, "sai")
    assert r.status_code == 429 and r.json()["detail"]["code"] == "rate_limited"
    assert int(r.headers["retry-after"]) > 0
    # ngay cả mật khẩu ĐÚNG cũng bị chặn trong thời gian khóa
    assert login(locked, PW).status_code == 429


def test_success_clears_failure_counter(locked):
    for _ in range(MAX_FAILURES - 1):
        login(locked, "sai")
    assert login(locked).status_code == 200
    for _ in range(MAX_FAILURES - 1):
        assert login(locked, "sai").status_code == 401  # bộ đếm đã được reset


def test_rate_limit_window_expires(tmp_path):
    db = Database(":memory:")
    now = [0.0]
    mgr = AuthManager(Settings(data_dir=tmp_path, password=PW), db, clock=lambda: now[0])
    for _ in range(MAX_FAILURES):
        mgr.record_failure("1.2.3.4")
    assert mgr.retry_after("1.2.3.4") > 0 and mgr.retry_after("5.6.7.8") == 0
    now[0] += 400
    assert mgr.retry_after("1.2.3.4") == 0
    db.close()


def test_rate_limit_is_per_ip_with_trusted_proxy(tmp_path):
    with make_client(tmp_path, trust_proxy=True) as c:
        for _ in range(MAX_FAILURES):
            login(c, "sai", headers={"x-forwarded-for": "9.9.9.9"})
        assert login(c, "sai", headers={"x-forwarded-for": "9.9.9.9"}).status_code == 429
        assert login(c, PW, headers={"x-forwarded-for": "8.8.8.8"}).status_code == 200


def test_forwarded_header_ignored_without_trust(locked):
    for _ in range(MAX_FAILURES):
        login(locked, "sai", headers={"x-forwarded-for": "1.1.1.1"})
    # đổi X-Forwarded-For không giúp né giới hạn khi không tin proxy
    assert login(locked, "sai", headers={"x-forwarded-for": "2.2.2.2"}).status_code == 429


# ---- chống gọi chéo trang ----
def test_cross_origin_unsafe_request_blocked_but_same_origin_ok(locked):
    login(locked)
    body = {"url": "https://youtu.be/dQw4w9WgXcQ"}
    evil = locked.post("/api/jobs", json=body, headers={"origin": "https://evil.example"})
    assert evil.status_code == 403 and evil.json()["detail"]["code"] == "bad_origin"
    ok = locked.post("/api/jobs", json=body, headers={"origin": "http://testserver"})
    assert ok.status_code == 201
    # GET chéo trang không bị chặn bởi kiểm tra này (cookie SameSite=Lax lo phần còn lại)
    assert locked.get("/api/jobs", headers={"origin": "https://evil.example"}).status_code == 200


# ---- API token ----
def test_token_lifecycle(locked):
    login(locked)
    created = locked.post("/api/auth/tokens", json={"name": "iPhone Shortcut"})
    assert created.status_code == 201
    data = created.json()
    assert data["token"].startswith("ytm_") and len(data["token"]) > 30
    listing = locked.get("/api/auth/tokens").json()["items"]
    assert [t["name"] for t in listing] == ["iPhone Shortcut"]
    assert "token" not in listing[0] and "token_hash" not in listing[0]  # không bao giờ lộ lại

    locked.cookies.clear()  # chỉ dùng Bearer, không cookie
    auth = {"Authorization": f"Bearer {data['token']}"}
    r = locked.post("/api/jobs", json={"url": "https://youtu.be/dQw4w9WgXcQ"}, headers=auth)
    assert r.status_code == 201
    assert locked.get("/api/jobs", headers=auth).status_code == 200

    login(locked)
    assert locked.get("/api/auth/tokens").json()["items"][0]["last_used_at"] is not None
    assert locked.delete(f"/api/auth/tokens/{data['id']}").status_code == 204
    locked.cookies.clear()
    assert locked.get("/api/jobs", headers=auth).status_code == 401


@pytest.mark.parametrize(
    "header", ["Bearer ", "Bearer nope", "Bearer ytm_fake", "Basic abc", "ytm_x"]
)
def test_bad_bearer_tokens_rejected(locked, header):
    assert locked.get("/api/jobs", headers={"Authorization": header}).status_code == 401


def test_token_management_requires_auth(locked):
    assert locked.get("/api/auth/tokens").status_code == 401
    assert locked.post("/api/auth/tokens", json={}).status_code == 401
    assert locked.delete("/api/auth/tokens/x").status_code == 401


def test_revoke_unknown_token_404(locked):
    login(locked)
    assert locked.delete("/api/auth/tokens/nope").status_code == 404


def test_bearer_ignores_origin_check(locked):
    login(locked)
    token = locked.post("/api/auth/tokens", json={"name": "t"}).json()["token"]
    locked.cookies.clear()
    r = locked.post(
        "/api/jobs",
        json={"url": "https://youtu.be/dQw4w9WgXcQ"},
        headers={"Authorization": f"Bearer {token}", "origin": "https://other"},
    )
    assert r.status_code == 201  # Bearer không bị CSRF nên không cần chặn theo Origin
