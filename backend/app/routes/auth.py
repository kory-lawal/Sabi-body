from fastapi import APIRouter, Depends

from app.auth import AuthenticatedUser, get_current_user

router = APIRouter()


@router.get("/auth/me")
def me(user: AuthenticatedUser = Depends(get_current_user)) -> dict[str, str | None]:
    return {"id": user.id, "email": user.email}
