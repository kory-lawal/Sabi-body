"""Registration, login, persistent sessions, verification and password reset.

Session model:
- A short-lived access token (JWT, default 15 min) is returned in the JSON body
  and kept only in browser memory.
- A long-lived opaque refresh token lives in an HttpOnly, SameSite=Lax cookie
  scoped to /api/auth (Secure in production). Only its SHA-256 hash is stored.
- Every refresh rotates the token. Presenting an already-rotated token outside
  a short grace window is treated as theft and revokes all of the user's sessions.
"""
import logging
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.accounts import emails, rate_limit
from app.accounts.deps import CurrentUser, api_error, get_current_user, require_trusted_origin
from app.accounts.schemas import (
    EmailOnlyRequest,
    LoginRequest,
    MessageOut,
    RegisterRequest,
    ResetPasswordRequest,
    SessionOut,
    TokenRequest,
    UserOut,
)
from app.accounts.security import (
    auth_secret,
    create_access_token,
    hash_password,
    hash_token,
    new_opaque_token,
    password_needs_rehash,
    password_problems,
    utcnow,
    verify_password,
)
from app.config import settings
from app.social import usernames
from app.db.models import (
    AdminAuditLog,
    AdminRole,
    EmailVerificationToken,
    PasswordResetToken,
    RefreshSession,
    ReminderPreference,
    User,
)
from app.db.session import get_db

logger = logging.getLogger("sabibody.auth")
router = APIRouter(prefix="/auth", tags=["auth"])

ROTATION_GRACE_SECONDS = 30
NON_REMEMBERED_SESSION_HOURS = 12


# --------------------------------------------------------------------------- helpers

def user_out(user: User, db: Session) -> UserOut:
    is_admin = db.scalar(select(AdminRole.id).where(AdminRole.user_id == user.id)) is not None
    return UserOut(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        username=user.username,
        email_verified=user.email_verified,
        created_at=user.created_at,
        is_admin=is_admin,
    )


def _require_auth_configured() -> None:
    if not auth_secret():
        raise api_error(status.HTTP_503_SERVICE_UNAVAILABLE, "auth_unconfigured",
                        "Accounts are not configured on this server yet.")


def _validate_password(password: str, email: str = "", full_name: str = "") -> None:
    problems = password_problems(password, email=email, full_name=full_name)
    if problems:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "weak_password", " ".join(problems))


def _set_refresh_cookie(response: Response, token: str, remember: bool) -> None:
    response.set_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        value=token,
        max_age=settings.REFRESH_TOKEN_DAYS * 86400 if remember else None,
        path=settings.REFRESH_COOKIE_PATH,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        path=settings.REFRESH_COOKIE_PATH,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
    )


def _cookie_clearing_error(status_code: int, code: str, message: str):
    """An error response that also deletes the refresh cookie."""
    scratch = Response()
    _clear_refresh_cookie(scratch)
    return api_error(status_code, code, message, {"set-cookie": scratch.headers["set-cookie"]})


def _session_lifetime(remember: bool) -> timedelta:
    return timedelta(days=settings.REFRESH_TOKEN_DAYS) if remember else timedelta(hours=NON_REMEMBERED_SESSION_HOURS)


def _start_session(db: Session, user: User, remember: bool, request: Request) -> tuple[RefreshSession, str]:
    token = new_opaque_token()
    session = RefreshSession(
        user_id=user.id,
        token_hash=hash_token(token),
        remember=remember,
        user_agent=(request.headers.get("user-agent") or "")[:255] or None,
        expires_at=utcnow() + _session_lifetime(remember),
        last_used_at=utcnow(),
    )
    db.add(session)
    db.flush()
    return session, token


def revoke_user_sessions(db: Session, user_id: uuid.UUID, reason: str, except_session: uuid.UUID | None = None) -> None:
    stmt = (
        update(RefreshSession)
        .where(RefreshSession.user_id == user_id, RefreshSession.revoked_at.is_(None))
        .values(revoked_at=utcnow(), revoked_reason=reason)
    )
    if except_session is not None:
        stmt = stmt.where(RefreshSession.id != except_session)
    db.execute(stmt)


def _maybe_bootstrap_admin(db: Session, user: User) -> None:
    """Grant admin to a verified user whose email is listed in the server-side
    ADMIN_BOOTSTRAP_EMAILS variable. Browsers can never request this."""
    if not user.email_verified or user.email not in settings.ADMIN_BOOTSTRAP_EMAILS:
        return
    if db.scalar(select(AdminRole.id).where(AdminRole.user_id == user.id)) is not None:
        return
    db.add(AdminRole(user_id=user.id, role="admin", granted_via="env_bootstrap"))
    db.add(AdminAuditLog(actor_user_id=user.id, action="admin_granted", details={"via": "ADMIN_BOOTSTRAP_EMAILS"}))
    logger.warning("Granted admin role via ADMIN_BOOTSTRAP_EMAILS to user %s", user.id)


def issue_verification(db: Session, user: User, *, purpose: str = "verify_email", new_email: str | None = None) -> str:
    # Invalidate outstanding tokens of the same purpose so only the newest link works.
    db.execute(
        update(EmailVerificationToken)
        .where(
            EmailVerificationToken.user_id == user.id,
            EmailVerificationToken.purpose == purpose,
            EmailVerificationToken.used_at.is_(None),
        )
        .values(used_at=utcnow())
    )
    token = new_opaque_token()
    db.add(EmailVerificationToken(
        user_id=user.id,
        token_hash=hash_token(token),
        purpose=purpose,
        new_email=new_email,
        expires_at=utcnow() + timedelta(hours=settings.EMAIL_VERIFICATION_HOURS),
    ))
    return token


def _send_quietly(message: emails.EmailMessage) -> bool:
    try:
        emails.send_email(message)
        return True
    except emails.EmailDeliveryError as exc:
        logger.error("Email delivery failed (%s): %s", message.subject, exc)
        return False


def _session_response(db: Session, user: User, session: RefreshSession, token: str, response: Response) -> SessionOut:
    access_token, expires_in = create_access_token(user.id, session.id)
    _set_refresh_cookie(response, token, session.remember)
    response.headers["Cache-Control"] = "no-store"
    return SessionOut(access_token=access_token, expires_in=expires_in, user=user_out(user, db))


# --------------------------------------------------------------------------- routes

@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    _require_auth_configured()
    email = body.email.lower()
    rate_limit.enforce(request, "register", limit=30, window_seconds=3600, identity=email, identity_limit=5)
    _validate_password(body.password, email=email, full_name=body.full_name)

    if db.scalar(select(User.id).where(User.email == email)) is not None:
        raise api_error(status.HTTP_409_CONFLICT, "email_taken",
                        "An account with this email already exists. Log in or reset your password.")
    user = User(full_name=body.full_name, email=email, password_hash=hash_password(body.password),
                username=usernames.generate(db, email),
                email_verified=not settings.REQUIRE_EMAIL_VERIFICATION)
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:  # concurrent registration with the same email
        db.rollback()
        raise api_error(status.HTTP_409_CONFLICT, "email_taken",
                        "An account with this email already exists. Log in or reset your password.") from exc
    db.add(ReminderPreference(user_id=user.id))
    token = issue_verification(db, user) if settings.REQUIRE_EMAIL_VERIFICATION else None
    db.commit()

    email_sent = _send_quietly(emails.verification_email(user.email, user.full_name, token)) if token else False
    return {
        "message": "Your account has been created.",
        "email_verification_required": settings.REQUIRE_EMAIL_VERIFICATION,
        "verification_email_sent": email_sent,
    }


@router.post("/login", response_model=SessionOut)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> SessionOut:
    _require_auth_configured()
    email = body.email.lower()
    rate_limit.enforce(request, "login", limit=60, window_seconds=900, identity=email, identity_limit=10)
    user = db.scalar(select(User).where(User.email == email))
    if not verify_password(user.password_hash if user else None, body.password) or user is None:
        raise api_error(status.HTTP_401_UNAUTHORIZED, "invalid_credentials", "That email and password don't match.")
    if not user.is_active:
        raise api_error(status.HTTP_403_FORBIDDEN, "account_disabled", "This account is disabled.")
    if settings.REQUIRE_EMAIL_VERIFICATION and not user.email_verified:
        raise api_error(status.HTTP_403_FORBIDDEN, "email_not_verified",
                        "Please confirm your email first. Check your inbox or send a new link.")
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    _maybe_bootstrap_admin(db, user)
    session, token = _start_session(db, user, body.remember, request)
    db.commit()
    return _session_response(db, user, session, token, response)


@router.post("/refresh", response_model=SessionOut, dependencies=[Depends(require_trusted_origin)])
def refresh(request: Request, response: Response, db: Session = Depends(get_db)) -> SessionOut:
    _require_auth_configured()
    rate_limit.enforce(request, "refresh", limit=60, window_seconds=300)
    raw = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    if not raw:
        raise api_error(status.HTTP_401_UNAUTHORIZED, "no_session", "Please log in.")

    session = db.scalar(
        select(RefreshSession).where(RefreshSession.token_hash == hash_token(raw)).with_for_update()
    )
    now = utcnow()
    if session is None:
        raise _cookie_clearing_error(status.HTTP_401_UNAUTHORIZED, "no_session", "Please log in.")
    if session.revoked_at is not None:
        if session.revoked_reason == "rotated" and (now - session.revoked_at).total_seconds() < ROTATION_GRACE_SECONDS:
            # Another tab refreshed at the same moment; its new cookie is already set.
            raise api_error(status.HTTP_409_CONFLICT, "refresh_conflict", "Session refreshed in another tab; retry.")
        if session.revoked_reason == "rotated":
            logger.warning("Refresh token reuse detected for user %s; revoking all sessions.", session.user_id)
            revoke_user_sessions(db, session.user_id, "reuse_detected")
            db.commit()
        raise _cookie_clearing_error(status.HTTP_401_UNAUTHORIZED, "session_revoked", "Please log in again.")
    if session.expires_at <= now:
        raise _cookie_clearing_error(status.HTTP_401_UNAUTHORIZED, "session_expired", "Your session has expired. Please log in again.")

    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise _cookie_clearing_error(status.HTTP_401_UNAUTHORIZED, "session_revoked", "Please log in again.")

    session.revoked_at = now
    session.revoked_reason = "rotated"
    session.last_used_at = now
    new_session, token = _start_session(db, user, session.remember, request)
    _maybe_bootstrap_admin(db, user)
    db.commit()
    return _session_response(db, user, new_session, token, response)


@router.post("/logout", response_model=MessageOut, dependencies=[Depends(require_trusted_origin)])
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> MessageOut:
    raw = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    if raw:
        db.execute(
            update(RefreshSession)
            .where(RefreshSession.token_hash == hash_token(raw), RefreshSession.revoked_at.is_(None))
            .values(revoked_at=utcnow(), revoked_reason="logout")
        )
        db.commit()
    _clear_refresh_cookie(response)
    return MessageOut(message="You have been logged out.")


@router.post("/logout-all", response_model=MessageOut)
def logout_all(response: Response, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> MessageOut:
    revoke_user_sessions(db, current.user.id, "logout_all")
    db.commit()
    _clear_refresh_cookie(response)
    return MessageOut(message="You have been logged out on all devices.")


@router.post("/verify-email")
def verify_email(body: TokenRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    rate_limit.enforce(request, "verify", limit=20, window_seconds=900)
    record = db.scalar(
        select(EmailVerificationToken)
        .where(EmailVerificationToken.token_hash == hash_token(body.token))
        .with_for_update()
    )
    now = utcnow()
    if record is None or record.used_at is not None or record.expires_at <= now:
        raise api_error(status.HTTP_400_BAD_REQUEST, "invalid_token",
                        "This link is invalid or has expired. Request a new one.")
    user = db.get(User, record.user_id)
    if user is None:
        raise api_error(status.HTTP_400_BAD_REQUEST, "invalid_token", "This link is invalid or has expired.")
    record.used_at = now
    if record.purpose == "change_email":
        new_email = (record.new_email or "").lower()
        if db.scalar(select(User.id).where(User.email == new_email, User.id != user.id)) is not None:
            db.commit()
            raise api_error(status.HTTP_409_CONFLICT, "email_taken", "That email is now used by another account.")
        user.email = new_email
        message = "Your email address has been updated."
    else:
        message = "Your email is confirmed. You can log in now."
    user.email_verified = True
    user.email_verified_at = now
    _maybe_bootstrap_admin(db, user)
    db.commit()
    return {"message": message, "email": user.email, "purpose": record.purpose}


@router.post("/resend-verification", status_code=status.HTTP_202_ACCEPTED, response_model=MessageOut)
def resend_verification(body: EmailOnlyRequest, request: Request, db: Session = Depends(get_db)) -> MessageOut:
    email = body.email.lower()
    rate_limit.enforce(request, "resend", limit=20, window_seconds=900, identity=email, identity_limit=3)
    user = db.scalar(select(User).where(User.email == email))
    if user is not None and not user.email_verified and user.is_active:
        token = issue_verification(db, user)
        db.commit()
        _send_quietly(emails.verification_email(user.email, user.full_name, token))
    return MessageOut(message="If that account needs confirming, we've sent a new link.")


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED, response_model=MessageOut)
def forgot_password(body: EmailOnlyRequest, request: Request, db: Session = Depends(get_db)) -> MessageOut:
    email = body.email.lower()
    rate_limit.enforce(request, "forgot", limit=20, window_seconds=900, identity=email, identity_limit=3)
    user = db.scalar(select(User).where(User.email == email))
    if user is not None and user.is_active:
        db.execute(
            update(PasswordResetToken)
            .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
            .values(used_at=utcnow())
        )
        token = new_opaque_token()
        db.add(PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=utcnow() + timedelta(minutes=settings.PASSWORD_RESET_MINUTES),
        ))
        db.commit()
        _send_quietly(emails.password_reset_email(user.email, user.full_name, token))
    return MessageOut(message="If an account uses that email, we've sent a password reset link.")


@router.post("/reset-password", response_model=MessageOut)
def reset_password(body: ResetPasswordRequest, request: Request, db: Session = Depends(get_db)) -> MessageOut:
    rate_limit.enforce(request, "reset", limit=10, window_seconds=900)
    record = db.scalar(
        select(PasswordResetToken)
        .where(PasswordResetToken.token_hash == hash_token(body.token))
        .with_for_update()
    )
    now = utcnow()
    if record is None or record.used_at is not None or record.expires_at <= now:
        raise api_error(status.HTTP_400_BAD_REQUEST, "invalid_token",
                        "This reset link is invalid or has expired. Request a new one.")
    user = db.get(User, record.user_id)
    if user is None:
        raise api_error(status.HTTP_400_BAD_REQUEST, "invalid_token", "This reset link is invalid or has expired.")
    _validate_password(body.password, email=user.email, full_name=user.full_name)
    record.used_at = now
    user.password_hash = hash_password(body.password)
    # Clicking the emailed link proves ownership of the address.
    if not user.email_verified:
        user.email_verified = True
        user.email_verified_at = now
    revoke_user_sessions(db, user.id, "password_reset")
    db.commit()
    _send_quietly(emails.password_changed_email(user.email, user.full_name))
    return MessageOut(message="Your password has been reset. Log in with your new password.")
