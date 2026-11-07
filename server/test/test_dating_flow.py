import os
import re
import unittest
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgresql://localhost/test")
os.environ.setdefault("OTP_HASH_SECRET", "test-otp-secret-that-is-long-enough")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-that-is-long-enough")

from server.app.main import Settings, create_app
from server.app.security import hash_session_token


class FakeResult:
    def __init__(self, row=None, rows=None):
        self.row = row if row is not None else (rows[0] if rows else None)
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class FakeDatingConnection:
    def __init__(self, state):
        self.state = state

    def execute(self, query, parameters=()):
        sql = re.sub(r"\s+", " ", query).strip().lower()
        if "from posting_quota_settings" in sql:
            return FakeResult({"free_daily_dating_likes": self.state["free_daily_dating_likes"]})
        if sql.startswith("select liked from dating_swipes"):
            pair = tuple(map(str, parameters))
            return FakeResult({"liked": self.state["swipes"][pair]} if pair in self.state["swipes"] else None)
        if sql.startswith("select count(*) as used from dating_swipes"):
            user_id = str(parameters[0])
            used = sum(1 for (liker, _target), liked in self.state["swipes"].items()
                       if liker == user_id and liked)
            return FakeResult({"used": used})
        if sql.startswith("select entitlement.id"):
            user_id = str(parameters[0])
            available = self.state["extra_like_credits"].get(user_id, 0)
            return FakeResult({"id": "extra-like-{}".format(user_id)} if available > 0 else None)
        if sql.startswith("update dating_entitlements"):
            entitlement_id = str(parameters[0])
            user_id = entitlement_id.removeprefix("extra-like-")
            if user_id in self.state["extra_like_credits"]:
                self.state["extra_like_credits"][user_id] -= 1
            return FakeResult()
        if sql.startswith("select u.id") and "from auth_sessions" in sql:
            session = self.state["sessions"].get(parameters[0])
            if not session:
                return FakeResult()
            return FakeResult(self.state["users"][session["user_id"]].copy())
        if sql.startswith("select birth_date from dating_profiles"):
            profile = self.state["profiles"].get(str(parameters[0]))
            return FakeResult({"birth_date": profile["birth_date"]} if profile else None)
        if sql.startswith("select profile.user_id, profile.birth_date") and "from dating_profiles profile" in sql:
            profile = self.state["profiles"].get(str(parameters[0]))
            return FakeResult(self._public_profile_row(profile) if profile else None)
        if sql.startswith("select user_id from dating_profiles where user_id in"):
            return FakeResult(rows=[
                {"user_id": user_id}
                for user_id in sorted(map(str, parameters))
                if user_id in self.state["profiles"]
            ])
        if sql.startswith("insert into dating_profiles"):
            user_id, birth_date, gender, seeking, location, bio, interests, image_urls, active = parameters
            self.state["profiles"][str(user_id)] = {
                "user_id": str(user_id),
                "birth_date": birth_date,
                "gender": gender,
                "seeking": seeking,
                "location": location,
                "bio": bio,
                "interests": interests,
                "image_urls": image_urls,
                "active": active,
            }
            return FakeResult()
        if sql.startswith("select profile.user_id, profile.gender, profile.seeking"):
            profile = self.state["profiles"].get(str(parameters[0]))
            return FakeResult({
                key: profile[key] for key in ("user_id", "gender", "seeking", "active")
            } if profile and profile["active"] else None)
        if sql.startswith("select 1 from dating_blocks"):
            first, second, third, fourth = map(str, parameters)
            blocked = any(pair in self.state["blocks"] for pair in ((first, second), (third, fourth)))
            return FakeResult({"?column?": 1} if blocked else None)
        if sql.startswith("insert into dating_swipes"):
            user_id, target_user_id, liked = parameters
            self.state["swipes"][(str(user_id), str(target_user_id))] = liked
            return FakeResult()
        if sql.startswith("select 1 from dating_swipes"):
            user_id, target_user_id = map(str, parameters)
            liked = self.state["swipes"].get((user_id, target_user_id), False)
            return FakeResult({"?column?": 1} if liked else None)
        if sql.startswith("insert into dating_matches"):
            first, second = map(str, parameters[:2])
            first, second = sorted((first, second))
            key = (first, second)
            if key in self.state["matches"]:
                return FakeResult()
            match_id = str(uuid4())
            self.state["matches"][key] = {
                "id": match_id,
                "participant_one_id": first,
                "participant_two_id": second,
                "created_at": datetime.now(timezone.utc),
            }
            return FakeResult({"id": match_id})
        if sql.startswith("select id from dating_matches"):
            first, second = map(str, parameters[:2])
            match = self.state["matches"].get(tuple(sorted((first, second))))
            return FakeResult({"id": match["id"]} if match else None)
        if sql.startswith("select id, participant_one_id, participant_two_id from dating_matches"):
            match_id, user_one, user_two = map(str, parameters)
            match = next(
                (
                    item for item in self.state["matches"].values()
                    if item["id"] == match_id and user_one in {
                        item["participant_one_id"], item["participant_two_id"]
                    }
                ),
                None,
            )
            return FakeResult(match.copy() if match else None)
        if sql.startswith("select dating_match.id, dating_match.created_at"):
            user_id = str(parameters[0])
            rows = []
            for match in self.state["matches"].values():
                if user_id not in {match["participant_one_id"], match["participant_two_id"]}:
                    continue
                other_id = (
                    match["participant_two_id"]
                    if match["participant_one_id"] == user_id
                    else match["participant_one_id"]
                )
                profile = self.state["profiles"][other_id]
                user = self.state["users"][other_id]
                latest = next(
                    (item for item in reversed(self.state["messages"]) if item["match_id"] == match["id"]),
                    None,
                )
                rows.append({
                    **match,
                    "user_id": other_id,
                    "display_name": user["display_name"],
                    "username": user["username"],
                    **profile,
                    "last_message": latest["body"] if latest else None,
                    "last_message_at": latest["created_at"] if latest else None,
                })
            return FakeResult(rows=rows)
        if sql.startswith("insert into dating_messages"):
            match_id, sender_id, body = map(str, parameters)
            message = {
                "id": str(uuid4()),
                "match_id": match_id,
                "sender_id": sender_id,
                "body": body,
                "created_at": datetime.now(timezone.utc),
                "read_at": None,
            }
            self.state["messages"].append(message)
            return FakeResult({key: value for key, value in message.items() if key != "match_id"})
        if sql.startswith("select message.id, message.sender_id"):
            match_id, limit = map(str, parameters)
            messages = [
                {
                    "id": item["id"],
                    "sender_id": item["sender_id"],
                    "body": item["body"],
                    "created_at": item["created_at"],
                    "sender_name": self.state["users"][item["sender_id"]]["display_name"],
                }
                for item in self.state["messages"] if item["match_id"] == match_id
            ]
            return FakeResult(rows=messages[-int(limit):])
        if sql.startswith("update dating_messages"):
            return FakeResult()
        if sql.startswith("insert into dating_blocks"):
            self.state["blocks"].add(tuple(map(str, parameters)))
            return FakeResult()
        if sql.startswith("delete from dating_matches") and "returning id" not in sql:
            first, second, third, fourth = map(str, parameters)
            self.state["matches"].pop(tuple(sorted((first, second))), None)
            self.state["matches"].pop(tuple(sorted((third, fourth))), None)
            return FakeResult()
        if sql.startswith("delete from dating_matches") and "returning id" in sql:
            match_id, user_one, _ = map(str, parameters)
            key = next(
                (
                    key for key, item in self.state["matches"].items()
                    if item["id"] == match_id and user_one in key
                ),
                None,
            )
            match = self.state["matches"].pop(key) if key else None
            return FakeResult({"id": match_id} if match else None)
        raise AssertionError("Unexpected dating query: {}".format(query))

    def _public_profile_row(self, profile):
        return {
            **profile,
            "display_name": self.state["users"][profile["user_id"]]["display_name"],
            "username": self.state["users"][profile["user_id"]]["username"],
        }


class FakeDatingPool:
    def __init__(self):
        self.state = {
            "users": {},
            "sessions": {},
            "profiles": {},
            "swipes": {},
            "matches": {},
            "messages": [],
            "blocks": set(),
            "free_daily_dating_likes": 10,
            "extra_like_credits": {},
        }

    @contextmanager
    def connection(self):
        yield FakeDatingConnection(self.state)


class DatingFlowTests(unittest.TestCase):
    def setUp(self):
        self.pool = FakeDatingPool()
        self.user_ids = {
            "alice": "00000000-0000-0000-0000-000000000001",
            "bob": "00000000-0000-0000-0000-000000000002",
            "casey": "00000000-0000-0000-0000-000000000003",
        }
        for name, display_name in (("alice", "Alice"), ("bob", "Bob"), ("casey", "Casey")):
            user_id = self.user_ids[name]
            self.pool.state["users"][user_id] = {
                "id": user_id,
                "display_name": display_name,
                "username": name,
                "email": f"{name}@example.com",
                "bio": "",
                "interests": [],
                "profile_image_url": None,
                "email_verified_at": datetime.now(timezone.utc),
                "profile_visible": True,
                "discoverable": True,
                "suspended_at": None,
            }
        self.settings = Settings(
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
        self.client = TestClient(create_app(settings=self.settings, pool=self.pool))
        self.bob_client = TestClient(self.client.app)
        self.casey_client = TestClient(self.client.app)
        for name, client in (("alice", self.client), ("bob", self.bob_client), ("casey", self.casey_client)):
            token = f"dating-session-{name}"
            self.pool.state["sessions"][hash_session_token(token, self.settings.session_secret)] = {
                "user_id": self.user_ids[name],
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            }
            client.cookies.set("iconnect.sid", token)
        self.match_id = None

    def create_profile(self, client, gender, seeking):
        birth_date = date.today().replace(year=date.today().year - 25).isoformat()
        response = client.put("/api/dating/profile", json={
            "birth_date": birth_date,
            "gender": gender,
            "seeking": seeking,
            "location": "Lagos",
            "bio": "I enjoy live music and good food.",
            "interests": ["Music"],
            "image_urls": ["/api/media/images/{}.webp".format("b" * 32)],
            "active": True,
            "agree_to_adult_terms": True,
        })
        self.assertEqual(response.status_code, 200, response.text)

    def test_mutual_matches_have_a_separate_privately_gated_inbox(self):
        self.create_profile(self.client, "woman", "everyone")
        self.create_profile(self.bob_client, "man", "everyone")
        self.create_profile(self.casey_client, "man", "everyone")

        before_match = self.client.post(
            f"/api/dating/profiles/{self.user_ids['bob']}/swipe",
            json={"liked": True},
        )
        self.assertEqual(before_match.status_code, 200, before_match.text)
        self.assertFalse(before_match.json()["matched"])
        self.assertEqual(
            self.client.post("/api/dating/matches/00000000-0000-0000-0000-000000000099/messages", json={"text": "Hi"}).status_code,
            404,
        )

        mutual = self.bob_client.post(
            f"/api/dating/profiles/{self.user_ids['alice']}/swipe",
            json={"liked": True},
        )
        self.assertEqual(mutual.status_code, 200, mutual.text)
        self.assertTrue(mutual.json()["matched"])
        self.match_id = mutual.json()["match_id"]
        match_list = self.client.get("/api/dating/matches")
        self.assertEqual(match_list.status_code, 200, match_list.text)
        self.assertEqual(len(match_list.json()["matches"]), 1)
        self.assertNotIn("birth_date", match_list.json()["matches"][0]["profile"])

        sent = self.client.post(
            f"/api/dating/matches/{self.match_id}/messages",
            json={"text": "Hello from the dating inbox"},
        )
        self.assertEqual(sent.status_code, 201, sent.text)
        received = self.bob_client.get(f"/api/dating/matches/{self.match_id}/messages")
        self.assertEqual(received.status_code, 200, received.text)
        self.assertEqual(received.json()["messages"][0]["body"], "Hello from the dating inbox")

        outsider_read = self.casey_client.get(f"/api/dating/matches/{self.match_id}/messages")
        outsider_send = self.casey_client.post(
            f"/api/dating/matches/{self.match_id}/messages",
            json={"text": "I am not part of this match"},
        )
        self.assertEqual(outsider_read.status_code, 404)
        self.assertEqual(outsider_send.status_code, 404)

        paused = self.client.put("/api/dating/profile", json={
            "birth_date": None,
            "gender": "woman",
            "seeking": "everyone",
            "location": "Lagos",
            "bio": "I enjoy live music and good food.",
            "interests": ["Music"],
            "image_urls": ["/api/media/images/{}.webp".format("b" * 32)],
            "active": False,
            "agree_to_adult_terms": True,
        })
        self.assertEqual(paused.status_code, 200, paused.text)
        self.assertFalse(paused.json()["profile"]["active"])
        self.assertEqual(self.client.get("/api/dating/matches").status_code, 200)
        self.assertEqual(
            self.client.get(f"/api/dating/matches/{self.match_id}/messages").status_code,
            200,
        )

    def test_daily_free_likes_and_paid_like_credits(self):
        self.create_profile(self.client, "woman", "everyone")
        self.create_profile(self.bob_client, "man", "everyone")
        self.create_profile(self.casey_client, "man", "everyone")
        self.pool.state["free_daily_dating_likes"] = 1

        first_like = self.client.post(
            f"/api/dating/profiles/{self.user_ids['bob']}/swipe",
            json={"liked": True},
        )
        self.assertEqual(first_like.status_code, 200, first_like.text)

        over_limit = self.client.post(
            f"/api/dating/profiles/{self.user_ids['casey']}/swipe",
            json={"liked": True},
        )
        self.assertEqual(over_limit.status_code, 402)
        self.assertEqual(over_limit.json()["error"]["code"], "dating_likes_limit_reached")

        self.pool.state["extra_like_credits"][self.user_ids["alice"]] = 1
        paid_like = self.client.post(
            f"/api/dating/profiles/{self.user_ids['casey']}/swipe",
            json={"liked": True},
        )
        self.assertEqual(paid_like.status_code, 200, paid_like.text)
        self.assertEqual(self.pool.state["extra_like_credits"][self.user_ids["alice"]], 0)

        repeated_like = self.client.post(
            f"/api/dating/profiles/{self.user_ids['casey']}/swipe",
            json={"liked": True},
        )
        self.assertEqual(repeated_like.status_code, 200, repeated_like.text)
        self.assertEqual(self.pool.state["extra_like_credits"][self.user_ids["alice"]], 0)
