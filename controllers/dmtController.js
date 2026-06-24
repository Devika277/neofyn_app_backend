// backend/controllers/dmtController.js

// ⚠️ REMINDER: Also fix UTR fallback in services/dmtServiceNew.js
// Change: const utrValue = providerResult.utr || providerResult.providerRefId || null;
// To:     const utrValue = providerResult.utr || null;

const dmtService = require('../services/DMT/dmtServiceNew');
const db = require('../config/db');
const axios = require('axios');
const walletService = require('../services/walletService');
const payoutProvider = require('../providers/vimopayProvider');
const dmtProviderRouter = require('../providers/dmtProviderRouter');
const commissionService = require('../services/commission/commissionService');

const getUserId = (req) => req.user.id;

// ========== REMITTER (Sender) ==========

/**
 * POST /dmt/remitter/lookup
 */
exports.lookupRemitter = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { mobile, productType } = req.body;
    if (!mobile) return res.status(400).json({ error: 'Mobile number required' });
    if (!productType) return res.status(400).json({ error: 'Product type required' });

    const { rows } = await db.query(
      `SELECT id, retailer_id, monthly_limit, monthly_used, first_name, last_name, product_type
       FROM dmt_remitters 
       WHERE retailer_id = $1 AND mobile = $2 AND product_type = $3 AND is_active = true`,
      [userId, mobile, productType]
    );

    if (rows.length === 0) {
      return res.json({ found: false });
    }

    const remitter = rows[0];
    // No override – limit comes directly from DB
    remitter.product_type = productType;
    res.json({ found: true, remitter });
  } catch (error) {
    console.error('Lookup remitter error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /dmt/check-phone (legacy)
 */
exports.checkPhoneExists = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { phone, productType } = req.query;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });
    if (!productType) return res.status(400).json({ error: 'Product type required' });

    const { rows } = await db.query(
      `SELECT id, retailer_id, monthly_limit, monthly_used, first_name, last_name, product_type
       FROM dmt_remitters 
       WHERE retailer_id = $1 AND mobile = $2 AND product_type = $3 AND is_active = true`,
      [userId, phone, productType]
    );
    if (rows.length === 0) return res.json({ exists: false });

    const remitter = rows[0];
    remitter.product_type = productType;
    res.json({ exists: true, remitter });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /dmt/remitter/register
 */
exports.registerRemitter = async (req, res) => {
  const client = await db.connect();
  try {
    const userId = getUserId(req);
    const { mobile, firstName, lastName, stateCode, productType, aadhaarNumber, lat, long } = req.body;

    if (!mobile || !firstName || !productType) {
      return res.status(400).json({ error: 'Mobile, first name and product type required' });
    }
    if (!aadhaarNumber || !/^\d{12}$/.test(aadhaarNumber)) {
      return res.status(400).json({ error: 'Valid 12-digit Aadhaar number is required' });
    }
    if (!['lite', 'smart'].includes(productType)) {
      return res.status(400).json({ error: 'Invalid product type' });
    }

    const monthlyLimit = productType === 'lite' ? 25000 : 200000;
    const now = new Date();

    await client.query('BEGIN');

    // Insert remitter
    const { rows } = await client.query(
      `INSERT INTO dmt_remitters 
       (retailer_id, mobile, first_name, last_name, state_code, aadhaar_number,
        monthly_limit, monthly_used, limit_reset_at, is_active, kyc_status, product_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, 'basic', $10)
       RETURNING id`,
      [userId, mobile, firstName, lastName || null, stateCode || null, aadhaarNumber,
       monthlyLimit, 0, now, productType]
    );
    const remitterId = rows[0].id;

    // Deduct registration fee only for DMT Lite
    if (productType === 'lite') {
      await walletService.deductMoney(
        userId, 10.00,
        `DMT remitter registration fee for ${mobile}`,
        `remitter_${remitterId}`,
        client
      );
    }

    await client.query('COMMIT');

    // Call provider to send OTP (mock/logic)
    const isMock = process.env.VITE_VIMOPAY_MOCK_MODE === 'true';
    // ... (rest of OTP sending logic remains same)

    res.status(201).json({ 
      id: remitterId, 
      message: 'Remitter registered successfully', 
      otpSent: !isMock,
      registrationFeeCharged: productType === 'lite'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Mobile number already registered' });
    if (error.message === 'Insufficient balance') return res.status(402).json({ error: 'Insufficient wallet balance to pay registration fee' });
    if (error.message === 'Wallet not found') return res.status(404).json({ error: 'User wallet not found. Please contact support.' });
    console.error('Register remitter error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

/**
 * POST /dmt/remitter/verify-otp
 */
exports.verifySenderOtp = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { senderMobile, otpPin, firstName, lastName } = req.body;
    if (!senderMobile || !otpPin) {
      return res.status(400).json({ error: 'Mobile and OTP required' });
    }

    const isMock = process.env.VITE_VIMOPAY_MOCK_MODE === 'true';
    if (isMock) {
      if (otpPin === '1234') {
        const { rows } = await db.query(
          `SELECT id, retailer_id, first_name, last_name, monthly_limit, monthly_used 
           FROM dmt_remitters 
           WHERE retailer_id = $1 AND mobile = $2 AND is_active = true`,
          [userId, senderMobile]
        );
        if (rows.length === 0) {
          return res.status(404).json({ error: 'Remitter not found' });
        }
        const remitter = rows[0];
        remitter.product_type = remitter.monthly_limit == 25000 ? 'lite' : 'smart';
        return res.json({ success: true, remitter });
      } else {
        return res.status(400).json({ error: 'Invalid OTP' });
      }
    }

    // Live mode: call provider
    const providerResult = await dmtProviderRouter.verifySenderOtp({
      mobile: senderMobile,
      otp: otpPin,
      firstName,
      lastName
    });

    if (providerResult.success) {
      const { rows } = await db.query(
        `SELECT id, retailer_id, first_name, last_name, monthly_limit, monthly_used 
         FROM dmt_remitters 
         WHERE retailer_id = $1 AND mobile = $2 AND is_active = true`,
        [userId, senderMobile]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Remitter not found' });
      const remitter = rows[0];
      remitter.product_type = remitter.monthly_limit == 25000 ? 'lite' : 'smart';
      return res.json({ success: true, remitter });
    } else {
      return res.status(400).json({ error: providerResult.message || 'OTP verification failed' });
    }
  } catch (error) {
    console.error('Verify sender OTP error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /dmt/remitters
 */
exports.getRemitters = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { rows } = await db.query(
      `SELECT id, retailer_id, mobile, first_name, last_name, monthly_limit, monthly_used, is_active 
       FROM dmt_remitters WHERE retailer_id = $1`,
      [userId]
    );
    const formatted = rows.map(r => ({
      ...r,
      product_type: r.monthly_limit == 25000 ? 'lite' : 'smart'
    }));
    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /dmt/remitter/:remitterId
 */
exports.getRemitterDetails = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { remitterId } = req.params;
    const { rows } = await db.query(
      `SELECT * FROM dmt_remitters WHERE id = $1 AND retailer_id = $2`,
      [remitterId, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Remitter not found' });
    const remitter = rows[0];
    remitter.product_type = remitter.monthly_limit == 25000 ? 'lite' : 'smart';
    res.json(remitter);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========== BENEFICIARY ==========

exports.addBeneficiary = async (req, res) => {
  const client = await db.connect();
  try {
    const userId = getUserId(req);
    const {
      remitterId,
      accountHolderName,
      accountNumber,
      ifscCode,
      bankName,
      bankCode,
      stateCode,
      cityCode,
      beneficiaryMobile
    } = req.body;

    // Verify remitter
    const { rows: rem } = await client.query(
      `SELECT id FROM dmt_remitters WHERE id = $1 AND retailer_id = $2`,
      [remitterId, userId]
    );
    if (rem.length === 0) {
      await client.release();
      return res.status(403).json({ error: 'Remitter not found or not yours' });
    }

    await client.query('BEGIN');

    // Insert beneficiary
    const { rows } = await client.query(
      `INSERT INTO dmt_beneficiaries 
       (remitter_id, account_holder_name, account_number, ifsc_code, bank_name, bank_code,
        bene_state, bene_city, beneficiary_mobile, is_active, verified, use_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, false, 0, NOW(), NOW())
       RETURNING id`,
      [remitterId, accountHolderName, accountNumber, ifscCode, bankName || '', bankCode || null,
       stateCode || null, cityCode || null, beneficiaryMobile || null]
    );
    const beneficiaryId = rows[0].id;

    // Deduct beneficiary fee
    await walletService.deductMoney(
      userId, 3.00,
      `DMT beneficiary addition fee for ${accountNumber}`,
      `beneficiary_${beneficiaryId}`,
      client
    );

    await client.query('COMMIT');
    res.status(201).json({ id: beneficiaryId, message: 'Beneficiary added successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.message === 'Insufficient balance') return res.status(402).json({ error: 'Insufficient wallet balance to add beneficiary' });
    if (error.message === 'Wallet not found') return res.status(404).json({ error: 'User wallet not found. Please contact support.' });
    console.error('Add beneficiary error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

exports.getBeneficiaries = async (req, res) => {
  try {
    const { remitterId } = req.params;
    const { rows } = await db.query(
      `SELECT id, account_holder_name, account_number, ifsc_code, bank_name, 
              beneficiary_mobile, verified, is_active, use_count, last_used_at
       FROM dmt_beneficiaries 
       WHERE remitter_id = $1 AND is_active = true`,
      [remitterId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteBeneficiary = async (req, res) => {
  try {
    const { beneficiaryId } = req.params;
    await db.query(`UPDATE dmt_beneficiaries SET is_active = false WHERE id = $1`, [beneficiaryId]);
    res.json({ message: 'Beneficiary deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ========== TRANSFER (TPIN only) ==========

exports.createDmtTransfer = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { remitterId, beneficiaryId, amount, tpin, transferMode = 'IMPS', lat, long, remark } = req.body;

    const result = await dmtService.processDmtTransfer(userId, {
      remitterId,
      beneficiaryId,
      amount,
      tpin,
      transferMode,
      lat,
      long,
      remark
    });

    // ✅ Return UTR number (similar to payout returning bank_ref_no)
    res.json({
      success: true,
      transactionId: result.transactionId,
      utrNumber: result.utrNumber,
      providerStatus: result.providerStatus,
      message: 'Transfer successful'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ========== TRANSACTIONS ==========

exports.getDmtTransactions = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { remitterId, startDate, endDate, limit = 50 } = req.query;

    let query = `
      SELECT 
        t.id,
        t.created_at,
        t.amount,
        t.status,
        t.utr_number,
        t.remark,
        t.retailer_id,
        t.remitter_id,
        t.beneficiary_id,
        t.transfer_mode,
        t.failure_reason,
        t.iyda_txn_id,
        CONCAT(r.first_name, ' ', r.last_name) AS remitter_name,
        r.mobile AS remitter_mobile,
        b.account_holder_name AS beneficiary_name,
        b.account_number,
        b.bank_name,
        b.beneficiary_mobile,
        cl.commission_amount
      FROM dmt_transactions t
      LEFT JOIN dmt_remitters r ON t.remitter_id = r.id
      LEFT JOIN dmt_beneficiaries b ON t.beneficiary_id = b.id
      LEFT JOIN commission_ledger cl ON cl.transaction_ref = t.iyda_txn_id
      WHERE t.retailer_id = $1
    `;
    const params = [userId];
    let idx = 2;

    if (remitterId) {
      query += ` AND t.remitter_id = $${idx}`;
      params.push(remitterId);
      idx++;
    }
    if (startDate) {
      query += ` AND t.created_at::date >= $${idx}`;
      params.push(startDate);
      idx++;
    }
    if (endDate) {
      query += ` AND t.created_at::date <= $${idx}`;
      params.push(endDate);
      idx++;
    }
    query += ` ORDER BY t.created_at DESC LIMIT $${idx}`;
    params.push(parseInt(limit));

    const { rows } = await db.query(query, params);
    
    const transactions = rows.map(row => ({
      ...row,
      amount: parseFloat(row.amount),
      commission_amount: row.commission_amount ? parseFloat(row.commission_amount) : null
    }));

    res.json({ success: true, transactions });
  } catch (error) {
    console.error('Get DMT transactions error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.adminGetDmtTransactions = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { user_id, status, from, to } = req.query;
    let query = `
      SELECT t.*, u.name as user_name, u.phone as user_phone
      FROM dmt_transactions t
      JOIN users u ON t.retailer_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;
    if (user_id) {
      query += ` AND t.retailer_id = $${idx}`;
      params.push(user_id);
      idx++;
    }
    if (status) {
      query += ` AND t.status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (from) {
      query += ` AND t.created_at::date >= $${idx}`;
      params.push(from);
      idx++;
    }
    if (to) {
      query += ` AND t.created_at::date <= $${idx}`;
      params.push(to);
      idx++;
    }
    query += ` ORDER BY t.created_at DESC`;
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.adminGetAllDmtTransactions = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const query = `
      SELECT 
        t.id,
        t.created_at,
        t.amount,
        t.status,
        t.utr_number,
        t.remark,
        t.provider_txn_id,
        t.commission_credited,
        t.retailer_id,
        t.remitter_id,
        t.beneficiary_id,
        t.transfer_mode,
        t.failure_reason,
        t.iyda_txn_id,
        u.phone AS retailer_phone,
        u.first_name AS retailer_first_name,
        u.last_name AS retailer_last_name,
        CONCAT(r.first_name, ' ', r.last_name) AS remitter_name,
        r.mobile AS remitter_mobile,
        r.product_type,
        b.account_holder_name AS beneficiary_name,
        b.account_number,
        b.ifsc_code,
        cl.commission_amount
      FROM dmt_transactions t
      LEFT JOIN users u ON t.retailer_id = u.id
      LEFT JOIN dmt_remitters r ON t.remitter_id = r.id
      LEFT JOIN dmt_beneficiaries b ON t.beneficiary_id = b.id
      LEFT JOIN commission_ledger cl ON cl.transaction_ref = t.iyda_txn_id
      ORDER BY t.created_at DESC
    `;

    const { rows } = await db.query(query);
    const transactions = rows.map(row => ({
      ...row,
      amount: parseFloat(row.amount),
      commission_amount: row.commission_amount ? parseFloat(row.commission_amount) : null
    }));

    res.json({ success: true, transactions });
  } catch (error) {
    console.error('Admin get all DMT error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ========== WEBHOOK ==========

exports.dmtWebhook = async (req, res) => {
  try {
    console.log('🔴 DMT WEBHOOK FULL PAYLOAD:', JSON.stringify(req.body, null, 2));

    const callbackData = req.body;
    const { iydaTxnId, providerTxnId, statusCode, message } = callbackData;
    if (!iydaTxnId) {
      return res.status(200).json({ successStatus: true, message: 'Missing iydaTxnId' });
    }

    let status = 'pending';
    if (statusCode === '000') status = 'success';
    else if (statusCode === '001') status = 'failed';

    // Comprehensive UTR extraction
    const utr = callbackData.utr ||
                callbackData.Utr ||
                callbackData.rrn ||
                callbackData.RRN ||
                callbackData.referenceNumber ||
                callbackData.ReferenceNumber ||
                callbackData.bankRefNo ||
                callbackData.BankRefNo ||
                callbackData.txnRef ||
                callbackData.TxnRef ||
                callbackData.transactionReference ||
                callbackData.TransactionReference ||
                callbackData.refNo ||
                callbackData.RefNo ||
                providerTxnId ||   // last resort fallback
                null;

    console.log(`[DMT Webhook] UTR captured: ${utr}`);

    // Update transaction including UTR
    await db.query(
      `UPDATE dmt_transactions 
       SET status = $1, provider_txn_id = $2, utr_number = $3, failure_reason = $4
       WHERE iyda_txn_id = $5 AND status = 'pending'`,
      [status, providerTxnId || null, utr, message || null, iydaTxnId]
    );

    // Success: credit commission
    if (status === 'success') {
      const { rows: check } = await db.query(
        `SELECT commission_credited, retailer_id, amount, remitter_id 
         FROM dmt_transactions WHERE iyda_txn_id = $1`,
        [iydaTxnId]
      );
      
      if (check.length > 0 && !check[0].commission_credited) {
        const { retailer_id, amount, remitter_id } = check[0];
        
        const { rows: rem } = await db.query(
          `SELECT product_type FROM dmt_remitters WHERE id = $1`,
          [remitter_id]
        );
        
        if (rem.length > 0) {
          const serviceType = rem[0].product_type === 'lite' ? 'dmt' : 'dmt_smart';
          
          try {
            await commissionService.processCommission(
              serviceType,
              amount,
              retailer_id,
              { subType: 'transfer' }
            );
            await db.query(
              `UPDATE dmt_transactions SET commission_credited = TRUE WHERE iyda_txn_id = $1`,
              [iydaTxnId]
            );
            console.log(`✅ Commission credited for ${iydaTxnId}`);
          } catch (commErr) {
            console.error(` Commission crediting failed for ${iydaTxnId}:`, commErr.message);
          }
        }
      }
    }

    // Failure: refund
    if (status === 'failed') {
      const { rows: txn } = await db.query(
        `SELECT retailer_id, amount, remitter_id FROM dmt_transactions WHERE iyda_txn_id = $1`,
        [iydaTxnId]
      );
      if (txn.length > 0) {
        await dmtService.refundFailedTransaction(txn[0].retailer_id, txn[0].amount, txn[0].remitter_id);
      }
    }

    res.status(200).json({ successStatus: true, message: 'Success', responseCode: '000' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).json({ successStatus: true, message: 'Error logged' });
  }
};

// ========== MASTER DATA ==========

exports.getBankList = async (req, res) => {
  try {
    const rawBanks = await payoutProvider.getBankList();
    const banks = rawBanks.map((bank) => ({
      code: bank.bankCode || bank.code || bank.bank_id,
      name: bank.bankName || bank.name || bank.description
    }));
    console.log(`[DMT Controller] Loaded ${banks.length} banks`);
    res.json({ success: true, banks });
  } catch (error) {
    console.error('[DMT Controller] Bank list error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getStateList = async (req, res) => {
  try {
    const rawStates = await payoutProvider.getStateList();
    const states = rawStates.map((state) => ({
      code: state.stateCode || state.code || state.state_id,
      name: state.stateName || state.name || state.state_name || state.description
    }));
    console.log(`[DMT Controller] Loaded ${states.length} states`);
    res.json({ success: true, states });
  } catch (error) {
    console.error('[DMT Controller] State list error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getCityList = async (req, res) => {
  const { stateCode } = req.query;
  if (!stateCode) return res.status(400).json({ success: false, error: 'stateCode required' });
  try {
    const token = await payoutProvider.getAuthToken();
    const response = await axios.get(
      `${process.env.PAYOUT_BASE_URL}/masterapi/api/master/citylist`,
      {
        params: { stateCode },
        headers: { Authorization: `Bearer ${token}`, userId: process.env.PAYOUT_USER_ID },
        timeout: 5000
      }
    );
    if (!response.data.successStatus) return res.json({ success: true, cities: [] });
    const { decrypt } = require('../utils/vimopayEncrypt');
    const cities = JSON.parse(decrypt(response.data.data)).map((city) => ({
      code: city.cityCode || city.code,
      name: city.cityName || city.name
    }));
    res.json({ success: true, cities });
  } catch (error) {
    console.warn(`[DMT Controller] City list not available for ${stateCode}:`, error.message);
    res.json({ success: true, cities: [] });
  }
};