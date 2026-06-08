const crypto = require('crypto');

function encrypt(plainObject, edKey, ivKey) {
    const plainText = JSON.stringify(plainObject);
    const key = Buffer.from(edKey, 'utf8');   // 32 bytes
    const iv = Buffer.from(ivKey, 'utf8');    // 32 bytes
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([encrypted, tag]).toString('base64');
}

function decrypt(base64String, edKey, ivKey) {
    try {
        const key = Buffer.from(edKey, 'utf8');
        const iv = Buffer.from(ivKey, 'utf8');
        const buf = Buffer.from(base64String, 'base64');
        const tag = buf.subarray(buf.length - 16);
        const data = buf.subarray(0, buf.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
        return JSON.parse(decrypted.toString('utf8'));
    } catch (e) {
        return null;   // never throw
    }
}

module.exports = { encrypt, decrypt };