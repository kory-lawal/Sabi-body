"""Workout invitations and the shared calendar."""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import Field, field_validator
from sqlalchemy.orm import Session

from app.accounts import rate_limit
from app.accounts.deps import CurrentUser, get_current_user
from app.accounts.schemas import StrictModel
from app.db.session import get_db
from app.social import sessions as svc
from app.social.common import parse_uuid

router = APIRouter(prefix="/shared-sessions", tags=["shared sessions"])


def _tz(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        raise ValueError("Times must include a timezone.")
    return value


class CreateBody(StrictModel):
    friend_id: str
    exercise_id: str = Field(max_length=40)
    target: int
    mode: Literal["instant", "scheduled"]
    scheduled_at: datetime | None = None
    message: str | None = Field(default=None, max_length=280)

    _check_tz = field_validator("scheduled_at")(_tz)


class RescheduleBody(StrictModel):
    scheduled_at: datetime

    _check_tz = field_validator("scheduled_at")(_tz)


def _out(db, s, current):
    return {"session": svc.session_out(db, s, current.user.id)}


@router.post("", status_code=status.HTTP_201_CREATED)
def create(body: CreateBody, request: Request, current: CurrentUser = Depends(get_current_user),
           db: Session = Depends(get_db)) -> dict:
    rate_limit.enforce(request, "shared_session_create", limit=120, window_seconds=3600, identity=str(current.user.id),
                       identity_limit=30)
    s = svc.create(db, current.user, parse_uuid(body.friend_id, "user_not_found", "We couldn't find that friend."),
                   body.exercise_id, body.target, body.mode, body.scheduled_at, body.message)
    db.commit()
    return _out(db, s, current)


@router.get("")
def list_sessions(view: Literal["pending", "upcoming", "past", "cancelled"] = "upcoming",
                  start: datetime | None = Query(default=None, alias="from"),
                  end: datetime | None = Query(default=None, alias="to"),
                  current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    rows = svc.list_for(db, current.user.id, view, start, end)
    return {"sessions": [svc.session_out(db, s, current.user.id) for s in rows]}


@router.get("/{session_id}")
def get_session(session_id: str, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    s = svc.get_for(db, parse_uuid(session_id, "session_not_found", "We couldn't find that workout."), current.user.id)
    return _out(db, s, current)


@router.post("/{session_id}/reschedule")
def reschedule(session_id: str, body: RescheduleBody, current: CurrentUser = Depends(get_current_user),
               db: Session = Depends(get_db)) -> dict:
    sid = parse_uuid(session_id, "session_not_found", "We couldn't find that workout.")
    return _out(db, svc.reschedule(db, current.user, sid, body.scheduled_at), current)


@router.post("/{session_id}/{action}")
def respond(session_id: str, action: Literal["accept", "decline", "cancel"],
            current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    sid = parse_uuid(session_id, "session_not_found", "We couldn't find that workout.")
    s = {"accept": svc.accept, "decline": svc.decline, "cancel": svc.cancel}[action](db, current.user, sid)
    return _out(db, s, current)
