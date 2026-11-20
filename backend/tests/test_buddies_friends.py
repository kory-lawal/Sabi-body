"""Phase 1: usernames, friend requests, blocking, reporting, mutes and notifications."""
from tests.buddies_base import BuddiesTestCase


class FriendsTests(BuddiesTestCase):
    def setUp(self):
        super().setUp()
        self.ada = self.make_user("ada.obi@example.com", "Ada Obi")
        self.bola = self.make_user("bola@example.com", "Bola Ade")

    def get(self, path, who):
        return self.client.get(path, headers=who["h"])

    def post(self, path, who, json=None):
        return self.client.post(path, json=json or {}, headers=who["h"])

    # ------------------------------------------------------------------ usernames
    def test_registration_generates_username_and_user_can_change_it(self):
        self.assertEqual(self.ada["user"]["username"], "adaobi")
        taken = self.client.put("/api/account/username", json={"username": "bola"}, headers=self.ada["h"])
        self.assertEqual(taken.status_code, 409)
        bad = self.client.put("/api/account/username", json={"username": "No Spaces!"}, headers=self.ada["h"])
        self.assertEqual(bad.status_code, 422)
        reserved = self.client.put("/api/account/username", json={"username": "admin"}, headers=self.ada["h"])
        self.assertEqual(reserved.json()["detail"]["code"], "reserved_username")
        ok = self.client.put("/api/account/username", json={"username": "@Ada_Fit"}, headers=self.ada["h"])
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertEqual(ok.json()["username"], "ada_fit")
        again = self.client.put("/api/account/username", json={"username": "ada_fit2"}, headers=self.ada["h"])
        self.assertEqual(again.json()["detail"]["code"], "username_cooldown")
        avail = self.get("/api/account/username/available?u=bola", self.ada)
        self.assertFalse(avail.json()["available"])

    # ------------------------------------------------------------------ search & requests
    def test_search_finds_by_username_prefix_and_hides_email(self):
        results = self.get("/api/users/search?q=bol", self.ada).json()["results"]
        self.assertEqual([r["username"] for r in results], ["bola"])
        self.assertNotIn("email", results[0])
        self.assertEqual(results[0]["relationship"], "none")
        self.assertEqual(self.get("/api/users/search?q=adaobi", self.ada).json()["results"], [])  # not self

    def test_request_accept_flow_with_notifications_and_duplicate_prevention(self):
        sent = self.post("/api/friends/requests", self.ada, {"username": "bola"})
        self.assertEqual(sent.status_code, 201, sent.text)
        dup = self.post("/api/friends/requests", self.ada, {"username": "bola"})
        self.assertEqual(dup.json()["detail"]["code"], "request_exists")

        bola_view = self.get("/api/friends", self.bola).json()
        self.assertEqual(len(bola_view["incoming"]), 1)
        self.assertEqual(self.get("/api/friends", self.ada).json()["sent"][0]["user"]["username"], "bola")

        notes = self.get("/api/notifications", self.bola).json()
        self.assertEqual(notes["unread"], 1)
        self.assertEqual(notes["notifications"][0]["type"], "friend_request")
        self.assertEqual(notes["notifications"][0]["actor"]["username"], "adaobi")

        # The sender can't accept their own request.
        rid = sent.json()["request_id"]
        self.assertEqual(self.post(f"/api/friends/requests/{rid}/accept", self.ada).status_code, 403)
        self.assertEqual(self.post(f"/api/friends/requests/{rid}/accept", self.bola).status_code, 200)

        self.assertEqual(self.get("/api/friends", self.ada).json()["friends"][0]["username"], "bola")
        self.assertEqual(self.get("/api/notifications", self.ada).json()["notifications"][0]["type"], "friend_accepted")
        self.assertEqual(self.get("/api/notifications", self.bola).json()["unread"], 0)  # request marked read
        again = self.post("/api/friends/requests", self.bola, {"username": "adaobi"})
        self.assertEqual(again.json()["detail"]["code"], "already_friends")

    def test_mutual_requests_become_friends(self):
        self.post("/api/friends/requests", self.ada, {"username": "bola"})
        back = self.post("/api/friends/requests", self.bola, {"username": "adaobi"})
        self.assertEqual(back.json()["status"], "accepted")
        self.assertEqual(len(self.get("/api/friends", self.bola).json()["friends"]), 1)

    def test_decline_sets_cooldown_and_cancel_removes_request(self):
        rid = self.post("/api/friends/requests", self.ada, {"username": "bola"}).json()["request_id"]
        self.assertEqual(self.post(f"/api/friends/requests/{rid}/decline", self.bola).status_code, 200)
        retry = self.post("/api/friends/requests", self.ada, {"username": "bola"})
        self.assertEqual(retry.json()["detail"]["code"], "request_cooldown")

        rid = self.post("/api/friends/requests", self.bola, {"username": "adaobi"}).json()["request_id"]
        self.assertEqual(self.post(f"/api/friends/requests/{rid}/cancel", self.ada).status_code, 403)
        self.assertEqual(self.post(f"/api/friends/requests/{rid}/cancel", self.bola).status_code, 200)
        self.assertEqual(self.get("/api/friends", self.ada).json()["incoming"], [])

    def test_remove_friend_and_profile_privacy(self):
        profile = self.get("/api/users/bola", self.ada).json()
        self.assertEqual(profile["relationship"], "none")
        self.assertNotIn("activity", profile)  # strangers see no activity
        self.befriend(self.ada, self.bola)
        self.client.post("/api/workouts", json=self.workout_body(), headers=self.bola["h"])
        profile = self.get("/api/users/bola", self.ada).json()
        self.assertEqual(profile["activity"]["completed_workouts"], 1)
        self.assertNotIn("email", profile["user"])
        friend_id = self.bola["user"]["id"]
        self.assertEqual(self.client.delete(f"/api/friends/{friend_id}", headers=self.ada["h"]).status_code, 200)
        self.assertEqual(self.get("/api/friends", self.bola).json()["friends"], [])
        self.assertNotIn("activity", self.get("/api/users/bola", self.ada).json())

    # ------------------------------------------------------------------ blocking, reports, mutes
    def test_block_hides_user_and_prevents_requests(self):
        self.befriend(self.ada, self.bola)
        blocked = self.post("/api/blocks", self.bola, {"username": "adaobi"})
        self.assertEqual(blocked.status_code, 200)
        self.assertEqual(self.get("/api/friends", self.ada).json()["friends"], [])
        self.assertEqual(self.get("/api/friends", self.bola).json()["blocked"][0]["username"], "adaobi")
        # The blocked person can't find, view or re-request — and can't tell they were blocked.
        self.assertEqual(self.get("/api/users/search?q=bol", self.ada).json()["results"], [])
        self.assertEqual(self.get("/api/users/bola", self.ada).status_code, 404)
        req = self.post("/api/friends/requests", self.ada, {"username": "bola"})
        self.assertEqual((req.status_code, req.json()["detail"]["code"]), (404, "user_not_found"))
        # The blocker must unblock before sending.
        req = self.post("/api/friends/requests", self.bola, {"username": "adaobi"})
        self.assertEqual(req.json()["detail"]["code"], "you_blocked")
        self.client.delete(f"/api/blocks/{self.ada['user']['id']}", headers=self.bola["h"])
        self.assertEqual(self.post("/api/friends/requests", self.bola, {"username": "adaobi"}).status_code, 201)

    def test_report_and_mute(self):
        report = self.post("/api/reports", self.ada, {"username": "bola", "reason": "spam", "details": "ads",
                                                       "also_block": True})
        self.assertEqual(report.status_code, 201)
        self.assertEqual(self.get("/api/friends", self.ada).json()["blocked"][0]["username"], "bola")
        self.client.delete(f"/api/blocks/{self.bola['user']['id']}", headers=self.ada["h"])

        self.befriend(self.ada, self.bola)
        bola_id = self.bola["user"]["id"]
        self.assertEqual(self.post(f"/api/friends/{bola_id}/mute", self.ada).status_code, 200)
        self.assertTrue(self.get("/api/friends", self.ada).json()["friends"][0]["muted"])

    def test_notification_read_and_preferences(self):
        self.post("/api/friends/requests", self.ada, {"username": "bola"})
        nid = self.get("/api/notifications", self.bola).json()["notifications"][0]["id"]
        self.assertEqual(self.post("/api/notifications/read", self.bola, {"ids": [nid]}).json()["unread"], 0)

        prefs = self.client.put("/api/notification-preferences", headers=self.ada["h"], json={
            "preferences": [{"type": "friend_request", "in_app": False, "email": False}], "buddy_reminder_24h": True})
        self.assertEqual(prefs.status_code, 200, prefs.text)
        self.assertTrue(prefs.json()["buddy_reminder_24h"])
        self.post("/api/friends/requests", self.bola, {"username": "adaobi"})  # auto-accepts (mutual)
        types = [n["type"] for n in self.get("/api/notifications", self.ada).json()["notifications"]]
        self.assertNotIn("friend_request", types)

    def test_unauthenticated_access_is_rejected(self):
        for path in ("/api/friends", "/api/users/search?q=bo", "/api/notifications"):
            self.assertEqual(self.client.get(path).status_code, 401)


class DashboardTests(BuddiesTestCase):
    def setUp(self):
        super().setUp()
        self.ada = self.make_user("ada.obi@example.com", "Ada Obi")
        self.bola = self.make_user("bola@example.com", "Bola Ade")

    def get(self, path, who):
        return self.client.get(path, headers=who["h"])

    def test_dashboard_aggregates_everything_for_the_hub(self):
        self.befriend(self.ada, self.bola)
        self.client.post("/api/shared-sessions", headers=self.bola["h"], json={
            "friend_id": self.ada["user"]["id"], "exercise_id": "squats", "target": 15, "mode": "instant"})
        self.client.post("/api/workouts", json=self.workout_body(), headers=self.bola["h"])
        data = self.get("/api/buddies/dashboard", self.ada).json()
        self.assertEqual(data["friends"][0]["username"], "bola")
        self.assertIn("streak", data["friends"][0])
        self.assertEqual(len(data["invitations"]), 1)
        self.assertEqual(data["activity"][0]["exercise_name"], "Push-ups")
        self.assertNotIn("completed_reps", data["activity"][0])  # activity only, no workout details
        self.assertGreaterEqual(data["unread"]["notifications"], 1)
        # A stranger's activity never appears.
        stranger = self.make_user("chidi@example.com", "Chidi Eze")
        self.client.post("/api/workouts", json=self.workout_body(), headers=stranger["h"])
        names = [a["user"]["username"] for a in self.get("/api/buddies/dashboard", self.ada).json()["activity"]]
        self.assertNotIn(stranger["user"]["username"], names)
