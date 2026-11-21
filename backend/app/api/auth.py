from __future__ import annotations

import asyncio
from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..auth import COOKIE_NAME, AuthManager

router = APIRouter(prefix="/api/auth", tags=["auth"])
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_auth(request: Request) -> AuthManager:
    return request.app.state.auth


def client_ip(request: Request, trust_proxy: bool) -> str:
    if trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[-1].strip()  # phần tử do proxy tin cậy của mình thêm vào
    return request.client.host if request.client else "unknown"


def _unauthorized() -> HTTPException:
    return HTTPException(401, {"code": "unauthorized", "message": "Cần đăng nhập"})


def _same_origin(request: Request) -> bool:
    origin = request.headers.get("origin")
    if not origin:
        return True  # không phải trình duyệt gửi chéo trang (cùng trang hoặc công cụ như curl)
    host = request.headers.get("host", "")
    return urlparse(origin).netloc == host


async def require_auth(request: Request) -> None:
    """Dependency bảo vệ API: session cookie (kèm kiểm tra Origin) hoặc Bearer token."""
    auth: AuthManager = request.app.state.auth
    if not auth.enabled:
        return
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        if await asyncio.to_thread(auth.check_api_token, header[7:].strip()):
            return
        raise _unauthorized()
    if auth.check_session(request.cookies.get(COOKIE_NAME)):
        if request.method not in SAFE_METHODS and not _same_origin(request):
            raise HTTPException(
                403, {"code": "bad_origin", "message": "Yêu cầu chéo trang bị chặn"}
            )
        return
    raise _unauthorized()


class LoginBody(BaseModel):
    password: str = Field(max_length=500)


class TokenBody(BaseModel):
    name: str = Field(default="Token", max_length=80)


@router.get("/status")
async def status(request: Request, auth: Annotated[AuthManager, Depends(get_auth)]):
    authenticated = (not auth.enabled) or auth.check_session(request.cookies.get(COOKIE_NAME))
    return {"required": auth.enabled, "authenticated": bool(authenticated)}


@router.post("/login")
async def login(
    body: LoginBody,
    request: Request,
    response: Response,
    auth: Annotated[AuthManager, Depends(get_auth)],
):
    if not auth.enabled:
        return {"authenticated": True}
    ip = client_ip(request, auth.settings.trust_proxy)
    wait = auth.retry_after(ip)
    if wait:
        raise HTTPException(
            429,
            {
                "code": "rate_limited",
                "message": f"Thử sai quá nhiều lần. Chờ {wait} giây rồi thử lại.",
            },
            headers={"Retry-After": str(wait)},
        )
    ok = await asyncio.to_thread(auth.verify_password, body.password)
    if not ok:
        auth.record_failure(ip)
        await asyncio.sleep(0.4)  # làm chậm việc dò mật khẩu
        raise HTTPException(401, {"code": "bad_password", "message": "Sai mật khẩu"})
    auth.clear_failures(ip)
    token, max_age = auth.make_session()
    secure = auth.settings.cookie_secure
    if secure is None:
        proto = request.headers.get("x-forwarded-proto") if auth.settings.trust_proxy else None
        secure = (proto or request.url.scheme) == "https"
    response.set_cookie(
        COOKIE_NAME, token, max_age=max_age, httponly=True, samesite="lax", secure=secure, path="/"
    )
    return {"authenticated": True}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"authenticated": False}


@router.get("/tokens", dependencies=[Depends(require_auth)])
async def list_tokens(auth: Annotated[AuthManager, Depends(get_auth)]):
    return {"items": await asyncio.to_thread(auth.list_tokens)}


@router.post("/tokens", status_code=201, dependencies=[Depends(require_auth)])
async def create_token(body: TokenBody, auth: Annotated[AuthManager, Depends(get_auth)]):
    """Token chỉ hiển thị MỘT lần ở response này; server chỉ lưu bản băm."""
    return await asyncio.to_thread(auth.create_token, body.name)


@router.delete("/tokens/{token_id}", status_code=204, dependencies=[Depends(require_auth)])
async def revoke_token(token_id: str, auth: Annotated[AuthManager, Depends(get_auth)]):
    if not await asyncio.to_thread(auth.revoke_token, token_id):
        raise HTTPException(404, {"code": "not_found", "message": "Không tìm thấy token"})
