// routes/rechargeRoutes.js
const express = require('express');
const router = express.Router();
const rechargeController = require('../controllers/rechargeController');
const protect = require('../middleware/authMiddleware');  // ✅ protect is the auth middleware

console.log('✅ Methods loaded:', Object.keys(rechargeController));
console.log('=== CONTROLLER DEBUG ===');
console.log('getOperatorList exists?', typeof rechargeController.getOperatorList);
console.log('processRecharge exists?', typeof rechargeController.processRecharge);
console.log('getUserHistory exists?', typeof rechargeController.getUserHistory);
console.log('handleCallback exists?', typeof rechargeController.handleCallback);
console.log('========================');

// ✅ PUBLIC CALLBACK – must be BEFORE auth middleware
router.post('/callback', rechargeController.handleCallback);

// ✅ All other routes require authentication
router.use(protect);   // ✅ use 'protect' not 'authMiddleware'

// Protected routes
router.post('/operators', rechargeController.getOperatorList);
router.get('/circles', rechargeController.getCircleList);
router.get('/services', rechargeController.getServiceTypeList);
router.post('/', rechargeController.processRecharge);
router.get('/history', rechargeController.getUserHistory);
router.get('/receipt/:transactionId', protect, rechargeController.getRechargeReceipt);
module.exports = router;