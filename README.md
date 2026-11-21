# YouTube → MP3

Web app cá nhân: dán URL YouTube → chuyển MP3 → trim ngay trên web. Kế hoạch chi tiết: [plans/00-baseline-plan.md](plans/00-baseline-plan.md).

## Backend (FastAPI)

```bash
python3 -m venv venv && venv/bin/pip install -r backend/requirements-dev.txt
make dev-backend      # http://localhost:8000/docs
make test             # unit test (offline)
make test-network     # gọi YouTube thật
```

Cấu hình qua biến môi trường: `YT_DATA_DIR` (mặc định `data/`), `YT_CONCURRENCY` (1), `YT_DEFAULT_BITRATE` (192), `YT_STATIC_DIR` (thư mục frontend đã build).

## Frontend (Vite + React + Tailwind)

```bash
cd frontend && npm install
make dev-frontend     # http://localhost:5173 (proxy /api → :8000, chạy kèm make dev-backend)
make test-frontend
make serve            # build + chạy 1 cổng duy nhất tại :8000
```

Mobile-first (iPhone/iPad là chính), dark/light theo hệ thống. Mở `/?url=<link>` để tự thêm link vào hàng đợi.

## PWA và thông báo

- Cài như app: Chrome/Edge → "Cài đặt ứng dụng"; iPhone/iPad → Safari → Chia sẻ → "Thêm vào MH chính".
- Web Push (Cài đặt → Thông báo) cần **HTTPS hợp lệ** (hoặc `localhost`). Trên iOS/iPadOS còn phải mở app từ biểu tượng ở Màn hình chính (iOS ≥ 16.4).
- iOS không có Share Target: dùng nút Dán, hoặc mở `/?url=<link>` (ví dụ từ iOS Shortcut).
- Khóa VAPID tự sinh tại `data/vapid_private.pem` (đừng commit; xóa file nếu muốn đăng ký lại toàn bộ thiết bị).
- Sinh lại icon: `cd frontend && node scripts/generate-icons.cjs`.

## Triển khai (Raspberry Pi + Docker)

Xem [docs/DEPLOY-PI.md](docs/DEPLOY-PI.md): Docker Compose, Tailscale HTTPS, đăng nhập, sao lưu, dọn dẹp tự động.

```bash
cp .env.example .env     # đặt mật khẩu
docker compose up -d --build
```

Đăng nhập: đặt `YT_PASSWORD` (hoặc `YT_PASSWORD_HASH` sinh bằng `python -m app.hashpw`) để bật; bỏ trống = chế độ mở (chỉ dùng trên localhost).

`download.py` ở thư mục gốc là CLI gốc, vẫn dùng được độc lập.
