// backend/utils/aepsLogger.js

/**
 * Logs AEPS events to console (and optionally to database).
 * @param {Object} entry - Log entry
 * @param {number} entry.userId - User ID performing the action
 * @param {string} entry.type - e.g., 'cash_withdrawal', 'balance_enquiry'
 * @param {string} entry.status - 'success', 'failed', 'error'
 * @param {Object} [entry.providerResult] - Full provider response
 * @param {string} [entry.error] - Error message if status is 'error'
 */
async function log(entry) {
  const { userId, type, status, providerResult, error } = entry;

  // Console logging for debugging
  console.log(
    `[AEPS LOG] ${new Date().toISOString()} | User: ${userId} | Type: ${type} | Status: ${status}`
  );

  // Optional: Insert into aeps_logs table if you have one
  // try {
  //   const pool = require('../config/db');
  //   await pool.query(
  //     `INSERT INTO aeps_logs (user_id, txn_type, status, provider_raw, error_details, created_at)
  //      VALUES ($1, $2, $3, $4, $5, NOW())`,
  //     [userId, type, status, JSON.stringify(providerResult), error]
  //   );
  // } catch (dbErr) {
  //   console.error('[AEPS LOG] DB insert failed:', dbErr.message);
  // }
}

module.exports = { log };