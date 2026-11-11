"""iConnect Ajo: personal savings plans.

A member creates a plan (target, contribution amount, how often) and records each
contribution they make. iConnect does not hold the money: it stays in the
member's own bank until a licensed wallet partner is integrated.
"""

from datetime import date, timedelta
from typing import Any, Callable, Dict, List, Literal, Optional
from uuid import UUID

from fastapi import Depends, FastAPI
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .geo import SUPPORTED_CURRENCIES

FREQUENCY_DAYS = {"daily": 1, "weekly": 7, "monthly": 30}
MAX_ACTIVE_PLANS = 10


class AjoModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AjoPlanInput(AjoModel):
    name: str = Field(min_length=2, max_length=60)
    currency: str = Field(min_length=3, max_length=3)
    target_amount_minor: int = Field(ge=100, le=100_000_000_000)
    contribution_amount_minor: int = Field(ge=100, le=100_000_000_000)
    frequency: Literal["daily", "weekly", "monthly"]
    start_date: date
    target_date: Optional[date] = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Give the plan a name.")
        return value

    @field_validator("currency")
    @classmethod
    def supported_currency(cls, value: str) -> str:
        value = value.strip().upper()
        if value not in SUPPORTED_CURRENCIES:
            raise ValueError("Unsupported currency.")
        return value

    @model_validator(mode="after")
    def check_amounts(self) -> "AjoPlanInput":
        if self.contribution_amount_minor > self.target_amount_minor:
            raise ValueError("Each contribution cannot be more than the target.")
        if self.target_date and self.target_date <= self.start_date:
            raise ValueError("The target date must be after the start date.")
        if self.start_date < date.today() - timedelta(days=365):
            raise ValueError("The start date is too far in the past.")
        return self


class AjoStatusInput(AjoModel):
    status: Literal["active", "paused", "completed", "cancelled"]


class AjoContributionInput(AjoModel):
    amount_minor: int = Field(ge=1, le=100_000_000_000)
    contributed_on: date
    note: str = Field(default="", max_length=160)

    @model_validator(mode="after")
    def not_future(self) -> "AjoContributionInput":
        if self.contributed_on > date.today():
            raise ValueError("A contribution cannot be dated in the future.")
        return self


def plan_summary(plan: Dict[str, Any], contributions: List[Dict[str, Any]], today: Optional[date] = None) -> Dict[str, Any]:
    """Progress, schedule and streak for one plan (pure, so it can be tested)."""
    today = today or date.today()
    period = FREQUENCY_DAYS[plan["frequency"]]
    saved = sum(int(item["amount_minor"]) for item in contributions)
    target = int(plan["target_amount_minor"])
    start = plan["start_date"]
    # Contributions whose due date has already passed (one due today is not late yet).
    expected = 0 if today <= start else ((today - start).days - 1) // period + 1
    expected_amount = min(target, expected * int(plan["contribution_amount_minor"]))
    periods_paid = set()
    for item in contributions:
        if item["contributed_on"] >= start:
            periods_paid.add((item["contributed_on"] - start).days // period)
    next_index = 0
    while next_index in periods_paid:
        next_index += 1
    next_due = start + timedelta(days=next_index * period)
    # Streak: consecutive paid periods ending at the current (or most recent) period.
    current_index = max(0, (today - start).days // period) if today >= start else -1
    streak = 0
    index = current_index if current_index in periods_paid else current_index - 1
    while index >= 0 and index in periods_paid:
        streak += 1
        index -= 1
    remaining = max(0, target - saved)
    contributions_left = -(-remaining // int(plan["contribution_amount_minor"])) if remaining else 0
    # If every remaining contribution is made on schedule from the next due date.
    projected_finish = (max(next_due, today) + timedelta(days=period * (contributions_left - 1))) if remaining else None
    status = plan["status"]
    return {
        "savedMinor": saved,
        "remainingMinor": remaining,
        "progressPct": round(min(100.0, saved * 100.0 / target), 1) if target else 0.0,
        "expectedByNowMinor": expected_amount,
        "behindByMinor": max(0, expected_amount - saved),
        "nextDueDate": next_due.isoformat() if remaining and status == "active" else None,
        "overdue": bool(remaining and status == "active" and next_due < today),
        "streak": streak,
        "contributionsLeft": contributions_left,
        "projectedFinish": projected_finish.isoformat() if projected_finish else None,
        "reachedTarget": saved >= target,
    }


def public_plan(plan: Dict[str, Any], contributions: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "id": str(plan["id"]),
        "name": plan["name"],
        "currency": plan["currency"],
        "targetAmountMinor": int(plan["target_amount_minor"]),
        "contributionAmountMinor": int(plan["contribution_amount_minor"]),
        "frequency": plan["frequency"],
        "startDate": plan["start_date"].isoformat(),
        "targetDate": plan["target_date"].isoformat() if plan.get("target_date") else None,
        "status": plan["status"],
        "createdAt": plan["created_at"].isoformat(),
        "summary": plan_summary(plan, contributions),
        "contributions": [
            {
                "id": str(item["id"]),
                "amountMinor": int(item["amount_minor"]),
                "contributedOn": item["contributed_on"].isoformat(),
                "note": item["note"],
                "createdAt": item["created_at"].isoformat(),
            }
            for item in sorted(contributions, key=lambda row: (row["contributed_on"], row["created_at"]), reverse=True)
        ],
    }


def register_ajo_routes(
    app: FastAPI,
    database: Any,
    require_user: Callable[..., Dict[str, Any]],
    rate_limit: Callable[..., None],
    api_error: Callable[[int, str, str], Exception],
) -> None:
    PLAN_COLUMNS = """id, user_id, name, currency, target_amount_minor, contribution_amount_minor,
                      frequency, start_date, target_date, status, created_at"""

    def load_plans(connection: Any, user_id: Any, plan_id: Optional[UUID] = None) -> List[Dict[str, Any]]:
        plans = connection.execute(
            "SELECT " + PLAN_COLUMNS + " FROM ajo_plans WHERE user_id = %s"
            + (" AND id = %s" if plan_id else " AND status <> 'cancelled'")
            + " ORDER BY created_at DESC",
            (user_id, plan_id) if plan_id else (user_id,),
        ).fetchall()
        if not plans:
            return []
        contributions = connection.execute(
            """SELECT id, plan_id, amount_minor, contributed_on, note, created_at
               FROM ajo_contributions WHERE plan_id = ANY(%s)""",
            ([plan["id"] for plan in plans],),
        ).fetchall()
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for item in contributions:
            grouped.setdefault(str(item["plan_id"]), []).append(item)
        return [public_plan(plan, grouped.get(str(plan["id"]), [])) for plan in plans]

    def one_plan(connection: Any, user_id: Any, plan_id: UUID) -> Dict[str, Any]:
        plans = load_plans(connection, user_id, plan_id)
        if not plans:
            raise api_error(404, "ajo_plan_not_found", "That savings plan could not be found.")
        return plans[0]

    @app.get("/api/ajo/plans")
    def list_ajo_plans(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            return {"plans": load_plans(connection, user["id"])}

    @app.post("/api/ajo/plans", status_code=201, dependencies=[Depends(rate_limit)])
    def create_ajo_plan(input: AjoPlanInput, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            count = connection.execute(
                "SELECT count(*) AS total FROM ajo_plans WHERE user_id = %s AND status IN ('active', 'paused')",
                (user["id"],),
            ).fetchone()["total"]
            if int(count) >= MAX_ACTIVE_PLANS:
                raise api_error(409, "too_many_plans", "You can have up to {} open savings plans.".format(MAX_ACTIVE_PLANS))
            row = connection.execute(
                """INSERT INTO ajo_plans (user_id, name, currency, target_amount_minor, contribution_amount_minor,
                                          frequency, start_date, target_date)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (user["id"], input.name, input.currency, input.target_amount_minor,
                 input.contribution_amount_minor, input.frequency, input.start_date, input.target_date),
            ).fetchone()
            return {"plan": one_plan(connection, user["id"], row["id"])}

    @app.post("/api/ajo/plans/{plan_id}/status")
    def update_ajo_status(plan_id: UUID, input: AjoStatusInput, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            row = connection.execute(
                """UPDATE ajo_plans SET status = %s, updated_at = now()
                   WHERE id = %s AND user_id = %s AND status <> 'cancelled' RETURNING id""",
                (input.status, plan_id, user["id"]),
            ).fetchone()
            if not row:
                raise api_error(404, "ajo_plan_not_found", "That savings plan could not be found.")
            return {"plan": one_plan(connection, user["id"], plan_id)}

    @app.post("/api/ajo/plans/{plan_id}/contributions", status_code=201, dependencies=[Depends(rate_limit)])
    def add_ajo_contribution(plan_id: UUID, input: AjoContributionInput, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            plan = connection.execute(
                "SELECT id, status, start_date FROM ajo_plans WHERE id = %s AND user_id = %s",
                (plan_id, user["id"]),
            ).fetchone()
            if not plan:
                raise api_error(404, "ajo_plan_not_found", "That savings plan could not be found.")
            if plan["status"] not in ("active", "paused"):
                raise api_error(409, "ajo_plan_closed", "This plan is closed. Reopen it to add contributions.")
            if input.contributed_on < plan["start_date"]:
                raise api_error(400, "before_start", "The contribution date is before the plan started.")
            connection.execute(
                """INSERT INTO ajo_contributions (plan_id, user_id, amount_minor, contributed_on, note)
                   VALUES (%s, %s, %s, %s, %s)""",
                (plan_id, user["id"], input.amount_minor, input.contributed_on, " ".join(input.note.split())),
            )
            return {"plan": one_plan(connection, user["id"], plan_id)}

    @app.delete("/api/ajo/plans/{plan_id}/contributions/{contribution_id}")
    def delete_ajo_contribution(plan_id: UUID, contribution_id: UUID, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            row = connection.execute(
                """DELETE FROM ajo_contributions
                   WHERE id = %s AND plan_id = %s AND user_id = %s RETURNING id""",
                (contribution_id, plan_id, user["id"]),
            ).fetchone()
            if not row:
                raise api_error(404, "contribution_not_found", "That contribution could not be found.")
            return {"plan": one_plan(connection, user["id"], plan_id)}
