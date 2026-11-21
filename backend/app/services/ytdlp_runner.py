"""Chạy BÊN TRONG venv của yt-dlp (python của venv đó), không phụ thuộc gói ``app``.

Giao thức: ``python ytdlp_runner.py '<json yêu cầu>'`` → in mỗi sự kiện một dòng JSON ra stdout:
  {"type":"version","version":"..."}
  {"type":"info","video_id","title","channel","thumbnail","duration"}
  {"type":"progress","stage":"downloading|converting","percent":0..100}
  {"type":"done","path":"..."}
  {"type":"error","message":"..."}        (kèm exit code 1)
Mọi thứ khác yt-dlp in ra đều bị chặn để stdout chỉ chứa các dòng JSON này.
"""

from __future__ import annotations

import json
import shutil
import sys
from collections.abc import Callable
from typing import Any

Emit = Callable[[dict[str, Any]], None]


class _Quiet:
    """Logger của yt-dlp nuốt hết đầu ra."""

    def debug(self, msg: str) -> None: ...
    def info(self, msg: str) -> None: ...
    def warning(self, msg: str) -> None: ...
    def error(self, msg: str) -> None: ...


def _base_opts(ffmpeg_location: str | None) -> dict[str, Any]:
    opts: dict[str, Any] = {
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": _Quiet(),
        "socket_timeout": 30,
        "retries": 3,
    }
    if ffmpeg_location:
        opts["ffmpeg_location"] = ffmpeg_location
    # yt-dlp mặc định chỉ dùng Deno giải challenge JS của YouTube; máy chỉ có Node thì bật Node.
    if not shutil.which("deno") and shutil.which("node"):
        opts["js_runtimes"] = {"node": {}}
    return opts


def run_version(emit: Emit) -> None:
    import yt_dlp.version

    emit({"type": "version", "version": yt_dlp.version.__version__})


def run_info(req: dict[str, Any], emit: Emit) -> None:
    import yt_dlp

    with yt_dlp.YoutubeDL({**_base_opts(req.get("ffmpeg")), "skip_download": True}) as ydl:
        info = ydl.extract_info(req["url"], download=False)
    if not info:
        raise RuntimeError("Video unavailable: không lấy được thông tin")
    emit(
        {
            "type": "info",
            "video_id": info.get("id") or "",
            "title": info.get("title") or "Không có tiêu đề",
            "channel": info.get("channel") or info.get("uploader"),
            "thumbnail": info.get("thumbnail"),
            "duration": float(info["duration"]) if info.get("duration") else None,
        }
    )


def run_download(req: dict[str, Any], emit: Emit) -> None:
    import yt_dlp

    out_base = req["out_base"]

    def progress_hook(d: dict[str, Any]) -> None:
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                pct = min(99.0, d["downloaded_bytes"] / total * 100)
                emit({"type": "progress", "stage": "downloading", "percent": pct})
        elif d.get("status") == "finished":
            emit({"type": "progress", "stage": "downloading", "percent": 100.0})

    def pp_hook(d: dict[str, Any]) -> None:
        if d.get("postprocessor") == "ExtractAudio":
            pct = 100.0 if d.get("status") == "finished" else 0.0
            emit({"type": "progress", "stage": "converting", "percent": pct})

    opts = {
        **_base_opts(req.get("ffmpeg")),
        "format": "bestaudio/best",
        "outtmpl": f"{out_base}.%(ext)s",
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": str(req.get("bitrate", 192)),
            }
        ],
        "progress_hooks": [progress_hook],
        "postprocessor_hooks": [pp_hook],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([req["url"]])
    emit({"type": "done", "path": f"{out_base}.mp3"})


def main(argv: list[str]) -> int:
    def emit(event: dict[str, Any]) -> None:
        sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    try:
        req = json.loads(argv[1])
        cmd = req["cmd"]
        if cmd == "version":
            run_version(emit)
        elif cmd == "info":
            run_info(req, emit)
        elif cmd == "download":
            run_download(req, emit)
        else:
            raise ValueError(f"Lệnh không hợp lệ: {cmd}")
    except Exception as exc:  # báo lỗi gọn cho tiến trình cha, không in traceback ra stdout
        emit({"type": "error", "message": str(exc)})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
