// backend/providers/bbps/bbpsBillPay.js
// Based on BBPS API Specification v1.0.6
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');

function debugLog(msg, data = null) {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] ${msg}\n`;
    if (data) logLine += JSON.stringify(data, null, 2) + '\n';
    fs.appendFileSync('./bbps_debug.log', logLine + '\n');
    console.log(`[BBPS-DEBUG] ${msg}`, data ? data : '');
}

function getConfig() {
    return {
        baseUrl: process.env.BBPS_BASE_URL,
        secretKey: process.env.BBPS_SECRET_KEY,
        saltKey: process.env.BBPS_SALT_KEY,
        encryptDecryptKey: process.env.BBPS_ENCRYPT_DECRYPT_KEY,
        userId: process.env.BBPS_USER_ID,
        merchantId: process.env.BBPS_MERCHANT_ID,
        paths: {
            authorize:   '/bbpsapi/api/signature/authorize',
            register:    '/bbpsapi/api/Payment/MerchantRegistration',
            fetchBill:   '/bbpsapi/api/payment/fetchbill',
            billPayment: '/bbpsapi/api/payment/billpayment',
            stateList:   '/masterapi/api/master/statelist',
            cityList:    '/bbpsapi/api/BillerCategories/City',
            billerCats:  '/bbpsapi/api/billercategories/getbillercategories',
            billerCode:  '/bbpsapi/api/billercategories/getbillercode',
            billerDetails: '/bbpsapi/api/billercategories/getbillerdetails',
        }
    };
}

function encryptPayload(plainText, edKey, ivKey) {
    const key = Buffer.from(edKey, 'utf8');
    const iv  = Buffer.from(ivKey, 'utf8');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const result = Buffer.concat([encrypted, tag]).toString('base64');
    debugLog('encryptPayload success', { length: result.length });
    return result;
}

function decryptPayload(encryptedBase64, edKey, ivKey) {
    try {
        const key = Buffer.from(edKey, 'utf8');
        const iv  = Buffer.from(ivKey, 'utf8');
        const data = Buffer.from(encryptedBase64, 'base64');
        const tag  = data.slice(-16);
        const ct   = data.slice(0, -16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8').trim();
        debugLog('decryptPayload success', { length: decrypted.length });
        return decrypted;
    } catch (e) {
        debugLog('decryptPayload failed', { error: e.message });
        return null;
    }
}

let _cache = { token: null, expiresAt: 0 };

async function getToken() {
    const cfg = getConfig();
    if (!cfg.baseUrl || !cfg.secretKey || !cfg.saltKey || !cfg.encryptDecryptKey || !cfg.userId) {
        throw new Error('BBPS: missing required environment variables');
    }
    if (_cache.token && Date.now() < _cache.expiresAt) {
        debugLog('Using cached token');
        return _cache.token;
    }
    debugLog('Fetching new auth token...');
    const url = `${cfg.baseUrl}${cfg.paths.authorize}`;
    try {
        const response = await axios.post(url, {}, {
            headers: {
                'Content-Type': 'application/json',
                secretKey: cfg.secretKey,
                saltKey: cfg.saltKey,
                encryptdecryptKey: cfg.encryptDecryptKey,
                userId: cfg.userId,
            },
            timeout: 10000,
        });
        const body = response.data;
        debugLog('Auth response', { responseCode: body.responseCode, successStatus: body.successStatus });
        if (!body.successStatus || body.responseCode !== '000') {
            throw new Error(`BBPS auth failed: ${body.message || JSON.stringify(body)}`);
        }
        const rawToken = body.data.replace(/[\r\n]/g, '');
        _cache = { token: rawToken, expiresAt: Date.now() + 55 * 60 * 1000 };
        debugLog('Auth token cached', { length: rawToken.length });
        return rawToken;
    } catch (err) {
        debugLog('Auth request error', { message: err.message });
        throw err;
    }
}

async function post(path, payload, retry = true) {
    const cfg = getConfig();
    let token = await getToken();
    const plainJson = JSON.stringify(payload);
    const requestBody = encryptPayload(plainJson, cfg.secretKey, cfg.saltKey);
    
    console.log('[BBPS-DEBUG] Encrypted request body:', requestBody);
    
    const url = `${cfg.baseUrl}${path}`;
    try {
        const response = await axios.post(url, { requestBody }, {
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                userId: cfg.userId,
            },
            timeout: 20000,
        });
        const body = response.data;
        let data = null;
        if (body.data && typeof body.data === 'string') {
            const decrypted = decryptPayload(body.data, cfg.secretKey, cfg.saltKey);
            if (decrypted) data = JSON.parse(decrypted);
        } else {
            data = body.data;
        }
        return { meta: body, data };
    } catch (err) {
        if (retry && err.response && err.response.status === 401) {
            debugLog('Token expired, clearing cache and retrying...');
            _cache.token = null;
            _cache.expiresAt = 0;
            token = await getToken();
            return await post(path, payload, false);
        }
        debugLog('POST request error', {
            message: err.message,
            responseStatus: err.response?.status,
            responseData: err.response?.data
        });
        throw err;
    }
}

// =====================================================
// AGGRESSIVE SANITIZATION HELPERS (VimoPay compliant)
// =====================================================

// Clean merchant name: only alphanumeric, no spaces, no special characters
function sanitizeMerchantName(name) {
    if (!name) return '';
    return name.trim().replace(/[^a-zA-Z0-9]/g, '');
}

// Aggressive address sanitization:
// - VimoPay allows only: letters, numbers, spaces, dots (.), forward slashes (/), dashes (-)
// - We replace commas with space, remove all other special characters
function sanitizeAddress(addr) {
    if (!addr) return '';
    
    let cleaned = addr
        .trim()
        // 1. Replace commas with space (most important for your use case)
        .replace(/,/g, ' ')
        // 2. Replace ampersand with ' and '
        .replace(/&/g, ' and ')
        // 3. Replace @ with ' at '
        .replace(/@/g, ' at ')
        // 4. Replace underscore, colon, semicolon, hash with space
        .replace(/[_:;#]/g, ' ')
        // 5. Remove parentheses, brackets, curly braces
        .replace(/[()[\]{}]/g, ' ')
        // 6. Remove any other character that is NOT allowed:
        //    Allowed: A-Z a-z 0-9 space . / -
        .replace(/[^a-zA-Z0-9\s\.\/\-]/g, ' ')
        // 7. Collapse multiple spaces into single space
        .replace(/\s+/g, ' ')
        .trim();
    
    // Fallback if result is empty
    if (!cleaned) {
        cleaned = 'Shop Address';
    }
    
    return cleaned;
}

// Clean city/state: only letters (uppercase)
function sanitizeCode(code) {
    if (!code) return '';
    return code.trim().replace(/[^a-zA-Z]/g, '').toUpperCase();
}

// Clean pincode: only digits, max 6
function sanitizePincode(pincode) {
    if (!pincode) return '';
    return pincode.trim().replace(/[^0-9]/g, '').slice(0, 6);
}

// Clean mobile: only digits, max 10
function sanitizeMobile(mobile) {
    if (!mobile) return '';
    return mobile.trim().replace(/[^0-9]/g, '').slice(0, 10);
}

// Clean email: trim and lowercase
function sanitizeEmail(email) {
    if (!email) return '';
    return email.trim().toLowerCase();
}

class BBPSBillPay {
    // ------------------------------------------------------------------
    // Get state list
    // ------------------------------------------------------------------
    async getStates() {
        console.log('[BBPS] getStates() called');
        const cfg = getConfig();
        const fetchStates = async (retry = false) => {
            if (retry) {
                _cache.token = null;
                _cache.expiresAt = 0;
            }
            const token = await getToken();
            const url = `${cfg.baseUrl}${cfg.paths.stateList}`;
            return await axios.get(url, {
                headers: { Authorization: `Bearer ${token}`, userId: cfg.userId }
            });
        };
        let response;
        try {
            response = await fetchStates(false);
        } catch (err) {
            if (err.response && err.response.status === 401) {
                console.log('[BBPS] State list token expired, retrying...');
                response = await fetchStates(true);
            } else {
                throw err;
            }
        }
        let raw = response.data;
        console.log('[BBPS] Raw response type:', typeof raw);
        if (raw && raw.data && typeof raw.data === 'string') {
            console.log('[BBPS] Encrypted data field detected, decrypting...');
            const decrypted = decryptPayload(raw.data, cfg.secretKey, cfg.saltKey);
            if (!decrypted) throw new Error('Failed to decrypt state list');
            console.log('[BBPS] Decrypted data:', decrypted.substring(0, 200));
            raw = JSON.parse(decrypted);
        } else if (typeof raw === 'string') {
            console.log('[BBPS] Raw string (first 200 chars):', raw.substring(0, 200));
            const decrypted = decryptPayload(raw, cfg.secretKey, cfg.saltKey);
            if (!decrypted) throw new Error('Failed to decrypt state list');
            console.log('[BBPS] Decrypted string (first 200 chars):', decrypted.substring(0, 200));
            raw = JSON.parse(decrypted);
        }
        let states = raw.data || raw;
        if (states && !Array.isArray(states) && states.data && Array.isArray(states.data)) {
            states = states.data;
        }
        if (!Array.isArray(states)) {
            console.error('[BBPS] Unexpected state list format:', JSON.stringify(raw).substring(0, 500));
            throw new Error('Invalid response format from VimoPay state list API');
        }
        console.log(`[BBPS] getStates() received ${states.length} states`);
        return states;
    }

    // ------------------------------------------------------------------
    // Get city list
    // ------------------------------------------------------------------
    async getCities(stateCode) {
        console.log('[BBPS] getCities() stateCode:', stateCode);
        const result = await post(getConfig().paths.cityList, { stateCode });
        let cities = result.data;
        if (cities && !Array.isArray(cities) && cities.data && Array.isArray(cities.data)) {
            cities = cities.data;
        }
        if (!Array.isArray(cities)) {
            console.error('[BBPS] Expected cities array but got:', typeof cities);
            return [];
        }
        return cities;
    }

    // ------------------------------------------------------------------
    // Get biller categories
    // ------------------------------------------------------------------
    async getBillerCategories() {
        console.log('[BBPS] getBillerCategories() called');
        const cfg = getConfig();
        const token = await getToken();
        const url = `${cfg.baseUrl}${cfg.paths.billerCats}`;
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${token}`, userId: cfg.userId }
        });
        
        let raw = response.data;
        if (raw && raw.data && typeof raw.data === 'string') {
            console.log('[BBPS] Encrypted data field detected, decrypting...');
            const decrypted = decryptPayload(raw.data, cfg.secretKey, cfg.saltKey);
            if (!decrypted) throw new Error('Failed to decrypt categories');
            console.log('[BBPS] Decrypted categories:', decrypted.substring(0, 200));
            raw = JSON.parse(decrypted);
        }
        
        const categories = raw.data || raw;
        if (!Array.isArray(categories)) {
            console.error('[BBPS] Unexpected categories format:', categories);
            return [];
        }
        return categories;
    }

    // ------------------------------------------------------------------
    // Get billers (providers) for a given categoryCode
    // ------------------------------------------------------------------
    async getBillerCode(categoryCode) {
        console.log('[BBPS] getBillerCode() categoryCode:', categoryCode);
        const payload = { billerCategoryCode: categoryCode };
        const result = await post(getConfig().paths.billerCode, payload);
        let billers = result.data;
        if (billers && !Array.isArray(billers) && billers.data && Array.isArray(billers.data)) {
            billers = billers.data;
        }
        if (!Array.isArray(billers)) {
            console.error('[BBPS] Unexpected billers format:', billers);
            return [];
        }
        return billers;
    }

    // ------------------------------------------------------------------
    // Get biller details (required customer parameters)
    // ------------------------------------------------------------------
    async getBillerDetails(billerCategoryCode, billerCode) {
        console.log('[BBPS] getBillerDetails() categoryCode:', billerCategoryCode, 'billerCode:', billerCode);
        const payload = { billerCategoryCode, billerCode };
        const result = await post(getConfig().paths.billerDetails, payload);
        console.log('[BBPS] getBillerDetails result.data:', JSON.stringify(result.data, null, 2));
        return result.data;
    }

    // ------------------------------------------------------------------
    // Register merchant (onboarding) - WITH AGGRESSIVE SANITIZATION & INCREASED TIMEOUT
    // ------------------------------------------------------------------
    async registerMerchant(userData) {
        const cfg = getConfig();
        debugLog('registerMerchant called with raw data', userData);
        
        // Aggressive sanitization of all fields
        const sanitized = {
            merchantRefId: userData.merchantRefId || Date.now().toString(),
            merchantName: sanitizeMerchantName(userData.merchantName),
            merchantMobileNo: sanitizeMobile(userData.merchantMobileNo),
            merchantEmail: sanitizeEmail(userData.merchantEmail),
            merchantAddress: sanitizeAddress(userData.merchantAddress),
            merchantState: sanitizeCode(userData.merchantState),
            merchantCity: sanitizeCode(userData.merchantCity),
            merchantPinCode: sanitizePincode(userData.merchantPinCode),
            ipAddress: userData.ipAddress || '203.0.113.1',
            latitude: userData.latitude || 0,
            longitude: userData.longitude || 0,
            udf1: userData.udf1 || '',
            udf2: userData.udf2 || '',
            udf3: userData.udf3 || '',
        };
        
        // Log before sending to see the cleaned address
        console.log('[BBPS] Raw address input:', userData.merchantAddress);
        console.log('[BBPS] Sanitized address output:', sanitized.merchantAddress);
        
        // Validate sanitized data before sending
        if (!sanitized.merchantName) {
            throw new Error('Invalid merchant name after sanitization. Must contain at least one letter or number.');
        }
        
        if (!sanitized.merchantAddress) {
            throw new Error('Invalid merchant address after sanitization.');
        }
        
        if (!sanitized.merchantMobileNo || sanitized.merchantMobileNo.length < 10) {
            throw new Error('Invalid mobile number after sanitization. Must be 10 digits.');
        }
        
        if (!sanitized.merchantEmail || !sanitized.merchantEmail.includes('@')) {
            throw new Error('Invalid email after sanitization.');
        }
        
        if (!sanitized.merchantState || sanitized.merchantState.length !== 2) {
            throw new Error('Invalid state code. Must be 2 letters.');
        }
        
        if (!sanitized.merchantPinCode || sanitized.merchantPinCode.length !== 6) {
            throw new Error('Invalid pincode. Must be 6 digits.');
        }
        
        debugLog('Sanitized payload before encryption', sanitized);
        
        const payload = {
            merchantRefId: sanitized.merchantRefId,
            merchantName: sanitized.merchantName,
            merchantMobileNo: sanitized.merchantMobileNo,
            merchantEmail: sanitized.merchantEmail,
            merchantAddress: sanitized.merchantAddress,
            merchantState: sanitized.merchantState,
            merchantCity: sanitized.merchantCity,
            merchantPinCode: sanitized.merchantPinCode,
            ipAddress: sanitized.ipAddress,
            latitude: sanitized.latitude,
            longitude: sanitized.longitude,
            udf1: sanitized.udf1,
            udf2: sanitized.udf2,
            udf3: sanitized.udf3,
        };
        
        const token = await getToken();
        const edKey = cfg.secretKey;
        const ivKey = cfg.saltKey;
        const encryptedBody = encryptPayload(JSON.stringify(payload), edKey, ivKey);
        const url = `${cfg.baseUrl}${cfg.paths.register}`;
        
        const response = await axios.post(url, { requestBody: encryptedBody }, {
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                userId: cfg.userId,
            },
            timeout: 30000, // Increased from 15000 to 30000 ms (30 seconds)
        });
        
        let decrypted = null;
        if (response.data.data && typeof response.data.data === 'string') {
            decrypted = decryptPayload(response.data.data, edKey, ivKey);
        }
        
        if (!decrypted) throw new Error('Failed to decrypt merchant registration response');
        const result = JSON.parse(decrypted);
        console.log('[BBPS] Registration decrypted FULL result:', JSON.stringify(result, null, 2));
        
        if (result.code !== '000') {
            throw new Error(`VimoPay registration failed: ${result.message || JSON.stringify(result)}`);
        }
        
        debugLog('Registration success, merchantCode:', result.merchantCode);
        return result;
    }

    // ------------------------------------------------------------------
    // Fetch bill (step 1)
    // ------------------------------------------------------------------
    async fetchBill(request) {
        const cfg = getConfig();
        const { serviceType, customerId, additionalData = {} } = request;
        const merchantRefId = String(Date.now());

        const customerParam = [];
        if (additionalData.customerParams) {
            customerParam.push(...additionalData.customerParams);
        }

        const merchantCode = additionalData.merchantCode;
        if (!merchantCode) {
            throw new Error('Merchant code is required for fetchBill');
        }
        const billerId = additionalData.billerId || serviceType;
        if (!billerId) {
            throw new Error('Biller ID is required for fetchBill');
        }

        const payload = {
            merchantRefId,
            merchantCode,
            billerId,
            customerParam,
            lat: additionalData.lat || '0.0',
            long: additionalData.long || '0.0',
            udf1: additionalData.udf1 || '',
            udf2: additionalData.udf2 || '',
            udf3: additionalData.udf3 || '',
        };

        console.log('[BBPS] fetchBill plaintext payload:', JSON.stringify(payload, null, 2));
        const result = await post(cfg.paths.fetchBill, payload);
        console.log('[BBPS] fetchBill result meta:', JSON.stringify(result.meta, null, 2));
        console.log('[BBPS] fetchBill result data:', JSON.stringify(result.data, null, 2));

        if (result.meta.responseCode !== '000') {
            throw new Error(`Fetch bill failed: ${result.meta.message}`);
        }
        const billerResponse = result.data?.billerResponse || result.data || {};
        if (!billerResponse.fetchRefId) throw new Error('Fetch Bill response missing fetchRefId');
        debugLog(`Bill fetched | fetchRefId=${billerResponse.fetchRefId} amount=${billerResponse.amount}`);
        return billerResponse;
    }

    // ------------------------------------------------------------------
    // Pay bill (step 2)
    // ------------------------------------------------------------------
    async payNow(request, fetchBillResult) {
        const cfg = getConfig();
        const { transaction_id, additionalData = {}, amount: userAmount } = request;
        let merchantCode = additionalData.merchantCode;
        if (!merchantCode) {
            merchantCode = fetchBillResult?.merchantCode;
            if (!merchantCode) throw new Error('Merchant code is required for payment');
        }
        const merchantRefId = String(transaction_id || Date.now());
        const billerId = fetchBillResult.billerId || fetchBillResult.billerCode;
        if (!billerId) throw new Error('Biller ID (or Biller Code) is missing from fetch result');
        const fetchRefId = fetchBillResult.fetchRefId;
        if (!fetchRefId) throw new Error('FetchRefId is missing – please fetch bill first');

        let txnAmount = userAmount;
        if (!txnAmount || isNaN(parseFloat(txnAmount))) {
            txnAmount = fetchBillResult.amount;
        }
        if (!txnAmount) throw new Error('Bill amount is missing');

        const customerParam = fetchBillResult.customerParam || additionalData.customerParams || [];
        const payload = {
            billerId,
            fetchRefId,
            merchantRefId,
            merchantCode,
            txnAmount: parseFloat(txnAmount).toFixed(2),
            customerParam,
            lat: additionalData.lat || '0.0',
            long: additionalData.long || '0.0',
            udf1: additionalData.udf1 || '',
            udf2: additionalData.udf2 || '',
            udf3: additionalData.udf3 || '',
        };
        console.log('[BBPS] payNow plaintext payload:', JSON.stringify(payload, null, 2));
        const result = await post(cfg.paths.billPayment, payload);
        const status = result.meta.responseCode === '000' ? 'success' : 'failed';
        const providerTxnId = result.data?.txnId || result.data?.transactionId || null;
        debugLog(`Payment ${status} | providerTxnId=${providerTxnId}`);
        return {
            status,
            provider_txn_id: providerTxnId,
            message: result.meta.message || `Bill payment ${status}`,
            raw_response: result,
        };
    }
}

module.exports = new BBPSBillPay();