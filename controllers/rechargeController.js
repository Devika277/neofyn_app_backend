// backend/controllers/rechargeController.js
const rechargeService = require('../services/recharge/rechargeService');
const logger = require('../utils/logger');
const crypto = require('crypto');
const db = require('../config/db');
const walletService = require('../services/walletService');

class RechargeController {
    async processRecharge(req, res) {
        try {
            const userId = req.user.id;
            const { mobile, operator, serviceType = 'MBL', amount, idempotencyKey, testMode, lat, long } = req.body;
            if (!mobile || !operator || !amount) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields: mobile, operator, amount'
                });
            }

            if (!/^\d{10}$/.test(mobile)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid mobile number. Must be 10 digits.'
                });
            }

            const maxAmount = serviceType === 'ELE' ? 100000 : 10000;
            if (amount < 10 || amount > maxAmount) {
                return res.status(400).json({
                    success: false,
                    error: `Amount must be between ₹10 and ₹${maxAmount.toLocaleString()}`
                });
            }

            logger.info(`RechargeController: Processing recharge for user ${userId}, mobile: ${mobile}`);

            const result = await rechargeService.processRecharge(
                userId,
                { mobile, operator, serviceType, amount: parseFloat(amount), testMode, lat, long },
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

        } catch (error) {
            logger.error('RechargeController: Error processing recharge', { error: error.message });
            if (error.message.includes('Insufficient balance')) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({
                success: false,
                error: 'Failed to process recharge. Please try again.'
            });
        }
    }

    /**
     * GET /api/recharge/plans
     * Fetch recharge plans filtered by operator and circle (state).
     * Query params: operator (required), circle (optional, defaults to 'ALL')
     */
    async getPlans(req, res) {
        try {
            const { operator, circle } = req.query;

            if (!operator) {
                return res.status(400).json({
                    success: false,
                    error: 'Operator is required'
                });
            }

            const circleFilter = circle || 'ALL';

            const plans = await rechargeService.getPlansByOperatorAndCircle(operator, circleFilter);

            // Group plans by category for frontend consumption
            const groupedPlans = plans.reduce((acc, plan) => {
                const category = plan.category || 'others';
                if (!acc[category]) acc[category] = [];
                acc[category].push(plan);
                return acc;
            }, {});

            return res.status(200).json({
                success: true,
                plans: groupedPlans
            });
        } catch (error) {
            logger.error('RechargeController: Error fetching plans', { error: error.message });
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch recharge plans'
            });
        }
    }

    async getUserHistory(req, res) {
        try {
            const userId = req.user.id;
            const limit = parseInt(req.query.limit) || 50;
            const offset = parseInt(req.query.offset) || 0;
            const history = await rechargeService.getUserHistory(userId, limit, offset);
            return res.status(200).json({
                success: true,
                data: history,
                pagination: { limit, offset, count: history.length }
            });
        } catch (error) {
            logger.error('RechargeController: Error fetching user history', { error: error.message });
            return res.status(500).json({ success: false, error: 'Failed to fetch recharge history' });
        }
    }

    async getAllRecharges(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 50;
            const offset = parseInt(req.query.offset) || 0;
            const filters = {
                status: req.query.status,
                operator: req.query.operator,
                search: req.query.search
            };
            const result = await rechargeService.getAllRecharges(filters, limit, offset);
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
            logger.error('RechargeController: Error fetching all recharges', { error: error.message });
            return res.status(500).json({ success: false, error: 'Failed to fetch recharges' });
        }
    }

    /**
     * POST /api/recharge/callback
     * Vimopay posts final transaction status here.
     * CRITICAL RULES:
     *   1. ALWAYS return HTTP 200 — if we return anything else, Vimopay retries forever
     *   2. ALWAYS wrap in try/catch — never let a crash reach the response
     *   3. Check merchantRefId exists before using it
     *   4. Use lowercase status values only
     */
    async handleCallback(req, res) {
        // ✅ RULE 1: Declare ack first — this is ALWAYS returned at the bottom
        const ack = { successStatus: true, message: 'Success', responseCode: '000' };

        try {
            const isMock = process.env.PAYMENT_MODE === 'mock';

            // ── Mock callback (original logic unchanged) ─────────────────────
            if (isMock) {
                const { txn_id, status, amount, hash } = req.body;

                const secret = process.env.CALLBACK_SECRET;
                if (!secret) {
                    logger.error('CALLBACK_SECRET not set in environment');
                    return res.status(200).json(ack);
                }

                const expectedHash = crypto
                    .createHash('md5')
                    .update(txn_id + amount + secret)
                    .digest('hex');

                if (hash !== expectedHash) {
                    logger.warn(`Invalid callback signature for txn ${txn_id}`);
                    return res.status(200).json(ack);
                }

                const transaction = await db.query(
                    'SELECT id, user_id, plan_amount, status FROM transactions WHERE provider_txn_id = $1',
                    [txn_id]
                );

                if (transaction.rows.length === 0) {
                    logger.error(`[MOCK CALLBACK] Transaction not found: ${txn_id}`);
                    return res.status(200).json(ack);
                }

                const txn = transaction.rows[0];
                if (txn.status !== 'pending') {
                    logger.info(`[MOCK CALLBACK] Already processed: ${txn_id}`);
                    return res.status(200).json(ack);
                }

                const newStatus = status === 'success' ? 'success' : 'failed';
                await db.query(
                    'UPDATE transactions SET status = $1, updated_at = NOW() WHERE id = $2',
                    [newStatus, txn.id]
                );

                if (newStatus === 'failed') {
                    await walletService.addMoney(
                        txn.user_id,
                        txn.plan_amount,
                        `Refund from callback for transaction ${txn.id}`,
                        null
                    );
                    logger.info(`[MOCK CALLBACK] Refunded ₹${txn.plan_amount} for txn ${txn.id}`);
                }

                return res.status(200).json(ack);
            }

            // ── Vimopay callback (sandbox / live) ────────────────────────────
            const {
                txnId,
                txnStatusCode,
                txnStatus,
                merchantRefId,
                amount,
                operatorRefId,
                commission,
                finalCommission,
                tds
            } = req.body;

            logger.info('[CALLBACK RECEIVED]', {
                merchantRefId,
                txnStatus,
                txnStatusCode,
                txnId
            });

            if (!txnStatusCode || !merchantRefId) {
                logger.error('[CALLBACK] Missing required fields', req.body);
                return res.status(200).json(ack);
            }

            const txnResult = await db.query(
                `SELECT id, user_id, plan_amount, status
                 FROM transactions
                 WHERE merchant_ref_id = $1
                 LIMIT 1`,
                [String(merchantRefId)]
            );

            if (!txnResult.rows || txnResult.rows.length === 0) {
                logger.error('[CALLBACK] Transaction not found for merchantRefId:', merchantRefId);
                return res.status(200).json(ack);
            }

            const row = txnResult.rows[0];

            if (row.status === 'success' || row.status === 'failed') {
                logger.info('[CALLBACK] Already processed, skipping:', merchantRefId);
                return res.status(200).json(ack);
            }

            const statusMap = {
                '000': 'success',
                '001': 'failed',
                '002': 'pending',
                '003': 'failed',
                '004': 'pending'
            };
            const newStatus = statusMap[txnStatusCode] || 'pending';

            // ✅ FIXED: cast api_response to jsonb to avoid type mismatch error
            await db.query(
                `UPDATE transactions
                 SET status          = $1,
                     provider_txn_id = $2,
                     api_response    = COALESCE(api_response::jsonb, '{}'::jsonb) || $3::jsonb,
                     updated_at      = NOW()
                 WHERE id = $4`,
                [
                    newStatus,
                    txnId || null,
                    JSON.stringify({
                        operatorRefId:   operatorRefId   || null,
                        commission:      commission      || 0,
                        finalCommission: finalCommission || 0,
                        tds:             tds             || 0,
                        txnStatus:       txnStatus       || null
                    }),
                    row.id
                ]
            );

            logger.info(`[CALLBACK] Status updated to: ${newStatus} for txn id: ${row.id}`);

            if ((txnStatusCode === '001' || txnStatusCode === '003') && row.user_id) {
                const refundAmount = parseFloat(amount || row.plan_amount || 0);
                await walletService.addMoney(
                    row.user_id,
                    refundAmount,
                    `Recharge refund - Vimopay txn ${txnId || merchantRefId}`,
                    null
                );
                logger.info(`[CALLBACK] Refunded ₹${refundAmount} for txn id: ${row.id}`);
            }


        } catch (error) {
            logger.error('[CALLBACK] Unhandled error:', error.message);
            logger.error('[CALLBACK] Stack:', error.stack);
            logger.error('[CALLBACK] Body was:', JSON.stringify(req.body));
            // fall through – return ack
        }

        return res.status(200).json(ack);
    }
}

module.exports = new RechargeController();