from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError, PyJWTError

from app.config import settings

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    email: str | None


@lru_cache(maxsize=4)
def _create_jwks_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url)


def get_jwks_client() -> PyJWKClient | None:
    jwks_url = settings.SUPABASE_JWKS_URL
    if not jwks_url:
        return None
    return _create_jwks_client(jwks_url)


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing or invalid bearer token.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthenticatedUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized()

    supabase_url = settings.SUPABASE_URL
    jwks_url = settings.SUPABASE_JWKS_URL
    if not supabase_url or not jwks_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase token verification is not configured.",
        )

    try:
        jwks_client = get_jwks_client()
        if jwks_client is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Supabase token verification is not configured.",
            )
        signing_key = jwks_client.get_signing_key_from_jwt(credentials.credentials)
    except PyJWKClientConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase signing keys are temporarily unavailable.",
        ) from exc
    except (PyJWKClientError, PyJWTError) as exc:
        raise _unauthorized() from exc

    try:
        claims = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            issuer=f"{supabase_url}/auth/v1",
            options={"require": ["exp", "sub", "aud", "iss", "role"]},
        )
    except PyJWTError as exc:
        raise _unauthorized() from exc

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise _unauthorized()
    if claims.get("role") != "authenticated":
        raise _unauthorized()

    email = claims.get("email")
    return AuthenticatedUser(
        id=subject,
        email=email if isinstance(email, str) else None,
    )
