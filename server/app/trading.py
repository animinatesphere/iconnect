"""iTrade paper desk: risk-profile mandate and hard-gate risk engine from NH FX V13.4.

No market data, news feed or broker is connected. Everything here runs in PAPER
or EXTERNAL_MANUAL mode only: the server drafts protected tickets from trader
inputs and the saved risk profile, but it never transmits an order anywhere.
"""

import math
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Literal, Optional
from uuid import UUID

from fastapi import Body, Depends, FastAPI
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator


# ---------------------------------------------------------------------------
# Configuration (V13.4 sections 1, 14). Starting values, not calibrated ones.
# ---------------------------------------------------------------------------

CURRENCIES = ("USD", "EUR", "GBP", "JPY", "CAD")

PAIRS: Dict[str, tuple] = {
    "EUR/USD": ("EUR", "USD"),
    "GBP/USD": ("GBP", "USD"),
    "USD/JPY": ("USD", "JPY"),
    "USD/CAD": ("USD", "CAD"),
    "EUR/GBP": ("EUR", "GBP"),
    "EUR/JPY": ("EUR", "JPY"),
    "EUR/CAD": ("EUR", "CAD"),
    "GBP/JPY": ("GBP", "JPY"),
    "GBP/CAD": ("GBP", "CAD"),
    "CAD/JPY": ("CAD", "JPY"),
}

# Starting spread ceilings per pair, in pips. Configuration, not calibration.
MAX_SPREAD_PIPS: Dict[str, float] = {
    "EUR/USD": 2.0,
    "GBP/USD": 2.5,
    "USD/JPY": 2.0,
    "USD/CAD": 2.5,
    "EUR/GBP": 2.5,
    "EUR/JPY": 3.5,
    "EUR/CAD": 4.0,
    "GBP/JPY": 4.5,
    "GBP/CAD": 5.0,
    "CAD/JPY": 4.0,
}

MAX_ENTRY_DEVIATION_PIPS = 2.0
QUOTE_MAX_AGE_SECONDS = 30
STOP_MIN_PIPS = 15.0
STOP_MAX_PIPS = 20.0
MIN_NET_REWARD_TO_RISK = 2.0
TICKET_TTL_SECONDS = 120
LOT_STEP_UNITS = 1000
COOLING_PERIOD_HOURS = 24
SESSION_LOSS_LOCK_COUNT = 2
EXTERNAL_CAPITAL_STALE_DAYS = 7

RISK_TOLERANCES: Dict[str, Dict[str, Any]] = {
    "capital_preservation": {"label": "Capital preservation", "min_probability": 75.0, "max_risk_pct": 0.5},
    "conservative": {"label": "Conservative", "min_probability": 70.0, "max_risk_pct": 0.75},
    "balanced": {"label": "Balanced", "min_probability": 65.0, "max_risk_pct": 1.0},
    "custom_restrictive": {"label": "Custom restrictive", "min_probability": 65.0, "max_risk_pct": 1.0},
}

# System safety bounds. No profile may be set outside these.
SAFETY_BOUNDS = {
    "max_probability": 95.0,
    "max_risk_per_idea_pct": 2.0,
    "max_correlated_risk_pct": 4.0,
    "max_open_ideas": 5,
    "max_daily_loss_pct": 5.0,
    "max_weekly_loss_pct": 10.0,
    "max_quantity": 1_000_000,
}

RELEASE_STATES = ("SCHEDULED", "HEADLINE_ONLY", "FULL_PRINT", "MICROSTRUCTURE_USABLE")

FEEDS = [
    ("benzinga", "Benzinga breaking news"),
    ("calendar", "Economic calendar"),
    ("ibkr_market", "IBKR quotes and Level 2"),
    ("ibkr_orders", "IBKR order management"),
    ("cme_level2", "CME futures Level 2"),
    ("third_level2", "Associated-market Level 2"),
    ("rates", "Rates, DXY, VIX, oil, metals"),
]


LIMIT_LABELS = {
    "perIdeaAmount": "per-idea amount",
    "perIdeaEquityPct": "per-idea % of equity",
    "correlatedExposure": "correlated currency cap",
    "wideStopReference": "reference size after wide-stop cut",
    "absoluteMaximum": "absolute maximum quantity",
}


def pip_size(pair: str) -> float:
    return 0.01 if PAIRS[pair][1] == "JPY" else 0.0001


def public_config() -> Dict[str, Any]:
    return {
        "currencies": list(CURRENCIES),
        "pairs": [
            {"pair": pair, "base": base, "quote": quote, "pipSize": pip_size(pair), "maxSpreadPips": MAX_SPREAD_PIPS[pair]}
            for pair, (base, quote) in PAIRS.items()
        ],
        "stopMinPips": STOP_MIN_PIPS,
        "stopMaxPips": STOP_MAX_PIPS,
        "minNetRewardToRisk": MIN_NET_REWARD_TO_RISK,
        "ticketTtlSeconds": TICKET_TTL_SECONDS,
        "lotStepUnits": LOT_STEP_UNITS,
        "coolingPeriodHours": COOLING_PERIOD_HOURS,
        "riskTolerances": [{"id": key, **value} for key, value in RISK_TOLERANCES.items()],
        "safetyBounds": SAFETY_BOUNDS,
        "releaseStates": list(RELEASE_STATES),
    }


def system_status(market_state: str = "DISCONNECTED", deriv_available: bool = False,
                  deriv_pairs: Optional[List[str]] = None) -> Dict[str, Any]:
    feeds = [{"id": "deriv_market", "name": "Deriv live FX quotes", "state": market_state}]
    feeds += [{"id": key, "name": name, "state": "DISCONNECTED"} for key, name in FEEDS]
    return {
        "stage": "DERIV_DEMO" if deriv_available else "PAPER",
        "orderTransmission": "DERIV_DEMO_ONLY" if deriv_available else "DISABLED",
        "calibration": "NOT_YET_CALIBRATED",
        "feeds": feeds,
        "derivPairs": deriv_pairs or [],
        "brokerModes": [
            {"id": "paper", "label": "Paper (system-tracked)", "available": True},
            {"id": "external_manual", "label": "External manual", "available": True},
            {"id": "deriv_demo", "label": "Deriv demo (linked)", "available": deriv_available},
            {"id": "owner_linked_ibkr", "label": "Owner linked IBKR", "available": False},
        ],
        "config": public_config(),
    }


# ---------------------------------------------------------------------------
# Input models
# ---------------------------------------------------------------------------


class TradingModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RiskProfileInput(TradingModel):
    operating_mode: Literal["paper", "external_manual", "deriv_demo"]
    account_currency: Literal["USD", "EUR", "GBP", "JPY", "CAD"]
    capital: float = Field(gt=0, le=1_000_000_000)
    risk_tolerance: Literal["capital_preservation", "conservative", "balanced", "custom_restrictive"]
    min_probability: float = Field(ge=65, le=95)
    reference_quantity: int = Field(ge=LOT_STEP_UNITS, le=SAFETY_BOUNDS["max_quantity"])
    max_quantity: int = Field(ge=LOT_STEP_UNITS, le=SAFETY_BOUNDS["max_quantity"])
    max_risk_per_idea: float = Field(gt=0, le=1_000_000_000)
    max_risk_per_idea_pct: float = Field(gt=0, le=SAFETY_BOUNDS["max_risk_per_idea_pct"])
    max_correlated_risk_pct: float = Field(gt=0, le=SAFETY_BOUNDS["max_correlated_risk_pct"])
    max_open_ideas: int = Field(ge=1, le=SAFETY_BOUNDS["max_open_ideas"])
    daily_loss_limit_pct: float = Field(gt=0, le=SAFETY_BOUNDS["max_daily_loss_pct"])
    weekly_loss_limit_pct: float = Field(gt=0, le=SAFETY_BOUNDS["max_weekly_loss_pct"])
    permitted_pairs: List[str] = Field(min_length=1, max_length=len(PAIRS))
    acknowledge_risk: bool
    acknowledge_manual_execution: bool
    acknowledge_external_unverified: bool = False

    @field_validator("permitted_pairs")
    @classmethod
    def valid_pairs(cls, values: List[str]) -> List[str]:
        unknown = [value for value in values if value not in PAIRS]
        if unknown:
            raise ValueError("Unknown pair: {}.".format(", ".join(unknown)))
        return [pair for pair in PAIRS if pair in set(values)]

    @model_validator(mode="after")
    def check_profile(self) -> "RiskProfileInput":
        tolerance = RISK_TOLERANCES[self.risk_tolerance]
        if self.min_probability < tolerance["min_probability"]:
            raise ValueError(
                "{} requires a minimum probability of at least {:.0f}%.".format(
                    tolerance["label"], tolerance["min_probability"],
                )
            )
        if self.max_risk_per_idea_pct > tolerance["max_risk_pct"]:
            raise ValueError(
                "{} allows at most {}% of equity at risk per idea.".format(
                    tolerance["label"], tolerance["max_risk_pct"],
                )
            )
        if self.reference_quantity > self.max_quantity:
            raise ValueError("The 15-pip reference quantity cannot exceed the maximum quantity.")
        if self.max_correlated_risk_pct < self.max_risk_per_idea_pct:
            raise ValueError("Correlated exposure limit must be at least the per-idea risk limit.")
        if self.weekly_loss_limit_pct < self.daily_loss_limit_pct:
            raise ValueError("Weekly loss limit must be at least the daily loss limit.")
        if not self.acknowledge_risk or not self.acknowledge_manual_execution:
            raise ValueError("Confirm the risk disclosure and the manual-execution requirement.")
        if self.operating_mode == "external_manual" and not self.acknowledge_external_unverified:
            raise ValueError("Confirm that the system cannot verify or enforce trades in your external broker.")
        return self


class TicketInput(TradingModel):
    pair: str
    side: Literal["buy", "sell"]
    entry_price: float = Field(gt=0, le=100000)
    stop_price: float = Field(gt=0, le=100000)
    target_price: float = Field(gt=0, le=100000)
    spread_pips: float = Field(ge=0, le=50)
    slippage_pips: float = Field(default=0.5, ge=0, le=50)
    commission_per_100k: float = Field(default=0, ge=0, le=1000)
    gap_allowance_pips: float = Field(default=0, ge=0, le=50)
    probability: float = Field(ge=0, le=100)
    release_state: Literal["SCHEDULED", "HEADLINE_ONLY", "FULL_PRINT", "MICROSTRUCTURE_USABLE"]
    microstructure_usable: bool
    data_checked: bool
    quote_to_account_rate: Optional[float] = Field(default=None, gt=0, le=100000)
    rationale: str = Field(min_length=3, max_length=200)
    event_label: str = Field(default="", max_length=120)

    @field_validator("pair")
    @classmethod
    def valid_pair(cls, value: str) -> str:
        if value not in PAIRS:
            raise ValueError("Choose one of the ten supported pairs.")
        return value

    @field_validator("rationale", "event_label")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return " ".join(value.split())


class AuthorizeInput(TradingModel):
    idempotency_key: UUID
    quantity: int = Field(ge=LOT_STEP_UNITS, le=SAFETY_BOUNDS["max_quantity"])


class ReportInput(TradingModel):
    result: Literal["filled", "not_filled", "cancelled"]
    fill_price: Optional[float] = Field(default=None, gt=0, le=100000)
    quantity: Optional[int] = Field(default=None, ge=1, le=SAFETY_BOUNDS["max_quantity"])


class ResolveInput(TradingModel):
    opened: bool
    contract_id: Optional[int] = Field(default=None, ge=1)


class CloseInput(TradingModel):
    exit_price: Optional[float] = Field(default=None, gt=0, le=100000)


# ---------------------------------------------------------------------------
# Pure risk engine
# ---------------------------------------------------------------------------


def is_risk_increase(old: Optional[Dict[str, Any]], new: Dict[str, Any]) -> bool:
    """True when the new profile permits more risk, quantity or scope than the old one."""
    if not old:
        return False
    higher_is_riskier = (
        "capital", "reference_quantity", "max_quantity", "max_risk_per_idea",
        "max_risk_per_idea_pct", "max_correlated_risk_pct", "max_open_ideas",
        "daily_loss_limit_pct", "weekly_loss_limit_pct",
    )
    for key in higher_is_riskier:
        if float(new[key]) > float(old[key]) + 1e-9:
            return True
    if float(new["min_probability"]) < float(old["min_probability"]) - 1e-9:
        return True
    if set(new["permitted_pairs"]) - set(old["permitted_pairs"]):
        return True
    if new["operating_mode"] != old["operating_mode"] or new["account_currency"] != old["account_currency"]:
        return True
    return False


def pip_value_per_unit(pair: str, account_currency: str, price: float, quote_to_account_rate: Optional[float]) -> Optional[float]:
    """Value of one pip on one unit of the pair, in the account currency."""
    base, quote = PAIRS[pair]
    size = pip_size(pair)
    if quote == account_currency:
        return size
    if base == account_currency:
        return size / price
    if quote_to_account_rate:
        return size * quote_to_account_rate
    return None


def currency_legs(pair: str, side: str) -> List[tuple]:
    """A BUY of EUR/USD is long EUR and short USD."""
    base, quote = PAIRS[pair]
    if side == "buy":
        return [(base, "long"), (quote, "short")]
    return [(base, "short"), (quote, "long")]


def _gate(gate_id: str, name: str, status: str, detail: str) -> Dict[str, str]:
    return {"id": gate_id, "name": name, "status": status, "detail": detail}


GATE_NAMES = [
    ("G1", "Data freshness and source validity"),
    ("G2", "Release state is FULL_PRINT or later"),
    ("G3", "Market stability, liquidity and spread"),
    ("G4", "Protective stop between 15 and 20 pips"),
    ("G5", "Required probability and wide-stop size"),
    ("G6", "Minimum 2:1 net reward-to-risk"),
    ("G7", "Correlation, dollar-risk and account limits"),
    ("G8", "Manual authorization"),
]


def evaluate_ticket(profile: Dict[str, Any], account: Dict[str, Any], ticket: Dict[str, Any]) -> Dict[str, Any]:
    """Run the V13.4 eligibility gates in order. An earlier failure ends evaluation.

    profile: the effective risk-profile settings.
    account: equity, open exposure and lock state from the database.
    ticket:  TicketInput fields.
    """
    pair = ticket["pair"]
    side = ticket["side"]
    entry = float(ticket["entry_price"])
    stop = float(ticket["stop_price"])
    target = float(ticket["target_price"])
    size = pip_size(pair)
    gates: List[Dict[str, str]] = []
    metrics: Dict[str, Any] = {}
    reason: Optional[str] = None

    def finish(qualified: bool, draft: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        evaluated = {gate["id"] for gate in gates}
        for gate_id, name in GATE_NAMES:
            if gate_id not in evaluated:
                gates.append(_gate(gate_id, name, "not_evaluated", "Not reached because an earlier gate failed."
                                   if not qualified else "Required when you authorize the draft."))
        return {
            "qualified": qualified,
            "outcome": "DRAFT_PREPARED" if qualified else "NO_TRADE",
            "reason": reason,
            "gates": gates,
            "metrics": metrics,
            "draft": draft,
            "probabilitySource": "TRADER_ESTIMATE_NOT_CALIBRATED",
        }

    # G1 — data freshness. A live Deriv quote checks the price; news is still the trader's check.
    pip_value = pip_value_per_unit(pair, profile["account_currency"], entry, ticket.get("quote_to_account_rate"))
    live = ticket.get("live_quote")
    live_detail = ""
    if ticket.get("require_live_quote") and not live:
        reason = "NO TRADE — LIVE PRICE UNAVAILABLE"
        gates.append(_gate("G1", GATE_NAMES[0][1], "fail", "No fresh Deriv price for {}. It may not be offered on Deriv, the market may be closed, or the feed is down.".format(pair)))
        return finish(False)
    if live:
        executable = float(live["ask"] if side == "buy" else live["bid"])
        live_spread = round((float(live["ask"]) - float(live["bid"])) / size, 1)
        deviation = round(abs(entry - executable) / size, 1)
        metrics.update({"liveBid": live["bid"], "liveAsk": live["ask"], "liveSpreadPips": live_spread, "entryDeviationPips": deviation})
        if deviation > MAX_ENTRY_DEVIATION_PIPS:
            reason = "NO TRADE — ENTRY IS AWAY FROM THE LIVE PRICE"
            gates.append(_gate("G1", GATE_NAMES[0][1], "fail",
                               "Entry {} is {:.1f} pips from the live {} {} (limit {:.0f} pips). Use the live price.".format(
                                   entry, deviation, "ask" if side == "buy" else "bid", executable, MAX_ENTRY_DEVIATION_PIPS)))
            return finish(False)
        live_detail = "Live Deriv {} {} ({:.1f}-pip spread). ".format("ask" if side == "buy" else "bid", executable, live_spread)
    if not ticket["data_checked"]:
        reason = "NO TRADE — PRICE AND NEWS DATA NOT CONFIRMED"
        gates.append(_gate("G1", GATE_NAMES[0][1], "fail", "Confirm you checked breaking news{}.".format("" if live else " and current prices")))
        return finish(False)
    if pip_value is None:
        reason = "NO TRADE — ACCOUNT CONVERSION RATE MISSING"
        gates.append(_gate("G1", GATE_NAMES[0][1], "fail",
                           "Enter the {}→{} conversion rate so pip value can be calculated. It is never assumed.".format(
                               PAIRS[pair][1], profile["account_currency"])))
        return finish(False)
    gates.append(_gate("G1", GATE_NAMES[0][1], "pass", live_detail + ("News: trader-confirmed." if live else "Prices and news trader-confirmed (no live price for this pair).")))

    # G2 — release state. No ticket from SCHEDULED or HEADLINE_ONLY.
    if RELEASE_STATES.index(ticket["release_state"]) < RELEASE_STATES.index("FULL_PRINT"):
        reason = "NO TRADE — WAIT FOR FULL PRINT"
        gates.append(_gate("G2", GATE_NAMES[1][1], "fail", "{} cannot produce a ticket. The first tick is not a signal.".format(ticket["release_state"])))
        return finish(False)
    gates.append(_gate("G2", GATE_NAMES[1][1], "pass", ticket["release_state"]))

    # G3 — microstructure and spread.
    spread = float(ticket["spread_pips"])
    if live:
        spread = max(spread, metrics["liveSpreadPips"])
    max_spread = MAX_SPREAD_PIPS[pair]
    if not ticket["microstructure_usable"]:
        reason = "WAIT — MARKET NOT STABLE"
        gates.append(_gate("G3", GATE_NAMES[2][1], "fail", "The order book is not usable yet."))
        return finish(False)
    if spread > max_spread:
        reason = "WAIT — SPREAD TOO WIDE"
        gates.append(_gate("G3", GATE_NAMES[2][1], "fail", "Spread {:.1f} pips is above the {:.1f}-pip limit for {}.".format(spread, max_spread, pair)))
        return finish(False)
    gates.append(_gate("G3", GATE_NAMES[2][1], "pass", "Spread {:.1f} pips (limit {:.1f}).".format(spread, max_spread)))

    # G4 — stop distance, and direction sanity.
    if side == "buy" and not (stop < entry < target):
        reason = "NO TRADE — PRICES ON THE WRONG SIDE"
        gates.append(_gate("G4", GATE_NAMES[3][1], "fail", "For a BUY, the stop must be below entry and the target above it."))
        return finish(False)
    if side == "sell" and not (target < entry < stop):
        reason = "NO TRADE — PRICES ON THE WRONG SIDE"
        gates.append(_gate("G4", GATE_NAMES[3][1], "fail", "For a SELL, the stop must be above entry and the target below it."))
        return finish(False)
    stop_pips = round(abs(entry - stop) / size, 1)
    target_pips = round(abs(target - entry) / size, 1)
    metrics.update({"stopPips": stop_pips, "targetPips": target_pips, "pipValuePerUnit": pip_value})
    if stop_pips > STOP_MAX_PIPS:
        reason = "REJECTED — REQUIRED STOP EXCEEDS 20-PIP SAFETY CEILING"
        gates.append(_gate("G4", GATE_NAMES[3][1], "fail", "Stop is {:.1f} pips. Above 20 pips the market is unstable for this strategy; no size or probability can override this.".format(stop_pips)))
        return finish(False)
    if stop_pips < STOP_MIN_PIPS:
        reason = "NO TRADE — STOP BELOW 15-PIP PRODUCTION MINIMUM"
        gates.append(_gate("G4", GATE_NAMES[3][1], "fail", "Stop is {:.1f} pips. The production minimum is 15 pips so normal post-event noise does not stop the trade out.".format(stop_pips)))
        return finish(False)
    wide = stop_pips > STOP_MIN_PIPS
    gates.append(_gate("G4", GATE_NAMES[3][1], "pass",
                       "{:.1f}-pip stop{}.".format(stop_pips, " — wide-stop risk escalation applies" if wide else "")))

    # G5 — probability, with +1 point per full pip above 15, and the wide-stop size cut.
    base_probability = float(profile["min_probability"])
    required_probability = base_probability + max(0, math.floor(stop_pips - STOP_MIN_PIPS + 1e-9))
    probability = float(ticket["probability"])
    wide_stop_factor = min(1.0, STOP_MIN_PIPS / stop_pips)
    metrics.update({"requiredProbability": required_probability, "probability": probability, "wideStopFactor": round(wide_stop_factor, 4)})
    if probability < required_probability:
        reason = "NO TRADE — PROBABILITY BELOW YOUR PROFILE THRESHOLD"
        gates.append(_gate("G5", GATE_NAMES[4][1], "fail",
                           "{:.0f}% is below the {:.0f}% required for a {:.1f}-pip stop under your profile.".format(probability, required_probability, stop_pips)))
        return finish(False)
    gates.append(_gate("G5", GATE_NAMES[4][1], "pass",
                       "{:.0f}% ≥ {:.0f}% required. Size limited to {:.2f}% of your reference quantity.".format(
                           probability, required_probability, wide_stop_factor * 100)))

    # G6 — net reward-to-risk on costs.
    slippage = float(ticket["slippage_pips"])
    gap = float(ticket["gap_allowance_pips"])
    commission_pips = (float(ticket["commission_per_100k"]) / 100000.0) / pip_value
    costs = spread + slippage + commission_pips
    net_upside = target_pips - costs
    total_downside = stop_pips + costs + gap
    net_rr = net_upside / total_downside if total_downside > 0 else 0.0
    metrics.update({
        "costPips": round(costs, 2),
        "netUpsidePips": round(net_upside, 2),
        "totalDownsidePips": round(total_downside, 2),
        "netRewardToRisk": round(net_rr, 2),
        "requiredTargetPips": round(2 * stop_pips, 1),
    })
    if target_pips + 1e-9 < 2 * stop_pips:
        reason = "NO TRADE — TARGET BELOW 2× STOP DISTANCE"
        gates.append(_gate("G6", GATE_NAMES[5][1], "fail",
                           "A {:.1f}-pip stop needs at least {:.1f} pips to the target; this target is {:.1f}.".format(stop_pips, 2 * stop_pips, target_pips)))
        return finish(False)
    if net_rr + 1e-9 < MIN_NET_REWARD_TO_RISK:
        reason = "NO TRADE — NET REWARD-TO-RISK BELOW 2.00"
        gates.append(_gate("G6", GATE_NAMES[5][1], "fail",
                           "After costs: {:.1f} pips net upside vs {:.1f} pips total downside = {:.2f}:1.".format(net_upside, total_downside, net_rr)))
        return finish(False)
    gates.append(_gate("G6", GATE_NAMES[5][1], "pass", "{:.2f}:1 after {:.1f} pips of costs.".format(net_rr, costs)))

    # G7 — account state and the drafted quantity.
    equity = float(account["equity"])
    locks = account.get("locks") or []
    if locks:
        reason = "NO TRADE — " + locks[0]["label"].upper()
        gates.append(_gate("G7", GATE_NAMES[6][1], "fail", locks[0]["detail"]))
        return finish(False)
    if pair not in profile["permitted_pairs"]:
        reason = "NO TRADE — PAIR NOT PERMITTED BY YOUR PROFILE"
        gates.append(_gate("G7", GATE_NAMES[6][1], "fail", "{} is not in your permitted pairs.".format(pair)))
        return finish(False)
    if int(account["open_ideas"]) >= int(profile["max_open_ideas"]):
        reason = "NO TRADE — MAXIMUM OPEN IDEAS REACHED"
        gates.append(_gate("G7", GATE_NAMES[6][1], "fail", "You already have {} open idea(s); your limit is {}.".format(account["open_ideas"], profile["max_open_ideas"])))
        return finish(False)

    loss_per_unit = total_downside * pip_value
    exposure = account.get("exposure") or {}
    correlated_cap = equity * float(profile["max_correlated_risk_pct"]) / 100.0
    correlated_room = None
    for currency, direction in currency_legs(pair, side):
        used = float((exposure.get(currency) or {}).get(direction, 0.0))
        room = correlated_cap - used
        correlated_room = room if correlated_room is None else min(correlated_room, room)
    limits = {
        "perIdeaAmount": float(profile["max_risk_per_idea"]) / loss_per_unit,
        "perIdeaEquityPct": equity * float(profile["max_risk_per_idea_pct"]) / 100.0 / loss_per_unit,
        "correlatedExposure": max(0.0, correlated_room or 0.0) / loss_per_unit,
        "wideStopReference": float(profile["reference_quantity"]) * wide_stop_factor,
        "absoluteMaximum": float(profile["max_quantity"]),
    }
    binding = min(limits, key=lambda key: limits[key])
    quantity = int(math.floor(limits[binding] / LOT_STEP_UNITS + 1e-9) * LOT_STEP_UNITS)
    metrics["quantityLimits"] = {key: int(math.floor(value)) for key, value in limits.items()}
    metrics["bindingLimit"] = binding
    if quantity < LOT_STEP_UNITS:
        reason = "NO TRADE — RISK LIMITS ALLOW LESS THAN 1,000 UNITS"
        gates.append(_gate("G7", GATE_NAMES[6][1], "fail",
                           "The tightest limit ({}) allows {:,} units, below the 1,000-unit minimum.".format(LIMIT_LABELS[binding], int(limits[binding]))))
        return finish(False)
    risk_amount = round(quantity * loss_per_unit, 2)
    gates.append(_gate("G7", GATE_NAMES[6][1], "pass",
                       "Drafted {:,} units; the tightest limit is your {}.".format(quantity, LIMIT_LABELS[binding])))
    reason = "QUALIFIED — DRAFT READY FOR MANUAL AUTHORIZATION"
    draft = {
        "quantity": quantity,
        "riskAmount": risk_amount,
        "riskPct": round(risk_amount / equity * 100.0, 3) if equity else None,
        "rewardAmount": round(quantity * net_upside * pip_value, 2),
        "lossPerUnit": loss_per_unit,
    }
    return finish(True, draft)


def risk_for_quantity(decision: Dict[str, Any], quantity: int) -> float:
    return round(quantity * float(decision["draft"]["lossPerUnit"]), 2)


def realized_pnl(pair: str, side: str, account_currency: str, fill: float, exit_price: float,
                 quantity: int, quote_to_account_rate: Optional[float], commission_per_100k: float) -> float:
    base, quote = PAIRS[pair]
    direction = 1 if side == "buy" else -1
    pnl_quote = (exit_price - fill) * direction * quantity
    if quote == account_currency:
        pnl = pnl_quote
    elif base == account_currency:
        pnl = pnl_quote / exit_price
    else:
        pnl = pnl_quote * float(quote_to_account_rate or 0)
    pnl -= commission_per_100k * quantity / 100000.0
    return round(pnl, 2)


def compute_locks(profile: Dict[str, Any], capital: float, today_pnl: float, week_pnl: float,
                  losses_today: int, capital_confirmed_at: Optional[datetime], now: datetime) -> List[Dict[str, str]]:
    locks = []
    if today_pnl <= -capital * float(profile["daily_loss_limit_pct"]) / 100.0:
        locks.append({"id": "DAILY_HALT", "label": "Daily loss limit reached",
                      "detail": "Realized loss today has reached your {}% daily limit. New drafts resume next session (UTC).".format(profile["daily_loss_limit_pct"])})
    if week_pnl <= -capital * float(profile["weekly_loss_limit_pct"]) / 100.0:
        locks.append({"id": "WEEKLY_HALT", "label": "Weekly loss limit reached",
                      "detail": "Realized loss this week has reached your {}% weekly limit. New drafts resume next week.".format(profile["weekly_loss_limit_pct"])})
    if losses_today >= SESSION_LOSS_LOCK_COUNT:
        locks.append({"id": "SESSION_LOCK", "label": "Two-loss session lock",
                      "detail": "Two losing trades this session. Without live market-quality data the system cannot confirm recovery, so the lock holds until the next session (UTC). A timer alone never releases it during the session."})
    if profile["operating_mode"] == "external_manual" and capital_confirmed_at:
        age_days = (now - capital_confirmed_at).total_seconds() / 86400
        if age_days > EXTERNAL_CAPITAL_STALE_DAYS:
            locks.append({"id": "PROFILE_STALE", "label": "Profile and exposure stale",
                          "detail": "Your external capital was confirmed more than {} days ago. Re-save your risk profile to confirm it.".format(EXTERNAL_CAPITAL_STALE_DAYS)})
    return locks


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

OPEN_STATUSES = ("accepted_manual", "open")
# Submitting tickets already reserve risk: the order may be live at the broker.
EXPOSURE_STATUSES = ("accepted_manual", "open", "submitting")

TICKET_COLUMNS = """id, user_id, profile_id, operating_mode, pair, side, status, decision,
                    drafted_quantity, authorized_quantity, risk_amount, entry_price, stop_price,
                    target_price, fill_price, exit_price, realized_pnl, execution_source,
                    idempotency_key, expires_at, authorized_at, closed_at, created_at, broker"""


def _float(value: Any) -> Optional[float]:
    return float(value) if value is not None else None


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def public_profile(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    return {
        "id": str(row["id"]),
        "version": int(row["version"]),
        "settings": row["settings"],
        "effectiveFrom": _iso(row["effective_from"]),
        "createdAt": _iso(row["created_at"]),
    }


def public_ticket(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(row["id"]),
        "operatingMode": row["operating_mode"],
        "pair": row["pair"],
        "side": row["side"],
        "status": row["status"],
        "decision": row["decision"],
        "draftedQuantity": row["drafted_quantity"],
        "authorizedQuantity": row["authorized_quantity"],
        "riskAmount": _float(row["risk_amount"]),
        "entryPrice": _float(row["entry_price"]),
        "stopPrice": _float(row["stop_price"]),
        "targetPrice": _float(row["target_price"]),
        "fillPrice": _float(row["fill_price"]),
        "exitPrice": _float(row["exit_price"]),
        "realizedPnl": _float(row["realized_pnl"]),
        "executionSource": row["execution_source"],
        "broker": row.get("broker"),
        "idempotencyKey": str(row["idempotency_key"]) if row["status"] == "drafted" else None,
        "expiresAt": _iso(row["expires_at"]),
        "authorizedAt": _iso(row["authorized_at"]),
        "closedAt": _iso(row["closed_at"]),
        "createdAt": _iso(row["created_at"]),
    }


def usd_notional(pair: str, units: int, quotes: Dict[str, Dict[str, Any]]) -> Optional[float]:
    """USD value of a position, needed because a Deriv stake x multiplier is in USD."""
    base = PAIRS[pair][0]
    if base == "USD":
        return float(units)
    reference = {"EUR": "EUR/USD", "GBP": "GBP/USD"}.get(base)
    quote = quotes.get(reference) if reference else None
    if not quote:
        return None
    return float(units) * (float(quote["bid"]) + float(quote["ask"])) / 2.0


def register_trading_routes(
    app: FastAPI,
    database: Any,
    require_user: Callable[..., Dict[str, Any]],
    rate_limit: Callable[..., None],
    api_error: Callable[[int, str, str], Exception],
    market: Any = None,
    deriv: Any = None,
    is_owner: Optional[Callable[[Dict[str, Any]], bool]] = None,
) -> None:
    from .deriv import DERIV_SYMBOLS, DerivError, plan_multiplier_order

    balance_cache: Dict[str, Any] = {"value": None, "at": None}

    def deriv_ready(user: Dict[str, Any]) -> bool:
        return bool(deriv is not None and deriv.configured and is_owner and is_owner(user))

    def live_quote(pair: str) -> Optional[Dict[str, Any]]:
        if market is None or pair not in DERIV_SYMBOLS:
            return None
        quote = market.quote(pair)
        if not quote:
            return None
        age = max(0, int(datetime.now(timezone.utc).timestamp()) - int(quote["epoch"]))
        if age > QUOTE_MAX_AGE_SECONDS:
            return None
        return dict(quote, age=age)

    def deriv_balance() -> Optional[Dict[str, Any]]:
        import time as _time

        if balance_cache["value"] and balance_cache["at"] is not None and _time.monotonic() - balance_cache["at"] < 15:
            return balance_cache["value"]
        balance_cache["value"] = deriv.balance()
        balance_cache["at"] = _time.monotonic()
        return balance_cache["value"]

    def parse(model: Any, payload: Any) -> Any:
        # Return the specific rule that failed instead of the app-wide generic message.
        try:
            return model.model_validate(payload)
        except ValidationError as error:
            first = error.errors()[0] if error.errors() else {}
            field = ".".join(str(part) for part in first.get("loc", ()) if part != "__root__")
            message = str(first.get("msg", "Check the information and try again.")).replace("Value error, ", "")
            if field and first.get("type") != "value_error":
                message = "{}: {}".format(field.replace("_", " "), message)
            raise api_error(400, "invalid_input", message) from error

    def lock_user(connection: Any, user_id: Any) -> None:
        # Serializes drafting and authorization per trader so two devices or
        # repeated taps cannot over-reserve risk capacity.
        connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 7413))", (str(user_id),))

    def audit(connection: Any, user_id: Any, action: str, ticket_id: Any = None, details: Optional[Dict[str, Any]] = None) -> None:
        from psycopg.types.json import Jsonb

        connection.execute(
            """INSERT INTO trading_audit_events (user_id, ticket_id, action, details)
               VALUES (%s, %s, %s, %s)""",
            (user_id, ticket_id, action, Jsonb(details or {})),
        )

    def effective_profile(connection: Any, user_id: Any) -> Optional[Dict[str, Any]]:
        return connection.execute(
            """SELECT id, version, settings, effective_from, created_at
               FROM trading_risk_profiles
               WHERE user_id = %s AND cancelled_at IS NULL AND effective_from <= now()
               ORDER BY version DESC LIMIT 1""",
            (user_id,),
        ).fetchone()

    def pending_profile(connection: Any, user_id: Any) -> Optional[Dict[str, Any]]:
        return connection.execute(
            """SELECT id, version, settings, effective_from, created_at
               FROM trading_risk_profiles
               WHERE user_id = %s AND cancelled_at IS NULL AND effective_from > now()
               ORDER BY version DESC LIMIT 1""",
            (user_id,),
        ).fetchone()

    def expire_drafts(connection: Any, user_id: Any) -> None:
        expired = connection.execute(
            """UPDATE trading_tickets SET status = 'expired', updated_at = now()
               WHERE user_id = %s AND status = 'drafted' AND expires_at <= now()
               RETURNING id""",
            (user_id,),
        ).fetchall()
        for row in expired:
            audit(connection, user_id, "ticket_expired", row["id"])

    def account_state(connection: Any, user_id: Any, profile_row: Dict[str, Any],
                      broker_balance: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        settings = profile_row["settings"]
        capital = float(settings["capital"])
        totals = connection.execute(
            """SELECT
                 COALESCE(SUM(realized_pnl) FILTER (WHERE closed_at >= %s), 0) AS total_pnl,
                 COALESCE(SUM(realized_pnl) FILTER (
                   WHERE closed_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0) AS today_pnl,
                 COALESCE(SUM(realized_pnl) FILTER (
                   WHERE closed_at >= date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0) AS week_pnl,
                 COUNT(*) FILTER (
                   WHERE realized_pnl < 0
                     AND closed_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS losses_today
               FROM trading_tickets
               WHERE user_id = %s AND status = 'closed' AND operating_mode = %s""",
            # Equity counts P&L since the declared capital was set. Loss counters
            # never reset on a profile save, so re-saving cannot clear a lock.
            (datetime.fromisoformat(settings["capital_basis_at"]), user_id, settings["operating_mode"]),
        ).fetchone()
        open_rows = connection.execute(
            """SELECT pair, side, risk_amount FROM trading_tickets
               WHERE user_id = %s AND status IN ('accepted_manual', 'open', 'submitting')""",
            (user_id,),
        ).fetchall()
        exposure: Dict[str, Dict[str, float]] = {}
        for row in open_rows:
            for currency, direction in currency_legs(row["pair"], row["side"]):
                bucket = exposure.setdefault(currency, {"long": 0.0, "short": 0.0})
                bucket[direction] = round(bucket[direction] + float(row["risk_amount"] or 0), 2)
        today_pnl = float(totals["today_pnl"])
        week_pnl = float(totals["week_pnl"])
        losses_today = int(totals["losses_today"])
        confirmed_at = datetime.fromisoformat(settings["capital_confirmed_at"]) if settings.get("capital_confirmed_at") else None
        locks = compute_locks(settings, capital, today_pnl, week_pnl, losses_today, confirmed_at, datetime.now(timezone.utc))
        if settings["operating_mode"] == "deriv_demo" and broker_balance:
            equity = float(broker_balance["balance"])
            source = "DERIV_DEMO"
        else:
            equity = capital + float(totals["total_pnl"])
            source = "PAPER_LEDGER" if settings["operating_mode"] == "paper" else "USER_REPORTED"
        return {
            "capital": capital,
            "equity": round(equity, 2),
            "equitySource": source,
            "todayPnl": round(today_pnl, 2),
            "weekPnl": round(week_pnl, 2),
            "lossesToday": losses_today,
            "openIdeas": len(open_rows),
            "exposure": exposure,
            "correlatedCap": round(equity * float(settings["max_correlated_risk_pct"]) / 100.0, 2),
            "locks": locks,
            # Keys the pure engine reads:
            "open_ideas": len(open_rows),
        }

    def load_ticket(connection: Any, ticket_id: UUID, user_id: Any) -> Dict[str, Any]:
        row = connection.execute(
            "SELECT " + TICKET_COLUMNS + " FROM trading_tickets WHERE id = %s AND user_id = %s",
            (ticket_id, user_id),
        ).fetchone()
        if not row:
            raise api_error(404, "ticket_not_found", "That ticket could not be found.")
        return row

    def close_from_contract(connection: Any, user_id: Any, ticket: Dict[str, Any], contract: Dict[str, Any], reason: str) -> Optional[Dict[str, Any]]:
        from psycopg.types.json import Jsonb

        profit = contract.get("profit")
        if profit is None and contract.get("sell_price") is not None and contract.get("buy_price") is not None:
            profit = float(contract["sell_price"]) - float(contract["buy_price"])
        if profit is None:
            return None
        exit_spot = contract.get("exit_spot") or contract.get("current_spot")
        broker = dict(ticket.get("broker") or {}, closedBy=reason, status=contract.get("status"),
                      sellPrice=contract.get("sell_price"))
        row = connection.execute(
            """UPDATE trading_tickets SET status = 'closed', exit_price = %s, realized_pnl = %s,
                 broker = %s, closed_at = now(), updated_at = now()
               WHERE id = %s AND status = 'open'
               RETURNING """ + TICKET_COLUMNS,
            (float(exit_spot) if exit_spot else None, round(float(profit), 2), Jsonb(broker), ticket["id"]),
        ).fetchone()
        if row:
            audit(connection, user_id, "position_closed", ticket["id"], {
                "realizedPnl": round(float(profit), 2), "source": "DERIV_DEMO", "closedBy": reason,
            })
        return row

    def sync_deriv(user: Dict[str, Any]) -> Dict[str, Any]:
        """Pull live P&L for open Deriv contracts and close any that Deriv already closed."""
        with database.connection() as connection:
            rows = connection.execute(
                "SELECT " + TICKET_COLUMNS + """ FROM trading_tickets
                   WHERE user_id = %s AND operating_mode = 'deriv_demo' AND status = 'open'
                     AND broker ? 'contractId'""",
                (user["id"],),
            ).fetchall()
        if not rows:
            return {}
        contracts = deriv.open_contracts([int(row["broker"]["contractId"]) for row in rows])
        live: Dict[str, Any] = {}
        with database.connection() as connection:
            for row in rows:
                contract = contracts.get(int(row["broker"]["contractId"]))
                if not contract:
                    continue
                if contract.get("is_sold"):
                    close_from_contract(connection, user["id"], row, contract, "deriv_limit_order")
                    continue
                live[str(row["id"])] = {
                    "profit": _float(contract.get("profit")),
                    "currentSpot": _float(contract.get("current_spot")),
                    "entrySpot": _float(contract.get("entry_spot")),
                    "bidPrice": _float(contract.get("bid_price")),
                }
        return live

    @app.get("/api/trading/quotes")
    def trading_quotes(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        now = int(datetime.now(timezone.utc).timestamp())
        quotes = market.quotes() if market is not None else {}
        return {
            "serverTime": datetime.now(timezone.utc).isoformat(),
            "quotes": {
                pair: dict(quote, age=max(0, now - int(quote["epoch"])),
                           spreadPips=round((quote["ask"] - quote["bid"]) / pip_size(pair), 1))
                for pair, quote in quotes.items()
            },
        }

    @app.get("/api/trading/overview")
    def trading_overview(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        broker_live: Dict[str, Any] = {}
        broker_error = None
        broker_balance = None
        with database.connection() as connection:
            profile_row = effective_profile(connection, user["id"])
        if profile_row and profile_row["settings"]["operating_mode"] == "deriv_demo" and deriv_ready(user):
            try:
                broker_live = sync_deriv(user)
                broker_balance = deriv_balance()
            except DerivError as error:
                broker_error = error.message
        if market is not None:
            market.quotes()
        with database.connection() as connection:
            expire_drafts(connection, user["id"])
            profile_row = effective_profile(connection, user["id"])
            pending = pending_profile(connection, user["id"])
            account = account_state(connection, user["id"], profile_row, broker_balance) if profile_row else None
            if account:
                account.pop("open_ideas", None)
            tickets = connection.execute(
                "SELECT " + TICKET_COLUMNS + """ FROM trading_tickets WHERE user_id = %s
                   ORDER BY created_at DESC LIMIT 40""",
                (user["id"],),
            ).fetchall()
            events = connection.execute(
                """SELECT action, ticket_id, details, created_at FROM trading_audit_events
                   WHERE user_id = %s ORDER BY created_at DESC LIMIT 30""",
                (user["id"],),
            ).fetchall()
        return {
            "system": system_status(market.state() if market is not None else "DISCONNECTED", deriv_ready(user), list(DERIV_SYMBOLS)),
            "serverTime": datetime.now(timezone.utc).isoformat(),
            "profile": public_profile(profile_row),
            "pendingProfile": public_profile(pending),
            "account": account,
            "broker": {"live": broker_live, "error": broker_error, "balance": broker_balance},
            "tickets": [public_ticket(row) for row in tickets],
            "audit": [
                {
                    "action": row["action"],
                    "ticketId": str(row["ticket_id"]) if row["ticket_id"] else None,
                    "details": row["details"],
                    "createdAt": _iso(row["created_at"]),
                }
                for row in events
            ],
        }

    @app.put("/api/trading/profile", dependencies=[Depends(rate_limit)])
    def save_trading_profile(payload: Dict[str, Any] = Body(...), user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        from psycopg.types.json import Jsonb

        input = parse(RiskProfileInput, payload)
        settings = input.model_dump()
        if input.operating_mode == "deriv_demo":
            if not deriv_ready(user):
                raise api_error(403, "deriv_not_available",
                                "Deriv demo trading is only available to the site owner once Deriv is configured on the server.")
            try:
                deriv_account = deriv.account(refresh=True)
            except DerivError as error:
                raise api_error(502, error.code, error.message)
            if str(deriv_account.get("currency") or "").upper() != input.account_currency:
                raise api_error(400, "currency_mismatch", "Your Deriv demo account is in {}. Set the account currency to {}.".format(
                    deriv_account.get("currency"), deriv_account.get("currency")))
            unsupported = [pair for pair in input.permitted_pairs if pair not in DERIV_SYMBOLS]
            if unsupported:
                raise api_error(400, "pairs_not_on_deriv", "Deriv does not offer Multipliers on: {}. Untick them.".format(", ".join(unsupported)))
        now_iso = datetime.now(timezone.utc).isoformat()
        settings["capital_confirmed_at"] = now_iso
        settings["capital_basis_at"] = now_iso
        with database.connection() as connection:
            lock_user(connection, user["id"])
            current = effective_profile(connection, user["id"])
            if current:
                old = current["settings"]
                if (float(old["capital"]) == float(settings["capital"])
                        and old["operating_mode"] == settings["operating_mode"]
                        and old.get("capital_basis_at")):
                    # Same declared capital: keep the ledger running from the original basis.
                    settings["capital_basis_at"] = old["capital_basis_at"]
            increase = is_risk_increase(current["settings"] if current else None, settings)
            if increase and current:
                account = account_state(connection, user["id"], current)
                if account["locks"]:
                    raise api_error(409, "trading_locked",
                                    "Risk-increasing changes are not allowed while a loss lock or halt is active.")
            version_row = connection.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM trading_risk_profiles WHERE user_id = %s",
                (user["id"],),
            ).fetchone()
            connection.execute(
                """UPDATE trading_risk_profiles SET cancelled_at = now()
                   WHERE user_id = %s AND cancelled_at IS NULL AND effective_from > now()""",
                (user["id"],),
            )
            row = connection.execute(
                """INSERT INTO trading_risk_profiles (user_id, version, settings, effective_from)
                   VALUES (%s, %s, %s, now() + make_interval(hours => %s))
                   RETURNING id, version, settings, effective_from, created_at""",
                (user["id"], version_row["next"], Jsonb(settings), COOLING_PERIOD_HOURS if increase else 0),
            ).fetchone()
            if not increase:
                # Risk-reducing or first profile: drafts made under the old version are void.
                connection.execute(
                    """UPDATE trading_tickets SET status = 'expired', updated_at = now()
                       WHERE user_id = %s AND status = 'drafted'""",
                    (user["id"],),
                )
            audit(connection, user["id"], "profile_saved", None, {
                "version": row["version"],
                "riskIncrease": increase,
                "effectiveFrom": _iso(row["effective_from"]),
                "mode": settings["operating_mode"],
            })
        return {"profile": public_profile(row), "riskIncrease": increase, "coolingPeriodHours": COOLING_PERIOD_HOURS if increase else 0}

    @app.post("/api/trading/tickets", status_code=201, dependencies=[Depends(rate_limit)])
    def create_trading_ticket(payload: Dict[str, Any] = Body(...), user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        from psycopg.types.json import Jsonb

        input = parse(TicketInput, payload)
        quote = live_quote(input.pair)  # Network calls before taking the trader lock.
        deriv_commission = None
        if market is not None and input.pair in DERIV_SYMBOLS:
            rate = market.commission_rate(input.pair)
            notional_100k = usd_notional(input.pair, 100000, market.quotes())
            if rate is not None and notional_100k:
                deriv_commission = round(rate * notional_100k, 2)
        with database.connection() as connection:
            lock_user(connection, user["id"])
            expire_drafts(connection, user["id"])
            profile_row = effective_profile(connection, user["id"])
            if not profile_row:
                raise api_error(409, "risk_profile_required", "Set up and confirm your risk profile before drafting a ticket.")
            settings = profile_row["settings"]
            if settings["operating_mode"] == "deriv_demo" and not deriv_ready(user):
                raise api_error(409, "deriv_not_available", "Deriv is not configured on the server. Switch your profile to paper.")
            account = account_state(connection, user["id"], profile_row)
            inputs = input.model_dump()
            if settings["operating_mode"] == "deriv_demo":
                if deriv_commission is None:
                    raise api_error(503, "deriv_commission_unavailable", "Could not get Deriv's commission for this pair. Try again.")
                # Deriv charges commission instead of a separate fee; count it in the 2:1 check now.
                inputs["commission_per_100k"] = max(float(inputs["commission_per_100k"]), deriv_commission)
            decision = evaluate_ticket(settings, account, dict(
                inputs, live_quote=quote, require_live_quote=settings["operating_mode"] == "deriv_demo",
            ))
            decision["inputs"] = inputs
            decision["liveQuoteAtDraft"] = quote
            decision["derivCommissionPer100k"] = deriv_commission
            decision["profileVersion"] = int(profile_row["version"])
            decision["accountCurrency"] = settings["account_currency"]
            draft = decision["draft"]
            row = connection.execute(
                """INSERT INTO trading_tickets
                     (user_id, profile_id, operating_mode, pair, side, status, decision,
                      drafted_quantity, risk_amount, entry_price, stop_price, target_price,
                      expires_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                           CASE WHEN %s THEN now() + make_interval(secs => %s) END)
                   RETURNING """ + TICKET_COLUMNS,
                (
                    user["id"], profile_row["id"], settings["operating_mode"], input.pair, input.side,
                    "drafted" if decision["qualified"] else "rejected", Jsonb(decision),
                    draft["quantity"] if draft else None, draft["riskAmount"] if draft else None,
                    input.entry_price, input.stop_price, input.target_price,
                    decision["qualified"], TICKET_TTL_SECONDS,
                ),
            ).fetchone()
            audit(connection, user["id"], "ticket_drafted" if decision["qualified"] else "ticket_rejected", row["id"], {
                "pair": input.pair, "side": input.side, "reason": decision["reason"],
            })
        return {"ticket": public_ticket(row)}

    @app.post("/api/trading/tickets/{ticket_id}/authorize", dependencies=[Depends(rate_limit)])
    def authorize_trading_ticket(ticket_id: UUID, input: AuthorizeInput, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        from psycopg.types.json import Jsonb

        with database.connection() as connection:
            preview = load_ticket(connection, ticket_id, user["id"])
        quote = live_quote(preview["pair"])  # Fresh price for the final check, fetched outside the lock.

        with database.connection() as connection:
            lock_user(connection, user["id"])
            ticket = load_ticket(connection, ticket_id, user["id"])
            if str(ticket["idempotency_key"]) != str(input.idempotency_key):
                raise api_error(409, "ticket_version_mismatch", "This screen is out of date. Refresh to see the current ticket.")
            if ticket["status"] in ("open", "accepted_manual", "submitting"):
                # Repeated tap or second device: already authorized once, never twice.
                return {"ticket": public_ticket(ticket), "alreadyAuthorized": True}
            if ticket["status"] != "drafted":
                raise api_error(409, "ticket_not_drafted", "This ticket is {} and cannot be authorized.".format(ticket["status"]))
            if ticket["expires_at"] <= datetime.now(timezone.utc):
                connection.execute("UPDATE trading_tickets SET status = 'expired', updated_at = now() WHERE id = %s", (ticket_id,))
                audit(connection, user["id"], "ticket_expired", ticket_id)
                raise api_error(409, "ticket_expired", "This draft expired. Draft a fresh ticket with current prices.")
            if input.quantity > int(ticket["drafted_quantity"]) or input.quantity % LOT_STEP_UNITS:
                raise api_error(400, "quantity_not_allowed",
                                "Quantity must be in steps of 1,000 and no more than the drafted {:,} units.".format(ticket["drafted_quantity"]))

            # Final revalidation against the current profile, account state and live price.
            profile_row = effective_profile(connection, user["id"])
            if not profile_row or str(profile_row["id"]) != str(ticket["profile_id"]):
                connection.execute("UPDATE trading_tickets SET status = 'expired', updated_at = now() WHERE id = %s", (ticket_id,))
                audit(connection, user["id"], "ticket_expired", ticket_id, {"reason": "profile_changed"})
                raise api_error(409, "profile_changed", "Your risk profile changed. Draft a fresh ticket.")
            mode = ticket["operating_mode"]
            if mode == "deriv_demo" and not deriv_ready(user):
                raise api_error(409, "deriv_not_available", "Deriv is not configured on the server.")
            decision = ticket["decision"]
            account = account_state(connection, user["id"], profile_row)
            recheck = evaluate_ticket(profile_row["settings"], account, dict(
                decision["inputs"], live_quote=quote, require_live_quote=mode == "deriv_demo",
            ))
            if not recheck["qualified"] or input.quantity > recheck["draft"]["quantity"]:
                connection.execute("UPDATE trading_tickets SET status = 'expired', updated_at = now() WHERE id = %s", (ticket_id,))
                audit(connection, user["id"], "revalidation_failed", ticket_id, {"reason": recheck["reason"]})
                raise api_error(409, "revalidation_failed",
                                "Final check failed: {}. Draft a fresh ticket.".format(recheck["reason"] or "account limits changed"))

            risk_amount = risk_for_quantity(decision, input.quantity)
            decision["gates"] = [
                dict(gate, status="pass", detail="Authorized by you at {}.".format(datetime.now(timezone.utc).strftime("%H:%M:%S UTC")))
                if gate["id"] == "G8" else gate
                for gate in decision["gates"]
            ]
            decision["liveQuoteAtAuthorization"] = quote
            new_status = {"paper": "open", "external_manual": "accepted_manual", "deriv_demo": "submitting"}[mode]
            source = {"paper": "PAPER_SIMULATED", "external_manual": "USER_REPORTED", "deriv_demo": "DERIV_DEMO"}[mode]
            row = connection.execute(
                """UPDATE trading_tickets
                   SET status = %s, authorized_quantity = %s, risk_amount = %s,
                       fill_price = CASE WHEN %s THEN entry_price END,
                       execution_source = %s, decision = %s,
                       authorized_at = now(), updated_at = now()
                   WHERE id = %s AND status = 'drafted' AND idempotency_key = %s
                   RETURNING """ + TICKET_COLUMNS,
                (
                    new_status, input.quantity, risk_amount,
                    mode == "paper", source, Jsonb(decision),
                    ticket_id, input.idempotency_key,
                ),
            ).fetchone()
            audit(connection, user["id"], "ticket_authorized", ticket_id, {
                "quantity": input.quantity, "draftedQuantity": ticket["drafted_quantity"], "riskAmount": risk_amount,
                "mode": mode,
            })
        if mode != "deriv_demo":
            return {"ticket": public_ticket(row), "alreadyAuthorized": False}
        # The 'submitting' state is committed before Deriv is contacted, so a retry
        # or crash can never send this ticket twice.
        return submit_to_deriv(user, row, input.quantity)

    def submit_to_deriv(user: Dict[str, Any], ticket: Dict[str, Any], quantity: int) -> Dict[str, Any]:
        from psycopg.types.json import Jsonb

        pair = ticket["pair"]
        entry = float(ticket["entry_price"])
        stop = float(ticket["stop_price"])
        target = float(ticket["target_price"])
        currency = ticket["decision"]["accountCurrency"]
        result = None
        broker: Dict[str, Any] = {}
        failure = None
        outcome_unknown = False
        notional = usd_notional(pair, quantity, market.quotes() if market is not None else {})
        if notional is None:
            failure = "Could not value the position in USD (no live reference price)."
        else:
            candidates = plan_multiplier_order(notional, entry, stop, target)
            if not candidates:
                failure = "The position is too small or too large for Deriv Multipliers."
            for candidate in candidates:
                try:
                    proposal = deriv.quote_multiplier(DERIV_SYMBOLS[pair], ticket["side"], candidate["stake"],
                                                      candidate["multiplier"], candidate["stop_loss"],
                                                      candidate["take_profit"], currency)
                except DerivError as error:
                    # Only a price quote failed, nothing was bought: try the next multiplier.
                    failure = error.message
                    if error.code in ("deriv_auth_failed", "deriv_real_refused", "deriv_account_missing"):
                        break
                    continue
                commission = float(proposal.get("commission") or 0)
                # Deriv charges commission at the start, so move both limits by it to keep
                # them at the ticket's stop and target prices.
                stop_loss = round(candidate["stop_loss"] + commission, 2)
                take_profit = round(candidate["take_profit"] - commission, 2)
                net_ratio = take_profit / stop_loss if stop_loss > 0 else 0
                if net_ratio + 1e-9 < MIN_NET_REWARD_TO_RISK:
                    failure = "Deriv commission of {:.2f} {} lowers reward-to-risk to {:.2f}:1, below 2.00.".format(commission, currency, net_ratio)
                    break
                if stop_loss >= candidate["stake"] * 0.9:
                    failure = "Stop-loss is too close to the stake at multiplier x{}.".format(candidate["multiplier"])
                    continue
                # A buy is attempted at most once. A failed buy is never retried, because
                # the order might have gone through even if the reply was lost.
                try:
                    result = deriv.buy_multiplier(DERIV_SYMBOLS[pair], ticket["side"], candidate["stake"],
                                                  candidate["multiplier"], stop_loss, take_profit, currency)
                except DerivError as error:
                    if error.code in ("deriv_timeout",):
                        outcome_unknown = True
                    failure = error.message
                    break
                except Exception as error:
                    outcome_unknown = True
                    failure = "Connection to Deriv failed during the buy ({}).".format(type(error).__name__)
                    break
                limits = (result["proposal"].get("limit_order") or {})
                broker = {
                    "contractId": int(result["receipt"]["contract_id"]),
                    "transactionId": result["receipt"].get("transaction_id"),
                    "buyPrice": result["receipt"].get("buy_price"),
                    "stake": candidate["stake"],
                    "multiplier": candidate["multiplier"],
                    "stopLoss": stop_loss,
                    "takeProfit": take_profit,
                    "commission": float(result["commission"]),
                    "stopLevel": (limits.get("stop_loss") or {}).get("value"),
                    "takeProfitLevel": (limits.get("take_profit") or {}).get("value"),
                    "stopOutLevel": (limits.get("stop_out") or {}).get("value"),
                    "notionalUsd": round(notional, 2),
                    "longcode": result["receipt"].get("longcode"),
                }
                break
        with database.connection() as connection:
            if result:
                row = connection.execute(
                    """UPDATE trading_tickets SET status = 'open', fill_price = %s, risk_amount = %s,
                         broker = %s, updated_at = now()
                       WHERE id = %s AND status = 'submitting'
                       RETURNING """ + TICKET_COLUMNS,
                    (entry, broker["stopLoss"], Jsonb(broker), ticket["id"]),
                ).fetchone()
                audit(connection, user["id"], "deriv_bought", ticket["id"], {
                    "contractId": broker["contractId"], "stake": broker["stake"], "multiplier": broker["multiplier"],
                    "stopLoss": broker["stopLoss"], "takeProfit": broker["takeProfit"],
                })
                balance_cache["at"] = None
                return {"ticket": public_ticket(row), "alreadyAuthorized": False}
            if outcome_unknown:
                # Keep it 'submitting' (risk stays reserved) until the trader checks Deriv.
                connection.execute(
                    "UPDATE trading_tickets SET broker = %s, updated_at = now() WHERE id = %s AND status = 'submitting'",
                    (Jsonb({"error": failure, "outcomeUnknown": True}), ticket["id"]),
                )
                audit(connection, user["id"], "deriv_outcome_unknown", ticket["id"], {"error": failure})
        if outcome_unknown:
            raise api_error(502, "broker_outcome_unknown",
                            "The connection to Deriv dropped during the buy, so it may or may not have opened. "
                            "Check your Deriv demo account, then resolve the ticket in Positions. It will not be sent again.")
        with database.connection() as connection:
            connection.execute(
                """UPDATE trading_tickets SET status = 'broker_rejected', broker = %s,
                     closed_at = now(), updated_at = now()
                   WHERE id = %s AND status = 'submitting'""",
                (Jsonb({"error": failure}), ticket["id"]),
            )
            audit(connection, user["id"], "deriv_rejected", ticket["id"], {"error": failure})
        raise api_error(502, "broker_rejected", "Deriv did not open the trade: {}".format(failure or "unknown error"))

    @app.post("/api/trading/tickets/{ticket_id}/resolve")
    def resolve_submitting_ticket(ticket_id: UUID, input: ResolveInput, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        """Settle a Deriv ticket whose buy outcome was unknown, after the trader checked Deriv."""
        from psycopg.types.json import Jsonb

        with database.connection() as connection:
            ticket = load_ticket(connection, ticket_id, user["id"])
        if ticket["operating_mode"] != "deriv_demo" or ticket["status"] != "submitting":
            raise api_error(409, "not_submitting", "Only a Deriv ticket stuck in 'submitting' can be resolved.")
        broker = dict(ticket.get("broker") or {})
        if input.opened:
            if not input.contract_id:
                raise api_error(400, "contract_id_required", "Enter the contract ID shown in your Deriv demo account.")
            if not deriv_ready(user):
                raise api_error(409, "deriv_not_available", "Deriv is not configured on the server.")
            contract = deriv.open_contracts([input.contract_id]).get(input.contract_id)
            if not contract:
                raise api_error(404, "contract_not_found", "Deriv has no contract {} on your demo account.".format(input.contract_id))
            broker.update(contractId=input.contract_id, buyPrice=contract.get("buy_price"),
                          resolvedBy="trader", outcomeUnknown=False)
            with database.connection() as connection:
                lock_user(connection, user["id"])
                row = connection.execute(
                    """UPDATE trading_tickets SET status = 'open', fill_price = COALESCE(%s, entry_price),
                         broker = %s, updated_at = now()
                       WHERE id = %s AND status = 'submitting' RETURNING """ + TICKET_COLUMNS,
                    (_float(contract.get("entry_spot")), Jsonb(broker), ticket_id),
                ).fetchone()
                audit(connection, user["id"], "deriv_resolved_opened", ticket_id, {"contractId": input.contract_id})
        else:
            broker.update(resolvedBy="trader", outcomeUnknown=False)
            with database.connection() as connection:
                row = connection.execute(
                    """UPDATE trading_tickets SET status = 'broker_rejected', broker = %s,
                         closed_at = now(), updated_at = now()
                       WHERE id = %s AND status = 'submitting' RETURNING """ + TICKET_COLUMNS,
                    (Jsonb(broker), ticket_id),
                ).fetchone()
                audit(connection, user["id"], "deriv_resolved_not_opened", ticket_id)
        if not row:
            raise api_error(409, "not_submitting", "This ticket changed. Refresh and try again.")
        return {"ticket": public_ticket(row)}

    @app.post("/api/trading/tickets/{ticket_id}/decline")
    def decline_trading_ticket(ticket_id: UUID, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            row = connection.execute(
                """UPDATE trading_tickets SET status = 'declined', updated_at = now()
                   WHERE id = %s AND user_id = %s AND status = 'drafted'
                   RETURNING """ + TICKET_COLUMNS,
                (ticket_id, user["id"]),
            ).fetchone()
            if not row:
                load_ticket(connection, ticket_id, user["id"])
                raise api_error(409, "ticket_not_drafted", "Only a drafted ticket can be declined.")
            audit(connection, user["id"], "ticket_declined", ticket_id)
        return {"ticket": public_ticket(row)}

    @app.post("/api/trading/tickets/{ticket_id}/report")
    def report_external_ticket(ticket_id: UUID, input: ReportInput, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            ticket = load_ticket(connection, ticket_id, user["id"])
            if ticket["operating_mode"] != "external_manual" or ticket["status"] != "accepted_manual" or ticket["fill_price"] is not None:
                raise api_error(409, "report_not_allowed", "Only an accepted external draft awaiting a fill can be reported.")
            if input.result == "filled":
                if input.fill_price is None:
                    raise api_error(400, "fill_price_required", "Enter the price your broker filled the order at.")
                quantity = input.quantity or int(ticket["authorized_quantity"])
                if quantity > int(ticket["authorized_quantity"]):
                    raise api_error(400, "quantity_above_authorized",
                                    "The reported quantity is above the {:,} units you accepted.".format(ticket["authorized_quantity"]))
                row = connection.execute(
                    """UPDATE trading_tickets SET fill_price = %s, authorized_quantity = %s,
                         risk_amount = %s, updated_at = now()
                       WHERE id = %s RETURNING """ + TICKET_COLUMNS,
                    (input.fill_price, quantity, risk_for_quantity(ticket["decision"], quantity), ticket_id),
                ).fetchone()
            else:
                row = connection.execute(
                    """UPDATE trading_tickets SET status = %s, closed_at = now(), updated_at = now()
                       WHERE id = %s RETURNING """ + TICKET_COLUMNS,
                    (input.result, ticket_id),
                ).fetchone()
            audit(connection, user["id"], "external_" + input.result, ticket_id, {
                "fillPrice": input.fill_price, "quantity": input.quantity, "source": "USER_REPORTED",
            })
        return {"ticket": public_ticket(row)}

    @app.post("/api/trading/tickets/{ticket_id}/close")
    def close_trading_ticket(ticket_id: UUID, input: CloseInput, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            ticket = load_ticket(connection, ticket_id, user["id"])
        if ticket["operating_mode"] == "deriv_demo":
            if ticket["status"] != "open" or not (ticket.get("broker") or {}).get("contractId"):
                raise api_error(409, "ticket_not_open", "Only an open Deriv position can be closed.")
            if not deriv_ready(user):
                raise api_error(409, "deriv_not_available", "Deriv is not configured on the server.")
            contract_id = int(ticket["broker"]["contractId"])
            try:
                sale = deriv.sell(contract_id)
                contract = dict(sale["contract"])
                if contract.get("sell_price") is None and sale["receipt"].get("sold_for") is not None:
                    contract["sell_price"] = sale["receipt"]["sold_for"]
            except DerivError as error:
                # Already closed by its stop-loss or take-profit: record what Deriv reports.
                contract = (deriv.open_contracts([contract_id]).get(contract_id) or {})
                if not contract.get("is_sold"):
                    raise api_error(502, "deriv_sell_failed", "Deriv could not close the trade: {}".format(error.message))
            balance_cache["at"] = None
            with database.connection() as connection:
                row = close_from_contract(connection, user["id"], ticket, contract, "manual_close")
                row = row or load_ticket(connection, ticket_id, user["id"])
            return {"ticket": public_ticket(row)}

        if input.exit_price is None:
            raise api_error(400, "exit_price_required", "Enter the exit price.")
        with database.connection() as connection:
            lock_user(connection, user["id"])
            ticket = load_ticket(connection, ticket_id, user["id"])
            if ticket["status"] not in OPEN_STATUSES or ticket["fill_price"] is None:
                raise api_error(409, "ticket_not_open", "Only a filled, open position can be closed.")
            decision = ticket["decision"]
            inputs = decision["inputs"]
            pnl = realized_pnl(
                ticket["pair"], ticket["side"], decision["accountCurrency"], float(ticket["fill_price"]),
                input.exit_price, int(ticket["authorized_quantity"]), inputs.get("quote_to_account_rate"),
                float(inputs.get("commission_per_100k") or 0),
            )
            row = connection.execute(
                """UPDATE trading_tickets SET status = 'closed', exit_price = %s, realized_pnl = %s,
                     closed_at = now(), updated_at = now()
                   WHERE id = %s AND status IN ('accepted_manual', 'open')
                   RETURNING """ + TICKET_COLUMNS,
                (input.exit_price, pnl, ticket_id),
            ).fetchone()
            audit(connection, user["id"], "position_closed", ticket_id, {
                "exitPrice": input.exit_price, "realizedPnl": pnl, "source": ticket["execution_source"],
            })
        return {"ticket": public_ticket(row)}
