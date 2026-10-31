import html
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Deque, Dict, List, Literal, Optional
from uuid import UUID
from fastapi import Depends, FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
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

    @field_validator("text")
    @classmethod
    def clean_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Post text is required.")
        return value


class SocialCommentInput(StrictModel):
    text: str = Field(min_length=1, max_length=280)

    @field_validator("text")
    @classmethod
    def clean_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Comment text is required.")
        return value


class SocialLikeInput(StrictModel):
    liked: bool


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
    payload = json.dumps({
        "from": settings.email_from,
        "to": [email],
        "subject": "Your iConnect verification code",
        "text": "Hi {}, your iConnect verification code is {}. It expires in 10 minutes.".format(name, code),
        "html": (
            "<p>Hi {},</p><p>Your iConnect verification code is:</p>"
            '<p style="font-size:28px;font-weight:bold;letter-spacing:8px">{}</p>'
            "<p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>"
        ).format(safe_name, code),
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
    cookie_name = "__Host-iconnect.sid" if settings.production else "iconnect.sid"

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
                if int(content_length) > MAX_REQUEST_BYTES:
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

    def social_post(connection: Any, post_id: Any, viewer_id: Any) -> Optional[Dict[str, Any]]:
        return connection.execute(
            """SELECT p.id, p.body, p.created_at,
                      u.id AS author_id, u.display_name, u.username,
                      (SELECT count(*) FROM social_post_likes l WHERE l.post_id = p.id) AS like_count,
                      (SELECT count(*) FROM social_post_comments c WHERE c.post_id = p.id) AS comment_count,
                      EXISTS (
                          SELECT 1 FROM social_post_likes mine
                          WHERE mine.post_id = p.id AND mine.user_id = %s
                      ) AS liked_by_me
               FROM social_posts p
               JOIN users u ON u.id = p.user_id
               WHERE p.id = %s""",
            (viewer_id, post_id),
        ).fetchone()

    def public_social_post(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "text": row["body"],
            "createdAt": row["created_at"].isoformat(),
            "author": {
                "id": str(row["author_id"]),
                "name": row["display_name"],
                "username": row["username"],
            },
            "likeCount": int(row["like_count"]),
            "commentCount": int(row["comment_count"]),
            "likedByMe": bool(row["liked_by_me"]),
        }

    def public_social_comment(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "text": row["body"],
            "createdAt": row["created_at"].isoformat(),
            "author": {
                "id": str(row["author_id"]),
                "name": row["display_name"],
                "username": row["username"],
            },
        }

    def public_direct_message(row: Dict[str, Any], viewer_id: Any) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "text": row["body"],
            "createdAt": row["created_at"].isoformat(),
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

    def current_user(request: Request) -> Optional[Dict[str, Any]]:
        token = request.cookies.get(cookie_name)
        if not token:
            return None
        with database.connection() as connection:
            user = connection.execute(
                """SELECT u.id, u.display_name, u.username, u.email, u.bio, u.interests,
                       u.email_verified_at, u.profile_visible, u.discoverable
                   FROM auth_sessions s
                   JOIN users u ON u.id = s.user_id
                   WHERE s.token_hash = %s AND s.expires_at > now()
                     AND u.email_verified_at IS NOT NULL""",
                (hash_session_token(token, settings.session_secret),),
            ).fetchone()
            return user

    def require_user(request: Request) -> Dict[str, Any]:
        user = current_user(request)
        if not user:
            raise ApiError(401, "not_authenticated", "Sign in to continue.")
        return user

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
                          password_hash, email_verified_at
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
        create_session(user["id"], request, response)
        return {"user": public_user(user)}

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

    @app.get("/api/social/posts")
    def list_social_posts(
        user: Dict[str, Any] = Depends(require_user),
        following_only: bool = False,
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT p.id, p.body, p.created_at,
                          u.id AS author_id, u.display_name, u.username,
                          (SELECT count(*) FROM social_post_likes l WHERE l.post_id = p.id) AS like_count,
                          (SELECT count(*) FROM social_post_comments c WHERE c.post_id = p.id) AS comment_count,
                          EXISTS (
                              SELECT 1 FROM social_post_likes mine
                              WHERE mine.post_id = p.id AND mine.user_id = %s
                          ) AS liked_by_me
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
                   ORDER BY p.created_at DESC
                   LIMIT %s""",
                (user["id"], following_only, user["id"], limit),
            ).fetchall()
        return {"posts": [public_social_post(row) for row in rows]}

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
                """INSERT INTO social_posts (user_id, body)
                   VALUES (%s, %s)
                   RETURNING id""",
                (user["id"], input.text),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The post could not be created.")
            post = social_post(connection, inserted["id"], user["id"])
        if not post:
            raise ApiError(500, "internal_error", "The post could not be created.")
        return {"post": public_social_post(post)}

    @app.get("/api/social/posts/{post_id}")
    def get_social_post(
        post_id: UUID,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            post = social_post(connection, post_id, user["id"])
        if not post:
            raise ApiError(404, "post_not_found", "That post could not be found.")
        return {"post": public_social_post(post)}

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
        return {"post": public_social_post(post)}

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
                """SELECT c.id, c.body, c.created_at,
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
            inserted = connection.execute(
                """INSERT INTO social_post_comments (post_id, user_id, body)
                   SELECT p.id, %s, %s
                   FROM social_posts p
                   WHERE p.id = %s
                   RETURNING id""",
                (user["id"], input.text, post_id),
            ).fetchone()
            if not inserted:
                raise ApiError(404, "post_not_found", "That post could not be found.")
            row = connection.execute(
                """SELECT c.id, c.body, c.created_at,
                          u.id AS author_id, u.display_name, u.username
                   FROM social_post_comments c
                   JOIN users u ON u.id = c.user_id
                   WHERE c.id = %s""",
                (inserted["id"],),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "The reply could not be created.")
        return {"comment": public_social_comment(row)}

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
            connection.execute(
                """UPDATE direct_messages
                   SET read_at = now()
                   WHERE conversation_id = %s
                     AND recipient_id = %s
                     AND read_at IS NULL""",
                (conversation_id, user["id"]),
            )
            rows = connection.execute(
                """SELECT message.id, message.body, message.created_at, message.sender_id,
                          sender.display_name, sender.username
                   FROM (
                       SELECT id, body, created_at, sender_id
                       FROM direct_messages
                       WHERE conversation_id = %s
                       ORDER BY created_at DESC, id DESC
                       LIMIT %s
                   ) message
                   JOIN users sender ON sender.id = message.sender_id
                   ORDER BY message.created_at ASC, message.id ASC""",
                (conversation_id, limit),
            ).fetchall()
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
                """SELECT message.id, message.body, message.created_at, message.sender_id,
                          sender.display_name, sender.username
                   FROM direct_messages message
                   JOIN users sender ON sender.id = message.sender_id
                   WHERE message.id = %s""",
                (inserted["id"],),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "The message could not be sent.")
        return {"message": public_direct_message(row, user["id"])}

    return app


app = create_app()
