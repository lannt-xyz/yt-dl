import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.testing import FAKE_LATEST, NEEDS_UPDATE_ID, PRIVATE_ID, SLOW_ID
from tests.conftest import wait_for_status


@pytest.fixture
def fake_client(tmp_path):
    settings = Settings(data_dir=tmp_path / "d", update_check_hours=0, fake_downloader=True)
    with TestClient(create_app(settings)) as c:
        yield c


def add(c, vid):
    return c.post("/api/jobs", json={"url": f"https://www.youtube.com/watch?v={vid}"}).json()["id"]


def test_normal_video_downloads_30s_mp3(fake_client):
    done = wait_for_status(fake_client, add(fake_client, "dQw4w9WgXcQ"), "done")
    assert done["title"] == "Video thử dQw4w9WgXcQ" and done["duration"] == 30
    assert fake_client.get(done["audio_url"]).content[:3] == b"ID3" or done["file_size"] > 1000


def test_private_video_fails(fake_client):
    failed = wait_for_status(fake_client, add(fake_client, PRIVATE_ID), "failed")
    assert failed["error_code"] == "private"


def test_needs_update_fixed_by_real_update_flow(fake_client):
    job = add(fake_client, NEEDS_UPDATE_ID)
    assert wait_for_status(fake_client, job, "failed")["error_code"] == "needs_update"
    st = fake_client.post("/api/ytdlp/check").json()
    assert st["latest"] == FAKE_LATEST and st["update_available"] is True
    fake_client.post("/api/ytdlp/update", json={})
    deadline = time.monotonic() + 10
    while (
        time.monotonic() < deadline
        and fake_client.get("/api/ytdlp").json()["version"] != FAKE_LATEST
    ):
        time.sleep(0.05)
    assert fake_client.get("/api/ytdlp").json()["version"] == FAKE_LATEST
    fake_client.post(f"/api/jobs/{job}/retry")
    done = wait_for_status(fake_client, job, "done")
    assert done["ytdlp_version"] == FAKE_LATEST


def test_slow_video_can_be_cancelled(fake_client):
    job = add(fake_client, SLOW_ID)
    time.sleep(0.4)
    fake_client.post(f"/api/jobs/{job}/cancel")
    wait_for_status(fake_client, job, "cancelled")


def test_reset_endpoint_only_in_fake_mode(fake_client, client):
    add(fake_client, "dQw4w9WgXcQ")
    assert fake_client.post("/api/_test/reset").json() == {"ok": True}
    assert fake_client.get("/api/jobs").json()["total"] == 0
    assert client.post("/api/_test/reset").status_code in (404, 405)  # app thường không có


def test_reset_restores_bundled_ytdlp(fake_client):
    fake_client.post("/api/ytdlp/update", json={})
    deadline = time.monotonic() + 10
    while (
        time.monotonic() < deadline
        and fake_client.get("/api/ytdlp").json()["version"] != FAKE_LATEST
    ):
        time.sleep(0.05)
    fake_client.post("/api/_test/reset")
    st = fake_client.get("/api/ytdlp").json()
    assert st["source"] == "bundled" and st["version"] != FAKE_LATEST


def test_any_slow_prefixed_id_is_slow(fake_client):
    ids = [add(fake_client, v) for v in ("slowAAAAAAA", "slowBBBBBBB")]
    time.sleep(0.5)
    statuses = sorted(fake_client.get(f"/api/jobs/{i}").json()["status"] for i in ids)
    assert statuses == ["downloading", "queued"]  # chạy tuần tự
    for i in ids:
        fake_client.post(f"/api/jobs/{i}/cancel")
