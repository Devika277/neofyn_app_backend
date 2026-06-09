const pool = require('../config/db');
const { hashTpin, validateTpin } = require('../utils/tpinHelper');
const { generateAccessToken } = require('../utils/token');

// Weak TPIN blacklist
const WEAK_TPINS = new Set([
  '000000', '111111', '222222', '333333',
  '444444', '555555', '666666', '777777',
  '888888', '999999', '123456', '654321',
  '112233', '998877',
]);

function validateTpinStrength(tpin) {
  if (!/^\d{6}$/.test(tpin)) return 'TPIN must be exactly 6 digits';
  if (WEAK_TPINS.has(tpin)) return 'TPIN is too common. Choose a stronger PIN.';
  if (/^(\d)\1{5}$/.test(tpin)) return 'TPIN cannot be all the same digit';
  return null;
}

// -------------------------------------------------------
// POST /api/auth/set-tpin
// -------------------------------------------------------
const setTpin = async (req, res) => {
  console.log('=== setTpin called ===');
  console.log('User from token:', req.user);

  try {
    const { newTpin } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    if (!newTpin) {
      return res.status(400).json({ error: 'newTpin is required' });
    }

    const strengthError = validateTpinStrength(newTpin);
    if (strengthError) {
      return res.status(400).json({ error: strengthError });
    }

    const hashedTpin = hashTpin(newTpin);

    // Update user's TPIN
    await pool.query('UPDATE users SET tpin = $1 WHERE id = $2', [hashedTpin, userId]);

    // Fetch updated user to generate new token with tpinSet = true
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const updatedUser = userResult.rows[0];
    updatedUser.tpinSet = true;   // force flag for token generation

    const newAccessToken = generateAccessToken(updatedUser);

    return res.json({
      success: true,
      message: 'TPIN set successfully',
      accessToken: newAccessToken,
    });
  } catch (err) {
    console.error('[setTpin] ERROR:', err.message);
    console.error(err.stack);
    return res.status(500).json({ error: 'Failed to set TPIN: ' + err.message });
  }
};

// -------------------------------------------------------
// POST /api/auth/change-tpin
// -------------------------------------------------------
const changeTpin = async (req, res) => {
  try {
    const { currentTpin, newTpin } = req.body;
    const userId = req.user.id;

    if (!currentTpin || !newTpin) {
      return res.status(400).json({ error: 'currentTpin and newTpin are required' });
    }

    const isValid = await validateTpin(userId, currentTpin);
    if (!isValid) {
      return res.status(401).json({ error: 'Current TPIN is incorrect' });
    }

    const strengthError = validateTpinStrength(newTpin);
    if (strengthError) {
      return res.status(400).json({ error: strengthError });
    }

    if (currentTpin === newTpin) {
      return res.status(400).json({ error: 'New TPIN must be different from current TPIN' });
    }

    const hashedNewTpin = hashTpin(newTpin);
    await pool.query('UPDATE users SET tpin = $1 WHERE id = $2', [hashedNewTpin, userId]);

    // Optionally return a new token with tpinSet still true
    return res.json({ success: true, message: 'TPIN changed successfully' });
  } catch (err) {
    console.error('[changeTpin]', err.message);
    return res.status(500).json({ error: 'Failed to change TPIN' });
  }
};

// -------------------------------------------------------
// POST /api/auth/verify-tpin
// -------------------------------------------------------
const verifyTpin = async (req, res) => {
  try {
    const { tpin } = req.body;
    const userId = req.user.id;

    if (!tpin) {
      return res.status(400).json({ error: 'tpin is required' });
    }

    const isValid = await validateTpin(userId, tpin);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid TPIN', valid: false });
    }

    return res.json({ success: true, valid: true });
  } catch (err) {
    console.error('[verifyTpin]', err.message);
    return res.status(500).json({ error: 'TPIN verification failed' });
  }
};

module.exports = { setTpin, changeTpin, verifyTpin };