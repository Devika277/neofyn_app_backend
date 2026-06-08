const express = require('express');
const router = express.Router();
const aepsController = require('../controllers/aepsControllers');
const protect = require('../middleware/authMiddleware'); // ← make sure this path is correct

// ========== PUBLIC ROUTES ==========
router.get('/health', aepsController.healthCheck);
router.get('/banks', aepsController.getBankList);
router.get('/states', aepsController.getStateList);
router.post('/districts', aepsController.getDistrictList);

// ========== MERCHANT ROUTES ==========
router.post('/merchant/register', aepsController.registerMerchant);
router.post('/merchant/send-otp', aepsController.sendOtp);
router.post('/merchant/verify-otp', aepsController.verifyOtp);
router.get('/merchant/by-phone', aepsController.getMerchantByPhone);

// ========== AUTHENTICATION ROUTES ==========
router.post('/2fa', aepsController.twoFactorAuth);

// ========== TRANSACTION ROUTES ==========
router.post('/transaction', aepsController.aepsTransaction);
router.post('/transaction/status', aepsController.transactionStatus);
router.get('/history', aepsController.getHistory);   // no authMiddleware

// ========== WEBHOOK (Provider calls this) ==========
router.post('/callback', aepsController.webhookCallback);

module.exports = router;