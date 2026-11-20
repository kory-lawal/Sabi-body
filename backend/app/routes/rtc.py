"""ICE servers for Workout Together video.

STUN lets most home networks connect peer-to-peer. Strict networks (many
mobile carriers, offices) need a TURN relay. TURN credentials are fetched
server-side so the provider's secret key never reaches the browser.
"""
import logging
import time

import httpx
from fastapi import APIRouter, Depends, Request

from app.accounts import rate_limit
from app.accounts.deps import CurrentUser, get_current_user
from app.config import settings
from app.db.models import SharedSession
from app.db.session import get_db
from app.social.common import parse_uuid
from app.social.shared_workouts import summary as shared_summary
from app.social import sessions as session_svc

logger = logging.getLogger("sabibody.rtc")

router = APIRouter(tags=["workout together"])

STUN = [{"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}]
_cache: dict = {"servers": None, "expires": 0.0}
CACHE_SECONDS = 1800


def _metered_servers() -> list[dict]:
    now = time.time()
    if _cache["servers"] is not None and _cache["expires"] > now:
        return _cache["servers"]
    url = f"https://{settings.METERED_TURN_APP}.metered.live/api/v1/turn/credentials"
    response = httpx.get(url, params={"apiKey": settings.METERED_TURN_API_KEY}, timeout=8)
    response.raise_for_status()
    servers = [s for s in response.json() if isinstance(s, dict) and s.get("urls")]
    _cache.update(servers=servers, expires=now + CACHE_SECONDS)
    return servers


def ice_servers() -> tuple[list[dict], str]:
    servers = list(STUN)
    relay = "none"
    if settings.METERED_TURN_APP and settings.METERED_TURN_API_KEY:
        try:
            servers += [s for s in _metered_servers() if not str(s.get("urls", "")).startswith("stun:")]
            relay = "metered"
        except (httpx.HTTPError, ValueError) as exc:
            logger.error("Could not fetch TURN credentials: %s", exc)
            relay = "unavailable"
    elif settings.TURN_URLS:
        servers.append({"urls": settings.TURN_URLS, "username": settings.TURN_USERNAME,
                        "credential": settings.TURN_CREDENTIAL})
        relay = "static"
    return servers, relay


@router.get("/rtc/ice-servers")
def get_ice_servers(request: Request, current: CurrentUser = Depends(get_current_user)) -> dict:
    rate_limit.enforce(request, "ice", limit=120, window_seconds=600, identity=str(current.user.id), identity_limit=30)
    servers, relay = ice_servers()
    return {"ice_servers": servers, "relay": relay}


@router.get("/shared-sessions/{session_id}/summary")
def get_summary(session_id: str, current: CurrentUser = Depends(get_current_user), db=Depends(get_db)) -> dict:
    s = session_svc.get_for(db, parse_uuid(session_id, "session_not_found", "We couldn't find that workout."),
                            current.user.id)
    return shared_summary(db, s, current.user.id)
