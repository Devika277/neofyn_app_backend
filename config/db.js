const { Pool } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

if (!process.env.DATABASE_URL) {
  console.error('[db] FATAL: DATABASE_URL not set.');
  process.exit(1);
}

const isNeon = process.env.DATABASE_URL.includes('neon.tech');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isNeon
    ? { rejectUnauthorized: false }
    : false,

  // Max 10 per process × 3 PM2 processes = 30 connections total,
  // well within PostgreSQL default of 100.
  max: 10,
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  console.log('[db] Database connected successfully');
});

pool.on('error', (err) => {
  console.error('[db] Unexpected database error:', err);
});

// Optional: logs pool health every 30 seconds (remove if not needed)
setInterval(() => {
  console.log('[db] Pool stats:', {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max: pool.options.max,
  });
}, 30000);

module.exports = pool;