import re
import os
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
os.environ.setdefault("OTP_HASH_SECRET", "test-otp-secret-that-is-long-enough")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-that-is-long-enough")

from server.app.main import Settings, create_app
from server.app.security import hash_email_code


class FakeResult:
    def __init__(self, row=None, rowcount=None):
        self.row = row
        self.rowcount = rowcount if rowcount is not None else (1 if row else 0)

    def fetchone(self):
        return self.row


class FakeConnection:
    def __init__(self, state):
        self.state = state

    @contextmanager
    def transaction(self):
        yield self

    def execute(self, query, parameters=()):
        sql = re.sub(r"\s+", " ", query).strip().lower()
        if sql.startswith("insert into users"):
            if self.state["user"] and self.state["user"]["email"] == parameters[2]:
                return FakeResult()
            self.state["user"] = {
                "id": "test-user-id",
                "display_name": parameters[0],
                "username": parameters[1],
                "email": parameters[2],
                "password_hash": parameters[3],
                "bio": "",
                "interests": [],
                "email_verified_at": None,
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
        if sql.startswith("select id, display_name, username, email, bio, interests, password_hash"):
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


class FakePool:
    def __init__(self):
        self.state = {"user": None, "verification": None, "sessions": {}}

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
        )
        self.client = TestClient(create_app(
            settings=settings,
            pool=self.pool,
            send_otp_email=send_email,
        ))

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

        profile = self.client.put("/api/auth/profile", json={
            "name": "Updated User",
            "username": "updated.user",
            "bio": "A short intro",
            "interests": ["Design"],
        })
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.json()["user"]["name"], "Updated User")

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


if __name__ == "__main__":
    unittest.main()
