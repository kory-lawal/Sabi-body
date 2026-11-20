"""Private messaging between friends (REST; the realtime socket offers the same send/read)."""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from sqlalchemy.orm import Session

from app.accounts.deps import CurrentUser, get_current_user
from app.accounts.schemas import StrictModel
from app.db.session import get_db
from app.social import chat
from app.social.common import parse_uuid

router = APIRouter(tags=["chat"])


class SendBody(StrictModel):
    kind: Literal["text", "exercise_card"] = "text"
    body: str = Field(default="", max_length=4000)
    payload: dict = Field(default_factory=dict)
    client_msg_id: str = Field(min_length=8, max_length=64)


class NudgeBody(StrictModel):
    preset: str = Field(min_length=1, max_length=40)


@router.get("/conversations")
def list_conversations(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return chat.conversations(db, current.user)


@router.get("/conversations/unread")
def unread(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return {"unread": chat.total_unread(db, current.user.id)}


@router.get("/conversations/{friend_id}/messages")
def history(friend_id: str, before: datetime | None = None, limit: int = Query(default=50, ge=1, le=100),
            current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return chat.history(db, current.user, parse_uuid(friend_id), before, limit)


@router.post("/conversations/{friend_id}/messages", status_code=201)
def send_message(friend_id: str, body: SendBody, current: CurrentUser = Depends(get_current_user),
                 db: Session = Depends(get_db)) -> dict:
    return chat.send(db, current.user, parse_uuid(friend_id), body.kind, body.body, body.payload, body.client_msg_id)


@router.post("/conversations/{friend_id}/read")
def mark_read(friend_id: str, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return chat.mark_read(db, current.user, parse_uuid(friend_id))


@router.post("/friends/{friend_id}/nudge", status_code=201)
def nudge(friend_id: str, body: NudgeBody, current: CurrentUser = Depends(get_current_user),
          db: Session = Depends(get_db)) -> dict:
    return chat.nudge(db, current.user, parse_uuid(friend_id), body.preset)


@router.get("/nudge-presets")
def presets(current: CurrentUser = Depends(get_current_user)) -> dict:
    return {"presets": [{"id": k, "text": v} for k, v in chat.NUDGE_PRESETS.items()]}
