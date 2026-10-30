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
from typing import Any, Callable, Deque, Dict, List, Optional
from fastapi import Depends, FastAPI, Request, Response
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


def public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(user["id"]),
        "name": user["display_name"],
        "username": user["username"],
        "email": user["email"],
        "bio": user["bio"],
        "interests": user["interests"],
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
                          u.email_verified_at
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

    @app.put("/api/auth/profile")
    def update_profile(input: ProfileInput, request: Request) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            updated = connection.execute(
                """UPDATE users
                   SET display_name = %s, username = %s, bio = %s, interests = %s, updated_at = now()
                   WHERE id = %s AND email_verified_at IS NOT NULL
                   RETURNING id, display_name, username, email, bio, interests""",
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

    return app


app = create_app()
