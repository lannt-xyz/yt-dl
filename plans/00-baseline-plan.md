# Baseline plan: YouTube → MP3 Web (cá nhân)

> Trạng thái: **baseline / draft** (2026-11-21). Cập nhật qua các file plan sau, không sửa lịch sử file này.

## 1. Mục tiêu

Web app dùng cá nhân: dán URL YouTube → chuyển sang MP3 → trim ngay trên web → tải về.
UX/UI phải chuyên nghiệp dù chỉ dùng cá nhân. yt-dlp phải cập nhật linh động.

Hiện trạng: [download.py](../download.py) là CLI dùng `yt_dlp` + `ffmpeg`, yt-dlp ghim `2026.10.26`.

## 2. Luồng người dùng

1. **Dán URL**: ô nhập lớn, tự lấy metadata (thumbnail, tiêu đề, kênh, thời lượng) và hiện preview.
2. **Chuyển đổi**: server tải audio → MP3, tiến trình realtime (SSE): *Lấy thông tin → Tải → Chuyển MP3*.
3. **Trim**: waveform + 2 tay cầm kéo, nhập mốc chính xác (`1:23.450`), nghe thử đoạn chọn, fade in/out, phím tắt (Space, `I`/`O`, `←/→`).
4. **Xuất**: tải MP3, chọn bitrate (128/192/320k), sửa tên file + ID3 tag (title, artist, cover từ thumbnail).
5. **Thư viện**: danh sách file đã tải, tìm kiếm, nghe lại, tải lại, xóa.

## 3. Kiến trúc

| Lớp | Lựa chọn | Ghi chú |
|---|---|---|
| Backend | FastAPI (Python) | gọi `yt_dlp` như library; SSE cho tiến trình |
| Job queue | asyncio + thread pool, trạng thái trong SQLite | không cần Celery/Redis |
| Frontend | Vite + React + TS + Tailwind (shadcn/ui) | đã chốt; mobile-first (iPad/iPhone là chính, PC thỉnh thoảng) |
| Thông báo | Web Push (VAPID, `pywebpush`) + thông báo trong app | iOS chỉ nhận push khi app đã "Thêm vào Màn hình chính" |
| Nơi chạy | Raspberry Pi 4 (ARM64) | xem mục 7 |
| Waveform/trim UI | wavesurfer.js + plugin Regions | |
| Cắt audio | ffmpeg phía server | chính xác, trim lại nhiều lần |
| Đóng gói | Docker Compose | ffmpeg + Python nằm sẵn trong image |

**Chiến lược trim:** tải cả bài thành MP3 trước, trim bằng ffmpeg sau (có waveform đầy đủ, trim lại không cần tải lại). Giữ `download_ranges` làm chế độ "tải nhanh" tùy chọn khi đã biết mốc cắt.

## 4. Cập nhật yt-dlp linh động

1. **Nút Update trong Settings**: hiện version đang chạy vs mới nhất trên PyPI; cài vào thư mục riêng, không đụng môi trường chính.
2. **Tự phát hiện lỗi**: gặp `Sign in to confirm` / `HTTP 403` / `Unable to extract` → banner đề xuất update + retry (có thể bật auto).
3. **Kiểm tra định kỳ** mỗi 24h; kênh `stable` / `nightly`.
4. **Rollback**: giữ các version cũ để quay lại nếu bản mới lỗi.
5. Lưu trên volume để không mất khi container restart.
6. Lưu ý: YouTube có thể cần JS runtime (Deno/Node) và cookies → tùy chọn "cookies từ trình duyệt" trong Settings.

**Quyết định cách ly (đã chốt): phương án A, versioned venv.**
- Mỗi version yt-dlp nằm trong một venv riêng: `data/ytdlp/<version>/`; con trỏ `data/ytdlp/current` trỏ tới version đang dùng.
- Update = tạo venv mới + `pip install yt-dlp==<ver>` → smoke test (`--version`, extract thử 1 URL cố định) → đổi con trỏ. Lỗi ở bước nào thì giữ nguyên version cũ.
- Rollback = đổi con trỏ về version trước. Giữ tối đa N version (mặc định 3), tự xóa bản cũ hơn.
- Job tải chạy yt-dlp bằng interpreter của venv `current` (subprocess hoặc import theo `sys.path` riêng), nên update không cần restart web.
- Không dùng docker-in-docker / mount `docker.sock`. Giữ ranh giới qua một interface nhỏ (`get_info`, `download`, `update`, `version`, `rollback`) để sau này có thể chuyển sang sidecar/container-per-job mà không sửa web.

## 5. UX/UI

- Layout một cột gọn, dark/light theo hệ thống.
- Trạng thái rõ ràng mọi bước (skeleton, progress theo bước, lỗi dễ hiểu).
- Undo khi trim, giữ state khi reload, hỗ trợ keyboard + accessibility.
- Tự dọn file cũ sau N ngày / khi vượt dung lượng.

### Responsive, ưu tiên cảm ứng (iPad + iPhone là chính)

- **Mobile-first**, 3 mức bố cục: iPhone (1 cột, thanh điều hướng dưới đáy) → iPad (2 cột: hàng đợi/lịch sử bên cạnh trình trim, hỗ trợ cả dọc và ngang) → PC (rộng hơn, thêm phím tắt).
- Vùng chạm tối thiểu 44×44px; tay cầm trim to, dễ kéo bằng ngón tay; có nút nhích ±0.1s / ±1s và nút "đặt điểm vào/ra tại vị trí đang phát" thay cho việc phải kéo thật chính xác.
- Tôn trọng safe-area (notch, home indicator), `viewport-fit=cover`, `100dvh`; không để zoom ngoài ý muốn khi focus input (font ≥ 16px).
- Hover không phải đường dẫn duy nhất; mọi hành động đều làm được bằng chạm.
- **Waveform**: server tính sẵn peaks (JSON nhỏ) thay vì để trình duyệt giải mã cả file MP3. Tránh ngốn RAM trên iPhone và nhanh hơn nhiều.
- **Audio trên iOS**: chỉ phát được sau thao tác của người dùng; thiết kế nút Play rõ ràng, không autoplay.
- **Tải file trên iOS**: dùng nút Tải/Chia sẻ (Share sheet → "Lưu vào Tệp"); có kiểm thử trên Safari thật.

## 6. Hàng đợi, lịch sử, thông báo

Không hỗ trợ playlist (mỗi lần một URL), nhưng có thể dán/gửi liên tiếp nhiều URL.

- **Hàng đợi**: mỗi URL là một job. Trạng thái: `queued → fetching_info → downloading → converting → done | failed | cancelled`.
  - Lưu trong SQLite, **bền qua restart**: khởi động lại thì job dở dang được đưa về `queued` hoặc đánh dấu lỗi rõ ràng.
  - Mặc định chạy **tuần tự (concurrency = 1)** để không làm nghẽn Pi 4; cấu hình được 1–2.
  - Hỗ trợ hủy, thử lại, sắp xếp lại thứ tự job đang chờ; phát hiện URL trùng (đã có trong lịch sử → hỏi tải lại hay mở bản cũ).
  - Tiến trình realtime qua SSE cho cả danh sách, không chỉ job đang xem.
- **Lịch sử**: mọi job (thành công/thất bại) được lưu: URL, tiêu đề, kênh, thumbnail, thời lượng, thời điểm, version yt-dlp đã dùng, kích thước file, lỗi nếu có. Tìm kiếm, lọc theo trạng thái/ngày, tải lại, mở trình trim cho bản đã tải, xóa file (giữ hoặc xóa dòng lịch sử). Các bản trim là bản ghi con của bản gốc.
- **Thông báo khi xong từng URL** (và khi lỗi):
  1. **Trong app**: toast + huy hiệu số job chưa xem trên tab Lịch sử.
  2. **Web Push** (VAPID) để báo ngay cả khi đã đóng app: bấm vào thông báo → mở thẳng bản vừa xong. Người dùng đăng ký từ Settings bằng thao tác bấm (iOS yêu cầu), lưu subscription trong SQLite, tự xóa subscription hết hạn (410/404).
  3. **iOS**: push chỉ hoạt động khi app được cài ra Màn hình chính (iOS/iPadOS ≥ 16.4) và dùng HTTPS hợp lệ. Hướng dẫn cài đặt đặt ngay trong UI. Chưa cài thì dùng (1) khi app đang mở.
  4. Tùy chọn: kênh thông báo ngoài (ntfy/Telegram) làm dự phòng, mặc định tắt.

## 7. Triển khai trên Raspberry Pi 4

- **Kiến trúc**: image ARM64. Docker Compose gồm `app` (FastAPI + static frontend đã build) và `proxy` (Caddy, lo HTTPS). Frontend build ở máy dev/CI, không build trên Pi.
- **Tài nguyên**: yt-dlp chủ yếu bị giới hạn bởi mạng; ffmpeg encode MP3 trên Pi 4 đủ nhanh. Chỉ chạy 1 job một lúc, giới hạn RAM/CPU container, theo dõi nhiệt độ.
- **Lưu trữ**: `data/` (SQLite, venv yt-dlp, audio) trên volume; **nên đặt trên SSD/USB thay vì thẻ SD** vì ghi nhiều. Có hạn mức dung lượng và dọn file tự động.
- **JS runtime** cho yt-dlp (Deno/Node) phải có bản ARM64 trong image.
- **Truy cập và bảo mật** (thiết bị ngoài máy dev: iPad/iPhone):
  - HTTPS bắt buộc cho PWA + Push. Phương án khuyến nghị: **Tailscale** (truy cập từ xa an toàn, có HTTPS cert hợp lệ qua `tailscale cert`/serve, không phải mở port ra Internet). Dự phòng: tên miền + Caddy (Let's Encrypt) nếu muốn công khai.
  - Dù đã nằm sau Tailscale vẫn có **đăng nhập đơn giản** (mật khẩu/passkey, session cookie, rate-limit) vì app có quyền chạy lệnh tải và ghi đĩa.
  - Không mở thẳng port ra Internet; chặn SSRF (chỉ chấp nhận URL YouTube đã chuẩn hóa).
- **Vận hành**: `restart: unless-stopped`, healthcheck, backup `data/*.db` định kỳ, log xoay vòng.

## 8. PWA

Mục tiêu: cài được như app trên điện thoại/desktop, mở nhanh, có trải nghiệm native.

- **Manifest**: tên, icon (192/512 + maskable), `display: standalone`, theme/background color khớp dark/light, `start_url`, `shortcuts` (ví dụ "Tải URL mới", "Thư viện").
- **Service worker** (`vite-plugin-pwa` / Workbox):
  - Precache app shell (JS/CSS/font/icon) → mở app tức thì, hiện UI offline.
  - **Không cache** API `/api/*` và stream tiến trình (SSE); chỉ cache có kiểm soát file audio của thư viện (tùy chọn, giới hạn dung lượng, LRU).
  - Cập nhật SW theo kiểu "prompt": hiện toast "Có bản mới, tải lại" thay vì reload ngầm.
- **Gửi URL từ app YouTube vào app của mình** (tính năng đáng giá nhất của PWA ở đây):
  - **Android/PC**: Web Share Target (manifest `share_target`) → tự điền URL và đưa vào hàng đợi.
  - **iOS/iPadOS: Safari KHÔNG hỗ trợ Web Share Target.** Phương án thay thế: (a) **iOS Shortcut** nhận URL từ Share Sheet rồi gọi API `POST /api/jobs` bằng API token cá nhân; (b) tự đọc clipboard khi mở app (nút "Dán từ clipboard", hoặc tự gợi ý nếu clipboard chứa link YouTube); (c) deep-link `/?url=...`. Mình đề xuất làm (b) + (c) trước, (a) là phần nâng cao với file Shortcut đính kèm hướng dẫn.
  - Cần API token riêng cho Shortcut (tạo/thu hồi trong Settings).
- **Offline UX**: khi mất mạng/server, hiển thị trạng thái rõ ràng, vẫn xem được thư viện đã cache; các thao tác cần server bị vô hiệu hóa kèm giải thích.
- **Điều kiện HTTPS**: service worker, Share Target và Web Push chỉ chạy trong secure context với cert hợp lệ (cert tự ký không đủ trên iOS) → dùng Tailscale HTTPS hoặc Caddy + Let's Encrypt (xem mục 7).
- **iOS đặc thù**: icon `apple-touch-icon`, meta `apple-mobile-web-app-*`, splash; hướng dẫn "Thêm vào Màn hình chính" trong UI; dung lượng cache của Safari có thể bị hệ thống dọn nên không phụ thuộc vào cache để giữ dữ liệu.
- **Kiểm tra**: Lighthouse PWA/installability trong CI (xem mục 9) và kiểm tra tay trên iPhone/iPad thật.

## 9. Kiểm thử

Nguyên tắc: test mặc định phải **chạy offline, nhanh và ổn định**, không gọi YouTube thật. Test cần mạng gắn marker riêng và chỉ chạy khi gọi chủ động.

### Backend (pytest + pytest-asyncio + httpx `AsyncClient`)

| Nhóm | Nội dung kiểm tra |
|---|---|
| Tiện ích | `parse_time` (`90`, `1:30`, `01:02:03`, `1m30s`, mốc không hợp lệ), validate/chuẩn hóa URL YouTube (watch, youtu.be, shorts, playlist → bị bỏ `list=`), làm sạch tên file |
| Downloader | Mock `yt_dlp`: map option đúng (mp3, bitrate, `noplaylist`), map lỗi (`Sign in to confirm`, 403, `Unable to extract`) sang mã lỗi/thông điệp của app, cập nhật tiến trình |
| Trim/ffmpeg | Sinh file sine 5s bằng ffmpeg làm fixture; kiểm tra độ dài đầu ra (sai số ≤ 50ms), mốc ngoài phạm vi, `start >= end`, fade, ID3 tag và cover |
| Updater | Dùng fake index/pip: so sánh version, tạo venv mới, smoke test thất bại → **không đổi con trỏ**, rollback, giữ tối đa N version, update khi đang có job chạy |
| API | Các endpoint `info` / `convert` / `trim` / `library` / `settings`; SSE phát đúng thứ tự sự kiện; job hủy/lỗi; dọn file cũ |
| Job store | SQLite in-memory: vòng đời job, khôi phục job dở dang khi khởi động lại |
| Hàng đợi | Chạy tuần tự đúng concurrency; hủy/thử lại/sắp xếp lại; URL trùng; job lỗi không chặn job sau |
| Lịch sử | Ghi đủ trường, tìm kiếm/lọc/phân trang, xóa file giữ lại dòng lịch sử, bản trim là bản ghi con |
| Thông báo | Mock `pywebpush`: gửi đúng payload khi job xong/lỗi, xóa subscription khi nhận 410/404, không gửi khi chưa đăng ký |
| Auth | Đăng nhập/sai mật khẩu/rate-limit, API token (tạo/thu hồi), endpoint không có session bị từ chối |

Marker: `@pytest.mark.network` (gọi YouTube thật, một video ngắn cố định) và `@pytest.mark.slow`; mặc định bỏ qua cả hai.

### Frontend (Vitest + React Testing Library + MSW)

- Hàm thuần: format/parse thời gian, clamp vùng trim, tính độ dài kết quả.
- Component: ô nhập URL (dán, lỗi, loading), thanh tiến trình theo bước, điều khiển trim (nhập mốc ↔ vùng trên waveform đồng bộ, phím tắt), banner "yt-dlp cũ".
- Mock API bằng MSW, kể cả SSE.
- wavesurfer.js mock ở mức adapter vì jsdom không có Web Audio.

### E2E (Playwright, backend dùng downloader giả)

- Luồng chính: dán URL → chuyển đổi → trim → tải file (kiểm tra file tải về hợp lệ).
- Luồng lỗi: URL sai, yt-dlp lỗi → banner update → retry.
- PWA: manifest hợp lệ, service worker đăng ký, mở lại khi offline vẫn hiện app shell, Share Target điền đúng URL (Chromium).
- Responsive: chạy bộ test chính ở viewport iPhone, iPad (dọc/ngang) và desktop, dùng thiết bị giả lập WebKit của Playwright; kiểm tra không tràn ngang, tay cầm trim đủ lớn.
- Hàng đợi: dán 3 URL liên tiếp → chạy tuần tự → thông báo trong app cho từng cái → xuất hiện đủ trong lịch sử.
- Kiểm tra tay trên iPhone/iPad thật cho: cài PWA, Web Push, phát audio, tải file, Shortcut.
- Lighthouse CI: điểm PWA/Accessibility tối thiểu.

### Chất lượng và vận hành

- Mục tiêu coverage: backend ≥ 85%, frontend logic ≥ 80%; không đặt mục tiêu cứng cho UI thuần hiển thị.
- `make test` (nhanh: unit), `make test-all` (thêm e2e), `make test-network` (gọi YouTube thật).
- Lint/type: `ruff` + `mypy` cho backend, `eslint` + `tsc --noEmit` cho frontend.
- CI (GitHub Actions): unit + lint + e2e trên mỗi push. Thêm job **định kỳ hằng tuần** chạy `network` với yt-dlp bản mới nhất để phát hiện sớm khi YouTube đổi.

## 10. Lộ trình

1. **MVP**: FastAPI (SQLite, job store) + UI mobile-first dán URL → convert → tải về; unit test nền (tiện ích, downloader mock, ffmpeg).
2. **Hàng đợi + lịch sử** (tuần tự, bền qua restart, SSE) + thông báo trong app.
3. **Trình trim**: peaks do server tính, waveform, tay cầm cảm ứng, nghe thử, ID3/cover.
4. **Update + rollback yt-dlp** (versioned venv) kèm test updater.
5. **PWA + Web Push**: manifest, service worker, đăng ký push, hướng dẫn cài trên iOS, clipboard/deep-link, tùy chọn Shortcut.
6. **Triển khai Pi 4**: Docker ARM64, Caddy + Tailscale HTTPS, đăng nhập, backup, dọn file tự động.
7. **E2E + CI + polish UI**, kiểm tra tay trên thiết bị iOS thật.

## 11. Quyết định

Đã chốt:
- [x] **Cách ly yt-dlp**: phương án A, versioned venv (mục 4).
- [x] **PWA**: có (mục 8).
- [x] **Unit test**: có (mục 9).
- [x] **Nơi chạy**: Raspberry Pi 4 server, truy cập từ iPad/iPhone/PC (mục 7).
- [x] **Frontend**: Vite + React + Tailwind, mobile-first responsive (mục 5).
- [x] **Playlist**: không hỗ trợ; có hàng đợi, thông báo khi xong từng URL và lịch sử (mục 6).

Đang mở (chọn mặc định nếu không có ý kiến khác):
- [ ] **Truy cập từ xa**: Tailscale (mặc định) hay tên miền công khai + Caddy?
- [ ] **Đăng nhập**: mật khẩu đơn giản (mặc định) hay passkey?
- [ ] **iOS Shortcut** gửi URL từ YouTube: làm ở bước 5 hay để sau?
- [ ] **Thông báo dự phòng** (ntfy/Telegram): có cần không (mặc định: không)?
