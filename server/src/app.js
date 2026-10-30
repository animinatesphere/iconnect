import connectPgSimple from 'connect-pg-simple'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import session from 'express-session'
import helmet from 'helmet'
import { z } from 'zod'
import { createEmailCode, hashEmailCode, hashPassword, secureHashEquals, verifyPassword } from './security.js'

const PgSession = connectPgSimple(session)
const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase())
const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: emailSchema,
  password: z.string().min(10).max(128),
}).strict()
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
}).strict()
const verifySchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/),
}).strict()
const resendSchema = z.object({ email: emailSchema }).strict()
const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  username: z.string().trim().regex(/^[a-zA-Z0-9._]{3,30}$/),
  bio: z.string().trim().max(120),
  interests: z.array(z.string().trim().min(1).max(32)).max(10),
}).strict()

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many authentication attempts. Try again in 15 minutes.' } },
})

function sendError(response, status, code, message) {
  response.status(status).json({ error: { code, message } })
}

function parseBody(schema, request, response) {
  const result = schema.safeParse(request.body)
  if (!result.success) {
    sendError(response, 400, 'invalid_input', 'Check the information and try again.')
    return null
  }
  return result.data
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.display_name,
    username: user.username,
    email: user.email,
    bio: user.bio,
    interests: user.interests,
  }
}

function regenerateSession(request, userId) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) {
        reject(error)
        return
      }
      request.session.userId = userId
      request.session.save((saveError) => saveError ? reject(saveError) : resolve())
    })
  })
}

function issueVerification(pool, sendOtpEmail, secret) {
  return async function issue(user) {
    const code = createEmailCode()
    const codeHash = hashEmailCode(code, secret)
    const inserted = await pool.query(
      `INSERT INTO email_verification_codes (user_id, code_hash, expires_at, sent_at, attempts)
       VALUES ($1, $2, now() + interval '10 minutes', now(), 0)
       ON CONFLICT (user_id) DO UPDATE
       SET code_hash = EXCLUDED.code_hash,
           expires_at = EXCLUDED.expires_at,
           sent_at = EXCLUDED.sent_at,
           attempts = 0
       WHERE email_verification_codes.sent_at <= now() - interval '60 seconds'
       RETURNING user_id`,
      [user.id, codeHash],
    )
    if (inserted.rowCount === 0) return false

    try {
      await sendOtpEmail({ email: user.email, name: user.display_name, code })
    } catch (error) {
      await pool.query(
        'DELETE FROM email_verification_codes WHERE user_id = $1 AND code_hash = $2',
        [user.id, codeHash],
      )
      throw error
    }
    return true
  }
}

export function createApp({ pool, config, sendOtpEmail, logger = console, sessionStore }) {
  const app = express()
  const issueVerificationCode = issueVerification(pool, sendOtpEmail, config.otpHashSecret)
  const dummyPasswordHashPromise = hashPassword('not-a-real-user-password')

  app.disable('x-powered-by')
  app.set('trust proxy', config.trustProxy)
  app.use(helmet())
  app.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    if (request.headers.origin && !config.allowedOrigins.has(request.headers.origin)) {
      sendError(response, 403, 'origin_not_allowed', 'This request origin is not allowed.')
      return
    }
    next()
  })
  app.use(express.json({ limit: '16kb', type: 'application/json' }))
  app.use(session({
    name: config.production ? '__Host-iconnect.sid' : 'iconnect.sid',
    store: sessionStore ?? new PgSession({
      pool,
      tableName: 'user_sessions',
      createTableIfMissing: true,
      pruneSessionInterval: 15 * 60,
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: config.sessionMaxAgeDays * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      secure: config.production,
      path: '/',
    },
  }))

  app.get('/api/health', async (_request, response) => {
    await pool.query('SELECT 1')
    response.json({ status: 'ok' })
  })

  app.post('/api/auth/register', authRateLimit, async (request, response) => {
    const input = parseBody(registerSchema, request, response)
    if (!input) return

    const passwordHash = await hashPassword(input.password)
    const emailPrefix = input.email.split('@')[0].replace(/[^a-zA-Z0-9._]/g, '').slice(0, 30)
    const username = emailPrefix.length >= 3 ? emailPrefix : `user${emailPrefix}`.slice(0, 30)
    const result = await pool.query(
      `INSERT INTO users (display_name, username, email, password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, display_name, email`,
      [input.name, username, input.email, passwordHash],
    )

    if (result.rowCount) {
      await issueVerificationCode(result.rows[0])
    }
    response.status(202).json({ message: 'If this address can be registered, a verification code has been sent.' })
  })

  app.post('/api/auth/resend-verification', authRateLimit, async (request, response) => {
    const input = parseBody(resendSchema, request, response)
    if (!input) return

    const result = await pool.query(
      `SELECT id, display_name, email
       FROM users
       WHERE email = $1 AND email_verified_at IS NULL`,
      [input.email],
    )
    if (result.rowCount) {
      await issueVerificationCode(result.rows[0])
    }
    response.status(202).json({ message: 'If the address is awaiting verification, a code has been sent.' })
  })

  app.post('/api/auth/verify-email', authRateLimit, async (request, response) => {
    const input = parseBody(verifySchema, request, response)
    if (!input) return

    const client = await pool.connect()
    let user
    try {
      await client.query('BEGIN')
      const result = await client.query(
        `SELECT u.id, u.display_name, u.username, u.email, u.bio, u.interests,
                v.code_hash, v.expires_at, v.attempts
         FROM users u
         JOIN email_verification_codes v ON v.user_id = u.id
         WHERE u.email = $1 AND u.email_verified_at IS NULL
         FOR UPDATE OF u, v`,
        [input.email],
      )
      if (!result.rowCount) {
        await client.query('ROLLBACK')
        sendError(response, 400, 'invalid_code', 'That code is invalid or expired. Request a new one and try again.')
        return
      }

      const row = result.rows[0]
      if (row.attempts >= 5 || new Date(row.expires_at).getTime() <= Date.now()) {
        await client.query('DELETE FROM email_verification_codes WHERE user_id = $1', [row.id])
        await client.query('COMMIT')
        sendError(response, 400, 'invalid_code', 'That code is invalid or expired. Request a new one and try again.')
        return
      }

      const candidateHash = hashEmailCode(input.code, config.otpHashSecret)
      if (!secureHashEquals(candidateHash, row.code_hash)) {
        await client.query(
          'UPDATE email_verification_codes SET attempts = attempts + 1 WHERE user_id = $1',
          [row.id],
        )
        await client.query('COMMIT')
        sendError(response, 400, 'invalid_code', 'That code is invalid or expired. Request a new one and try again.')
        return
      }

      await client.query(
        'UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1',
        [row.id],
      )
      await client.query('DELETE FROM email_verification_codes WHERE user_id = $1', [row.id])
      await client.query('COMMIT')
      user = row
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    await regenerateSession(request, user.id)
    response.json({ user: publicUser(user) })
  })

  app.post('/api/auth/login', authRateLimit, async (request, response) => {
    const input = parseBody(loginSchema, request, response)
    if (!input) return

    const result = await pool.query(
      'SELECT id, display_name, username, email, bio, interests, password_hash, email_verified_at FROM users WHERE email = $1',
      [input.email],
    )
    const user = result.rows[0]
    const passwordValid = await verifyPassword(input.password, user?.password_hash ?? await dummyPasswordHashPromise)
    if (!user || !passwordValid) {
      sendError(response, 401, 'invalid_credentials', 'Email or password is incorrect.')
      return
    }
    if (!user.email_verified_at) {
      sendError(response, 403, 'email_not_verified', 'Verify your email address before signing in.')
      return
    }

    await regenerateSession(request, user.id)
    response.json({ user: publicUser(user) })
  })

  app.get('/api/auth/me', async (request, response) => {
    if (!request.session.userId) {
      sendError(response, 401, 'not_authenticated', 'Sign in to continue.')
      return
    }
    const result = await pool.query(
      'SELECT id, display_name, username, email, bio, interests, email_verified_at FROM users WHERE id = $1',
      [request.session.userId],
    )
    if (!result.rowCount || !result.rows[0].email_verified_at) {
      request.session.destroy(() => {})
      sendError(response, 401, 'not_authenticated', 'Sign in to continue.')
      return
    }
    response.json({ user: publicUser(result.rows[0]) })
  })

  app.put('/api/auth/profile', async (request, response) => {
    if (!request.session.userId) {
      sendError(response, 401, 'not_authenticated', 'Sign in to continue.')
      return
    }
    const input = parseBody(profileSchema, request, response)
    if (!input) return
    const result = await pool.query(
      `UPDATE users
       SET display_name = $2, username = $3, bio = $4, interests = $5, updated_at = now()
       WHERE id = $1 AND email_verified_at IS NOT NULL
       RETURNING id, display_name, username, email, bio, interests`,
      [request.session.userId, input.name, input.username, input.bio, input.interests],
    )
    if (!result.rowCount) {
      sendError(response, 401, 'not_authenticated', 'Sign in to continue.')
      return
    }
    response.json({ user: publicUser(result.rows[0]) })
  })

  app.post('/api/auth/logout', async (request, response) => {
    if (!request.session.userId) {
      response.status(204).end()
      return
    }
    await new Promise((resolve, reject) => {
      request.session.destroy((error) => error ? reject(error) : resolve())
    })
    response.clearCookie(config.production ? '__Host-iconnect.sid' : 'iconnect.sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.production,
      path: '/',
    })
    response.status(204).end()
  })

  app.use((error, _request, response, _next) => {
    logger.error('API request failed:', error)
    if (response.headersSent) return
    if (error.type === 'entity.parse.failed') {
      sendError(response, 400, 'invalid_json', 'The request body must be valid JSON.')
      return
    }
    if (error.type === 'entity.too.large') {
      sendError(response, 413, 'request_too_large', 'The request body is too large.')
      return
    }
    sendError(response, 500, 'internal_error', 'The request could not be completed. Try again later.')
  })

  return app
}
