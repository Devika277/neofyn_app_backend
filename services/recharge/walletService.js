const pool = require('../../config/db');

// ============================================
// MAIN WALLET (stored in `wallets` table)
// ============================================

// ============================================
// Get wallet by user ID
// ============================================
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

// ============================================
// Get main wallet balance
// ============================================
const getBalance = async (userId) => {
  try {
    const result = await pool.query(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [userId]
    );
         return parseFloat(result.rows[0]?.balance || 0);
        } catch (error) {
            console.error('Error getting balance:', error);
        }
    };

// ============================================
// Add money to main wallet (Credit)
// ============================================
const addMoney = async (userId, amount, description, adminId = null, merchantRefId = null) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Update user's wallet balance (assuming 'wallets' table)
        const updateResult = await client.query(
            `UPDATE wallets SET balance = balance + $1, updated_at = NOW() 
             WHERE user_id = $2 RETURNING balance`,
            [amount, userId]
        );
        const newBalance = parseFloat(updateResult.rows[0]?.balance || 0);

        // 2. Insert a transaction record (using columns that exist in your table)
        await client.query(
            `INSERT INTO transactions 
             (user_id, amount, type, description, merchant_ref_id, created_at) 
             VALUES ($1, $2, 'credit', $3, $4, NOW())`,
            [userId, amount, description, merchantRefId || `CREDIT-${Date.now()}`]
        );

        await client.query('COMMIT');
        console.log(`✅ Added ₹${amount} to user ${userId}. New balance: ₹${newBalance}`);
        return { success: true, newBalance };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error adding money:', error);
        throw error;
    } finally {
        client.release();
    }
};


// ============================================
// Deduct money from main wallet (Debit)
// - referenceId: optional (e.g., "AEP-12345")
// - client: optional (reuse existing transaction client)
// ============================================
const deductMoney = async (userId, amount, description, referenceId = null, client = null) => {
  // If a client is passed in, we use it (external transaction)
  // If not, we use the pool directly (internal auto-commit)
  const dbClient = client || pool; 
  const isExternalClient = !!client;

  try {
    // Only start a transaction if we are NOT using an external client
    if (!isExternalClient) {
      await dbClient.query('BEGIN');
    }

    const walletResult = await dbClient.query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (walletResult.rows.length === 0) {
      throw new Error('Wallet not found');
    }

    const wallet = walletResult.rows[0];
    const currentBalance = parseFloat(wallet.balance);
    const amountNum = parseFloat(amount);

    if (currentBalance < amountNum) {
      throw new Error('Insufficient balance');
    }

    const newBalance = currentBalance - amountNum;

    await dbClient.query(
      'UPDATE wallets SET balance = $1 WHERE user_id = $2',
      [newBalance, userId]
    );

    const ledgerResult = await dbClient.query(
      `INSERT INTO wallet_ledger
         (wallet_id, transaction_type, amount, balance_after, description, reference_id) 
       VALUES($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [wallet.id, 'debit', amountNum, newBalance, description, referenceId || 'system']
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
    if (!isExternalClient && dbClient !== pool) {
      await dbClient.query('ROLLBACK');
    }
    throw error;
  }
};

// ============================================
// Deduct balance – wrapper for AePS and other modules
// ============================================
const deductBalance = async (userId, amount, description, client = null) => {
  const referenceId = `AEP-${Date.now()}`;
  return deductMoney(userId, amount, description, referenceId, client);
};

// ============================================
// Get transaction history (main wallet)
// ============================================
const getTransactionHistory = async (userId, limit = 50, offset = 0) => {
  try {
    const wallet = await getWalletByUserId(userId);
    if (!wallet) {
      return []; // ✅ No wallet yet — return empty array instead of crashing
    }
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

// ============================================
// Admin: Get all main wallets with user details
// ============================================
const getAllWallets = async (limit = 50, offset = 0) => {
  try {
    const result = await pool.query(
      `SELECT 
         w.*,
         u.first_name,
         u.last_name,
         u.email,
         u.phone,
         u.business_name
       FROM wallets w
       JOIN users u ON w.user_id = u.id
       ORDER BY w.balance DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    
    // Get total count
    const countResult = await pool.query('SELECT COUNT(*) FROM wallets');
    
    return {
      wallets: result.rows,
      total: parseInt(countResult.rows[0].count)
    };
  } catch (error) {
    throw error;
  }
};

// ============================================
// Get main wallet statistics for admin
// ============================================
const getWalletStats = async () => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_wallets,
        SUM(balance) as total_balance,
        AVG(balance) as average_balance,
        COUNT(CASE WHEN balance > 0 THEN 1 END) as active_wallets,
        COUNT(CASE WHEN balance = 0 THEN 1 END) as zero_balance_wallets
      FROM wallets
    `);
    
    return {
      totalWallets: parseInt(result.rows[0].total_wallets),
      totalBalance: parseFloat(result.rows[0].total_balance || 0),
      averageBalance: parseFloat(result.rows[0].average_balance || 0),
      activeWallets: parseInt(result.rows[0].active_wallets || 0),
      zeroBalanceWallets: parseInt(result.rows[0].zero_balance_wallets || 0)
    };
  } catch (error) {
    throw error;
  }
};

// ============================================
// Exports (only main wallet functions)
// ============================================
module.exports = {
  getWalletByUserId,
  getBalance,
  addMoney,
  deductMoney,
  deductBalance,
  getTransactionHistory,
  getAllWallets,
  getWalletStats
};