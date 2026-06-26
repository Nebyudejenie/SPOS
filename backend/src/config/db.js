import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

// Prefer a single DATABASE_URL if provided, otherwise build from discrete vars.
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'appdb',
      max: Number(process.env.DB_POOL_MAX) || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

pool.on('error', (err) => {
  logger.error('Unexpected idle PostgreSQL client error', { error: err.message });
});

export const query = (text, params) => pool.query(text, params);

// Wait for the DB to accept connections (it may still be booting in Docker).
export async function waitForDatabase({ retries = 15, delayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      logger.info('Connected to PostgreSQL');
      return;
    } catch (err) {
      logger.warn(`PostgreSQL not ready (attempt ${attempt}/${retries})`, { error: err.message });
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export async function closePool() {
  await pool.end();
}

export default pool;
