# Trạng thái triển khai & checklist nghiệm thu

> Cập nhật: 2026-11-21. Đối chiếu với [00-baseline-plan.md](00-baseline-plan.md).

## 1. Đã làm so với kế hoạch

| # | Hạng mục kế hoạch | Trạng thái | Nhánh |
|---|---|---|---|
| 1 | MVP: tải URL → MP3, tải về; hàng đợi, lịch sử, SSE | ✅ | `feat/backend-core`, `feat/frontend-mvp` |
| 2 | Hàng đợi tuần tự bền qua restart, hủy/thử lại, phát hiện trùng, thông báo trong app | ✅ | cùng trên |
| 3 | Trình trim: waveform, tay cầm cảm ứng, nghe thử, fade, bitrate, tên | ✅ | `feat/trim-ui` |
| 4 | yt-dlp cập nhật linh động: venv theo version, rollback, stable/nightly, tự cập nhật + tự thử lại | ✅ | `feat/ytdlp-updater` |
| 5 | PWA: manifest, service worker, offline shell, Share Target (Android), Web Push, hướng dẫn cài iOS | ✅ | `feat/pwa-push` |
| 6 | Pi 4: Docker ARM64, Caddy/Tailscale HTTPS, đăng nhập, API token, dọn file tự động, backup DB | ✅ | `feat/deploy-auth` |
| 7 | E2E (iPhone/iPad/desktop), kiểm tra trợ năng, CI, job kiểm tra yt-dlp hằng tuần | ✅ | `feat/e2e-ci` |

Số liệu kiểm thử (tại thời điểm viết): backend **295** test (coverage **95%**), frontend **177** unit test, **86** kịch bản E2E
(4 viewport), quét trợ năng axe WCAG 2.1 AA ở chế độ sáng/tối.

## 2. Khác với kế hoạch gốc (có chủ đích)

- **Waveform tự vẽ bằng canvas** thay vì wavesurfer.js: tay cầm 44px, kéo mượt bằng ngón tay, logic thuần dễ test.
- **Passkey** chưa làm; dùng mật khẩu (PBKDF2) + API token (mặc định đã chốt trong kế hoạch).
- **Thông báo dự phòng ntfy/Telegram**: không làm (mặc định đã chốt là "không").
- **iOS Shortcut**: không đính kèm file `.shortcut` (không ký được tự động); thay bằng hướng dẫn từng bước ngay trong
  Cài đặt → Truy cập, dùng API token.
- **Lighthouse CI**: thay bằng axe trong E2E (kiểm soát được hơn, chạy cả sáng/tối). PWA được kiểm bằng test manifest,
  service worker, offline, share target.
- **Lịch sử khi offline**: shell mở được và báo offline, nhưng danh sách lịch sử/audio không được cache (cần server).
- Cache audio phía service worker là tùy chọn trong kế hoạch → **không làm**.

## 3. Lỗi tìm ra nhờ chạy thật / E2E và đã sửa

- Tay cầm cắt ở mép phải bị cắt nửa (khó chạm) → thêm đệm hai bên khung waveform.
- Thẻ nhập mốc thời gian tràn ngang trên iPhone.
- Gõ link mới khi lần gửi trước chưa xong thì bị xóa mất; job nhanh bị ghi đè trạng thái "đang chờ" sau khi đã xong.
- Màn hình kiểm tra đăng nhập làm mất offline shell (thêm nhớ trạng thái đã đăng nhập).
- Hai sự kiện cập nhật yt-dlp tới liền nhau làm mất toast thành công.
- Toast xếp chồng che waveform trên màn hình nhỏ → rút ngắn thời gian hiển thị, tối đa 3.
- Độ tương phản màu (chữ phụ, màu accent/lỗi ở giao diện sáng) và nhãn nút không chứa chữ hiển thị (WCAG 2.5.3).

## 4. Chưa kiểm chứng được trong môi trường phát triển (cần bạn thử trên thiết bị thật)

1. **iPhone/iPad thật**: cài PWA ra Màn hình chính, Web Push thật qua Apple, phát audio, tải file, kéo tay cầm bằng ngón tay.
   (E2E dùng Chrome giả lập viewport/cảm ứng, không phải Safari/WebKit.)
2. **Raspberry Pi 4 thật**: image đã build và chạy thử đầy đủ trên x86_64 (healthy, đăng nhập, tải + trim thật,
   non-root, ffmpeg + node). Chưa chạy trên arm64; CI chỉ build amd64.
3. **Tailscale HTTPS** và **Caddy + Let's Encrypt**: chỉ có cấu hình + tài liệu, chưa thử với tên miền/tailnet thật.
4. **Web Push qua FCM/Apple**: mã hóa + ký VAPID được test bằng pywebpush thật, và service worker hiển thị thông báo
   được kiểm bằng CDP; chưa gửi qua máy chủ push thật của Google/Apple.
5. **Workflow GitHub Actions** chưa được chạy trên GitHub (chỉ kiểm cú pháp YAML).

## 5. Checklist nghiệm thu (làm theo thứ tự)

**Trên máy dev**
- [ ] `make check` (lint + toàn bộ unit test) xanh
- [ ] `make e2e` xanh (cần Chrome cài sẵn)
- [ ] `make serve` → mở <http://localhost:8000>, dán link thật, thấy tiến trình → tải xong → bấm Cắt → lưu → tải file về nghe thử

**Trên Pi** (xem [../docs/DEPLOY-PI.md](../docs/DEPLOY-PI.md))
- [ ] `docker compose up -d --build` → `docker compose ps` báo `healthy`
- [ ] Đăng nhập bằng mật khẩu trong `.env`; sai 5 lần thì bị khóa tạm
- [ ] `tailscale serve ...` → mở địa chỉ https từ iPhone

**Trên iPhone/iPad**
- [ ] Safari → Thêm vào MH chính → mở từ biểu tượng
- [ ] Cài đặt → Thông báo → bật → "Gửi thông báo thử" nhận được
- [ ] Dán 3 link liên tiếp rồi khóa màn hình: nhận thông báo cho từng link
- [ ] Mở trình cắt: kéo hai tay cầm bằng ngón tay, nghe thử, lưu
- [ ] Cài đặt → Truy cập → tạo token → làm Phím tắt gửi link từ app YouTube

**yt-dlp**
- [ ] Cài đặt → yt-dlp → Kiểm tra → (nếu có bản mới) Cập nhật → thử tải lại
- [ ] Bấm "Quay lại bản trước" hoạt động
