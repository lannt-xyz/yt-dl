from __future__ import annotations

import contextlib
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from packaging.version import InvalidVersion, Version

log = logging.getLogger("ytdlp")

PYPI_URL = "https://pypi.org/pypi/yt-dlp/json"
SMOKE_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"  # video 19 giây, ổn định
CHANNELS = ("stable", "nightly")
READY = "READY"


class UpdateError(Exception):
    """Cập nhật thất bại; version đang dùng vẫn được giữ nguyên."""


@dataclass(frozen=True)
class Runtime:
    version: str
    python: str
    source: str  # "venv" | "bundled"


# ---- các hàm thật (được thay bằng bản giả trong test) ----
Installer = Callable[[str, Path, bool], None]
Smoker = Callable[[str], tuple[bool, str]]
LatestFetcher = Callable[[str], str]


def _parse(version: str) -> Version | None:
    try:
        return Version(version)
    except InvalidVersion:
        return None


def is_newer(candidate: str, current: str) -> bool:
    a, b = _parse(candidate), _parse(current)
    if a is None or b is None:
        return candidate != current
    return a > b


def fetch_latest_pypi(channel: str, timeout: float = 15) -> str:
    req = urllib.request.Request(PYPI_URL, headers={"User-Agent": "yt-mp3-web"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (URL cố định)
        data = json.load(resp)
    if channel == "stable":
        return str(data["info"]["version"])
    best: tuple[Version, str] | None = None
    for ver, files in data["releases"].items():
        parsed = _parse(ver)
        if parsed is None or not files or all(f.get("yanked") for f in files):
            continue
        if best is None or parsed > best[0]:
            best = (parsed, ver)
    if best is None:
        raise UpdateError("Không tìm thấy version nào trên PyPI")
    return best[1]


def pip_installer(version: str, venv_dir: Path, pre: bool) -> None:
    subprocess.run(
        [sys.executable, "-m", "venv", str(venv_dir)], check=True, capture_output=True, timeout=180
    )
    pip = [str(_venv_python(venv_dir)), "-m", "pip", "install", "--no-input",
           "--disable-pip-version-check", "--quiet"]  # fmt: skip
    if pre:
        pip.append("--pre")
    proc = subprocess.run(
        [*pip, f"yt-dlp[default]=={version}"], capture_output=True, text=True, timeout=600
    )
    if proc.returncode != 0:
        raise UpdateError(f"pip install thất bại: {proc.stderr.strip()[-300:]}")


def make_smoker(runner: Path, smoke_url: str | None = SMOKE_URL) -> Smoker:
    def smoke(python: str) -> tuple[bool, str]:
        def call(req: dict[str, Any], timeout: int) -> tuple[bool, str]:
            try:
                proc = subprocess.run(
                    [python, str(runner), json.dumps(req)],
                    capture_output=True, text=True, timeout=timeout,
                )  # fmt: skip
            except (OSError, subprocess.TimeoutExpired) as exc:
                return False, str(exc)
            for line in reversed(proc.stdout.splitlines()):
                with contextlib.suppress(ValueError):
                    event = json.loads(line)
                    if event.get("type") == "error":
                        return False, str(event.get("message"))
                    return proc.returncode == 0, ""
            return False, proc.stderr.strip()[-200:] or "không có phản hồi"

        ok, msg = call({"cmd": "version"}, 60)
        if not ok or not smoke_url:
            return ok, msg
        return call({"cmd": "info", "url": smoke_url}, 90)

    return smoke


def _venv_python(venv_dir: Path) -> Path:
    return venv_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def _bundled_version() -> str:
    try:
        from yt_dlp.version import __version__

        return str(__version__)
    except Exception:  # yt-dlp chưa cài trong môi trường chính
        return "unknown"


class YtDlpManager:
    """Quản lý nhiều version yt-dlp, mỗi version một venv riêng.

    - ``current``: version đang dùng (hoặc bản cài sẵn "bundled" nếu chưa cập nhật lần nào).
    - Cập nhật = tạo venv mới → smoke test → qua mới đổi con trỏ; lỗi thì dọn dẹp, giữ bản cũ.
    - ``rollback`` quay về version dùng trước đó. Giữ tối đa ``keep`` version.
    """

    def __init__(
        self,
        root: Path,
        *,
        installer: Installer = pip_installer,
        smoker: Smoker | None = None,
        latest_fetcher: LatestFetcher = fetch_latest_pypi,
        runner: Path | None = None,
        smoke_url: str | None = SMOKE_URL,
        bundled_python: str | None = None,
        keep: int = 3,
        clock: Callable[[], float] = time.time,
    ):
        self.root = root
        self.versions_dir = root / "versions"
        self.state_path = root / "state.json"
        self.runner = runner or Path(__file__).with_name("ytdlp_runner.py")
        self._installer = installer
        self._smoker = smoker or make_smoker(self.runner, smoke_url)
        self._latest_fetcher = latest_fetcher
        self._bundled_python = bundled_python or sys.executable
        self.keep = max(2, keep)
        self._clock = clock
        self._lock = threading.RLock()
        self._update_lock = threading.Lock()
        self._in_use: dict[str, int] = {}
        self.root.mkdir(parents=True, exist_ok=True)
        self.versions_dir.mkdir(exist_ok=True)
        self._state = self._load()

    # ---- trạng thái ----
    def _load(self) -> dict[str, Any]:
        default: dict[str, Any] = {
            "current": None, "history": [], "channel": "stable", "auto_update": False,
            "latest": None, "last_check": None, "last_error": None,
        }  # fmt: skip
        try:
            data = json.loads(self.state_path.read_text())
            return {**default, **data}
        except (OSError, ValueError):
            return default

    def _save(self) -> None:
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._state, indent=2))
        os.replace(tmp, self.state_path)

    def _venv_dir(self, version: str) -> Path:
        return self.versions_dir / version / "venv"

    def _is_ready(self, version: str) -> bool:
        return (self.versions_dir / version / READY).exists() and _venv_python(
            self._venv_dir(version)
        ).exists()

    def installed_versions(self) -> list[str]:
        found = [
            p.name for p in self.versions_dir.iterdir()
            if (p / READY).exists() and _venv_python(p / "venv").exists()
        ]  # fmt: skip
        return sorted(found, key=lambda v: _parse(v) or Version("0"), reverse=True)

    # ---- runtime hiện tại ----
    def current(self) -> Runtime:
        with self._lock:
            cur = self._state["current"]
            if cur and self._is_ready(cur):
                return Runtime(cur, str(_venv_python(self._venv_dir(cur))), "venv")
            return Runtime(_bundled_version(), self._bundled_python, "bundled")

    @contextlib.contextmanager
    def use(self) -> Iterator[Runtime]:
        """Giữ version hiện tại không bị dọn trong lúc một job đang chạy."""
        with self._lock:
            runtime = self.current()
            self._in_use[runtime.version] = self._in_use.get(runtime.version, 0) + 1
        try:
            yield runtime
        finally:
            with self._lock:
                self._in_use[runtime.version] -= 1
                if self._in_use[runtime.version] <= 0:
                    del self._in_use[runtime.version]

    # ---- cài đặt ----
    @property
    def channel(self) -> str:
        return str(self._state["channel"])

    @property
    def auto_update(self) -> bool:
        return bool(self._state["auto_update"])

    def configure(self, *, channel: str | None = None, auto_update: bool | None = None) -> None:
        with self._lock:
            if channel is not None:
                if channel not in CHANNELS:
                    raise ValueError(f"Kênh không hợp lệ: {channel}")
                if channel != self._state["channel"]:
                    self._state["latest"] = None
                self._state["channel"] = channel
            if auto_update is not None:
                self._state["auto_update"] = bool(auto_update)
            self._save()

    def status(self) -> dict[str, Any]:
        with self._lock:
            runtime = self.current()
            latest = self._state["latest"]
            return {
                "version": runtime.version,
                "source": runtime.source,
                "channel": self._state["channel"],
                "auto_update": self._state["auto_update"],
                "latest": latest,
                "update_available": bool(latest and is_newer(latest, runtime.version)),
                "last_check": self._state["last_check"],
                "last_error": self._state["last_error"],
                "versions": self.installed_versions(),
                "previous": self._previous(),
                "updating": self._update_lock.locked(),
            }

    def _previous(self) -> str | None:
        cur = self.current().version
        for v in reversed(self._state["history"]):
            if v != cur and self._is_ready(v):
                return str(v)
        return None

    # ---- kiểm tra / cập nhật ----
    def check_latest(self) -> str:
        channel = self.channel
        try:
            latest = self._latest_fetcher(channel)
        except Exception as exc:
            with self._lock:
                self._state["last_error"] = f"Không kiểm tra được bản mới: {exc}"
                self._save()
            raise UpdateError(str(exc)) from exc
        with self._lock:
            self._state["latest"] = latest
            self._state["last_check"] = self._clock()
            self._state["last_error"] = None
            self._save()
        return latest

    def update(self, version: str | None = None) -> str:
        """Cài ``version`` (mặc định bản mới nhất của kênh) và chuyển sang dùng nó.

        Trả về version đang dùng sau khi cập nhật. Ném ``UpdateError`` nếu thất bại
        (khi đó version đang dùng không đổi).
        """
        if not self._update_lock.acquire(blocking=False):
            raise UpdateError("Đang có một lần cập nhật khác đang chạy")
        try:
            target = version or self.check_latest()
            if _parse(target) is None:
                raise UpdateError(f"Version không hợp lệ: {target}")
            current = self.current().version
            if target == current:
                return current
            venv_dir = self._venv_dir(target)
            if not self._is_ready(target):
                self._install(target, venv_dir)
            self._activate(target)
            self._prune()
            return target
        finally:
            self._update_lock.release()

    def update_if_newer(self) -> bool:
        """Dùng cho tự phục hồi khi tải lỗi: True nếu đã chuyển sang bản mới hơn."""
        before = self.current().version
        try:
            after = self.update()
        except UpdateError as exc:
            log.warning("Tự cập nhật yt-dlp thất bại: %s", exc)
            return False
        return after != before and is_newer(after, before)

    def _install(self, version: str, venv_dir: Path) -> None:
        parsed = _parse(version)
        pre = bool(parsed and parsed.is_prerelease)
        version_dir = venv_dir.parent
        shutil.rmtree(version_dir, ignore_errors=True)  # dọn bản cài dở từ lần trước
        version_dir.mkdir(parents=True)
        try:
            self._installer(version, venv_dir, pre)
            ok, msg = self._smoker(str(_venv_python(venv_dir)))
            if not ok:
                raise UpdateError(f"Bản {version} không qua kiểm tra: {msg}")
            (version_dir / READY).write_text(version)  # chỉ đánh dấu khi đã qua smoke test
        except UpdateError:
            shutil.rmtree(version_dir, ignore_errors=True)
            raise
        except Exception as exc:
            shutil.rmtree(version_dir, ignore_errors=True)
            raise UpdateError(f"Cài {version} thất bại: {exc}") from exc

    def _activate(self, version: str) -> None:
        with self._lock:
            history = [v for v in self._state["history"] if v != version]
            cur = self._state["current"]
            if cur and cur != version:
                history = [v for v in history if v != cur] + [cur]
            self._state["history"] = history[-10:]
            self._state["current"] = version
            self._save()

    def rollback(self) -> str:
        with self._lock:
            prev = self._previous()
            if prev is None:
                raise UpdateError("Không có version trước đó để quay lại")
            cur = self.current().version
            history = [v for v in self._state["history"] if v not in (prev, cur)]
            if self._state["current"]:
                history.append(self._state["current"])
            self._state["history"] = history[-10:] + [prev]
            self._state["current"] = prev
            self._save()
            return prev

    def _prune(self) -> None:
        with self._lock:
            keep_always = {self._state["current"], *self._in_use, self._previous()}
            installed = self.installed_versions()  # mới → cũ
            kept = 0
            for v in installed:
                if v in keep_always or kept < self.keep:
                    kept += 1
                    continue
                shutil.rmtree(self.versions_dir / v, ignore_errors=True)
