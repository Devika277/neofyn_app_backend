const { Pool } = require('pg');
require('dotenv').config();

let pool = null;

if (!process.env.DATABASE_URL) {
  console.warn('[db] WARNING: DATABASE_URL not set, skipping DB connection');
} else {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false      // Required for Neon (and most cloud PG)
    }
  });

  pool.on('connect', () => {
    console.log('[db] Connected to database');
  });

  pool.on('error', (err) => {
    console.error('[db] Unexpected error:', err.message);
  });
}

module.exports = pool;