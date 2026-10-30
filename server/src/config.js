import 'dotenv/config'

function requiredSecret(name) {
  const value = process.env[name]
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set to at least 32 characters.`)
  }
  return value
}

function getOrigin(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('APP_ORIGIN must be a valid origin URL.')
  }
  if (url.origin !== value.replace(/\/$/, '')) {
    throw new Error('APP_ORIGIN must not include a path, query, or fragment.')
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('APP_ORIGIN must use HTTPS in production.')
  }
  return url.origin
}

const production = process.env.NODE_ENV === 'production'
const appOrigin = getOrigin(process.env.APP_ORIGIN ?? 'http://localhost:5173')
const allowedOrigins = new Set([appOrigin])
if (!production) {
  const developmentOrigin = new URL(appOrigin)
  if (developmentOrigin.hostname === 'localhost') developmentOrigin.hostname = '127.0.0.1'
  else if (developmentOrigin.hostname === '127.0.0.1') developmentOrigin.hostname = 'localhost'
  allowedOrigins.add(developmentOrigin.origin)
}
const resendApiKey = process.env.RESEND_API_KEY ?? ''
const emailFrom = process.env.EMAIL_FROM ?? ''

if (production && (!resendApiKey || !emailFrom)) {
  throw new Error('RESEND_API_KEY and EMAIL_FROM are required in production.')
}

const trustProxy = Number(process.env.TRUST_PROXY ?? (production ? '1' : '0'))
if (!Number.isInteger(trustProxy) || trustProxy < 0) {
  throw new Error('TRUST_PROXY must be a non-negative integer.')
}
const apiHost = process.env.API_HOST ?? '127.0.0.1'
if (production && !['127.0.0.1', '::1'].includes(apiHost)) {
  throw new Error('In production, API_HOST must bind to loopback behind an HTTPS reverse proxy.')
}

export const config = {
  appOrigin,
  apiHost,
  apiPort: Number(process.env.API_PORT ?? '3001'),
  allowedOrigins,
  databaseUrl: process.env.DATABASE_URL,
  emailFrom,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  otpHashSecret: requiredSecret('OTP_HASH_SECRET'),
  production,
  resendApiKey,
  sessionMaxAgeDays: Number(process.env.SESSION_MAX_AGE_DAYS ?? '7'),
  sessionSecret: requiredSecret('SESSION_SECRET'),
  trustProxy,
}

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL must be set.')
}
if (!Number.isInteger(config.apiPort) || config.apiPort < 1 || config.apiPort > 65535) {
  throw new Error('API_PORT must be a valid TCP port.')
}
if (!Number.isInteger(config.sessionMaxAgeDays) || config.sessionMaxAgeDays < 1 || config.sessionMaxAgeDays > 30) {
  throw new Error('SESSION_MAX_AGE_DAYS must be between 1 and 30.')
}
