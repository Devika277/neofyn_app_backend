
// test-prepend-iv.js
const crypto = require('crypto');
const axios  = require('axios');

const ENCRYPT_DECRYPT_KEY = '47cdba1911f078afe863774a8dffcb26'; // sample key
const BEARER_TOKEN = '9fyvLgza94v0ls7gU55OGMMx6+rocl+VU2n1ED19ti2n5Puw/zkTa2VwiKPlHO5MWhtFxHvZ+zLbY5pfotJuBVX3UdKscc3Ocmgi5gM/dAXF2wZ+zoCfc3Bv/et1wItHXsrwW4dYv2BVwSxM0FnXW66W3R0FZFaKNWHcCKvU4+9cDeQFZGGf2uq7VHZ2LovhW48habzhOfD+G2mfcNHyuOdtU3xLeSAbhDLu/GxOlDJYo1p22Wi9AQirCPTfPY6l+b9jbu8WorkwCX09Oo+MIRjkBJ2cR7sVM68EFxiYhCNPkSwM0iPNVeg6EZYoQuQatly0k8ySa5UYU5XL0gquCzXWFjC8v22bUqReImpW9NGmyx6rizEyesoLSZMSEYg1KdJC+lIWMb0mllPR9R+DUk4S2Hr8DkWR+1lpySug4Nj46Xs1SvJTs7NQ/vN2R8H1O3d2qdEHN3xfQ1Spcrfv36e334sfBcIbe1sGHDvHGb8KU0fJjEASruBgJ+iT+oJLOPWAITNKn1qNm8+BLj4IE1hMzkCSe+4Qg2/O0vFvsqshrbVdV4szZSklbS/4NJ3KZLKSJW6BuMoQ9/K/Ez5y'; // get a fresh one first
const USER_ID = 'E5B82667-9A9D-4A5A-A55C-F3B1E10BF370';

function encryptWithRandomIV(plainText, keyStr) {
    const key = Buffer.from(keyStr, 'utf8');       // 32 bytes
    const iv  = crypto.randomBytes(12);             // 12 byte random IV (standard GCM)

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let enc = cipher.update(plainText, 'utf8');
    enc = Buffer.concat([enc, cipher.final()]);
    const tag = cipher.getAuthTag();

    // Prepend IV: [12B iv][ciphertext][16B tag]
    return Buffer.concat([iv, enc, tag]).toString('base64');
}

function decryptWithPrependedIV(encryptedText, keyStr) {
    const key = Buffer.from(keyStr, 'utf8');
    const buf = Buffer.from(encryptedText, 'base64');

    const iv         = buf.slice(0, 12);   // first 12 bytes = IV
    const tag        = buf.slice(-16);     // last 16 bytes = tag
    const ciphertext = buf.slice(12, -16); // middle = ciphertext

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let dec = decipher.update(ciphertext, null, 'utf8');
    dec += decipher.final('utf8');
    return dec.trim();
}

// Test encrypt/decrypt roundtrip first
const payload = JSON.stringify({ stateCode: 'DL' });
const encrypted = encryptWithRandomIV(payload, ENCRYPT_DECRYPT_KEY);
console.log('Encrypted length:', encrypted.length, '(should be 60+ chars)');
console.log('Encrypted:', encrypted);

// Verify roundtrip
const decrypted = decryptWithPrependedIV(encrypted, ENCRYPT_DECRYPT_KEY);
console.log('Roundtrip decrypt:', decrypted);
console.log('Roundtrip OK:', decrypted === payload);

// Now hit the API
(async () => {
    try {
        const res = await axios.post(
            'https://gateway.vimopay.in/aepsapi/api/payment/acquiredistrictuat',
            { requestBody: encrypted },
            { headers: {
                'Content-Type': 'application/json',
                'userId': USER_ID,
                'Authorization': `Bearer ${BEARER_TOKEN}`,
            }}
        );
        console.log('\nAPI Response:', JSON.stringify(res.data));

        // Try to decrypt response
        if (res.data.data) {
            try {
                const dec = decryptWithPrependedIV(res.data.data, ENCRYPT_DECRYPT_KEY);
                console.log('Decrypted response:', dec);
            } catch(e) {
                console.log('Response decrypt failed:', e.message);
            }
        }
    } catch(e) {
        console.log('API Error:', e.response?.data || e.message);
    }
})();