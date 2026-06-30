const axios = require('axios');
const { encrypt, decrypt } = require('../utils/vimopayEncrypt');

let cachedToken = null;
let tokenExpiry = null;
let cachedBankList = null;
let bankListExpiry = null;
let cachedStateList = null;
let stateListExpiry = null;
const cachedCityLists = {};
const cityListExpiry = {};
const stateCoordinates = {
  "Kerala": { lat: "10.8505", long: "76.2711" },
  "KL": { lat: "10.8505", long: "76.2711" },
  "Tamil Nadu": { lat: "11.1271", long: "78.6569" },
  "TN": { lat: "11.1271", long: "78.6569" },
  "Karnataka": { lat: "15.3173", long: "75.7139" },
  "KA": { lat: "15.3173", long: "75.7139" },
  "Maharashtra": { lat: "19.7515", long: "75.7139" },
  "MH": { lat: "19.7515", long: "75.7139" },
  "Delhi": { lat: "28.7041", long: "77.1025" },
  "DL": { lat: "28.7041", long: "77.1025" },
  "Uttar Pradesh": { lat: "26.8467", long: "80.9462" },
  "UP": { lat: "26.8467", long: "80.9462" },
  "Gujarat": { lat: "22.2587", long: "71.1924" },
  "GJ": { lat: "22.2587", long: "71.1924" },
  "Rajasthan": { lat: "27.0238", long: "74.2179" },
  "RJ": { lat: "27.0238", long: "74.2179" },
  "West Bengal": { lat: "22.9868", long: "87.8550" },
  "WB": { lat: "22.9868", long: "87.8550" },
  "Bihar": { lat: "25.0961", long: "85.3131" },
  "BR": { lat: "25.0961", long: "85.3131" },
  "Andhra Pradesh": { lat: "15.9129", long: "79.7400" },
  "AP": { lat: "15.9129", long: "79.7400" },
  "Telangana": { lat: "17.1232", long: "79.2088" },
  "TS": { lat: "17.1232", long: "79.2088" }
};
async function getAuthToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const BASE_URL = process.env.PAYOUT_BASE_URL;
  const USER_ID = process.env.PAYOUT_USER_ID;

  console.log('[VimoPay] Auth URL:', `${BASE_URL}/payoutapi/api/Signature/Authorize`);
  console.log('[VimoPay] userId:', USER_ID);

  try {
    const response = await axios.post(
      `${BASE_URL}/payoutapi/api/Signature/Authorize`,
      {},
      {
        headers: {
          secretKey: process.env.PAYOUT_SECRET_KEY,
          saltKey: process.env.PAYOUT_SALT_KEY,
          encryptdecryptKey: process.env.PAYOUT_ENCRYPT_DECRYPT_KEY,
          userId: USER_ID,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log('[VimoPay] Auth response:', response.data);

    const rawToken = response.data.data.replace(/[\r\n]/g, '');
    cachedToken = rawToken;
    tokenExpiry = Date.now() + 25 * 60 * 1000;
    return cachedToken;

  } catch (e) {
    console.error('[VimoPay] Auth failed - status:', e.response?.status);
    console.error('[VimoPay] Auth failed - data:', e.response?.data);
    throw e;
  }
}

/**
 * Send DMT transfer using the same endpoint as payout
 */
// async function sendDmtTransfer(params) {
//   const { merchantRefId, amount, mode, remitter, beneficiary, lat, long } = params;

//   const BASE_URL = process.env.PAYOUT_BASE_URL;
//   const USER_ID = process.env.PAYOUT_USER_ID;

//   console.log('[VimoPay DMT] Starting transfer', { merchantRefId, amount, mode });

//   const token = await getAuthToken();

//   const validBankCode = beneficiary.bankCode || '001';
  
//   // Clean beneficiary name - remove special characters, keep only alphabets and spaces
//   const cleanName = (name) => {
//     if (!name) return '';
//     let cleaned = name.replace(/[^a-zA-Z\s]/g, '');
//     cleaned = cleaned.replace(/\s+/g, ' ').trim();
//     return cleaned.toUpperCase();
//   };

//   // Ensure IFSC is uppercase and valid format
//   const cleanIFSC = (ifsc) => {
//     const cleaned = ifsc.toUpperCase().trim();
//     // Validate IFSC format: 4 letters, 0, 6 alphanumeric
//     const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
//     if (!ifscRegex.test(cleaned)) {
//       console.warn('[VimoPay DMT] Invalid IFSC format:', ifsc, 'cleaned to:', cleaned);
//     }
//     return cleaned;
//   };

//   const cleanedName = cleanName(beneficiary.name);
//   const cleanedIFSC = cleanIFSC(beneficiary.ifsc);
  
//   console.log('[VimoPay DMT] Cleaned beneficiary name:', cleanedName);
//   console.log('[VimoPay DMT] Cleaned IFSC:', cleanedIFSC);

//   const payload = {
//     amount: parseFloat(amount),
//     merchantRefId: String(merchantRefId).replace(/_/g, '-'),
//     beneficiaryBank: validBankCode,
//     paymentPurpose: '004',
//     paymentMode: mode.toLowerCase(),
//     beneficiaryAccountNumber: String(beneficiary.accountNumber),
//     beneficiaryIFSC: cleanedIFSC,
//     beneficiaryMobileNumber: String(beneficiary.mobile || remitter.mobile || '9999999999'),
//     beneficiaryName: cleanedName,
//     beneficiaryLocation: beneficiary.location || 'MH',
//     // lat: String(lat !== undefined && lat !== null ? lat : '0.0'),
//     // long: String(long !== undefined && long !== null ? long : '0.0'),
//     // lat: "10.8505",
// // long: "76.2711",
// lat: String(lat && lat !== '0.0' && lat !== 0 ? lat : (stateCoordinates[beneficiary.location]?.lat || '20.5937')),
// long: String(long && long !== '0.0' && long !== 0 ? long : (stateCoordinates[beneficiary.location]?.long || '78.9629')),
//     udf1: '',
//     udf2: '',
//     udf3: '',
//     remitterMobile: String(remitter.mobile),
//     remitterName: cleanName(remitter.name)
//   };
// console.log("LOCATION DEBUG RAW:", beneficiary.location);
// console.log("BENEFICIARY OBJECT:", beneficiary);
//   console.log('[VimoPay DMT] Sending payload:', JSON.stringify(payload, null, 2));

//   const encryptedBody = encrypt(JSON.stringify(payload));
//   console.log('[VimoPay DMT] Encrypted body (first 50 chars):', encryptedBody.slice(0, 50) + '...');

//   const endpoint = `${BASE_URL}/payoutapi/api/Payment/payout`;
//   console.log('[VimoPay DMT] Calling endpoint:', endpoint);

//   try {
//     const response = await axios.post(
//       endpoint,
//       { requestBody: encryptedBody },
//       {
//         headers: {
//           Authorization: `Bearer ${token}`,
//           userId: USER_ID,
//           'Content-Type': 'application/json'
//         },
//         timeout: 15000
//       }
//     );

//     console.log('[VimoPay DMT] Response status:', response.status);
//     console.log('[VimoPay DMT] Raw response:', JSON.stringify(response.data, null, 2));

//     const responseData = response.data;

//     // ALWAYS decrypt the data field to get the actual response
//     let decrypted = null;
//     let data = null;
    
//     if (responseData.data) {
//       try {
//         decrypted = decrypt(responseData.data);
//         console.log('[VimoPay DMT] Decrypted response:', decrypted);
        
//         try {
//           data = JSON.parse(decrypted);
//           console.log('[VimoPay DMT] Parsed data:', data);
//         } catch (e) {
//           console.warn('[VimoPay DMT] Decrypted response is not JSON, using as string');
//           data = { responseMessage: decrypted };
//         }
//       } catch (e) {
//         console.error('[VimoPay DMT] Decryption failed:', e.message);
//         try {
//           data = JSON.parse(responseData.data);
//         } catch (e2) {
//           data = { responseMessage: responseData.data };
//         }
//       }
//     }

//     // Handle failure with decrypted error message
//     if (!responseData || !responseData.successStatus) {
//       console.error('[VimoPay DMT] Transfer failed:', {
//         responseCode: responseData?.responseCode,
//         message: responseData?.message,
//         decryptedData: data,
//         rawData: responseData?.data
//       });
      
//       let errorMessage = responseData?.message || 'VimoPay DMT API rejected request';
      
//       // Extract detailed error messages from the decrypted data
//       if (Array.isArray(data)) {
//         const errors = data.map(err => err.ErrorMessage).join('; ');
//         errorMessage = errors || errorMessage;
//       } else if (data?.ErrorMessage) {
//         errorMessage = data.ErrorMessage;
//       } else if (data?.responseMessage) {
//         errorMessage = data.responseMessage;
//       } else if (data?.message) {
//         errorMessage = data.message;
//       }
      
//       return {
//         status: responseData?.responseCode || '001',
//         providerRefId: data?.txnId || data?.transactionId || null,
//         utr: null,   // ✅ UTR added
//         message: errorMessage,
//         rawError: data
//       };
//     }

//     // Success case - use decrypted data
//     const dataField = responseData.data;
//     if (!dataField) {
//       return {
//         status: 'pending',
//         providerRefId: null,
//         utr: null,   // ✅ UTR added
//         message: 'Queued — awaiting callback'
//       };
//     }

//     // If we don't have data yet, try one more time
//     if (!data) {
//       try {
//         const decrypted2 = decrypt(dataField);
//         data = JSON.parse(decrypted2);
//         console.log('[VimoPay DMT] Decrypted success data:', data);
//       } catch (e) {
//         console.warn('[VimoPay DMT] Could not parse success data');
//         data = {};
//       }
//     }

//     const code = data?.txnStatusCode || data?.responseCode || data?.status;
//     console.log('[VimoPay DMT] Transaction status code:', code);

//     if (code === '000' || code === '00' || code === 'SUCCESS') {
//       const utr = data.rrn || data.transactionId || data.txnId || null;   // ✅ Extract UTR
//       console.log('[VimoPay DMT] Captured UTR:', utr);
//       return {
//         status: '000',
//         providerRefId: data.txnId || data.transactionId || data.providerRefId,
//         utr: utr,   // ✅ UTR included
//         message: data.responseMessage || data.message || 'Success'
//       };
//     } else if (code === '004' || code === '04' || code === 'PENDING') {
//       return {
//         status: '004',
//         providerRefId: data.txnId || data.transactionId || null,
//         utr: null,   // ✅ UTR added
//         message: 'Queued'
//       };
//     } else {
//       const errorMsg = data.responseMessage || data.message || data.error || 'Transaction failed';
//       console.warn('[VimoPay DMT] Transaction failed with code:', code, 'Message:', errorMsg);
//       return {
//         status: code || '001',
//         providerRefId: data?.txnId || null,
//         utr: null,   // ✅ UTR added
//         message: errorMsg,
//         rawError: data
//       };
//     }
//   } catch (error) {
//     console.error('[VimoPay DMT] Transfer error:', error.message);
//     if (error.response) {
//       console.error('[VimoPay DMT] Error response:', JSON.stringify(error.response.data, null, 2));
//     }
//     throw new Error(`VimoPay DMT transfer failed: ${error.message}`);
//   }
// }



/**
 * Send DMT transfer using the same endpoint as payout
 * @param {Object} params - { merchantRefId, amount, mode, remitter, beneficiary }
 */
async function sendDmtTransfer(params) {
  const { merchantRefId, amount, mode, remitter, beneficiary, lat, long } = params;

  const BASE_URL = process.env.PAYOUT_BASE_URL;
  const USER_ID = process.env.PAYOUT_USER_ID;

  console.log('[VimoPay DMT] Starting transfer', { merchantRefId, amount, mode });

  const token = await getAuthToken();

  // ✅ FIX: Get correct bank code from bank list
  let validBankCode = beneficiary.bankCode;
  
  // If bankCode is null, undefined, or '001' (default), try to find correct one
  if (!validBankCode || validBankCode === '001' || validBankCode === 'null' || validBankCode === 'undefined') {
    console.log('[VimoPay DMT] 🔍 Looking up correct bank code for IFSC:', beneficiary.ifsc);
    
    try {
      // Fetch bank list
      const bankList = await getBankList();
      console.log('[VimoPay DMT] 📋 Bank list fetched, total banks:', bankList.length);
      
      let matchedBank = null;
      
      // Strategy 1: Match by IFSC prefix (first 4 characters)
      if (beneficiary.ifsc) {
        const ifscPrefix = beneficiary.ifsc.substring(0, 4).toUpperCase();
        console.log('[VimoPay DMT] 🔍 Searching by IFSC prefix:', ifscPrefix);
        
        matchedBank = bankList.find(bank => {
          const bankIfsc = (bank.ifsc || '').substring(0, 4).toUpperCase();
          return bankIfsc === ifscPrefix;
        });
        
        if (matchedBank) {
          console.log('[VimoPay DMT] ✅ Found bank by IFSC prefix:', {
            code: matchedBank.bankCode || matchedBank.code,
            name: matchedBank.bankName || matchedBank.name
          });
        }
      }
      
      // Strategy 2: Match by bank name (if not found by IFSC)
      if (!matchedBank && beneficiary.bankName) {
        const searchName = beneficiary.bankName.toUpperCase();
        console.log('[VimoPay DMT] 🔍 Searching by bank name:', searchName);
        
        matchedBank = bankList.find(bank => {
          const bankName = (bank.bankName || bank.name || '').toUpperCase();
          return bankName.includes(searchName) || searchName.includes(bankName);
        });
        
        if (matchedBank) {
          console.log('[VimoPay DMT] ✅ Found bank by name:', {
            code: matchedBank.bankCode || matchedBank.code,
            name: matchedBank.bankName || matchedBank.name
          });
        }
      }
      
      // Strategy 3: Try to match by IFSC code completely (if not found by prefix)
      if (!matchedBank && beneficiary.ifsc) {
        const ifscFull = beneficiary.ifsc.toUpperCase();
        console.log('[VimoPay DMT] 🔍 Searching by full IFSC:', ifscFull);
        
        matchedBank = bankList.find(bank => {
          const bankIfsc = (bank.ifsc || '').toUpperCase();
          return bankIfsc === ifscFull;
        });
        
        if (matchedBank) {
          console.log('[VimoPay DMT] ✅ Found bank by full IFSC:', {
            code: matchedBank.bankCode || matchedBank.code,
            name: matchedBank.bankName || matchedBank.name
          });
        }
      }
      
      // If found, use the correct bank code
      if (matchedBank) {
        validBankCode = matchedBank.bankCode || matchedBank.code || matchedBank.bank_id;
        console.log('[VimoPay DMT] ✅ Using bank code:', validBankCode);
      } else {
        console.warn('[VimoPay DMT] ⚠️ No matching bank found, using default: 001');
        validBankCode = '001';
      }
      
    } catch (error) {
      console.error('[VimoPay DMT] ❌ Error fetching bank list:', error.message);
      validBankCode = '001';
    }
  } else {
    console.log('[VimoPay DMT] Using provided bank code:', validBankCode);
  }

  // Clean beneficiary name - remove special characters, keep only alphabets and spaces
  const cleanName = (name) => {
    if (!name) return '';
    let cleaned = name.replace(/[^a-zA-Z\s]/g, '');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned.toUpperCase();
  };

  // Ensure IFSC is uppercase and valid format
  const cleanIFSC = (ifsc) => {
    const cleaned = ifsc.toUpperCase().trim();
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(cleaned)) {
      console.warn('[VimoPay DMT] Invalid IFSC format:', ifsc, 'cleaned to:', cleaned);
    }
    return cleaned;
  };

  const cleanedName = cleanName(beneficiary.name);
  const cleanedIFSC = cleanIFSC(beneficiary.ifsc);
  
  console.log('[VimoPay DMT] Cleaned beneficiary name:', cleanedName);
  console.log('[VimoPay DMT] Cleaned IFSC:', cleanedIFSC);

  const payload = {
    amount: parseFloat(amount),
    merchantRefId: String(merchantRefId).replace(/_/g, '-'),
    beneficiaryBank: validBankCode,  // ✅ Now using correct bank code
    paymentPurpose: '004',
    paymentMode: mode.toLowerCase(),
    beneficiaryAccountNumber: String(beneficiary.accountNumber),
    beneficiaryIFSC: cleanedIFSC,
    beneficiaryMobileNumber: String(beneficiary.mobile || remitter.mobile || '9999999999'),
    beneficiaryName: cleanedName,
    beneficiaryLocation: beneficiary.location || 'MH',
    lat: String(lat && lat !== '0.0' && lat !== 0 ? lat : (stateCoordinates[beneficiary.location]?.lat || '20.5937')),
    long: String(long && long !== '0.0' && long !== 0 ? long : (stateCoordinates[beneficiary.location]?.long || '78.9629')),
    udf1: '',
    udf2: '',
    udf3: '',
    remitterMobile: String(remitter.mobile),
    remitterName: cleanName(remitter.name)
  };

  console.log("LOCATION DEBUG RAW:", beneficiary.location);
  console.log("BENEFICIARY OBJECT:", beneficiary);
  console.log('[VimoPay DMT] Sending payload:', JSON.stringify(payload, null, 2));

  const encryptedBody = encrypt(JSON.stringify(payload));
  console.log('[VimoPay DMT] Encrypted body (first 50 chars):', encryptedBody.slice(0, 50) + '...');

  const endpoint = `${BASE_URL}/payoutapi/api/Payment/payout`;
  console.log('[VimoPay DMT] Calling endpoint:', endpoint);

  try {
    const response = await axios.post(
      endpoint,
      { requestBody: encryptedBody },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          userId: USER_ID,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log('[VimoPay DMT] Response status:', response.status);
    console.log('[VimoPay DMT] Raw response:', JSON.stringify(response.data, null, 2));

    const responseData = response.data;

    // ALWAYS decrypt the data field to get the actual response
    let decrypted = null;
    let data = null;
    
    if (responseData.data) {
      try {
        decrypted = decrypt(responseData.data);
        console.log('[VimoPay DMT] Decrypted response:', decrypted);
        
        try {
          data = JSON.parse(decrypted);
          console.log('[VimoPay DMT] Parsed data:', data);
        } catch (e) {
          console.warn('[VimoPay DMT] Decrypted response is not JSON, using as string');
          data = { responseMessage: decrypted };
        }
      } catch (e) {
        console.error('[VimoPay DMT] Decryption failed:', e.message);
        try {
          data = JSON.parse(responseData.data);
        } catch (e2) {
          data = { responseMessage: responseData.data };
        }
      }
    }

    // Handle failure with decrypted error message
    if (!responseData || !responseData.successStatus) {
      console.error('[VimoPay DMT] Transfer failed:', {
        responseCode: responseData?.responseCode,
        message: responseData?.message,
        decryptedData: data,
        rawData: responseData?.data
      });
      
      let errorMessage = responseData?.message || 'VimoPay DMT API rejected request';
      
      if (Array.isArray(data)) {
        const errors = data.map(err => err.ErrorMessage).join('; ');
        errorMessage = errors || errorMessage;
      } else if (data?.ErrorMessage) {
        errorMessage = data.ErrorMessage;
      } else if (data?.responseMessage) {
        errorMessage = data.responseMessage;
      } else if (data?.message) {
        errorMessage = data.message;
      }
      
      return {
        status: responseData?.responseCode || '001',
        providerRefId: data?.txnId || data?.transactionId || null,
        utr: null,
        message: errorMessage,
        rawError: data
      };
    }

    // Success case - use decrypted data
    const dataField = responseData.data;
    if (!dataField) {
      return {
        status: 'pending',
        providerRefId: null,
        utr: null,
        message: 'Queued — awaiting callback'
      };
    }

    if (!data) {
      try {
        const decrypted2 = decrypt(dataField);
        data = JSON.parse(decrypted2);
        console.log('[VimoPay DMT] Decrypted success data:', data);
      } catch (e) {
        console.warn('[VimoPay DMT] Could not parse success data');
        data = {};
      }
    }

    const code = data?.txnStatusCode || data?.responseCode || data?.status;
    console.log('[VimoPay DMT] Transaction status code:', code);

    if (code === '000' || code === '00' || code === 'SUCCESS') {
      const utr = data.rrn || data.transactionId || data.txnId || null;
      console.log('[VimoPay DMT] Captured UTR:', utr);
      return {
        status: '000',
        providerRefId: data.txnId || data.transactionId || data.providerRefId,
        utr: utr,
        message: data.responseMessage || data.message || 'Success'
      };
    } else if (code === '004' || code === '04' || code === 'PENDING') {
      return {
        status: '004',
        providerRefId: data.txnId || data.transactionId || null,
        utr: null,
        message: 'Queued'
      };
    } else {
      const errorMsg = data.responseMessage || data.message || data.error || 'Transaction failed';
      console.warn('[VimoPay DMT] Transaction failed with code:', code, 'Message:', errorMsg);
      return {
        status: code || '001',
        providerRefId: data?.txnId || null,
        utr: null,
        message: errorMsg,
        rawError: data
      };
    }
  } catch (error) {
    console.error('[VimoPay DMT] Transfer error:', error.message);
    if (error.response) {
      console.error('[VimoPay DMT] Error response:', JSON.stringify(error.response.data, null, 2));
    }
    throw new Error(`VimoPay DMT transfer failed: ${error.message}`);
  }
}







async function getStateList() {
  if (cachedStateList && stateListExpiry && Date.now() < stateListExpiry) {
    console.log('[VimoPay Payout] Using cached state list');
    return cachedStateList;
  }

  const BASE_URL = process.env.PAYOUT_BASE_URL;
  const USER_ID = process.env.PAYOUT_USER_ID;
  const token = await getAuthToken();

  const response = await axios.get(`${BASE_URL}/masterapi/api/master/statelist`, {
    headers: { Authorization: `Bearer ${token}`, userId: USER_ID },
    timeout: 10000
  });

  const responseData = response.data;
  if (!responseData.successStatus || responseData.responseCode !== '000') {
    throw new Error('Failed to fetch state list: ' + responseData.message);
  }

  let states;
  try {
    states = JSON.parse(decrypt(responseData.data));
  } catch (e) {
    try {
      states = JSON.parse(responseData.data);
    } catch (e2) {
      throw new Error('State list decryption failed');
    }
  }

  cachedStateList = states;
  stateListExpiry = Date.now() + 24 * 60 * 60 * 1000;
  console.log(`[VimoPay Payout] State list cached (${states.length} states)`);
  return states;
}

async function getCityList(stateCode) {
  if (cachedCityLists[stateCode] && cityListExpiry[stateCode] && Date.now() < cityListExpiry[stateCode]) {
    console.log(`[VimoPay Payout] Using cached city list for ${stateCode}`);
    return cachedCityLists[stateCode];
  }

  const BASE_URL = process.env.PAYOUT_BASE_URL;
  const USER_ID = process.env.PAYOUT_USER_ID;
  const token = await getAuthToken();

  try {
    const response = await axios.get(`${BASE_URL}/masterapi/api/master/citylist`, {
      params: { stateCode },
      headers: { Authorization: `Bearer ${token}`, userId: USER_ID },
      timeout: 5000
    });

    if (!response.data.successStatus) return [];

    let cities;
    try {
      cities = JSON.parse(decrypt(response.data.data));
    } catch (e) {
      cities = JSON.parse(response.data.data);
    }

    cachedCityLists[stateCode] = cities;
    cityListExpiry[stateCode] = Date.now() + 24 * 60 * 60 * 1000;
    return cities;
  } catch (e) {
    console.warn(`[VimoPay Payout] City list unavailable for ${stateCode}:`, e.message);
    return [];
  }
}

/**
 * Fetch bank list from Vidual API (Production)
 * Caches for 24 hours
 */
async function getBankList() {
  if (cachedBankList && bankListExpiry && Date.now() < bankListExpiry) {
    console.log('[VimoPay Payout] Using cached bank list');
    return cachedBankList;
  }

  const BASE_URL = process.env.PAYOUT_BASE_URL;
  const USER_ID = process.env.PAYOUT_USER_ID;

  console.log('[VimoPay Payout] Fetching fresh bank list...');

  const token = await getAuthToken();

  const bankUrl = `${BASE_URL}/masterapi/api/master/banklist`;
  console.log('[VimoPay Payout] Bank list URL:', bankUrl);

  const response = await axios.get(bankUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      userId: USER_ID
    },
    timeout: 10000
  });

  const responseData = response.data;

  if (!responseData.successStatus || responseData.responseCode !== '000') {
    throw new Error('Failed to fetch bank list: ' + responseData.message);
  }

  const encryptedData = responseData.data;
  
  let banks;
  try {
    const decrypted = decrypt(encryptedData);
    banks = JSON.parse(decrypted);
    console.log('[VimoPay Payout] Bank list decrypted successfully');
  } catch (e) {
    console.error('[VimoPay Payout] Failed to decrypt bank list:', e.message);
    try {
      banks = JSON.parse(encryptedData);
      console.log('[VimoPay Payout] Bank list parsed directly (no decryption needed)');
    } catch (e2) {
      throw new Error('Bank list decryption failed');
    }
  }

  cachedBankList = banks;
  bankListExpiry = Date.now() + 24 * 60 * 60 * 1000;

  console.log(`[VimoPay Payout] Bank list cached (${banks.length} banks)`);
  return banks;
}

module.exports = { sendDmtTransfer, getStateList, getCityList, getBankList };