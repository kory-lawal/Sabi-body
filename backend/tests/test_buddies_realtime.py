"""Phase 2: the authenticated realtime socket (/api/ws)."""
from tests.buddies_base import TEST_DATABASE_URL, BuddiesTestCase

if TEST_DATABASE_URL:
    from fastapi.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    from app.main import app
    from app.realtime.registry import registry


def receive_until(ws, wanted: str, limit: int = 20) -> dict:
    for _ in range(limit):
        message = ws.receive_json()
        if message.get("type") == wanted:
            return message
    raise AssertionError(f"Did not receive {wanted}")


class RealtimeTests(BuddiesTestCase):
    def setUp(self):
        super().setUp()
        registry.reset()
        self.ada = self.make_user("ada.obi@example.com", "Ada Obi")
        self.bola = self.make_user("bola@example.com", "Bola Ade")

    def connect(self, who, client=None):
        client = client or TestClient(app)
        ws = client.websocket_connect("/api/ws")
        return ws

    def test_requires_auth_message_and_valid_token(self):
        with self.connect(self.ada) as ws:
            ws.send_json({"type": "ping"})  # not auth first
            with self.assertRaises(WebSocketDisconnect) as ctx:
                ws.receive_json()
            self.assertEqual(ctx.exception.code, 4401)
        with self.connect(self.ada) as ws:
            ws.send_json({"type": "auth", "data": {"token": "not-a-token"}})
            with self.assertRaises(WebSocketDisconnect) as ctx:
                ws.receive_json()
            self.assertEqual(ctx.exception.code, 4401)

    def test_rejects_untrusted_origin(self):
        client = TestClient(app)
        with self.assertRaises(WebSocketDisconnect) as ctx:
            with client.websocket_connect("/api/ws", headers={"origin": "https://evil.example"}) as ws:
                ws.receive_json()
        self.assertEqual(ctx.exception.code, 4403)

    def test_ready_ping_and_live_notification_push(self):
        with self.connect(self.bola) as ws:
            ws.send_json({"type": "auth", "data": {"token": self.bola["token"]}})
            ready = receive_until(ws, "ready")
            self.assertEqual(ready["data"]["user_id"], self.bola["user"]["id"])
            self.assertEqual(ready["data"]["unread"], 0)
            ws.send_json({"type": "ping"})
            receive_until(ws, "pong")

            # A REST action by another user is pushed to Bola's open socket after commit.
            sent = self.client.post("/api/friends/requests", json={"username": "bola"}, headers=self.ada["h"])
            self.assertEqual(sent.status_code, 201)
            event = receive_until(ws, "notification.new")
            self.assertEqual(event["data"]["notification"]["type"], "friend_request")
            self.assertEqual(event["data"]["unread"], 1)
            receive_until(ws, "friends.changed")

    def test_presence_is_sent_to_friends_only(self):
        self.befriend(self.ada, self.bola)
        with self.connect(self.ada) as ada_ws:
            ada_ws.send_json({"type": "auth", "data": {"token": self.ada["token"]}})
            self.assertEqual(receive_until(ada_ws, "ready")["data"]["online_friends"], [])
            with self.connect(self.bola) as bola_ws:
                bola_ws.send_json({"type": "auth", "data": {"token": self.bola["token"]}})
                ready = receive_until(bola_ws, "ready")
                self.assertEqual(ready["data"]["online_friends"], [self.ada["user"]["id"]])
                update = receive_until(ada_ws, "presence.update")
                self.assertEqual(update["data"], {"user_id": self.bola["user"]["id"], "online": True})

    def test_unknown_message_types_are_acknowledged_as_errors(self):
        with self.connect(self.ada) as ws:
            ws.send_json({"type": "auth", "data": {"token": self.ada["token"]}})
            receive_until(ws, "ready")
            ws.send_json({"type": "nope", "id": "r1"})
            ack = receive_until(ws, "ack")
            self.assertEqual((ack["ref"], ack["ok"], ack["error"]["code"]), ("r1", False, "unknown_type"))
