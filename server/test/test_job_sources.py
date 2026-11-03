import json
import os
import unittest
from unittest.mock import patch
from urllib.error import URLError

from server.app.config import (
    DEFAULT_GREENHOUSE_BOARD_TOKENS,
    DEFAULT_SMARTRECRUITERS_COMPANY_IDS,
    _job_source_ids,
)
from server.app import job_sources


class FakeResponse:
    status = 200

    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit):
        return self.payload


class JobSourceTests(unittest.TestCase):
    def setUp(self):
        with job_sources._cache_lock:
            job_sources._source_cache.clear()

    def test_job_source_configuration_uses_starters_and_supports_overrides(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(
                _job_source_ids("GREENHOUSE_BOARD_TOKENS", DEFAULT_GREENHOUSE_BOARD_TOKENS),
                DEFAULT_GREENHOUSE_BOARD_TOKENS,
            )
        with patch.dict(os.environ, {"GREENHOUSE_BOARD_TOKENS": "stripe,figma,stripe"}):
            self.assertEqual(
                _job_source_ids("GREENHOUSE_BOARD_TOKENS", DEFAULT_GREENHOUSE_BOARD_TOKENS),
                ("stripe", "figma"),
            )
        with patch.dict(os.environ, {"GREENHOUSE_BOARD_TOKENS": "none"}):
            self.assertEqual(
                _job_source_ids("GREENHOUSE_BOARD_TOKENS", DEFAULT_GREENHOUSE_BOARD_TOKENS),
                (),
            )
        self.assertTrue(DEFAULT_SMARTRECRUITERS_COMPANY_IDS)

    def test_fetches_and_normalizes_greenhouse_and_smartrecruiters_jobs(self):
        def fake_urlopen(request, timeout):
            self.assertEqual(timeout, 5)
            if "boards-api.greenhouse.io" in request.full_url:
                return FakeResponse({"jobs": [{
                    "id": 123,
                    "title": "Product Designer",
                    "updated_at": "2026-11-02T10:00:00Z",
                    "absolute_url": "https://boards.greenhouse.io/acme/jobs/123",
                    "location": {"name": "Lagos, Nigeria"},
                    "content": "&amp;lt;p&amp;gt;Design useful products.&amp;lt;/p&amp;gt;",
                }]})
            return FakeResponse({"content": [{
                "id": "456",
                "name": "Backend Engineer",
                "releasedDate": "2026-11-03T10:00:00Z",
                "company": {"identifier": "example", "name": "Example Ltd"},
                "location": {
                    "fullLocation": "Remote, Nigeria",
                    "remote": True,
                },
                "typeOfEmployment": {"label": "Full-time"},
                "department": {"label": "Engineering"},
            }]})

        with patch("server.app.job_sources.urlopen", side_effect=fake_urlopen) as mocked:
            result = job_sources.fetch_external_jobs(
                ("acme",),
                ("example",),
                limit=10,
            )

        self.assertTrue(result["enabled"])
        self.assertEqual(result["warnings"], [])
        self.assertEqual(len(result["jobs"]), 2)
        greenhouse = next(job for job in result["jobs"] if job["source"] == "Greenhouse")
        smartrecruiters = next(
            job for job in result["jobs"] if job["source"] == "SmartRecruiters"
        )
        self.assertEqual(greenhouse["description"], "Design useful products.")
        self.assertEqual(greenhouse["workplaceType"], "onsite")
        self.assertEqual(smartrecruiters["workplaceType"], "remote")
        self.assertEqual(
            smartrecruiters["externalUrl"],
            "https://jobs.smartrecruiters.com/example/456",
        )
        self.assertEqual(mocked.call_count, 2)

    def test_filters_external_results_and_reports_failed_sources(self):
        with patch(
            "server.app.job_sources.urlopen",
            return_value=FakeResponse({"jobs": [{
                "id": 1,
                "title": "Remote Analyst",
                "absolute_url": "https://boards.greenhouse.io/acme/jobs/1",
                "location": {"name": "Remote"},
                "content": "<p>Analyze data</p>",
            }]}),
        ):
            result = job_sources.fetch_external_jobs(
                ("acme",),
                (),
                query="analyst",
                location="remote",
                workplace_type="remote",
            )
        self.assertEqual(len(result["jobs"]), 1)

        with patch(
            "server.app.job_sources.urlopen",
            side_effect=URLError("connection failed"),
        ):
            failed = job_sources.fetch_external_jobs(("broken",), ())
        self.assertEqual(failed["jobs"], [])
        self.assertEqual(failed["warnings"], [
            "Greenhouse feed (broken) is temporarily unavailable."
        ])

    def test_no_configured_employer_boards_disables_external_fetch(self):
        with patch("server.app.job_sources.urlopen") as mocked:
            result = job_sources.fetch_external_jobs((), ())
        self.assertFalse(result["enabled"])
        self.assertEqual(result["jobs"], [])
        mocked.assert_not_called()


if __name__ == "__main__":
    unittest.main()
