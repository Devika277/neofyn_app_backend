// neofyn-backend/controllers/rechargeController.js
const rechargeService = require('../services/recharge/rechargeService');
const db = require('../config/db'); // adjust path to your db


// ─────────────────────────────────────────────
// GET OPERATOR LIST
// POST /api/recharge/operators
// ─────────────────────────────────────────────
exports.getOperatorList = async (req, res) => {
    try {
        const { serviceType = 'MBL' } = req.body;
        const result = await rechargeService.getOperatorList(serviceType);

        if (!result.success) {
            return res.status(200).json({
                success: false,
                message: result.error || 'Failed to fetch operator list',
                data: result.data || []
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Operator list fetched successfully',
            data: result.data
        });
    } catch (error) {
        console.error('❌ getOperatorList controller error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            data: []
        });
    }
};

// ─────────────────────────────────────────────
// GET CIRCLE LIST  (static – VimoPay has no circle API)
// GET /api/recharge/circles
// ─────────────────────────────────────────────
exports.getCircleList = async (req, res) => {
    try {
        const circles = rechargeService.getCircleList();
        return res.status(200).json({
            success: true,
            message: 'Circle list fetched successfully',
            data: circles
        });
    } catch (error) {
        console.error('❌ getCircleList controller error:', error.message);
        return res.status(500).json({ success: false, message: 'Internal server error', data: [] });
    }
};

// ─────────────────────────────────────────────
// GET SERVICE TYPE LIST
// GET /api/recharge/services
// ─────────────────────────────────────────────
exports.getServiceTypeList = async (req, res) => {
    try {
        const result = await rechargeService.getServiceTypeList();

        if (!result.success) {
            return res.status(200).json({
                success: false,
                message: result.error || 'Failed to fetch service types',
                data: result.data || []
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Service types fetched successfully',
            data: result.data
        });
    } catch (error) {
        console.error('❌ getServiceTypeList controller error:', error.message);
        return res.status(500).json({ success: false, message: 'Internal server error', data: [] });
    }
};

// ─────────────────────────────────────────────
// PROCESS RECHARGE
// POST /api/recharge
// ─────────────────────────────────────────────
exports.processRecharge = async (req, res) => {
    try {
        const userId = req.user.id;

        const {
            mobile,          // operatorNumber
            operatorCode,    // e.g. "JRE", "AIR" – from operator list API
            serviceType,     // e.g. "MBL", "DTH"
            amount,
            merchantRefId,   // unique ref per transaction (idempotency key from Flutter)
            lat,
            long,
            udf1 = '',
            udf2 = '',
            udf3 = '',
            testMode = false
        } = req.body;

        // ── Basic validation ──────────────────────────────────────────────
        const missing = [];
        if (!mobile)        missing.push('mobile');
        if (!operatorCode)  missing.push('operatorCode');
        if (!serviceType)   missing.push('serviceType');
        if (!amount)        missing.push('amount');
        if (!merchantRefId) missing.push('merchantRefId');
        if (!lat)           missing.push('lat');
        if (!long)          missing.push('long');

        if (missing.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missing.join(', ')}`
            });
        }

        if (!/^\d{10}$/.test(mobile)) {
            return res.status(400).json({
                success: false,
                message: 'Mobile number must be exactly 10 digits'
            });
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount < 10 || parsedAmount > 10000) {
            return res.status(400).json({
                success: false,
                message: 'Amount must be between ₹10 and ₹10,000'
            });
        }

        // ── Call service ──────────────────────────────────────────────────
        const result = await rechargeService.processRecharge(userId, {
            mobile,
            operatorCode,
            serviceType,
            amount: parsedAmount,
            merchantRefId,
            lat: String(lat),
            long: String(long),
            udf1,
            udf2,
            udf3,
            testMode
        });

        if (!result.success) {
            return res.status(200).json({
                success: false,
                message: result.message || 'Recharge failed',
                errorCode: result.errorCode || null,
                data: result.data || null
            });
        }

        return res.status(200).json({
            success: true,
            message: result.message || 'Recharge initiated successfully',
            // data: result.data
                data: {
        transactionId: result.transactionId,
        amount: result.amount,
        mobile: result.mobile,
        status: 'SUCCESS'
    }
        });

    } catch (error) {
        console.error('❌ processRecharge controller error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// ─────────────────────────────────────────────
// HANDLE VIMOPAY CALLBACK
// POST /api/recharge/callback  (PUBLIC – no auth middleware)
// VimoPay posts final txn status here
// ─────────────────────────────────────────────
exports.handleCallback = async (req, res) => {
    try {
        console.log('📩 VimoPay callback received:', JSON.stringify(req.body));

        const {
            txnId,
            txnStatus,
            txnStatusCode,
            merchantRefId,
            amount,
            operatorCode,
            serviceType,
            operatorNumber,
            operatorRefId,
            commission,
            finalCommission,
            tds,
            lat,
            long,
            udf1,
            udf2,
            udf3
        } = req.body;

        // merchantRefId is the primary key we stored during processRecharge
        if (!merchantRefId) {
            console.warn('⚠️  Callback missing merchantRefId');
            return res.status(400).json({
                successStatus: false,
                message: 'Missing merchantRefId',
                responseCode: '003'
            });
        }

        // Map VimoPay status codes → internal status
        // 000 = Success, 001 = Failed, 002 = Pending/InProgress
        let internalStatus;
        switch (txnStatusCode) {
            case '000': internalStatus = 'success';  break;
            case '001': internalStatus = 'failed';   break;
            case '002': internalStatus = 'pending';  break;
            default:    internalStatus = 'pending';
        }

        await rechargeService.handleCallback({
            txnId,
            txnStatus,
            txnStatusCode,
            internalStatus,
            merchantRefId,
            amount,
            operatorCode,
            serviceType,
            operatorNumber,
            operatorRefId,
            commission,
            finalCommission,
            tds
        });

        // VimoPay expects this exact acknowledgement
        return res.status(200).json({
            successStatus: true,
            message: 'Success',
            responseCode: '000'
        });

    } catch (error) {
        console.error('❌ handleCallback controller error:', error.message);
        // Still return 200 so VimoPay doesn't keep retrying
        return res.status(200).json({
            successStatus: true,
            message: 'Success',
            responseCode: '000'
        });
    }
};

// ─────────────────────────────────────────────
// GET RECHARGE HISTORY
// GET /api/recharge/history
// ─────────────────────────────────────────────
exports.getUserHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const limit  = parseInt(req.query.limit)  || 20;
        const offset = parseInt(req.query.offset) || 0;

        const result = await rechargeService.getUserHistory(userId, limit, offset);

        return res.status(200).json({
            success: true,
            message: 'History fetched successfully',
            data: result
        });
    } catch (error) {
        console.error('❌ getUserHistory controller error:', error.message);
        return res.status(500).json({ success: false, message: 'Internal server error', data: [] });
    }
};

    // controllers/rechargeController.js (add at the end)

// GET /api/recharge/receipt/:transactionId
exports.getRechargeReceipt = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const userId = req.user.id; // from auth middleware

        // Fetch the transaction from your database
        const transaction = await db.query(
            `SELECT id, user_id, amount, status, merchant_ref_id, operator_code, 
                    operator_number, created_at, provider_txn_id, commission
             FROM transactions 
             WHERE id = $1 AND user_id = $2`,
            [transactionId, userId]
        );

        if (transaction.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Transaction not found' });
        }

        const tx = transaction.rows[0];

        // Mask mobile number (show first 3, last 3 digits)
        const maskedMobile = tx.operator_number 
            ? tx.operator_number.replace(/(\d{3})\d+(\d{3})/, '$1****$2')
            : 'N/A';

        // Build receipt object as per RBI guidelines
        const receipt = {
            success: true,
            data: {
                // Unique identifiers
                transactionId: tx.id,
                merchantTransactionId: tx.merchant_ref_id,
                providerTransactionId: tx.provider_txn_id || 'Not available',
                
                // Amount & currency
                amount: parseFloat(tx.amount).toFixed(2),
                currency: 'INR',
                
                // Customer info (masked)
                customerMobile: maskedMobile,
                
                // Service details
                operator: tx.operator_code || 'Mobile Recharge',
                rechargeAmount: parseFloat(tx.amount).toFixed(2),
                
                // Date & time
                dateTime: new Date(tx.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                timestamp: tx.created_at,
                
                // Status
                status: tx.status.toUpperCase(),
                
                // Merchant details (your business)
                merchantName: 'Neofyn Digital Services',
                merchantSupport: 'support@neofyn.com | +91 98765 43210',
                
                // RBI mandatory disclaimers
                disclaimers: [
                    'This transaction has been successfully processed by Neofyn.',
                    'In case of any discrepancy, please contact customer support within 7 days.',
                    'Never share your OTP, PIN, or UPI password with anyone.',
                    'This receipt is system generated and does not require a signature.'
                ],
                policyText: 'Refunds, if any, will be processed as per the operator’s refund policy.'
            }
        };

        return res.json(receipt);
    } catch (error) {
        console.error('Receipt fetch error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
