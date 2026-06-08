// services/partnerAuthService.js
const axios = require('axios');

const VIMO_BASE = 'http://gateway.vimopay.in';
let cachedAuthToken = null;
let tokenExpiry = null;

async function getBearerToken() {
    if (cachedAuthToken && tokenExpiry && Date.now() < tokenExpiry) {
        console.log('Using cached VimoPay token');
        return cachedAuthToken;
    }

    try {
        console.log('=== Getting VimoPay Auth Token ===');
        
        const response = await axios.post(
            `${VIMO_BASE}/rechargeplanapi/api/signature/authorizeuat`,
            {},
            {
                headers: {
                    'Content-Type': 'application/json',
                    'secretKey': process.env.SECRET_KEY,
                    'saltKey': process.env.SALT_KEY,
                    'encryptDecryptKey': process.env.ENCRYPT_DECRYPT_KEY,
                    'userId': process.env.PARTNER_USER_ID
                }
            }
        );

        if (response.data.successStatus !== true) {
            throw new Error(`Auth failed: ${response.data.message}`);
        }

        const token = response.data.data;
        
        if (!token) {
            throw new Error('No token in response');
        }

        console.log('✅ VimoPay token obtained (length:', token.length, 'chars)');

        cachedAuthToken = token;
        tokenExpiry = Date.now() + 50 * 60 * 1000;
        
        return token;
        
    } catch (error) {
        console.error('VimoPay Auth Error:', error.response?.data || error.message);
        throw new Error(`Failed to authenticate with VimoPay: ${error.message}`);
    }
}

module.exports = { getBearerToken };