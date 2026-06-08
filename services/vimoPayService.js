// const axios = require('axios');
// const crypto = require('crypto');

// const VIMO_BASE = 'https://gateway.vimopay.in'; // replace with actual UAT base URL
// const MERCHANT_ID = process.env.VIMO_MERCHANT_ID;
// const SECRET_KEY = process.env.SECRET_KEY;

// class VimoPayService {

//     // ── Step 1: Get Auth Token ──────────────────────────────────────────
//     async getAuthToken() {
//         const res = await axios.post(`${VIMO_BASE}/bbpsapi/api/signature/authorizeuat`, {
//             merchantId: MERCHANT_ID,
//             secretKey: SECRET_KEY
//         });
//         return res.data.token; // store this, reuse until expiry
//     }

//     // ── Step 2: Get State List (for biller UI dropdowns) ────────────────
//     async getStateList(token) {
//         const res = await axios.get(`${VIMO_BASE}/masterapi/api/master/statelistuat`, {
//             headers: { Authorization: `Bearer ${token}` }
//         });
//         return res.data;
//     }

//     // ── Step 3: Get Biller Categories ───────────────────────────────────
//     async getBillerCategories(token) {
//         const res = await axios.get(`${VIMO_BASE}/bbpsapi/api/BillerCategories/CityUat`, {
//             headers: { Authorization: `Bearer ${token}` }
//         });
//         return res.data;
//     }

//     // ── Step 4: Fetch Bill ───────────────────────────────────────────────
//     async fetchBill(token, { merchantRefId, billerId, consumerNumber, additionalParams }) {
//         const res = await axios.post(
//             `${VIMO_BASE}/bbpsapi/api/bill/fetchuat`,  // confirm exact path from VimoPay docs
//             {
//                 merchantId: MERCHANT_ID,
//                 merchantRefId,          // generate once, reuse for Pay Now
//                 billerId,
//                 consumerNumber,
//                 additionalParams: additionalParams || {}
//             },
//             { headers: { Authorization: `Bearer ${token}` } }
//         );
//         return res.data; // this is your FetchBillResult
//     }

//     // ── Step 5: Pay Bill ─────────────────────────────────────────────────
//     async payBill(token, { merchantRefId, fetchBillResult, amount, userId }) {
//         const res = await axios.post(
//             `${VIMO_BASE}/bbpsapi/api/bill/payuat`,    // confirm exact path
//             {
//                 merchantId: MERCHANT_ID,
//                 merchantRefId,           // SAME as used in fetchBill
//                 amount,
//                 fetchBillResult,         // pass the whole object back
//                 agentId: userId
//             },
//             { headers: { Authorization: `Bearer ${token}` } }
//         );
//         return res.data;
//     }
// }

// module.exports = new VimoPayService();



const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.VIMOPAY_BASE_URL;

const AUTH_HEADERS = {
  secretKey: process.env.SECRET_KEY,
  saltKey: process.env.SALT_KEY,
  encryptdecryptKey: process.env.ENCRYPT_DECRYPT_KEY,
  userId: process.env.USER_ID,
  'Content-Type': 'application/json',
};

// Step 1: Get Bearer Token
async function authorize() {
  const response = await axios.post(
    `${BASE_URL}/aepsapi/api/signature/authorizeuat`,
    {},
    { headers: AUTH_HEADERS }
  );
  if (response.data.successStatus) {
    return response.data.data; // This is the Bearer token
  }
  throw new Error('Authorization failed: ' + response.data.message);
}

// Step 2: Get Bank List
async function getBankList(token) {
  const response = await axios.get(
    `${BASE_URL}/masterapi/api/master/banklistuat`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        userId: process.env.USER_ID,
      },
    }
  );
  return response.data;
}

// Step 3: Get State List
async function getStateList(token) {
  const response = await axios.get(
    `${BASE_URL}/masterapi/api/master/statelistuat`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        userId: process.env.USER_ID,
      },
    }
  );
  return response.data;
}

// Step 4: Get District List
async function getDistrictList(token, encryptedBody) {
  const response = await axios.post(
    `${BASE_URL}/aepsapi/api/payment/acquiredistrictuat`,
    { requestBody: encryptedBody },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        userId: process.env.USER_ID,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
}

// Step 5: Register Merchant
async function registerMerchant(token, encryptedBody) {
  const response = await axios.post(
    `${BASE_URL}/aepsapi/api/payment/merchantonboarduat`,
    { requestBody: encryptedBody },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        userId: process.env.USER_ID,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
}

module.exports = { authorize, getBankList, getStateList, getDistrictList, registerMerchant };