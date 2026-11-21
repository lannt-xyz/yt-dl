import pytest

from app.services.downloader import classify_error, to_download_error


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
