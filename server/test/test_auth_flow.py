import re
import os
import json
import logging
import unittest
import tempfile
from contextlib import contextmanager
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
os.environ.setdefault("OTP_HASH_SECRET", "test-otp-secret-that-is-long-enough")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-that-is-long-enough")

from server.app.main import Settings, _send_otp_email, create_app
from server.app.security import hash_email_code


class FakeResult:
    def __init__(self, row=None, rows=None, rowcount=None):
        self.rows = rows or []
        self.row = row if row is not None else (self.rows[0] if self.rows else None)
        self.rowcount = rowcount if rowcount is not None else (1 if row else 0)

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self, state):
        self.state = state

    @contextmanager
    def transaction(self):
        yield self

    def execute(self, query, parameters=()):
        sql = re.sub(r"\s+", " ", query).strip().lower()
        if sql.startswith("insert into admin_audit_log"):
            event = {
                "id": str(uuid4()),
                "admin_user_id": str(parameters[0]),
                "subject_user_id": str(parameters[1]),
                "action": "view_user_details",
                "created_at": datetime.now(timezone.utc),
            }
            self.state["admin_audit"].append(event)
            return FakeResult({"id": event["id"]})
        if "from admin_audit_log log" in sql:
            return FakeResult(rows=[
                {
                    "id": event["id"],
                    "action": event["action"],
                    "created_at": event["created_at"],
                    "admin_id": self.state["user"]["id"],
                    "admin_name": self.state["user"]["display_name"],
                    "admin_email": self.state["user"]["email"],
                    "subject_id": event["subject_user_id"],
                    "subject_name": self.state["user"]["display_name"],
                    "subject_email": self.state["user"]["email"],
                }
                for event in reversed(self.state["admin_audit"])
            ][:parameters[0]])
        if sql.startswith("select (select count(*) from users) as users"):
            return FakeResult({
                "users": 1,
                "verified_users": 1,
                "posts": 0,
                "comments": 0,
                "likes": 0,
                "bookmarks": 0,
                "messages": 1,
                "products": 0,
                "local_listings": 0,
                "jobs": 0,
                "applications": 0,
                "communities": 0,
                "memberships": 0,
            })
        if sql.startswith("select count(*) as total from users u"):
            return FakeResult({"total": 1})
        if sql.startswith("select u.id") and "from users u" in sql and "order by u.created_at" in sql:
            return FakeResult(rows=[self._admin_user_row()])
        if (
            sql.startswith("select id, display_name, username, email, bio, interests, profile_visible")
            and "from users where id = %s" in sql
        ):
            user = self.state["user"]
            return FakeResult(user.copy() if user and str(user["id"]) == str(parameters[0]) else None)
        if sql.startswith("select (select count(*) from social_posts where user_id"):
            return FakeResult({
                "posts": 0,
                "comments": 0,
                "likes": 0,
                "bookmarks": 0,
                "messages": 1,
                "products": 0,
                "local_listings": 0,
                "jobs": 0,
                "applications": 0,
                "communities_created": 0,
                "communities_joined": 0,
                "following": 0,
                "followers": 0,
            })
        if "from community_memberships membership" in sql:
            return FakeResult(rows=[])
        if "from communities c where c.owner_id = %s" in sql:
            return FakeResult(rows=[])
        if sql.startswith("select m.id, m.conversation_id") and "from direct_messages m" in sql:
            user = self.state["user"]
            return FakeResult(rows=[{
                "id": "00000000-0000-0000-0000-000000000099",
                "conversation_id": "00000000-0000-0000-0000-000000000098",
                "body": "Private test message",
                "created_at": datetime.now(timezone.utc),
                "read_at": None,
                "sender_id": user["id"],
                "sender_name": user["display_name"],
                "sender_username": user["username"],
                "recipient_id": user["id"],
                "recipient_name": user["display_name"],
                "recipient_username": user["username"],
            }])
        if any(sql.startswith(prefix) for prefix in (
            "select l.created_at, p.id as post_id",
            "select b.created_at, p.id as post_id",
            "select id, name, category, price, stock",
            "select id, category, title, price, location",
            "select id, title, company, location, employment_type",
            "select a.id, a.job_id, a.cover_letter",
            "select followed.id, followed.display_name",
            "select follower.id, follower.display_name",
        )):
            return FakeResult(rows=[])
        if sql.startswith("insert into social_posts"):
            post = {
                "id": str(uuid4()),
                "user_id": str(parameters[0]),
                "body": parameters[1],
                "image_urls": parameters[2],
                "created_at": datetime.now(timezone.utc),
            }
            self.state["posts"].append(post)
            return FakeResult({"id": post["id"]})
        if sql.startswith("insert into marketplace_products"):
            product = {
                "id": str(uuid4()),
                "seller_id": str(parameters[0]),
                "name": parameters[1],
                "category": parameters[2],
                "price": parameters[3],
                "stock": parameters[4],
                "description": parameters[5],
                "image_url": parameters[6],
                "image_urls": parameters[7],
                "created_at": datetime.now(timezone.utc),
                "published": True,
            }
            self.state["products"].append(product)
            return FakeResult({"id": product["id"]})
        if sql.startswith("insert into local_marketplace_listings"):
            listing = {
                "id": str(uuid4()),
                "seller_id": str(parameters[0]),
                "category": parameters[1],
                "title": parameters[2],
                "price": parameters[3],
                "location": parameters[4],
                "detail": parameters[5],
                "description": parameters[6],
                "image_url": parameters[7],
                "created_at": datetime.now(timezone.utc),
                "published": True,
            }
            self.state["local_listings"].append(listing)
            return FakeResult({"id": listing["id"]})
        if sql.startswith("insert into communities"):
            community = {
                "id": str(uuid4()),
                "owner_id": str(parameters[0]),
                "name": parameters[1],
                "description": parameters[2],
                "created_at": datetime.now(timezone.utc),
            }
            self.state["communities"].append(community)
            return FakeResult({"id": community["id"]})
        if sql.startswith("insert into community_memberships"):
            self.state["community_memberships"].add((str(parameters[0]), str(parameters[1])))
            return FakeResult(rowcount=1)
        if sql.startswith("delete from community_memberships"):
            self.state["community_memberships"].discard((str(parameters[0]), str(parameters[1])))
            return FakeResult(rowcount=1)
        if sql.startswith("select c.id") and "from communities c" in sql:
            if "where c.id = %s" in sql:
                viewer_id, community_id = parameters
                communities = [
                    item for item in self.state["communities"]
                    if item["id"] == str(community_id)
                ]
            else:
                viewer_id, search, _, _, limit = parameters
                communities = self.state["communities"]
                if search:
                    search_text = search.strip("%").lower()
                    communities = [
                        item for item in communities
                        if search_text in item["name"].lower()
                        or search_text in item["description"].lower()
                    ]
                communities = sorted(
                    communities,
                    key=lambda item: item["created_at"],
                    reverse=True,
                )[:limit]
            return FakeResult(rows=[
                self._community_row(item, viewer_id)
                for item in communities
            ])
        if sql.startswith("select id from communities where id = %s"):
            community = next(
                (item for item in self.state["communities"] if item["id"] == str(parameters[0])),
                None,
            )
            return FakeResult({"id": community["id"]} if community else None)
        if sql.startswith("select l.id") and "from local_marketplace_listings l" in sql:
            listings = self.state["local_listings"]
            if "where l.id = %s" in sql:
                listing_id = str(parameters[0])
                listings = [
                    item for item in listings
                    if item["id"] == listing_id and item["published"]
                ]
            else:
                if "l.category = %s" in sql:
                    listings = [item for item in listings if item["category"] == parameters[0]]
                if "lower(l.title) like" in sql:
                    search_index = 1 if "l.category = %s" in sql else 0
                    search = parameters[search_index].strip("%").lower()
                    listings = [
                        item for item in listings
                        if search in item["title"].lower()
                        or search in item["description"].lower()
                        or search in item["detail"].lower()
                        or search in "local seller"
                        or search in "localseller"
                    ]
                if "lower(l.location) like" in sql:
                    location = parameters[-2].strip("%").lower()
                    listings = [item for item in listings if location in item["location"].lower()]
                listings = sorted(
                    listings,
                    key=lambda item: item["created_at"],
                    reverse=True,
                )[:parameters[-1]]
            return FakeResult(rows=[self._local_marketplace_listing_row(item) for item in listings])
        if sql.startswith("select p.id") and "from marketplace_products p" in sql:
            products = self.state["products"]
            if "where p.id = %s" in sql:
                product_id = str(parameters[0])
                products = [
                    item for item in products
                    if item["id"] == product_id and item["published"]
                ]
            else:
                if "p.category = %s" in sql:
                    products = [item for item in products if item["category"] == parameters[0]]
                products = sorted(
                    products,
                    key=lambda item: item["created_at"],
                    reverse=True,
                )[:parameters[-1]]
            return FakeResult(rows=[self._marketplace_product_row(item) for item in products])
        if sql.startswith("select p.id") and "from social_posts p" in sql:
            if "where p.user_id = %s" in sql:
                post_ids = [
                    post["id"] for post in self.state["posts"]
                    if post["user_id"] == str(parameters[0])
                ]
                viewer_id = str(parameters[0])
            elif "where p.id = %s" in sql:
                post_ids = [str(parameters[-1])]
                viewer_id = str(parameters[0])
            else:
                post_ids = [post["id"] for post in self.state["posts"]]
                viewer_id = str(parameters[0])
                if "bookmark_filter.user_id" in sql and parameters[4]:
                    post_ids = [
                        post_id for post_id in post_ids
                        if (post_id, str(parameters[5])) in self.state["bookmarks"]
                    ]
            rows = [
                self._social_post_row(post, viewer_id)
                for post in self.state["posts"]
                if post["id"] in post_ids
            ]
            rows.sort(key=lambda row: row["created_at"], reverse=True)
            if "limit %s" in sql:
                if "where p.user_id = %s" in sql:
                    rows = rows[parameters[2]:parameters[2] + parameters[1]]
                else:
                    rows = rows[:parameters[-1]]
            return FakeResult(rows=rows)
        if sql.startswith("select id from social_posts"):
            post = next(
                (item for item in self.state["posts"] if item["id"] == str(parameters[0])),
                None,
            )
            return FakeResult({"id": post["id"]} if post else None)
        if sql.startswith("insert into social_post_likes"):
            self.state["likes"].add((str(parameters[0]), str(parameters[1])))
            return FakeResult(rowcount=1)
        if sql.startswith("delete from social_post_likes"):
            self.state["likes"].discard((str(parameters[0]), str(parameters[1])))
            return FakeResult(rowcount=1)
        if sql.startswith("insert into social_post_bookmarks"):
            self.state["bookmarks"].add((str(parameters[0]), str(parameters[1])))
            return FakeResult(rowcount=1)
        if sql.startswith("delete from social_post_bookmarks"):
            self.state["bookmarks"].discard((str(parameters[0]), str(parameters[1])))
            return FakeResult(rowcount=1)
        if sql.startswith("insert into social_post_comments"):
            post_id = str(parameters[2])
            if not any(post["id"] == post_id for post in self.state["posts"]):
                return FakeResult()
            comment = {
                "id": str(uuid4()),
                "post_id": post_id,
                "user_id": str(parameters[0]),
                "body": parameters[1],
                "created_at": datetime.now(timezone.utc),
            }
            self.state["comments"].append(comment)
            return FakeResult({"id": comment["id"]})
        if "from social_post_comments c" in sql:
            if "where c.id = %s" in sql:
                comments = [
                    item for item in self.state["comments"]
                    if item["id"] == str(parameters[0])
                ]
            else:
                comments = [
                    item for item in self.state["comments"]
                    if item["post_id"] == str(parameters[0])
                ]
                comments.sort(key=lambda item: item["created_at"])
                comments = comments[:parameters[-1]]
            return FakeResult(rows=[self._social_comment_row(item) for item in comments])
        if sql.startswith("insert into users"):
            if self.state["user"] and self.state["user"]["email"] == parameters[2]:
                return FakeResult()
            self.state["user"] = {
                "id": "00000000-0000-0000-0000-000000000001",
                "display_name": parameters[0],
                "username": parameters[1],
                "email": parameters[2],
                "password_hash": parameters[3],
                "bio": "",
                "interests": [],
                "profile_visible": True,
                "discoverable": True,
                "email_verified_at": None,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
            return FakeResult({
                "id": self.state["user"]["id"],
                "display_name": self.state["user"]["display_name"],
                "email": self.state["user"]["email"],
            })
        if sql.startswith("insert into email_verification_codes"):
            self.state["verification"] = {
                "user_id": parameters[0],
                "code_hash": parameters[1],
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
                "attempts": 0,
            }
            return FakeResult({"user_id": parameters[0]})
        if sql.startswith("select u.id") and "join email_verification_codes" in sql:
            user = self.state["user"]
            verification = self.state["verification"]
            if not user or not verification or user["email"] != parameters[0]:
                return FakeResult()
            return FakeResult({**user, **verification})
        if sql.startswith("select u.id") and "from auth_sessions" in sql:
            session = self.state["sessions"].get(parameters[0])
            user = self.state["user"]
            if (
                session
                and session["expires_at"] > datetime.now(timezone.utc)
                and user
                and user["email_verified_at"]
            ):
                return FakeResult(user.copy())
            return FakeResult()
        if sql.startswith("update email_verification_codes set attempts"):
            self.state["verification"]["attempts"] += 1
            return FakeResult(rowcount=1)
        if sql.startswith("update users set email_verified_at"):
            self.state["user"]["email_verified_at"] = datetime.now(timezone.utc)
            return FakeResult(rowcount=1)
        if sql.startswith("delete from email_verification_codes"):
            self.state["verification"] = None
            return FakeResult(rowcount=1)
        if (
            sql.startswith("select id, display_name, username, email, bio, interests,")
            and "password_hash" in sql
        ):
            user = self.state["user"]
            return FakeResult(user.copy() if user and user["email"] == parameters[0] else None)
        if sql.startswith("select id, display_name, email from users"):
            user = self.state["user"]
            if user and user["email"] == parameters[0] and not user["email_verified_at"]:
                return FakeResult({
                    "id": user["id"],
                    "display_name": user["display_name"],
                    "email": user["email"],
                })
            return FakeResult()
        if sql.startswith("update users set display_name"):
            user = self.state["user"]
            if not user or user["id"] != parameters[4] or not user["email_verified_at"]:
                return FakeResult()
            user.update({
                "display_name": parameters[0],
                "username": parameters[1],
                "bio": parameters[2],
                "interests": parameters[3],
            })
            return FakeResult(user.copy())
        if sql.startswith("update users set profile_visible"):
            user = self.state["user"]
            if not user or user["id"] != parameters[2] or not user["email_verified_at"]:
                return FakeResult()
            user["profile_visible"] = parameters[0]
            user["discoverable"] = parameters[1]
            return FakeResult({
                "profile_visible": user["profile_visible"],
                "discoverable": user["discoverable"],
            })
        if sql.startswith("insert into auth_sessions"):
            self.state["sessions"][parameters[0]] = {
                "user_id": parameters[1],
                "expires_at": parameters[2],
            }
            return FakeResult(rowcount=1)
        if sql.startswith("delete from auth_sessions where expires_at"):
            now = datetime.now(timezone.utc)
            self.state["sessions"] = {
                token: session
                for token, session in self.state["sessions"].items()
                if session["expires_at"] > now
            }
            return FakeResult(rowcount=1)
        if sql.startswith("delete from auth_sessions"):
            self.state["sessions"].pop(parameters[0], None)
            return FakeResult(rowcount=1)
        if sql.startswith("select 1"):
            return FakeResult({"?column?": 1})
        raise AssertionError("Unexpected database query: {}".format(query))

    def _social_post_row(self, post, viewer_id):
        user = self.state["user"]
        return {
            "id": post["id"],
            "body": post["body"],
            "image_urls": post["image_urls"],
            "created_at": post["created_at"],
            "author_id": user["id"],
            "display_name": user["display_name"],
            "username": user["username"],
            "like_count": sum(like[0] == post["id"] for like in self.state["likes"]),
            "comment_count": sum(comment["post_id"] == post["id"] for comment in self.state["comments"]),
            "liked_by_me": (post["id"], viewer_id) in self.state["likes"],
            "bookmarked_by_me": (post["id"], viewer_id) in self.state["bookmarks"],
        }

    def _marketplace_product_row(self, product):
        user = self.state["user"]
        return {
            "id": product["id"],
            "name": product["name"],
            "category": product["category"],
            "price": product["price"],
            "stock": product["stock"],
            "description": product["description"],
            "image_url": product["image_url"],
            "image_urls": product["image_urls"],
            "created_at": product["created_at"],
            "seller_id": user["id"],
            "seller_name": user["display_name"],
            "seller_username": user["username"],
        }

    def _local_marketplace_listing_row(self, listing):
        user = self.state["user"]
        return {
            "id": listing["id"],
            "category": listing["category"],
            "title": listing["title"],
            "price": listing["price"],
            "location": listing["location"],
            "detail": listing["detail"],
            "description": listing["description"],
            "image_url": listing["image_url"],
            "created_at": listing["created_at"],
            "seller_id": user["id"],
            "seller_name": user["display_name"],
            "seller_username": user["username"],
        }

    def _community_row(self, community, viewer_id):
        return {
            "id": community["id"],
            "name": community["name"],
            "description": community["description"],
            "created_at": community["created_at"],
            "member_count": sum(
                membership[0] == community["id"]
                for membership in self.state["community_memberships"]
            ),
            "joined_by_me": (community["id"], str(viewer_id)) in self.state["community_memberships"],
        }

    def _admin_user_row(self):
        user = self.state["user"]
        return {
            "id": user["id"],
            "display_name": user["display_name"],
            "username": user["username"],
            "email": user["email"],
            "bio": user["bio"],
            "interests": user["interests"],
            "profile_visible": user["profile_visible"],
            "discoverable": user["discoverable"],
            "email_verified_at": user["email_verified_at"],
            "created_at": user["created_at"],
            "updated_at": user["updated_at"],
            "posts": 0,
            "comments": 0,
            "messages": 1,
            "products": 0,
            "local_listings": 0,
            "jobs": 0,
            "applications": 0,
        }

    def _social_comment_row(self, comment):
        user = self.state["user"]
        return {
            "id": comment["id"],
            "body": comment["body"],
            "created_at": comment["created_at"],
            "author_id": user["id"],
            "display_name": user["display_name"],
            "username": user["username"],
        }


class FakePool:
    def __init__(self):
        self.state = {
            "user": None,
            "verification": None,
            "sessions": {},
            "posts": [],
            "products": [],
            "local_listings": [],
            "communities": [],
            "community_memberships": set(),
            "admin_audit": [],
            "likes": set(),
            "bookmarks": set(),
            "comments": [],
        }

    @contextmanager
    def connection(self):
        yield FakeConnection(self.state)


class AuthFlowTests(unittest.TestCase):
    def setUp(self):
        self.pool = FakePool()
        self.delivered_code = ""

        def send_email(email, _name, code):
            self.assertEqual(email, "new@example.com")
            self.delivered_code = code

        settings = Settings(
            app_origin="http://localhost:5173",
            api_host="127.0.0.1",
            api_port=10000,
            database_url="postgresql://test:test@localhost/test",
            email_from="",
            environment="development",
            otp_hash_secret="test-otp-secret-that-is-long-enough",
            production=False,
            resend_api_key="",
            session_max_age_days=7,
            session_secret="test-session-secret-that-is-long-enough",
            trust_proxy=0,
            admin_emails=frozenset({"new@example.com"}),
        )
        self.media_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.media_tmp.cleanup)
        self.settings = settings
        self.client = TestClient(create_app(
            settings=settings,
            pool=self.pool,
            send_otp_email=send_email,
            media_directory=Path(self.media_tmp.name),
        ))

    def test_resend_request_identifies_the_api_client(self):
        settings = Settings(
            app_origin="https://www.iconnectdworld.com",
            api_host="127.0.0.1",
            api_port=10000,
            database_url="postgresql://localhost/test",
            email_from="iConnect <no-reply@mail.iconnectdworld.com>",
            environment="production",
            otp_hash_secret="test-otp-secret-that-is-long-enough",
            production=True,
            resend_api_key="test-resend-key",
            session_max_age_days=7,
            session_secret="test-session-secret-that-is-long-enough",
            trust_proxy=1,
            admin_emails=frozenset(),
        )
        with patch("server.app.main.urllib.request.urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value.status = 200
            _send_otp_email(
                "recipient@example.com",
                "<Test User>",
                "123456",
                settings,
                logging.getLogger("test"),
            )
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("User-agent"), "iConnect-API/1.0")
        payload = json.loads(request.data.decode("utf-8"))
        self.assertIn("You’re almost home, &lt;Test User&gt;.", payload["html"])
        self.assertIn("YOUR VERIFICATION CODE", payload["html"])
        self.assertIn(">123456</div>", payload["html"])
        self.assertIn("expires in 10 minutes", payload["html"])

    def test_signup_verify_login_profile_and_logout(self):
        invalid_signup = self.client.post("/api/auth/register", json={
            "name": "New User",
            "email": "new@example.com",
            "password": "short",
        })
        self.assertEqual(invalid_signup.status_code, 400)
        self.assertEqual(invalid_signup.json()["error"]["code"], "invalid_input")

        signup = self.client.post("/api/auth/register", json={
            "name": " New User ",
            "email": "New@Example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        self.assertRegex(self.delivered_code, r"^\d{6}$")
        self.assertEqual(
            self.pool.state["verification"]["code_hash"],
            hash_email_code(self.delivered_code, "test-otp-secret-that-is-long-enough"),
        )
        self.assertNotEqual(self.pool.state["verification"]["code_hash"], self.delivered_code)

        unverified_login = self.client.post("/api/auth/login", json={
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(unverified_login.status_code, 403)

        invalid_code = "000000" if self.delivered_code != "000000" else "000001"
        failed_verify = self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": invalid_code,
        })
        self.assertEqual(failed_verify.status_code, 400)
        self.assertEqual(self.pool.state["verification"]["attempts"], 1)

        verified = self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })
        self.assertEqual(verified.status_code, 200)
        self.assertEqual(verified.json()["user"]["name"], "New User")
        self.assertIn("iconnect.sid", verified.headers["set-cookie"])

        current_user = self.client.get("/api/auth/me")
        self.assertEqual(current_user.status_code, 200)
        self.assertEqual(current_user.json()["user"]["username"], "new")
        self.assertTrue(current_user.json()["user"]["profileVisible"])
        privacy = self.client.put("/api/auth/preferences", json={
            "profile_visible": False,
            "discoverable": False,
        })
        self.assertEqual(privacy.status_code, 200)
        self.assertFalse(privacy.json()["preferences"]["profileVisible"])
        self.assertFalse(self.client.get("/api/auth/me").json()["user"]["discoverable"])

        profile = self.client.put("/api/auth/profile", json={
            "name": "Updated User",
            "username": "updated.user",
            "bio": "A short intro",
            "interests": ["Design"],
        })
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.json()["user"]["name"], "Updated User")
        self.assertFalse(profile.json()["user"]["profileVisible"])

        bad_login = self.client.post("/api/auth/login", json={
            "email": "new@example.com",
            "password": "incorrect password",
        })
        self.assertEqual(bad_login.status_code, 401)

        login = self.client.post("/api/auth/login", json={
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(login.status_code, 200)
        logout = self.client.post("/api/auth/logout")
        self.assertEqual(logout.status_code, 204)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)

    def test_signed_in_members_upload_images_for_posts_and_products(self):
        image_buffer = BytesIO()
        Image.new("RGB", (4, 4), (70, 120, 180)).save(image_buffer, format="PNG")
        image_bytes = image_buffer.getvalue()
        webp_buffer = BytesIO()
        Image.new("RGB", (4, 4), (120, 70, 180)).save(webp_buffer, format="WEBP")
        webp_bytes = webp_buffer.getvalue()
        unauthenticated = self.client.post(
            "/api/media/images",
            content=image_bytes,
            headers={"Content-Type": "image/png"},
        )
        self.assertEqual(unauthenticated.status_code, 401)

        signup = self.client.post("/api/auth/register", json={
            "name": "Media User",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        verified = self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })
        self.assertEqual(verified.status_code, 200)

        first_upload = self.client.post(
            "/api/media/images",
            content=image_bytes,
            headers={"Content-Type": "image/png"},
        )
        second_upload = self.client.post(
            "/api/media/images",
            content=webp_bytes,
            headers={"Content-Type": "image/webp"},
        )
        self.assertEqual(first_upload.status_code, 201, first_upload.text)
        self.assertEqual(second_upload.status_code, 201, second_upload.text)
        image_urls = [first_upload.json()["url"], second_upload.json()["url"]]
        served_image = self.client.get(image_urls[0])
        self.assertEqual(served_image.status_code, 200)
        self.assertEqual(served_image.headers["content-type"], "image/webp")
        self.assertEqual(Image.open(BytesIO(served_image.content)).format, "WEBP")

        post = self.client.post(
            "/api/social/posts",
            json={"text": "A post with photos", "image_urls": image_urls},
        )
        self.assertEqual(post.status_code, 201, post.text)
        self.assertEqual(post.json()["post"]["imageUrls"], image_urls)
        self.assertEqual(self.client.get("/api/social/posts").json()["posts"][0]["imageUrls"], image_urls)

        product = self.client.post("/api/marketplace/products", json={
            "name": "Photo listing",
            "category": "Home",
            "price": 12000,
            "stock": 2,
            "description": "A listing with multiple photos",
            "image_urls": image_urls,
        })
        self.assertEqual(product.status_code, 201, product.text)
        self.assertEqual(product.json()["product"]["imageUrls"], image_urls)
        self.assertEqual(product.json()["product"]["imageUrl"], image_urls[0])
        product_id = product.json()["product"]["id"]
        listed_products = self.client.get("/api/marketplace/products")
        self.assertEqual(listed_products.status_code, 200, listed_products.text)
        self.assertEqual(listed_products.json()["products"][0]["imageUrls"], image_urls)
        product_details = self.client.get("/api/marketplace/products/{}".format(product_id))
        self.assertEqual(product_details.status_code, 200, product_details.text)
        self.assertEqual(product_details.json()["product"]["imageUrls"], image_urls)

    def test_rejects_invalid_image_upload_and_more_than_five_images(self):
        self.client.post("/api/auth/register", json={
            "name": "Media User",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })
        invalid_images = self.client.post(
            "/api/media/images",
            content=b"not an image",
            headers={"Content-Type": "image/png"},
        )
        self.assertEqual(invalid_images.status_code, 400)
        post = self.client.post("/api/social/posts", json={
            "text": "Too many photos",
            "image_urls": ["/api/media/images/{}.png".format("a" * 32)] * 6,
        })
        self.assertEqual(post.status_code, 400)

    def test_rejects_foreign_origin_and_extra_fields(self):
        blocked = self.client.post(
            "/api/auth/register",
            headers={"Origin": "https://attacker.example"},
            json={"name": "Name", "email": "new@example.com", "password": "a long test password"},
        )
        self.assertEqual(blocked.status_code, 403)

        extra_field = self.client.post("/api/auth/register", json={
            "name": "Name",
            "email": "new@example.com",
            "password": "a long test password",
            "is_admin": True,
        })
        self.assertEqual(extra_field.status_code, 400)

    def test_allows_local_vite_origins_during_development(self):
        response = self.client.get(
            "/api/health",
            headers={"Origin": "http://127.0.0.1:5173"},
        )
        self.assertEqual(response.status_code, 200)

    def test_persistent_social_posts_likes_and_comments(self):
        self.assertEqual(self.client.get("/api/social/posts").status_code, 401)
        self.assertEqual(
            self.client.post("/api/social/posts", json={"text": "No session"}).status_code,
            401,
        )

        signup = self.client.post("/api/auth/register", json={
            "name": "Social User",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        verified = self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })
        self.assertEqual(verified.status_code, 200)

        invalid_post = self.client.post("/api/social/posts", json={"text": "   "})
        self.assertEqual(invalid_post.status_code, 400)
        created = self.client.post("/api/social/posts", json={"text": "  A persistent update  "})
        self.assertEqual(created.status_code, 201, created.text)
        post = created.json()["post"]
        self.assertEqual(post["text"], "A persistent update")
        self.assertEqual(post["author"]["name"], "Social User")
        self.assertEqual(post["likeCount"], 0)
        self.assertFalse(post["likedByMe"])
        self.assertFalse(post["bookmarkedByMe"])

        listed = self.client.get("/api/social/posts")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["posts"][0]["id"], post["id"])
        bookmark_url = "/api/social/posts/{}/bookmark".format(post["id"])
        self.assertEqual(
            self.client.put(bookmark_url, json={"bookmarked": True}).json(),
            {"bookmarked": True},
        )
        self.assertTrue(self.client.get("/api/social/posts").json()["posts"][0]["bookmarkedByMe"])
        bookmarked_posts = self.client.get("/api/social/posts?bookmarked_only=true").json()["posts"]
        self.assertEqual([item["id"] for item in bookmarked_posts], [post["id"]])
        self.assertEqual(
            self.client.put(bookmark_url, json={"bookmarked": False}).json(),
            {"bookmarked": False},
        )
        self.assertEqual(self.client.get("/api/social/posts?bookmarked_only=true").json()["posts"], [])
        self.assertEqual(self.client.get("/api/social/posts/00000000-0000-0000-0000-000000000002").status_code, 404)

        like_url = "/api/social/posts/{}/like".format(post["id"])
        liked = self.client.put(like_url, json={"liked": True})
        self.assertEqual(liked.json()["post"]["likeCount"], 1)
        self.assertTrue(liked.json()["post"]["likedByMe"])
        liked_again = self.client.put(like_url, json={"liked": True})
        self.assertEqual(liked_again.json()["post"]["likeCount"], 1)
        unliked = self.client.put(like_url, json={"liked": False})
        self.assertEqual(unliked.json()["post"]["likeCount"], 0)
        self.assertFalse(unliked.json()["post"]["likedByMe"])

        comments_url = "/api/social/posts/{}/comments".format(post["id"])
        invalid_comment = self.client.post(comments_url, json={"text": "  "})
        self.assertEqual(invalid_comment.status_code, 400)
        created_comment = self.client.post(comments_url, json={"text": "  A saved reply  "})
        self.assertEqual(created_comment.status_code, 201)
        self.assertEqual(created_comment.json()["comment"]["text"], "A saved reply")
        comments = self.client.get(comments_url)
        self.assertEqual(comments.status_code, 200)
        self.assertEqual(len(comments.json()["comments"]), 1)
        self.assertEqual(comments.json()["comments"][0]["text"], "A saved reply")
        refreshed = self.client.get("/api/social/posts/{}".format(post["id"]))
        self.assertEqual(refreshed.json()["post"]["commentCount"], 1)

    def test_admin_allowlist_user_details_private_messages_and_audit(self):
        self.assertEqual(self.client.get("/api/admin/overview").status_code, 401)
        signup = self.client.post("/api/auth/register", json={
            "name": "Admin User",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        verified = self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })
        self.assertEqual(verified.status_code, 200)

        rejected = self.client.post("/api/admin/login", json={
            "email": "new@example.com",
            "password": "wrong password",
        })
        self.assertEqual(rejected.status_code, 401)
        signed_in = self.client.post("/api/admin/login", json={
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signed_in.status_code, 200, signed_in.text)
        self.assertEqual(signed_in.json()["admin"]["email"], "new@example.com")

        not_allowlisted = TestClient(create_app(
            settings=replace(self.settings, admin_emails=frozenset()),
            pool=self.pool,
        ))
        not_allowlisted.cookies.set("iconnect.sid", self.client.cookies.get("iconnect.sid"))
        self.assertEqual(not_allowlisted.get("/api/admin/me").status_code, 403)
        self.assertEqual(not_allowlisted.get("/api/admin/users").status_code, 403)

        overview = self.client.get("/api/admin/overview")
        self.assertEqual(overview.status_code, 200, overview.text)
        self.assertEqual(overview.json()["overview"]["users"], 1)
        self.assertEqual(overview.json()["overview"]["messages"], 1)
        users = self.client.get("/api/admin/users")
        self.assertEqual(users.status_code, 200, users.text)
        user = users.json()["users"][0]
        self.assertEqual(user["email"], "new@example.com")
        self.assertEqual(user["counts"]["messages"], 1)
        self.assertNotIn("password_hash", user)

        details = self.client.get("/api/admin/users/{}".format(user["id"]))
        self.assertEqual(details.status_code, 200, details.text)
        self.assertEqual(details.json()["user"]["activity"]["messages"][0]["text"], "Private test message")
        self.assertEqual(len(self.pool.state["admin_audit"]), 1)
        audit = self.client.get("/api/admin/audit-log")
        self.assertEqual(audit.status_code, 200, audit.text)
        self.assertEqual(audit.json()["events"][0]["action"], "view_user_details")
        self.assertEqual(
            self.client.get("/api/admin/users/00000000-0000-0000-0000-000000000002").status_code,
            404,
        )

    def test_marketplace_product_listings_are_persistent(self):
        self.assertEqual(self.client.get("/api/marketplace/products").status_code, 401)
        self.assertEqual(
            self.client.post("/api/marketplace/products", json={
                "name": "Test item",
                "category": "Home",
                "price": 12000,
                "stock": 3,
                "description": "A test product",
            }).status_code,
            401,
        )

        signup = self.client.post("/api/auth/register", json={
            "name": "Shop Seller",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        verified = self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })
        self.assertEqual(verified.status_code, 200)

        invalid_image = self.client.post("/api/marketplace/products", json={
            "name": "Test item",
            "category": "Home",
            "price": 12000,
            "stock": 3,
            "description": "A test product",
            "image_url": "javascript:alert(1)",
        })
        self.assertEqual(invalid_image.status_code, 400)
        created = self.client.post("/api/marketplace/products", json={
            "name": "  Handmade lamp ",
            "category": "Home",
            "price": 12000,
            "stock": 3,
            "description": "  A warm desk lamp. ",
            "image_url": "https://images.example.com/lamp.jpg",
        })
        self.assertEqual(created.status_code, 201, created.text)
        product = created.json()["product"]
        self.assertEqual(product["name"], "Handmade lamp")
        self.assertEqual(product["description"], "A warm desk lamp.")
        self.assertEqual(product["seller"]["name"], "Shop Seller")
        self.assertEqual(product["price"], 12000)
        self.assertEqual(product["stock"], 3)

        listed = self.client.get("/api/marketplace/products")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([item["id"] for item in listed.json()["products"]], [product["id"]])
        category = self.client.get("/api/marketplace/products?category=Home")
        self.assertEqual(len(category.json()["products"]), 1)
        self.assertEqual(
            self.client.get("/api/marketplace/products/{}".format(product["id"])).json()["product"],
            product,
        )
        self.assertEqual(
            self.client.get("/api/marketplace/products/00000000-0000-0000-0000-000000000002").status_code,
            404,
        )
        self.assertEqual(
            self.client.get("/api/marketplace/products?query=x").status_code,
            400,
        )

    def test_communities_are_persistent_and_membership_is_account_bound(self):
        self.assertEqual(self.client.get("/api/communities").status_code, 401)
        signup = self.client.post("/api/auth/register", json={
            "name": "Community Member",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        self.assertEqual(self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        }).status_code, 200)

        invalid_community = self.client.post("/api/communities", json={
            "name": "  ",
            "description": "Description",
        })
        self.assertEqual(invalid_community.status_code, 400)
        created = self.client.post("/api/communities", json={
            "name": "  Local Makers ",
            "description": " A place for nearby designers and builders. ",
        })
        self.assertEqual(created.status_code, 201, created.text)
        community = created.json()["community"]
        self.assertEqual(community["name"], "Local Makers")
        self.assertEqual(community["description"], "A place for nearby designers and builders.")
        self.assertEqual(community["memberCount"], 1)
        self.assertTrue(community["joinedByMe"])
        self.assertNotIn("owner", community)

        listed = self.client.get("/api/communities?query=makers")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([item["id"] for item in listed.json()["communities"]], [community["id"]])
        self.assertEqual(self.client.get("/api/communities?query=x").status_code, 400)

        membership_url = "/api/communities/{}/membership".format(community["id"])
        left = self.client.put(membership_url, json={"joined": False})
        self.assertEqual(left.status_code, 200)
        self.assertEqual(left.json()["community"]["memberCount"], 0)
        self.assertFalse(left.json()["community"]["joinedByMe"])
        joined = self.client.put(membership_url, json={"joined": True})
        self.assertTrue(joined.json()["community"]["joinedByMe"])
        self.assertEqual(joined.json()["community"]["memberCount"], 1)
        joined_again = self.client.put(membership_url, json={"joined": True})
        self.assertEqual(joined_again.json()["community"]["memberCount"], 1)
        left_again = self.client.put(membership_url, json={"joined": False})
        self.assertEqual(left_again.json()["community"]["memberCount"], 0)
        self.assertEqual(
            self.client.put(
                "/api/communities/00000000-0000-0000-0000-000000000002/membership",
                json={"joined": True},
            ).status_code,
            404,
        )

    def test_local_marketplace_listings_are_persistent(self):
        self.assertEqual(self.client.get("/api/local-marketplace/listings").status_code, 401)
        signup = self.client.post("/api/auth/register", json={
            "name": "Local Seller",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        self.assertEqual(self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        }).status_code, 200)

        invalid_listing = self.client.post("/api/local-marketplace/listings", json={
            "category": "Homes",
            "title": "Sample apartment",
            "price": "₦2,400,000 / year",
            "location": "Lagos",
            "detail": "Two bedrooms",
            "description": "A test home.",
            "image_url": "http://images.example.com/home.jpg",
        })
        self.assertEqual(invalid_listing.status_code, 400)
        created = self.client.post("/api/local-marketplace/listings", json={
            "category": "Homes",
            "title": "  Bright apartment ",
            "price": "₦2,400,000 / year",
            "location": "Lagos",
            "detail": "Two bedrooms · Available now",
            "description": " A bright home near the city. ",
        })
        self.assertEqual(created.status_code, 201, created.text)
        listing = created.json()["listing"]
        self.assertEqual(listing["title"], "Bright apartment")
        self.assertEqual(listing["description"], "A bright home near the city.")
        self.assertEqual(listing["seller"]["name"], "Local Seller")
        self.assertIsNone(listing["imageUrl"])

        listed = self.client.get("/api/local-marketplace/listings?category=Homes&location=Lagos")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([item["id"] for item in listed.json()["listings"]], [listing["id"]])
        searched = self.client.get("/api/local-marketplace/listings?query=bright")
        self.assertEqual([item["id"] for item in searched.json()["listings"]], [listing["id"]])
        self.assertEqual(self.client.get("/api/local-marketplace/listings?query=x").status_code, 400)
        self.assertEqual(
            self.client.get("/api/local-marketplace/listings/{}".format(listing["id"])).json()["listing"],
            listing,
        )
        self.assertEqual(
            self.client.get("/api/local-marketplace/listings/00000000-0000-0000-0000-000000000002").status_code,
            404,
        )


if __name__ == "__main__":
    unittest.main()
