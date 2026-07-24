/**
 * Payout Controller (AEPS wallet → own bank)
 * 
 * Handles HTTP requests for:
 * - Getting agent's own bank account (primary)
 * - Getting all bank accounts
 * - Getting AEPS balance
 * - Getting daily/monthly limits
 * - Initiating a payout transfer (with optional bankAccountId)
 * - Getting transaction history
 * - Admin endpoints
 * - Saving/updating the agent's bank account (add/update/delete/set default)
 */

const payoutService = require('../services/payout/payoutService');
const db = require('../config/db');

/**
 * GET /api/payout/my-bank-account
 * Returns agent's primary bank account details (read-only)
 */
async function getMyBankAccount(req, res, next) {
  try {
    const userId = req.user.id;
    const bankAccount = await payoutService.getMyBankAccount(userId);
    if (!bankAccount) {
      return res.status(404).json({ error: 'No bank account found. Please add a bank account in profile.' });
    }
    res.json(bankAccount);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/payout/my-bank-accounts
 * Returns all active bank accounts for the agent (including primary)
 */
async function getMyBankAccounts(req, res, next) {
  try {
    const userId = req.user.id;
    const accounts = await payoutService.getAllBankAccounts(userId);
    res.json({ success: true, accounts });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/payout/bank-account
 * Add a new bank account (does NOT delete existing accounts)
 * Body: { account_name, account_number, ifsc_code, bank_name, mobile_number?, state_code?, vimopay_bank_code? }
 */
async function upsertBankAccount(req, res, next) {
  try {
    const userId = req.user.id;
    const { account_name, account_number, ifsc_code, bank_name, mobile_number, state_code, vimopay_bank_code, accountId } = req.body;

    if (!account_number || !ifsc_code) {
      return res.status(400).json({ error: 'Account number and IFSC are required' });
    }

    const result = await payoutService.upsertBankAccount(userId, {
      account_name,
      account_number,
      ifsc_code,
      bank_name,
      mobile_number,
      state_code,
      vimopay_bank_code,
      accountId, // optional: if provided, update that account; else insert new
    });

    res.json({ success: true, bankAccount: result });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/payout/bank-account/:id
 * Update an existing bank account (by ID)
 * Body: { account_name, account_number, ifsc_code, bank_name, mobile_number?, state_code?, vimopay_bank_code? }
 */
async function updateBankAccount(req, res, next) {
  try {
    const userId = req.user.id;
    const accountId = parseInt(req.params.id);
    const { account_name, account_number, ifsc_code, bank_name, mobile_number, state_code, vimopay_bank_code } = req.body;

    if (!account_number || !ifsc_code) {
      return res.status(400).json({ error: 'Account number and IFSC are required' });
    }

    const result = await payoutService.upsertBankAccount(userId, {
      account_name,
      account_number,
      ifsc_code,
      bank_name,
      mobile_number,
      state_code,
      vimopay_bank_code,
      accountId, // update this specific account
    });

    res.json({ success: true, bankAccount: result });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/payout/bank-account/:id
 * Soft-delete a bank account (set is_active = false)
 */
async function deleteBankAccount(req, res, next) {
  try {
    const userId = req.user.id;
    const accountId = parseInt(req.params.id);

    const deleted = await payoutService.deleteBankAccount(userId, accountId);
    if (!deleted) {
      return res.status(404).json({ error: 'Account not found or already inactive' });
    }
    res.json({ success: true, message: 'Bank account deleted successfully' });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/payout/bank-account/:id/default
 * Set a specific account as the primary (default) account
 */
async function setDefaultBankAccount(req, res, next) {
  try {
    const userId = req.user.id;
    const accountId = parseInt(req.params.id);

    const updated = await payoutService.setDefaultBankAccount(userId, accountId);
    res.json({ success: true, message: 'Default bank account updated', bankAccount: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/payout/balance
 * Returns AEPS wallet balance (from aeps_wallets table)
 */
async function getPayoutBalance(req, res, next) {
  try {
    const userId = req.user.id;
    const balance = await payoutService.getAepsBalance(userId);
    res.json({ balance });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/payout/limits
 * Returns daily/monthly usage and limits
 */
async function getPayoutLimits(req, res, next) {
  try {
    const userId = req.user.id;
    const limits = await payoutService.getPayoutLimits(userId);
    res.json(limits);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/payout/transfer
 * Process a payout transfer
 * Body: { amount, mode, tpin, remarks?, lat?, long?, bankAccountId? }
 */
async function createPayout(req, res, next) {
  try {
    const userId = req.user.id;
    const ip_address = req.ip || req.connection.remoteAddress;
    const { amount, mode, tpin, remarks, lat, long, bankAccountId } = req.body;

    if (!amount || !mode || !tpin) {
      return res.status(400).json({ error: 'Missing required fields: amount, mode, tpin' });
    }

    const result = await payoutService.processPayout(userId, {
      amount,
      mode,
      tpin,
      ip_address,
      remarks,
      lat,
      long,
      bankAccountId, // pass the selected account ID (optional)
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/payout/transactions
 * Get agent's own payout transaction history
 * Query: ?status=, from=, to=
 */
/**
 * GET /api/payout/transactions
 * Get agent's own payout transaction history
 * Query: ?status=, from=, to=
 */
async function getMyPayoutTransactions(req, res, next) {
  try {
    const userId = req.user.id;
    const { status, from, to } = req.query;

    // Validate date formats if provided
    if (from && isNaN(Date.parse(from))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid "from" date format. Please use ISO 8601 format (YYYY-MM-DD)'
      });
    }

    if (to && isNaN(Date.parse(to))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid "to" date format. Please use ISO 8601 format (YYYY-MM-DD)'
      });
    }

    // Validate status if provided
    const validStatuses = ['pending', 'processing', 'success', 'failed', 'cancelled'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Allowed values: ${validStatuses.join(', ')}`
      });
    }

    // Fetch user details (business_name and phone)
    const userResult = await db.query(
      'SELECT business_name, phone FROM users WHERE id = $1',
      [userId]
    );

    const userDetails = userResult.rows[0] || {};

    let query = `
      SELECT id, amount, payout_charge, total_deduction, transfer_mode, status, 
             merchant_ref_id, provider_ref_id,
             bank_ref_no, failure_reason, 
             bene_account_name, bene_account_number, bene_ifsc,
             created_at, updated_at,
             $1::text as business_name,
             $2::text as phone
      FROM payout_transactions
      WHERE user_id = $3 AND wallet_source = 'aeps'
    `;
    const params = [userDetails.business_name || null, userDetails.phone || null, userId];
    let paramIndex = 4;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    if (from) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(from);
      paramIndex++;
    }
    if (to) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(to);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC`;

    const result = await db.query(query, params);

    // Check if no transactions found
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No payout transactions found for the specified criteria'
      });
    }

    // Calculate summary statistics
    const totalAmount = result.rows.reduce((sum, row) => sum + parseFloat(row.amount), 0);
    const totalDeduction = result.rows.reduce((sum, row) => sum + parseFloat(row.total_deduction || 0), 0);
    const totalPayoutCharge = result.rows.reduce((sum, row) => sum + parseFloat(row.payout_charge || 0), 0);

    // Group by status for summary
    const statusSummary = result.rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: result.rows,
      user: {
        business_name: userDetails.business_name || null,
        phone: userDetails.phone || null
      },
      summary: {
        total_transactions: result.rows.length,
        total_amount: parseFloat(totalAmount.toFixed(2)),
        total_deduction: parseFloat(totalDeduction.toFixed(2)),
        total_payout_charge: parseFloat(totalPayoutCharge.toFixed(2)),
        status_breakdown: statusSummary
      },
      filters_applied: {
        status: status || null,
        from: from || null,
        to: to || null
      }
    });
  } catch (err) {
    console.error('Error fetching payout transactions:', err);
    
    // Handle specific database errors
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      return res.status(503).json({
        success: false,
        error: 'Database connection error. Please try again later.'
      });
    }

    next(err);
  }
}
/**
 * GET /api/payout/admin/transactions
 * Admin view - all agents' payout transactions
 * Query: ?user_id=, status=, from=, to=
 */
async function adminGetPayoutTransactions(req, res, next) {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { user_id, status, from, to } = req.query;
    
    let query = `
      SELECT 
        t.*, 
        CONCAT(u.first_name, ' ', u.last_name) as user_name,
        u.phone as user_mobile
      FROM payout_transactions t
      JOIN users u ON t.user_id = u.id
      WHERE t.wallet_source = 'aeps'
    `;
    
    const params = [];
    let paramIndex = 1;

    if (user_id) {
      query += ` AND t.user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }
    if (status) {
      query += ` AND t.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    if (from) {
      query += ` AND t.created_at >= $${paramIndex}`;
      params.push(from);
      paramIndex++;
    }
    if (to) {
      query += ` AND t.created_at <= $${paramIndex}`;
      params.push(to);
      paramIndex++;
    }

    query += ` ORDER BY t.created_at DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/payout/callback
 * VimoPay webhook for final transaction status updates
 */
/**
 * POST /api/payout/callback
 * VimoPay webhook for final transaction status updates
 */
async function payoutWebhook(req, res, next) {
  try {
    const body = req.body;
    console.log('📨 Webhook received:', JSON.stringify(body, null, 2));

    // ✅ Use correct field names
    const { 
      txnStatusCode, 
      txnId, 
      merchantRefId, 
      rrn, 
      responseMessage,
      beneficiaryName,
      beneficiaryAccountNumber,
      beneficiaryIFSC,
      charges
    } = body;

    // VimoPay posts plain JSON to callback (not encrypted)
    // const { txnStatusCode, txnId, merchantRefId, rrn, responseMessage } = body;

    if (!merchantRefId && !txnId) {
      return res.status(200).json({ successStatus: true, message: 'Success', responseCode: '000' });
    }

    const finalStatus = txnStatusCode === '000' ? 'success'
      : txnStatusCode === '001' ? 'failed' : 'pending';

    await db.query(`
      UPDATE payout_transactions
      SET status = $1,
          provider_ref_id = COALESCE(provider_ref_id, $2),
          bank_ref_no = $3,
          failure_reason = $4,
          raw_response = $5,
          updated_at = NOW()
      WHERE merchant_ref_id = $6 AND wallet_source = 'aeps'
    `, [
      finalStatus,
      txnId,
      rrn || null,
      finalStatus === 'failed' ? responseMessage : null,
      JSON.stringify(body),
      merchantRefId
    ]);

    // ✅ If failed, refund BOTH AEPS wallet AND Main wallet commission
    if (finalStatus === 'failed') {
      const txnQuery = await db.query(
        'SELECT user_id, amount, payout_charge FROM payout_transactions WHERE merchant_ref_id = $1',
        [merchantRefId]
      );

      if (txnQuery.rows.length > 0) {
        const { user_id, amount, payout_charge } = txnQuery.rows[0];
        const charge = parseFloat(payout_charge || 0);
        
        // ✅ Refund principal to AEPS wallet
        await db.query(
          'UPDATE aeps_wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2',
          [amount, user_id]
        );

        // Insert AEPS refund ledger entry
        await db.query(`
          INSERT INTO aeps_wallet_ledger (aeps_wallet_id, transaction_type, amount, balance_after, description, created_at)
          SELECT id, 'payout_refund', $1, balance, $2, NOW()
          FROM aeps_wallets WHERE user_id = $3
        `, [amount, `Refund for failed payout (callback): ${responseMessage || 'Provider failure'}`, user_id]);

        // ✅ Refund commission to Main wallet (if any)
        if (charge > 0) {
          const mainWallet = await db.query(
            'SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE',
            [user_id]
          );
          
          if (mainWallet.rows.length > 0) {
            const newMainBalance = parseFloat(mainWallet.rows[0].balance) + charge;
            
            await db.query(
              'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
              [newMainBalance, user_id]
            );

            await db.query(
              `INSERT INTO wallet_ledger (wallet_id, transaction_type, amount, balance_after, description, reference_id)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [mainWallet.rows[0].id, 'credit', charge, newMainBalance,
               `Refund for failed payout commission (callback): ${responseMessage || 'Provider failure'}`, 
               `CB_${merchantRefId}`]
            );
          }
        }
      }
    }

    // Always return HTTP 200 with successStatus to prevent VimoPay retries
    res.status(200).json({ successStatus: true, message: 'Success', responseCode: '000' });
  } catch (err) {
    console.error('payoutWebhook error:', err.message);
    // Still return 200 so VimoPay doesn't retry indefinitely
    res.status(200).json({ successStatus: true, message: 'Success', responseCode: '000' });
  }
}

module.exports = {
  getMyBankAccount,
  getMyBankAccounts,
  upsertBankAccount,
  updateBankAccount,
  deleteBankAccount,
  setDefaultBankAccount,
  getPayoutBalance,
  getPayoutLimits,
  createPayout,
  getMyPayoutTransactions,
  adminGetPayoutTransactions,
  payoutWebhook
};