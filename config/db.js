const { Pool } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

let pool = null;

try {
  if (!process.env.DATABASE_URL) {
    console.warn('[db] WARNING: DATABASE_URL not set');
  } else {
    const isNeon = process.env.DATABASE_URL.includes('neon.tech');

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: isNeon
        ? { rejectUnauthorized: false }
        : false
    });

    pool.on('connect', () => {
      console.log('[db] Database connected successfully');
    });

    pool.on('error', (err) => {
      console.error('[db] Unexpected database error:', err.message);
    });
  }
} catch (err) {
  console.error('[db] Pool creation error:', err.message);
}

module.exports = pool;