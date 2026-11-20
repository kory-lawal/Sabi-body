"""The SabiBody Buddies dashboard: one call with everything the hub needs."""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.accounts.deps import CurrentUser, get_current_user
from app.accounts.security import utcnow
from app.db.models import SharedSession, User, WorkoutSession
from app.db.session import get_db
from app.realtime.registry import registry
from app.routes.workouts import EXERCISES
from app.social import challenges, chat, friends, notifications, sessions, streaks
from app.social.common import pair, public_user

router = APIRouter(prefix="/buddies", tags=["buddies"])


@router.get("/dashboard")
def dashboard(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    me = current.user.id
    now = utcnow()
    overview = friends.overview(db, me)
    friend_ids = [f["id"] for f in overview["friends"]]

    friend_rows = []
    for f in overview["friends"]:
        fid = uuid.UUID(f["id"])
        low, high = pair(me, fid)
        friend_rows.append({**f, "online": registry.is_online(fid),
                            "streak": streaks.for_pair(db, low, high)["buddy"]})
    friend_rows.sort(key=lambda f: (not f["online"], -f["streak"]["current"], f["display_name"].lower()))

    upcoming = sessions.list_for(db, me, "upcoming", None, None)[:5]
    pending = sessions.list_for(db, me, "pending", None, None)
    recent = db.scalars(
        select(SharedSession)
        .where(or_(SharedSession.user_low == me, SharedSession.user_high == me),
               SharedSession.status.in_(("completed", "incomplete")))
        .order_by(SharedSession.ended_at.desc().nulls_last()).limit(5)
    ).all()

    # Friends' recent public activity: what they did and when — never their full history.
    activity = []
    if friend_ids:
        rows = db.execute(
            select(WorkoutSession.user_id, WorkoutSession.exercise_id, WorkoutSession.completed_at)
            .where(WorkoutSession.user_id.in_(friend_ids), WorkoutSession.completed.is_(True),
                   WorkoutSession.completed_at > now - timedelta(days=7))
            .order_by(WorkoutSession.completed_at.desc()).limit(10)
        ).all()
        people = {u.id: u for u in db.scalars(select(User).where(User.id.in_({r[0] for r in rows})))} if rows else {}
        for user_id, exercise_id, completed_at in rows:
            person = people.get(user_id)
            if person is None:
                continue
            activity.append({
                "user": public_user(person),
                "exercise_id": exercise_id,
                "exercise_name": EXERCISES.get(exercise_id, (exercise_id,))[0],
                "completed_at": completed_at.isoformat(),
            })

    challenge_lists = challenges.list_for(db, me)
    return {
        "friends": friend_rows,
        "requests": {"incoming": overview["incoming"], "sent_count": len(overview["sent"])},
        "invitations": [sessions.session_out(db, s, me) for s in pending if s.awaiting_user_id == me],
        "sent_invitations": [sessions.session_out(db, s, me) for s in pending if s.awaiting_user_id != me],
        "upcoming": [sessions.session_out(db, s, me) for s in upcoming],
        "recent": [sessions.session_out(db, s, me) for s in recent],
        "challenges": {"received": [c for c in challenge_lists["pending"] if c["awaiting_me"]],
                       "active": challenge_lists["active"]},
        "activity": activity,
        "unread": {"messages": chat.total_unread(db, me), "notifications": notifications.unread_count(db, me)},
    }
