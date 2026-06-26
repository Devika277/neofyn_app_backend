const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/bbpsController');
const { protect } = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

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

module.exports = router;