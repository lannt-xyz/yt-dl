from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..services.push import InvalidSubscriptionError, PushNotifier

router = APIRouter(prefix="/api/push", tags=["push"])


def get_notifier(request: Request) -> PushNotifier:
    return request.app.state.push


Notifier = Annotated[PushNotifier, Depends(get_notifier)]


class Keys(BaseModel):
    p256dh: str
    auth: str


class SubscribeBody(BaseModel):
    endpoint: str
    keys: Keys


class EndpointBody(BaseModel):
    endpoint: str


@router.get("/key")
async def public_key(push: Notifier):
    return {"public_key": push.public_key}


@router.post("/subscribe", status_code=201)
async def subscribe(body: SubscribeBody, request: Request, push: Notifier):
    try:
        push.subscribe(
            body.endpoint, body.keys.p256dh, body.keys.auth, request.headers.get("user-agent")
        )
    except InvalidSubscriptionError as exc:
        raise HTTPException(422, {"code": "invalid_subscription", "message": str(exc)}) from exc
    return {"subscribed": True, "devices": push.count()}


@router.post("/status")
async def status(body: EndpointBody, push: Notifier):
    return {"subscribed": push.has(body.endpoint), "devices": push.count()}


@router.post("/unsubscribe")
async def unsubscribe(body: EndpointBody, push: Notifier):
    return {"removed": push.unsubscribe(body.endpoint), "devices": push.count()}


@router.post("/test")
async def test(push: Notifier):
    if push.count() == 0:
        raise HTTPException(
            409, {"code": "no_subscription", "message": "Chưa có thiết bị nào bật thông báo"}
        )
    sent = push.notify(
        {
            "title": "Thông báo thử",
            "body": "Nếu bạn thấy dòng này, thông báo đang hoạt động.",
            "tag": "test",
            "url": "/",
            "icon": "/icons/icon-192.png",
        },
        wait=True,
    )
    return {"sent": sent, "devices": push.count()}
