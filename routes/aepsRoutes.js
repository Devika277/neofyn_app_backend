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
    if (!pipe || !['1', '2', '3'].includes(pipe)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid pipe (1, 2, or 3) is required' 
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
    if (!['1', '2', '3'].includes(pipe)) {
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
    if (!['1', '2', '3'].includes(pipe)) {
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
    if (!['1', '2', '3'].includes(pipe)) {
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
    if (!['1', '2', '3'].includes(pipe)) {
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

// ============================================================
// Daily 2FA Route
// ============================================================
// backend/routes/aepsRoutes.js

// ============================================================
// ✅ ADD THIS ROUTE - For 2FA (matches Flutter app's expected endpoint)
// ============================================================
// router.post('/aepsapi/api/payment/merchant2FAPipe', authenticate, async (req, res) => {
//   console.log('[AEPS Route] ════════════════════════════════════════════');
//   console.log('[AEPS Route] 🔵 POST /aepsapi/api/payment/merchant2FAPipe');
//   console.log('[AEPS Route] 🔵 User ID:', req.user?.id);
//   console.log('[AEPS Route] 🔵 Request body:', JSON.stringify(req.body, null, 2));

//   try {
//     let { 
//       merchantId, 
//       merchantRefId, 
//       aadhaarNumber, 
//       pipe, 
//       deviceType, 
//       pidData, 
//       lat, 
//       long 
//     } = req.body;

//     // Validate required fields
//     if (!merchantId || !merchantRefId || !aadhaarNumber || !pidData) {
//       console.log('[AEPS Route] ❌ Missing required fields');
//       return res.status(400).json({ 
//         successStatus: false, 
//         message: 'merchantId, merchantRefId, aadhaarNumber, and pidData are required',
//         responseCode: '001'
//       });
//     }

//     // Validate Aadhaar
//     if (!/^\d{12}$/.test(aadhaarNumber)) {
//       console.log('[AEPS Route] ❌ Invalid Aadhaar format');
//       return res.status(400).json({ 
//         successStatus: false, 
//         message: 'Aadhaar number must be 12 digits',
//         responseCode: '001'
//       });
//     }

//     // Set default pipe if not provided
//     pipe = pipe || '1';
//     if (!['1', '2', '3'].includes(pipe)) {
//       console.log('[AEPS Route] ❌ Invalid pipe:', pipe);
//       return res.status(400).json({ 
//         successStatus: false, 
//         message: 'Invalid pipe value. Must be 1, 2, or 3',
//         responseCode: '001'
//       });
//     }

//     console.log('[AEPS Route] ✅ Validation passed');
//     console.log('[AEPS Route] 📦 Calling provider with:', {
//       merchantId,
//       merchantRefId,
//       aadhaarNumber: '****' + aadhaarNumber.slice(-4),
//       pipe,
//       deviceType: deviceType || 'mantra',
//       pidDataLength: pidData ? pidData.length : 0,
//       lat: lat || '0.0',
//       long: long || '0.0'
//     });

//     // ✅ Call the provider directly
//     const result = await vimopayAepsProvider.perform2FA({
//       merchantId,
//       merchantRefId,
//       aadhaarNumber,
//       pipe,
//       deviceType: deviceType || 'mantra',
//       pidData,
//       lat: lat || '0.0',
//       long: long || '0.0',
//     });

//     console.log('[AEPS Route] 📥 Provider result:', JSON.stringify(result, null, 2));

//     // Check if the 2FA was successful
//     if (result.status === '000') {
//       console.log('[AEPS Route] ✅ 2FA Successful!');
//       return res.json({
//         successStatus: true,
//         message: result.statusDescription || '2FA verification successful',
//         responseCode: '000',
//         data: {
//           status: result.status,
//           merchantStatus: result.merchantStatus,
//           statusDescription: result.statusDescription || '2FA verification successful',
//           merchantId: result.merchantId,
//           txnRefId: result.txnRefId,
//         }
//       });
//     } else {
//       console.log('[AEPS Route] ❌ 2FA Failed with status:', result.status);
//       return res.status(400).json({
//         successStatus: false,
//         message: result.statusDescription || '2FA verification failed',
//         responseCode: result.status || '001',
//         data: {
//           status: result.status,
//           merchantStatus: result.merchantStatus,
//           statusDescription: result.statusDescription || '2FA verification failed',
//           merchantId: result.merchantId,
//           txnRefId: result.txnRefId,
//         }
//       });
//     }

//   } catch (error) {
//     console.error('[AEPS Route] ❌ Error performing 2FA:', error.message);
//     console.error('[AEPS Route] Stack:', error.stack);
    
//     return res.status(500).json({ 
//       successStatus: false, 
//       message: error.message || 'Internal server error',
//       responseCode: '500',
//       data: {
//         status: '500',
//         merchantStatus: 'Failed',
//         statusDescription: error.message || 'Internal server error',
//       }
//     });
//   }
// });
// In aepsRoutes.js, replace the /2fa route:
router.post('/2fa', authenticate, async (req, res) => {
  try {
    let { merchantId, merchantRefId, aadhaarNumber, pipe, deviceType, pidData, lat, long } = req.body;
    if (!merchantId || !merchantRefId || !aadhaarNumber || !pidData) {
      return res.status(400).json({ success: false, message: 'merchantId, merchantRefId, aadhaarNumber, and pidData required' });
    }
    pipe = pipe || '2';
    if (!['1', '2', '3'].includes(pipe)) {
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
    if (!['1', '2', '3'].includes(pipe)) {
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
    if (!['1', '2', '3'].includes(pipe)) {
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
    if (!['1', '2', '3'].includes(pipe)) {
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
router.post('/mini-statement', authenticate, async (req, res) => {
  try {
    let { bankCode, pidData, accountType, device, aadhaarNo, mobileNo, lat, long, pipe } = req.body;
    if (!bankCode || !pidData) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    pipe = pipe || '2';
    if (!['1', '2', '3'].includes(pipe)) {
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

router.get('/transactions', authenticate, async (req, res) => {
  try {
    const pipe = req.query.pipe || null;
    if (pipe && !['1', '2', '3'].includes(pipe)) {
      return res.status(400).json({ success: false, message: 'Invalid pipe value' });
    }
    const transactions = await aepsService.getUserTransactions(req.user.id, pipe);
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
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

module.exports = router;