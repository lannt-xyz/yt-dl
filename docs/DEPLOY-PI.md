# Triển khai trên Raspberry Pi 4

Mục tiêu: chạy app 24/7 trên Pi, dùng từ iPhone/iPad/PC (kể cả khi ở ngoài nhà) mà **không mở port ra Internet**.

## 0. Chuẩn bị

- Raspberry Pi 4 (4 GB trở lên là thoải mái), Raspberry Pi OS 64-bit (arm64).
- **Ổ SSD/USB cho dữ liệu.** App ghi khá nhiều (audio, DB); thẻ SD sẽ mòn nhanh.
- Docker Engine + plugin Compose: <https://docs.docker.com/engine/install/debian/>

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # đăng xuất/đăng nhập lại
```

## 1. Cài đặt

```bash
git clone https://github.com/lannt-xyz/yt-dl.git && cd yt-dl
cp .env.example .env
```

Sửa `.env`:

| Biến | Ý nghĩa |
|---|---|
| `YT_PASSWORD` hoặc `YT_PASSWORD_HASH` | Mật khẩu đăng nhập. Nên dùng hash: `docker compose run --rm app python -m app.hashpw` |
| `YT_TRUST_PROXY=1` | Đang đứng sau Caddy/Tailscale Serve (lấy IP thật để chống dò mật khẩu, nhận biết https) |
| `YT_DATA_HOST_DIR` | Thư mục dữ liệu trên SSD, ví dụ `/mnt/ssd/yt-mp3` |
| `YT_RETENTION_DAYS` / `YT_MAX_STORAGE_GB` | Tự dọn file cũ / giới hạn dung lượng |

```bash
mkdir -p /mnt/ssd/yt-mp3 && sudo chown 10001:10001 /mnt/ssd/yt-mp3   # user trong container
docker compose up -d --build
docker compose ps        # STATUS phải là "healthy"
docker compose logs -f app
```

Lần build đầu trên Pi mất khoảng 5–10 phút (build frontend + cài thư viện). Có thể build trên máy khác bằng
`docker buildx build --platform linux/arm64 ...` rồi đẩy image lên.

App lắng nghe ở `127.0.0.1:8000` trên Pi. Thử nhanh: `curl localhost:8000/api/health`.

## 2. Truy cập từ xa với HTTPS

PWA, service worker và **thông báo đẩy yêu cầu HTTPS hợp lệ** (chứng chỉ tự ký không dùng được trên iOS).

### Cách A (khuyến nghị): Tailscale

Không mở port, chứng chỉ do Tailscale cấp, chỉ thiết bị trong tailnet của bạn truy cập được.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# Bật MagicDNS + HTTPS Certificates trong trang quản trị Tailscale (một lần)
sudo tailscale serve --bg --https=443 http://127.0.0.1:8000
tailscale serve status        # in ra địa chỉ https://<tên-máy>.<tailnet>.ts.net
```

Cài app Tailscale trên iPhone/iPad/PC, đăng nhập cùng tài khoản rồi mở địa chỉ trên.

### Cách B: Tên miền công khai + Caddy

Chỉ dùng khi bạn thật sự muốn truy cập không cần Tailscale. Trỏ DNS về nhà, mở port 80/443 trên router, đặt
`YT_DOMAIN=mp3.example.com` trong `.env`, rồi:

```bash
docker compose --profile https up -d
```

Khi đó **mật khẩu mạnh là bắt buộc** (app đã giới hạn thử sai 5 lần/5 phút mỗi IP, nhưng hãy dùng `YT_PASSWORD_HASH`).

## 3. Cài như app trên iPhone/iPad

1. Mở địa chỉ https bằng **Safari**, đăng nhập.
2. Nút Chia sẻ → **Thêm vào MH chính** → Thêm.
3. Mở app từ biểu tượng mới → **Cài đặt (⚙) → Thông báo → bật**. (iOS chỉ gửi thông báo cho app đã cài, iOS/iPadOS ≥ 16.4.)
4. Nhấn “Gửi thông báo thử” để kiểm tra.

Gửi link từ app YouTube: iOS không hỗ trợ Share Target, dùng một trong hai cách:
nút **Dán** trong app, hoặc **Phím tắt (Shortcuts)** — tạo token trong Cài đặt → Truy cập và làm theo hướng dẫn ngay dưới đó.

## 4. Vận hành

| Việc | Cách làm |
|---|---|
| Cập nhật yt-dlp | Trong app: Cài đặt → yt-dlp (có thể bật tự động). Không cần restart, có nút quay lại bản trước. |
| Cập nhật app | `git pull && docker compose up -d --build` |
| Xem log | `docker compose logs -f app` |
| Sao lưu | App tự sao lưu DB mỗi ngày vào `data/backups/` (giữ 7 bản). Chép thư mục đó ra nơi khác định kỳ. Thủ công: `docker compose exec app python scripts/backup_db.py` |
| Khôi phục | Dừng app, chép một file `data/backups/app-*.db` thành `data/app.db`, bật lại |
| Dọn dung lượng | Tự động theo `YT_RETENTION_DAYS`/`YT_MAX_STORAGE_GB`; hoặc Cài đặt → Lưu trữ → “Dọn dẹp ngay” |
| Đổi mật khẩu | Sửa `.env`, `docker compose up -d`; mọi phiên đăng nhập cũ tự hết hiệu lực |
| Đăng ký lại thông báo cho tất cả thiết bị | Xóa `data/vapid_private.pem` và khởi động lại; bật lại thông báo trên từng thiết bị |

## 5. Sự cố thường gặp

- **Mọi video đều lỗi “cần cập nhật yt-dlp”**: Cài đặt → yt-dlp → Kiểm tra → Cập nhật (hoặc bật “Tự động cập nhật”).
  Nếu vẫn lỗi, thử kênh *Nightly*.
- **YouTube đòi đăng nhập / chặn IP nhà**: tình trạng của YouTube, không phải lỗi app. Thử cập nhật yt-dlp trước.
- **Không bật được thông báo trên iPhone**: kiểm tra đã mở app từ biểu tượng Màn hình chính (không phải tab Safari) và địa chỉ là https hợp lệ.
- **Nóng/giật khi tải**: giữ `YT_CONCURRENCY=1`; kiểm tra nhiệt độ `vcgencmd measure_temp`, dùng tản nhiệt.
- **Hết dung lượng**: đặt `YT_MAX_STORAGE_GB`, chuyển `YT_DATA_HOST_DIR` sang ổ lớn hơn.

## 6. Bảo mật — tóm tắt

- Không mở port ra Internet nếu không cần; ưu tiên Tailscale.
- Mật khẩu hash PBKDF2, cookie phiên `HttpOnly` + `SameSite=Lax` (+ `Secure` khi https), kiểm tra `Origin` với thao tác ghi,
  giới hạn thử sai, token API chỉ lưu bản băm và hiển thị đúng một lần.
- App chỉ nhận link video YouTube (không tải URL tùy ý) và chỉ gửi push tới dịch vụ push của trình duyệt.
- Container chạy bằng user không phải root, dữ liệu nằm ở volume riêng.
