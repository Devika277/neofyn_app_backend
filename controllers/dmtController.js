// backend/controllers/dmtController.js

const dmtService = require('../services/DMT/dmtServiceNew');
const db = require('../config/db');
const axios = require('axios');
const walletService = require('../services/walletService');
const payoutProvider = require('../providers/vimopayProvider');
const dmtProviderRouter = require('../providers/dmtProviderRouter');
const commissionService = require('../services/Commission/commissionService');

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
      message: result.message || 'Transfer successful'
    });
  } catch (error) {
    console.error('DMT Transfer error:', error);
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


// ========== WEBHOOK ==========
// async function processWebhookUpdate(
//   iydaTxnId,
//   finalStatus,
//   txnId,
//   rrn,
//   responseMessage,
//   body,

//   res
// ){

//   const update = await db.query(
//     `
//     UPDATE dmt_transactions
//     SET 
//       status=$1,
//       provider_txn_id=COALESCE(provider_txn_id,$2),
//       utr_number=COALESCE(utr_number,$3),
//       failure_reason=$4,
//       raw_response=$5,
//       updated_at=NOW()
//     WHERE iyda_txn_id=$6
//     RETURNING id,retailer_id,amount,remitter_id,commission_credited
//     `,
//     [
//       finalStatus,
//       txnId || null,
//       rrn || null,
//       finalStatus==='failed'
//         ? responseMessage
//         : null,
//       JSON.stringify(body),
//       iydaTxnId
//     ]
//   );


//   console.log(
//     "Webhook update rows:",
//     update.rowCount
//   );


//   if(update.rows.length){

//     const txn = update.rows[0];


//     if(finalStatus==="success" && !txn.commission_credited){

//       try{

//         const {rows}=await db.query(
//           `
//           SELECT product_type
//           FROM dmt_remitters
//           WHERE id=$1
//           `,
//           [txn.remitter_id]
//         );


//         if(rows.length){

//           const serviceType =
//           rows[0].product_type==="lite"
//           ?
//           "dmt"
//           :
//           "dmt_smart";


//           await commissionService.processCommission(
//             serviceType,
//             Number(txn.amount),
//             txn.retailer_id,
//             {
//               subType:"transfer",
//               transactionRef:iydaTxnId
//             }
//           );


//           await db.query(
//             `
//             UPDATE dmt_transactions
//             SET commission_credited=true
//             WHERE id=$1
//             `,
//             [txn.id]
//           );


//         }

//       }catch(e){
//         console.log(
//           "Commission error:",
//           e.message
//         );
//       }

//     }


//     if(finalStatus==="failed"){

//       await dmtService.refundFailedTransaction(
//         txn.retailer_id,
//         Number(txn.amount),
//         txn.remitter_id
//       );

//     }

//   }


//  return res.status(200).json({
//    successStatus:true,
//    message:"processed",
//    responseCode:"000"
//  });


// }
exports.dmtWebhook = async (req, res) => {
  try {
    console.log('🔴 ========================================');
    console.log('🔴 DMT WEBHOOK RECEIVED');
    console.log('🔴 Timestamp:', new Date().toISOString());
    console.log('🔴 Headers:', JSON.stringify(req.headers, null, 2));
    console.log('🔴 Full Payload:', JSON.stringify(req.body, null, 2));
    console.log('🔴 ========================================');

    // const body = req.body;
    const body = req.body.data || req.body;
    console.log(
 "FINAL CALLBACK BODY:",
 JSON.stringify(body,null,2)
);
    // Extract identifiers - try multiple possible field names
    const merchantRefId = body.merchantRefId || 
                          body.merchant_ref_id || 
                          body.orderId || 
                          body.order_id ||
                          body.clientRefId ||
                          body.txnId;
    const txnStatusCode = String(
  body.txnStatusCode ||
  body.status ||
  body.txnStatus ||
  body.responseCode ||
  ''
);
    // const txnStatusCode = body.txnStatusCode || 
    //                       body.status || 
    //                       body.txnStatus ||
    //                       body.responseCode;
    
    // const rrn = body.rrn || 
    //             body.utr || 
    //             body.UTR || 
    //             body.bankRefNo ||
    //             body.referenceNumber;
const rrn =
      body.rrn ||
      body.utr ||
      body.UTR ||
      body.bankRefNo ||
      body.bankReferenceNumber ||
      body.transactionReferenceNumber ||
      body.referenceNumber ||
      null;    
    const txnId = body.txnId || 
                  body.transactionId || 
                  body.providerRefId;
    
    const responseMessage = body.responseMessage || 
                            body.message || 
                            body.statusMessage;

    console.log(`📊 Extracted merchantRefId: ${merchantRefId}`);
    console.log(`📊 Extracted txnStatusCode: ${txnStatusCode}`);
    console.log(`📊 Extracted rrn/UTR: ${rrn}`);
    console.log(`📊 Extracted txnId: ${txnId}`);

    if (!merchantRefId) {
      console.log('⚠️ No merchantRefId found in webhook - cannot process');
      // Still return 200 so VimoPay doesn't retry
      return res.status(200).json({ 
        successStatus: true, 
        message: 'No reference ID', 
        responseCode: '000' 
      });
    }

    // Normalize: replace hyphens with underscores for DB lookup
    const iydaTxnId = String(merchantRefId).replace(/-/g, '_');
    // const iydaTxnId = merchantRefId;
    console.log(`📊 Normalized iydaTxnId for DB: ${iydaTxnId}`);

    // Determine status
    let finalStatus;
    if (txnStatusCode === '000' || txnStatusCode === '00' || txnStatusCode === 'SUCCESS') {
      finalStatus = 'success';
    } else if (txnStatusCode === '001' || txnStatusCode === '01' || txnStatusCode === 'FAILED' || txnStatusCode === 'FAILURE') {
      finalStatus = 'failed';
    } else if (txnStatusCode === '002' || txnStatusCode === '02' || txnStatusCode === 'REJECTED') {
      finalStatus = 'rejected';
    } else if (txnStatusCode === '004' || txnStatusCode === '04' || txnStatusCode === 'PENDING') {
      finalStatus = 'pending';
    } else {
      finalStatus = 'pending';
    }

    console.log(`📊 Final status: ${finalStatus}`);

    // First check if transaction exists
    const checkResult = await db.query(
      `SELECT id, status, retailer_id, amount, remitter_id, commission_credited 
       FROM dmt_transactions 
       WHERE iyda_txn_id = $1`,
      [iydaTxnId]
    );

    if (checkResult.rows.length === 0) {
      console.error(`❌ No transaction found for iydaTxnId: ${iydaTxnId}`);
      
      // Try with original merchantRefId (without normalization)
      const checkResult2 = await db.query(
        `SELECT id, iyda_txn_id FROM dmt_transactions WHERE iyda_txn_id = $1`,
        [merchantRefId]
      );
      
      if (checkResult2.rows.length > 0) {
        console.log(`✅ Found with original merchantRefId: ${merchantRefId}`);
        // Use this instead
        return processWebhookUpdate(merchantRefId, finalStatus, txnId, rrn, responseMessage, body, res);
      }
      
      console.error(`❌ Transaction not found with either format`);
      return res.status(200).json({ 
        successStatus: true, 
        message: 'Transaction not found', 
        responseCode: '000' 
      });
    }

    const existingTxn = checkResult.rows[0];
    console.log(`✅ Found transaction: ID=${existingTxn.id}, Current Status=${existingTxn.status}`);

    // If already in final state, don't update
    if (existingTxn.status === 'success' && finalStatus === 'success') {
      console.log(`⚠️ Transaction already marked as success - skipping update`);
      
      // But update UTR if we have it and it's missing
      if (rrn) {
        await db.query(
          `UPDATE dmt_transactions SET utr_number = $1, raw_response = $2, updated_at = NOW() 
           WHERE iyda_txn_id = $3 AND utr_number IS NULL`,
          [rrn, JSON.stringify(body), iydaTxnId]
        );
        console.log(`✅ UTR updated to: ${rrn}`);
      }
      
      return res.status(200).json({ 
        successStatus: true, 
        message: 'Already processed', 
        responseCode: '000' 
      });
    }

    // Update transaction
    const updateResult = await db.query(
      `UPDATE dmt_transactions 
       SET status = $1, 
           provider_txn_id = COALESCE(provider_txn_id, $2),
           utr_number = COALESCE(utr_number, $3),
           failure_reason = $4,
           raw_response = $5,
           updated_at = NOW()
       WHERE iyda_txn_id = $6
       RETURNING id, retailer_id, amount, remitter_id, commission_credited`,
      [
        finalStatus,
        txnId || null,
        rrn || null,
        finalStatus === 'failed' ? (responseMessage || 'Provider failure') : null,
        JSON.stringify(body),
        iydaTxnId
      ]
    );

    console.log(`✅ Rows updated: ${updateResult.rowCount}`);

    if (updateResult.rows.length > 0) {
      const txn = updateResult.rows[0];
      console.log(`✅ Transaction ${iydaTxnId} updated to ${finalStatus}, UTR: ${rrn}`);

      // Credit commission on success
      if (finalStatus === 'success' && !txn.commission_credited) {
        try {
          const { rows: rem } = await db.query(
            `SELECT product_type FROM dmt_remitters WHERE id = $1`,
            [txn.remitter_id]
          );
          if (rem.length > 0) {
            const commissionService = require('../services/Commission/commissionService');
            const serviceType = rem[0].product_type === 'lite' ? 'dmt' : 'dmt_smart';
            await commissionService.processCommission(
              serviceType,
              parseFloat(txn.amount),
              txn.retailer_id,
              { subType: 'transfer', transactionRef: iydaTxnId }
            );
            await db.query(
              `UPDATE dmt_transactions SET commission_credited = TRUE WHERE id = $1`,
              [txn.id]
            );
            console.log(`✅ Commission credited for ${iydaTxnId}`);
          }
        } catch (commErr) {
          console.error(`❌ Commission error:`, commErr.message);
        }
      }

      // Refund on failure
      if (finalStatus === 'failed') {
        try {
          const dmtService = require('../services/DMT/dmtServiceNew');
          await dmtService.refundFailedTransaction(
            txn.retailer_id,
            parseFloat(txn.amount),
            txn.remitter_id
          );
          console.log(`✅ Refund done for ${iydaTxnId}`);
        } catch (refundErr) {
          console.error(`❌ Refund error:`, refundErr.message);
        }
      }
    }

    return res.status(200).json({ 
      successStatus: true, 
      message: 'Success', 
      responseCode: '000' 
    });

  } catch (error) {
    console.error('❌ DMT Webhook error:', error.message, error.stack);
    // Always return 200 so VimoPay doesn't keep retrying
    return res.status(200).json({ 
      successStatus: true, 
      message: 'Error logged but acknowledged', 
      responseCode: '000' 
    });
  }
};

// exports.dmtWebhook = async (req, res) => {
//   try {
//     console.log('🔴 DMT WEBHOOK RECEIVED');
//     console.log('Full Payload:', JSON.stringify(req.body, null, 2));

//     const body = req.body;
//     const { 
//       txnStatusCode, 
//       txnId, 
//       merchantRefId,   // comes as DMT-37-xxx-xxx (hyphens)
//       rrn, 
//       responseMessage 
//     } = body;

//     if (!merchantRefId) {
//       console.log('⚠️ No merchantRefId in webhook');
//       return res.status(200).json({ successStatus: true, message: 'Success', responseCode: '000' });
//     }

//     // ✅ Normalize hyphens → underscores to match DB
//     const iydaTxnId = merchantRefId.replace(/-/g, '_');
//     console.log(`📊 merchantRefId from VimoPay: ${merchantRefId}`);
//     console.log(`📊 Normalized for DB lookup:   ${iydaTxnId}`);
//     console.log(`📊 txnStatusCode: ${txnStatusCode}, rrn: ${rrn}`);

//     // Determine status
//     const finalStatus = 
//       txnStatusCode === '000' ? 'success' :
//       txnStatusCode === '001' ? 'failed'  : 
//       txnStatusCode === '002' ? 'rejected' : 'pending';

//     console.log(`📊 Final status: ${finalStatus}`);

//     // ✅ FIXED: Use correct column name 'iyda_txn_id'
//     const updateResult = await db.query(
//       `UPDATE dmt_transactions 
//        SET status = $1, 
//            provider_txn_id = COALESCE(provider_txn_id, $2),
//            utr_number = $3,
//            failure_reason = $4,
//            raw_response = $5,
//            updated_at = NOW()
//        WHERE iyda_txn_id = $6 
//        AND status = 'pending'
//        RETURNING id, retailer_id, amount, remitter_id, commission_credited`,
//       [
//         finalStatus,
//         txnId || null,
//         rrn || null,
//         finalStatus === 'failed' ? (responseMessage || 'Provider failure') : null,
//         JSON.stringify(body),
//         iydaTxnId  // ✅ Use the normalized version (with underscores)
//       ]
//     );

//     console.log(`✅ Rows updated: ${updateResult.rowCount}`);

//     if (updateResult.rows.length > 0) {
//       const txn = updateResult.rows[0];
//       console.log(`✅ Transaction ${iydaTxnId} updated to ${finalStatus}`);

//       // Credit commission on success
//       if (finalStatus === 'success' && !txn.commission_credited) {
//         try {
//           const { rows: rem } = await db.query(
//             `SELECT product_type FROM dmt_remitters WHERE id = $1`,
//             [txn.remitter_id]
//           );
//           if (rem.length > 0) {
//             const commissionService = require('../services/Commission/commissionService');
//             const serviceType = rem[0].product_type === 'lite' ? 'dmt' : 'dmt_smart';
//             await commissionService.processCommission(
//               serviceType,
//               parseFloat(txn.amount),
//               txn.retailer_id,
//               { subType: 'transfer', transactionRef: iydaTxnId }
//             );
//             await db.query(
//               `UPDATE dmt_transactions SET commission_credited = TRUE WHERE id = $1`,
//               [txn.id]
//             );
//             console.log(`✅ Commission credited for ${iydaTxnId}`);
//           }
//         } catch (commErr) {
//           console.error(`❌ Commission error:`, commErr.message);
//         }
//       }

//       // Refund on failure
//       if (finalStatus === 'failed') {
//         try {
//           const dmtService = require('../services/dmtService');
//           await dmtService.refundFailedTransaction(
//             txn.retailer_id,
//             parseFloat(txn.amount),
//             txn.remitter_id
//           );
//           console.log(`✅ Refund done for ${iydaTxnId}`);
//         } catch (refundErr) {
//           console.error(`❌ Refund error:`, refundErr.message);
//         }
//       }
//     } else {
//       console.warn(`⚠️ No pending DMT transaction found for iyda_txn_id: ${iydaTxnId}`);
      
//       // 🔍 Debug: Check if transaction exists with different status
//       const checkResult = await db.query(
//         `SELECT id, status, iyda_txn_id FROM dmt_transactions 
//          WHERE iyda_txn_id = $1`,
//         [iydaTxnId]
//       );
      
//       if (checkResult.rows.length > 0) {
//         console.log(`🔍 Found transaction but status is: ${checkResult.rows[0].status} (not 'pending')`);
//         console.log(`🔍 Transaction ID: ${checkResult.rows[0].id}`);
//       } else {
//         console.log(`🔍 No transaction found with iyda_txn_id: ${iydaTxnId}`);
//       }
//     }

//     return res.status(200).json({ successStatus: true, message: 'Success', responseCode: '000' });

//   } catch (error) {
//     console.error('❌ DMT Webhook error:', error.message, error.stack);
//     return res.status(200).json({ successStatus: true, message: 'Error logged' });
//   }
// };

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