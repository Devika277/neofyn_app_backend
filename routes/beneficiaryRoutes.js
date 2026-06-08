// beneficiaryRoutes.js
// Mount in server.js: app.use('/api/beneficiary', require('./routes/beneficiaryRoutes'));

const express = require('express');
const router  = express.Router();
const db      = require('../config/db'); // adjust path

const MAX_BENEFICIARIES = 3;

// GET /api/beneficiary/:userId
router.get('/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await db.query(
      `SELECT id, account_name, account_number, ifsc_code, bank_name,
              bank_code, purpose_code, purpose_desc, mobile,
              state, state_name, payment_mode,
              upi_id, upi_name, is_verified, is_active
       FROM payout_beneficiaries
       WHERE user_id = $1 AND is_active = TRUE
       ORDER BY bene_added_at ASC`,
      [userId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Fetch beneficiary error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/beneficiary
router.post('/', async (req, res) => {
  const {
    userId, accountName, accountNumber, ifscCode, bankName,
    bankCode, purposeCode, purposeDesc, mobile,
    state, stateName, paymentMode, upiId, upiName
  } = req.body;

  console.log('POST /api/beneficiary body:', req.body); // debug

  try {
    const count = await db.query(
      `SELECT COUNT(*) FROM payout_beneficiaries 
       WHERE user_id = $1 AND is_active = TRUE`,
      [userId]
    );
    if (parseInt(count.rows[0].count) >= MAX_BENEFICIARIES) {
      return res.status(400).json({ 
        success: false, 
        message: 'Maximum 3 beneficiaries allowed' 
      });
    }

    const result = await db.query(
      `INSERT INTO payout_beneficiaries (
        user_id,
        account_name,
        account_number,
        ifsc_code,
        bank_name,
        bank_code,
        purpose_code,
        purpose_desc,
        mobile,
        state,
        state_name,
        payment_mode,
        upi_id,
        upi_name
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14
      ) RETURNING id`,
      [
        userId,        // $1
        accountName,   // $2
        accountNumber, // $3
        ifscCode,      // $4
        bankName,      // $5
        bankCode,      // $6
        purposeCode,   // $7
        purposeDesc,   // $8
        mobile,        // $9
        state,         // $10
        stateName,     // $11
        paymentMode,   // $12
        upiId || null, // $13
        upiName || null // $14
      ]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Add beneficiary error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// PUT /api/beneficiary/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { accountName, accountNumber, ifscCode, bankName, state, upiId, upiName } = req.body;
  try {
    await db.query(
      `UPDATE payout_beneficiaries
       SET account_name=$1, account_number=$2, ifsc_code=$3,
           bank_name=$4, state=$5, upi_id=$6, upi_name=$7, updated_at=NOW()
       WHERE id=$8`,
      [accountName, accountNumber, ifscCode, bankName, state, upiId || null, upiName || null, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Edit beneficiary error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/beneficiary/:id  (soft delete)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query(
      `UPDATE payout_beneficiaries SET is_active=FALSE, updated_at=NOW() WHERE id=$1`,
      [id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Delete beneficiary error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
