// backend/providers/vimopay/vimopayAepsProvider.js
// ✅ PRODUCTION VERSION
//   - All URLs updated to production endpoints (no 'uat' suffix)
//   - WADH values added to transactions & E-KYC, now trimmed to remove hidden chars
//   - ✅ FIX: aadhaarNumber added to merchantEkyc (required for biometric match)
//   - ✅ FIX: dynamic pipe support – uses params.pipe to select correct WADH (Pipe 1, 2, or 3)
//   - ✅ FIX: 2FA does NOT send wadh (as confirmed by VimoPay) – but we now send wadh: "" explicitly
//   - ✅ FIX: Removed dummy default '999999999999' for aadhaarNumber – now required
//   - ✅ FIX: cashWithdrawal, cashDeposit, balanceEnquiry, miniStatement now use dynamic WADH (Pipe 1, 2, or 3)
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
async function callVimoPayAPI(endpoint, method, payload = null, requiresAuth = true) {
  const BASE_URL = process.env.AEPS_BASE_URL || 'https://prod.vidual.in';
  const USER_ID  = process.env.AEPS_USER_ID;

  const headers = { 'Content-Type': 'application/json' };

  if (requiresAuth) {
    const token = await getAuthToken();
    headers.Authorization = `Bearer ${token}`;
    headers.userId = USER_ID;
  }

  let requestBody = null;
  if (payload) {
    requestBody = { requestBody: encryptAES(JSON.stringify(payload)) };
  }

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
// HELPER – get WADH based on pipe (Pipe 1, 2, or 3)
// ============================================================
function getWADH(pipe) {
  if (pipe === '1') {
    return (process.env.AEPS_WADH_PIPE1 || '').trim();
  } else if (pipe === '2') {
    return (process.env.AEPS_WADH_PIPE2 || '').trim();
  } else if (pipe === '3') {
    return (process.env.AEPS_WADH_PIPE3 || '').trim();
  }
  // Default fallback
  return (process.env.AEPS_WADH_PIPE2 || '').trim();
}

// ============================================================
// PUBLIC PROVIDER METHODS (all URLs replaced with production)
// ============================================================

async function registerMerchant(params) {
  if (!params.aadhaarNo || params.aadhaarNo.length !== 12) {
    throw new Error('Valid 12-digit agent Aadhaar is required for merchant registration');
  }

  const payload = {
    merchantRefId:       params.merchantRefId || `NEO${Date.now()}`,
    ipAddress:           params.ipAddress || '127.0.0.1',
    lat:                 params.lat || '0.0',
    long:                params.long || '0.0',
    shopLat:             params.lat || '0.0',
    shopLong:            params.long || '0.0',
    firstName:           params.firstName,
    lastName:            params.lastName,
    middleName:          params.middleName || '',
    dob:                 params.dob,
    gender:              params.gender || 'M',
    emailId:             params.emailId || 'merchant@neofyn.in',
    merchantPhoneNumber: params.merchantPhoneNumber,
    merchantAddress1:    params.merchantAddress1,
    merchantAddress2:    params.merchantAddress2 || '',
    shopAddress:         params.shopAddress || params.merchantAddress1,
    shopState:           params.stateCode,
    shopDistrict:        params.districtCode,
    shopPincode:         params.shopPincode,
    merchantState:       params.stateCode,
    merchantDistrict:    params.districtCode,
    merchantPinCode:     params.shopPincode,
    merchantPan:         params.merchantPan || 'AAAAA0000A',
    shopPan:             params.shopPan || 'AAAAA0000A',
    aadhaarNumber:       params.aadhaarNo,
    aadhaarNo:           params.aadhaarNo,
    bankAccountNumber:   params.bankAccount,
    bankAccount:         params.bankAccount,
    bankIfscCode:        params.bankIfsc,
    bankIfsc:            params.bankIfsc,
    BankName:            params.bankNameCode,
    bankNameCode:        params.bankNameCode,
    pipe:                params.pipe || '1',
  };

  const result = await callVimoPayAPI('/aepsapi/api/payment/merchantonboardallpipe', 'POST', payload);
  console.log('[VimoPay AEPS] Register response:', JSON.stringify(result));

  if (Array.isArray(result.data)) {
    console.error('[VimoPay AEPS] Validation errors:');
    result.data.forEach(e => console.error(' -', e.MemberNames?.[0], ':', e.ErrorMessage));
  }

  const d = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : result;
  return {
    status:            getStatusFromResult(result),
    merchantStatus:    d.merchantStatus || result.merchantStatus || (result.successStatus ? 'Success' : 'Failed'),
    statusDescription: d.statusDescription || result.message || '',
    merchantId:        d.merchantId || result.merchantId,
    txnRefId:          d.txnRefId || result.txnRefId,
    merchantRefId:     d.merchantRefId || result.merchantRefId || payload.merchantRefId,
    pipe:              d.pipe || result.pipe || payload.pipe,
  };
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
  const result = await callVimoPayAPI('/aepsapi/api/payment/merchantonboardsendotppipe', 'POST', {
    merchantId: params.merchantId, merchantRefId: params.merchantRefId, pipe: params.pipe || '1',
  });
  return {
    status:            getStatusFromResult(result),
    merchantStatus:    result.merchantStatus || (result.successStatus ? 'Success' : 'Failed'),
    statusDescription: result.statusDescription || result.message || '',
    merchantId:        result.merchantId || params.merchantId,
    txnRefId:          result.txnRefId,
  };
}

async function resendOTP(params) {
  const result = await callVimoPayAPI('/aepsapi/api/payment/merchantonboardsendotppipe', 'POST', {
    merchantId: params.merchantId, merchantRefId: params.merchantRefId, pipe: params.pipe || '1',
  });
  return {
    status:            getStatusFromResult(result),
    merchantStatus:    result.merchantStatus || (result.successStatus ? 'Success' : 'Failed'),
    statusDescription: result.statusDescription || result.message || '',
    merchantId:        result.merchantId || params.merchantId,
    txnRefId:          result.txnRefId,
  };
}

async function verifyOTP(params) {
  const result = await callVimoPayAPI('/aepsapi/api/payment/merchantonboardValidateOtpPipe', 'POST', {
    merchantId: params.merchantId, merchantRefId: params.merchantRefId,
    otp: params.otp, pipe: params.pipe || '1',
  });
  return {
    status:            getStatusFromResult(result),
    merchantStatus:    result.merchantStatus || (result.successStatus ? 'Success' : 'Failed'),
    statusDescription: result.statusDescription || result.message || '',
    merchantId:        result.merchantId || params.merchantId,
    txnRefId:          result.txnRefId,
  };
}

async function merchantEkyc(params) {
  const pipe = params.pipe || '1';
  const wadhValue = getWADH(pipe);
  
  console.log('[VimoPay AEPS] E-KYC pipe:', pipe);
  console.log('[VimoPay AEPS] E-KYC WADH length:', wadhValue.length);
  console.log('[VimoPay AEPS] E-KYC WADH (first 10 chars):', wadhValue.substring(0, 10));

  const result = await callVimoPayAPI('/aepsapi/api/payment/merchantonboardKycPipe', 'POST', {
    merchantId:    params.merchantId,
    merchantRefId: params.merchantRefId,
    pipe:          pipe,
    pidData:       params.pidData,
    deviceType:    params.deviceType || 'mantra',
    wadh:          wadhValue,
    aadhaarNumber: params.aadhaarNumber,
  });
  console.log('[VimoPay AEPS] E-KYC response:', JSON.stringify(result));
  return {
    status:            getStatusFromResult(result),
    merchantStatus:    result.merchantStatus || (result.successStatus ? 'Success' : 'Failed'),
    statusDescription: result.statusDescription || result.message || '',
    merchantId:        result.merchantId || params.merchantId,
    txnRefId:          result.txnRefId,
  };
}

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
    lat: params.lat || '0.0',
    long: params.long || '0.0',
  });

  const result = await callVimoPayAPI('/aepsapi/api/payment/merchant2FAPipe', 'POST', {
    merchantId:    params.merchantId,
    merchantRefId: params.merchantRefId,
    aadhaarNumber: params.aadhaarNumber,
    pipe:          pipe,
    deviceType:    params.deviceType || 'mantra',
    pidData:       params.pidData,
    wadh:          '',
    lat:           params.lat || '0.0',
    long:          params.long || '0.0',
  });

  console.log('[VimoPay AEPS] 2FA response:', JSON.stringify(result));
  return {
    status:            getStatusFromResult(result),
    merchantStatus:    result.merchantStatus || (result.successStatus ? 'Success' : 'Failed'),
    statusDescription: result.statusDescription || result.message || '',
    merchantId:        result.merchantId || params.merchantId,
    txnRefId:          result.txnRefId,
  };
}

// ============================================================
// TRANSACTIONS – Production endpoint + DYNAMIC WADH (Pipe 1, 2, or 3)
// ============================================================

// Cash Withdrawal (CW)
async function cashWithdrawal(params) {
  const pipe = params.pipe || '1';
  const wadh = getWADH(pipe);

  console.log(`[VimoPay AEPS] Cash withdrawal pipe: ${pipe}, WADH length: ${wadh.length}`);

  const result = await callVimoPayAPI('/aepsapi/api/payment/AepsTransactionPipe', 'POST', {
    merchantRefId:   `TXN${Date.now()}`,
    merchantId:      params.merchantId,
    transactionType: 'CW',
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
    wadh:            wadh,
    udf1: '', udf2: '', udf3: '',
  });

  console.log('[VimoPay AEPS] CW response:', JSON.stringify(result));
  return extractTxnData(result);
}

// Cash Deposit (CD)
async function cashDeposit(params) {
  const pipe = params.pipe || '1';
  const wadh = getWADH(pipe);

  console.log(`[VimoPay AEPS] Cash deposit pipe: ${pipe}, WADH length: ${wadh.length}`);

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
    wadh:            wadh,
    udf1: '', udf2: '', udf3: '',
  });

  console.log('[VimoPay AEPS] CD response:', JSON.stringify(result));
  return extractTxnData(result);
}

// Balance Enquiry (BE)
async function balanceEnquiry(params) {
  const pipe = params.pipe || '1';
  const wadh = getWADH(pipe);

  console.log(`[VimoPay AEPS] Balance enquiry pipe: ${pipe}, WADH length: ${wadh.length}`);

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
    wadh:            wadh,
    udf1: '', udf2: '', udf3: '',
  });

  console.log('[VimoPay AEPS] BE response:', JSON.stringify(result));
  return extractTxnData(result);
}

// Mini Statement (MS)
async function miniStatement(params) {
  const pipe = params.pipe || '1';
  const wadh = getWADH(pipe);

  console.log(`[VimoPay AEPS] Mini statement pipe: ${pipe}, WADH length: ${wadh.length}`);

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
    wadh:            wadh,
    udf1: '', udf2: '', udf3: '',
  });

  console.log('[VimoPay AEPS] MS response:', JSON.stringify(result));

  const txnData = extractTxnData(result);
  txnData.transactionList = parseTransactionList(txnData.transactionList);
  console.log('[VimoPay AEPS] Parsed transactionList:', JSON.stringify(txnData.transactionList));

  return txnData;
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
  init,
};