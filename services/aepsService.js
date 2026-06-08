const axios = require('axios');
const encryptionService = require('./encryptionService');

const crypto = require('crypto');
const mockOtpStore = require('../utils/mockOtpStore');
const MOCK_OTP = process.env.MOCK_OTP === 'true';

const stateToNumericMap = {
    'AN': '01', 'AP': '02', 'AR': '03', 'AS': '04', 'BR': '05',
    'CG': '06', 'CH': '07', 'DD': '08', 'DL': '09', 'GA': '10',
    'GJ': '11', 'HP': '12', 'HR': '13', 'JH': '14', 'JK': '15',
    'KA': '16', 'KL': '17', 'LA': '18', 'LD': '19', 'MH': '20',
    'ML': '21', 'MN': '22', 'MP': '23', 'MZ': '24', 'NL': '25',
    'OD': '26', 'PB': '27', 'RJ': '28', 'SK': '29', 'TN': '30',
    'TG': '31', 'TR': '32', 'UP': '33', 'UK': '34', 'WB': '35'
};

function getNumericStateCode(abbr) {
    return stateToNumericMap[abbr] || abbr;
}

function decrypt(encryptedText) {
    const key = Buffer.from(this.encryptDecryptKey, 'utf8'); // 32-byte key
    const iv = Buffer.from(this.encryptDecryptKey.substring(0, 16), 'utf8'); // typical IV derivation
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
class AepsService {
    constructor() {
        this.baseURL = process.env.VIMOPAY_BASE_URL  || 'https://gateway.vimopay.in';
        this.secretKey = process.env._secretKey;
        this.saltKey = process.env._saltKey;
        this.userId = process.env._userId;
        this.encryptDecryptKey = process.env.ENCRYPT_DECRYPT_KEY; // ✅ ADD THIS

        this.bearerToken = null;
        this.tokenExpiry = null;
    }

    /**
     * Make API request to provider
     */
 async makeRequest(endpoint, method = 'POST', data = null, useAuth = true) {
    const headers = {
        'Content-Type': 'application/json',
        'userId': this.userId,
    };

    const authEndpoint = '/aepsapi/api/signature/authorizeuat';

    if (useAuth && endpoint !== authEndpoint) {
        if (!this.bearerToken || this.isTokenExpired()) {
            await this.authorize();
        }
        headers['Authorization'] = `Bearer ${this.bearerToken}`;
    }

    if (endpoint === authEndpoint) {
        headers['secretKey'] = this.secretKey;
        headers['saltKey'] = this.saltKey;
        headers['encryptdecryptKey'] = this.encryptDecryptKey;
    }


   
        // ✅ Debug — remove after confirmed working
    console.log('secretKey:', this.secretKey ? '✅ set' : '❌ UNDEFINED');
    console.log('saltKey:', this.saltKey ? '✅ set' : '❌ UNDEFINED');
    console.log('encryptdecryptKey:', this.encryptDecryptKey ? '✅ set' : '❌ UNDEFINED');
    console.log('userId:', this.userId ? '✅ set' : '❌ UNDEFINED');

    const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers,
        timeout: 30000,
    };

    if (data) {
        config.data = encryptionService.prepareRequest(data);
    }

    try {

        console.log('Request headers:', JSON.stringify(headers));
        console.log('Request URL:', `${this.baseURL}${endpoint}`);
        console.log('REQUEST BODY:', JSON.stringify(config.data));
        
        const response = await axios(config);

        // ✅ Auth endpoint returns plain JSON — never encrypted
        if (endpoint === authEndpoint) {
            console.log('Auth raw response:', JSON.stringify(response.data));
            return response.data;
        }
 // In makeRequest, before parseResponse:
        const rawData = response.data;
        console.log('DISTRICT RAW RESPONSE:', JSON.stringify(rawData).substring(0, 200));
        return encryptionService.parseResponse(rawData);

        return encryptionService.parseResponse(response.data);

    } catch (error) {
        console.error(`API Error [${endpoint}]:`, error.response?.data || error.message);
        throw new Error(error.response?.data?.message || `API call failed: ${error.message}`);
    }
}

    /**
     * Check if token is expired
     */
    isTokenExpired() {
        return !this.tokenExpiry || Date.now() >= this.tokenExpiry;
    }

    /**
     * 1. Authorization API - Get Bearer Token
     */
    async authorize() {
    try {
        const requestData = {
            userId: this.userId,
            timestamp: new Date().toISOString()
        };

        const response = await this.makeRequest(
            '/aepsapi/api/signature/authorizeuat',
            'POST',
            requestData,
            false
        );


        console.log('Parsed auth response:', JSON.stringify(response));

        // ✅ Extract token from wherever the server puts it
        const token = response.token
            || response.data?.token
            || response.data
            || response.bearerToken;

        if (!token) {
            throw new Error(`No token found in response: ${JSON.stringify(response)}`);
        }

        this.bearerToken = token;
        this.tokenExpiry = Date.now() + (55 * 60 * 1000); // 55 minutes from now
        console.log('✅ Authorization successful');
        return this.bearerToken;

    } catch (error) {
        console.error('Authorization failed:', error);
        throw new Error(`Authorization failed: ${error.message}`);
    }
}
    /**
     * 2. Get Bank List
     */
async getBankList() {
    try {
        // Ensure we have a valid Bearer token
        if (!this.bearerToken || this.isTokenExpired()) {
                     console.log('🔄 Token missing/expired, re-authorizing...');

            await this.authorize();
        }
 console.log('🔑 Bearer token exists:', !!this.bearerToken);
        console.log('🔑 Token preview:', this.bearerToken?.substring(0, 20));
        const url = `${this.baseURL}/masterapi/api/master/banklistuat`;
        const response = await axios.get(url, {
            headers: {
                'Content-Type': 'application/json',
                'userId': this.userId,
                'Authorization': `Bearer ${this.bearerToken}`
            },
            timeout: 15000
        });

        const encryptedData = response.data?.data;
        if (!encryptedData) {
            throw new Error('No data field in bank list response');
        }

        const decryptedString = encryptionService.decrypt(encryptedData);
        const bankList = JSON.parse(decryptedString);   // should be an array
        console.log('🔍 Decrypted bank list sample:', JSON.stringify(bankList[0]));

        // Map to a simple { code, name } structure
        return {
            success: true,
            data: bankList.map(b => ({
                code: b.bankCode || b.code,    // usually numeric string
                name: b.bankName || b.description || b.name
            }))
        };
    } catch (error) {
        console.error('❌ Bank list error:', error.message);
        return { success: false, data: [], error: error.message };
    }
}  

    /**
     * 3. Get State List
     */
async getStateList() {
    try {
        // Ensure we have a valid Bearer token
        if (!this.bearerToken || this.isTokenExpired()) {
            await this.authorize();
        }

        const url = `${this.baseURL}/masterapi/api/master/statelistuat`;
        const response = await axios.get(url, {
            headers: {
                'Content-Type': 'application/json',
                'userId': this.userId,
                'Authorization': `Bearer ${this.bearerToken}`
            },
            timeout: 15000
        });

        // The response is { successStatus, data: "encryptedString" }
        const encryptedData = response.data?.data;
        if (!encryptedData) {
            throw new Error('No data field in response');
        }

        // ✅ Decrypt the data field (use your existing encryptionService)
        const decryptedString = encryptionService.decrypt(encryptedData);
        // If your encryptionService doesn't have a simple decrypt() method,
        // you can implement it inline using crypto (see note below).

        const stateList = JSON.parse(decryptedString);  // should be an array
        console.log('🔍 Decrypted state list sample:', JSON.stringify(stateList[0])); // log first state

        // Map to standard format
     return {
    success: true,
    data: stateList.map(s => ({
        stateId: s.code,                         // original abbreviation
        name: s.description,
        code: s.code,                            // keep for compatibility
        numericCode: getNumericStateCode(s.code) 
            }))
        };
    } catch (error) {
        console.error('❌ State list error:', error.message);
        return { success: false, data: [], error: error.message };
    }
}
    /**
     * ✅ District List – encrypted request & response, uses makeRequest
     */
 async getDistrictList(stateCode) {
    if (!stateCode) throw new Error('stateCode is required');

    try {
        const encryptedResponse = await this.makeRequest(
            '/aepsapi/api/payment/acquiredistrictuat',
            'POST',
            { stateCode }
        );

        // makeRequest already returns decrypted? Actually it might also return the encrypted data.
        // But we can do the same manual decryption if needed.
        // Since we're unsure, let's also manually decrypt the 'data' field from the raw response.
        // We'll call the API directly with makeRequest but then decrypt ourselves.

        // For districts, the response is still encrypted. We'll replicate the GET pattern:
        if (!this.bearerToken || this.isTokenExpired()) {
            await this.authorize();
        }
        const url = `${this.baseURL}/aepsapi/api/payment/acquiredistrictuat`;
        const response = await axios.post(url, encryptionService.prepareRequest({ stateCode }), {
            headers: {
                'Content-Type': 'application/json',
                'userId': this.userId,
                'Authorization': `Bearer ${this.bearerToken}`
            },
            timeout: 30000
        });

        const encryptedData = response.data?.data;
        if (!encryptedData) throw new Error('No data field in district response');

        const decryptedString = encryptionService.decrypt(encryptedData);
        const districtList = JSON.parse(decryptedString);
        
        console.log('🔍 District sample:', JSON.stringify(districtList[0]));

        // Map to your District model
        return {
            success: true,
            data: districtList.map(d => ({
                code: d.districtCode || d.code,
                name: d.districtName || d.description || d.name
            }))
        };
    } catch (error) {
        console.error('❌ District list error:', error.message);
        return { success: false, data: [], error: error.message };
    }
}

    
 async registerMerchant(merchantData) {
    const requestData = {
        firstName: merchantData.firstName,
        middleName: merchantData.middleName || '',
        lastName: merchantData.lastName || '',
        dob: merchantData.dob,
        emailId: merchantData.emailId,
        merchantPhoneNumber: merchantData.mobileNo,
        aadhaarNumber: merchantData.aadhaarNo,
        merchantPan: merchantData.panNo,
        gender: merchantData.gender,
        merchantAddress1: merchantData.merchantAddress1,
        merchantAddress2: merchantData.merchantAddress2 || '',
        merchantState: merchantData.merchantState,
        merchantDistrict: merchantData.merchantDistrict,
        merchantPinCode: merchantData.merchantPinCode,
        shopPan: merchantData.shopPan,
        bankAccountNumber: merchantData.bankAccountNumber,
        bankIfscCode: merchantData.bankIfscCode,
        bankName: merchantData.bankName,
        accountType: merchantData.accountType,
        shopAddress: merchantData.shopAddress,
        shopDistrict: merchantData.shopDistrict,
        shopState: merchantData.shopState,
        shopPinCode: merchantData.shopPinCode,
        shopLat: merchantData.shopLat,
        shopLong: merchantData.shopLong,
        lat: merchantData.lat,
        long: merchantData.long,
        ipAddress: merchantData.ipAddress,
        merchantRefId: merchantData.merchantRefId,
        pipe: merchantData.pipe || "1"
    };

       // UAT fallback
    // Send the encrypted request (makeRequest already encrypts payload)
    const rawResponse = await this.makeRequest('/aepsapi/api/payment/merchantonboarduat', 'POST', requestData);

    // Always try to decrypt the 'data' field (both success and failure)
    if (rawResponse && rawResponse.data && typeof rawResponse.data === 'string') {
        const decryptedString = encryptionService.decrypt(rawResponse.data);
        if (decryptedString) {
            try {
                const parsed = JSON.parse(decryptedString);
                // Merge decrypted fields into the response object
                Object.assign(rawResponse, parsed);
                console.log('✅ Decrypted registration response:', parsed);
            } catch (e) {
                console.error('❌ Failed to parse decrypted JSON:', e.message);
            }
        } else {
            console.warn('⚠️ Decryption returned null for registration response');
        }
    }

    return rawResponse;
}
    /**
     * 6. Send OTP
     */
    // async sendOtp(merchantId, mobileNo, merchantRefId) {
    //     const requestData = {
    //         merchantId,
    //         mobileNo,
    //         merchantRefId,
    //         pipe: "1"
    //     };
    //     const response = await this.makeRequest('/aepsapi/api/payment/sendotpuat', 'POST', requestData);
    //     return response;
    // }

    /**
     * 7. Resend OTP
     */
    async resendOtp(merchantId, merchantRefId) {
        const requestData = {
            merchantId,
            merchantRefId,
            pipe: "1"
        };
        const response = await this.makeRequest('/aepsapi/api/payment/resendotput', 'POST', requestData);
        return response;
    }

    /**
     * 8. Verify OTP
     */
    // async verifyOtp(merchantId, otp, merchantRefId) {
    //     const requestData = {
    //         merchantId,
    //         otp,
    //         merchantRefId,
    //         pipe: "1"
    //     };
    //     const response = await this.makeRequest('/aepsapi/api/payment/validateoutput', 'POST', requestData);
    //     return response;
    // }



async sendOtp(merchantId, mobileNo, merchantRefId) {
    if (MOCK_OTP) {
        const otp = "123456";   // fixed for testing
        mockOtpStore.setOtp(merchantRefId, otp);
        console.log(`[MOCK OTP] OTP ${otp} saved for refId ${merchantRefId}`);
        return { status: "000", message: "OTP sent successfully (mock)" };
    }

    const requestData = { merchantId, mobileNo, merchantRefId, pipe: "1" };
    return await this.makeRequest('/aepsapi/api/payment/sendotpuat', 'POST', requestData);
}

async verifyOtp(req, res) {
    try {
        const { merchantId, otp, merchantRefId } = req.body;

        if (!merchantId || !otp) {
            return res.status(400).json({
                success: false,
                message: 'merchantId and otp are required'
            });
        }

        const response = await aepsService.verifyOtp(merchantId, otp, merchantRefId);

        if (response.status === '000' || response.responseCode === '000') {
            // ✅ Update merchant status to active/verified
            await MerchantModel.updateStatus(merchantId, 'verified');
            // or 'active' depending on your column values
            console.log(`Merchant ${merchantId} verified successfully`);
        }

        res.json({
            success: response.status === '000' || response.responseCode === '000',
            data: response
        });
    } catch (error) {
        console.error('Verify OTP Error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

    /**
     * 9. 2 Factor Authentication (Biometric)
     */
/**
 * 9. 2 Factor Authentication (Biometric) - FIXED
 * 
 * Issue: Server expects encrypted request body, not plain JSON
 * Fix: Use encryptionService.prepareRequest() like registerMerchant
 */
async twoFactorAuth(merchantId, aadhaarNumber, pidData, deviceType, merchantRefId) {
    try {
        // Ensure we have a valid Bearer token
        if (!this.bearerToken || this.isTokenExpired()) {
            console.log('Token missing or expired, re-authorizing...');
            await this.authorize();
        }

        const requestData = {
            merchantId,
            aadhaarNumber,
            pidData,
            deviceType,
            merchantRefId,
            pipe: "1"
        };

        const url = `${this.baseURL}/aepsapi/api/payment/2fauat`;
        
        console.log('2FA Request:');
        console.log('  URL:', url);
        console.log('  merchantId:', merchantId);
        console.log('  aadhaarNumber:', aadhaarNumber);
        console.log('  deviceType:', deviceType);
        console.log('  merchantRefId:', merchantRefId);
        
        // ✅ FIX: Encrypt request body using encryptionService (like registerMerchant)
        const encryptedBody = encryptionService.prepareRequest(requestData);
        
        console.log('Encrypted 2FA body:', encryptedBody);
        
        const response = await axios.post(url, encryptedBody, {
            headers: {
                'Content-Type': 'application/json',
                'userId': this.userId,
                'Authorization': `Bearer ${this.bearerToken}`
            },
            timeout: 30000
        });

        console.log('2FA raw response:', JSON.stringify(response.data));

        const rawData = response.data;
        
        // Check if response has encrypted data field
        if (rawData.successStatus === true && rawData.data) {
            try {
                const decrypted = encryptionService.decrypt(rawData.data);
                const parsed = JSON.parse(decrypted);
                return parsed;
            } catch (e) {
                console.log('2FA response not encrypted, using direct data');
                return rawData;
            }
        }

        return rawData;

    } catch (error) {
        console.error('2FA Error:', error.response?.data || error.message);
        
        // Check for unauthorized - try re-authorizing once
        if ((error.response?.status === 401 || error.response?.status === 403) ||
            error.message?.toLowerCase().includes('unauthorized')) {
            
            console.log('Got unauthorized, clearing token and retrying...');
            this.bearerToken = null;
            this.tokenExpiry = null;
            
            // Retry once
            return await this.twoFactorAuth(
                merchantId, 
                aadhaarNumber, 
                pidData, 
                deviceType, 
                merchantRefId
            );
        }
        
        const errorMsg = error.response?.data?.message 
            || error.response?.data?.error 
            || error.message;
        throw new Error(errorMsg || '2FA failed');
    }
}

    /**
     * 10. AEPS Transaction
     * serviceType: 'CW' (Cash Withdrawal), 'BE' (Balance Enquiry), 'MS' (Mini Statement)
     */
 async aepsTransaction(transactionData) {
    try {
        if (!this.bearerToken || this.isTokenExpired()) {
            console.log('Token missing/expired, re-authorizing...');
            await this.authorize();
        }

        const {
            serviceType,
            merchantId,
            aadhaarNumber,
            mobileNo,
            bankIIN,
            amount,
            pidData,
            deviceType,
            merchantRefId,
            latitude,
            longitude,
            ipAddress
        } = transactionData;

        const requestData = {
            transactionType: serviceType,
            merchantRefId:   merchantRefId,
            merchantId:      merchantId,
            aadhaarNumber:   aadhaarNumber,
            mobileNumber:    mobileNo,
            amount:          amount || '0',
            bankIIN:         bankIIN,
            ipAddress:       ipAddress || '192.168.1.1',
            pipe:            '1',
            lat:             latitude  || '0',
            long:            longitude || '0',
            deviceType:      deviceType || 'mantra',
            pidData:         pidData,
            udf1:            '',
            udf2:            '',
            udf3:            ''
        };

        console.log('📦 requestData before encrypt:', JSON.stringify(requestData, null, 2));

        // ✅ Encrypt the request exactly like in getStateList (using prepareRequest)
        const encryptedBody = encryptionService.prepareRequest(requestData);
        const url = `${this.baseURL}/aepsapi/api/payment/aepstransaction`;

        const response = await axios.post(url, encryptedBody, {
            headers: {
                'Content-Type': 'application/json',
                'userId': this.userId,
                'Authorization': `Bearer ${this.bearerToken}`
            },
            timeout: 60000
        });

        console.log('📥 AEPS raw response:', JSON.stringify(response.data));

        // ✅ SIMPLIFIED DECRYPTION – same as getStateList
        const encryptedData = response.data?.data;
        if (!encryptedData) {
            console.error('❌ No data field in response');
            return response.data;
        }

        const decryptedString = encryptionService.decrypt(encryptedData);
        if (!decryptedString) {
            console.error('❌ Decryption failed');
            return response.data;
        }

        const parsed = JSON.parse(decryptedString);
        console.log('📥 Decrypted response:', JSON.stringify(parsed, null, 2));
        return parsed;

    } catch (error) {
        console.error('❌ AEPS Transaction Error:', error.message);
        console.error('Stack:', error.stack);

        if (error.response?.status === 401 || error.response?.status === 403) {
            console.log('🔄 Retrying with new token...');
            this.bearerToken = null;
            this.tokenExpiry = null;
            return await this.aepsTransaction(transactionData);
        }

        throw new Error(
            error.response?.data?.message ||
            error.response?.data?.error ||
            error.message ||
            'Transaction failed'
        );
    }
}

    /**
     * 11. Transaction Status Check
     */
    async transactionStatus(merchantId, merchantRefId) {
        const requestData = {
            merchantId,
            merchantRefId
        };
        const response = await this.makeRequest('/aepsapi/api/payment/transactionstatus', 'POST', requestData);
        return response;
    }
}

module.exports = new AepsService();


