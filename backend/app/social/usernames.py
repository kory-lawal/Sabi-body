"""Public usernames (handles) used to find friends."""
import re
import secrets
import uuid

from fastapi import status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.accounts.deps import api_error
from app.db.models import User

USERNAME_PATTERN = re.compile(r"^[a-z0-9_]{3,20}$")
RESERVED = {
    "admin", "administrator", "support", "help", "sabibody", "sabi_body", "system", "root", "moderator",
    "staff", "official", "null", "undefined", "me", "you", "api", "www", "search",
}


def normalize(value: str) -> str:
    return (value or "").strip().lstrip("@").lower()


def validate(value: str) -> str:
    name = normalize(value)
    if not USERNAME_PATTERN.match(name):
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_username",
                        "Use 3–20 lowercase letters, numbers or underscores.")
    if name in RESERVED:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "reserved_username", "That username isn't available.")
    return name


def is_taken(db: Session, name: str, exclude: uuid.UUID | None = None) -> bool:
    query = select(User.id).where(User.username == name)
    if exclude is not None:
        query = query.where(User.id != exclude)
    return db.scalar(query) is not None


def generate(db: Session, email: str) -> str:
    """Derive a free handle from the email's local part (e.g. ada.obi@x.com -> adaobi)."""
    base = re.sub(r"[^a-z0-9_]", "", email.split("@", 1)[0].lower())[:14]
    if len(base) < 3 or base in RESERVED:
        base = (base + "user")[:14] if base not in RESERVED else "user"
    if not is_taken(db, base):
        return base
    for _ in range(20):
        candidate = f"{base}_{secrets.token_hex(3)[:5]}"
        if not is_taken(db, candidate):
            return candidate
    return f"user_{secrets.token_hex(7)}"[:20]
