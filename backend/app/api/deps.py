from __future__ import annotations

from fastapi import Request

from ..config import Settings
from ..events import EventBroker
from ..repository import JobRepo
from ..services.downloader import Downloader
from ..services.worker import JobWorker


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_repo(request: Request) -> JobRepo:
    return request.app.state.repo


def get_worker(request: Request) -> JobWorker:
    return request.app.state.worker


def get_broker(request: Request) -> EventBroker:
    return request.app.state.broker


def get_downloader(request: Request) -> Downloader:
    return request.app.state.downloader
