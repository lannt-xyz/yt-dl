import pytest

from app.services.downloader import YtDlpDownloader, classify_error, to_download_error


@pytest.mark.parametrize(
    ("message", "code"),
    [
        ("ERROR: [youtube] abc: Sign in to confirm you're not a bot", "needs_update"),
        ("HTTP Error 403: Forbidden", "needs_update"),
        ("Unable to extract uploader id", "needs_update"),
        ("nsig extraction failed: Some formats may be missing", "needs_update"),
        ("Video unavailable. This video has been removed by the uploader", "unavailable"),
        ("Private video. Sign in if you've been granted access", "private"),
        ("Sign in to confirm your age. This video may be inappropriate", "age_restricted"),
        ("The uploader has not made this video available in your country", "geo_blocked"),
        ("Read timed out.", "network"),
        ("Temporary failure in name resolution", "network"),
        ("ffmpeg not found", "ffmpeg"),
        ("something weird", "unknown"),
        ("", "unknown"),
    ],
)
def test_classify_error(message, code):
    assert classify_error(message) == code


def test_to_download_error_has_hint_and_detail():
    err = to_download_error(RuntimeError("HTTP Error 403: Forbidden"))
    assert err.code == "needs_update"
    assert "yt-dlp" in err.message and "403" in err.message


def test_ytdlp_version_reports_installed():
    assert YtDlpDownloader().version().count(".") >= 2


def test_ytdlp_options_use_mp3_and_no_playlist(monkeypatch, tmp_path):
    captured = {}

    class FakeYDL:
        def __init__(self, opts):
            captured.update(opts)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def download(self, urls):
            (tmp_path / "x.mp3").write_bytes(b"data")

    import yt_dlp

    monkeypatch.setattr(yt_dlp, "YoutubeDL", FakeYDL)
    path = YtDlpDownloader().download(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ", tmp_path / "x", 256, lambda *_: None,
        lambda: False,
    )  # fmt: skip
    assert path == tmp_path / "x.mp3"
    assert captured["noplaylist"] is True
    assert captured["format"] == "bestaudio/best"
    assert captured["postprocessors"][0]["preferredcodec"] == "mp3"
    assert captured["postprocessors"][0]["preferredquality"] == "256"
    assert captured["outtmpl"] == f"{tmp_path / 'x'}.%(ext)s"


def test_ytdlp_download_maps_errors(monkeypatch, tmp_path):
    class BoomYDL:
        def __init__(self, opts):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def download(self, urls):
            raise RuntimeError("HTTP Error 403: Forbidden")

    import yt_dlp

    from app.services.downloader import DownloadError

    monkeypatch.setattr(yt_dlp, "YoutubeDL", BoomYDL)
    with pytest.raises(DownloadError) as exc:
        YtDlpDownloader().download("u", tmp_path / "x", 192, lambda *_: None, lambda: False)
    assert exc.value.code == "needs_update"


def test_ytdlp_cancel_hook_raises_job_cancelled(monkeypatch, tmp_path):
    class CancelYDL:
        def __init__(self, opts):
            self.opts = opts

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def download(self, urls):
            self.opts["progress_hooks"][0]({"status": "downloading", "downloaded_bytes": 1})

    import yt_dlp

    from app.services.downloader import JobCancelledError

    monkeypatch.setattr(yt_dlp, "YoutubeDL", CancelYDL)
    with pytest.raises(JobCancelledError):
        YtDlpDownloader().download("u", tmp_path / "x", 192, lambda *_: None, lambda: True)


@pytest.mark.network
def test_real_fetch_info():
    info = YtDlpDownloader().fetch_info("https://www.youtube.com/watch?v=jNQXAC9IVRw")
    assert info.video_id == "jNQXAC9IVRw"
    assert info.duration and info.duration > 0
