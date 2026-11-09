import os
import unittest
from datetime import datetime, timedelta, timezone

from pydantic import ValidationError

os.environ.setdefault("DATABASE_URL", "postgresql://localhost/test")
os.environ.setdefault("OTP_HASH_SECRET", "test-otp-secret-that-is-long-enough")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-that-is-long-enough")

from server.app.trading import (
    RiskProfileInput,
    compute_locks,
    evaluate_ticket,
    is_risk_increase,
    realized_pnl,
)


def profile(**overrides):
    values = {
        "operating_mode": "paper",
        "account_currency": "USD",
        "capital": 10000.0,
        "risk_tolerance": "balanced",
        "min_probability": 65.0,
        "reference_quantity": 100000,
        "max_quantity": 200000,
        "max_risk_per_idea": 1000.0,
        "max_risk_per_idea_pct": 1.0,
        "max_correlated_risk_pct": 2.0,
        "max_open_ideas": 3,
        "daily_loss_limit_pct": 3.0,
        "weekly_loss_limit_pct": 6.0,
        "permitted_pairs": ["EUR/USD", "GBP/USD", "USD/JPY", "EUR/GBP"],
        "acknowledge_risk": True,
        "acknowledge_manual_execution": True,
    }
    values.update(overrides)
    return values


def account(**overrides):
    values = {"equity": 10000.0, "open_ideas": 0, "exposure": {}, "locks": []}
    values.update(overrides)
    return values


def ticket(stop_pips=15, target_pips=40, **overrides):
    entry = 1.1000
    values = {
        "pair": "EUR/USD",
        "side": "buy",
        "entry_price": entry,
        "stop_price": round(entry - stop_pips * 0.0001, 5),
        "target_price": round(entry + target_pips * 0.0001, 5),
        "spread_pips": 1.0,
        "slippage_pips": 0.5,
        "commission_per_100k": 0.0,
        "gap_allowance_pips": 0.0,
        "probability": 72.0,
        "release_state": "FULL_PRINT",
        "microstructure_usable": True,
        "data_checked": True,
        "quote_to_account_rate": None,
        "rationale": "CPI beat, yields confirm",
        "event_label": "",
    }
    values.update(overrides)
    return values


def failed_gate(decision):
    return next(gate["id"] for gate in decision["gates"] if gate["status"] == "fail")


class WideStopEscalationTest(unittest.TestCase):
    """V13.4 §14.2 worked examples with a 65% base likelihood."""

    def check(self, stop_pips, required, factor):
        decision = evaluate_ticket(profile(), account(), ticket(stop_pips=stop_pips, target_pips=60, probability=required))
        self.assertTrue(decision["qualified"], decision["reason"])
        self.assertEqual(decision["metrics"]["requiredProbability"], required)
        self.assertAlmostEqual(decision["metrics"]["wideStopFactor"], factor, places=4)
        below = evaluate_ticket(profile(), account(), ticket(stop_pips=stop_pips, target_pips=60, probability=required - 1))
        self.assertFalse(below["qualified"])
        self.assertEqual(failed_gate(below), "G5")

    def test_fifteen_pip_stop(self):
        self.check(15, 65.0, 1.0)

    def test_sixteen_pip_stop(self):
        self.check(16, 66.0, 0.9375)

    def test_eighteen_pip_stop(self):
        self.check(18, 68.0, 15 / 18)

    def test_twenty_pip_stop(self):
        self.check(20, 70.0, 0.75)


class HardGateTest(unittest.TestCase):
    def test_stop_above_ceiling_rejected_even_with_huge_upside(self):
        decision = evaluate_ticket(profile(), account(), ticket(stop_pips=30, target_pips=100, probability=99))
        self.assertFalse(decision["qualified"])
        self.assertEqual(failed_gate(decision), "G4")
        self.assertIn("EXCEEDS 20-PIP", decision["reason"])

    def test_stop_below_minimum_rejected(self):
        decision = evaluate_ticket(profile(), account(), ticket(stop_pips=12, target_pips=40))
        self.assertEqual(failed_gate(decision), "G4")

    def test_headline_only_never_drafts(self):
        decision = evaluate_ticket(profile(), account(), ticket(release_state="HEADLINE_ONLY"))
        self.assertEqual(failed_gate(decision), "G2")
        later = {gate["id"]: gate["status"] for gate in decision["gates"]}
        self.assertEqual(later["G7"], "not_evaluated")

    def test_unchecked_data_blocks(self):
        decision = evaluate_ticket(profile(), account(), ticket(data_checked=False))
        self.assertEqual(failed_gate(decision), "G1")

    def test_spread_ceiling(self):
        decision = evaluate_ticket(profile(), account(), ticket(spread_pips=3.0))
        self.assertEqual(failed_gate(decision), "G3")

    def test_prices_on_wrong_side(self):
        decision = evaluate_ticket(profile(), account(), ticket(side="sell"))
        self.assertEqual(failed_gate(decision), "G4")

    def test_target_below_twice_stop(self):
        decision = evaluate_ticket(profile(), account(), ticket(stop_pips=15, target_pips=29))
        self.assertEqual(failed_gate(decision), "G6")

    def test_costs_push_net_ratio_below_two(self):
        # 30-pip target on a 15-pip stop is exactly 2x gross, but costs make it < 2.00 net.
        decision = evaluate_ticket(profile(), account(), ticket(stop_pips=15, target_pips=30))
        self.assertEqual(failed_gate(decision), "G6")
        self.assertLess(decision["metrics"]["netRewardToRisk"], 2.0)

    def test_cross_pair_needs_conversion_rate(self):
        cross = ticket(pair="EUR/GBP", entry_price=0.8500, stop_price=0.8485, target_price=0.8540)
        decision = evaluate_ticket(profile(), account(), cross)
        self.assertEqual(failed_gate(decision), "G1")
        decision = evaluate_ticket(profile(), account(), dict(cross, quote_to_account_rate=1.27))
        self.assertTrue(decision["qualified"], decision["reason"])

    def test_pair_not_permitted(self):
        decision = evaluate_ticket(profile(permitted_pairs=["GBP/USD"]), account(), ticket())
        self.assertEqual(failed_gate(decision), "G7")

    def test_lock_blocks_new_drafts(self):
        lock = {"id": "SESSION_LOCK", "label": "Two-loss session lock", "detail": "locked"}
        decision = evaluate_ticket(profile(), account(locks=[lock]), ticket())
        self.assertEqual(failed_gate(decision), "G7")

    def test_max_open_ideas(self):
        decision = evaluate_ticket(profile(max_open_ideas=1), account(open_ideas=1), ticket())
        self.assertEqual(failed_gate(decision), "G7")


class DraftQuantityTest(unittest.TestCase):
    def test_quantity_is_minimum_of_limits_rounded_down(self):
        # 1% of 10,000 = $100. Downside 15 + 1 + 0.5 = 16.5 pips x $0.0001 = $0.00165/unit -> 60,606 units.
        decision = evaluate_ticket(profile(), account(), ticket())
        self.assertTrue(decision["qualified"])
        self.assertEqual(decision["metrics"]["bindingLimit"], "perIdeaEquityPct")
        self.assertEqual(decision["draft"]["quantity"], 60000)
        self.assertLessEqual(decision["draft"]["riskAmount"], 100.0)

    def test_wide_stop_cuts_reference_quantity(self):
        decision = evaluate_ticket(
            profile(capital=1_000_000, max_risk_per_idea=100000, reference_quantity=100000),
            account(equity=1_000_000),
            ticket(stop_pips=20, target_pips=60, probability=70),
        )
        self.assertEqual(decision["metrics"]["bindingLimit"], "wideStopReference")
        self.assertEqual(decision["draft"]["quantity"], 75000)

    def test_correlated_exposure_reduces_quantity(self):
        # Already long EUR with $150 at risk; cap is 2% of 10,000 = $200, so $50 room remains.
        decision = evaluate_ticket(profile(), account(exposure={"EUR": {"long": 150.0, "short": 0.0}}), ticket())
        self.assertEqual(decision["metrics"]["bindingLimit"], "correlatedExposure")
        self.assertLessEqual(decision["draft"]["riskAmount"], 50.0)

    def test_opposite_direction_exposure_does_not_count(self):
        decision = evaluate_ticket(profile(), account(exposure={"EUR": {"long": 0.0, "short": 200.0}}), ticket())
        self.assertEqual(decision["draft"]["quantity"], 60000)

    def test_too_small_account_rejects(self):
        decision = evaluate_ticket(profile(capital=100, max_risk_per_idea=1), account(equity=100), ticket())
        self.assertEqual(failed_gate(decision), "G7")

    def test_usd_jpy_pip_value_uses_price(self):
        usd_jpy = ticket(pair="USD/JPY", entry_price=150.00, stop_price=149.85, target_price=150.40, spread_pips=1.0)
        decision = evaluate_ticket(profile(), account(), usd_jpy)
        self.assertTrue(decision["qualified"], decision["reason"])
        self.assertAlmostEqual(decision["metrics"]["pipValuePerUnit"], 0.01 / 150.0)


class LocksAndProfileTest(unittest.TestCase):
    def test_two_losses_lock_session(self):
        now = datetime.now(timezone.utc)
        locks = compute_locks(profile(), 10000, -50, -50, 2, now, now)
        self.assertEqual([lock["id"] for lock in locks], ["SESSION_LOCK"])

    def test_daily_and_weekly_halts(self):
        now = datetime.now(timezone.utc)
        locks = compute_locks(profile(), 10000, -300, -600, 0, now, now)
        self.assertEqual({lock["id"] for lock in locks}, {"DAILY_HALT", "WEEKLY_HALT"})

    def test_external_profile_goes_stale(self):
        now = datetime.now(timezone.utc)
        locks = compute_locks(profile(operating_mode="external_manual"), 10000, 0, 0, 0, now - timedelta(days=8), now)
        self.assertEqual([lock["id"] for lock in locks], ["PROFILE_STALE"])

    def test_risk_increase_detection(self):
        base = profile()
        self.assertFalse(is_risk_increase(None, base))
        self.assertFalse(is_risk_increase(base, profile(max_risk_per_idea_pct=0.5)))
        self.assertFalse(is_risk_increase(base, profile(min_probability=70)))
        self.assertTrue(is_risk_increase(base, profile(min_probability=64)))
        self.assertTrue(is_risk_increase(base, profile(max_quantity=300000)))
        self.assertTrue(is_risk_increase(base, profile(permitted_pairs=base["permitted_pairs"] + ["CAD/JPY"])))

    def test_profile_cannot_go_below_tolerance(self):
        with self.assertRaises(ValidationError):
            RiskProfileInput(**profile(risk_tolerance="capital_preservation", min_probability=70, max_risk_per_idea_pct=0.5))
        with self.assertRaises(ValidationError):
            RiskProfileInput(**profile(risk_tolerance="conservative", min_probability=70, max_risk_per_idea_pct=1.0))
        RiskProfileInput(**profile(risk_tolerance="capital_preservation", min_probability=75, max_risk_per_idea_pct=0.5))

    def test_external_mode_requires_acknowledgement(self):
        with self.assertRaises(ValidationError):
            RiskProfileInput(**profile(operating_mode="external_manual"))
        RiskProfileInput(**profile(operating_mode="external_manual", acknowledge_external_unverified=True))


class PnlTest(unittest.TestCase):
    def test_usd_quoted(self):
        self.assertEqual(realized_pnl("EUR/USD", "buy", "USD", 1.1000, 1.1030, 100000, None, 0), 300.0)
        self.assertEqual(realized_pnl("EUR/USD", "sell", "USD", 1.1000, 1.1030, 100000, None, 0), -300.0)

    def test_usd_base(self):
        self.assertAlmostEqual(realized_pnl("USD/JPY", "buy", "USD", 150.00, 150.30, 100000, None, 0), 199.6, places=1)

    def test_commission(self):
        self.assertEqual(realized_pnl("EUR/USD", "buy", "USD", 1.1000, 1.1030, 100000, None, 5), 295.0)


if __name__ == "__main__":
    unittest.main()


class LiveQuoteGateTest(unittest.TestCase):
    def quote(self, bid=1.09995, ask=1.10005):
        return {"bid": bid, "ask": ask, "epoch": 0, "age": 1}

    def test_live_quote_passes_and_widens_spread(self):
        decision = evaluate_ticket(profile(), account(), dict(ticket(spread_pips=0.2), live_quote=self.quote(1.0999, 1.1000)))
        self.assertTrue(decision["qualified"], decision["reason"])
        self.assertEqual(decision["metrics"]["liveSpreadPips"], 1.0)
        self.assertIn("Live Deriv ask", decision["gates"][0]["detail"])

    def test_entry_far_from_live_price_is_refused(self):
        decision = evaluate_ticket(profile(), account(), dict(ticket(), live_quote=self.quote(1.1029, 1.1030)))
        self.assertEqual(failed_gate(decision), "G1")
        self.assertIn("AWAY FROM THE LIVE PRICE", decision["reason"])

    def test_sell_uses_bid(self):
        sell = ticket(side="sell", stop_price=1.1015, target_price=1.0960)
        decision = evaluate_ticket(profile(), account(), dict(sell, live_quote=self.quote(1.1000, 1.1001)))
        self.assertTrue(decision["qualified"], decision["reason"])

    def test_deriv_mode_requires_live_quote(self):
        decision = evaluate_ticket(profile(), account(), dict(ticket(), live_quote=None, require_live_quote=True))
        self.assertEqual(failed_gate(decision), "G1")


class DerivSizingTest(unittest.TestCase):
    def test_multiplier_plan_matches_stop_and_target(self):
        from server.app.deriv import plan_multiplier_order

        # 60,000 EUR/USD at 1.1000 = $66,000 notional; 15-pip stop = $90, 40-pip target = $240.
        plans = plan_multiplier_order(66000, 1.1000, 1.0985, 1.1040)
        first = plans[0]
        # x50 and x100 need stakes above Deriv's $500 maximum, so x150 is the lowest that fits.
        self.assertEqual(first["multiplier"], 150)
        self.assertEqual(first["stake"], 440.0)
        self.assertAlmostEqual(first["stop_loss"], 90.0, places=1)
        self.assertAlmostEqual(first["take_profit"], 240.0, places=1)
        for plan in plans:
            self.assertLess(plan["stop_loss"], plan["stake"] * 0.9)

    def test_tiny_position_has_no_plan(self):
        from server.app.deriv import plan_multiplier_order

        self.assertEqual(plan_multiplier_order(40, 1.1, 1.0985, 1.104), [])

    def test_position_above_deriv_maximum_has_no_plan(self):
        from server.app.deriv import plan_multiplier_order

        # $500 stake x 500 = $250,000 is Deriv's largest position.
        self.assertEqual(plan_multiplier_order(300000, 1.1, 1.0985, 1.104), [])

    def test_usd_notional(self):
        from server.app.trading import usd_notional

        quotes = {"EUR/USD": {"bid": 1.0999, "ask": 1.1001}, "GBP/USD": {"bid": 1.2999, "ask": 1.3001}}
        self.assertEqual(usd_notional("USD/JPY", 10000, quotes), 10000.0)
        self.assertAlmostEqual(usd_notional("EUR/JPY", 10000, quotes), 11000.0)
        self.assertAlmostEqual(usd_notional("GBP/CAD", 10000, quotes), 13000.0)
        self.assertIsNone(usd_notional("EUR/GBP", 10000, {}))
