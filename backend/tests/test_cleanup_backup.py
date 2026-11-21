import os
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Database
from app.main import _maintenance, create_app
from app.repository import JobRepo
from app.services.backup import backup_database, latest_backup_age, list_backups
from app.services.cleanup import ORPHAN_MIN_AGE, run_cleanup
from tests.conftest import FakeDownloader, wait_for_status

DAY = 86400
NOW = 1_800_000_000.0


@pytest.fixture
def env(tmp_path):
    settings = Settings(data_dir=tmp_path / "d", retention_days=30)
    settings.ensure_dirs()
    db = Database(settings.db_path)
    yield settings, JobRepo(db)
    db.close()


def add_done(settings, repo, name, age_days, size=1000, now=NOW):
    job = repo.create(url="u", video_id="v", title=name)
    fname = f"{job['id']}.mp3"
    path = settings.audio_dir / fname
    path.write_bytes(b"x" * size)
    path.with_suffix(".peaks.json").write_text("{}")
    finished = now - age_days * DAY
    repo.update(job["id"], status="done", file_name=fname, file_size=size, finished_at=finished)
    return repo.get(job["id"]), path


def test_removes_files_older_than_retention_but_keeps_history(env):
    settings, repo = env
    old, old_path = add_done(settings, repo, "cũ", age_days=45)
    new, new_path = add_done(settings, repo, "mới", age_days=5)
    result = run_cleanup(settings, repo, now=NOW)
    assert result.removed_files == 1 and result.freed_bytes == 1000
    assert not old_path.exists() and not old_path.with_suffix(".peaks.json").exists()
    assert new_path.exists()
    row = repo.get(old["id"])
    assert row["status"] == "done" and row["file_name"] is None and row["file_size"] is None
    assert repo.get(new["id"])["file_name"] is not None
    assert result.job_ids == [old["id"]]


def test_retention_zero_keeps_everything(env):
    settings, repo = env
    _, path = add_done(settings, repo, "rất cũ", age_days=999)
    assert run_cleanup(settings, repo, now=NOW, retention_days=0).removed_files == 0
    assert path.exists()


def test_storage_cap_removes_oldest_first(env):
    settings, repo = env
    a, pa = add_done(settings, repo, "a", age_days=3, size=400)
    b, pb = add_done(settings, repo, "b", age_days=2, size=400)
    c, pc = add_done(settings, repo, "c", age_days=1, size=400)
    result = run_cleanup(settings, repo, now=NOW, max_bytes=900)  # 1200 > 900 → bỏ file cũ nhất
    assert result.removed_files == 1 and not pa.exists() and pb.exists() and pc.exists()
    result = run_cleanup(settings, repo, now=NOW, max_bytes=500)  # còn 800 > 500 → bỏ tiếp b
    assert not pb.exists() and pc.exists()
    assert run_cleanup(settings, repo, now=NOW, max_bytes=500).removed_files == 0  # đã đủ


def test_cap_from_settings_gb(tmp_path):
    settings = Settings(data_dir=tmp_path / "d", retention_days=0, max_storage_gb=0.000001)
    settings.ensure_dirs()
    db = Database(settings.db_path)
    repo = JobRepo(db)
    _, p = add_done(settings, repo, "x", age_days=1, size=5000)
    run_cleanup(settings, repo, now=NOW)
    assert not p.exists()
    db.close()


def test_never_touches_active_or_failed_jobs(env):
    settings, repo = env
    running = repo.create(url="u", video_id="v")
    repo.update(running["id"], status="downloading")
    part = settings.audio_dir / f"{running['id']}.webm.part"
    part.write_bytes(b"x")
    old = NOW - 10 * DAY
    os.utime(part, (old, old))  # rất cũ nhưng thuộc job đang chạy
    failed = repo.create(url="u", video_id="v")
    repo.update(failed["id"], status="failed", finished_at=NOW - 100 * DAY)
    run_cleanup(settings, repo, now=NOW)
    assert part.exists()
    assert repo.get(failed["id"])["status"] == "failed"


def test_orphan_files_removed_only_when_old_enough(env):
    settings, repo = env
    old_orphan = settings.audio_dir / "zzzz.mp3"
    fresh_orphan = settings.audio_dir / "yyyy.mp3"
    stray_part = settings.audio_dir / "xxxx.mp3.part"
    for p in (old_orphan, fresh_orphan, stray_part):
        p.write_bytes(b"12345")
    past = NOW - ORPHAN_MIN_AGE - 10
    for p in (old_orphan, stray_part):
        os.utime(p, (past, past))
    os.utime(fresh_orphan, (NOW - 60, NOW - 60))
    result = run_cleanup(settings, repo, now=NOW)
    assert result.orphan_files == 2
    assert not old_orphan.exists() and not stray_part.exists() and fresh_orphan.exists()


def test_referenced_files_and_peaks_are_never_orphans(env):
    settings, repo = env
    _, path = add_done(settings, repo, "giữ", age_days=1)
    past = NOW - 10 * DAY
    for p in (path, path.with_suffix(".peaks.json")):
        os.utime(p, (past, past))
    assert run_cleanup(settings, repo, now=NOW).orphan_files == 0
    assert path.exists() and path.with_suffix(".peaks.json").exists()


def test_cleanup_tolerates_already_missing_file(env):
    settings, repo = env
    job, path = add_done(settings, repo, "mất", age_days=60)
    path.unlink()
    result = run_cleanup(settings, repo, now=NOW)
    assert result.removed_files == 1 and repo.get(job["id"])["file_name"] is None


# ---- API ----
def test_cleanup_endpoint_and_redownload_after_cleanup(tmp_path):
    settings = Settings(data_dir=tmp_path / "d", update_check_hours=0, retention_days=1)
    with TestClient(create_app(settings, downloader=FakeDownloader())) as c:
        job = c.post("/api/jobs", json={"url": "https://youtu.be/dQw4w9WgXcQ"}).json()
        done = wait_for_status(c, job["id"], "done")
        repo = c.app.state.repo
        repo.update(job["id"], finished_at=time.time() - 5 * DAY)

        r = c.post("/api/system/cleanup")
        assert r.status_code == 200 and r.json()["removed_files"] == 1
        gone = c.get(f"/api/jobs/{job['id']}").json()
        assert gone["status"] == "done" and gone["has_file"] is False and gone["audio_url"] is None
        assert c.get(done["audio_url"]).status_code == 409
        assert c.post(f"/api/jobs/{job['id']}/trim", json={"start": 0, "end": 1}).status_code == 409

        # file đã dọn → cho phép tải lại ngay trên cùng dòng lịch sử
        assert c.post(f"/api/jobs/{job['id']}/retry").status_code == 200
        again = wait_for_status(c, job["id"], "done")
        assert again["has_file"] is True


def test_retry_still_rejected_for_healthy_done_job(client, done_job):
    assert client.post(f"/api/jobs/{done_job['id']}/retry").status_code == 409


def test_system_reports_storage_and_backups(client):
    info = client.get("/api/system").json()
    assert info["storage"]["retention_days"] == 30 and info["backups"]["count"] == 0
    assert info["auth_enabled"] is False


# ---- backup ----
def make_db(path: Path):
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE t (n INTEGER)")
    conn.executemany("INSERT INTO t VALUES (?)", [(i,) for i in range(100)])
    conn.commit()
    conn.close()


def test_backup_is_valid_and_complete(tmp_path):
    src = tmp_path / "app.db"
    make_db(src)
    dest = backup_database(src, tmp_path / "bk", keep=3, now=NOW)
    assert dest.name.startswith("app-") and dest.suffix == ".db"
    conn = sqlite3.connect(dest)
    assert conn.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 100
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    conn.close()
    assert not list((tmp_path / "bk").glob("*.part"))


def test_backup_works_while_db_is_open_for_writing(tmp_path):
    src = tmp_path / "app.db"
    db = Database(src)
    db.execute(
        "INSERT INTO jobs (id, url, status, created_at) VALUES ('a','u','done',1)"
    )  # kết nối của app vẫn mở
    dest = backup_database(src, tmp_path / "bk", now=NOW)
    conn = sqlite3.connect(dest)
    assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 1
    conn.close()
    db.close()


def test_backup_keeps_only_newest_n(tmp_path):
    src = tmp_path / "app.db"
    make_db(src)
    for i in range(6):
        backup_database(src, tmp_path / "bk", keep=3, now=NOW + i * 10)
    names = [p.name for p in list_backups(tmp_path / "bk")]
    assert len(names) == 3 and names == sorted(names, reverse=True)


def test_latest_backup_age(tmp_path):
    assert latest_backup_age(tmp_path / "none") is None
    src = tmp_path / "app.db"
    make_db(src)
    dest = backup_database(src, tmp_path / "bk")
    os.utime(dest, (NOW, NOW))
    assert latest_backup_age(tmp_path / "bk", now=NOW + 120) == 120


def test_backup_script_cli(tmp_path):
    import subprocess
    import sys

    data = tmp_path / "data"
    data.mkdir()
    make_db(data / "app.db")
    script = Path(__file__).resolve().parent.parent / "scripts" / "backup_db.py"
    ok = subprocess.run([sys.executable, str(script), str(data)], capture_output=True, text=True)
    assert ok.returncode == 0 and "Đã sao lưu" in ok.stdout
    assert len(list_backups(data / "backups")) == 1
    missing = subprocess.run(
        [sys.executable, str(script), str(tmp_path / "trống")], capture_output=True, text=True
    )
    assert missing.returncode == 1


# ---- vòng lặp bảo trì ----
async def test_maintenance_runs_cleanup_and_backup(tmp_path):
    import asyncio

    from app.events import EventBroker

    settings = Settings(
        data_dir=tmp_path / "d", retention_days=1, cleanup_interval_min=0, backup_interval_hours=24
    )
    settings.ensure_dirs()
    db = Database(settings.db_path)
    repo = JobRepo(db)
    job, path = add_done(settings, repo, "cũ", age_days=10, now=time.time())
    broker = EventBroker()
    broker.bind_loop(asyncio.get_running_loop())
    queue = broker.open_queue()

    await asyncio.wait_for(_maintenance(repo, broker, settings, first_delay=0), 10)

    assert not path.exists()
    event = queue.get_nowait()
    assert (
        event["type"] == "job" and event["job"]["id"] == job["id"] and not event["job"]["has_file"]
    )
    assert len(list_backups(settings.backup_dir)) == 1
    db.close()


async def test_maintenance_skips_backup_when_recent(tmp_path):
    import asyncio

    from app.events import EventBroker

    settings = Settings(data_dir=tmp_path / "d", cleanup_interval_min=0, backup_interval_hours=24)
    settings.ensure_dirs()
    db = Database(settings.db_path)
    repo = JobRepo(db)
    backup_database(settings.db_path, settings.backup_dir, now=time.time())
    await asyncio.wait_for(_maintenance(repo, EventBroker(), settings, first_delay=0), 10)
    assert len(list_backups(settings.backup_dir)) == 1
    db.close()
