// test-samplekey.js
const crypto = require('crypto');

// Sample code key from PDF (NOT the sandbox credential key)
const ENCRYPT_DECRYPT_KEY = '47cdba1911f078afe863774a8dffcb26';
const IV_KEY = '7cca987fb6cfeea37022977bde6e62c0';

const encryptedData = '/ebDwltjjedH0Y24alNEwR4J693p8maYOOL+T/uqowb6bBhEPHe9TQ==';

const combinations = [
    { keyEnc: 'utf8', ivEnc: 'utf8', algo: 'aes-256-gcm' },
    { keyEnc: 'utf8', ivEnc: 'hex',  algo: 'aes-256-gcm' },
    { keyEnc: 'utf8', ivEnc: 'utf8', algo: 'aes-256-cbc' },
    { keyEnc: 'utf8', ivEnc: 'hex',  algo: 'aes-256-cbc' },
];

for (const { keyEnc, ivEnc, algo } of combinations) {
    try {
        const key = Buffer.from(ENCRYPT_DECRYPT_KEY, keyEnc);
        const iv  = Buffer.from(IV_KEY, ivEnc);
        const buf = Buffer.from(encryptedData, 'base64');

        let dec;
        if (algo.includes('gcm')) {
            const tag        = buf.slice(-16);
            const ciphertext = buf.slice(0, -16);
            const decipher   = crypto.createDecipheriv(algo, key, iv);
            decipher.setAuthTag(tag);
            dec  = decipher.update(ciphertext, null, 'utf8');
            dec += decipher.final('utf8');
        } else {
            const decipher = crypto.createDecipheriv(algo, key, iv);
            dec  = decipher.update(buf, null, 'utf8');
            dec += decipher.final('utf8');
        }

        console.log(`\n✅ SUCCESS: key=${keyEnc}, iv=${ivEnc}, algo=${algo}`);
        console.log('Decrypted:', dec);
    } catch (e) {
        console.log(`❌ FAILED:  key=${keyEnc}, iv=${ivEnc}, algo=${algo} → ${e.message}`);
    }
}