// backend/providers/vimopay/vimopayRecharge.js
// Vimopay Recharge API v1.0.5 — Mobile, DTH, Electricity
// PRODUCTION VERSION – with operator list logging
'use strict';

const axios  = require('axios');
const logger = require('../../utils/logger');
const { encryptRecharge, decryptRecharge } = require('../../utils/vimopayEncrypt');

// ─────────────────────────────────────────────────────────────
// TOKEN CACHE
// ─────────────────────────────────────────────────────────────
let _token       = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const BASE_URL = process.env.VIMOPAY_RECHARGE_BASE_URL;
  const USER_ID  = process.env.VIMOPAY_RECHARGE_USER_ID;

  logger.info('Vimopay Recharge: fetching new auth token');

  const res = await axios.post(
    `${BASE_URL}/rechargeapi/api/Signature/Authorize`,
    {},
    {
      headers: {
        secretKey:         process.env.VIMOPAY_RECHARGE_SECRET_KEY,
        saltKey:           process.env.VIMOPAY_RECHARGE_SALT_KEY,
        encryptdecryptKey: process.env.VIMOPAY_RECHARGE_ENCRYPT_DECRYPT_KEY,
        userId:            USER_ID,
      },
    }
  );

  if (!res.data || !res.data.successStatus) {
    throw new Error('Vimopay auth failed: ' + (res.data && res.data.message ? res.data.message : 'no response'));
  }

  if (!res.data.data) {
    throw new Error('Vimopay auth: no token data in response');
  }

  const rawData = res.data.data;

  // Try decryption first
  const decrypted = decryptRecharge(rawData);
  if (decrypted && decrypted.trim().length > 0) {
    _token = decrypted.replace(/[\r\n\s]/g, '');
    _tokenExpiry = Date.now() + 25 * 60 * 1000;
    logger.info(`Vimopay Recharge: token refreshed via decryption (${_token.length} chars)`);
    return _token;
  }

  // Use raw token as Bearer
  const rawToken = rawData.replace(/[\r\n]/g, '');
  if (/^[\x21-\x7E]+$/.test(rawToken) && rawToken.length > 20) {
    _token = rawToken;
    _tokenExpiry = Date.now() + 25 * 60 * 1000;
    logger.info(`Vimopay Recharge: using raw token as Bearer (${_token.length} chars)`);
    return _token;
  }

  const cleaned = rawData.replace(/[^\x21-\x7E]/g, '');
  if (cleaned.length > 20) {
    _token = cleaned;
    _tokenExpiry = Date.now() + 25 * 60 * 1000;
    logger.warn(`Vimopay Recharge: using cleaned token (${_token.length} chars)`);
    return _token;
  }

  throw new Error('Vimopay auth: could not extract usable token from response');
}

// ─────────────────────────────────────────────────────────────
// OPERATOR CACHE
// ─────────────────────────────────────────────────────────────

const OPERATOR_FALLBACK = {
  // Mobile
  'JIO':          'JRE',
  'AIRTEL':       'ATL',
  'VI': 'VDF',
'VODAFONE': 'VDF',
'IDEA': 'VDF',
 'BSNL':         'BNT',
'BSNL TOPUP':   'BNT',
  // DTH
  'TATA PLAY':    'STV',
  'TATAPLAY':     'STV',
  'AIRTEL TV':    'ATV',
  'AIRTEL DTH':   'ATV',
  'DISH TV':      'BTV',
  'DISHTV':       'BTV',
  'SUN DTH':      'SDT',
  'SUN DIRECT':   'SDT',
  'VIDEOCON D2H': 'VDH',
  'D2H':          'VDH',
};

const _opCache = {};

async function getOpCode(serviceType, operatorName) {
  const BASE_URL = process.env.VIMOPAY_RECHARGE_BASE_URL;
  const USER_ID  = process.env.VIMOPAY_RECHARGE_USER_ID;

  if (!_opCache[serviceType]) {
    try {
      const token     = await getToken();
      const encrypted = encryptRecharge(serviceType);

      const r = await axios.post(
        `${BASE_URL}/masterapi/api/Master/GetOperator`,
        { requestBody: encrypted },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            userId:        USER_ID,
          },
          timeout: 10000,
        }
      );

      if (!r.data || !r.data.successStatus || !r.data.data) {
        throw new Error(`Operator list API failed: ${r.data && r.data.message}`);
      }

      const raw = decryptRecharge(r.data.data);
      if (!raw) {
        throw new Error('Could not decrypt operator list — using fallback.');
      }

      const ops = JSON.parse(raw);
      _opCache[serviceType] = {};

      ops.forEach(o => {
        const descKey = (o.description || '').toUpperCase().trim();
        if (descKey) _opCache[serviceType][descKey] = o.code;
        _opCache[serviceType][o.code.toUpperCase()] = o.code;
      });

      // ─── LOG THE FULL OPERATOR LIST FOR DEBUGGING ───
      console.log('\n=== OPERATOR LIST FROM VIMOPAY PRODUCTION API ===');
      ops.forEach(o => console.log(`${o.description} -> ${o.code}`));
      const bsnlEntry = ops.find(o => o.description === 'BSNL');
      if (bsnlEntry) {
        console.log(`\n✅ BSNL entry from API: description="${bsnlEntry.description}", code="${bsnlEntry.code}"`);
      } else {
        console.log('\n⚠️ BSNL not found in operator list!');
      }
      console.log('=============================================\n');

      logger.info(`Vimopay: loaded ${ops.length} operators for serviceType=${serviceType}`);

    } catch (e) {
      logger.warn(`Vimopay: operator fetch failed for ${serviceType} — using fallback. Reason: ${e.message}`);
    }
  }

  const cache   = _opCache[serviceType] || {};
  const key     = (operatorName || '').toUpperCase().trim();
  const resolved = cache[key] || OPERATOR_FALLBACK[key] || operatorName;

  logger.info(`Vimopay: "${operatorName}" → "${resolved}" (serviceType=${serviceType})`);
  return resolved;
}

// ─────────────────────────────────────────────────────────────
// STATUS MAP
// ─────────────────────────────────────────────────────────────
const STATUS_MAP = {
  '000': 'success',
  '001': 'failed',
  '002': 'pending',
  '003': 'failed',
  '004': 'pending',
};

// ─────────────────────────────────────────────────────────────
// MAIN — processRecharge()
// ─────────────────────────────────────────────────────────────
async function processRecharge(request) {
  const BASE_URL = process.env.VIMOPAY_RECHARGE_BASE_URL;
  const USER_ID  = process.env.VIMOPAY_RECHARGE_USER_ID;

  const {
    mobile,
    operator,
    amount,
    merchantRefId,
    serviceType = 'MBL',
    lat          = '0',
    long         = '0',
  } = request;

  const token = await getToken();
  const opCode = await getOpCode(serviceType, operator);

  const plainPayload = JSON.stringify({
    merchantRefId:  String(merchantRefId),
    amount:         amount,
    operatorCode:   opCode,
    serviceType:    serviceType,
    operatorNumber: mobile,
    lat:            String(lat),
    long:           String(long),
    udf1:           '',
    udf2:           '',
    udf3:           '',
  });

  const encryptedPayload = encryptRecharge(plainPayload);
  if (!encryptedPayload) {
    throw new Error('Vimopay: payload encryption failed');
  }

  logger.info(`Vimopay Recharge: initiating | mobile=${mobile} | serviceType=${serviceType} | opCode=${opCode} | amount=₹${amount} | ref=${merchantRefId}`);

  const res = await axios.post(
    `${BASE_URL}/rechargeapi/api/Payment/recharge`,
    { requestBody: encryptedPayload },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        userId:        USER_ID,
      },
      timeout: 15000,
    }
  );

  logger.info(`Vimopay Recharge: response | successStatus=${res.data.successStatus} | responseCode=${res.data.responseCode} | message=${res.data.message}`);

  if (!res.data || !res.data.successStatus) {
    return {
      status:          'failed',
      provider_txn_id: null,
      message:         res.data && res.data.message ? res.data.message : 'Vimopay API rejected request',
      raw_response:    res.data || {},
    };
  }

  if (!res.data.data) {
    logger.warn('Vimopay Recharge: no data field in success response — returning pending');
    return {
      status:          'pending',
      provider_txn_id: null,
      message:         'Queued — awaiting callback',
      raw_response:    res.data,
    };
  }

  let txnData = null;
  try {
    const raw = decryptRecharge(res.data.data);
    if (raw) {
      txnData = JSON.parse(raw);
    }
  } catch (e) {
    logger.warn(`Vimopay Recharge: response decrypt failed — ${e.message}`);
  }

  if (!txnData) {
    logger.warn('Vimopay Recharge: could not decrypt response — returning pending');
    return {
      status:          'pending',
      provider_txn_id: null,
      message:         'Queued — awaiting callback',
      raw_response:    res.data,
    };
  }

  logger.info(`Vimopay Recharge: txnId=${txnData.txnId} | txnStatus=${txnData.txnStatus} | txnStatusCode=${txnData.txnStatusCode}`);

  return {
    status:          STATUS_MAP[txnData.txnStatusCode] || 'pending',
    provider_txn_id: txnData.txnId            || null,
    message:         txnData.txnStatus         || 'Unknown',
    commission:      txnData.commission         || 0,
    finalCommission: txnData.finalCommission    || 0,
    tds:             txnData.tds                || 0,
    raw_response:    txnData,
  };
}

module.exports = { process: processRecharge };