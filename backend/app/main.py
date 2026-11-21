from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

from .api import jobs, system
from .config import Settings
from .db import Database
from .events import EventBroker
from .repository import JobRepo
from .services.downloader import Downloader, YtDlpDownloader
from .services.worker import JobWorker

log = logging.getLogger("app")


def create_app(settings: Settings | None = None, downloader: Downloader | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings.ensure_dirs()
        db = Database(settings.db_path)
        repo = JobRepo(db)
        broker = EventBroker()
        broker.bind_loop(asyncio.get_running_loop())
        dl = downloader or YtDlpDownloader()
        worker = JobWorker(repo, dl, broker, settings)

        recovered = repo.reset_running_to_queued()
        if recovered:
            log.warning("Đưa %d job dở dang về hàng đợi sau khi khởi động lại", recovered)

        app.state.settings = settings
        app.state.db = db
        app.state.repo = repo
        app.state.broker = broker
        app.state.downloader = dl
        app.state.worker = worker
        await worker.start()
        worker.wake()
        try:
            yield
        finally:
            await worker.stop()
            db.close()

    app = FastAPI(title="YouTube → MP3", version="0.1.0", lifespan=lifespan)

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        body = detail if isinstance(detail, dict) else {"code": "error", "message": str(detail)}
        return JSONResponse({"detail": body}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
        msg = first.get("msg", "Dữ liệu không hợp lệ")
        message = f"{where}: {msg}" if where else "Dữ liệu không hợp lệ"
        body = {"code": "validation_error", "message": message}
        return JSONResponse({"detail": body}, status_code=422)

    app.include_router(system.router)
    app.include_router(jobs.router)
    _mount_frontend(app, settings.static_dir)
    return app


def _mount_frontend(app: FastAPI, static_dir: Path | None) -> None:
    """Phục vụ frontend đã build (SPA) nếu có thư mục static."""
    if static_dir is None or not (static_dir / "index.html").is_file():
        return
    root = static_dir.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404, {"code": "not_found", "message": "Không tìm thấy"})
        candidate = (root / path).resolve()
        if path and candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(root / "index.html")
