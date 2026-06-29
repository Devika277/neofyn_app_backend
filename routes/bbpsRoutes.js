const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/bbpsController');
const { protect } = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const ctrl = require('../controllers/bbpsOnboardingController');
const bbps = require('../providers/bbps/bbpsBillPay');
const jwt = require('jsonwebtoken');
const db = require('../config/db');


/**
 * Payment Routes
 * Base path: /api/payments
 */

// Public endpoints (no authentication required)
router.post('/callback', paymentController.handleCallback);
router.get('/services', paymentController.getActiveServices);

// All other payment routes require authentication
router.use(protect);

/**
 * POST /api/payments
 * Process any bill payment
 * Body: { serviceType, amount, customerId, additionalData, idempotencyKey, testMode }
 */
router.post('/', paymentController.processPayment);

/**
 * GET /api/payments/history
 * Get user's payment history
 * Query: ?serviceType=&limit=50&offset=0
 */
router.get('/history', paymentController.getUserHistory);

/**
 * GET /api/payments/transaction/:id
 * Get single transaction details
 */
router.get('/transaction/:id', paymentController.getTransactionById);

/**
 * GET /api/payments/admin/all
 * Admin: Get all payments with filters
 * Query: ?serviceType=&status=&search=&limit=&offset=
 * Requires admin privileges
 */
router.get('/admin/all', protect, adminMiddleware, paymentController.getAllPayments);


// =====================================================
// ISOLATED JWT VERIFICATION FOR BBPS ROUTES ONLY
// =====================================================
const verifyToken = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  
  console.log('[BBPS-AUTH] Received token:', token ? token.substring(0, 50) + '...' : 'undefined');
  console.log('[BBPS-AUTH] JWT_SECRET used:', process.env.JWT_SECRET ? 'set' : 'MISSING');
  
  if (!token) {
    return res.status(401).json({ success: false, error: 'Not authorized, no token' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('[BBPS-AUTH] Decoded payload:', decoded);
    
    const user = await db.query('SELECT id, role, email, phone FROM users WHERE id = $1', [decoded.id]);
    console.log('[BBPS-AUTH] User found:', user.rows.length > 0);
    
    if (user.rows.length === 0) {
      console.log('[BBPS-AUTH] User not found in database');
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    
    req.user = user.rows[0];
    console.log('[BBPS-AUTH] Authentication successful, calling next()');
    next();  // ✅ This must be called
  } catch (error) {
    console.error('[BBPS-AUTH] JWT verification failed:', error.message);
    return res.status(401).json({ success: false, error: 'Token is not valid' });
  }
};

// ========== Onboarding & Status ==========
router.post('/merchant/onboard', verifyToken, ctrl.onboard);
router.get('/merchant/status/:userId', verifyToken, ctrl.getStatus);

// ========== Dynamic Data for Onboarding ==========
router.get('/states', verifyToken, async (req, res) => {
    try {
        const data = await bbps.getStates();
        res.json({ success: true, data });
    } catch (err) {
        res.json({ success: false, data: [], message: err.message });
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
        res.json({ success: false, data: [], message: err.message });
    }
});

// ========== Bill Payment UI Data ==========
// ✅ ADD THIS ROUTE
router.get('/billerCategories', verifyToken, async (req, res) => {
    try {
        console.log('[BBPS-ROUTE] billerCategories called');
        const data = await bbps.getBillerCategories();
        console.log('[BBPS-ROUTE] billerCategories success, items:', data?.length);
        res.json({ success: true, data });
    } catch (err) {
        console.error('[BBPS-ROUTE] billerCategories ERROR:', err.message);
        res.json({ success: false, data: [], message: err.message });
    }
});

// ✅ ADD THIS ROUTE
router.post('/billerCode', verifyToken, async (req, res) => {
    try {
        const { categoryCode } = req.body;
        if (!categoryCode) {
            return res.status(400).json({ success: false, message: 'categoryCode is required' });
        }
        const data = await bbps.getBillerCode(categoryCode);
        res.json({ success: true, data });
    } catch (err) {
        res.json({ success: false, data: [], message: err.message });
    }
});

// ✅ ADD THIS ROUTE
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
        res.json({ success: false, data: null, message: err.message });
    }
});

module.exports = router;