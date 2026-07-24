// const express = require('express');
// const router = express.Router();
// const aepsController = require('../controllers/aepsControllers');
// const protect = require('../middleware/authMiddleware'); // ← make sure this path is correct

// // ========== PUBLIC ROUTES ==========
// router.get('/health', aepsController.healthCheck);
// router.get('/banks', aepsController.getBankList);
// router.get('/states', aepsController.getStateList);
// router.post('/districts', aepsController.getDistrictList);

// // ========== MERCHANT ROUTES ==========
// router.post('/merchant/register', aepsController.registerMerchant);
// router.post('/merchant/send-otp', aepsController.sendOtp);
// router.post('/merchant/verify-otp', aepsController.verifyOtp);
// router.get('/merchant/by-phone', aepsController.getMerchantByPhone);

// // ========== AUTHENTICATION ROUTES ==========
// router.post('/2fa', aepsController.twoFactorAuth);

// // ========== TRANSACTION ROUTES ==========
// router.post('/transaction', aepsController.aepsTransaction);
// router.post('/transaction/status', aepsController.transactionStatus);
// router.get('/history', aepsController.getHistory);   // no authMiddleware

// // ========== WEBHOOK (Provider calls this) ==========
// router.post('/callback', aepsController.webhookCallback);

// module.exports = router;


const express = require('express');
const router = express.Router();
const db = require('../config/db');
const vimopayAepsProvider = require('../providers/vimopayAepsProvider');

const aepsService = require('../services/AEPS/aepsService');
const aepsWalletService = require('../services/AEPS/aepsWalletService');

const { protect: authenticate } = require('../middleware/authMiddleware');
const { isAdmin } = require('../middleware/adminMiddleware');

const aepsController = require('../controllers/aepsControllers'); // ✅ Import controller


// ==============================
// Helper: Real IP extraction (static sandbox IP only for local development)
// ==============================
function getIp(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || req.ip
    || '';
  if (process.env.NODE_ENV !== 'production' && (!ip || ip === '::1' || ip === '127.0.0.1')) {
    return '103.21.141.2';   // VimoPay sandbox test IP
  }
  return ip;
}

// ==============================
// User Endpoints (Authenticated)
// ==============================

// router.get('/merchant/status', authenticate, async (req, res) => {
//   try {
//     const pipe = req.query.pipe || '2';
//     if (!['1', '2', '3'].includes(pipe)) {
//       return res.status(400).json({ success: false, message: 'Invalid pipe. Must be "1", "2", or "3".' });
//     }
//     const status = await aepsService.getMerchantStatus(req.user.id, pipe);
//     res.json(status);
//   } catch (error) {
//     console.error('Error checking merchant status:', error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// });


router.get('/merchant-status', async (req, res) => {
  const { userId } = req.query;
  try {
    const result = await aepsService.getAllMerchantStatuses(userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// backend/routes/aepsRoutes.js

router.post('/merchant/register', authenticate, async (req, res) => {
  console.log('[AEPS Route] ════════════════════════════════════════════');
  console.log('[AEPS Route] 🔵 POST /merchant/register');
  console.log('[AEPS Route] 🔵 User ID:', req.user?.id);
  console.log('[AEPS Route] 🔵 Request body:', JSON.stringify(req.body, null, 2));

  try {
    const { 
      aadhaarNo, 
      pipe,
      firstName,
      lastName,
      stateCode,
      districtCode,
      // ... other fields
    } = req.body;

    // Validate Aadhaar
    if (!aadhaarNo || aadhaarNo.length !== 12 || !/^\d{12}$/.test(aadhaarNo)) {
      return res.status(400).json({
        success: false,
        message: 'Agent Aadhaar number is required and must be a valid 12-digit number'
      });
    }

    // Validate Pipe
    if (!pipe || !['1', '2', '3', '4'].includes(pipe)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid pipe (1, 2, 3, or 4) is required' 
      });
    }

    console.log(`[AEPS Route] ✅ Registering merchant for pipe ${pipe}`);

    // ✅ Check if merchant exists for this specific pipe
    const existingMerchant = await db.query(
      `SELECT * FROM aeps_merchants WHERE user_id = $1 AND pipe = $2`,
      [req.user.id, pipe]
    );

    if (existingMerchant.rows.length > 0) {
      console.log(`[AEPS Route] ❌ Merchant already exists for pipe ${pipe}`);
      return res.status(409).json({
        success: false,
        message: `Merchant already registered for pipe ${pipe}`,
        merchantId: existingMerchant.rows[0].merchant_id,
        pipe: pipe,
        registrationStatus: existingMerchant.rows[0].registration_status
      });
    }

    // ✅ Check if merchant exists for other pipes (optional info)
    const otherPipes = await db.query(
      `SELECT pipe FROM aeps_merchants WHERE user_id = $1 AND pipe != $2`,
      [req.user.id, pipe]
    );
    
    if (otherPipes.rows.length > 0) {
      console.log(`[AEPS Route] ℹ️ User has merchants on other pipes:`, 
        otherPipes.rows.map(r => r.pipe).join(', ')
      );
    }

    // ✅ Register merchant
    const result = await aepsService.registerMerchant(req.user.id, {
      ...req.body,
      ipAddress: getIp(req),
      pipe: pipe,
    });

    console.log('[AEPS Route] ✅ Registration successful:', {
      merchantId: result.merchantId,
      pipe: result.pipe,
      status: result.registrationStatus
    });

    res.json({
      success: true,
      message: `Merchant registered successfully for pipe ${pipe}`,
      data: result
    });

  } catch (error) {
    console.error('[AEPS Route] ❌ Registration error:', error.message);
    console.error('[AEPS Route] Stack:', error.stack);
    
    // Handle specific errors
    if (error.message.includes('already registered')) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to register merchant' 
    });
  }
});

router.get('/banks', authenticate, async (req, res) => {
  try {
    const banks = await aepsService.getBankList();
    res.json(banks);
  } catch (error) {
    console.error('Error fetching banks:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/states', authenticate, async (req, res) => {
  try {
    const states = await aepsService.getStateList();
    res.json(states);
  } catch (error) {
    console.error('Error fetching states:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/districts', authenticate, async (req, res) => {
  try {
    const { stateCode } = req.body;
    if (!stateCode) return res.status(400).json({ success: false, message: 'State code required' });
    const districts = await aepsService.getDistrictList(stateCode);
    res.json(districts);
  } catch (error) {
    console.error('Error fetching districts:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/bank-iins', authenticate, async (req, res) => {
  try {
    const iins = await aepsService.getBankIINs();
    res.json(iins);
  } catch (error) {
    console.error('Error fetching bank IINs:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// OTP routes
router.post('/merchant/send-otp', authenticate, async (req, res) => {
  try {
    let { merchantId, merchantRefId, pipe } = req.body;
    if (!merchantId || !merchantRefId) {
      return res.status(400).json({ success: false, message: 'merchantId and merchantRefId required' });
    }
    pipe = pipe || '2';
    if (!['1', '2', '3', '4'].includes(pipe)) {
      return res.status(400).json({ success: false, message: 'Invalid pipe value' });
    }
    const result = await aepsService.sendOTP(req.user.id, pipe, { merchantId, merchantRefId });
    res.json(result);
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/merchant/resend-otp', authenticate, async (req, res) => {
  try {
    let { merchantId, merchantRefId, pipe } = req.body;
    if (!merchantId || !merchantRefId) {
      return res.status(400).json({ success: false, message: 'merchantId and merchantRefId required' });
    }
    pipe = pipe || '2';
    if (!['1', '2', '3', '4'].includes(pipe)) {
      return res.status(400).json({ success: false, message: 'Invalid pipe value' });
    }
    const result = await aepsService.resendOTP(req.user.id, pipe, { merchantId, merchantRefId });
    res.json(result);
  } catch (error) {
    console.error('Error resending OTP:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/merchant/verify-otp', authenticate, async (req, res) => {
  try {
    let { merchantId, merchantRefId, otp, pipe } = req.body;
    if (!merchantId || !merchantRefId || !otp) {
      return res.status(400).json({ success: false, message: 'merchantId, merchantRefId, and otp required' });
    }
    pipe = pipe || '2';
    if (!['1', '2', '3', '4'].includes(pipe)) {
      return res.status(400).json({ success: false, message: 'Invalid pipe value' });
    }
    const result = await aepsService.verifyOTP(req.user.id, pipe, { merchantId, merchantRefId, otp });
    res.json(result);
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// E-KYC
router.post('/merchant/ekyc', authenticate, async (req, res) => {
  try {
    let { merchantId, merchantRefId, pipe, pidData, deviceType, aadhaarNumber } = req.body;
    if (!merchantId || !merchantRefId || !pidData) {
      return res.status(400).json({ success: false, message: 'merchantId, merchantRefId, and pidData required' });
    }
    pipe = pipe || '2';
    if (!['1', '2', '3', '4'].includes(pipe)) {
      return res.status(400).json({ success: false, message: 'Invalid pipe value' });
    }
    const result = await aepsService.performEkyc(req.user.id, pipe, {
      merchantId,
      merchantRefId,
      pidData,
      deviceType: deviceType || 'mantra',
      aadhaarNumber,
      ipAddress: getIp(req),
    });
    res.json(result);
  } catch (error) {
    console.error('Error performing E-KYC:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/2fa/status/:userId', authenticate, aepsController.check2FAStatus);

// In aepsRoutes.js, replace the /2fa route:
router.post('/2fa', authenticate, async (req, res) => {
  try {
    let { merchantId, merchantRefId, aadhaarNumber, pipe, deviceType, pidData, lat, long } = req.body;
    if (!merchantId || !merchantRefId || !aadhaarNumber || !pidData) {
      return res.status(400).json({ success: false, message: 'merchantId, merchantRefId, aadhaarNumber, and pidData required' });
    }
    pipe = pipe || '2';
    if (!['1', '2', '3', '4'].includes(pipe)) {
      return res.status(400).json({ success: false, message: 'Invalid pipe value' });
    }
    const result = await aepsService.perform2FA(req.user.id, pipe, {
      merchantId,
      merchantRefId,
      aadhaarNumber,
      deviceType: deviceType || 'mantra',
      pidData,
      lat,
      long,
      ipAddress: getIp(req),
    });
    res.json(result);
  } catch (error) {
    console.error('Error performing 2FA:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});
// router.post('/2fa', authenticate, async (req, res) => {
//   try {
//     let { merchantId, merchantRefId, aadhaarNumber, pipe, deviceType, pidData, lat, long } = req.body;
//     if (!merchantId || !merchantRefId || !aadhaarNumber || !pidData) {
//       return res.status(400).json({ success: false, message: 'merchantId, merchantRefId, aadhaarNumber, and pidData required' });
//     }
//     pipe = pipe || '2';
//     if (!['1', '2', '3'].includes(pipe)) {
//       return res.status(400).json({ success: false, message: 'Invalid pipe value' });
//     }
//     const result = await aepsService.perform2FA(req.user.id, pipe, {
//       merchantId,
//       merchantRefId,
//       aadhaarNumber,
//       deviceType: deviceType || 'mantra',
//       pidData,
//       lat,
//       long,
//       ipAddress: getIp(req),
//     });
//     res.json(result);
//   } catch (error) {
//     console.error('Error performing 2FA:', error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// });
// ==============================
// Transactions
// ==============================

// Cash Withdrawal
router.post('/cash-withdrawal', authenticate, async (req, res) => {
  try {
    let { amount, bankCode, pidData, accountType, lat, long, device, aadhaarNo, mobileNo, pipe } = req.body;
    if (!amount || !bankCode || !pidData) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    pipe = pipe || '2';
    if (!['1', '2', '3', '4'].includes(pipe)) {
      return res.status(400).json({ success: false, message: 'Invalid pipe value' });
    }
    const result = await aepsService.cashWithdrawal(req.user.id, pipe, {
      amount,
      bankCode,
      pidData,
      accountType,
      lat,
      long,
      device,
      aadhaarNo,
      mobileNo,
      ipAddress: getIp(req),
    });
    res.json(result);
  } catch (error) {
    console.error('Error processing withdrawal:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Cash Deposit
router.post('/cash-deposit', authenticate, async (req, res) => {
  try {
    let { amount, bankCode, pidData, accountType, lat, long, device, aadhaarNo, mobileNo, pipe } = req.body;
    if (!amount || !bankCode || !pidData) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    pipe = pipe || '2';
    if (!['1', '2', '3', '4'].includes(pipe)) {
      return res.status(400).json({ success: false, message: 'Invalid pipe value' });
    }
    const result = await aepsService.cashDeposit(req.user.id, pipe, {
      amount,
      bankCode,
      pidData,
      accountType,
      lat,
      long,
      device,
      aadhaarNo,
      mobileNo,
      ipAddress: getIp(req),
    });
    res.json(result);
  } catch (error) {
    console.error('Error processing cash deposit:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Balance Enquiry
router.post('/balance-enquiry', authenticate, async (req, res) => {
  try {
    let { bankCode, pidData, accountType, device, aadhaarNo, mobileNo, lat, long, pipe } = req.body;
    if (!bankCode || !pidData) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    pipe = pipe || '2';
    if (!['1', '2', '3', '4'].includes(pipe)) {
      return res.status(400).json({ success: false, message: 'Invalid pipe value' });
    }
    const result = await aepsService.balanceEnquiry(req.user.id, pipe, {
      bankCode,
      pidData,
      accountType,
      device,
      aadhaarNo,
      mobileNo,
      lat,
      long,
      ipAddress: getIp(req),
    });
    res.json(result);
  } catch (error) {
    console.error('Error processing balance enquiry:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Mini Statement
// Mini Statement
router.post('/mini-statement', authenticate, async (req, res) => {
  try {
    let { bankCode, pidData, accountType, device, aadhaarNo, mobileNo, lat, long, pipe } = req.body;
    if (!bankCode || !pidData) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    pipe = pipe || '2';
    if (!['1', '2', '3', '4'].includes(pipe)) {
      return res.status(400).json({ success: false, message: 'Invalid pipe value' });
    }
    const result = await aepsService.miniStatement(req.user.id, pipe, {
      bankCode,
      pidData,
      accountType,
      device,
      aadhaarNo,
      mobileNo,
      lat,
      long,
      ipAddress: getIp(req),
    });
    res.json(result);
  } catch (error) {
    console.error('Error processing mini statement:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ✅ Aadhaar Pay (AP) — NEW
router.post('/aadhaar-pay', authenticate, async (req, res) => {
  try {
    let { amount, bankCode, pidData, accountType, lat, long, device, aadhaarNo, mobileNo, pipe } = req.body;
    if (!amount || !bankCode || !pidData) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    pipe = pipe || '2';
    if (!['1', '2', '3', '4'].includes(pipe)) {
      return res.status(400).json({ success: false, message: 'Invalid pipe value' });
    }
    const result = await aepsService.aadhaarPay(req.user.id, pipe, {
      amount,
      bankCode,
      pidData,
      accountType,
      lat,
      long,
      device,
      aadhaarNo,
      mobileNo,
      ipAddress: getIp(req),
    });
    res.json(result);
  } catch (error) {
    console.error('Error processing Aadhaar Pay:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// ✅ UPDATED: GET /transactions - Now includes mini_statement data and user details
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const pipe = req.query.pipe || null;
    if (pipe && !['1', '2', '3', '4'].includes(pipe)) {
      return res.status(400).json({ success: false, message: 'Invalid pipe value' });
    }
    
    // Fetch user details along with transactions
    // ✅ FIXED: Use db.query() instead of db()
    const userResult = await db.query(
      `SELECT business_name, phone FROM users WHERE id = $1`,
      [req.user.id]
    );
    const user = userResult.rows[0] || null;

    const transactions = await aepsService.getUserTransactions(req.user.id, pipe);
    
    // ✅ Format response to include transaction_list for mini statements
    const formatted = transactions.map(tx => ({
      id: tx.id,
      txn_type: tx.txn_type,
      amount: tx.amount,
      aadhaar_last4: tx.aadhaar_last4,
      bank_iin: tx.bank_iin,
      bank_name: tx.bank_name,
      rrn: tx.rrn,
      npci_code: tx.npci_code,
      npci_message: tx.npci_message,
      status: tx.status,
      provider: tx.provider,
      device_used: tx.device_used,
      created_at: tx.created_at,
      pipe: tx.pipe,
      available_balance: tx.available_balance || null,
      transaction_list: tx.transaction_list || [],  // ✅ Mini statement entries
      mini_statement: tx.mini_statement || null,    // ✅ Raw mini statement data
      user: {
        business_name: user?.business_name || null,
        phone: user?.phone || null
      }
    }));
    
    res.json(formatted);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ✅ NEW: GET /history - Alias for transactions with same data
router.get('/history', authenticate, async (req, res) => {
  try {
    const pipe = req.query.pipe || null;
    if (pipe && !['1', '2', '3', '4'].includes(pipe)) {
      return res.status(400).json({ success: false, message: 'Invalid pipe value' });
    }
    
    // Fetch user details along with transactions
    // ✅ FIXED: Use db.query() instead of db()
    const userResult = await db.query(
      `SELECT business_name, phone FROM users WHERE id = $1`,
      [req.user.id]
    );
    const user = userResult.rows[0] || null;
        
    const transactions = await aepsService.getUserTransactions(req.user.id, pipe);
    
    // ✅ Format response to include transaction_list for mini statements
    const formatted = transactions.map(tx => ({
      id: tx.id,
      txn_type: tx.txn_type,
      amount: tx.amount,
      aadhaar_last4: tx.aadhaar_last4,
      bank_iin: tx.bank_iin,
      bank_name: tx.bank_name,
      rrn: tx.rrn,
      npci_code: tx.npci_code,
      npci_message: tx.npci_message,
      status: tx.status,
      provider: tx.provider,
      device_used: tx.device_used,
      created_at: tx.created_at,
      pipe: tx.pipe,
      available_balance: tx.available_balance || null,
      transaction_list: tx.transaction_list || [],  // ✅ Mini statement entries
      mini_statement: tx.mini_statement || null,    // ✅ Raw mini statement data
      user: {
        business_name: user?.business_name || null,
        phone: user?.phone || null
      }
    }));
    
    res.json(formatted);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ✅ NEW: GET /mini-statement/:transactionId - Fetch mini statement details for a specific transaction
router.get('/mini-statement/:transactionId', authenticate, async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;
    
    const result = await db.query(
      `SELECT 
        id, 
        txn_type, 
        mini_statement, 
        available_balance,
        rrn,
        npci_code,
        npci_message,
        bank_iin,
        aadhaar_last4,
        created_at,
        raw_response
       FROM aeps_transactions 
       WHERE id = $1 AND user_id = $2`,
      [transactionId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Transaction not found' 
      });
    }
    
    const tx = result.rows[0];
    let miniStatement = [];
    let transactionList = [];
    
    // Parse mini_statement
    if (tx.mini_statement) {
      try {
        miniStatement = typeof tx.mini_statement === 'string' 
          ? JSON.parse(tx.mini_statement) 
          : tx.mini_statement;
        
        // Extract transaction list
        if (Array.isArray(miniStatement)) {
          transactionList = miniStatement;
        } else if (miniStatement && typeof miniStatement === 'object') {
          transactionList = miniStatement.transactions || 
                          miniStatement.list || 
                          miniStatement.items || 
                          [];
        }
      } catch (e) {
        console.error('Error parsing mini_statement:', e);
      }
    }
    
    // If mini_statement is empty, try raw_response
    if (transactionList.length === 0 && tx.raw_response) {
      try {
        const raw = typeof tx.raw_response === 'string' 
          ? JSON.parse(tx.raw_response) 
          : tx.raw_response;
        
        if (raw && raw.transactionList && Array.isArray(raw.transactionList)) {
          transactionList = raw.transactionList;
        } else if (raw && raw.transaction_list && Array.isArray(raw.transaction_list)) {
          transactionList = raw.transaction_list;
        }
      } catch (e) {
        // Silently ignore
      }
    }
    
    res.json({
      success: true,
      data: {
        id: tx.id,
        txn_type: tx.txn_type,
        rrn: tx.rrn,
        npci_code: tx.npci_code,
        npci_message: tx.npci_message,
        bank_iin: tx.bank_iin,
        aadhaar_last4: tx.aadhaar_last4,
        created_at: tx.created_at,
        available_balance: tx.available_balance,
        transaction_list: transactionList,
        mini_statement: miniStatement,
      }
    });
  } catch (error) {
    console.error('Error fetching mini statement:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Wallet (no pipe needed)
router.get('/wallet/balance', authenticate, async (req, res) => {
  try {
    const balance = await aepsWalletService.getAepsBalance(req.user.id);
    res.json({ balance });
  } catch (error) {
    console.error('Error fetching AePS balance:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/wallet/ledger', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const ledger = await aepsWalletService.getAepsLedger(req.user.id, limit, offset);
    res.json(ledger);
  } catch (error) {
    console.error('Error fetching AePS ledger:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/move-to-main', authenticate, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount required' });
    }
    const result = await aepsWalletService.moveToMain(req.user.id, amount);
    res.json(result);
  } catch (error) {
    console.error('Error moving to main wallet:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==============================
// Admin View Endpoints (READ ONLY)
// ==============================

router.get('/admin/merchants', authenticate, isAdmin, async (req, res) => {
  try {
    const merchants = await aepsService.getAllMerchants();
    res.json(merchants);
  } catch (error) {
    console.error('Error fetching merchants:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/admin/transactions', authenticate, isAdmin, async (req, res) => {
  try {
    const { status, type, from, to } = req.query;
    const transactions = await aepsService.getAllTransactions(status, type, from, to);
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching admin transactions:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/admin/wallets', authenticate, isAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const wallets = await aepsWalletService.getAllAepsWallets(limit, offset);
    res.json(wallets);
  } catch (error) {
    console.error('Error fetching admin wallets:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/admin/refresh-bank-iins', authenticate, isAdmin, async (req, res) => {
  try {
    const iins = await aepsService.getBankIINs(true);
    res.json({ success: true, count: iins.length, data: iins });
  } catch (error) {
    console.error('Error refreshing bank IINs:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Callback endpoint for provider async updates
router.post('/callback', async (req, res) => {
  res.sendStatus(200);
});


// =====================================================
// MERCHANT PROFILE ROUTES
// =====================================================

// Get merchant profile (first registered pipe)
router.get(
    '/merchant/profile/:userId',
    authenticate,
    aepsController.getMerchantProfile
);

// Get merchant profile by specific pipe
router.get(
    '/merchant/profile/:userId/pipe/:pipe',
    authenticate,
    aepsController.getMerchantProfileByPipe
);

module.exports = router;