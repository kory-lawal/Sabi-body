"""In-app notifications: creation (with preferences, mutes and dedupe), listing and read state."""
import uuid
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.accounts.security import utcnow
from app.db.models import Notification, NotificationPreference, User
from app.social.common import is_muted, public_user
from app.social.events import queue_event

# type -> (label shown in settings, in-app default, email default, mutable per friend)
NOTIFICATION_TYPES: dict[str, tuple[str, bool, bool]] = {
    "friend_request": ("Friend requests", True, False),
    "friend_accepted": ("Accepted friend requests", True, False),
    "message": ("New messages", True, False),
    "workout_invite": ("Workout invitations", True, False),
    "invite_response": ("Invitation responses", True, False),
    "session_update": ("Rescheduled or cancelled workouts", True, False),
    "workout_reminder": ("Workout reminders", True, True),
    "missed_commitment": ("Missed commitments", True, False),
    "streak_milestone": ("Streak milestones", True, False),
    "challenge": ("Challenges", True, False),
    "encouragement": ("Encouragement from friends", True, False),
}

# Types a friend's mute silences (system reminders and milestones still arrive).
MUTABLE_TYPES = {"message", "workout_invite", "invite_response", "session_update", "challenge", "encouragement",
                 "friend_accepted"}


def preferences_for(db: Session, user_id: uuid.UUID) -> dict[str, dict]:
    rows = {r.type: r for r in db.scalars(select(NotificationPreference).where(NotificationPreference.user_id == user_id))}
    out = {}
    for key, (label, in_app, email) in NOTIFICATION_TYPES.items():
        row = rows.get(key)
        out[key] = {
            "label": label,
            "in_app": row.in_app if row else in_app,
            "email": row.email if row else email,
            "email_supported": key == "workout_reminder",
        }
    return out


def wants(db: Session, user_id: uuid.UUID, notif_type: str, channel: str = "in_app") -> bool:
    row = db.get(NotificationPreference, (user_id, notif_type))
    if row is not None:
        return bool(getattr(row, channel))
    _, in_app, email = NOTIFICATION_TYPES[notif_type]
    return in_app if channel == "in_app" else email


def serialize(db: Session, row: Notification, actor: User | None = None) -> dict:
    if actor is None and row.actor_id is not None:
        actor = db.get(User, row.actor_id)
    return {
        "id": str(row.id),
        "type": row.type,
        "actor": public_user(actor) if actor else None,
        "entity_type": row.entity_type,
        "entity_id": str(row.entity_id) if row.entity_id else None,
        "payload": row.payload or {},
        "read": row.read_at is not None,
        "created_at": row.created_at.isoformat() if row.created_at else utcnow().isoformat(),
    }


def notify(
    db: Session,
    user_id: uuid.UUID,
    notif_type: str,
    *,
    dedupe_key: str,
    actor_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    payload: dict | None = None,
    refresh: bool = False,
) -> Notification | None:
    """Create a notification unless the user opted out or muted the actor.

    dedupe_key makes repeated triggers harmless. With refresh=True an existing
    row is brought back to the top as unread (used for "new messages from X").
    """
    if notif_type not in NOTIFICATION_TYPES:
        raise ValueError(f"Unknown notification type {notif_type}")
    if not wants(db, user_id, notif_type, "in_app"):
        return None
    if actor_id is not None and notif_type in MUTABLE_TYPES and is_muted(db, user_id, actor_id):
        return None

    now = utcnow()
    values = dict(
        id=uuid.uuid4(), user_id=user_id, type=notif_type, actor_id=actor_id, entity_type=entity_type,
        entity_id=entity_id, payload=payload or {}, dedupe_key=dedupe_key, created_at=now,
    )
    stmt = pg_insert(Notification).values(**values)
    if refresh:
        stmt = stmt.on_conflict_do_update(
            constraint="uq_notifications_user_dedupe",
            set_={"read_at": None, "created_at": now, "payload": stmt.excluded.payload, "actor_id": actor_id},
        )
    else:
        stmt = stmt.on_conflict_do_nothing(constraint="uq_notifications_user_dedupe")
    result = db.execute(stmt.returning(Notification.id))
    new_id = result.scalar()
    if new_id is None:
        return None
    row = db.get(Notification, new_id)
    db.refresh(row)
    queue_event(db, user_id, "notification.new", {"notification": serialize(db, row), "unread": unread_count(db, user_id)})
    return row


def unread_count(db: Session, user_id: uuid.UUID) -> int:
    return int(db.scalar(
        select(func.count()).select_from(Notification).where(Notification.user_id == user_id,
                                                             Notification.read_at.is_(None))
    ) or 0)


def list_notifications(db: Session, user_id: uuid.UUID, before: datetime | None, limit: int) -> list[Notification]:
    query = select(Notification).where(Notification.user_id == user_id)
    if before is not None:
        query = query.where(Notification.created_at < before)
    return list(db.scalars(query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit)))


def mark_read(db: Session, user_id: uuid.UUID, notification_ids: list[uuid.UUID] | None) -> int:
    stmt = update(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None))
    if notification_ids is not None:
        stmt = stmt.where(Notification.id.in_(notification_ids))
    result = db.execute(stmt.values(read_at=utcnow()))
    return result.rowcount or 0


def mark_entity_read(db: Session, user_id: uuid.UUID, entity_type: str, entity_id: uuid.UUID) -> None:
    db.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.entity_type == entity_type,
               Notification.entity_id == entity_id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
