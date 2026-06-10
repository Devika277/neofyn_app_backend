const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

/**
 * Validate MPIN format (6 digits, not trivial)
 * @param {string} mpin - Plain MPIN
 * @returns {string|null} - Error message or null if valid
 */
function validateMpin(mpin) {
  if (!mpin || mpin.length !== 6) {
    return 'MPIN must be exactly 6 digits';
  }
  if (!/^\d{6}$/.test(mpin)) {
    return 'MPIN must contain only digits';
  }
  const commonPins = ['000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999', '123456', '654321'];
  if (commonPins.includes(mpin)) {
    return 'MPIN too common, please choose a more secure PIN';
  }
  return null;
}

/**
 * Hash MPIN
 * @param {string} mpin - Plain MPIN
 * @returns {Promise<string>} - Hashed MPIN
 */
async function hashMpin(mpin) {
  return await bcrypt.hash(mpin, SALT_ROUNDS);
}

/**
 * Verify MPIN against hash
 * @param {string} plainMpin - Plain MPIN
 * @param {string} hashedMpin - Stored hash
 * @returns {Promise<boolean>}
 */
async function verifyMpin(plainMpin, hashedMpin) {
  return await bcrypt.compare(plainMpin, hashedMpin);
}

module.exports = {
  validateMpin,
  hashMpin,
  verifyMpin,
};