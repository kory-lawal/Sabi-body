"""Workout history and dashboard statistics for the signed-in user."""
import re
import uuid
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.accounts.deps import CurrentUser, api_error, get_current_user
from app.accounts.security import utcnow
from app.db.models import WorkoutSession
from app.db.session import get_db

router = APIRouter(tags=["workouts"])

# Server-side catalogue: the browser cannot invent exercise names or types.
EXERCISES: dict[str, tuple[str, str]] = {
    "squats": ("Squats", "reps"),
    "jumping-jacks": ("Jumping Jacks", "reps"),
    "plank": ("Plank", "duration"),
    "push-ups": ("Push-ups", "reps"),
    "sit-ups": ("Sit-ups", "reps"),
    "lunges": ("Lunges", "reps"),
    "high-knees": ("High Knees", "reps"),
}

IDEMPOTENCY_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
MAX_WORKOUT_SECONDS = 4 * 3600


def resolve_timezone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_timezone", "Unknown timezone.") from exc


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class WorkoutCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    idempotency_key: str
    exercise_id: str
    completed: bool
    completed_reps: int | None = Field(default=None, ge=0, le=10_000)
    target_reps: int | None = Field(default=None, ge=1, le=1_000)
    target_duration_seconds: int | None = Field(default=None, ge=1, le=7_200)
    duration_seconds: int = Field(ge=0, le=MAX_WORKOUT_SECONDS)
    started_at: datetime
    completed_at: datetime | None = None
    # Set when this workout was done in a SabiBody Buddies shared session.
    shared_session_id: uuid.UUID | None = None

    @field_validator("idempotency_key")
    @classmethod
    def _key(cls, value: str) -> str:
        if not IDEMPOTENCY_PATTERN.match(value):
            raise ValueError("Invalid idempotency key.")
        return value

    @field_validator("started_at", "completed_at")
    @classmethod
    def _tz(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("Timestamps must include a timezone.")
        return value


def workout_out(row: WorkoutSession) -> dict:
    return {
        "id": str(row.id),
        "shared_session_id": str(row.shared_session_id) if row.shared_session_id else None,
        "exercise_id": row.exercise_id,
        "exercise_name": row.exercise_name,
        "exercise_type": row.exercise_type,
        "completed_reps": row.completed_reps,
        "target_reps": row.target_reps,
        "target_duration_seconds": row.target_duration_seconds,
        "duration_seconds": row.duration_seconds,
        "completed": row.completed,
        "started_at": _aware(row.started_at).isoformat(),
        "completed_at": _aware(row.completed_at).isoformat() if row.completed_at else None,
        "created_at": _aware(row.created_at).isoformat() if row.created_at else None,
    }


@router.post("/workouts", status_code=status.HTTP_201_CREATED)
def create_workout(body: WorkoutCreate, current: CurrentUser = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> dict:
    if body.exercise_id not in EXERCISES:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown_exercise", "Unknown exercise.")
    name, exercise_type = EXERCISES[body.exercise_id]
    now = utcnow()
    started_at = body.started_at.astimezone(timezone.utc)
    if started_at > now + timedelta(minutes=5) or started_at < now - timedelta(days=2):
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_timestamp", "Workout start time is not valid.")

    if exercise_type == "duration":
        if body.target_duration_seconds is None:
            raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_workout", "Plank needs a target duration.")
        completed_reps, target_reps = None, None
        target_duration = body.target_duration_seconds
        met_target = body.duration_seconds >= target_duration
    else:
        if body.target_reps is None or body.completed_reps is None:
            raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_workout", "Repetitions are required.")
        completed_reps, target_reps, target_duration = body.completed_reps, body.target_reps, None
        met_target = completed_reps >= target_reps

    if body.completed and not met_target:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "target_not_met",
                        "A workout can only be marked complete once its target is reached.")
    completed = body.completed and met_target
    completed_at = None
    if completed:
        completed_at = (body.completed_at or now).astimezone(timezone.utc)
        if completed_at < started_at or completed_at > now + timedelta(minutes=5):
            raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_timestamp", "Completion time is not valid.")

    shared = None
    if body.shared_session_id is not None:
        from app.social import shared_workouts
        shared = shared_workouts.validate_link(db, current.user.id, body.shared_session_id, body.exercise_id,
                                               target_reps if exercise_type == "reps" else target_duration)

    values = dict(
        id=uuid.uuid4(),
        user_id=current.user.id,
        shared_session_id=shared.id if shared else None,
        exercise_id=body.exercise_id,
        exercise_name=name,
        exercise_type=exercise_type,
        completed_reps=completed_reps,
        target_reps=target_reps,
        target_duration_seconds=target_duration,
        duration_seconds=body.duration_seconds,
        completed=completed,
        started_at=started_at,
        completed_at=completed_at,
        idempotency_key=body.idempotency_key,
    )
    try:
        inserted = db.execute(
            pg_insert(WorkoutSession)
            .values(**values)
            .on_conflict_do_nothing(constraint="uq_workout_sessions_user_idempotency")
            .returning(WorkoutSession.id)
        ).scalar()
    except IntegrityError as exc:  # already saved a workout for this shared session
        db.rollback()
        raise api_error(status.HTTP_409_CONFLICT, "already_saved",
                        "You've already saved a workout for this shared session.") from exc
    db.commit()
    row = db.scalar(select(WorkoutSession).where(
        WorkoutSession.user_id == current.user.id,
        WorkoutSession.idempotency_key == body.idempotency_key,
    ))
    if shared is not None and row.shared_session_id == shared.id:
        from app.social import shared_workouts
        db.refresh(shared)
        shared_workouts.record(db, current.user.id, shared, row)
    return {"workout": workout_out(row), "duplicate": inserted is None}


def _week_start(local_day: date) -> date:
    return local_day - timedelta(days=local_day.weekday())


def _local_midnight_utc(day: date, tz: ZoneInfo) -> datetime:
    return datetime.combine(day, time(0, 0), tzinfo=tz).astimezone(timezone.utc)


def _history_group(started_local: date, today: date) -> str:
    if started_local == today:
        return "today"
    week_start = _week_start(today)
    if started_local >= week_start:
        return "this_week"
    if started_local >= week_start - timedelta(days=28):
        return "previous_weeks"
    return "previous_months"


@router.get("/workouts")
def list_workouts(
    tz: str = Query("UTC", max_length=64),
    exercise: str | None = Query(None, max_length=40),
    status_filter: str = Query("all", alias="status", pattern="^(all|completed|incomplete)$"),
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0, le=100_000),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    zone = resolve_timezone(tz)
    conditions = [WorkoutSession.user_id == current.user.id]
    if exercise:
        if exercise not in EXERCISES:
            raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown_exercise", "Unknown exercise.")
        conditions.append(WorkoutSession.exercise_id == exercise)
    if status_filter != "all":
        conditions.append(WorkoutSession.completed.is_(status_filter == "completed"))
    if date_from and date_to and date_from > date_to:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_range", "The start date must be before the end date.")
    if date_from:
        conditions.append(WorkoutSession.started_at >= _local_midnight_utc(date_from, zone))
    if date_to:
        conditions.append(WorkoutSession.started_at < _local_midnight_utc(date_to + timedelta(days=1), zone))

    where = and_(*conditions)
    total = db.scalar(select(func.count()).select_from(WorkoutSession).where(where)) or 0
    rows = db.scalars(
        select(WorkoutSession).where(where)
        .order_by(WorkoutSession.started_at.desc(), WorkoutSession.id.desc())
        .limit(limit).offset(offset)
    ).all()
    today = datetime.now(zone).date()
    items = []
    for row in rows:
        item = workout_out(row)
        item["group"] = _history_group(_aware(row.started_at).astimezone(zone).date(), today)
        items.append(item)
    return {"items": items, "total": int(total), "limit": limit, "offset": offset}


def build_summary(db: Session, user_id: uuid.UUID, zone: ZoneInfo, week_offset: int = 0) -> dict:
    owner = WorkoutSession.user_id == user_id
    totals = db.execute(
        select(
            func.count().filter(WorkoutSession.completed.is_(True)),
            func.count(),
            func.coalesce(func.sum(WorkoutSession.completed_reps), 0),
            func.coalesce(func.sum(WorkoutSession.duration_seconds), 0),
            func.avg(WorkoutSession.duration_seconds).filter(WorkoutSession.completed.is_(True)),
        ).where(owner)
    ).one()
    completed_count, attempts, total_reps, total_seconds, avg_seconds = totals

    today = datetime.now(zone).date()
    current_week = _week_start(today)
    selected_week = current_week + timedelta(weeks=week_offset)
    previous_week = selected_week - timedelta(weeks=1)
    range_start = _local_midnight_utc(previous_week, zone)
    range_end = _local_midnight_utc(selected_week + timedelta(days=7), zone)
    rows = db.execute(
        select(WorkoutSession.started_at, WorkoutSession.completed, WorkoutSession.completed_reps,
               WorkoutSession.duration_seconds)
        .where(owner, WorkoutSession.started_at >= range_start, WorkoutSession.started_at < range_end)
    ).all()
    days = [
        {"date": (selected_week + timedelta(days=i)).isoformat(), "workouts": 0, "reps": 0, "seconds": 0}
        for i in range(7)
    ]
    previous_week_workouts = 0
    for started_at, completed, reps, seconds in rows:
        local_day = _aware(started_at).astimezone(zone).date()
        if not completed:
            continue
        if previous_week <= local_day < selected_week:
            previous_week_workouts += 1
        elif selected_week <= local_day < selected_week + timedelta(days=7):
            bucket = days[(local_day - selected_week).days]
            bucket["workouts"] += 1
            bucket["reps"] += reps or 0
            bucket["seconds"] += seconds or 0

    this_week_start = _local_midnight_utc(current_week, zone)
    this_week = db.scalar(
        select(func.count()).select_from(WorkoutSession)
        .where(owner, WorkoutSession.completed.is_(True), WorkoutSession.started_at >= this_week_start)
    ) or 0

    # Streak: consecutive local days, ending today or yesterday, with a completed workout.
    recent_days = db.scalars(
        select(WorkoutSession.started_at).where(owner, WorkoutSession.completed.is_(True))
        .where(WorkoutSession.started_at >= utcnow() - timedelta(days=400))
        .order_by(WorkoutSession.started_at.desc())
    ).all()
    active_days = {_aware(value).astimezone(zone).date() for value in recent_days}
    streak = 0
    cursor = today if today in active_days else today - timedelta(days=1)
    while cursor in active_days:
        streak += 1
        cursor -= timedelta(days=1)

    by_exercise = [
        {"exercise_id": exercise_id, "exercise_name": EXERCISES.get(exercise_id, (exercise_id,))[0], "workouts": count}
        for exercise_id, count in db.execute(
            select(WorkoutSession.exercise_id, func.count())
            .where(owner, WorkoutSession.completed.is_(True))
            .group_by(WorkoutSession.exercise_id)
            .order_by(func.count().desc())
        ).all()
    ]
    recent = db.scalars(
        select(WorkoutSession).where(owner).order_by(WorkoutSession.started_at.desc()).limit(5)
    ).all()

    selected_week_workouts = sum(day["workouts"] for day in days)
    return {
        "total_workouts": int(completed_count),
        "total_attempts": int(attempts),
        "total_reps": int(total_reps),
        "total_duration_seconds": int(total_seconds),
        "average_duration_seconds": int(round(float(avg_seconds))) if avg_seconds is not None else 0,
        "workouts_this_week": int(this_week),
        "completion_rate": round(completed_count / attempts, 3) if attempts else 0,
        "streak_days": streak,
        "by_exercise": by_exercise,
        "week": {
            "offset": week_offset,
            "start": selected_week.isoformat(),
            "end": (selected_week + timedelta(days=6)).isoformat(),
            "days": days,
            "workouts": selected_week_workouts,
            "previous_week_workouts": previous_week_workouts,
        },
        "recent": [workout_out(row) for row in recent],
        "timezone": zone.key,
    }


@router.get("/workouts/summary")
def workout_summary(
    tz: str = Query("UTC", max_length=64),
    week_offset: int = Query(0, ge=-520, le=0),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return build_summary(db, current.user.id, resolve_timezone(tz), week_offset)
