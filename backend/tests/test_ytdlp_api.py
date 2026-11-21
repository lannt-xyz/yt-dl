import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.downloader import DownloadError
from tests.conftest import VIDEO_A, FakeDownloader, wait_for_status
from tests.test_ytdlp_manager import Fakes


def wire(client: TestClient, fakes: Fakes):
    m = client.app.state.ytdlp
    m._installer, m._smoker, m._latest_fetcher = fakes.installer, fakes.smoker, fakes.fetcher
    return m


@pytest.fixture
def fakes():
    return Fakes()


@pytest.fixture
def yclient(client, fakes):
    wire(client, fakes)
    return client


def wait_version(client, version, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        st = client.get("/api/ytdlp").json()
        if st["version"] == version and not st["updating"]:
            return st
        time.sleep(0.05)
    raise AssertionError(f"version không đổi sang {version}: {st}")


def test_status_initial(yclient):
    st = yclient.get("/api/ytdlp").json()
    assert st["source"] == "bundled" and st["channel"] == "stable" and st["auto_update"] is False
    assert st["updating"] is False and st["versions"] == []


def test_check_reports_update_available(yclient):
    st = yclient.post("/api/ytdlp/check").json()
    assert st["latest"] == "2026.11.01" and st["update_available"] is True


def test_check_failure_returns_502(client):
    def boom(channel):
        raise OSError("không có mạng")

    client.app.state.ytdlp._latest_fetcher = boom
    r = client.post("/api/ytdlp/check")
    assert r.status_code == 502 and r.json()["detail"]["code"] == "check_failed"


def test_update_runs_in_background_and_switches(yclient):
    r = yclient.post("/api/ytdlp/update", json={})
    assert r.status_code == 202
    st = wait_version(yclient, "2026.11.01")
    assert st["source"] == "venv" and st["update_available"] is False


def test_update_specific_version_then_rollback(yclient):
    yclient.post("/api/ytdlp/update", json={"version": "2026.10.01"})
    wait_version(yclient, "2026.10.01")
    yclient.post("/api/ytdlp/update", json={"version": "2026.11.01"})
    wait_version(yclient, "2026.11.01")
    st = yclient.post("/api/ytdlp/rollback").json()
    assert st["version"] == "2026.10.01" and st["previous"] == "2026.11.01"


def test_rollback_without_history_conflicts(yclient):
    r = yclient.post("/api/ytdlp/rollback")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "no_previous"


def test_failed_update_leaves_version_and_status_reports_it(yclient, fakes):
    fakes.smoke_ok = False
    yclient.post("/api/ytdlp/update", json={"version": "2026.11.01"})
    time.sleep(0.5)
    st = wait_version(yclient, yclient.get("/api/ytdlp").json()["version"])
    assert st["source"] == "bundled" and st["versions"] == []


def test_second_update_while_running_conflicts(yclient, fakes):
    fakes.gate = threading.Event()
    assert yclient.post("/api/ytdlp/update", json={"version": "2026.11.01"}).status_code == 202
    assert fakes.entered.wait(5)
    r = yclient.post("/api/ytdlp/update", json={"version": "2026.12.01"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "updating"
    fakes.gate.set()
    wait_version(yclient, "2026.11.01")


def test_settings_roundtrip_and_validation(yclient):
    st = yclient.put("/api/ytdlp/settings", json={"channel": "nightly", "auto_update": True}).json()
    assert st["channel"] == "nightly" and st["auto_update"] is True
    bad = yclient.put("/api/ytdlp/settings", json={"channel": "beta"})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_channel"
    assert yclient.get("/api/ytdlp").json()["channel"] == "nightly"


# ---- tự phục hồi khi tải lỗi "needs_update" ----
def make_client(tmp_path, fake, fakes):
    app = create_app(Settings(data_dir=tmp_path / "d", update_check_hours=0), downloader=fake)
    c = TestClient(app)
    c.__enter__()
    wire(c, fakes)
    return c


def test_auto_update_fixes_job_and_retries_once(tmp_path):
    fake, fakes = FakeDownloader(), Fakes()
    original_install = fakes.installer

    def installer(version, venv_dir, pre):
        original_install(version, venv_dir, pre)
        fake.fail_with = None  # bản mới "sửa" được lỗi

    fakes.installer = installer
    c = make_client(tmp_path, fake, fakes)
    try:
        c.app.state.ytdlp._installer = installer
        c.put("/api/ytdlp/settings", json={"auto_update": True})
        fake.fail_with = DownloadError("needs_update", "HTTP 403")
        job = c.post("/api/jobs", json={"url": f"https://youtu.be/{VIDEO_A}"}).json()
        done = wait_for_status(c, job["id"], "done")
        assert done["error_code"] is None
        assert c.get("/api/ytdlp").json()["version"] == "2026.11.01"
    finally:
        c.__exit__(None, None, None)


def test_no_recovery_when_auto_update_disabled(tmp_path):
    fake, fakes = FakeDownloader(), Fakes()
    fake.fail_with = DownloadError("needs_update", "HTTP 403")
    c = make_client(tmp_path, fake, fakes)
    try:
        job = c.post("/api/jobs", json={"url": f"https://youtu.be/{VIDEO_A}"}).json()
        failed = wait_for_status(c, job["id"], "failed")
        assert failed["error_code"] == "needs_update"
        assert fakes.installed == []
    finally:
        c.__exit__(None, None, None)


def test_recovery_happens_only_once_per_job(tmp_path):
    fake, fakes = FakeDownloader(), Fakes()
    fake.fail_with = DownloadError("needs_update", "HTTP 403")  # bản mới cũng không sửa được
    c = make_client(tmp_path, fake, fakes)
    try:
        c.put("/api/ytdlp/settings", json={"auto_update": True})
        job = c.post("/api/jobs", json={"url": f"https://youtu.be/{VIDEO_A}"}).json()
        failed = wait_for_status(c, job["id"], "failed")
        assert failed["error_code"] == "needs_update"
        assert fakes.installed == ["2026.11.01"]  # chỉ cập nhật một lần, không lặp vô hạn
    finally:
        c.__exit__(None, None, None)


def test_other_errors_do_not_trigger_update(tmp_path):
    fake, fakes = FakeDownloader(), Fakes()
    fake.fail_with = DownloadError("private", "riêng tư")
    c = make_client(tmp_path, fake, fakes)
    try:
        c.put("/api/ytdlp/settings", json={"auto_update": True})
        job = c.post("/api/jobs", json={"url": f"https://youtu.be/{VIDEO_A}"}).json()
        wait_for_status(c, job["id"], "failed")
        assert fakes.installed == []
    finally:
        c.__exit__(None, None, None)


async def test_periodic_check_updates_when_auto(tmp_path):
    import asyncio

    from app.events import EventBroker
    from app.main import _periodic_check
    from app.services.ytdlp_manager import YtDlpManager

    fakes = Fakes()
    m = YtDlpManager(tmp_path / "y", installer=fakes.installer, smoker=fakes.smoker,
                     latest_fetcher=fakes.fetcher)  # fmt: skip
    broker = EventBroker()
    broker.bind_loop(asyncio.get_running_loop())
    queue = broker.open_queue()
    settings = Settings(data_dir=tmp_path, update_check_hours=1)

    m.configure(auto_update=False)
    task = asyncio.create_task(_periodic_check(m, broker, settings, first_delay=0.01))
    event = await asyncio.wait_for(queue.get(), 5)
    assert event["type"] == "ytdlp" and event["status"]["latest"] == "2026.11.01"
    assert m.current().source == "bundled"  # auto tắt: chỉ báo, không tự cài
    task.cancel()

    m.configure(auto_update=True)
    task = asyncio.create_task(_periodic_check(m, broker, settings, first_delay=0.01))
    event = await asyncio.wait_for(queue.get(), 5)
    assert event["status"]["version"] == "2026.11.01"
    task.cancel()


async def test_periodic_check_disabled_when_hours_zero(tmp_path):
    import asyncio

    from app.events import EventBroker
    from app.main import _periodic_check
    from app.services.ytdlp_manager import YtDlpManager

    m = YtDlpManager(tmp_path / "y")
    result = await asyncio.wait_for(
        _periodic_check(m, EventBroker(), Settings(data_dir=tmp_path, update_check_hours=0)), 1
    )
    assert result is None
