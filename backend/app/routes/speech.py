from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.models.schemas import SpeechGenerateRequest, SpeechRequest
from app.services.naijalingo_service import naijalingo_service

router = APIRouter()


@router.get("/voices")
async def list_voices() -> dict:
    try:
        voices = naijalingo_service.list_voices()
    except RuntimeError as exc:  # pragma: no cover - runtime integration
        status_code = 503 if not naijalingo_service.is_configured else 502
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    return {"voices": voices}


@router.post("/test")
async def speech_test(request: SpeechRequest) -> Response:
    try:
        payload, mime_type, _ = naijalingo_service.synthesize(request.language, request.text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(content=payload, media_type=mime_type)


@router.post("/audio", include_in_schema=False)
@router.post("/generate")
async def speech_generate(request: SpeechGenerateRequest) -> Response:
    try:
        payload, mime_type, _ = naijalingo_service.synthesize(
            request.language,
            request.text,
            voice=request.voice,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(content=payload, media_type=mime_type)


@router.get("/health")
async def speech_service_health() -> dict:
    return {
        "status": "ok" if naijalingo_service.is_configured else "degraded",
        "configured": naijalingo_service.is_configured,
        "service": "yarngpt",
    }
