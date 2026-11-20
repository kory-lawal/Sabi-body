"""End-to-end API tests against a real PostgreSQL database.

Set TEST_DATABASE_URL to an empty, disposable database, e.g. one created with
`pgserver` (see README). The schema is created with the real Alembic migration.
These tests are skipped when TEST_DATABASE_URL is not set.
"""
import os
import re
import unittest
import uuid
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "")

if TEST_DATABASE_URL:
    from alembic import command
    from alembic.config import Config
    from fastapi.testclient import TestClient
    from sqlalchemy import select, text, update

    from app.accounts import emails, rate_limit
    from app.config import normalize_database_url
    from app.db import session as db_session
    from app.db.models import (
        AdminAuditLog,
        RefreshSession,
        ReminderDeliveryLog,
        ReminderPreference,
        User,
        WorkoutSession,
    )
    from app.jobs.reminders import run_reminders
    from app.main import app

PASSWORD = "Strong-pass-2026"


@unittest.skipUnless(TEST_DATABASE_URL, "TEST_DATABASE_URL is not set")
class AccountsApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        url = normalize_database_url(TEST_DATABASE_URL)
        db_session.configure(url)
        engine = db_session.get_engine()
        with engine.begin() as conn:
            conn.execute(text("drop schema public cascade; create schema public;"))
        config = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
        config.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "migrations"))
        config.attributes["database_url"] = url
        command.upgrade(config, "head")

    def setUp(self):
        with db_session.get_engine().begin() as conn:
            conn.execute(text(
                "truncate users, workout_sessions, reminder_preferences, email_verification_tokens, "
                "password_reset_tokens, refresh_sessions, reminder_delivery_logs, admin_roles, "
                "admin_audit_logs cascade"
            ))
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

    def register(self, email="ada@example.com", name="Ada Obi", password=PASSWORD, client=None):
        client = client or self.client
        return client.post("/api/auth/register", json={"full_name": name, "email": email, "password": password})

    def verified_login(self, email="ada@example.com", name="Ada Obi", client=None):
        client = client or self.client
        self.assertEqual(self.register(email, name, client=client).status_code, 201)
        self.assertEqual(client.post("/api/auth/verify-email", json={"token": self.last_token("verify-email")}).status_code, 200)
        response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["access_token"]

    @staticmethod
    def auth(token):
        return {"Authorization": f"Bearer {token}"}

    def workout(self, token, **overrides):
        now = datetime.now(timezone.utc)
        body = {
            "idempotency_key": uuid.uuid4().hex,
            "exercise_id": "squats",
            "completed": True,
            "completed_reps": 10,
            "target_reps": 10,
            "duration_seconds": 95,
            "started_at": (now - timedelta(minutes=2)).isoformat(),
            "completed_at": now.isoformat(),
        }
        body.update(overrides)
        return self.client.post("/api/workouts", json=body, headers=self.auth(token))

    # ------------------------------------------------------------------ registration
    def test_registration_hashes_password_creates_profile_and_blocks_duplicates(self):
        response = self.register()
        self.assertEqual(response.status_code, 201, response.text)
        self.assertTrue(response.json()["email_verification_required"])
        self.assertEqual(self.register(email="ADA@example.com").status_code, 409)
        with self.db() as db:
            users = db.scalars(select(User)).all()
            self.assertEqual(len(users), 1)
            self.assertTrue(users[0].password_hash.startswith("$argon2id$"))
            self.assertNotIn(PASSWORD, users[0].password_hash)
            self.assertEqual(db.scalar(select(ReminderPreference.user_id)), users[0].id)
        self.assertEqual(emails.console_outbox[-1].subject, "Confirm your SabiBody email")

    def test_registration_rejects_weak_passwords_and_bad_input(self):
        self.assertEqual(self.register(password="short1").status_code, 422)
        self.assertEqual(self.register(password="onlyletterslong").status_code, 422)
        self.assertEqual(self.register(email="not-an-email").status_code, 422)
        self.assertEqual(self.register(name="   ").status_code, 422)
        extra = self.client.post("/api/auth/register", json={
            "full_name": "Eve", "email": "eve@example.com", "password": PASSWORD, "is_admin": True})
        self.assertEqual(extra.status_code, 422)

    # ------------------------------------------------------------------ verification and login
    def test_unverified_users_cannot_log_in_and_verification_links_are_single_use(self):
        self.register()
        login = self.client.post("/api/auth/login", json={"email": "ada@example.com", "password": PASSWORD})
        self.assertEqual(login.status_code, 403)
        self.assertEqual(login.json()["detail"]["code"], "email_not_verified")
        token = self.last_token("verify-email")
        self.assertEqual(self.client.post("/api/auth/verify-email", json={"token": token}).status_code, 200)
        self.assertEqual(self.client.post("/api/auth/verify-email", json={"token": token}).status_code, 400)
        bad = self.client.post("/api/auth/login", json={"email": "ada@example.com", "password": "Wrong-pass-2026"})
        self.assertEqual(bad.status_code, 401)
        self.assertEqual(bad.json()["detail"]["code"], "invalid_credentials")
        unknown = self.client.post("/api/auth/login", json={"email": "nobody@example.com", "password": PASSWORD})
        self.assertEqual(unknown.status_code, 401)

    def test_login_sets_httponly_refresh_cookie_and_never_returns_secrets(self):
        token = self.verified_login()
        cookie = [c for c in self.client.cookies.jar if c.name == "sabi_refresh"][0]
        self.assertEqual(cookie.path, "/api/auth")
        self.assertTrue(cookie.has_nonstandard_attr("HttpOnly"))
        me = self.client.get("/api/account/me", headers=self.auth(token))
        self.assertEqual(me.status_code, 200)
        body = me.json()
        self.assertEqual(body["full_name"], "Ada Obi")
        self.assertFalse(body["is_admin"])
        self.assertNotIn("password_hash", me.text)
        with self.db() as db:
            stored = db.scalar(select(RefreshSession.token_hash))
        self.assertNotEqual(stored, cookie.value)
        self.assertEqual(len(stored), 64)

    def test_protected_endpoints_reject_missing_and_tampered_tokens(self):
        token = self.verified_login()
        for path in ("/api/account/me", "/api/workouts", "/api/workouts/summary", "/api/reminders", "/api/admin/overview"):
            self.assertEqual(self.client.get(path).status_code, 401, path)
        tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
        self.assertEqual(self.client.get("/api/account/me", headers=self.auth(tampered)).status_code, 401)

    # ------------------------------------------------------------------ persistent sessions
    def test_refresh_restores_session_rotates_token_and_detects_reuse(self):
        self.verified_login()
        old_cookie = self.client.cookies.get("sabi_refresh")
        restored = self.client.post("/api/auth/refresh")
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(restored.json()["user"]["email"], "ada@example.com")
        new_cookie = self.client.cookies.get("sabi_refresh")
        self.assertNotEqual(old_cookie, new_cookie)

        # A replay inside the grace window is a benign multi-tab race.
        replay = TestClient(app)
        replay.cookies.set("sabi_refresh", old_cookie, path="/api/auth")
        self.assertEqual(replay.post("/api/auth/refresh").status_code, 409)

        # Outside the grace window the replay is treated as theft: every session is revoked.
        with self.db() as db:
            db.execute(update(RefreshSession).where(RefreshSession.revoked_reason == "rotated")
                       .values(revoked_at=datetime.now(timezone.utc) - timedelta(minutes=5)))
            db.commit()
        self.assertEqual(replay.post("/api/auth/refresh").status_code, 401)
        self.assertEqual(self.client.post("/api/auth/refresh").status_code, 401)

    def test_expired_access_token_is_rejected_and_refresh_issues_a_new_one(self):
        import jwt as pyjwt

        from app.accounts.security import ACCESS_TOKEN_AUDIENCE, ACCESS_TOKEN_ISSUER, auth_secret

        token = self.verified_login()
        claims = pyjwt.decode(token, auth_secret(), algorithms=["HS256"], audience=ACCESS_TOKEN_AUDIENCE)
        claims["exp"] = int((datetime.now(timezone.utc) - timedelta(minutes=1)).timestamp())
        claims["iss"] = ACCESS_TOKEN_ISSUER
        expired = pyjwt.encode(claims, auth_secret(), algorithm="HS256")
        response = self.client.get("/api/account/me", headers=self.auth(expired))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"]["code"], "token_expired")
        fresh = self.client.post("/api/auth/refresh").json()["access_token"]
        self.assertEqual(self.client.get("/api/account/me", headers=self.auth(fresh)).status_code, 200)

    def test_logout_revokes_session_and_access_token(self):
        token = self.verified_login()
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 200)
        self.assertEqual(self.client.get("/api/account/me", headers=self.auth(token)).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/refresh").status_code, 401)

    def test_refresh_rejects_untrusted_origin(self):
        self.verified_login()
        response = self.client.post("/api/auth/refresh", headers={"Origin": "https://evil.example"})
        self.assertEqual(response.status_code, 403)

    def test_login_is_rate_limited(self):
        self.register()
        codes = [self.client.post("/api/auth/login", json={"email": "ada@example.com", "password": "Wrong-pass-2026"}).status_code
                 for _ in range(11)]
        self.assertEqual(codes[-1], 429)

    # ------------------------------------------------------------------ password recovery
    def test_password_reset_is_single_use_expiring_and_revokes_sessions(self):
        token = self.verified_login()
        generic = self.client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
        self.assertEqual(generic.status_code, 202)
        self.client.post("/api/auth/forgot-password", json={"email": "ada@example.com"})
        reset_token = self.last_token("reset-password")
        new_password = "Brand-new-pass-77"
        ok = self.client.post("/api/auth/reset-password", json={"token": reset_token, "password": new_password})
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertEqual(self.client.post("/api/auth/reset-password", json={"token": reset_token, "password": "Another-pass-88"}).status_code, 400)
        self.assertEqual(self.client.get("/api/account/me", headers=self.auth(token)).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json={"email": "ada@example.com", "password": new_password}).status_code, 200)

        self.client.post("/api/auth/forgot-password", json={"email": "ada@example.com"})
        expiring = self.last_token("reset-password")
        with self.db() as db:
            db.execute(text("update password_reset_tokens set expires_at = now() - interval '1 minute' where used_at is null"))
            db.commit()
        self.assertEqual(self.client.post("/api/auth/reset-password", json={"token": expiring, "password": "Another-pass-88"}).status_code, 400)

    def test_change_password_and_email_change_with_verification(self):
        token = self.verified_login()
        other_device = TestClient(app)
        other_token = other_device.post("/api/auth/login", json={"email": "ada@example.com", "password": PASSWORD}).json()["access_token"]
        wrong = self.client.post("/api/account/password", headers=self.auth(token),
                                 json={"current_password": "nope-nope-1", "new_password": "Brand-new-pass-77"})
        self.assertEqual(wrong.status_code, 400)
        changed = self.client.post("/api/account/password", headers=self.auth(token),
                                   json={"current_password": PASSWORD, "new_password": "Brand-new-pass-77"})
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(self.client.get("/api/account/me", headers=self.auth(token)).status_code, 200)
        self.assertEqual(other_device.get("/api/account/me", headers=self.auth(other_token)).status_code, 401)

        request = self.client.post("/api/account/email", headers=self.auth(token),
                                   json={"new_email": "ada.new@example.com", "password": "Brand-new-pass-77"})
        self.assertEqual(request.status_code, 202, request.text)
        self.assertEqual(emails.console_outbox[-1].to, "ada.new@example.com")
        self.assertEqual(self.client.get("/api/account/me", headers=self.auth(token)).json()["email"], "ada@example.com")
        confirm = self.client.post("/api/auth/verify-email", json={"token": self.last_token("verify-email")})
        self.assertEqual(confirm.json()["email"], "ada.new@example.com")
        self.assertEqual(self.client.get("/api/account/me", headers=self.auth(token)).json()["email"], "ada.new@example.com")

    def test_profile_name_edit_cannot_change_id_or_role(self):
        token = self.verified_login()
        ok = self.client.patch("/api/account/me", headers=self.auth(token), json={"full_name": "  Ada   Okafor "})
        self.assertEqual(ok.json()["full_name"], "Ada Okafor")
        for field in ({"id": str(uuid.uuid4())}, {"is_admin": True}, {"email": "x@example.com"}):
            response = self.client.patch("/api/account/me", headers=self.auth(token), json={"full_name": "Ada", **field})
            self.assertEqual(response.status_code, 422, field)

    # ------------------------------------------------------------------ workouts
    def test_workouts_are_validated_idempotent_and_private(self):
        token = self.verified_login()
        key = uuid.uuid4().hex
        first = self.workout(token, idempotency_key=key)
        self.assertEqual(first.status_code, 201, first.text)
        self.assertFalse(first.json()["duplicate"])
        again = self.workout(token, idempotency_key=key, completed_reps=99)
        self.assertTrue(again.json()["duplicate"])
        self.assertEqual(again.json()["workout"]["completed_reps"], 10)

        self.assertEqual(self.workout(token, completed_reps=4).status_code, 422)  # claims complete, target missed
        partial = self.workout(token, completed=False, completed_reps=4, completed_at=None)
        self.assertEqual(partial.status_code, 201)
        self.assertFalse(partial.json()["workout"]["completed"])
        self.assertEqual(self.workout(token, exercise_id="burpees").status_code, 422)
        plank = self.workout(token, exercise_id="plank", completed_reps=None, target_reps=None,
                             target_duration_seconds=30, duration_seconds=31)
        self.assertEqual(plank.status_code, 201, plank.text)
        self.assertEqual(plank.json()["workout"]["exercise_type"], "duration")
        self.assertIsNone(plank.json()["workout"]["completed_reps"])
        short_plank = self.workout(token, exercise_id="plank", target_duration_seconds=30, duration_seconds=12)
        self.assertEqual(short_plank.status_code, 422)

        with self.db() as db:
            self.assertEqual(db.scalar(select(text("count(*)")).select_from(WorkoutSession)), 3)

        # Another user sees none of Ada's workouts.
        other = TestClient(app)
        other_token = self.verified_login("ben@example.com", "Ben", client=other)
        listing = other.get("/api/workouts", headers=self.auth(other_token)).json()
        self.assertEqual(listing["total"], 0)
        self.assertEqual(other.get("/api/workouts/summary", headers=self.auth(other_token)).json()["total_workouts"], 0)

    def test_dashboard_summary_and_history_use_real_records(self):
        token = self.verified_login()
        self.workout(token)  # 10 reps, 95 s, completed
        self.workout(token, exercise_id="lunges", completed_reps=12, target_reps=12, duration_seconds=65)
        self.workout(token, completed=False, completed_reps=3, duration_seconds=20, completed_at=None)
        summary = self.client.get("/api/workouts/summary", params={"tz": "Africa/Lagos"}, headers=self.auth(token)).json()
        self.assertEqual(summary["total_workouts"], 2)
        self.assertEqual(summary["total_attempts"], 3)
        self.assertEqual(summary["total_reps"], 25)
        self.assertEqual(summary["total_duration_seconds"], 180)
        self.assertEqual(summary["average_duration_seconds"], 80)
        self.assertEqual(summary["workouts_this_week"], 2)
        self.assertEqual(summary["streak_days"], 1)
        self.assertEqual(sum(day["workouts"] for day in summary["week"]["days"]), 2)
        self.assertEqual(len(summary["recent"]), 3)
        previous = self.client.get("/api/workouts/summary", params={"tz": "Africa/Lagos", "week_offset": -1},
                                   headers=self.auth(token)).json()
        self.assertEqual(previous["week"]["workouts"], 0)
        self.assertEqual(previous["week"]["offset"], -1)

        history = self.client.get("/api/workouts", params={"tz": "Africa/Lagos"}, headers=self.auth(token)).json()
        self.assertEqual(history["total"], 3)
        self.assertEqual({item["group"] for item in history["items"]}, {"today"})
        completed_only = self.client.get("/api/workouts", params={"status": "completed", "exercise": "squats"},
                                         headers=self.auth(token)).json()
        self.assertEqual(completed_only["total"], 1)
        future = (datetime.now(timezone.utc) + timedelta(days=3)).date().isoformat()
        none = self.client.get("/api/workouts", params={"from": future}, headers=self.auth(token)).json()
        self.assertEqual(none["total"], 0)
        self.assertEqual(self.client.get("/api/workouts/summary", params={"tz": "Mars/Base"}, headers=self.auth(token)).status_code, 422)

    # ------------------------------------------------------------------ reminders
    def test_reminder_preferences_persist_and_validate(self):
        token = self.verified_login()
        defaults = self.client.get("/api/reminders", headers=self.auth(token)).json()
        self.assertFalse(defaults["email_reminders_enabled"])
        body = {"email_reminders_enabled": True, "morning_reminder_enabled": True, "morning_reminder_time": "06:30",
                "evening_reminder_enabled": False, "evening_reminder_time": "19:15", "timezone": "Africa/Lagos"}
        saved = self.client.put("/api/reminders", json=body, headers=self.auth(token))
        self.assertEqual(saved.status_code, 200, saved.text)
        reloaded = self.client.get("/api/reminders", headers=self.auth(token)).json()
        self.assertEqual(reloaded["morning_reminder_time"], "06:30")
        self.assertEqual(reloaded["timezone"], "Africa/Lagos")
        self.assertEqual(self.client.put("/api/reminders", json={**body, "timezone": "Nowhere/City"}, headers=self.auth(token)).status_code, 422)
        self.assertEqual(self.client.put("/api/reminders", json={**body, "morning_reminder_time": "14:00"}, headers=self.auth(token)).status_code, 422)

    def test_reminder_job_respects_timezone_skips_completed_days_and_never_duplicates(self):
        token = self.verified_login()
        self.client.put("/api/reminders", headers=self.auth(token), json={
            "email_reminders_enabled": True, "morning_reminder_enabled": True, "morning_reminder_time": "07:00",
            "evening_reminder_enabled": True, "evening_reminder_time": "18:00", "timezone": "Africa/Lagos"})
        lagos = ZoneInfo("Africa/Lagos")
        today = datetime.now(lagos).date()
        before = datetime.combine(today, time(6, 50), tzinfo=lagos)
        morning = datetime.combine(today, time(7, 5), tzinfo=lagos)
        with self.db() as db:
            self.assertEqual(run_reminders(db, now=before)["sent"], 0)
            emails.console_outbox.clear()
            self.assertEqual(run_reminders(db, now=morning)["sent"], 1)
            self.assertEqual(run_reminders(db, now=morning + timedelta(minutes=10))["sent"], 0)
            self.assertEqual(len(emails.console_outbox), 1)
            self.assertEqual(emails.console_outbox[0].subject, "Time for a quick SabiBody workout")

        # A completed workout today suppresses the evening reminder.
        self.workout(token)
        evening = datetime.combine(today, time(18, 1), tzinfo=lagos)
        with self.db() as db:
            stats = run_reminders(db, now=evening)
            statuses = {row.reminder_type: row.delivery_status for row in db.scalars(select(ReminderDeliveryLog))}
        self.assertEqual(stats["sent"], 0)
        self.assertEqual(statuses, {"morning": "sent", "evening": "skipped_completed"})

    def test_cron_endpoint_requires_secret(self):
        self.assertIn(self.client.post("/api/internal/reminders/run").status_code, (401, 503))

    # ------------------------------------------------------------------ admin
    def test_admin_overview_requires_server_granted_role(self):
        from app.cli import grant_admin

        token = self.verified_login()
        self.verified_login("ben@example.com", "Ben", client=TestClient(app))
        self.assertEqual(self.client.get("/api/admin/overview", headers=self.auth(token)).status_code, 403)
        self.assertEqual(grant_admin("ada@example.com"), 0)
        self.workout(token)
        overview = self.client.get("/api/admin/overview", headers=self.auth(token))
        self.assertEqual(overview.status_code, 200, overview.text)
        data = overview.json()
        self.assertEqual(data["total_users"], 2)
        self.assertEqual(data["new_today"], 2)
        self.assertEqual(data["total_completed_workouts"], 1)
        self.assertEqual(data["growth"][-1]["total_users"], 2)
        self.assertNotIn("password_hash", overview.text)
        with self.db() as db:
            actions = set(db.scalars(select(AdminAuditLog.action)).all())
        self.assertEqual(actions, {"admin_granted", "admin_overview_viewed"})

    # ------------------------------------------------------------------ deletion
    def test_account_deletion_cascades(self):
        token = self.verified_login()
        self.workout(token)
        self.assertEqual(self.client.request("DELETE", "/api/account", headers=self.auth(token),
                                             json={"password": "wrong-one-1"}).status_code, 400)
        self.assertEqual(self.client.request("DELETE", "/api/account", headers=self.auth(token),
                                             json={"password": PASSWORD}).status_code, 200)
        with self.db() as db:
            self.assertEqual(db.scalar(select(text("count(*)")).select_from(User)), 0)
            self.assertEqual(db.scalar(select(text("count(*)")).select_from(WorkoutSession)), 0)


if __name__ == "__main__":
    unittest.main()
