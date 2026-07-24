const express = require('express');
const router = express.Router();
const cardpayOutController = require('../controllers/cardpayOutController');
const { protect } = require('../middleware/authMiddleware');
const { isAdmin } = require('../middleware/adminMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// Public routes (no auth required)
router.post('/callback', cardpayOutController.processCallback);

// All routes below require authentication
router.use(protect);

// User routes
router.get('/beneficiaries', cardpayOutController.getBeneficiaries);
router.post('/beneficiaries', cardpayOutController.addBeneficiary);
router.delete('/beneficiaries/:id', cardpayOutController.deleteBeneficiary);
router.get('/balance', cardpayOutController.getBalance);
router.get('/limits', cardpayOutController.getLimits);
router.post('/initiate', requirePermission('cardpay-out.transfer'), cardpayOutController.initiatePayout);
router.get('/status/:ref', cardpayOutController.getStatus);
router.get('/receipt/:ref', cardpayOutController.getReceipt);
router.get('/history', cardpayOutController.getHistory);

// Admin routes
router.get('/admin/dashboard', isAdmin, cardpayOutController.adminGetDashboard);
router.get('/admin/transactions', isAdmin, cardpayOutController.adminGetTransactions);
router.get('/admin/transactions/:id', isAdmin, cardpayOutController.adminGetTransaction);
router.post('/admin/process/:id', isAdmin, cardpayOutController.adminProcess);
router.post('/admin/cancel/:id', isAdmin, cardpayOutController.adminCancel);
router.get('/admin/reports/export', isAdmin, cardpayOutController.adminExportReport);
router.get('/admin/config', isAdmin, cardpayOutController.adminGetConfig);
router.post('/admin/config', isAdmin, cardpayOutController.adminUpdateConfig);

module.exports = router;
