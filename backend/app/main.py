from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

from .api import auth as auth_api
from .api import jobs, push, system, ytdlp
from .api.auth import require_auth
from .auth import AuthManager
from .config import Settings
from .db import Database
from .events import EventBroker
from .repository import JobRepo
from .services.downloader import Downloader, SubprocessDownloader
from .services.push import PushNotifier, job_payload
from .services.worker import JobWorker
from .services.ytdlp_manager import UpdateError, YtDlpManager

log = logging.getLogger("app")


def create_app(
    settings: Settings | None = None,
    downloader: Downloader | None = None,
    push_notifier: PushNotifier | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings.ensure_dirs()
        db = Database(settings.db_path)
        repo = JobRepo(db)
        broker = EventBroker()
        broker.bind_loop(asyncio.get_running_loop())
        manager = YtDlpManager(settings.ytdlp_dir, smoke_url=settings.smoke_url)
        dl = downloader or SubprocessDownloader(manager)
        notifier = push_notifier or PushNotifier(
            db, settings.vapid_key_path, subject=settings.vapid_subject,
            extra_hosts=settings.push_extra_hosts,
        )  # fmt: skip

        def on_finished(job: dict) -> None:
            payload = job_payload(job)
            if payload:
                notifier.notify(payload)

        worker = JobWorker(
            repo, dl, broker, settings,
            recovery=lambda: manager.auto_update and manager.update_if_newer(),
            on_finished=on_finished,
        )  # fmt: skip

        recovered = repo.reset_running_to_queued()
        if recovered:
            log.warning("Đưa %d job dở dang về hàng đợi sau khi khởi động lại", recovered)

        app.state.settings = settings
        app.state.db = db
        app.state.repo = repo
        app.state.broker = broker
        app.state.downloader = dl
        app.state.worker = worker
        app.state.ytdlp = manager
        app.state.push = notifier
        app.state.auth = AuthManager(settings, db)
        app.state.background_tasks = set()
        await worker.start()
        worker.wake()
        checker = asyncio.create_task(_periodic_check(manager, broker, settings))
        maintenance = asyncio.create_task(_maintenance(repo, broker, settings))
        try:
            yield
        finally:
            checker.cancel()
            maintenance.cancel()
            for task in list(app.state.background_tasks):
                task.cancel()
            await asyncio.gather(checker, maintenance, return_exceptions=True)
            await worker.stop()
            notifier.shutdown()
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

    protected = [Depends(require_auth)]
    app.include_router(auth_api.router)
    app.include_router(system.public_router)
    app.include_router(system.router, dependencies=protected)
    app.include_router(jobs.router, dependencies=protected)
    app.include_router(ytdlp.router, dependencies=protected)
    app.include_router(push.router, dependencies=protected)
    _mount_frontend(app, settings.static_dir)
    return app


async def _periodic_check(
    manager: YtDlpManager, broker: EventBroker, settings: Settings, first_delay: float = 60.0
) -> None:
    """Mỗi ``update_check_hours`` giờ: kiểm tra bản mới, tự cập nhật nếu được bật."""
    if settings.update_check_hours <= 0:
        return
    delay = first_delay
    while True:
        await asyncio.sleep(delay)
        delay = settings.update_check_hours * 3600
        try:
            await asyncio.to_thread(manager.check_latest)
            if manager.auto_update and manager.status()["update_available"]:
                await asyncio.to_thread(manager.update)
        except UpdateError as exc:
            log.warning("Kiểm tra/cập nhật yt-dlp: %s", exc)
        except Exception:
            log.exception("Lỗi khi kiểm tra yt-dlp định kỳ")
        broker.publish({"type": "ytdlp", "status": await asyncio.to_thread(manager.status)})


async def _maintenance(
    repo: JobRepo, broker: EventBroker, settings: Settings, first_delay: float = 30.0
) -> None:
    """Định kỳ: dọn file cũ/mồ côi, và sao lưu cơ sở dữ liệu mỗi ``backup_interval_hours`` giờ."""
    from .schemas import job_to_out
    from .services.backup import backup_database, latest_backup_age
    from .services.cleanup import run_cleanup

    await asyncio.sleep(first_delay)
    while True:
        try:
            result = await asyncio.to_thread(run_cleanup, settings, repo)
            for job_id in result.job_ids:
                job = repo.get(job_id)
                if job:
                    broker.publish({"type": "job", "job": job_to_out(job)})
            if settings.backup_interval_hours > 0:
                age = latest_backup_age(settings.backup_dir)
                if age is None or age >= settings.backup_interval_hours * 3600:
                    await asyncio.to_thread(
                        backup_database, settings.db_path, settings.backup_dir, settings.backup_keep
                    )
        except Exception:
            log.exception("Lỗi khi bảo trì định kỳ")
        if settings.cleanup_interval_min <= 0:
            return
        await asyncio.sleep(settings.cleanup_interval_min * 60)


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
