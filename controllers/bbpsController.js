const { v4: uuidv4 } = require('uuid');
const paymentService = require('../services/BBPS/bbpsService');
const logger = require('../utils/logger');
const crypto = require('crypto');
const db = require('../config/db');
const walletService = require('../services/walletService');

// Helper to get user's BBPS merchant code from merchant_onboarding table
async function getMerchantInfo(userId) {
    const result = await db.query(
        `SELECT bbps_merchant_code, latitude, longitude 
         FROM merchant_onboarding 
         WHERE user_id = $1 AND status = 'active'`,
        [userId]
    );
    if (!result.rows[0]) return null;
    return {
        merchantCode: result.rows[0].bbps_merchant_code,
        latitude: result.rows[0].latitude,
        longitude: result.rows[0].longitude,
    };
}

/**
 * Payment Controller – Supports two‑step BBPS flow:
 *   step = 'fetch' → get bill details
 *   step = 'pay'   → complete payment
 */
class PaymentController {
    /**
     * POST /api/payments/process
     * Unified endpoint for both fetch and pay steps.
     * Request body:
     *   { step: 'fetch', serviceType, customerId, additionalData, idempotencyKey }
     *   or
     *   { step: 'pay', transactionId, serviceType, customerId, additionalData, idempotencyKey }
     */
    async processPayment(req, res) {
        try {
            const userId = req.user.id;
            const { step, serviceType, customerId, amount, additionalData, idempotencyKey, transactionId } = req.body;

            // Basic validation
            if (!step || !['fetch', 'pay'].includes(step)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid or missing "step". Use "fetch" or "pay".'
                });
            }

            if (step === 'fetch') {
                // Fetch step: need serviceType and customerId
                if (!serviceType || !customerId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Missing required fields for fetch: serviceType, customerId'
                    });
                }
                if (customerId.length < 3) {
                    return res.status(400).json({
                        success: false,
                        error: 'Consumer number must be at least 3 characters'
                    });
                }

                // Get user's merchant code
                const merchantInfo = await getMerchantInfo(userId);
    if (!merchantInfo) {
        return res.status(400).json({
            success: false,
            error: 'Merchant not onboarded. Please complete BBPS onboarding first.'
        });
    }

                // Merge merchant code into additionalData
                const enrichedAdditionalData = {
        ...(additionalData || {}),
        merchantCode: merchantInfo.merchantCode,
        lat: merchantInfo.latitude || '0.0',
        long: merchantInfo.longitude || '0.0',
    };

                logger.info(`PaymentController: Fetch bill for user ${userId}, service: ${serviceType}, customer: ${customerId}`);

                const result = await paymentService.processPayment(
                    userId,
                    {
                        step: 'fetch',
                        serviceType,
                        customerId,
                        additionalData: enrichedAdditionalData,
                    },
                    idempotencyKey
                );

                return res.status(200).json({
                    success: result.success,
                    message: result.message,
                    data: {
                        transactionId: result.transactionId,
                        fetchBillResult: result.fetchBillResult
                    }
                });
            }

            if (step === 'pay') {
    // Pay step: need transactionId (from fetch)
    if (!transactionId) {
        return res.status(400).json({
            success: false,
            error: 'Missing transactionId for pay step'
        });
    }

    // ✅ Extract the amount sent by the frontend
    const payAmount = req.body.amount ? parseFloat(req.body.amount) : undefined;

    // Get user's merchant code (required for pay step too)
    const merchantInfo = await getMerchantInfo(userId);
    if (!merchantInfo) {
        return res.status(400).json({
            success: false,
            error: 'Merchant not onboarded. Please complete BBPS onboarding first.'
        });
    }

    const enrichedAdditionalData = {
        ...(additionalData || {}),
        merchantCode: merchantInfo.merchantCode,
        lat: merchantInfo.latitude || '0.0',
        long: merchantInfo.longitude || '0.0',
    };

    logger.info(`PaymentController: Pay bill for user ${userId}, transactionId: ${transactionId}, amount: ${payAmount}`);

    const result = await paymentService.processPayment(
        userId,
        {
            step: 'pay',
            transactionId,
            serviceType: serviceType || null,
            customerId: customerId || null,
            amount: payAmount,                     // ✅ now passed correctly
            additionalData: enrichedAdditionalData,
        },
        idempotencyKey
    );

    return res.status(200).json({
        success: result.success,
        message: result.message,
        data: {
            transactionId: result.transactionId,
            provider: result.provider,
            refunded: result.refunded
        }
    });
}
        } catch (error) {
    logger.error('PaymentController: Error processing payment', {
        error: error.message,
        stack: error.stack,
    });

    // Existing user‑friendly checks
    if (error.message.includes('Insufficient balance') ||
        error.message.includes('not found or inactive') ||
        error.message.includes('Merchant is not onboarded') ||
        error.message.includes('Please complete the fetch step first')) {
        return res.status(400).json({
            success: false,
            error: error.message,
        });
    }

    // ✅ NEW: Catch VimoPay fetch / validation errors
    if (error.message.includes('Incorrect / invalid') ||
        error.message.includes('Fetch bill failed') ||
        error.message.includes('validation failed')) {
        return res.status(400).json({
            success: false,
            error: error.message,
        });
    }

    // Fallback for any other unexpected error
    return res.status(500).json({
        success: false,
        error: 'Failed to process payment. Please try again.',
    });
}
    }
    /**
     * GET /api/payments/history
     * Supports optional query parameters:
     *   - serviceType (string)
     *   - startDate (YYYY-MM-DD)
     *   - endDate   (YYYY-MM-DD)
     *   - limit, offset
     */
 async getUserHistory(req, res) {
    try {
        const userId = req.user.id;
        const serviceType = req.query.serviceType || null;
        const startDate = req.query.startDate || null;
        const endDate = req.query.endDate || null;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        // Validate date format if provided
        if (startDate && isNaN(Date.parse(startDate))) {
            return res.status(400).json({
                success: false,
                error: 'Invalid startDate format. Please use ISO 8601 format (YYYY-MM-DD)'
            });
        }

        if (endDate && isNaN(Date.parse(endDate))) {
            return res.status(400).json({
                success: false,
                error: 'Invalid endDate format. Please use ISO 8601 format (YYYY-MM-DD)'
            });
        }

        // Validate limit and offset
        if (limit < 1 || limit > 100) {
            return res.status(400).json({
                success: false,
                error: 'Limit must be between 1 and 100'
            });
        }

        if (offset < 0) {
            return res.status(400).json({
                success: false,
                error: 'Offset must be greater than or equal to 0'
            });
        }

        const history = await paymentService.getUserHistory(
            userId,
            serviceType,
            startDate,
            endDate,
            limit,
            offset
        );

        // Check if history exists
        if (!history || history.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No payment history found for the specified criteria'
            });
        }

        // Fetch user details (business_name and phone)
        const user = await db.query(
            'SELECT business_name, phone FROM users WHERE id = $1',
            [userId]
        );

        const userDetails = user.rows[0] || {};

        // Enhance history data with user details
        const enhancedHistory = history.map(record => ({
            ...record,
            business_name: userDetails.business_name || null,
            phone: userDetails.phone || null
        }));

        return res.status(200).json({
            success: true,
            data: enhancedHistory,
            pagination: {
                limit,
                offset,
                count: enhancedHistory.length,
                hasMore: enhancedHistory.length === limit
            }
        });
    } catch (error) {
        logger.error('PaymentController: Error fetching user history', { 
            error: error.message,
            stack: error.stack,
            userId: req.user?.id
        });
        
        // Handle specific database/service errors
        if (error.message.includes('serviceType')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid service type provided'
            });
        }

        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            return res.status(503).json({
                success: false,
                error: 'Database connection error. Please try again later.'
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Failed to fetch payment history. Please try again later.'
        });
    }
}

    /**
     * GET /api/payments/transaction/:id
     */
    async getTransactionById(req, res) {
        try {
            const userId = req.user.id;
            const transactionId = parseInt(req.params.id);

            if (isNaN(transactionId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid transaction ID'
                });
            }

            const transaction = await paymentService.getTransactionById(userId, transactionId);

            return res.status(200).json({
                success: true,
                data: transaction
            });
        } catch (error) {
            logger.error('PaymentController: Error fetching transaction', { error: error.message });

            if (error.message === 'Transaction not found') {
                return res.status(404).json({
                    success: false,
                    error: 'Transaction not found'
                });
            }

            return res.status(500).json({
                success: false,
                error: 'Failed to fetch transaction details'
            });
        }
    }

    /**
     * GET /api/payments/services
     */
    async getActiveServices(req, res) {
        try {
            const services = await paymentService.getActiveServices();

            return res.status(200).json({
                success: true,
                data: services
            });
        } catch (error) {
            logger.error('PaymentController: Error fetching services', { error: error.message });
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch services'
            });
        }
    }

    /**
     * GET /api/payments/admin/all
     */
    async getAllPayments(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 50;
            const offset = parseInt(req.query.offset) || 0;
            const filters = {
                serviceType: req.query.serviceType,
                status: req.query.status,
                search: req.query.search
            };

            const result = await paymentService.getAllPayments(filters, limit, offset);

            return res.status(200).json({
                success: true,
                data: result.transactions,
                pagination: {
                    limit: result.limit,
                    offset: result.offset,
                    total: result.total,
                    count: result.transactions.length
                }
            });
        } catch (error) {
            logger.error('PaymentController: Error fetching all payments', { error: error.message });
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch payments'
            });
        }
    }

    /**
     * POST /api/payments/callback
     * Handle provider callback (webhook) with signature verification
     */
    async handleCallback(req, res) {
        try {
            const { txn_id, status, amount, hash } = req.body;

            // 1. Verify signature
            const secret = process.env.CALLBACK_SECRET;
            if (!secret) {
                logger.error('CALLBACK_SECRET not set in environment');
                return res.status(500).json({ success: false, error: 'Server configuration error' });
            }
            const expectedHash = crypto.createHash('md5').update(txn_id + amount + secret).digest('hex');
            if (hash !== expectedHash) {
                logger.warn(`Invalid callback signature for txn ${txn_id}`);
                return res.status(401).json({ success: false, error: 'Invalid signature' });
            }

            // 2. Find transaction by provider_txn_id
            const transaction = await db.query(
                'SELECT id, user_id, plan_amount, status FROM transactions WHERE provider_txn_id = $1',
                [txn_id]
            );
            if (transaction.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Transaction not found' });
            }

            const txn = transaction.rows[0];
            if (txn.status !== 'pending') {
                return res.status(200).json({ success: true, message: 'Already processed' });
            }

            // 3. Update transaction status
            const newStatus = status === 'success' ? 'success' : 'failed';
            await db.query(
                'UPDATE transactions SET status = $1, updated_at = NOW() WHERE id = $2',
                [newStatus, txn.id]
            );

            // 4. If failed, refund wallet
            if (newStatus === 'failed') {
                await walletService.addMoney(
                    txn.user_id,
                    txn.plan_amount,
                    `Refund from callback for payment transaction ${txn.id}`,
                    null
                );
                logger.info(`Refunded ₹${txn.plan_amount} for failed callback payment transaction ${txn.id}`);
            }

            return res.status(200).json({ success: true, message: 'Callback processed' });
        } catch (error) {
            logger.error('Callback error:', error);
            return res.status(500).json({ success: false, error: 'Internal error' });
        }
    }
}

module.exports = new PaymentController();