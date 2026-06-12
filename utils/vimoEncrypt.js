const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════
// PAYOUT MODULE — AES-256-GCM
// Used by: vimopayProvider.js (payout transfers)
//
// ✅ CONFIRMED by VimoPay support + tested successfully:
//   secretKey = ED key  → UTF8 encoded = 32 bytes (AES-256 key)
//   saltKey   = IV key  → UTF8 encoded = 32 bytes (AES-256 IV)
//   Algorithm = aes-256-gcm
//   Encoding  = utf8 (NOT hex)
//
// ✅ Auth token = raw data field used directly as Bearer
//   No decryption needed for auth token
// ═══════════════════════════════════════════════════════════════

function encrypt(plainText) {
  try {
    const key = Buffer.from(process.env.PAYOUT_ED_KEY, 'utf8'); // 32 bytes
    const iv  = Buffer.from(process.env.PAYOUT_IV_KEY, 'utf8'); // 32 bytes
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([encrypted, tag]).toString('base64');
  } catch (e) {
    throw new Error(`encrypt failed: ${e.message}`);
  }
}

function decrypt(encryptedBase64) {
  try {
    const key = Buffer.from(process.env.PAYOUT_ED_KEY, 'utf8'); // 32 bytes
    const iv  = Buffer.from(process.env.PAYOUT_IV_KEY, 'utf8'); // 32 bytes
    const data       = Buffer.from(encryptedBase64, 'base64');
    const tag        = data.slice(-16);
    const ciphertext = data.slice(0, -16);
    const decipher   = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8').trim();
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// RECHARGE MODULE — AES-256-GCM
// Used by: vimopayRecharge.js (mobile, DTH, electricity recharge)
//
// ✅ CONFIRMED by VimoPay support + tested successfully:
//   secretKey = ED key  → UTF8 encoded = 32 bytes (AES-256 key)
//   saltKey   = IV key  → UTF8 encoded = 32 bytes (AES-256 IV)
//   Algorithm = aes-256-gcm
//   Encoding  = utf8 (NOT hex)
//
// ✅ Auth token = raw data field used directly as Bearer
//   No decryption needed for auth token
//
// ✅ decryptRecharge returns NULL on failure (never throws)
// ═══════════════════════════════════════════════════════════════

function encryptRecharge(plainText) {
  try {
    const key = Buffer.from(process.env.VIMOPAY_RECHARGE_ED_KEY, 'utf8'); // 32 bytes
    const iv  = Buffer.from(process.env.VIMOPAY_RECHARGE_IV_KEY, 'utf8'); // 32 bytes
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([encrypted, tag]).toString('base64');
  } catch (e) {
    throw new Error(`encryptRecharge failed: ${e.message}`);
  }
}

function decryptRecharge(encryptedBase64) {
  // ✅ CRITICAL: Returns null on failure — never throws
  // Auth token does NOT need decryption — used as raw Bearer token
  // This function only used for decrypting API response data
  try {
    const key = Buffer.from(process.env.VIMOPAY_RECHARGE_ED_KEY, 'utf8'); // 32 bytes
    const iv  = Buffer.from(process.env.VIMOPAY_RECHARGE_IV_KEY, 'utf8'); // 32 bytes
    const data       = Buffer.from(encryptedBase64, 'base64');
    const tag        = data.slice(-16);
    const ciphertext = data.slice(0, -16);
    const decipher   = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8').trim();
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// payout   → encrypt, decrypt
// recharge → encryptRecharge, decryptRecharge
// ═══════════════════════════════════════════════════════════════
module.exports = {
  encrypt,
  decrypt,
  encryptRecharge,
  decryptRecharge,
};