"""Chat over the realtime socket: send, read receipts and typing indicators."""
import time
import uuid

from starlette.concurrency import run_in_threadpool

from app.db.models import User
from app.db.session import new_session
from app.realtime.registry import Connection, registry
from app.realtime.ws import WsError, handler
from app.social import chat
from app.social.common import are_friends, block_exists


def _friend_uuid(data: dict) -> uuid.UUID:
    try:
        return uuid.UUID(str(data.get("friend_id", "")))
    except ValueError as exc:
        raise WsError("not_found", "Unknown friend.") from exc


def _with_db(fn):
    db = new_session()
    try:
        return fn(db)
    finally:
        db.close()


@handler("chat.send")
async def chat_send(conn: Connection, data: dict) -> dict:
    friend_id = _friend_uuid(data)

    def work(db):
        me = db.get(User, conn.user_id)
        return chat.send(db, me, friend_id, str(data.get("kind", "text")), str(data.get("body", "")),
                         data.get("payload") if isinstance(data.get("payload"), dict) else {},
                         str(data.get("client_msg_id", "")))

    return await run_in_threadpool(_with_db, work)


@handler("chat.read")
async def chat_read(conn: Connection, data: dict) -> dict:
    friend_id = _friend_uuid(data)

    def work(db):
        return chat.mark_read(db, db.get(User, conn.user_id), friend_id)

    return await run_in_threadpool(_with_db, work)


_typing_seen: dict[tuple, float] = {}


@handler("chat.typing")
async def chat_typing(conn: Connection, data: dict) -> dict:
    friend_id = _friend_uuid(data)
    key = (conn.user_id, friend_id)
    now = time.monotonic()
    if now - _typing_seen.get(key, 0) < 2.5:  # at most one relay every 2.5 s
        return {}
    _typing_seen[key] = now
    allowed = await run_in_threadpool(
        _with_db, lambda db: are_friends(db, conn.user_id, friend_id) and not block_exists(db, conn.user_id, friend_id))
    if allowed:
        registry.deliver(friend_id, {"type": "chat.typing", "data": {"user_id": str(conn.user_id)}})
    return {}
