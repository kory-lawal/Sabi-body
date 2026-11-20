"""Workout Together rooms: presence, readiness, synchronized start, progress
relay, WebRTC signalling relay, reconnection grace and repeat rounds.

The database is the source of truth for *who may join* and for outcomes;
this module keeps only the live, per-process room state (who is connected,
who is ready, the latest progress numbers). After a server restart the room
is rebuilt when participants re-join.

Each participant's device runs its own MediaPipe tracking; the server only
relays small progress numbers. It never receives video, audio or frames.
"""
import asyncio
import time
import uuid
from dataclasses import dataclass, field
from datetime import timedelta

from starlette.concurrency import run_in_threadpool

from app.accounts.security import utcnow
from app.db.models import SharedSession, SharedSessionParticipant, User
from app.db.session import new_session
from app.realtime.registry import Connection, registry
from app.realtime.ws import WsError, handler
from app.social import sessions as session_svc
from app.social.common import other_user, public_user

COUNTDOWN_SECONDS = 3
RECONNECT_GRACE_SECONDS = 180
SIGNAL_TYPES = {"description", "candidate"}
CHEERS = {"clap", "fire", "strong", "go", "almost", "heart"}


@dataclass
class Member:
    user_id: uuid.UUID
    conns: set = field(default_factory=set)
    ready: bool = False
    progress: dict = field(default_factory=dict)
    media: dict = field(default_factory=lambda: {"cam": True, "mic": True})
    finished: bool = False
    left: bool = False
    disconnected_at: float | None = None


@dataclass
class Room:
    session_id: uuid.UUID
    users: tuple
    members: dict = field(default_factory=dict)
    phase: str = "waiting"  # waiting | countdown | active | summary
    starts_at: str | None = None
    round_proposal: dict | None = None

    def other(self, user_id: uuid.UUID) -> uuid.UUID:
        return self.users[1] if self.users[0] == user_id else self.users[0]


ROOMS: dict[uuid.UUID, Room] = {}


def _with_db(fn):
    db = new_session()
    try:
        return fn(db)
    finally:
        db.close()


def _member_out(room: Room, member: Member, profile: dict) -> dict:
    now = time.monotonic()
    deadline = None
    if member.disconnected_at is not None and not member.conns:
        deadline = max(0, int(RECONNECT_GRACE_SECONDS - (now - member.disconnected_at)))
    return {
        "user": profile,
        "connected": bool(member.conns),
        "ready": member.ready,
        "progress": member.progress,
        "media": member.media,
        "finished": member.finished,
        "left": member.left,
        "reconnect_seconds_left": deadline,
    }


def room_state(room: Room, profiles: dict) -> dict:
    return {
        "session_id": str(room.session_id),
        "phase": room.phase,
        "starts_at": room.starts_at,
        "round_proposal": room.round_proposal,
        "members": {str(uid): _member_out(room, room.members[uid], profiles.get(uid, {})) for uid in room.users
                    if uid in room.members},
    }


_profiles: dict[uuid.UUID, dict] = {}


async def _profiles_for(users) -> dict:
    missing = [u for u in users if u not in _profiles]
    if missing:
        def load(db):
            return {u.id: public_user(u) for u in db.query(User).filter(User.id.in_(missing))}
        _profiles.update(await run_in_threadpool(_with_db, load))
    return {u: _profiles.get(u, {}) for u in users}


async def broadcast(room: Room, payload: dict, exclude: uuid.UUID | None = None) -> None:
    for uid in room.users:
        if uid == exclude:
            continue
        member = room.members.get(uid)
        for conn in list(member.conns) if member else []:
            conn.enqueue(payload)


async def push_state(room: Room) -> None:
    await broadcast(room, {"type": "room.state", "data": room_state(room, await _profiles_for(room.users))})


def _uuid(value, code="room_forbidden") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise WsError(code, "That workout room doesn't exist.") from exc


def _room_for(conn: Connection, data: dict) -> Room:
    sid = _uuid(data.get("session_id"))
    room = ROOMS.get(sid)
    if room is None or sid not in conn.rooms or conn.user_id not in room.members:
        raise WsError("not_in_room", "Join the workout room first.")
    return room


@handler("room.join")
async def room_join(conn: Connection, data: dict) -> dict:
    sid = _uuid(data.get("session_id"))
    now = utcnow()

    def check(db):
        s = db.get(SharedSession, sid)
        if s is None or conn.user_id not in (s.user_low, s.user_high):
            raise WsError("room_forbidden", "You're not part of this workout.")
        part = db.get(SharedSessionParticipant, (sid, conn.user_id))
        if part is None or part.rsvp != "accepted":
            raise WsError("room_forbidden", "Accept the invitation before joining.")
        if s.status not in ("accepted", "live", "completed", "incomplete"):
            raise WsError("room_closed", "This workout is no longer available.")
        if s.status == "accepted" and not session_svc.can_join(s, now):
            start, _ = session_svc.join_window(s)
            if now < start:
                raise WsError("room_not_open", "The room opens 15 minutes before the start time.")
            raise WsError("room_closed", "This workout's time has passed.")
        part.joined_at = part.joined_at or now
        part.last_seen_at = now
        part.left_at = None
        db.commit()
        parts = session_svc.participants(db, sid)
        return {
            "session": session_svc.session_out(db, s, conn.user_id, parts),
            "users": (s.user_low, s.user_high),
            "status": s.status,
            "finished": {uid: p.finished_at is not None for uid, p in parts.items()},
        }

    info = await run_in_threadpool(_with_db, check)
    room = ROOMS.get(sid)
    if room is None:
        room = Room(session_id=sid, users=info["users"])
        if info["status"] in ("completed", "incomplete"):
            room.phase = "summary"
        elif info["status"] == "live":
            room.phase = "active"
        ROOMS[sid] = room
    for uid in room.users:
        room.members.setdefault(uid, Member(user_id=uid, finished=info["finished"].get(uid, False)))
    member = room.members[conn.user_id]
    was_connected = bool(member.conns)
    member.conns.add(conn)
    member.left = False
    member.disconnected_at = None
    conn.rooms.add(sid)

    partner = room.other(conn.user_id)
    if not was_connected:
        await broadcast(room, {"type": "room.peer", "data": {"user_id": str(conn.user_id), "connected": True,
                                                             "session_id": str(sid)}}, exclude=conn.user_id)
        # Let the partner know someone is waiting, even on pages other than the room.
        if not room.members[partner].conns:
            registry.deliver(partner, {"type": "room.waiting", "data": {
                "session_id": str(sid), "user": (await _profiles_for([conn.user_id]))[conn.user_id]}})
    await push_state(room)
    return {"session": info["session"], "state": room_state(room, await _profiles_for(room.users))}


async def _maybe_start(room: Room) -> None:
    if room.phase != "waiting":
        return
    members = [room.members[u] for u in room.users]
    if not all(m.ready and m.conns for m in members):
        return
    room.phase = "countdown"
    starts = utcnow() + timedelta(seconds=COUNTDOWN_SECONDS)
    room.starts_at = starts.isoformat()

    def mark_live(db):
        s = db.get(SharedSession, room.session_id)
        if s is not None and s.status == "accepted":
            s.status = "live"
            s.started_at = starts
            for p in session_svc.participants(db, s.id).values():
                p.ready_at = utcnow()
            db.commit()

    await run_in_threadpool(_with_db, mark_live)
    await broadcast(room, {"type": "room.start", "data": {"session_id": str(room.session_id),
                                                          "starts_at": room.starts_at}})
    room.phase = "active"
    await push_state(room)


@handler("room.ready")
async def room_ready(conn: Connection, data: dict) -> dict:
    room = _room_for(conn, data)
    member = room.members[conn.user_id]
    member.ready = bool(data.get("ready", True))
    await push_state(room)
    await _maybe_start(room)
    return {}


@handler("room.progress")
async def room_progress(conn: Connection, data: dict) -> dict:
    room = _room_for(conn, data)
    member = room.members[conn.user_id]
    progress = {}
    for key in ("count", "elapsed_ms", "target", "seq"):
        value = data.get(key)
        if isinstance(value, (int, float)) and 0 <= value <= 10_000_000:
            progress[key] = int(value)
    status = data.get("status")
    if status in ("waiting", "positioning", "running", "paused", "finished", "ended"):
        progress["status"] = status
    member.progress = progress
    if status == "finished":
        member.finished = True
    await broadcast(room, {"type": "room.progress", "data": {"session_id": str(room.session_id),
                                                             "user_id": str(conn.user_id), "progress": progress}},
                    exclude=conn.user_id)
    return {}


@handler("room.media")
async def room_media(conn: Connection, data: dict) -> dict:
    room = _room_for(conn, data)
    member = room.members[conn.user_id]
    member.media = {"cam": bool(data.get("cam", True)), "mic": bool(data.get("mic", True))}
    await broadcast(room, {"type": "room.media", "data": {"session_id": str(room.session_id),
                                                          "user_id": str(conn.user_id), "media": member.media}},
                    exclude=conn.user_id)
    return {}


@handler("room.cheer")
async def room_cheer(conn: Connection, data: dict) -> dict:
    room = _room_for(conn, data)
    cheer = data.get("cheer")
    if cheer not in CHEERS:
        raise WsError("invalid_cheer", "Unknown cheer.")
    await broadcast(room, {"type": "room.cheer", "data": {"session_id": str(room.session_id),
                                                          "user_id": str(conn.user_id), "cheer": cheer}},
                    exclude=conn.user_id)
    return {}


@handler("rtc.signal")
async def rtc_signal(conn: Connection, data: dict) -> dict:
    """Relay WebRTC offers/answers/ICE candidates to the other participant only."""
    room = _room_for(conn, data)
    payload = {k: data[k] for k in SIGNAL_TYPES if k in data}
    if not payload:
        raise WsError("invalid_signal", "Nothing to relay.")
    partner = room.members.get(room.other(conn.user_id))
    for target in list(partner.conns) if partner else []:
        target.enqueue({"type": "rtc.signal", "data": {"session_id": str(room.session_id),
                                                       "from": str(conn.user_id), **payload}})
    return {}


@handler("room.leave")
async def room_leave(conn: Connection, data: dict) -> dict:
    room = _room_for(conn, data)
    member = room.members[conn.user_id]
    member.conns.discard(conn)
    conn.rooms.discard(room.session_id)
    if not member.conns:
        member.left = True
        member.ready = False

        def mark(db):
            part = db.get(SharedSessionParticipant, (room.session_id, conn.user_id))
            if part is not None:
                part.left_at = utcnow()
                db.commit()

        await run_in_threadpool(_with_db, mark)
        await broadcast(room, {"type": "room.peer", "data": {"user_id": str(conn.user_id), "connected": False,
                                                             "left": True, "session_id": str(room.session_id)}})
    await push_state(room)
    _gc(room)
    return {}


@handler("room.round.propose")
async def round_propose(conn: Connection, data: dict) -> dict:
    room = _room_for(conn, data)
    exercise_id = str(data.get("exercise_id", ""))
    try:
        target = int(data.get("target"))
        session_svc.validate_target(exercise_id, target)
    except (TypeError, ValueError) as exc:
        raise WsError("invalid_target", "Choose an exercise and target.") from exc
    except Exception as exc:  # api_error from validate_target
        raise WsError("invalid_target", getattr(exc, "detail", {}).get("message", "Invalid target.")) from exc
    room.round_proposal = {"by": str(conn.user_id), "exercise_id": exercise_id, "target": target}
    await push_state(room)
    return {}


@handler("room.round.respond")
async def round_respond(conn: Connection, data: dict) -> dict:
    room = _room_for(conn, data)
    proposal = room.round_proposal
    if not proposal or proposal["by"] == str(conn.user_id):
        raise WsError("no_proposal", "There's no round waiting for your answer.")
    if not data.get("accept"):
        room.round_proposal = None
        await push_state(room)
        return {}

    def create_round(db):
        root = db.get(SharedSession, room.session_id)
        proposer = db.get(User, uuid.UUID(proposal["by"]))
        new = session_svc.create(db, proposer, other_user(root, proposer.id), proposal["exercise_id"],
                                 proposal["target"], "instant", None, None, root=root, auto_accept=True)
        db.commit()
        return new.id

    try:
        new_id = await run_in_threadpool(_with_db, create_round)
    except Exception as exc:  # e.g. friendship ended
        raise WsError("round_failed", "We couldn't start another round.") from exc
    room.round_proposal = None
    await broadcast(room, {"type": "room.round", "data": {"session_id": str(room.session_id),
                                                          "new_session_id": str(new_id)}})
    return {"new_session_id": str(new_id)}


async def summary_ready(session_id: uuid.UUID, summary_for: dict) -> None:
    """Called after both workouts of a shared session are saved."""
    room = ROOMS.get(session_id)
    if room is not None:
        room.phase = "summary"
    for uid, payload in summary_for.items():
        registry.deliver(uid, {"type": "room.summary", "data": payload})
    if room is not None:
        await push_state(room)


def _gc(room: Room) -> None:
    if all(not m.conns for m in room.members.values()):
        if all(m.left or m.finished for m in room.members.values()) or room.phase == "summary":
            ROOMS.pop(room.session_id, None)


async def _on_disconnect(conn: Connection) -> None:
    for sid in list(conn.rooms):
        room = ROOMS.get(sid)
        if room is None:
            continue
        member = room.members.get(conn.user_id)
        if member is None:
            continue
        member.conns.discard(conn)
        if member.conns:
            continue
        member.disconnected_at = time.monotonic()

        def mark(db, uid=conn.user_id):
            part = db.get(SharedSessionParticipant, (sid, uid))
            if part is not None:
                part.last_seen_at = utcnow()
                db.commit()

        await run_in_threadpool(_with_db, mark)
        await broadcast(room, {"type": "room.peer", "data": {"user_id": str(conn.user_id), "connected": False,
                                                             "reconnect_seconds": RECONNECT_GRACE_SECONDS,
                                                             "session_id": str(sid)}})
        await push_state(room)


registry.disconnect_hooks.append(_on_disconnect)


def reset_rooms() -> None:  # tests
    ROOMS.clear()
    _profiles.clear()


def schedule(coro) -> None:
    """Run a coroutine on the socket event loop from sync code (e.g. after a workout save)."""
    loop = registry.loop
    if loop is None or loop.is_closed():
        coro.close()  # nobody is connected to this process; nothing to push
        return
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is loop:
        loop.create_task(coro)
    else:
        asyncio.run_coroutine_threadsafe(coro, loop)
