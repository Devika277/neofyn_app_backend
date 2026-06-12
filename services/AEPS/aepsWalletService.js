// backend/services/aepsWalletService.js
const pool = require('../config/db');

/**
 * Get AePS wallet by user ID
 */
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

/**
 * Get AePS wallet balance for a user
 */
const getAepsBalance = async (userId) => {
  try {
    const result = await pool.query(
      'SELECT balance FROM aeps_wallets WHERE user_id = $1',
      [userId]
    );
    if (result.rows.length === 0) {
      throw new Error('AePS wallet not found');
    }
    return parseFloat(result.rows[0].balance);
  } catch (error) {
    throw error;
  }
};

/**
 * Credit AePS wallet (used for fund load or settlement)
 * @param {string} userId - User ID
 * @param {number} amount - Amount to credit
 * @param {string} description - Description for ledger
 * @param {string} referenceId - Optional reference ID
 * @param {number|null} performedBy - Admin ID if done by admin, else null
 * @param {object} client - Optional DB client for transactions
 * @param {string} transactionType - Ledger transaction type (default 'fund_load')
 */
const creditAepsWallet = async (userId, amount, description, referenceId = null, performedBy = null, client = null, transactionType = 'fund_load') => {
  const dbClient = client || pool;
  const isExternalClient = !!client;

  try {
    if (!isExternalClient) {
      await dbClient.query('BEGIN');
    }

    const walletResult = await dbClient.query(
      'SELECT * FROM aeps_wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (walletResult.rows.length === 0) {
      throw new Error('AePS wallet not found');
    }

    const wallet = walletResult.rows[0];
    const newBalance = parseFloat(wallet.balance) + parseFloat(amount);

    await dbClient.query(
      'UPDATE aeps_wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
      [newBalance, userId]
    );

    const ledgerResult = await dbClient.query(
      `INSERT INTO aeps_wallet_ledger 
         (aeps_wallet_id, transaction_type, amount, balance_after, description, reference_id, performed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [wallet.id, transactionType, amount, newBalance, description, referenceId, performedBy]
    );

    if (!isExternalClient) {
      await dbClient.query('COMMIT');
    }

    return {
      success: true,
      newBalance,
      transaction: ledgerResult.rows[0]
    };
  } catch (error) {
    if (!isExternalClient) {
      await dbClient.query('ROLLBACK');
    }
    throw error;
  } finally {
    if (!isExternalClient && dbClient !== pool) {
      dbClient.release();
    }
  }
};

/**
 * Debit AePS wallet (used only for move_to_main)
 */
const debitAepsWallet = async (userId, amount, description, referenceId = null, client = null) => {
  const dbClient = client || pool;
  const isExternalClient = !!client;

  try {
    if (!isExternalClient) {
      await dbClient.query('BEGIN');
    }

    const walletResult = await dbClient.query(
      'SELECT * FROM aeps_wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (walletResult.rows.length === 0) {
      throw new Error('AePS wallet not found');
    }

    const wallet = walletResult.rows[0];
    const currentBalance = parseFloat(wallet.balance);
    const amountNum = parseFloat(amount);

    if (currentBalance < amountNum) {
      throw new Error('Insufficient AePS balance');
    }

    const newBalance = currentBalance - amountNum;

    await dbClient.query(
      'UPDATE aeps_wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
      [newBalance, userId]
    );

    const ledgerResult = await dbClient.query(
      `INSERT INTO aeps_wallet_ledger 
         (aeps_wallet_id, transaction_type, amount, balance_after, description, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [wallet.id, 'move_to_main', amountNum, newBalance, description, referenceId]
    );

    if (!isExternalClient) {
      await dbClient.query('COMMIT');
    }

    return {
      success: true,
      newBalance,
      transaction: ledgerResult.rows[0]
    };
  } catch (error) {
    if (!isExternalClient) {
      await dbClient.query('ROLLBACK');
    }
    throw error;
  } finally {
    if (!isExternalClient && dbClient !== pool) {
      dbClient.release();
    }
  }
};

/**
 * Move funds from AePS wallet to main wallet (agent self‑service)
 */
const moveToMain = async (userId, amount) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get AePS wallet with lock
    const aepsWalletResult = await client.query(
      'SELECT id, balance FROM aeps_wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (aepsWalletResult.rows.length === 0) {
      throw new Error('AePS wallet not found');
    }
    const aepsWallet = aepsWalletResult.rows[0];
    const currentAepsBalance = parseFloat(aepsWallet.balance);
    const amountNum = parseFloat(amount);
    if (currentAepsBalance < amountNum) {
      throw new Error('Insufficient AePS balance');
    }

    const newAepsBalance = currentAepsBalance - amountNum;

    // 2. Update AePS wallet
    await client.query(
      'UPDATE aeps_wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
      [newAepsBalance, userId]
    );

    // 3. Record in AePS ledger (debit)
    await client.query(
      `INSERT INTO aeps_wallet_ledger 
         (aeps_wallet_id, transaction_type, amount, balance_after, description)
       VALUES ($1, $2, $3, $4, $5)`,
      [aepsWallet.id, 'move_to_main', amountNum, newAepsBalance, `Moved to main wallet`]
    );

    // 4. Get main wallet ID and credit main wallet
    const mainWalletResult = await client.query(
      'SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (mainWalletResult.rows.length === 0) {
      throw new Error('Main wallet not found');
    }
    const mainWallet = mainWalletResult.rows[0];
    const newMainBalance = parseFloat(mainWallet.balance) + amountNum;

    await client.query(
      'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
      [newMainBalance, userId]
    );

    // 5. Record in main wallet ledger
    await client.query(
      `INSERT INTO wallet_ledger 
         (wallet_id, transaction_type, amount, balance_after, description)
       VALUES ($1, $2, $3, $4, $5)`,
      [mainWallet.id, 'credit', amountNum, newMainBalance, 'Credit from AePS wallet']
    );

    // 6. Log the move in aeps_fund_requests (as completed)
    await client.query(
      `INSERT INTO aeps_fund_requests (user_id, amount, status, payment_mode)
       VALUES ($1, $2, 'completed', 'move_to_main')`,
      [userId, amountNum]
    );

    await client.query('COMMIT');

    return {
      success: true,
      aepsBalance: newAepsBalance,
      mainBalance: newMainBalance
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('moveToMain error:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get AePS wallet ledger (transaction history)
 */
const getAepsLedger = async (userId, limit = 50, offset = 0) => {
  try {
    const wallet = await getAepsWalletByUserId(userId);
    if (!wallet) {
      throw new Error('AePS wallet not found');
    }
    const result = await pool.query(
      `SELECT * FROM aeps_wallet_ledger 
       WHERE aeps_wallet_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [wallet.id, limit, offset]
    );
    return result.rows;
  } catch (error) {
    throw error;
  }
};

/**
 * Admin: Get all AePS wallets with user details (read only)
 */
const getAllAepsWallets = async (limit = 50, offset = 0) => {
  try {
    const result = await pool.query(
      `SELECT 
         w.*,
         u.first_name,
         u.last_name,
         u.email,
         u.phone,
         u.business_name
       FROM aeps_wallets w
       JOIN users u ON w.user_id = u.id
       ORDER BY w.balance DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const countResult = await pool.query('SELECT COUNT(*) FROM aeps_wallets');
    return {
      wallets: result.rows,
      total: parseInt(countResult.rows[0].count)
    };
  } catch (error) {
    throw error;
  }
};

module.exports = {
  getAepsWalletByUserId,
  getAepsBalance,
  creditAepsWallet,
  debitAepsWallet,
  moveToMain,
  getAepsLedger,
  getAllAepsWallets
};