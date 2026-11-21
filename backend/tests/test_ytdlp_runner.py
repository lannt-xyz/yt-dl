import json

import pytest

from app.services import ytdlp_runner as runner


class FakeYDL:
    """Thay yt_dlp.YoutubeDL: ghi lại options, giả lập hook tiến trình."""

    opts: dict = {}
    info: dict | None = {
        "id": "abc",
        "title": "Tựa",
        "channel": "K",
        "thumbnail": "t",
        "duration": 12,
    }
    boom: Exception | None = None

    def __init__(self, opts):
        FakeYDL.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def extract_info(self, url, download=False):
        if FakeYDL.boom:
            raise FakeYDL.boom
        return FakeYDL.info

    def download(self, urls):
        if FakeYDL.boom:
            raise FakeYDL.boom
        hook = self.opts["progress_hooks"][0]
        hook({"status": "downloading", "downloaded_bytes": 50, "total_bytes": 100})
        hook({"status": "downloading", "downloaded_bytes": 10})  # không biết tổng → bỏ qua
        hook({"status": "finished"})
        pp = self.opts["postprocessor_hooks"][0]
        pp({"postprocessor": "ExtractAudio", "status": "started"})
        pp({"postprocessor": "ExtractAudio", "status": "finished"})
        pp({"postprocessor": "Other", "status": "started"})


@pytest.fixture(autouse=True)
def fake_ydl(monkeypatch):
    import yt_dlp

    FakeYDL.boom = None
    FakeYDL.info = {"id": "abc", "title": "Tựa", "channel": "K", "thumbnail": "t", "duration": 12}
    monkeypatch.setattr(yt_dlp, "YoutubeDL", FakeYDL)


def test_download_options_and_progress_events(tmp_path):
    events = []
    runner.run_download(
        {"url": "u", "out_base": str(tmp_path / "x"), "bitrate": 256}, events.append
    )
    opts = FakeYDL.opts
    assert opts["noplaylist"] is True and opts["format"] == "bestaudio/best"
    assert opts["postprocessors"][0]["preferredcodec"] == "mp3"
    assert opts["postprocessors"][0]["preferredquality"] == "256"
    assert opts["outtmpl"] == f"{tmp_path / 'x'}.%(ext)s"
    progress = [(e["stage"], e["percent"]) for e in events if e["type"] == "progress"]
    assert progress == [
        ("downloading", 50.0), ("downloading", 100.0), ("converting", 0.0), ("converting", 100.0),
    ]  # fmt: skip
    assert events[-1] == {"type": "done", "path": f"{tmp_path / 'x'}.mp3"}


def test_info_event_fields():
    events = []
    runner.run_info({"url": "u"}, events.append)
    assert events == [
        {"type": "info", "video_id": "abc", "title": "Tựa", "channel": "K",
         "thumbnail": "t", "duration": 12.0}
    ]  # fmt: skip


def test_info_without_result_raises():
    FakeYDL.info = None
    with pytest.raises(RuntimeError):
        runner.run_info({"url": "u"}, lambda e: None)


def test_main_outputs_only_json_lines_and_error_exit_code(capsys, tmp_path):
    code = runner.main(["r", json.dumps({"cmd": "info", "url": "u"})])
    assert code == 0
    lines = capsys.readouterr().out.splitlines()
    assert json.loads(lines[0])["type"] == "info"

    FakeYDL.boom = RuntimeError("HTTP Error 403: Forbidden")
    code = runner.main(
        ["r", json.dumps({"cmd": "download", "url": "u", "out_base": str(tmp_path)})]
    )
    assert code == 1
    assert json.loads(capsys.readouterr().out.splitlines()[-1]) == {
        "type": "error", "message": "HTTP Error 403: Forbidden"
    }  # fmt: skip


def test_main_rejects_unknown_command_and_bad_json(capsys):
    assert runner.main(["r", json.dumps({"cmd": "nope"})]) == 1
    assert runner.main(["r", "not json"]) == 1
    out = capsys.readouterr().out.splitlines()
    assert all(json.loads(line)["type"] == "error" for line in out)


def test_version_command(capsys):
    assert runner.main(["r", json.dumps({"cmd": "version"})]) == 0
    event = json.loads(capsys.readouterr().out)
    assert event["type"] == "version" and event["version"].count(".") >= 2


def test_node_runtime_enabled_when_no_deno(monkeypatch):
    monkeypatch.setattr(runner.shutil, "which", lambda n: "/usr/bin/node" if n == "node" else None)
    assert runner._base_opts(None)["js_runtimes"] == {"node": {}}
    monkeypatch.setattr(runner.shutil, "which", lambda n: "/usr/bin/deno" if n == "deno" else None)
    assert "js_runtimes" not in runner._base_opts("/opt/ffmpeg")
    assert runner._base_opts("/opt/ffmpeg")["ffmpeg_location"] == "/opt/ffmpeg"
