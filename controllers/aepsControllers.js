const aepsService = require('../services/aepsService');
const TransactionModel = require('../models/Transaction');
const MerchantModel = require('../models/Merchant');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');


// ✅ ADD THIS FUNCTION — saves to aeps_transactions table
async function saveAepsTransaction(data) {
    // 28 columns, 28 values — exactly matched
    const query = `
        INSERT INTO public.aeps_transactions (
            user_id,
            bank_iin,
            amount,
            commission_amount,
            status,
            provider_txn_id,
            rrn,
            response_code,
            error_message,
            balance_amount,
            mini_statement_data,
            device_serial,
            device_used,
            aeps_wallet_id,
            provider_txn_ref,
            npci_code,
            npci_message,
            available_balance,
            mini_statement,
            txn_type,
            npci_txn_id,
            merchant_ref_id,
            lat,
            long,
            provider,
            failure_reason,
            raw_response,
            aadhaar_last4,
            created_at,
            updated_at
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, $13, $14,
            $15, $16, $17, $18, $19, $20, $21,
            $22, $23, $24, $25, $26, $27, $28,
            NOW(), NOW()
        )
        RETURNING id
    `;

    // Count: 28 values for 28 columns (created_at/updated_at use NOW())
    const values = [
        data.user_id          ?? null,   // $1
        data.bank_iin         ?? null,   // $2
        data.amount           ?? 0,      // $3
        data.commission_amount ?? 0,     // $4
        data.status           ?? 'FAILED', // $5
        data.provider_txn_id  ?? null,   // $6
        data.rrn              ?? null,   // $7
        data.response_code    ?? null,   // $8
        data.error_message    ?? null,   // $9
        data.balance_amount   ?? 0,      // $10
        data.mini_statement_data ?? null, // $11
        data.device_serial    ?? null,   // $12
        data.device_used      ?? null,   // $13
        data.aeps_wallet_id   ?? null,   // $14
        data.provider_txn_ref ?? null,   // $15
        data.npci_code        ?? null,   // $16
        data.npci_message     ?? null,   // $17
        data.available_balance ?? 0,     // $18
        data.mini_statement   ?? null,   // $19
        data.txn_type         ?? null,   // $20
        data.npci_txn_id      ?? null,   // $21
        data.merchant_ref_id  ?? null,   // $22
        data.lat              ?? '0',    // $23
        data.long             ?? '0',    // $24
        data.provider         ?? null,   // $25
        data.failure_reason   ?? null,   // $26
        data.raw_response     ?? null,   // $27
        data.aadhaar_last4    ?? null,   // $28
    ];

    // Safety check — catch mismatch before hitting DB
    const COLUMN_COUNT = 28;
    if (values.length !== COLUMN_COUNT) {
        throw new Error(`Column/value mismatch: ${values.length} values for ${COLUMN_COUNT} columns`);
    }

    try {
        const result = await pool.query(query, values);
        console.log('✅ Saved to aeps_transactions, id:', result.rows[0].id);
        return result.rows[0];
    } catch (err) {
        console.error('❌ DB save error:', err.message);
        // Print each column/value pair for easy debugging
        const cols = [
            'user_id','bank_iin','amount','commission_amount','status',
            'provider_txn_id','rrn','response_code','error_message',
            'balance_amount','mini_statement_data','device_serial',
            'device_used','aeps_wallet_id','provider_txn_ref','npci_code',
            'npci_message','available_balance','mini_statement','txn_type',
            'npci_txn_id','merchant_ref_id','lat','long','provider',
            'failure_reason','raw_response','aadhaar_last4'
        ];
        cols.forEach((col, i) => {
            console.error(`  $${i+1} ${col}:`, values[i]);
        });
        throw err;
    }
}





class AepsController {
    /**
     * Health Check
     */
    async healthCheck(req, res) {
        res.json({
            status: 'success',
            message: 'AEPS API is running',
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Get Bank List
     */
    async getBankList(req, res) {
        try {
            const banks = await aepsService.getBankList();
            res.json({
                success: true,
                data: banks.data || banks
            });
        } catch (error) {
            console.error('Get Bank List Error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * Get State List
     */
    async getStateList(req, res) {
        try {
            const states = await aepsService.getStateList();
            res.json({
                success: true,
                data: states.data || states
            });
        } catch (error) {
            console.error('Get State List Error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * Get District List
     */
    async getDistrictList(req, res) {
        try {
            const { stateCode } = req.body;
            if (!stateCode) {
                return res.status(400).json({
                    success: false,
                    message: 'stateCode is required'
                });
            }
            const districts = await aepsService.getDistrictList(stateCode);
            res.json({
                success: true,
                data: districts.data || districts
            });
        } catch (error) {
            console.error('Get District List Error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * Register Merchant
     */
 async registerMerchant(req, res) {
    try {
        const {
            firstName,
            middleName,
            lastName,
            dob,
            emailId,
            mobileNo,                // Flutter still sends "mobileNo"
            aadhaarNo,
            panNo,
            merchantAddress1,
            merchantAddress2,
            merchantState,
            merchantDistrict,
            merchantPinCode,
            shopPan,
            bankAccountNumber,
            bankIfscCode,
            bankName,
            accountType,
            shopAddress,
            shopDistrict,
            shopState,
            shopPinCode,
            shopLat,
            shopLong,
            lat,
            long,
            pipe,
            gender
            // ipAddress is ignored (we set it server‑side)
            // merchantRefId is generated below
        } = req.body;

        // ---------- Basic validation (extend as needed) ----------
        const required = {
            firstName, lastName, dob, emailId, mobileNo, aadhaarNo,
            panNo, merchantAddress1, merchantState, merchantDistrict,
            merchantPinCode, shopPan, bankAccountNumber, bankIfscCode,
            bankName, accountType, shopAddress, shopDistrict, shopState,
            shopPinCode
        };

        const missing = Object.entries(required)
            .filter(([_, v]) => !v || (typeof v === 'string' && v.trim() === ''))
            .map(([k]) => k);

        if (missing.length > 0) {
            console.log('❌ Missing fields:', missing);
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missing.join(', ')}`
            });
        }

        // ---------- IP address (real client IP) ----------
        const ipAddress =
            req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
            req.socket.remoteAddress ||
            '127.0.0.1';

        // ---------- Generate merchantRefId ----------
        const merchantRefId = `MR_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        // ---------- Build the data object for the service ----------
        const merchantData = {
            // Personal
            firstName,
            middleName: middleName || '',
            lastName,
            dob,
            emailId,
            mobileNo,
            aadhaarNo,
            panNo,
            // Residence
            merchantAddress1,
            merchantAddress2: merchantAddress2 || '',
            merchantState,
            merchantDistrict,
            merchantPinCode,
            // Shop & Bank
            shopPan,
            bankAccountNumber,
            bankIfscCode,
            bankName,
            accountType,
            shopAddress,
            shopDistrict,
            shopState,
            shopPinCode,
            // Location
            shopLat: shopLat || 0,
            shopLong: shopLong || 0,
            lat: lat || 0,
            long: long || 0,
            // Meta
            ipAddress,
            merchantRefId,
            pipe: pipe || '1',
            gender: gender || 'M'
        };

        // ---------- Call service ----------
        const response = await aepsService.registerMerchant(merchantData);
        const merchantId = response.merchantId || response.data?.merchantId;
       
        console.log('📦 Registration response (decrypted):', JSON.stringify(response).substring(0, 500));

        // ---------- Save to DB if successful ----------
        if (response.status === '000' || response.responseCode === '000') {
              const realMerchantId = response.merchantId || response.data?.merchantId;

            // Save merchant to database (using your existing model)
            // Ensure the field names match your DB schema
            await MerchantModel.save({
        merchantId: realMerchantId,
        merchantRefId,
        firstName,
        lastName,
        mobileNo,           // goes into phone column
        emailId: emailId || '',
        aadhaarNo,
        panNo,
        pipe: pipe || '1',
        status: 'pending',
        userId: null        // can be linked later if needed
    });
        }

        res.json({
            success: response.status === '000' || response.responseCode === '000',
            data: response,
            merchantRefId
        });
    } catch (error) {
        console.error('Register Merchant Error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

    /**
     * Send OTP
     */
    async sendOtp(req, res) {
        try {
            const { merchantId, mobileNo, merchantRefId } = req.body;

            if (!merchantId || !mobileNo) {
                return res.status(400).json({
                    success: false,
                    message: 'merchantId and mobileNo are required'
                });
            }

            const refId = merchantRefId || `OTP_${Date.now()}`;
            const response = await aepsService.sendOtp(merchantId, mobileNo, refId);

            res.json({
                success: response.status === '000' || response.responseCode === '000',
                data: response,
                merchantRefId: refId
            });
        } catch (error) {
            console.error('Send OTP Error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * Verify OTP
     */
    async verifyOtp(req, res) {
        try {
            const { merchantId, otp, merchantRefId } = req.body;

            if (!merchantId || !otp) {
                return res.status(400).json({
                    success: false,
                    message: 'merchantId and otp are required'
                });
            }

            const response = await aepsService.verifyOtp(merchantId, otp, merchantRefId);

            if (response.status === '000') {
                await MerchantModel.updateVerificationStatus(merchantId, true);
            }

            res.json({
                success: response.status === '000',
                data: response
            });
        } catch (error) {
            console.error('Verify OTP Error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * 2 Factor Authentication (Biometric)
     */
    async twoFactorAuth(req, res) {
        try {
            const { merchantId, aadhaarNumber, pidData, deviceType, merchantRefId } = req.body;

            if (!merchantId || !aadhaarNumber || !pidData) {
                return res.status(400).json({
                    success: false,
                    message: 'merchantId, aadhaarNumber, and pidData are required'
                });
            }

            const response = await aepsService.twoFactorAuth(
                merchantId, aadhaarNumber, pidData, deviceType || 'mantra', merchantRefId
            );

            res.json({
                success: response.status === '000',
                data: response
            });
        } catch (error) {
            console.error('2FA Error:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * AEPS Transaction
     */
async aepsTransaction(req, res) {
    try {
        const {
            serviceType,
            merchantId,
            aadhaarNumber,
            bankIIN,
            amount,
            pidData,
            deviceType = 'mantra',
            merchantRefId,
            mobileNo,
            latitude,
            longitude,
            ipAddress
        } = req.body;

        // ✅ Get userId from JWT middleware if available
        const userId = req.body.userId || req.headers['userid'] || null;
        console.log('👤 userId from request:', userId);

        if (!serviceType || !merchantId || !aadhaarNumber || !bankIIN || !pidData) {
            return res.status(400).json({
                success: false,
                message: 'Required: serviceType, merchantId, aadhaarNumber, bankIIN, pidData'
            });
        }

        const txnRefId = merchantRefId ||
            `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const aadhaarLast4 = aadhaarNumber?.slice(-4) || '0000';

        console.log('📤 AEPS Transaction request:');
        console.log('  serviceType:', serviceType);
        console.log('  merchantId:', merchantId);
        console.log('  aadhaarNumber:', aadhaarNumber);
        console.log('  bankIIN:', bankIIN);
        console.log('  amount:', amount);
        console.log('  deviceType:', deviceType);
        console.log('  userId:', userId);

        const transactionData = {
            serviceType,
            merchantId,
            aadhaarNumber,
            mobileNo:      mobileNo   || '',
            bankIIN,
            amount:        amount     || '0',
            pidData,
            deviceType,
            merchantRefId: txnRefId,
            latitude:      latitude   || '0',
            longitude:     longitude  || '0',
            ipAddress:     ipAddress  || '192.168.1.1'
        };

        const response = await aepsService.aepsTransaction(transactionData);
        console.log('📥 AEPS response:', JSON.stringify(response));

        const isSuccess =
            response.successStatus === true  ||
            response.responseCode  === '000' ||
            response.status        === '000' ||
            response.statusCode    === '00';

        // ✅ Save to aeps_transactions using the function above
        const dbRecord = {
            user_id:             userId,   // ✅ from JWT now
            bank_iin:            bankIIN,
            amount:              parseFloat(amount) || 0,
            commission_amount:   0,
            status:              isSuccess ? 'SUCCESS' : 'FAILED',
            provider_txn_id:     response.txnRefId
                                   || response.transactionId
                                   || null,
            rrn:                 response.rrn || response.RRN || null,
            response_code:       response.responseCode || response.statusCode || null,
            error_message:       isSuccess ? null
                                   : (response.message || 'Transaction failed'),
            balance_amount:      parseFloat(response.availableBalance || 0),
            mini_statement_data: response.miniStatement
                                   ? JSON.stringify(response.miniStatement) : null,
            device_serial:       null,
            device_used:         deviceType,
            aeps_wallet_id:      null,
            provider_txn_ref:    txnRefId,
            npci_code:           response.npciCode   || null,
            npci_message:        response.npciMessage || null,
            available_balance:   parseFloat(response.availableBalance || 0),
            mini_statement:      response.miniStatement
                                   ? JSON.stringify(response.miniStatement) : null,
            txn_type:            serviceType,
            npci_txn_id:         response.npciTxnId  || null,
            merchant_ref_id:     txnRefId,
            lat:                 latitude  || '0',
            long:                longitude || '0',
            provider:            'AEPS_PROVIDER',
            failure_reason:      isSuccess ? null : (response.message || null),
            raw_response:        JSON.stringify(response),
            aadhaar_last4:       aadhaarLast4,
        };

        await saveAepsTransaction(dbRecord);  // ✅ calls the function defined above

        res.json({
            success:          isSuccess,
            data:             response,
            transactionRefId: txnRefId,
            message:          isSuccess
                                ? 'Transaction successful'
                                : (response.message || 'Transaction failed')
        });

    } catch (error) {
        console.error('❌ AEPS Transaction Error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
}
    /**
     * Transaction Status
     */
 
 async transactionStatus(req, res) {
    try {
        const { merchantRefId, txnRefId } = req.body;
        const refId = merchantRefId || txnRefId;

        if (!refId) {
            return res.status(400).json({
                success: false,
                message: 'Required: merchantRefId or txnRefId'
            });
        }

        // ✅ First, search in local aeps_transactions table
        const result = await pool.query(
            `SELECT 
                id,
                merchant_ref_id AS "merchantRefId",
                provider_txn_id AS "txnId",
                rrn,
                txn_type AS "transactionType",
                amount,
                status,
                response_code AS "responseCode",
                error_message AS "errorMessage",
                bank_name AS "bankName",
                bank_iin AS "bankIin",
                aadhaar_last4 AS "aadhaarLast4",
                available_balance AS "balance",
                mini_statement AS "miniStatementData",
                created_at AS "createdAt"
             FROM public.aeps_transactions
             WHERE merchant_ref_id = $1 
                OR provider_txn_ref = $1 
                OR provider_txn_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [refId]
        );

        if (result.rows.length > 0) {
            const tx = result.rows[0];
            return res.json({
                success: true,
                data: {
                    status: tx.status,
                    txnRefId: tx.merchantRefId,
                    amount: tx.amount,
                    rrn: tx.rrn,
                    bankName: tx.bankName,
                    aadhaarLast4: tx.aadhaarLast4,
                    balance: tx.balance,
                    miniStatementData: tx.miniStatementData,
                    createdAt: tx.createdAt,
                    errorMessage: tx.errorMessage,
                    transactionType: tx.transactionType
                }
            });
        }

        // If not found locally, fallback to provider API (optional)
        return res.status(404).json({
            success: false,
            message: 'Transaction not found'
        });
    } catch (error) {
        console.error('Transaction Status Error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

    /**
     * Webhook Callback (Provider calls this)
     */
    async webhookCallback(req, res) {
        try {
            const callbackData = req.body;
            console.log('Received callback:', callbackData);

            // Update transaction status
            if (callbackData.transactionId || callbackData.txnRefId) {
                await TransactionModel.updateStatus(
                    callbackData.transactionId || callbackData.txnRefId,
                    callbackData.status,
                    callbackData.statusDescription,
                    callbackData
                );
            }

            // Always respond with 200 to acknowledge receipt
            res.status(200).json({
                status: 'success',
                message: 'Callback received'
            });
        } catch (error) {
            console.error('Webhook Error:', error);
            res.status(200).json({ status: 'received' }); // Still return 200 to avoid retries
        }
    }

async getMerchantByPhone(req, res) {
    try {
        const { phone } = req.query;
        if (!phone) return res.status(400).json({ success: false, message: 'Phone required' });

        const merchant = await MerchantModel.findByPhone(phone);
        if (!merchant) return res.json({ success: false, message: 'Merchant not found' });

        res.json({
            success: true,
            data: {
                merchantId: merchant.merchant_id,
                merchantRefId: merchant.merchant_ref_id,
                firstName: merchant.first_name,
                lastName: merchant.last_name,
                phone: merchant.phone,
                email: merchant.email,
                aadhaarNo: merchant.aadhaar_no,
                panNo: merchant.pan_no,
                status: merchant.status
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}


async getHistory(req, res) {
  try {
    // Get userId from query parameter (highest priority)
    // Also support other sources if you want, but avoid req.user
    const userId = req.query.userId
                || req.headers['userid']
                || req.body.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized – userId required (query, header, or body)'
      });
    }

    const limit  = Math.min(parseInt(req.query.limit)  || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const statusFilter  = req.query.status  || null;
    const txnTypeFilter = req.query.txnType || null;

    const conditions = ['user_id = $1'];
    const params     = [userId];
    let   p          = 2;

    if (statusFilter) {
      conditions.push(`status = $${p++}`);
      params.push(statusFilter.toUpperCase());
    }
    if (txnTypeFilter) {
      conditions.push(`txn_type = $${p++}`);
      params.push(txnTypeFilter.toUpperCase());
    }

    const where = conditions.join(' AND ');

    const result = await pool.query(
      `SELECT
          id,
          user_id                 AS "userId",
          merchant_ref_id         AS "merchantRefId",
          provider_txn_id         AS "txnId",
          provider_txn_ref        AS "providerTxnRef",
          npci_txn_id             AS "npciTxnId",
          rrn,
          txn_type                AS "transactionType",
          amount,
          commission_amount       AS "commissionAmount",
          balance_amount          AS "balanceAmount",
          available_balance       AS "availableBalance",
          status,
          response_code           AS "responseCode",
          npci_code               AS "npciCode",
          npci_message            AS "npciMessage",
          bank_name               AS "bankName",
          bank_iin                AS "bankIin",
          aadhaar_last4           AS "aadhaarLast4",
          error_message           AS "errorMessage",
          failure_reason          AS "failureReason",
          device_serial           AS "deviceSerial",
          device_used             AS "deviceUsed",
          provider,
          lat,
          long,
          mini_statement          AS "miniStatementData",
          created_at              AS "createdAt",
          updated_at              AS "updatedAt"
       FROM public.aeps_transactions
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.aeps_transactions WHERE ${where}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;

    console.log(`[getHistory] userId=${userId} rows=${result.rows.length} total=${total}`);

    return res.status(200).json({
      success: true,
      data: {
        transactions: result.rows,
        total,
        limit,
        offset,
      },
    });

  } catch (error) {
    console.error('[getHistory] error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction history',
      error: error.message,
    });
  }
}


}

module.exports = new AepsController();