# syntax=docker/dockerfile:1.7
# Đa kiến trúc (linux/amd64, linux/arm64 — dùng được trên Raspberry Pi 4).

# ---- 1) Build frontend ----
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 2) Node runtime (yt-dlp cần JS runtime để giải challenge của YouTube) ----
FROM node:22-slim AS noderuntime

# ---- 3) Ảnh chạy ----
FROM python:3.12-slim AS app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    YT_DATA_DIR=/data \
    YT_STATIC_DIR=/app/static

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=noderuntime /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY backend/app ./app
COPY backend/scripts ./scripts
COPY --from=web /web/dist ./static

# chạy bằng user thường; /data là volume chứa DB, audio, các bản yt-dlp, khóa VAPID
RUN useradd --system --uid 10001 --home /app app \
 && mkdir -p /data && chown -R app:app /data /app
USER app
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

ENTRYPOINT ["tini", "--"]
CMD ["python", "-m", "uvicorn", "app.main:create_app", "--factory", \
     "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
