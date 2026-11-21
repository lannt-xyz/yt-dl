from __future__ import annotations

import os
import subprocess
from array import array
from pathlib import Path

MIN_TRIM_LENGTH = 0.1  # giây
RANGE_TOLERANCE = 0.05  # cho phép vượt nhẹ độ dài do làm tròn


class AudioError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def probe_duration(path: Path, ffprobe: str = "ffprobe") -> float:
    try:
        proc = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=60, check=False,
        )  # fmt: skip
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise AudioError("ffmpeg", f"Không chạy được ffprobe: {exc}") from exc
    try:
        return float(proc.stdout.strip())
    except ValueError as exc:
        detail = proc.stderr.strip()[:200]
        raise AudioError("ffmpeg", f"ffprobe không đọc được file: {detail}") from exc


def validate_range(start: float, end: float, duration: float | None) -> None:
    if start < 0:
        raise AudioError("invalid_range", "Điểm bắt đầu không được âm")
    if end - start < MIN_TRIM_LENGTH:
        raise AudioError("invalid_range", "Điểm kết thúc phải sau điểm bắt đầu ít nhất 0.1 giây")
    if duration is not None and end > duration + RANGE_TOLERANCE:
        raise AudioError("invalid_range", f"Điểm kết thúc vượt quá độ dài file ({duration:.2f}s)")


def trim_audio(
    src: Path,
    dst: Path,
    start: float,
    end: float,
    *,
    bitrate: int = 192,
    fade_in: float = 0.0,
    fade_out: float = 0.0,
    metadata: dict[str, str] | None = None,
    ffmpeg: str = "ffmpeg",
    duration: float | None = None,
) -> None:
    """Cắt ``src[start:end]`` ra MP3 mới ``dst`` (ghi file tạm rồi đổi tên để an toàn)."""
    validate_range(start, end, duration)
    length = end - start
    if fade_in < 0 or fade_out < 0:
        raise AudioError("invalid_fade", "Thời gian fade không được âm")
    if fade_in + fade_out > length:
        raise AudioError("invalid_fade", "Tổng thời gian fade vượt quá độ dài đoạn cắt")

    filters: list[str] = []
    if fade_in > 0:
        filters.append(f"afade=t=in:st=0:d={fade_in:.3f}")
    if fade_out > 0:
        filters.append(f"afade=t=out:st={length - fade_out:.3f}:d={fade_out:.3f}")

    tmp = dst.with_name(dst.name + ".part")
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
           "-ss", f"{start:.3f}", "-i", str(src), "-t", f"{length:.3f}", "-vn"]  # fmt: skip
    if filters:
        cmd += ["-af", ",".join(filters)]
    cmd += ["-codec:a", "libmp3lame", "-b:a", f"{bitrate}k", "-id3v2_version", "3"]
    for key, value in (metadata or {}).items():
        cmd += ["-metadata", f"{key}={value}"]
    cmd += ["-f", "mp3", str(tmp)]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        tmp.unlink(missing_ok=True)
        raise AudioError("ffmpeg", f"Không chạy được ffmpeg: {exc}") from exc
    if proc.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        raise AudioError("ffmpeg", f"ffmpeg lỗi: {proc.stderr.strip()[:300]}")
    os.replace(tmp, dst)


def compute_peaks(
    src: Path, *, peaks_per_second: int = 20, ffmpeg: str = "ffmpeg", sample_rate: int = 4000
) -> list[float]:
    """Tính biên độ đỉnh theo từng khoảng 1/peaks_per_second giây, chuẩn hóa về 0..1.

    Server tính sẵn để trình duyệt (đặc biệt iPhone) khỏi phải giải mã cả file.
    """
    bucket = sample_rate // peaks_per_second
    cmd = [ffmpeg, "-v", "error", "-i", str(src), "-vn", "-ac", "1",
           "-ar", str(sample_rate), "-f", "s16le", "-"]  # fmt: skip
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError as exc:
        raise AudioError("ffmpeg", f"Không chạy được ffmpeg: {exc}") from exc

    peaks: list[int] = []
    chunk_bytes = bucket * 2 * 64
    assert proc.stdout is not None
    try:
        leftover = b""
        while True:
            data = proc.stdout.read(chunk_bytes)
            if not data:
                break
            data = leftover + data
            usable = len(data) - (len(data) % (bucket * 2))
            leftover = data[usable:]
            if usable:
                samples = array("h")
                samples.frombytes(data[:usable])
                for i in range(0, len(samples), bucket):
                    peaks.append(max(map(abs, samples[i : i + bucket])))
        if leftover:
            samples = array("h")
            samples.frombytes(leftover[: len(leftover) - (len(leftover) % 2)])
            if samples:
                peaks.append(max(map(abs, samples)))
    finally:
        proc.stdout.close()
        proc.wait()
    if proc.returncode != 0:
        raise AudioError("ffmpeg", "ffmpeg không giải mã được file để tính waveform")

    top = max(peaks, default=0)
    if top == 0:
        return [0.0 for _ in peaks]
    return [round(p / top, 3) for p in peaks]
