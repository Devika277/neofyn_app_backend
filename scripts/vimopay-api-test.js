// scripts/decrypt-with-full-logs.js
const crypto = require('crypto');
require('dotenv').config();

// ═══════════════════════════════════════════════════════════════
// Your working decryption function
// ═══════════════════════════════════════════════════════════════

function decrypt(encryptedBase64) {
    console.log('[VimoPay Decrypt] ════════════════════════════════════════════');
    console.log('[VimoPay Decrypt] 🔐 Starting Decryption Process');
    console.log('[VimoPay Decrypt] ════════════════════════════════════════════');
    
    // Log input
    console.log('[VimoPay Decrypt] 📥 INPUT:');
    console.log('[VimoPay Decrypt]   - Encrypted Data:', encryptedBase64);
    console.log('[VimoPay Decrypt]   - Length:', encryptedBase64 ? encryptedBase64.length : 0);
    console.log('[VimoPay Decrypt]   - Preview:', encryptedBase64 ? encryptedBase64.substring(0, 50) + '...' : 'null');
    
    if (!encryptedBase64) {
        console.log('[VimoPay Decrypt] ❌ No encrypted data provided');
        return null;
    }

    // Get keys
    const key = process.env.PAYOUT_ED_KEY || process.env.PAYOUT_ENCRYPT_DECRYPT_KEY;
    const iv = process.env.PAYOUT_IV_KEY;

    console.log('[VimoPay Decrypt] 🔑 KEYS:');
    console.log('[VimoPay Decrypt]   - ED_KEY:', key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : '❌ Missing');
    console.log('[VimoPay Decrypt]   - IV_KEY:', iv ? `${iv.substring(0, 4)}...${iv.substring(iv.length - 4)}` : '❌ Missing');
    
    if (!key || !iv) {
        console.log('[VimoPay Decrypt] ❌ Missing encryption keys');
        return null;
    }

    try {
        // Convert keys to buffers
        const keyBuffer = Buffer.from(key, 'utf8');
        const ivBuffer = Buffer.from(iv, 'utf8');
        
        console.log('[VimoPay Decrypt] 📊 BUFFER INFO:');
        console.log('[VimoPay Decrypt]   - Key bytes:', keyBuffer.length, '(should be 32 for AES-256)');
        console.log('[VimoPay Decrypt]   - IV bytes:', ivBuffer.length, '(should be 32 for GCM)');
        console.log('[VimoPay Decrypt]   - Key (hex):', keyBuffer.toString('hex').substring(0, 20) + '...');
        console.log('[VimoPay Decrypt]   - IV (hex):', ivBuffer.toString('hex').substring(0, 20) + '...');

        // Decode base64
        const data = Buffer.from(encryptedBase64, 'base64');
        
        console.log('[VimoPay Decrypt] 📦 ENCRYPTED DATA:');
        console.log('[VimoPay Decrypt]   - Total bytes:', data.length);
        console.log('[VimoPay Decrypt]   - Hex preview:', data.toString('hex').substring(0, 40) + '...');
        
        // GCM tag is 16 bytes
        const tag = data.slice(-16);
        const ciphertext = data.slice(0, -16);
        
        console.log('[VimoPay Decrypt] 🔍 DATA SPLIT:');
        console.log('[VimoPay Decrypt]   - Ciphertext bytes:', ciphertext.length);
        console.log('[VimoPay Decrypt]   - Tag bytes:', tag.length);
        console.log('[VimoPay Decrypt]   - Tag (hex):', tag.toString('hex'));
        console.log('[VimoPay Decrypt]   - Ciphertext (hex):', ciphertext.toString('hex').substring(0, 40) + '...');

        // Decrypt
        const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, ivBuffer);
        decipher.setAuthTag(tag);
        
        const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
        ]);
        
        const result = decrypted.toString('utf8').trim();
        
        console.log('[VimoPay Decrypt] ✅ DECRYPTION SUCCESSFUL!');
        console.log('[VimoPay Decrypt] 📄 DECRYPTED DATA:');
        console.log('[VimoPay Decrypt]   - Length:', result.length);
        console.log('[VimoPay Decrypt]   - Content:', result);
        console.log('[VimoPay Decrypt]   - Preview:', result.substring(0, 200) + (result.length > 200 ? '...' : ''));
        
        // Try to parse as JSON
        console.log('[VimoPay Decrypt] 🔍 PARSING RESULT:');
        try {
            const parsed = JSON.parse(result);
            console.log('[VimoPay Decrypt]   - Type: JSON Object');
            console.log('[VimoPay Decrypt]   - Keys:', Object.keys(parsed).join(', '));
            console.log('[VimoPay Decrypt]   - Formatted:');
            console.log(JSON.stringify(parsed, null, 2));
            
            // Check if it's an error
            if (parsed.successStatus === false || parsed.responseCode === '001') {
                console.log('[VimoPay Decrypt] ⚠️ This is an ERROR response from VimoPay');
                console.log('[VimoPay Decrypt]   - Error:', parsed.message || parsed.statusDescription);
            } else if (parsed.successStatus === true) {
                console.log('[VimoPay Decrypt] ✅ This is a SUCCESS response from VimoPay');
            }
            
            return parsed;
        } catch (e) {
            console.log('[VimoPay Decrypt]   - Type: Plain Text (not JSON)');
            console.log('[VimoPay Decrypt]   - Parse Error:', e.message);
            return result;
        }
        
    } catch (error) {
        console.log('[VimoPay Decrypt] ❌ DECRYPTION FAILED:');
        console.log('[VimoPay Decrypt]   - Error:', error.message);
        console.log('[VimoPay Decrypt]   - Stack:', error.stack);
        return null;
    } finally {
        console.log('[VimoPay Decrypt] ════════════════════════════════════════════');
    }
}

// ═══════════════════════════════════════════════════════════════
// Function to log decrypted API response
// ═══════════════════════════════════════════════════════════════

function logDecryptedResponse(encryptedData, context = '') {
    console.log('\n' + '═'.repeat(60));
    console.log(`📋 DECRYPTED RESPONSE ${context ? `(${context})` : ''}`);
    console.log('═'.repeat(60));
    
    const result = decrypt(encryptedData);
    
    console.log('\n📊 FINAL RESULT:');
    console.log('═'.repeat(60));
    if (result && typeof result === 'object') {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log(result || 'null');
    }
    console.log('═'.repeat(60) + '\n');
    
    return result;
}

// ═══════════════════════════════════════════════════════════════
// Test with your encrypted data
// ═══════════════════════════════════════════════════════════════

// Sample encrypted data from your logs
const testData = "TMCy8YldxOFEsyY10iT4jFCKJIwAHCwq2vliY2c8uHKqfi7ALKNMfg==";

console.log('🧪 TESTING DECRYPTION WITH SAMPLE DATA\n');
logDecryptedResponse(testData, 'Sample from logs');

// ═══════════════════════════════════════════════════════════════
// Function to decrypt response from API call
// ═══════════════════════════════════════════════════════════════

async function callAndDecryptAPI(endpoint, data = {}) {
    console.log('\n' + '═'.repeat(60));
    console.log('🌐 MAKING API CALL TO:', endpoint);
    console.log('═'.repeat(60));
    
    const baseUrl = process.env.PAYOUT_BASE_URL || 'https://prod.vidual.in';
    const userId = process.env.PAYOUT_USER_ID;
    const secretKey = process.env.PAYOUT_SECRET_KEY;
    
    // Encrypt request data
    const encryptFn = (plainText) => {
        try {
            const key = Buffer.from(process.env.PAYOUT_ED_KEY, 'utf8');
            const iv = Buffer.from(process.env.PAYOUT_IV_KEY, 'utf8');
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
    };
    
    const encryptedRequest = Object.keys(data).length > 0 ? encryptFn(JSON.stringify(data)) : null;
    
    const requestBody = {
        userId: userId,
        ...(encryptedRequest && { data: encryptedRequest })
    };
    
    console.log('📤 REQUEST:');
    console.log('  - URL:', `${baseUrl}${endpoint}`);
    console.log('  - Body:', JSON.stringify(requestBody, null, 2));
    
    try {
        const response = await fetch(`${baseUrl}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${secretKey}`
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('📥 RESPONSE:');
        console.log('  - Status:', response.status, response.statusText);
        
        const responseText = await response.text();
        console.log('  - Raw:', responseText || '(empty)');
        
        if (!responseText) {
            console.log('❌ Empty response from server');
            return null;
        }
        
        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch (e) {
            console.log('❌ Invalid JSON response:', responseText);
            return { error: 'Invalid JSON', raw: responseText };
        }
        
        // Decrypt the response data
        if (responseData.data) {
            console.log('\n🔐 DECRYPTING RESPONSE DATA:');
            const decrypted = logDecryptedResponse(responseData.data, 'API Response');
            return { ...responseData, decryptedData: decrypted };
        } else {
            console.log('\n📄 RESPONSE WITHOUT ENCRYPTION:');
            console.log(JSON.stringify(responseData, null, 2));
            return responseData;
        }
        
    } catch (error) {
        console.error('❌ API Error:', error.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// Main - Test with AEPS endpoints (known working from your logs)
// ═══════════════════════════════════════════════════════════════

async function main() {
    const args = process.argv.slice(2);
    const action = args[0] || 'test';
    
    console.log('🚀 STARTING DECRYPT LOGS');
    console.log('═'.repeat(60));
    console.log('📋 Environment:');
    console.log('  - PAYOUT_BASE_URL:', process.env.PAYOUT_BASE_URL);
    console.log('  - PAYOUT_USER_ID:', process.env.PAYOUT_USER_ID);
    console.log('  - PAYOUT_ED_KEY:', process.env.PAYOUT_ED_KEY ? '✅ Set' : '❌ Missing');
    console.log('  - PAYOUT_IV_KEY:', process.env.PAYOUT_IV_KEY ? '✅ Set' : '❌ Missing');
    console.log('═'.repeat(60) + '\n');
    
    if (action === 'test') {
        // Test with sample data
        console.log('🧪 TESTING WITH SAMPLE DATA\n');
        logDecryptedResponse(testData, 'Sample from logs');
        
        // Test with AEPS bank list endpoint (known working from your logs)
        console.log('\n🌐 TESTING AEPS BANK LIST ENDPOINT\n');
        const result = await callAndDecryptAPI('/masterapi/api/master/banklist');
        
        if (result && result.decryptedData) {
            console.log('\n✅ SUCCESSFULLY DECRYPTED AEPS RESPONSE:');
            console.log(JSON.stringify(result.decryptedData, null, 2));
        }
    } else if (action === 'banklist') {
        const result = await callAndDecryptAPI('/masterapi/api/master/banklist');
        if (result && result.decryptedData) {
            console.log('\n✅ AEPS BANK LIST:');
            console.log(JSON.stringify(result.decryptedData, null, 2));
        }
    } else if (action === 'statelist') {
        const result = await callAndDecryptAPI('/masterapi/api/master/statelist');
        if (result && result.decryptedData) {
            console.log('\n✅ AEPS STATE LIST:');
            console.log(JSON.stringify(result.decryptedData, null, 2));
        }
    } else if (action === 'decrypt') {
        const data = args[1] || testData;
        logDecryptedResponse(data, 'Manual decrypt');
    } else {
        console.log('📋 Available actions:');
        console.log('  - test       : Test with sample data and AEPS endpoint');
        console.log('  - banklist   : Test AEPS bank list endpoint');
        console.log('  - statelist  : Test AEPS state list endpoint');
        console.log('  - decrypt    : Decrypt provided data (node decrypt.js decrypt "data_here")');
        console.log('  - decrypt-file: Decrypt from file (node decrypt.js decrypt-file encrypted.txt)');
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { decrypt, logDecryptedResponse, callAndDecryptAPI };