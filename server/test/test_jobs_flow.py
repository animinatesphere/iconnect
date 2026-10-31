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
        self.rows = rows if rows is not None else ([row] if row is not None else [])
        self.row = row if row is not None else (self.rows[0] if self.rows else None)

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class FakeJobsConnection:
    def __init__(self, state):
        self.state = state

    def execute(self, query, parameters=()):
        sql = re.sub(r"\s+", " ", query).strip().lower()
        if sql.startswith("select u.id") and "from auth_sessions" in sql:
            session = self.state["sessions"].get(parameters[0])
            if not session or session["expires_at"] <= datetime.now(timezone.utc):
                return FakeResult()
            return FakeResult(self.state["users"][session["user_id"]].copy())

        if sql.startswith("insert into job_listings"):
            (
                user_id,
                title,
                company,
                location,
                employment_type,
                workplace_type,
                summary,
                description,
            ) = parameters
            job_id = str(uuid4())
            self.state["jobs"][job_id] = {
                "id": job_id,
                "user_id": str(user_id),
                "title": title,
                "company": company,
                "location": location,
                "employment_type": employment_type,
                "workplace_type": workplace_type,
                "summary": summary,
                "description": description,
                "created_at": datetime.now(timezone.utc),
            }
            return FakeResult({"id": job_id})

        if sql.startswith("select j.id") and "from job_listings j" in sql:
            return FakeResult(rows=self._job_rows(query, parameters))

        if sql.startswith("select id from job_listings where id ="):
            job = self.state["jobs"].get(str(parameters[0]))
            return FakeResult({"id": job["id"]} if job else None)

        if sql.startswith("select id, user_id from job_listings where id ="):
            job = self.state["jobs"].get(str(parameters[0]))
            return FakeResult(
                {"id": job["id"], "user_id": job["user_id"]} if job else None
            )

        if sql.startswith("insert into job_bookmarks"):
            self.state["bookmarks"].add((str(parameters[0]), str(parameters[1])))
            return FakeResult()

        if sql.startswith("delete from job_bookmarks"):
            self.state["bookmarks"].discard((str(parameters[0]), str(parameters[1])))
            return FakeResult()

        if sql.startswith("insert into job_applications"):
            job_id, applicant_id, cover_letter = map(str, parameters)
            key = (job_id, applicant_id)
            if key in self.state["applications"]:
                return FakeResult()
            application = {
                "id": str(uuid4()),
                "job_id": job_id,
                "applicant_id": applicant_id,
                "cover_letter": cover_letter,
                "status": "submitted",
                "created_at": datetime.now(timezone.utc),
            }
            self.state["applications"][key] = application
            return FakeResult({"id": application["id"]})

        if sql.startswith("select id, job_id, cover_letter, status, created_at"):
            application = self.state["applications"].get(
                (str(parameters[0]), str(parameters[1]))
            )
            return FakeResult(application.copy() if application else None)

        if sql.startswith("select application.id"):
            job_id, limit = str(parameters[0]), parameters[1]
            applications = [
                application
                for (current_job_id, _), application in self.state["applications"].items()
                if current_job_id == job_id
            ]
            applications.sort(key=lambda item: item["created_at"], reverse=True)
            rows = []
            for application in applications[:limit]:
                applicant = self.state["users"][application["applicant_id"]]
                rows.append({
                    "id": application["id"],
                    "cover_letter": application["cover_letter"],
                    "status": application["status"],
                    "created_at": application["created_at"],
                    "display_name": applicant["display_name"],
                    "username": applicant["username"],
                })
            return FakeResult(rows=rows)

        raise AssertionError("Unexpected database query: {}".format(query))

    def _job_rows(self, query, parameters):
        sql = re.sub(r"\s+", " ", query).strip().lower()
        where_clause = sql.rsplit(" where ", 1)[1].split(" order by ", 1)[0]
        viewer_id = str(parameters[0])
        filters = parameters[5:-1]
        single_job_id = str(parameters[-1]) if "where j.id = %s" in sql else None
        query_patterns = [
            value for value in filters
            if isinstance(value, str) and value.startswith("%") and value.endswith("%")
        ]
        search_pattern = query_patterns[0][1:-1] if "lower(j.title) like" in where_clause else None
        location_pattern = (
            query_patterns[-1][1:-1]
            if "lower(j.location) like" in where_clause
            else None
        )
        workplace_type = next(
            (value for value in filters if value in ("remote", "hybrid", "onsite")),
            None,
        )
        rows = []
        for job in self.state["jobs"].values():
            if single_job_id and job["id"] != single_job_id:
                continue
            saved = (viewer_id, job["id"]) in self.state["bookmarks"]
            application = self.state["applications"].get((job["id"], viewer_id))
            if "filter_bookmark.job_id = j.id" in where_clause and not saved:
                continue
            if "filter_application.job_id = j.id" in where_clause and not application:
                continue
            if "j.user_id = %s" in where_clause and job["user_id"] != viewer_id:
                continue
            if workplace_type and job["workplace_type"] != workplace_type:
                continue
            searchable = " ".join(
                [job["title"], job["company"], job["summary"], job["description"]]
            ).lower()
            if search_pattern and search_pattern not in searchable:
                continue
            if location_pattern and location_pattern not in job["location"].lower():
                continue
            owner = self.state["users"][job["user_id"]]
            rows.append({
                **job,
                "display_name": owner["display_name"],
                "username": owner["username"],
                "is_saved": saved,
                "applied_by_me": application is not None,
                "is_owner": job["user_id"] == viewer_id,
                "application_count": sum(
                    current_job_id == job["id"]
                    for current_job_id, _ in self.state["applications"]
                ),
                "application_status": application["status"] if application else None,
                "application_cover_letter": (
                    application["cover_letter"] if application else None
                ),
            })
        rows.sort(key=lambda item: (item["created_at"], item["id"]), reverse=True)
        return rows if single_job_id else rows[:parameters[-1]]


class FakeJobsPool:
    def __init__(self):
        self.state = {
            "users": {},
            "sessions": {},
            "jobs": {},
            "bookmarks": set(),
            "applications": {},
        }

    @contextmanager
    def connection(self):
        yield FakeJobsConnection(self.state)


class JobsFlowTests(unittest.TestCase):
    def setUp(self):
        self.pool = FakeJobsPool()
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
            self.pool.state["users"][self.user_ids[key]] = {
                "id": self.user_ids[key],
                "display_name": name,
                "username": username,
                "email": "{}@example.com".format(username),
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
        self.clients = {}
        for key in ("alice", "bob", "casey"):
            client = TestClient(create_app(settings=settings, pool=self.pool))
            token = "session-token-{}".format(key)
            self.pool.state["sessions"][hash_session_token(token, settings.session_secret)] = {
                "user_id": self.user_ids[key],
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            }
            client.cookies.set("iconnect.sid", token)
            self.clients[key] = client

    def create_listing(self, owner="alice", **overrides):
        listing = {
            "title": "Product Designer",
            "company": "Common Ground",
            "location": "Lagos, Nigeria",
            "employment_type": "Full-time",
            "workplace_type": "hybrid",
            "summary": "Design a welcoming community product.",
            "description": "Work with the team to improve the member experience.",
        }
        listing.update(overrides)
        response = self.clients[owner].post("/api/jobs", json=listing)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["job"]

    def test_listing_search_filters_and_repeat_safe_saved_roles(self):
        anonymous = TestClient(self.clients["alice"].app)
        self.assertEqual(anonymous.get("/api/jobs").status_code, 401)

        job = self.create_listing(title="  Product Designer  ")
        self.assertEqual(job["title"], "Product Designer")
        self.assertTrue(job["isOwner"])
        self.assertNotIn("email", job["poster"])

        found = self.clients["bob"].get(
            "/api/jobs?query=designer&location=lagos&workplace_type=hybrid"
        )
        self.assertEqual(found.status_code, 200, found.text)
        self.assertEqual([item["id"] for item in found.json()["jobs"]], [job["id"]])
        self.assertEqual(self.clients["bob"].get("/api/jobs?query=x").status_code, 400)
        self.assertEqual(
            self.clients["bob"].get("/api/jobs?workplace_type=invalid").status_code,
            400,
        )

        save_url = "/api/jobs/{}/save".format(job["id"])
        self.assertEqual(self.clients["bob"].put(save_url, json={"saved": True}).status_code, 200)
        self.assertEqual(self.clients["bob"].put(save_url, json={"saved": True}).status_code, 200)
        saved = self.clients["bob"].get("/api/jobs?view=saved").json()["jobs"]
        self.assertEqual(len(saved), 1)
        self.assertTrue(saved[0]["isSaved"])
        self.assertEqual(
            self.clients["bob"].put(save_url, json={"saved": False}).json()["saved"],
            False,
        )
        self.assertEqual(self.clients["bob"].get("/api/jobs?view=saved").json()["jobs"], [])
        self.assertEqual(
            self.clients["casey"].put(
                "/api/jobs/{}/save".format(uuid4()), json={"saved": True}
            ).status_code,
            404,
        )

    def test_applications_are_repeat_safe_and_private_to_listing_owner(self):
        job = self.create_listing(owner="bob")
        url = "/api/jobs/{}/applications".format(job["id"])
        self.assertEqual(
            self.clients["bob"].post(url, json={"cover_letter": "My own listing"}).status_code,
            400,
        )

        submitted = self.clients["alice"].post(url, json={"cover_letter": "  I am interested.  "})
        self.assertEqual(submitted.status_code, 201, submitted.text)
        self.assertEqual(submitted.json()["application"]["coverLetter"], "I am interested.")
        self.assertFalse(submitted.json()["alreadyApplied"])
        repeated = self.clients["alice"].post(url, json={"cover_letter": "Changed note"})
        self.assertTrue(repeated.json()["alreadyApplied"])
        self.assertEqual(repeated.json()["application"]["coverLetter"], "I am interested.")

        applied = self.clients["alice"].get("/api/jobs?view=applied").json()["jobs"]
        self.assertEqual(len(applied), 1)
        self.assertEqual(applied[0]["applicationStatus"], "submitted")
        self.assertEqual(applied[0]["applicationCoverLetter"], "I am interested.")
        mine = self.clients["bob"].get("/api/jobs?view=mine").json()["jobs"]
        self.assertEqual(mine[0]["applicationCount"], 1)

        applicants = self.clients["bob"].get(url)
        self.assertEqual(applicants.status_code, 200)
        self.assertEqual(applicants.json()["applications"][0]["applicant"]["username"], "alice")
        self.assertNotIn("email", applicants.json()["applications"][0]["applicant"])
        self.assertEqual(self.clients["alice"].get(url).status_code, 404)
        self.assertEqual(self.clients["casey"].get(url).status_code, 404)

    def test_job_listing_validation_rejects_empty_text_and_unknown_fields(self):
        empty_title = self.clients["alice"].post("/api/jobs", json={
            "title": " ",
            "company": "Company",
            "location": "Remote",
            "employment_type": "Full-time",
            "workplace_type": "remote",
            "summary": "A role",
            "description": "Details",
        })
        self.assertEqual(empty_title.status_code, 400)
        invalid_field = self.clients["alice"].post("/api/jobs", json={
            "title": "Role",
            "company": "Company",
            "location": "Remote",
            "employment_type": "Full-time",
            "workplace_type": "remote",
            "summary": "A role",
            "description": "Details",
            "email": "private@example.com",
        })
        self.assertEqual(invalid_field.status_code, 400)


if __name__ == "__main__":
    unittest.main()
