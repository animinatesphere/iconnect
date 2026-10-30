import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createApp } from './app.js'
import { config } from './config.js'
import { createOtpSender } from './email.js'

const { Pool } = pg
const pool = new Pool({ connectionString: config.databaseUrl })
const migrationPath = new URL('../migrations/001_initial.sql', import.meta.url)

try {
  await pool.query(await readFile(fileURLToPath(migrationPath), 'utf8'))
  await pool.query('SELECT 1')
} catch (error) {
  console.error('Backend startup failed while preparing PostgreSQL:', error.message)
  await pool.end()
  process.exitCode = 1
  throw error
}

const app = createApp({
  pool,
  config,
  sendOtpEmail: createOtpSender({
    apiKey: config.resendApiKey,
    from: config.emailFrom,
    production: config.production,
  }),
})

const server = app.listen(config.apiPort, config.apiHost, () => {
  console.info(`iConnect API listening on http://${config.apiHost}:${config.apiPort}`)
})

async function shutdown(signal) {
  console.info(`${signal} received; stopping the iConnect API.`)
  server.close(async (error) => {
    await pool.end()
    if (error) {
      console.error('API shutdown failed:', error.message)
      process.exitCode = 1
    }
  })
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
