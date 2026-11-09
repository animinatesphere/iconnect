import unittest

from server.app.geo import normalize_country, plan_visible_in_country, request_client_ip, resolve_country


class CountryDetectionTest(unittest.TestCase):
    def test_edge_header_wins(self):
        self.assertEqual(resolve_country({"x-vercel-ip-country": "gb"}, "1.2.3.4", 1, ""), ("GB", "x-vercel-ip-country"))
        self.assertEqual(resolve_country({"cf-ipcountry": "CA"}, None, 1, ""), ("CA", "cf-ipcountry"))

    def test_placeholder_codes_are_unknown(self):
        self.assertIsNone(normalize_country("XX"))
        self.assertIsNone(normalize_country("T1"))
        self.assertIsNone(normalize_country("USA"))
        self.assertEqual(resolve_country({"cf-ipcountry": "XX"}, None, 1, ""), (None, "unknown"))

    def test_missing_database_is_unknown(self):
        self.assertEqual(resolve_country({}, "8.8.8.8", 0, "/nonexistent.mmdb"), (None, "unknown"))

    def test_client_ip_uses_forwarded_for_only_behind_proxy(self):
        headers = {"x-forwarded-for": "81.2.69.160, 3.120.147.49"}
        self.assertEqual(request_client_ip(headers, "127.0.0.1", 1), "81.2.69.160")
        self.assertEqual(request_client_ip(headers, "127.0.0.1", 0), "127.0.0.1")


class PlanVisibilityTest(unittest.TestCase):
    def test_country_plan_replaces_default(self):
        self.assertTrue(plan_visible_in_country(["GB"], "GB", True))
        self.assertFalse(plan_visible_in_country([], "GB", True))

    def test_default_shown_when_country_has_no_plan(self):
        self.assertTrue(plan_visible_in_country([], "FR", False))
        self.assertFalse(plan_visible_in_country(["GB"], "FR", False))

    def test_unknown_country_sees_everything(self):
        self.assertTrue(plan_visible_in_country(["GB"], None, False))
        self.assertTrue(plan_visible_in_country([], None, False))


if __name__ == "__main__":
    unittest.main()
