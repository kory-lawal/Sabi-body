"""Phase 3: private chat, exercise cards and nudges."""
import uuid

from tests.buddies_base import TEST_DATABASE_URL, BuddiesTestCase

if TEST_DATABASE_URL:
    from fastapi.testclient import TestClient

    from app.main import app
    from app.realtime.registry import registry


def receive_until(ws, wanted, limit=20):
    for _ in range(limit):
        message = ws.receive_json()
        if message.get("type") == wanted:
            return message
    raise AssertionError(wanted)


class ChatTests(BuddiesTestCase):
    def setUp(self):
        super().setUp()
        registry.reset()
        self.ada = self.make_user("ada.obi@example.com", "Ada Obi")
        self.bola = self.make_user("bola@example.com", "Bola Ade")
        self.chidi = self.make_user("chidi@example.com", "Chidi Eze")
        self.befriend(self.ada, self.bola)

    def send(self, who, to, body="Hi!", kind="text", payload=None, cid=None):
        return self.client.post(f"/api/conversations/{to['user']['id']}/messages", headers=who["h"], json={
            "kind": kind, "body": body, "payload": payload or {}, "client_msg_id": cid or uuid.uuid4().hex})

    def test_friends_can_chat_and_unread_counts_work(self):
        self.assertEqual(self.send(self.ada, self.bola, "Ready for push-ups?").status_code, 201)
        self.send(self.ada, self.bola, "7pm?")
        convs = self.client.get("/api/conversations", headers=self.bola["h"]).json()
        self.assertEqual(convs["unread"], 2)
        self.assertEqual(convs["conversations"][0]["last_message"]["body"], "7pm?")
        notes = self.client.get("/api/notifications", headers=self.bola["h"]).json()["notifications"]
        self.assertEqual([n["type"] for n in notes if n["type"] != "friend_request"], ["message"])  # one per conversation
        self.assertEqual(notes[0]["payload"]["count"], 2)

        history = self.client.get(f"/api/conversations/{self.ada['user']['id']}/messages", headers=self.bola["h"]).json()
        self.assertEqual([m["body"] for m in history["messages"]], ["Ready for push-ups?", "7pm?"])
        self.assertTrue(history["can_send"])
        read = self.client.post(f"/api/conversations/{self.ada['user']['id']}/read", headers=self.bola["h"])
        self.assertEqual(read.json()["unread"], 0)
        self.assertEqual(self.client.get("/api/notifications/unread-count", headers=self.bola["h"]).json()["unread"], 0)

    def test_sends_are_idempotent(self):
        cid = uuid.uuid4().hex
        first = self.send(self.ada, self.bola, "once", cid=cid).json()
        again = self.send(self.ada, self.bola, "once", cid=cid).json()
        self.assertTrue(again["duplicate"])
        self.assertEqual(first["message"]["id"], again["message"]["id"])

    def test_only_friends_can_message_and_others_cannot_read(self):
        stranger = self.send(self.chidi, self.ada, "hey")
        self.assertEqual((stranger.status_code, stranger.json()["detail"]["code"]), (403, "not_friends"))
        self.send(self.ada, self.bola, "private")
        # Chidi can't read Ada↔Bola: there is no conversation between Chidi and either of them.
        peek = self.client.get(f"/api/conversations/{self.bola['user']['id']}/messages", headers=self.chidi["h"]).json()
        self.assertEqual(peek["messages"], [])
        self.assertFalse(peek["can_send"])

    def test_blocking_stops_messages_and_hides_history(self):
        self.send(self.ada, self.bola, "before")
        self.client.post("/api/blocks", json={"username": "adaobi"}, headers=self.bola["h"])
        self.assertEqual(self.send(self.ada, self.bola, "after").status_code, 403)
        hidden = self.client.get(f"/api/conversations/{self.bola['user']['id']}/messages", headers=self.ada["h"])
        self.assertEqual(hidden.status_code, 404)
        self.assertEqual(self.client.get("/api/conversations", headers=self.ada["h"]).json()["conversations"], [])

    def test_exercise_card_is_validated_against_catalogue(self):
        bad = self.send(self.ada, self.bola, kind="exercise_card", payload={"exercise_id": "burpees"})
        self.assertEqual(bad.status_code, 422)
        good = self.send(self.ada, self.bola, "Try this!", kind="exercise_card",
                         payload={"exercise_id": "push-ups", "target": 5000, "secret": "x"}).json()
        payload = good["message"]["payload"]
        self.assertEqual(payload, {"exercise_id": "push-ups", "exercise_name": "Push-ups", "exercise_type": "reps",
                                   "target": 200})
        # Clients can't forge system message kinds.
        forged = self.send(self.ada, self.bola, kind="invitation", payload={"session_id": str(uuid.uuid4())})
        self.assertEqual(forged.status_code, 422)

    def test_nudges_are_rate_limited_and_respect_mutes(self):
        url = f"/api/friends/{self.bola['user']['id']}/nudge"
        self.assertEqual(self.client.post(url, json={"preset": "remind_today"}, headers=self.ada["h"]).status_code, 201)
        again = self.client.post(url, json={"preset": "waiting"}, headers=self.ada["h"])
        self.assertEqual(again.json()["detail"]["code"], "nudge_cooldown")
        notes = self.client.get("/api/notifications", headers=self.bola["h"]).json()["notifications"]
        self.assertEqual([n["type"] for n in notes if n["type"] != "friend_request"], ["encouragement"])
        self.assertEqual(notes[0]["payload"]["text"], "Don’t forget your workout today!")

        self.client.post(f"/api/friends/{self.bola['user']['id']}/mute", headers=self.ada["h"])
        self.client.post(f"/api/friends/{self.ada['user']['id']}/nudge", json={"preset": "you_got_this"},
                         headers=self.bola["h"])
        types = [n["type"] for n in self.client.get("/api/notifications", headers=self.ada["h"]).json()["notifications"]]
        self.assertNotIn("encouragement", types)  # muted, though the message is still in the chat
        bad = self.client.post(url, json={"preset": "spam"}, headers=self.ada["h"])
        self.assertEqual(bad.status_code, 422)

    def test_messages_arrive_over_the_socket(self):
        with TestClient(app).websocket_connect("/api/ws") as bola_ws, TestClient(app).websocket_connect("/api/ws") as ada_ws:
            bola_ws.send_json({"type": "auth", "data": {"token": self.bola["token"]}})
            receive_until(bola_ws, "ready")
            ada_ws.send_json({"type": "auth", "data": {"token": self.ada["token"]}})
            receive_until(ada_ws, "ready")
            ada_ws.send_json({"type": "chat.send", "id": "m1", "data": {
                "friend_id": self.bola["user"]["id"], "body": "over the socket", "client_msg_id": uuid.uuid4().hex}})
            ack = receive_until(ada_ws, "ack")
            self.assertTrue(ack["ok"], ack)
            event = receive_until(bola_ws, "chat.message")
            self.assertEqual(event["data"]["message"]["body"], "over the socket")
            bola_ws.send_json({"type": "chat.read", "id": "r1", "data": {"friend_id": self.ada["user"]["id"]}})
            receipt = receive_until(ada_ws, "chat.read")
            self.assertEqual(receipt["data"]["reader_id"], self.bola["user"]["id"])
