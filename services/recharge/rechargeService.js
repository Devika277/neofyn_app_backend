// neofyn-backend/services/recharge/rechargeService.js
const axios = require('axios');
const encryptionService = require('../encryptionService');
const walletService = require('../recharge/walletService');
// const commissionEngine = require('../recharge/commissionEngine');
const db = require('../../config/db');
const logger = require('../../utils/logger');          // adjust path as needed
const { processCommission } = require('../Commission/commissionService'); // make sure path is correct

// ─────────────────────────────────────────────────────────────────────────────
// VimoPay token cache & helpers
// ─────────────────────────────────────────────────────────────────────────────
let _bearerToken = null;
let _tokenFetchedAt = null;
const TOKEN_TTL_MS = 55 * 60 * 1000; // 55 minutes

function isTokenExpired() {
    if (!_tokenFetchedAt) return true;
    return (Date.now() - _tokenFetchedAt) > TOKEN_TTL_MS;
}

async function authorize() {
    const url = `${encryptionService.baseUrl}/rechargeapi/api/signature/authorizeuat`;
    logger.info('🔐 Authorizing with VimoPay...');

    const response = await axios.post(url, {}, {
        headers: encryptionService.getAuthHeaders(),
        timeout: 15000
    });

    const body = response.data;
    if (!body.successStatus || !body.data) {
        throw new Error(`VimoPay auth failed: ${JSON.stringify(body)}`);
    }

    _bearerToken = encryptionService.extractBearerToken(body);
    _tokenFetchedAt = Date.now();
    logger.info('✅ VimoPay Bearer token obtained');
    return _bearerToken;
}

async function ensureToken() {
    if (!_bearerToken || isTokenExpired()) {
        await authorize();
    }
    return _bearerToken;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic master data endpoints (live from VimoPay)
// ─────────────────────────────────────────────────────────────────────────────
async function getServiceTypeList() {
    try {
        const token = await ensureToken();
        const url = `${encryptionService.baseUrl}/masterapi/api/Master/GetServiceType`;
        const response = await axios.get(url, {
            headers: encryptionService.getAuthenticatedHeaders(token),
            timeout: 15000
        });
        const encryptedData = response.data?.data;
        if (!encryptedData) throw new Error('No data in GetServiceType response');
        const decryptedString = encryptionService.decrypt(encryptedData);
        if (!decryptedString) throw new Error('Decryption failed for service type list');
        const serviceList = JSON.parse(decryptedString);
        return {
            success: true,
            data: serviceList.map(s => ({ code: s.code, description: s.description }))
        };
    } catch (error) {
        logger.error('getServiceTypeList error:', error.message);
        return { success: false, error: error.message };
    }
}

async function getOperatorList(serviceType = 'MBL') {
    try {
        const token = await ensureToken();
        const url = `${encryptionService.baseUrl}/masterapi/api/Master/GetOperator`;
        const encryptedBody = encryptionService.encrypt(serviceType);
        const requestBody = { requestBody: encryptedBody };
        const response = await axios.post(url, requestBody, {
            headers: encryptionService.getAuthenticatedHeaders(token),
            timeout: 15000
        });
        const encryptedData = response.data?.data;
        if (!encryptedData) throw new Error('No data in GetOperator response');
        const decryptedString = encryptionService.decrypt(encryptedData);
        if (!decryptedString) throw new Error('Decryption failed for operator list');
        const operatorList = JSON.parse(decryptedString);
        return {
            success: true,
            data: operatorList.map(op => ({ code: op.code, description: op.description }))
        };
    } catch (error) {
        logger.error('getOperatorList error:', error.message);
        return { success: false, error: error.message };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main RechargeService class (production‑ready logic)
// ─────────────────────────────────────────────────────────────────────────────
class RechargeService {
    // -------------------------------------------------------------------------
    // processRecharge – with idempotency, retries, provider logs, refunds
    // -------------------------------------------------------------------------
    async processRecharge(userId, rechargeData, idempotencyKey = null) {
        const { mobile, operator, serviceType = 'MBL', amount, testMode = false, lat = 0.0, long = 0.0, udf1 = '', udf2 = '', udf3 = '' } = rechargeData;
        const startTime = Date.now();
        const client = await db.connect();

        try {
            await client.query('BEGIN');

            // 1. Idempotency check
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
                        success: tx.status === 'success',
                        message: tx.status === 'success' ? 'Recharge already processed' : 'Recharge previously failed',
                        transactionId: tx.id,
                        provider: tx.provider_txn_id,
                        refunded: tx.status === 'failed'
                    };
                }
            }

            // 2. Basic validation
            if (!mobile || !operator || !amount) throw new Error('Missing required fields: mobile, operator, amount');
            if (amount <= 0) throw new Error('Amount must be greater than 0');
            if (!/^\d{10}$/.test(mobile)) throw new Error('Invalid mobile number (10 digits required)');

            const balance = await walletService.getBalance(userId);
            if (balance < amount) {
                throw new Error(`Insufficient balance. Available: ₹${balance}, Required: ₹${amount}`);
            }

            // 3. Insert pending transaction (without merchant_ref_id)
            const insertResult = await client.query(
                `INSERT INTO transactions
                 (user_id, type, mobile, operator, plan_amount, status, idempotency_key)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id`,
                [userId, 'MOBILE_RECHARGE', mobile, operator, amount, 'pending', idempotencyKey || null]
            );
            const transactionId = insertResult.rows[0].id;
            const merchantRefId = transactionId.toString(); // ✅ merchant_ref_id = numeric id as string

            await client.query(
                `UPDATE transactions SET merchant_ref_id = $1 WHERE id = $2`,
                [merchantRefId, transactionId]
            );
            logger.info(`Created pending transaction ${transactionId} with merchant_ref_id=${merchantRefId}`);

            // 4. Deduct wallet (using the client transaction)
            await walletService.deductMoney(userId, amount, client);
            logger.info(`Wallet deducted: ₹${amount} from user ${userId}`);

            // 5. Call VimoPay with retries (max 2 retries)
            const MAX_RETRIES = 2;
            const RETRY_DELAY_MS = 500;
            let providerResponse = null;
            let lastError = null;

            for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
                try {
                    let response;
                    if (testMode || process.env.NODE_ENV === 'development') {
                        logger.info('🧪 Test mode – mocking VimoPay response');
                        response = {
                            success: true,
                            txnStatus: 'Queued',
                            txnStatusCode: '004',
                            txnId: `MOCK-${Date.now()}`,
                            commission: 4.0,
                            finalCommission: 4.0,
                            tds: 0.0
                        };
                    } else {
                        response = await this._callVimoPayRecharge({
                            merchantRefId,
                            amount,
                            operatorCode: operator,
                            serviceType,
                            operatorNumber: mobile,
                            lat,
                            long,
                            udf1,
                            udf2,
                            udf3
                        });
                    }

                    if (response.txnStatusCode === '000' || response.txnStatusCode === '004') {
                        providerResponse = response;
                        break;
                    } else {
                        lastError = new Error(response.txnStatus || 'Provider returned failure');
                        if (attempt <= MAX_RETRIES) {
                            logger.warn(`Provider attempt ${attempt} failed, retrying...`);
                            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                        } else {
                            providerResponse = response; // fallback, will be treated as failed
                        }
                    }
                } catch (err) {
                    lastError = err;
                    logger.warn(`Provider call attempt ${attempt} error: ${err.message}`);
                    if (attempt <= MAX_RETRIES) {
                        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                    }
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
                await walletService.addMoney(userId, amount, client);
                refunded = true;
                logger.info(`Refunded ₹${amount} after provider failure`);
            } else {
                // Map VimoPay status code -> internal status
                const statusMap = {
                    '000': 'success',
                    '001': 'failed',
                    '004': 'pending',
                    '002': 'pending'
                };
                finalStatus = statusMap[providerResponse.txnStatusCode] || 'failed';
                finalMessage = providerResponse.txnStatus || '';

                await client.query(
                    `UPDATE transactions
                     SET status = $1, provider_txn_id = $2, api_response = $3, updated_at = NOW()
                     WHERE id = $4`,
                    [finalStatus, providerResponse.txnId, JSON.stringify(providerResponse), transactionId]
                );

                if (finalStatus === 'failed') {
                    await walletService.addMoney(userId, amount, client);
                    refunded = true;
                    logger.info(`Refunded ₹${amount} after failed recharge`);
                }
            }

            // Commit the database transaction
            await client.query('COMMIT');

            // Insert provider log (non‑critical, ignore errors)
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

            // Commission on success (operator-aware)
            if (finalStatus === 'success') {
                const operatorMap = {
                    'JIO': 'JIORECH', 'JIORECHARGE': 'JIORECH', 'JIORECH': 'JIORECH',
                    'BSNL': 'BSNL_TOPUP', 'BSNLTOPUP': 'BSNL_TOPUP', 'BSNL_TOPUP': 'BSNL_TOPUP',
                    'BSNLVALIDITY': 'BSNL_VALIDITY', 'BSNL_VALIDITY': 'BSNL_VALIDITY',
                    'AIRTEL': 'AIRTEL', 'VI': 'VI', 'VODAFONE': 'VI', 'IDEA': 'VI',
                };
                const normalizedOperator = operatorMap[operator?.toUpperCase()?.trim()] || operator?.toUpperCase()?.trim();
                await processCommission('recharge', amount, userId, { operator: normalizedOperator })
                    .catch(err => logger.error(`Commission failed for tx ${transactionId}:`, err.message));
            }

            const message = finalStatus === 'success' ? 'Recharge successful' :
                            finalStatus === 'pending' ? 'Recharge is processing, you will be notified' :
                            `Recharge failed: ${finalMessage}`;

            return {
                success: finalStatus === 'success',
                message,
                transactionId,
                provider: providerResponse?.txnId || null,
                refunded
            };

        } catch (error) {
            await client.query('ROLLBACK');
            if (error.transactionRef) {
                await commissionEngine.reverse(error.transactionRef).catch(e => logger.error(e));
            }
            logger.error('processRecharge error:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    // -------------------------------------------------------------------------
    // Internal: actual VimoPay recharge API call
    // -------------------------------------------------------------------------
    async _callVimoPayRecharge(payload) {
        const token = await ensureToken();
        const url = `${encryptionService.baseUrl}/rechargeapi/api/payment/rechargeuat`;
        const encryptedBody = encryptionService.encrypt(JSON.stringify(payload));
        const requestBody = { requestBody: encryptedBody };

        logger.info(`Calling VimoPay recharge for ref: ${payload.merchantRefId}`);
        const response = await axios.post(url, requestBody, {
            headers: encryptionService.getAuthenticatedHeaders(token),
            timeout: 30000
        });

        const body = response.data;
        if (!body.successStatus) {
            let decryptedError = null;
            if (body.data) {
                try {
                    decryptedError = encryptionService.decrypt(body.data);
                    logger.error('Decrypted VimoPay error:', decryptedError);
                } catch (e) {}
            }
            throw new Error(`VimoPay recharge call failed: ${JSON.stringify(body)}`);
        }

        const encryptedData = body.data;
        const decryptedString = encryptionService.decrypt(encryptedData);
        if (!decryptedString) throw new Error('Failed to decrypt VimoPay recharge response');

        const result = JSON.parse(decryptedString);
        logger.info(`VimoPay response: txnStatus=${result.txnStatus}, code=${result.txnStatusCode}`);

        return {
            success: body.successStatus,
            txnId: result.txnId,
            txnStatus: result.txnStatus,
            txnStatusCode: result.txnStatusCode,
            commission: result.commission,
            finalCommission: result.finalCommission,
            tds: result.tds,
            merchantRefId: result.merchantRefId,
            operatorRefId: result.operatorRefId || null
        };
    }

    // -------------------------------------------------------------------------
    // handleCallback – VimoPay callback handler (service layer)
    // -------------------------------------------------------------------------
    async handleCallback(callbackData) {
        const { txnId, txnStatusCode, merchantRefId, amount, operatorRefId, commission, finalCommission, tds } = callbackData;
        logger.info(`Processing callback for merchantRefId: ${merchantRefId}, statusCode: ${txnStatusCode}`);

        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const existing = await client.query(
                `SELECT id, user_id, plan_amount, status FROM transactions WHERE merchant_ref_id = $1 LIMIT 1`,
                [merchantRefId]
            );
            if (existing.rows.length === 0) {
                logger.warn(`No transaction found for merchantRefId: ${merchantRefId}`);
                await client.query('ROLLBACK');
                return { success: false, message: 'Transaction not found' };
            }

            const tx = existing.rows[0];
            if (tx.status !== 'pending') {
                logger.info(`Transaction ${merchantRefId} already in final state: ${tx.status}`);
                await client.query('ROLLBACK');
                return { success: true, message: 'Already processed' };
            }

            const statusMap = {
                '000': 'success',
                '001': 'failed',
                '004': 'pending',
                '002': 'pending'
            };
            const internalStatus = statusMap[txnStatusCode] || 'pending';

            await client.query(
                `UPDATE transactions
                 SET status = $1, provider_txn_id = $2,
                     commission = $3, updated_at = NOW(),
                     api_response = api_response || $4::jsonb
                 WHERE id = $5`,
                [
                    internalStatus,
                    txnId || null,
                    finalCommission || commission || 0,
                    JSON.stringify({ callback: callbackData, txnStatusCode }),
                    tx.id
                ]
            );

            const refundAmount = amount ? parseFloat(amount) : tx.plan_amount;
            if (internalStatus === 'failed') {
                await walletService.addMoney(tx.user_id, refundAmount, client);
                logger.info(`Refunded ₹${refundAmount} to user ${tx.user_id} after failed recharge`);
            }

            if (internalStatus === 'success') {
                await commissionEngine.calculate(tx.user_id, refundAmount, 'MOBILE_RECHARGE', client);
            }

            await client.query('COMMIT');
            logger.info(`Callback processed: ${merchantRefId} → ${internalStatus}`);
            return { success: true, status: internalStatus };

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('handleCallback service error:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    // -------------------------------------------------------------------------
    // getUserHistory & getAllRecharges
    // -------------------------------------------------------------------------
    async getUserHistory(userId, limit = 20, offset = 0) {
        try {
            const result = await db.query(
                `SELECT id, type, amount, status, merchant_ref_id,
                        operator_code, service_type, operator_number,
                        provider_txn_id, commission, created_at, updated_at
                 FROM transactions
                 WHERE user_id = $1 AND type = 'MOBILE_RECHARGE'
                 ORDER BY created_at DESC
                 LIMIT $2 OFFSET $3`,
                [userId, limit, offset]
            );
            return result.rows;
        } catch (error) {
            logger.error('getUserHistory error:', error.message);
            return [];
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
            logger.error('getAllRecharges error:', error.message);
            throw error;
        }
    }

    // -------------------------------------------------------------------------
    // getReceipt – RBI compliant receipt
    // -------------------------------------------------------------------------
    async getReceipt(userId, transactionId) {
        const result = await db.query(
            `SELECT id, user_id, amount, status, merchant_ref_id, provider_txn_id,
                    operator_code, operator_number, created_at, updated_at,
                    commission, api_response
             FROM transactions
             WHERE id = $1 AND user_id = $2`,
            [transactionId, userId]
        );
        if (result.rows.length === 0) throw new Error('Transaction not found');

        const tx = result.rows[0];
        const mobile = tx.operator_number || '';
        const maskedMobile = mobile.length >= 6 ? mobile.replace(/(\d{3})\d+(\d{3})/, '$1****$2') : mobile;

        let apiResponse = null;
        try {
            if (tx.api_response) apiResponse = JSON.parse(tx.api_response);
        } catch (e) {}

        return {
            success: true,
            data: {
                transactionId: tx.id,
                merchantTransactionId: tx.merchant_ref_id,
                providerTransactionId: tx.provider_txn_id || apiResponse?.txnId || 'N/A',
                amount: parseFloat(tx.amount).toFixed(2),
                currency: 'INR',
                customerMobile: maskedMobile,
                operator: tx.operator_code || 'Mobile Recharge',
                rechargeAmount: parseFloat(tx.amount).toFixed(2),
                dateTime: new Date(tx.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                timestamp: tx.created_at,
                status: tx.status.toUpperCase(),
                merchantName: 'Neofyn Digital Services',
                merchantSupport: 'support@neofyn.com | +91 98765 43210',
                disclaimers: [
                    'This transaction has been successfully processed by Neofyn.',
                    'In case of any discrepancy, please contact customer support within 7 days.',
                    'Never share your OTP, PIN, or UPI password with anyone.',
                    'This receipt is system generated and does not require a signature.'
                ],
                policyText: 'Refunds, if any, will be processed as per the operator’s refund policy.'
            }
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export instance and standalone helpers (backward compatible)
// ─────────────────────────────────────────────────────────────────────────────
const rechargeService = new RechargeService();

module.exports = {
    processRecharge: rechargeService.processRecharge.bind(rechargeService),
    handleCallback: rechargeService.handleCallback.bind(rechargeService),
    getUserHistory: rechargeService.getUserHistory.bind(rechargeService),
    getAllRecharges: rechargeService.getAllRecharges.bind(rechargeService),
    getReceipt: rechargeService.getReceipt.bind(rechargeService),
    getServiceTypeList,
    getOperatorList
    // NOTE: getCircleList has been removed – not needed for VimoPay recharge
};