#!/bin/sh
# Cập nhật và khởi động lại ứng dụng trên máy chủ (Pi): pull image mới → up -d → chờ container "healthy".
# Chạy trực tiếp trên máy chủ:  DEPLOY_PATH=/home/pi/yt-dl sh scripts/deploy.sh
# GitHub Actions đẩy chính file này qua SSH:  ssh host "DEPLOY_PATH=... sh -s" < scripts/deploy.sh
set -eu

cd "${DEPLOY_PATH:-.}"
SERVICE="${DEPLOY_SERVICE:-app}"
TIMEOUT="${DEPLOY_TIMEOUT:-120}"

echo "==> Thư mục triển khai: $(pwd)"
[ -f docker-compose.yml ] || [ -f compose.yml ] || { echo "LỖI: không thấy docker-compose.yml ở đây" >&2; exit 1; }

# Giữ file compose khớp với repo (nếu thư mục này là bản clone); không bắt buộc
if [ -d .git ]; then
  git pull --ff-only || echo "CẢNH BÁO: git pull không thành công, tiếp tục với file compose hiện có" >&2
fi

echo "==> Kéo image mới"
docker compose pull "$SERVICE"

echo "==> Khởi động lại container"
docker compose up -d --remove-orphans "$SERVICE"

echo "==> Chờ container khỏe (tối đa ${TIMEOUT}s)"
cid="$(docker compose ps -q "$SERVICE")"
[ -n "$cid" ] || { echo "LỖI: không tìm thấy container của service '$SERVICE'" >&2; exit 1; }

waited=0
while :; do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")"
  case "$status" in
    healthy | running) # 'running' = image không khai báo healthcheck
      echo "OK: container $status"
      break
      ;;
    unhealthy | exited | dead)
      echo "LỖI: container $status. Log gần nhất:" >&2
      docker logs --tail 40 "$cid" >&2 || true
      exit 1
      ;;
  esac
  if [ "$waited" -ge "$TIMEOUT" ]; then
    echo "LỖI: quá ${TIMEOUT}s mà container vẫn '$status'. Log gần nhất:" >&2
    docker logs --tail 40 "$cid" >&2 || true
    exit 1
  fi
  sleep 3
  waited=$((waited + 3))
done

# dọn các layer cũ để không đầy ổ của Pi
docker image prune -f >/dev/null 2>&1 || true
docker compose ps
echo "==> Deploy xong"
