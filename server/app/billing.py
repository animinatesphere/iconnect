import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Dict, Optional


class BillingProviderError(Exception):
    def __init__(self, status_code: Optional[int] = None, detail: Optional[str] = None):
        super().__init__(detail or "")
        self.status_code = status_code
        self.detail = detail


def _provider_error_detail(raw: Any) -> Optional[str]:
    """Pull the provider's human-readable error message (never contains secrets)."""
    try:
        data = json.loads(raw) if isinstance(raw, (bytes, str)) else raw
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    message = data.get("message")
    if not message and isinstance(data.get("error"), dict):
        message = data["error"].get("message")
    return str(message)[:300] if message else None


def provider_request(
    provider: str,
    secret_key: str,
    path: str,
    payload: Optional[Dict[str, Any]] = None,
    method: Optional[str] = None,
) -> Dict[str, Any]:
    is_stripe = provider == "stripe"
    base_url = "https://api.stripe.com" if is_stripe else "https://api.paystack.co"
    url = base_url + path
    body = None
    # Paystack's Cloudflare firewall rejects Python's default "Python-urllib" agent with HTTP 403.
    headers = {"Accept": "application/json", "User-Agent": "iConnect-API/1.0"}
    if is_stripe:
        headers["Authorization"] = "Bearer " + secret_key
        if payload is not None:
            body = urllib.parse.urlencode(payload).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
    else:
        headers["Authorization"] = "Bearer " + secret_key
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

    request = urllib.request.Request(
        url,
        data=body,
        headers=headers,
        method=method or ("POST" if payload is not None else "GET"),
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read(1024 * 1024))
    except urllib.error.HTTPError as error:
        try:
            raw = error.read(64 * 1024)
            detail = _provider_error_detail(raw) or (
                "non-JSON response: " + raw[:200].decode("utf-8", "replace").replace("\n", " ")
            )
        except OSError:
            detail = None
        raise BillingProviderError(error.code, detail) from error
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        raise BillingProviderError(None, type(error).__name__ + ": " + str(error)[:200]) from error

    if not isinstance(result, dict):
        raise BillingProviderError()
    if not is_stripe and result.get("status") is False:
        raise BillingProviderError(None, _provider_error_detail(result))
    return result


def verify_paystack_signature(payload: bytes, signature: str, secret_key: str) -> bool:
    expected = hmac.new(secret_key.encode("utf-8"), payload, hashlib.sha512).hexdigest()
    try:
        candidate = bytes.fromhex(signature)
    except ValueError:
        return False
    return len(candidate) == hashlib.sha512().digest_size and hmac.compare_digest(
        bytes.fromhex(expected), candidate
    )


def verify_stripe_signature(
    payload: bytes,
    signature: str,
    secret: str,
    now: Optional[int] = None,
) -> bool:
    values = {}
    for entry in signature.split(","):
        key, separator, value = entry.partition("=")
        if separator:
            values.setdefault(key, []).append(value)
    timestamps = values.get("t", [])
    signatures = values.get("v1", [])
    if len(timestamps) != 1 or not signatures:
        return False
    try:
        timestamp = int(timestamps[0])
    except ValueError:
        return False
    if abs((now if now is not None else int(time.time())) - timestamp) > 300:
        return False
    signed_payload = timestamps[0].encode("ascii") + b"." + payload
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    expected_bytes = bytes.fromhex(expected)
    for candidate in signatures:
        try:
            candidate_bytes = bytes.fromhex(candidate)
        except ValueError:
            continue
        if len(candidate_bytes) == hashlib.sha256().digest_size and hmac.compare_digest(
            expected_bytes, candidate_bytes
        ):
            return True
    return False


def parse_provider_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, (int, float)):
        from datetime import timezone

        try:
            return datetime.fromtimestamp(value, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str) and value:
        normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            from datetime import timezone

            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    return None
