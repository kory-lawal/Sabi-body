"""Phase 7: challenges — progress only from real workouts, deadlines, permissions."""
import uuid
from datetime import datetime, timedelta, timezone

from tests.buddies_base import TEST_DATABASE_URL, BuddiesTestCase

if TEST_DATABASE_URL:
    from sqlalchemy import update

    from app.db.models import Challenge
    from app.jobs.buddy_jobs import run_buddy_jobs


class ChallengeTests(BuddiesTestCase):
    def setUp(self):
        super().setUp()
        self.ada = self.make_user("ada.obi@example.com", "Ada Obi")
        self.bola = self.make_user("bola@example.com", "Bola Ade")
        self.chidi = self.make_user("chidi@example.com", "Chidi Eze")
        self.befriend(self.ada, self.bola)

    def create(self, who=None, friend=None, **overrides):
        who, friend = who or self.ada, friend or self.bola
        body = {"friend_id": friend["user"]["id"], "metric": "reps", "exercise_id": "push-ups", "target": 30,
                "deadline": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()}
        body.update(overrides)
        return self.client.post("/api/challenges", json=body, headers=who["h"])

    def work(self, who, exercise="push-ups", reps=10, target=10, seconds=60, completed=None):
        now = datetime.now(timezone.utc)
        body = {"idempotency_key": uuid.uuid4().hex, "exercise_id": exercise, "duration_seconds": seconds,
                "started_at": (now - timedelta(seconds=5)).isoformat()}
        if exercise == "plank":
            body.update(target_duration_seconds=target, completed=seconds >= target)
        else:
            done = reps >= target if completed is None else completed
            body.update(completed_reps=reps, target_reps=target, completed=done)
        if body["completed"]:
            body["completed_at"] = now.isoformat()
        return self.client.post("/api/workouts", json=body, headers=who["h"])

    def get(self, cid, who):
        return self.client.get(f"/api/challenges/{cid}", headers=who["h"]).json()["challenge"]

    def test_progress_comes_only_from_real_workouts_after_accepting(self):
        self.work(self.bola, reps=50)  # before the challenge: doesn't count
        cid = self.create().json()["challenge"]["id"]
        self.work(self.bola, reps=50)  # before accepting: doesn't count
        accepted = self.client.post(f"/api/challenges/{cid}/accept", headers=self.bola["h"]).json()["challenge"]
        self.assertEqual(accepted["status"], "active")
        self.assertEqual(accepted["my_progress"], 0)

        self.work(self.ada, reps=20)
        self.work(self.ada, reps=6, target=10)  # unfinished attempt — reps still genuine
        self.work(self.ada, exercise="squats", reps=40, target=40)  # different exercise: ignored
        c = self.get(cid, self.ada)
        self.assertEqual((c["my_progress"], c["friend_progress"], c["i_reached"]), (26, 0, False))
        self.work(self.ada, reps=4, target=4)
        c = self.get(cid, self.ada)
        self.assertTrue(c["i_reached"])
        self.assertTrue(c["first_is_me"])
        self.assertEqual(c["status"], "active")
        notes = self.client.get("/api/notifications", headers=self.bola["h"]).json()["notifications"]
        self.assertTrue(any(n["type"] == "challenge" and n["payload"]["event"] == "completed" for n in notes))

        self.work(self.bola, reps=30, target=30)
        self.assertEqual(self.get(cid, self.bola)["status"], "completed")

    def test_cannot_claim_completion_or_modify_others(self):
        cid = self.create().json()["challenge"]["id"]
        self.client.post(f"/api/challenges/{cid}/accept", headers=self.bola["h"])
        for path in (f"/api/challenges/{cid}", f"/api/challenges/{cid}/complete"):
            self.assertIn(self.client.post(path, json={"status": "completed"}, headers=self.ada["h"]).status_code,
                          (404, 405, 422))
        self.assertEqual(self.client.get(f"/api/challenges/{cid}", headers=self.chidi["h"]).status_code, 404)
        self.assertEqual(self.client.post(f"/api/challenges/{cid}/cancel", headers=self.bola["h"]).status_code, 409)

    def test_plank_hold_and_workout_count_challenges(self):
        hold = self.create(metric="seconds", target=60).json()["challenge"]
        self.assertEqual((hold["exercise_id"], hold["summary"]), ("plank", "hold a plank for 60 seconds"))
        self.client.post(f"/api/challenges/{hold['id']}/accept", headers=self.bola["h"])
        self.work(self.bola, exercise="plank", target=30, seconds=40)
        self.work(self.bola, exercise="plank", target=30, seconds=35)
        self.assertEqual(self.get(hold["id"], self.bola)["my_progress"], 40)  # longest single hold
        self.work(self.bola, exercise="plank", target=60, seconds=61)
        self.assertTrue(self.get(hold["id"], self.bola)["i_reached"])

        three = self.create(metric="workouts", exercise_id="any", target=3).json()["challenge"]
        self.client.post(f"/api/challenges/{three['id']}/accept", headers=self.bola["h"])
        self.work(self.ada, reps=10)
        self.work(self.ada, exercise="squats", reps=10)
        self.work(self.ada, reps=3, target=10)  # not completed: doesn't count as a workout
        self.assertEqual(self.get(three["id"], self.ada)["my_progress"], 2)

    def test_validation_permissions_and_deadline_expiry(self):
        self.assertEqual(self.create(who=self.chidi, friend=self.ada).status_code, 403)
        self.assertEqual(self.create(metric="reps", exercise_id="plank").json()["detail"]["code"], "unknown_exercise")
        self.assertEqual(self.create(target=0).json()["detail"]["code"], "invalid_target")
        soon = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        self.assertEqual(self.create(deadline=soon).json()["detail"]["code"], "invalid_deadline")

        declined = self.create().json()["challenge"]["id"]
        self.assertEqual(self.client.post(f"/api/challenges/{declined}/accept", headers=self.ada["h"]).status_code, 409)
        self.assertEqual(self.client.post(f"/api/challenges/{declined}/decline", headers=self.bola["h"]).json()["challenge"]["status"],
                         "declined")

        cid = self.create().json()["challenge"]["id"]
        self.client.post(f"/api/challenges/{cid}/accept", headers=self.bola["h"])
        with self.db() as db:
            db.execute(update(Challenge).where(Challenge.id == uuid.UUID(cid))
                       .values(deadline=datetime.now(timezone.utc) - timedelta(minutes=1)))
            db.commit()
            stats = run_buddy_jobs(db)
        self.assertEqual(stats["challenges_closed"], 1)
        self.assertEqual(self.get(cid, self.ada)["status"], "expired")
        lists = self.client.get("/api/challenges", headers=self.ada["h"]).json()
        self.assertEqual({c["id"] for c in lists["past"]}, {cid, declined})

    def test_unfriending_cancels_open_challenges(self):
        cid = self.create().json()["challenge"]["id"]
        self.client.delete(f"/api/friends/{self.bola['user']['id']}", headers=self.ada["h"])
        self.assertEqual(self.get(cid, self.ada)["status"], "cancelled")
