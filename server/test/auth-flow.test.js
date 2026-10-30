import test from 'node:test'
import assert from 'node:assert/strict'
import session from 'express-session'
import { createApp } from '../src/app.js'
import { hashEmailCode } from '../src/security.js'

const sessionSecret = 'test-session-secret-that-is-long-enough'
const otpHashSecret = 'test-otp-secret-that-is-long-enough'

function createFakeDatabase() {
  const state = { user: null, verification: null }

  async function query(sql, values = []) {
    if (sql.includes('INSERT INTO users')) {
      state.user = {
        id: 'user-test-id',
        display_name: values[0],
        username: values[1],
        email: values[2],
        password_hash: values[3],
        bio: '',
        interests: [],
        email_verified_at: null,
      }
      return { rowCount: 1, rows: [{ id: state.user.id, display_name: state.user.display_name, email: state.user.email }] }
    }
    if (sql.includes('INSERT INTO email_verification_codes')) {
      state.verification = {
        user_id: values[0],
        code_hash: values[1],
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
        attempts: 0,
      }
      return { rowCount: 1, rows: [{ user_id: values[0] }] }
    }
    if (sql.includes('FROM users WHERE id = $1')) {
      return { rowCount: state.user?.id === values[0] ? 1 : 0, rows: state.user?.id === values[0] ? [state.user] : [] }
    }
    if (sql.includes('FROM users WHERE email = $1')) {
      return { rowCount: state.user?.email === values[0] ? 1 : 0, rows: state.user?.email === values[0] ? [state.user] : [] }
    }
    if (sql.includes('UPDATE users') && sql.includes('display_name = $2')) {
      Object.assign(state.user, {
        display_name: values[1],
        username: values[2],
        bio: values[3],
        interests: values[4],
      })
      return { rowCount: 1, rows: [state.user] }
    }
    throw new Error(`Unexpected fake database query: ${sql}`)
  }

  return {
    state,
    query,
    async connect() {
      return {
        async query(sql, values = []) {
          if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rowCount: 0, rows: [] }
          if (sql.includes('FROM users u') && sql.includes('email_verification_codes')) {
            if (!state.user || !state.verification || state.user.email !== values[0]) return { rowCount: 0, rows: [] }
            return { rowCount: 1, rows: [{ ...state.user, ...state.verification }] }
          }
          if (sql.includes('UPDATE users SET email_verified_at')) {
            state.user.email_verified_at = new Date()
            return { rowCount: 1, rows: [] }
          }
          if (sql.includes('UPDATE email_verification_codes SET attempts')) {
            state.verification.attempts += 1
            return { rowCount: 1, rows: [] }
          }
          if (sql.includes('DELETE FROM email_verification_codes')) {
            state.verification = null
            return { rowCount: 1, rows: [] }
          }
          throw new Error(`Unexpected fake transaction query: ${sql}`)
        },
        release() {},
      }
    },
  }
}

test('signup sends an email code, verifies it, and establishes an authenticated session', async (context) => {
  const pool = createFakeDatabase()
  let deliveredCode = ''
  const app = createApp({
    pool,
    config: {
      appOrigin: 'http://localhost:5173',
      allowedOrigins: new Set(['http://localhost:5173']),
      production: false,
      trustProxy: 0,
      sessionMaxAgeDays: 7,
      sessionSecret,
      otpHashSecret,
    },
    sendOtpEmail: async ({ email, code }) => {
      assert.equal(email, 'new@example.com')
      deliveredCode = code
    },
    logger: { error() {} },
    sessionStore: new session.MemoryStore(),
  })
  const server = app.listen(0, '127.0.0.1')
  context.after(() => new Promise((resolve) => server.close(resolve)))
  await new Promise((resolve) => server.once('listening', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`

  const invalidSignup = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'New User', email: 'new@example.com', password: 'short' }),
  })
  assert.equal(invalidSignup.status, 400)

  const signupResponse = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'New User', email: 'New@Example.com', password: 'a long test password' }),
  })
  assert.equal(signupResponse.status, 202)
  assert.match(deliveredCode, /^\d{6}$/)
  assert.equal(pool.state.verification.code_hash, hashEmailCode(deliveredCode, otpHashSecret))
  assert.notEqual(pool.state.verification.code_hash, deliveredCode)

  const unverifiedLogin = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.com', password: 'a long test password' }),
  })
  assert.equal(unverifiedLogin.status, 403)

  const invalidCodeResponse = await fetch(`${origin}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.com', code: deliveredCode === '000000' ? '000001' : '000000' }),
  })
  assert.equal(invalidCodeResponse.status, 400)
  assert.equal(pool.state.verification.attempts, 1)

  const verifyResponse = await fetch(`${origin}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.com', code: deliveredCode }),
  })
  assert.equal(verifyResponse.status, 200)
  const sessionCookie = verifyResponse.headers.get('set-cookie').split(';')[0]
  assert.equal(pool.state.user.email_verified_at instanceof Date, true)

  const currentUserResponse = await fetch(`${origin}/api/auth/me`, {
    headers: { Cookie: sessionCookie },
  })
  assert.equal(currentUserResponse.status, 200)
  assert.deepEqual((await currentUserResponse.json()).user, {
    id: 'user-test-id',
    name: 'New User',
    username: 'new',
    email: 'new@example.com',
    bio: '',
    interests: [],
  })

  const profileResponse = await fetch(`${origin}/api/auth/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({ name: 'Updated User', username: 'updated.user', bio: 'A short intro', interests: ['Design'] }),
  })
  assert.equal(profileResponse.status, 200)
  assert.equal((await profileResponse.json()).user.name, 'Updated User')

  const invalidLogin = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.com', password: 'incorrect password' }),
  })
  assert.equal(invalidLogin.status, 401)

  const loginResponse = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.com', password: 'a long test password' }),
  })
  assert.equal(loginResponse.status, 200)
  const loginCookie = loginResponse.headers.get('set-cookie').split(';')[0]
  assert.match(loginCookie, /iconnect\.sid/)

  const logoutResponse = await fetch(`${origin}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: loginCookie },
  })
  assert.equal(logoutResponse.status, 204)
  const loggedOutResponse = await fetch(`${origin}/api/auth/me`, {
    headers: { Cookie: loginCookie },
  })
  assert.equal(loggedOutResponse.status, 401)
})
