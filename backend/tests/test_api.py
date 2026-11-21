import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.downloader import DownloadError
from tests.conftest import VIDEO_A, VIDEO_B, VIDEO_C, FakeDownloader, wait_for_status


def post(client, vid=VIDEO_A, **extra):
    return client.post("/api/jobs", json={"url": f"https://www.youtube.com/watch?v={vid}", **extra})


# ---- tạo job ----
def test_create_job_normalizes_url_and_runs_to_done(client):
    r = client.post("/api/jobs", json={"url": f"https://youtu.be/{VIDEO_A}?si=x&list=PLfoo"})
    assert r.status_code == 201
    job = r.json()
    assert job["url"] == f"https://www.youtube.com/watch?v={VIDEO_A}"
    assert job["video_id"] == VIDEO_A
    assert job["thumbnail"].endswith(f"{VIDEO_A}/mqdefault.jpg")

    done = wait_for_status(client, job["id"], "done")
    assert done["title"] == f"Video {VIDEO_A}"
    assert done["channel"] == "Kênh thử"
    assert done["has_file"] and done["file_size"] > 1000
    assert done["ytdlp_version"] == "9999.01.01"
    assert done["progress"] == 100 and done["seen"] is False
    assert done["audio_url"].endswith("/audio")


@pytest.mark.parametrize(
    "url", ["", "https://example.com/x", "https://www.youtube.com/playlist?list=PLx", "abc"]
)
def test_create_job_rejects_bad_url(client, url):
    r = client.post("/api/jobs", json={"url": url})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_url"


def test_validation_errors_use_uniform_shape(client):
    r = client.post("/api/jobs", json={})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "validation_error"
    assert "url" in r.json()["detail"]["message"]


def test_create_job_rejects_bad_bitrate(client):
    r = post(client, bitrate=999)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "invalid_bitrate"


def test_duplicate_detection(client, done_job):
    r = post(client, VIDEO_A)
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["code"] == "duplicate" and detail["job"]["id"] == done_job["id"]
    forced = post(client, VIDEO_A, force=True)
    assert forced.status_code == 201 and forced.json()["id"] != done_job["id"]


def test_already_queued_detection(client, fake):
    fake.release.clear()
    first = post(client, VIDEO_A).json()
    again = post(client, VIDEO_A)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "already_queued"
    assert again.json()["detail"]["job"]["id"] == first["id"]
    fake.release.set()
    wait_for_status(client, first["id"], "done")


# ---- hàng đợi ----
def test_jobs_run_sequentially_in_order(client, fake):
    fake.release.clear()
    ids = [post(client, v).json()["id"] for v in (VIDEO_A, VIDEO_B, VIDEO_C)]
    assert fake.started.wait(5)
    time.sleep(0.2)
    statuses = [client.get(f"/api/jobs/{i}").json()["status"] for i in ids]
    assert statuses[0] in ("downloading", "converting")
    assert statuses[1:] == ["queued", "queued"]  # concurrency = 1
    fake.release.set()
    for i in ids:
        wait_for_status(client, i, "done")
    finished = [client.get(f"/api/jobs/{i}").json()["finished_at"] for i in ids]
    assert finished == sorted(finished)


def test_failed_job_does_not_block_next(client, fake):
    fake.fail_with = DownloadError("needs_update", "HTTP 403")
    bad = post(client, VIDEO_A).json()["id"]
    wait_for_status(client, bad, "failed")
    fake.fail_with = None
    good = post(client, VIDEO_B).json()["id"]
    wait_for_status(client, good, "done")
    failed = client.get(f"/api/jobs/{bad}").json()
    assert failed["error_code"] == "needs_update" and failed["has_file"] is False


def test_retry_failed_job(client, fake):
    fake.fail_with = DownloadError("network", "timeout")
    job_id = post(client).json()["id"]
    wait_for_status(client, job_id, "failed")
    fake.fail_with = None
    r = client.post(f"/api/jobs/{job_id}/retry")
    assert r.status_code == 200
    done = wait_for_status(client, job_id, "done")
    assert done["error_code"] is None and done["error_message"] is None


def test_retry_rejects_non_failed(client, done_job):
    r = client.post(f"/api/jobs/{done_job['id']}/retry")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "not_retryable"


def test_cancel_queued_job(client, fake):
    fake.release.clear()
    running = post(client, VIDEO_A).json()["id"]
    assert fake.started.wait(5)
    queued = post(client, VIDEO_B).json()["id"]
    r = client.post(f"/api/jobs/{queued}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    fake.release.set()
    wait_for_status(client, running, "done")
    assert client.get(f"/api/jobs/{queued}").json()["status"] == "cancelled"


def test_cancel_running_job_cleans_up(client, fake, settings):
    fake.release.clear()
    job_id = post(client).json()["id"]
    assert fake.started.wait(5)
    assert client.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    wait_for_status(client, job_id, "cancelled")
    assert list(settings.audio_dir.glob(f"{job_id}.*")) == []
    # sau khi hủy có thể thử lại
    fake.release.set()
    assert client.post(f"/api/jobs/{job_id}/retry").status_code == 200
    wait_for_status(client, job_id, "done")


def test_cancel_finished_job_conflicts(client, done_job):
    r = client.post(f"/api/jobs/{done_job['id']}/cancel")
    assert r.status_code == 409


# ---- lịch sử ----
def test_history_list_filters_and_unseen(client, fake):
    ok = post(client, VIDEO_A).json()["id"]
    wait_for_status(client, ok, "done")
    fake.fail_with = DownloadError("unavailable", "gone")
    bad = post(client, VIDEO_B).json()["id"]
    wait_for_status(client, bad, "failed")

    everything = client.get("/api/jobs").json()
    assert everything["total"] == 2 and everything["unseen"] == 2
    assert everything["items"][0]["id"] == bad  # mới nhất trước

    assert client.get("/api/jobs?status=done").json()["total"] == 1
    assert client.get("/api/jobs?status=failed").json()["items"][0]["id"] == bad
    assert client.get("/api/jobs?q=video " + VIDEO_A[:4]).json()["total"] == 1
    assert client.get("/api/jobs?status=active").json()["total"] == 0
    assert client.get("/api/jobs?status=nope").status_code == 422
    assert client.get("/api/jobs?limit=0").status_code == 422

    assert client.post("/api/jobs/mark-seen").json()["unseen"] == 0
    assert client.get("/api/jobs").json()["unseen"] == 0


def test_get_job_404(client):
    r = client.get("/api/jobs/doesnotexist")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "not_found"


def test_delete_job_removes_file_but_not_while_running(client, fake, settings):
    fake.release.clear()
    job_id = post(client).json()["id"]
    assert fake.started.wait(5)
    r = client.delete(f"/api/jobs/{job_id}")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "running"
    fake.release.set()
    done = wait_for_status(client, job_id, "done")
    assert (settings.audio_dir / f"{done['id']}.mp3").exists()
    assert client.delete(f"/api/jobs/{job_id}").status_code == 204
    assert not (settings.audio_dir / f"{job_id}.mp3").exists()
    assert client.get(f"/api/jobs/{job_id}").status_code == 404


def test_delete_keeps_file_when_requested(client, done_job, settings):
    r = client.delete(f"/api/jobs/{done_job['id']}?delete_file=false")
    assert r.status_code == 204
    assert (settings.audio_dir / f"{done_job['id']}.mp3").exists()


# ---- file ----
def test_audio_stream_supports_range(client, done_job):
    full = client.get(done_job["audio_url"])
    assert full.status_code == 200 and full.headers["content-type"] == "audio/mpeg"
    part = client.get(done_job["audio_url"], headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100


def test_download_has_friendly_filename(client, done_job):
    r = client.get(done_job["download_url"])
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]
    from urllib.parse import unquote

    assert f"Video {VIDEO_A}.mp3" in unquote(r.headers["content-disposition"])


def test_audio_unavailable_before_done_and_after_file_removed(client, done_job, settings, fake):
    (settings.audio_dir / f"{done_job['id']}.mp3").unlink()
    r = client.get(done_job["audio_url"])
    assert r.status_code == 410 and r.json()["detail"]["code"] == "file_missing"

    fake.release.clear()
    pending = post(client, VIDEO_B).json()["id"]
    assert client.get(f"/api/jobs/{pending}/audio").status_code == 409
    fake.release.set()
    wait_for_status(client, pending, "done")


def test_peaks_endpoint_and_cache(client, done_job, settings):
    r = client.get(f"/api/jobs/{done_job['id']}/peaks")
    assert r.status_code == 200
    data = r.json()
    assert data["peaks_per_second"] == 20 and len(data["peaks"]) > 100
    assert (settings.audio_dir / f"{done_job['id']}.peaks.json").exists()
    assert client.get(f"/api/jobs/{done_job['id']}/peaks").json() == data


# ---- trim ----
def test_trim_creates_child_job(client, done_job):
    r = client.post(
        f"/api/jobs/{done_job['id']}/trim",
        json={"start": "0:01", "end": 4.0, "fade_in": 0.2, "fade_out": 0.2, "bitrate": 128},
    )
    assert r.status_code == 201, r.text
    child = r.json()
    assert child["kind"] == "trim" and child["parent_id"] == done_job["id"]
    assert child["status"] == "done" and child["seen"] is True
    assert child["duration"] == pytest.approx(3.0)
    assert child["trim_start"] == 1.0 and child["trim_end"] == 4.0
    assert child["title"].endswith("[0:01-0:04]") and child["bitrate"] == 128

    audio = client.get(child["audio_url"])
    assert audio.status_code == 200 and len(audio.content) > 500
    kids = client.get(f"/api/jobs/{done_job['id']}/children").json()
    assert [k["id"] for k in kids] == [child["id"]]
    assert client.get("/api/jobs?kind=trim").json()["total"] == 1
    assert client.get("/api/jobs?kind=download").json()["total"] == 1


def test_trim_custom_title(client, done_job):
    r = client.post(f"/api/jobs/{done_job['id']}/trim",
                    json={"start": 0, "end": 2, "title": "  Điệp khúc  "})  # fmt: skip
    assert r.json()["title"] == "Điệp khúc"


@pytest.mark.parametrize(
    "body",
    [
        {"start": 3, "end": 2},
        {"start": 2, "end": 2},
        {"start": -1, "end": 2},
        {"start": 0, "end": 99},
        {"start": "abc", "end": 2},
        {"start": 0, "end": 2, "fade_in": 1.5, "fade_out": 1.5},
        {"start": 0, "end": 2, "bitrate": 77},
    ],
)
def test_trim_validation_errors(client, done_job, body):
    r = client.post(f"/api/jobs/{done_job['id']}/trim", json=body)
    assert r.status_code == 422, r.text
    # lỗi không để lại job rác
    assert client.get("/api/jobs?kind=trim").json()["total"] == 0


def test_trim_requires_finished_download(client, fake):
    fake.release.clear()
    job_id = post(client).json()["id"]
    r = client.post(f"/api/jobs/{job_id}/trim", json={"start": 0, "end": 1})
    assert r.status_code == 409
    fake.release.set()
    wait_for_status(client, job_id, "done")


def test_deleting_parent_keeps_trim(client, done_job):
    child = client.post(f"/api/jobs/{done_job['id']}/trim", json={"start": 0, "end": 2}).json()
    client.delete(f"/api/jobs/{done_job['id']}")
    still = client.get(child["audio_url"])
    assert still.status_code == 200
    assert client.get(f"/api/jobs/{child['id']}").json()["parent_id"] is None


# ---- hệ thống ----
def test_health_and_system(client, done_job):
    assert client.get("/api/health").json() == {"status": "ok"}
    info = client.get("/api/system").json()
    assert info["ytdlp_version"] == "9999.01.01" and info["ffmpeg_available"] is True
    assert info["counts"]["done"] == 1 and info["audio_bytes"] > 0
    assert info["disk"]["free"] > 0


def test_restart_requeues_interrupted_jobs(settings):
    first = FakeDownloader()
    first.release.clear()
    with TestClient(create_app(settings, downloader=first)) as c1:
        job_id = post(c1).json()["id"]
        assert first.started.wait(5)
    # app tắt giữa chừng → khởi động lại với downloader mới
    second = FakeDownloader()
    with TestClient(create_app(settings, downloader=second)) as c2:
        done = wait_for_status(c2, job_id, "done")
        assert done["has_file"]


def test_concurrency_setting_runs_parallel(tmp_path):
    settings = Settings(data_dir=tmp_path / "d", concurrency=2)
    fake = FakeDownloader()
    fake.release.clear()
    with TestClient(create_app(settings, downloader=fake)) as c:
        ids = [post(c, v).json()["id"] for v in (VIDEO_A, VIDEO_B, VIDEO_C)]
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            running = [c.get(f"/api/jobs/{i}").json()["status"] for i in ids]
            if sum(s in ("downloading", "converting") for s in running) == 2:
                break
            time.sleep(0.05)
        assert sorted(running).count("queued") == 1
        fake.release.set()
        for i in ids:
            wait_for_status(c, i, "done")
