"""iConnect Ads: members buy an ad package set by admins; paid ads are reviewed, then shown in the feed.

Payment reuses the billing pipeline (billing_transactions + Paystack/Stripe + the
generic confirm/webhook activation). Activation moves a campaign to 'in_review';
an admin approves it, and its run starts then.
"""

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .geo import SUPPORTED_CURRENCIES, normalize_country, plan_visible_in_country

CAMPAIGN_STATUSES = ("pending_payment", "in_review", "active", "rejected", "expired", "cancelled")


class AdModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AdPackageInput(AdModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=200)
    duration_days: int = Field(ge=1, le=365)
    currency: str = Field(min_length=3, max_length=3)
    amount_minor: int = Field(ge=100, le=100_000_000_000)
    country_codes: List[str] = Field(default_factory=list, max_length=250)
    active: bool = True

    @field_validator("name", "description")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("currency")
    @classmethod
    def supported_currency(cls, value: str) -> str:
        value = value.strip().upper()
        if value not in SUPPORTED_CURRENCIES:
            raise ValueError("Unsupported currency.")
        return value

    @field_validator("country_codes")
    @classmethod
    def clean_countries(cls, values: List[str]) -> List[str]:
        cleaned: List[str] = []
        for value in values:
            code = normalize_country(value)
            if not code:
                raise ValueError("Use two-letter country codes such as NG, US or GB.")
            if code not in cleaned:
                cleaned.append(code)
        return cleaned


class AdCampaignInput(AdModel):
    package_id: UUID
    title: str = Field(min_length=3, max_length=60)
    body: str = Field(min_length=10, max_length=220)
    image_url: Optional[str] = Field(default=None, max_length=2048)
    link_url: Optional[str] = Field(default=None, max_length=500)
    cta_label: str = Field(default="Learn more", min_length=2, max_length=24)

    @field_validator("title", "body", "cta_label")
    @classmethod
    def clean_text(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("This field is required.")
        return value

    @field_validator("link_url")
    @classmethod
    def valid_link(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = value.strip()
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.netloc or not re.fullmatch(r"[A-Za-z0-9.-]+(:\d+)?", parsed.netloc):
            raise ValueError("The ad link must be a full https:// address.")
        return value


class AdReviewInput(AdModel):
    decision: str = Field(pattern="^(approve|reject|stop)$")
    note: str = Field(default="", max_length=300)


def public_package(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "description": row["description"],
        "durationDays": int(row["duration_days"]),
        "currency": row["currency"],
        "amountMinor": int(row["amount_minor"]),
        "countryCodes": list(row.get("country_codes") or []),
        "active": bool(row["active"]),
    }


def public_campaign(row: Dict[str, Any], include_owner: bool = False) -> Dict[str, Any]:
    data = {
        "id": str(row["id"]),
        "packageName": row.get("package_name"),
        "durationDays": int(row["duration_days"]),
        "title": row["title"],
        "body": row["body"],
        "imageUrl": row["image_url"],
        "linkUrl": row["link_url"],
        "ctaLabel": row["cta_label"],
        "status": row["status"],
        "currency": row["currency"],
        "amountMinor": int(row["amount_minor"]),
        "reviewNote": row.get("review_note") or "",
        "impressions": int(row["impressions"]),
        "clicks": int(row["clicks"]),
        "startsAt": row["starts_at"].isoformat() if row.get("starts_at") else None,
        "endsAt": row["ends_at"].isoformat() if row.get("ends_at") else None,
        "createdAt": row["created_at"].isoformat() if row.get("created_at") else None,
    }
    if include_owner:
        data["advertiser"] = {"id": str(row["user_id"]), "name": row.get("owner_name"), "email": row.get("owner_email")}
    return data


CAMPAIGN_COLUMNS = """campaign.id, campaign.user_id, campaign.title, campaign.body, campaign.image_url,
                      campaign.link_url, campaign.cta_label, campaign.status, campaign.currency,
                      campaign.amount_minor, campaign.duration_days, campaign.review_note,
                      campaign.impressions, campaign.clicks, campaign.starts_at, campaign.ends_at,
                      campaign.created_at, package.name AS package_name"""


def register_ads_routes(
    app: FastAPI,
    database: Any,
    settings: Any,
    require_user: Callable[..., Dict[str, Any]],
    require_admin: Callable[..., Dict[str, Any]],
    require_super_admin: Callable[..., Dict[str, Any]],
    rate_limit: Callable[..., None],
    api_error: Callable[[int, str, str], Exception],
    billing_location: Callable[[Request], Any],
    provider_request: Callable[..., Dict[str, Any]],
    provider_error: Any,
    validate_image_reference: Callable[[str], str],
    logger: Any,
) -> None:
    def expire_campaigns(connection: Any) -> None:
        connection.execute(
            "UPDATE ad_campaigns SET status = 'expired', updated_at = now() WHERE status = 'active' AND ends_at <= now()"
        )

    def packages_for(connection: Any, country: Optional[str]) -> List[Dict[str, Any]]:
        rows = connection.execute(
            """SELECT id, name, description, duration_days, currency, amount_minor, country_codes, active
               FROM ad_packages WHERE active ORDER BY currency, amount_minor"""
        ).fetchall()
        has_country = bool(country) and any(country in (row["country_codes"] or []) for row in rows)
        return [row for row in rows if plan_visible_in_country(row["country_codes"], country, has_country)]

    @app.get("/api/ads/packages")
    def list_ad_packages(request: Request, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        country, source = billing_location(request)
        with database.connection() as connection:
            rows = packages_for(connection, country)
        return {"location": {"country": country, "source": source}, "packages": [public_package(row) for row in rows]}

    @app.get("/api/ads/mine")
    def list_my_ads(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            expire_campaigns(connection)
            rows = connection.execute(
                "SELECT " + CAMPAIGN_COLUMNS + """ FROM ad_campaigns campaign
                   LEFT JOIN ad_packages package ON package.id = campaign.package_id
                   WHERE campaign.user_id = %s ORDER BY campaign.created_at DESC LIMIT 50""",
                (user["id"],),
            ).fetchall()
        return {"campaigns": [public_campaign(row) for row in rows]}

    @app.post("/api/ads/campaigns", status_code=201, dependencies=[Depends(rate_limit)])
    def create_ad_campaign(input: AdCampaignInput, request: Request, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        image_url = None
        if input.image_url:
            try:
                image_url = validate_image_reference(input.image_url)
            except ValueError as error:
                raise api_error(400, "invalid_image", str(error))
        country, _source = billing_location(request)
        with database.connection() as connection:
            package = next((row for row in packages_for(connection, country) if str(row["id"]) == str(input.package_id)), None)
            if not package:
                raise api_error(404, "ad_package_not_available", "That ad package is not available in your country. Refresh to see your local prices.")
            provider = "paystack" if package["currency"] == "NGN" else "stripe"
            secret_key = settings.paystack_secret_key if provider == "paystack" else settings.stripe_secret_key
            if not secret_key:
                raise api_error(503, "payment_provider_not_configured",
                                "{} checkout is not configured on this server yet.".format("Paystack" if provider == "paystack" else "Stripe"))
            campaign = connection.execute(
                """INSERT INTO ad_campaigns
                     (user_id, package_id, title, body, image_url, link_url, cta_label,
                      currency, amount_minor, duration_days)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (user["id"], package["id"], input.title, input.body, image_url, input.link_url,
                 input.cta_label, package["currency"], package["amount_minor"], package["duration_days"]),
            ).fetchone()
            reference = "ic_" + uuid4().hex
            transaction = connection.execute(
                """INSERT INTO billing_transactions
                     (user_id, provider, provider_reference, transaction_type, currency,
                      amount_minor, ad_campaign_id)
                   VALUES (%s, %s, %s, 'ad_campaign', %s, %s, %s)
                   RETURNING id""",
                (user["id"], provider, reference, package["currency"], package["amount_minor"], campaign["id"]),
            ).fetchone()

        ads_url = settings.app_origin + "/app/ads"
        try:
            if provider == "paystack":
                result = provider_request(provider, secret_key, "/transaction/initialize", {
                    "email": user["email"],
                    "amount": int(package["amount_minor"]),
                    "currency": package["currency"],
                    "reference": reference,
                    "callback_url": ads_url + "?reference=" + reference,
                    "metadata": {"transaction_id": str(transaction["id"]), "ad_campaign_id": str(campaign["id"])},
                })
                data = result.get("data") or {}
                checkout_url = data.get("authorization_url") if isinstance(data, dict) else None
            else:
                result = provider_request(provider, secret_key, "/v1/checkout/sessions", {
                    "mode": "payment",
                    "success_url": ads_url + "?status=success&reference={CHECKOUT_SESSION_ID}",
                    "cancel_url": ads_url + "?status=cancelled",
                    "customer_email": user["email"],
                    "client_reference_id": reference,
                    "metadata[transaction_id]": str(transaction["id"]),
                    "payment_intent_data[metadata][transaction_id]": str(transaction["id"]),
                    "line_items[0][price_data][currency]": str(package["currency"]).lower(),
                    "line_items[0][price_data][unit_amount]": str(int(package["amount_minor"])),
                    "line_items[0][price_data][product_data][name]": "iConnect Ads · " + package["name"],
                    "line_items[0][quantity]": "1",
                })
                checkout_url = result.get("url")
                if result.get("id"):
                    reference = result["id"]
                    with database.connection() as connection:
                        connection.execute(
                            "UPDATE billing_transactions SET provider_reference = %s WHERE id = %s",
                            (reference, transaction["id"]),
                        )
        except provider_error as error:
            logger.warning("%s ad checkout failed (HTTP %s): %s", provider, error.status_code, getattr(error, "detail", None))
            with database.connection() as connection:
                connection.execute("UPDATE billing_transactions SET status = 'failed' WHERE id = %s", (transaction["id"],))
                connection.execute("UPDATE ad_campaigns SET status = 'cancelled', updated_at = now() WHERE id = %s", (campaign["id"],))
            raise api_error(502, "checkout_initialization_failed", "The payment provider could not start checkout. Please try again.")
        if not isinstance(checkout_url, str) or not checkout_url.startswith("https://"):
            raise api_error(502, "checkout_initialization_failed", "The payment provider returned an invalid checkout link.")
        return {"checkoutUrl": checkout_url, "reference": reference, "campaignId": str(campaign["id"])}

    @app.post("/api/ads/campaigns/{campaign_id}/cancel")
    def cancel_ad_campaign(campaign_id: UUID, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            row = connection.execute(
                """UPDATE ad_campaigns SET status = 'cancelled', updated_at = now()
                   WHERE id = %s AND user_id = %s AND status = 'pending_payment' RETURNING id""",
                (campaign_id, user["id"]),
            ).fetchone()
        if not row:
            raise api_error(409, "ad_not_cancellable", "Only an unpaid ad can be cancelled. Contact support about a paid ad.")
        return {"cancelled": True}

    @app.get("/api/ads/feed")
    def feed_ads(limit: int = Query(default=2, ge=1, le=5), user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            expire_campaigns(connection)
            rows = connection.execute(
                """SELECT campaign.id, campaign.title, campaign.body, campaign.image_url, campaign.link_url,
                          campaign.cta_label, owner.display_name AS advertiser
                   FROM ad_campaigns campaign JOIN users owner ON owner.id = campaign.user_id
                   WHERE campaign.status = 'active' AND campaign.starts_at <= now() AND campaign.ends_at > now()
                   ORDER BY random() LIMIT %s""",
                (limit,),
            ).fetchall()
            if rows:
                connection.execute(
                    "UPDATE ad_campaigns SET impressions = impressions + 1 WHERE id = ANY(%s)",
                    ([row["id"] for row in rows],),
                )
        return {"ads": [{
            "id": str(row["id"]),
            "title": row["title"],
            "body": row["body"],
            "imageUrl": row["image_url"],
            "linkUrl": row["link_url"],
            "ctaLabel": row["cta_label"],
            "advertiser": row["advertiser"],
        } for row in rows]}

    @app.post("/api/ads/{campaign_id}/click")
    def click_ad(campaign_id: UUID, user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            row = connection.execute(
                """UPDATE ad_campaigns SET clicks = clicks + 1
                   WHERE id = %s AND status = 'active' AND ends_at > now() RETURNING link_url""",
                (campaign_id,),
            ).fetchone()
        return {"linkUrl": row["link_url"] if row else None}

    # ---------------- Admin ----------------

    @app.get("/api/admin/ads")
    def admin_ads(admin: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
        with database.connection() as connection:
            expire_campaigns(connection)
            packages = connection.execute(
                """SELECT id, name, description, duration_days, currency, amount_minor, country_codes, active
                   FROM ad_packages ORDER BY currency, amount_minor"""
            ).fetchall()
            campaigns = connection.execute(
                "SELECT " + CAMPAIGN_COLUMNS + """, owner.display_name AS owner_name, owner.email AS owner_email
                   FROM ad_campaigns campaign
                   LEFT JOIN ad_packages package ON package.id = campaign.package_id
                   JOIN users owner ON owner.id = campaign.user_id
                   WHERE campaign.status <> 'pending_payment' OR campaign.created_at > now() - interval '2 days'
                   ORDER BY (campaign.status = 'in_review') DESC, campaign.created_at DESC LIMIT 200"""
            ).fetchall()
            revenue = connection.execute(
                """SELECT currency, COALESCE(sum(amount_minor), 0) AS total, count(*) AS paid
                   FROM billing_transactions
                   WHERE transaction_type = 'ad_campaign' AND status = 'paid'
                   GROUP BY currency ORDER BY currency"""
            ).fetchall()
        return {
            "canManagePackages": admin.get("role") == "super_admin",
            "packages": [public_package(row) for row in packages],
            "campaigns": [public_campaign(row, include_owner=True) for row in campaigns],
            "revenue": {row["currency"]: {"totalMinor": int(row["total"]), "paidCampaigns": int(row["paid"])} for row in revenue},
        }

    def save_package(connection: Any, admin: Dict[str, Any], input: AdPackageInput, package_id: Optional[UUID]) -> Dict[str, Any]:
        values = (input.name, input.description, input.duration_days, input.currency, input.amount_minor,
                  input.country_codes, input.active)
        if package_id:
            row = connection.execute(
                """UPDATE ad_packages SET name = %s, description = %s, duration_days = %s, currency = %s,
                     amount_minor = %s, country_codes = %s, active = %s, updated_at = now()
                   WHERE id = %s
                   RETURNING id, name, description, duration_days, currency, amount_minor, country_codes, active""",
                values + (package_id,),
            ).fetchone()
            if not row:
                raise api_error(404, "ad_package_not_found", "That ad package could not be found.")
        else:
            row = connection.execute(
                """INSERT INTO ad_packages (name, description, duration_days, currency, amount_minor, country_codes, active, created_by)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id, name, description, duration_days, currency, amount_minor, country_codes, active""",
                values + (admin["id"],),
            ).fetchone()
        connection.execute(
            """INSERT INTO admin_audit_log (admin_user_id, action, details)
               VALUES (%s, 'update_monetization', %s::jsonb)""",
            (admin["id"], json.dumps({"action": "save_ad_package", "package_id": str(row["id"])})),
        )
        return row

    @app.post("/api/admin/ads/packages", status_code=201)
    def create_ad_package(input: AdPackageInput, admin: Dict[str, Any] = Depends(require_super_admin)) -> Dict[str, Any]:
        with database.connection() as connection:
            return {"package": public_package(save_package(connection, admin, input, None))}

    @app.put("/api/admin/ads/packages/{package_id}")
    def update_ad_package(package_id: UUID, input: AdPackageInput, admin: Dict[str, Any] = Depends(require_super_admin)) -> Dict[str, Any]:
        with database.connection() as connection:
            return {"package": public_package(save_package(connection, admin, input, package_id))}

    @app.post("/api/admin/ads/campaigns/{campaign_id}/review")
    def review_ad_campaign(campaign_id: UUID, input: AdReviewInput, admin: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
        with database.connection() as connection:
            if input.decision == "approve":
                # The paid run starts when the ad goes live, not when it was bought.
                row = connection.execute(
                    """UPDATE ad_campaigns SET status = 'active', starts_at = now(),
                         ends_at = now() + make_interval(days => duration_days),
                         review_note = %s, reviewed_by = %s, updated_at = now()
                       WHERE id = %s AND status = 'in_review' RETURNING id""",
                    (input.note, admin["id"], campaign_id),
                ).fetchone()
            elif input.decision == "reject":
                if not input.note.strip():
                    raise api_error(400, "note_required", "Give the advertiser a reason for the rejection.")
                row = connection.execute(
                    """UPDATE ad_campaigns SET status = 'rejected', review_note = %s, reviewed_by = %s, updated_at = now()
                       WHERE id = %s AND status = 'in_review' RETURNING id""",
                    (input.note, admin["id"], campaign_id),
                ).fetchone()
            else:
                row = connection.execute(
                    """UPDATE ad_campaigns SET status = 'cancelled', review_note = %s, reviewed_by = %s,
                         ends_at = LEAST(ends_at, now()), updated_at = now()
                       WHERE id = %s AND status = 'active' RETURNING id""",
                    (input.note or "Stopped by an administrator.", admin["id"], campaign_id),
                ).fetchone()
            if not row:
                raise api_error(409, "ad_not_reviewable", "This ad changed. Refresh and try again.")
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, action, details)
                   VALUES (%s, 'update_monetization', %s::jsonb)""",
                (admin["id"], json.dumps({"action": "review_ad", "campaign_id": str(campaign_id), "decision": input.decision})),
            )
        return {"status": {"approve": "active", "reject": "rejected", "stop": "cancelled"}[input.decision]}
