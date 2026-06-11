const db = require('../config/db');
const mpinHelper = require('../utils/mpinHelper');

/**
 * Set / Create MPIN for the authenticated user
 * POST /api/auth/set-mpin
 * Body: { mpin: string }
 */
exports.setMpin = async (req, res) => {
  const userId = req.user.id; // from protect middleware
  const { mpin } = req.body;

  if (!mpin) {
    return res.status(400).json({ success: false, error: 'MPIN is required' });
  }

  const validationError = mpinHelper.validateMpin(mpin);
  if (validationError) {
    return res.status(400).json({ success: false, error: validationError });
  }

  try {
    // Check if MPIN already set
    const userCheck = await db.query('SELECT mpin_set FROM users WHERE id = $1', [userId]);
    if (userCheck.rows[0]?.mpin_set === true) {
      return res.status(400).json({ success: false, error: 'MPIN already set. Use change endpoint.' });
    }

    const hashedMpin = await mpinHelper.hashMpin(mpin);
    await db.query(
      'UPDATE users SET mpin = $1, mpin_set = true WHERE id = $2',
      [hashedMpin, userId]
    );

    res.json({ success: true, message: 'MPIN set successfully' });
  } catch (err) {
    console.error('Set MPIN error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};

/**
 * Change existing MPIN (requires current MPIN)
 * POST /api/auth/change-mpin
 * Body: { currentMpin: string, newMpin: string }
 */
exports.changeMpin = async (req, res) => {
  const userId = req.user.id;
  const { currentMpin, newMpin } = req.body;

  if (!currentMpin || !newMpin) {
    return res.status(400).json({ success: false, error: 'Current MPIN and new MPIN are required' });
  }

  const validationError = mpinHelper.validateMpin(newMpin);
  if (validationError) {
    return res.status(400).json({ success: false, error: validationError });
  }

  try {
    // Fetch stored MPIN hash
    const userRes = await db.query('SELECT mpin, mpin_set FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];
    if (!user || !user.mpin_set) {
      return res.status(400).json({ success: false, error: 'MPIN not set yet. Use set endpoint.' });
    }

    // Verify current MPIN
    const isMatch = await mpinHelper.verifyMpin(currentMpin, user.mpin);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Current MPIN is incorrect' });
    }

    const hashedNew = await mpinHelper.hashMpin(newMpin);
    await db.query('UPDATE users SET mpin = $1 WHERE id = $2', [hashedNew, userId]);

    res.json({ success: true, message: 'MPIN changed successfully' });
  } catch (err) {
    console.error('Change MPIN error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};

/**
 * Verify MPIN (for login or transaction confirmation)
 * POST /api/auth/verify-mpin
 * Body: { mpin: string }
 */
exports.verifyMpin = async (req, res) => {
  const userId = req.user.id;
  const { mpin } = req.body;

  if (!mpin) {
    return res.status(400).json({ success: false, error: 'MPIN is required' });
  }

  try {
    const userRes = await db.query('SELECT mpin, mpin_set FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];
    if (!user || !user.mpin_set) {
      return res.status(400).json({ success: false, error: 'MPIN not set' });
    }

    const isValid = await mpinHelper.verifyMpin(mpin, user.mpin);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid MPIN' });
    }

    res.json({ success: true, message: 'MPIN verified' });
  } catch (err) {
    console.error('Verify MPIN error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};