"""Who is connected, and thread-safe delivery of events to their sockets."""
import asyncio
import logging
import time
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable

logger = logging.getLogger("sabibody.realtime")

QUEUE_LIMIT = 500


class Connection:
    def __init__(self, websocket, user_id: uuid.UUID, session_id: uuid.UUID, token_exp: float):
        self.id = uuid.uuid4()
        self.websocket = websocket
        self.user_id = user_id
        self.session_id = session_id
        self.token_exp = token_exp
        self.expiry_warned = False
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_LIMIT)
        self.last_seen = time.monotonic()
        self.rooms: set[uuid.UUID] = set()
        self.closed = False
        self._window_start = time.monotonic()
        self._window_count = 0

    def enqueue(self, payload: dict) -> None:
        if self.closed:
            return
        try:
            self.queue.put_nowait(payload)
        except asyncio.QueueFull:  # a stuck client must not grow memory without bound
            logger.warning("Dropping event for slow connection %s", self.id)

    def allow_message(self, limit: int = 120, window: float = 10.0) -> bool:
        now = time.monotonic()
        if now - self._window_start > window:
            self._window_start, self._window_count = now, 0
        self._window_count += 1
        return self._window_count <= limit


DisconnectHook = Callable[[Connection], Awaitable[None]]


class Registry:
    def __init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self.by_user: dict[uuid.UUID, set[Connection]] = defaultdict(set)
        self.disconnect_hooks: list[DisconnectHook] = []

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    def add(self, conn: Connection) -> bool:
        """Register a connection; True if this is the user's first open socket."""
        first = not self.by_user.get(conn.user_id)
        self.by_user[conn.user_id].add(conn)
        return first

    def remove(self, conn: Connection) -> bool:
        """Unregister; True if the user has no sockets left."""
        conn.closed = True
        conns = self.by_user.get(conn.user_id)
        if conns is not None:
            conns.discard(conn)
            if not conns:
                self.by_user.pop(conn.user_id, None)
                return True
        return False

    def is_online(self, user_id: uuid.UUID) -> bool:
        return bool(self.by_user.get(user_id))

    def connections(self, user_id: uuid.UUID) -> list[Connection]:
        return list(self.by_user.get(user_id, ()))

    # ------------------------------------------------------------ delivery
    def deliver(self, user_id: uuid.UUID, payload: dict) -> None:
        """Push to every socket of a user. Must be called on the event loop."""
        for conn in self.connections(user_id):
            conn.enqueue(payload)

    def publish(self, user_id: uuid.UUID, payload: dict) -> None:
        """Thread-safe: may be called from sync request handlers running in the threadpool."""
        loop = self.loop
        if loop is None or loop.is_closed():
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            self.deliver(user_id, payload)
        else:
            loop.call_soon_threadsafe(self.deliver, user_id, payload)

    def close_user_sessions(self, user_id: uuid.UUID, except_session: uuid.UUID | None = None) -> None:
        """Close a user's sockets (thread-safe), except the one tied to except_session."""
        loop = self.loop
        if loop is None or loop.is_closed():
            return

        def close() -> None:
            for conn in self.connections(user_id):
                if except_session is None or conn.session_id != except_session:
                    conn.enqueue({"type": "__close__", "code": 4401})

        loop.call_soon_threadsafe(close)

    def reset(self) -> None:  # tests
        self.by_user.clear()


registry = Registry()
