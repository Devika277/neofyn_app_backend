// routes/commissionRoutes.js

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// ✅ Define adminOnly middleware here
const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }
  
  // Check if user has admin role
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  
  next();
};

// Import controller functions
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

// ─── User routes ────────────────────────────────────────────
router.get('/balance', getBalance);
router.get('/history', getHistory);
router.post('/transfer', transferToMain);

// ─── Admin routes ────────────────────────────────────────────
router.get('/admin/all', adminOnly, getAllWallets);
router.post('/admin/freeze/:userId', adminOnly, freezeWallet);
router.get('/admin/settings', adminOnly, getSettings);
router.put('/admin/settings', adminOnly, updateSettings);

// ─── Commission Rates routes ────────────────────────────────
router.get('/rates', getCommissionRates);
router.put('/rates/:id', adminOnly, updateCommissionRate);
router.post('/rates', adminOnly, createCommissionRate);

module.exports = router;