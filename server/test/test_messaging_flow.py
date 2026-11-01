import os
import re
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgresql://localhost/test")
os.environ.setdefault("OTP_HASH_SECRET", "test-otp-secret-that-is-long-enough")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-that-is-long-enough")

from server.app.main import Settings, create_app
from server.app.security import hash_session_token


class FakeResult:
    def __init__(self, row=None, rows=None):
        self.rows = rows or []
        self.row = row if row is not None else (self.rows[0] if self.rows else None)

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class FakeMessagingConnection:
    def __init__(self, state):
        self.state = state

    def execute(self, query, parameters=()):
        sql = re.sub(r"\s+", " ", query).strip().lower()
        if sql.startswith("select u.id") and "from auth_sessions" in sql:
            session = self.state["sessions"].get(parameters[0])
            if not session or session["expires_at"] <= datetime.now(timezone.utc):
                return FakeResult()
            return FakeResult(self.state["users"][session["user_id"]].copy())
        if sql.startswith("select id, display_name, username") and "from users" in sql:
            current_id, username_prefix, name_prefix, limit = parameters
            matches = [
                user.copy()
                for user in self.state["users"].values()
                if user["id"] != current_id
                and user["email_verified_at"]
                and user["profile_visible"]
                and user["discoverable"]
                and (
                    user["username"].lower().startswith(username_prefix[:-1])
                    or user["display_name"].lower().startswith(name_prefix[:-1])
                )
            ]
            return FakeResult(rows=matches[:limit])
        if sql.startswith("select person.id") and "from users person" in sql:
            (
                viewer_id,
                excluded_id,
                query_pattern,
                _username_pattern,
                _name_pattern,
                _interest_pattern,
                following_only,
                following_viewer_id,
                limit,
            ) = parameters
            matches = []
            for person in self.state["users"].values():
                if person["id"] == excluded_id or not person["email_verified_at"]:
                    continue
                if not person["profile_visible"] or not person["discoverable"]:
                    continue
                follows = (str(following_viewer_id), person["id"]) in self.state["follows"]
                if following_only and not follows:
                    continue
                if query_pattern:
                    search_term = query_pattern[:-1].replace("\\%", "%").replace("\\_", "_").replace("\\\\", "\\")
                    candidates = [
                        person["username"].lower(),
                        person["display_name"].lower(),
                        *[interest.lower() for interest in person.get("interests", [])],
                    ]
                    if not any(candidate.startswith(search_term) for candidate in candidates):
                        continue
                matches.append({
                    "id": person["id"],
                    "display_name": person["display_name"],
                    "username": person["username"],
                    "bio": person["bio"],
                    "interests": person["interests"],
                    "follower_count": sum(
                        following_id == person["id"]
                        for _, following_id in self.state["follows"]
                    ),
                    "following_count": sum(
                        follower_id == person["id"]
                        for follower_id, _ in self.state["follows"]
                    ),
                    "followed_by_me": (str(viewer_id), person["id"]) in self.state["follows"],
                })
            matches.sort(key=lambda item: (item["display_name"].lower(), item["username"].lower()))
            return FakeResult(rows=matches[:limit])
        if sql.startswith("select (select count(*) from user_follows"):
            person_id, follower_id = map(str, parameters)
            return FakeResult({
                "follower_count": sum(
                    following_id == person_id
                    for _, following_id in self.state["follows"]
                ),
                "following_count": sum(
                    current_follower == follower_id
                    for current_follower, _ in self.state["follows"]
                ),
            })
        if sql.startswith("insert into user_follows"):
            self.state["follows"].add(tuple(map(str, parameters)))
            return FakeResult()
        if sql.startswith("delete from user_follows"):
            self.state["follows"].discard(tuple(map(str, parameters)))
            return FakeResult()
        if sql.startswith("select id from users"):
            user = self.state["users"].get(str(parameters[0]))
            if user and user["email_verified_at"] and user["profile_visible"] and user["discoverable"]:
                return FakeResult({"id": user["id"]})
            return FakeResult()
        if sql.startswith("update users set profile_visible"):
            user = self.state["users"].get(str(parameters[2]))
            if not user:
                return FakeResult()
            user["profile_visible"] = parameters[0]
            user["discoverable"] = parameters[1]
            return FakeResult({
                "profile_visible": user["profile_visible"],
                "discoverable": user["discoverable"],
            })
        if sql.startswith("insert into direct_conversations"):
            first_id = str(min(str(parameters[0]), str(parameters[1])))
            second_id = str(max(str(parameters[0]), str(parameters[1])))
            conversation = next(
                (
                    item
                    for item in self.state["conversations"].values()
                    if item["participant_one_id"] == first_id
                    and item["participant_two_id"] == second_id
                ),
                None,
            )
            if conversation is None:
                conversation = {
                    "id": str(uuid4()),
                    "participant_one_id": first_id,
                    "participant_two_id": second_id,
                    "created_at": datetime.now(timezone.utc),
                }
                self.state["conversations"][conversation["id"]] = conversation
            return FakeResult({"id": conversation["id"]})
        if sql.startswith("select c.id, c.created_at"):
            viewer_id = str(parameters[0])
            rows = []
            for conversation in self.state["conversations"].values():
                participants = (conversation["participant_one_id"], conversation["participant_two_id"])
                if viewer_id not in participants:
                    continue
                other_id = next(participant for participant in participants if participant != viewer_id)
                messages = [
                    item
                    for item in self.state["messages"].values()
                    if item["conversation_id"] == conversation["id"]
                ]
                latest = max(messages, key=lambda item: (item["created_at"], item["id"])) if messages else None
                rows.append({
                    "id": conversation["id"],
                    "created_at": conversation["created_at"],
                    "recipient_id": other_id,
                    "recipient_name": self.state["users"][other_id]["display_name"],
                    "recipient_username": self.state["users"][other_id]["username"],
                    "last_message": latest["body"] if latest else None,
                    "last_message_at": latest["created_at"] if latest else None,
                    "unread_count": sum(
                        item["conversation_id"] == conversation["id"]
                        and item["recipient_id"] == viewer_id
                        and item["read_at"] is None
                        for item in self.state["messages"].values()
                    ),
                })
            rows.sort(key=lambda item: item["last_message_at"] or item["created_at"], reverse=True)
            return FakeResult(rows=rows)
        if sql.startswith("select id from direct_conversations"):
            conversation_id, viewer_id, _ = parameters
            conversation = self.state["conversations"].get(str(conversation_id))
            if conversation and str(viewer_id) in {
                conversation["participant_one_id"],
                conversation["participant_two_id"],
            }:
                return FakeResult({"id": conversation["id"]})
            return FakeResult()
        if sql.startswith("update direct_messages"):
            conversation_id, recipient_id = map(str, parameters)
            now = datetime.now(timezone.utc)
            for message in self.state["messages"].values():
                if (
                    message["conversation_id"] == conversation_id
                    and message["recipient_id"] == recipient_id
                    and message["read_at"] is None
                ):
                    message["read_at"] = now
            return FakeResult()
        if sql.startswith("insert into direct_messages"):
            sender_id = str(parameters[0])
            conversation_id = str(parameters[3])
            conversation = self.state["conversations"].get(conversation_id)
            if not conversation or sender_id not in {
                conversation["participant_one_id"],
                conversation["participant_two_id"],
            }:
                return FakeResult()
            recipient_id = next(
                participant
                for participant in (
                    conversation["participant_one_id"],
                    conversation["participant_two_id"],
                )
                if participant != sender_id
            )
            message = {
                "id": str(uuid4()),
                "conversation_id": conversation_id,
                "sender_id": sender_id,
                "recipient_id": recipient_id,
                "body": parameters[2],
                "created_at": datetime.now(timezone.utc),
                "read_at": None,
            }
            self.state["messages"][message["id"]] = message
            return FakeResult({"id": message["id"]})
        if sql.startswith("select message.id") and "where message.id = %s" in sql:
            message = self.state["messages"].get(str(parameters[0]))
            return FakeResult(self._message_row(message) if message else None)
        if sql.startswith("select message.id") and "from (" in sql:
            if "select id, body, created_at, read_at, sender_id from direct_messages" not in sql:
                raise AssertionError("Message query must expose read_at from its subquery.")
            conversation_id, limit = str(parameters[0]), parameters[1]
            messages = [
                item
                for item in self.state["messages"].values()
                if item["conversation_id"] == conversation_id
            ]
            messages.sort(key=lambda item: (item["created_at"], item["id"]), reverse=True)
            messages = messages[:limit]
            messages.sort(key=lambda item: (item["created_at"], item["id"]))
            return FakeResult(rows=[self._message_row(item) for item in messages])
        raise AssertionError("Unexpected database query: {}".format(query))

    def _message_row(self, message):
        sender = self.state["users"][message["sender_id"]]
        return {
            "id": message["id"],
            "body": message["body"],
            "created_at": message["created_at"],
            "read_at": message["read_at"],
            "sender_id": message["sender_id"],
            "display_name": sender["display_name"],
            "username": sender["username"],
        }


class FakeMessagingPool:
    def __init__(self):
        self.state = {
            "users": {},
            "sessions": {},
            "conversations": {},
            "messages": {},
            "follows": set(),
        }

    @contextmanager
    def connection(self):
        yield FakeMessagingConnection(self.state)


class MessagingFlowTests(unittest.TestCase):
    def setUp(self):
        self.pool = FakeMessagingPool()
        self.user_ids = {
            "alice": str(uuid4()),
            "bob": str(uuid4()),
            "casey": str(uuid4()),
        }
        for key, name, username in (
            ("alice", "Alice Example", "alice"),
            ("bob", "Bob Example", "bob"),
            ("casey", "Casey Example", "casey"),
        ):
            user_id = self.user_ids[key]
            self.pool.state["users"][user_id] = {
                "id": user_id,
                "display_name": name,
                "username": username,
                "email": "{}@example.com".format(username),
                "bio": "",
                "interests": [],
                "profile_visible": True,
                "discoverable": True,
                "email_verified_at": datetime.now(timezone.utc),
            }
        settings = Settings(
            app_origin="http://localhost:5173",
            api_host="127.0.0.1",
            api_port=10000,
            database_url="postgresql://localhost/test",
            email_from="",
            environment="development",
            otp_hash_secret="test-otp-secret-that-is-long-enough",
            production=False,
            resend_api_key="",
            session_max_age_days=7,
            session_secret="test-session-secret-that-is-long-enough",
            trust_proxy=0,
            admin_emails=frozenset(),
        )
        self.client = TestClient(create_app(settings=settings, pool=self.pool))
        self.bob_client = TestClient(create_app(settings=settings, pool=self.pool))
        self.casey_client = TestClient(create_app(settings=settings, pool=self.pool))
        for key, client in (
            ("alice", self.client),
            ("bob", self.bob_client),
            ("casey", self.casey_client),
        ):
            token = "session-token-{}".format(key)
            self.pool.state["sessions"][hash_session_token(token, settings.session_secret)] = {
                "user_id": self.user_ids[key],
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            }
            client.cookies.set("iconnect.sid", token)

    def test_authenticated_direct_messaging_and_conversation_privacy(self):
        anonymous = TestClient(self.client.app)
        self.assertEqual(anonymous.get("/api/messages/conversations").status_code, 401)
        self.assertEqual(anonymous.get("/api/messages/users?query=bo").status_code, 401)

        found = self.client.get("/api/messages/users?query=%40bo")
        self.assertEqual(found.status_code, 200)
        self.assertEqual(len(found.json()["users"]), 1)
        recipient = found.json()["users"][0]
        self.assertEqual(recipient["username"], "bob")
        self.assertNotIn("email", recipient)
        wildcard_search = self.client.get("/api/messages/users?query=%25_")
        self.assertEqual(wildcard_search.json()["users"], [])

        self_conversation = self.client.post("/api/messages/conversations", json={
            "recipient_id": self.user_ids["alice"],
        })
        self.assertEqual(self_conversation.status_code, 400)
        missing_user = self.client.post("/api/messages/conversations", json={
            "recipient_id": str(uuid4()),
        })
        self.assertEqual(missing_user.status_code, 404, missing_user.text)

        created = self.client.post("/api/messages/conversations", json={
            "recipient_id": recipient["id"],
        })
        self.assertEqual(created.status_code, 201)
        conversation_id = created.json()["conversationId"]
        created_again = self.client.post("/api/messages/conversations", json={
            "recipient_id": recipient["id"],
        })
        self.assertEqual(created_again.json()["conversationId"], conversation_id)

        message_url = "/api/messages/conversations/{}/messages".format(conversation_id)
        self.assertEqual(self.client.post(message_url, json={"text": "   "}).status_code, 400)
        sent = self.client.post(message_url, json={"text": "  Hello, Bob!  "})
        self.assertEqual(sent.status_code, 201)
        self.assertEqual(sent.json()["message"]["text"], "Hello, Bob!")
        self.assertTrue(sent.json()["message"]["isMine"])
        self.assertIsNone(sent.json()["message"]["readAt"])

        bob_conversations = self.bob_client.get("/api/messages/conversations").json()["conversations"]
        self.assertEqual(len(bob_conversations), 1)
        self.assertEqual(bob_conversations[0]["unreadCount"], 1)

        received = self.bob_client.get(message_url)
        self.assertEqual(received.status_code, 200)
        self.assertEqual(received.json()["messages"][0]["text"], "Hello, Bob!")
        self.assertFalse(received.json()["messages"][0]["isMine"])
        self.assertIsNotNone(received.json()["messages"][0]["readAt"])
        alice_view = self.client.get(message_url)
        self.assertTrue(alice_view.json()["messages"][0]["isMine"])
        self.assertIsNotNone(alice_view.json()["messages"][0]["readAt"])
        self.assertEqual(
            self.bob_client.get("/api/messages/conversations").json()["conversations"][0]["unreadCount"],
            0,
        )

        forbidden_read = self.casey_client.get(message_url)
        forbidden_send = self.casey_client.post(message_url, json={"text": "Not a participant"})
        self.assertEqual(forbidden_read.status_code, 404)
        self.assertEqual(forbidden_send.status_code, 404)

    def test_account_discovery_and_repeat_safe_follow_updates(self):
        anonymous = TestClient(self.client.app)
        self.assertEqual(anonymous.get("/api/people").status_code, 401)

        discovered = self.client.get("/api/people")
        self.assertEqual(discovered.status_code, 200)
        people = discovered.json()["people"]
        self.assertEqual(len(people), 2)
        bob = next(person for person in people if person["username"] == "bob")
        self.assertNotIn("email", bob)
        self.assertFalse(bob["followedByMe"])

        searched = self.client.get("/api/people?query=%40bo")
        self.assertEqual([person["id"] for person in searched.json()["people"]], [self.user_ids["bob"]])
        wildcard = self.client.get("/api/people?query=%25_")
        self.assertEqual(wildcard.json()["people"], [])
        self.assertEqual(self.client.get("/api/people?query=x").status_code, 400)

        hidden = self.bob_client.put("/api/auth/preferences", json={
            "profile_visible": False,
            "discoverable": True,
        })
        self.assertEqual(hidden.status_code, 200)
        self.assertNotIn(
            self.user_ids["bob"],
            [person["id"] for person in self.client.get("/api/people").json()["people"]],
        )
        self.assertNotIn(
            self.user_ids["bob"],
            [person["id"] for person in self.client.get("/api/messages/users?query=bo").json()["users"]],
        )
        hidden_conversation = self.client.post("/api/messages/conversations", json={
            "recipient_id": self.user_ids["bob"],
        })
        self.assertEqual(hidden_conversation.status_code, 404)
        self.assertEqual(self.bob_client.get("/api/auth/me").json()["user"]["profileVisible"], False)
        self.assertEqual(self.bob_client.put("/api/auth/preferences", json={
            "profile_visible": True,
            "discoverable": False,
        }).status_code, 200)
        self.assertNotIn(
            self.user_ids["bob"],
            [person["id"] for person in self.client.get("/api/people").json()["people"]],
        )
        self.assertEqual(self.bob_client.put("/api/auth/preferences", json={
            "profile_visible": True,
            "discoverable": True,
        }).status_code, 200)

        follow_url = "/api/people/{}/follow".format(self.user_ids["bob"])
        followed = self.client.put(follow_url, json={"following": True})
        self.assertEqual(followed.status_code, 200)
        self.assertEqual(followed.json()["followerCount"], 1)
        followed_again = self.client.put(follow_url, json={"following": True})
        self.assertEqual(followed_again.json()["followerCount"], 1)

        following_people = self.client.get("/api/people?following_only=true").json()["people"]
        self.assertEqual([person["id"] for person in following_people], [self.user_ids["bob"]])
        self.assertTrue(following_people[0]["followedByMe"])

        self_follow = self.client.put(
            "/api/people/{}/follow".format(self.user_ids["alice"]),
            json={"following": True},
        )
        self.assertEqual(self_follow.status_code, 400)
        missing_person = self.client.put(
            "/api/people/{}/follow".format(uuid4()),
            json={"following": True},
        )
        self.assertEqual(missing_person.status_code, 404)

        unfollowed = self.client.put(follow_url, json={"following": False})
        self.assertEqual(unfollowed.status_code, 200)
        self.assertEqual(unfollowed.json()["followerCount"], 0)
        self.assertEqual(
            self.client.get("/api/people?following_only=true").json()["people"],
            [],
        )


if __name__ == "__main__":
    unittest.main()
