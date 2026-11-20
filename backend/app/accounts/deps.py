"""Authentication and authorization dependencies.

Identity always comes from a verified access token; a user id sent by the
browser is never used as proof of ownership.
"""
import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.accounts.security import AccessTokenError, decode_access_token, utcnow
from app.config import settings
from app.db.models import AdminRole, RefreshSession, User
from app.db.session import get_db


def api_error(status_code: int, code: str, message: str, headers: dict | None = None) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message}, headers=headers)


@dataclass
class CurrentUser:
    user: User
    session_id: uuid.UUID


def _bearer_token(request: Request) -> str:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise api_error(status.HTTP_401_UNAUTHORIZED, "not_authenticated", "Please log in to continue.",
                        {"WWW-Authenticate": "Bearer"})
    return token.strip()


def get_current_user(request: Request, db: Session = Depends(get_db)) -> CurrentUser:
    token = _bearer_token(request)
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(payload["sub"])
        session_id = uuid.UUID(payload["sid"])
    except AccessTokenError as exc:
        if exc.code == "auth_unconfigured":
            raise api_error(status.HTTP_503_SERVICE_UNAVAILABLE, "auth_unconfigured",
                            "Accounts are not configured on this server yet.") from exc
        message = "Your session has expired." if exc.code == "token_expired" else "Please log in to continue."
        raise api_error(status.HTTP_401_UNAUTHORIZED, exc.code, message, {"WWW-Authenticate": "Bearer"}) from exc
    except (KeyError, ValueError) as exc:
        raise api_error(status.HTTP_401_UNAUTHORIZED, "invalid_token", "Please log in to continue.") from exc

    row = db.execute(
        select(User, RefreshSession)
        .join(RefreshSession, RefreshSession.user_id == User.id)
        .where(User.id == user_id, RefreshSession.id == session_id)
    ).first()
    if row is None:
        raise api_error(status.HTTP_401_UNAUTHORIZED, "session_revoked", "Please log in again.")
    user, session = row
    if session.revoked_at is not None or session.expires_at <= utcnow():
        raise api_error(status.HTTP_401_UNAUTHORIZED, "session_revoked", "Please log in again.")
    if not user.is_active:
        raise api_error(status.HTTP_403_FORBIDDEN, "account_disabled", "This account is disabled.")
    return CurrentUser(user=user, session_id=session_id)


def get_admin_user(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> CurrentUser:
    role = db.scalar(select(AdminRole).where(AdminRole.user_id == current.user.id, AdminRole.role == "admin"))
    if role is None:
        raise api_error(status.HTTP_403_FORBIDDEN, "forbidden", "You do not have access to this page.")
    return current


def require_trusted_origin(request: Request) -> None:
    """CSRF defence for cookie-authenticated endpoints (refresh, logout).

    SameSite=Lax already stops cross-site POSTs from carrying the cookie; this
    additionally rejects requests whose Origin is not an allowed frontend.
    """
    origin = request.headers.get("origin")
    if origin is None:
        return
    allowed = set(settings.ALLOWED_ORIGINS) | {settings.FRONTEND_URL}
    if origin.rstrip("/") not in allowed:
        raise api_error(status.HTTP_403_FORBIDDEN, "untrusted_origin", "This request origin is not allowed.")
