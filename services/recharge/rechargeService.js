// neofyn-backend/services/recharge/rechargeService.js
const axios           = require('axios');
const encryptionService = require('../encryptionService'); // ← your existing file, same path
const walletService   = require('../recharge/walletService');
const commissionEngine = require('../recharge/commissionEngine');
const db              = require('../../config/db');  // adjust path if needed

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: VimoPay token cache
// We fetch a Bearer token once and reuse it until it expires (~60 min typical)
// ─────────────────────────────────────────────────────────────────────────────
let _bearerToken     = null;
let _tokenFetchedAt  = null;
const TOKEN_TTL_MS   = 55 * 60 * 1000; // 55 minutes

function isTokenExpired() {
    if (!_tokenFetchedAt) return true;
    return (Date.now() - _tokenFetchedAt) > TOKEN_TTL_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 – Authorize with VimoPay
// POST /rechargeapi/api/signature/authorizeuat
// Headers: secretKey, saltKey, encryptdecryptKey, userId
// Response: { successStatus, data: "<raw Bearer token string>" }
// ─────────────────────────────────────────────────────────────────────────────
async function authorize() {
    const url = `${encryptionService.baseUrl}/rechargeapi/api/signature/authorizeuat`;

    console.log('🔐 Authorizing with VimoPay...');

    const response = await axios.post(url, {}, {
        headers: encryptionService.getAuthHeaders(),
        timeout: 15000
    });

    const body = response.data;

    if (!body.successStatus || !body.data) {
        throw new Error(`VimoPay auth failed: ${JSON.stringify(body)}`);
    }

    // The token is the raw `data` string — no decryption needed
    _bearerToken    = encryptionService.extractBearerToken(body);
    _tokenFetchedAt = Date.now();

    console.log('✅ VimoPay Bearer token obtained');
    return _bearerToken;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: ensure we always have a valid token before calling VimoPay
// ─────────────────────────────────────────────────────────────────────────────
async function ensureToken() {
    if (!_bearerToken || isTokenExpired()) {
        await authorize();
    }
    return _bearerToken;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 – Get Service Type List  (optional, useful for DTH / Electricity)
// GET /masterapi/api/Master/GetServiceType
// ─────────────────────────────────────────────────────────────────────────────
async function getServiceTypeList() {
    try {
        const token = await ensureToken();
        const url   = `${encryptionService.baseUrl}/masterapi/api/Master/GetServiceType`;

        const response = await axios.get(url, {
            headers: encryptionService.getAuthenticatedHeaders(token),
            timeout: 15000
        });

        const encryptedData = response.data?.data;
        if (!encryptedData) throw new Error('No data in GetServiceType response');

        const decryptedString = encryptionService.decrypt(encryptedData);
        if (!decryptedString) throw new Error('Decryption failed for service type list');

        const serviceList = JSON.parse(decryptedString);
        console.log('🔍 Service types fetched:', serviceList.length);

        return {
            success: true,
            data: serviceList.map(s => ({
                code:        s.code,
                description: s.description
            }))
        };
    } catch (error) {
        console.error('❌ getServiceTypeList error:', error.message);
        // ❌ FALLBACK REMOVED – now returns error only
        return {
            success: false,
            error: error.message
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 – Get Operator List
// POST /masterapi/api/Master/GetOperator
// Body (encrypted): { requestBody: encrypt(serviceTypeCode) }
// e.g. encrypt("MBL") or encrypt("DTH")
// ─────────────────────────────────────────────────────────────────────────────
async function getOperatorList(serviceType = 'MBL') {
    try {
        const token = await ensureToken();
        const url   = `${encryptionService.baseUrl}/masterapi/api/Master/GetOperator`;

        const encryptedBody = encryptionService.encrypt(serviceType);
        const requestBody   = { requestBody: encryptedBody };

        console.log(`📡 Fetching operator list for serviceType: ${serviceType}`);

        const response = await axios.post(url, requestBody, {
            headers: encryptionService.getAuthenticatedHeaders(token),
            timeout: 15000
        });

        const encryptedData = response.data?.data;
        if (!encryptedData) throw new Error('No data in GetOperator response');

        const decryptedString = encryptionService.decrypt(encryptedData);
        if (!decryptedString) throw new Error('Decryption failed for operator list');

        const operatorList = JSON.parse(decryptedString);
        console.log(`✅ Operators fetched: ${operatorList.length}`);

        return {
            success: true,
            data: operatorList.map(op => ({
                code:        op.code,
                description: op.description
            }))
        };
    } catch (error) {
        console.error('❌ getOperatorList error:', error.message);
        // ❌ FALLBACK REMOVED – now returns error only
        return {
            success: false,
            error: error.message
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Static circle list (VimoPay has no circle API – kept as before)
// ─────────────────────────────────────────────────────────────────────────────
function getCircleList() {
    return [
        { code: 'DL',  description: 'Delhi' },
        { code: 'MH',  description: 'Maharashtra' },
        { code: 'KA',  description: 'Karnataka' },
        { code: 'TN',  description: 'Tamil Nadu' },
        { code: 'WB',  description: 'West Bengal' },
        { code: 'GJ',  description: 'Gujarat' },
        { code: 'RJ',  description: 'Rajasthan' },
        { code: 'UP',  description: 'Uttar Pradesh' },
        { code: 'AP',  description: 'Andhra Pradesh' },
        { code: 'TS',  description: 'Telangana' },
        { code: 'KL',  description: 'Kerala' },
        { code: 'PB',  description: 'Punjab' },
        { code: 'HR',  description: 'Haryana' },
        { code: 'MP',  description: 'Madhya Pradesh' },
        { code: 'OD',  description: 'Odisha' },
        { code: 'BR',  description: 'Bihar' },
        { code: 'AS',  description: 'Assam' },
        { code: 'HP',  description: 'Himachal Pradesh' },
        { code: 'UK',  description: 'Uttarakhand' },
        { code: 'JH',  description: 'Jharkhand' }
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 – Process Recharge (the main transaction)
// POST /rechargeapi/api/payment/rechargeuat
//
// Plain payload (before encryption):
// {
//   merchantRefId, amount, operatorCode, serviceType,
//   operatorNumber (= mobile), lat, long, udf1, udf2, udf3
// }
// Sent as: { requestBody: encrypt(JSON.stringify(payload)) }
// ─────────────────────────────────────────────────────────────────────────────

const generateMerchantRefId = () => {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    return `${timestamp}${random}`;
};
// Example: RECH1747823456123456

async function processRecharge(userId, rechargeData, idempotencyKey) {
    const startTime = Date.now();

    // ── Build initial log object (will be filled step by step) ──────────────
    const transactionLog = {
        id: null,
        transaction_id: null,
        request_payload: {},
        response_payload: null,
        error_message: null,
        http_status: 0,
        response_time_ms: 0,
        final_status: 'pending',
        created_at: new Date().toISOString()
    };

    const {
        mobile,
        operatorCode,
        serviceType,
        amount,
        merchantRefId,   // Flutter sends uuid, but we will override
        lat,
        long,
        udf1 = '',
        udf2 = '',
        udf3 = '',
        testMode = false
    } = rechargeData;

    // Always generate a clean alphanumeric ID (no hyphens)
    const refId = generateMerchantRefId();

    // ── Fill request payload ────────────────────────────────────────────────
    transactionLog.request_payload = {
        mobile,
        operator: operatorCode,
        amount,
        serviceType,
        lat,
        long,
        udf1,
        udf2,
        udf3
    };

    // ── 1. Check wallet balance ───────────────────────────────────────────────
    const walletBalance = await walletService.getBalance(userId);
    if (walletBalance < amount) {
        // Log failed attempt (no DB transaction needed here)
        await db.query(
            `INSERT INTO transactions
             (user_id, type, amount, status, merchant_ref_id, meta)
             VALUES ($1, 'MOBILE_RECHARGE', $2, 'failed', $3, $4)`,
            [userId, amount, refId, JSON.stringify({ errorCode: 'INSUFFICIENT_BALANCE' })]
        );
        // Fill log for this failure case
        transactionLog.final_status = 'failed';
        transactionLog.error_message = 'Insufficient wallet balance';
        transactionLog.response_time_ms = Date.now() - startTime;
        console.log('\n📋 TRANSACTION LOG (FAILED):\n', JSON.stringify(transactionLog, null, 2));
        return {
            success: false,
            errorCode: 'INSUFFICIENT_BALANCE',
            message: 'Insufficient wallet balance'
        };
    }

    // ── 2. Begin DB transaction ───────────────────────────────────────────────
    const client = await db.connect();
    let dbTxnId;

    try {
        await client.query('BEGIN');

        // Insert pending transaction row
        const insertResult = await client.query(
            `INSERT INTO transactions
             (user_id, type, amount, status, merchant_ref_id, operator_code,
              service_type, operator_number, meta)
             VALUES ($1, 'MOBILE_RECHARGE', $2, 'pending', $3, $4, $5, $6, $7)
             RETURNING id`,
            [
                userId, amount, refId, operatorCode,
                serviceType, mobile,
                JSON.stringify({ lat, long, udf1, udf2, udf3 })
            ]
        );
        dbTxnId = insertResult.rows[0].id;
        transactionLog.id = dbTxnId;
        transactionLog.transaction_id = dbTxnId;   // same as internal ID

        // ── 3. Deduct wallet ──────────────────────────────────────────────────
        await walletService.deductMoney(userId, amount, client);

        // ── 4. Call VimoPay (or mock in dev/testMode) ─────────────────────────
        let providerResponse;
        let httpStatus = 200;
        let errorMsg = null;

        try {
            const apiStart = Date.now();
            if (testMode || process.env.NODE_ENV === 'development') {
                console.log('🧪 Test mode – mocking VimoPay recharge response');
                providerResponse = {
                    success:       true,
                    txnStatus:     'Queued',
                    txnStatusCode: '004',
                    txnId:         `MOCK-${Date.now()}`,
                    commission:    4.0,
                    finalCommission: 4.0,
                    tds:           0.0
                };
                transactionLog.response_time_ms = Date.now() - apiStart;
                transactionLog.response_payload = providerResponse;
                transactionLog.http_status = 200;
            } else {
                providerResponse = await _callVimoPayRecharge({
                    merchantRefId:  refId,
                    amount,
                    operatorCode,
                    serviceType,
                    operatorNumber: mobile,
                    lat,
                    long,
                    udf1,
                    udf2,
                    udf3
                });
                transactionLog.response_time_ms = Date.now() - apiStart;
                transactionLog.response_payload = providerResponse;
                transactionLog.http_status = 200;
            }
        } catch (apiError) {
            // API call itself threw an exception (network, timeout, etc.)
            transactionLog.final_status = 'failed';
            transactionLog.error_message = apiError.message;
            transactionLog.http_status = apiError.response?.status || 0;
            transactionLog.response_payload = apiError.response?.data || null;
            transactionLog.response_time_ms = Date.now() - startTime;
            console.log('\n📋 TRANSACTION LOG (API ERROR):\n', JSON.stringify(transactionLog, null, 2));
            throw apiError; // rethrow to outer catch
        }

        // ── 5. Map VimoPay status → internal status ───────────────────────────
        let internalStatus;
        switch (providerResponse.txnStatusCode) {
            case '000': internalStatus = 'success'; break;
            case '001': internalStatus = 'failed';  break;
            case '004':
            case '002':
            default:    internalStatus = 'pending';
        }

        // ── 6. Update transaction row ─────────────────────────────────────────
        await client.query(
            `UPDATE transactions
             SET status = $1, provider_txn_id = $2, api_response = $3,
                 commission = $4, updated_at = NOW()
             WHERE id = $5`,
            [
                internalStatus,
                providerResponse.txnId || null,
                JSON.stringify(providerResponse),
                providerResponse.finalCommission || 0,
                dbTxnId
            ]
        );

        // ── 7. Refund on failure ──────────────────────────────────────────────
        if (internalStatus === 'failed') {
            await walletService.addMoney(userId, amount, client);
            transactionLog.final_status = 'failed';
            transactionLog.error_message = providerResponse.txnStatus || 'VimoPay failed';
        } else {
            transactionLog.final_status = internalStatus; // success or pending
        }

        // ── 8. Calculate commission on success ────────────────────────────────
        if (internalStatus === 'success') {
            // Note: commissionEngine.calculate expects (userId, amount, type, client)
            await commissionEngine.calculate(userId, amount, 'MOBILE_RECHARGE', client);
        }

        await client.query('COMMIT');

        // ── 9. Final success log ──────────────────────────────────────────────
        transactionLog.response_time_ms = Date.now() - startTime;
        console.log('\n📋 TRANSACTION LOG (SUCCESS):\n', JSON.stringify(transactionLog, null, 2));

        return {
            success:   internalStatus !== 'failed',
            message:   providerResponse.txnStatus || 'Recharge initiated',
            errorCode: internalStatus === 'failed' ? 'PROVIDER_FAILED' : null,
            data: {
                txnId:           providerResponse.txnId,
                txnStatus:       providerResponse.txnStatus,
                txnStatusCode:   providerResponse.txnStatusCode,
                merchantRefId:   refId,
                amount,
                operatorCode,
                serviceType,
                operatorNumber:  mobile,
                commission:      providerResponse.commission,
                finalCommission: providerResponse.finalCommission,
                tds:             providerResponse.tds
            }
        };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ processRecharge error:', error.message);

        // Update log for failure (if not already set)
        transactionLog.final_status = 'failed';
        if (!transactionLog.error_message) {
            transactionLog.error_message = error.message;
        }
        transactionLog.response_time_ms = Date.now() - startTime;
        console.log('\n📋 TRANSACTION LOG (EXCEPTION):\n', JSON.stringify(transactionLog, null, 2));

        // Refund wallet if deduction already happened
        try {
            await walletService.addMoney(userId, amount);
        } catch (refundErr) {
            console.error('⚠️  Refund failed after rollback:', refundErr.message);
        }

        return {
            success:   false,
            errorCode: 'INTERNAL_ERROR',
            message:   'Recharge processing failed'
        };
    } finally {
        client.release();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: actual VimoPay recharge API call
// POST /rechargeapi/api/payment/rechargeuat
// ─────────────────────────────────────────────────────────────────────────────
async function _callVimoPayRecharge(payload) {
    const token = await ensureToken();
    const url   = `${encryptionService.baseUrl}/rechargeapi/api/payment/rechargeuat`;

    const encryptedBody = encryptionService.encrypt(JSON.stringify(payload));
    const requestBody   = { requestBody: encryptedBody };

    console.log(`📡 Calling VimoPay recharge for ref: ${payload.merchantRefId}`);

    const response = await axios.post(url, requestBody, {
        headers: encryptionService.getAuthenticatedHeaders(token),
        timeout: 30000
    });

    const body = response.data;

    // 👇 ADD DEBUG HERE – decrypt error data
    if (!body.successStatus) {
        let decryptedError = null;
        if (body.data) {
            try {
                decryptedError = encryptionService.decrypt(body.data);
                console.error('🔍 Decrypted VimoPay error:', decryptedError);
            } catch (e) {
                console.error('Failed to decrypt error response:', e.message);
            }
        }
        throw new Error(`VimoPay recharge call failed: ${JSON.stringify(body)} | Decrypted: ${decryptedError}`);
    }

    const encryptedData  = body.data;
    const decryptedString = encryptionService.decrypt(encryptedData);
    if (!decryptedString) {
        throw new Error('Failed to decrypt VimoPay recharge response');
    }

    const result = JSON.parse(decryptedString);
    console.log(`✅ VimoPay recharge response: txnStatus=${result.txnStatus}, code=${result.txnStatusCode}`);
    return {
        success:         body.successStatus,
        txnId:           result.txnId,
        txnStatus:       result.txnStatus,
        txnStatusCode:   result.txnStatusCode,
        commission:      result.commission,
        finalCommission: result.finalCommission,
        tds:             result.tds,
        merchantRefId:   result.merchantRefId,
        operatorRefId:   result.operatorRefId || null
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handle VimoPay Callback (called from controller)
// Updates the transaction row with final status
// ─────────────────────────────────────────────────────────────────────────────
async function handleCallback(callbackData) {
    const {
        txnId,
        internalStatus,
        txnStatusCode,
        merchantRefId,
        commission,
        finalCommission,
        tds,
        operatorRefId
    } = callbackData;

    console.log(`📩 Processing callback for merchantRefId: ${merchantRefId}, status: ${internalStatus}`);

    try {
        // Find the transaction by merchantRefId
        const existing = await db.query(
            `SELECT id, user_id, amount, status FROM transactions WHERE merchant_ref_id = $1 LIMIT 1`,
            [merchantRefId]
        );

        if (existing.rows.length === 0) {
            console.warn(`⚠️  No transaction found for merchantRefId: ${merchantRefId}`);
            return;
        }

        const txn = existing.rows[0];

        // Only update if currently pending (avoid double-processing)
        if (txn.status !== 'pending') {
            console.log(`ℹ️  Transaction ${merchantRefId} already in final state: ${txn.status}`);
            return;
        }

        const client = await db.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `UPDATE transactions
                 SET status = $1, provider_txn_id = $2,
                     commission = $3, updated_at = NOW(),
                     api_response = api_response || $4::jsonb
                 WHERE merchant_ref_id = $5`,
                [
                    internalStatus,
                    txnId || null,
                    finalCommission || 0,
                    JSON.stringify({ callback: callbackData, txnStatusCode }),
                    merchantRefId
                ]
            );

            // If final status is failed → refund the user's wallet
            if (internalStatus === 'failed') {
                await walletService.addMoney(txn.user_id, txn.amount, client);
                console.log(`💰 Refunded ₹${txn.amount} to user ${txn.user_id} after failed recharge`);
            }

            // If success → calculate commission (if not already done)
            if (internalStatus === 'success') {
                await commissionEngine.calculate(txn.user_id, txn.amount, 'MOBILE_RECHARGE', client);
            }

            await client.query('COMMIT');
            console.log(`✅ Callback processed: ${merchantRefId} → ${internalStatus}`);
// Return transaction ID along with other data
return {
    success: true,
    transactionId: dbTxnId,
    txnStatusCode: providerResponse.txnStatusCode,
    txnId: providerResponse.txnId,
    amount: amount,
    mobile: mobile
};

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('❌ handleCallback service error:', error.message);
        throw error;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Get User Recharge History
// ─────────────────────────────────────────────────────────────────────────────
async function getUserHistory(userId, limit = 20, offset = 0) {
    try {
        const result = await db.query(
            `SELECT
                id, type, amount, status, merchant_ref_id,
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
        console.error('❌ getUserHistory error:', error.message);
        return [];
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// GET RECEIPT for a transaction (RBI compliant)
// ─────────────────────────────────────────────────────────────────────────────
async function getReceipt(userId, transactionId) {
    // Fetch transaction from DB
    const result = await db.query(
        `SELECT id, user_id, amount, status, merchant_ref_id, provider_txn_id,
                operator_code, operator_number, created_at, updated_at,
                commission, api_response
         FROM transactions
         WHERE id = $1 AND user_id = $2`,
        [transactionId, userId]
    );

    if (result.rows.length === 0) {
        throw new Error('Transaction not found');
    }

    const tx = result.rows[0];

    // Mask mobile number (show first 3, last 3 digits)
    const mobile = tx.operator_number || '';
    const maskedMobile = mobile.length >= 6
        ? mobile.replace(/(\d{3})\d+(\d{3})/, '$1****$2')
        : mobile;

    // Parse API response if stored
    let apiResponse = null;
    try {
        if (tx.api_response) apiResponse = JSON.parse(tx.api_response);
    } catch (e) {}

    // Build receipt object
    const receipt = {
        success: true,
        data: {
            // Unique identifiers
            transactionId: tx.id,
            merchantTransactionId: tx.merchant_ref_id,
            providerTransactionId: tx.provider_txn_id || apiResponse?.txnId || 'N/A',

            // Amount & currency
            amount: parseFloat(tx.amount).toFixed(2),
            currency: 'INR',

            // Customer info (masked)
            customerMobile: maskedMobile,

            // Service details
            operator: tx.operator_code || 'Mobile Recharge',
            rechargeAmount: parseFloat(tx.amount).toFixed(2),

            // Date & time (IST)
            dateTime: new Date(tx.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            timestamp: tx.created_at,

            // Status
            status: tx.status.toUpperCase(),

            // Merchant details (update with your actual business info)
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

    return receipt;
}



// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
    getServiceTypeList,
    getOperatorList,
    getCircleList,
    processRecharge,
    handleCallback,
    getUserHistory,
    getReceipt,

};