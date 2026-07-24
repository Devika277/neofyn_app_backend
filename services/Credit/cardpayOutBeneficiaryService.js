const db = require('../config/db');

async function listBeneficiaries(userId) {
  const result = await db.query(
    `SELECT id, account_holder_name, account_number, ifsc_code, bank_name,
            is_verified, is_active, created_at
     FROM cardpay_out_beneficiaries
     WHERE user_id = $1 AND is_active = true
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

async function createBeneficiary(userId, data) {
  const { account_holder_name, account_number, ifsc_code, bank_name } = data;
  const result = await db.query(
    `INSERT INTO cardpay_out_beneficiaries (user_id, account_holder_name, account_number, ifsc_code, bank_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, account_holder_name, account_number, ifsc_code, bank_name, is_verified, is_active, created_at`,
    [userId, account_holder_name, account_number, ifsc_code, bank_name]
  );
  return result.rows[0];
}

async function removeBeneficiary(userId, beneficiaryId) {
  const result = await db.query(
    `UPDATE cardpay_out_beneficiaries SET is_active = false, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND is_active = true
     RETURNING id`,
    [beneficiaryId, userId]
  );
  if (result.rows.length === 0) {
    throw new Error('Beneficiary not found or already deleted');
  }
}

module.exports = { listBeneficiaries, createBeneficiary, removeBeneficiary };
