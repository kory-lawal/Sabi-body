"""Server-side jobs for SabiBody Buddies (run every minute in-process while the
server is awake, and every 15 minutes by the GitHub Actions cron as a backstop).

1. Expire invitations nobody answered.
2. Email + in-app reminders for confirmed shared workouts:
   - '24h'   24 hours before (only if the person turned it on),
   - '1h'    one hour before,
   - 'start' when the workout starts.
   Each (session, person, kind, scheduled time) is claimed in
   shared_reminder_delivery_logs before sending, so overlapping runs can never
   send twice, and a reschedule re-arms reminders for the new time.
3. Streak/no-show evaluation and challenge deadlines (added by later phases via HOOKS).
"""
import logging
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.accounts import emails
from app.accounts.security import utcnow
from app.db.models import ReminderPreference, SharedReminderDeliveryLog, SharedSession, SharedSessionParticipant, User
from app.routes.workouts import EXERCISES
from app.social import notifications
from app.social.sessions import expire_stale, target_of

logger = logging.getLogger("sabibody.buddy_jobs")

# kind -> (offset before start, window during which it may still be sent)
REMINDER_KINDS: dict[str, tuple[timedelta, timedelta]] = {
    "24h": (timedelta(hours=24), timedelta(hours=3)),
    "1h": (timedelta(hours=1), timedelta(minutes=40)),
    "start": (timedelta(minutes=0), timedelta(minutes=15)),
}
LOOKAHEAD = timedelta(hours=24, minutes=5)

HOOKS: list[Callable[[Session, datetime], dict]] = []


def _zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def local_time_text(when: datetime, zone_name: str | None) -> str:
    zone = _zone(zone_name)
    local = when.astimezone(zone)
    hour = local.strftime("%I").lstrip("0") or "12"
    label = zone_name.replace("_", " ") if zone_name and zone_name != "UTC" else "UTC"
    return f"{local.strftime('%A %d %B')} at {hour}:{local.strftime('%M %p')} ({label})"


def due_kinds(scheduled_at: datetime, now: datetime, want_24h: bool) -> list[str]:
    kinds = []
    for kind, (offset, window) in REMINDER_KINDS.items():
        if kind == "24h" and not want_24h:
            continue
        due = scheduled_at - offset
        if due <= now < due + window:
            kinds.append(kind)
    return kinds


def _claim(db: Session, session: SharedSession, user_id: uuid.UUID, kind: str, status_value: str) -> bool:
    result = db.execute(
        pg_insert(SharedReminderDeliveryLog)
        .values(id=uuid.uuid4(), session_id=session.id, user_id=user_id, kind=kind,
                scheduled_at=session.scheduled_at, delivery_status=status_value)
        .on_conflict_do_nothing(constraint="uq_shared_reminder_once")
        .returning(SharedReminderDeliveryLog.id)
    )
    return result.scalar() is not None


def send_reminders(db: Session, now: datetime) -> dict:
    stats = {"checked": 0, "sent": 0, "skipped": 0, "failed": 0, "already_handled": 0}
    sessions = db.scalars(
        select(SharedSession).where(
            SharedSession.status == "accepted",
            SharedSession.mode == "scheduled",
            SharedSession.scheduled_at > now - REMINDER_KINDS["start"][1],
            SharedSession.scheduled_at <= now + LOOKAHEAD,
        )
    ).all()
    for session in sessions:
        scheduled_at = session.scheduled_at if session.scheduled_at.tzinfo else session.scheduled_at.replace(tzinfo=timezone.utc)
        parts = db.scalars(select(SharedSessionParticipant).where(SharedSessionParticipant.session_id == session.id,
                                                                  SharedSessionParticipant.rsvp == "accepted")).all()
        if len(parts) < 2:
            continue
        users = {u.id: u for u in db.scalars(select(User).where(User.id.in_([p.user_id for p in parts])))}
        prefs = {p.user_id: p for p in db.scalars(select(ReminderPreference).where(
            ReminderPreference.user_id.in_(list(users))))}
        for part in parts:
            user = users.get(part.user_id)
            partner = next((u for uid, u in users.items() if uid != part.user_id), None)
            if user is None or partner is None:
                continue
            pref = prefs.get(user.id)
            for kind in due_kinds(scheduled_at, now, bool(pref and pref.buddy_reminder_24h)):
                stats["checked"] += 1
                wants_email = (user.is_active and user.email_verified
                               and notifications.wants(db, user.id, "workout_reminder", "email"))
                if not _claim(db, session, user.id, kind, "pending" if wants_email else "skipped"):
                    stats["already_handled"] += 1
                    db.rollback()
                    continue
                payload = {"kind": kind, "exercise_id": session.exercise_id, "target": target_of(session),
                           "scheduled_at": scheduled_at.isoformat()}
                if kind != "24h":
                    notifications.notify(db, user.id, "workout_reminder", actor_id=partner.id,
                                         entity_type="shared_session", entity_id=session.id, payload=payload,
                                         dedupe_key=f"reminder:{session.id}:{kind}:{scheduled_at.isoformat()}")
                db.commit()
                if not wants_email:
                    stats["skipped"] += 1
                    continue
                exercise = EXERCISES.get(session.exercise_id, (session.exercise_id,))[0]
                message = emails.buddy_reminder_email(
                    user.email, user.full_name, partner.full_name.split(" ")[0], exercise,
                    local_time_text(scheduled_at, pref.timezone if pref else "UTC"), kind, str(session.id))
                log = db.scalar(select(SharedReminderDeliveryLog).where(
                    SharedReminderDeliveryLog.session_id == session.id, SharedReminderDeliveryLog.user_id == user.id,
                    SharedReminderDeliveryLog.kind == kind, SharedReminderDeliveryLog.scheduled_at == session.scheduled_at))
                try:
                    emails.send_email(message)
                    log.delivery_status, log.sent_at = "sent", utcnow()
                    stats["sent"] += 1
                except emails.EmailDeliveryError as exc:
                    log.delivery_status, log.error = "failed", str(exc)[:500]
                    stats["failed"] += 1
                    logger.error("Buddy reminder failed for session %s: %s", session.id, exc)
                db.commit()
    return stats


def run_buddy_jobs(db: Session, now: datetime | None = None) -> dict:
    now = now or utcnow()
    expired = expire_stale(db, now)
    db.commit()
    stats = {"expired_invites": expired, "reminders": send_reminders(db, now)}
    for hook in HOOKS:
        try:
            stats.update(hook(db, now) or {})
            db.commit()
        except Exception:  # noqa: BLE001 — one failing job must not stop the others
            db.rollback()
            logger.exception("Buddy job hook failed")
    return stats
