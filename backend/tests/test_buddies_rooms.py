"""Phase 5: Workout Together rooms — joining, readiness, synchronized start,
progress and WebRTC signalling relay, disconnects, linked saves and rounds."""
import uuid
from datetime import datetime, timedelta, timezone

from tests.buddies_base import TEST_DATABASE_URL, BuddiesTestCase

if TEST_DATABASE_URL:
    from fastapi.testclient import TestClient

    from app.main import app
    from app.realtime.registry import registry
    from app.realtime.rooms import reset_rooms


def until(ws, wanted, limit=40, where=None):
    for _ in range(limit):
        message = ws.receive_json()
        if message.get("type") == wanted and (where is None or where(message)):
            return message
    raise AssertionError(f"no {wanted}")


class RoomTests(BuddiesTestCase):
    def setUp(self):
        super().setUp()
        registry.reset()
        reset_rooms()
        self.ada = self.make_user("ada.obi@example.com", "Ada Obi")
        self.bola = self.make_user("bola@example.com", "Bola Ade")
        self.chidi = self.make_user("chidi@example.com", "Chidi Eze")
        self.befriend(self.ada, self.bola)
        created = self.client.post("/api/shared-sessions", headers=self.ada["h"], json={
            "friend_id": self.bola["user"]["id"], "exercise_id": "push-ups", "target": 20, "mode": "instant"})
        self.sid = created.json()["session"]["id"]

    def accept(self):
        self.assertEqual(self.client.post(f"/api/shared-sessions/{self.sid}/accept", headers=self.bola["h"]).status_code, 200)

    def socket(self, who):
        ws = TestClient(app).websocket_connect("/api/ws")
        ws.__enter__()
        ws.send_json({"type": "auth", "data": {"token": who["token"]}})
        until(ws, "ready")
        self.addCleanup(lambda: ws.__exit__(None, None, None))
        return ws

    def join(self, ws, sid=None):
        ws.send_json({"type": "room.join", "id": "j", "data": {"session_id": sid or self.sid}})
        return until(ws, "ack", where=lambda m: m["ref"] == "j")

    def save(self, who, reps=20, sid=None):
        now = datetime.now(timezone.utc)
        return self.client.post("/api/workouts", headers=who["h"], json={
            "idempotency_key": uuid.uuid4().hex, "exercise_id": "push-ups", "completed": reps >= 20,
            "completed_reps": reps, "target_reps": 20, "duration_seconds": 60,
            "started_at": (now - timedelta(minutes=1)).isoformat(),
            "completed_at": now.isoformat() if reps >= 20 else None, "shared_session_id": sid or self.sid})

    def test_only_accepted_participants_can_join(self):
        ada = self.socket(self.ada)
        ack = self.join(ada)
        self.assertFalse(ack["ok"])  # invitation not accepted yet
        self.accept()
        chidi = self.socket(self.chidi)
        self.assertEqual(self.join(chidi)["error"]["code"], "room_forbidden")
        self.assertTrue(self.join(ada)["ok"])

    def test_both_ready_starts_countdown_and_progress_is_relayed_separately(self):
        self.accept()
        ada, bola = self.socket(self.ada), self.socket(self.bola)
        state = self.join(ada)["data"]["state"]
        self.assertFalse(state["members"][self.bola["user"]["id"]]["connected"])
        self.join(bola)
        until(ada, "room.peer", where=lambda m: m["data"]["connected"])

        ada.send_json({"type": "room.ready", "data": {"session_id": self.sid, "ready": True}})
        bola.send_json({"type": "room.ready", "data": {"session_id": self.sid, "ready": True}})
        start = until(ada, "room.start")
        self.assertIn("starts_at", start["data"])
        until(bola, "room.start")
        status = self.client.get(f"/api/shared-sessions/{self.sid}", headers=self.ada["h"]).json()["session"]["status"]
        self.assertEqual(status, "live")

        ada.send_json({"type": "room.progress", "data": {"session_id": self.sid, "count": 7, "target": 20, "status": "running"}})
        got = until(bola, "room.progress")
        self.assertEqual((got["data"]["user_id"], got["data"]["progress"]["count"]), (self.ada["user"]["id"], 7))

        ada.send_json({"type": "rtc.signal", "data": {"session_id": self.sid, "description": {"type": "offer", "sdp": "x"}}})
        relayed = until(bola, "rtc.signal")
        self.assertEqual(relayed["data"]["from"], self.ada["user"]["id"])
        self.assertEqual(relayed["data"]["description"]["type"], "offer")

    def test_signalling_requires_being_in_the_room(self):
        self.accept()
        ada = self.socket(self.ada)
        ada.send_json({"type": "rtc.signal", "id": "s", "data": {"session_id": self.sid, "candidate": {}}})
        self.assertEqual(until(ada, "ack")["error"]["code"], "not_in_room")

    def test_disconnect_gives_grace_and_rejoin_restores_state(self):
        self.accept()
        ada = self.socket(self.ada)
        self.join(ada)
        bola_client = TestClient(app)
        with bola_client.websocket_connect("/api/ws") as bola:
            bola.send_json({"type": "auth", "data": {"token": self.bola["token"]}})
            until(bola, "ready")
            self.join(bola)
            bola.send_json({"type": "room.progress", "data": {"session_id": self.sid, "count": 5, "status": "running"}})
            until(ada, "room.progress")
        lost = until(ada, "room.peer", where=lambda m: not m["data"]["connected"])
        self.assertEqual(lost["data"]["reconnect_seconds"], 180)
        bola = self.socket(self.bola)
        state = self.join(bola)["data"]["state"]
        self.assertEqual(state["members"][self.bola["user"]["id"]]["progress"]["count"], 5)  # kept across reconnects

    def test_each_person_saves_their_own_workout_and_both_get_the_summary(self):
        self.accept()
        ada, bola = self.socket(self.ada), self.socket(self.bola)
        self.join(ada)
        self.join(bola)
        self.assertEqual(self.save(self.ada, 20).status_code, 201)
        dup = self.save(self.ada, 20)
        self.assertEqual(dup.json()["detail"]["code"], "already_saved")
        self.assertEqual(self.save(self.bola, 14).status_code, 201)

        summary = until(ada, "room.summary")["data"]
        me, partner = summary["participants"]
        self.assertTrue(me["is_me"])
        self.assertEqual((me["result"]["completed_reps"], partner["result"]["completed_reps"]), (20, 14))
        self.assertFalse(summary["both_completed"])
        self.assertEqual(summary["status"], "incomplete")
        until(bola, "room.summary")
        # Histories stay separate.
        ada_hist = self.client.get("/api/workouts", headers=self.ada["h"]).json()["items"]
        self.assertEqual([w["completed_reps"] for w in ada_hist], [20])

    def test_mismatched_or_foreign_session_saves_are_rejected(self):
        self.accept()
        bad = self.client.post("/api/workouts", headers=self.ada["h"], json={
            "idempotency_key": uuid.uuid4().hex, "exercise_id": "squats", "completed": True, "completed_reps": 20,
            "target_reps": 20, "duration_seconds": 60, "started_at": datetime.now(timezone.utc).isoformat(),
            "shared_session_id": self.sid})
        self.assertEqual(bad.json()["detail"]["code"], "session_mismatch")
        self.assertEqual(self.save(self.chidi, 20).status_code, 404)

    def test_repeat_round_needs_both_and_creates_linked_session(self):
        self.accept()
        ada, bola = self.socket(self.ada), self.socket(self.bola)
        self.join(ada)
        self.join(bola)
        ada.send_json({"type": "room.round.propose", "data": {"session_id": self.sid, "exercise_id": "squats", "target": 15}})
        until(bola, "room.state", where=lambda m: m["data"]["round_proposal"] is not None)
        ada.send_json({"type": "room.round.respond", "id": "own", "data": {"session_id": self.sid, "accept": True}})
        self.assertEqual(until(ada, "ack", where=lambda m: m["ref"] == "own")["error"]["code"], "no_proposal")
        bola.send_json({"type": "room.round.respond", "id": "r", "data": {"session_id": self.sid, "accept": True}})
        new_id = until(ada, "room.round")["data"]["new_session_id"]
        new = self.client.get(f"/api/shared-sessions/{new_id}", headers=self.bola["h"]).json()["session"]
        self.assertEqual((new["status"], new["exercise_id"], new["target"], new["round_number"]), ("accepted", "squats", 15, 2))
        self.assertEqual(new["root_session_id"], self.sid)

    def test_ice_servers_include_stun(self):
        body = self.client.get("/api/rtc/ice-servers", headers=self.ada["h"]).json()
        self.assertTrue(any("stun:" in str(s["urls"]) for s in body["ice_servers"]))
        self.assertIn(body["relay"], {"none", "metered", "static", "unavailable"})
