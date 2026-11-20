import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env", override=False)


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    value = os.getenv(name, "").strip()
    try:
        return int(value) if value else default
    except ValueError:
        return default


def _list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def normalize_database_url(url: str) -> str:
    """Use the psycopg 3 driver for postgres:// and postgresql:// URLs."""
    url = url.strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


class Settings:
    PROJECT_ROOT = BASE_DIR
    MODELS_DIR = BASE_DIR / "models"
    POSE_MODEL_PATH = MODELS_DIR / "pose_landmarker.task"
    YARNGPT_API_KEY = os.getenv("YARNGPT_API_KEY", "").strip() or os.getenv("NAIJALINGO_API_KEY", "").strip()
    YARNGPT_BASE_URL = os.getenv("YARNGPT_BASE_URL", "https://api.yarngpt.ai").rstrip("/")
    ALLOWED_ORIGINS = _list(
        "SABI_ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:5175,http://localhost:5176",
    )
    DEBUG = os.getenv("PYTHON_ENV", "development").lower() != "production"
    IS_PRODUCTION = not DEBUG

    # Database (Neon PostgreSQL). Never expose this value to the browser.
    DATABASE_URL = normalize_database_url(os.getenv("DATABASE_URL", ""))

    # Authentication
    AUTH_SECRET_KEY = os.getenv("AUTH_SECRET_KEY", "").strip()
    ACCESS_TOKEN_MINUTES = _int("ACCESS_TOKEN_MINUTES", 15)
    REFRESH_TOKEN_DAYS = _int("REFRESH_TOKEN_DAYS", 30)
    REFRESH_COOKIE_NAME = "sabi_refresh"
    REFRESH_COOKIE_PATH = "/api/auth"
    COOKIE_SECURE = _bool("COOKIE_SECURE", not DEBUG)
    REQUIRE_EMAIL_VERIFICATION = _bool("REQUIRE_EMAIL_VERIFICATION", True)
    EMAIL_VERIFICATION_HOURS = _int("EMAIL_VERIFICATION_HOURS", 48)
    PASSWORD_RESET_MINUTES = _int("PASSWORD_RESET_MINUTES", 60)
    ADMIN_BOOTSTRAP_EMAILS = [email.lower() for email in _list("ADMIN_BOOTSTRAP_EMAILS")]

    # Email delivery
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5176").strip().rstrip("/")
    EMAIL_PROVIDER = os.getenv("EMAIL_PROVIDER", "").strip().lower()
    RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
    EMAIL_FROM = os.getenv("EMAIL_FROM", "").strip()

    # Scheduled reminders
    CRON_SECRET = os.getenv("CRON_SECRET", "").strip()

    # --- Workout Together video (WebRTC). STUN is public; TURN relays for strict networks.
    # Metered (OpenRelay): https://www.metered.ca — app name + secret API key, kept server-side.
    METERED_TURN_APP = os.getenv("METERED_TURN_APP", "").strip()
    METERED_TURN_API_KEY = os.getenv("METERED_TURN_API_KEY", "").strip()
    # Or any static TURN server (comma-separated urls).
    TURN_URLS = [u.strip() for u in os.getenv("TURN_URLS", "").split(",") if u.strip()]
    TURN_USERNAME = os.getenv("TURN_USERNAME", "").strip()
    TURN_CREDENTIAL = os.getenv("TURN_CREDENTIAL", "").strip()
    REMINDER_SEND_WINDOW_MINUTES = _int("REMINDER_SEND_WINDOW_MINUTES", 180)

    @property
    def database_configured(self) -> bool:
        return bool(self.DATABASE_URL)

    @property
    def email_provider(self) -> str:
        if self.EMAIL_PROVIDER:
            return self.EMAIL_PROVIDER
        return "resend" if self.RESEND_API_KEY else "console"


settings = Settings()
