"""Small password-backed session for a personal, single-user deployment."""

import hashlib
import hmac
import os
import secrets
import time

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel


router = APIRouter(prefix="/api/auth", tags=["auth"])
COOKIE_NAME = "stopwatch_session"
SESSION_SECONDS = 7 * 24 * 60 * 60


def password() -> str | None:
    return os.getenv("APP_PASSWORD") or None


def session_secret() -> str:
    return os.getenv("APP_SESSION_SECRET") or ""


def authenticated(request: Request) -> bool:
    if not password():
        return True
    token = request.cookies.get(COOKIE_NAME, "")
    try:
        expires_text, signature = token.split(".", 1)
        expires = int(expires_text)
    except (ValueError, TypeError):
        return False
    if expires <= time.time():
        return False
    expected = hmac.new(
        session_secret().encode(), expires_text.encode(), hashlib.sha256
    ).hexdigest()
    return secrets.compare_digest(signature, expected)


class LoginRequest(BaseModel):
    password: str


@router.get("/session")
def session(request: Request):
    return {"authenticated": authenticated(request), "enabled": bool(password())}


@router.post("/login")
def login(payload: LoginRequest, response: Response):
    configured = password()
    if not configured or not secrets.compare_digest(payload.password, configured):
        raise HTTPException(status_code=401, detail="Incorrect password")
    expires = str(int(time.time()) + SESSION_SECONDS)
    signature = hmac.new(
        session_secret().encode(), expires.encode(), hashlib.sha256
    ).hexdigest()
    response.set_cookie(
        COOKIE_NAME,
        f"{expires}.{signature}",
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=os.getenv("APP_ENV") == "production",
        samesite="strict",
        path="/api",
    )
    return {"authenticated": True, "enabled": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/api")
    return {"authenticated": False, "enabled": bool(password())}
