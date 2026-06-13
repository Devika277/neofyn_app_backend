// // routes/rechargeRoutes.js
// const express = require('express');
// const router = express.Router();
// const rechargeController = require('../controllers/rechargeController');
// const protect = require('../middleware/authMiddleware');  // ✅ protect is the auth middleware

// console.log('✅ Methods loaded:', Object.keys(rechargeController));
// console.log('=== CONTROLLER DEBUG ===');
// console.log('getOperatorList exists?', typeof rechargeController.getOperatorList);
// console.log('processRecharge exists?', typeof rechargeController.processRecharge);
// console.log('getUserHistory exists?', typeof rechargeController.getUserHistory);
// console.log('handleCallback exists?', typeof rechargeController.handleCallback);
// console.log('========================');

// // ✅ PUBLIC CALLBACK – must be BEFORE auth middleware
// router.post('/callback', rechargeController.handleCallback);

// // ✅ All other routes require authentication
// router.use(protect);   // ✅ use 'protect' not 'authMiddleware'

// // Protected routes
// router.post('/operators', rechargeController.getOperatorList);
// router.get('/circles', rechargeController.getCircleList);
// router.get('/services', rechargeController.getServiceTypeList);
// router.post('/', rechargeController.processRecharge);
// router.get('/history', rechargeController.getUserHistory);
// router.get('/receipt/:transactionId', protect, rechargeController.getRechargeReceipt);
// module.exports = router;


// routes/rechargeRoutes.js
const express = require('express');
const router = express.Router();
const rechargeController = require('../controllers/rechargeController');
// ✅ FIXED: Import protect as a named export
const { protect } = require('../middleware/authMiddleware');

// ✅ PUBLIC CALLBACK – must be BEFORE auth middleware
router.post('/callback', rechargeController.handleCallback);

// ✅ All other routes require authentication
router.use(protect);

// ──────────────────────────────────────────────────────────────────────────
// Master data endpoints (live from VimoPay)
// These must be implemented in rechargeController (or call service directly)
// ──────────────────────────────────────────────────────────────────────────
router.get('/services', rechargeController.getServiceTypeList);
router.post('/operators', rechargeController.getOperatorList);

// ❌ /circles endpoint removed – not needed for VimoPay recharge

// ──────────────────────────────────────────────────────────────────────────
// Recharge operations
// ──────────────────────────────────────────────────────────────────────────
router.post('/', rechargeController.processRecharge);
router.get('/history', rechargeController.getUserHistory);
router.get('/receipt/:transactionId', rechargeController.getRechargeReceipt);

// Optional: admin only (you can add admin middleware if needed)
router.get('/all', rechargeController.getAllRecharges);   // if controller has it

module.exports = router;