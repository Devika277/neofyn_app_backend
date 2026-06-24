const express = require('express');
const router = express.Router();
const dmtController = require('../controllers/dmtController');
const { protect } = require('../middleware/authMiddleware');
const { isAdmin } = require('../middleware/adminMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

// ============================================================
// PUBLIC ROUTES (No authentication required)
// ============================================================

// Webhook – VimoPay posts directly
router.post('/callback', dmtController.dmtWebhook);

// ============================================================
// PROTECTED ROUTES (Authentication required)
// ============================================================
router.use(protect);

// ────────────────────────────────────────────────────────────
// MASTER DATA (no additional permissions)
// ────────────────────────────────────────────────────────────
router.get('/banks', dmtController.getBankList);
router.get('/states', dmtController.getStateList);
router.get('/cities', dmtController.getCityList);

// ────────────────────────────────────────────────────────────
// REMITTER (sender) endpoints
// ────────────────────────────────────────────────────────────

// ✅ Frontend calls POST /dmt/remitter/lookup
router.post('/remitter/lookup', dmtController.lookupRemitter);

// Legacy GET endpoint (kept for compatibility)
router.get('/check-phone', dmtController.checkPhoneExists);

// Registration & OTP verification (sender)
router.post('/remitter/register', dmtController.registerRemitter);
router.post('/remitter/verify-otp', dmtController.verifySenderOtp);

// Fetch remitters
router.get('/remitters', dmtController.getRemitters);
router.get('/remitter/:remitterId', dmtController.getRemitterDetails);

// ────────────────────────────────────────────────────────────
// BENEFICIARY endpoints
// ────────────────────────────────────────────────────────────

// Frontend: POST /dmt/beneficiary/add
router.post('/beneficiary/add', dmtController.addBeneficiary);
// Alternative (legacy) endpoint
router.post('/beneficiary', dmtController.addBeneficiary);

// Frontend: GET /dmt/beneficiary/:remitterId
router.get('/beneficiary/:remitterId', dmtController.getBeneficiaries);
// Plural version (legacy)
router.get('/beneficiaries/:remitterId', dmtController.getBeneficiaries);

// Delete beneficiary
router.delete('/beneficiary/:beneficiaryId', dmtController.deleteBeneficiary);

// ────────────────────────────────────────────────────────────
// TRANSFER (TPIN‑only – no OTP request route)
// ────────────────────────────────────────────────────────────
router.post('/transfer', requirePermission('dmt.transfer'), dmtController.createDmtTransfer);

// ────────────────────────────────────────────────────────────
// TRANSACTION HISTORY
// ────────────────────────────────────────────────────────────
router.get('/history', dmtController.getDmtTransactions);

// ────────────────────────────────────────────────────────────
// ADMIN ROUTES
// ────────────────────────────────────────────────────────────
router.get('/admin/transactions', isAdmin, dmtController.adminGetDmtTransactions);
router.get('/admin/all', isAdmin, dmtController.adminGetAllDmtTransactions);


module.exports = router;