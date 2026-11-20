import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from app.config import settings
from app.routes.account import router as account_router
from app.routes.admin import router as admin_router
from app.routes.auth import router as auth_router
from app.routes.friends import router as friends_router
from app.routes.health import router as health_router
from app.routes.internal import router as internal_router
from app.routes.notifications import router as notifications_router
from app.routes.pose import router as pose_router
from app.routes.reminders import router as reminders_router
from app.routes.speech import router as speech_router
from app.routes.workouts import router as workouts_router
from app.realtime.ws import router as ws_router
from app.realtime import handlers_chat, rooms  # noqa: F401  (register socket handlers)
from app.routes.rtc import router as rtc_router
from app.routes.chat import router as chat_router
from app.routes.shared_sessions import router as shared_sessions_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sabibody")

app = FastAPI(title="Sabi Body Python API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)


@app.exception_handler(OperationalError)
async def database_error_handler(request: Request, exc: OperationalError) -> JSONResponse:
    logger.error("Database unavailable during %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=503,
        content={"detail": {"code": "database_unavailable",
                            "message": "Accounts are temporarily unavailable. Please try again shortly."}},
    )


app.include_router(health_router, prefix="/api")
app.include_router(speech_router, prefix="/api/speech")
app.include_router(speech_router, prefix="/api/coach")
app.include_router(auth_router, prefix="/api")
app.include_router(account_router, prefix="/api")
app.include_router(workouts_router, prefix="/api")
app.include_router(reminders_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(internal_router, prefix="/api")
app.include_router(friends_router, prefix="/api")
app.include_router(notifications_router, prefix="/api")
app.include_router(ws_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(rtc_router, prefix="/api")
app.include_router(shared_sessions_router, prefix="/api")
app.include_router(pose_router)


async def _buddy_ticker() -> None:
    """Run Buddies jobs every minute while this process is awake (reminder precision).

    GitHub Actions' 15-minute cron remains the backstop when the server was asleep;
    delivery logs make concurrent or repeated runs harmless.
    """
    import asyncio

    from starlette.concurrency import run_in_threadpool

    from app.db.session import new_session
    from app.jobs.buddy_jobs import run_buddy_jobs

    def tick() -> None:
        db = new_session()
        try:
            run_buddy_jobs(db)
        finally:
            db.close()

    while True:
        await asyncio.sleep(60)
        try:
            await run_in_threadpool(tick)
        except Exception:  # noqa: BLE001
            logger.exception("Buddies ticker run failed")


@app.on_event("startup")
async def _start_background_jobs() -> None:
    import asyncio
    import os

    if settings.database_configured and os.getenv("SABI_DISABLE_TICKER") != "1":
        app.state.buddy_ticker = asyncio.create_task(_buddy_ticker())


@app.get("/")
async def root() -> dict:
    return {"status": "ok", "service": "sabi-body-python-api"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=settings.DEBUG)
