import os
import re
from dataclasses import dataclass
from typing import FrozenSet, Tuple
from urllib.parse import urlparse

from dotenv import load_dotenv


DEFAULT_GREENHOUSE_BOARD_TOKENS = (
    "stripe",
    "figma",
    "cloudflare",
    "gitlab",
    "mongodb",
    "airbnb",
)
DEFAULT_SMARTRECRUITERS_COMPANY_IDS = (
    "redbull",
    "smartrecruiters",
)


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
    admin_emails: FrozenSet[str]
    greenhouse_board_tokens: Tuple[str, ...] = ()
    smartrecruiters_company_ids: Tuple[str, ...] = ()
    livekit_url: str = ""
    livekit_api_key: str = ""
    livekit_api_secret: str = ""
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    paystack_secret_key: str = ""
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    geoip_country_db: str = ""
    deriv_app_id: str = ""
    deriv_api_token: str = ""
    deriv_account_id: str = ""


def _required_secret(name: str) -> str:
    value = os.getenv(name, "")
    if len(value) < 32:
        raise RuntimeError("{} must be set to at least 32 characters.".format(name))
    return value


def _job_source_ids(name: str, defaults: Tuple[str, ...]) -> Tuple[str, ...]:
    configured = os.getenv(name, "").strip()
    if not configured:
        return defaults
    if configured.casefold() == "none":
        return ()
    values = tuple(dict.fromkeys(
        value.strip()
        for value in configured.split(",")
        if value.strip()
    ))
    if len(values) > 20 or any(
        not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", value)
        for value in values
    ):
        raise RuntimeError(
            "{} must contain up to 20 comma-separated public company identifiers.".format(name)
        )
    return values


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
    admin_emails = frozenset(
        email.strip().lower()
        for email in os.getenv("ADMIN_EMAILS", "").split(",")
        if email.strip()
    )
    if any(not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) for email in admin_emails):
        raise RuntimeError("ADMIN_EMAILS must contain comma-separated valid email addresses.")

    livekit_url = os.getenv("LIVEKIT_URL", "").strip().rstrip("/")
    livekit_api_key = os.getenv("LIVEKIT_API_KEY", "").strip()
    livekit_api_secret = os.getenv("LIVEKIT_API_SECRET", "").strip()
    if any((livekit_url, livekit_api_key, livekit_api_secret)) and not all((
        livekit_url,
        livekit_api_key,
        livekit_api_secret,
    )):
        raise RuntimeError(
            "LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be configured together."
        )
    if livekit_url:
        parsed_livekit_url = urlparse(livekit_url)
        expected_scheme = "wss" if production else parsed_livekit_url.scheme
        if (
            parsed_livekit_url.scheme not in {"wss", "ws"}
            or (production and parsed_livekit_url.scheme != expected_scheme)
            or not parsed_livekit_url.netloc
            or parsed_livekit_url.path
            or parsed_livekit_url.query
            or parsed_livekit_url.fragment
        ):
            raise RuntimeError("LIVEKIT_URL must be a ws:// or wss:// origin without a path.")
        if len(livekit_api_secret) < 32:
            raise RuntimeError("LIVEKIT_API_SECRET must be at least 32 characters.")

    gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not re.fullmatch(r"gemini-[A-Za-z0-9._-]{1,80}", gemini_model):
        raise RuntimeError("GEMINI_MODEL must be a valid Gemini model identifier.")
    paystack_secret_key = os.getenv("PAYSTACK_SECRET_KEY", "").strip()
    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY", "").strip()
    stripe_webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
    if bool(stripe_secret_key) != bool(stripe_webhook_secret):
        raise RuntimeError("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be configured together.")

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
        admin_emails=admin_emails,
        greenhouse_board_tokens=_job_source_ids(
            "GREENHOUSE_BOARD_TOKENS",
            DEFAULT_GREENHOUSE_BOARD_TOKENS,
        ),
        smartrecruiters_company_ids=_job_source_ids(
            "SMARTRECRUITERS_COMPANY_IDS",
            DEFAULT_SMARTRECRUITERS_COMPANY_IDS,
        ),
        livekit_url=livekit_url,
        livekit_api_key=livekit_api_key,
        livekit_api_secret=livekit_api_secret,
        gemini_api_key=gemini_api_key,
        gemini_model=gemini_model,
        paystack_secret_key=paystack_secret_key,
        stripe_secret_key=stripe_secret_key,
        stripe_webhook_secret=stripe_webhook_secret,
        geoip_country_db=os.getenv("GEOIP_COUNTRY_DB", "").strip(),
        deriv_app_id=os.getenv("DERIV_APP_ID", "").strip(),
        deriv_api_token=os.getenv("DERIV_API_TOKEN", "").strip(),
        deriv_account_id=os.getenv("DERIV_ACCOUNT_ID", "").strip(),
    )
