from __future__ import annotations

import math
import re

_UNITS = re.compile(r"^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$")


def parse_time(value: str | int | float) -> float:
    """Chuyển chuỗi thời gian sang số giây.

    Chấp nhận: ``90``, ``90.5``, ``1:30``, ``1:23.450``, ``01:02:03``, ``1m30s``, ``1h2m3s``.
    Ném ``ValueError`` nếu không hợp lệ hoặc âm.
    """
    if isinstance(value, (int, float)):
        seconds = float(value)
    else:
        text = str(value).strip().lower()
        if not text:
            raise ValueError("Thời gian trống")
        seconds = _parse_text(text)
    if math.isnan(seconds) or math.isinf(seconds) or seconds < 0:
        raise ValueError(f"Thời gian không hợp lệ: {value!r}")
    return seconds


def _parse_text(text: str) -> float:
    if ":" in text:
        parts = text.split(":")
        if len(parts) > 3:
            raise ValueError(f"Thời gian không hợp lệ: {text!r}")
        try:
            numbers = [float(p) for p in parts]
        except ValueError as exc:
            raise ValueError(f"Thời gian không hợp lệ: {text!r}") from exc
        if any(n < 0 for n in numbers):
            raise ValueError(f"Thời gian không hợp lệ: {text!r}")
        if any(not float(n).is_integer() for n in numbers[:-1]):
            raise ValueError(f"Chỉ giây mới được có phần thập phân: {text!r}")
        total = 0.0
        for n in numbers:
            total = total * 60 + n
        return total
    try:
        return float(text)
    except ValueError:
        pass
    match = _UNITS.match(text)
    if not match or not any(match.groups()):
        raise ValueError(f"Thời gian không hợp lệ: {text!r}")
    hours, minutes, secs = match.groups()
    return int(hours or 0) * 3600 + int(minutes or 0) * 60 + float(secs or 0)


def format_time(seconds: float, *, millis: bool = False) -> str:
    """Định dạng ``h:mm:ss`` (hoặc ``m:ss``), tùy chọn thêm phần ``.mmm``."""
    seconds = max(0.0, float(seconds))
    total_ms = round(seconds * 1000)
    whole, ms = divmod(total_ms, 1000)
    hours, rem = divmod(whole, 3600)
    minutes, secs = divmod(rem, 60)
    base = f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"
    return f"{base}.{ms:03d}" if millis else base
