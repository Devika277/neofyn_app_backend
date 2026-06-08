const express = require('express');
const router = express.Router();
const { register, login, forgotPassword, resetPassword } = require('../controllers/authController');
const { authorize } = require('../services/vimoPayService');
const pool = require('../config/db');

// Registration Route
// Points to http://localhost:5000/api/auth/register
router.post('/register', register);


// Login Route
// Points to http://localhost:5000/api/auth/login
router.post('/login', login);


router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
// Cache token in DB — reuse if fresh (tokens typically valid ~1 hour)
router.post('/token', async (req, res) => {
  try {
    // Check for a fresh token in DB (less than 50 minutes old)
    const cached = await pool.query(
      `SELECT token FROM aeps_tokens 
       WHERE created_at > NOW() - INTERVAL '50 minutes' 
       ORDER BY created_at DESC LIMIT 1`
    );

    if (cached.rows.length > 0) {
      return res.json({ success: true, token: cached.rows[0].token });
    }

    // Get new token from VimoPay
    const token = await authorize();

    // Save to DB
    await pool.query(
      'INSERT INTO aeps_tokens (token) VALUES ($1)',
      [token]
    );

    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;