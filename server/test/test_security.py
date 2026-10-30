import unittest

from server.app.security import (
    create_email_code,
    hash_email_code,
    hash_password,
    secure_hash_equals,
    verify_password,
)


class SecurityTests(unittest.TestCase):
    def test_password_hash_only_verifies_original_password(self):
        hashed = hash_password("a long test password")
        self.assertTrue(verify_password("a long test password", hashed))
        self.assertFalse(verify_password("a different password", hashed))
        self.assertRegex(hashed, r"^scrypt\$32768\$8\$1\$")

    def test_email_codes_are_six_digits_and_use_keyed_hashes(self):
        code = create_email_code()
        hashed = hash_email_code(code, "test-only-secret")
        self.assertRegex(code, r"^\d{6}$")
        self.assertTrue(secure_hash_equals(hashed, hash_email_code(code, "test-only-secret")))
        self.assertFalse(secure_hash_equals(hashed, hash_email_code("000000", "test-only-secret")))


if __name__ == "__main__":
    unittest.main()
