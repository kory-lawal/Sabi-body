"""Reminder preferences for the signed-in user."""
from datetime import time

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.accounts.deps import CurrentUser, api_error, get_current_user
from app.db.models import ReminderPreference
from app.db.session import get_db
from app.routes.workouts import resolve_timezone

router = APIRouter(prefix="/reminders", tags=["reminders"])

MORNING_RANGE = (time(4, 0), time(11, 59))
EVENING_RANGE = (time(15, 0), time(23, 59))


class ReminderUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email_reminders_enabled: bool
    morning_reminder_enabled: bool
    morning_reminder_time: time
    evening_reminder_enabled: bool
    evening_reminder_time: time
    timezone: str

    @field_validator("morning_reminder_time", "evening_reminder_time")
    @classmethod
    def _minute_precision(cls, value: time) -> time:
        return value.replace(second=0, microsecond=0, tzinfo=None)


def preferences_out(pref: ReminderPreference) -> dict:
    return {
        "email_reminders_enabled": pref.email_reminders_enabled,
        "morning_reminder_enabled": pref.morning_reminder_enabled,
        "morning_reminder_time": pref.morning_reminder_time.strftime("%H:%M"),
        "evening_reminder_enabled": pref.evening_reminder_enabled,
        "evening_reminder_time": pref.evening_reminder_time.strftime("%H:%M"),
        "timezone": pref.timezone,
        "updated_at": pref.updated_at.isoformat() if pref.updated_at else None,
    }


def _get_or_create(db: Session, user_id) -> ReminderPreference:
    pref = db.scalar(select(ReminderPreference).where(ReminderPreference.user_id == user_id))
    if pref is None:
        pref = ReminderPreference(user_id=user_id)
        db.add(pref)
        db.commit()
        db.refresh(pref)
    return pref


@router.get("")
def get_preferences(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return preferences_out(_get_or_create(db, current.user.id))


@router.put("")
def update_preferences(body: ReminderUpdate, current: CurrentUser = Depends(get_current_user),
                       db: Session = Depends(get_db)) -> dict:
    zone = resolve_timezone(body.timezone)
    if not (MORNING_RANGE[0] <= body.morning_reminder_time <= MORNING_RANGE[1]):
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_time", "Choose a morning time between 04:00 and 11:59.")
    if not (EVENING_RANGE[0] <= body.evening_reminder_time <= EVENING_RANGE[1]):
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_time", "Choose an evening time between 15:00 and 23:59.")
    pref = _get_or_create(db, current.user.id)
    pref.email_reminders_enabled = body.email_reminders_enabled
    pref.morning_reminder_enabled = body.morning_reminder_enabled
    pref.morning_reminder_time = body.morning_reminder_time
    pref.evening_reminder_enabled = body.evening_reminder_enabled
    pref.evening_reminder_time = body.evening_reminder_time
    pref.timezone = zone.key
    db.commit()
    db.refresh(pref)
    return preferences_out(pref)
