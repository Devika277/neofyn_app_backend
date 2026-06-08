const axios = require('axios');
const { encrypt, decrypt } = require('./crypto1');

const BASE_URL = 'http://gateway.vimopay.in';
let cachedToken = null;
let tokenExpiry  = null;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const res = await axios.post(
    `${BASE_URL}/dmtapi/api/Signature/Authorizeuat`, {},
    { headers: {
        secretKey:        process.env.SECRET_KEY,
        saltKey:          process.env.SALT_KEY,
        encryptdecryptKey: process.env.ENCRYPT_DECRYPT_KEY,
        userId:           process.env.USER_ID
    }}
  );
  if (!res.data.successStatus) throw new Error('Authorization failed');
  cachedToken = res.data.data;
  tokenExpiry  = Date.now() + 55 * 60 * 1000;
  return cachedToken;
}

async function gatewayPost(url, payload) {
  const token       = await getToken();
  const requestBody = encrypt(JSON.stringify(payload));
  const res = await axios.post(
    `${BASE_URL}${url}`,
    { requestBody },
    { headers: {
        Authorization:   `Bearer ${token}`,
        userId:          process.env.USER_ID,
        'Content-Type':  'application/json'
    }}
  );
  if (res.data.successStatus && res.data.data) {
    return JSON.parse(decrypt(res.data.data));
  }
  throw new Error(res.data.message || 'Gateway error');
}

async function gatewayGet(url) {
  const token = await getToken();
  const res = await axios.get(`${BASE_URL}${url}`, {
    headers: { Authorization: `Bearer ${token}`, userId: process.env.USER_ID }
  });
  if (res.data.successStatus && res.data.data) {
    return JSON.parse(decrypt(res.data.data));
  }
  throw new Error(res.data.message || 'Gateway error');
}

module.exports = { gatewayPost, gatewayGet };