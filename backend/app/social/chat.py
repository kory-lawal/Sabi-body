"""Private one-to-one messaging between accepted friends.

- Only accepted, unblocked friends can send. Either side can still read the
  history of a conversation they belong to after an unfriend (but not after a
  block, which hides the conversation entirely for both).
- Sends are idempotent per (sender, client_msg_id), so retries after a flaky
  connection never duplicate a message.
- Exercise cards carry only catalogue data (exercise id + suggested target) —
  never anyone's workout records.
"""
import re
import uuid
from datetime import datetime, timedelta

from fastapi import status
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.accounts import rate_limit
from app.accounts.deps import api_error
from app.accounts.security import utcnow
from app.db.models import Conversation, ConversationRead, Message, User
from app.routes.workouts import EXERCISES
from app.social import notifications
from app.social.common import block_exists, other_user, pair, public_user, require_friend
from app.social.events import queue_event

CLIENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
MAX_BODY = 2000

NUDGE_PRESETS = {
    "remind_today": "Don’t forget your workout today!",
    "waiting": "Your workout partner is waiting for you.",
    "lets_finish": "Let’s finish our workout today!",
    "milestone": "One more workout to reach our next milestone!",
    "you_got_this": "You’ve got this — keep going!",
    "upcoming": "Don’t forget our workout together later!",
}
NUDGE_PAIR_COOLDOWN = timedelta(hours=4)
NUDGE_DAILY_LIMIT = 10


def get_conversation(db: Session, a: uuid.UUID, b: uuid.UUID, create: bool = False) -> Conversation | None:
    low, high = pair(a, b)
    conv = db.scalar(select(Conversation).where(Conversation.user_low == low, Conversation.user_high == high))
    if conv is None and create:
        db.execute(pg_insert(Conversation).values(id=uuid.uuid4(), user_low=low, user_high=high)
                   .on_conflict_do_nothing(constraint="uq_conversations_pair"))
        conv = db.scalar(select(Conversation).where(Conversation.user_low == low, Conversation.user_high == high))
    return conv


def message_out(row: Message) -> dict:
    return {
        "id": str(row.id),
        "conversation_id": str(row.conversation_id),
        "sender_id": str(row.sender_id),
        "kind": row.kind,
        "body": row.body,
        "payload": row.payload or {},
        "client_msg_id": row.client_msg_id,
        "created_at": row.created_at.isoformat(),
    }


def _validate_payload(kind: str, body: str, payload: dict) -> tuple[str, dict]:
    body = (body or "").strip()
    if len(body) > MAX_BODY:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "message_too_long", "Messages can be up to 2000 characters.")
    if kind == "text":
        if not body:
            raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "empty_message", "Type a message first.")
        return body, {}
    if kind == "exercise_card":
        exercise_id = str((payload or {}).get("exercise_id", ""))
        if exercise_id not in EXERCISES:
            raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown_exercise", "Choose a SabiBody exercise.")
        name, ex_type = EXERCISES[exercise_id]
        try:
            target = int((payload or {}).get("target") or 0)
        except (TypeError, ValueError):
            target = 0
        limit = 3600 if ex_type == "duration" else 200
        target = max(1, min(target, limit)) if target else (30 if ex_type == "duration" else 10)
        return body[:280], {"exercise_id": exercise_id, "exercise_name": name, "exercise_type": ex_type,
                            "target": target}
    raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "unsupported_kind", "That message type can't be sent here.")


def _deliver(db: Session, conv: Conversation, sender: User, recipient_id: uuid.UUID, row: Message) -> None:
    out = message_out(row)
    for uid in (sender.id, recipient_id):
        queue_event(db, uid, "chat.message", {"message": out, "with_user": str(sender.id if uid == recipient_id
                                                                                   else recipient_id)})
    if row.kind == "nudge":  # nudges raise their own "encouragement" notification
        return
    count = unread_in(db, conv.id, recipient_id)
    notifications.notify(
        db, recipient_id, "message", actor_id=sender.id, entity_type="conversation", entity_id=conv.id,
        dedupe_key=f"message:{conv.id}", refresh=True, payload={"count": count, "kind": row.kind},
    )


def create_message(db: Session, sender: User, friend_id: uuid.UUID, kind: str, body: str, payload: dict,
                   client_msg_id: str, *, system: bool = False) -> tuple[Message, bool]:
    """Insert a message (idempotently) and queue realtime delivery. Caller commits.

    system=True is used by other services (invitations, schedules, nudges) for
    kinds a client may not send directly; they validate their own payloads.
    """
    if not CLIENT_ID_PATTERN.match(client_msg_id or ""):
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_client_id", "Invalid message id.")
    require_friend(db, sender.id, friend_id)
    if not system:
        body, payload = _validate_payload(kind, body, payload)
    conv = get_conversation(db, sender.id, friend_id, create=True)
    now = utcnow()
    result = db.execute(
        pg_insert(Message).values(
            id=uuid.uuid4(), conversation_id=conv.id, sender_id=sender.id, kind=kind, body=body,
            payload=payload or {}, client_msg_id=client_msg_id, created_at=now,
        ).on_conflict_do_nothing(constraint="uq_messages_sender_client_id").returning(Message.id)
    )
    new_id = result.scalar()
    if new_id is None:  # retry of an already stored message
        existing = db.scalar(select(Message).where(Message.sender_id == sender.id,
                                                   Message.client_msg_id == client_msg_id))
        return existing, True
    row = db.get(Message, new_id)
    conv.last_message_at = now
    # The sender has obviously read everything up to their own message.
    _set_read(db, conv.id, sender.id, now)
    _deliver(db, conv, sender, friend_id, row)
    return row, False


def send(db: Session, sender: User, friend_id: uuid.UUID, kind: str, body: str, payload: dict,
         client_msg_id: str) -> dict:
    if not rate_limit.hit(f"chat:{sender.id}", 30, 10) or not rate_limit.hit(f"chat-day:{sender.id}", 2000, 86400):
        raise api_error(status.HTTP_429_TOO_MANY_REQUESTS, "rate_limited", "You’re sending messages very fast. Take a breath!")
    row, duplicate = create_message(db, sender, friend_id, kind, body, payload, client_msg_id)
    db.commit()
    return {"message": message_out(row), "duplicate": duplicate}


def _set_read(db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID, when: datetime) -> None:
    stmt = pg_insert(ConversationRead).values(conversation_id=conversation_id, user_id=user_id, last_read_at=when)
    db.execute(stmt.on_conflict_do_update(
        index_elements=["conversation_id", "user_id"],
        set_={"last_read_at": func.greatest(ConversationRead.last_read_at, stmt.excluded.last_read_at)},
    ))


def unread_in(db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID) -> int:
    last_read = db.scalar(select(ConversationRead.last_read_at).where(
        ConversationRead.conversation_id == conversation_id, ConversationRead.user_id == user_id))
    query = select(func.count()).select_from(Message).where(
        Message.conversation_id == conversation_id, Message.sender_id != user_id)
    if last_read is not None:
        query = query.where(Message.created_at > last_read)
    return int(db.scalar(query) or 0)


def total_unread(db: Session, user_id: uuid.UUID) -> int:
    reads = select(ConversationRead.conversation_id, ConversationRead.last_read_at).where(
        ConversationRead.user_id == user_id).subquery()
    query = (
        select(func.count())
        .select_from(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .outerjoin(reads, reads.c.conversation_id == Conversation.id)
        .where(
            or_(Conversation.user_low == user_id, Conversation.user_high == user_id),
            Message.sender_id != user_id,
            or_(reads.c.last_read_at.is_(None), Message.created_at > reads.c.last_read_at),
        )
    )
    return int(db.scalar(query) or 0)


def mark_read(db: Session, me: User, friend_id: uuid.UUID) -> dict:
    conv = get_conversation(db, me.id, friend_id)
    if conv is None:
        return {"unread": total_unread(db, me.id)}
    now = utcnow()
    _set_read(db, conv.id, me.id, now)
    notifications.mark_entity_read(db, me.id, "conversation", conv.id)
    queue_event(db, friend_id, "chat.read", {"conversation_id": str(conv.id), "reader_id": str(me.id),
                                             "read_at": now.isoformat()})
    db.flush()
    unread = total_unread(db, me.id)
    queue_event(db, me.id, "chat.unread", {"unread": unread, "notifications": notifications.unread_count(db, me.id)})
    db.commit()
    return {"unread": unread}


def history(db: Session, me: User, friend_id: uuid.UUID, before: datetime | None, limit: int) -> dict:
    friend = db.get(User, friend_id)
    if friend is None or block_exists(db, me.id, friend_id):
        raise api_error(status.HTTP_404_NOT_FOUND, "conversation_not_found", "We couldn't find that conversation.")
    conv = get_conversation(db, me.id, friend_id)
    messages: list[Message] = []
    other_read_at = None
    if conv is not None:
        query = select(Message).where(Message.conversation_id == conv.id)
        if before is not None:
            query = query.where(Message.created_at < before)
        messages = list(db.scalars(query.order_by(Message.created_at.desc(), Message.id.desc()).limit(limit)))
        messages.reverse()
        other_read_at = db.scalar(select(ConversationRead.last_read_at).where(
            ConversationRead.conversation_id == conv.id, ConversationRead.user_id == friend_id))
    from app.social.common import are_friends
    return {
        "with_user": public_user(friend),
        "can_send": are_friends(db, me.id, friend_id),
        "messages": [message_out(m) for m in messages],
        "has_more": len(messages) == limit,
        "other_read_at": other_read_at.isoformat() if other_read_at else None,
    }


def conversations(db: Session, me: User) -> dict:
    convs = db.scalars(
        select(Conversation)
        .where(or_(Conversation.user_low == me.id, Conversation.user_high == me.id),
               Conversation.last_message_at.is_not(None))
        .order_by(Conversation.last_message_at.desc())
        .limit(100)
    ).all()
    items = []
    for conv in convs:
        friend_id = other_user(conv, me.id)
        if block_exists(db, me.id, friend_id):
            continue
        friend = db.get(User, friend_id)
        if friend is None:
            continue
        last = db.scalar(select(Message).where(Message.conversation_id == conv.id)
                         .order_by(Message.created_at.desc()).limit(1))
        items.append({
            "conversation_id": str(conv.id),
            "with_user": public_user(friend),
            "last_message": message_out(last) if last else None,
            "unread": unread_in(db, conv.id, me.id),
        })
    return {"conversations": items, "unread": total_unread(db, me.id)}


def nudge(db: Session, sender: User, friend_id: uuid.UUID, preset: str) -> dict:
    if preset not in NUDGE_PRESETS:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown_preset", "Choose one of the suggestions.")
    friend = require_friend(db, sender.id, friend_id)
    now = utcnow()
    conv = get_conversation(db, sender.id, friend_id, create=True)
    recent = db.scalar(select(Message.created_at).where(
        Message.conversation_id == conv.id, Message.sender_id == sender.id, Message.kind == "nudge",
        Message.created_at > now - NUDGE_PAIR_COOLDOWN).limit(1))
    if recent is not None:
        raise api_error(status.HTTP_429_TOO_MANY_REQUESTS, "nudge_cooldown",
                        f"You recently nudged {friend.full_name.split(' ')[0]}. Give them a few hours.")
    today = db.scalar(select(func.count()).select_from(Message).where(
        Message.sender_id == sender.id, Message.kind == "nudge", Message.created_at > now - timedelta(days=1)))
    if (today or 0) >= NUDGE_DAILY_LIMIT:
        raise api_error(status.HTTP_429_TOO_MANY_REQUESTS, "nudge_limit", "You’ve sent a lot of nudges today.")
    text = NUDGE_PRESETS[preset]
    row, _ = create_message(db, sender, friend_id, "nudge", text, {"preset": preset},
                            f"nudge-{uuid.uuid4().hex}", system=True)
    notifications.notify(db, friend_id, "encouragement", actor_id=sender.id, entity_type="message", entity_id=row.id,
                         dedupe_key=f"nudge:{row.id}", payload={"text": text, "preset": preset})
    db.commit()
    return {"message": message_out(row)}
