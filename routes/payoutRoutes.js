const express = require('express');
const router = express.Router();
const payoutController = require('../controllers/payoutController');
const { protect } = require('../middleware/authMiddleware');
const { isAdmin } = require('../middleware/adminMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const axios = require('axios');
const { decrypt } = require('../utils/vimopayEncrypt');
const db = require('../config/db')

// ============================================================
// PUBLIC ROUTES (No authentication required)
// ============================================================

// Webhook (public – Vimopay posts directly)
router.post('/callback', payoutController.payoutWebhook);

// ============================================================
// PROTECTED ROUTES (Authentication required)
// ============================================================

// All routes below require authentication
router.use(protect);

// ============================================================
// MASTER DATA ROUTES (Dynamic lists from Vidual API)
// ============================================================

/**
 * GET /api/payout/banks
 * Get list of all banks from Vidual API (Production)
 */
router.get('/banks', async (req, res) => {
  try {
    console.log('[Banks API] Fetching bank list...');
    
    const authResponse = await axios.post(
      `${process.env.PAYOUT_BASE_URL}/payoutapi/api/Signature/Authorize`,
      {},
      {
        headers: {
          secretKey: process.env.PAYOUT_SECRET_KEY,
          saltKey: process.env.PAYOUT_SALT_KEY,
          encryptdecryptKey: process.env.PAYOUT_ENCRYPT_DECRYPT_KEY,
          userId: process.env.PAYOUT_USER_ID
        }
      }
    );
    
    const rawToken = authResponse.data.data;
    console.log('[Banks API] Got auth token');
    
    const bankResponse = await axios.get(
      `${process.env.PAYOUT_BASE_URL}/masterapi/api/master/banklist`,
      {
        headers: {
          Authorization: `Bearer ${rawToken}`,
          userId: process.env.PAYOUT_USER_ID
        }
      }
    );
    
    console.log('[Banks API] Bank API Response Code:', bankResponse.data.responseCode);
    
    const encryptedData = bankResponse.data.data;
    const decrypted = decrypt(encryptedData);
    const banks = JSON.parse(decrypted);
    
    console.log(`[Banks API] Successfully loaded ${banks.length} banks`);
    
    res.json({ success: true, banks });
    
  } catch (error) {
    console.error('[Banks API] Error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to fetch bank list' 
    });
  }
});

/**
 * GET /api/payout/states
 * Get list of all states from Vidual API (Production)
 */
router.get('/states', async (req, res) => {
  try {
    console.log('[States API] Fetching state list...');
    
    const authResponse = await axios.post(
      `${process.env.PAYOUT_BASE_URL}/payoutapi/api/Signature/Authorize`,
      {},
      {
        headers: {
          secretKey: process.env.PAYOUT_SECRET_KEY,
          saltKey: process.env.PAYOUT_SALT_KEY,
          encryptdecryptKey: process.env.PAYOUT_ENCRYPT_DECRYPT_KEY,
          userId: process.env.PAYOUT_USER_ID
        }
      }
    );
    
    const rawToken = authResponse.data.data;
    console.log('[States API] Got auth token');
    
    const stateResponse = await axios.get(
      `${process.env.PAYOUT_BASE_URL}/masterapi/api/master/statelist`,
      {
        headers: {
          Authorization: `Bearer ${rawToken}`,
          userId: process.env.PAYOUT_USER_ID
        }
      }
    );
    
    console.log('[States API] State API Response Code:', stateResponse.data.responseCode);
    
    const encryptedData = stateResponse.data.data;
    const decrypted = decrypt(encryptedData);
    const states = JSON.parse(decrypted);
    
    console.log(`[States API] Successfully loaded ${states.length} states`);
    
    res.json({ success: true, states });
    
  } catch (error) {
    console.error('[States API] Error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to fetch state list' 
    });
  }
});

// ============================================================
// AGENT BANK ACCOUNT ROUTES
// ============================================================

/**
 * GET /api/payout/my-bank-account
 * Get agent's primary bank account details
 */
router.get('/my-bank-account', payoutController.getMyBankAccount);

/**
 * GET /api/payout/my-bank-accounts
 * Get all active bank accounts for the agent
 */
router.get('/my-bank-accounts', payoutController.getMyBankAccounts);

/**
 * POST /api/payout/bank-account
 * Add a new bank account (does not delete existing)
 * Body: { account_name, account_number, ifsc_code, bank_name, mobile_number?, state_code?, vimopay_bank_code? }
 */
router.post('/bank-account', payoutController.upsertBankAccount);

/**
 * PUT /api/payout/bank-account/:id
 * Update an existing bank account by ID
 * Body: { account_name, account_number, ifsc_code, bank_name, mobile_number?, state_code?, vimopay_bank_code? }
 */
router.put('/bank-account/:id', payoutController.updateBankAccount);

/**
 * DELETE /api/payout/bank-account/:id
 * Soft-delete a bank account (set is_active = false)
 */
router.delete('/bank-account/:id', payoutController.deleteBankAccount);

/**
 * PATCH /api/payout/bank-account/:id/default
 * Set a specific account as the primary (default) account
 */
router.patch('/bank-account/:id/default', payoutController.setDefaultBankAccount);

// ============================================================
// WALLET & LIMITS ROUTES
// ============================================================

/**
 * GET /api/payout/balance
 * Get AEPS wallet balance
 */
router.get('/balance', payoutController.getPayoutBalance);

/**
 * GET /api/payout/limits
 * Get daily and monthly payout limits
 */
router.get('/limits', payoutController.getPayoutLimits);

// ============================================================
// TRANSACTION ROUTES
// ============================================================

/**
 * POST /api/payout/transfer
 * Create a new payout transfer
 * Requires 'payout.transfer' permission
 * Body: { amount, mode, tpin, remarks?, lat?, long?, bankAccountId? }
 */
router.post('/transfer', requirePermission('payout.transfer'), payoutController.createPayout);


/**
 * GET /api/payout/transactions
 * Get logged-in user's payout transactions
 */
router.get('/transactions', payoutController.getMyPayoutTransactions);

// ✅ ADD THIS ROUTE - Get transaction status by merchant reference ID
/**
 * GET /api/payout/status/:merchantRefId
 * Get transaction status by merchant reference ID
 */
// ✅ UPDATED ROUTE - Get transaction status by merchant reference ID
/**
 * GET /api/payout/status/:merchantRefId
 * Get transaction status with full deduction breakdown and wallet balances
 */
router.get('/status/:merchantRefId', async (req, res) => {
  try {
    const { merchantRefId } = req.params;
    const userId = req.user.id;
    
    console.log(`[Status API] Fetching status for merchantRefId: ${merchantRefId}`);
    
    // ✅ Get transaction with all fields including payout_charge and total_deduction
    const result = await db.query(
      `SELECT 
        id,
        user_id,
        amount,
        payout_charge,
        total_deduction,
        transfer_mode as paymentmode,
        status,
        merchant_ref_id as merchantrefid,
        provider_ref_id as providerrefid,
        bank_ref_no as bankrefno,
        failure_reason,
        created_at,
        updated_at,
        bene_account_name as beneficiaryname,
        bene_account_number as beneficiaryaccountnumber,
        bene_ifsc as beneficiaryifsc
      FROM payout_transactions 
      WHERE merchant_ref_id = $1 AND user_id = $2`,
      [merchantRefId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    const tx = result.rows[0];
    
    // ✅ Get current wallet balances
    const [aepsWallet, mainWallet] = await Promise.all([
      db.query('SELECT balance FROM aeps_wallets WHERE user_id = $1', [userId]),
      db.query('SELECT balance FROM wallets WHERE user_id = $1', [userId])
    ]);
    
    const aepsBalance = aepsWallet.rows[0] ? parseFloat(aepsWallet.rows[0].balance) : 0;
    const mainBalance = mainWallet.rows[0] ? parseFloat(mainWallet.rows[0].balance) : 0;
    
    // ✅ Build complete response with deduction breakdown
    const response = {
      success: true,
      data: {
        ...tx,
        // Ensure numeric values
        amount: parseFloat(tx.amount || 0),
        payout_charge: parseFloat(tx.payout_charge || 0),
        total_deduction: parseFloat(tx.total_deduction || tx.amount || 0),
        // ✅ Current wallet balances
        aeps_balance: aepsBalance,
        main_balance: mainBalance,
        // Status-specific message
        message: tx.status === 'success' 
          ? 'Payout completed successfully'
          : tx.status === 'failed'
          ? tx.failure_reason || 'Transaction failed'
          : 'Transaction is being processed'
      }
    };
    
    console.log(`[Status API] Response:`, {
      amount: response.data.amount,
      payout_charge: response.data.payout_charge,
      total_deduction: response.data.total_deduction,
      aeps_balance: response.data.aeps_balance,
      main_balance: response.data.main_balance
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('[Status API] Error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch transaction status'
    });
  }
});



// routes/payoutRoutes.js

// ============================================================
// BENEFICIARY ROUTES (Using agent_bank_accounts table)
// ============================================================

const payoutBeneficiaryService = require('../services/payout/payoutBeneficiaryService');

/**
 * POST /api/payout/beneficiary/add
 * Add a new beneficiary (stored in agent_bank_accounts with is_primary = false)
 * Body: { userId, phone, beneData: { account_name, account_number, ifsc_code, bank_code, state_code, payment_mode, mobile } }
 */
router.post('/beneficiary/add', async (req, res) => {
  try {
    const { userId, phone, beneData } = req.body;
    
    console.log('📥 Received beneficiary data:', { userId, phone, beneData });
    
    if (!userId || !phone || !beneData) {
      return res.status(400).json({
        status: 'error',
        message: 'userId, phone, and beneData are required'
      });
    }

    // ✅ Validate required fields
    if (!beneData.account_name) {
      return res.status(400).json({
        status: 'error',
        message: 'account_name is required'
      });
    }
    if (!beneData.account_number) {
      return res.status(400).json({
        status: 'error',
        message: 'account_number is required'
      });
    }
    if (!beneData.ifsc_code) {
      return res.status(400).json({
        status: 'error',
        message: 'ifsc_code is required'
      });
    }

    const result = await payoutBeneficiaryService.addBeneficiary(userId, phone, beneData);
    
    res.json({
      status: 'success',
      data: result.beneficiary,
      message: result.message
    });
    
  } catch (error) {
    console.error('[Add Beneficiary API] Error:', error.message);
    res.status(400).json({
      status: 'error',
      message: error.message || 'Failed to add beneficiary'
    });
  }
});

/**
 * GET /api/payout/beneficiaries
 * Get all beneficiaries for a user (from agent_bank_accounts where is_primary = false)
 */
router.get('/beneficiaries', async (req, res) => {
  try {
    const userId = req.query.userId || req.user?.id;
    
    if (!userId) {
      return res.status(400).json({
        status: 'error',
        message: 'User ID is required'
      });
    }

    const beneficiaries = await payoutBeneficiaryService.listBeneficiaries(userId);
    
    res.json({
      status: 'success',
      data: beneficiaries,
      message: 'Beneficiaries fetched successfully'
    });
    
  } catch (error) {
    console.error('[Beneficiaries API] Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to fetch beneficiaries'
    });
  }
});

/**
 * DELETE /api/payout/beneficiary/:id
 * Soft delete a beneficiary
 */
router.delete('/beneficiary/:id', async (req, res) => {
  try {
    const beneficiaryId = req.params.id;
    const userId = req.query.userId || req.user?.id;
    
    if (!userId) {
      return res.status(400).json({
        status: 'error',
        message: 'User ID is required'
      });
    }

    const result = await payoutBeneficiaryService.deleteBeneficiary(beneficiaryId, userId);
    
    res.json({
      status: 'success',
      ...result
    });
    
  } catch (error) {
    console.error('[Delete Beneficiary API] Error:', error.message);
    res.status(400).json({
      status: 'error',
      message: error.message || 'Failed to delete beneficiary'
    });
  }
});


/**
 * GET /api/payout/transactions
 * Get logged-in user's payout transactions
 */
router.get('/transactions', payoutController.getMyPayoutTransactions);

// ============================================================
// ADMIN ROUTES
// ============================================================

/**
 * GET /api/payout/admin/transactions
 * Get all payout transactions (admin only)
 */
router.get('/admin/transactions', isAdmin, payoutController.adminGetPayoutTransactions);

module.exports = router;