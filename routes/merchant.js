const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { registerMerchant, authorize } = require('../services/vimoPayService'); // ✅ fixed import path
const { encrypt, decrypt } = require('../utils/crypto');

// ─── Helper: Get Valid Token ─────────────────────────────────────────────────
async function getToken(pool) {
  try {
    const cached = await pool.query(
      `SELECT token FROM aeps_tokens 
       WHERE created_at > NOW() - INTERVAL '50 minutes' 
       ORDER BY created_at DESC LIMIT 1`
    );
    if (cached.rows.length > 0) return cached.rows[0].token;

    // No fresh token — get new one
    const token = await authorize();
    await pool.query(
      'INSERT INTO aeps_tokens (token) VALUES ($1)',
      [token]
    );
    return token;
  } catch (err) {
    throw new Error('Token fetch failed: ' + err.message);
  }
}

// ─── POST /merchant/register ─────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const pool = req.app.locals.pool;

  try {
    // ✅ Extract userId separately — don't send it to VimoPay
    const { userId, ...merchantData } = req.body;

    // ✅ Cast to integer for PostgreSQL
    const userIdInt = parseInt(userId);

    
    // Validate userId
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required to register merchant'
      });
    }

    // ✅ Check if this user already has a merchant registered
    const existing = await pool.query(
      `SELECT merchant_id FROM merchants 
       WHERE user_id = $1 AND status = 'Success' LIMIT 1`,
      [userId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Merchant already registered for this user',
        merchantId: existing.rows[0].merchant_id
      });
    }

    const token = await getToken(pool);

    // ✅ Build VimoPay payload (no userId — that's internal only)
    const payload = {
      merchantRefId: uuidv4(),
      pipe: '1',           // UAT always 1
      ipAddress: req.ip || '127.0.0.1',
      ...merchantData,
    };

    console.log('📤 Sending to VimoPay:', JSON.stringify(payload));

    const encryptedBody = encrypt(JSON.stringify(payload));
    const response = await registerMerchant(token, encryptedBody);

    if (!response || !response.data) {
      throw new Error('Empty response from VimoPay');
    }

    const decrypted = JSON.parse(decrypt(response.data));
    console.log('📥 VimoPay response:', JSON.stringify(decrypted));

    // ✅ Save merchant WITH user_id to link to logged-in user
    await pool.query(
      `INSERT INTO merchants 
        (user_id, merchant_ref_id, merchant_id, first_name, last_name, 
         phone, email, aadhaar_no, pan_no, pipe, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (merchant_ref_id) DO UPDATE SET
         merchant_id = EXCLUDED.merchant_id,
         status      = EXCLUDED.status`,
      [
        userId,
        decrypted.merchantRefId,
        decrypted.merchantId,
        decrypted.firstName,
        decrypted.lastName,
        decrypted.mobileNo,
        decrypted.emailId,
        decrypted.aadhaarNo,
        decrypted.panNo,
        decrypted.pipe,
        decrypted.merchantStatus,
      ]
    );

    res.json({
      success: true,
      data: decrypted,
      message: decrypted.statusDescription || 'Merchant registered'
    });

  } catch (err) {
    console.error('❌ Register error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /merchant/status/:userId ────────────────────────────────────────────
router.get('/status/:userId', async (req, res) => {
  const pool = req.app.locals.pool;
  const { userId } = req.params;

  try {
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }

    const result = await pool.query(
      `SELECT merchant_id, status, first_name, last_name, phone 
       FROM merchants 
       WHERE user_id = $1 
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (result.rows.length > 0 && result.rows[0].status === 'Success') {
      const merchant = result.rows[0];
      res.json({
        success: true,
        registered: true,
        merchantId: merchant.merchant_id,
        name: `${merchant.first_name} ${merchant.last_name}`,
        phone: merchant.phone,
      });
    } else {
      res.json({
        success: true,
        registered: false,
        merchantId: null,
      });
    }
  } catch (err) {
    console.error('❌ Status check error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /merchant/transaction ──────────────────────────────────────────────
router.post('/transaction', async (req, res) => {
  const pool = req.app.locals.pool;

  try {
    const {
      merchantRefId,
      txnRefId,
      txnType,
      amount,
      aadhaarNo,
      bankIIN,
      rrn,
      npciCode,
      npciMessage,
      availableBalance,
      status,
      pipe,
      rawResponse,
      userId,           // ✅ also store which user did this transaction
    } = req.body;

    // Validate required fields
    if (!merchantRefId) {
      return res.status(400).json({
        success: false,
        error: 'merchantRefId is required'
      });
    }

    await pool.query(
      `INSERT INTO aeps_transactions
        (user_id, merchant_ref_id, txn_ref_id, txn_type, amount,
         aadhaar_no, bank_iin, rrn, npci_code, npci_message,
         available_balance, status, pipe, raw_response)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        userId || null,
        merchantRefId,
        txnRefId,
        txnType,
        amount,
        aadhaarNo,
        bankIIN,
        rrn,
        npciCode,
        npciMessage,
        availableBalance,
        status,
        pipe,
        rawResponse ? JSON.stringify(rawResponse) : null,
      ]
    );

    res.json({ success: true, message: 'Transaction saved successfully' });

  } catch (err) {
    console.error('❌ Transaction save error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /merchant/transactions/:userId ──────────────────────────────────────
// Bonus: Get transaction history for a user
router.get('/transactions/:userId', async (req, res) => {
  const pool = req.app.locals.pool;
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `SELECT txn_ref_id, txn_type, amount, aadhaar_no,
              npci_message, available_balance, status, created_at
       FROM aeps_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId]
    );

    res.json({
      success: true,
      transactions: result.rows
    });
  } catch (err) {
    console.error('❌ Transactions fetch error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;