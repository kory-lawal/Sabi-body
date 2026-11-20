"""The /api/ws endpoint.

Protocol (JSON text frames): {"type": str, "id"?: str, "data"?: object}
1. The server checks Origin, accepts, and waits up to 10 s for
   {"type": "auth", "data": {"token": "<access token>"}}. The token is never
   put in the URL, so it can't end up in proxy logs.
2. It replies {"type": "ready", ...}. Client requests that carry an "id" get
   {"type": "ack", "ref": id, "ok": bool, "data"|"error": ...}.
3. The client pings every ~25 s; silent sockets are closed after 75 s.
4. Before the access token expires the server sends "auth.expiring"; the
   client answers with "auth.refresh" and a new token, or is closed (4401).
"""
import asyncio
import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from app.accounts.deps import authenticate_token, origin_allowed
from app.accounts.security import AccessTokenError, decode_access_token, utcnow
from app.db.session import new_session
from app.realtime.registry import Connection, registry
from app.social import notifications
from app.social.events import set_publisher

logger = logging.getLogger("sabibody.realtime")

router = APIRouter()

MAX_FRAME = 16 * 1024
AUTH_TIMEOUT = 10
IDLE_TIMEOUT = 75
RECEIVE_TICK = 20
EXPIRY_WARNING = 90  # seconds before exp
EXPIRY_GRACE = 60  # seconds after exp

Handler = Callable[[Connection, dict], Awaitable[dict | None]]
HANDLERS: dict[str, Handler] = {}

# Events from sync REST handlers reach sockets through the registry.
set_publisher(registry.publish)


def handler(message_type: str):
    def decorate(fn: Handler) -> Handler:
        HANDLERS[message_type] = fn
        return fn
    return decorate


class WsError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _authenticate(token: str):
    db = new_session()
    try:
        current = authenticate_token(db, token)
        exp = float(decode_access_token(token)["exp"])
        unread = notifications.unread_count(db, current.user.id)
        return current.user.id, current.session_id, exp, unread
    finally:
        db.close()


async def send(conn: Connection, payload: dict) -> None:
    conn.enqueue(payload)


async def _writer(conn: Connection) -> None:
    try:
        while True:
            payload = await conn.queue.get()
            if payload.get("type") == "__close__":
                await conn.websocket.close(code=payload.get("code", 4401))
                return
            await conn.websocket.send_text(json.dumps(payload, default=str))
    except (WebSocketDisconnect, RuntimeError, asyncio.CancelledError):
        return
    except Exception:  # noqa: BLE001 — a broken socket must not crash the server
        logger.exception("Socket writer failed")


async def _presence(user_id: uuid.UUID, online: bool) -> None:
    from app.social.friends import friend_ids  # avoid import cycle at module load

    def friends_of():
        db = new_session()
        try:
            return friend_ids(db, user_id)
        finally:
            db.close()

    try:
        for friend in await run_in_threadpool(friends_of):
            registry.deliver(friend, {"type": "presence.update", "data": {"user_id": str(user_id), "online": online}})
    except Exception:  # noqa: BLE001
        logger.exception("Presence broadcast failed")


async def _online_friends(user_id: uuid.UUID) -> list[str]:
    from app.social.friends import friend_ids

    def friends_of():
        db = new_session()
        try:
            return friend_ids(db, user_id)
        finally:
            db.close()

    try:
        return [str(f) for f in await run_in_threadpool(friends_of) if registry.is_online(f)]
    except Exception:  # noqa: BLE001
        return []


async def _handle(conn: Connection, message: dict) -> None:
    mtype = message.get("type")
    ref = message.get("id")
    data = message.get("data") if isinstance(message.get("data"), dict) else {}

    if mtype == "ping":
        conn.enqueue({"type": "pong", "data": {"server_time": utcnow().isoformat()}})
        return
    if mtype == "auth.refresh":
        try:
            user_id, session_id, exp, _ = await run_in_threadpool(_authenticate, str(data.get("token", "")))
        except (HTTPException, AccessTokenError, KeyError, ValueError):
            await conn.websocket.close(code=4401)
            return
        if user_id != conn.user_id:
            await conn.websocket.close(code=4401)
            return
        conn.session_id, conn.token_exp, conn.expiry_warned = session_id, exp, False
        if ref:
            conn.enqueue({"type": "ack", "ref": ref, "ok": True, "data": {}})
        return

    fn = HANDLERS.get(mtype)
    if fn is None:
        if ref:
            conn.enqueue({"type": "ack", "ref": ref, "ok": False,
                          "error": {"code": "unknown_type", "message": "Unknown message type."}})
        return
    heavy = mtype in ("room.progress", "rtc.ice")
    if not conn.allow_message(limit=400 if heavy else 120):
        if ref:
            conn.enqueue({"type": "ack", "ref": ref, "ok": False,
                          "error": {"code": "rate_limited", "message": "Slow down a little."}})
        return
    try:
        result = await fn(conn, data)
        if ref:
            conn.enqueue({"type": "ack", "ref": ref, "ok": True, "data": result or {}})
    except WsError as exc:
        if ref:
            conn.enqueue({"type": "ack", "ref": ref, "ok": False, "error": {"code": exc.code, "message": exc.message}})
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "error", "message": str(exc.detail)}
        if ref:
            conn.enqueue({"type": "ack", "ref": ref, "ok": False, "error": detail})
    except Exception:  # noqa: BLE001
        logger.exception("Handler %s failed", mtype)
        if ref:
            conn.enqueue({"type": "ack", "ref": ref, "ok": False,
                          "error": {"code": "server_error", "message": "Something went wrong."}})


async def _watchdog(conn: Connection) -> None:
    """Warns before the access token expires and closes expired or silent sockets.

    Runs beside the receive loop so receives are never cancelled mid-flight."""
    while not conn.closed:
        await asyncio.sleep(RECEIVE_TICK)
        now_wall = time.time()
        code = None
        if conn.token_exp + EXPIRY_GRACE < now_wall:
            code = 4401
        elif time.monotonic() - conn.last_seen > IDLE_TIMEOUT:
            code = 4408
        elif not conn.expiry_warned and conn.token_exp - EXPIRY_WARNING < now_wall:
            conn.expiry_warned = True
            conn.enqueue({"type": "auth.expiring", "data": {"expires_at": conn.token_exp}})
        if code:
            conn.enqueue({"type": "__close__", "code": code})
            return


@router.websocket("/ws")
async def realtime_socket(websocket: WebSocket) -> None:
    if not origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=4403)
        return
    await websocket.accept()
    registry.bind_loop(asyncio.get_running_loop())

    try:
        first = json.loads(await asyncio.wait_for(websocket.receive_text(), AUTH_TIMEOUT))
        if not isinstance(first, dict) or first.get("type") != "auth":
            raise ValueError("auth expected")
        token = str((first.get("data") or {}).get("token", ""))
        user_id, session_id, exp, unread = await run_in_threadpool(_authenticate, token)
    except (asyncio.TimeoutError, ValueError, KeyError, HTTPException, AccessTokenError, WebSocketDisconnect,
            json.JSONDecodeError):
        try:
            await websocket.close(code=4401)
        except RuntimeError:
            pass
        return

    conn = Connection(websocket, user_id, session_id, exp)
    first_socket = registry.add(conn)
    writer = asyncio.create_task(_writer(conn))
    conn.enqueue({"type": "ready", "data": {
        "user_id": str(user_id), "server_time": utcnow().isoformat(), "unread": unread,
        "online_friends": await _online_friends(user_id),
    }})
    if first_socket:
        await _presence(user_id, True)

    watchdog = asyncio.create_task(_watchdog(conn))
    try:
        while not conn.closed:
            raw = await websocket.receive_text()
            conn.last_seen = time.monotonic()
            if len(raw) > MAX_FRAME:
                conn.enqueue({"type": "error", "data": {"code": "frame_too_large"}})
                continue
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(message, dict):
                await _handle(conn, message)
    except WebSocketDisconnect:
        pass
    except RuntimeError:  # socket closed under us
        pass
    finally:
        last = registry.remove(conn)
        writer.cancel()
        watchdog.cancel()
        for hook in registry.disconnect_hooks:
            try:
                await hook(conn)
            except Exception:  # noqa: BLE001
                logger.exception("Disconnect hook failed")
        if last:
            await _presence(user_id, False)
