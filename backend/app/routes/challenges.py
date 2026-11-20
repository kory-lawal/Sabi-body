"""Friend challenges (progress always comes from real saved workouts)."""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request, status
from pydantic import Field, field_validator
from sqlalchemy.orm import Session

from app.accounts import rate_limit
from app.accounts.deps import CurrentUser, get_current_user
from app.accounts.schemas import StrictModel
from app.db.session import get_db
from app.social import challenges as svc
from app.social.common import parse_uuid

router = APIRouter(prefix="/challenges", tags=["challenges"])


class CreateBody(StrictModel):
    friend_id: str
    metric: Literal["reps", "seconds", "workouts"]
    exercise_id: str = Field(default="any", max_length=40)
    target: int
    deadline: datetime
    message: str | None = Field(default=None, max_length=280)

    @field_validator("deadline")
    @classmethod
    def _tz(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("The deadline must include a timezone.")
        return value


@router.get("")
def list_challenges(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return svc.list_for(db, current.user.id)


@router.post("", status_code=status.HTTP_201_CREATED)
def create(body: CreateBody, request: Request, current: CurrentUser = Depends(get_current_user),
           db: Session = Depends(get_db)) -> dict:
    rate_limit.enforce(request, "challenge_create", limit=60, window_seconds=3600, identity=str(current.user.id),
                       identity_limit=20)
    c = svc.create(db, current.user, parse_uuid(body.friend_id, "user_not_found", "We couldn't find that friend."),
                   body.metric, body.exercise_id, body.target, body.deadline, body.message)
    return {"challenge": svc.challenge_out(db, c, current.user.id)}


@router.get("/{challenge_id}")
def get_challenge(challenge_id: str, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    c = svc.get_for(db, parse_uuid(challenge_id, "challenge_not_found", "We couldn't find that challenge."), current.user.id)
    return {"challenge": svc.challenge_out(db, c, current.user.id)}


@router.post("/{challenge_id}/{action}")
def respond(challenge_id: str, action: Literal["accept", "decline", "cancel"],
            current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    cid = parse_uuid(challenge_id, "challenge_not_found", "We couldn't find that challenge.")
    c = svc.respond(db, current.user, cid, action)
    return {"challenge": svc.challenge_out(db, c, current.user.id)}
