// backend/services/walletService.js

const pool = require('../config/db');

// ─── Get wallet by user ID ───────────────────────────────────────
const getWalletByUserId = async (userId) => {
  try {
    const result = await pool.query(
      'SELECT * FROM wallets WHERE user_id = $1',
      [userId]
    );
    return result.rows[0];
  } catch (error) {
    throw error;
  }
};

// ─── Get main wallet balance ─────────────────────────────────────
const getBalance = async (userId) => {
  try {
    const result = await pool.query(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [userId]
    );
    if (result.rows.length === 0) throw new Error('Wallet not found');
    return parseFloat(result.rows[0].balance);
  } catch (error) {
    throw error;
  }
};

// ─── Add money to main wallet (Credit) ──────────────────────────
const addMoney = async (userId, amount, description, adminId, client = null) => {
  let ownClient = false;
  let dbClient  = client;

  if (!dbClient) {
    dbClient  = await pool.connect();
    ownClient = true;
  }

  try {
    if (ownClient) await dbClient.query('BEGIN');

    const walletResult = await dbClient.query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (walletResult.rows.length === 0) throw new Error('Wallet not found');

    const wallet     = walletResult.rows[0];
    const newBalance = parseFloat(wallet.balance) + parseFloat(amount);

    await dbClient.query(
      'UPDATE wallets SET balance = $1 WHERE user_id = $2',
      [newBalance, userId]
    );

    const ledgerResult = await dbClient.query(
      `INSERT INTO wallet_ledger
         (wallet_id, transaction_type, amount, balance_after, description, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [wallet.id, 'credit', amount, newBalance, description,
       adminId ? `admin_${adminId}` : 'system']
    );

    if (ownClient) await dbClient.query('COMMIT');

    return {
      success:     true,
      newBalance,
      transaction: ledgerResult.rows[0],
    };
  } catch (error) {
    if (ownClient) await dbClient.query('ROLLBACK');
    throw error;
  } finally {
    if (ownClient && dbClient) dbClient.release();
  }
};

// ─── Deduct money from main wallet (Debit) ──────────────────────
const deductMoney = async (userId, amount, description, referenceId = null, client = null) => {
  let ownClient = false;
  let dbClient  = client;

  if (!dbClient) {
    dbClient  = await pool.connect();
    ownClient = true;
  }

  try {
    if (ownClient) await dbClient.query('BEGIN');

    const walletResult = await dbClient.query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (walletResult.rows.length === 0) throw new Error('Wallet not found');

    const wallet         = walletResult.rows[0];
    const currentBalance = parseFloat(wallet.balance);
    const amountNum      = parseFloat(amount);

    if (currentBalance < amountNum) throw new Error('Insufficient balance');

    const newBalance = currentBalance - amountNum;

    await dbClient.query(
      'UPDATE wallets SET balance = $1 WHERE user_id = $2',
      [newBalance, userId]
    );

    const ledgerResult = await dbClient.query(
      `INSERT INTO wallet_ledger
         (wallet_id, transaction_type, amount, balance_after, description, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [wallet.id, 'debit', amountNum, newBalance, description, referenceId || 'system']
    );

    if (ownClient) await dbClient.query('COMMIT');

    return {
      success:     true,
      newBalance,
      transaction: ledgerResult.rows[0],
    };
  } catch (error) {
    if (ownClient) await dbClient.query('ROLLBACK');
    throw error;
  } finally {
    if (ownClient && dbClient) dbClient.release();
  }
};

// ─── Deduct balance — wrapper for AePS and other modules ────────
const deductBalance = async (userId, amount, description, client = null) => {
  const referenceId = `AEP-${Date.now()}`;
  return deductMoney(userId, amount, description, referenceId, client);
};

// ─── ✅ NEW: Deduct fee for beneficiary registration ─────────────
const deductBeneficiaryFee = async (userId, amount, beneficiaryName, client = null) => {
  const description = `Beneficiary registration fee for ${beneficiaryName}`;
  const referenceId = `BENEFEE-${Date.now()}`;
  return deductMoney(userId, amount, description, referenceId, client);
};

// ─── ✅ NEW: Check if user has sufficient balance ────────────────
const hasSufficientBalance = async (userId, amount) => {
  try {
    const balance = await getBalance(userId);
    return balance >= amount;
  } catch (error) {
    throw error;
  }
};

// ─── Get transaction history (main wallet) ───────────────────────
const getTransactionHistory = async (userId, limit = 50, offset = 0) => {
  try {
    const wallet = await getWalletByUserId(userId);
    if (!wallet) throw new Error('Wallet not found');

    const result = await pool.query(
      `SELECT * FROM wallet_ledger
       WHERE wallet_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [wallet.id, limit, offset]
    );
    return result.rows;
  } catch (error) {
    throw error;
  }
};

// ─── Admin: Get all main wallets with user details ───────────────
const getAllWallets = async (limit = 50, offset = 0) => {
  try {
    const result = await pool.query(
      `SELECT
         w.*,
         u.first_name, u.last_name, u.email, u.phone, u.business_name
       FROM wallets w
       JOIN users u ON w.user_id = u.id
       ORDER BY w.balance DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const countResult = await pool.query('SELECT COUNT(*) FROM wallets');
    return {
      wallets: result.rows,
      total:   parseInt(countResult.rows[0].count),
    };
  } catch (error) {
    throw error;
  }
};

// ─── Get main wallet statistics for admin ────────────────────────
const getWalletStats = async () => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)                                    AS total_wallets,
        SUM(balance)                                AS total_balance,
        AVG(balance)                                AS average_balance,
        COUNT(CASE WHEN balance > 0 THEN 1 END)     AS active_wallets,
        COUNT(CASE WHEN balance = 0 THEN 1 END)     AS zero_balance_wallets
      FROM wallets
    `);
    return {
      totalWallets:       parseInt(result.rows[0].total_wallets),
      totalBalance:       parseFloat(result.rows[0].total_balance    || 0),
      averageBalance:     parseFloat(result.rows[0].average_balance  || 0),
      activeWallets:      parseInt(result.rows[0].active_wallets     || 0),
      zeroBalanceWallets: parseInt(result.rows[0].zero_balance_wallets || 0),
    };
  } catch (error) {
    throw error;
  }
};

module.exports = {
  getWalletByUserId,
  getBalance,
  addMoney,
  deductMoney,
  deductBalance,
  deductBeneficiaryFee,      // ✅ NEW
  hasSufficientBalance,      // ✅ NEW
  getTransactionHistory,
  getAllWallets,
  getWalletStats,
};