// backend/utils/crypto.js
const crypto = require('crypto');


const KEY = process.env.ENCRYPT_DECRYPT_KEY; // 32 hex chars = 16 bytes


// const key = Buffer.from('8086289ecab4a664c8410a1e79d19090', 'hex');
// const iv = Buffer.from('7cca987fb6cfeea37022', 'hex'); // Changed to 12 bytes

// function decrypt(encryptedBase64) {
//   const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
//   const decipher = crypto.createDecipheriv('aes-128-gcm', key, iv);
  
//   // Extract auth tag (last 16 bytes for GCM)
//   const tagLength = 16;
//   const encrypted = encryptedBuffer.slice(0, -tagLength);
//   const authTag = encryptedBuffer.slice(-tagLength);
  
//   decipher.setAuthTag(authTag);
//   const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  
//   return decrypted.toString('utf8');
// }

function encrypt(plainText) {
  const key = Buffer.from(KEY, 'utf8').slice(0, 16);
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(true);
  let encrypted = cipher.update(plainText, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

function decrypt(encryptedBase64) {
  const key = Buffer.from(KEY, 'utf8').slice(0, 16);
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  decipher.setAutoPadding(true);
  let decrypted = decipher.update(encryptedBase64, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };