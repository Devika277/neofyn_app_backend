// scripts/decrypt-with-details.js
const crypto = require('crypto');
require('dotenv').config();

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

    const key = process.env.PAYOUT_ED_KEY || process.env.PAYOUT_ENCRYPT_DECRYPT_KEY;
    const iv = process.env.PAYOUT_IV_KEY;

    if (!key || !iv) {
        throw new Error('Missing encryption keys');
    }

    console.log('[VimoPay Decrypt] 🔑 Key Info:');
    console.log('[VimoPay Decrypt]   - Key bytes:', Buffer.from(key, 'utf8').length);
    console.log('[VimoPay Decrypt]   - IV bytes:', Buffer.from(iv, 'utf8').length);

    try {
        const keyBuffer = Buffer.from(key, 'utf8');
        const ivBuffer = Buffer.from(iv, 'utf8');
        const data = Buffer.from(encryptedBase64, 'base64');
        
        console.log('[VimoPay Decrypt] 📊 Data Analysis:');
        console.log('[VimoPay Decrypt]   - Total bytes:', data.length);
        
        // GCM tag is 16 bytes
        const tag = data.slice(-16);
        const ciphertext = data.slice(0, -16);
        
        console.log('[VimoPay Decrypt]   - Ciphertext bytes:', ciphertext.length);
        console.log('[VimoPay Decrypt]   - Tag bytes:', tag.length);
        console.log('[VimoPay Decrypt]   - Tag (hex):', tag.toString('hex'));

        const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, ivBuffer);
        decipher.setAuthTag(tag);
        
        const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
        ]);
        
        const result = decrypted.toString('utf8').trim();
        
        console.log('[VimoPay Decrypt] ✅ Decryption successful!');
        console.log('[VimoPay Decrypt]   - Result length:', result.length);
        console.log('[VimoPay Decrypt]   - Result:', result);
        
        // Check if it's an error message
        if (result === 'Server Failed to respond' || result.includes('Failed')) {
            console.log('[VimoPay Decrypt] ⚠️ This appears to be an error message from the server');
            console.log('[VimoPay Decrypt] 💡 The API request likely failed, not the decryption');
            
            // Try to parse as JSON anyway
            try {
                const parsed = JSON.parse(result);
                console.log('[VimoPay Decrypt] 📊 Parsed as JSON:', parsed);
                return parsed;
            } catch (e) {
                console.log('[VimoPay Decrypt] ℹ️ Not JSON, returning as string');
                return result;
            }
        }
        
        // Parse as JSON
        try {
            const parsed = JSON.parse(result);
            console.log('[VimoPay Decrypt] ✅ Parsed as JSON successfully');
            return parsed;
        } catch (e) {
            console.log('[VimoPay Decrypt] ℹ️ Not JSON, returning as string');
            return result;
        }
        
    } catch (error) {
        console.error('[VimoPay Decrypt] ❌ Decryption failed:', error.message);
        console.error('[VimoPay Decrypt] Stack:', error.stack);
        throw error;
    }
}

// Main
const args = process.argv.slice(2);
const encryptedData = args[0] || "TMCy8YldxOFEsyY10iT4jFCKJIwAHCwq2vliY2c8uHKqfi7ALKNMfg==";

try {
    const result = decryptVimoPayData(encryptedData);
    console.log('\n📊 FINAL RESULT:');
    console.log('═'.repeat(60));
    console.log(typeof result === 'object' ? JSON.stringify(result, null, 2) : result);
    console.log('═'.repeat(60));
} catch (error) {
    console.error('❌ Failed:', error.message);
}