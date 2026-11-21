import io
import json
import os
import sys
import threading
from pathlib import Path

import pytest

from app.services import ytdlp_manager as ym
from app.services.ytdlp_manager import UpdateError, YtDlpManager, is_newer


class Fakes:
    def __init__(self):
        self.latest = "2026.11.01"
        self.installed: list[str] = []
        self.smoke_ok = True
        self.fail_install: Exception | None = None
        self.gate: threading.Event | None = None
        self.entered = threading.Event()

    def installer(self, version, venv_dir: Path, pre):
        self.entered.set()
        if self.gate:
            self.gate.wait(5)
        if self.fail_install:
            raise self.fail_install
        py = venv_dir / "bin" / "python"
        py.parent.mkdir(parents=True)
        py.write_text("#!/bin/sh\n")
        os.chmod(py, 0o755)
        self.installed.append(version)

    def smoker(self, python):
        return (True, "") if self.smoke_ok else (False, "extract lỗi")

    def fetcher(self, channel):
        return self.latest


@pytest.fixture
def fakes():
    return Fakes()


@pytest.fixture
def mgr(tmp_path, fakes):
    return YtDlpManager(
        tmp_path / "ytdlp",
        installer=fakes.installer,
        smoker=fakes.smoker,
        latest_fetcher=fakes.fetcher,
        bundled_python="/usr/bin/bundled-python",
        keep=3,
    )


def test_starts_on_bundled_runtime(mgr):
    cur = mgr.current()
    assert cur.source == "bundled" and cur.python == "/usr/bin/bundled-python"
    st = mgr.status()
    assert st["update_available"] is False and st["versions"] == [] and st["previous"] is None


def test_check_latest_marks_update_available(mgr, fakes):
    assert mgr.check_latest() == "2026.11.01"
    st = mgr.status()
    assert st["latest"] == "2026.11.01" and st["last_check"] is not None
    assert st["update_available"] is True  # bundled hiện tại cũ hơn


def test_update_installs_and_switches(mgr, fakes):
    assert mgr.update() == "2026.11.01"
    cur = mgr.current()
    assert cur.version == "2026.11.01" and cur.source == "venv"
    assert cur.python.endswith("2026.11.01/venv/bin/python")
    assert mgr.status()["update_available"] is False
    assert mgr.installed_versions() == ["2026.11.01"]


def test_update_to_same_version_is_noop(mgr, fakes):
    mgr.update("2026.11.01")
    mgr.update("2026.11.01")
    assert fakes.installed == ["2026.11.01"]


def test_failed_smoke_test_keeps_current_and_cleans_up(mgr, fakes):
    mgr.update("2026.10.01")
    fakes.smoke_ok = False
    with pytest.raises(UpdateError, match="không qua kiểm tra"):
        mgr.update("2026.11.01")
    assert mgr.current().version == "2026.10.01"
    assert mgr.installed_versions() == ["2026.10.01"]
    assert not (mgr.versions_dir / "2026.11.01").exists()


def test_installer_exception_is_wrapped_and_cleaned(mgr, fakes):
    fakes.fail_install = OSError("hết dung lượng")
    with pytest.raises(UpdateError, match="hết dung lượng"):
        mgr.update("2026.11.01")
    assert mgr.current().source == "bundled"
    assert not (mgr.versions_dir / "2026.11.01").exists()


def test_invalid_version_rejected(mgr):
    with pytest.raises(UpdateError, match="không hợp lệ"):
        mgr.update("abc!")


def test_partial_install_without_ready_marker_is_ignored(mgr):
    half = mgr.versions_dir / "2026.12.01" / "venv" / "bin"
    half.mkdir(parents=True)
    (half / "python").write_text("x")
    assert mgr.installed_versions() == []


def test_rollback_toggles_between_versions(mgr):
    mgr.update("2026.10.01")
    mgr.update("2026.11.01")
    assert mgr.status()["previous"] == "2026.10.01"
    assert mgr.rollback() == "2026.10.01"
    assert mgr.current().version == "2026.10.01"
    assert mgr.status()["previous"] == "2026.11.01"
    assert mgr.rollback() == "2026.11.01"


def test_rollback_without_previous_fails(mgr):
    with pytest.raises(UpdateError):
        mgr.rollback()
    mgr.update("2026.10.01")
    with pytest.raises(UpdateError):
        mgr.rollback()  # bản bundled không phải venv nên không quay lại được


def test_prune_keeps_newest_n(mgr):
    for v in ["2026.08.01", "2026.09.01", "2026.10.01", "2026.11.01", "2026.12.01"]:
        mgr.update(v)
    assert mgr.installed_versions() == ["2026.12.01", "2026.11.01", "2026.10.01"]


def test_prune_never_removes_version_in_use(mgr):
    mgr.update("2026.01.01")
    with mgr.use() as rt:
        assert rt.version == "2026.01.01"
        for v in ["2026.08.01", "2026.09.01", "2026.10.01", "2026.11.01"]:
            mgr.update(v)
        assert "2026.01.01" in mgr.installed_versions()  # job đang chạy vẫn còn dùng được
        assert Path(rt.python).exists()
    mgr.update("2026.12.01")
    assert "2026.01.01" not in mgr.installed_versions()  # hết dùng thì được dọn


def test_concurrent_update_is_rejected(mgr, fakes):
    fakes.gate = threading.Event()
    t = threading.Thread(target=mgr.update, args=("2026.11.01",))
    t.start()
    assert fakes.entered.wait(5)
    assert mgr.status()["updating"] is True
    with pytest.raises(UpdateError, match="đang chạy"):
        mgr.update("2026.12.01")
    fakes.gate.set()
    t.join(5)
    assert mgr.status()["updating"] is False and mgr.current().version == "2026.11.01"


def test_state_survives_restart(tmp_path, fakes):
    kwargs = dict(installer=fakes.installer, smoker=fakes.smoker, latest_fetcher=fakes.fetcher)
    a = YtDlpManager(tmp_path / "y", **kwargs)
    a.update("2026.10.01")
    a.update("2026.11.01")
    a.configure(channel="nightly", auto_update=True)
    b = YtDlpManager(tmp_path / "y", **kwargs)
    assert b.current().version == "2026.11.01"
    assert b.channel == "nightly" and b.auto_update is True
    assert b.status()["previous"] == "2026.10.01"


def test_corrupt_state_file_falls_back_to_defaults(tmp_path, fakes):
    root = tmp_path / "y"
    root.mkdir()
    (root / "state.json").write_text("{không phải json")
    m = YtDlpManager(root, installer=fakes.installer, smoker=fakes.smoker)
    assert m.current().source == "bundled"


def test_configure_validates_and_resets_latest(mgr):
    mgr.check_latest()
    with pytest.raises(ValueError):
        mgr.configure(channel="beta")
    mgr.configure(channel="nightly")
    assert mgr.channel == "nightly" and mgr.status()["latest"] is None


def test_update_if_newer(mgr, fakes):
    assert mgr.update_if_newer() is True  # bundled → 2026.11.01
    assert mgr.update_if_newer() is False  # đã là bản mới nhất
    fakes.latest = "2026.12.01"
    fakes.smoke_ok = False
    assert mgr.update_if_newer() is False  # bản mới hỏng → giữ nguyên
    assert mgr.current().version == "2026.11.01"


def test_check_latest_failure_is_recorded(tmp_path, fakes):
    def boom(channel):
        raise OSError("mất mạng")

    m = YtDlpManager(
        tmp_path / "y", installer=fakes.installer, smoker=fakes.smoker, latest_fetcher=boom
    )
    with pytest.raises(UpdateError):
        m.check_latest()
    assert "mất mạng" in m.status()["last_error"]


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        ("2026.11.01", "2026.10.26", True),
        ("2026.10.26", "2026.10.26", False),
        ("2026.10.25", "2026.10.26", False),
        ("2026.10.26.123456", "2026.10.26", True),
        ("2026.10.26.dev0", "2026.10.26", False),
        ("2027.01.01.dev1", "2026.12.31", True),
        ("garbage", "2026.10.26", True),
    ],
)
def test_is_newer(a, b, expected):
    assert is_newer(a, b) is expected


PYPI = {
    "info": {"version": "2026.11.01"},
    "releases": {
        "2026.10.26": [{"yanked": False}],
        "2026.11.01": [{"yanked": False}],
        "2026.11.05.dev0": [{"yanked": False}],
        "2026.11.09.dev0": [{"yanked": True}],
        "bad-version": [{"yanked": False}],
        "2026.12.01": [],
    },
}


def test_fetch_latest_pypi_stable_and_nightly(monkeypatch):
    monkeypatch.setattr(
        ym.urllib.request, "urlopen", lambda req, timeout: io.StringIO(json.dumps(PYPI))
    )
    assert ym.fetch_latest_pypi("stable") == "2026.11.01"
    assert ym.fetch_latest_pypi("nightly") == "2026.11.05.dev0"


def test_real_smoker_with_real_runner():
    smoke = ym.make_smoker(
        ym.YtDlpManager.__init__.__globals__["Path"](ym.__file__).with_name("ytdlp_runner.py"), None
    )
    ok, msg = smoke(sys.executable)
    assert ok, msg
    ok, _ = smoke("/nonexistent/python")
    assert ok is False


@pytest.mark.slow
def test_real_venv_install_of_pinned_version(tmp_path):
    """Cài thật yt-dlp vào venv riêng (cần mạng, ~30s). Chạy bằng: pytest -m slow"""
    m = YtDlpManager(tmp_path / "y", smoke_url=None)
    version = m.update("2025.01.26")
    assert version == "2025.01.26" and m.current().source == "venv"
    assert m.installed_versions() == ["2025.01.26"]


@pytest.mark.network
def test_real_fetch_and_download_through_subprocess(tmp_path):
    from app.services.downloader import SubprocessDownloader

    dl = SubprocessDownloader(YtDlpManager(tmp_path / "y"))
    info = dl.fetch_info("https://www.youtube.com/watch?v=jNQXAC9IVRw")
    assert info.video_id == "jNQXAC9IVRw" and info.duration
    seen = []
    path = dl.download(
        "https://www.youtube.com/watch?v=jNQXAC9IVRw", tmp_path / "out", 128,
        lambda stage, pct: seen.append(stage), lambda: False,
    )  # fmt: skip
    assert path.exists() and path.stat().st_size > 10_000
    assert "downloading" in seen and "converting" in seen
