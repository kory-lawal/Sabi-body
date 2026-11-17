import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env", override=False)


class Settings:
    PROJECT_ROOT = BASE_DIR
    MODELS_DIR = BASE_DIR / "models"
    POSE_MODEL_PATH = MODELS_DIR / "pose_landmarker.task"
    YARNGPT_API_KEY = os.getenv("YARNGPT_API_KEY", "").strip() or os.getenv("NAIJALINGO_API_KEY", "").strip()
    YARNGPT_BASE_URL = os.getenv("YARNGPT_BASE_URL", "https://api.yarngpt.ai").rstrip("/")
    ALLOWED_ORIGINS = [
        origin.strip()
        for origin in os.getenv(
            "SABI_ALLOWED_ORIGINS",
            "http://localhost:5173,http://localhost:5175,http://localhost:5176",
        ).split(",")
        if origin.strip()
    ]
    SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    SUPABASE_JWKS_URL = os.getenv("SUPABASE_JWKS_URL", "").strip() or (
        f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
        if SUPABASE_URL
        else ""
    )
    DEBUG = os.getenv("PYTHON_ENV", "development").lower() != "production"


settings = Settings()
