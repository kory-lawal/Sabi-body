"""Friendship rules.

- Both people must accept before they are friends (one row per pair).
- Duplicate requests/friendships are impossible (unique pair).
- If either person blocked the other, nothing can be sent between them, and a
  blocked person cannot tell they were blocked (they get the same "not found").
- Ending a friendship or blocking cancels open invitations and challenges
  between the pair; private workout records are never shared or exposed.
"""
import uuid
from datetime import timedelta

from fastapi import status
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.accounts.deps import api_error
from app.accounts.security import utcnow
from app.db.models import (
    Challenge,
    FriendMute,
    FriendRequestEvent,
    Friendship,
    SharedSession,
    User,
    UserBlock,
)
from app.social import notifications, usernames
from app.social.common import block_exists, friendship_between, other_user, pair, public_user
from app.social.events import queue_event

DAILY_REQUEST_LIMIT = 20
DECLINE_COOLDOWN = timedelta(days=7)
NOT_FOUND = ("user_not_found", "We couldn't find a SabiBody member with that username.")


def _discoverable(user: User | None) -> bool:
    return user is not None and user.is_active and user.email_verified


def find_by_username(db: Session, username: str) -> User | None:
    name = usernames.normalize(username)
    if not usernames.USERNAME_PATTERN.match(name):
        return None
    return db.scalar(select(User).where(User.username == name))


def relationship(db: Session, me: uuid.UUID, other: uuid.UUID) -> str:
    if me == other:
        return "self"
    if db.scalar(select(UserBlock.id).where(UserBlock.blocker_id == me, UserBlock.blocked_id == other)):
        return "blocked"
    row = friendship_between(db, me, other)
    if row is None:
        return "none"
    if row.status == "accepted":
        return "friends"
    return "outgoing" if row.requester_id == me else "incoming"


def search(db: Session, me: uuid.UUID, query: str, limit: int = 10) -> list[dict]:
    q = usernames.normalize(query)
    if len(q) < 2:
        return []
    q = "".join(ch for ch in q if ch.isalnum() or ch == "_")
    if len(q) < 2:
        return []
    blocked_either = select(UserBlock.blocked_id).where(UserBlock.blocker_id == me).union(
        select(UserBlock.blocker_id).where(UserBlock.blocked_id == me)
    )
    rows = db.scalars(
        select(User)
        .where(
            User.username.like(f"{q}%"),
            User.id != me,
            User.is_active.is_(True),
            User.email_verified.is_(True),
            User.id.not_in(blocked_either),
        )
        .order_by(func.char_length(User.username), User.username)
        .limit(limit)
    ).all()
    return [{**public_user(u), "relationship": relationship(db, me, u.id)} for u in rows]


def _record(db: Session, requester: uuid.UUID, target: uuid.UUID, outcome: str) -> None:
    db.add(FriendRequestEvent(requester_id=requester, target_id=target, outcome=outcome))


def _accept(db: Session, row: Friendship, accepter: User) -> None:
    row.status = "accepted"
    row.accepted_at = utcnow()
    requester_id = row.requester_id
    notifications.mark_entity_read(db, accepter.id, "friendship", row.id)
    notifications.notify(
        db, requester_id, "friend_accepted", actor_id=accepter.id, entity_type="friendship", entity_id=row.id,
        dedupe_key=f"friend_accepted:{row.id}",
    )
    for uid in (requester_id, accepter.id):
        queue_event(db, uid, "friends.changed", {})


def send_request(db: Session, me: User, username: str) -> dict:
    target = find_by_username(db, username)
    if not _discoverable(target) or target.id == me.id:
        if target is not None and target.id == me.id:
            raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "self_request", "You can't add yourself.")
        raise api_error(status.HTTP_404_NOT_FOUND, *NOT_FOUND)
    if db.scalar(select(UserBlock.id).where(UserBlock.blocker_id == me.id, UserBlock.blocked_id == target.id)):
        raise api_error(status.HTTP_409_CONFLICT, "you_blocked", "Unblock this person first to send a request.")
    if db.scalar(select(UserBlock.id).where(UserBlock.blocker_id == target.id, UserBlock.blocked_id == me.id)):
        raise api_error(status.HTTP_404_NOT_FOUND, *NOT_FOUND)  # never reveal a block

    existing = friendship_between(db, me.id, target.id)
    if existing is not None:
        if existing.status == "accepted":
            raise api_error(status.HTTP_409_CONFLICT, "already_friends", "You're already friends.")
        if existing.requester_id == me.id:
            raise api_error(status.HTTP_409_CONFLICT, "request_exists", "You've already sent a request.")
        _accept(db, existing, me)  # they asked first: sending back means yes
        db.commit()
        return {"status": "accepted", "user": public_user(target)}

    now = utcnow()
    sent_today = db.scalar(
        select(func.count()).select_from(FriendRequestEvent).where(
            FriendRequestEvent.requester_id == me.id, FriendRequestEvent.outcome == "sent",
            FriendRequestEvent.created_at > now - timedelta(days=1),
        )
    )
    if (sent_today or 0) >= DAILY_REQUEST_LIMIT:
        raise api_error(status.HTTP_429_TOO_MANY_REQUESTS, "request_limit",
                        "You've sent a lot of requests today. Try again tomorrow.")
    declined_recently = db.scalar(
        select(FriendRequestEvent.id).where(
            FriendRequestEvent.requester_id == me.id, FriendRequestEvent.target_id == target.id,
            FriendRequestEvent.outcome == "declined", FriendRequestEvent.created_at > now - DECLINE_COOLDOWN,
        )
    )
    if declined_recently:
        raise api_error(status.HTTP_429_TOO_MANY_REQUESTS, "request_cooldown",
                        "You can send this person another request in a few days.")

    low, high = pair(me.id, target.id)
    row = Friendship(user_low=low, user_high=high, requester_id=me.id, status="pending")
    db.add(row)
    try:
        db.flush()
    except IntegrityError as exc:  # a concurrent request for the same pair
        db.rollback()
        raise api_error(status.HTTP_409_CONFLICT, "request_exists", "There's already a request between you.") from exc
    _record(db, me.id, target.id, "sent")
    notifications.notify(
        db, target.id, "friend_request", actor_id=me.id, entity_type="friendship", entity_id=row.id,
        dedupe_key=f"friend_request:{row.id}",
    )
    queue_event(db, target.id, "friends.changed", {})
    db.commit()
    return {"status": "pending", "request_id": str(row.id), "user": public_user(target)}


def _pending_for(db: Session, request_id: uuid.UUID, me: uuid.UUID) -> Friendship:
    row = db.get(Friendship, request_id)
    if row is None or row.status != "pending" or me not in (row.user_low, row.user_high):
        raise api_error(status.HTTP_404_NOT_FOUND, "request_not_found", "That friend request no longer exists.")
    return row


def respond(db: Session, me: User, request_id: uuid.UUID, action: str) -> dict:
    row = _pending_for(db, request_id, me.id)
    other = other_user(row, me.id)
    if action in ("accept", "decline") and row.requester_id == me.id:
        raise api_error(status.HTTP_403_FORBIDDEN, "not_recipient", "Only the person you invited can answer.")
    if action == "cancel" and row.requester_id != me.id:
        raise api_error(status.HTTP_403_FORBIDDEN, "not_requester", "Only the sender can cancel a request.")

    if action == "accept":
        if block_exists(db, me.id, other):
            raise api_error(status.HTTP_404_NOT_FOUND, "request_not_found", "That friend request no longer exists.")
        _accept(db, row, me)
    else:
        # The target of a request is always the person who didn't send it.
        target = me.id if action == "decline" else other
        _record(db, row.requester_id, target, "declined" if action == "decline" else "cancelled")
        notifications.mark_entity_read(db, me.id, "friendship", row.id)
        notifications.mark_entity_read(db, other, "friendship", row.id)
        db.delete(row)
        queue_event(db, other, "friends.changed", {})
    db.commit()
    return {"status": "accepted" if action == "accept" else "removed"}


def end_open_items(db: Session, a: uuid.UUID, b: uuid.UUID, reason: str) -> None:
    """Cancel invitations, commitments and challenges between two people (no streak penalty)."""
    low, high = pair(a, b)
    now = utcnow()
    db.execute(
        update(SharedSession)
        .where(SharedSession.user_low == low, SharedSession.user_high == high,
               SharedSession.status.in_(("proposed", "accepted", "live")))
        .values(status="cancelled", cancelled_at=now, awaiting_user_id=None)
    )
    db.execute(
        update(Challenge)
        .where(or_((Challenge.creator_id == a) & (Challenge.opponent_id == b),
                   (Challenge.creator_id == b) & (Challenge.opponent_id == a)),
               Challenge.status.in_(("pending", "active")))
        .values(status="cancelled", finished_at=now, result={"reason": reason})
    )


def remove_friend(db: Session, me: User, friend_id: uuid.UUID) -> None:
    row = friendship_between(db, me.id, friend_id)
    if row is None or row.status != "accepted":
        raise api_error(status.HTTP_404_NOT_FOUND, "not_friends", "You're not friends with this person.")
    db.delete(row)
    end_open_items(db, me.id, friend_id, "friend_removed")
    db.execute(delete(FriendMute).where(FriendMute.user_id == me.id, FriendMute.muted_user_id == friend_id))
    for uid in (me.id, friend_id):
        queue_event(db, uid, "friends.changed", {})
    db.commit()


def block(db: Session, me: User, username: str) -> dict:
    target = find_by_username(db, username)
    if target is None or target.id == me.id:
        raise api_error(status.HTTP_404_NOT_FOUND, *NOT_FOUND)
    if db.scalar(select(UserBlock.id).where(UserBlock.blocker_id == me.id, UserBlock.blocked_id == target.id)):
        return {"status": "blocked", "user": public_user(target)}
    db.add(UserBlock(blocker_id=me.id, blocked_id=target.id))
    row = friendship_between(db, me.id, target.id)
    if row is not None:
        db.delete(row)
    end_open_items(db, me.id, target.id, "blocked")
    queue_event(db, target.id, "friends.changed", {})
    queue_event(db, me.id, "friends.changed", {})
    db.commit()
    return {"status": "blocked", "user": public_user(target)}


def unblock(db: Session, me: User, user_id: uuid.UUID) -> None:
    db.execute(delete(UserBlock).where(UserBlock.blocker_id == me.id, UserBlock.blocked_id == user_id))
    queue_event(db, me.id, "friends.changed", {})
    db.commit()


def set_mute(db: Session, me: User, friend_id: uuid.UUID, muted: bool) -> None:
    row = friendship_between(db, me.id, friend_id)
    if row is None or row.status != "accepted":
        raise api_error(status.HTTP_404_NOT_FOUND, "not_friends", "You're not friends with this person.")
    if muted:
        exists = db.scalar(select(FriendMute.id).where(FriendMute.user_id == me.id,
                                                       FriendMute.muted_user_id == friend_id))
        if not exists:
            db.add(FriendMute(user_id=me.id, muted_user_id=friend_id))
    else:
        db.execute(delete(FriendMute).where(FriendMute.user_id == me.id, FriendMute.muted_user_id == friend_id))
    db.commit()


def friend_ids(db: Session, me: uuid.UUID) -> list[uuid.UUID]:
    rows = db.execute(
        select(Friendship.user_low, Friendship.user_high).where(
            Friendship.status == "accepted", or_(Friendship.user_low == me, Friendship.user_high == me)
        )
    ).all()
    return [high if low == me else low for low, high in rows]


def overview(db: Session, me: uuid.UUID) -> dict:
    rows = db.scalars(
        select(Friendship).where(or_(Friendship.user_low == me, Friendship.user_high == me))
        .order_by(Friendship.created_at.desc())
    ).all()
    other_ids = {other_user(r, me) for r in rows}
    blocked_rows = db.scalars(select(UserBlock).where(UserBlock.blocker_id == me).order_by(UserBlock.created_at.desc())).all()
    other_ids |= {b.blocked_id for b in blocked_rows}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(other_ids)))} if other_ids else {}
    muted = set(db.scalars(select(FriendMute.muted_user_id).where(FriendMute.user_id == me)))

    friends, incoming, sent = [], [], []
    for row in rows:
        other = users.get(other_user(row, me))
        if other is None:
            continue
        if row.status == "accepted":
            friends.append({**public_user(other), "friends_since": row.accepted_at.isoformat() if row.accepted_at else None,
                            "muted": other.id in muted})
        elif row.requester_id == me:
            sent.append({"request_id": str(row.id), "user": public_user(other), "created_at": row.created_at.isoformat()})
        else:
            incoming.append({"request_id": str(row.id), "user": public_user(other),
                             "created_at": row.created_at.isoformat()})
    friends.sort(key=lambda f: f["display_name"].lower())
    blocked = [{**public_user(users[b.blocked_id]), "blocked_at": b.created_at.isoformat()}
               for b in blocked_rows if b.blocked_id in users]
    return {"friends": friends, "incoming": incoming, "sent": sent, "blocked": blocked}
