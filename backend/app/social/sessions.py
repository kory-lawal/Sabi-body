"""Shared workout sessions: instant invitations and scheduled commitments.

Lifecycle (status):
  proposed  -> accepted  (the invited person, or whoever must answer a new time, says yes)
  proposed  -> declined  (they say no)  | expired (nobody answered in time)
  accepted  -> live      (both are in the workout room and ready)
  live      -> completed | incomplete
  proposed/accepted -> cancelled (either person)
  reschedule ("suggest another time") moves the session back to proposed and
  waits for the *other* person to accept the new time.

All times are stored as timezone-aware UTC timestamps; each person sees them
in their own timezone.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.accounts.deps import api_error
from app.accounts.security import utcnow
from app.db.models import SharedSession, SharedSessionEvent, SharedSessionParticipant, User
from app.routes.workouts import EXERCISES
from app.social import chat, notifications
from app.social.common import other_user, pair, public_user, require_friend
from app.social.events import queue_event

INSTANT_INVITE_TTL = timedelta(minutes=30)
JOIN_EARLY = timedelta(minutes=15)
JOIN_LATE = timedelta(hours=2)
LATE_CANCEL = timedelta(hours=2)
MIN_LEAD = timedelta(minutes=5)
MAX_AHEAD = timedelta(days=90)
MAX_REPS = 200
MAX_SECONDS = 3600


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def validate_target(exercise_id: str, target: int) -> tuple[str, int | None, int | None]:
    if exercise_id not in EXERCISES:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown_exercise", "Choose a SabiBody exercise.")
    ex_type = EXERCISES[exercise_id][1]
    limit = MAX_SECONDS if ex_type == "duration" else MAX_REPS
    if not isinstance(target, int) or target < 1 or target > limit:
        unit = "seconds" if ex_type == "duration" else "reps"
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_target", f"Choose a target between 1 and {limit} {unit}.")
    return ex_type, (target if ex_type == "reps" else None), (target if ex_type == "duration" else None)


def target_of(s: SharedSession) -> int:
    return s.target_reps if s.exercise_type == "reps" else s.target_duration_seconds


def participants(db: Session, session_id: uuid.UUID) -> dict[uuid.UUID, SharedSessionParticipant]:
    rows = db.scalars(select(SharedSessionParticipant).where(SharedSessionParticipant.session_id == session_id))
    return {r.user_id: r for r in rows}


def join_window(s: SharedSession) -> tuple[datetime, datetime]:
    if s.mode == "instant":
        start = _aware(s.created_at) or utcnow()
        return start, start + JOIN_LATE
    at = _aware(s.scheduled_at)
    return at - JOIN_EARLY, at + JOIN_LATE


def can_join(s: SharedSession, now: datetime | None = None) -> bool:
    now = now or utcnow()
    if s.status == "live":
        return True
    if s.status != "accepted":
        return False
    start, end = join_window(s)
    return start <= now <= end


def session_out(db: Session, s: SharedSession, me: uuid.UUID, parts: dict | None = None) -> dict:
    parts = parts if parts is not None else participants(db, s.id)
    partner_id = other_user(s, me)
    partner = db.get(User, partner_id)
    mine = parts.get(me)
    theirs = parts.get(partner_id)
    exercise_name = EXERCISES.get(s.exercise_id, (s.exercise_id, ""))[0]
    return {
        "id": str(s.id),
        "mode": s.mode,
        "status": s.status,
        "exercise_id": s.exercise_id,
        "exercise_name": exercise_name,
        "exercise_type": s.exercise_type,
        "target": target_of(s),
        "scheduled_at": _aware(s.scheduled_at).isoformat() if s.scheduled_at else None,
        "expires_at": _aware(s.expires_at).isoformat() if s.expires_at else None,
        "message": s.message,
        "partner": public_user(partner) if partner else None,
        "created_by_me": s.created_by == me,
        "awaiting_me": s.awaiting_user_id == me,
        "awaiting_partner": s.awaiting_user_id == partner_id,
        "my_rsvp": mine.rsvp if mine else None,
        "partner_rsvp": theirs.rsvp if theirs else None,
        "can_join": can_join(s),
        "round_number": s.round_number,
        "root_session_id": str(s.root_session_id) if s.root_session_id else None,
        "started_at": _aware(s.started_at).isoformat() if s.started_at else None,
        "ended_at": _aware(s.ended_at).isoformat() if s.ended_at else None,
        "cancelled_by_me": s.cancelled_by == me if s.cancelled_by else None,
        "created_at": _aware(s.created_at).isoformat() if s.created_at else None,
    }


def _broadcast(db: Session, s: SharedSession) -> None:
    for uid in (s.user_low, s.user_high):
        queue_event(db, uid, "session.updated", {"session_id": str(s.id)})


def _event(db: Session, s: SharedSession, actor: uuid.UUID | None, kind: str, data: dict | None = None) -> None:
    db.add(SharedSessionEvent(session_id=s.id, actor_id=actor, type=kind, data=data or {}))


def get_for(db: Session, session_id: uuid.UUID, me: uuid.UUID, lock: bool = False) -> SharedSession:
    query = select(SharedSession).where(SharedSession.id == session_id)
    if lock:
        query = query.with_for_update()
    s = db.scalar(query)
    if s is None or me not in (s.user_low, s.user_high):
        raise api_error(status.HTTP_404_NOT_FOUND, "session_not_found", "We couldn't find that workout.")
    return s


def _notify_payload(s: SharedSession, **extra) -> dict:
    return {"mode": s.mode, "exercise_id": s.exercise_id, "target": target_of(s),
            "scheduled_at": _aware(s.scheduled_at).isoformat() if s.scheduled_at else None, **extra}


def create(db: Session, me: User, friend_id: uuid.UUID, exercise_id: str, target: int, mode: str,
           scheduled_at: datetime | None, message: str | None, *, root: SharedSession | None = None,
           auto_accept: bool = False) -> SharedSession:
    friend = require_friend(db, me.id, friend_id)
    ex_type, target_reps, target_seconds = validate_target(exercise_id, target)
    now = utcnow()
    if mode == "scheduled":
        scheduled_at = _aware(scheduled_at)
        if scheduled_at is None:
            raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "time_required", "Choose a date and time.")
        if scheduled_at < now + MIN_LEAD:
            raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "time_in_past",
                            "Choose a time at least 5 minutes from now.")
        if scheduled_at > now + MAX_AHEAD:
            raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "time_too_far", "Plan up to 90 days ahead.")
        expires_at = scheduled_at
    elif mode == "instant":
        scheduled_at = None
        expires_at = now + INSTANT_INVITE_TTL
    else:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_mode", "Choose now or a scheduled time.")

    low, high = pair(me.id, friend.id)
    s = SharedSession(
        user_low=low, user_high=high, created_by=me.id, exercise_id=exercise_id, exercise_type=ex_type,
        target_reps=target_reps, target_duration_seconds=target_seconds, mode=mode, scheduled_at=scheduled_at,
        expires_at=expires_at, status="accepted" if auto_accept else "proposed",
        awaiting_user_id=None if auto_accept else friend.id, message=(message or "").strip()[:280] or None,
        root_session_id=(root.root_session_id or root.id) if root else None,
        round_number=(root.round_number + 1) if root else 1,
    )
    db.add(s)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise api_error(status.HTTP_409_CONFLICT, "duplicate_invite",
                        "You already have an open invitation or workout with this friend at that time.") from exc
    db.add_all([
        SharedSessionParticipant(session_id=s.id, user_id=me.id, rsvp="accepted"),
        SharedSessionParticipant(session_id=s.id, user_id=friend.id, rsvp="accepted" if auto_accept else "pending"),
    ])
    _event(db, s, me.id, "created", {"mode": mode})
    if not auto_accept:
        exercise_name = EXERCISES[exercise_id][0]
        unit = "seconds of" if ex_type == "duration" else ""
        body = (f"Let’s do {target} {unit} {exercise_name.lower()} together now!" if mode == "instant"
                else f"I scheduled {target} {unit} {exercise_name.lower()} for us.").replace("  ", " ")
        chat.create_message(db, me, friend.id, "invitation" if mode == "instant" else "scheduled_workout", body,
                            {"session_id": str(s.id), **_notify_payload(s)}, f"sess-{s.id.hex}", system=True)
        notifications.notify(db, friend.id, "workout_invite", actor_id=me.id, entity_type="shared_session",
                             entity_id=s.id, dedupe_key=f"invite:{s.id}", payload=_notify_payload(s))
    _broadcast(db, s)
    return s


def accept(db: Session, me: User, session_id: uuid.UUID) -> SharedSession:
    s = get_for(db, session_id, me.id, lock=True)
    if s.status != "proposed" or s.awaiting_user_id != me.id:
        raise api_error(status.HTTP_409_CONFLICT, "not_awaiting_you", "There's nothing to accept on this workout.")
    now = utcnow()
    if s.expires_at and _aware(s.expires_at) <= now:
        s.status = "expired"
        db.commit()
        raise api_error(status.HTTP_409_CONFLICT, "invite_expired", "This invitation has expired.")
    require_friend(db, me.id, other_user(s, me.id))
    s.status = "accepted"
    s.awaiting_user_id = None
    if s.mode == "instant":
        s.expires_at = now + JOIN_LATE
    for p in participants(db, s.id).values():
        p.rsvp = "accepted"
    _event(db, s, me.id, "accepted")
    notifications.mark_entity_read(db, me.id, "shared_session", s.id)
    notifications.notify(db, other_user(s, me.id), "invite_response", actor_id=me.id, entity_type="shared_session",
                         entity_id=s.id, dedupe_key=f"accepted:{s.id}:{s.scheduled_at}",
                         payload=_notify_payload(s, response="accepted"))
    _broadcast(db, s)
    db.commit()
    return s


def decline(db: Session, me: User, session_id: uuid.UUID) -> SharedSession:
    s = get_for(db, session_id, me.id, lock=True)
    if s.status != "proposed" or s.awaiting_user_id != me.id:
        raise api_error(status.HTTP_409_CONFLICT, "not_awaiting_you", "There's nothing to decline on this workout.")
    # Declining a *new time* for an already-agreed workout cancels it without penalty.
    s.status = "declined"
    s.awaiting_user_id = None
    parts = participants(db, s.id)
    if me.id in parts:
        parts[me.id].rsvp = "declined"
    _event(db, s, me.id, "declined")
    notifications.mark_entity_read(db, me.id, "shared_session", s.id)
    notifications.notify(db, other_user(s, me.id), "invite_response", actor_id=me.id, entity_type="shared_session",
                         entity_id=s.id, dedupe_key=f"declined:{s.id}", payload=_notify_payload(s, response="declined"))
    _broadcast(db, s)
    db.commit()
    return s


def reschedule(db: Session, me: User, session_id: uuid.UUID, scheduled_at: datetime) -> SharedSession:
    s = get_for(db, session_id, me.id, lock=True)
    if s.status not in ("proposed", "accepted") or s.mode != "scheduled":
        raise api_error(status.HTTP_409_CONFLICT, "cannot_reschedule", "This workout can't be moved.")
    now = utcnow()
    scheduled_at = _aware(scheduled_at)
    if scheduled_at < now + MIN_LEAD or scheduled_at > now + MAX_AHEAD:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "time_in_past", "Choose a time between 5 minutes and 90 days from now.")
    friend_id = other_user(s, me.id)
    require_friend(db, me.id, friend_id)
    was = s.status
    old = s.scheduled_at
    s.scheduled_at = scheduled_at
    s.expires_at = scheduled_at
    s.status = "proposed"
    s.awaiting_user_id = friend_id
    for uid, p in participants(db, s.id).items():
        p.rsvp = "accepted" if uid == me.id else "pending"
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise api_error(status.HTTP_409_CONFLICT, "duplicate_invite", "You already have a workout together at that time.") from exc
    _event(db, s, me.id, "rescheduled", {"from": _aware(old).isoformat() if old else None, "to": scheduled_at.isoformat(),
                                          "was": was})
    notifications.notify(db, friend_id, "session_update" if was == "accepted" else "invite_response", actor_id=me.id,
                         entity_type="shared_session", entity_id=s.id,
                         dedupe_key=f"rescheduled:{s.id}:{scheduled_at.isoformat()}",
                         payload=_notify_payload(s, change="rescheduled", response="countered"))
    _broadcast(db, s)
    db.commit()
    return s


def cancel(db: Session, me: User, session_id: uuid.UUID) -> SharedSession:
    s = get_for(db, session_id, me.id, lock=True)
    if s.status not in ("proposed", "accepted"):
        raise api_error(status.HTTP_409_CONFLICT, "cannot_cancel", "This workout can no longer be cancelled.")
    now = utcnow()
    late = (s.status == "accepted" and s.mode == "scheduled" and s.scheduled_at is not None
            and _aware(s.scheduled_at) - now < LATE_CANCEL)
    was = s.status
    s.status = "cancelled"
    s.cancelled_by = me.id
    s.cancelled_at = now
    s.awaiting_user_id = None
    _event(db, s, me.id, "cancelled", {"late": bool(late), "was": was})
    if was == "accepted":  # only confirmed commitments affect streaks
        from app.social import streaks
        streaks.on_cancelled(db, s, bool(late))
    friend_id = other_user(s, me.id)
    notifications.notify(db, friend_id, "session_update", actor_id=me.id, entity_type="shared_session", entity_id=s.id,
                         dedupe_key=f"cancelled:{s.id}", payload=_notify_payload(s, change="cancelled"))
    _broadcast(db, s)
    db.commit()
    return s


def list_for(db: Session, me: uuid.UUID, view: str, start: datetime | None, end: datetime | None) -> list[SharedSession]:
    now = utcnow()
    mine = or_(SharedSession.user_low == me, SharedSession.user_high == me)
    query = select(SharedSession).where(mine)
    if start is not None or end is not None:
        query = query.where(SharedSession.scheduled_at.is_not(None))
        if start is not None:
            query = query.where(SharedSession.scheduled_at >= start)
        if end is not None:
            query = query.where(SharedSession.scheduled_at < end)
        return list(db.scalars(query.order_by(SharedSession.scheduled_at)))
    if view == "pending":
        query = query.where(SharedSession.status == "proposed").order_by(SharedSession.created_at.desc())
    elif view == "upcoming":
        query = query.where(
            SharedSession.status.in_(("accepted", "live")),
            or_(SharedSession.mode == "instant", SharedSession.scheduled_at >= now - JOIN_LATE),
        ).order_by(SharedSession.scheduled_at.asc().nulls_first())
    elif view == "past":
        query = query.where(or_(
            SharedSession.status.in_(("completed", "incomplete")),
            and_(SharedSession.status == "accepted", SharedSession.scheduled_at < now - JOIN_LATE),
        )).order_by(SharedSession.scheduled_at.desc().nulls_last(), SharedSession.created_at.desc())
    elif view == "cancelled":
        query = query.where(SharedSession.status.in_(("cancelled", "declined", "expired"))).order_by(
            SharedSession.updated_at.desc())
    else:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_view", "Unknown view.")
    return list(db.scalars(query.limit(100)))


def expire_stale(db: Session, now: datetime) -> int:
    """Invitations nobody answered before they expired."""
    result = db.execute(
        update(SharedSession)
        .where(SharedSession.status == "proposed", SharedSession.expires_at <= now)
        .values(status="expired", awaiting_user_id=None)
        .returning(SharedSession.id, SharedSession.user_low, SharedSession.user_high)
    ).all()
    for sid, low, high in result:
        for uid in (low, high):
            queue_event(db, uid, "session.updated", {"session_id": str(sid)})
    return len(result)
