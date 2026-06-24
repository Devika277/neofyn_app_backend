const crypto = require('crypto');

const ALGORITHM = 'aes-128-cbc';
// ❌ REMOVE THESE TWO TOP-LEVEL LINES:
// const KEY = Buffer.from(process.env.BBPS_ENCRYPT_KEY, 'hex');
// const IV = KEY.slice(0, 16);

function getKeyAndIV() {
  const KEY = Buffer.from(process.env.PAYOUT_ENCRYPT_DECRYPT_KEY, 'hex');
  const IV = KEY.slice(0, 16);
  return { KEY, IV };
}

function encrypt(plainText) {
  const { KEY, IV } = getKeyAndIV();  // ← read env at call time, not load time
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, IV);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final()
  ]);
  return encrypted.toString('base64');
}

function decrypt(encryptedBase64) {
  const { KEY, IV } = getKeyAndIV();  // ← same fix here
  const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, IV);
  const decrypted = Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };