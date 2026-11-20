"""Shared fixtures for SabiBody Buddies API tests (real PostgreSQL, real Alembic migrations)."""
import os
import re
import unittest
import uuid
from datetime import datetime, timedelta, timezone

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "")

if TEST_DATABASE_URL:
    from alembic import command
    from alembic.config import Config
    from fastapi.testclient import TestClient
    from sqlalchemy import text

    from app.accounts import emails, rate_limit
    from app.config import normalize_database_url
    from app.db import session as db_session
    from app.db.models import Base
    from app.main import app

PASSWORD = "Strong-pass-2026"
_migrated = False


def _migrate_once() -> None:
    global _migrated
    if _migrated:
        return
    url = normalize_database_url(TEST_DATABASE_URL)
    db_session.configure(url)
    with db_session.get_engine().begin() as conn:
        conn.execute(text("drop schema public cascade; create schema public;"))
    here = os.path.dirname(__file__)
    config = Config(os.path.join(here, "..", "alembic.ini"))
    config.set_main_option("script_location", os.path.join(here, "..", "migrations"))
    config.attributes["database_url"] = url
    command.upgrade(config, "head")
    _migrated = True


@unittest.skipUnless(TEST_DATABASE_URL, "TEST_DATABASE_URL is not set")
class BuddiesTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _migrate_once()

    def setUp(self):
        tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
        with db_session.get_engine().begin() as conn:
            conn.execute(text(f"truncate {tables} cascade"))
        rate_limit.reset()
        emails.console_outbox.clear()
        self.client = TestClient(app)

    # ------------------------------------------------------------------ helpers
    def db(self):
        return db_session.new_session()

    def last_token(self, route: str) -> str:
        for message in reversed(emails.console_outbox):
            match = re.search(rf"#/{route}\?token=([A-Za-z0-9_-]+)", message.text)
            if match:
                return match.group(1)
        self.fail(f"No {route} email was sent")

    def make_user(self, email: str, name: str = "Test User") -> dict:
        """Register, verify and log in a user on its own client; returns token, headers, user."""
        client = TestClient(app)
        response = client.post("/api/auth/register", json={"full_name": name, "email": email, "password": PASSWORD})
        self.assertEqual(response.status_code, 201, response.text)
        verify = client.post("/api/auth/verify-email", json={"token": self.last_token("verify-email")})
        self.assertEqual(verify.status_code, 200, verify.text)
        login = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        self.assertEqual(login.status_code, 200, login.text)
        body = login.json()
        return {"client": client, "token": body["access_token"], "user": body["user"],
                "h": {"Authorization": f"Bearer {body['access_token']}"}}

    def befriend(self, a: dict, b: dict) -> None:
        sent = self.client.post("/api/friends/requests", json={"username": b["user"]["username"]}, headers=a["h"])
        self.assertEqual(sent.status_code, 201, sent.text)
        accepted = self.client.post(f"/api/friends/requests/{sent.json()['request_id']}/accept", headers=b["h"])
        self.assertEqual(accepted.status_code, 200, accepted.text)

    def workout_body(self, **overrides) -> dict:
        now = datetime.now(timezone.utc)
        body = {
            "idempotency_key": uuid.uuid4().hex,
            "exercise_id": "push-ups",
            "completed": True,
            "completed_reps": 20,
            "target_reps": 20,
            "duration_seconds": 60,
            "started_at": (now - timedelta(minutes=2)).isoformat(),
            "completed_at": now.isoformat(),
        }
        body.update(overrides)
        return body
