from fastapi import APIRouter

from app.services.naijalingo_service import naijalingo_service

router = APIRouter()


@router.get("/health")
async def python_backend_health() -> dict:
    return {"status": "ok", "service": "sabi-body-python-api"}


@router.get("/speech/health")
async def speech_backend_health() -> dict:
    return {
        "status": "ok" if naijalingo_service.is_configured else "degraded",
        "configured": naijalingo_service.is_configured,
        "service": "yarngpt",
    }
