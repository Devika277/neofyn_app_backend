const db = require('../../config/db');
const { hashTpin } = require('../../utils/tpinHelper');
const walletService = require('./../walletService');
const dmtProviderRouter = require('../../providers/dmtProviderRouter');
const commissionService = require('../../services/Commission/commissionService');
const payoutProvider = require('../../providers/vimopayProvider');

const DMT_PROVIDER_ID = 8;

const debug = {
  log: (step, data) => {
    console.log(`[DMT Debug] ${step}:`, JSON.stringify(data, null, 2));
  },
  error: (step, error) => {
    console.error(`[DMT Debug Error] ${step}:`, {
      message: error.message,
      stack: error.stack,
      data: error.data || error.response?.data
    });
  }
};

async function logProviderCall({
  merchantRefId, providerId, module, transactionType,
  requestPayload, responsePayload, status, errorMessage,
  httpStatus, responseTimeMs, finalStatus
}) {
  try {
    await db.query(
      `INSERT INTO provider_logs 
        (merchant_ref_id, provider_id, module, transaction_type, request_payload, response_payload, status, error_message, http_status, response_time_ms, final_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        merchantRefId, providerId, module, transactionType,
        typeof requestPayload === 'string' ? requestPayload : JSON.stringify(requestPayload),
        typeof responsePayload === 'string' ? responsePayload : JSON.stringify(responsePayload),
        status || null, errorMessage || null, httpStatus || null,
        responseTimeMs || null, finalStatus || null
      ]
    );
  } catch (logErr) {
    console.error('[ProviderLog] Failed to insert provider log:', logErr.message);
  }
}

async function resetMonthlyLimitIfNeeded(remitterId, limitResetAt) {
  const now = new Date();
  const lastReset = new Date(limitResetAt);
  if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
    await db.query(
      `UPDATE dmt_remitters SET monthly_used = 0, limit_reset_at = $1 WHERE id = $2`,
      [now, remitterId]
    );
    return true;
  }
  return false;
}

async function processDmtTransfer(userId, { remitterId, beneficiaryId, amount, tpin, transferMode, lat, long, remark }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    debug.log('START', { userId, remitterId, beneficiaryId, amount, transferMode, lat, long, remark: remark || '(none)' });

    // ─── TPIN Validation ──────────────
    const hashedInput = hashTpin(tpin);
    const { rows: userRows } = await client.query(
      'SELECT tpin FROM users WHERE id = $1', [userId]
    );
    if (userRows.length === 0 || userRows[0].tpin !== hashedInput) {
      throw new Error('Invalid TPIN');
    }

    // 2. Fetch remitter
    const { rows: remitters } = await client.query(
      `SELECT * FROM dmt_remitters WHERE id = $1 AND retailer_id = $2 AND is_active = true`,
      [remitterId, userId]
    );
    if (remitters.length === 0) throw new Error('Remitter not found or inactive');
    const remitter = remitters[0];
    const productType = remitter.monthly_limit == 25000 ? 'lite' : 'smart';

    // 3. Fetch beneficiary
    const { rows: beneficiaries } = await client.query(
      `SELECT * FROM dmt_beneficiaries WHERE id = $1 AND remitter_id = $2 AND is_active = true`,
      [beneficiaryId, remitterId]
    );
    if (beneficiaries.length === 0) throw new Error('Beneficiary not found');
    const beneficiary = beneficiaries[0];

    // ----- VALIDATE STATE CODE & GET NUMERIC STATE ID -----
    if (!beneficiary.bene_state) {
      throw new Error(`Beneficiary ${beneficiary.id} (${beneficiary.account_holder_name}) has no state code.`);
    }

    let stateNumeric = beneficiary.bene_state;
    try {
      const rawStates = await payoutProvider.getStateList();
      console.log('[DMT DEBUG] Total states from provider:', rawStates.length);
      
      // Extract valid codes (two‑letter) for validation
      const validStateCodes = rawStates.map(s => s.stateCode || s.code || s.state_id);
      console.log('[DMT] Full valid state codes:', validStateCodes);
      console.log('[DMT DEBUG] Our bene_state:', beneficiary.bene_state);
      console.log('[DMT DEBUG] Is our state in valid codes?', validStateCodes.includes(beneficiary.bene_state));

      if (!validStateCodes.includes(beneficiary.bene_state)) {
        console.log('[DMT DEBUG] ❌ STATE NOT FOUND! Our state:', beneficiary.bene_state);
        console.log('[DMT DEBUG] Available codes:', validStateCodes);
        throw new Error(
          `Invalid state code: "${beneficiary.bene_state}". ` +
          `Valid codes: ${validStateCodes.join(', ')}`
        );
      }
      console.log('[DMT DEBUG] ✅ State found!');

      // Find the state object
      const stateObj = rawStates.find(s => (s.stateCode || s.code || s.state_id) === beneficiary.bene_state);
      if (stateObj) {
        stateNumeric = stateObj.code || stateObj.stateCode || stateObj.stateId || stateObj.id || stateObj.state_id || stateObj.codeId;
        console.log(`[DMT] Mapped state code "${beneficiary.bene_state}" to numeric ID "${stateNumeric}"`);
      } else {
        throw new Error(`State object not found for code "${beneficiary.bene_state}"`);
      }
    } catch (stateErr) {
      console.error('[DMT] State validation error:', stateErr.message);
      throw new Error(`Cannot validate state code: ${stateErr.message}`);
    }

    // 4. Per transaction limits
    let maxPerTxn = productType === 'lite' ? 5000 : 50000;
    if (amount > maxPerTxn) throw new Error(`Maximum per transaction is ₹${maxPerTxn}`);
    if (amount < 100) throw new Error('Minimum amount is ₹100');

    // 5. Monthly limit with reset
    await resetMonthlyLimitIfNeeded(remitter.id, remitter.limit_reset_at);
    const { rows: updatedRem } = await client.query(`SELECT * FROM dmt_remitters WHERE id = $1`, [remitterId]);
    const currentUsed = updatedRem[0].monthly_used;
    const remaining = remitter.monthly_limit - currentUsed;
    if (amount > remaining) throw new Error(`Monthly limit remaining: ₹${remaining}`);

    // ========== SURCHARGE CALCULATION (DMT Lite only) ==========
    let surcharge = 0;
    if (productType === 'lite') {
      if (amount >= 100 && amount <= 1000) {
        surcharge = 10;
      } else if (amount > 1000) {
        surcharge = Math.round(amount * 0.01);
      }
    }
    const totalDebit = amount + surcharge;
    // ===========================================================

    // 6. Check main wallet balance
    const currentBalance = await walletService.getBalance(userId);
    if (currentBalance < totalDebit) {
      throw new Error(`Insufficient balance. Required: ₹${totalDebit}`);
    }

    // 7. Debit main wallet (totalDebit = transfer amount + surcharge)
    const iydaTxnId = `DMT_${userId}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const description = `DMT transfer to ${beneficiary.account_holder_name} (${beneficiary.account_number})`;
    await walletService.deductMoney(userId, totalDebit, description, iydaTxnId, client);

    // 8. Insert transaction record (amount = transfer amount only)
    await client.query(
      `INSERT INTO dmt_transactions 
       (retailer_id, remitter_id, beneficiary_id, amount, transfer_mode, iyda_txn_id, status, remark)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
      [userId, remitterId, beneficiaryId, amount, transferMode, iydaTxnId, remark || null]
    );

    // 9. Increment monthly used (by transfer amount only)
    await client.query(
      `UPDATE dmt_remitters SET monthly_used = monthly_used + $1 WHERE id = $2`,
      [amount, remitterId]
    );

    // 10. Update beneficiary use count
    await client.query(
      `UPDATE dmt_beneficiaries SET use_count = use_count + 1, last_used_at = NOW() WHERE id = $1`,
      [beneficiaryId]
    );

    await client.query('COMMIT');

    // 11. Call provider (only the transfer amount, not surcharge)
    const providerPayload = {
      merchantRefId: iydaTxnId,
      amount,
      mode: transferMode,
      remitter: {
        mobile: remitter.mobile,
        name: `${remitter.first_name} ${remitter.last_name || ''}`.trim()
      },
      beneficiary: {
        accountNumber: beneficiary.account_number,
        ifsc: beneficiary.ifsc_code,
        name: beneficiary.account_holder_name,
        mobile: beneficiary.beneficiary_mobile || '9999999999',
        location: stateNumeric,
        bankCode: beneficiary.bank_code
      },
      lat: lat || '0.0',
      long: long || '0.0'
    };
    
    console.log("[DMT] FINAL STATE SENT:", stateNumeric);
    debug.log('CALLING_PROVIDER', providerPayload);

    const providerStartTime = Date.now();
    let providerResult;

    try {
      // providerResult = await dmtProviderRouter.sendDmtTransfer(providerPayload);
     providerResult = await Promise.race([
    dmtProviderRouter.sendDmtTransfer(providerPayload),

    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Provider timeout')), 15000)
    )

  ]);

    } catch (providerError) {
      const responseTimeMs = Date.now() - providerStartTime;
      await logProviderCall({
        merchantRefId: iydaTxnId, providerId: DMT_PROVIDER_ID, module: 'dmt',
        transactionType: 'transfer', requestPayload: providerPayload,
        responsePayload: null, status: 'ERROR', errorMessage: providerError.message,
        httpStatus: null, responseTimeMs, finalStatus: 'failed'
      });

      await rollbackFailedTransfer(userId, amount, totalDebit, remitterId, iydaTxnId, providerError.message);
      throw new Error(`Provider error: ${providerError.message}`);
    }

    const responseTimeMs = Date.now() - providerStartTime;

    // ✅ FIX: Normalize provider response - handle both formats
    // VimoPay can return txnStatusCode OR status
    const statusCode = providerResult.txnStatusCode || 
                       providerResult.status || 
                       providerResult.code || 
                       providerResult.responseCode;
    
    // ✅ FIX: Extract providerRefId from correct field
    const providerRefId = providerResult.txnId || 
                          providerResult.providerRefId || 
                          providerResult.transactionId || 
                          providerResult.id;
    
    // ✅ FIX: Extract response message
    const responseMessage = providerResult.responseMessage || 
                            providerResult.message || 
                            providerResult.statusMessage;

    // ✅ FIX: Extract UTR from provider response - comprehensive extraction
    const utrValue = providerResult.utr ||
                     providerResult.Utr ||
                     providerResult.utrNumber ||
                     providerResult.rrn ||
                     providerResult.RRN ||
                     providerResult.bankRefNo ||
                     providerResult.BankRefNo ||
                     providerResult.referenceNumber ||
                     providerResult.ReferenceNumber ||
                     providerResult.txnRef ||
                     providerResult.TxnRef ||
                     providerResult.refNo ||
                     providerResult.RefNo ||
                     providerResult.transactionReference ||
                     providerResult.TransactionReference ||
                     providerResult.providerTxnId ||
                     null;

    console.log(`[DMT] Provider Response - Status: ${statusCode}, ProviderRefId: ${providerRefId}, UTR: ${utrValue}`);
    console.log(`[DMT] Full Provider Response:`, JSON.stringify(providerResult, null, 2));

    // ✅ FIX: Determine final status - handle both '000' and '00' as success
    // const isSuccess = statusCode === '000' || statusCode === '00' || statusCode === 'SUCCESS';
    const normalizedStatus =
String(statusCode).toUpperCase();


const isSuccess =
normalizedStatus === '000' ||
normalizedStatus === '00' ||
normalizedStatus === 'SUCCESS';
    const isQueued = statusCode === '004' || statusCode === 'PENDING' || statusCode === 'QUEUED';
    
    let finalStatus;
    if (isSuccess) {
      finalStatus = 'success';
    } else if (isQueued) {
      finalStatus = 'pending';
    } else {
      finalStatus = 'failed';
    }

    console.log(`[DMT] Final status determined: ${finalStatus}`);

    // 12. Update status based on provider result
    if (isSuccess || isQueued) {
      // ✅ Store UTR and provider reference
      await db.query(
        `UPDATE dmt_transactions 
         SET status = $1, 
             provider_txn_id = $2, 
             utr_number = $3,
             raw_response = $4,
             updated_at = NOW()
         WHERE iyda_txn_id = $5`,
        [finalStatus, providerRefId || null, utrValue, JSON.stringify(providerResult), iydaTxnId]
      );

      await logProviderCall({
        merchantRefId: iydaTxnId, providerId: DMT_PROVIDER_ID, module: 'dmt',
        transactionType: 'transfer', requestPayload: providerPayload,
        responsePayload: providerResult, status: statusCode,
        errorMessage: null, httpStatus: 200, responseTimeMs, finalStatus
      });

      // ✅ Commission crediting (only on immediate success, not on queued)
      if (isSuccess) {
        try {
          const serviceType = productType === 'lite' ? 'dmt' : 'dmt_smart';
          await commissionService.processCommission(serviceType, amount, userId, {
            subType: 'transfer', transactionRef: iydaTxnId
          });
          await db.query(
            `UPDATE dmt_transactions SET commission_credited = TRUE WHERE iyda_txn_id = $1`,
            [iydaTxnId]
          );
          debug.log('COMMISSION_CREDITED', { serviceType, amount });
        } catch (commErr) {
          console.error('Commission crediting failed (non‑blocking):', commErr);
        }
      }

      return { 
        success: true, 
        transactionId: iydaTxnId, 
        utrNumber: utrValue,
        providerStatus: statusCode,
        message: responseMessage || (isSuccess ? 'Transfer successful' : 'Transfer queued for processing')
      };
      
    } else {
      // Provider failure
      await db.query(
        `UPDATE dmt_transactions 
         SET status = 'failed', 
             failure_reason = $1, 
             raw_response = $2,
             updated_at = NOW()
         WHERE iyda_txn_id = $3`,
        [responseMessage || 'Provider rejected', JSON.stringify(providerResult), iydaTxnId]
      );

      await logProviderCall({
        merchantRefId: iydaTxnId, providerId: DMT_PROVIDER_ID, module: 'dmt',
        transactionType: 'transfer', requestPayload: providerPayload,
        responsePayload: providerResult, status: statusCode,
        errorMessage: responseMessage || 'Provider rejected',
        httpStatus: 200, responseTimeMs, finalStatus: 'failed'
      });

      await rollbackFailedTransfer(userId, amount, totalDebit, remitterId, iydaTxnId, responseMessage);
      throw new Error(responseMessage || 'Provider transfer failed');
    }

  } catch (error) {
    debug.error('TRANSACTION_ERROR', error);
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Rollback a failed transfer: refund wallet (full debit amount), revert monthly used (transfer amount only).
 */
async function rollbackFailedTransfer(userId, transferAmount, refundAmount, remitterId, iydaTxnId, reason) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Refund the full deducted amount (transfer + surcharge)
    await walletService.addMoney(userId, refundAmount, `Refund for failed DMT: ${reason}`, null, client);
    // Revert only the transfer amount from monthly used
    await client.query(`UPDATE dmt_remitters SET monthly_used = monthly_used - $1 WHERE id = $2`, [transferAmount, remitterId]);
    await client.query(
      `UPDATE dmt_transactions SET status = 'failed', failure_reason = $1 WHERE iyda_txn_id = $2 AND status = 'pending'`,
      [reason, iydaTxnId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Rollback failed:', err);
  } finally {
    client.release();
  }
}

/**
 * Refund money from webhook failure (separate from rollback).
 */
async function refundFailedTransaction(userId, amount, remitterId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await walletService.addMoney(userId, amount, 'Refund from DMT callback failure', null, client);
    await client.query(`UPDATE dmt_remitters SET monthly_used = monthly_used - $1 WHERE id = $2`, [amount, remitterId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Refund failed:', err);
  } finally {
    client.release();
  }
}

module.exports = {
  processDmtTransfer,
  refundFailedTransaction,
  rollbackFailedTransfer,
  logProviderCall
};