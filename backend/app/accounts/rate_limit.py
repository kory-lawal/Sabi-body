"""Sliding-window rate limiting for sensitive endpoints.

State is held in process memory. That is adequate for a single Render
instance; if the backend is scaled to several instances, each instance keeps
its own counters (limits become per-instance) and a shared store is needed.
"""
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

_lock = threading.Lock()
_hits: dict[str, deque[float]] = defaultdict(deque)


def client_ip(request: Request) -> str:
    # Vercel sets X-Forwarded-For to the real client address; Render appends to it.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


def hit(key: str, limit: int, window_seconds: int) -> bool:
    """Record a hit; return False when the key is over its limit."""
    now = time.monotonic()
    with _lock:
        bucket = _hits[key]
        while bucket and now - bucket[0] > window_seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        if len(_hits) > 50_000:
            for stale in [k for k, v in _hits.items() if not v or now - v[-1] > 3600][:10_000]:
                _hits.pop(stale, None)
        return True


def enforce(
    request: Request,
    scope: str,
    *,
    limit: int,
    window_seconds: int,
    identity: str | None = None,
    identity_limit: int | None = None,
) -> None:
    """`limit` applies per client IP; `identity_limit` (default: `limit`) per account/email.

    Keep per-IP limits generous: many mobile users share one carrier-NAT address.
    The per-identity limit is what stops guessing against a single account.
    """
    keys = [(f"{scope}:ip:{client_ip(request)}", limit)]
    if identity:
        keys.append((f"{scope}:id:{identity.lower()}", identity_limit or limit))
    for key, key_limit in keys:
        if not hit(key, key_limit, window_seconds):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"code": "rate_limited", "message": "Too many attempts. Please wait a few minutes and try again."},
                headers={"Retry-After": str(window_seconds)},
            )


def reset() -> None:
    with _lock:
        _hits.clear()
