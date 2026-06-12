// routes/commissionRoutes.js
const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/authMiddleware');

const {
    getBalance,
    getHistory,
    transferToMain,
    getAllWallets,
    freezeWallet,
    getSettings,
    updateSettings,
    getCommissionRates,
    updateCommissionRate,
    createCommissionRate
} = require('../controllers/commissionController');


// All routes require authentication
router.use(protect);

// User routes
router.get('/balance', getBalance);
router.get('/history', getHistory);
router.post('/transfer', transferToMain);

// Admin routes (strict admin only)
router.get('/admin/all', adminOnly, getAllWallets);
router.post('/admin/freeze/:userId', adminOnly, freezeWallet);
router.get('/admin/settings', adminOnly, getSettings);
router.put('/admin/settings', adminOnly, updateSettings);

router.get('/rates', protect, getCommissionRates);

router.put('/rates/:id', protect, adminOnly, updateCommissionRate);

router.post('/rates', protect, adminOnly, createCommissionRate);

module.exports = router;