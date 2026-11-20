"""Buddy streaks and exercise-specific streaks.

A streak counts consecutive *kept commitments* between two friends — not
calendar days — so friends who plan three workouts a week never lose a streak
on days they didn't plan to train.

Rules (also shown to users):
  counted  Both people saved a completed workout for the session.
  broken   Someone missed it: a no-show (not in the room by 30 minutes after
           the start), a cancellation less than 2 hours before the start, or
           a workout that was ended without reaching the target.
  neutral  A mutually agreed reschedule, a cancellation more than 2 hours
           ahead, an unanswered/declined invitation, or a technical
           disconnection the person didn't come back from.
Each commitment (its first round) affects streaks exactly once, recorded in
streak_events, so nothing can be counted twice. No endpoint lets anyone set
streak values.
"""
import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.accounts.security import utcnow
from app.db.models import (
    BuddyStreak,
    ExerciseStreak,
    SharedSession,
    SharedSessionEvent,
    SharedSessionParticipant,
    StreakEvent,
)
from app.social import notifications
from app.social.events import queue_event

MILESTONES = (3, 7, 14, 30, 50, 100)
NO_SHOW_AFTER = timedelta(minutes=30)
ABANDONED_AFTER = timedelta(hours=2)


def _root_id(s: SharedSession) -> uuid.UUID:
    return s.root_session_id or s.id


def _get_or_create(db: Session, model, **keys):
    stmt = pg_insert(model).values(id=uuid.uuid4(), **keys).on_conflict_do_nothing()
    db.execute(stmt)
    query = select(model)
    for k, v in keys.items():
        query = query.where(getattr(model, k) == v)
    return db.scalar(query.with_for_update())


def _apply(row, outcome: str, now: datetime) -> int | None:
    """Update one streak row; returns a milestone level if one was just reached."""
    if outcome == "counted":
        if row.current == 0:
            row.run_started_at = now
        row.current += 1
        row.longest = max(row.longest, row.current)
        row.total_completed += 1
        row.last_completed_at = now
        return row.current if row.current in MILESTONES else None
    if outcome == "broken":
        row.current = 0
        row.run_started_at = None
    return None


def apply_outcome(db: Session, s: SharedSession, outcome: str, reason: str) -> bool:
    """Record a commitment's outcome once and update both streaks. Caller commits."""
    root = db.get(SharedSession, _root_id(s)) or s
    inserted = db.execute(
        pg_insert(StreakEvent)
        .values(id=uuid.uuid4(), root_session_id=root.id, user_low=root.user_low, user_high=root.user_high,
                exercise_id=root.exercise_id, outcome=outcome, reason=reason)
        .on_conflict_do_nothing(index_elements=["root_session_id"])
        .returning(StreakEvent.id)
    ).scalar()
    if inserted is None or outcome == "neutral":
        return inserted is not None
    now = utcnow()
    buddy = _get_or_create(db, BuddyStreak, user_low=root.user_low, user_high=root.user_high)
    exercise = _get_or_create(db, ExerciseStreak, user_low=root.user_low, user_high=root.user_high,
                              exercise_id=root.exercise_id)
    milestone = _apply(buddy, outcome, now)
    _apply(exercise, outcome, now)
    for uid, partner in ((root.user_low, root.user_high), (root.user_high, root.user_low)):
        if milestone:
            notifications.notify(
                db, uid, "streak_milestone", actor_id=partner, entity_type="shared_session", entity_id=root.id,
                dedupe_key=f"streak:{root.user_low}:{root.user_high}:{buddy.run_started_at.isoformat()}:{milestone}",
                payload={"level": milestone, "exercise_id": root.exercise_id},
            )
        if outcome == "broken":
            notifications.notify(
                db, uid, "missed_commitment", actor_id=partner, entity_type="shared_session", entity_id=root.id,
                dedupe_key=f"missed:{root.id}", payload={"exercise_id": root.exercise_id, "reason": reason},
            )
        queue_event(db, uid, "streaks.changed", {})
    return True


# ------------------------------------------------------------------ triggers

def on_session_finished(db: Session, s: SharedSession) -> None:
    """Both workouts are saved: a completed first round keeps the streak going."""
    if s.root_session_id is not None:  # repeat rounds never change streaks
        return
    if s.status == "completed":
        apply_outcome(db, s, "counted", "completed_together")
    else:
        apply_outcome(db, s, "broken", "target_not_reached")


def on_cancelled(db: Session, s: SharedSession, late: bool) -> None:
    if s.root_session_id is not None:
        return
    apply_outcome(db, s, "broken" if late else "neutral", "late_cancel" if late else "cancelled_early")


def evaluate_due(db: Session, now: datetime) -> dict:
    """Job hook: no-shows and workouts that never finished."""
    stats = {"no_shows": 0, "abandoned": 0}
    # 1) Confirmed scheduled workouts nobody started by 30 minutes after the start time.
    stale = db.scalars(select(SharedSession).where(
        SharedSession.status == "accepted", SharedSession.mode == "scheduled",
        SharedSession.scheduled_at < now - NO_SHOW_AFTER, SharedSession.root_session_id.is_(None),
    )).all()
    for s in stale:
        parts = db.scalars(select(SharedSessionParticipant).where(SharedSessionParticipant.session_id == s.id)).all()
        for p in parts:
            if p.joined_at is None:
                p.outcome = "absent"
        s.status = "incomplete"
        s.ended_at = now
        apply_outcome(db, s, "broken", "no_show")
        for uid in (s.user_low, s.user_high):
            queue_event(db, uid, "session.updated", {"session_id": str(s.id)})
        stats["no_shows"] += 1
    # 2) Live (or accepted instant) sessions that never got both results within 2 hours.
    unfinished = db.scalars(select(SharedSession).where(
        SharedSession.status.in_(("live", "accepted")),
        or_(and_(SharedSession.started_at.is_not(None), SharedSession.started_at < now - ABANDONED_AFTER),
            and_(SharedSession.mode == "instant", SharedSession.created_at < now - ABANDONED_AFTER * 2)),
    )).all()
    for s in unfinished:
        parts = db.scalars(select(SharedSessionParticipant).where(SharedSessionParticipant.session_id == s.id)).all()
        quit_early = any(p.outcome == "not_completed" for p in parts)
        for p in parts:
            if p.workout_session_id is None:
                p.outcome = "disconnected" if p.joined_at else "absent"
        absent = any(p.outcome == "absent" for p in parts)
        s.status = "incomplete"
        s.ended_at = now
        if s.root_session_id is None:
            if quit_early or (absent and s.mode == "scheduled"):
                apply_outcome(db, s, "broken", "not_completed")
            else:
                # Technical problems never break a streak.
                apply_outcome(db, s, "neutral", "disconnected")
        for uid in (s.user_low, s.user_high):
            queue_event(db, uid, "session.updated", {"session_id": str(s.id)})
        stats["abandoned"] += 1
    return stats


# ------------------------------------------------------------------ reads

def _row_out(row) -> dict:
    if row is None:
        return {"current": 0, "longest": 0, "total_completed": 0, "last_completed_at": None}
    return {"current": row.current, "longest": row.longest, "total_completed": row.total_completed,
            "last_completed_at": row.last_completed_at.isoformat() if row.last_completed_at else None}


def next_milestone(current: int) -> int | None:
    return next((m for m in MILESTONES if m > current), None)


def for_pair(db: Session, low: uuid.UUID, high: uuid.UUID) -> dict:
    buddy = db.scalar(select(BuddyStreak).where(BuddyStreak.user_low == low, BuddyStreak.user_high == high))
    exercises = db.scalars(select(ExerciseStreak).where(ExerciseStreak.user_low == low, ExerciseStreak.user_high == high)
                           .order_by(ExerciseStreak.current.desc(), ExerciseStreak.total_completed.desc())).all()
    out = _row_out(buddy)
    out["next_milestone"] = next_milestone(out["current"])
    return {"buddy": out, "exercises": [{"exercise_id": e.exercise_id, **_row_out(e)} for e in exercises]}


def summary_for(db: Session, s: SharedSession) -> dict:
    root = db.get(SharedSession, _root_id(s)) or s
    data = for_pair(db, root.user_low, root.user_high)
    exercise = next((e for e in data["exercises"] if e["exercise_id"] == root.exercise_id), None)
    event = db.scalar(select(StreakEvent).where(StreakEvent.root_session_id == root.id))
    buddy = data["buddy"]
    return {
        "buddy": buddy,
        "exercise": exercise or _row_out(None),
        "outcome": event.outcome if event else None,
        "milestone": buddy["current"] if event and event.outcome == "counted" and buddy["current"] in MILESTONES else None,
        "counts_toward_streak": s.root_session_id is None,
    }


def cancel_was_late(db: Session, s: SharedSession) -> bool:
    event = db.scalar(select(SharedSessionEvent).where(SharedSessionEvent.session_id == s.id,
                                                       SharedSessionEvent.type == "cancelled")
                      .order_by(SharedSessionEvent.created_at.desc()).limit(1))
    return bool(event and (event.data or {}).get("late"))
