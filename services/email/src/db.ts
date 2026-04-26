import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.EMAIL_DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[db] Pool error:', err.message);
});
