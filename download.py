import argparse

import yt_dlp
from yt_dlp.utils import download_range_func, parse_duration


def parse_time(value):
    # Chấp nhận "90", "1:30", "01:02:03", "1m30s"...
    seconds = parse_duration(value)
    if seconds is None:
        raise argparse.ArgumentTypeError(f"Thời gian không hợp lệ: {value}")
    return seconds


def download_youtube_audio(url, output_path="downloads", start=None, end=None):
    print("Đang tải:", url)
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': f'{output_path}/%(title)s.%(ext)s',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'noplaylist': True,  # chỉ tải 1 video, không tải cả playlist
    }

    if start is not None or end is not None:
        start = start or 0
        end = end if end is not None else float('inf')
        # chỉ tải đoạn [start, end], cắt chính xác tại mốc thời gian
        ydl_opts['download_ranges'] = download_range_func(None, [(start, end)])
        ydl_opts['force_keyframes_at_cuts'] = True
        # thêm khoảng thời gian vào tên file để không ghi đè bản đầy đủ
        ydl_opts['outtmpl'] = f'{output_path}/%(title)s [%(section_start)s-%(section_end)s].%(ext)s'

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
        print("Đã tải xong:", url)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tải audio YouTube thành mp3")
    parser.add_argument("urls", nargs="*", help="Các URL cần tải")
    parser.add_argument("-s", "--start", type=parse_time, help="Thời điểm bắt đầu (vd: 90, 1:30, 1m30s)")
    parser.add_argument("-e", "--end", type=parse_time, help="Thời điểm kết thúc (vd: 3:45)")
    parser.add_argument("-o", "--output", default="downloads", help="Thư mục lưu file")
    args = parser.parse_args()

    if args.start is not None and args.end is not None and args.start >= args.end:
        parser.error("--start phải nhỏ hơn --end")

    # Nếu không có URL nào được cung cấp, yêu cầu người dùng nhập URL
    if not args.urls:
        urls_input = input("Nhập các URL YouTube (cách nhau bằng dấu phẩy): ")
        args.urls = [url.strip() for url in urls_input.split(",") if url.strip()]

    print("Bắt đầu tải...")
    for url in args.urls:
        download_youtube_audio(url, args.output, args.start, args.end)
    print("Tải xong!")
