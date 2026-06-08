// test-request-format.js
const axios = require('axios');
const crypto = require('crypto');

const ENCRYPT_DECRYPT_KEY = '47cdba1911f078afe863774a8dffcb26';
const IV_KEY = '7cca987fb6cfeea37022977bde6e62c0';
const BEARER_TOKEN = '9fyvLgza94v0ls7gU55OGMMx6+rocl+VU2n1ED19ti2n5Puw/zkTa2VwiKPlHO5MWhtFxHvZ+zLbY5pfotJuBVX3UdKscc3Ocmgi5gM/dAXF2wZ+zoCfc3Bv/et1wItHXsrwW4dYv2BVwSxM0FnXW66W3R0FZFaKNWHcCKvU4+9cDeQFZGGf2uq7VHZ2LovhW48habzhOfD+G2mfcNHyuOdtU3xLeSAbhDLu/GxOlDJYo1p22Wi9AQirCPTfPY6l+b9jbu8WorkwCX09Oo+MIRjkBJ2cR7sVM68EFxiYhCNPkSwM0iPNVeg6EZYoQuQatly0k8ySa5UYU5XL0gquCzXWFjC8v22bUqReImpW9NGmyx6rizEyesoLSZMSEYg1KdJC+lIWMb0mllPR9R+DUk4S2Hr8DkWR+1lpySug4Nj46Xs1SvJTs7NQ/vN2R8H1cHRIqZIHN3xfQ1Spcrfv36e334sfBcIbe1sGHDvHGb8KU0fJjEASruBgJ+iT+oJLOPWAITxctx+Eh8OODF4SKW4F/Xe+Qp0bnjTF2Kw+ir8Kmrx1IbQzUR9MTSXlC850kGhjBy7x+qkh+A0lfwPx';
const USER_ID = 'E5B82667-9A9D-4A5A-A55C-F3B1E10BF370';

function encrypt(plainText) {
    const key = Buffer.from(ENCRYPT_DECRYPT_KEY, 'utf8');
    const iv  = Buffer.from(IV_KEY, 'utf8');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plainText, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([encrypted, tag]).toString('base64');
}

const payload = JSON.stringify({ stateCode: 'DL' });
const encryptedPayload = encrypt(payload);

const bodyFormats = [
    { requestBody: encryptedPayload },          // current
    { data: encryptedPayload },                 // maybe 'data'
    { encryptedData: encryptedPayload },        // maybe 'encryptedData'
    { body: encryptedPayload },                 // maybe 'body'
    { request: encryptedPayload },              // maybe 'request'
    encryptedPayload,                           // raw string
];

const headers = {
    'Content-Type': 'application/json',
    'userId': USER_ID,
    'Authorization': `Bearer ${BEARER_TOKEN}`,
};

(async () => {
    for (const body of bodyFormats) {
        try {
            const res = await axios.post(
                'https://gateway.vimopay.in/aepsapi/api/payment/acquiredistrictuat',
                body,
                { headers }
            );
            console.log(`\n✅ WORKS with body format: ${JSON.stringify(body).substring(0, 60)}`);
            console.log('Response:', JSON.stringify(res.data).substring(0, 200));
        } catch (e) {
            console.log(`❌ FAILED: ${JSON.stringify(body).substring(0, 60)} → ${e.response?.data?.message || e.message}`);
        }
    }
})();