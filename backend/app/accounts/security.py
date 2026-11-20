"""Password hashing, opaque token generation and access-token signing."""
import hashlib
import hmac
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.config import settings

logger = logging.getLogger("sabibody.auth")

# Argon2id with argon2-cffi's RFC 9106 low-memory profile defaults.
_password_hasher = PasswordHasher()
# Used to keep login timing similar whether or not the email exists.
_DUMMY_HASH = _password_hasher.hash(secrets.token_urlsafe(16))

ACCESS_TOKEN_AUDIENCE = "sabibody-api"
ACCESS_TOKEN_ISSUER = "sabibody"

_ephemeral_secret: str | None = None


def auth_secret() -> str | None:
    """Return the signing secret. In development a random per-process secret is
    used when AUTH_SECRET_KEY is unset (sessions then end on restart)."""
    global _ephemeral_secret
    if settings.AUTH_SECRET_KEY:
        return settings.AUTH_SECRET_KEY
    if settings.IS_PRODUCTION:
        return None
    if _ephemeral_secret is None:
        _ephemeral_secret = secrets.token_urlsafe(48)
        logger.warning("AUTH_SECRET_KEY is not set; using a temporary development secret.")
    return _ephemeral_secret


PASSWORD_MIN_LENGTH = 10
PASSWORD_MAX_LENGTH = 128


def password_problems(password: str, *, email: str = "", full_name: str = "") -> list[str]:
    problems: list[str] = []
    if len(password) < PASSWORD_MIN_LENGTH:
        problems.append(f"Use at least {PASSWORD_MIN_LENGTH} characters.")
    if len(password) > PASSWORD_MAX_LENGTH:
        problems.append(f"Use no more than {PASSWORD_MAX_LENGTH} characters.")
    if not re.search(r"[A-Za-z]", password):
        problems.append("Include at least one letter.")
    if not re.search(r"\d", password):
        problems.append("Include at least one number.")
    lowered = password.lower()
    local_part = email.split("@")[0].lower() if email else ""
    if local_part and len(local_part) >= 4 and local_part in lowered:
        problems.append("Do not include your email address.")
    if len(set(password)) < 4:
        problems.append("Use a less repetitive password.")
    return problems


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _password_hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    try:
        return _password_hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return False


def new_opaque_token() -> str:
    """256 bits of randomness, URL-safe. Only its hash is ever stored."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def tokens_match(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID) -> tuple[str, int]:
    secret = auth_secret()
    if not secret:
        raise RuntimeError("AUTH_SECRET_KEY is required in production.")
    now = utcnow()
    lifetime = timedelta(minutes=settings.ACCESS_TOKEN_MINUTES)
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "iat": int(now.timestamp()),
        "exp": int((now + lifetime).timestamp()),
        "aud": ACCESS_TOKEN_AUDIENCE,
        "iss": ACCESS_TOKEN_ISSUER,
        "typ": "access",
    }
    return jwt.encode(payload, secret, algorithm="HS256"), int(lifetime.total_seconds())


class AccessTokenError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def decode_access_token(token: str) -> dict:
    secret = auth_secret()
    if not secret:
        raise AccessTokenError("auth_unconfigured")
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=ACCESS_TOKEN_AUDIENCE,
            issuer=ACCESS_TOKEN_ISSUER,
            options={"require": ["exp", "sub", "sid", "aud", "iss"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise AccessTokenError("token_expired") from exc
    except jwt.PyJWTError as exc:
        raise AccessTokenError("invalid_token") from exc
    if payload.get("typ") != "access":
        raise AccessTokenError("invalid_token")
    return payload
