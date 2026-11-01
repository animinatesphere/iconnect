import asyncio
import html
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Callable, Deque, Dict, List, Literal, Optional, Tuple
from urllib.parse import urlsplit
from uuid import UUID, uuid4
from fastapi import Depends, FastAPI, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from PIL.Image import DecompressionBombError
from pydantic import BaseModel, ConfigDict, Field, field_validator
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import Settings, load_settings
from .security import (
    create_email_code,
    create_session_token,
    hash_email_code,
    hash_password,
    hash_session_token,
    secure_hash_equals,
    verify_password,
)


LOGGER = logging.getLogger("iconnect.api")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9._]{3,30}$")
MAX_REQUEST_BYTES = 16 * 1024
AUTH_WINDOW_SECONDS = 15 * 60
AUTH_REQUEST_LIMIT = 10
SOCIAL_WINDOW_SECONDS = 15 * 60
SOCIAL_REQUEST_LIMIT = 60
MESSAGE_WINDOW_SECONDS = 15 * 60
MESSAGE_REQUEST_LIMIT = 120
MEDIA_UPLOAD_WINDOW_SECONDS = 15 * 60
MEDIA_UPLOAD_REQUEST_LIMIT = 30
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
MAX_IMAGES_PER_RECORD = 5
DEFAULT_MEDIA_DIRECTORY = Path(__file__).resolve().parents[2] / "uploads"
MIGRATION_PATH = Path(__file__).resolve().parents[1] / "migrations" / "001_initial.sql"


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class RegisterInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=10, max_length=128)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name is required.")
        return value

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Email is invalid.")
        return value


class LoginInput(StrictModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Email is invalid.")
        return value


class VerifyInput(StrictModel):
    email: str = Field(min_length=3, max_length=254)
    code: str = Field(pattern=r"^\d{6}$")

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Email is invalid.")
        return value


class ResendInput(StrictModel):
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Email is invalid.")
        return value


class ProfileInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    username: str = Field(min_length=3, max_length=30)
    bio: str = Field(max_length=120)
    interests: List[str]

    @field_validator("name", "bio")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("name")
    @classmethod
    def require_name(cls, value: str) -> str:
        if not value:
            raise ValueError("Name is required.")
        return value

    @field_validator("username")
    @classmethod
    def valid_username(cls, value: str) -> str:
        value = value.strip()
        if not USERNAME_PATTERN.fullmatch(value):
            raise ValueError("Username is invalid.")
        return value

    @field_validator("interests")
    @classmethod
    def valid_interests(cls, values: List[str]) -> List[str]:
        if len(values) > 10:
            raise ValueError("Choose no more than 10 interests.")
        cleaned = [value.strip() for value in values]
        if any(not value or len(value) > 32 for value in cleaned):
            raise ValueError("Interest length is invalid.")
        return cleaned


class SocialPostInput(StrictModel):
    text: str = Field(min_length=1, max_length=500)
    image_urls: List[str] = Field(default_factory=list, max_length=MAX_IMAGES_PER_RECORD)

    @field_validator("text")
    @classmethod
    def clean_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Post text is required.")
        return value

    @field_validator("image_urls")
    @classmethod
    def valid_image_urls(cls, values: List[str]) -> List[str]:
        return validate_image_urls(values)


class SocialCommentInput(StrictModel):
    text: str = Field(min_length=1, max_length=280)
    parent_comment_id: Optional[UUID] = None

    @field_validator("text")
    @classmethod
    def clean_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Comment text is required.")
        return value

    @field_validator("parent_comment_id", mode="before")
    @classmethod
    def parse_parent_comment_id(cls, value: Any) -> Optional[UUID]:
        if value is None or isinstance(value, UUID):
            return value
        if not isinstance(value, str):
            raise ValueError("Parent comment id is invalid.")
        try:
            return UUID(value)
        except ValueError as error:
            raise ValueError("Parent comment id is invalid.") from error


class SocialLikeInput(StrictModel):
    liked: bool


class SocialBookmarkInput(StrictModel):
    bookmarked: bool


class MarketplaceProductInput(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    category: Literal["Style", "Tech", "Home", "Other"]
    price: int = Field(ge=1, le=1_000_000_000)
    stock: int = Field(ge=0, le=1_000_000)
    description: str = Field(min_length=1, max_length=2000)
    image_url: Optional[str] = Field(default=None, max_length=2048)
    image_urls: List[str] = Field(default_factory=list, max_length=MAX_IMAGES_PER_RECORD)

    @field_validator("name", "description")
    @classmethod
    def clean_listing_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Product name and description are required.")
        return value

    @field_validator("image_url")
    @classmethod
    def valid_image_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = value.strip()
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("Product images must use an https URL.")
        return value

    @field_validator("image_urls")
    @classmethod
    def valid_image_urls(cls, values: List[str]) -> List[str]:
        return validate_image_urls(values)


class AdminMarketplaceProductInput(MarketplaceProductInput):
    published: bool = True


class AdminSubadminInput(StrictModel):
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Email is invalid.")
        return value


class AdminUserStatusInput(StrictModel):
    suspended: bool


def validate_image_urls(values: List[str]) -> List[str]:
    if len(values) > MAX_IMAGES_PER_RECORD:
        raise ValueError("Choose no more than five images.")
    cleaned = []
    for value in values:
        value = value.strip()
        if not value or len(value) > 2048:
            raise ValueError("Image URL is invalid.")
        if value.startswith("/api/media/images/"):
            filename = value.rsplit("/", 1)[-1]
            if not re.fullmatch(r"[a-f0-9]{32}\.webp", filename):
                raise ValueError("Uploaded image URL is invalid.")
        else:
            parsed = urlsplit(value)
            if parsed.scheme != "https" or not parsed.netloc:
                raise ValueError("Images must use an uploaded image or https URL.")
        cleaned.append(value)
    if len(set(cleaned)) != len(cleaned):
        raise ValueError("Image URLs must be unique.")
    return cleaned


class LocalMarketplaceListingInput(StrictModel):
    category: Literal["Homes", "Services", "Farm"]
    title: str = Field(min_length=1, max_length=120)
    price: str = Field(min_length=1, max_length=80)
    location: str = Field(min_length=1, max_length=120)
    detail: str = Field(min_length=1, max_length=280)
    description: str = Field(min_length=1, max_length=2000)
    image_url: Optional[str] = Field(default=None, max_length=2048)

    @field_validator("title", "price", "location", "detail", "description")
    @classmethod
    def clean_listing_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Listing details are required.")
        return value

    @field_validator("image_url")
    @classmethod
    def valid_image_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = value.strip()
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("Listing images must use an https URL.")
        return value


class CommunityInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=500)

    @field_validator("name", "description")
    @classmethod
    def clean_community_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Community name and description are required.")
        return value


class CommunityMembershipInput(StrictModel):
    joined: bool


class DirectConversationInput(StrictModel):
    recipient_id: UUID

    @field_validator("recipient_id", mode="before")
    @classmethod
    def parse_recipient_id(cls, value: Any) -> UUID:
        if isinstance(value, UUID):
            return value
        if not isinstance(value, str):
            raise ValueError("Recipient id is invalid.")
        try:
            return UUID(value)
        except ValueError as error:
            raise ValueError("Recipient id is invalid.") from error


class DirectMessageInput(StrictModel):
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def clean_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message text is required.")
        return value


class UserFollowInput(StrictModel):
    following: bool


class PrivacyPreferencesInput(StrictModel):
    profile_visible: bool
    discoverable: bool


class JobListingInput(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    company: str = Field(min_length=1, max_length=120)
    location: str = Field(min_length=1, max_length=120)
    employment_type: str = Field(min_length=1, max_length=40)
    workplace_type: Literal["remote", "hybrid", "onsite"]
    summary: str = Field(min_length=1, max_length=250)
    description: str = Field(min_length=1, max_length=5000)

    @field_validator("title", "company", "location", "employment_type", "summary", "description")
    @classmethod
    def clean_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field is required.")
        return value


class JobSaveInput(StrictModel):
    saved: bool


class JobApplicationInput(StrictModel):
    cover_letter: str = Field(default="", max_length=2000)

    @field_validator("cover_letter")
    @classmethod
    def clean_cover_letter(cls, value: str) -> str:
        return value.strip()


def public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(user["id"]),
        "name": user["display_name"],
        "username": user["username"],
        "email": user["email"],
        "bio": user["bio"],
        "interests": user["interests"],
        "profileVisible": user.get("profile_visible", True),
        "discoverable": user.get("discoverable", True),
    }


def _send_otp_email(
    email: str,
    name: str,
    code: str,
    settings: Settings,
    logger: logging.Logger,
) -> None:
    if not settings.resend_api_key and not settings.production:
        logger.info("Development email OTP for %s: %s", email, code)
        return
    if not settings.resend_api_key or not settings.email_from:
        raise RuntimeError("Email delivery is not configured.")

    safe_name = html.escape(name)
    email_html = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Your iConnect verification code</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4ef;font-family:Arial,Helvetica,sans-serif;color:#292b25;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your iConnect sign-in code is inside. It expires in 10 minutes.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4ef;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fffefa;border:1px solid #e8e8df;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:25px 32px;background:#25271f;color:#fffefa;">
            <div style="font-size:21px;font-weight:700;letter-spacing:-.5px;">iConnect<span style="color:#c6d89b;">.</span></div>
            <div style="padding-top:6px;color:#d4d5ca;font-size:12px;">A little more connection.</div>
          </td></tr>
          <tr><td style="padding:34px 32px 18px;">
            <div style="color:#788653;font-size:11px;font-weight:700;letter-spacing:1.5px;">EMAIL VERIFICATION</div>
            <h1 style="margin:12px 0 10px;font-size:25px;line-height:1.25;color:#292b25;">You’re almost home, {name}.</h1>
            <p style="margin:0;color:#66685e;font-size:15px;line-height:1.65;">Enter this one-time code to verify your email and finish setting up your iConnect account.</p>
          </td></tr>
          <tr><td style="padding:10px 32px 18px;">
            <div style="padding:21px 12px;border:1px solid #e5e9d8;border-radius:12px;background:#f5f7ee;text-align:center;">
              <div style="color:#77796e;font-size:10px;font-weight:700;letter-spacing:1.6px;">YOUR VERIFICATION CODE</div>
              <div style="padding-top:10px;color:#34382b;font-size:34px;font-weight:700;letter-spacing:9px;">{code}</div>
            </div>
          </td></tr>
          <tr><td style="padding:0 32px 30px;">
            <p style="margin:0;color:#77796e;font-size:13px;line-height:1.65;"><strong style="color:#494b43;">This code expires in 10 minutes.</strong><br>If you didn’t request it, you can safely ignore this email. Never share your code with anyone.</p>
          </td></tr>
          <tr><td style="padding:18px 32px;border-top:1px solid #eeeee7;background:#fafaf6;color:#85867d;font-size:11px;line-height:1.6;">
            Sent by iConnect to verify your email address.<br>iConnect · Social, made a little more human
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>""".format(name=safe_name, code=html.escape(code))
    payload = json.dumps({
        "from": settings.email_from,
        "to": [email],
        "subject": "Your iConnect verification code",
        "text": "Hi {}, your iConnect verification code is {}. It expires in 10 minutes.".format(name, code),
        "html": email_html,
    }).encode("utf-8")
    request = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": "Bearer {}".format(settings.resend_api_key),
            "Content-Type": "application/json",
            "User-Agent": "iConnect-API/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError("Resend rejected the verification email (HTTP {}).".format(response.status))
    except urllib.error.HTTPError as error:
        raise RuntimeError("Resend rejected the verification email (HTTP {}).".format(error.code)) from error


def create_app(
    settings: Optional[Settings] = None,
    pool: Optional[Any] = None,
    send_otp_email: Optional[Callable[[str, str, str], None]] = None,
    logger: logging.Logger = LOGGER,
    media_directory: Optional[Path] = None,
) -> FastAPI:
    settings = settings or load_settings()
    owns_pool = pool is None
    database = pool or ConnectionPool(
        conninfo=settings.database_url,
        min_size=1,
        max_size=10,
        kwargs={"row_factory": dict_row},
        open=False,
    )
    send_email = send_otp_email or (
        lambda email, name, code: _send_otp_email(email, name, code, settings, logger)
    )
    dummy_password_hash = hash_password("not-a-real-user-password")
    rate_limit_state: Dict[str, Deque[float]] = defaultdict(deque)
    rate_limit_lock = threading.Lock()
    social_rate_limit_state: Dict[str, Deque[float]] = defaultdict(deque)
    social_rate_limit_lock = threading.Lock()
    message_rate_limit_state: Dict[str, Deque[float]] = defaultdict(deque)
    message_rate_limit_lock = threading.Lock()
    media_upload_rate_limit_state: Dict[str, Deque[float]] = defaultdict(deque)
    media_upload_rate_limit_lock = threading.Lock()
    realtime_connections: Dict[
        str,
        Dict[int, Tuple[asyncio.AbstractEventLoop, asyncio.Queue[Dict[str, Any]]]],
    ] = defaultdict(dict)
    realtime_connections_lock = threading.Lock()
    configured_media_directory = media_directory or Path(os.getenv(
        "ICONNECT_MEDIA_DIR",
        str(DEFAULT_MEDIA_DIRECTORY),
    )).expanduser()
    uploads_directory = (
        configured_media_directory
        if configured_media_directory.is_absolute()
        else DEFAULT_MEDIA_DIRECTORY.parent / configured_media_directory
    )
    cookie_name = "__Host-iconnect.sid" if settings.production else "iconnect.sid"

    def publish_realtime(
        event: Dict[str, Any],
        user_ids: Optional[List[Any]] = None,
    ) -> None:
        normalized_user_ids = (
            {str(user_id) for user_id in user_ids}
            if user_ids is not None
            else None
        )
        with realtime_connections_lock:
            if normalized_user_ids is None:
                subscribers = [
                    subscriber
                    for user_subscribers in realtime_connections.values()
                    for subscriber in user_subscribers.values()
                ]
            else:
                subscribers = [
                    subscriber
                    for user_id in normalized_user_ids
                    for subscriber in realtime_connections.get(user_id, {}).values()
                ]
        for loop, queue in subscribers:
            def enqueue_event(target_queue: asyncio.Queue, payload: Dict[str, Any]) -> None:
                if target_queue.full():
                    while not target_queue.empty():
                        target_queue.get_nowait()
                    target_queue.put_nowait({"type": "sync"})
                else:
                    target_queue.put_nowait(payload)

            try:
                loop.call_soon_threadsafe(enqueue_event, queue, event)
            except RuntimeError:
                continue

    def register_realtime_connection(
        user_id: Any,
        connection_id: int,
        loop: asyncio.AbstractEventLoop,
        queue: asyncio.Queue[Dict[str, Any]],
    ) -> None:
        with realtime_connections_lock:
            realtime_connections[str(user_id)][connection_id] = (loop, queue)

    def unregister_realtime_connection(user_id: Any, connection_id: int) -> None:
        with realtime_connections_lock:
            user_subscribers = realtime_connections.get(str(user_id))
            if user_subscribers:
                user_subscribers.pop(connection_id, None)
                if not user_subscribers:
                    realtime_connections.pop(str(user_id), None)

    @asynccontextmanager
    async def lifespan(_application: FastAPI):
        if owns_pool:
            database.open()
            try:
                migration_sql = MIGRATION_PATH.read_text(encoding="utf-8")
                with database.connection() as connection:
                    connection.execute(migration_sql.encode("utf-8"), prepare=False)
                    connection.execute("SELECT 1")
            except Exception:
                database.close()
                raise
        yield
        if owns_pool:
            database.close()

    app = FastAPI(
        title="iConnect API",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content={"error": {"code": error.code, "message": error.message}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, _error: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "invalid_input", "message": "Check the information and try again."}},
        )

    @app.exception_handler(Exception)
    async def internal_error_handler(_request: Request, error: Exception) -> JSONResponse:
        logger.exception("API request failed: %s", error)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "The request could not be completed. Try again later.",
                },
            },
        )

    @app.middleware("http")
    async def apply_security_headers(request: Request, call_next: Callable[..., Any]) -> Response:
        origin = request.headers.get("origin")
        allowed_origins = {settings.app_origin}
        if not settings.production:
            allowed_origins.update({
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            })
        if origin and origin not in allowed_origins:
            return JSONResponse(
                status_code=403,
                content={"error": {"code": "origin_not_allowed", "message": "This request origin is not allowed."}},
            )
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                body_limit = (
                    MAX_IMAGE_BYTES
                    if request.url.path == "/api/media/images"
                    else MAX_REQUEST_BYTES
                )
                if int(content_length) > body_limit:
                    return JSONResponse(
                        status_code=413,
                        content={"error": {"code": "request_too_large", "message": "The request body is too large."}},
                    )
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content={"error": {"code": "invalid_input", "message": "Check the information and try again."}},
                )
        response = await call_next(request)
        if "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        if settings.production:
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
        return response

    def enforce_auth_rate_limit(request: Request) -> None:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        client_ip = (
            forwarded_for.split(",")[0].strip()
            if settings.trust_proxy and forwarded_for
            else request.client.host if request.client else "unknown"
        )
        now = time.monotonic()
        with rate_limit_lock:
            attempts = rate_limit_state[client_ip]
            while attempts and now - attempts[0] >= AUTH_WINDOW_SECONDS:
                attempts.popleft()
            if len(attempts) >= AUTH_REQUEST_LIMIT:
                raise ApiError(
                    429,
                    "rate_limited",
                    "Too many authentication attempts. Try again in 15 minutes.",
                )
            attempts.append(now)

    def enforce_social_rate_limit(request: Request) -> None:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        client_ip = (
            forwarded_for.split(",")[0].strip()
            if settings.trust_proxy and forwarded_for
            else request.client.host if request.client else "unknown"
        )
        now = time.monotonic()
        with social_rate_limit_lock:
            attempts = social_rate_limit_state[client_ip]
            while attempts and now - attempts[0] >= SOCIAL_WINDOW_SECONDS:
                attempts.popleft()
            if len(attempts) >= SOCIAL_REQUEST_LIMIT:
                raise ApiError(
                    429,
                    "rate_limited",
                    "You are posting too quickly. Please try again later.",
                )
            attempts.append(now)

    def enforce_message_rate_limit(request: Request) -> None:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        client_ip = (
            forwarded_for.split(",")[0].strip()
            if settings.trust_proxy and forwarded_for
            else request.client.host if request.client else "unknown"
        )
        now = time.monotonic()
        with message_rate_limit_lock:
            attempts = message_rate_limit_state[client_ip]
            while attempts and now - attempts[0] >= MESSAGE_WINDOW_SECONDS:
                attempts.popleft()
            if len(attempts) >= MESSAGE_REQUEST_LIMIT:
                raise ApiError(
                    429,
                    "rate_limited",
                    "You are sending messages too quickly. Please try again later.",
                )
            attempts.append(now)

    def enforce_media_upload_rate_limit(request: Request) -> None:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        client_ip = (
            forwarded_for.split(",")[0].strip()
            if settings.trust_proxy and forwarded_for
            else request.client.host if request.client else "unknown"
        )
        now = time.monotonic()
        with media_upload_rate_limit_lock:
            attempts = media_upload_rate_limit_state[client_ip]
            while attempts and now - attempts[0] >= MEDIA_UPLOAD_WINDOW_SECONDS:
                attempts.popleft()
            if len(attempts) >= MEDIA_UPLOAD_REQUEST_LIMIT:
                raise ApiError(
                    429,
                    "rate_limited",
                    "Too many image uploads. Please try again later.",
                )
            attempts.append(now)

    def social_post(connection: Any, post_id: Any, viewer_id: Any) -> Optional[Dict[str, Any]]:
        return connection.execute(
            """SELECT p.id, p.body, p.image_urls, p.created_at,
                      u.id AS author_id, u.display_name, u.username,
                      (SELECT count(*) FROM social_post_likes l WHERE l.post_id = p.id) AS like_count,
                      (SELECT count(*) FROM social_post_comments c WHERE c.post_id = p.id) AS comment_count,
                      EXISTS (
                          SELECT 1 FROM social_post_likes mine
                          WHERE mine.post_id = p.id AND mine.user_id = %s
                      ) AS liked_by_me,
                      EXISTS (
                          SELECT 1 FROM social_post_bookmarks mine
                          WHERE mine.post_id = p.id AND mine.user_id = %s
                      ) AS bookmarked_by_me
               FROM social_posts p
               JOIN users u ON u.id = p.user_id
               WHERE p.id = %s""",
            (viewer_id, viewer_id, post_id),
        ).fetchone()

    def public_social_post(row: Dict[str, Any], viewer_id: Any) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "text": row["body"],
            "imageUrls": row.get("image_urls") or [],
            "createdAt": row["created_at"].isoformat(),
            "isMine": str(row["author_id"]) == str(viewer_id),
            "author": {
                "id": str(row["author_id"]),
                "name": row["display_name"],
                "username": row["username"],
            },
            "likeCount": int(row["like_count"]),
            "commentCount": int(row["comment_count"]),
            "likedByMe": bool(row["liked_by_me"]),
            "bookmarkedByMe": bool(row["bookmarked_by_me"]),
        }

    def public_social_comment(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "text": row["body"],
            "createdAt": row["created_at"].isoformat(),
            "parentCommentId": (
                str(row["parent_comment_id"])
                if row.get("parent_comment_id")
                else None
            ),
            "author": {
                "id": str(row["author_id"]),
                "name": row["display_name"],
                "username": row["username"],
            },
        }

    def public_marketplace_product(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "name": row["name"],
            "category": row["category"],
            "price": int(row["price"]),
            "stock": int(row["stock"]),
            "description": row["description"],
            "imageUrl": (row.get("image_urls") or [row["image_url"]])[0],
            "imageUrls": row.get("image_urls") or ([row["image_url"]] if row["image_url"] else []),
            "createdAt": row["created_at"].isoformat(),
            "seller": {
                "id": str(row["seller_id"]),
                "name": row["seller_name"],
                "username": row["seller_username"],
            },
        }

    def public_local_marketplace_listing(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "category": row["category"],
            "title": row["title"],
            "price": row["price"],
            "location": row["location"],
            "detail": row["detail"],
            "description": row["description"],
            "imageUrl": row["image_url"],
            "createdAt": row["created_at"].isoformat(),
            "seller": {
                "id": str(row["seller_id"]),
                "name": row["seller_name"],
                "username": row["seller_username"],
            },
        }

    def public_community(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "name": row["name"],
            "description": row["description"],
            "memberCount": int(row["member_count"]),
            "joinedByMe": bool(row["joined_by_me"]),
            "createdAt": row["created_at"].isoformat(),
        }

    def community_record(connection: Any, community_id: UUID, viewer_id: Any) -> Optional[Dict[str, Any]]:
        return connection.execute(
            """SELECT c.id, c.name, c.description, c.created_at,
                      (SELECT count(*) FROM community_memberships members
                       WHERE members.community_id = c.id) AS member_count,
                      EXISTS (
                          SELECT 1 FROM community_memberships mine
                          WHERE mine.community_id = c.id AND mine.user_id = %s
                      ) AS joined_by_me
               FROM communities c
               WHERE c.id = %s""",
            (viewer_id, community_id),
        ).fetchone()

    def public_direct_message(row: Dict[str, Any], viewer_id: Any) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "text": row["body"],
            "createdAt": row["created_at"].isoformat(),
            "readAt": row["read_at"].isoformat() if row.get("read_at") else None,
            "isMine": str(row["sender_id"]) == str(viewer_id),
            "sender": {
                "id": str(row["sender_id"]),
                "name": row["display_name"],
                "username": row["username"],
            },
        }

    def public_discoverable_user(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "name": row["display_name"],
            "username": row["username"],
            "bio": row["bio"],
            "interests": row["interests"],
            "followerCount": int(row["follower_count"]),
            "followingCount": int(row["following_count"]),
            "followedByMe": bool(row["followed_by_me"]),
        }

    def public_job(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "title": row["title"],
            "company": row["company"],
            "location": row["location"],
            "employmentType": row["employment_type"],
            "workplaceType": row["workplace_type"],
            "summary": row["summary"],
            "description": row["description"],
            "createdAt": row["created_at"].isoformat(),
            "poster": {
                "name": row["display_name"],
                "username": row["username"],
            },
            "isSaved": bool(row["is_saved"]),
            "appliedByMe": bool(row["applied_by_me"]),
            "isOwner": bool(row["is_owner"]),
            "applicationCount": int(row["application_count"]),
            "applicationStatus": row["application_status"],
            "applicationCoverLetter": row["application_cover_letter"],
        }

    def issue_verification(user: Dict[str, Any]) -> bool:
        code = create_email_code()
        code_hash = hash_email_code(code, settings.otp_hash_secret)
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO email_verification_codes (user_id, code_hash, expires_at, sent_at, attempts)
                   VALUES (%s, %s, now() + interval '10 minutes', now(), 0)
                   ON CONFLICT (user_id) DO UPDATE
                   SET code_hash = EXCLUDED.code_hash,
                       expires_at = EXCLUDED.expires_at,
                       sent_at = EXCLUDED.sent_at,
                       attempts = 0
                   WHERE email_verification_codes.sent_at <= now() - interval '60 seconds'
                   RETURNING user_id""",
                (user["id"], code_hash),
            ).fetchone()
        if not inserted:
            return False
        try:
            send_email(user["email"], user["display_name"], code)
        except Exception:
            with database.connection() as connection:
                connection.execute(
                    "DELETE FROM email_verification_codes WHERE user_id = %s AND code_hash = %s",
                    (user["id"], code_hash),
                )
            raise
        return True

    def create_session(user_id: Any, request: Request, response: Response) -> None:
        token = create_session_token()
        token_hash = hash_session_token(token, settings.session_secret)
        expires_at = datetime.now(timezone.utc) + timedelta(days=settings.session_max_age_days)
        with database.connection() as connection:
            old_token = request.cookies.get(cookie_name)
            if old_token:
                connection.execute(
                    "DELETE FROM auth_sessions WHERE token_hash = %s",
                    (hash_session_token(old_token, settings.session_secret),),
                )
            connection.execute(
                "DELETE FROM auth_sessions WHERE expires_at <= now()",
            )
            connection.execute(
                "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
                (token_hash, user_id, expires_at),
            )
        response.set_cookie(
            cookie_name,
            token,
            max_age=settings.session_max_age_days * 24 * 60 * 60,
            httponly=True,
            secure=settings.production,
            samesite="lax",
            path="/",
        )

    def user_for_session(token: Optional[str]) -> Optional[Dict[str, Any]]:
        if not token:
            return None
        with database.connection() as connection:
            user = connection.execute(
                """SELECT u.id, u.display_name, u.username, u.email, u.bio, u.interests,
                       u.email_verified_at, u.profile_visible, u.discoverable, u.suspended_at
                   FROM auth_sessions s
                   JOIN users u ON u.id = s.user_id
                   WHERE s.token_hash = %s AND s.expires_at > now()
                     AND u.email_verified_at IS NOT NULL
                     AND u.suspended_at IS NULL""",
                (hash_session_token(token, settings.session_secret),),
            ).fetchone()
            return user

    def current_user(request: Request) -> Optional[Dict[str, Any]]:
        return user_for_session(request.cookies.get(cookie_name))

    def require_user(request: Request) -> Dict[str, Any]:
        user = current_user(request)
        if not user:
            raise ApiError(401, "not_authenticated", "Sign in to continue.")
        return user

    @app.websocket("/api/realtime")
    async def realtime_socket(websocket: WebSocket) -> None:
        origin = websocket.headers.get("origin")
        allowed_origins = {settings.app_origin}
        if not settings.production:
            allowed_origins.update({
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            })
        if origin and origin not in allowed_origins:
            await websocket.close(code=1008)
            return
        user = await asyncio.to_thread(
            user_for_session,
            websocket.cookies.get(cookie_name),
        )
        if not user:
            await websocket.close(code=1008)
            return

        await websocket.accept()
        connection_id = id(websocket)
        event_queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=100)
        register_realtime_connection(
            user["id"],
            connection_id,
            asyncio.get_running_loop(),
            event_queue,
        )
        try:
            await websocket.send_json({"type": "connected"})
            while True:
                try:
                    event = await asyncio.wait_for(event_queue.get(), timeout=25)
                except asyncio.TimeoutError:
                    await websocket.send_json({"type": "ping"})
                    continue
                await websocket.send_json(event)
        except WebSocketDisconnect:
            pass
        finally:
            unregister_realtime_connection(user["id"], connection_id)

    def require_admin(request: Request) -> Dict[str, Any]:
        user = require_user(request)
        if user["email"].strip().lower() in settings.admin_emails:
            return {**user, "role": "super_admin"}
        with database.connection() as connection:
            role = connection.execute(
                "SELECT user_id FROM admin_roles WHERE user_id = %s",
                (user["id"],),
            ).fetchone()
        if not role:
            raise ApiError(403, "admin_required", "This account is not authorized to access admin tools.")
        return {**user, "role": "sub_admin"}

    def require_super_admin(request: Request) -> Dict[str, Any]:
        admin = require_admin(request)
        if admin["role"] != "super_admin":
            raise ApiError(403, "super_admin_required", "Only a super administrator can manage administrator roles.")
        return admin

    @app.post("/api/media/images", status_code=201)
    async def upload_image(
        request: Request,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, str]:
        enforce_media_upload_rate_limit(request)
        media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        formats = {
            "image/jpeg": "JPEG",
            "image/png": "PNG",
            "image/webp": "WEBP",
        }
        expected_format = formats.get(media_type)
        if not expected_format:
            raise ApiError(400, "invalid_image", "Choose a JPEG, PNG, or WebP image.")

        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > MAX_IMAGE_BYTES:
                raise ApiError(413, "image_too_large", "Each image must be 4 MB or smaller.")
        try:
            original_bytes = bytes(content)
            source = Image.open(BytesIO(original_bytes))
            if source.format != expected_format:
                raise ApiError(400, "invalid_image", "The uploaded image does not match its content type.")
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise ApiError(400, "invalid_image", "Images must be 20 megapixels or smaller.")
            source.verify()

            source = Image.open(BytesIO(original_bytes))
            source.load()
            source = ImageOps.exif_transpose(source)
            source.thumbnail((1920, 1920), Image.Resampling.LANCZOS)
            has_alpha = "A" in source.getbands() or "transparency" in source.info
            normalized = source.convert("RGBA" if has_alpha else "RGB")
            output = BytesIO()
            normalized.save(output, format="WEBP", quality=82, method=5)
            image_bytes = output.getvalue()
            if len(image_bytes) > MAX_IMAGE_BYTES:
                source = Image.open(BytesIO(original_bytes))
                source.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
                normalized = source.convert("RGBA" if has_alpha else "RGB")
                output = BytesIO()
                normalized.save(output, format="WEBP", quality=70, method=5)
                image_bytes = output.getvalue()
            if len(image_bytes) > MAX_IMAGE_BYTES:
                raise ApiError(413, "image_too_large", "The optimized image is still larger than 4 MB.")
        except ApiError:
            raise
        except (UnidentifiedImageError, OSError, DecompressionBombError) as error:
            raise ApiError(400, "invalid_image", "The uploaded file is not a valid supported image.") from error

        filename = uuid4().hex + ".webp"
        try:
            await asyncio.to_thread(uploads_directory.mkdir, parents=True, exist_ok=True)
            await asyncio.to_thread((uploads_directory / filename).write_bytes, image_bytes)
        except OSError as error:
            logger.exception("Could not save an uploaded image for user %s", user["id"])
            raise ApiError(500, "media_unavailable", "The image could not be saved. Try again later.") from error
        return {"url": "/api/media/images/{}".format(filename)}

    @app.get("/api/media/images/{filename}")
    def get_uploaded_image(filename: str, request: Request) -> Response:
        require_user(request)
        if not re.fullmatch(r"[a-f0-9]{32}\.webp", filename):
            raise ApiError(404, "image_not_found", "That image could not be found.")
        image_path = uploads_directory / filename
        if not image_path.is_file():
            raise ApiError(404, "image_not_found", "That image could not be found.")
        return FileResponse(
            image_path,
            media_type="image/webp",
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )

    @app.get("/api/health")
    def health() -> Dict[str, str]:
        with database.connection() as connection:
            connection.execute("SELECT 1")
        return {"status": "ok"}

    @app.post("/api/auth/register", status_code=202, dependencies=[Depends(enforce_auth_rate_limit)])
    def register(input: RegisterInput) -> Dict[str, str]:
        password_hash = hash_password(input.password)
        email_prefix = re.sub(r"[^a-zA-Z0-9._]", "", input.email.split("@")[0])[:30]
        username = email_prefix if len(email_prefix) >= 3 else ("user" + email_prefix)[:30]
        with database.connection() as connection:
            user = connection.execute(
                """INSERT INTO users (display_name, username, email, password_hash)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (email) DO NOTHING
                   RETURNING id, display_name, email""",
                (input.name, username, input.email, password_hash),
            ).fetchone()
        if user:
            issue_verification(user)
        return {"message": "If this address can be registered, a verification code has been sent."}

    @app.post("/api/auth/resend-verification", status_code=202, dependencies=[Depends(enforce_auth_rate_limit)])
    def resend_verification(input: ResendInput) -> Dict[str, str]:
        with database.connection() as connection:
            user = connection.execute(
                """SELECT id, display_name, email FROM users
                   WHERE email = %s AND email_verified_at IS NULL""",
                (input.email,),
            ).fetchone()
        if user:
            issue_verification(user)
        return {"message": "If the address is awaiting verification, a code has been sent."}

    @app.post("/api/auth/verify-email", dependencies=[Depends(enforce_auth_rate_limit)])
    def verify_email(input: VerifyInput, request: Request, response: Response) -> Dict[str, Any]:
        user = None
        invalid_code = False
        with database.connection() as connection:
            with connection.transaction():
                row = connection.execute(
                    """SELECT u.id, u.display_name, u.username, u.email, u.bio, u.interests,
                              v.code_hash, v.expires_at, v.attempts
                       FROM users u
                       JOIN email_verification_codes v ON v.user_id = u.id
                       WHERE u.email = %s AND u.email_verified_at IS NULL
                       FOR UPDATE OF u, v""",
                    (input.email,),
                ).fetchone()
                if not row:
                    invalid_code = True
                elif row["attempts"] >= 5 or row["expires_at"] <= datetime.now(timezone.utc):
                    connection.execute(
                        "DELETE FROM email_verification_codes WHERE user_id = %s",
                        (row["id"],),
                    )
                    invalid_code = True
                elif not secure_hash_equals(
                    hash_email_code(input.code, settings.otp_hash_secret),
                    row["code_hash"],
                ):
                    connection.execute(
                        "UPDATE email_verification_codes SET attempts = attempts + 1 WHERE user_id = %s",
                        (row["id"],),
                    )
                    invalid_code = True
                else:
                    connection.execute(
                        "UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = %s",
                        (row["id"],),
                    )
                    connection.execute(
                        "DELETE FROM email_verification_codes WHERE user_id = %s",
                        (row["id"],),
                    )
                    user = row
        if invalid_code or not user:
            raise ApiError(
                400,
                "invalid_code",
                "That code is invalid or expired. Request a new one and try again.",
            )
        create_session(user["id"], request, response)
        return {"user": public_user(user)}

    @app.post("/api/auth/login", dependencies=[Depends(enforce_auth_rate_limit)])
    def login(input: LoginInput, request: Request, response: Response) -> Dict[str, Any]:
        with database.connection() as connection:
            user = connection.execute(
                """SELECT id, display_name, username, email, bio, interests,
                          profile_visible, discoverable,
                          password_hash, email_verified_at, suspended_at
                   FROM users WHERE email = %s""",
                (input.email,),
            ).fetchone()
        password_valid = verify_password(
            input.password,
            user["password_hash"] if user else dummy_password_hash,
        )
        if not user or not password_valid:
            raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")
        if not user["email_verified_at"]:
            raise ApiError(403, "email_not_verified", "Verify your email address before signing in.")
        if user["suspended_at"] is not None:
            raise ApiError(403, "account_suspended", "This account is currently suspended.")
        create_session(user["id"], request, response)
        return {"user": public_user(user)}

    @app.post("/api/admin/login", dependencies=[Depends(enforce_auth_rate_limit)])
    def admin_login(input: LoginInput, request: Request, response: Response) -> Dict[str, Any]:
        with database.connection() as connection:
            user = connection.execute(
                """SELECT id, display_name, username, email, bio, interests,
                          profile_visible, discoverable,
                          password_hash, email_verified_at, suspended_at
                   FROM users WHERE email = %s""",
                (input.email,),
            ).fetchone()
        password_valid = verify_password(
            input.password,
            user["password_hash"] if user else dummy_password_hash,
        )
        if not user or not password_valid:
            raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")
        if not user["email_verified_at"]:
            raise ApiError(403, "email_not_verified", "Verify your email address before signing in.")
        if user["suspended_at"] is not None:
            raise ApiError(403, "account_suspended", "This account is currently suspended.")
        role = None
        if user["email"].strip().lower() not in settings.admin_emails:
            with database.connection() as connection:
                role = connection.execute(
                    "SELECT user_id FROM admin_roles WHERE user_id = %s",
                    (user["id"],),
                ).fetchone()
        if user["email"].strip().lower() not in settings.admin_emails and not role:
            raise ApiError(403, "admin_required", "This account is not authorized to access admin tools.")
        admin_role = (
            "super_admin"
            if user["email"].strip().lower() in settings.admin_emails
            else "sub_admin"
        )
        create_session(user["id"], request, response)
        return {
            "admin": {
                "id": str(user["id"]),
                "name": user["display_name"],
                "email": user["email"],
                "role": admin_role,
            },
        }

    @app.get("/api/auth/me")
    def get_current_user(request: Request) -> Dict[str, Any]:
        return {"user": public_user(require_user(request))}

    @app.put("/api/auth/preferences")
    def update_privacy_preferences(
        input: PrivacyPreferencesInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            updated = connection.execute(
                """UPDATE users
                   SET profile_visible = %s,
                       discoverable = %s,
                       updated_at = now()
                   WHERE id = %s AND email_verified_at IS NOT NULL
                   RETURNING profile_visible, discoverable""",
                (input.profile_visible, input.discoverable, user["id"]),
            ).fetchone()
        if not updated:
            raise ApiError(401, "not_authenticated", "Sign in to continue.")
        return {
            "preferences": {
                "profileVisible": updated["profile_visible"],
                "discoverable": updated["discoverable"],
            },
        }

    @app.put("/api/auth/profile")
    def update_profile(input: ProfileInput, request: Request) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            updated = connection.execute(
                """UPDATE users
                   SET display_name = %s, username = %s, bio = %s, interests = %s, updated_at = now()
                   WHERE id = %s AND email_verified_at IS NOT NULL
                   RETURNING id, display_name, username, email, bio, interests,
                             profile_visible, discoverable""",
                (input.name, input.username, input.bio, input.interests, user["id"]),
            ).fetchone()
        if not updated:
            raise ApiError(401, "not_authenticated", "Sign in to continue.")
        return {"user": public_user(updated)}

    @app.post("/api/auth/logout", status_code=204)
    def logout(request: Request, response: Response) -> Response:
        token = request.cookies.get(cookie_name)
        if token:
            with database.connection() as connection:
                connection.execute(
                    "DELETE FROM auth_sessions WHERE token_hash = %s",
                    (hash_session_token(token, settings.session_secret),),
                )
        response.delete_cookie(
            cookie_name,
            httponly=True,
            secure=settings.production,
            samesite="lax",
            path="/",
        )
        response.status_code = 204
        return response

    @app.get("/api/admin/me")
    def get_admin_session(admin: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
        return {
            "admin": {
                "id": str(admin["id"]),
                "name": admin["display_name"],
                "email": admin["email"],
                "role": admin["role"],
            },
        }

    @app.get("/api/admin/subadmins")
    def list_admin_subadmins(
        _admin: Dict[str, Any] = Depends(require_super_admin),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT u.id, u.display_name, u.email, roles.created_at,
                          creator.display_name AS created_by_name
                   FROM admin_roles roles
                   JOIN users u ON u.id = roles.user_id
                   JOIN users creator ON creator.id = roles.created_by
                   ORDER BY roles.created_at DESC, u.id""",
            ).fetchall()
        return {
            "superAdmins": sorted(settings.admin_emails),
            "subAdmins": [
                {
                    "id": str(row["id"]),
                    "name": row["display_name"],
                    "email": row["email"],
                    "createdAt": row["created_at"].isoformat(),
                    "createdBy": row["created_by_name"],
                }
                for row in rows
            ],
        }

    @app.post("/api/admin/subadmins", status_code=201)
    def create_admin_subadmin(
        input: AdminSubadminInput,
        admin: Dict[str, Any] = Depends(require_super_admin),
    ) -> Dict[str, Any]:
        if input.email in settings.admin_emails:
            raise ApiError(409, "admin_already_exists", "This account is already a super administrator.")
        with database.connection() as connection:
            user = connection.execute(
                """SELECT id, display_name, email, email_verified_at
                   FROM users WHERE lower(email) = %s""",
                (input.email,),
            ).fetchone()
            if not user:
                raise ApiError(404, "user_not_found", "Register and verify this account before granting admin access.")
            if not user["email_verified_at"]:
                raise ApiError(409, "email_not_verified", "Verify this account’s email before granting admin access.")
            existing = connection.execute(
                "SELECT user_id FROM admin_roles WHERE user_id = %s",
                (user["id"],),
            ).fetchone()
            if existing:
                raise ApiError(409, "admin_already_exists", "This account is already a sub-admin.")
            connection.execute(
                "INSERT INTO admin_roles (user_id, created_by) VALUES (%s, %s)",
                (user["id"], admin["id"]),
            )
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, subject_user_id, action, details)
                   VALUES (%s, %s, 'grant_subadmin', %s::jsonb)""",
                (admin["id"], user["id"], json.dumps({"email": user["email"]})),
            )
        return {
            "subAdmin": {
                "id": str(user["id"]),
                "name": user["display_name"],
                "email": user["email"],
            },
        }

    @app.delete("/api/admin/subadmins/{user_id}", status_code=204)
    def delete_admin_subadmin(
        user_id: UUID,
        admin: Dict[str, Any] = Depends(require_super_admin),
    ) -> Response:
        with database.connection() as connection:
            removed = connection.execute(
                """DELETE FROM admin_roles roles
                   USING users u
                   WHERE roles.user_id = %s AND u.id = roles.user_id
                     AND lower(u.email) <> ALL(%s)
                   RETURNING roles.user_id, u.email""",
                (user_id, list(settings.admin_emails)),
            ).fetchone()
            if not removed:
                raise ApiError(404, "subadmin_not_found", "That sub-admin could not be found.")
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, subject_user_id, action, details)
                   VALUES (%s, %s, 'revoke_subadmin', %s::jsonb)""",
                (admin["id"], user_id, json.dumps({"email": removed["email"]})),
            )
        return Response(status_code=204)

    @app.get("/api/admin/content")
    def list_admin_content(
        content_type: Literal["posts", "comments", "products", "local_listings", "jobs", "communities"] = Query(alias="type"),
        query: Optional[str] = Query(default=None, max_length=80),
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
        _admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        normalized_query = (query or "").strip().lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        escaped_query = (
            normalized_query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        pattern = "%" + escaped_query + "%" if escaped_query else None
        definitions = {
            "posts": (
                "social_posts p JOIN users u ON u.id = p.user_id",
                "p.id, p.body AS title, u.display_name AS owner, p.created_at, p.image_urls AS image_urls, TRUE AS published",
                "lower(p.body) LIKE %s ESCAPE E'\\\\' OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'",
                "social_posts",
            ),
            "comments": (
                "social_post_comments c JOIN users u ON u.id = c.user_id JOIN social_posts p ON p.id = c.post_id",
                "c.id, c.body AS title, u.display_name AS owner, c.created_at, '{}'::text[] AS image_urls, TRUE AS published",
                "lower(c.body) LIKE %s ESCAPE E'\\\\' OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'",
                "social_post_comments",
            ),
            "products": (
                "marketplace_products p JOIN users u ON u.id = p.seller_id",
                "p.id, p.name AS title, p.description, p.category, p.price, p.stock, p.image_url, u.display_name AS owner, p.created_at, COALESCE(NULLIF(p.image_urls, '{}'::text[]), CASE WHEN p.image_url IS NOT NULL THEN ARRAY[p.image_url]::text[] ELSE '{}'::text[] END) AS image_urls, p.published",
                "lower(p.name) LIKE %s ESCAPE E'\\\\' OR lower(p.description) LIKE %s ESCAPE E'\\\\' OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'",
                "marketplace_products",
            ),
            "local_listings": (
                "local_marketplace_listings p JOIN users u ON u.id = p.seller_id",
                "p.id, p.title, concat(p.category, ' · ', p.location, ' · ', p.price, ' · ', p.description) AS description, u.display_name AS owner, p.created_at, ARRAY[]::text[] AS image_urls, p.published",
                "lower(p.title) LIKE %s ESCAPE E'\\\\' OR lower(p.description) LIKE %s ESCAPE E'\\\\' OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'",
                "local_marketplace_listings",
            ),
            "jobs": (
                "job_listings p JOIN users u ON u.id = p.user_id",
                "p.id, p.title, concat(p.company, ' · ', p.location, ' · ', p.description) AS description, u.display_name AS owner, p.created_at, ARRAY[]::text[] AS image_urls, TRUE AS published",
                "lower(p.title) LIKE %s ESCAPE E'\\\\' OR lower(p.company) LIKE %s ESCAPE E'\\\\' OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'",
                "job_listings",
            ),
            "communities": (
                "communities p JOIN users u ON u.id = p.owner_id",
                "p.id, p.name AS title, p.description, u.display_name AS owner, p.created_at, ARRAY[]::text[] AS image_urls, TRUE AS published",
                "lower(p.name) LIKE %s ESCAPE E'\\\\' OR lower(p.description) LIKE %s ESCAPE E'\\\\' OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'",
                "communities",
            ),
        }
        source, fields, search_clause, _ = definitions[content_type]
        sort_alias = {
            "posts": "p",
            "comments": "c",
            "products": "p",
            "local_listings": "p",
            "jobs": "p",
            "communities": "p",
        }[content_type]
        where_clause = "WHERE %s::text IS NULL OR (" + search_clause + ")"
        parameters = (pattern, *([pattern] * search_clause.count("%s")))
        with database.connection() as connection:
            total = connection.execute(
                "SELECT count(*) AS total FROM {} {}".format(source, where_clause),
                parameters,
            ).fetchone()
            rows = connection.execute(
                "SELECT {} FROM {} {} ORDER BY {}.created_at DESC, {}.id DESC LIMIT %s OFFSET %s".format(
                    fields, source, where_clause, sort_alias, sort_alias
                ),
                (*parameters, limit, offset),
            ).fetchall()
        return {
            "items": [
                {
                    "id": str(row["id"]),
                    "title": row["title"],
                    "description": row.get("description", ""),
                    "owner": row["owner"],
                    "createdAt": row["created_at"].isoformat(),
                    "imageUrls": row.get("image_urls") or [],
                    "published": bool(row["published"]),
                    **(
                        {
                            "category": row["category"],
                            "price": int(row["price"]),
                            "stock": int(row["stock"]),
                            "imageUrl": row["image_url"],
                        }
                        if content_type == "products"
                        else {}
                    ),
                }
                for row in rows
            ],
            "total": int(total["total"]) if total else 0,
            "limit": limit,
            "offset": offset,
        }

    @app.delete("/api/admin/content/{content_type}/{content_id}", status_code=204)
    def delete_admin_content(
        content_type: Literal["posts", "comments", "products", "local_listings", "jobs", "communities"],
        content_id: UUID,
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Response:
        tables = {
            "posts": ("social_posts", "user_id"),
            "comments": ("social_post_comments", "user_id"),
            "products": ("marketplace_products", "seller_id"),
            "local_listings": ("local_marketplace_listings", "seller_id"),
            "jobs": ("job_listings", "user_id"),
            "communities": ("communities", "owner_id"),
        }
        table, owner_column = tables[content_type]
        with database.connection() as connection:
            removed = connection.execute(
                "DELETE FROM {} WHERE id = %s RETURNING {}, id".format(table, owner_column),
                (content_id,),
            ).fetchone()
            if not removed:
                raise ApiError(404, "content_not_found", "That content could not be found.")
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, subject_user_id, action, details)
                   VALUES (%s, %s, 'delete_content', %s::jsonb)""",
                (
                    admin["id"],
                    removed[owner_column],
                    json.dumps({"type": content_type, "id": str(removed["id"])}),
                ),
            )
        return Response(status_code=204)

    @app.put("/api/admin/products/{product_id}")
    def update_admin_product(
        product_id: UUID,
        input: AdminMarketplaceProductInput,
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        image_urls = input.image_urls or ([input.image_url] if input.image_url else [])
        with database.connection() as connection:
            updated = connection.execute(
                """UPDATE marketplace_products
                   SET name = %s, category = %s, price = %s, stock = %s,
                       description = %s, image_url = %s, image_urls = %s, published = %s
                   WHERE id = %s
                   RETURNING id""",
                (
                    input.name,
                    input.category,
                    input.price,
                    input.stock,
                    input.description,
                    input.image_url or (image_urls[0] if image_urls else None),
                    image_urls,
                    input.published,
                    product_id,
                ),
            ).fetchone()
            if not updated:
                raise ApiError(404, "product_not_found", "That product could not be found.")
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, action, details)
                   VALUES (%s, 'update_product', %s::jsonb)""",
                (admin["id"], json.dumps({"productId": str(product_id), "published": input.published})),
            )
        return {"productId": str(product_id), "published": input.published}

    @app.get("/api/admin/overview")
    def get_admin_overview(
        _admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            row = connection.execute(
                """SELECT
                       (SELECT count(*) FROM users) AS users,
                       (SELECT count(*) FROM users WHERE email_verified_at IS NOT NULL) AS verified_users,
                       (SELECT count(*) FROM social_posts) AS posts,
                       (SELECT count(*) FROM social_post_comments) AS comments,
                       (SELECT count(*) FROM social_post_likes) AS likes,
                       (SELECT count(*) FROM social_post_bookmarks) AS bookmarks,
                       (SELECT count(*) FROM direct_messages) AS messages,
                       (SELECT count(*) FROM marketplace_products) AS products,
                       (SELECT count(*) FROM local_marketplace_listings) AS local_listings,
                       (SELECT count(*) FROM job_listings) AS jobs,
                       (SELECT count(*) FROM job_applications) AS applications,
                       (SELECT count(*) FROM communities) AS communities,
                       (SELECT count(*) FROM community_memberships) AS memberships,
                       (SELECT count(*) FROM users WHERE created_at >= now() - interval '7 days') AS new_users_7d,
                       (SELECT count(*) FROM social_posts WHERE created_at >= now() - interval '7 days') AS new_posts_7d,
                       (SELECT count(*) FROM marketplace_products WHERE created_at >= now() - interval '7 days') AS new_products_7d,
                       (SELECT count(*) FROM job_listings WHERE created_at >= now() - interval '7 days') AS new_jobs_7d"""
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "Admin overview could not be loaded.")
        return {
            "overview": {
                "users": int(row["users"]),
                "verifiedUsers": int(row["verified_users"]),
                "posts": int(row["posts"]),
                "comments": int(row["comments"]),
                "likes": int(row["likes"]),
                "bookmarks": int(row["bookmarks"]),
                "messages": int(row["messages"]),
                "products": int(row["products"]),
                "localListings": int(row["local_listings"]),
                "jobs": int(row["jobs"]),
                "applications": int(row["applications"]),
                "communities": int(row["communities"]),
                "memberships": int(row["memberships"]),
                "newUsers7d": int(row["new_users_7d"]),
                "newPosts7d": int(row["new_posts_7d"]),
                "newProducts7d": int(row["new_products_7d"]),
                "newJobs7d": int(row["new_jobs_7d"]),
            },
        }

    @app.get("/api/admin/users")
    def list_admin_users(
        query: Optional[str] = Query(default=None, max_length=80),
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
        _admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        normalized_query = (query or "").strip().lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        escaped_query = (
            normalized_query
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        pattern = "%" + escaped_query + "%" if escaped_query else None
        with database.connection() as connection:
            total = connection.execute(
                """SELECT count(*) AS total
                   FROM users u
                   WHERE %s::text IS NULL
                      OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'
                      OR lower(u.username) LIKE %s ESCAPE E'\\\\'
                      OR lower(u.email) LIKE %s ESCAPE E'\\\\'""",
                (pattern, pattern, pattern, pattern),
            ).fetchone()
            rows = connection.execute(
                """SELECT u.id, u.display_name, u.username, u.email, u.bio,
                          u.interests, u.profile_visible, u.discoverable,
                          u.email_verified_at, u.suspended_at, u.created_at, u.updated_at,
                          (SELECT count(*) FROM social_posts p WHERE p.user_id = u.id) AS posts,
                          (SELECT count(*) FROM social_post_comments c WHERE c.user_id = u.id) AS comments,
                          (SELECT count(*) FROM direct_messages m
                           WHERE m.sender_id = u.id OR m.recipient_id = u.id) AS messages,
                          (SELECT count(*) FROM marketplace_products p WHERE p.seller_id = u.id) AS products,
                          (SELECT count(*) FROM local_marketplace_listings l WHERE l.seller_id = u.id) AS local_listings,
                          (SELECT count(*) FROM job_listings j WHERE j.user_id = u.id) AS jobs,
                          (SELECT count(*) FROM job_applications a WHERE a.applicant_id = u.id) AS applications
                   FROM users u
                   WHERE %s::text IS NULL
                      OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'
                      OR lower(u.username) LIKE %s ESCAPE E'\\\\'
                      OR lower(u.email) LIKE %s ESCAPE E'\\\\'
                   ORDER BY u.created_at DESC, u.id DESC
                   LIMIT %s OFFSET %s""",
                (pattern, pattern, pattern, pattern, limit, offset),
            ).fetchall()
        users = [
            {
                "id": str(user["id"]),
                "name": user["display_name"],
                "username": user["username"],
                "email": user["email"],
                "bio": user["bio"],
                "interests": user["interests"],
                "profileVisible": bool(user["profile_visible"]),
                "discoverable": bool(user["discoverable"]),
                "emailVerified": user["email_verified_at"] is not None,
                "suspended": user["suspended_at"] is not None,
                "createdAt": user["created_at"].isoformat(),
                "updatedAt": user["updated_at"].isoformat(),
                "counts": {
                    "posts": int(user["posts"]),
                    "comments": int(user["comments"]),
                    "messages": int(user["messages"]),
                    "products": int(user["products"]),
                    "localListings": int(user["local_listings"]),
                    "jobs": int(user["jobs"]),
                    "applications": int(user["applications"]),
                },
            }
            for user in rows
        ]
        return {
            "users": users,
            "total": int(total["total"]) if total else 0,
            "limit": limit,
            "offset": offset,
        }

    @app.post("/api/admin/users/{user_id}/suspension")
    def set_admin_user_suspension(
        user_id: UUID,
        input: AdminUserStatusInput,
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, bool]:
        if str(admin["id"]) == str(user_id):
            raise ApiError(409, "cannot_suspend_self", "You cannot suspend your own administrator account.")
        with database.connection() as connection:
            target = connection.execute(
                "SELECT id, email FROM users WHERE id = %s",
                (user_id,),
            ).fetchone()
            if not target:
                raise ApiError(404, "user_not_found", "That account could not be found.")
            if target["email"].strip().lower() in settings.admin_emails:
                raise ApiError(409, "cannot_suspend_admin", "Super-admin accounts cannot be suspended here.")
            target_admin = connection.execute(
                "SELECT user_id FROM admin_roles WHERE user_id = %s",
                (user_id,),
            ).fetchone()
            if target_admin:
                raise ApiError(409, "cannot_suspend_admin", "Administrator accounts cannot be suspended here.")
            if input.suspended:
                connection.execute(
                    "UPDATE users SET suspended_at = now(), updated_at = now() WHERE id = %s",
                    (user_id,),
                )
                connection.execute("DELETE FROM auth_sessions WHERE user_id = %s", (user_id,))
            else:
                connection.execute(
                    "UPDATE users SET suspended_at = NULL, updated_at = now() WHERE id = %s",
                    (user_id,),
                )
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, subject_user_id, action, details)
                   VALUES (%s, %s, 'update_user_status', %s::jsonb)""",
                (admin["id"], user_id, json.dumps({"suspended": input.suspended})),
            )
        return {"suspended": input.suspended}

    @app.get("/api/admin/users/{user_id}")
    def get_admin_user_details(
        user_id: UUID,
        limit: int = Query(default=100, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            user = connection.execute(
                """SELECT id, display_name, username, email, bio, interests,
                          profile_visible, discoverable, email_verified_at, suspended_at,
                          created_at, updated_at
                   FROM users
                   WHERE id = %s""",
                (user_id,),
            ).fetchone()
            if not user:
                raise ApiError(404, "user_not_found", "That account could not be found.")
            target_is_admin = user["email"].strip().lower() in settings.admin_emails
            if not target_is_admin:
                target_is_admin = connection.execute(
                    "SELECT user_id FROM admin_roles WHERE user_id = %s",
                    (user_id,),
                ).fetchone() is not None

            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, subject_user_id, action)
                   VALUES (%s, %s, 'view_user_details')""",
                (admin["id"], user_id),
            )
            counts = connection.execute(
                """SELECT
                       (SELECT count(*) FROM social_posts WHERE user_id = %s) AS posts,
                       (SELECT count(*) FROM social_post_comments WHERE user_id = %s) AS comments,
                       (SELECT count(*) FROM social_post_likes WHERE user_id = %s) AS likes,
                       (SELECT count(*) FROM social_post_bookmarks WHERE user_id = %s) AS bookmarks,
                       (SELECT count(*) FROM direct_messages
                        WHERE sender_id = %s OR recipient_id = %s) AS messages,
                       (SELECT count(*) FROM marketplace_products WHERE seller_id = %s) AS products,
                       (SELECT count(*) FROM local_marketplace_listings WHERE seller_id = %s) AS local_listings,
                       (SELECT count(*) FROM job_listings WHERE user_id = %s) AS jobs,
                       (SELECT count(*) FROM job_applications WHERE applicant_id = %s) AS applications,
                       (SELECT count(*) FROM communities WHERE owner_id = %s) AS communities_created,
                       (SELECT count(*) FROM community_memberships WHERE user_id = %s) AS communities_joined,
                       (SELECT count(*) FROM user_follows WHERE follower_id = %s) AS following,
                       (SELECT count(*) FROM user_follows WHERE following_id = %s) AS followers""",
                (user_id,) * 14,
            ).fetchone()
            posts = connection.execute(
                """SELECT p.id, p.body, p.image_urls, p.created_at,
                          (SELECT count(*) FROM social_post_likes l WHERE l.post_id = p.id) AS like_count,
                          (SELECT count(*) FROM social_post_comments c WHERE c.post_id = p.id) AS comment_count
                   FROM social_posts p WHERE p.user_id = %s
                   ORDER BY p.created_at DESC, p.id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            comments = connection.execute(
                """SELECT c.id, c.post_id, c.body, c.created_at, p.body AS post_text
                   FROM social_post_comments c
                   JOIN social_posts p ON p.id = c.post_id
                   WHERE c.user_id = %s
                   ORDER BY c.created_at DESC, c.id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            likes = connection.execute(
                """SELECT l.created_at, p.id AS post_id, p.body AS post_text,
                          author.display_name AS author_name, author.username AS author_username
                   FROM social_post_likes l
                   JOIN social_posts p ON p.id = l.post_id
                   JOIN users author ON author.id = p.user_id
                   WHERE l.user_id = %s
                   ORDER BY l.created_at DESC, p.id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            bookmarks = connection.execute(
                """SELECT b.created_at, p.id AS post_id, p.body AS post_text,
                          author.display_name AS author_name, author.username AS author_username
                   FROM social_post_bookmarks b
                   JOIN social_posts p ON p.id = b.post_id
                   JOIN users author ON author.id = p.user_id
                   WHERE b.user_id = %s
                   ORDER BY b.created_at DESC, p.id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            products = connection.execute(
                """SELECT id, name, category, price, stock, description, image_url, image_urls,
                          published, created_at
                   FROM marketplace_products WHERE seller_id = %s
                   ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            local_listings = connection.execute(
                """SELECT id, category, title, price, location, detail, description,
                          image_url, published, created_at
                   FROM local_marketplace_listings WHERE seller_id = %s
                   ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            jobs = connection.execute(
                """SELECT id, title, company, location, employment_type,
                          workplace_type, summary, description, created_at, updated_at
                   FROM job_listings WHERE user_id = %s
                   ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            applications = connection.execute(
                """SELECT a.id, a.job_id, a.cover_letter, a.status, a.created_at,
                          j.title AS job_title, j.company AS job_company
                   FROM job_applications a
                   JOIN job_listings j ON j.id = a.job_id
                   WHERE a.applicant_id = %s
                   ORDER BY a.created_at DESC, a.id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            communities_joined = connection.execute(
                """SELECT c.id, c.name, c.description, c.created_at AS joined_at,
                          (SELECT count(*) FROM community_memberships m
                           WHERE m.community_id = c.id) AS member_count
                   FROM community_memberships membership
                   JOIN communities c ON c.id = membership.community_id
                   WHERE membership.user_id = %s
                   ORDER BY membership.created_at DESC, c.id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            communities_created = connection.execute(
                """SELECT c.id, c.name, c.description, c.created_at,
                          (SELECT count(*) FROM community_memberships m
                           WHERE m.community_id = c.id) AS member_count
                   FROM communities c WHERE c.owner_id = %s
                   ORDER BY c.created_at DESC, c.id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            following = connection.execute(
                """SELECT followed.id, followed.display_name, followed.username, f.created_at
                   FROM user_follows f JOIN users followed ON followed.id = f.following_id
                   WHERE f.follower_id = %s
                   ORDER BY f.created_at DESC, followed.id LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            followers = connection.execute(
                """SELECT follower.id, follower.display_name, follower.username, f.created_at
                   FROM user_follows f JOIN users follower ON follower.id = f.follower_id
                   WHERE f.following_id = %s
                   ORDER BY f.created_at DESC, follower.id LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            messages = []
            if admin["role"] == "super_admin":
                messages = connection.execute(
                    """SELECT m.id, m.conversation_id, m.body, m.created_at, m.read_at,
                              sender.id AS sender_id, sender.display_name AS sender_name,
                              sender.username AS sender_username,
                              recipient.id AS recipient_id, recipient.display_name AS recipient_name,
                              recipient.username AS recipient_username
                       FROM direct_messages m
                       JOIN direct_conversations conversation ON conversation.id = m.conversation_id
                       JOIN users sender ON sender.id = m.sender_id
                       JOIN users recipient ON recipient.id = m.recipient_id
                       WHERE conversation.participant_one_id = %s
                          OR conversation.participant_two_id = %s
                       ORDER BY m.created_at DESC, m.id DESC LIMIT %s OFFSET %s""",
                    (user_id, user_id, limit, offset),
                ).fetchall()

        def timestamp(row: Dict[str, Any], key: str) -> Optional[str]:
            value = row[key]
            return value.isoformat() if value else None

        details = {
            "id": str(user["id"]),
            "name": user["display_name"],
            "username": user["username"],
            "email": user["email"],
            "role": admin["role"],
            "isAdmin": target_is_admin,
            "bio": user["bio"],
            "interests": user["interests"],
            "profileVisible": bool(user["profile_visible"]),
            "discoverable": bool(user["discoverable"]),
            "emailVerified": user["email_verified_at"] is not None,
            "suspended": user["suspended_at"] is not None,
            "emailVerifiedAt": timestamp(user, "email_verified_at"),
            "createdAt": timestamp(user, "created_at"),
            "updatedAt": timestamp(user, "updated_at"),
            "counts": {
                "posts": int(counts["posts"]),
                "comments": int(counts["comments"]),
                "likes": int(counts["likes"]),
                "bookmarks": int(counts["bookmarks"]),
                "messages": int(counts["messages"]),
                "products": int(counts["products"]),
                "localListings": int(counts["local_listings"]),
                "jobs": int(counts["jobs"]),
                "applications": int(counts["applications"]),
                "communitiesCreated": int(counts["communities_created"]),
                "communitiesJoined": int(counts["communities_joined"]),
                "following": int(counts["following"]),
                "followers": int(counts["followers"]),
            },
            "activity": {
                "posts": [
                    {"id": str(row["id"]), "text": row["body"], "imageUrls": row.get("image_urls") or [], "createdAt": timestamp(row, "created_at"), "likeCount": int(row["like_count"]), "commentCount": int(row["comment_count"])}
                    for row in posts
                ],
                "comments": [
                    {"id": str(row["id"]), "postId": str(row["post_id"]), "text": row["body"], "postText": row["post_text"], "createdAt": timestamp(row, "created_at")}
                    for row in comments
                ],
                "likes": [
                    {"postId": str(row["post_id"]), "postText": row["post_text"], "author": {"name": row["author_name"], "username": row["author_username"]}, "createdAt": timestamp(row, "created_at")}
                    for row in likes
                ],
                "bookmarks": [
                    {"postId": str(row["post_id"]), "postText": row["post_text"], "author": {"name": row["author_name"], "username": row["author_username"]}, "createdAt": timestamp(row, "created_at")}
                    for row in bookmarks
                ],
                "messages": [
                    {
                        "id": str(row["id"]),
                        "conversationId": str(row["conversation_id"]),
                        "text": row["body"],
                        "createdAt": timestamp(row, "created_at"),
                        "readAt": timestamp(row, "read_at"),
                        "sender": {"id": str(row["sender_id"]), "name": row["sender_name"], "username": row["sender_username"]},
                        "recipient": {"id": str(row["recipient_id"]), "name": row["recipient_name"], "username": row["recipient_username"]},
                    }
                    for row in messages
                ],
                "products": [
                    {"id": str(row["id"]), "name": row["name"], "category": row["category"], "price": int(row["price"]), "stock": row["stock"], "description": row["description"], "imageUrl": (row.get("image_urls") or [row["image_url"]])[0], "imageUrls": row.get("image_urls") or ([row["image_url"]] if row["image_url"] else []), "published": bool(row["published"]), "createdAt": timestamp(row, "created_at")}
                    for row in products
                ],
                "localListings": [
                    {"id": str(row["id"]), "category": row["category"], "title": row["title"], "price": row["price"], "location": row["location"], "detail": row["detail"], "description": row["description"], "imageUrl": row["image_url"], "published": bool(row["published"]), "createdAt": timestamp(row, "created_at")}
                    for row in local_listings
                ],
                "jobs": [
                    {"id": str(row["id"]), "title": row["title"], "company": row["company"], "location": row["location"], "employmentType": row["employment_type"], "workplaceType": row["workplace_type"], "summary": row["summary"], "description": row["description"], "createdAt": timestamp(row, "created_at"), "updatedAt": timestamp(row, "updated_at")}
                    for row in jobs
                ],
                "applications": [
                    {"id": str(row["id"]), "jobId": str(row["job_id"]), "jobTitle": row["job_title"], "company": row["job_company"], "coverLetter": row["cover_letter"], "status": row["status"], "createdAt": timestamp(row, "created_at")}
                    for row in applications
                ],
                "communitiesJoined": [
                    {"id": str(row["id"]), "name": row["name"], "description": row["description"], "memberCount": int(row["member_count"]), "joinedAt": timestamp(row, "joined_at")}
                    for row in communities_joined
                ],
                "communitiesCreated": [
                    {"id": str(row["id"]), "name": row["name"], "description": row["description"], "memberCount": int(row["member_count"]), "createdAt": timestamp(row, "created_at")}
                    for row in communities_created
                ],
                "following": [
                    {"id": str(row["id"]), "name": row["display_name"], "username": row["username"], "createdAt": timestamp(row, "created_at")}
                    for row in following
                ],
                "followers": [
                    {"id": str(row["id"]), "name": row["display_name"], "username": row["username"], "createdAt": timestamp(row, "created_at")}
                    for row in followers
                ],
            },
            "page": {"limit": limit, "offset": offset},
        }
        return {"user": details}

    @app.get("/api/admin/audit-log")
    def get_admin_audit_log(
        limit: int = Query(default=100, ge=1, le=200),
        _admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT log.id, log.action, log.details, log.created_at,
                          admin.id AS admin_id, admin.display_name AS admin_name,
                          admin.email AS admin_email,
                          subject.id AS subject_id, subject.display_name AS subject_name,
                          subject.email AS subject_email
                   FROM admin_audit_log log
                   JOIN users admin ON admin.id = log.admin_user_id
                   LEFT JOIN users subject ON subject.id = log.subject_user_id
                   ORDER BY log.created_at DESC, log.id DESC
                   LIMIT %s""",
                (limit,),
            ).fetchall()
        return {
            "events": [
                {
                    "id": str(row["id"]),
                    "action": row["action"],
                    "details": row["details"] or {},
                    "createdAt": row["created_at"].isoformat(),
                    "admin": {"id": str(row["admin_id"]), "name": row["admin_name"], "email": row["admin_email"]},
                    "subject": None if row["subject_id"] is None else {
                        "id": str(row["subject_id"]),
                        "name": row["subject_name"],
                        "email": row["subject_email"],
                    },
                }
                for row in rows
            ],
        }

    @app.get("/api/social/posts")
    def list_social_posts(
        user: Dict[str, Any] = Depends(require_user),
        following_only: bool = False,
        bookmarked_only: bool = False,
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT p.id, p.body, p.image_urls, p.created_at,
                          u.id AS author_id, u.display_name, u.username,
                          (SELECT count(*) FROM social_post_likes l WHERE l.post_id = p.id) AS like_count,
                          (SELECT count(*) FROM social_post_comments c WHERE c.post_id = p.id) AS comment_count,
                          EXISTS (
                              SELECT 1 FROM social_post_likes mine
                              WHERE mine.post_id = p.id AND mine.user_id = %s
                          ) AS liked_by_me,
                          EXISTS (
                              SELECT 1 FROM social_post_bookmarks mine
                              WHERE mine.post_id = p.id AND mine.user_id = %s
                          ) AS bookmarked_by_me
                   FROM social_posts p
                   JOIN users u ON u.id = p.user_id
                   WHERE (
                       NOT %s
                       OR EXISTS (
                           SELECT 1 FROM user_follows followed
                           WHERE followed.follower_id = %s
                             AND followed.following_id = p.user_id
                       )
                   )
                   AND (
                       NOT %s
                       OR EXISTS (
                           SELECT 1 FROM social_post_bookmarks bookmark_filter
                           WHERE bookmark_filter.user_id = %s
                             AND bookmark_filter.post_id = p.id
                       )
                   )
                   ORDER BY p.created_at DESC
                   LIMIT %s""",
                (
                    user["id"],
                    user["id"],
                    following_only,
                    user["id"],
                    bookmarked_only,
                    user["id"],
                    limit,
                ),
            ).fetchall()
        return {"posts": [public_social_post(row, user["id"]) for row in rows]}

    @app.post(
        "/api/social/posts",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_social_post(
        input: SocialPostInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO social_posts (user_id, body, image_urls)
                   VALUES (%s, %s, %s)
                   RETURNING id""",
                (user["id"], input.text, input.image_urls),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The post could not be created.")
            post = social_post(connection, inserted["id"], user["id"])
        if not post:
            raise ApiError(500, "internal_error", "The post could not be created.")
        publish_realtime({"type": "post.created", "postId": str(post["id"])})
        return {"post": public_social_post(post, user["id"])}

    @app.put(
        "/api/social/posts/{post_id}",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def update_social_post(
        post_id: UUID,
        input: SocialPostInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            updated = connection.execute(
                """UPDATE social_posts
                   SET body = %s, image_urls = %s
                   WHERE id = %s AND user_id = %s
                   RETURNING id""",
                (input.text, input.image_urls, post_id, user["id"]),
            ).fetchone()
            if not updated:
                raise ApiError(404, "post_not_found", "That post could not be found.")
            post = social_post(connection, updated["id"], user["id"])
        if not post:
            raise ApiError(500, "internal_error", "The updated post could not be loaded.")
        publish_realtime({"type": "post.updated", "postId": str(post["id"])})
        return {"post": public_social_post(post, user["id"])}

    @app.delete(
        "/api/social/posts/{post_id}",
        status_code=204,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def delete_social_post(
        post_id: UUID,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Response:
        with database.connection() as connection:
            deleted = connection.execute(
                "DELETE FROM social_posts WHERE id = %s AND user_id = %s RETURNING id",
                (post_id, user["id"]),
            ).fetchone()
        if not deleted:
            raise ApiError(404, "post_not_found", "That post could not be found.")
        publish_realtime({"type": "post.deleted", "postId": str(post_id)})
        return Response(status_code=204)

    @app.put(
        "/api/social/posts/{post_id}/bookmark",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def set_social_post_bookmark(
        post_id: UUID,
        input: SocialBookmarkInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, bool]:
        with database.connection() as connection:
            post = connection.execute(
                "SELECT id FROM social_posts WHERE id = %s",
                (post_id,),
            ).fetchone()
            if not post:
                raise ApiError(404, "post_not_found", "That post could not be found.")
            if input.bookmarked:
                connection.execute(
                    """INSERT INTO social_post_bookmarks (post_id, user_id)
                       VALUES (%s, %s)
                       ON CONFLICT (post_id, user_id) DO NOTHING""",
                    (post_id, user["id"]),
                )
            else:
                connection.execute(
                    """DELETE FROM social_post_bookmarks
                       WHERE post_id = %s AND user_id = %s""",
                    (post_id, user["id"]),
                )
        publish_realtime({"type": "post.updated", "postId": str(post_id)})
        return {"bookmarked": input.bookmarked}

    @app.get("/api/social/posts/{post_id}")
    def get_social_post(
        post_id: UUID,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            post = social_post(connection, post_id, user["id"])
        if not post:
            raise ApiError(404, "post_not_found", "That post could not be found.")
        return {"post": public_social_post(post, user["id"])}

    @app.put(
        "/api/social/posts/{post_id}/like",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def set_social_post_like(
        post_id: UUID,
        input: SocialLikeInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            if not connection.execute(
                "SELECT id FROM social_posts WHERE id = %s",
                (post_id,),
            ).fetchone():
                raise ApiError(404, "post_not_found", "That post could not be found.")
            if input.liked:
                connection.execute(
                    """INSERT INTO social_post_likes (post_id, user_id)
                       VALUES (%s, %s)
                       ON CONFLICT (post_id, user_id) DO NOTHING""",
                    (post_id, user["id"]),
                )
            else:
                connection.execute(
                    "DELETE FROM social_post_likes WHERE post_id = %s AND user_id = %s",
                    (post_id, user["id"]),
                )
            post = social_post(connection, post_id, user["id"])
        if not post:
            raise ApiError(404, "post_not_found", "That post could not be found.")
        publish_realtime({"type": "post.updated", "postId": str(post_id)})
        return {"post": public_social_post(post, user["id"])}

    @app.get(
        "/api/social/posts/{post_id}/comments",
        dependencies=[Depends(require_user)],
    )
    def list_social_comments(
        post_id: UUID,
        limit: int = Query(default=100, ge=1, le=200),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            if not connection.execute(
                "SELECT id FROM social_posts WHERE id = %s",
                (post_id,),
            ).fetchone():
                raise ApiError(404, "post_not_found", "That post could not be found.")
            rows = connection.execute(
                """SELECT c.id, c.body, c.created_at, c.parent_comment_id,
                          u.id AS author_id, u.display_name, u.username
                   FROM social_post_comments c
                   JOIN users u ON u.id = c.user_id
                   WHERE c.post_id = %s
                   ORDER BY c.created_at ASC
                   LIMIT %s""",
                (post_id, limit),
            ).fetchall()
        return {"comments": [public_social_comment(row) for row in rows]}

    @app.post(
        "/api/social/posts/{post_id}/comments",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_social_comment(
        post_id: UUID,
        input: SocialCommentInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            if input.parent_comment_id:
                parent = connection.execute(
                    """SELECT id
                       FROM social_post_comments
                       WHERE id = %s AND post_id = %s
                         AND parent_comment_id IS NULL""",
                    (input.parent_comment_id, post_id),
                ).fetchone()
                if not parent:
                    raise ApiError(404, "comment_not_found", "That comment could not be found.")
            inserted = connection.execute(
                """INSERT INTO social_post_comments
                       (post_id, user_id, body, parent_comment_id)
                   SELECT p.id, %s, %s, %s
                   FROM social_posts p
                   WHERE p.id = %s
                   RETURNING id""",
                (user["id"], input.text, input.parent_comment_id, post_id),
            ).fetchone()
            if not inserted:
                raise ApiError(404, "post_not_found", "That post could not be found.")
            row = connection.execute(
                """SELECT c.id, c.body, c.created_at, c.parent_comment_id,
                          u.id AS author_id, u.display_name, u.username
                   FROM social_post_comments c
                   JOIN users u ON u.id = c.user_id
                   WHERE c.id = %s""",
                (inserted["id"],),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "The reply could not be created.")
        publish_realtime({
            "type": "comment.created",
            "postId": str(post_id),
            "commentId": str(row["id"]),
        })
        return {"comment": public_social_comment(row)}

    @app.get("/api/marketplace/products")
    def list_marketplace_products(
        request: Request,
        query: Optional[str] = Query(default=None, max_length=80),
        category: Optional[Literal["Style", "Tech", "Home", "Other"]] = None,
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        require_user(request)
        normalized_query = (query or "").strip().lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        filters = ["p.published"]
        parameters: List[Any] = []
        if category:
            filters.append("p.category = %s")
            parameters.append(category)
        if normalized_query:
            escaped_query = (
                normalized_query
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            pattern = "%" + escaped_query + "%"
            filters.append(
                "(lower(p.name) LIKE %s ESCAPE E'\\\\' "
                "OR lower(p.description) LIKE %s ESCAPE E'\\\\' "
                "OR lower(s.display_name) LIKE %s ESCAPE E'\\\\' "
                "OR lower(s.username) LIKE %s ESCAPE E'\\\\')"
            )
            parameters.extend([pattern] * 4)
        parameters.append(limit)
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT p.id, p.name, p.category, p.price, p.stock,
                          p.description, p.image_url, p.image_urls, p.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM marketplace_products p
                   JOIN users s ON s.id = p.seller_id
                   WHERE {}
                   ORDER BY p.created_at DESC, p.id DESC
                   LIMIT %s""".format(" AND ".join(filters)),
                tuple(parameters),
            ).fetchall()
        return {"products": [public_marketplace_product(row) for row in rows]}

    @app.post(
        "/api/marketplace/products",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_marketplace_product(
        input: MarketplaceProductInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO marketplace_products
                       (seller_id, name, category, price, stock, description, image_url, image_urls)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (
                    user["id"],
                    input.name,
                    input.category,
                    input.price,
                    input.stock,
                    input.description,
                    input.image_url,
                    input.image_urls or ([input.image_url] if input.image_url else []),
                ),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The product listing could not be created.")
            row = connection.execute(
                """SELECT p.id, p.name, p.category, p.price, p.stock,
                          p.description, p.image_url, p.image_urls, p.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM marketplace_products p
                   JOIN users s ON s.id = p.seller_id
                   WHERE p.id = %s""",
                (inserted["id"],),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "The product listing could not be loaded.")
        return {"product": public_marketplace_product(row)}

    @app.get("/api/marketplace/products/{product_id}")
    def get_marketplace_product(
        product_id: UUID,
        request: Request,
    ) -> Dict[str, Any]:
        require_user(request)
        with database.connection() as connection:
            row = connection.execute(
                """SELECT p.id, p.name, p.category, p.price, p.stock,
                          p.description, p.image_url, p.image_urls, p.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM marketplace_products p
                   JOIN users s ON s.id = p.seller_id
                   WHERE p.id = %s AND p.published""",
                (product_id,),
            ).fetchone()
        if not row:
            raise ApiError(404, "product_not_found", "That product could not be found.")
        return {"product": public_marketplace_product(row)}

    @app.get("/api/local-marketplace/listings")
    def list_local_marketplace_listings(
        request: Request,
        query: Optional[str] = Query(default=None, max_length=80),
        location: Optional[str] = Query(default=None, max_length=80),
        category: Optional[Literal["Homes", "Services", "Farm"]] = None,
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        require_user(request)
        normalized_query = (query or "").strip().lower()
        normalized_location = (location or "").strip().lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        filters = ["l.published"]
        parameters: List[Any] = []
        if category:
            filters.append("l.category = %s")
            parameters.append(category)
        if normalized_query:
            escaped_query = (
                normalized_query
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            pattern = "%" + escaped_query + "%"
            filters.append(
                "(lower(l.title) LIKE %s ESCAPE E'\\\\' "
                "OR lower(l.description) LIKE %s ESCAPE E'\\\\' "
                "OR lower(l.detail) LIKE %s ESCAPE E'\\\\' "
                "OR lower(s.display_name) LIKE %s ESCAPE E'\\\\' "
                "OR lower(s.username) LIKE %s ESCAPE E'\\\\')"
            )
            parameters.extend([pattern] * 5)
        if normalized_location:
            escaped_location = (
                normalized_location
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            filters.append("lower(l.location) LIKE %s ESCAPE E'\\\\'")
            parameters.append("%" + escaped_location + "%")
        parameters.append(limit)
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT l.id, l.category, l.title, l.price, l.location,
                          l.detail, l.description, l.image_url, l.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM local_marketplace_listings l
                   JOIN users s ON s.id = l.seller_id
                   WHERE {}
                   ORDER BY l.created_at DESC, l.id DESC
                   LIMIT %s""".format(" AND ".join(filters)),
                tuple(parameters),
            ).fetchall()
        return {"listings": [public_local_marketplace_listing(row) for row in rows]}

    @app.post(
        "/api/local-marketplace/listings",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_local_marketplace_listing(
        input: LocalMarketplaceListingInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO local_marketplace_listings
                       (seller_id, category, title, price, location, detail,
                        description, image_url)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (
                    user["id"],
                    input.category,
                    input.title,
                    input.price,
                    input.location,
                    input.detail,
                    input.description,
                    input.image_url,
                ),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The listing could not be created.")
            row = connection.execute(
                """SELECT l.id, l.category, l.title, l.price, l.location,
                          l.detail, l.description, l.image_url, l.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM local_marketplace_listings l
                   JOIN users s ON s.id = l.seller_id
                   WHERE l.id = %s""",
                (inserted["id"],),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "The listing could not be loaded.")
        return {"listing": public_local_marketplace_listing(row)}

    @app.get("/api/local-marketplace/listings/{listing_id}")
    def get_local_marketplace_listing(
        listing_id: UUID,
        request: Request,
    ) -> Dict[str, Any]:
        require_user(request)
        with database.connection() as connection:
            row = connection.execute(
                """SELECT l.id, l.category, l.title, l.price, l.location,
                          l.detail, l.description, l.image_url, l.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM local_marketplace_listings l
                   JOIN users s ON s.id = l.seller_id
                   WHERE l.id = %s AND l.published""",
                (listing_id,),
            ).fetchone()
        if not row:
            raise ApiError(404, "listing_not_found", "That listing could not be found.")
        return {"listing": public_local_marketplace_listing(row)}

    @app.get("/api/messages/users")
    def search_message_recipients(
        request: Request,
        query: str = Query(min_length=2, max_length=40),
        limit: int = Query(default=20, ge=1, le=50),
    ) -> Dict[str, Any]:
        user = require_user(request)
        normalized_query = query.strip().lstrip("@").lower()
        if len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        escaped_query = (
            normalized_query
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        pattern = escaped_query + "%"
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT id, display_name, username
                   FROM users
                   WHERE email_verified_at IS NOT NULL
                     AND profile_visible AND discoverable
                     AND id <> %s
                     AND (
                         lower(username) LIKE %s ESCAPE E'\\\\'
                         OR lower(display_name) LIKE %s ESCAPE E'\\\\'
                     )
                   ORDER BY lower(username), lower(display_name)
                   LIMIT %s""",
                (user["id"], pattern, pattern, limit),
            ).fetchall()
        return {
            "users": [
                {
                    "id": str(row["id"]),
                    "name": row["display_name"],
                    "username": row["username"],
                }
                for row in rows
            ],
        }

    @app.get("/api/communities")
    def list_communities(
        request: Request,
        query: Optional[str] = Query(default=None, max_length=80),
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        user = require_user(request)
        normalized_query = (query or "").strip().lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        escaped_query = (
            normalized_query
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        pattern = "%" + escaped_query + "%" if escaped_query else None
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT c.id, c.name, c.description, c.created_at,
                          (SELECT count(*) FROM community_memberships members
                           WHERE members.community_id = c.id) AS member_count,
                          EXISTS (
                              SELECT 1 FROM community_memberships mine
                              WHERE mine.community_id = c.id AND mine.user_id = %s
                          ) AS joined_by_me
                   FROM communities c
                   WHERE %s::text IS NULL
                      OR lower(c.name) LIKE %s ESCAPE E'\\\\'
                      OR lower(c.description) LIKE %s ESCAPE E'\\\\'
                   ORDER BY c.created_at DESC, c.id DESC
                   LIMIT %s""",
                (user["id"], pattern, pattern, pattern, limit),
            ).fetchall()
        return {"communities": [public_community(row) for row in rows]}

    @app.post(
        "/api/communities",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_community(
        input: CommunityInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO communities (owner_id, name, description)
                   VALUES (%s, %s, %s)
                   RETURNING id""",
                (user["id"], input.name, input.description),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The community could not be created.")
            connection.execute(
                """INSERT INTO community_memberships (community_id, user_id)
                   VALUES (%s, %s)
                   ON CONFLICT (community_id, user_id) DO NOTHING""",
                (inserted["id"], user["id"]),
            )
            row = community_record(connection, inserted["id"], user["id"])
        if not row:
            raise ApiError(500, "internal_error", "The community could not be loaded.")
        return {"community": public_community(row)}

    @app.put(
        "/api/communities/{community_id}/membership",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def set_community_membership(
        community_id: UUID,
        input: CommunityMembershipInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            if not connection.execute(
                "SELECT id FROM communities WHERE id = %s",
                (community_id,),
            ).fetchone():
                raise ApiError(404, "community_not_found", "That community could not be found.")
            if input.joined:
                connection.execute(
                    """INSERT INTO community_memberships (community_id, user_id)
                       VALUES (%s, %s)
                       ON CONFLICT (community_id, user_id) DO NOTHING""",
                    (community_id, user["id"]),
                )
            else:
                connection.execute(
                    """DELETE FROM community_memberships
                       WHERE community_id = %s AND user_id = %s""",
                    (community_id, user["id"]),
                )
            row = community_record(connection, community_id, user["id"])
        if not row:
            raise ApiError(404, "community_not_found", "That community could not be found.")
        return {"community": public_community(row)}

    @app.get("/api/people")
    def discover_people(
        request: Request,
        query: Optional[str] = Query(default=None, max_length=40),
        following_only: bool = False,
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        user = require_user(request)
        normalized_query = (query or "").strip().lstrip("@").lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        escaped_query = (
            normalized_query
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        pattern = escaped_query + "%" if escaped_query else None
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT person.id, person.display_name, person.username, person.bio,
                          person.interests,
                          (SELECT count(*)
                           FROM user_follows followers
                           WHERE followers.following_id = person.id) AS follower_count,
                          (SELECT count(*)
                           FROM user_follows following
                           WHERE following.follower_id = person.id) AS following_count,
                          EXISTS (
                              SELECT 1
                              FROM user_follows mine
                              WHERE mine.follower_id = %s
                                AND mine.following_id = person.id
                          ) AS followed_by_me
                   FROM users person
                   WHERE person.email_verified_at IS NOT NULL
                     AND person.profile_visible
                     AND person.discoverable
                     AND person.id <> %s
                     AND (
                         %s::text IS NULL
                         OR lower(person.username) LIKE %s ESCAPE E'\\\\'
                         OR lower(person.display_name) LIKE %s ESCAPE E'\\\\'
                         OR EXISTS (
                             SELECT 1
                             FROM unnest(person.interests) AS interest(value)
                             WHERE lower(interest.value) LIKE %s ESCAPE E'\\\\'
                         )
                     )
                     AND (
                         NOT %s
                         OR EXISTS (
                             SELECT 1
                             FROM user_follows following_filter
                             WHERE following_filter.follower_id = %s
                               AND following_filter.following_id = person.id
                         )
                     )
                   ORDER BY lower(person.display_name), lower(person.username)
                   LIMIT %s""",
                (
                    user["id"],
                    user["id"],
                    pattern,
                    pattern,
                    pattern,
                    pattern,
                    following_only,
                    user["id"],
                    limit,
                ),
            ).fetchall()
        return {"people": [public_discoverable_user(row) for row in rows]}

    @app.put(
        "/api/people/{person_id}/follow",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def set_person_follow(
        person_id: UUID,
        input: UserFollowInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        if str(person_id) == str(user["id"]):
            raise ApiError(400, "invalid_follow", "You cannot follow your own account.")
        with database.connection() as connection:
            person = connection.execute(
                """SELECT id
                   FROM users
                   WHERE id = %s AND email_verified_at IS NOT NULL
                     AND profile_visible AND discoverable""",
                (person_id,),
            ).fetchone()
            if not person:
                raise ApiError(404, "person_not_found", "That account could not be found.")
            if input.following:
                connection.execute(
                    """INSERT INTO user_follows (follower_id, following_id)
                       VALUES (%s, %s)
                       ON CONFLICT (follower_id, following_id) DO NOTHING""",
                    (user["id"], person_id),
                )
            else:
                connection.execute(
                    """DELETE FROM user_follows
                       WHERE follower_id = %s AND following_id = %s""",
                    (user["id"], person_id),
                )
            counts = connection.execute(
                """SELECT
                       (SELECT count(*) FROM user_follows
                        WHERE following_id = %s) AS follower_count,
                       (SELECT count(*) FROM user_follows
                        WHERE follower_id = %s) AS following_count""",
                (person_id, person_id),
            ).fetchone()
        if not counts:
            raise ApiError(500, "internal_error", "The follow status could not be updated.")
        return {
            "following": input.following,
            "followerCount": int(counts["follower_count"]),
            "followingCount": int(counts["following_count"]),
        }

    def job_record(connection: Any, job_id: UUID, viewer_id: Any) -> Optional[Dict[str, Any]]:
        return connection.execute(
            """SELECT j.id, j.title, j.company, j.location, j.employment_type,
                      j.workplace_type, j.summary, j.description, j.created_at,
                      author.display_name, author.username,
                      EXISTS (
                          SELECT 1 FROM job_bookmarks bookmark
                          WHERE bookmark.job_id = j.id AND bookmark.user_id = %s
                      ) AS is_saved,
                      EXISTS (
                          SELECT 1 FROM job_applications mine
                          WHERE mine.job_id = j.id AND mine.applicant_id = %s
                      ) AS applied_by_me,
                      j.user_id = %s AS is_owner,
                      (SELECT count(*) FROM job_applications applications
                       WHERE applications.job_id = j.id) AS application_count,
                      (SELECT mine.status FROM job_applications mine
                       WHERE mine.job_id = j.id AND mine.applicant_id = %s) AS application_status,
                      (SELECT mine.cover_letter FROM job_applications mine
                       WHERE mine.job_id = j.id AND mine.applicant_id = %s) AS application_cover_letter
               FROM job_listings j
               JOIN users author ON author.id = j.user_id
               WHERE j.id = %s""",
            (viewer_id, viewer_id, viewer_id, viewer_id, viewer_id, job_id),
        ).fetchone()

    @app.get("/api/jobs")
    def list_jobs(
        request: Request,
        query: Optional[str] = Query(default=None, max_length=80),
        location: Optional[str] = Query(default=None, max_length=80),
        workplace_type: Optional[Literal["remote", "hybrid", "onsite"]] = None,
        view: Literal["all", "saved", "applied", "mine"] = "all",
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        user = require_user(request)
        normalized_query = (query or "").strip().lower()
        normalized_location = (location or "").strip().lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        filters = []
        parameters: List[Any] = [user["id"], user["id"], user["id"], user["id"], user["id"]]
        if view == "saved":
            filters.append(
                "EXISTS (SELECT 1 FROM job_bookmarks filter_bookmark "
                "WHERE filter_bookmark.job_id = j.id AND filter_bookmark.user_id = %s)"
            )
            parameters.append(user["id"])
        elif view == "applied":
            filters.append(
                "EXISTS (SELECT 1 FROM job_applications filter_application "
                "WHERE filter_application.job_id = j.id AND filter_application.applicant_id = %s)"
            )
            parameters.append(user["id"])
        elif view == "mine":
            filters.append("j.user_id = %s")
            parameters.append(user["id"])

        if normalized_query:
            escaped_query = (
                normalized_query
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            pattern = "%" + escaped_query + "%"
            filters.append(
                "(lower(j.title) LIKE %s ESCAPE E'\\\\' "
                "OR lower(j.company) LIKE %s ESCAPE E'\\\\' "
                "OR lower(j.summary) LIKE %s ESCAPE E'\\\\' "
                "OR lower(j.description) LIKE %s ESCAPE E'\\\\')"
            )
            parameters.extend([pattern] * 4)
        if normalized_location:
            escaped_location = (
                normalized_location
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            pattern = "%" + escaped_location + "%"
            filters.append("lower(j.location) LIKE %s ESCAPE E'\\\\'")
            parameters.append(pattern)
        if workplace_type:
            filters.append("j.workplace_type = %s")
            parameters.append(workplace_type)
        parameters.append(limit)

        with database.connection() as connection:
            rows = connection.execute(
                """SELECT j.id, j.title, j.company, j.location, j.employment_type,
                          j.workplace_type, j.summary, j.description, j.created_at,
                          author.display_name, author.username,
                          EXISTS (
                              SELECT 1 FROM job_bookmarks bookmark
                              WHERE bookmark.job_id = j.id AND bookmark.user_id = %s
                          ) AS is_saved,
                          EXISTS (
                              SELECT 1 FROM job_applications mine
                              WHERE mine.job_id = j.id AND mine.applicant_id = %s
                          ) AS applied_by_me,
                          j.user_id = %s AS is_owner,
                          (SELECT count(*) FROM job_applications applications
                           WHERE applications.job_id = j.id) AS application_count,
                          (SELECT mine.status FROM job_applications mine
                           WHERE mine.job_id = j.id AND mine.applicant_id = %s) AS application_status,
                          (SELECT mine.cover_letter FROM job_applications mine
                           WHERE mine.job_id = j.id AND mine.applicant_id = %s) AS application_cover_letter
                   FROM job_listings j
                   JOIN users author ON author.id = j.user_id
                   WHERE {}
                   ORDER BY j.created_at DESC, j.id DESC
                   LIMIT %s""".format(" AND ".join(filters) if filters else "TRUE"),
                tuple(parameters),
            ).fetchall()
        return {"jobs": [public_job(row) for row in rows]}

    @app.post(
        "/api/jobs",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_job(
        input: JobListingInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO job_listings
                       (user_id, title, company, location, employment_type,
                        workplace_type, summary, description)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (
                    user["id"],
                    input.title,
                    input.company,
                    input.location,
                    input.employment_type,
                    input.workplace_type,
                    input.summary,
                    input.description,
                ),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The job listing could not be created.")
            row = job_record(connection, inserted["id"], user["id"])
        if not row:
            raise ApiError(500, "internal_error", "The job listing could not be created.")
        return {"job": public_job(row)}

    @app.put(
        "/api/jobs/{job_id}/save",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def set_job_saved(
        job_id: UUID,
        input: JobSaveInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            listing = connection.execute(
                "SELECT id FROM job_listings WHERE id = %s",
                (job_id,),
            ).fetchone()
            if not listing:
                raise ApiError(404, "job_not_found", "That job listing could not be found.")
            if input.saved:
                connection.execute(
                    """INSERT INTO job_bookmarks (user_id, job_id)
                       VALUES (%s, %s)
                       ON CONFLICT (user_id, job_id) DO NOTHING""",
                    (user["id"], job_id),
                )
            else:
                connection.execute(
                    "DELETE FROM job_bookmarks WHERE user_id = %s AND job_id = %s",
                    (user["id"], job_id),
                )
        return {"saved": input.saved}

    @app.post(
        "/api/jobs/{job_id}/applications",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def apply_to_job(
        job_id: UUID,
        input: JobApplicationInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            listing = connection.execute(
                "SELECT id, user_id FROM job_listings WHERE id = %s",
                (job_id,),
            ).fetchone()
            if not listing:
                raise ApiError(404, "job_not_found", "That job listing could not be found.")
            if str(listing["user_id"]) == str(user["id"]):
                raise ApiError(400, "invalid_application", "You cannot apply to your own job listing.")
            inserted = connection.execute(
                """INSERT INTO job_applications (job_id, applicant_id, cover_letter)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (job_id, applicant_id) DO NOTHING
                   RETURNING id""",
                (job_id, user["id"], input.cover_letter),
            ).fetchone()
            application = connection.execute(
                """SELECT id, job_id, cover_letter, status, created_at
                   FROM job_applications
                   WHERE job_id = %s AND applicant_id = %s""",
                (job_id, user["id"]),
            ).fetchone()
        if not application:
            raise ApiError(500, "internal_error", "Your application could not be saved.")
        return {
            "application": {
                "id": str(application["id"]),
                "jobId": str(application["job_id"]),
                "coverLetter": application["cover_letter"],
                "status": application["status"],
                "createdAt": application["created_at"].isoformat(),
            },
            "alreadyApplied": inserted is None,
        }

    @app.get("/api/jobs/{job_id}/applications")
    def list_job_applications(
        job_id: UUID,
        request: Request,
        limit: int = Query(default=100, ge=1, le=200),
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            listing = connection.execute(
                "SELECT id, user_id FROM job_listings WHERE id = %s",
                (job_id,),
            ).fetchone()
            if not listing or str(listing["user_id"]) != str(user["id"]):
                raise ApiError(404, "job_not_found", "That job listing could not be found.")
            rows = connection.execute(
                """SELECT application.id, application.cover_letter, application.status,
                          application.created_at, applicant.display_name, applicant.username
                   FROM job_applications application
                   JOIN users applicant ON applicant.id = application.applicant_id
                   WHERE application.job_id = %s
                   ORDER BY application.created_at DESC
                   LIMIT %s""",
                (job_id, limit),
            ).fetchall()
        return {
            "applications": [
                {
                    "id": str(row["id"]),
                    "coverLetter": row["cover_letter"],
                    "status": row["status"],
                    "createdAt": row["created_at"].isoformat(),
                    "applicant": {
                        "name": row["display_name"],
                        "username": row["username"],
                    },
                }
                for row in rows
            ],
        }

    @app.get("/api/messages/conversations")
    def list_direct_conversations(request: Request) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT c.id, c.created_at,
                          other.id AS recipient_id,
                          other.display_name AS recipient_name,
                          other.username AS recipient_username,
                          latest.body AS last_message,
                          latest.created_at AS last_message_at,
                          (SELECT count(*)
                           FROM direct_messages unread
                           WHERE unread.conversation_id = c.id
                             AND unread.recipient_id = %s
                             AND unread.read_at IS NULL) AS unread_count
                   FROM direct_conversations c
                   JOIN users other
                     ON other.id = CASE
                         WHEN c.participant_one_id = %s THEN c.participant_two_id
                         ELSE c.participant_one_id
                     END
                   LEFT JOIN LATERAL (
                       SELECT body, created_at
                       FROM direct_messages
                       WHERE conversation_id = c.id
                       ORDER BY created_at DESC, id DESC
                       LIMIT 1
                   ) latest ON TRUE
                   WHERE c.participant_one_id = %s OR c.participant_two_id = %s
                   ORDER BY COALESCE(latest.created_at, c.created_at) DESC""",
                (user["id"], user["id"], user["id"], user["id"]),
            ).fetchall()
        return {
            "conversations": [
                {
                    "id": str(row["id"]),
                    "recipient": {
                        "id": str(row["recipient_id"]),
                        "name": row["recipient_name"],
                        "username": row["recipient_username"],
                    },
                    "lastMessage": row["last_message"] or "",
                    "lastMessageAt": (
                        row["last_message_at"] or row["created_at"]
                    ).isoformat(),
                    "unreadCount": int(row["unread_count"]),
                }
                for row in rows
            ],
        }

    @app.post(
        "/api/messages/conversations",
        status_code=201,
        dependencies=[Depends(enforce_message_rate_limit)],
    )
    def create_direct_conversation(
        input: DirectConversationInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        if str(input.recipient_id) == str(user["id"]):
            raise ApiError(400, "invalid_recipient", "You cannot start a conversation with yourself.")
        with database.connection() as connection:
            recipient = connection.execute(
                """SELECT id
                   FROM users
                   WHERE id = %s AND email_verified_at IS NOT NULL
                     AND profile_visible AND discoverable""",
                (input.recipient_id,),
            ).fetchone()
            if not recipient:
                raise ApiError(404, "user_not_found", "That account could not be found.")
            conversation = connection.execute(
                """INSERT INTO direct_conversations (participant_one_id, participant_two_id)
                   VALUES (LEAST(%s, %s), GREATEST(%s, %s))
                   ON CONFLICT (participant_one_id, participant_two_id)
                   DO UPDATE SET created_at = direct_conversations.created_at
                   RETURNING id""",
                (user["id"], input.recipient_id, user["id"], input.recipient_id),
            ).fetchone()
        if not conversation:
            raise ApiError(500, "internal_error", "The conversation could not be opened.")
        return {"conversationId": str(conversation["id"])}

    @app.get("/api/messages/conversations/{conversation_id}/messages")
    def list_direct_messages(
        conversation_id: UUID,
        request: Request,
        limit: int = Query(default=100, ge=1, le=200),
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            conversation = connection.execute(
                """SELECT id
                   FROM direct_conversations
                   WHERE id = %s
                     AND (participant_one_id = %s OR participant_two_id = %s)""",
                (conversation_id, user["id"], user["id"]),
            ).fetchone()
            if not conversation:
                raise ApiError(404, "conversation_not_found", "That conversation could not be found.")
            read_messages = connection.execute(
                """UPDATE direct_messages
                   SET read_at = now()
                   WHERE conversation_id = %s
                     AND recipient_id = %s
                     AND read_at IS NULL
                   RETURNING sender_id""",
                (conversation_id, user["id"]),
            ).fetchall()
            rows = connection.execute(
                """SELECT message.id, message.body, message.created_at, message.read_at,
                          message.sender_id,
                          sender.display_name, sender.username
                   FROM (
                       SELECT id, body, created_at, read_at, sender_id
                       FROM direct_messages
                       WHERE conversation_id = %s
                       ORDER BY created_at DESC, id DESC
                       LIMIT %s
                   ) message
                   JOIN users sender ON sender.id = message.sender_id
                   ORDER BY message.created_at ASC, message.id ASC""",
                (conversation_id, limit),
            ).fetchall()
        sender_ids = list({row["sender_id"] for row in read_messages})
        if sender_ids:
            publish_realtime(
                {"type": "message.read", "conversationId": str(conversation_id)},
                sender_ids,
            )
        return {
            "messages": [
                public_direct_message(row, user["id"])
                for row in rows
            ],
        }

    @app.post(
        "/api/messages/conversations/{conversation_id}/messages",
        status_code=201,
        dependencies=[Depends(enforce_message_rate_limit)],
    )
    def create_direct_message(
        conversation_id: UUID,
        input: DirectMessageInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO direct_messages
                       (conversation_id, sender_id, recipient_id, body)
                   SELECT c.id, %s,
                          CASE
                              WHEN c.participant_one_id = %s THEN c.participant_two_id
                              ELSE c.participant_one_id
                          END,
                          %s
                   FROM direct_conversations c
                   WHERE c.id = %s
                     AND (c.participant_one_id = %s OR c.participant_two_id = %s)
                   RETURNING id""",
                (
                    user["id"],
                    user["id"],
                    input.text,
                    conversation_id,
                    user["id"],
                    user["id"],
                ),
            ).fetchone()
            if not inserted:
                raise ApiError(404, "conversation_not_found", "That conversation could not be found.")
            row = connection.execute(
                """SELECT message.id, message.body, message.created_at, message.read_at,
                          message.sender_id, message.recipient_id,
                          sender.display_name, sender.username
                   FROM direct_messages message
                   JOIN users sender ON sender.id = message.sender_id
                   WHERE message.id = %s""",
                (inserted["id"],),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "The message could not be sent.")
        publish_realtime(
            {
                "type": "message.created",
                "conversationId": str(conversation_id),
                "messageId": str(row["id"]),
                "senderId": str(row["sender_id"]),
            },
            [row["recipient_id"]],
        )
        return {"message": public_direct_message(row, user["id"])}

    return app


app = create_app()
