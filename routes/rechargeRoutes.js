const express = require('express');
const router = express.Router();
const rechargeController = require('../controllers/rechargeController');
const { protect } = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

/**
 * Recharge Routes
 * Base path: /api/recharge
 */

/**
 * POST /api/recharge/callback
 * Webhook callback from provider (public endpoint, no auth)
 * MUST be before the auth middleware
 */
router.post('/callback', rechargeController.handleCallback);

// All other recharge routes require authentication
router.use(protect);

/**
 * POST /api/recharge
 * Process a mobile recharge
 * Body: { mobile, operator, circle, amount, idempotencyKey, testMode, lat, long }
 */
router.post('/', requirePermission('recharge.transaction'), rechargeController.processRecharge);

/**
 * GET /api/recharge/history
 * Get user's recharge history
 * Query: ?limit=50&offset=0
 */
router.get('/history', rechargeController.getUserHistory);

/**
 * GET /api/recharge/plans
 * Get active recharge plans for the selected operator and circle (state)
 * Query: ?operator=JIO&circle=Tamil%20Nadu (circle defaults to 'ALL' if omitted)
 */
router.get('/plans', rechargeController.getPlans);

/**
 * GET /api/recharge/admin/all
 * Admin: Get all recharges with filters
 * Query: ?status=&operator=&search=&limit=&offset=
 */
router.get('/admin/all', protect, adminMiddleware, rechargeController.getAllRecharges);

module.exports = router;