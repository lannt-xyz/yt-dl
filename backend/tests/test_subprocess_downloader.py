import contextlib
import sys
import textwrap
import time

import pytest

from app.services.downloader import DownloadError, JobCancelledError, SubprocessDownloader
from app.services.ytdlp_manager import Runtime

FAKE_RUNNER = textwrap.dedent(
    """
    import json, pathlib, sys, time
    req = json.loads(sys.argv[1]); url = req["url"]
    def emit(**e): print(json.dumps(e), flush=True)
    print("dòng rác không phải JSON")
    if req["cmd"] == "info":
        if "fail403" in url:
            emit(type="error", message="HTTP Error 403: Forbidden"); sys.exit(1)
        if "noinfo" in url:
            sys.exit(0)
        emit(type="info", video_id="abc", title="Tựa", channel="Kênh",
             thumbnail=None, duration=12.5)
    elif req["cmd"] == "download":
        if "hang" in url:
            emit(type="progress", stage="downloading", percent=5); time.sleep(60)
        if "crash" in url:
            sys.stderr.write("boom boom"); sys.exit(3)
        if "nofile" in url:
            emit(type="done", path="x"); sys.exit(0)
        emit(type="progress", stage="downloading", percent=50)
        emit(type="progress", stage="converting", percent=100)
        pathlib.Path(req["out_base"] + ".mp3").write_bytes(b"x" * 10)
        emit(type="done", path=req["out_base"] + ".mp3")
    """
)


class StubManager:
    def __init__(self, runner):
        self.runner = runner
        self.active = 0

    def current(self):
        return Runtime("1.2.3", sys.executable, "bundled")

    @contextlib.contextmanager
    def use(self):
        self.active += 1
        try:
            yield self.current()
        finally:
            self.active -= 1


@pytest.fixture
def stub(tmp_path):
    runner = tmp_path / "fake_runner.py"
    runner.write_text(FAKE_RUNNER)
    return StubManager(runner)


@pytest.fixture
def dl(stub):
    return SubprocessDownloader(stub)


def test_version_comes_from_manager(dl):
    assert dl.version() == "1.2.3"


def test_fetch_info(dl):
    info = dl.fetch_info("https://x/ok")
    assert (info.video_id, info.title, info.channel, info.duration) == ("abc", "Tựa", "Kênh", 12.5)


def test_fetch_info_error_is_classified(dl):
    with pytest.raises(DownloadError) as exc:
        dl.fetch_info("https://x/fail403")
    assert exc.value.code == "needs_update"


def test_fetch_info_empty_output(dl):
    with pytest.raises(DownloadError):
        dl.fetch_info("https://x/noinfo")


def test_download_reports_progress_and_returns_file(dl, tmp_path):
    seen = []
    path = dl.download(
        "https://x/ok", tmp_path / "job1", 192, lambda *a: seen.append(a), lambda: False
    )
    assert path == tmp_path / "job1.mp3" and path.read_bytes() == b"x" * 10
    assert seen == [("downloading", 50.0), ("converting", 100.0)]


def test_download_nonzero_exit_uses_stderr(dl, tmp_path):
    with pytest.raises(DownloadError) as exc:
        dl.download("https://x/crash", tmp_path / "j", 192, lambda *a: None, lambda: False)
    assert "boom boom" in exc.value.message


def test_download_missing_output_file(dl, tmp_path):
    with pytest.raises(DownloadError) as exc:
        dl.download("https://x/nofile", tmp_path / "j", 192, lambda *a: None, lambda: False)
    assert exc.value.code == "ffmpeg"


def test_cancel_kills_process_quickly(dl, stub, tmp_path):
    started = time.monotonic()
    state = {"progress": False}

    def on_progress(stage, pct):
        state["progress"] = True

    with pytest.raises(JobCancelledError):
        dl.download("https://x/hang", tmp_path / "j", 192, on_progress, lambda: state["progress"])
    assert time.monotonic() - started < 10  # chứ không đợi 60s của tiến trình giả
    assert stub.active == 0


def test_timeout_kills_process(stub, tmp_path):
    dl = SubprocessDownloader(stub)
    dl.DOWNLOAD_TIMEOUT = 0.5
    started = time.monotonic()
    with pytest.raises(DownloadError) as exc:
        dl.download("https://x/hang", tmp_path / "j", 192, lambda *a: None, lambda: False)
    assert exc.value.code == "network" and time.monotonic() - started < 10


def test_runtime_is_held_during_job(stub, tmp_path):
    seen = []
    dl = SubprocessDownloader(stub)
    dl.download(
        "https://x/ok", tmp_path / "j", 192, lambda *a: seen.append(stub.active), lambda: False
    )
    assert seen and all(n == 1 for n in seen)
    assert stub.active == 0
