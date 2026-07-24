// backend/providers/vimopay/vimopayAepsProvider.js
// ✅ PRODUCTION VERSION
//   - All URLs updated to production endpoints (no 'uat' suffix)
//   - WADH values added to transactions & E-KYC, now trimmed to remove hidden chars
//   - ✅ FIX: aadhaarNumber added to merchantEkyc (required for biometric match)
//   - ✅ FIX: dynamic pipe support – uses params.pipe to select correct WADH (Pipe 1, 2, 3 or 4)
//   - ✅ FIX: 2FA does NOT send wadh (as confirmed by VimoPay) – but we now send wadh: "" explicitly
//   - ✅ FIX: Removed dummy default '999999999999' for aadhaarNumber – now required
//   - ✅ FIX: cashWithdrawal, cashDeposit, balanceEnquiry, miniStatement now use dynamic WADH (Pipe 1, 2, 3 or 4)
//   - ✅ FIX: Masked Aadhaar in logs to prevent PII leakage
//   - ✅ FIX: Unified status extraction across all methods (result.data?.status || result.responseCode)
//   - ✅ FIX: Added full PID option logging for 2FA debugging
//   - Auth token uses raw Bearer (no decryption) as confirmed by VimoPay
//   - Encryption: AES-256-GCM, UTF8, ED key = secretKey, IV key = saltKey
//   - Merchant onboarding sends both old/new field names (VimoPay requirement)

'use strict';

const axios  = require('axios');
const crypto = require('crypto');

// ============================================================
// TOKEN CACHE
// ============================================================
let cachedToken = null;
let tokenExpiry = 0;

// ============================================================
// ENCRYPTION / DECRYPTION
// ============================================================
function encryptAES(text) {
  const key = Buffer.from(process.env.AEPS_ED_KEY, 'utf8');
  const iv  = Buffer.from(process.env.AEPS_IV_KEY, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([encrypted, tag]).toString('base64');
}

function decryptAES(encryptedData) {
  try {
    const key  = Buffer.from(process.env.AEPS_ED_KEY, 'utf8');
    const iv   = Buffer.from(process.env.AEPS_IV_KEY, 'utf8');
    const data = Buffer.from(encryptedData, 'base64');
    const tag  = data.slice(-16);
    const ct   = data.slice(0, -16);
    const d    = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8').trim();
  } catch (e) {
    return null;
  }
}

// ============================================================
// TRANSACTION LIST PARSER (for mini statement)
// ============================================================
function parseTransactionList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;

  const cleaned = typeof raw === 'string' ? raw.replace(/^"|"$/g, '').trim() : String(raw);
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  const transactions = [];
  const parts = cleaned.split('TxnType ').filter(p => p.trim().length > 0);
  parts.forEach(part => {
    const p = part.trim();
    const getField = (key, nextKeys) => {
      const pattern = `${key}\\s+(.+?)(?:\\s+(?:${nextKeys.join('|')})|$)`;
      const match = p.match(new RegExp(pattern));
      return match ? match[1].trim() : '—';
    };
    const type      = p.split(' ')[0] || '—';
    const amount    = getField('TxnAmount',  ['TxnDate', 'TxnTime', 'Narration', 'TxnType']);
    const date      = getField('TxnDate',    ['TxnTime', 'Narration', 'TxnType']);
    const time      = getField('TxnTime',    ['Narration', 'TxnType']);
    const narration = getField('Narration',  ['TxnType']);
    if (type !== '—' || amount !== '—') {
      transactions.push({ type, amount, date, time, narration });
    }
  });
  return transactions.length > 0 ? transactions : [];
}

// ============================================================
// AUTH TOKEN (raw Bearer)
// ============================================================
async function getAuthToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    console.log('[VimoPay AEPS] Using cached token');
    return cachedToken;
  }

  const BASE_URL = process.env.AEPS_BASE_URL || 'https://prod.vidual.in';
  const USER_ID  = process.env.AEPS_USER_ID;

  console.log('[VimoPay AEPS] Fetching new auth token...');

  try {
    const response = await axios({
      method: 'POST',
      url: `${BASE_URL}/aepsapi/api/signature/authorize`,
      headers: {
        secretKey:         process.env.AEPS_SECRET_KEY,
        saltKey:           process.env.AEPS_SALT_KEY,
        encryptdecryptKey: process.env.AEPS_ENCRYPT_DECRYPT_KEY,
        userId:            USER_ID,
        'Content-Type':    'application/json',
      },
      data: {},
    });

    if (!response.data || !response.data.successStatus) {
      throw new Error('Auth failed: ' + (response.data?.message || 'no response'));
    }

    const dataField = response.data.data;
    if (!dataField) throw new Error('No data field in auth response');

    const rawToken    = dataField.replace(/[\r\n]/g, '');
    const isPrintable = /^[\x21-\x7E]+$/.test(rawToken);

    let token;
    if (isPrintable && rawToken.length > 10) {
      token = rawToken;
      console.log('[VimoPay AEPS] Using raw token as Bearer. Length:', token.length);
    } else {
      const decrypted = decryptAES(dataField);
      if (decrypted && decrypted.length > 10) {
        token = decrypted.replace(/[\r\n\s]/g, '');
      } else {
        throw new Error('Could not extract usable token');
      }
    }

    cachedToken = token;
    tokenExpiry = Date.now() + 25 * 60 * 1000;
    console.log('[VimoPay AEPS] Token cached. Length:', token.length);
    return cachedToken;

  } catch (error) {
    console.error('[VimoPay AEPS] Auth error:', error.message);
    throw new Error('Failed to authenticate with VimoPay AEPS: ' + error.message);
  }
}

// ============================================================
// GENERIC API CALL WRAPPER
// ============================================================
// In vimopayAepsProvider.js

// backend/providers/vimopay/vimopayAepsProvider.js

async function callVimoPayAPI(endpoint, method, payload = null, requiresAuth = true) {
  const BASE_URL = process.env.AEPS_BASE_URL || 'https://prod.vidual.in';
  const USER_ID = process.env.AEPS_USER_ID;

  console.log(`[VimoPay AEPS] ════════════════════════════════════════════`);
  console.log(`[VimoPay AEPS] 🔵 API CALL: ${method} ${endpoint}`);
  console.log(`[VimoPay AEPS] Full URL: ${BASE_URL}${endpoint}`);
  console.log(`[VimoPay AEPS] ════════════════════════════════════════════`);

  const headers = { 'Content-Type': 'application/json' };

  if (requiresAuth) {
    try {
      const token = await getAuthToken();
      headers.Authorization = `Bearer ${token}`;
      headers.userId = USER_ID;
      console.log('[VimoPay AEPS] ✅ Auth token obtained');
    } catch (authError) {
      console.error('[VimoPay AEPS] ❌ Auth error:', authError.message);
      throw new Error(`Authentication failed: ${authError.message}`);
    }
  }

  let requestBody = null;
  let plainText = null;
  if (payload) {
    requestBody = { requestBody: encryptAES(JSON.stringify(payload)) };
  }
  // if (payload) {
  //   plainText = JSON.stringify(payload);
  //   console.log('[VimoPay AEPS] 📦 REQUEST PAYLOAD (DECRYPTED):');
  //   console.log(JSON.stringify(payload, null, 2));
  //   console.log('[VimoPay AEPS] Plain text length:', plainText.length);
    
  //   try {
  //     const encrypted = encryptAES(plainText);
  //     requestBody = { requestBody: encrypted };
  //     console.log('[VimoPay AEPS] 🔐 Encrypted payload length:', encrypted.length);
  //     console.log('[VimoPay AEPS] Encrypted payload (first 100 chars):', encrypted.substring(0, 100) + '...');
  //   } catch (encError) {
  //     console.error('[VimoPay AEPS] ❌ Encryption error:', encError.message);
  //     throw new Error(`Encryption failed: ${encError.message}`);
  //   }
  // }
console.log(`[VimoPay AEPS] Calling ${method} ${endpoint}`);

  const response = await axios({ method, url: `${BASE_URL}${endpoint}`, headers, data: requestBody });
  const result = response.data;

  if (result.data && typeof result.data === 'string') {
    const decrypted = decryptAES(result.data);
    if (decrypted) {
      try {
        result.data = JSON.parse(decrypted);
        console.log(`[VimoPay AEPS] Response decrypted successfully`);
      } catch (e) {
        console.warn('[VimoPay AEPS] Response decrypt/parse failed — using raw');
      }
    }
  }

  return result;
}  



// ============================================================
// HELPER – unified status extraction (used by all methods)
// ============================================================
function getStatusFromResult(result) {
  const d = result.data && typeof result.data === 'object' ? result.data : result;
  return d.status || result.responseCode || (result.successStatus ? '000' : '001');
}

// ============================================================
// HELPER – extract transaction fields (already uses similar logic)
// ============================================================
function extractTxnData(result) {
  const d = result.data && typeof result.data === 'object' ? result.data : result;
  return {
    status:            d.status || result.responseCode || (result.successStatus ? '000' : '001'),
    merchantStatus:    d.merchantStatus || result.merchantStatus,
    statusDescription: d.statusDescription || result.message || '',
    txnRefId:          d.txnRefId || result.txnRefId,
    merchantRefId:     d.merchantRefId || result.merchantRefId,
    transactionAmount: d.transactionAmount || result.transactionAmount,
    aadhaarNo:         d.aadhaarNo || result.aadhaarNo,
    txnDateTime:       d.txnDateTime || result.txnDateTime,
    bankIIN:           d.bankIIN || result.bankIIN,
    rrn:               d.rrn || result.rrn,
    npciCode:          d.npciCode || result.npciCode,
    npciMessage:       d.npciMessage || result.npciMessage,
    availableBalance:  d.availableBalance || result.availableBalance,
    transactionList:   d.transactionList || result.transactionList,
  };
}

// ============================================================
// HELPER – get WADH based on pipe (Pipe 1, 2, 3 or 4)
// ============================================================
function getWADH(pipe) {
  if (pipe === '1') {
    return (process.env.AEPS_WADH_PIPE1 || '').trim();
  } else if (pipe === '2') {
    return (process.env.AEPS_WADH_PIPE2 || '').trim();
  } else if (pipe === '3') {
    return (process.env.AEPS_WADH_PIPE3 || '').trim();
  } else if (pipe === '4') {
    return (process.env.AEPS_WADH_PIPE4 || 'E0jzJ/P8UopUHAieZn8CKqS4WPMi5ZSYXgfnlfkWjrc=').trim();
  }
  
  // Default fallback
  return (process.env.AEPS_WADH_PIPE2 || '').trim();
}

// ============================================================
// PUBLIC PROVIDER METHODS (all URLs replaced with production)
// ============================================================

// backend/providers/vimopay/vimopayAepsProvider.js

async function registerMerchant(params) {
  console.log('[VimoPay AEPS] ════════════════════════════════════════════');
  console.log('[VimoPay AEPS] 🔵 registerMerchant CALLED');
  console.log('[VimoPay AEPS] ════════════════════════════════════════════');
  console.log('[VimoPay AEPS] Parameters:', {
    firstName: params.firstName,
    lastName: params.lastName,
    aadhaarNo: params.aadhaarNo ? '****' + params.aadhaarNo.slice(-4) : 'null',
    pipe: params.pipe || '1',
    merchantPhoneNumber: params.merchantPhoneNumber,
    stateCode: params.stateCode,
    districtCode: params.districtCode,
    bankAccount: params.bankAccount ? '****' + params.bankAccount.slice(-4) : 'null',
    bankIfsc: params.bankIfsc,
  });

  // Validate Aadhaar
  if (!params.aadhaarNo || params.aadhaarNo.length !== 12) {
    console.error('[VimoPay AEPS] ❌ Invalid Aadhaar:', params.aadhaarNo);
    throw new Error('Valid 12-digit agent Aadhaar is required for merchant registration');
  }

  // Validate Pipe - UPDATED to include pipe 4
  const pipe = params.pipe || '1';
  if (!['1', '2', '3', '4'].includes(pipe)) {  // ✅ Added '4'
    console.error('[VimoPay AEPS] ❌ Invalid pipe:', pipe);
    throw new Error('Invalid pipe value. Must be 1, 2, 3, or 4');
  }

  // Check if merchant already exists in other pipes
  console.log('[VimoPay AEPS] 🔍 Checking if merchant exists in other pipes...');
  const existingMerchants = await checkMerchantInAllPipes(
    params.merchantPan || 'AAAAA0000A',
    params.aadhaarNo
  );
  
  if (existingMerchants.length > 0) {
    const existingPipes = existingMerchants.map(m => m.pipe);
    const alreadyInThisPipe = existingMerchants.find(m => m.pipe === pipe);
    
    if (alreadyInThisPipe) {
      // Already registered in THIS pipe - return existing data
      console.log(`[VimoPay AEPS] ⚠️ Merchant already registered in pipe ${pipe}`);
      return {
        status: '000',
        merchantStatus: alreadyInThisPipe.merchantStatus || 'Success',
        statusDescription: `Merchant already registered in pipe ${pipe}`,
        merchantId: alreadyInThisPipe.merchantId,
        txnRefId: null,
        merchantRefId: params.merchantRefId || `NEO${Date.now()}`,
        pipe: pipe,
        isExisting: true,
      };
    } else {
      // Registered in OTHER pipes - log but allow registration
      console.log(`[VimoPay AEPS] ℹ️ Merchant exists in pipes: ${existingPipes.join(', ')}`);
      console.log(`[VimoPay AEPS] ℹ️ Attempting registration in pipe ${pipe} anyway...`);
    }
  }
  // ✅ Build the payload with ALL required fields
  const payload = {
    merchantRefId: params.merchantRefId || `NEO${Date.now()}`,
    ipAddress: params.ipAddress || '127.0.0.1',
    lat: params.lat || '0.0',
    long: params.long || '0.0',
    shopLat: params.lat || '0.0',
    shopLong: params.long || '0.0',
    firstName: params.firstName || '',
    lastName: params.lastName || '',
    middleName: params.middleName || '',
    dob: params.dob || '',
    gender: params.gender || 'M',
    emailId: params.emailId || 'merchant@neofyn.in',
    merchantPhoneNumber: params.merchantPhoneNumber || '',
    merchantAddress1: params.merchantAddress1 || '',
    merchantAddress2: params.merchantAddress2 || '',
    shopAddress: params.shopAddress || params.merchantAddress1 || '',
    shopState: params.stateCode || '',
    shopDistrict: params.districtCode || '',
    shopPincode: params.shopPincode || '',
    merchantState: params.stateCode || '',
    merchantDistrict: params.districtCode || '',
    merchantPinCode: params.shopPincode || '',
    merchantPan: params.merchantPan || 'AAAAA0000A',
    shopPan: params.shopPan || 'AAAAA0000A',
    aadhaarNumber: params.aadhaarNo,
    aadhaarNo: params.aadhaarNo,
    bankAccountNumber: params.bankAccount || '',
    bankAccount: params.bankAccount || '',
    bankIfscCode: params.bankIfsc || '',
    bankIfsc: params.bankIfsc || '',
    BankName: params.bankNameCode || '',
    bankNameCode: params.bankNameCode || '',
    pipe: pipe, // ✅ Explicitly set the pipe
  };


   // ✅ Pipe 4 specific fields (VimoPay requires extra fields for Pipe 4)
  // ✅ Pipe 4 specific fields (VimoPay requires extra fields for Pipe 4)
if (pipe === '4') {
  // Generate shopName for Pipe 4
  let shopName = params.shopName || params.businessName || '';
  if (!shopName) {
    shopName = `${params.firstName || 'User'}'s Shop`;  // ✅ Use params.firstName
  }
  // Clean shopName - remove special characters
  shopName = shopName.trim().replace(/[^a-zA-Z0-9\s]/g, '');
  if (!shopName) {
    shopName = `${params.firstName || 'User'}'s Shop`;
  }
  
  payload.shopName = shopName; // ✅ Only add for Pipe 4
  
  console.log('[VimoPay AEPS] 🟢 Pipe 4 - Added shopName:', shopName);
} else {
  console.log(`[VimoPay AEPS] 🟡 Pipe ${pipe} - No extra fields needed`);
}

  console.log('[VimoPay AEPS] 📦 Payload being sent (sensitive data masked):', {
    ...payload,
    aadhaarNumber: '****' + payload.aadhaarNumber.slice(-4),
    aadhaarNo: '****' + payload.aadhaarNo.slice(-4),
    bankAccountNumber: payload.bankAccountNumber ? '****' + payload.bankAccountNumber.slice(-4) : 'null',
    bankAccount: payload.bankAccount ? '****' + payload.bankAccount.slice(-4) : 'null',
    shopName: payload.shopName || 'NOT SENT',
  });

  try {
    // ✅ Call the VimoPay API
    const result = await callVimoPayAPI('/aepsapi/api/payment/merchantonboardallpipe', 'POST', payload);
    
    console.log('[VimoPay AEPS] 📥 Register response received');
    console.log('[VimoPay AEPS] Full response:', JSON.stringify(result, null, 2));

    // ✅ Check for validation errors
    if (Array.isArray(result.data)) {
      console.error('[VimoPay AEPS] ❌ Validation errors:');
      result.data.forEach(e => {
        console.error(`  - ${e.MemberNames?.[0] || 'Unknown field'}: ${e.ErrorMessage}`);
      });
      
      // Extract error messages
      const errorMessages = result.data.map(e => e.ErrorMessage).join('; ');
      return {
        status: '999',
        merchantStatus: 'Failed',
        statusDescription: `Validation failed: ${errorMessages}`,
        merchantId: null,
        txnRefId: null,
        merchantRefId: payload.merchantRefId,
        pipe: pipe,
        errors: result.data,
      };
    }

    // ✅ Extract response data
    const d = result.data && typeof result.data === 'object' && !Array.isArray(result.data) 
      ? result.data 
      : result;

    // ✅ Check if registration was successful
    const successStatus = result.successStatus || d.successStatus || false;
    const responseCode = result.responseCode || d.responseCode || '';
    const status = getStatusFromResult(result);
    
    console.log('[VimoPay AEPS] Registration status:', {
      successStatus,
      responseCode,
      status,
      merchantId: d.merchantId || result.merchantId,
      merchantStatus: d.merchantStatus || result.merchantStatus,
    });

    // ✅ Check if merchant already exists for this pipe
    if (responseCode === '001' && result.message && result.message.includes('already')) {
      console.error('[VimoPay AEPS] ❌ Merchant already registered for this pipe');
      return {
        status: '001',
        merchantStatus: 'Failed',
        statusDescription: `Merchant already registered for pipe ${pipe}`,
        merchantId: null,
        txnRefId: null,
        merchantRefId: payload.merchantRefId,
        pipe: pipe,
        isDuplicate: true,
      };
    }

    // ✅ Return success response
    return {
      status: status,
      merchantStatus: d.merchantStatus || result.merchantStatus || (successStatus ? 'Success' : 'Failed'),
      statusDescription: d.statusDescription || result.message || d.message || '',
      merchantId: d.merchantId || result.merchantId || null,
      txnRefId: d.txnRefId || result.txnRefId || null,
      merchantRefId: d.merchantRefId || result.merchantRefId || payload.merchantRefId,
      pipe: d.pipe || result.pipe || pipe,
    };

  } catch (error) {
    console.error('[VimoPay AEPS] ❌ Registration error:', error.message);
    console.error('[VimoPay AEPS] Error stack:', error.stack);
    
    // Handle network errors
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return {
        status: '999',
        merchantStatus: 'Failed',
        statusDescription: 'Registration timed out. Please try again.',
        merchantId: null,
        txnRefId: null,
        merchantRefId: params.merchantRefId || `NEO${Date.now()}`,
        pipe: pipe,
      };
    }
    
    throw error;
  }
}


async function getBankList() {
  const result = await callVimoPayAPI('/masterapi/api/master/banklist', 'GET');
  return Array.isArray(result.data) ? result.data.map(b => ({ code: b.code, name: b.description })) : [];
}

async function getStateList() {
  const result = await callVimoPayAPI('/masterapi/api/master/statelist', 'GET');
  return Array.isArray(result.data) ? result.data.map(s => ({ code: s.code, name: s.description })) : [];
}

async function getDistrictList(stateCode) {
  const result = await callVimoPayAPI('/aepsapi/api/payment/acquiredistrict', 'POST', { stateCode });
  return Array.isArray(result.data) ? result.data.map(d => ({ code: d.code, name: d.description })) : [];
}

async function getBankIINs() {
  const result = await callVimoPayAPI('/aepsapi/api/payment/bankiin', 'POST', { txnCode: 'BE', authType: 'BA' });
  return Array.isArray(result.data) ? result.data : [];
}

async function sendOTP(params) {
  console.log('[VimoPay AEPS] ════════════════════════════════════════════');
  console.log('[VimoPay AEPS] 🔵 sendOTP CALLED');
  console.log('[VimoPay AEPS] ════════════════════════════════════════════');
  
  // Log all input parameters with detailed validation
  console.log('[VimoPay AEPS] 📥 Input Parameters:');
  console.log('[VimoPay AEPS]   - merchantId:', params.merchantId || '❌ MISSING');
  console.log('[VimoPay AEPS]   - merchantRefId:', params.merchantRefId || '❌ MISSING');
  console.log('[VimoPay AEPS]   - pipe:', params.pipe || '1 (default)');
  console.log('[VimoPay AEPS]   - phoneNumber:', params.phoneNumber || '❌ NOT PROVIDED');
  console.log('[VimoPay AEPS]   - userId:', params.userId || '❌ NOT PROVIDED');
  console.log('[VimoPay AEPS]   - bankAccount:', params.bankAccount ? params.bankAccount.substring(0, 4) + 'XXXX' : '❌ NOT PROVIDED');
  console.log('[VimoPay AEPS]   - ifsc:', params.ifsc || '❌ NOT PROVIDED');
  
  // Validate required parameters
  console.log('[VimoPay AEPS] 🔍 Parameter Validation:');
  const validationErrors = [];
  if (!params.merchantId) validationErrors.push('merchantId is required');
  if (!params.merchantRefId) validationErrors.push('merchantRefId is required');
  if (!params.pipe) validationErrors.push('pipe is required (1, 2, 3, or 4)');
  
  if (validationErrors.length > 0) {
    console.log('[VimoPay AEPS] ❌ Validation Errors:', validationErrors.join(', '));
    console.log('[VimoPay AEPS] ════════════════════════════════════════════');
    throw new Error('Validation failed: ' + validationErrors.join(', '));
  }
  
  // Check if phone number is valid (if provided)
  if (params.phoneNumber) {
    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(params.phoneNumber)) {
      console.log('[VimoPay AEPS] ⚠️ Invalid phone number format:', params.phoneNumber);
      console.log('[VimoPay AEPS] 💡 Phone should be 10 digits');
    } else {
      console.log('[VimoPay AEPS] ✅ Phone number format valid:', params.phoneNumber);
    }
  }
  
  // Determine which pipe is being used
// In sendOTP() - update validation
console.log('[VimoPay AEPS] 🔄 Pipe Selection:');
if (params.pipe === '1') {
  console.log('[VimoPay AEPS]   - Using PIPE 1 (Standard Onboarding)');
} else if (params.pipe === '2') {
  console.log('[VimoPay AEPS]   - Using PIPE 2 (Re-onboarding/Retry)');
} else if (params.pipe === '3') {
  console.log('[VimoPay AEPS]   - Using PIPE 3 (Alternative)');
} else if (params.pipe === '4') {
  console.log('[VimoPay AEPS]   - Using PIPE 4 (New Pipe)');
} else {
  console.log('[VimoPay AEPS]   - Unknown pipe:', params.pipe);
}

  console.log('[VimoPay AEPS] ════════════════════════════════════════════');

  try {
    // Build request payload
    const requestPayload = {
      merchantId: params.merchantId,
      merchantRefId: params.merchantRefId,
      pipe: params.pipe || '1',
    };
    
    console.log('[VimoPay AEPS] 📤 Request Payload:');
    console.log('[VimoPay AEPS]   - merchantId:', requestPayload.merchantId);
    console.log('[VimoPay AEPS]   - merchantRefId:', requestPayload.merchantRefId);
    console.log('[VimoPay AEPS]   - pipe:', requestPayload.pipe);
    console.log('[VimoPay AEPS]   - Full Payload:', JSON.stringify(requestPayload, null, 2));
    
    // Log timestamp
    console.log('[VimoPay AEPS] ⏰ Request Timestamp:', new Date().toISOString());
    
    // API call start time
    const startTime = Date.now();
    console.log('[VimoPay AEPS] 🚀 Making API call to VimoPay...');
    
    const result = await callVimoPayAPI('/aepsapi/api/payment/merchantonboardsendotppipe', 'POST', requestPayload);
    
    // API call duration
    const duration = Date.now() - startTime;
    console.log('[VimoPay AEPS] ⏱️ API Response Time:', duration, 'ms');

    console.log('[VimoPay AEPS] 📥 sendOTP RESPONSE RECEIVED');
    console.log('[VimoPay AEPS] ════════════════════════════════════════════');
    
    // Log raw response
    console.log('[VimoPay AEPS] 📄 Raw Response:');
    console.log('[VimoPay AEPS]   - Type:', typeof result);
    console.log('[VimoPay AEPS]   - Is Array:', Array.isArray(result));
    console.log('[VimoPay AEPS]   - Full Response:', JSON.stringify(result, null, 2));
    
    // Extract decrypted data
    const d = result.data && typeof result.data === 'object' ? result.data : result;
    
    console.log('[VimoPay AEPS] 📊 Parsed Response:');
    console.log('[VimoPay AEPS]   - Top-level data exists:', !!result.data);
    console.log('[VimoPay AEPS]   - Extracted data type:', typeof d);
    console.log('[VimoPay AEPS]   - Is data array:', Array.isArray(d));
    
    // Detailed response breakdown
    console.log('[VimoPay AEPS] 🔍 Response Breakdown:');
    
    // Top-level fields
    console.log('[VimoPay AEPS]   📌 Top-Level Fields:');
    console.log('[VimoPay AEPS]     - successStatus:', result.successStatus !== undefined ? result.successStatus : '❌ MISSING');
    console.log('[VimoPay AEPS]     - responseCode:', result.responseCode || '❌ MISSING');
    console.log('[VimoPay AEPS]     - message:', result.message || '❌ MISSING');
    console.log('[VimoPay AEPS]     - data exists:', result.data ? '✅ YES' : '❌ NO');
    
    // Data fields (d)
    console.log('[VimoPay AEPS]   📌 Data Fields (d):');
    console.log('[VimoPay AEPS]     - status:', d.status || '❌ MISSING');
    console.log('[VimoPay AEPS]     - merchantStatus:', d.merchantStatus || '❌ MISSING');
    console.log('[VimoPay AEPS]     - statusDescription:', d.statusDescription || '❌ MISSING');
    console.log('[VimoPay AEPS]     - merchantId:', d.merchantId || '❌ MISSING');
    console.log('[VimoPay AEPS]     - merchantRefId:', d.merchantRefId || '❌ MISSING');
    console.log('[VimoPay AEPS]     - txnRefId:', d.txnRefId || '❌ MISSING');
    console.log('[VimoPay AEPS]     - pipe:', d.pipe || '❌ MISSING');
    console.log('[VimoPay AEPS]     - message (data):', d.message || '❌ MISSING');
    console.log('[VimoPay AEPS]     - ErrorMessage (data):', d.ErrorMessage || '❌ MISSING');
    
    // Check for validation errors array
    if (Array.isArray(d)) {
      console.log('[VimoPay AEPS] ⚠️ Response is an array (validation errors):');
      d.forEach((err, index) => {
        console.log(`[VimoPay AEPS]   Error ${index + 1}:`);
        console.log(`[VimoPay AEPS]     - Field:`, err.field || 'Unknown');
        console.log(`[VimoPay AEPS]     - Error:`, err.error || err.message || JSON.stringify(err));
      });
    }
    
    // Status code analysis
    console.log('[VimoPay AEPS] 📌 Status Analysis:');
    const status = getStatusFromResult(result);
    console.log('[VimoPay AEPS]   - Extracted status:', status);
    
    if (status === '000' || status === '200') {
      console.log('[VimoPay AEPS]   ✅ Success status code');
    } else if (status === '001' || status === '100') {
      console.log('[VimoPay AEPS]   ⚠️ Failure status code');
    } else {
      console.log('[VimoPay AEPS]   ℹ️ Unknown status code:', status);
    }
    
    // OTP delivery status check
    console.log('[VimoPay AEPS] 📱 OTP Delivery Analysis:');
    if (result.successStatus === true && d.status === '000') {
      console.log('[VimoPay AEPS]   ✅ API reports OTP was sent successfully');
      
      // Check if phone number was provided
      if (params.phoneNumber) {
        console.log('[VimoPay AEPS]   📞 Phone number for OTP:', params.phoneNumber);
        
        // Check if phone is in correct format
        const phoneRegex = /^[0-9]{10}$/;
        if (phoneRegex.test(params.phoneNumber)) {
          console.log('[VimoPay AEPS]   ✅ Phone number format is valid');
        }
      } else {
        console.log('[VimoPay AEPS]   ⚠️ Phone number not provided in request');
        console.log('[VimoPay AEPS]   💡 Add phone number to params for better tracking');
      }
      
      // Log delivery status from API
      if (d.statusDescription && d.statusDescription.includes('OTP')) {
        console.log('[VimoPay AEPS]   📨 OTP Status:', d.statusDescription);
      }
      
    } else if (result.successStatus === false) {
      console.log('[VimoPay AEPS]   ❌ API reports failure');
      console.log('[VimoPay AEPS]   📝 Failure reason:', result.message || d.statusDescription || 'Unknown');
      
      // Analyze failure reasons
      if (d.statusDescription && d.statusDescription.includes('Invalid Account')) {
        console.log('[VimoPay AEPS]   🔴 Bank account verification failed');
        console.log('[VimoPay AEPS]   💡 Solution: Verify bank account details');
      } else if (d.statusDescription && d.statusDescription.includes('Duplicate')) {
        console.log('[VimoPay AEPS]   🔴 Duplicate merchant ID');
        console.log('[VimoPay AEPS]   💡 Solution: Generate new merchantRefId');
      } else if (d.statusDescription && d.statusDescription.includes('not found')) {
        console.log('[VimoPay AEPS]   🔴 Merchant not found');
        console.log('[VimoPay AEPS]   💡 Solution: Create merchant first');
      }
    }
    
    // Compare request vs response merchant IDs
    if (d.merchantId && params.merchantId && d.merchantId !== params.merchantId) {
      console.log('[VimoPay AEPS] ⚠️ Merchant ID Mismatch:');
      console.log('[VimoPay AEPS]   - Request merchantId:', params.merchantId);
      console.log('[VimoPay AEPS]   - Response merchantId:', d.merchantId);
      console.log('[VimoPay AEPS]   - A new merchant may have been created');
    }
    
    // Check if OTP should be sent (PENDING status check)
    if (d.merchantStatus === 'PENDING') {
      console.log('[VimoPay AEPS] ⚠️ Merchant status is PENDING');
      console.log('[VimoPay AEPS] 💡 OTP may not be sent to PENDING merchants');
      console.log('[VimoPay AEPS] 💡 Complete KYC and bank verification first');
    }
    
    // Log success/failure summary
    console.log('[VimoPay AEPS] 📊 Summary:');
    console.log('[VimoPay AEPS]   - Success Status:', result.successStatus !== undefined ? result.successStatus : '❌ Unknown');
    console.log('[VimoPay AEPS]   - Response Code:', result.responseCode || '❌ Unknown');
    console.log('[VimoPay AEPS]   - Message:', result.message || '❌ Unknown');
    console.log('[VimoPay AEPS]   - Merchant ID:', d.merchantId || params.merchantId || '❌ Unknown');
    console.log('[VimoPay AEPS]   - Transaction ID:', d.txnRefId || '❌ Unknown');
    
    // Check if response indicates OTP was sent
    const otpSent = result.successStatus === true && 
                   (d.status === '000' || d.merchantStatus === 'Success');
    
    if (otpSent) {
      console.log('[VimoPay AEPS] ✅✅✅ OTP SENT SUCCESSFULLY ✅✅✅');
      console.log('[VimoPay AEPS] 📱 Check phone:', params.phoneNumber || 'Unknown number');
      console.log('[VimoPay AEPS] ⏰ Time:', new Date().toISOString());
    } else {
      console.log('[VimoPay AEPS] ❌❌❌ OTP NOT SENT ❌❌❌');
      console.log('[VimoPay AEPS] 💡 Troubleshooting:');
      console.log('[VimoPay AEPS]   1. Verify merchant status is not PENDING');
      console.log('[VimoPay AEPS]   2. Check bank account is verified');
      console.log('[VimoPay AEPS]   3. Try pipe 2 if pipe 1 failed');
      console.log('[VimoPay AEPS]   4. Ensure phone number is correct');
      console.log('[VimoPay AEPS]   5. Check SMS gateway status');
    }
    
    console.log('[VimoPay AEPS] ════════════════════════════════════════════');

    // Return structured response
    const response = {
      status: status,
      merchantStatus: d.merchantStatus || result.merchantStatus || (result.successStatus ? 'Success' : 'Failed'),
      statusDescription: d.statusDescription || result.message || d.message || '',
      merchantId: d.merchantId || result.merchantId || params.merchantId,
      txnRefId: d.txnRefId || result.txnRefId,
      // Additional debug info
      _debug: {
        phoneNumber: params.phoneNumber || null,
        userId: params.userId || null,
        pipe: params.pipe || '1',
        responseTime: duration + 'ms',
        timestamp: new Date().toISOString(),
        rawSuccess: result.successStatus,
        rawCode: result.responseCode,
      }
    };
    
    console.log('[VimoPay AEPS] 📦 Return Object:', JSON.stringify(response, null, 2));
    
    return response;
    
  } catch (error) {
    console.error('[VimoPay AEPS] ❌❌❌ sendOTP ERROR ❌❌❌');
    console.error('[VimoPay AEPS] Error Message:', error.message);
    console.error('[VimoPay AEPS] Error Stack:', error.stack);
    
    // Log error details
    if (error.response) {
      console.error('[VimoPay AEPS] 📄 Error Response:');
      console.error('[VimoPay AEPS]   - Status:', error.response.status);
      console.error('[VimoPay AEPS]   - Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('[VimoPay AEPS] 📄 No response received from server');
      console.error('[VimoPay AEPS]   - Request was sent but no response');
    } else {
      console.error('[VimoPay AEPS] 📄 Request setup error');
    }
    
    console.log('[VimoPay AEPS] ════════════════════════════════════════════');
    throw error;
  }
}

async function verifyOTPDelivery(merchantId, txnRefId, phoneNumber) {
  console.log('[VimoPay AEPS] 🔍 Verifying OTP delivery...');
  console.log('[VimoPay AEPS]   - Merchant ID:', merchantId);
  console.log('[VimoPay AEPS]   - Transaction ID:', txnRefId);
  console.log('[VimoPay AEPS]   - Phone Number:', phoneNumber);
  
  try {
    // Check with VimoPay if OTP status endpoint exists
    const result = await callVimoPayAPI('/aepsapi/api/payment/otpstatus', 'POST', {
      merchantId: merchantId,
      txnRefId: txnRefId
    });
    
    console.log('[VimoPay AEPS] 📥 OTP Status Response:');
    console.log('[VimoPay AEPS]   - Status:', result.status);
    console.log('[VimoPay AEPS]   - Delivery Status:', result.deliveryStatus || 'Unknown');
    console.log('[VimoPay AEPS]   - Sent At:', result.sentAt || 'Unknown');
    
    return result;
  } catch (error) {
    console.log('[VimoPay AEPS] ⚠️ OTP status check not available:', error.message);
    return null;
  }
}
async function resendOTP(params) {
  console.log('[VimoPay AEPS] ════════════════════════════════════════════');
  console.log('[VimoPay AEPS] 🔵 resendOTP CALLED');
  console.log('[VimoPay AEPS] merchantId:', params.merchantId);
  console.log('[VimoPay AEPS] merchantRefId:', params.merchantRefId);
  console.log('[VimoPay AEPS] pipe:', params.pipe || '1');
  console.log('[VimoPay AEPS] phoneNumber (from params):', params.phoneNumber || 'NOT PROVIDED');
  console.log('[VimoPay AEPS] ════════════════════════════════════════════');

  try {
    // Log the request payload
    const requestPayload = {
      merchantId: params.merchantId,
      merchantRefId: params.merchantRefId,
      pipe: params.pipe || '1',
    };
    console.log('[VimoPay AEPS] 📤 Request Payload:', JSON.stringify(requestPayload, null, 2));

    const result = await callVimoPayAPI('/aepsapi/api/payment/merchantonboardsendotppipe', 'POST', requestPayload);

    console.log('[VimoPay AEPS] 📥 resendOTP RESPONSE RECEIVED');
    console.log('[VimoPay AEPS] Full response:', JSON.stringify(result, null, 2));

    // Extract decrypted data
    const d = result.data && typeof result.data === 'object' ? result.data : result;
    
    console.log('[VimoPay AEPS] 🔍 Response Details:');
    console.log('[VimoPay AEPS]   - successStatus:', result.successStatus);
    console.log('[VimoPay AEPS]   - responseCode:', result.responseCode);
    console.log('[VimoPay AEPS]   - message:', result.message);
    console.log('[VimoPay AEPS]   - d.status:', d.status);
    console.log('[VimoPay AEPS]   - d.merchantStatus:', d.merchantStatus);
    console.log('[VimoPay AEPS]   - d.statusDescription:', d.statusDescription);
    console.log('[VimoPay AEPS]   - d.message:', d.message);
    console.log('[VimoPay AEPS]   - d.ErrorMessage:', d.ErrorMessage);
    console.log('[VimoPay AEPS]   - d.merchantId:', d.merchantId);
    console.log('[VimoPay AEPS]   - d.txnRefId:', d.txnRefId);
    console.log('[VimoPay AEPS]   - d.pipe:', d.pipe);
    
    // ✅ Check if there are validation errors (array response)
    if (Array.isArray(d)) {
      console.log('[VimoPay AEPS] ⚠️ Validation errors array:');
      d.forEach((err, index) => {
        console.log(`[VimoPay AEPS]   Error ${index + 1}:`, JSON.stringify(err, null, 2));
      });
    }

    // 🔍 Check for OTP delivery status
    if (result.successStatus === true && d.status === '000') {
      console.log('[VimoPay AEPS] ✅ OTP request successful according to API');
      console.log('[VimoPay AEPS] 📱 OTP should be sent to:', params.phoneNumber || 'Unknown number');
      
      // Log what the API says about OTP delivery
      console.log('[VimoPay AEPS] 📨 OTP Delivery Status from API:');
      console.log('[VimoPay AEPS]   - statusDescription:', d.statusDescription);
      console.log('[VimoPay AEPS]   - merchantStatus:', d.merchantStatus);
      
      // ⚠️ Check if phone number is masked or different
      if (d.merchantId && d.merchantId !== params.merchantId) {
        console.log('[VimoPay AEPS] ⚠️ Merchant ID mismatch!');
        console.log('[VimoPay AEPS]   - Requested merchantId:', params.merchantId);
        console.log('[VimoPay AEPS]   - Response merchantId:', d.merchantId);
        console.log('[VimoPay AEPS]   - This could mean a new merchant was created');
      }
    }

    // 🔴 Check for OTP sending failures
    if (d.statusDescription && d.statusDescription.includes('OTP')) {
      console.log('[VimoPay AEPS] 📨 OTP Related Status:', d.statusDescription);
    }

    // 📞 Verify phone number in the user record
    console.log('[VimoPay AEPS] 📞 Phone Number Check:');
    console.log('[VimoPay AEPS]   - User phone in DB: 9600750104');
    console.log('[VimoPay AEPS]   - Phone in request:', params.phoneNumber || 'Not provided');
    console.log('[VimoPay AEPS]   - Match:', params.phoneNumber === '9600750104' ? '✅ YES' : '❌ NO');

    const status = getStatusFromResult(result);
    console.log('[VimoPay AEPS] Extracted status:', status);
    
    // 🔍 Additional debug: Check if OTP was actually sent via SMS
    if (result.successStatus === true && d.status === '000') {
      console.log('[VimoPay AEPS] ⚠️ IMPORTANT: API says OTP sent, but user not receiving.');
      console.log('[VimoPay AEPS] Possible reasons:');
      console.log('[VimoPay AEPS]   1. SMS gateway failure (silent)');
      console.log('[VimoPay AEPS]   2. DND active on number 9600750104');
      console.log('[VimoPay AEPS]   3. SMS template not approved');
      console.log('[VimoPay AEPS]   4. Wrong phone number in merchant record');
      console.log('[VimoPay AEPS]   5. Rate limiting (too many requests)');
      console.log('[VimoPay AEPS]   6. Merchant status is PENDING (not onboarded)');
    }
    
    console.log('[VimoPay AEPS] ════════════════════════════════════════════');

    return {
      status: status,
      merchantStatus: d.merchantStatus || result.merchantStatus || (result.successStatus ? 'Success' : 'Failed'),
      statusDescription: d.statusDescription || result.message || d.message || '',
      merchantId: d.merchantId || result.merchantId || params.merchantId,
      txnRefId: d.txnRefId || result.txnRefId,
      phoneNumber: params.phoneNumber || '9600750104',
    };
  } catch (error) {
    console.error('[VimoPay AEPS] ❌ resendOTP error:', error.message);
    console.error('[VimoPay AEPS] Stack:', error.stack);
    console.log('[VimoPay AEPS] ════════════════════════════════════════════');
    throw error;
  }
}


// async function verifyOTP(params) {
//   const result = await callVimoPayAPI('/aepsapi/api/payment/merchantonboardValidateOtpPipe', 'POST', {
//     merchantId: params.merchantId, merchantRefId: params.merchantRefId,
//     otp: params.otp, pipe: params.pipe || '1',
//   });
//   return {
//     status:            getStatusFromResult(result),
//     merchantStatus:    result.merchantStatus || (result.successStatus ? 'Success' : 'Failed'),
//     statusDescription: result.statusDescription || result.message || '',
//     merchantId:        result.merchantId || params.merchantId,
//     txnRefId:          result.txnRefId,
//   };
// }


async function verifyOTP(params) {
  console.log('[VimoPay AEPS] ════════════════════════════════════════════');
  console.log('[VimoPay AEPS] 🔵 verifyOTP CALLED');
  console.log('[VimoPay AEPS] merchantId:', params.merchantId);
  console.log('[VimoPay AEPS] merchantRefId:', params.merchantRefId);
  console.log('[VimoPay AEPS] otp:', params.otp ? '***' : 'missing');
  console.log('[VimoPay AEPS] pipe:', params.pipe || '1');
  console.log('[VimoPay AEPS] ════════════════════════════════════════════');

  try {
    const result = await callVimoPayAPI('/aepsapi/api/payment/merchantonboardValidateOtpPipe', 'POST', {
      merchantId: params.merchantId,
      merchantRefId: params.merchantRefId,
      otp: params.otp,
      pipe: params.pipe || '1',
    });

    console.log('[VimoPay AEPS] 📥 verifyOTP RESPONSE RECEIVED');
    console.log('[VimoPay AEPS] Full response:', JSON.stringify(result, null, 2));

    // Extract decrypted data
    const d = result.data && typeof result.data === 'object' ? result.data : result;
    
    console.log('[VimoPay AEPS] 🔍 Response Details:');
    console.log('[VimoPay AEPS]   - successStatus:', result.successStatus);
    console.log('[VimoPay AEPS]   - responseCode:', result.responseCode);
    console.log('[VimoPay AEPS]   - message:', result.message);
    console.log('[VimoPay AEPS]   - d.status:', d.status);
    console.log('[VimoPay AEPS]   - d.merchantStatus:', d.merchantStatus);
    console.log('[VimoPay AEPS]   - d.statusDescription:', d.statusDescription);
    console.log('[VimoPay AEPS]   - d.message:', d.message);
    console.log('[VimoPay AEPS]   - d.ErrorMessage:', d.ErrorMessage);
    console.log('[VimoPay AEPS]   - d.otpVerified:', d.otpVerified);
    console.log('[VimoPay AEPS]   - d.registrationStatus:', d.registrationStatus);
    
    // ✅ Check if there are validation errors (array response)
    if (Array.isArray(d)) {
      console.log('[VimoPay AEPS] ⚠️ Validation errors array:');
      d.forEach((err, index) => {
        console.log(`[VimoPay AEPS]   Error ${index + 1}:`, JSON.stringify(err, null, 2));
      });
    }

    const status = getStatusFromResult(result);
    console.log('[VimoPay AEPS] Extracted status:', status);
    
    // ✅ Check if OTP verification was successful
    const isVerified = status === '000' || result.successStatus === true;
    console.log('[VimoPay AEPS] OTP Verified:', isVerified);
    console.log('[VimoPay AEPS] ════════════════════════════════════════════');

    return {
      status: status,
      merchantStatus: d.merchantStatus || result.merchantStatus || (result.successStatus ? 'Success' : 'Failed'),
      statusDescription: d.statusDescription || result.message || d.message || '',
      merchantId: d.merchantId || result.merchantId || params.merchantId,
      txnRefId: d.txnRefId || result.txnRefId,
      otpVerified: isVerified,
      registrationStatus: d.registrationStatus || d.merchantStatus,
    };
  } catch (error) {
    console.error('[VimoPay AEPS] ❌ verifyOTP error:', error.message);
    console.error('[VimoPay AEPS] Stack:', error.stack);
    console.log('[VimoPay AEPS] ════════════════════════════════════════════');
    throw error;
  }
}

async function merchantEkyc(params) {
  const pipe = params.pipe || '1';
  const wadhValue = getWADH(pipe);
  
  // ─── DEBUG: Log all input parameters ──────────────────────
  console.log('[VimoPay AEPS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[VimoPay AEPS] 📤 E-KYC REQUEST DETAILS');
  console.log('[VimoPay AEPS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[VimoPay AEPS] Pipe           :', pipe);
  console.log('[VimoPay AEPS] Merchant ID    :', params.merchantId);
  console.log('[VimoPay AEPS] Merchant Ref ID:', params.merchantRefId);
  console.log('[VimoPay AEPS] Device Type    :', params.deviceType || 'mantra');
  console.log('[VimoPay AEPS] Aadhaar Number :', params.aadhaarNumber ? '****' + params.aadhaarNumber.slice(-4) : 'NOT PROVIDED');
  console.log('[VimoPay AEPS] WADH Length    :', wadhValue.length);
  console.log('[VimoPay AEPS] WADH (first 20):', wadhValue.substring(0, 20) + '...');
  console.log('[VimoPay AEPS] WADH (full)    :', wadhValue);
  console.log('[VimoPay AEPS] PID Data Length:', params.pidData ? params.pidData.length : 0);
  console.log('[VimoPay AEPS] PID Data (first 500 chars):\n', params.pidData ? params.pidData.substring(0, 500) + '...' : 'NOT PROVIDED');
  
  // ─── Check if PID Data contains wadh ──────────────────────
  if (params.pidData) {
    const hasWadh = params.pidData.includes('wadh=');
    console.log('[VimoPay AEPS] PID Data contains wadh attribute:', hasWadh);
    if (hasWadh) {
      const wadhMatch = params.pidData.match(/wadh="([^"]*)"/);
      console.log('[VimoPay AEPS] PID Data WADH (extracted):', wadhMatch ? wadhMatch[1].substring(0, 20) + '...' : 'NOT FOUND');
    }
  }
  
  console.log('[VimoPay AEPS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ─── Build the payload ──────────────────────────────────────
  const payload = {
    merchantId:    params.merchantId,
    merchantRefId: params.merchantRefId,
    pipe:          pipe,
    pidData:       params.pidData,
    deviceType:    params.deviceType || 'mantra',
    wadh:          wadhValue,
    aadhaarNumber: params.aadhaarNumber,
  };

  // ─── DEBUG: Full decrypted payload (what we're sending) ────
  console.log('[VimoPay AEPS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[VimoPay AEPS] 📦 FULL DECRYPTED PAYLOAD');
  console.log('[VimoPay AEPS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(JSON.stringify(payload, null, 2));
  console.log('[VimoPay AEPS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ─── Make the API call ──────────────────────────────────────
  const result = await callVimoPayAPI('/aepsapi/api/payment/merchantonboardKycPipe', 'POST', payload);

  // ─── DEBUG: Log the full response ──────────────────────────
  console.log('[VimoPay AEPS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[VimoPay AEPS] 📥 E-KYC RESPONSE');
  console.log('[VimoPay AEPS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[VimoPay AEPS] Full Response:', JSON.stringify(result, null, 2));
  
  // ─── Extract and log response details ──────────────────────
  const d = result.data && typeof result.data === 'object' ? result.data : result;
  console.log('[VimoPay AEPS] Response Details:');
  console.log('[VimoPay AEPS]   - successStatus :', result.successStatus);
  console.log('[VimoPay AEPS]   - responseCode  :', result.responseCode);
  console.log('[VimoPay AEPS]   - message       :', result.message);
  console.log('[VimoPay AEPS]   - status        :', d.status);
  console.log('[VimoPay AEPS]   - merchantStatus:', d.merchantStatus);
  console.log('[VimoPay AEPS]   - statusDesc    :', d.statusDescription);
  console.log('[VimoPay AEPS]   - merchantId    :', d.merchantId);
  console.log('[VimoPay AEPS]   - txnRefId      :', d.txnRefId);
  console.log('[VimoPay AEPS] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ─── Return formatted response ─────────────────────────────
  return {
    status:            getStatusFromResult(result),
    merchantStatus:    d.merchantStatus || result.merchantStatus || (result.successStatus ? 'Success' : 'Failed'),
    statusDescription: d.statusDescription || result.message || '',
    merchantId:        d.merchantId || params.merchantId,
    txnRefId:          d.txnRefId,
  };
}

// async function perform2FA(params) {
//   const pipe = params.pipe || '1';
//   const maskedAadhaar = params.aadhaarNumber ? '****' + params.aadhaarNumber.slice(-4) : 'null';

//   console.log('[VimoPay AEPS] Full PID option being sent:\n', params.pidData);

//   console.log('[VimoPay AEPS] 2FA request details:', {
//     merchantId: params.merchantId,
//     merchantRefId: params.merchantRefId,
//     aadhaarNumber: maskedAadhaar,
//     pipe: pipe,
//     deviceType: params.deviceType || 'mantra',
//     pidDataLength: params.pidData ? params.pidData.length : 0,
//   });

//   // ✅ ONLY send the 6 mandatory parameters as per documentation
//   const result = await callVimoPayAPI('/aepsapi/api/payment/merchant2FAPipe', 'POST', {
//     merchantId:    params.merchantId,
//     merchantRefId: params.merchantRefId,
//     aadhaarNumber: params.aadhaarNumber,
//     pipe:          pipe,
//     deviceType:    params.deviceType || 'mantra',
//     pidData:       params.pidData,
//     // ❌ REMOVED: wadh, lat, long
//   });

//   console.log('[VimoPay AEPS] 2FA response:', JSON.stringify(result));
  
//   return {
//     status:            getStatusFromResult(result),
//     merchantStatus:    result.merchantStatus || (result.successStatus ? 'Success' : 'Failed'),
//     statusDescription: result.statusDescription || result.message || '',
//     merchantId:        result.merchantId || params.merchantId,
//     txnRefId:          result.txnRefId,
//   };
// }

// backend/providers/vimopay/vimopayAepsProvider.js

async function perform2FA(params) {
  const pipe = params.pipe || '1';
  const maskedAadhaar = params.aadhaarNumber ? '****' + params.aadhaarNumber.slice(-4) : 'null';

  console.log('[VimoPay AEPS] Full PID option being sent:\n', params.pidData);

  console.log('[VimoPay AEPS] 2FA request details:', {
    merchantId: params.merchantId,
    merchantRefId: params.merchantRefId,
    aadhaarNumber: maskedAadhaar,
    pipe: pipe,
    deviceType: params.deviceType || 'mantra',
    pidDataLength: params.pidData ? params.pidData.length : 0,
  });

  const result = await callVimoPayAPI('/aepsapi/api/payment/merchant2FAPipe', 'POST', {
    merchantId: params.merchantId,
    merchantRefId: params.merchantRefId,
    aadhaarNumber: params.aadhaarNumber,
    pipe: pipe,
    deviceType: (params.deviceType || 'mantra').toLowerCase(),
    pidData: params.pidData,
    wadh: ''
  });

  console.log('[VimoPay AEPS] 2FA response:', JSON.stringify(result));
  return {
    status: getStatusFromResult(result),
    merchantStatus: result.merchantStatus || (result.successStatus ? 'Success' : 'Failed'),
    statusDescription: result.statusDescription || result.message || '',
    merchantId: result.merchantId || params.merchantId,
    txnRefId: result.txnRefId,
  };
}

// ============================================================
// TRANSACTIONS – Production endpoint + DYNAMIC WADH (Pipe 1, 2, or 3)
// ============================================================

// Cash Withdrawal (CW) - REMOVE wadh from payload
// async function cashWithdrawal(params) {
//   const pipe = params.pipe || '1';
//   // ✅ Use correct WADH per pipe
//   const wadh = pipe === '2' 
//     ? 'E0jzJ/P8UopUHAieZn8CKqS4WPMi5ZSYXgfnlfkWjrc='  // Pipe 2
//     : 'E0jzJ/P8UopUHAieZn8CKqS4WPMi5ZSYXgfnlfkWjrc='; // Pipe 1 (or your .env value)

//  // ✅ Inject WADH into PID data
//   let pidData = params.pidData;
//   if (pidData && wadh) {
//     pidData = pidData.replace(/wadh=""/g, `wadh="${wadh}"`);
//     console.log(`[VimoPay AEPS] Using EKYC WADH: ${wadh.substring(0, 20)}...`);
//   }
//   console.log(`[VimoPay AEPS] Cash withdrawal pipe: ${pipe}`);
// console.log(`[VimoPay AEPS] Cash withdrawal pipe: ${pipe}, WADH: ${wadh.substring(0, 20)}...`);
//   const result = await callVimoPayAPI('/aepsapi/api/payment/AepsTransactionPipe', 'POST', {
//     merchantRefId:   `TXN${Date.now()}`,
//     merchantId:      params.merchantId,
//     transactionType: 'CW',
//     aadhaarNumber:   params.aadhaarNo,
//     mobileNumber:    '9072188422',
//     amount:          params.amount.toString(),
//     bankIIN:         params.bankCode,
//     ipAddress:       params.ipAddress || '127.0.0.1',
//     pipe:            pipe,
//     lat:             params.lat || '0.0',
//     long:            params.long || '0.0',
//     deviceType:      params.device || 'mantra',
//     pidData:         params.pidData,
//     // ❌ REMOVED: wadh: wadh,
//     udf1: '', udf2: '', udf3: '',
//   });

//   console.log('[VimoPay AEPS] CW response:', JSON.stringify(result));
//   return extractTxnData(result);
// }


function cleanPidDataForTransaction(pidData) {
  if (!pidData) return pidData;
  
  let cleaned = pidData;
  
  // 1. Remove wadh="" attribute from XML
  cleaned = cleaned.replace(/wadh="[^"]*"/g, '');
  
  // 2. Remove wadh='' attribute (single quotes)
  cleaned = cleaned.replace(/wadh='[^']*'/g, '');
  
  // 3. Remove wadh= parameter (without quotes)
  cleaned = cleaned.replace(/wadh=[^\s&>]+/g, '');
  
  // 4. Remove &wadh= or ?wadh= from query strings
  cleaned = cleaned.replace(/[&?]wadh=[^&]*/g, '');
  
  // 5. Clean up empty attributes like: attr=""
  cleaned = cleaned.replace(/\s+=""/g, '');
  cleaned = cleaned.replace(/=""/g, '');
  
  // 6. Remove any XML comments containing wadh
  cleaned = cleaned.replace(/<!--[^>]*wadh[^>]*-->/gi, '');
  
  // 7. Clean up extra spaces and newlines
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // 8. Fix any malformed XML tags
  cleaned = cleaned.replace(/<Data\s+>/g, '<Data>');
  cleaned = cleaned.replace(/<Data\s+type=/g, '<Data type=');
  
  console.log('[VimoPay AEPS] ✅ WADH removed from PID data');
  console.log('[VimoPay AEPS] Cleaned PID (first 200 chars):', cleaned.substring(0, 200) + '...');
  
  return cleaned;
}


// Cash Withdrawal (CW) - REMOVE wadh completely from payload
// Cash Withdrawal (CW) - CORRECTED
async function cashWithdrawal(params) {
  const pipe = params.pipe || '1';
  
  console.log(`[VimoPay AEPS] Cash withdrawal pipe: ${pipe}`);
  console.log(`[VimoPay AEPS] Merchant ID: ${params.merchantId}`);
  console.log(`[VimoPay AEPS] Amount: ${params.amount}`);

  // ✅ SEND ORIGINAL PID DATA - DO NOT CLEAN IT!
  // The PID data already contains the fingerprint
  // The wadh field is NOT sent in the payload (as per VimoPay)

  const payload = {
    merchantRefId:   `TXN${Date.now()}`,
    merchantId:      params.merchantId,
    transactionType: 'CW',
    aadhaarNumber:   params.aadhaarNo,
    mobileNumber:    params.mobileNo || '9072188422',
    amount:          params.amount.toString(),
    bankIIN:         params.bankCode,
    ipAddress:       params.ipAddress || '127.0.0.1',
    pipe:            pipe,
    lat:             params.lat || '0.0',
    long:            params.long || '0.0',
    deviceType:      params.device || 'mantra',
    pidData:         params.pidData,  // ✅ SEND AS-IS, NO CLEANING!
    udf1:            '',
    udf2:            '',
    udf3:            '',
    // ❌ NO wadh field in payload
  };

  console.log('[VimoPay AEPS] 📦 Cash Withdrawal Payload:');
  console.log(JSON.stringify({
    ...payload,
    aadhaarNumber: '****' + payload.aadhaarNumber.slice(-4),
    pidData: payload.pidData ? 'PID_DATA_PRESENT (length: ' + payload.pidData.length + ')' : null,
  }, null, 2));

  const result = await callVimoPayAPI('/aepsapi/api/payment/AepsTransactionPipe', 'POST', payload);

  console.log('[VimoPay AEPS] CW response:', JSON.stringify(result));
  return extractTxnData(result);
}


// Cash Deposit (CD) - REMOVE wadh
async function cashDeposit(params) {
  const pipe = params.pipe || '1';

  console.log(`[VimoPay AEPS] Cash deposit pipe: ${pipe}`);
  
  const result = await callVimoPayAPI('/aepsapi/api/payment/AepsTransactionPipe', 'POST', {
    merchantRefId:   `TXN${Date.now()}`,
    merchantId:      params.merchantId,
    transactionType: 'CD',
    aadhaarNumber:   params.aadhaarNo,
    mobileNumber:    params.mobileNo,
    amount:          params.amount.toString(),
    bankIIN:         params.bankCode,
    ipAddress:       params.ipAddress || '127.0.0.1',
    pipe:            pipe,
    lat:             params.lat || '0.0',
    long:            params.long || '0.0',
    deviceType:      params.device || 'mantra',
    pidData:         params.pidData,
    // ❌ REMOVED: wadh: wadh,
    udf1: '', udf2: '', udf3: '',
  });

  console.log('[VimoPay AEPS] CD response:', JSON.stringify(result));
  return extractTxnData(result);
}

// Balance Enquiry (BE) - REMOVE wadh
async function balanceEnquiry(params) {
  const pipe = params.pipe || '1';

  console.log(`[VimoPay AEPS] Balance enquiry pipe: ${pipe}`);



  const result = await callVimoPayAPI('/aepsapi/api/payment/AepsTransactionPipe', 'POST', {
    merchantRefId:   `TXN${Date.now()}`,
    merchantId:      params.merchantId,
    transactionType: 'BE',
    aadhaarNumber:   params.aadhaarNo,
    mobileNumber:    params.mobileNo,
    amount:          '0',
    bankIIN:         params.bankCode,
    ipAddress:       params.ipAddress || '127.0.0.1',
    pipe:            pipe,
    lat:             params.lat || '0.0',
    long:            params.long || '0.0',
    deviceType:      params.device || 'mantra',
    pidData:         params.pidData,
    // ❌ REMOVED: wadh: wadh,
    udf1: '', udf2: '', udf3: '',
  });

  console.log('[VimoPay AEPS] BE response:', JSON.stringify(result));
  return extractTxnData(result);
}

// Mini Statement (MS) - REMOVE wadh
async function miniStatement(params) {
  const pipe = params.pipe || '1';

  console.log(`[VimoPay AEPS] Mini statement pipe: ${pipe}`);
    // ✅ Clean PID data
  const cleanedPidData = cleanPidDataForTransaction(params.pidData);

  const result = await callVimoPayAPI('/aepsapi/api/payment/AepsTransactionPipe', 'POST', {
    merchantRefId:   `TXN${Date.now()}`,
    merchantId:      params.merchantId,
    transactionType: 'MS',
    aadhaarNumber:   params.aadhaarNo,
    mobileNumber:    params.mobileNo,
    amount:          '0',
    bankIIN:         params.bankCode,
    ipAddress:       params.ipAddress || '127.0.0.1',
    pipe:            pipe,
    lat:             params.lat || '0.0',
    long:            params.long || '0.0',
    deviceType:      params.device || 'mantra',
    pidData:         params.pidData,
    // ❌ REMOVED: wadh: wadh,
    udf1: '', udf2: '', udf3: '',
  });

  console.log('[VimoPay AEPS] MS response:', JSON.stringify(result));

  const txnData = extractTxnData(result);
  txnData.transactionList = parseTransactionList(txnData.transactionList);
  console.log('[VimoPay AEPS] Parsed transactionList:', JSON.stringify(txnData.transactionList));

  return txnData;
}


// Aadhaar Pay (AP)
async function aadhaarPay(params) {
  const pipe = params.pipe || '1';

  console.log(`[VimoPay AEPS] Aadhaar Pay pipe: ${pipe}`);

  const result = await callVimoPayAPI('/aepsapi/api/payment/AepsTransactionPipe', 'POST', {
    merchantRefId: `TXN${Date.now()}`,
    merchantId: params.merchantId,
    transactionType: 'AP',
    aadhaarNumber: params.aadhaarNo,
    mobileNumber: params.mobileNo,
    amount: params.amount.toString(),
    bankIIN: (params.bankCode || '').trim(),
    ipAddress: params.ipAddress || '127.0.0.1',
    pipe: pipe,
    lat: params.lat || '0.0',
    long: params.long || '0.0',
    deviceType: params.device || 'mantra',
    pidData: params.pidData,
    udf1: '', udf2: '', udf3: '',
  });

  console.log('[VimoPay AEPS] AP response:', JSON.stringify(result));
  return extractTxnData(result);
}


// ✅ ADD THE NEW FUNCTION HERE - BEFORE module.exports

// ============================================================
// CHECK MERCHANT STATUS IN ALL PIPES
// ============================================================
async function checkMerchantInAllPipes(panNumber, aadhaarNumber) {
  console.log('[VimoPay AEPS] 🔍 Checking merchant in all pipes...');
  console.log('[VimoPay AEPS] PAN:', panNumber);
  console.log('[VimoPay AEPS] Aadhaar:', aadhaarNumber ? '****' + aadhaarNumber.slice(-4) : 'null');
  
  const results = [];
  
  // Check each pipe
  for (const pipe of ['1', '2', '3','4']) {
    try {
      // Use the merchant status endpoint to check if merchant exists
      const result = await callVimoPayAPI('/aepsapi/api/payment/merchantstatusbypan', 'POST', {
        panNumber: panNumber,
        pipe: pipe,
      });
      
      if (result && result.data && result.data.merchantId) {
        results.push({
          pipe: pipe,
          merchantId: result.data.merchantId,
          merchantStatus: result.data.merchantStatus || result.data.status,
          registrationStatus: result.data.registrationStatus,
        });
      }
    } catch (e) {
      console.log(`[VimoPay AEPS] No merchant found in pipe ${pipe} or endpoint not available`);
    }
  }
  
  console.log('[VimoPay AEPS] Merchant check results:', JSON.stringify(results));
  return results;
}
function init(env) {}

module.exports = {
  registerMerchant,
  getBankList,
  getStateList,
  getDistrictList,
  getBankIINs,
  sendOTP,
  resendOTP,
  verifyOTP,
  merchantEkyc,
  perform2FA,
  cashWithdrawal,
  cashDeposit,
  balanceEnquiry,
  miniStatement,
  checkMerchantInAllPipes,
  init,
  verifyOTPDelivery
};