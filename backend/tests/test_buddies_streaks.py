"""Phase 6: buddy streaks and exercise streaks (every rule in the rules table)."""
import uuid
from datetime import datetime, timedelta, timezone

from tests.buddies_base import TEST_DATABASE_URL, BuddiesTestCase

if TEST_DATABASE_URL:
    from sqlalchemy import select, update

    from app.db.models import SharedSession, SharedSessionParticipant, StreakEvent
    from app.jobs.buddy_jobs import run_buddy_jobs
    from app.social import streaks


class StreakTests(BuddiesTestCase):
    def setUp(self):
        super().setUp()
        self.ada = self.make_user("ada.obi@example.com", "Ada Obi")
        self.bola = self.make_user("bola@example.com", "Bola Ade")
        self.befriend(self.ada, self.bola)

    def session(self, exercise="push-ups", target=20, mode="instant", hours=None):
        body = {"friend_id": self.bola["user"]["id"], "exercise_id": exercise, "target": target, "mode": mode}
        if hours is not None:
            body["scheduled_at"] = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
        sid = self.client.post("/api/shared-sessions", json=body, headers=self.ada["h"]).json()["session"]["id"]
        self.client.post(f"/api/shared-sessions/{sid}/accept", headers=self.bola["h"])
        return sid

    def save(self, who, sid, reps=20, exercise="push-ups", target=20):
        now = datetime.now(timezone.utc)
        complete = reps >= target
        return self.client.post("/api/workouts", headers=who["h"], json={
            "idempotency_key": uuid.uuid4().hex, "exercise_id": exercise, "completed": complete,
            "completed_reps": reps, "target_reps": target, "duration_seconds": 60,
            "started_at": (now - timedelta(minutes=1)).isoformat(),
            "completed_at": now.isoformat() if complete else None, "shared_session_id": sid})

    def streak(self):
        return self.client.get(f"/api/streaks/{self.bola['user']['id']}", headers=self.ada["h"]).json()

    def complete_together(self, **kw):
        sid = self.session(**kw)
        self.save(self.ada, sid, exercise=kw.get("exercise", "push-ups"), target=kw.get("target", 20),
                  reps=kw.get("target", 20))
        self.save(self.bola, sid, exercise=kw.get("exercise", "push-ups"), target=kw.get("target", 20),
                  reps=kw.get("target", 20))
        return sid

    def test_completed_commitments_build_both_streaks(self):
        self.complete_together()
        self.complete_together()
        self.complete_together(exercise="squats", target=15)
        data = self.streak()
        self.assertEqual((data["buddy"]["current"], data["buddy"]["longest"], data["buddy"]["total_completed"]), (3, 3, 3))
        by_ex = {e["exercise_id"]: e for e in data["exercises"]}
        self.assertEqual((by_ex["push-ups"]["current"], by_ex["squats"]["current"]), (2, 1))
        self.assertIsNotNone(data["buddy"]["last_completed_at"])
        self.assertEqual(data["buddy"]["next_milestone"], 7)
        # Milestone (3) notified to both, once.
        for who in (self.ada, self.bola):
            notes = self.client.get("/api/notifications", headers=who["h"]).json()["notifications"]
            self.assertEqual(sum(n["type"] == "streak_milestone" for n in notes), 1)
        # The friend list shows the streak too.
        self.assertEqual(self.client.get("/api/friends", headers=self.bola["h"]).json()["friends"][0]["streak"]["current"], 3)

    def test_one_person_not_reaching_the_target_breaks_the_streak(self):
        self.complete_together()
        sid = self.session()
        self.save(self.ada, sid, reps=20)
        self.save(self.bola, sid, reps=12)
        data = self.streak()
        self.assertEqual((data["buddy"]["current"], data["buddy"]["longest"]), (0, 1))
        types = [n["type"] for n in self.client.get("/api/notifications", headers=self.bola["h"]).json()["notifications"]]
        self.assertIn("missed_commitment", types)

    def test_summary_reports_the_streak_update(self):
        sid = self.complete_together()
        summary = self.client.get(f"/api/shared-sessions/{sid}/summary", headers=self.bola["h"]).json()
        self.assertEqual(summary["streaks"]["buddy"]["current"], 1)
        self.assertEqual(summary["streaks"]["outcome"], "counted")
        self.assertTrue(summary["both_completed"])

    def test_no_show_breaks_but_early_cancel_and_reschedule_do_not(self):
        self.complete_together()
        early = self.session(mode="scheduled", hours=5)
        self.client.post(f"/api/shared-sessions/{early}/cancel", headers=self.ada["h"])
        moved = self.session(mode="scheduled", hours=6)
        self.client.post(f"/api/shared-sessions/{moved}/reschedule", headers=self.bola["h"],
                         json={"scheduled_at": (datetime.now(timezone.utc) + timedelta(hours=8)).isoformat()})
        self.assertEqual(self.streak()["buddy"]["current"], 1)  # neutral

        missed = self.session(mode="scheduled", hours=1)
        with self.db() as db:
            run_buddy_jobs(db, datetime.now(timezone.utc) + timedelta(hours=1, minutes=31))
        self.assertEqual(self.streak()["buddy"]["current"], 0)
        status = self.client.get(f"/api/shared-sessions/{missed}", headers=self.ada["h"]).json()["session"]["status"]
        self.assertEqual(status, "incomplete")

    def test_late_cancel_breaks_the_streak(self):
        self.complete_together()
        soon = self.session(mode="scheduled", hours=1)
        self.client.post(f"/api/shared-sessions/{soon}/cancel", headers=self.bola["h"])
        self.assertEqual(self.streak()["buddy"]["current"], 0)

    def test_disconnection_without_return_is_neutral(self):
        self.complete_together()
        sid = self.session()
        with self.db() as db:
            started = datetime.now(timezone.utc) - timedelta(hours=3)
            db.execute(update(SharedSession).where(SharedSession.id == sid).values(status="live", started_at=started))
            db.execute(update(SharedSessionParticipant).where(SharedSessionParticipant.session_id == sid)
                       .values(joined_at=started))
            db.commit()
        self.save(self.ada, sid)  # Ada finishes; Bola's connection dropped and never came back
        with self.db() as db:
            run_buddy_jobs(db)
            event = db.scalar(select(StreakEvent).where(StreakEvent.root_session_id == uuid.UUID(sid)))
        self.assertEqual(event.outcome, "neutral")
        self.assertEqual(self.streak()["buddy"]["current"], 1)

    def test_repeat_rounds_and_replays_never_double_count(self):
        root = self.complete_together()
        with self.db() as db:
            s = db.get(SharedSession, uuid.UUID(root))
            self.assertFalse(streaks.apply_outcome(db, s, "counted", "replay"))  # ledger blocks a second count
            db.commit()
        self.assertEqual(self.streak()["buddy"]["current"], 1)
        # A second round (linked to the first) is fun but doesn't change the streak.
        with self.db() as db:
            from app.social import sessions as svc
            from app.db.models import User
            r1 = db.get(SharedSession, uuid.UUID(root))
            r2 = svc.create(db, db.get(User, uuid.UUID(self.ada["user"]["id"])), uuid.UUID(self.bola["user"]["id"]),
                            "push-ups", 20, "instant", None, None, root=r1, auto_accept=True)
            db.commit()
            r2_id = str(r2.id)
        self.save(self.ada, r2_id)
        self.save(self.bola, r2_id)
        self.assertEqual(self.streak()["buddy"]["current"], 1)

    def test_streaks_require_friendship_and_cannot_be_written(self):
        stranger = self.make_user("chidi@example.com", "Chidi Eze")
        self.assertEqual(self.client.get(f"/api/streaks/{self.bola['user']['id']}", headers=stranger["h"]).status_code, 403)
        for method in ("post", "put", "patch"):
            response = getattr(self.client, method)(f"/api/streaks/{self.bola['user']['id']}", json={"current": 99},
                                                    headers=self.ada["h"])
            self.assertEqual(response.status_code, 405)
