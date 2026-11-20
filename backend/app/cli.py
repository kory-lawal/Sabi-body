"""Trusted server-side administration commands.

Usage (from the backend directory, with DATABASE_URL set):
    python -m app.cli grant-admin you@example.com
    python -m app.cli revoke-admin you@example.com
    python -m app.cli check-db
"""
import argparse
import sys

from sqlalchemy import inspect, select, text

from app.db.models import AdminAuditLog, AdminRole, Base, User
from app.db.session import get_engine, new_session


def grant_admin(email: str) -> int:
    db = new_session()
    try:
        user = db.scalar(select(User).where(User.email == email.lower()))
        if user is None:
            print(f"No user with email {email}. Register the account first.")
            return 1
        if db.scalar(select(AdminRole).where(AdminRole.user_id == user.id)):
            print("User is already an admin.")
            return 0
        db.add(AdminRole(user_id=user.id, role="admin", granted_via="cli"))
        db.add(AdminAuditLog(actor_user_id=None, action="admin_granted", details={"via": "cli", "user_id": str(user.id)}))
        db.commit()
        print(f"Granted admin to {user.email}.")
        return 0
    finally:
        db.close()


def revoke_admin(email: str) -> int:
    db = new_session()
    try:
        user = db.scalar(select(User).where(User.email == email.lower()))
        role = db.scalar(select(AdminRole).where(AdminRole.user_id == user.id)) if user else None
        if role is None:
            print("User is not an admin.")
            return 1
        db.delete(role)
        db.add(AdminAuditLog(actor_user_id=None, action="admin_revoked", details={"via": "cli", "user_id": str(user.id)}))
        db.commit()
        print(f"Revoked admin from {user.email}.")
        return 0
    finally:
        db.close()


def check_db() -> int:
    engine = get_engine()
    if engine is None:
        print("DATABASE_URL is not set.")
        return 1
    with engine.connect() as conn:
        version = conn.execute(text("select version()")).scalar()
        revision = conn.execute(text("select version_num from alembic_version")).scalar() if inspect(conn).has_table("alembic_version") else None
        existing = set(inspect(conn).get_table_names())
    expected = set(Base.metadata.tables)
    print(f"Connected: {version.split(',')[0]}")
    print(f"Alembic revision: {revision or 'none'}")
    for name in sorted(expected):
        print(f"  {'OK     ' if name in existing else 'MISSING'} {name}")
    return 0 if expected <= existing else 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("grant-admin", "revoke-admin"):
        sub.add_parser(name).add_argument("email")
    sub.add_parser("check-db")
    args = parser.parse_args(argv)
    if args.command == "grant-admin":
        return grant_admin(args.email)
    if args.command == "revoke-admin":
        return revoke_admin(args.email)
    return check_db()


if __name__ == "__main__":
    sys.exit(main())
