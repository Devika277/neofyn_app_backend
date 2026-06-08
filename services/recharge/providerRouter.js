const axios = require('axios');
const { encrypt, decrypt } = require('../../utils/vimoEncrypt');
const { getVimoToken } = require('../vimoAuth');

/**
 * Execute a recharge via VimoPay UAT
 * @param {Object} rechargeData - { mobile, operatorCode, serviceType, amount, lat, long }
 * @param {string} merchantRefId - unique idempotency key
 * @returns {Promise<{status: string, providerTxnId: string, rawResponse: Object}>}
 */
async function routeRecharge(rechargeData, merchantRefId) {
    const token = await getVimoToken();
    const BASE_URL = process.env.VIMO_BASE_URL;
    const url = `${BASE_URL}/rechargeapi/api/payment/rechargeuat`;

    const payload = {
        merchantRefId,
        amount: Number(rechargeData.amount),
        operatorCode: rechargeData.operatorCode,   // e.g. 'JRE', 'ATL'
        serviceType: rechargeData.serviceType,     // 'MBL' for mobile
        operatorNumber: rechargeData.mobile,
        lat: rechargeData.lat || '0.0',
        long: rechargeData.long || '0.0',
        udf1: '',
        udf2: '',
        udf3: ''
    };

    // Encrypt the payload as per VimoPay spec
    const encryptedBody = encrypt(payload, process.env.VIMO_ENCRYPT_DECRYPT_KEY, process.env.VIMO_ENCRYPT_DECRYPT_KEY);

    const response = await axios.post(url, { requestBody: encryptedBody }, {
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            userId: process.env.VIMO_USER_ID
        }
    });

    if (!response.data.successStatus) {
        throw new Error(`VimoPay recharge error: ${response.data.message}`);
    }

    // Decrypt the response data
    const decryptedData = decrypt(response.data.data, process.env.VIMO_ENCRYPT_DECRYPT_KEY, process.env.VIMO_ENCRYPT_DECRYPT_KEY);
    // decryptedData contains: txnId, txnStatusCode, txnStatus, etc.

    const statusMap = {
        '000': 'success',
        '001': 'failed',
        '002': 'pending',
        '004': 'pending'
    };

    return {
        status: statusMap[decryptedData.txnStatusCode] || 'pending',
        providerTxnId: decryptedData.txnId || '',
        rawResponse: decryptedData
    };
}

module.exports = { routeRecharge };