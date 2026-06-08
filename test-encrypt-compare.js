// test-encrypt-compare.js
const crypto = require('crypto');

// Test BOTH keys
const keys = [
    { name: 'sandbox-key',  key: '47cdba1911f078afe863774a8dffcb26' },
    { name: 'samplecode-key', key: '8086289ecab4a664c8410a1e79d19090' },
];
const IV_KEY = '7cca987fb6cfeea37022977bde6e62c0';
const payload = JSON.stringify({ stateCode: 'DL' });

for (const { name, key: edKey } of keys) {
    for (const ivEnc of ['utf8', 'hex']) {
        for (const keyEnc of ['utf8', 'hex']) {
            try {
                const keyBuf = Buffer.from(edKey, keyEnc);
                const ivBuf  = Buffer.from(IV_KEY, ivEnc);
                const algo   = keyBuf.length === 32 ? 'aes-256-gcm' : 'aes-128-gcm';

                const cipher = crypto.createCipheriv(algo, keyBuf, ivBuf);
                let enc = cipher.update(payload, 'utf8');
                enc = Buffer.concat([enc, cipher.final()]);
                const tag = cipher.getAuthTag();
                const result = Buffer.concat([enc, tag]).toString('base64');

                console.log(`✅ ${name} | key=${keyEnc}(${keyBuf.length}B) iv=${ivEnc}(${ivBuf.length}B) ${algo}`);
                console.log(`   Result length: ${result.length}`);
                console.log(`   Result: ${result}\n`);
            } catch(e) {
                console.log(`❌ ${name} | key=${keyEnc} iv=${ivEnc} → ${e.message}`);
            }
        }
    }
}