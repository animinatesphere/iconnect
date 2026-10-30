import base64
import hashlib
import hmac
import secrets

from cryptography.hazmat.primitives.kdf.scrypt import Scrypt


PASSWORD_N = 32768
PASSWORD_R = 8
PASSWORD_P = 1
PASSWORD_KEY_LENGTH = 64


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    password_hash = Scrypt(
        salt=salt,
        length=PASSWORD_KEY_LENGTH,
        n=PASSWORD_N,
        r=PASSWORD_R,
        p=PASSWORD_P,
    ).derive(password.encode("utf-8"))
    return "scrypt$32768$8$1${}${}".format(
        _b64url_encode(salt),
        _b64url_encode(password_hash),
    )


def verify_password(password: str, encoded_hash: str) -> bool:
    try:
        algorithm, n, r, p, salt_text, hash_text = encoded_hash.split("$")
        if (algorithm, n, r, p) != ("scrypt", "32768", "8", "1"):
            return False
        salt = _b64url_decode(salt_text)
        expected = _b64url_decode(hash_text)
        if len(salt) != 16 or len(expected) != PASSWORD_KEY_LENGTH:
            return False
        actual = Scrypt(
            salt=salt,
            length=len(expected),
            n=PASSWORD_N,
            r=PASSWORD_R,
            p=PASSWORD_P,
        ).derive(password.encode("utf-8"))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def create_email_code() -> str:
    return str(secrets.randbelow(900000) + 100000)


def hash_email_code(code: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), code.encode("utf-8"), hashlib.sha256).hexdigest()


def secure_hash_equals(first: str, second: str) -> bool:
    try:
        first_bytes = bytes.fromhex(first)
        second_bytes = bytes.fromhex(second)
    except ValueError:
        return False
    return len(first_bytes) == len(second_bytes) and hmac.compare_digest(first_bytes, second_bytes)


def create_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_session_token(token: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), token.encode("ascii"), hashlib.sha256).hexdigest()
