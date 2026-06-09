const crypto = require('crypto');
const pool = require('../config/db');

function hashTpin(tpin) {
  return crypto.createHash('sha256').update(String(tpin)).digest('hex');
}

async function validateTpin(userId, tpin) {
  if (!tpin || tpin.length < 4 || tpin.length > 6) return false;

  const hashed = hashTpin(tpin);
  const res = await pool.query(
    'SELECT id FROM users WHERE id = $1 AND tpin = $2',
    [userId, hashed]
  );
  return res.rows.length > 0;
}

module.exports = { validateTpin, hashTpin };