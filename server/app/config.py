import os
from dataclasses import dataclass
from urllib.parse import urlparse

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    app_origin: str
    api_host: str
    api_port: int
    database_url: str
    email_from: str
    environment: str
    otp_hash_secret: str
    production: bool
    resend_api_key: str
    session_max_age_days: int
    session_secret: str
    trust_proxy: int


def _required_secret(name: str) -> str:
    value = os.getenv(name, "")
    if len(value) < 32:
        raise RuntimeError("{} must be set to at least 32 characters.".format(name))
    return value


def load_settings() -> Settings:
    load_dotenv()
    environment = os.getenv("NODE_ENV", "development")
    production = environment == "production"
    app_origin = os.getenv("APP_ORIGIN", "http://localhost:5173")
    parsed_origin = urlparse(app_origin)
    if (
        not parsed_origin.scheme
        or not parsed_origin.netloc
        or parsed_origin.path
        or parsed_origin.params
        or parsed_origin.query
        or parsed_origin.fragment
        or app_origin.rstrip("/") != "{}://{}".format(parsed_origin.scheme, parsed_origin.netloc)
    ):
        raise RuntimeError("APP_ORIGIN must be a valid origin URL without a path.")
    if production and parsed_origin.scheme != "https":
        raise RuntimeError("APP_ORIGIN must use HTTPS in production.")

    resend_api_key = os.getenv("RESEND_API_KEY", "")
    email_from = os.getenv("EMAIL_FROM", "")
    if production and (not resend_api_key or not email_from):
        raise RuntimeError("RESEND_API_KEY and EMAIL_FROM are required in production.")

    try:
        api_port = int(os.getenv("API_PORT", "10000"))
        session_max_age_days = int(os.getenv("SESSION_MAX_AGE_DAYS", "7"))
        trust_proxy = int(os.getenv("TRUST_PROXY", "1" if production else "0"))
    except ValueError as error:
        raise RuntimeError("API_PORT, SESSION_MAX_AGE_DAYS, and TRUST_PROXY must be integers.") from error

    if not 1 <= api_port <= 65535:
        raise RuntimeError("API_PORT must be a valid TCP port.")
    if not 1 <= session_max_age_days <= 30:
        raise RuntimeError("SESSION_MAX_AGE_DAYS must be between 1 and 30.")
    if trust_proxy < 0:
        raise RuntimeError("TRUST_PROXY must be a non-negative integer.")

    api_host = os.getenv("API_HOST", "127.0.0.1")
    if production and api_host not in {"127.0.0.1", "::1"}:
        raise RuntimeError("In production, API_HOST must bind to loopback behind an HTTPS reverse proxy.")

    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        raise RuntimeError("DATABASE_URL must be set.")

    return Settings(
        app_origin=app_origin.rstrip("/"),
        api_host=api_host,
        api_port=api_port,
        database_url=database_url,
        email_from=email_from,
        environment=environment,
        otp_hash_secret=_required_secret("OTP_HASH_SECRET"),
        production=production,
        resend_api_key=resend_api_key,
        session_max_age_days=session_max_age_days,
        session_secret=_required_secret("SESSION_SECRET"),
        trust_proxy=trust_proxy,
    )
