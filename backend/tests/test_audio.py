from pathlib import Path

import pytest

from app.services import audio
from tests.conftest import make_sine_mp3


@pytest.fixture
def sine(tmp_path: Path) -> Path:
    path = tmp_path / "sine.mp3"
    make_sine_mp3(path, seconds=5)
    return path


def test_probe_duration(sine):
    assert audio.probe_duration(sine) == pytest.approx(5.0, abs=0.15)


def test_probe_duration_invalid_file(tmp_path):
    bad = tmp_path / "bad.mp3"
    bad.write_bytes(b"not audio")
    with pytest.raises(audio.AudioError):
        audio.probe_duration(bad)


def test_trim_length_is_accurate(sine, tmp_path):
    dst = tmp_path / "out.mp3"
    audio.trim_audio(sine, dst, 1.0, 3.5, duration=5.0)
    assert dst.exists()
    assert audio.probe_duration(dst) == pytest.approx(2.5, abs=0.1)
    assert not (tmp_path / "out.mp3.part").exists()


def test_trim_with_fades_and_metadata(sine, tmp_path):
    dst = tmp_path / "out.mp3"
    audio.trim_audio(
        sine, dst, 0, 2, fade_in=0.5, fade_out=0.5, bitrate=128,
        metadata={"title": "Tiêu đề", "artist": "Ai đó"}, duration=5.0,
    )  # fmt: skip
    assert audio.probe_duration(dst) == pytest.approx(2.0, abs=0.1)
    peaks = audio.compute_peaks(dst, peaks_per_second=20)
    # fade-in: đầu nhỏ hơn giữa; fade-out: cuối nhỏ hơn giữa
    assert peaks[0] < peaks[len(peaks) // 2]
    assert peaks[-2] < peaks[len(peaks) // 2]


@pytest.mark.parametrize(
    ("start", "end", "duration"),
    [(-1, 2, 5), (2, 2, 5), (3, 2, 5), (0, 2.05, 2.0 - 0.2), (0, 0.05, 5)],
)
def test_validate_range_rejects(start, end, duration):
    with pytest.raises(audio.AudioError) as exc:
        audio.validate_range(start, end, duration)
    assert exc.value.code == "invalid_range"


def test_validate_range_allows_small_overshoot():
    audio.validate_range(0, 5.03, 5.0)


def test_trim_rejects_bad_fade(sine, tmp_path):
    with pytest.raises(audio.AudioError) as exc:
        audio.trim_audio(sine, tmp_path / "o.mp3", 0, 2, fade_in=1.5, fade_out=1.0, duration=5.0)
    assert exc.value.code == "invalid_fade"
    with pytest.raises(audio.AudioError):
        audio.trim_audio(sine, tmp_path / "o.mp3", 0, 2, fade_in=-1, duration=5.0)


def test_trim_failure_leaves_no_partial(tmp_path):
    missing = tmp_path / "nope.mp3"
    dst = tmp_path / "out.mp3"
    with pytest.raises(audio.AudioError):
        audio.trim_audio(missing, dst, 0, 1, duration=5.0)
    assert not dst.exists()
    assert not (tmp_path / "out.mp3.part").exists()


def test_compute_peaks_shape_and_range(sine):
    peaks = audio.compute_peaks(sine, peaks_per_second=20)
    assert len(peaks) == pytest.approx(5 * 20, abs=6)
    assert max(peaks) == 1.0
    assert all(0.0 <= p <= 1.0 for p in peaks)


def test_compute_peaks_silence(tmp_path):
    import subprocess

    silent = tmp_path / "silent.mp3"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
         "anullsrc=r=22050:cl=mono", "-t", "2", "-codec:a", "libmp3lame", str(silent)],
        check=True,
    )  # fmt: skip
    peaks = audio.compute_peaks(silent)
    assert peaks and all(p == 0.0 for p in peaks)


def test_compute_peaks_invalid_file(tmp_path):
    bad = tmp_path / "bad.mp3"
    bad.write_bytes(b"garbage")
    with pytest.raises(audio.AudioError):
        audio.compute_peaks(bad)
