const crypto = require('crypto1');

function encrypt(plainText) {
  const key = Buffer.from(process.env.ENCRYPT_DECRYPT_KEY, 'utf8');
  const iv  = Buffer.from(process.env.SALT_KEY, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([encrypted, tag]).toString('base64');
}

function decrypt(encryptedBase64) {
  const key  = Buffer.from(process.env.ENCRYPT_DECRYPT_KEY, 'utf8');
  const iv   = Buffer.from(process.env.SALT_KEY, 'utf8');
  const data = Buffer.from(encryptedBase64, 'base64');
  const tag       = data.slice(-16);
  const encrypted = data.slice(0, -16);
  const decipher  = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, null, 'utf8') + decipher.final('utf8');
}

module.exports = { encrypt, decrypt };