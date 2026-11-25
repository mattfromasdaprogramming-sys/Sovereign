import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set — copy .env.example to .env first');
}

export const pool = new pg.Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const q = (text, params) => pool.query(text, params);

/** Run fn inside a transaction, rolling back on any throw. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    try {
      await client.query('rollback');
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});
