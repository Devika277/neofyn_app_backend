// services/vimoEncryption.js
const crypto = require("crypto");

// const edKey = "8086289ecab4a664c8410a1e79d19090";
// const ivKey = "7cca987fb6cfeea37022977bde6e62c0";

function encrypt(plainText) {
    try {
        // For AES-256-GCM, key must be 32 bytes, IV should be 12 bytes for GCM
        const key = Buffer.from(edKey, "utf8");
        // Take first 12 bytes of IV for GCM (as per Android implementation)
        const iv = Buffer.from(ivKey, "utf8").slice(0, 12);
        
        console.log(`Encrypt - Key length: ${key.length}, IV length: ${iv.length}`);
        
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        
        let encrypted = cipher.update(plainText, "utf8");
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        const tag = cipher.getAuthTag();
        
        // Append the auth tag (16 bytes) to the encrypted data
        const finalBuffer = Buffer.concat([encrypted, tag]);
        
        return finalBuffer.toString("base64");
        
    } catch (err) {
        console.error("Encrypt error:", err.message);
        return null;
    }
}

function decrypt(encryptedText) {
    if (!encryptedText) return null;
    
    try {
        // For AES-256-GCM, key must be 32 bytes, IV should be 12 bytes
        const key = Buffer.from(edKey, "utf8");
        // Take first 12 bytes of IV for GCM (as per Android implementation)
        const iv = Buffer.from(ivKey, "utf8").slice(0, 12);
        
        const encryptedBuffer = Buffer.from(encryptedText, "base64");
        
        // The auth tag is the LAST 16 bytes
        // The ciphertext is everything BEFORE the last 16 bytes
        const tag = encryptedBuffer.slice(-16);
        const ciphertext = encryptedBuffer.slice(0, -16);
        
        console.log(`Decrypt - Key length: ${key.length}, IV length: ${iv.length}`);
        console.log(`Ciphertext length: ${ciphertext.length}, Tag length: ${tag.length}`);
        
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        
        let decrypted = decipher.update(ciphertext, null, "utf8");
        decrypted += decipher.final("utf8");
        
        return decrypted.trim();
        
    } catch (err) {
        console.error("Decrypt error:", err.message);
        return null;
    }
}

module.exports = { encrypt, decrypt };