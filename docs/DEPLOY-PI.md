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

Có hai cách lấy image:

- **Dùng image dựng sẵn trên Docker Hub** (nhanh, khuyến nghị): `docker compose pull && docker compose up -d`
  (image `lanntxyz/yt-dl`, có sẵn cho amd64 và arm64).
- **Tự build trên Pi** từ source: `docker compose up -d --build` (lần đầu 5–10 phút).

```bash
mkdir -p /mnt/ssd/yt-mp3 && sudo chown 10001:10001 /mnt/ssd/yt-mp3   # user trong container
docker compose pull && docker compose up -d     # hoặc: docker compose up -d --build
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
| Cập nhật app | `git pull && docker compose pull && docker compose up -d` (hoặc `up -d --build` để tự build) |
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

## 7. Phát hành image lên Docker Hub (GitHub Actions)

Workflow `CI` (job `publish`) tự build image đa kiến trúc `linux/amd64` + `linux/arm64` và đẩy lên
**`lanntxyz/yt-dl`** khi:

| Sự kiện | Tag được đẩy |
|---|---|
| push lên `main` | `latest`, `sha-<7 ký tự>` |
| push tag `v1.2.3` | `1.2.3`, `1.2`, `sha-<7 ký tự>` |
| push nhánh khác / pull request | chỉ build thử (amd64), **không đẩy** |

Cấu hình một lần: Docker Hub → Account settings → Security → **New Access Token** (quyền *Read & Write*), rồi trong
GitHub repo → Settings → Secrets and variables → Actions thêm (đặt trong environment **`PERSONAL`** hoặc cấp repo đều được; workflow dùng environment `PERSONAL`):

- `DOCKERHUB_USERNAME` = `lanntxyz`
- `DOCKERHUB_TOKEN` = token vừa tạo

Chưa có secrets thì job vẫn chạy nhưng chỉ build thử và in cảnh báo. Phát hành bản có số version:
`git tag v1.0.0 && git push origin v1.0.0`. Build arm64 qua QEMU mất khoảng 10–20 phút (có cache).

## 8. Tự động deploy lên Pi (GitHub Actions qua SSH)

Sau khi image được đẩy lên Docker Hub (mục 7), job `deploy` SSH vào Pi và chạy [scripts/deploy.sh](../scripts/deploy.sh):
`docker compose pull` → `up -d` → chờ container `healthy` (quá 120 giây hoặc container chết thì job báo đỏ, kèm log).
Job chỉ chạy khi push lên `main` **và** image đã thật sự được đẩy; nhánh khác/PR không bao giờ deploy.

### Cấu hình một lần

**1. Tạo khóa SSH riêng cho deploy** (trên máy bạn, không đặt passphrase):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ./deploy_key -N ""
ssh-copy-id -i ./deploy_key.pub <user>@<máy-pi>      # hoặc dán deploy_key.pub vào ~/.ssh/authorized_keys trên Pi
```

**2. Lấy dấu vân tay máy chủ** (chạy từ mạng bạn tin tưởng):

```bash
ssh-keyscan -p 22 <máy-pi>      # kết quả dán vào secret SSH_KNOWN_HOSTS
```

**3. Thêm secrets** ở GitHub repo → Settings → Secrets and variables → Actions:

| Secret | Giá trị |
|---|---|
| `SSH_HOST` | địa chỉ Pi (IP/tên miền, hoặc tên MagicDNS `pi.<tailnet>.ts.net`) |
| `SSH_USER` | user SSH trên Pi (user này phải dùng được `docker`) |
| `SSH_PRIVATE_KEY` | toàn bộ nội dung file `deploy_key` |
| `SSH_KNOWN_HOSTS` | kết quả `ssh-keyscan` ở bước 2 |
| `DEPLOY_PATH` | thư mục chứa `docker-compose.yml` và `.env` trên Pi, ví dụ `/home/pi/yt-dl` |
| `SSH_PORT` | (tùy chọn) cổng SSH nếu khác 22 |

Thiếu secret bắt buộc thì job deploy tự bỏ qua kèm cảnh báo vàng, không làm hỏng pipeline. Sau khi xong, **xóa file `deploy_key` trên máy bạn**.

### Pi nằm sau NAT / chỉ truy cập qua Tailscale?

Runner của GitHub không tới được mạng nhà bạn. Có hai cách:

- **Tailscale (khuyến nghị):** tạo OAuth client (quyền `devices:write`, tag `tag:ci`) trong trang quản trị Tailscale, thêm secrets
  `TS_OAUTH_CLIENT_ID` và `TS_OAUTH_SECRET`. Job tự đưa runner vào tailnet trước khi SSH; `SSH_HOST` dùng tên MagicDNS/IP Tailscale của Pi.
  Cần cho phép `tag:ci` truy cập Pi (cổng 22) trong ACL của tailnet.
- Mở cổng SSH ra Internet (không khuyến nghị): bắt buộc tắt đăng nhập bằng mật khẩu, chỉ cho phép khóa, và nên đổi cổng.

### Bảo mật

- Khóa deploy chỉ nên dùng cho việc này. Muốn chặt hơn, giới hạn trong `authorized_keys` trên Pi:
  `no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... github-actions-deploy`.
- Bật **Required reviewers** cho environment `PERSONAL` (Settings → Environments) nếu muốn duyệt tay trước mỗi lần deploy.
- Khóa được ghi ra runner chỉ trong lúc deploy và bị xóa ở bước cuối; host được xác thực bằng `SSH_KNOWN_HOSTS`.
- Chạy tay trên Pi bất cứ lúc nào: `DEPLOY_PATH=/home/pi/yt-dl sh scripts/deploy.sh`.
