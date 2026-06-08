// backend/routes/payoutRoutes.js
const express = require('express');
const router = express.Router();
const payoutService = require('../services/payout/payoutService');
const PayoutTransaction = require('../models/PayoutTransaction'); // <-- add this
const pool = require('../config/db');


// ✅ Debug middleware
router.use((req, res, next) => {
    console.log('=== PAYOUT ROUTE DEBUG ===');
    console.log('Time:', new Date().toISOString());
    console.log('Method:', req.method);
    console.log('Path:', req.path);
    console.log('Full URL:', req.originalUrl);
    console.log('Auth Header:', req.headers.authorization ? 'PRESENT' : 'MISSING');
    if (req.headers.authorization) {
        console.log('Auth Header Value:', req.headers.authorization.substring(0, 50) + '...');
    }
    console.log('=========================');
    next();
});

// Auth middleware
const verifyAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
};

// ✅ Master Data Endpoints
router.get('/banks', verifyAuth, async (req, res) => {
    try {
        const result = await payoutService.getBankList();
        res.json({
            success: result.successStatus || false,
            message: result.message || 'Success',
            data: result.data || []
        });
    } catch (error) {
        console.error('Error fetching banks:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/purposes', verifyAuth, async (req, res) => {
    try {
        const result = await payoutService.getPurposeList();
        res.json({
            success: result.successStatus || false,
            message: result.message || 'Success',
            data: result.data || []
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/states', verifyAuth, async (req, res) => {
    try {
        const result = await payoutService.getStateList();
        res.json({
            success: result.successStatus || false,
            message: result.message || 'Success',
            data: result.data || []
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ✅ Payout Initiation (with validation, DB storage, queued response)
router.post('/initiate', verifyAuth, async (req, res) => {
    try {
        const { body } = req;
        
        // 1. Required fields validation
        const required = ['amount', 'beneficiaryBank', 'paymentPurpose', 'beneficiaryAccountNumber', 
                          'beneficiaryIFSC', 'beneficiaryMobileNumber', 'beneficiaryName', 'beneficiaryLocation'];
        const missing = required.filter(f => !body[f]);
        if (missing.length) {
            return res.status(400).json({ success: false, message: `Missing: ${missing.join(', ')}` });
        }
        
        // 2. Minimum amount validation (₹100)
        const amount = parseFloat(body.amount);
        if (isNaN(amount) || amount < 100) {
            return res.status(400).json({ success: false, message: 'Amount must be at least ₹100' });
        }
        
        // 3. Payment mode validation: only IMPS/NEFT, uppercase
        let paymentMode = (body.paymentMode || 'imps').toUpperCase();
        if (!['IMPS', 'NEFT'].includes(paymentMode)) {
            return res.status(400).json({ success: false, message: 'Payment mode must be IMPS or NEFT' });
        }
        body.paymentMode = paymentMode;
        
        // 4. Call payout service (it generates merchantRefId if missing)
        const payoutResp = await payoutService.initiatePayout(body);
        
        // 5. Store transaction in database
        const merchantRefId = payoutResp.merchantRefId;
        await PayoutTransaction.create({
            user_id: req.user.id, // assuming JWT contains user id
            merchant_ref_id: merchantRefId,
            amount: amount,
            beneficiary_bank: body.beneficiaryBank,
            payment_purpose: body.paymentPurpose,
            payment_mode: paymentMode,
            beneficiary_account_number: body.beneficiaryAccountNumber,
            beneficiary_ifsc: body.beneficiaryIFSC,
            beneficiary_mobile: body.beneficiaryMobileNumber,
            beneficiary_name: body.beneficiaryName,
            beneficiary_location: body.beneficiaryLocation,
            // txn_id: initialTxnId,   // store if available
            // vimopay_response: payoutResp.rawData || null ,
            lat: body.lat || '28.7041',
            long: body.long || '77.1025',
            udf1: body.udf1,
            udf2: body.udf2,
            udf3: body.udf3
        });
        
        // 6. Return queued status to Flutter (not final success)
        res.json({
            success: true,
            message: 'Payout queued for processing',
            data: {
                merchantRefId: merchantRefId,
                status: 'QUEUED'
            }
        });
    } catch (error) {
        console.error('Payout initiation error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ✅ Transaction status endpoint
router.get('/status/:merchantRefId', verifyAuth, async (req, res) => {
    try {
        const tx = await PayoutTransaction.findByMerchantRef(req.params.merchantRefId);
        if (!tx) {
            return res.status(404).json({ success: false, message: 'Transaction not found' });
        }
        
        // Fetch user details (remitter) from your users table
        const userId = req.user.id; // assuming JWT contains user id
        const userQuery = await pool.query(
            `SELECT first_name, phone FROM users WHERE id = $1`,
            [userId]
        );
        const user = userQuery.rows[0];
        
        // Return combined data
        res.json({
            success: true,
            data: {
                // Transaction details
                merchantRefId: tx.merchant_ref_id,
                status: tx.status,
                txnId: tx.txn_id,
                amount: parseFloat(tx.amount),
                createdAt: tx.created_at,
                updatedAt: tx.updated_at,
                // Beneficiary details
                beneficiaryName: tx.beneficiary_name,
                beneficiaryAccountNumber: tx.beneficiary_account_number,
                beneficiaryIFSC: tx.beneficiary_ifsc,
                beneficiaryMobile: tx.beneficiary_mobile,
                beneficiaryBank: tx.beneficiary_bank,
                beneficiaryLocation: tx.beneficiary_location,
                paymentPurpose: tx.payment_purpose,
                paymentMode: tx.payment_mode,
                // Remitter details (current user)
                remitterName: user?.first_name || 'N/A',
                remitterPhone: user?.phone || 'N/A'
            }
        });
    } catch (error) {
        console.error('Status fetch error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ✅ VimoPay Callback endpoint (no auth – public)
router.post('/callback', async (req, res) => {
    try {
        const callbackData = req.body;
        console.log('📞 VimoPay Callback received:', JSON.stringify(callbackData));
        
        // Expected fields from VimoPay (adjust keys as per actual callback)
        const { merchantRefId, txnStatus, txnId, status, referenceId } = callbackData;
        const refId = merchantRefId || callbackData.merchant_ref_id;
        
        if (!refId) {
            console.error('Callback missing merchantRefId');
            return res.status(400).json({ successStatus: false, message: 'Missing merchantRefId' });
        }
        
        // Map VimoPay status to internal status
        let internalStatus = 'QUEUED';
        const statusText = (txnStatus || status || '').toUpperCase();
        if (statusText === 'SUCCESS' || statusText === 'COMPLETED') internalStatus = 'SUCCESS';
        else if (statusText === 'FAILED' || statusText === 'REJECTED') internalStatus = 'FAILED';
        
        const finalTxnId = txnId || referenceId;
        
        await PayoutTransaction.updateStatus(refId, internalStatus, finalTxnId, callbackData);
        
        // Acknowledge receipt as per VimoPay PDF
        res.json({ successStatus: true, message: 'Success', responseCode: '000' });
    } catch (error) {
        console.error('Callback processing error:', error);
        res.status(500).json({ successStatus: false, message: 'Internal error' });
    }
});


// GET /api/payout/history – list all payouts for the authenticated user
router.get('/history', verifyAuth, async (req, res) => {
    try {
        const userId = req.user.id; // assuming JWT contains user.id
        const transactions = await PayoutTransaction.getUserTransactions(userId);
        res.json({
            success: true,
            data: transactions.map(tx => ({
                merchantRefId: tx.merchant_ref_id,
                amount: parseFloat(tx.amount),
                status: tx.status,
                txnId: tx.txn_id,
                beneficiaryName: tx.beneficiary_name,
                beneficiaryBank: tx.beneficiary_bank,
                createdAt: tx.created_at,
                paymentMode: tx.payment_mode
            }))
        });
    } catch (error) {
        console.error('History fetch error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


console.log('✅ Payout routes registered:');
router.stack.forEach((r) => {
    if (r.route && r.route.path) console.log(`   ${Object.keys(r.route.methods)} /api/payout${r.route.path}`);
});

module.exports = router;