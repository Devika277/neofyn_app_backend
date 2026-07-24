const crypto = require('crypto');

class CardPayEncryptionService {
  constructor(secretKey, saltKey) {
    this.key = Buffer.from(secretKey, 'utf-8');
    this.iv = Buffer.from(saltKey, 'utf-8');

    if (this.key.length !== 32) {
      console.warn('[CardPay] secretKey (AES key) length is %d bytes (expected 32).', this.key.length);
    }
    if (this.iv.length !== 32) {
      console.warn('[CardPay] saltKey (IV) length is %d bytes (expected 32, matching Vimopay spec).', this.iv.length);
    }
  }

  encrypt(plainText) {
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, this.iv);
    let encrypted = cipher.update(plainText, 'utf-8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([encrypted, tag]).toString('base64');
  }

  decrypt(encryptedText) {
    const encryptedWithTag = Buffer.from(encryptedText, 'base64');
    const tag = encryptedWithTag.subarray(encryptedWithTag.length - 16);
    const encrypted = encryptedWithTag.subarray(0, encryptedWithTag.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, this.iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf-8');
  }
}

module.exports = CardPayEncryptionService;
