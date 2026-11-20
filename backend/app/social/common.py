"""Shared relationship helpers: pair ordering, friendship and block checks, public profiles."""
import uuid

from fastapi import status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.accounts.deps import api_error
from app.db.models import Friendship, FriendMute, User, UserBlock


def pair(a: uuid.UUID, b: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    """Canonical (low, high) ordering; matches Postgres uuid ordering."""
    return (a, b) if a < b else (b, a)


def other_user(row, me: uuid.UUID) -> uuid.UUID:
    return row.user_high if row.user_low == me else row.user_low


def first_name(full_name: str) -> str:
    return (full_name or "").split(" ")[0] or "there"


def public_user(user: User) -> dict:
    """What any signed-in user may see about another user. Never includes email."""
    parts = [p for p in user.full_name.split(" ") if p]
    initials = "".join(p[0] for p in parts[:2]).upper() or user.username[:2].upper()
    return {
        "id": str(user.id),
        "username": user.username,
        "display_name": user.full_name,
        "first_name": first_name(user.full_name),
        "initials": initials,
    }


def friendship_between(db: Session, a: uuid.UUID, b: uuid.UUID) -> Friendship | None:
    low, high = pair(a, b)
    return db.scalar(select(Friendship).where(Friendship.user_low == low, Friendship.user_high == high))


def are_friends(db: Session, a: uuid.UUID, b: uuid.UUID) -> bool:
    row = friendship_between(db, a, b)
    return row is not None and row.status == "accepted"


def block_exists(db: Session, a: uuid.UUID, b: uuid.UUID) -> bool:
    """True if either user has blocked the other."""
    return db.scalar(
        select(UserBlock.id).where(
            or_(
                (UserBlock.blocker_id == a) & (UserBlock.blocked_id == b),
                (UserBlock.blocker_id == b) & (UserBlock.blocked_id == a),
            )
        )
    ) is not None


def is_muted(db: Session, user_id: uuid.UUID, by_user_id: uuid.UUID) -> bool:
    """Has user_id muted notifications from by_user_id?"""
    return db.scalar(
        select(FriendMute.id).where(FriendMute.user_id == user_id, FriendMute.muted_user_id == by_user_id)
    ) is not None


def require_friend(db: Session, me: uuid.UUID, friend_id: uuid.UUID) -> User:
    """Load an accepted, unblocked, active friend or raise 404/403."""
    friend = db.get(User, friend_id)
    if friend is None or not friend.is_active:
        raise api_error(status.HTTP_404_NOT_FOUND, "user_not_found", "We couldn't find that person.")
    if block_exists(db, me, friend_id) or not are_friends(db, me, friend_id):
        raise api_error(status.HTTP_403_FORBIDDEN, "not_friends", "You can only do this with your SabiBody friends.")
    return friend


def parse_uuid(value: str, code: str = "not_found", message: str = "Not found.") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise api_error(status.HTTP_404_NOT_FOUND, code, message) from exc
