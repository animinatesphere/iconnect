"""Work out which country a request comes from, for location-based plan prices.

Order of sources:
1. A country header added by the edge in front of the API (Vercel or Cloudflare).
2. A local IP-to-country database (MaxMind/DB-IP .mmdb), when GEOIP_COUNTRY_DB is set.
Unknown is a valid answer; callers then fall back to showing every plan.
"""

import ipaddress
import logging
import re
import threading
from typing import Any, Optional, Tuple

LOGGER = logging.getLogger("iconnect.geo")

# Two-decimal currencies only, so amount_minor is always "price x 100" for
# both Paystack and Stripe.
SUPPORTED_CURRENCIES = (
    "NGN", "USD", "GBP", "EUR", "CAD", "AUD", "NZD",
    "GHS", "KES", "ZAR", "INR", "AED",
)

COUNTRY_HEADERS = ("x-vercel-ip-country", "cf-ipcountry")
_COUNTRY_CODE = re.compile(r"^[A-Z]{2}$")
# Placeholder codes some edges send for unknown, Tor or anonymous traffic.
_UNKNOWN_CODES = {"XX", "T1", "A1", "A2", "O1", "EU", "AP", "ZZ"}

_reader_lock = threading.Lock()
_reader: Any = None
_reader_path: Optional[str] = None


def normalize_country(value: Optional[str]) -> Optional[str]:
    code = (value or "").strip().upper()
    if not _COUNTRY_CODE.match(code) or code in _UNKNOWN_CODES:
        return None
    return code


def _geoip_reader(path: str) -> Any:
    global _reader, _reader_path
    with _reader_lock:
        if _reader is not None and _reader_path == path:
            return _reader
        try:
            import maxminddb  # type: ignore

            _reader = maxminddb.open_database(path)
            _reader_path = path
        except Exception as error:  # Missing package or file: detection just falls back.
            LOGGER.warning("GeoIP database unavailable (%s): %s", path, error)
            _reader = None
            _reader_path = path
        return _reader


def lookup_ip_country(ip: str, database_path: str) -> Optional[str]:
    if not database_path or not ip:
        return None
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if address.is_private or address.is_loopback or address.is_reserved:
        return None
    reader = _geoip_reader(database_path)
    if reader is None:
        return None
    try:
        record = reader.get(str(address)) or {}
    except Exception:
        return None
    country = record.get("country") or record.get("registered_country") or {}
    return normalize_country(country.get("iso_code") if isinstance(country, dict) else None)


def request_client_ip(headers: Any, peer: Optional[str], trust_proxy: int) -> str:
    forwarded_for = headers.get("x-forwarded-for", "")
    if trust_proxy and forwarded_for:
        # Vercel's rewrite proxy sets the first entry to the visitor's address.
        return forwarded_for.split(",")[0].strip()
    return peer or ""


def resolve_country(headers: Any, peer: Optional[str], trust_proxy: int, database_path: str) -> Tuple[Optional[str], str]:
    """Return (ISO country code or None, source label)."""
    for name in COUNTRY_HEADERS:
        country = normalize_country(headers.get(name))
        if country:
            return country, name
    country = lookup_ip_country(request_client_ip(headers, peer, trust_proxy), database_path)
    if country:
        return country, "geoip"
    return None, "unknown"


def plan_visible_in_country(plan_countries: Any, country: Optional[str], has_country_plans: bool) -> bool:
    """A plan with no countries is the default price for every country without its own plans."""
    countries = list(plan_countries or [])
    if country is None:
        return True
    if has_country_plans:
        return country in countries
    return not countries
