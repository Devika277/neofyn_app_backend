// scripts/decrypt.js
const crypto = require('crypto');
require('dotenv').config();

// ═══════════════════════════════════════════════════════════════
// Using the confirmed working method from your encryption file
// ═══════════════════════════════════════════════════════════════

function decryptVimoPayData(encryptedBase64) {
    console.log('[VimoPay Decrypt] ════════════════════════════════════════════');
    console.log('[VimoPay Decrypt] 🔐 Decrypting with AES-256-GCM');
    console.log('[VimoPay Decrypt] ════════════════════════════════════════════');
    
    console.log('[VimoPay Decrypt] 📥 Input Data:');
    console.log('[VimoPay Decrypt]   - Length:', encryptedBase64 ? encryptedBase64.length : 0);
    console.log('[VimoPay Decrypt]   - Preview:', encryptedBase64 ? encryptedBase64.substring(0, 50) + '...' : 'null');
    
    if (!encryptedBase64) {
        throw new Error('No encrypted data provided');
    }

    // Get keys from environment
    const key = process.env.PAYOUT_ED_KEY || process.env.PAYOUT_ENCRYPT_DECRYPT_KEY;
    const iv = process.env.PAYOUT_IV_KEY;

    if (!key) {
        throw new Error('PAYOUT_ED_KEY or PAYOUT_ENCRYPT_DECRYPT_KEY not found in environment');
    }
    if (!iv) {
        throw new Error('PAYOUT_IV_KEY not found in environment');
    }

    console.log('[VimoPay Decrypt] 🔑 Using Keys:');
    console.log('[VimoPay Decrypt]   - Key (UTF8):', key.substring(0, 4) + '...' + key.substring(key.length - 4));
    console.log('[VimoPay Decrypt]   - IV (UTF8):', iv.substring(0, 4) + '...' + iv.substring(iv.length - 4));
    
    // Check key lengths
    console.log('[VimoPay Decrypt] 📏 Key Length Check:');
    const keyBuffer = Buffer.from(key, 'utf8');
    const ivBuffer = Buffer.from(iv, 'utf8');
    console.log('[VimoPay Decrypt]   - Key bytes:', keyBuffer.length, '(should be 32 for AES-256)');
    console.log('[VimoPay Decrypt]   - IV bytes:', ivBuffer.length, '(should be 32 for GCM)');
    
    if (keyBuffer.length !== 32) {
        console.log('[VimoPay Decrypt] ⚠️ Warning: Key is not 32 bytes!');
        console.log('[VimoPay Decrypt] 💡 This may cause decryption failure');
    }
    
    if (ivBuffer.length !== 32) {
        console.log('[VimoPay Decrypt] ⚠️ Warning: IV is not 32 bytes!');
        console.log('[VimoPay Decrypt] 💡 This may cause decryption failure');
    }

    console.log('[VimoPay Decrypt] 🔄 Attempting AES-256-GCM decryption...');

    try {
        // ✅ Using the confirmed working method from your encryption file
        const data = Buffer.from(encryptedBase64, 'base64');
        console.log('[VimoPay Decrypt]   - Data bytes:', data.length);
        
        // GCM tag is always 16 bytes at the end
        const tag = data.slice(-16);
        const ciphertext = data.slice(0, -16);
        
        console.log('[VimoPay Decrypt]   - Tag bytes:', tag.length);
        console.log('[VimoPay Decrypt]   - Ciphertext bytes:', ciphertext.length);

        const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, ivBuffer);
        decipher.setAuthTag(tag);
        
        const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
        ]);
        
        const result = decrypted.toString('utf8').trim();
        
        console.log('[VimoPay Decrypt] ✅ Decryption successful!');
        console.log('[VimoPay Decrypt]   - Decrypted length:', result.length);
        console.log('[VimoPay Decrypt]   - Decrypted preview:', result.substring(0, 100) + '...');
        
        // Parse the result
        return parseResult(result);
        
    } catch (error) {
        console.error('[VimoPay Decrypt] ❌ Decryption failed:', error.message);
        throw error;
    }
}

function parseResult(result) {
    console.log('[VimoPay Decrypt] 📊 Parsing result...');
    
    if (!result) {
        console.log('[VimoPay Decrypt] ⚠️ Empty result');
        return null;
    }
    
    // Try to parse as JSON
    try {
        const parsed = JSON.parse(result);
        console.log('[VimoPay Decrypt] ✅ Parsed as JSON successfully');
        return parsed;
    } catch (e) {
        console.log('[VimoPay Decrypt] ℹ️ Not JSON, returning as string');
        return result;
    }
}

// Main function
function main() {
    const args = process.argv.slice(2);
    let encryptedData = args[0];
    
    if (!encryptedData) {
        console.log('[VimoPay Decrypt] ❌ Please provide encrypted data as argument');
        console.log('[VimoPay Decrypt] Usage: node scripts/decrypt.js "encrypted_data_here"');
        console.log('[VimoPay Decrypt] Or: node scripts/decrypt.js --file encrypted.txt');
        process.exit(1);
    }
    
    // Check if reading from file
    if (encryptedData === '--file' && args[1]) {
        const fs = require('fs');
        try {
            const fileContent = fs.readFileSync(args[1], 'utf-8');
            console.log('[VimoPay Decrypt] 📄 Read from file:', args[1]);
            encryptedData = fileContent.trim();
        } catch (error) {
            console.error('[VimoPay Decrypt] ❌ Error reading file:', error.message);
            process.exit(1);
        }
    }
    
    try {
        const result = decryptVimoPayData(encryptedData);
        console.log('[VimoPay Decrypt] ════════════════════════════════════════════');
        console.log('[VimoPay Decrypt] ✅ DECRYPTION RESULT:');
        console.log('[VimoPay Decrypt] ════════════════════════════════════════════');
        
        if (typeof result === 'object') {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(result);
        }
        console.log('[VimoPay Decrypt] ════════════════════════════════════════════');
    } catch (error) {
        console.error('[VimoPay Decrypt] ❌ Decryption failed:', error.message);
        console.error('[VimoPay Decrypt] Stack:', error.stack);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { decryptVimoPayData };