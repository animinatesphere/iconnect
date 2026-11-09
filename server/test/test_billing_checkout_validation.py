import os
import unittest
from uuid import uuid4

os.environ.setdefault("DATABASE_URL", "postgresql://localhost/test")
os.environ.setdefault("OTP_HASH_SECRET", "test-otp-secret-that-is-long-enough")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-that-is-long-enough")

from server.app.main import BillingCheckoutInput


class BillingCheckoutValidationTests(unittest.TestCase):
    def test_plan_checkout_accepts_json_uuid_string(self):
        plan_id = uuid4()
        checkout = BillingCheckoutInput.model_validate({"plan_id": str(plan_id)})
        self.assertEqual(checkout.plan_id, plan_id)
        self.assertIsNone(checkout.dating_product_id)

    def test_dating_addon_checkout_accepts_json_uuid_string(self):
        product_id = uuid4()
        checkout = BillingCheckoutInput.model_validate({"dating_product_id": str(product_id)})
        self.assertEqual(checkout.dating_product_id, product_id)
        self.assertIsNone(checkout.plan_id)


if __name__ == "__main__":
    unittest.main()
