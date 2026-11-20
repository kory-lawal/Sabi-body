"""Phase 4: invitations, scheduling, the shared calendar and buddy reminder emails."""
from datetime import datetime, timedelta, timezone

from tests.buddies_base import TEST_DATABASE_URL, BuddiesTestCase

if TEST_DATABASE_URL:
    from sqlalchemy import update

    from app.accounts import emails
    from app.db.models import ReminderPreference, SharedSession
    from app.jobs.buddy_jobs import run_buddy_jobs


class SessionTests(BuddiesTestCase):
    def setUp(self):
        super().setUp()
        self.ada = self.make_user("ada.obi@example.com", "Ada Obi")
        self.bola = self.make_user("bola@example.com", "Bola Ade")
        self.chidi = self.make_user("chidi@example.com", "Chidi Eze")
        self.befriend(self.ada, self.bola)

    def create(self, who=None, friend=None, **overrides):
        who, friend = who or self.ada, friend or self.bola
        body = {"friend_id": friend["user"]["id"], "exercise_id": "push-ups", "target": 20, "mode": "instant"}
        body.update(overrides)
        return self.client.post("/api/shared-sessions", json=body, headers=who["h"])

    def at(self, hours=24):
        return (datetime.now(timezone.utc) + timedelta(hours=hours)).replace(microsecond=0).isoformat()

    def act(self, sid, action, who):
        return self.client.post(f"/api/shared-sessions/{sid}/{action}", headers=who["h"])

    # ------------------------------------------------------------------ invitations
    def test_instant_invite_accept_and_duplicate_prevention(self):
        created = self.create(message="Let's go!")
        self.assertEqual(created.status_code, 201, created.text)
        s = created.json()["session"]
        self.assertEqual((s["status"], s["awaiting_partner"], s["created_by_me"]), ("proposed", True, True))
        self.assertEqual(self.create().json()["detail"]["code"], "duplicate_invite")

        # Bola gets a chat card and a notification.
        msgs = self.client.get(f"/api/conversations/{self.ada['user']['id']}/messages", headers=self.bola["h"]).json()
        self.assertEqual(msgs["messages"][-1]["kind"], "invitation")
        self.assertEqual(msgs["messages"][-1]["payload"]["session_id"], s["id"])
        types = [n["type"] for n in self.client.get("/api/notifications", headers=self.bola["h"]).json()["notifications"]]
        self.assertIn("workout_invite", types)

        self.assertEqual(self.act(s["id"], "accept", self.ada).json()["detail"]["code"], "not_awaiting_you")
        accepted = self.act(s["id"], "accept", self.bola).json()["session"]
        self.assertEqual(accepted["status"], "accepted")
        self.assertTrue(accepted["can_join"])
        upcoming = self.client.get("/api/shared-sessions?view=upcoming", headers=self.ada["h"]).json()["sessions"]
        self.assertEqual([u["id"] for u in upcoming], [s["id"]])

    def test_only_friends_can_invite_and_strangers_cannot_see_sessions(self):
        self.assertEqual(self.create(who=self.chidi, friend=self.ada).status_code, 403)
        sid = self.create().json()["session"]["id"]
        self.assertEqual(self.client.get(f"/api/shared-sessions/{sid}", headers=self.chidi["h"]).status_code, 404)
        self.assertEqual(self.act(sid, "accept", self.chidi).status_code, 404)

    def test_validation_of_exercise_target_and_time(self):
        self.assertEqual(self.create(exercise_id="burpees").json()["detail"]["code"], "unknown_exercise")
        self.assertEqual(self.create(target=0).json()["detail"]["code"], "invalid_target")
        self.assertEqual(self.create(exercise_id="plank", target=4000).json()["detail"]["code"], "invalid_target")
        past = self.create(mode="scheduled", scheduled_at=self.at(-1))
        self.assertEqual(past.json()["detail"]["code"], "time_in_past")
        naive = self.create(mode="scheduled", scheduled_at="2026-12-01T19:00:00")
        self.assertEqual(naive.status_code, 422)

    def test_schedule_decline_reschedule_and_cancel(self):
        s = self.create(mode="scheduled", scheduled_at=self.at(24)).json()["session"]
        # Bola suggests another time: now Ada must answer.
        new_time = self.at(30)
        moved = self.client.post(f"/api/shared-sessions/{s['id']}/reschedule", json={"scheduled_at": new_time},
                                 headers=self.bola["h"]).json()["session"]
        self.assertEqual((moved["status"], moved["awaiting_partner"]), ("proposed", True))
        self.assertEqual(datetime.fromisoformat(moved["scheduled_at"]), datetime.fromisoformat(new_time))
        self.assertEqual(self.act(s["id"], "accept", self.bola).status_code, 409)
        self.assertEqual(self.act(s["id"], "accept", self.ada).json()["session"]["status"], "accepted")

        cancelled = self.act(s["id"], "cancel", self.bola).json()["session"]
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(
            [c["id"] for c in self.client.get("/api/shared-sessions?view=cancelled", headers=self.ada["h"]).json()["sessions"]],
            [s["id"]])
        notes = self.client.get("/api/notifications", headers=self.ada["h"]).json()["notifications"]
        self.assertTrue(any(n["type"] == "session_update" and n["payload"]["change"] == "cancelled" for n in notes))

        other = self.create(mode="scheduled", scheduled_at=self.at(48)).json()["session"]
        self.assertEqual(self.act(other["id"], "decline", self.bola).json()["session"]["status"], "declined")

    def test_calendar_range_query(self):
        self.create(mode="scheduled", scheduled_at=self.at(24))
        self.create(mode="scheduled", scheduled_at=self.at(24 * 40))
        start = datetime.now(timezone.utc).isoformat()
        end = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        rows = self.client.get("/api/shared-sessions", params={"from": start, "to": end}, headers=self.bola["h"]).json()
        self.assertEqual(len(rows["sessions"]), 1)

    # ------------------------------------------------------------------ jobs
    def test_instant_invites_expire(self):
        sid = self.create().json()["session"]["id"]
        with self.db() as db:
            result = run_buddy_jobs(db, datetime.now(timezone.utc) + timedelta(minutes=31))
        self.assertEqual(result["expired_invites"], 1)
        self.assertEqual(self.client.get(f"/api/shared-sessions/{sid}", headers=self.bola["h"]).json()["session"]["status"],
                         "expired")
        self.assertEqual(self.act(sid, "accept", self.bola).status_code, 409)

    def test_reminders_go_to_both_in_their_timezones_once(self):
        start = (datetime.now(timezone.utc) + timedelta(hours=2)).replace(second=0, microsecond=0)
        s = self.create(mode="scheduled", scheduled_at=start.isoformat()).json()["session"]
        self.act(s["id"], "accept", self.bola)
        with self.db() as db:
            db.execute(update(ReminderPreference).where(ReminderPreference.user_id == self.bola["user"]["id"])
                       .values(timezone="America/New_York"))
            db.execute(update(ReminderPreference).where(ReminderPreference.user_id == self.ada["user"]["id"])
                       .values(timezone="Africa/Lagos"))
            db.commit()
        emails.console_outbox.clear()

        one_hour_before = start - timedelta(minutes=59)
        with self.db() as db:
            stats = run_buddy_jobs(db, one_hour_before)["reminders"]
            again = run_buddy_jobs(db, one_hour_before + timedelta(minutes=5))["reminders"]
        self.assertEqual(stats["sent"], 2)
        self.assertEqual(again["sent"], 0)  # no duplicates
        by_to = {m.to: m for m in emails.console_outbox}
        bola_mail = by_to["bola@example.com"]
        self.assertEqual(bola_mail.subject, "Your SabiBody workout is in one hour!")
        self.assertIn("Hey Bola", bola_mail.text)
        self.assertIn("workout with Ada", bola_mail.text)
        self.assertIn("America/New York", bola_mail.text)
        self.assertIn("Africa/Lagos", by_to["ada.obi@example.com"].text)
        self.assertIn("workout with Bola", by_to["ada.obi@example.com"].text)

        emails.console_outbox.clear()
        with self.db() as db:
            run_buddy_jobs(db, start + timedelta(minutes=1))
        subjects = sorted(m.subject for m in emails.console_outbox)
        self.assertEqual(subjects, ["It's time to work out with Ada!", "It's time to work out with Bola!"])

    def test_reminders_skip_cancelled_respect_prefs_and_rearm_after_reschedule(self):
        start = (datetime.now(timezone.utc) + timedelta(hours=3)).replace(second=0, microsecond=0)
        s = self.create(mode="scheduled", scheduled_at=start.isoformat()).json()["session"]
        self.act(s["id"], "accept", self.bola)
        # Bola turns off reminder emails; Ada turns on the 24h one.
        self.client.put("/api/notification-preferences", headers=self.bola["h"], json={
            "preferences": [{"type": "workout_reminder", "in_app": True, "email": False}]})
        emails.console_outbox.clear()
        with self.db() as db:
            run_buddy_jobs(db, start - timedelta(minutes=55))
        self.assertEqual([m.to for m in emails.console_outbox], ["ada.obi@example.com"])

        # Moving the workout re-arms reminders for the new time.
        new_start = start + timedelta(hours=5)
        self.client.post(f"/api/shared-sessions/{s['id']}/reschedule", json={"scheduled_at": new_start.isoformat()},
                         headers=self.ada["h"])
        self.act(s["id"], "accept", self.bola)
        emails.console_outbox.clear()
        with self.db() as db:
            run_buddy_jobs(db, new_start - timedelta(minutes=55))
        self.assertEqual([m.to for m in emails.console_outbox], ["ada.obi@example.com"])

        self.act(s["id"], "cancel", self.ada)
        emails.console_outbox.clear()
        with self.db() as db:
            run_buddy_jobs(db, new_start + timedelta(minutes=1))
        self.assertEqual(emails.console_outbox, [])

    def test_optional_24h_reminder(self):
        start = (datetime.now(timezone.utc) + timedelta(hours=30)).replace(second=0, microsecond=0)
        s = self.create(mode="scheduled", scheduled_at=start.isoformat()).json()["session"]
        self.act(s["id"], "accept", self.bola)
        self.client.put("/api/notification-preferences", headers=self.ada["h"], json={"buddy_reminder_24h": True})
        emails.console_outbox.clear()
        with self.db() as db:
            run_buddy_jobs(db, start - timedelta(hours=23, minutes=50))
        self.assertEqual([(m.to, m.subject) for m in emails.console_outbox],
                         [("ada.obi@example.com", "Your SabiBody workout with Bola is tomorrow")])
