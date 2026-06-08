// services/DMT/dmtService.js
const axios = require('axios');
const encryptionService = require('../encryptionService');
const pool = require('../../config/db')


class DMTService {
    constructor() {
        this.token = null;
        this.tokenExpiry = null;
    }

    // ----- Token Management -----
    async getToken(forceRefresh = false) {
        if (!forceRefresh && this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.token;
        }
        try {
            const url = `${encryptionService.baseUrl}/dmtapi/api/Signature/Authorizeuat`;
            const headers = encryptionService.getAuthHeaders();
            const response = await axios.post(url, {}, { headers });
            if (response.data && response.data.successStatus) {
                this.token = encryptionService.extractBearerToken(response.data);
                this.tokenExpiry = Date.now() + 55 * 60 * 1000;
                return this.token;
            } else {
                throw new Error('Failed to obtain token: ' + JSON.stringify(response.data));
            }
        } catch (error) {
            console.error('Token acquisition error:', error.message);
            throw error;
        }
    }

    // ----- Generic Encrypted Request (for DMT endpoints) -----
    async _request(endpoint, payload, retryOnAuth = true) {
        const token = await this.getToken();
        const url = `${encryptionService.baseUrl}${endpoint}`;
        const encryptedBody = encryptionService.prepareRequest(payload);
        const headers = encryptionService.getAuthenticatedHeaders(token);
        try {
            const response = await axios.post(url, encryptedBody, { headers });
            const parsed = encryptionService.parseResponse(response.data);
            return parsed;
        } catch (error) {
            if (error.response?.status === 401 && retryOnAuth) {
                console.log('Token expired, refreshing...');
                await this.getToken(true);
                return this._request(endpoint, payload, false);
            }
            throw error;
        }
    }

    // ----- Unencrypted Master API Requests -----
    async _getUnencrypted(endpoint) {
        const token = await this.getToken();
        const url = `${encryptionService.baseUrl}${endpoint}`;
        const headers = encryptionService.getAuthenticatedHeaders(token);
        const response = await axios.get(url, { headers });
        // Master APIs return plain JSON inside { data: ... } – just return the data
        return response.data.data || response.data;
    }

    async _postUnencrypted(endpoint, body) {
        const token = await this.getToken();
        const url = `${encryptionService.baseUrl}${endpoint}`;
        const headers = encryptionService.getAuthenticatedHeaders(token);
        const response = await axios.post(url, body, { headers });
        return response.data.data || response.data;
    }

    // ----- Helper -----
    generateMerchantRefId() {
        return 'MR' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
    }

    // ========== MASTER DATA ENDPOINTS (no encryption) ==========
async getStates() {
    try {
        const token = await this.getToken();
        const url = `${encryptionService.baseUrl}/masterapi/api/master/statelistuat`;
        const headers = encryptionService.getAuthenticatedHeaders(token);
        const response = await axios.get(url, { headers });

        const encryptedData = response.data?.data;
        if (!encryptedData) throw new Error('No data field in state response');

        const decryptedString = encryptionService.decrypt(encryptedData);
        if (!decryptedString) throw new Error('Decryption failed for states');

        const rawStates = JSON.parse(decryptedString);
        console.log('✅ States decrypted, count:', rawStates.length);
        console.log('🔍 First 3 states:', JSON.stringify(rawStates.slice(0, 3)));
        console.log('🔍 State codes:', rawStates.map(s => s.code?.trim()));

        return { success: true, data: rawStates };
    } catch (error) {
        console.error('❌ getStates error:', error.message);
        return { success: false, data: [], error: error.message };
    }
}

// async getCities(stateCode) {
//     try {
//         const token = await this.getToken();

//         // ✅ Use the exact stateCode as-is from Vimopay's own state list
//         const cleanStateCode = stateCode.trim();
//         console.log('🔍 getCities called with raw:', JSON.stringify(stateCode));
//         console.log('🔍 getCities cleaned:', JSON.stringify(cleanStateCode));

//         const url = `${encryptionService.baseUrl}/masterapi/api/master/city`;
//         const headers = encryptionService.getAuthenticatedHeaders(token);

//         // Try 1: plain body (no encryption) — some APIs encrypt response but accept plain request
//         console.log('🔍 Attempt 1: POST with plain stateCode body');
//         try {
//             const response = await axios.post(
//                 url,
//                 { stateCode: cleanStateCode },
//                 { headers }
//             );
//             console.log('✅ Attempt 1 success:', response.status, JSON.stringify(response.data).substring(0, 100));
//             const encryptedData = response.data?.data;
//             if (encryptedData) {
//                 const decryptedString = encryptionService.decrypt(encryptedData);
//                 const rawCities = JSON.parse(decryptedString);
//                 console.log('✅ Cities decrypted, count:', rawCities.length);
//                 return { success: true, data: rawCities };
//             }
//         } catch (e1) {
//             console.error('❌ Attempt 1 failed:', e1.response?.status, e1.response?.headers?.allow);
//         }

//         // Try 2: GET with query param
//         console.log('🔍 Attempt 2: GET with ?stateCode=');
//         try {
//             const response = await axios.get(
//                 `${url}?stateCode=${encodeURIComponent(cleanStateCode)}`,
//                 { headers }
//             );
//             console.log('✅ Attempt 2 success:', response.status, JSON.stringify(response.data).substring(0, 100));
//             const encryptedData = response.data?.data;
//             if (encryptedData) {
//                 const decryptedString = encryptionService.decrypt(encryptedData);
//                 const rawCities = JSON.parse(decryptedString);
//                 console.log('✅ Cities decrypted, count:', rawCities.length);
//                 return { success: true, data: rawCities };
//             }
//         } catch (e2) {
//             console.error('❌ Attempt 2 failed:', e2.response?.status);
//             console.error('❌ Attempt 2 response body:', JSON.stringify(e2.response?.data));  // 👈 add this
//             console.error('❌ Attempt 2 full URL:', e2.config?.url);          }

//         // Try 3: POST with encrypted requestBody (original approach)
//         console.log('🔍 Attempt 3: POST with encrypted requestBody');
//         try {
//             const encryptedBody = encryptionService.encrypt(JSON.stringify({ stateCode: cleanStateCode }));
//             const response = await axios.post(
//                 url,
//                 { requestBody: encryptedBody },
//                 { headers }
//             );
//             console.log('✅ Attempt 3 success:', response.status, JSON.stringify(response.data).substring(0, 100));
//             const encryptedData = response.data?.data;
//             if (encryptedData) {
//                 const decryptedString = encryptionService.decrypt(encryptedData);
//                 const rawCities = JSON.parse(decryptedString);
//                 console.log('✅ Cities decrypted, count:', rawCities.length);
//                 return { success: true, data: rawCities };
//             }
//         } catch (e3) {
//             console.error('❌ Attempt 3 failed:', e3.response?.status, e3.response?.headers?.allow);
//         }
// // Attempt 4: POST with { request: { stateCode } }
// console.log('🔍 Attempt 4: POST with { request: { stateCode } }');
// try {
//     const response = await axios.post(
//         url,
//         { request: { stateCode: cleanStateCode } },
//         { headers }
//     );
//     console.log('✅ Attempt 4 success:', response.status, JSON.stringify(response.data).substring(0, 100));
// } catch (e4) {
//     console.error('❌ Attempt 4 failed:', e4.response?.status, JSON.stringify(e4.response?.data));
// }

// // Attempt 5: POST with { request: stateCode } (flat string)
// console.log('🔍 Attempt 5: POST with { request: "AN" }');
// try {
//     const response = await axios.post(
//         url,
//         { request: cleanStateCode },
//         { headers }
//     );
//     console.log('✅ Attempt 5 success:', response.status, JSON.stringify(response.data).substring(0, 100));
// } catch (e5) {
//     console.error('❌ Attempt 5 failed:', e5.response?.status, JSON.stringify(e5.response?.data));
// }

// // Attempt 6: POST with encrypted body under "request" key
// console.log('🔍 Attempt 6: POST with { request: encryptedPayload }');
// try {
//     const encryptedBody = encryptionService.encrypt(JSON.stringify({ stateCode: cleanStateCode }));
//     const response = await axios.post(
//         url,
//         { request: encryptedBody },
//         { headers }
//     );
//     console.log('✅ Attempt 6 success:', response.status, JSON.stringify(response.data).substring(0, 100));
// } catch (e6) {
//     console.error('❌ Attempt 6 failed:', e6.response?.status, JSON.stringify(e6.response?.data));
// }

// // Attempt 7: GET with body { request: { stateCode } }
// console.log('🔍 Attempt 7: GET with body');
// try {
//     const response = await axios.get(url, {
//         headers,
//         data: { request: { stateCode: cleanStateCode } }  // body on GET
//     });
//     console.log('✅ Attempt 7 success:', response.status, JSON.stringify(response.data).substring(0, 100));
// } catch (e7) {
//     console.error('❌ Attempt 7 failed:', e7.response?.status, JSON.stringify(e7.response?.data));
// }

// // Attempt 8: GET with encrypted body
// console.log('🔍 Attempt 8: GET with encrypted body');
// try {
//     const encryptedBody = encryptionService.encrypt(JSON.stringify({ stateCode: cleanStateCode }));
//     const response = await axios.get(url, {
//         headers,
//         data: { request: encryptedBody }
//     });
//     console.log('✅ Attempt 8 success:', response.status, JSON.stringify(response.data).substring(0, 100));
// } catch (e8) {
//     console.error('❌ Attempt 8 failed:', e8.response?.status, JSON.stringify(e8.response?.data));
// }

// // Attempt 9: GET with plain stateCode in body
// console.log('🔍 Attempt 9: GET with { stateCode } in body');
// try {
//     const response = await axios.get(url, {
//         headers,
//         data: { stateCode: cleanStateCode }
//     });
//     console.log('✅ Attempt 9 success:', response.status, JSON.stringify(response.data).substring(0, 100));
// } catch (e9) {
//     console.error('❌ Attempt 9 failed:', e9.response?.status, JSON.stringify(e9.response?.data));
// }

// // Attempt 10: GET with { requestBody: encryptedPayload } ← exact field name from error
// console.log('🔍 Attempt 10: GET with { requestBody: encrypted }');
// try {
//     const encryptedBody = encryptionService.encrypt(JSON.stringify({ stateCode: cleanStateCode }));
//     console.log('🔍 Encrypted:', encryptedBody.substring(0, 30) + '...');
//     const response = await axios.get(url, {
//         headers,
//         data: { requestBody: encryptedBody }  // ✅ exact key from error message
//     });
//     console.log('✅ Attempt 10 success:', response.status, JSON.stringify(response.data).substring(0, 100));
// } catch (e10) {
//     console.error('❌ Attempt 10 failed:', e10.response?.status, JSON.stringify(e10.response?.data));
// }

// // Attempt 11: GET with { requestBody: encrypted plain stateCode string (not JSON)  }
// console.log('🔍 Attempt 11: GET with { requestBody: encrypt(stateCode only) }');
// try {
//     const encryptedBody = encryptionService.encrypt(cleanStateCode); // just the code, no JSON wrapper
//     const response = await axios.get(url, {
//         headers,
//         data: { requestBody: encryptedBody }
//     });
//     console.log('✅ Attempt 11 success:', response.status, JSON.stringify(response.data).substring(0, 100));
// } catch (e11) {
//     console.error('❌ Attempt 11 failed:', e11.response?.status, JSON.stringify(e11.response?.data));
// }

//         throw new Error('All attempts failed');

//     } catch (error) {
//         console.error('❌ getCities final error:', error.message);
//         return { success: false, data: [], error: error.message };
//     }
    
// }

async getCities(stateCode) {
    try {
        const token = await this.getToken();
        const url = `${encryptionService.baseUrl}/masterapi/api/master/city`;
        const headers = encryptionService.getAuthenticatedHeaders(token);

        const encryptedBody = encryptionService.encrypt(JSON.stringify({ stateCode: stateCode.trim() }));

        // ✅ GET with encrypted requestBody in body
        const response = await axios.get(url, {
            headers,
            data: { requestBody: encryptedBody }
        });

        const encryptedData = response.data?.data;
        if (!encryptedData) throw new Error('No data field in city response');

        const decryptedString = encryptionService.decrypt(encryptedData);
        if (!decryptedString) throw new Error('Decryption failed for cities');

        const rawCities = JSON.parse(decryptedString);
        console.log('✅ Cities decrypted, count:', rawCities.length);
        return { success: true, data: rawCities };

    } catch (error) {
        console.error('❌ getCities error:', error.message);
        if (error.response?.data) console.error('Response data:', JSON.stringify(error.response.data));
        return { success: false, data: [], error: error.message };
    }
}

async getBanks() {
    try {
        // Get valid Bearer token (handles refresh internally)
        const token = await this.getToken();
        const url = `${encryptionService.baseUrl}/masterapi/api/master/banklistuat`;
        const headers = encryptionService.getAuthenticatedHeaders(token);
        
        const response = await axios.get(url, { headers });
        
        const encryptedData = response.data?.data;
        if (!encryptedData) {
            throw new Error('No data field in bank response');
        }
        
        const decryptedString = encryptionService.decrypt(encryptedData);
        if (!decryptedString) {
            throw new Error('Decryption failed for banks');
        }
        
        const rawBanks = JSON.parse(decryptedString);
        console.log('✅ Banks decrypted, count:', rawBanks.length);
        
        // Normalise to { code, name } structure
        const mappedBanks = rawBanks.map(b => ({
            code: b.bankCode || b.code,
            name: b.bankName || b.description || b.name
        }));
        
        return { success: true, data: mappedBanks };
    } catch (error) {
        console.error('❌ Bank list error:', error.message);
        return { success: false, data: [], error: error.message };
    }
}

    // ========== DMT TRANSACTION ENDPOINTS (encrypted) ==========
async agentRegistration(data) {
    try {
        const payload = {
            ...data,
            merchantRefId: this.generateMerchantRefId(),
            ip: data.ip || '127.0.0.1',
            lat: data.lat || '0.0',
            long: data.long || '0.0'
        };

        console.log('📤 [agentRegistration] Sending payload:', payload);

        // 1. Call external Vimopay API
        const response = await this._request('/dmtapi/api/Registration/AgentRegistrationuat', payload);
        console.log('📥 [agentRegistration] Raw response:', JSON.stringify(response));

        const encryptedData = response?.data;
        if (!encryptedData) {
            console.error('❌ No data field in registration response');
            return { success: false, message: 'No data field in response' };
        }

        console.log('🔐 Encrypted data length:', encryptedData.length);

        // 2. Decrypt the response
        const decryptedString = encryptionService.decrypt(encryptedData);
        if (!decryptedString) {
            console.error('❌ Decryption failed');
            return { success: false, message: 'Decryption failed' };
        }

        console.log('✅ Decrypted string:', decryptedString);

        const decryptedData = JSON.parse(decryptedString);
        console.log('📦 Parsed decrypted data:', decryptedData);

        // 3. Extract agent code (try multiple possible keys)
        let agentCode = decryptedData.agentCode || decryptedData.AgentCode || decryptedData.code || null;
        if (!agentCode) {
            console.error('❌ No agentCode found in decrypted data');
            return { success: false, message: 'Agent code missing in response' };
        }

        // 4. Save to PostgreSQL (non‑blocking – don’t throw if DB fails)
        try {
            const insertQuery = `
                INSERT INTO agents (
                    agent_code, agent_mobile, agent_pan, agent_name, agent_dob,
                    agent_gender, agent_shop_name, agent_state, agent_city,
                    ip, lat, long
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (agent_code) DO UPDATE
                SET
                    agent_mobile = EXCLUDED.agent_mobile,
                    agent_pan = EXCLUDED.agent_pan,
                    updated_at = CURRENT_TIMESTAMP;
            `;

            const values = [
                agentCode,                     // $1
                data.agentMobile,              // $2
                data.agentPan,                 // $3
                data.agentName,                // $4
                data.agentDob,                 // $5
                data.agentGender,              // $6
                data.agentShopName,            // $7
                data.agentState,               // $8
                data.agentCity,                // $9
                data.ip || '127.0.0.1',        // $10
                data.lat || '0.0',             // $11
                data.long || '0.0'             // $12
            ];

            await pool.query(insertQuery, values);
            console.log('✅ Agent saved to database:', agentCode);
        } catch (dbError) {
            // Log DB error but do not fail the registration – external API already succeeded.
            console.error('⚠️ Failed to save agent to DB:', dbError.message);
        }

        // 5. Return normalized response for Flutter
        return {
            successStatus: true,
            message: decryptedData.message || 'Registration successful',
            responseCode: decryptedData.responseCode || decryptedData.StatusCode,
            agentCode: agentCode,
            ...decryptedData   // include all decrypted fields
        };

    } catch (error) {
        console.error('❌ agentRegistration error:', error.message);
        if (error.response?.data) console.error('Response data:', JSON.stringify(error.response.data));
        return { success: false, message: error.message };
    }
}


async senderRegistration(data) {
    try {
        // Build the plain payload exactly as per API spec (page 57, 63)
        const plainPayload = {
            merchantRefId: this.generateMerchantRefId(),
            senderMobile: data.senderMobile,
            senderName: data.senderName,
            aadhaar: data.aadhaar,
            address: data.address,
            pinCode: data.pinCode,
            agentCode: data.agentCode,
            senderState: data.senderState,
            senderCity: data.senderCity,
            pidData: data.pidData || '<?xml version="1.0" encoding="UTF-8"?><PidOptions ver="1.0"><Opts fCount="1" fType="0" format="0" pidVer="2.0" timeout="10000" otp="" posh="UNKNOWN" env="P" wadh=""/></PidOptions>',
            ip: data.ip || '127.0.0.1',
            lat: data.lat || '0.0',
            long: data.long || '0.0',
            udf1: data.udf1 || '',
            udf2: data.udf2 || '',
            udf3: data.udf3 || ''
        };

        console.log('📤 Sender Registration - Plain Payload:', JSON.stringify(plainPayload, null, 2));

        // Encrypt the payload
        const plainText = JSON.stringify(plainPayload);
        const encryptedBody = encryptionService.encrypt(plainText);

        // Send request with encrypted body
        const response = await this._request('/dmtapi/api/Registration/SenderRegistrationUAT', { requestBody: encryptedBody });
        console.log('📥 Raw encrypted response:', response);

        // Decrypt the 'data' field (if present)
        const encryptedData = response?.data;
        if (!encryptedData) throw new Error('No data field in sender registration response');

        const decryptedString = encryptionService.decrypt(encryptedData);
        if (!decryptedString) throw new Error('Decryption failed for sender registration');

        const decryptedData = JSON.parse(decryptedString);
        console.log('✅ Sender Registration Decrypted Response:', decryptedData);

        // Return the full decrypted response (Flutter expects txnStatus, message, etc.)
        return {
            successStatus: response.successStatus !== undefined ? response.successStatus : true,
            message: decryptedData.message || response.message,
            responseCode: decryptedData.responseCode || response.responseCode,
            ...decryptedData
        };
    } catch (error) {
        console.error('❌ senderRegistration error:', error.message);
        return { successStatus: false, message: error.message };
    }
}
async retriggerSenderOtp(data) {
    try {
        const plainPayload = {
            senderMobile: data.senderMobile,
            senderName: data.senderName,
            merchantRefId: this.generateMerchantRefId(),
            ip: data.ip || '127.0.0.1',
            lat: data.lat || '0.0',
            long: data.long || '0.0'
        };

        console.log('📤 Retrigger OTP - Plain Payload:', JSON.stringify(plainPayload));

        const encryptedBody = encryptionService.encrypt(JSON.stringify(plainPayload));
        
        // Try primary endpoint
        let response;
        try {
            console.log('🔄 Trying primary endpoint: /dmtapi/api/Registration/SenderOtpRetriggerUAT');
            response = await this._request('/dmtapi/api/Registration/SenderOtpRetriggerUAT', { requestBody: encryptedBody });
            console.log('✅ Primary endpoint succeeded');
        } catch (primaryErr) {
            console.warn('⚠️ Primary endpoint failed with status:', primaryErr.response?.status, primaryErr.message);
            console.log('🔄 Trying fallback endpoint: /dmtapi/api/Registration/OtpRetrigerUAT');
            response = await this._request('/dmtapi/api/Registration/OtpRetrigerUAT', { requestBody: encryptedBody });
            console.log('✅ Fallback endpoint succeeded');
        }

        console.log('📥 Raw retrigger response:', JSON.stringify(response));

        const encryptedData = response?.data;
        if (!encryptedData) throw new Error('No data field in retrigger OTP response');

        const decryptedString = encryptionService.decrypt(encryptedData);
        const decryptedData = JSON.parse(decryptedString);
        console.log('✅ Retrigger OTP Decrypted:', decryptedData);

        return {
            successStatus: response.successStatus ?? true,
            message: decryptedData.message || response.message,
            otpLen: decryptedData.otpLen,
            txnStatus: decryptedData.txnStatus,
            ...decryptedData
        };
    } catch (error) {
        console.error('❌ retriggerSenderOtp error:', error.message);
        if (error.response?.data) console.error('Response data:', JSON.stringify(error.response.data));
        if (error.response?.status) console.error('HTTP status:', error.response.status);
        return { successStatus: false, message: error.message };
    }
}

  async verifySenderOtp(data) {
    try {
        const plainPayload = {
            senderMobile: data.senderMobile,
            otpPin: data.otpPin,                     // OTP entered by user
            ip: data.ip || '127.0.0.1',
            lat: data.lat || '0.0',
            long: data.long || '0.0',
            merchantRefId: this.generateMerchantRefId()
        };

        console.log('📤 Verify OTP - Plain Payload:', JSON.stringify(plainPayload));

        const encryptedBody = encryptionService.encrypt(JSON.stringify(plainPayload));
        const response = await this._request('/dmtapi/api/Registration/VerifySenderRegistrationUAT', { requestBody: encryptedBody });
        console.log('📥 Raw verify response:', response);

        const encryptedData = response?.data;
        if (!encryptedData) throw new Error('No data field in verify OTP response');

        const decryptedString = encryptionService.decrypt(encryptedData);
        const decryptedData = JSON.parse(decryptedString);
        console.log('✅ Verify OTP Decrypted:', decryptedData);

        // Typical success response: { txnStatus: "SUCCESS", message: "Customer Registration Successful", ... }
        return {
            successStatus: response.successStatus ?? true,
            message: decryptedData.message || response.message,
            txnStatus: decryptedData.txnStatus,
            txnStatusCode: decryptedData.txnStatusCode,
            ...decryptedData
        };
    } catch (error) {
        console.error('❌ verifySenderOtp error:', error.message);
        return { successStatus: false, message: error.message };
    }
}

async beneficiaryList(data) {
    try {
        const payload = {
            senderMobileNo: data.senderMobileNo,
            pageNumber: String(data.pageNumber || 1),
            pageSize: String(data.pageSize || 10),
            merchantRefId: this.generateMerchantRefId()
        };
        console.log('📤 Beneficiary List Payload:', payload);

        const encryptedBody = encryptionService.encrypt(JSON.stringify(payload));
        const response = await this._request('/dmtapi/api/Registration/BeneficiaryListUAT', { requestBody: encryptedBody });

        const encryptedData = response?.data;
        if (!encryptedData) throw new Error('No data field in beneficiary list response');

        const decryptedString = encryptionService.decrypt(encryptedData);
        const decryptedData = JSON.parse(decryptedString);
        console.log('✅ Beneficiary List Decrypted, count:', decryptedData.beneficiaries?.length);

        return {
            successStatus: true,
            message: decryptedData.message || response.message,
            data: decryptedData.beneficiaries || [],
            ...decryptedData
        };
    } catch (error) {
        console.error('❌ beneficiaryList error:', error.message);
        return { successStatus: false, message: error.message, data: [] };
    }
}

async syncBeneficiaryWithLocalDb(data) {
    const client = await pool.connect();
    try {
        const {
            remitterId,
            accountHolderName,
            accountNumber,
            ifscCode,
            bankName,
            beneCode,
            accountType,
            cityCode,
            pennyDropName,
            beneCity,
            beneState
        } = data;

        // Step 1 – check existence
        const checkResult = await client.query(
            `SELECT id FROM public.dmt_beneficiaries
             WHERE account_number = $1 AND ifsc_code = $2`,
            [accountNumber, ifscCode]
        );

        if (checkResult.rows.length > 0) {
            // Step 2 – update existing
            const updateResult = await client.query(
                `UPDATE public.dmt_beneficiaries
                 SET remitter_id = $1,
                     account_holder_name = $2,
                     bank_name = $3,
                     bene_code = $4,
                     account_type = $5,
                     city_code = $6,
                     penny_drop_name = $7,
                     bene_city = $8,
                     bene_state = $9,
                     is_active = true,
                     verified = true,
                     updated_at = NOW()
                 WHERE account_number = $10 AND ifsc_code = $11
                 RETURNING id`,
                [
                    remitterId, accountHolderName, bankName, beneCode,
                    accountType, cityCode, pennyDropName, beneCity, beneState,
                    accountNumber, ifscCode
                ]
            );
            return {
                success: true,
                message: 'Beneficiary updated locally',
                id: updateResult.rows[0]?.id
            };
        } else {
            // Step 3 – insert new
            const insertResult = await client.query(
                `INSERT INTO public.dmt_beneficiaries(
                    remitter_id, account_holder_name, account_number, ifsc_code,
                    bank_name, bene_code, account_type, city_code,
                    penny_drop_name, bene_city, bene_state,
                    is_active, verified, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, true, NOW(), NOW())
                RETURNING id`,
                [
                    remitterId, accountHolderName, accountNumber, ifscCode,
                    bankName, beneCode, accountType, cityCode,
                    pennyDropName, beneCity, beneState
                ]
            );
            return {
                success: true,
                message: 'Beneficiary synced locally',
                id: insertResult.rows[0].id
            };
        }
    } catch (error) {
        console.error('❌ Local DB sync error:', error.message);
        return { success: false, message: error.message };
    } finally {
        client.release();
    }
}

       
async registerBeneficiary(data) {
    try {
        const plainPayload = {
            ...data,
            merchantRefId: this.generateMerchantRefId(),
            ip: data.ip || '127.0.0.1',
            lat: data.lat || '0.0',
            long: data.long || '0.0'
        };
        console.log('📤 Beneficiary Registration Payload:', plainPayload);
        
        const encryptedBody = encryptionService.encrypt(JSON.stringify(plainPayload));
        const response = await this._request('/dmtapi/api/Registration/BeneficiaryRegistrationuat', { requestBody: encryptedBody });
        
        const encryptedData = response?.data;
        if (!encryptedData) throw new Error('No data field in beneficiary registration response');
        
        const decryptedString = encryptionService.decrypt(encryptedData);
        const decryptedData = JSON.parse(decryptedString);
        console.log('✅ Beneficiary Registration Decrypted:', decryptedData);
        
        return {
            successStatus: true,
            message: decryptedData.message || response.message,
            responseCode: decryptedData.responseCode || response.responseCode,
            ...decryptedData
        };
    } catch (error) {
        console.error('❌ registerBeneficiary error:', error.message);
        return { successStatus: false, message: error.message };
    }
}
    


async pennyDrop(data) {
    try {
        const payload = {
            ...data,
            merchantRefId: this.generateMerchantRefId(),
            ip: data.ip || '127.0.0.1',
            lat: data.lat || '0.0',
            long: data.long || '0.0'
        };
        console.log('📤 Penny Drop Payload (plain):', payload);

        // Send plain JSON (no encryption wrapper)
        const response = await this._request('/pennydropapi/api/Payment/pennydropuat', payload);
        console.log('📥 Plain penny drop response:', JSON.stringify(response));

        // Check if response indicates success directly
        if (response?.txnStatusCode === '000' || response?.successStatus === true) {
            return {
                successStatus: true,
                message: response.message || 'Penny drop successful',
                txnStatusCode: response.txnStatusCode,
                txnId: response.txnId || response.beneAccId,
                ...response
            };
        }

        // If response has encrypted data field, try to decrypt
        if (response?.data) {
            try {
                const decryptedString = encryptionService.decrypt(response.data);
                const decryptedData = JSON.parse(decryptedString);
                console.log('✅ Penny Drop Decrypted:', decryptedData);
                return {
                    successStatus: true,
                    ...decryptedData
                };
            } catch (decryptErr) {
                console.warn('Decryption failed, returning raw response:', decryptErr.message);
            }
        }

        // Fallback: return raw response
        return response;
    } catch (error) {
        console.error('❌ pennyDrop error:', error.message);
        if (error.response?.data) console.error('Response data:', JSON.stringify(error.response.data));
        return { successStatus: false, message: error.message };
    }
}


    async resendTransactionOtp(data) {
        const payload = {
            beneAccId: data.beneAccId,
            merchantRefId: this.generateMerchantRefId()
        };
        return this._request('/dmtapi/api/Registration/OtpRetriggerUAT', payload);
    }

    async dmtTransaction(data) {
        const payload = {
            amount: String(data.amount),
            benneAccId: data.benneAccId,
            txnMode: data.txnMode,
            otp: data.otp,
            ip: data.ip || '127.0.0.1',
            lat: data.lat || '0.0',
            long: data.long || '0.0',
            merchantRefId: this.generateMerchantRefId()
        };
        return this._request('/dmtapi/api/Registration/dmttransactionuat', payload);
    }
}

module.exports = new DMTService();