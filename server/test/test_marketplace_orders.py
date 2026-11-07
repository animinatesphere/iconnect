import os
import re
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgresql://localhost/test")
os.environ.setdefault("OTP_HASH_SECRET", "test-otp-secret-that-is-long-enough")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-that-is-long-enough")

from server.app.billing import BillingProviderError
from server.app.main import Settings, create_app
from server.app.security import hash_session_token


class FakeResult:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row if self.row is not None else (self.rows[0] if self.rows else None)

    def fetchall(self):
        return self.rows


class FakeMarketplaceConnection:
    def __init__(self, state):
        self.state = state

    def execute(self, query, parameters=()):
        sql = re.sub(r"\s+", " ", query).strip().lower()
        if sql.startswith("select u.id") and "from auth_sessions" in sql:
            session = self.state["sessions"].get(parameters[0])
            return FakeResult(self.state["users"][session["user_id"]].copy() if session else None)
        if sql.startswith("with expired as"):
            return FakeResult()
        if sql.startswith("select product.id, product.name"):
            product = self.state["products"].get(str(parameters[0]))
            return FakeResult(product.copy() if product else None)
        if sql.startswith("select marketplace_commission_bps"):
            return FakeResult({"marketplace_commission_bps": self.state["commission_bps"]})
        if sql.startswith("update marketplace_products set stock = stock -"):
            quantity, product_id, minimum = parameters
            product = self.state["products"].get(str(product_id))
            if not product or product["stock"] < minimum:
                return FakeResult()
            product["stock"] -= quantity
            return FakeResult({"stock": product["stock"]})
        if sql.startswith("insert into marketplace_orders"):
            buyer_id, seller_id, product_id, name, quantity, unit_price, amount, commission, seller_amount = parameters
            order_id = str(uuid4())
            self.state["orders"][order_id] = {
                "id": order_id,
                "buyer_id": str(buyer_id),
                "seller_id": str(seller_id),
                "product_id": str(product_id),
                "product_name": name,
                "quantity": quantity,
                "unit_price_minor": unit_price,
                "amount_minor": amount,
                "marketplace_commission_minor": commission,
                "seller_amount_minor": seller_amount,
                "currency": "NGN",
                "status": "pending",
                "created_at": datetime.now(timezone.utc),
                "paid_at": None,
                "fulfilled_at": None,
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=30),
            }
            return FakeResult({"id": order_id})
        if sql.startswith("insert into billing_transactions"):
            user_id, order_id, reference, amount = parameters
            transaction_id = str(uuid4())
            self.state["transactions"][reference] = {
                "id": transaction_id,
                "user_id": str(user_id),
                "order_id": str(order_id),
                "provider": "paystack",
                "provider_reference": reference,
                "transaction_type": "marketplace_order",
                "currency": "NGN",
                "amount_minor": amount,
                "status": "pending",
            }
            return FakeResult({"id": transaction_id})
        if sql.startswith("update billing_transactions set status = 'failed'"):
            transaction_id = str(parameters[0])
            transaction = next((item for item in self.state["transactions"].values() if item["id"] == transaction_id), None)
            if not transaction or transaction["status"] != "pending":
                return FakeResult()
            transaction["status"] = "failed"
            return FakeResult({"order_id": transaction["order_id"]})
        if sql.startswith("update marketplace_orders set status = %s"):
            status, order_id = parameters
            order = self.state["orders"].get(str(order_id))
            if not order or order["status"] != "pending":
                return FakeResult()
            order["status"] = status
            return FakeResult({"product_id": order["product_id"], "quantity": order["quantity"]})
        if sql.startswith("update marketplace_products set stock = stock +"):
            quantity, product_id = parameters
            self.state["products"][str(product_id)]["stock"] += quantity
            return FakeResult()
        if sql.startswith("select id, user_id, subscription_id, dating_product_id") and "provider_reference = %s" in sql:
            user_id, reference = parameters
            transaction = self.state["transactions"].get(str(reference))
            return FakeResult(transaction.copy() if transaction and transaction["user_id"] == str(user_id) else None)
        if sql.startswith("update billing_transactions set status = 'paid'"):
            transaction_id = str(parameters[0])
            transaction = next((item for item in self.state["transactions"].values() if item["id"] == transaction_id), None)
            if not transaction or transaction["status"] == "paid":
                return FakeResult()
            transaction["status"] = "paid"
            return FakeResult({
                "id": transaction["id"],
                "user_id": transaction["user_id"],
                "subscription_id": None,
                "dating_product_id": None,
                "order_id": transaction["order_id"],
                "transaction_type": transaction["transaction_type"],
            })
        if sql.startswith("update marketplace_orders set status = 'paid'") and "status = 'pending'" in sql:
            order = self.state["orders"].get(str(parameters[0]))
            if not order or order["status"] != "pending":
                return FakeResult()
            order["status"] = "paid"
            order["paid_at"] = datetime.now(timezone.utc)
            return FakeResult({"id": order["id"]})
        if sql.startswith("update marketplace_products product set stock = product.stock - order_row.quantity"):
            order = self.state["orders"].get(str(parameters[0]))
            if (
                not order
                or order["status"] not in {"expired", "payment_failed"}
                or self.state["products"][order["product_id"]]["stock"] < order["quantity"]
            ):
                return FakeResult()
            self.state["products"][order["product_id"]]["stock"] -= order["quantity"]
            return FakeResult({"id": order["id"]})
        if sql.startswith("update marketplace_orders set status = 'paid'") and "in ('expired', 'payment_failed')" in sql:
            order = self.state["orders"].get(str(parameters[0]))
            if not order or order["status"] not in {"expired", "payment_failed"}:
                return FakeResult()
            order["status"] = "paid"
            order["paid_at"] = datetime.now(timezone.utc)
            return FakeResult({"id": order["id"]})
        if sql.startswith("update marketplace_orders set status = 'refund_required'"):
            order = self.state["orders"].get(str(parameters[0]))
            if not order or order["status"] not in {"expired", "payment_failed"}:
                return FakeResult()
            order["status"] = "refund_required"
            return FakeResult({"id": order["id"]})
        if sql.startswith("select order_row.id"):
            user_id, _same_user = map(str, parameters)
            rows = []
            for order in self.state["orders"].values():
                if user_id not in {order["buyer_id"], order["seller_id"]}:
                    continue
                buyer = self.state["users"][order["buyer_id"]]
                seller = self.state["users"][order["seller_id"]]
                rows.append({
                    **order,
                    "buyer_name": buyer["display_name"],
                    "buyer_username": buyer["username"],
                    "seller_name": seller["display_name"],
                    "seller_username": seller["username"],
                })
            return FakeResult(rows=rows)
        if sql.startswith("update marketplace_orders set status = 'fulfilled'"):
            order_id, seller_id = map(str, parameters)
            order = self.state["orders"].get(order_id)
            if not order or order["seller_id"] != seller_id or order["status"] != "paid":
                return FakeResult()
            order["status"] = "fulfilled"
            order["fulfilled_at"] = datetime.now(timezone.utc)
            return FakeResult({"id": order_id})
        if sql.startswith("select status from marketplace_orders"):
            order_id, seller_id = map(str, parameters)
            order = self.state["orders"].get(order_id)
            return FakeResult({"status": order["status"]} if order and order["seller_id"] == seller_id else None)
        raise AssertionError("Unexpected marketplace query: {}".format(query))


class FakeMarketplacePool:
    def __init__(self, buyer_id, seller_id, product_id):
        self.state = {
            "users": {
                buyer_id: {"id": buyer_id, "email": "buyer@example.com", "display_name": "Buyer", "username": "buyer"},
                seller_id: {"id": seller_id, "email": "seller@example.com", "display_name": "Seller", "username": "seller"},
            },
            "sessions": {},
            "products": {
                product_id: {
                    "id": product_id,
                    "name": "Camera",
                    "price": 25000,
                    "stock": 5,
                    "published": True,
                    "seller_id": seller_id,
                    "seller_name": "Seller",
                },
            },
            "orders": {},
            "transactions": {},
            "commission_bps": 500,
        }

    @contextmanager
    def connection(self):
        yield FakeMarketplaceConnection(self.state)


class MarketplaceOrderTests(unittest.TestCase):
    def setUp(self):
        self.buyer_id = str(uuid4())
        self.seller_id = str(uuid4())
        self.product_id = str(uuid4())
        self.pool = FakeMarketplacePool(self.buyer_id, self.seller_id, self.product_id)
        self.settings = Settings(
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
            paystack_secret_key="paystack-test-secret",
        )
        self.client = TestClient(create_app(settings=self.settings, pool=self.pool))
        self.seller_client = TestClient(self.client.app)
        for user_id, client, token in (
            (self.buyer_id, self.client, "buyer-session"),
            (self.seller_id, self.seller_client, "seller-session"),
        ):
            self.pool.state["sessions"][hash_session_token(token, self.settings.session_secret)] = {
                "user_id": user_id,
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            }
            client.cookies.set("iconnect.sid", token)

    def test_paid_order_reserves_stock_and_seller_can_fulfill(self):
        def fake_provider_request(_provider, _secret, path, _payload=None, **_kwargs):
            if path == "/transaction/initialize":
                return {"data": {"authorization_url": "https://checkout.paystack.com/test"}}
            return {"status": True, "data": {"status": "success", "amount": 5000000, "currency": "NGN"}}

        with patch("server.app.main.provider_request", side_effect=fake_provider_request):
            checkout = self.client.post("/api/marketplace/orders/checkout", json={
                "product_id": self.product_id,
                "quantity": 2,
            })
        self.assertEqual(checkout.status_code, 201, checkout.text)
        self.assertEqual(self.pool.state["products"][self.product_id]["stock"], 3)
        self.assertTrue(checkout.json()["checkoutUrl"].startswith("https://"))
        reference = checkout.json()["reference"]

        with patch("server.app.main.provider_request", side_effect=fake_provider_request):
            confirmed = self.client.post("/api/billing/confirm", json={"reference": reference})
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.assertEqual(self.pool.state["orders"][checkout.json()["orderId"]]["status"], "paid")

        orders = self.seller_client.get("/api/marketplace/orders")
        self.assertEqual(orders.status_code, 200, orders.text)
        sale = orders.json()["orders"][0]
        self.assertEqual(sale["role"], "seller")
        self.assertEqual(sale["marketplaceCommissionMinor"], 250000)
        self.assertEqual(sale["sellerAmountMinor"], 4750000)

        fulfilled = self.seller_client.post(
            "/api/marketplace/orders/{}/fulfill".format(sale["id"])
        )
        self.assertEqual(fulfilled.status_code, 200, fulfilled.text)
        self.assertEqual(self.pool.state["orders"][sale["id"]]["status"], "fulfilled")

    def test_buyer_cannot_purchase_own_product(self):
        self.pool.state["products"][self.product_id]["seller_id"] = self.buyer_id
        response = self.client.post("/api/marketplace/orders/checkout", json={
            "product_id": self.product_id,
            "quantity": 1,
        })
        self.assertEqual(response.status_code, 400, response.text)

    def test_failed_checkout_releases_reserved_stock(self):
        with patch("server.app.main.provider_request", side_effect=BillingProviderError(503)):
            response = self.client.post("/api/marketplace/orders/checkout", json={
                "product_id": self.product_id,
                "quantity": 2,
            })
        self.assertEqual(response.status_code, 502, response.text)
        self.assertEqual(self.pool.state["products"][self.product_id]["stock"], 5)
        self.assertEqual(next(iter(self.pool.state["orders"].values()))["status"], "payment_failed")

    def test_checkout_rejects_quantity_above_available_stock(self):
        response = self.client.post("/api/marketplace/orders/checkout", json={
            "product_id": self.product_id,
            "quantity": 6,
        })
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.pool.state["products"][self.product_id]["stock"], 5)
        self.assertFalse(self.pool.state["orders"])

    def test_late_payment_reserves_stock_again_when_available(self):
        order_id, reference = self._start_checkout(quantity=2)
        order = self.pool.state["orders"][order_id]
        order["status"] = "expired"
        self.pool.state["products"][self.product_id]["stock"] += 2
        self._confirm(reference)
        self.assertEqual(order["status"], "paid")
        self.assertEqual(self.pool.state["products"][self.product_id]["stock"], 3)

    def test_late_payment_without_stock_is_flagged_for_refund(self):
        order_id, reference = self._start_checkout(quantity=2)
        order = self.pool.state["orders"][order_id]
        order["status"] = "expired"
        self.pool.state["products"][self.product_id]["stock"] += 2
        self.pool.state["products"][self.product_id]["stock"] = 0
        self._confirm(reference)
        self.assertEqual(order["status"], "refund_required")
        self.assertEqual(self.pool.state["products"][self.product_id]["stock"], 0)

    def _start_checkout(self, quantity):
        def fake_provider_request(_provider, _secret, path, _payload=None, **_kwargs):
            return {"data": {"authorization_url": "https://checkout.paystack.com/test"}}

        with patch("server.app.main.provider_request", side_effect=fake_provider_request):
            response = self.client.post("/api/marketplace/orders/checkout", json={
                "product_id": self.product_id,
                "quantity": quantity,
            })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["orderId"], response.json()["reference"]

    def _confirm(self, reference):
        def fake_provider_request(_provider, _secret, _path, _payload=None, **_kwargs):
            return {"status": True, "data": {"status": "success", "amount": 5000000, "currency": "NGN"}}

        with patch("server.app.main.provider_request", side_effect=fake_provider_request):
            response = self.client.post("/api/billing/confirm", json={"reference": reference})
        self.assertEqual(response.status_code, 200, response.text)


if __name__ == "__main__":
    unittest.main()
