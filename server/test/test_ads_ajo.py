import unittest
from datetime import date, datetime, timezone
from uuid import uuid4

from pydantic import ValidationError

from server.app.ads import AdCampaignInput, AdPackageInput
from server.app.ajo import AjoContributionInput, AjoPlanInput, plan_summary


def plan(**overrides):
    values = {
        "frequency": "weekly",
        "start_date": date(2026, 11, 2),
        "target_amount_minor": 100000,
        "contribution_amount_minor": 20000,
        "status": "active",
    }
    values.update(overrides)
    return values


def paid(day, amount=20000):
    return {"amount_minor": amount, "contributed_on": day, "created_at": datetime.now(timezone.utc)}


class AjoSummaryTest(unittest.TestCase):
    def test_new_plan_is_due_on_start_date(self):
        summary = plan_summary(plan(), [], today=date(2026, 11, 2))
        self.assertEqual(summary["nextDueDate"], "2026-11-02")
        self.assertFalse(summary["overdue"])
        self.assertEqual(summary["contributionsLeft"], 5)
        self.assertEqual(summary["projectedFinish"], "2026-11-30")

    def test_missed_week_is_overdue_and_behind(self):
        summary = plan_summary(plan(), [paid(date(2026, 11, 2))], today=date(2026, 11, 11))
        self.assertEqual(summary["nextDueDate"], "2026-11-09")
        self.assertTrue(summary["overdue"])
        self.assertEqual(summary["expectedByNowMinor"], 40000)
        self.assertEqual(summary["behindByMinor"], 20000)

    def test_streak_counts_consecutive_periods(self):
        contributions = [paid(date(2026, 11, 2)), paid(date(2026, 11, 10)), paid(date(2026, 11, 17))]
        summary = plan_summary(plan(), contributions, today=date(2026, 11, 18))
        self.assertEqual(summary["streak"], 3)
        self.assertEqual(summary["progressPct"], 60.0)
        self.assertEqual(summary["nextDueDate"], "2026-11-23")

    def test_due_today_is_not_behind(self):
        summary = plan_summary(plan(), [paid(date(2026, 11, 2))], today=date(2026, 11, 9))
        self.assertFalse(summary["overdue"])
        self.assertEqual(summary["behindByMinor"], 0)

    def test_streak_survives_until_current_period_is_due(self):
        # Paid weeks 0 and 1; today is in week 2 and not paid yet: streak still 2.
        summary = plan_summary(plan(), [paid(date(2026, 11, 2)), paid(date(2026, 11, 9))], today=date(2026, 11, 16))
        self.assertEqual(summary["streak"], 2)

    def test_reaching_target_clears_due_date(self):
        summary = plan_summary(plan(), [paid(date(2026, 11, 2), 100000)], today=date(2026, 11, 3))
        self.assertTrue(summary["reachedTarget"])
        self.assertIsNone(summary["nextDueDate"])
        self.assertIsNone(summary["projectedFinish"])
        self.assertEqual(summary["progressPct"], 100.0)

    def test_plan_validation(self):
        base = dict(name="School fees", currency="NGN", target_amount_minor=500000, contribution_amount_minor=50000,
                    frequency="monthly", start_date=date.today())
        AjoPlanInput(**base)
        with self.assertRaises(ValidationError):
            AjoPlanInput(**dict(base, contribution_amount_minor=600000))
        with self.assertRaises(ValidationError):
            AjoPlanInput(**dict(base, currency="XYZ"))
        with self.assertRaises(ValidationError):
            AjoContributionInput(amount_minor=100, contributed_on=date(2999, 1, 1))


class AdInputTest(unittest.TestCase):
    def test_link_must_be_https(self):
        base = dict(package_id=uuid4(), title="Fresh bread", body="Hot bread delivered every morning in Lekki.")
        self.assertEqual(AdCampaignInput(**dict(base, link_url="https://bakery.ng/order")).link_url, "https://bakery.ng/order")
        for bad in ["http://bakery.ng", "javascript:alert(1)", "bakery.ng"]:
            with self.assertRaises(ValidationError):
                AdCampaignInput(**dict(base, link_url=bad))
        self.assertIsNone(AdCampaignInput(**dict(base, link_url=" ")).link_url)

    def test_package_countries_and_currency(self):
        package = AdPackageInput(name="7-day feed boost", duration_days=7, currency="gbp", amount_minor=1500, country_codes=["gb", "GB", "ie"])
        self.assertEqual(package.currency, "GBP")
        self.assertEqual(package.country_codes, ["GB", "IE"])
        with self.assertRaises(ValidationError):
            AdPackageInput(name="x", duration_days=7, currency="USD", amount_minor=1500, country_codes=["USA"])


if __name__ == "__main__":
    unittest.main()
