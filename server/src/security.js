import { createHmac, randomInt, randomBytes, scrypt as callbackScrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(callbackScrypt)
const passwordKeyLength = 64
const passwordParameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, passwordKeyLength, passwordParameters)
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function verifyPassword(password, encodedHash) {
  const [algorithm, n, r, p, saltText, hashText] = encodedHash.split('$')
  if (algorithm !== 'scrypt' || n !== '32768' || r !== '8' || p !== '1' || !saltText || !hashText) return false

  const salt = Buffer.from(saltText, 'base64url')
  const expected = Buffer.from(hashText, 'base64url')
  if (salt.length !== 16 || expected.length !== passwordKeyLength) return false
  const actual = await scrypt(password, salt, expected.length, passwordParameters)
  return timingSafeEqual(actual, expected)
}

export function createEmailCode() {
  return randomInt(100000, 1000000).toString()
}

export function hashEmailCode(code, secret) {
  return createHmac('sha256', secret).update(code).digest('hex')
}

export function secureHashEquals(first, second) {
  const firstBuffer = Buffer.from(first, 'hex')
  const secondBuffer = Buffer.from(second, 'hex')
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer)
}
