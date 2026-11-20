"""Notification centre and notification preferences."""
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from sqlalchemy.orm import Session

from app.accounts.deps import CurrentUser, get_current_user
from app.accounts.schemas import StrictModel
from app.db.models import NotificationPreference, ReminderPreference
from app.db.session import get_db
from app.social import notifications as svc
from app.social.common import parse_uuid
from app.social.events import queue_event

router = APIRouter(tags=["notifications"])


class ReadBody(StrictModel):
    ids: list[str] = Field(default_factory=list, max_length=200)


class PreferenceItem(StrictModel):
    type: str
    in_app: bool
    email: bool = True


class PreferencesBody(StrictModel):
    preferences: list[PreferenceItem] = Field(default_factory=list, max_length=40)
    buddy_reminder_24h: bool | None = None


@router.get("/notifications")
def list_notifications(before: datetime | None = None, limit: int = Query(default=30, ge=1, le=100),
                       current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    rows = svc.list_notifications(db, current.user.id, before, limit)
    return {
        "notifications": [svc.serialize(db, r) for r in rows],
        "unread": svc.unread_count(db, current.user.id),
        "next_before": rows[-1].created_at.isoformat() if len(rows) == limit else None,
    }


@router.get("/notifications/unread-count")
def unread_count(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return {"unread": svc.unread_count(db, current.user.id)}


def _after_read(db: Session, current: CurrentUser) -> dict:
    count = svc.unread_count(db, current.user.id)
    queue_event(db, current.user.id, "notification.read", {"unread": count})
    db.commit()
    return {"unread": count}


@router.post("/notifications/read")
def mark_read(body: ReadBody, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    svc.mark_read(db, current.user.id, [parse_uuid(i) for i in body.ids])
    return _after_read(db, current)


@router.post("/notifications/read-all")
def mark_all_read(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    svc.mark_read(db, current.user.id, None)
    return _after_read(db, current)


def _preferences_out(db: Session, user_id) -> dict:
    reminder = db.query(ReminderPreference).filter(ReminderPreference.user_id == user_id).one_or_none()
    return {
        "preferences": [{"type": k, **v} for k, v in svc.preferences_for(db, user_id).items()],
        "buddy_reminder_24h": bool(reminder.buddy_reminder_24h) if reminder else False,
    }


@router.get("/notification-preferences")
def get_preferences(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return _preferences_out(db, current.user.id)


@router.put("/notification-preferences")
def put_preferences(body: PreferencesBody, current: CurrentUser = Depends(get_current_user),
                    db: Session = Depends(get_db)) -> dict:
    uid = current.user.id
    for item in body.preferences:
        if item.type not in svc.NOTIFICATION_TYPES:
            continue
        row = db.get(NotificationPreference, (uid, item.type))
        if row is None:
            db.add(NotificationPreference(user_id=uid, type=item.type, in_app=item.in_app, email=item.email))
        else:
            row.in_app, row.email = item.in_app, item.email
    if body.buddy_reminder_24h is not None:
        reminder = db.query(ReminderPreference).filter(ReminderPreference.user_id == uid).one_or_none()
        if reminder is None:
            reminder = ReminderPreference(user_id=uid)
            db.add(reminder)
        reminder.buddy_reminder_24h = body.buddy_reminder_24h
    db.commit()
    return _preferences_out(db, uid)
