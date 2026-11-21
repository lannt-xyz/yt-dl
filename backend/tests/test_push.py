import base64
import json
import threading

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Database
from app.main import create_app
from app.services.downloader import DownloadError
from app.services.push import (
    InvalidSubscriptionError,
    PushNotifier,
    job_payload,
    load_or_create_vapid,
    validate_endpoint,
)
from tests.conftest import VIDEO_A, FakeDownloader, wait_for_status

FCM = "https://fcm.googleapis.com/fcm/send/abc123"
APPLE = "https://web.push.apple.com/QXYZ"
MOZ = "https://updates.push.services.mozilla.com/wpush/v2/xyz"


class Resp:
    def __init__(self, code):
        self.status_code = code


class PushError(Exception):
    def __init__(self, code):
        super().__init__(f"push {code}")
        self.response = Resp(code)


class RecordingSender:
    def __init__(self):
        self.calls: list[dict] = []
        self.fail: dict[str, Exception] = {}
        self.sent = threading.Event()

    def __call__(self, **kw):
        self.calls.append(kw)
        self.sent.set()
        exc = self.fail.get(kw["subscription_info"]["endpoint"])
        if exc:
            raise exc


@pytest.fixture
def db():
    d = Database(":memory:")
    yield d
    d.close()


@pytest.fixture
def sender():
    return RecordingSender()


@pytest.fixture
def notifier(db, sender, tmp_path):
    n = PushNotifier(db, tmp_path / "vapid.pem", sender=sender)
    yield n
    n.shutdown()


# ---- VAPID ----
def test_vapid_key_created_once_and_stable(tmp_path):
    path = tmp_path / "k" / "vapid.pem"
    p1, pub1 = load_or_create_vapid(path)
    p2, pub2 = load_or_create_vapid(path)
    assert p1 == p2 == path and pub1 == pub2
    assert oct(path.stat().st_mode & 0o777) == "0o600"
    raw = base64.urlsafe_b64decode(pub1 + "=" * (-len(pub1) % 4))
    assert len(raw) == 65 and raw[0] == 4  # điểm EC P-256 dạng uncompressed


def test_vapid_rejects_non_ec_key(tmp_path):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    path = tmp_path / "rsa.pem"
    key = rsa.generate_private_key(65537, 2048)
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    with pytest.raises(ValueError):
        load_or_create_vapid(path)


# ---- endpoint hợp lệ ----
@pytest.mark.parametrize("endpoint", [FCM, APPLE, MOZ, "https://wns2.notify.windows.com/x"])
def test_valid_endpoints(endpoint):
    validate_endpoint(endpoint)


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/x",
        "https://evil.example.com/x",
        "https://fcm.googleapis.com.evil.com/x",
        "https://169.254.169.254/latest/meta-data",
        "https://localhost:8000/x",
        "file:///etc/passwd",
        "",
        "not a url",
    ],
)
def test_invalid_endpoints(endpoint):
    with pytest.raises(InvalidSubscriptionError):
        validate_endpoint(endpoint)


def test_extra_hosts_allowed():
    validate_endpoint("https://push.my-ntfy.example/x", ("my-ntfy.example",))


# ---- đăng ký ----
def test_subscribe_is_idempotent_and_updates_keys(notifier):
    notifier.subscribe(FCM, "k1", "a1", "UA")
    notifier.subscribe(FCM, "k2", "a2", "UA")
    assert notifier.count() == 1
    row = notifier.db.query_one("SELECT * FROM push_subscriptions")
    assert (row["p256dh"], row["auth"]) == ("k2", "a2")
    assert notifier.has(FCM) and not notifier.has(APPLE)


def test_subscribe_requires_keys(notifier):
    with pytest.raises(InvalidSubscriptionError):
        notifier.subscribe(FCM, "", "a")
    assert notifier.count() == 0


def test_unsubscribe(notifier):
    notifier.subscribe(FCM, "k", "a")
    assert notifier.unsubscribe(FCM) is True
    assert notifier.unsubscribe(FCM) is False
    assert notifier.count() == 0


# ---- gửi ----
def test_notify_sends_encrypted_payload_to_all(notifier, sender):
    notifier.subscribe(FCM, "k1", "a1")
    notifier.subscribe(APPLE, "k2", "a2")
    assert notifier.notify({"title": "Tải xong", "body": "Bài hát"}, wait=True) == 2
    assert {c["subscription_info"]["endpoint"] for c in sender.calls} == {FCM, APPLE}
    call = sender.calls[0]
    assert json.loads(call["data"]) == {"title": "Tải xong", "body": "Bài hát"}
    assert call["vapid_claims"] == {"sub": "mailto:admin@example.com"}
    assert call["vapid_private_key"].endswith("vapid.pem")
    assert call["subscription_info"]["keys"].keys() == {"p256dh", "auth"}


def test_notify_without_subscriptions_sends_nothing(notifier, sender):
    assert notifier.notify({"title": "x"}, wait=True) == 0
    assert sender.calls == []


@pytest.mark.parametrize("code", [404, 410])
def test_expired_subscription_is_removed(notifier, sender, code):
    notifier.subscribe(FCM, "k", "a")
    notifier.subscribe(APPLE, "k", "a")
    sender.fail[FCM] = PushError(code)
    assert notifier.notify({"title": "x"}, wait=True) == 1
    assert not notifier.has(FCM) and notifier.has(APPLE)


@pytest.mark.parametrize("failure", [PushError(500), OSError("mạng")])
def test_transient_failure_keeps_subscription(notifier, sender, failure):
    notifier.subscribe(FCM, "k", "a")
    sender.fail[FCM] = failure
    assert notifier.notify({"title": "x"}, wait=True) == 0
    assert notifier.has(FCM)


# ---- nội dung thông báo ----
def test_job_payload_done_and_failed():
    done = job_payload({"id": "j1", "kind": "download", "status": "done", "title": "Bài A"})
    assert done["title"] == "Tải xong" and done["body"] == "Bài A"
    assert done["tag"] == "job-j1" and done["url"] == "/?tab=history&job=j1"
    bad = job_payload({"id": "j2", "kind": "download", "status": "failed", "title": "B",
                       "error_message": "HTTP 403"})  # fmt: skip
    assert bad["title"] == "Tải thất bại" and "HTTP 403" in bad["body"]


@pytest.mark.parametrize(
    "job",
    [
        {"id": "x", "kind": "download", "status": "cancelled"},
        {"id": "x", "kind": "trim", "status": "done"},
        {"id": "x", "kind": "download", "status": "queued"},
    ],
)
def test_job_payload_skips_irrelevant(job):
    assert job_payload(job) is None


def test_job_payload_truncates_and_falls_back():
    p = job_payload({"id": "x", "kind": "download", "status": "done", "title": "A" * 500})
    assert len(p["body"]) == 200
    assert (
        job_payload({"id": "x", "kind": "download", "status": "done", "video_id": "vid"})["body"]
        == "vid"
    )


# ---- API + tích hợp worker ----
@pytest.fixture
def app_client(tmp_path):
    sender = RecordingSender()
    fake = FakeDownloader()
    settings = Settings(data_dir=tmp_path / "d", update_check_hours=0)
    app = create_app(settings, downloader=fake)
    with TestClient(app) as c:
        c.app.state.push._sender = sender
        yield c, sender, fake


def sub_body(endpoint=FCM):
    return {"endpoint": endpoint, "keys": {"p256dh": "BPkey", "auth": "authkey"}}


def test_api_key_and_subscribe_flow(app_client):
    c, _, _ = app_client
    key = c.get("/api/push/key").json()["public_key"]
    assert len(key) >= 80
    assert c.get("/api/push/key").json()["public_key"] == key
    r = c.post("/api/push/subscribe", json=sub_body())
    assert r.status_code == 201 and r.json() == {"subscribed": True, "devices": 1}
    assert c.post("/api/push/status", json={"endpoint": FCM}).json()["subscribed"] is True
    assert c.post("/api/push/unsubscribe", json={"endpoint": FCM}).json() == {
        "removed": True,
        "devices": 0,
    }
    assert c.post("/api/push/status", json={"endpoint": FCM}).json()["subscribed"] is False


def test_api_rejects_unsafe_endpoint(app_client):
    c, _, _ = app_client
    r = c.post("/api/push/subscribe", json=sub_body("https://evil.example.com/x"))
    assert r.status_code == 422 and r.json()["detail"]["code"] == "invalid_subscription"
    assert c.post("/api/push/subscribe", json={"endpoint": FCM}).status_code == 422


def test_api_test_notification(app_client):
    c, sender, _ = app_client
    assert c.post("/api/push/test").status_code == 409
    c.post("/api/push/subscribe", json=sub_body())
    r = c.post("/api/push/test")
    assert r.status_code == 200 and r.json()["sent"] == 1
    assert json.loads(sender.calls[0]["data"])["tag"] == "test"


def test_finished_download_triggers_push(app_client):
    c, sender, _ = app_client
    c.post("/api/push/subscribe", json=sub_body())
    job = c.post("/api/jobs", json={"url": f"https://youtu.be/{VIDEO_A}"}).json()
    wait_for_status(c, job["id"], "done")
    assert sender.sent.wait(5)
    payload = json.loads(sender.calls[0]["data"])
    assert payload["title"] == "Tải xong" and payload["job_id"] == job["id"]


def test_failed_download_triggers_push(app_client):
    c, sender, fake = app_client
    c.post("/api/push/subscribe", json=sub_body())
    fake.fail_with = DownloadError("private", "riêng tư")
    job = c.post("/api/jobs", json={"url": f"https://youtu.be/{VIDEO_A}"}).json()
    wait_for_status(c, job["id"], "failed")
    assert sender.sent.wait(5)
    assert json.loads(sender.calls[0]["data"])["title"] == "Tải thất bại"


def test_cancel_and_trim_do_not_push(app_client):
    c, sender, fake = app_client
    c.post("/api/push/subscribe", json=sub_body())
    fake.release.clear()
    running = c.post("/api/jobs", json={"url": f"https://youtu.be/{VIDEO_A}"}).json()["id"]
    assert fake.started.wait(5)
    c.post(f"/api/jobs/{running}/cancel")
    wait_for_status(c, running, "cancelled")
    fake.release.set()
    done = c.post("/api/jobs", json={"url": "https://youtu.be/9bZkp7q19f0"}).json()["id"]
    wait_for_status(c, done, "done")
    assert sender.sent.wait(5)
    n = len(sender.calls)
    c.post(f"/api/jobs/{done}/trim", json={"start": 0, "end": 2})
    import time

    time.sleep(0.3)
    assert len(sender.calls) == n  # chỉ có thông báo của job "done", không có cancel/trim
    assert all(json.loads(x["data"])["job_id"] == done for x in sender.calls)


def test_real_webpush_encryption_and_vapid_signing_with_our_key(tmp_path):
    """Chạy pywebpush thật (mã hóa + ký VAPID) với khóa do app tạo; chỉ giả lập bước POST mạng."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    from app.services.push import _default_sender

    key_path, _ = load_or_create_vapid(tmp_path / "vapid.pem")
    browser_key = ec.generate_private_key(ec.SECP256R1())
    p256dh = (
        base64.urlsafe_b64encode(
            browser_key.public_key().public_bytes(
                serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
            )
        )
        .rstrip(b"=")
        .decode()
    )
    auth = base64.urlsafe_b64encode(b"0123456789abcdef").rstrip(b"=").decode()

    captured = {}

    class Session:
        def post(self, url, data=None, headers=None, timeout=None):
            captured.update(url=url, headers=headers, size=len(data))

            class R:
                status_code = 201
                ok = True
                text = ""
                headers: dict = {}

            return R()

    _default_sender(
        subscription_info={"endpoint": FCM, "keys": {"p256dh": p256dh, "auth": auth}},
        data=json.dumps({"title": "Xin chào"}),
        vapid_private_key=str(key_path),
        vapid_claims={"sub": "mailto:admin@example.com"},
        ttl=60,
        requests_session=Session(),
    )
    assert captured["url"] == FCM
    assert captured["headers"]["content-encoding"] == "aes128gcm"
    assert captured["headers"]["authorization"].startswith("vapid ")
    assert captured["size"] > 50
