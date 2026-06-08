const axios = require('axios');
const { decrypt } = require('../utils/vimoEncrypt');  // your existing decrypt function

let cachedToken = null;
let tokenExpiry = null;

async function getVimoToken() {
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
        return cachedToken;
    }

    const BASE_URL = process.env.VIMO_BASE_URL;
    const secretKey = process.env.VIMO_SECRET_KEY;
    const saltKey = process.env.VIMO_SALT_KEY;
    const encryptdecryptKey = process.env.VIMO_ENCRYPT_DECRYPT_KEY;
    const userId = process.env.VIMO_USER_ID;

    // ✅ Correct UAT auth endpoint for recharge
    const url = `${BASE_URL}/rechargeapi/api/signature/authorizeuat`;

    const headers = {
        'Content-Type': 'application/json',
        secretKey,
        saltKey,
        encryptdecryptKey,
        userId
    };

    const response = await axios.post(url, {}, { headers });

    if (!response.data.successStatus) {
        throw new Error(`VimoPay auth failed: ${response.data.message || 'Unknown'}`);
    }

    // response.data.data is the encrypted token – decrypt it
    const decryptedToken = decrypt(response.data.data);
    cachedToken = decryptedToken;
    tokenExpiry = Date.now() + 50 * 60 * 1000; // 50 minutes

    console.log('[VimoAuth] Token refreshed');
    return cachedToken;
}

module.exports = { getVimoToken };