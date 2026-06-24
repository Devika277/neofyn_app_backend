/**
 * Payout Service (AEPS wallet → own bank account)
 * 
 * Handles:
 * - Getting agent's own bank account (from agent_bank_accounts table)
 * - Checking AEPS balance (from aeps_wallets)
 * - Daily/monthly limit checks
 * - TPIN validation
 * - Deducting AEPS wallet, logging ledger
 * - Creating payout_transaction
 * - Calling provider
 * - Handling success/failure/queued (refund on failure)
 * - Upserting the agent's bank account (create/update)
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../../config/db');
const { getPayoutProvider } = require('../../providers/payoutProviderRouter');
// const { validateTpin } = require('../../utils/mpinHelper');
const commissionEngine = require('../Commission/commissionEngine');
const { validateTpin } = require('../../utils/tpinHelper');


/**
 * Get agent's own bank account details (read-only for Payout)
 * @param {number} userId 
 * @returns {Promise<Object|null>} { account_name, account_number, ifsc_code, bank_name, mobile_number, state_code, vimopay_bank_code }
 */
// async function getMyBankAccount(userId) {
//   try {
//     const query = `
//       SELECT 
//         account_name,
//         account_number,
//         ifsc_code,
//         bank_name,
//         mobile_number,
//         state_code,
//         vimopay_bank_code
//       FROM agent_bank_accounts
//       WHERE user_id = $1 AND is_primary = true AND is_active = true
//     `;
//     const result = await db.query(query, [userId]);
//     if (result.rows.length === 0) return null;
//     return result.rows[0];
//   } catch (error) {
//     console.error('getMyBankAccount error:', error.message);
//     return null;
//   }
// }




/**
 * Get payout charge based on amount slab and user role
 * @param {number} amount - transaction amount
 * @param {string} role - user role (retailer, distributor, master_distributor)
 * @returns {Promise<number>} - charge amount to deduct
 */
async function getPayoutCharge(amount, role) {
  try {
    const normalizedRole = (role || 'retailer').toLowerCase();
    
    // Query the commission_rates table for payout charges
    const query = `
      SELECT rate_value, rate_type
      FROM commission_rates
      WHERE service_type = 'payout'
        AND role = $1
        AND is_active = TRUE
        AND $2::numeric >= min_amount
        AND ($3::numeric IS NULL OR $2::numeric <= max_amount)
      ORDER BY min_amount ASC
      LIMIT 1
    `;
    
    const result = await db.query(query, [normalizedRole, amount, amount]);
    
    if (result.rows.length === 0) {
      console.log(`[Payout Charge] No charge found for role: ${normalizedRole}, amount: ${amount}`);
      return 0;
    }
    
    const charge = parseFloat(result.rows[0].rate_value);
    console.log(`[Payout Charge] Charge for ${normalizedRole} on ₹${amount}: ₹${charge}`);
    return charge;
    
  } catch (error) {
    console.error('[Payout Charge] Error:', error.message);
    return 0;
  }
}


// services/payout/payoutService.js

async function getMyBankAccount(userId) {
  try {
    const query = `
      SELECT 
        account_name,
        account_number,
        ifsc_code,
        bank_name,
        mobile_number,
        state_code,
        vimopay_bank_code
      FROM agent_bank_accounts
      WHERE user_id = $1 AND is_primary = true AND is_active = true
    `;
    const result = await db.query(query, [userId]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  } catch (error) {
    console.error('getMyBankAccount error:', error.message);
    return null;
  }
}

/**
 * Save or update the agent's bank account details.
 * This will replace any existing primary account for the user.
 * @param {number} userId 
 * @param {object} data - { account_name, account_number, ifsc_code, bank_name, mobile_number, state_code, vimopay_bank_code }
 * @returns {Promise<object>} the saved bank account record
 */
async function upsertBankAccount(userId, data) {
  const { account_name, account_number, ifsc_code, bank_name, mobile_number, state_code, vimopay_bank_code, accountId } = data;

  if (!account_number || !ifsc_code) throw new Error('Account number and IFSC are required');

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // If accountId provided, UPDATE existing account
    if (accountId) {
      const check = await client.query(
        'SELECT id FROM agent_bank_accounts WHERE id = $1 AND user_id = $2 AND is_active = true',
        [accountId, userId]
      );
      if (check.rows.length === 0) throw new Error('Account not found');

      const result = await client.query(
        `UPDATE agent_bank_accounts SET account_name=$1, account_number=$2, ifsc_code=$3, bank_name=$4, mobile_number=$5, state_code=$6, vimopay_bank_code=$7, updated_at=NOW() WHERE id=$8 AND user_id=$9 RETURNING *`,
        [account_name||null, account_number, ifsc_code, bank_name||null, mobile_number||null, state_code||null, vimopay_bank_code||null, accountId, userId]
      );
      await client.query('COMMIT');
      return result.rows[0];
    }

    // Otherwise INSERT new account (does NOT delete existing)
    const countResult = await client.query(
      'SELECT COUNT(*) FROM agent_bank_accounts WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    const isFirst = parseInt(countResult.rows[0].count) === 0;

    const result = await client.query(
      `INSERT INTO agent_bank_accounts (user_id, account_name, account_number, ifsc_code, bank_name, mobile_number, state_code, vimopay_bank_code, is_primary, is_active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW(),NOW()) RETURNING *`,
      [userId, account_name||null, account_number, ifsc_code, bank_name||null, mobile_number||null, state_code||null, vimopay_bank_code||null, isFirst]
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error('Failed to save bank account');
  } finally {
    client.release();
  }
}
/**
 * Get all active bank accounts for the agent
 */
async function getAllBankAccounts(userId) {
  try {
    const query = `
      SELECT id, account_name, account_number, ifsc_code, bank_name, 
             mobile_number, state_code, vimopay_bank_code, is_primary, is_active, created_at, updated_at
      FROM agent_bank_accounts
      WHERE user_id = $1 AND is_active = true
      ORDER BY is_primary DESC, created_at ASC
    `;
    const result = await db.query(query, [userId]);
    return result.rows;
  } catch (error) {
    console.error('getAllBankAccounts error:', error.message);
    return [];
  }
}

/**
 * Get a specific bank account by ID
 */
async function getBankAccountById(userId, accountId) {
  try {
    const query = `
      SELECT id, account_name, account_number, ifsc_code, bank_name, 
             mobile_number, state_code, vimopay_bank_code, is_primary, is_active
      FROM agent_bank_accounts
      WHERE id = $1 AND user_id = $2 AND is_active = true
    `;
    const result = await db.query(query, [accountId, userId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('getBankAccountById error:', error.message);
    return null;
  }
}

/**
 * Set a specific account as primary
 */
async function setDefaultBankAccount(userId, accountId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    
    const check = await client.query(
      'SELECT id FROM agent_bank_accounts WHERE id = $1 AND user_id = $2 AND is_active = true',
      [accountId, userId]
    );
    if (check.rows.length === 0) throw new Error('Account not found');
    
    // Unset all primary for this user
    await client.query('UPDATE agent_bank_accounts SET is_primary = false, updated_at = NOW() WHERE user_id = $1', [userId]);
    
    // Set selected as primary
    const result = await client.query(
      'UPDATE agent_bank_accounts SET is_primary = true, updated_at = NOW() WHERE id = $1 RETURNING *',
      [accountId]
    );
    
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Soft delete a bank account
 */
async function deleteBankAccount(userId, accountId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    
    const check = await client.query(
      'SELECT id, is_primary FROM agent_bank_accounts WHERE id = $1 AND user_id = $2 AND is_active = true',
      [accountId, userId]
    );
    if (check.rows.length === 0) { await client.query('ROLLBACK'); return false; }
    
    const countResult = await client.query(
      'SELECT COUNT(*) FROM agent_bank_accounts WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (parseInt(countResult.rows[0].count) <= 1) throw new Error('Cannot delete last account');
    
    await client.query('UPDATE agent_bank_accounts SET is_active = false, updated_at = NOW() WHERE id = $1', [accountId]);
    
    if (check.rows[0].is_primary) {
      const oldest = await client.query(
        'SELECT id FROM agent_bank_accounts WHERE user_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1',
        [userId]
      );
      if (oldest.rows.length > 0) {
        await client.query('UPDATE agent_bank_accounts SET is_primary = true WHERE id = $1', [oldest.rows[0].id]);
      }
    }
    
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
/**
 * Get AEPS wallet balance from aeps_wallets table
 * @param {number} userId 
 * @returns {Promise<number>}
 */
async function getAepsBalance(userId) {
  const query = `SELECT balance FROM aeps_wallets WHERE user_id = $1`;
  const result = await db.query(query, [userId]);
  if (result.rows.length === 0) return 0;
  return parseFloat(result.rows[0].balance);
}

/**
 * Get daily and monthly usage for Payout
 * @param {number} userId 
 * @returns {Promise<{ dailyUsed: number, dailyLimit: number, monthlyUsed: number, monthlyLimit: number }>}
 */
async function getPayoutLimits(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

  const dailyQuery = `
    SELECT payout_daily_used FROM payout_daily_limits 
    WHERE user_id = $1 AND date = $2
  `;
  let dailyResult = await db.query(dailyQuery, [userId, today]);
  const dailyUsed = dailyResult.rows.length > 0 ? parseFloat(dailyResult.rows[0].payout_daily_used) : 0;

  const monthlyQuery = `
    SELECT COALESCE(SUM(amount), 0) as total 
    FROM payout_transactions 
    WHERE user_id = $1 AND wallet_source = 'aeps' 
      AND status = 'success' 
      AND created_at >= $2
  `;
  const monthlyResult = await db.query(monthlyQuery, [userId, startOfMonth]);
  const monthlyUsed = parseFloat(monthlyResult.rows[0].total);

  const dailyLimit = 100000;   // ₹1,00,000
  const monthlyLimit = 1000000; // ₹10,00,000

  return { dailyUsed, dailyLimit, monthlyUsed, monthlyLimit };
}

/**
 * Process a Payout transfer (AEPS wallet → own bank)
 * @param {number} userId 
 * @param {Object} data - { amount, mode, tpin, ip_address, fee?, remarks? }
 * @returns {Promise<Object>} { success, transactionId, amount, providerRefId?, bankRefNo?, message? }
 */
async function processPayout(userId, data) {
  const { amount, mode, tpin, ip_address, remarks, fee = 0 } = data;

  if (!amount || amount <= 0) throw new Error('Invalid amount');
  if (amount < 100) throw new Error('Minimum payout amount is ₹100');
  if (amount > 50000) throw new Error('Maximum per transaction is ₹50,000');
  if (!['IMPS', 'NEFT'].includes(mode)) throw new Error('Invalid transfer mode');

  const isTpinValid = await validateTpin(userId, tpin);
  if (!isTpinValid) throw new Error('Invalid TPIN');

  const myBank = await getMyBankAccount(userId);
  if (!myBank) throw new Error('No bank account found. Please add a bank account in profile.');

  const aepsBalance = await getAepsBalance(userId);
  if (aepsBalance < amount) throw new Error(`Insufficient AEPS balance. Available: ₹${aepsBalance}`);

  // ✅ Get user role for charge calculation
  const userResult = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
  const userRole = userResult.rows[0]?.role || 'retailer';

  // ✅ Calculate payout charge based on amount slab and role
  const payoutCharge = await getPayoutCharge(amount, userRole);
  const totalDeduction = amount + payoutCharge;

  // ✅ Check if user has enough balance including charge
  if (aepsBalance < totalDeduction) {
    throw new Error(`Insufficient AEPS balance. Required: ₹${totalDeduction} (₹${amount} + ₹${payoutCharge} charge)`);
  }

  console.log(`[Payout] Amount: ₹${amount}, Charge: ₹${payoutCharge}, Total Deduction: ₹${totalDeduction}`);

  const { dailyUsed, dailyLimit, monthlyUsed, monthlyLimit } = await getPayoutLimits(userId);
  if (dailyUsed + totalDeduction > dailyLimit) {
    throw new Error(`Daily limit exceeded. Used: ₹${dailyUsed}, Limit: ₹${dailyLimit}`);
  }
  if (monthlyUsed + totalDeduction > monthlyLimit) {
    throw new Error(`Monthly limit exceeded. Used: ₹${monthlyUsed}, Limit: ₹${monthlyLimit}`);
  }

  const merchantRefId = Date.now().toString() + Math.floor(Math.random() * 10000);
  const transactionRef = `PAY_${uuidv4().replace(/-/g, '').slice(0, 24)}`;

  const client = await db.connect();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');

    // ✅ Deduct amount + charge from aeps_wallets
    const updateWalletQuery = `
      UPDATE aeps_wallets 
      SET balance = balance - $1, updated_at = NOW() 
      WHERE user_id = $2 AND balance >= $1
      RETURNING balance
    `;
    const walletUpdate = await client.query(updateWalletQuery, [totalDeduction, userId]);
    
    if (walletUpdate.rows.length === 0) {
      throw new Error('Failed to deduct wallet (insufficient balance or concurrent update)');
    }
    const newBalance = parseFloat(walletUpdate.rows[0].balance);

    // ✅ Insert ledger entry for payout withdrawal
    const ledgerQuery = `
      INSERT INTO aeps_wallet_ledger (aeps_wallet_id, transaction_type, amount, balance_after, description, created_at)
      SELECT id, 'payout_withdrawal', $1, $2, $3, NOW()
      FROM aeps_wallets WHERE user_id = $4
    `;
    await client.query(ledgerQuery, [amount, newBalance, `Payout to own bank via ${mode}`, userId]);

    // ✅ Insert ledger entry for payout charge
    if (payoutCharge > 0) {
      await client.query(ledgerQuery, [
        payoutCharge, 
        newBalance, 
        `Payout charge (${userRole}) for ₹${amount} transaction`, 
        userId
      ]);
    }

    // Insert transaction record
    const txnQuery = `
      INSERT INTO payout_transactions (
        user_id, wallet_source, transfer_mode, amount, merchant_ref_id,
        bene_account_name, bene_account_number, bene_ifsc, status, ip_address, provider, 
        payout_charge, total_deduction, created_at, updated_at
      ) VALUES ($1, 'aeps', $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11, NOW(), NOW())
      RETURNING id
    `;
    const txnValues = [
      userId, mode, amount, merchantRefId,
      myBank.account_name, myBank.account_number, myBank.ifsc_code,
      ip_address,
      process.env.PAYOUT_PROVIDER || 'mock',
      payoutCharge,
      totalDeduction
    ];
    const txnResult = await client.query(txnQuery, txnValues);
    const transactionId = txnResult.rows[0].id;

    // Update daily limit usage
    const today = new Date().toISOString().slice(0, 10);
    const upsertLimitQuery = `
      INSERT INTO payout_daily_limits (user_id, date, payout_daily_used, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, date) DO UPDATE
      SET payout_daily_used = payout_daily_limits.payout_daily_used + EXCLUDED.payout_daily_used
    `;
    await client.query(upsertLimitQuery, [userId, today, totalDeduction]);

    // Call provider
    const provider = getPayoutProvider();
    let providerResponse;
    try {
      providerResponse = await provider.transfer({
        merchantRefId,
        amount,
        mode,
        accountDetails: {
          accountName: myBank.account_name,
          accountNumber: myBank.account_number,
          ifsc: myBank.ifsc_code,
          mobileNumber: myBank.mobile_number || '9999999999',
          stateCode: myBank.state_code || 'MH',
          bankCode: myBank.vimopay_bank_code || '001',
          lat: data.lat || '0.0',
          long: data.long || '0.0'
        }
      });
    } catch (err) {
      throw new Error(`Provider error: ${err.message}`);
    }

    const responseTimeMs = Date.now() - startTime;
    const isSuccess = providerResponse.status === '000';
    const isQueued = providerResponse.status === '004';
    const finalStatus = isSuccess ? 'success' : (isQueued ? 'pending' : 'failed');

    if (isSuccess) {
      await client.query(`
        UPDATE payout_transactions 
        SET status = 'success', provider_ref_id = $1, bank_ref_no = $2, raw_response = $3, updated_at = NOW()
        WHERE id = $4
      `, [providerResponse.providerRefId, providerResponse.bankRefNo, JSON.stringify(providerResponse), transactionId]);

      await client.query('COMMIT');

      // ✅ Update final balance after all deductions
      const finalBalance = await getAepsBalance(userId);
      console.log(`💰 Final AEPS balance after payout: ${finalBalance}`);

      return {
        success: true,
        transactionId,
        merchantRefId: merchantRefId,
        amount: parseFloat(amount),
        payoutCharge: payoutCharge,
        totalDeduction: totalDeduction,
        newBalance: finalBalance,
        providerRefId: providerResponse.providerRefId,
        bankRefNo: providerResponse.bankRefNo,
        message: 'Payout successful'
      };

    } else if (isQueued) {
      await client.query(`
        UPDATE payout_transactions
        SET status = 'pending', provider_ref_id = $1, raw_response = $2, updated_at = NOW()
        WHERE id = $3
      `, [providerResponse.providerRefId, JSON.stringify(providerResponse), transactionId]);

      await client.query('COMMIT');

      return {
        success: true,
        transactionId,
        amount: parseFloat(amount),
        payoutCharge: payoutCharge,
        totalDeduction: totalDeduction,
        providerRefId: providerResponse.providerRefId,
        message: 'Transfer submitted. Final status will be updated shortly.'
      };

    } else {
      // Provider failure: refund amount + charge
      await client.query(`
        UPDATE aeps_wallets 
        SET balance = balance + $1, updated_at = NOW()
        WHERE user_id = $2
      `, [totalDeduction, userId]);

      await client.query(`
        INSERT INTO aeps_wallet_ledger (aeps_wallet_id, transaction_type, amount, balance_after, description, created_at)
        SELECT id, 'payout_refund', $1, (balance + $1), $2, NOW()
        FROM aeps_wallets WHERE user_id = $3
      `, [totalDeduction, `Refund for failed payout (₹${amount} + ₹${payoutCharge} charge)`, userId]);

      await client.query(`
        UPDATE payout_transactions 
        SET status = 'failed', failure_reason = $1, raw_response = $2, updated_at = NOW()
        WHERE id = $3
      `, [providerResponse.message, JSON.stringify(providerResponse), transactionId]);

      await client.query(`
        UPDATE payout_daily_limits 
        SET payout_daily_used = payout_daily_used - $1
        WHERE user_id = $2 AND date = $3
      `, [totalDeduction, userId, today]);

      await client.query('COMMIT');

      return {
        success: false,
        transactionId,
        amount: parseFloat(amount),
        payoutCharge: payoutCharge,
        totalDeduction: totalDeduction,
        message: `Payout failed: ${providerResponse.message}`
      };
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('processPayout error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getMyBankAccount,
  getAllBankAccounts,
  getBankAccountById,
  setDefaultBankAccount,
  upsertBankAccount,
  deleteBankAccount,
  getAepsBalance,
  getPayoutLimits,
  getPayoutCharge,
  processPayout
};