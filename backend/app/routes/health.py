from fastapi import APIRouter

from app.services.naijalingo_service import naijalingo_service

router = APIRouter()


@router.get("/health")
async def python_backend_health() -> dict:
    return {"status": "ok", "service": "sabi-body-python-api"}


@router.get("/health/db")
def database_health() -> dict:
    from sqlalchemy import text

    from app.accounts.security import auth_secret
    from app.config import settings
    from app.db.session import get_engine

    engine = get_engine()
    if engine is None:
        return {"database": "unconfigured", "auth": bool(auth_secret()), "email_provider": settings.email_provider}
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1"))
        database = "ok"
    except Exception:  # report status only; never leak connection details
        database = "error"
    return {"database": database, "auth": bool(auth_secret()), "email_provider": settings.email_provider}


@router.get("/speech/health")
async def speech_backend_health() -> dict:
    return {
        "status": "ok" if naijalingo_service.is_configured else "degraded",
        "configured": naijalingo_service.is_configured,
        "service": "yarngpt",
    }
