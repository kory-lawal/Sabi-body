from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes.health import router as health_router
from app.routes.pose import router as pose_router
from app.routes.speech import router as speech_router

app = FastAPI(title="Sabi Body Python API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api")
app.include_router(speech_router, prefix="/api/speech")
app.include_router(speech_router, prefix="/api/coach")
app.include_router(pose_router)


@app.get("/")
async def root() -> dict:
    return {"status": "ok", "service": "sabi-body-python-api"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=settings.DEBUG)
