"""Linking each person's *own* workout record to a shared session, and the shared summary.

Every participant saves their own workouts row (their own reps, their own
duration). Rows are never merged; the shared session only points at them.
"""
import uuid
from collections.abc import Callable
from datetime import timezone

from fastapi import status
from sqlalchemy.orm import Session

from app.accounts.deps import api_error
from app.accounts.security import utcnow
from app.db.models import SharedSession, SharedSessionParticipant, User, WorkoutSession
from app.social import sessions as session_svc
from app.social.common import public_user

# Called with (db, session) once both workouts of a session are recorded (streaks, challenges…).
ON_SESSION_FINISHED: list[Callable[[Session, SharedSession], None]] = []
LINKABLE = ("accepted", "live", "completed", "incomplete")


def validate_link(db: Session, user_id: uuid.UUID, session_id: uuid.UUID, exercise_id: str,
                  target: int | None) -> SharedSession:
    s = db.get(SharedSession, session_id)
    part = db.get(SharedSessionParticipant, (session_id, user_id)) if s else None
    if s is None or part is None or part.rsvp != "accepted":
        raise api_error(status.HTTP_404_NOT_FOUND, "session_not_found", "We couldn't find that shared workout.")
    if s.status not in LINKABLE:
        raise api_error(status.HTTP_409_CONFLICT, "session_closed", "This shared workout is no longer open.")
    if s.exercise_id != exercise_id or session_svc.target_of(s) != target:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "session_mismatch",
                        "This workout doesn't match the shared session's exercise and target.")
    return s


def _result(row: WorkoutSession | None) -> dict | None:
    if row is None:
        return None
    return {
        "completed": row.completed,
        "completed_reps": row.completed_reps,
        "duration_seconds": row.duration_seconds,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


def summary(db: Session, s: SharedSession, me: uuid.UUID) -> dict:
    parts = session_svc.participants(db, s.id)
    people = []
    for uid in (me, s.user_high if s.user_low == me else s.user_low):
        user = db.get(User, uid)
        part = parts.get(uid)
        row = db.get(WorkoutSession, part.workout_session_id) if part and part.workout_session_id else None
        people.append({"user": public_user(user) if user else None, "is_me": uid == me, "result": _result(row)})
    started = s.started_at
    ended = s.ended_at
    duration = int((ended - started).total_seconds()) if started and ended else None
    out = {
        "session_id": str(s.id),
        "status": s.status,
        "exercise_id": s.exercise_id,
        "exercise_name": session_svc.EXERCISES.get(s.exercise_id, (s.exercise_id,))[0],
        "exercise_type": s.exercise_type,
        "target": session_svc.target_of(s),
        "participants": people,
        "session_duration_seconds": duration,
        "ended_at": ended.astimezone(timezone.utc).isoformat() if ended else None,
        "both_completed": all(p["result"] and p["result"]["completed"] for p in people),
        "round_number": s.round_number,
    }
    try:  # streak details are added by the streaks module when present
        from app.social import streaks
        out["streaks"] = streaks.summary_for(db, s)
    except ImportError:
        pass
    return out


def record(db: Session, user_id: uuid.UUID, s: SharedSession, row: WorkoutSession) -> None:
    """Attach a saved workout to its participant; finish the session when both are in."""
    part = db.get(SharedSessionParticipant, (s.id, user_id))
    if part is None:
        return
    if part.workout_session_id is None:
        part.workout_session_id = row.id
        part.outcome = "completed" if row.completed else "not_completed"
        part.finished_at = row.completed_at or utcnow()
    parts = session_svc.participants(db, s.id)
    if all(p.workout_session_id is not None for p in parts.values()) and s.status in ("accepted", "live"):
        both = all(p.outcome == "completed" for p in parts.values())
        s.status = "completed" if both else "incomplete"
        s.ended_at = utcnow()
        if s.started_at is None:
            s.started_at = min((db.get(WorkoutSession, p.workout_session_id).started_at for p in parts.values()))
        for hook in ON_SESSION_FINISHED:
            hook(db, s)
        db.commit()
        payloads = {uid: summary(db, s, uid) for uid in (s.user_low, s.user_high)}
        from app.realtime import rooms
        rooms.schedule(rooms.summary_ready(s.id, payloads))
    else:
        db.commit()
