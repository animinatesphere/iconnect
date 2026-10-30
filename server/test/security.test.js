import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmailCode, hashEmailCode, hashPassword, secureHashEquals, verifyPassword } from '../src/security.js'

test('password hashes verify only the original password', async () => {
  const hash = await hashPassword('a long test password')
  assert.equal(await verifyPassword('a long test password', hash), true)
  assert.equal(await verifyPassword('a different password', hash), false)
  assert.match(hash, /^scrypt\$32768\$8\$1\$/)
})

test('email codes are six digits and are compared using their keyed hash', () => {
  const code = createEmailCode()
  const hash = hashEmailCode(code, 'test-only-secret')
  assert.match(code, /^\d{6}$/)
  assert.equal(secureHashEquals(hash, hashEmailCode(code, 'test-only-secret')), true)
  assert.equal(secureHashEquals(hash, hashEmailCode('000000', 'test-only-secret')), false)
})
