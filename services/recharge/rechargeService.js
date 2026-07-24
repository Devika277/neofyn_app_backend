// backend/services/rechargeService.js
const { v4: uuidv4 } = require('uuid');
const db = require('../../config/db');
const logger = require('../../utils/logger');
const walletService = require('../walletService');
const providerRouter = require('../../services/providerRouter');
const commissionEngine = require('../Commission/commissionEngine');
const { processCommission } = require('../Commission/commissionService');


class RechargeService {
    async processRecharge(userId, rechargeData, idempotencyKey = null) {
        const { mobile, operator, amount, testMode, serviceType, lat, long } = rechargeData;

        const client = await db.connect();
        const startTime = Date.now();
        let transactionId = null;
        let merchantRefId = null;

        try {
            await client.query('BEGIN');

            // Idempotency check
            if (idempotencyKey) {
                const existing = await client.query(
                    `SELECT id, status, provider_txn_id, plan_amount
                     FROM transactions
                     WHERE idempotency_key = $1 AND user_id = $2`,
                    [idempotencyKey, userId]
                );
                if (existing.rows.length > 0) {
                    const tx = existing.rows[0];
                    await client.query('ROLLBACK');
                    logger.info(`RechargeService: Duplicate request prevented for key ${idempotencyKey}`);
                                       return {
                        success: tx.status === 'success' || tx.status === 'pending',
                        status: tx.status,
                        message: tx.status === 'success' ? 'Recharge already processed' : 'Recharge previously failed',
                        transactionId: tx.id,
                        provider: tx.provider_txn_id,
                        refunded: tx.status === 'failed'
                    };
                    // return {
                    //     success: tx.status === 'success',
                    //     message: tx.status === 'success' ? 'Recharge already processed' : 'Recharge previously failed',
                    //     transactionId: tx.id,
                    //     provider: tx.provider_txn_id,
                    //     refunded: tx.status === 'failed'
                    // };
                }
            }

            // Validation
            if (!mobile || !operator || !amount) throw new Error('Missing required fields');
            if (amount <= 0) throw new Error('Amount must be greater than 0');

            const balance = await walletService.getBalance(userId);
            if (balance < amount) {
                throw new Error(`Insufficient balance. Available: ₹${balance}, Required: ₹${amount}`);
            }

            // Insert pending transaction
            const insertResult = await client.query(
                  `INSERT INTO transactions
                    (user_id, type, mobile, operator, plan_amount, status, idempotency_key, device_type)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING id`,
                    [
                        userId, 
                        'MOBILE_RECHARGE', 
                        mobile, 
                        operator, 
                        amount, 
                        'pending', 
                        idempotencyKey || null,
                        'app'  // ✅ Added device_type
                    ]
                    );
            transactionId = insertResult.rows[0].id;
            merchantRefId = transactionId.toString();

            await client.query(
                `UPDATE transactions SET merchant_ref_id = $1 WHERE id = $2`,
                [merchantRefId, transactionId]
            );

            logger.info(`RechargeService: Created pending transaction ${transactionId} with merchant_ref_id=${merchantRefId}`);

            // Deduct wallet
            const deductResult = await walletService.deductMoney(
                userId, amount, `Mobile recharge for ${mobile}`, transactionId
            );
            logger.info(`RechargeService: Wallet deducted. New balance: ${deductResult.newBalance}`);

            // Call provider with retries
            const MAX_RETRIES = 2;
            const RETRY_DELAY_MS = 500;
            let providerResponse = null;
            let lastError = null;

            for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
                try {
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Provider timeout')), 10000)
                    );
                    const callPromise = providerRouter.routeRecharge({
                        mobile,
                        operator,
                        amount,
                        merchantRefId,
                        serviceType: serviceType || 'MBL',
                        user_id: userId,
                        testMode,
                        lat: lat || 0.0,
                        long: long || 0.0
                    });
                    const response = await Promise.race([callPromise, timeoutPromise]);
                    if (response.status === 'success' || response.status === 'pending') {
                        providerResponse = response;
                        break;
                    } else {
                        lastError = new Error(response.message || 'Provider failed');
                        if (attempt <= MAX_RETRIES) await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                        else providerResponse = response;
                    }
                } catch (err) {
                    lastError = err;
                    if (attempt <= MAX_RETRIES) await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                    else providerResponse = null;
                }
            }

            const responseTimeMs = Date.now() - startTime;
            let finalStatus = 'failed';
            let finalMessage = '';
            let refunded = false;

            if (!providerResponse) {
                finalStatus = 'failed';
                finalMessage = lastError ? lastError.message : 'Unknown provider error';
                await client.query(
                    `UPDATE transactions SET status = $1, api_response = $2, updated_at = NOW() WHERE id = $3`,
                    ['failed', JSON.stringify({ error: finalMessage }), transactionId]
                );
                const refundResult = await walletService.addMoney(
                    userId, amount, `Refund for failed recharge transaction ${transactionId}`, null
                );
                refunded = true;
                logger.info(`RechargeService: Refund processed. New balance: ${refundResult.newBalance}`);
            } else {
                const statusMap = {
                    'success': 'success',
                    'pending': 'pending',
                    'failed': 'failed'
                };
                finalStatus = statusMap[providerResponse.status] || 'failed';
                finalMessage = providerResponse.message || '';

                await client.query(
                    `UPDATE transactions
                     SET status = $1, provider_txn_id = $2, api_response = $3, updated_at = NOW()
                     WHERE id = $4`,
                    [finalStatus, providerResponse.provider_txn_id, JSON.stringify(providerResponse.raw_response || providerResponse), transactionId]
                );

                if (finalStatus === 'failed') {
                    const refundResult = await walletService.addMoney(
                        userId, amount, `Refund for failed recharge transaction ${transactionId} - ${finalMessage}`, null
                    );
                    refunded = true;
                    logger.info(`RechargeService: Refund processed. New balance: ${refundResult.newBalance}`);
                }
            }

            // ✅ Commit the transaction BEFORE inserting provider log (to avoid foreign key error)
            await client.query('COMMIT');

            // ✅ Insert provider log after commit (safe, transaction_id now exists)
            try {
                await db.query(`
                    INSERT INTO provider_logs
                    (merchant_ref_id, transaction_id, transaction_type, request_payload, response_payload,
                     http_status, response_time_ms, final_status, error_message)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                `, [
                    merchantRefId,
                    transactionId,
                    'recharge',
                    JSON.stringify({ mobile, operator, amount, serviceType, lat, long }),
                    JSON.stringify(providerResponse || { error: finalMessage }),
                    200,
                    responseTimeMs,
                    finalStatus,
                    finalStatus === 'failed' ? finalMessage : null
                ]);
            } catch (logErr) {
                logger.error('Failed to insert provider_log:', logErr.message);
            }

                      // ============================================================
                    // ✅ COMMISSION CREDIT (only on success)
                    // ============================================================
                    if (finalStatus === 'success') {
                        // Map provider operator names to commission_rates.slab_name
                        const operatorMap = {
                            'JIO':           'JIO',
                            'JIORECHARGE':   'JIO',
                            'JIORECH':       'JIO',
                            'BSNL':          'BSNL_TOPUP',
                            'BSNLTOPUP':     'BSNL_TOPUP',
                            'BSNL_TOPUP':    'BSNL_TOPUP',
                            'BSNLVALIDITY':  'BSNL_VALIDITY',
                            'BSNL_VALIDITY': 'BSNL_VALIDITY',
                            'AIRTEL':        'AIRTEL',
                            'VI':            'VI',
                            'VODAFONE':      'VI',
                            'IDEA':          'VI',
                        };
                        const normalizedOperator = operatorMap[operator?.toUpperCase()?.trim()] || operator?.toUpperCase()?.trim();

                        // Process commission for the retailer and all ancestors
                        // This will update commission_wallet and insert into commission_ledger
                        await processCommission(
                            'mobile',           // serviceType
                            amount,               // transaction amount
                            userId,               // retailer who did the recharge
                            { operator: normalizedOperator }  // extra info for slab lookup
                        ).catch(err => {
                            // Commission failure must NOT break the recharge response
                            logger.error(`RechargeService: Commission failed for tx ${transactionId}`, { error: err.message });
                        });
                    }

                                        return {
                        success: finalStatus === 'success' || finalStatus === 'pending',
                        status: finalStatus,
                        message: finalStatus === 'success' 
                            ? 'Recharge successful' 
                            : (finalStatus === 'pending' 
                                ? 'Recharge submitted. Processing...' 
                                : `Recharge failed: ${finalMessage}`),
                        transactionId,
                        provider: providerResponse?.provider_txn_id || null,
                        refunded
                    };
                    // return {
                    //     success: finalStatus === 'success',
                    //     message: finalStatus === 'success' ? 'Recharge successful' : (finalStatus === 'pending' ? 'Recharge is processing' : `Recharge failed: ${finalMessage}`),
                    //     transactionId,
                    //     provider: providerResponse?.provider_txn_id || null,
                    //     refunded
                    // };

                } catch (error) {
                    await client.query('ROLLBACK');
                    if (error.transactionRef) {
                        await commissionEngine.reverse(error.transactionRef).catch(e => logger.error(e));
                    }
                    logger.error('RechargeService: Error processing recharge', { error: error.message, stack: error.stack });
                    throw error;
                } finally {
                    client.release();
                }
            }

    async getUserHistory(userId, limit = 50, offset = 0) {
        try {
            // Removed 'circle' because transactions table does not have this column
            const result = await db.query(
                `SELECT id, mobile, operator, plan_amount as amount,
                        status, provider_txn_id, created_at
                 FROM transactions
                 WHERE user_id = $1 AND type = 'MOBILE_RECHARGE'
                 ORDER BY created_at DESC
                 LIMIT $2 OFFSET $3`,
                [userId, limit, offset]
            );
            return result.rows;
        } catch (error) {
            logger.error('RechargeService: Error fetching user history', { error: error.message });
            throw error;
        }
    }

    async getAllRecharges(filters = {}, limit = 50, offset = 0) {
        try {
            let whereClause = "WHERE t.type = 'MOBILE_RECHARGE'";
            const params = [];
            let paramIndex = 1;

            if (filters.status) {
                whereClause += ` AND t.status = $${paramIndex}`;
                params.push(filters.status);
                paramIndex++;
            }
            if (filters.operator) {
                whereClause += ` AND t.operator = $${paramIndex}`;
                params.push(filters.operator);
                paramIndex++;
            }
            if (filters.search) {
                whereClause += ` AND t.mobile ILIKE $${paramIndex}`;
                params.push(`%${filters.search}%`);
                paramIndex++;
            }

            const countQuery = await db.query(`SELECT COUNT(*) FROM transactions t ${whereClause}`, params);
            const result = await db.query(
                `SELECT t.*,
                        CONCAT(u.first_name, ' ', u.last_name) AS user_name,
                        u.email, u.phone AS user_mobile
                 FROM transactions t
                 JOIN users u ON u.id = t.user_id
                 ${whereClause}
                 ORDER BY t.created_at DESC
                 LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
                [...params, limit, offset]
            );
            return {
                transactions: result.rows,
                total: parseInt(countQuery.rows[0].count),
                limit,
                offset
            };
        } catch (error) {
            logger.error('RechargeService: Error fetching all recharges', { error: error.message });
            throw error;
        }
    }

    /**
     * Fetch active recharge plans for a given operator and circle (state).
     * Queries the correct table: recharge_plans.
     * @param {string} operator - Operator code (JIO, AIRTEL, VI, BSNL)
     * @param {string} circle - Circle/state (e.g., 'Tamil Nadu', 'ALL')
     * @returns {Promise<Array>} Array of plan objects
     */
    // backend/services/rechargeService.js

async getPlansByOperatorAndCircle(operator, circle = 'ALL') {
    try {
        const result = await db.query(
            `SELECT id, operator, amount, validity_days, data_benefit,
                    category, circle, display_order, is_active
             FROM recharge_plans
             WHERE operator = $1
               AND is_active = true
               AND (circle ILIKE $2 OR circle = 'ALL')
             ORDER BY category, display_order ASC, amount ASC`,
            [operator, circle]
        );
        return result.rows;
    } catch (error) {
        logger.error('RechargeService: Error fetching plans', { error: error.message, operator, circle });
        throw error;
    }
}
}

module.exports = new RechargeService();