import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set before running migrations.')
}

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const migrationPath = new URL('../migrations/001_initial.sql', import.meta.url)

try {
  await pool.query(await readFile(fileURLToPath(migrationPath), 'utf8'))
  console.info('Database migration completed.')
} finally {
  await pool.end()
}
