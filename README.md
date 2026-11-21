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

`download.py` ở thư mục gốc là CLI gốc, vẫn dùng được độc lập.
