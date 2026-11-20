"""Friends, search, public profiles, blocking, reporting and per-friend mutes."""
import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.accounts import rate_limit
from app.accounts.deps import CurrentUser, api_error, get_current_user
from app.accounts.schemas import StrictModel
from app.accounts.security import utcnow
from app.db.models import Message, UserReport, WorkoutSession
from app.db.session import get_db
from app.social import friends as svc
from app.social.common import block_exists, parse_uuid, public_user

router = APIRouter(tags=["friends"])


class UsernameBody(StrictModel):
    username: str = Field(min_length=1, max_length=40)


class ReportBody(StrictModel):
    username: str = Field(min_length=1, max_length=40)
    reason: Literal["spam", "harassment", "inappropriate", "impersonation", "other"]
    details: str | None = Field(default=None, max_length=1000)
    message_id: str | None = None
    also_block: bool = False


@router.get("/users/search")
def search_users(request: Request, q: str = Query(default="", max_length=40),
                 current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    rate_limit.enforce(request, "user_search", limit=240, window_seconds=600, identity=str(current.user.id),
                       identity_limit=120)
    return {"results": svc.search(db, current.user.id, q)}


@router.get("/users/{username}")
def public_profile(username: str, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    me = current.user.id
    user = svc.find_by_username(db, username)
    if user is None or not user.is_active or not user.email_verified or block_exists(db, me, user.id):
        # A block in either direction looks exactly like "no such user", except to the blocker.
        if user is not None and svc.relationship(db, me, user.id) == "blocked":
            return {"user": public_user(user), "relationship": "blocked", "member_since": user.created_at.isoformat()}
        raise api_error(status.HTTP_404_NOT_FOUND, *svc.NOT_FOUND)
    rel = svc.relationship(db, me, user.id)
    profile = {"user": public_user(user), "relationship": rel, "member_since": user.created_at.isoformat()}
    if rel == "friends":
        # Friends see activity, never individual workout records.
        week_ago = utcnow() - timedelta(days=7)
        stats = db.execute(
            select(func.count(), func.max(WorkoutSession.started_at)).where(
                WorkoutSession.user_id == user.id, WorkoutSession.completed.is_(True))
        ).one()
        this_week = db.scalar(select(func.count()).select_from(WorkoutSession).where(
            WorkoutSession.user_id == user.id, WorkoutSession.completed.is_(True),
            WorkoutSession.started_at >= week_ago))
        profile["activity"] = {
            "completed_workouts": int(stats[0] or 0),
            "workouts_last_7_days": int(this_week or 0),
            "last_workout_at": stats[1].isoformat() if stats[1] else None,
        }
    return profile


@router.get("/friends")
def list_friends(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return svc.overview(db, current.user.id)


@router.post("/friends/requests", status_code=status.HTTP_201_CREATED)
def send_request(body: UsernameBody, request: Request, current: CurrentUser = Depends(get_current_user),
                 db: Session = Depends(get_db)) -> dict:
    rate_limit.enforce(request, "friend_request", limit=120, window_seconds=3600, identity=str(current.user.id),
                       identity_limit=40)
    return svc.send_request(db, current.user, body.username)


@router.post("/friends/requests/{request_id}/{action}")
def respond_request(request_id: str, action: Literal["accept", "decline", "cancel"],
                    current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    rid = parse_uuid(request_id, "request_not_found", "That friend request no longer exists.")
    return svc.respond(db, current.user, rid, action)


@router.delete("/friends/{user_id}")
def remove_friend(user_id: str, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    svc.remove_friend(db, current.user, parse_uuid(user_id, "not_friends", "You're not friends with this person."))
    return {"status": "removed"}


@router.post("/friends/{user_id}/mute")
def mute_friend(user_id: str, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    svc.set_mute(db, current.user, parse_uuid(user_id), True)
    return {"muted": True}


@router.delete("/friends/{user_id}/mute")
def unmute_friend(user_id: str, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    svc.set_mute(db, current.user, parse_uuid(user_id), False)
    return {"muted": False}


@router.post("/blocks")
def block_user(body: UsernameBody, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return svc.block(db, current.user, body.username)


@router.delete("/blocks/{user_id}")
def unblock_user(user_id: str, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    svc.unblock(db, current.user, parse_uuid(user_id))
    return {"status": "unblocked"}


@router.post("/reports", status_code=status.HTTP_201_CREATED)
def report_user(body: ReportBody, request: Request, current: CurrentUser = Depends(get_current_user),
                db: Session = Depends(get_db)) -> dict:
    rate_limit.enforce(request, "report", limit=60, window_seconds=86400, identity=str(current.user.id),
                       identity_limit=10)
    target = svc.find_by_username(db, body.username)
    if target is None or target.id == current.user.id:
        raise api_error(status.HTTP_404_NOT_FOUND, *svc.NOT_FOUND)
    message_id = None
    if body.message_id:
        mid = parse_uuid(body.message_id)
        msg = db.get(Message, mid)
        if msg is not None and msg.sender_id == target.id:
            message_id = mid
    db.add(UserReport(reporter_id=current.user.id, reported_id=target.id, reported_username=target.username,
                      reason=body.reason, details=(body.details or "").strip() or None, message_id=message_id))
    db.commit()
    if body.also_block:
        svc.block(db, current.user, target.username)
    return {"status": "reported", "message": "Thanks. Our team will review this report."}
