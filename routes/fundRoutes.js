const express = require('express');
const router = express.Router();
const {
  submitRequest,
  getMyRequests,
  cancelRequest,
  getPendingRequests,
  getAllRequests,
  approveRequest,
  rejectRequest
} = require('../controllers/fundController');
const { protect } = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// ============================================
// USER ROUTES (Any authenticated user)
// ============================================

// Submit a new fund request
router.post('/request', protect, submitRequest);

// Get logged-in user's requests
router.get('/user', protect, getMyRequests);

// Cancel a pending request (user can cancel their own)
router.post('/cancel/:id', protect, cancelRequest);

// ============================================
// ADMIN ROUTES (Require admin privileges)
// ============================================

// Get all pending requests
router.get('/admin/pending', protect, adminMiddleware, getPendingRequests);

// Get all requests (optional status filter)
router.get('/admin/all', protect, adminMiddleware, getAllRequests);

// Approve a request (credits wallet)
router.post('/admin/approve/:id', protect, adminMiddleware, approveRequest);

// Reject a request
router.post('/admin/reject/:id', protect, adminMiddleware, rejectRequest);

module.exports = router;