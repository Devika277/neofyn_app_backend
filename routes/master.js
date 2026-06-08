const express = require('express');
const router = express.Router();
const { getBankList, getStateList, getDistrictList } = require('../services/vimoPayService');
const { encrypt, decrypt } = require('../utils/crypto');
const axios = require('axios');

// Helper: get fresh token
async function getToken(pool) {
  const cached = await pool.query(
    `SELECT token FROM aeps_tokens WHERE created_at > NOW() - INTERVAL '50 minutes' ORDER BY created_at DESC LIMIT 1`
  );
  if (cached.rows.length > 0) return cached.rows[0].token;
  const { authorize } = require('../services/vimopay');
  const token = await authorize();
  await pool.query('INSERT INTO aeps_tokens (token) VALUES ($1)', [token]);
  return token;
}

router.get('/banks', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const token = await getToken(pool);
    const data = await getBankList(token);
    // Decrypt the response data field
    const decrypted = decrypt(data.data);
    res.json({ success: true, banks: JSON.parse(decrypted) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/states', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const token = await getToken(pool);
    const data = await getStateList(token);
    const decrypted = decrypt(data.data);
    res.json({ success: true, states: JSON.parse(decrypted) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/districts', async (req, res) => {
  const pool = req.app.locals.pool;
  const { stateCode } = req.body;
  try {
    const token = await getToken(pool);
    const encryptedBody = encrypt(JSON.stringify({ stateCode }));
    const data = await getDistrictList(token, encryptedBody);
    const decrypted = decrypt(data.data);
    res.json({ success: true, districts: JSON.parse(decrypted) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;