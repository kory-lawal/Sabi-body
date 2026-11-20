"""Realtime events queued inside a DB transaction and delivered only after commit.

Services call queue_event(db, user_id, event). Nothing is pushed if the
transaction rolls back, so clients never see an event for data that was not saved.
The publisher is installed by app.realtime at startup; until then (and in
scripts/tests without a socket server) events are simply dropped after commit.
"""
import logging
import uuid
from collections.abc import Callable

from sqlalchemy import event
from sqlalchemy.orm import Session

logger = logging.getLogger("sabibody.events")

_PENDING_KEY = "sabibody_pending_events"
_publisher: Callable[[uuid.UUID, dict], None] | None = None


def set_publisher(publisher: Callable[[uuid.UUID, dict], None] | None) -> None:
    global _publisher
    _publisher = publisher


def queue_event(db: Session, user_id: uuid.UUID, event_type: str, data: dict) -> None:
    db.info.setdefault(_PENDING_KEY, []).append((user_id, {"type": event_type, "data": data}))


@event.listens_for(Session, "after_commit")
def _flush_events(session: Session) -> None:
    pending = session.info.pop(_PENDING_KEY, [])
    if not pending or _publisher is None:
        return
    for user_id, payload in pending:
        try:
            _publisher(user_id, payload)
        except Exception:  # delivery is best effort; the DB row is the durable record
            logger.exception("Failed to publish %s", payload.get("type"))


@event.listens_for(Session, "after_rollback")
def _drop_events(session: Session) -> None:
    session.info.pop(_PENDING_KEY, None)
