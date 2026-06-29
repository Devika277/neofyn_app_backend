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

// ─── Get AEPS wallet by user ID ──────────────────────────────────
const getAepsWalletByUserId = async (userId) => {
  try {
    const result = await pool.query(
      'SELECT * FROM aeps_wallets WHERE user_id = $1',
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

// ─── Get AEPS wallet balance ─────────────────────────────────────
const getAepsBalance = async (userId) => {
  try {
    const result = await pool.query(
      'SELECT balance FROM aeps_wallets WHERE user_id = $1',
      [userId]
    );
    if (result.rows.length === 0) return 0;
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

// ─── ✅ NEW: Transfer from AEPS wallet to Main wallet ────────────
const transferAepsToMain = async (userId, amount, description = 'AEPS to Main transfer', client = null) => {
  let ownClient = false;
  let dbClient  = client;

  if (!dbClient) {
    dbClient  = await pool.connect();
    ownClient = true;
  }

  try {
    if (ownClient) await dbClient.query('BEGIN');

    // 1. Check AEPS wallet
    const aepsWalletResult = await dbClient.query(
      'SELECT * FROM aeps_wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    
    if (aepsWalletResult.rows.length === 0) {
      throw new Error('AEPS wallet not found for this user');
    }

    const aepsWallet = aepsWalletResult.rows[0];
    const aepsBalance = parseFloat(aepsWallet.balance);
    const amountNum = parseFloat(amount);

    if (aepsBalance < amountNum) {
      throw new Error(`Insufficient AEPS balance. Available: ₹${aepsBalance.toFixed(2)}`);
    }

    // 2. Check Main wallet
    const mainWalletResult = await dbClient.query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    
    if (mainWalletResult.rows.length === 0) {
      throw new Error('Main wallet not found for this user');
    }

    const mainWallet = mainWalletResult.rows[0];
    const mainBalance = parseFloat(mainWallet.balance);
    const newMainBalance = mainBalance + amountNum;
    const newAepsBalance = aepsBalance - amountNum;

    // 3. Update AEPS wallet (decrease)
    await dbClient.query(
      'UPDATE aeps_wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
      [newAepsBalance, userId]
    );

    // 4. Update Main wallet (increase)
    await dbClient.query(
      'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
      [newMainBalance, userId]
    );

    // 5. Log in AEPS ledger (debit)
    await dbClient.query(
      `INSERT INTO aeps_wallet_ledger
         (aeps_wallet_id, transaction_type, amount, balance_after, description, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [aepsWallet.id, 'debit', amountNum, newAepsBalance, 
       `Transferred to main wallet: ${description}`, `AEP2MAIN_${Date.now()}`]
    );

    // 6. Log in main wallet ledger (credit)
    await dbClient.query(
      `INSERT INTO wallet_ledger
         (wallet_id, transaction_type, amount, balance_after, description, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [mainWallet.id, 'credit', amountNum, newMainBalance, 
       `Transferred from AEPS wallet: ${description}`, `AEP2MAIN_${Date.now()}`]
    );

    if (ownClient) await dbClient.query('COMMIT');

    return {
      success: true,
      message: `Successfully transferred ₹${amountNum.toFixed(2)} from AEPS to Main wallet`,
      data: {
        aeps_balance: newAepsBalance,
        main_balance: newMainBalance,
        transferred_amount: amountNum
      }
    };
  } catch (error) {
    if (ownClient) await dbClient.query('ROLLBACK');
    throw error;
  } finally {
    if (ownClient && dbClient) dbClient.release();
  }
};

// ─── ✅ NEW: Get AEPS wallet balance ─────────────────────────────
const getAepsWalletBalance = async (userId) => {
  try {
    const result = await dbClient.query(
      'SELECT balance FROM aeps_wallets WHERE user_id = $1',
      [userId]
    );
    if (result.rows.length === 0) {
      // Create AEPS wallet if it doesn't exist
      const newWallet = await dbClient.query(
        `INSERT INTO aeps_wallets (user_id, balance, status, created_at, updated_at) 
         VALUES ($1, $2, 'active', NOW(), NOW()) 
         RETURNING balance`,
        [userId, 0]
      );
      return parseFloat(newWallet.rows[0].balance);
    }
    return parseFloat(result.rows[0].balance);
  } catch (error) {
    throw error;
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
  getAepsWalletByUserId,
  getBalance,
  getAepsBalance,
  addMoney,
  deductMoney,
  deductBalance,
  deductBeneficiaryFee,
  hasSufficientBalance,
  getTransactionHistory,
  getAllWallets,
  getWalletStats,
  transferAepsToMain,           // ✅ NEW
  getAepsWalletBalance,         // ✅ NEW
};