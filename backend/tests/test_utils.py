import pytest

from app.utils.filenames import safe_filename
from app.utils.timeparse import format_time, parse_time
from app.utils.urls import InvalidUrlError, extract_video_id, normalize_youtube_url

VID = "dQw4w9WgXcQ"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("90", 90), ("90.5", 90.5), ("1:30", 90), ("1:23.450", 83.45), ("01:02:03", 3723),
        ("1m30s", 90), ("1h2m3s", 3723), ("45s", 45), ("2m", 120), (" 0:05 ", 5), (7, 7.0),
    ],
)  # fmt: skip
def test_parse_time_valid(text, expected):
    assert parse_time(text) == pytest.approx(expected)


@pytest.mark.parametrize(
    "text", ["", "   ", "abc", "-5", "1:2:3:4", "1.5:30", "1:x", "m30", "nan", "inf", "1:-30"]
)
def test_parse_time_invalid(text):
    with pytest.raises(ValueError):
        parse_time(text)


def test_parse_time_rejects_negative_number():
    with pytest.raises(ValueError):
        parse_time(-1)


@pytest.mark.parametrize(
    ("seconds", "millis", "expected"),
    [(0, False, "0:00"), (65, False, "1:05"), (3723, False, "1:02:03"),
     (83.45, True, "1:23.450"), (-3, False, "0:00")],
)  # fmt: skip
def test_format_time(seconds, millis, expected):
    assert format_time(seconds, millis=millis) == expected


@pytest.mark.parametrize(
    "url",
    [
        f"https://www.youtube.com/watch?v={VID}",
        f"http://youtube.com/watch?v={VID}&t=30s&list=PLabc",
        f"https://m.youtube.com/watch?v={VID}",
        f"https://music.youtube.com/watch?v={VID}&si=xyz",
        f"https://youtu.be/{VID}?si=abc",
        f"youtu.be/{VID}",
        f"https://www.youtube.com/shorts/{VID}",
        f"https://www.youtube.com/live/{VID}?feature=share",
        f"https://www.youtube.com/embed/{VID}",
        f"  https://www.youtube.com/watch?v={VID}  ",
    ],
)
def test_extract_video_id_valid(url):
    assert extract_video_id(url) == VID


def test_normalize_drops_extra_params():
    vid, url = normalize_youtube_url(f"https://www.youtube.com/watch?v={VID}&list=PL1&t=9")
    assert vid == VID
    assert url == f"https://www.youtube.com/watch?v={VID}"


@pytest.mark.parametrize(
    "url",
    [
        "", "   ", "not a url", "https://example.com/watch?v=dQw4w9WgXcQ",
        "https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
        "http://127.0.0.1:8080/watch?v=dQw4w9WgXcQ", "file:///etc/passwd",
        "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/playlist?list=PLabc",
        "https://www.youtube.com/@channel", "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/watch", "https://youtu.be/",
    ],
)  # fmt: skip
def test_extract_video_id_invalid(url):
    with pytest.raises(InvalidUrlError):
        extract_video_id(url)


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Bài hát / Tên: hay?", "Bài hát Tên hay.mp3"),
        ('a<b>c|d"e', "a b c d e.mp3"),
        ("   ", "audio.mp3"),
        (None, "audio.mp3"),
        ("...", "audio.mp3"),
        ("x" * 300, "x" * 120 + ".mp3"),
        ("line\nbreak\ttab", "line break tab.mp3"),
    ],
)
def test_safe_filename(name, expected):
    assert safe_filename(name) == expected
