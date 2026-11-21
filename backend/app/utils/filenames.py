from __future__ import annotations

import re
import unicodedata

_ILLEGAL = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')
_SPACES = re.compile(r"\s+")


def safe_filename(name: str | None, ext: str = "mp3", *, max_len: int = 120) -> str:
    """Tên file an toàn để người dùng tải về (giữ Unicode, bỏ ký tự cấm)."""
    text = unicodedata.normalize("NFC", name or "")
    text = _ILLEGAL.sub(" ", text)
    text = _SPACES.sub(" ", text).strip(" .")
    if not text:
        text = "audio"
    text = text[:max_len].rstrip(" .")
    return f"{text}.{ext}" if ext else text
