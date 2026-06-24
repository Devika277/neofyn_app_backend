// backend/routes/bbpsRoutes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const router = express.Router();
const ctrl = require('../controllers/bbpsOnboardingController');
const bbps = require('../providers/bbps/bbpsBillPay');



// =====================================================
// ISOLATED JWT VERIFICATION FOR BBPS ROUTES ONLY
// =====================================================
const verifyToken = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  
  console.log('[BBPS-AUTH] Received token:', token);
  console.log('[BBPS-AUTH] JWT_SECRET used:', process.env.JWT_SECRET ? 'set' : 'MISSING');
  
  if (!token) {
    return res.status(401).json({ success: false, error: 'Not authorized, no token' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await db.query('SELECT id, role, email, phone FROM users WHERE id = $1', [decoded.id]);
    if (user.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    req.user = user.rows[0];
    next();
  } catch (error) {
    console.error('[BBPS-AUTH] JWT error:', error.message);
    return res.status(401).json({ success: false, error: 'Token is not valid' });
  }
};

// ========== TEST ROUTE ==========
router.get('/ping', (req, res) => {
  console.log('[BBPS-ROUTE] ping received');
  res.json({ success: true, message: 'pong' });
});

// ========== Onboarding & Status ==========
// POST method for onboarding (the actual creation)
router.post('/merchant/onboard', verifyToken, ctrl.onboard);
// GET method to prevent "Cannot GET" errors – returns method not allowed
router.get('/merchant/onboard', (req, res) => {
  res.status(405).json({ 
    success: false, 
    message: 'Method not allowed. Please use POST to submit merchant onboarding data.' 
  });
});
router.get('/merchant/status/:userId', verifyToken, ctrl.getStatus);

// ========== Dynamic Data for Onboarding ==========
router.get('/states', verifyToken, async (req, res) => {
    try {
        const data = await bbps.getStates();
        res.json({ success: true, data });
    } catch (err) {
        console.error('[BBPS-ROUTE] getStates error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/cities', verifyToken, async (req, res) => {
    try {
        const { stateCode } = req.body;
        if (!stateCode) {
            return res.status(400).json({ success: false, message: 'stateCode is required' });
        }
        const data = await bbps.getCities(stateCode);
        res.json({ success: true, data });
    } catch (err) {
        console.error('[BBPS-ROUTE] getCities error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== Bill Payment UI Data ==========
router.get('/billerCategories', verifyToken, async (req, res) => {
    try {
        const data = await bbps.getBillerCategories();
        res.json({ success: true, data });
    } catch (err) {
        console.error('[BBPS-ROUTE] getBillerCategories error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/billerCode', verifyToken, async (req, res) => {
    try {
        const { categoryCode } = req.body;
        if (!categoryCode) {
            return res.status(400).json({ success: false, message: 'categoryCode is required' });
        }
        const data = await bbps.getBillerCode(categoryCode);
        res.json({ success: true, data });
    } catch (err) {
        console.error('[BBPS-ROUTE] getBillerCode error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== Biller Details (required parameters) ==========
router.post('/billerDetails', verifyToken, async (req, res) => {
    try {
        const { billerCategoryCode, billerCode } = req.body;
        if (!billerCategoryCode || !billerCode) {
            return res.status(400).json({ 
                success: false, 
                message: 'billerCategoryCode and billerCode are required' 
            });
        }
        const data = await bbps.getBillerDetails(billerCategoryCode, billerCode);
        res.json({ success: true, data });
    } catch (err) {
        console.error('[BBPS-ROUTE] getBillerDetails error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;