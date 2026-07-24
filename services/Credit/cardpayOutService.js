const db = require('../config/db');
const { getCardpayOutProvider } = require('../providers/cardpayOutProviderRouter');
const { validateTpin } = require('../utils/tpinHelper');
const { STATUS_CODE_MAP } = require('./cardPayService');

// ──────────────────────────────────────────────────────────────
// Constants (can be overridden via DB config later)
// ──────────────────────────────────────────────────────────────
const DAILY_LIMIT = 100000;      // ₹1,00,000
const MONTHLY_LIMIT = 1000000;   // ₹10,00,000
const MIN_AMOUNT = 100;
const MAX_AMOUNT = 50000;

// ──────────────────────────────────────────────────────────────
// USER SIDE
// ──────────────────────────────────────────────────────────────

/**
 * Get all active beneficiaries for a user.
 */
async function getBeneficiaries(userId) {
  const result = await db.query(
    `SELECT id, account_holder_name, account_number, ifsc_code, bank_name,
            is_verified, is_active, created_at
     FROM cardpay_out_beneficiaries
     WHERE user_id = $1 AND is_active = true
     ORDER BY created_at DESC`,
    [userId]
  );
  return { success: true, successStatus: true, message: 'Beneficiaries retrieved', responseCode: '000', data: result.rows };
}

/**
 * Add a new beneficiary for a user.
 */
async function addBeneficiary(userId, data) {
  const { account_holder_name, account_number, ifsc_code, bank_name } = data;
  const result = await db.query(
    `INSERT INTO cardpay_out_beneficiaries
       (user_id, account_holder_name, account_number, ifsc_code, bank_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, account_holder_name, account_number, ifsc_code,
               bank_name, is_verified, is_active, created_at`,
    [userId, account_holder_name, account_number, ifsc_code, bank_name]
  );
  return { success: true, successStatus: true, message: 'Beneficiary added', responseCode: '000', data: result.rows[0] };
}

/**
 * Soft‑delete a beneficiary.
 */
async function deleteBeneficiary(userId, beneficiaryId) {
  const result = await db.query(
    `UPDATE cardpay_out_beneficiaries
     SET is_active = false, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND is_active = true
     RETURNING id`,
    [beneficiaryId, userId]
  );
  if (result.rows.length === 0) {
    throw new Error('Beneficiary not found or already deleted');
  }
}

/**
 * Get the current CardPay wallet balance for a user.
 */
async function getCardPayBalance(userId) {
  const result = await db.query(
    'SELECT balance FROM cardpay_wallets WHERE user_id = $1',
    [userId]
  );
  if (result.rows.length === 0) return { success: true, successStatus: true, message: 'CardPay wallet not found', responseCode: '000', data: { balance: 0 } };
  return { success: true, successStatus: true, message: 'Balance retrieved', responseCode: '000', data: { balance: parseFloat(result.rows[0].balance) } };
}

/**
 * Get daily and monthly withdrawal limits used by the user.
 */
async function getWithdrawalLimits(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

  const dailyResult = await db.query(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM cardpay_out_transactions
     WHERE user_id = $1 AND txn_status = 'success' AND created_at::date = $2`,
    [userId, today]
  );
  const dailyUsed = parseFloat(dailyResult.rows[0].total);

  const monthlyResult = await db.query(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM cardpay_out_transactions
     WHERE user_id = $1 AND txn_status = 'success' AND created_at >= $2`,
    [userId, startOfMonth]
  );
  const monthlyUsed = parseFloat(monthlyResult.rows[0].total);

  return { success: true, successStatus: true, message: 'Limits retrieved', responseCode: '000', data: { dailyUsed, dailyLimit: DAILY_LIMIT, monthlyUsed, monthlyLimit: MONTHLY_LIMIT } };
}

/**
 * Initiate a CardPay-Out withdrawal.
 */
async function initiatePayout(userId, data) {
  const { amount, mode, beneficiaryId, tpin, remarks } = data;

  // ── Basic validations ──
  if (!amount || amount <= 0) throw new Error('Invalid amount');
  if (amount < MIN_AMOUNT) throw new Error(`Minimum payout amount is ₹${MIN_AMOUNT}`);
  if (amount > MAX_AMOUNT) throw new Error(`Maximum per transaction is ₹${MAX_AMOUNT}`);
  if (!['IMPS', 'NEFT'].includes(mode)) throw new Error('Invalid transfer mode');

  const isTpinValid = await validateTpin(userId, tpin);
  if (!isTpinValid) throw new Error('Invalid TPIN');

  const merchantRefId = Date.now().toString() + Math.floor(Math.random() * 10000);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Check CardPay wallet balance ──
    const walletRes = await client.query(
      'SELECT balance FROM cardpay_wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    const balance = parseFloat(walletRes.rows[0]?.balance || 0);
    if (amount > balance) throw new Error('Insufficient CardPay balance');

    // ── 2. Verify beneficiary ──
    const benRes = await client.query(
      `SELECT id, account_holder_name, account_number, ifsc_code
       FROM cardpay_out_beneficiaries
       WHERE id = $1 AND user_id = $2 AND is_active = true`,
      [beneficiaryId, userId]
    );
    if (benRes.rows.length === 0) throw new Error('Invalid beneficiary');
    const beneficiary = benRes.rows[0];

    // ── 3. Check daily/monthly limits ──
    const limits = await getWithdrawalLimits(userId);
    if (limits.dailyUsed + amount > limits.dailyLimit) {
      throw new Error(`Daily limit exceeded. Available: ₹${(limits.dailyLimit - limits.dailyUsed).toFixed(2)}`);
    }
    if (limits.monthlyUsed + amount > limits.monthlyLimit) {
      throw new Error(`Monthly limit exceeded. Available: ₹${(limits.monthlyLimit - limits.monthlyUsed).toFixed(2)}`);
    }

    // ── 4. Deduct from CardPay wallet ──
    const newBalance = balance - amount;
    await client.query(
      'UPDATE cardpay_wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
      [newBalance, userId]
    );

    // ── 5. Insert transaction ──
    const txnRes = await client.query(
      `INSERT INTO cardpay_out_transactions
         (user_id, beneficiary_id, merchant_ref_id, amount, mode, remarks, txn_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id`,
      [userId, beneficiaryId, merchantRefId, amount, mode, remarks]
    );
    const txnId = txnRes.rows[0].id;

    // ── 6. Insert wallet ledger (debit) ──
    await client.query(
      `INSERT INTO cardpay_out_wallet_ledger
         (user_id, cardpay_out_transaction_id, amount, balance_before, balance_after, remarks)
       VALUES ($1, $2, $3, $4, $5, 'CardPay-Out withdrawal')`,
      [userId, txnId, -amount, balance, newBalance]
    );

    // ── 7. Call the payout provider ──
    const provider = getCardpayOutProvider();
    let providerResponse;
    try {
      providerResponse = await provider.transfer({
        merchantRefId,
        amount,
        mode,
        accountDetails: {
          accountName: beneficiary.account_holder_name,
          accountNumber: beneficiary.account_number,
          ifsc: beneficiary.ifsc_code,
          mobileNumber: '9999999999',   // Could be user's phone if needed
        }
      });
    } catch (err) {
      throw new Error(`Provider error: ${err.message}`);
    }

    // ── 8. Interpret provider response ──
    const isSuccess = providerResponse.status === '000';
    const isPending = providerResponse.status === '002' || providerResponse.status === '004';
    const isValidationFailed = providerResponse.status === '003';
    const finalStatus = isSuccess ? 'success' : (isPending ? 'pending' : (isValidationFailed ? 'failed' : 'failed'));

    // ── 9. Update transaction ──
    await client.query(
      `UPDATE cardpay_out_transactions
       SET gateway_request = $1, gateway_response = $2, txn_status = $3,
           utr = $4, processed_at = NOW(), updated_at = NOW()
       WHERE id = $5`,
      [
        JSON.stringify(data),
        JSON.stringify(providerResponse),
        finalStatus,
        providerResponse.bankRefNo || null,
        txnId
      ]
    );

    // ── 10. Commit & return ──
    if (finalStatus === 'success') {
      await client.query(
        'UPDATE cardpay_out_transactions SET wallet_deducted = TRUE WHERE id = $1',
        [txnId]
      );
      await client.query('COMMIT');
      return {
        success: true,
        successStatus: true,
        message: 'Withdrawal successful',
        responseCode: '000',
        data: {
          transactionId: txnId,
          amount: parseFloat(amount),
          merchantRefId,
          providerRefId: providerResponse.providerRefId,
          bankRefNo: providerResponse.bankRefNo,
        }
      };
    } else if (finalStatus === 'failed') {
      // ── Refund wallet on failure ──
      await client.query(
        'UPDATE cardpay_wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2',
        [amount, userId]
      );
      await client.query(
        `INSERT INTO cardpay_out_wallet_ledger
           (user_id, cardpay_out_transaction_id, amount, balance_before, balance_after, remarks)
         VALUES ($1, $2, $3, $4, $5, 'CardPay-Out refund for failed transfer')`,
        [userId, txnId, amount, newBalance, balance]
      );
      await client.query('COMMIT');
      return {
        success: false,
        successStatus: false,
        message: `Withdrawal failed: ${providerResponse.message}`,
        responseCode: '001',
        data: {
          transactionId: txnId,
          amount: parseFloat(amount),
          merchantRefId,
        }
      };
    } else {
      // pending – wallet already deducted but provider is processing
      await client.query('COMMIT');
      return {
        success: true,
        successStatus: true,
        message: 'Transfer submitted. Final status will be updated shortly.',
        responseCode: '002',
        data: {
          transactionId: txnId,
          amount: parseFloat(amount),
          merchantRefId,
        }
      };
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get status of a single transaction by merchant reference ID.
 */
async function getTransactionStatus(ref) {
  const result = await db.query(
    `SELECT txn_status, utr, failure_reason, updated_at
     FROM cardpay_out_transactions WHERE merchant_ref_id = $1`,
    [ref]
  );
  if (result.rows.length === 0) throw new Error('Transaction not found');
  return { success: true, successStatus: true, message: 'Transaction status retrieved', responseCode: '000', data: result.rows[0] };
}

/**
 * Get full receipt data for a transaction.
 */
async function getReceiptData(ref) {
  const result = await db.query(
    `SELECT t.id, t.amount, t.mode, t.txn_status AS status, t.utr,
            t.charges, t.created_at, t.processed_at, t.merchant_ref_id,
            b.account_holder_name, b.account_number, b.ifsc_code, b.bank_name
     FROM cardpay_out_transactions t
     LEFT JOIN cardpay_out_beneficiaries b ON t.beneficiary_id = b.id
     WHERE t.merchant_ref_id = $1`,
    [ref]
  );
  if (result.rows.length === 0) throw new Error('Transaction not found');
  return { success: true, successStatus: true, message: 'Receipt data retrieved', responseCode: '000', data: result.rows[0] };
}

/**
 * Get a user's own transaction history with optional filters.
 */
async function getUserTransactions(userId, filters = {}) {
  const { status, from, to } = filters;
  let query = `
    SELECT t.id, t.amount, t.mode, t.txn_status AS status, t.utr,
           t.charges, t.created_at, t.merchant_ref_id,
           b.account_holder_name, b.account_number AS bene_account
    FROM cardpay_out_transactions t
    LEFT JOIN cardpay_out_beneficiaries b ON t.beneficiary_id = b.id
    WHERE t.user_id = $1
  `;
  const params = [userId];
  let paramIndex = 2;

  if (status) { query += ` AND t.txn_status = $${paramIndex}`; params.push(status); paramIndex++; }
  if (from) { query += ` AND t.created_at >= $${paramIndex}`; params.push(from); paramIndex++; }
  if (to) { query += ` AND t.created_at <= $${paramIndex}`; params.push(to + ' 23:59:59'); paramIndex++; }

  query += ' ORDER BY t.created_at DESC';
  const result = await db.query(query, params);
  return { success: true, successStatus: true, message: 'Transaction history retrieved', responseCode: '000', data: result.rows };
}

// ──────────────────────────────────────────────────────────────
// WEBHOOK / CALLBACK
// ──────────────────────────────────────────────────────────────

/**
 * Process a callback from the payout provider.
 */
async function processCallback(callbackData) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock and fetch transaction
    const txnRes = await client.query(
      `SELECT id, user_id, amount, wallet_deducted
       FROM cardpay_out_transactions
       WHERE merchant_ref_id = $1 FOR UPDATE`,
      [callbackData.merchantRefId]
    );
    if (txnRes.rows.length === 0) {
      await client.query('COMMIT');
      return { success: false, successStatus: false, message: 'Transaction not found', responseCode: '4003' };
    }
    const txn = txnRes.rows[0];

    // 2. Idempotency check
    if (txn.wallet_deducted) {
      await client.query('COMMIT');
      return { success: true, successStatus: true, message: 'Already processed', responseCode: '3002' };
    }

    // 3. Map status — prefer numeric txnStatusCode over text txnStatus
    let status;
    if (callbackData.txnStatusCode) {
      const numericStatusMap = {
        '000': 'success',
        '001': 'failed',
        '002': 'pending',
        '003': 'failed',
        '004': 'pending',
      };
      status = numericStatusMap[callbackData.txnStatusCode] || 'failed';
    } else {
      // Fallback to text-based status for providers that only send SUCCESS/FAILED
      const textStatusMap = { 'SUCCESS': 'success', 'FAILED': 'failed' };
      status = textStatusMap[callbackData.txnStatus] || 'failed';
    }

    if (status === 'success') {
      await client.query(
        `UPDATE cardpay_out_transactions
         SET txn_status = 'success', wallet_deducted = TRUE, utr = $1,
             processed_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [callbackData.utr, txn.id]
      );
    } else {
      // 4. Refund wallet on failure
      const walletRes = await client.query(
        'SELECT balance FROM cardpay_wallets WHERE user_id = $1 FOR UPDATE',
        [txn.user_id]
      );
      const currentBalance = parseFloat(walletRes.rows[0].balance);
      const refundAmount = parseFloat(txn.amount);

      await client.query(
        'UPDATE cardpay_wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2',
        [refundAmount, txn.user_id]
      );
      await client.query(
        `INSERT INTO cardpay_wallet_ledger
           (user_id, cardpay_transaction_id, amount, balance_before, balance_after, remarks)
         VALUES ($1, NULL, $2, $3, $4, 'CardPay-Out reversal')`,
        [txn.user_id, refundAmount, currentBalance, currentBalance + refundAmount]
      );
      await client.query(
        `UPDATE cardpay_out_transactions
         SET txn_status = 'failed', wallet_deducted = TRUE,
             failure_reason = $1, processed_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [callbackData.message || 'Provider failure', txn.id]
      );
    }

    // 5. Log callback
    await client.query(
      `INSERT INTO cardpay_out_callback_logs
         (cardpay_out_transaction_id, request_payload, response_payload, status)
       VALUES ($1, $2, $3, $4)`,
      [txn.id, JSON.stringify(callbackData), JSON.stringify({ success: true }), 'processed']
    );

    await client.query('COMMIT');
    const statusCodeKey = callbackData.txnStatusCode || callbackData.txnStatus;
    return { success: true, successStatus: true, message: 'Callback processed', responseCode: STATUS_CODE_MAP[statusCodeKey] || '2001' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ──────────────────────────────────────────────────────────────
// ADMIN SIDE
// ──────────────────────────────────────────────────────────────

/**
 * Get admin dashboard statistics.
 */
async function getAdminDashboard() {
  const result = await db.query(`
    SELECT
      COUNT(*)::int AS total_transactions,
      COALESCE(SUM(CASE WHEN txn_status = 'success' THEN amount ELSE 0 END), 0) AS total_success_amount,
      COALESCE(SUM(CASE WHEN txn_status = 'success' THEN 1 ELSE 0 END), 0)::int AS success_count,
      COALESCE(SUM(CASE WHEN txn_status = 'failed' THEN 1 ELSE 0 END), 0)::int AS failed_count,
      COALESCE(SUM(CASE WHEN txn_status = 'pending' THEN 1 ELSE 0 END), 0)::int AS pending_count
    FROM cardpay_out_transactions
  `);
  return { success: true, successStatus: true, message: 'Dashboard data retrieved', responseCode: '000', data: result.rows[0] };
}

/**
 * Get all transactions (admin view) with optional filters.
 */
async function getAllTransactions(filters = {}) {
  const { user_id, status, from, to } = filters;
  let query = `
    SELECT t.id, t.amount, t.mode, t.txn_status, t.utr, t.charges,
           t.created_at, t.merchant_ref_id, t.failure_reason,
           CONCAT(u.first_name, ' ', u.last_name) AS user_name,
           u.phone AS user_mobile, u.member_id,
           b.account_holder_name, b.account_number, b.ifsc_code, b.bank_name
    FROM cardpay_out_transactions t
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN cardpay_out_beneficiaries b ON t.beneficiary_id = b.id
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;

  if (user_id) { query += ` AND t.user_id = $${idx}`; params.push(user_id); idx++; }
  if (status) { query += ` AND t.txn_status = $${idx}`; params.push(status); idx++; }
  if (from) { query += ` AND t.created_at >= $${idx}`; params.push(from); idx++; }
  if (to) { query += ` AND t.created_at <= $${idx}`; params.push(to + ' 23:59:59'); idx++; }

  query += ' ORDER BY t.created_at DESC';
  const result = await db.query(query, params);
  return { success: true, successStatus: true, message: 'Transactions retrieved', responseCode: '000', data: result.rows };
}

/**
 * Get a single transaction detail for admin.
 */
async function getTransactionDetail(id) {
  const result = await db.query(`
    SELECT t.*,
           CONCAT(u.first_name, ' ', u.last_name) AS user_name,
           u.phone AS user_mobile,
           b.account_holder_name, b.account_number, b.ifsc_code, b.bank_name
    FROM cardpay_out_transactions t
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN cardpay_out_beneficiaries b ON t.beneficiary_id = b.id
    WHERE t.id = $1
  `, [id]);
  if (!result) return { success: false, successStatus: false, message: 'Transaction not found', responseCode: '004', data: null };
  return { success: true, successStatus: true, message: 'Transaction detail retrieved', responseCode: '000', data: result };
}

/**
 * Admin manually processes a pending transaction (force success).
 */
async function adminProcessTransaction(id) {
  const txn = await db.query(
    'SELECT id, txn_status FROM cardpay_out_transactions WHERE id = $1',
    [id]
  );
  if (txn.rows.length === 0) throw new Error('Transaction not found');
  if (txn.rows[0].txn_status !== 'pending') throw new Error('Only pending transactions can be processed');

  await db.query(
    `UPDATE cardpay_out_transactions
     SET txn_status = 'success', wallet_deducted = TRUE,
         processed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [id]
  );
  return { success: true, successStatus: true, message: 'Transaction marked as success', responseCode: '000' };
}

/**
 * Admin cancels a pending transaction and refunds the wallet.
 */
async function adminCancelTransaction(id) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const txnRes = await client.query(
      'SELECT id, user_id, amount, txn_status FROM cardpay_out_transactions WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (txnRes.rows.length === 0) throw new Error('Transaction not found');
    const txn = txnRes.rows[0];
    if (txn.txn_status !== 'pending') throw new Error('Only pending transactions can be cancelled');

    // Refund wallet
    const walletRes = await client.query(
      'SELECT balance FROM cardpay_wallets WHERE user_id = $1 FOR UPDATE',
      [txn.user_id]
    );
    const currentBalance = parseFloat(walletRes.rows[0].balance);
    const refundAmount = parseFloat(txn.amount);

    await client.query(
      'UPDATE cardpay_wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2',
      [refundAmount, txn.user_id]
    );
    await client.query(
      `INSERT INTO cardpay_out_wallet_ledger
         (user_id, cardpay_out_transaction_id, amount, balance_before, balance_after, remarks)
       VALUES ($1, $2, $3, $4, $5, 'CardPay-Out cancellation refund')`,
      [txn.user_id, id, refundAmount, currentBalance, currentBalance + refundAmount]
    );
    await client.query(
      `UPDATE cardpay_out_transactions
       SET txn_status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');
    return { success: true, successStatus: true, message: 'Transaction cancelled and wallet refunded', responseCode: '000' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Export data (for CSV) – essentially wrapper for getAllTransactions.
 */
async function getExportData(filters = {}) {
  return getAllTransactions(filters);
}

// ──────────────────────────────────────────────────────────────
// CONFIGURATION
// ──────────────────────────────────────────────────────────────

/**
 * Get all configuration entries from the DB.
 */
async function getConfig() {
  const result = await db.query(
    `SELECT key_name, key_value, environment
     FROM cardpay_out_configurations
     ORDER BY key_name`
  );
  return { success: true, successStatus: true, message: 'Config retrieved', responseCode: '000', data: result.rows };
}

/**
 * Update or insert a configuration entry.
 */
async function updateConfig(keyName, keyValue, environment) {
  await db.query(
    `INSERT INTO cardpay_out_configurations (key_name, key_value, environment)
     VALUES ($1, $2, $3)
     ON CONFLICT (key_name) DO UPDATE
     SET key_value = EXCLUDED.key_value,
         environment = EXCLUDED.environment,
         updated_at = NOW()`,
    [keyName, keyValue, environment]
  );
}

// ──────────────────────────────────────────────────────────────
// EXPORTS
// ──────────────────────────────────────────────────────────────
module.exports = {
  getBeneficiaries,
  addBeneficiary,
  deleteBeneficiary,
  getCardPayBalance,
  getWithdrawalLimits,
  initiatePayout,
  getTransactionStatus,
  getReceiptData,
  getUserTransactions,
  processCallback,
  getAdminDashboard,
  getAllTransactions,
  getTransactionDetail,
  adminProcessTransaction,
  adminCancelTransaction,
  getExportData,
  getConfig,
  updateConfig,
};