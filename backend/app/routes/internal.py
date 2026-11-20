"""Server-to-server endpoints (scheduler). Not for browsers."""
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.accounts.deps import api_error
from app.accounts.security import tokens_match
from app.config import settings
from app.db.session import get_db
from app.jobs.buddy_jobs import run_buddy_jobs
from app.jobs.reminders import run_reminders

router = APIRouter(prefix="/internal", include_in_schema=False)


def _require_cron_secret(request: Request) -> None:
    if not settings.CRON_SECRET:
        raise api_error(status.HTTP_503_SERVICE_UNAVAILABLE, "cron_unconfigured", "CRON_SECRET is not configured.")
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not tokens_match(token.strip(), settings.CRON_SECRET):
        raise api_error(status.HTTP_401_UNAUTHORIZED, "unauthorized", "Unauthorized.")


@router.post("/reminders/run", dependencies=[Depends(_require_cron_secret)])
def trigger_reminders(db: Session = Depends(get_db)) -> dict:
    stats = run_reminders(db)
    # The same cron call also runs the Buddies jobs (shared-workout reminders, expiry, streaks).
    stats["buddies"] = run_buddy_jobs(db)
    return stats
