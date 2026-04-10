import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('Brakuje DATABASE_URL w pliku .env');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

export async function testDbConnection() {
  const result = await query('SELECT NOW() AS now');
  return result.rows[0];
}
