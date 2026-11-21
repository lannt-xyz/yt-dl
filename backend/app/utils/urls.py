from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YT_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
}
_SHORT_HOSTS = {"youtu.be", "www.youtu.be"}
_PATH_PREFIXES = ("shorts", "embed", "live", "v")


class InvalidUrlError(ValueError):
    """URL không phải link video YouTube hợp lệ."""


def extract_video_id(url: str) -> str:
    """Trả về video id (11 ký tự) từ URL YouTube; ném ``InvalidUrlError`` nếu không hợp lệ.

    Chỉ chấp nhận host YouTube đã biết nên các URL khác (kể cả địa chỉ nội bộ) bị từ chối.
    """
    text = (url or "").strip()
    if not text:
        raise InvalidUrlError("URL trống")
    if "://" not in text:
        text = "https://" + text
    try:
        parsed = urlparse(text)
    except ValueError as exc:
        raise InvalidUrlError("URL không hợp lệ") from exc
    if parsed.scheme not in ("http", "https"):
        raise InvalidUrlError("Chỉ hỗ trợ http/https")
    host = (parsed.hostname or "").lower()

    candidate: str | None = None
    if host in _SHORT_HOSTS:
        candidate = parsed.path.strip("/").split("/")[0]
    elif host in _YT_HOSTS:
        parts = [p for p in parsed.path.split("/") if p]
        if parts and parts[0] == "watch":
            candidate = (parse_qs(parsed.query).get("v") or [""])[0]
        elif len(parts) >= 2 and parts[0] in _PATH_PREFIXES:
            candidate = parts[1]
    else:
        raise InvalidUrlError("Chỉ hỗ trợ link YouTube")

    if not candidate or not _VIDEO_ID.match(candidate):
        raise InvalidUrlError("Không tìm thấy video trong URL (playlist/kênh không được hỗ trợ)")
    return candidate


def canonical_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def normalize_youtube_url(url: str) -> tuple[str, str]:
    """Trả về ``(video_id, canonical_url)``; tham số ``list=``/``t=`` bị bỏ."""
    video_id = extract_video_id(url)
    return video_id, canonical_url(video_id)
