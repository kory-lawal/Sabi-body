"""Owner/administrator dashboard. Requires an admin_roles row for the caller;
roles can only be granted server-side (CLI or ADMIN_BOOTSTRAP_EMAILS)."""
from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.accounts.deps import CurrentUser, get_admin_user
from app.db.models import AdminAuditLog, User, WorkoutSession
from app.db.session import get_db
from app.routes.workouts import resolve_timezone

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/overview")
def overview(
    tz: str = Query("UTC", max_length=64),
    days: int = Query(30, ge=7, le=180),
    admin: CurrentUser = Depends(get_admin_user),
    db: Session = Depends(get_db),
) -> dict:
    zone = resolve_timezone(tz)
    today = datetime.now(zone).date()

    def local_start(day) -> datetime:
        return datetime.combine(day, time(0, 0), tzinfo=zone).astimezone(timezone.utc)

    def count_users_since(start: datetime) -> int:
        return int(db.scalar(select(func.count()).select_from(User).where(User.created_at >= start)) or 0)

    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    chart_start = today - timedelta(days=days - 1)
    created = db.scalars(select(User.created_at).where(User.created_at >= local_start(chart_start))).all()
    per_day = {chart_start + timedelta(days=i): 0 for i in range(days)}
    for value in created:
        value = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        local_day = value.astimezone(zone).date()
        if local_day in per_day:
            per_day[local_day] += 1
    total_users = int(db.scalar(select(func.count()).select_from(User)) or 0)
    before_chart = total_users - sum(per_day.values())
    running = before_chart
    growth = []
    for day, count in per_day.items():
        running += count
        growth.append({"date": day.isoformat(), "new_users": count, "total_users": running})

    recent = db.scalars(select(User).order_by(User.created_at.desc()).limit(10)).all()
    db.add(AdminAuditLog(actor_user_id=admin.user.id, action="admin_overview_viewed", details={"days": days}))
    db.commit()
    return {
        "total_users": total_users,
        "verified_users": int(db.scalar(select(func.count()).select_from(User).where(User.email_verified.is_(True))) or 0),
        "new_today": count_users_since(local_start(today)),
        "new_this_week": count_users_since(local_start(week_start)),
        "new_this_month": count_users_since(local_start(month_start)),
        "total_completed_workouts": int(db.scalar(
            select(func.count()).select_from(WorkoutSession).where(WorkoutSession.completed.is_(True))
        ) or 0),
        "growth": growth,
        "recent_users": [
            {
                "full_name": user.full_name,
                "email": user.email,
                "email_verified": user.email_verified,
                "created_at": user.created_at.isoformat(),
            }
            for user in recent
        ],
        "timezone": zone.key,
    }
