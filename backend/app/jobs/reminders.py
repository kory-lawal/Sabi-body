"""Scheduled workout-reminder delivery.

Run every 5-15 minutes by a scheduler (Render Cron Job running
`python -m app.jobs.reminders`, or any cron calling POST /api/internal/reminders/run
with the CRON_SECRET bearer token).

A reminder is sent only when all of these hold:
1. reminders are enabled globally and for that slot (morning/evening);
2. the user's local time has reached the chosen time, within
   REMINDER_SEND_WINDOW_MINUTES (so a late scheduler doesn't send a morning
   reminder at night);
3. the user has not completed a workout on that local date;
4. no delivery row exists for (user, slot, local date). The row is inserted
   *before* sending, and a unique constraint makes concurrent runs safe.
"""
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.accounts import emails
from app.config import settings
from app.db.models import ReminderDeliveryLog, ReminderPreference, User, WorkoutSession

logger = logging.getLogger("sabibody.reminders")


def _due_slots(pref: ReminderPreference, local_now: datetime) -> list[tuple[str, object]]:
    slots = []
    if pref.morning_reminder_enabled:
        slots.append(("morning", pref.morning_reminder_time))
    if pref.evening_reminder_enabled:
        slots.append(("evening", pref.evening_reminder_time))
    window = timedelta(minutes=settings.REMINDER_SEND_WINDOW_MINUTES)
    due = []
    for slot, at in slots:
        scheduled = local_now.replace(hour=at.hour, minute=at.minute, second=0, microsecond=0)
        if scheduled <= local_now < scheduled + window:
            due.append((slot, at))
    return due


def _completed_on(db: Session, user_id, day, zone: ZoneInfo) -> bool:
    start = datetime.combine(day, datetime.min.time(), tzinfo=zone).astimezone(timezone.utc)
    end = start + timedelta(days=1)
    return bool(db.scalar(
        select(func.count()).select_from(WorkoutSession).where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.completed.is_(True),
            WorkoutSession.started_at >= start,
            WorkoutSession.started_at < end,
        )
    ))


def run_reminders(db: Session, now: datetime | None = None) -> dict:
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    stats = {"checked": 0, "sent": 0, "skipped_completed": 0, "failed": 0, "already_handled": 0}
    rows = db.execute(
        select(ReminderPreference, User)
        .join(User, User.id == ReminderPreference.user_id)
        .where(
            ReminderPreference.email_reminders_enabled.is_(True),
            (ReminderPreference.morning_reminder_enabled.is_(True)) | (ReminderPreference.evening_reminder_enabled.is_(True)),
            User.is_active.is_(True),
            User.email_verified.is_(True),
        )
    ).all()
    for pref, user in rows:
        try:
            zone = ZoneInfo(pref.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            zone = ZoneInfo("UTC")
        local_now = now.astimezone(zone)
        for slot, at in _due_slots(pref, local_now):
            stats["checked"] += 1
            local_day = local_now.date()
            completed = _completed_on(db, user.id, local_day, zone)
            claimed = db.execute(
                pg_insert(ReminderDeliveryLog)
                .values(
                    user_id=user.id,
                    reminder_type=slot,
                    scheduled_date=local_day,
                    scheduled_time=at,
                    delivery_status="skipped_completed" if completed else "pending",
                )
                .on_conflict_do_nothing(constraint="uq_reminder_delivery_once_per_day")
                .returning(ReminderDeliveryLog.id)
            ).scalar()
            db.commit()
            if claimed is None:
                stats["already_handled"] += 1
                continue
            if completed:
                stats["skipped_completed"] += 1
                continue
            log = db.get(ReminderDeliveryLog, claimed)
            try:
                emails.send_email(emails.reminder_email(user.email, user.full_name, slot))
            except emails.EmailDeliveryError as exc:
                log.delivery_status = "failed"
                log.error = str(exc)[:500]
                stats["failed"] += 1
                logger.error("Reminder delivery failed for user %s: %s", user.id, exc)
            else:
                log.delivery_status = "sent"
                log.sent_at = datetime.now(timezone.utc)
                stats["sent"] += 1
            db.commit()
    stats["provider"] = settings.email_provider
    return stats


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    from app.db.session import new_session

    session = new_session()
    try:
        print(run_reminders(session))
    finally:
        session.close()
