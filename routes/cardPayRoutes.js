const express = require('express');
const router = express.Router();
const cardPayController = require('../controllers/cardPayController');
const { protect } = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// Public webhook (no auth - Vidual calls this)
router.post('/callback', cardPayController.callback);

// All other routes require authentication
router.use(protect);

// User routes
router.post('/initiate', cardPayController.initiate);
router.get('/states', cardPayController.getStateList);
router.get('/status/:ref', cardPayController.status);
router.get('/receipt/:ref', cardPayController.getReceipt);
router.get('/wallet/balance', cardPayController.walletBalance);
router.get('/wallet/ledger', cardPayController.getCardPayLedger);
router.post('/move-to-main', cardPayController.moveToMain);
router.get('/balance', cardPayController.getBalance);
router.get('/history', cardPayController.getUserHistory);

// Admin routes
router.get('/admin/dashboard', adminMiddleware, cardPayController.getDashboard);
router.get('/admin/transactions', adminMiddleware, cardPayController.getTransactions);
router.get('/admin/reports/export', adminMiddleware, cardPayController.exportReport);
router.get('/admin/config', adminMiddleware, cardPayController.getConfig);
router.post('/admin/config', adminMiddleware, cardPayController.updateConfig);
router.get('/admin/wallet/users', adminMiddleware, cardPayController.adminGetAllUserBalances);
router.get('/admin/wallet/ledger', adminMiddleware, cardPayController.adminGetCardPayLedger);

module.exports = router;
