import hashlib
import hmac
import unittest

from server.app.billing import parse_provider_datetime, verify_paystack_signature, verify_stripe_signature


class BillingHelperTests(unittest.TestCase):
    def test_paystack_signature_requires_matching_raw_payload(self):
        payload = b'{"event":"charge.success","data":{"reference":"ic_test"}}'
        secret = "paystack-test-secret"
        signature = hmac.new(secret.encode(), payload, hashlib.sha512).hexdigest()

        self.assertTrue(verify_paystack_signature(payload, signature, secret))
        self.assertFalse(verify_paystack_signature(payload + b" ", signature, secret))
        self.assertFalse(verify_paystack_signature(payload, signature, "wrong-secret"))

    def test_stripe_signature_accepts_valid_recent_signature_only(self):
        timestamp = 1_700_000_000
        payload = b'{"id":"evt_test","type":"checkout.session.completed"}'
        secret = "whsec_test"
        signed = str(timestamp).encode() + b"." + payload
        signature = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
        header = "t={},v1={}".format(timestamp, signature)

        self.assertTrue(verify_stripe_signature(payload, header, secret, now=timestamp))
        self.assertFalse(verify_stripe_signature(payload, header, secret, now=timestamp + 301))
        self.assertFalse(verify_stripe_signature(payload + b" ", header, secret, now=timestamp))

    def test_provider_datetime_supports_epoch_and_iso_values(self):
        self.assertEqual(
            parse_provider_datetime(1_700_000_000).isoformat(),
            "2023-11-14T22:13:20+00:00",
        )
        self.assertEqual(
            parse_provider_datetime("2024-01-02T03:04:05Z").isoformat(),
            "2024-01-02T03:04:05+00:00",
        )
        self.assertIsNone(parse_provider_datetime("not a date"))


if __name__ == "__main__":
    unittest.main()
