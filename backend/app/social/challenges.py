"""One-to-one challenges between friends.

Progress is always computed from each person's own saved workouts between the
moment the challenge was accepted and its deadline — nobody can claim
completion by pressing a button. Each person "reaches" the target on their
own; the challenge is completed when both have, and whoever got there first
is recorded. At the deadline an unfinished challenge expires.

Metrics:
  reps      total reps of one exercise (finished or not — every genuine rep counts)
  seconds   longest single plank hold
  workouts  number of completed workouts (one exercise, or 'any')
"""
import uuid
from datetime import datetime, timedelta

from fastapi import status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.accounts.deps import api_error
from app.accounts.security import utcnow
from app.db.models import Challenge, User, WorkoutSession
from app.routes.workouts import EXERCISES
from app.social import notifications
from app.social.common import public_user, require_friend
from app.social.events import queue_event

MIN_DURATION = timedelta(hours=1)
MAX_DURATION = timedelta(days=30)
DAILY_LIMIT = 10
LIMITS = {"reps": 5000, "seconds": 3600, "workouts": 50}


def _aware(value: datetime) -> datetime:
    from datetime import timezone
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def describe(c: Challenge) -> str:
    name = "workouts" if c.exercise_id == "any" else EXERCISES.get(c.exercise_id, (c.exercise_id,))[0].lower()
    if c.metric == "seconds":
        return f"hold a plank for {c.target_total} seconds"
    if c.metric == "workouts":
        what = "workouts" if c.exercise_id == "any" else f"{name} workouts"
        return f"complete {c.target_total} {what}"
    return f"{c.target_total} {name}"


def progress_for(db: Session, c: Challenge, user_id: uuid.UUID) -> int:
    if c.accepted_at is None:
        return 0
    # Uses the server's save time (not a browser-supplied timestamp): only workouts
    # saved between accepting and the deadline count.
    window = and_(WorkoutSession.user_id == user_id, WorkoutSession.created_at >= c.accepted_at,
                  WorkoutSession.created_at <= c.deadline)
    if c.metric == "reps":
        value = db.scalar(select(func.coalesce(func.sum(WorkoutSession.completed_reps), 0))
                          .where(window, WorkoutSession.exercise_id == c.exercise_id))
    elif c.metric == "seconds":
        value = db.scalar(select(func.coalesce(func.max(WorkoutSession.duration_seconds), 0))
                          .where(window, WorkoutSession.exercise_id == "plank"))
    else:
        query = select(func.count()).select_from(WorkoutSession).where(window, WorkoutSession.completed.is_(True))
        if c.exercise_id != "any":
            query = query.where(WorkoutSession.exercise_id == c.exercise_id)
        value = db.scalar(query)
    return int(value or 0)


def challenge_out(db: Session, c: Challenge, me: uuid.UUID) -> dict:
    other_id = c.opponent_id if c.creator_id == me else c.creator_id
    other = db.get(User, other_id)
    reached = (c.result or {}).get("reached", {})
    return {
        "id": str(c.id),
        "status": c.status,
        "exercise_id": c.exercise_id,
        "metric": c.metric,
        "target": c.target_total,
        "summary": describe(c),
        "deadline": _aware(c.deadline).isoformat(),
        "message": c.message,
        "created_by_me": c.creator_id == me,
        "awaiting_me": c.status == "pending" and c.opponent_id == me,
        "friend": public_user(other) if other else None,
        "my_progress": progress_for(db, c, me),
        "friend_progress": progress_for(db, c, other_id),
        "i_reached": str(me) in reached,
        "friend_reached": str(other_id) in reached,
        "first": (c.result or {}).get("first"),
        "first_is_me": (c.result or {}).get("first") == str(me),
        "accepted_at": _aware(c.accepted_at).isoformat() if c.accepted_at else None,
        "finished_at": _aware(c.finished_at).isoformat() if c.finished_at else None,
        "created_at": _aware(c.created_at).isoformat() if c.created_at else None,
    }


def _notify_both(db: Session, c: Challenge, event: str, actor: uuid.UUID | None, extra: dict | None = None) -> None:
    for uid in (c.creator_id, c.opponent_id):
        if uid == actor:
            continue
        other = c.opponent_id if uid == c.creator_id else c.creator_id
        notifications.notify(db, uid, "challenge", actor_id=other, entity_type="challenge", entity_id=c.id,
                             dedupe_key=f"challenge:{c.id}:{event}",
                             payload={"event": event, "exercise_id": c.exercise_id, "summary": describe(c),
                                      **(extra or {})})


def _broadcast(db: Session, c: Challenge) -> None:
    for uid in (c.creator_id, c.opponent_id):
        queue_event(db, uid, "challenge.updated", {"challenge_id": str(c.id)})


def create(db: Session, me: User, friend_id: uuid.UUID, metric: str, exercise_id: str, target: int,
           deadline: datetime, message: str | None) -> Challenge:
    require_friend(db, me.id, friend_id)
    if metric not in LIMITS:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_metric", "Choose a challenge type.")
    if metric == "seconds":
        exercise_id = "plank"
    elif metric == "workouts" and exercise_id == "any":
        pass
    elif exercise_id not in EXERCISES or (metric == "reps" and EXERCISES[exercise_id][1] != "reps"):
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown_exercise", "Choose an exercise for this challenge.")
    if not 1 <= target <= LIMITS[metric]:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_target",
                        f"Choose a target between 1 and {LIMITS[metric]}.")
    now = utcnow()
    deadline = _aware(deadline)
    if deadline < now + MIN_DURATION or deadline > now + MAX_DURATION:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_deadline",
                        "Give at least an hour and no more than 30 days.")
    sent_today = db.scalar(select(func.count()).select_from(Challenge).where(
        Challenge.creator_id == me.id, Challenge.created_at > now - timedelta(days=1)))
    if (sent_today or 0) >= DAILY_LIMIT:
        raise api_error(status.HTTP_429_TOO_MANY_REQUESTS, "challenge_limit", "You've sent a lot of challenges today.")
    c = Challenge(creator_id=me.id, opponent_id=friend_id, exercise_id=exercise_id, metric=metric,
                  target_total=target, deadline=deadline, message=(message or "").strip()[:280] or None,
                  status="pending", result={})
    db.add(c)
    db.flush()
    notifications.notify(db, friend_id, "challenge", actor_id=me.id, entity_type="challenge", entity_id=c.id,
                         dedupe_key=f"challenge:{c.id}:invite",
                         payload={"event": "invite", "exercise_id": exercise_id, "summary": describe(c)})
    _broadcast(db, c)
    db.commit()
    return c


def get_for(db: Session, challenge_id: uuid.UUID, me: uuid.UUID, lock: bool = False) -> Challenge:
    query = select(Challenge).where(Challenge.id == challenge_id)
    if lock:
        query = query.with_for_update()
    c = db.scalar(query)
    if c is None or me not in (c.creator_id, c.opponent_id):
        raise api_error(status.HTTP_404_NOT_FOUND, "challenge_not_found", "We couldn't find that challenge.")
    return c


def respond(db: Session, me: User, challenge_id: uuid.UUID, action: str) -> Challenge:
    c = get_for(db, challenge_id, me.id, lock=True)
    now = utcnow()
    if action in ("accept", "decline"):
        if c.status != "pending" or c.opponent_id != me.id:
            raise api_error(status.HTTP_409_CONFLICT, "not_awaiting_you", "There's nothing to answer on this challenge.")
        if _aware(c.deadline) <= now:
            c.status = "expired"
            db.commit()
            raise api_error(status.HTTP_409_CONFLICT, "challenge_expired", "This challenge has already ended.")
        if action == "accept":
            require_friend(db, me.id, c.creator_id)
            c.status, c.accepted_at = "active", now
        else:
            c.status, c.finished_at = "declined", now
        notifications.mark_entity_read(db, me.id, "challenge", c.id)
        _notify_both(db, c, "accepted" if action == "accept" else "declined", me.id)
    elif action == "cancel":
        if c.creator_id != me.id or c.status not in ("pending", "active"):
            raise api_error(status.HTTP_409_CONFLICT, "cannot_cancel", "This challenge can't be cancelled.")
        c.status, c.finished_at = "cancelled", now
        _notify_both(db, c, "cancelled", me.id)
    else:
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "Unknown action.")
    _broadcast(db, c)
    db.commit()
    return c


def _check(db: Session, c: Challenge, now: datetime) -> bool:
    """Record anyone who reached the target; complete when both have. Returns True if changed."""
    result = dict(c.result or {})
    reached = dict(result.get("reached", {}))
    changed = False
    for uid in (c.creator_id, c.opponent_id):
        if str(uid) not in reached and progress_for(db, c, uid) >= c.target_total:
            reached[str(uid)] = now.isoformat()
            result.setdefault("first", str(uid))
            changed = True
            other = c.opponent_id if uid == c.creator_id else c.creator_id
            notifications.notify(db, other, "challenge", actor_id=uid, entity_type="challenge", entity_id=c.id,
                                 dedupe_key=f"challenge:{c.id}:reached:{uid}",
                                 payload={"event": "completed", "exercise_id": c.exercise_id, "summary": describe(c),
                                          "winner_is_you": False})
    if changed:
        result["reached"] = reached
        c.result = result
        if len(reached) == 2:
            c.status, c.finished_at = "completed", now
        _broadcast(db, c)
    return changed


def on_workout_saved(db: Session, user_id: uuid.UUID) -> None:
    now = utcnow()
    active = db.scalars(select(Challenge).where(
        Challenge.status == "active", Challenge.deadline >= now,
        or_(Challenge.creator_id == user_id, Challenge.opponent_id == user_id))).all()
    changed = False
    for c in active:
        changed = _check(db, c, now) or changed
    if changed:
        db.commit()


def finalize_due(db: Session, now: datetime) -> dict:
    """Job hook: close challenges whose deadline passed."""
    due = db.scalars(select(Challenge).where(Challenge.status.in_(("pending", "active")), Challenge.deadline < now)).all()
    for c in due:
        if c.status == "active":
            _check(db, c, c.deadline)
        if c.status != "completed":
            c.status, c.finished_at = "expired", now
            _notify_both(db, c, "expired", None)
            _broadcast(db, c)
    return {"challenges_closed": len(due)}


def list_for(db: Session, me: uuid.UUID) -> dict:
    rows = db.scalars(select(Challenge).where(or_(Challenge.creator_id == me, Challenge.opponent_id == me))
                      .order_by(Challenge.created_at.desc()).limit(100)).all()
    out = {"pending": [], "active": [], "past": []}
    for c in rows:
        item = challenge_out(db, c, me)
        bucket = "pending" if c.status == "pending" else "active" if c.status == "active" else "past"
        out[bucket].append(item)
    return out
