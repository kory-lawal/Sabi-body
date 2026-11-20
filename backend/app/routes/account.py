"""The signed-in user's own account. Every query is scoped to current.user.id."""
from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.accounts import emails, rate_limit
from app.accounts.deps import CurrentUser, api_error, get_current_user
from app.accounts.schemas import (
    ChangeEmailRequest,
    ChangePasswordRequest,
    DeleteAccountRequest,
    MessageOut,
    UpdateProfileRequest,
    UserOut,
)
from app.accounts.security import hash_password, utcnow, verify_password
from app.db.models import RefreshSession, User
from app.db.session import get_db
from app.routes.auth import (
    _clear_refresh_cookie,
    _send_quietly,
    _validate_password,
    issue_verification,
    revoke_user_sessions,
    user_out,
)

router = APIRouter(prefix="/account", tags=["account"])


@router.get("/me", response_model=UserOut)
def me(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> UserOut:
    return user_out(current.user, db)


@router.patch("/me", response_model=UserOut)
def update_me(body: UpdateProfileRequest, current: CurrentUser = Depends(get_current_user),
              db: Session = Depends(get_db)) -> UserOut:
    user = current.user
    user.full_name = body.full_name
    db.commit()
    db.refresh(user)
    return user_out(user, db)


@router.post("/password", response_model=MessageOut)
def change_password(body: ChangePasswordRequest, request: Request, current: CurrentUser = Depends(get_current_user),
                    db: Session = Depends(get_db)) -> MessageOut:
    user = current.user
    rate_limit.enforce(request, "change_password", limit=5, window_seconds=900, identity=str(user.id))
    if not verify_password(user.password_hash, body.current_password):
        raise api_error(status.HTTP_400_BAD_REQUEST, "wrong_password", "Your current password is incorrect.")
    if body.current_password == body.new_password:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "weak_password", "Choose a password you haven't just used.")
    _validate_password(body.new_password, email=user.email, full_name=user.full_name)
    user.password_hash = hash_password(body.new_password)
    revoke_user_sessions(db, user.id, "password_changed", except_session=current.session_id)
    db.commit()
    _send_quietly(emails.password_changed_email(user.email, user.full_name))
    return MessageOut(message="Your password has been changed. Other devices were signed out.")


@router.post("/email", status_code=status.HTTP_202_ACCEPTED, response_model=MessageOut)
def request_email_change(body: ChangeEmailRequest, request: Request, current: CurrentUser = Depends(get_current_user),
                         db: Session = Depends(get_db)) -> MessageOut:
    user = current.user
    rate_limit.enforce(request, "change_email", limit=3, window_seconds=900, identity=str(user.id))
    new_email = body.new_email.lower()
    if not verify_password(user.password_hash, body.password):
        raise api_error(status.HTTP_400_BAD_REQUEST, "wrong_password", "Your password is incorrect.")
    if new_email == user.email:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "same_email", "That is already your email address.")
    if db.scalar(select(User.id).where(User.email == new_email)) is not None:
        raise api_error(status.HTTP_409_CONFLICT, "email_taken", "That email is already used by another account.")
    token = issue_verification(db, user, purpose="change_email", new_email=new_email)
    db.commit()
    if not _send_quietly(emails.email_change_email(new_email, user.full_name, token)):
        raise api_error(status.HTTP_502_BAD_GATEWAY, "email_failed", "We couldn't send the confirmation email. Try again later.")
    return MessageOut(message=f"We've sent a confirmation link to {new_email}. Your email changes after you confirm it.")


@router.get("/sessions")
def list_sessions(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    now = utcnow()
    active = db.scalar(
        select(func.count()).select_from(RefreshSession).where(
            RefreshSession.user_id == current.user.id,
            RefreshSession.revoked_at.is_(None),
            RefreshSession.expires_at > now,
        )
    )
    return {"active_sessions": int(active or 0)}


@router.post("/sessions/revoke-others", response_model=MessageOut)
def revoke_other_sessions(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> MessageOut:
    revoke_user_sessions(db, current.user.id, "logout_all", except_session=current.session_id)
    db.commit()
    return MessageOut(message="All other devices have been signed out.")


@router.delete("", response_model=MessageOut)
def delete_account(body: DeleteAccountRequest, request: Request, response: Response,
                   current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> MessageOut:
    user = current.user
    rate_limit.enforce(request, "delete_account", limit=5, window_seconds=900, identity=str(user.id))
    if not verify_password(user.password_hash, body.password):
        raise api_error(status.HTTP_400_BAD_REQUEST, "wrong_password", "Your password is incorrect.")
    # Foreign keys cascade to workouts, preferences, tokens, sessions and roles.
    db.execute(delete(User).where(User.id == user.id))
    db.commit()
    _clear_refresh_cookie(response)
    return MessageOut(message="Your account and workout history have been deleted.")
