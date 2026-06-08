// // services/recharge/bbpsService.js
// const { v4: uuidv4 } = require('uuid');
// const db = require('../../config/db');
// const logger = require('../../utils/logger');

// // Dummy bill data generator
// const DUMMY_BILLS = {
//   ELECTRICITY: {
//     billerId: "BBPS_ELEC_001",
//     billerName: "City Power Distribution Ltd",
//     category: "ELECTRICITY",
//     billAmount: 1542.50,
//     lateFee: 50.00,
//     totalAmount: 1592.50,
//   },
//   WATER: {
//     billerId: "BBPS_WTR_002",
//     billerName: "Municipal Water Supply Board",
//     category: "WATER",
//     billAmount: 850.00,
//     lateFee: 25.00,
//     totalAmount: 875.00,
//   },
//   GAS: {
//     billerId: "BBPS_GAS_003",
//     billerName: "City Gas Network",
//     category: "GAS",
//     billAmount: 2340.75,
//     lateFee: 100.00,
//     totalAmount: 2440.75,
//   },
//   TELECOM: {
//     billerId: "BBPS_TEL_004",
//     billerName: "Fast Broadband Services",
//     category: "TELECOM",
//     billAmount: 999.00,
//     lateFee: 0,
//     totalAmount: 999.00,
//   }
// };

// function generateBillNumber() {
//   return `BILL${Date.now()}${Math.floor(Math.random() * 10000)}`;
// }

// function generateCustomerName(customerId) {
//   const names = ["Rahul Sharma", "Priya Patel", "Amit Kumar", "Neha Singh", "Test User"];
//   const index = parseInt(customerId?.slice(-2) || "0") % names.length;
//   return names[index];
// }

// // Main fetch bill function
// async function fetchBBPSBill(userId, billData) {
//   const { serviceType, customerId, isTestMode = true } = billData;
  
//   logger.info(`Fetching ${serviceType} bill for customer ${customerId}, user: ${userId}`);
  
//   try {
//     const dummyConfig = DUMMY_BILLS[serviceType] || DUMMY_BILLS.ELECTRICITY;
//     const billNumber = generateBillNumber();
//     const dueDate = new Date();
//     dueDate.setDate(dueDate.getDate() + 15);
//     const customerName = generateCustomerName(customerId);
    
//     // Randomize amount
//     let billAmount = dummyConfig.billAmount;
//     if (serviceType === 'ELECTRICITY') {
//       billAmount = Math.floor(Math.random() * 3000) + 500;
//     }
    
//     const dummyResponse = {
//       success: true,
//       isDummyData: true,
//       message: "Bill fetched successfully (Test Data)",
//       data: {
//         id: Date.now(),
//         billerId: dummyConfig.billerId,
//         billerName: dummyConfig.billerName,
//         serviceType: serviceType,
//         customerId: customerId,
//         customerName: customerName,
//         consumerNumber: customerId,
//         billNumber: billNumber,
//         billAmount: billAmount,
//         lateFee: dummyConfig.lateFee,
//         totalAmount: billAmount + dummyConfig.lateFee,
//         dueDate: dueDate.toISOString(),
//         billDate: new Date().toISOString(),
//         billPeriod: "Current Month",
//         status: "PENDING",
//         isPaid: false
//       }
//     };
    
//     // Save to database
//     try {
//       await saveBillToDatabase({
//         userId,
//         serviceType,
//         ...dummyResponse.data,
//         isTestData: true
//       });
//     } catch (dbError) {
//       logger.warn('Could not save bill to DB:', dbError.message);
//     }
    
//     return dummyResponse;
    
//   } catch (error) {
//     logger.error('fetchBBPSBill error:', error);
//     return {
//       success: true,
//       isDummyData: true,
//       isFallback: true,
//       message: "Bill generated from fallback data",
//       data: generateFallbackBill(serviceType, customerId)
//     };
//   }
// }

// function generateFallbackBill(serviceType, customerId) {
//   return {
//     billerId: `FALLBACK_${serviceType}`,
//     billerName: `${serviceType} Bill Service`,
//     serviceType: serviceType,
//     customerId: customerId,
//     customerName: "Customer",
//     billNumber: `FALLBACK_${Date.now()}`,
//     billAmount: 1000,
//     totalAmount: 1000,
//     dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
//     status: "PENDING"
//   };
// }

// // ✅ ADD THIS FUNCTION - Save bill to database
// async function saveBillToDatabase(billData) {
//   const query = `
//     INSERT INTO bills (
//       user_id, service_type, biller_id, biller_name, customer_id,
//       customer_name, bill_number, bill_amount, late_fee, total_amount, 
//       due_date, bill_date, bill_period, bill_status, additional_info, is_test_data
//     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
//     RETURNING id
//   `;
  
//   const values = [
//     billData.userId,
//     billData.serviceType,
//     billData.billerId,
//     billData.billerName,
//     billData.customerId,
//     billData.customerName,
//     billData.billNumber,
//     billData.billAmount,
//     billData.lateFee || 0,
//     billData.totalAmount,
//     new Date(billData.dueDate),
//     new Date(billData.billDate || Date.now()),
//     billData.billPeriod,
//     billData.status || 'PENDING',
//     JSON.stringify(billData.additionalInfo || {}),
//     billData.isTestData || true
//   ];
  
//   const result = await db.query(query, values);
//   return result.rows[0].id;
// }

// // ✅ ADD THIS FUNCTION - Update bill status
// async function updateBillStatus(billId, status, transactionId) {
//   try {
//     logger.info(`Updating bill ${billId} status to ${status}, transaction: ${transactionId}`);
    
//     const query = `
//       UPDATE bills 
//       SET bill_status = $1, 
//           transaction_id = $2, 
//           updated_at = NOW()
//       WHERE id = $3
//       RETURNING *
//     `;
    
//     const values = [status, transactionId, billId];
//     const result = await db.query(query, values);
    
//     if (result.rows.length === 0) {
//       logger.warn(`Bill ${billId} not found for status update`);
//       return null;
//     }
    
//     logger.info(`Bill ${billId} status updated to ${status}`);
//     return result.rows[0];
    
//   } catch (error) {
//     logger.error('Error updating bill status:', error);
//     throw error;
//   }
// }

// // ✅ ADD THIS FUNCTION - Get customer bills
// async function getCustomerBills(userId, serviceType = null, limit = 50, offset = 0) {
//   try {
//     let query = `
//       SELECT id, service_type, biller_name, customer_id, bill_number,
//              bill_amount, total_amount, due_date, bill_date, bill_period,
//              bill_status, is_test_data, created_at
//       FROM bills
//       WHERE user_id = $1
//     `;
//     const params = [userId];
//     let paramIndex = 2;
    
//     if (serviceType && serviceType !== 'all' && serviceType !== 'undefined') {
//       query += ` AND service_type = $${paramIndex}`;
//       params.push(serviceType.toUpperCase());
//       paramIndex++;
//     }
    
//     query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
//     params.push(limit, offset);
    
//     const result = await db.query(query, params);
    
//     const countResult = await db.query(
//       `SELECT COUNT(*) FROM bills WHERE user_id = $1 ${serviceType && serviceType !== 'all' && serviceType !== 'undefined' ? 'AND service_type = $2' : ''}`,
//       serviceType && serviceType !== 'all' && serviceType !== 'undefined' ? [userId, serviceType.toUpperCase()] : [userId]
//     );
    
//     return {
//       success: true,
//       bills: result.rows,
//       total: parseInt(countResult.rows[0].count),
//       limit,
//       offset
//     };
    
//   } catch (error) {
//     logger.error('Error fetching customer bills:', error);
//     return {
//       success: false,
//       bills: [],
//       total: 0,
//       message: error.message
//     };
//   }
// }

// // ✅ ADD THIS FUNCTION - Get available services
// async function getAvailableServices() {
//   try {
//     const result = await db.query(
//       `SELECT name, display_name, category, icon, is_active 
//        FROM services 
//        WHERE is_active = true 
//        ORDER BY category, display_name`
//     );
    
//     if (result.rows.length > 0) {
//       return result.rows;
//     }
    
//     return [
//       { name: 'ELECTRICITY', display_name: 'Electricity Bill', category: 'UTILITY', icon: '⚡', is_active: true },
//       { name: 'WATER', display_name: 'Water Bill', category: 'UTILITY', icon: '💧', is_active: true },
//       { name: 'GAS', display_name: 'Gas Bill', category: 'UTILITY', icon: '🔥', is_active: true },
//       { name: 'TELECOM', display_name: 'Broadband Bill', category: 'UTILITY', icon: '📡', is_active: true }
//     ];
//   } catch (error) {
//     logger.error('Error fetching services:', error);
//     return [
//       { name: 'ELECTRICITY', display_name: 'Electricity Bill', category: 'UTILITY' },
//       { name: 'WATER', display_name: 'Water Bill', category: 'UTILITY' },
//       { name: 'GAS', display_name: 'Gas Bill', category: 'UTILITY' },
//       { name: 'TELECOM', display_name: 'Broadband Bill', category: 'UTILITY' }
//     ];
//   }
// }

// // ✅ MAKE SURE ALL FUNCTIONS ARE EXPORTED
// module.exports = {
//   fetchBBPSBill,
//   saveBillToDatabase,
//   updateBillStatus,      // ← This was missing!
//   getCustomerBills,      // ← This was missing!
//   getAvailableServices,  // ← This was missing!
//   DUMMY_BILLS
// };


// services/bbpsService.js
const axios = require('axios');
const encryptionService = require('../encryptionService'); // your existing module

// Environment variables – set these in your .env
const BASE_URL = process.env.VIMOPAY_BASE_URL;               // e.g. https://<gateway>/bbpsapi
const SECRET_KEY = process.env.VIMO_SECRET_KEY;
const SALT_KEY = process.env.VIMO_SALT_KEY;
const ENCRYPTDECRYPT_KEY = process.env.VIMO_ENCRYPT_DECRYPT_KEY;
const USER_ID = process.env.VIMO_USER_ID;

// In‑memory token cache (for development; replace with Redis/DB in production)
let cachedToken = null;
let tokenExpiry = null;

// Helper: check if token is still valid (TTL = 45 minutes)
const isTokenValid = () => cachedToken && tokenExpiry && Date.now() < tokenExpiry;

// Helper: sleep for retries
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Step 1 – Partner Authorization
 * Calls /signature/authorizeuat, decrypts the token, and caches it.
 */
const authorize = async () => {
    try {
        const url = `${BASE_URL}/api/signature/authorizeuat`;
        const headers = {
            'secretKey': SECRET_KEY,
            'saltKey': SALT_KEY,
            'encryptdecryptKey': ENCRYPTDECRYPT_KEY,
            'userId': USER_ID,
            'Content-Type': 'application/json'
        };

        const response = await axios.post(url, {}, { headers, timeout: 15000 });

        // Spec says response.data contains the encrypted token
        const encryptedToken = response.data?.data;
        if (!encryptedToken) {
            throw new Error('No token data in authorization response');
        }

        // Decrypt the token using your existing decryption method
        const decryptedToken = encryptionService.decrypt(encryptedToken);
        if (!decryptedToken) {
            throw new Error('Failed to decrypt authorization token');
        }

        // Cache token and set expiry (45 minutes – spec suggests session token)
        cachedToken = decryptedToken.trim();
        tokenExpiry = Date.now() + 45 * 60 * 1000;

        console.log('✅ BBPS authorization successful, token cached');
        return cachedToken;
    } catch (error) {
        console.error('❌ Authorization failed:', error.message);
        throw new Error(`BBPS authorization error: ${error.message}`);
    }
};

/**
 * Gets a valid Bearer token – re‑authorizes if expired or missing.
 */
const getBearerToken = async () => {
    if (isTokenValid()) return cachedToken;
    return await authorize();
};

/**
 * Generic request handler for all BBPS endpoints that need:
 * - Bearer token
 * - Encrypted request body -> { requestBody: "<encrypted>" }
 * - Decryption of the response's data field
 */
const makeRequest = async (endpoint, payload, retryCount = 0) => {
    try {
        const token = await getBearerToken();
        const url = `${BASE_URL}${endpoint}`;

        // Encrypt the payload using your existing prepareRequest method
        const encryptedBody = encryptionService.prepareRequest(payload);

        const response = await axios.post(url, encryptedBody, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'userId': USER_ID,
                'Content-Type': 'application/json'
            },
            timeout: 20000
        });

        // Handle response – decrypt the data field if it exists and is a string
        let decryptedData = response.data;
        if (response.data && typeof response.data.data === 'string') {
            const decryptedString = encryptionService.decrypt(response.data.data);
            if (decryptedString) {
                try {
                    decryptedData = {
                        ...response.data,
                        data: JSON.parse(decryptedString)
                    };
                } catch (e) {
                    // If JSON parse fails, keep the decrypted string as is
                    decryptedData = {
                        ...response.data,
                        data: decryptedString
                    };
                }
            }
        }

        // Check for BBPS error codes (000 = success, others = failure)
        const responseCode = decryptedData?.responseCode || decryptedData?.statusCode;
        if (responseCode && responseCode !== '000') {
            const errorMsg = decryptedData?.message || decryptedData?.statusMessage || 'BBPS request failed';
            const error = new Error(errorMsg);
            error.code = responseCode;
            throw error;
        }

        return decryptedData;
    } catch (error) {
        // If token might be expired (e.g., 401), retry once after re‑authorization
        if (error.response?.status === 401 && retryCount === 0) {
            console.warn('Token expired, re‑authorizing and retrying...');
            cachedToken = null;       // invalidate cache
            tokenExpiry = null;
            await sleep(100);
            return makeRequest(endpoint, payload, retryCount + 1);
        }
        throw error;
    }
};

// ======================== ADD THESE METHODS ========================

/**
 * Get State List (Master API)
 * Follows exactly the pattern from your working getStateList()
 */
const getStateList = async () => {
    try {
        const token = await getBearerToken();
        const url = `${BASE_URL}/masterapi/api/master/statelistuat`;

        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'userId': USER_ID,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        // Response structure: { successStatus, message, responseCode, data: "encryptedString" }
        const encryptedData = response.data?.data;
        if (!encryptedData) {
            throw new Error('No data field in state list response');
        }

        // Decrypt using your existing decryption method
        const decryptedString = encryptionService.decrypt(encryptedData);
        if (!decryptedString) {
            throw new Error('Failed to decrypt state list');
        }

        const stateList = JSON.parse(decryptedString);  // Array of { code, description }
        
        // Optional: map to a clean format
        const formatted = stateList.map(s => ({
            code: s.code?.trim(),
            name: s.description,
            original: s
        }));

        return {
            success: true,
            data: formatted,
            raw: stateList
        };
    } catch (error) {
        console.error('❌ State list error:', error.message);
        return { success: false, data: [], error: error.message };
    }
};

/**
 * Get City List (District) for a given state
 * POST /bbpsapi/api/BillerCategories/CityUat
 * @param {string} stateCode - The state code (e.g., "AP", "MH")
 */
const getCityList = async (stateCode) => {
    try {
        const token = await getBearerToken();
        const url = `${BASE_URL}/bbpsapi/api/BillerCategories/CityUat`;

        // According to the PDF, this is a POST with a body (likely { stateCode })
        // The PDF doesn't show the exact request body, but typical BBPS expects:
        const requestBody = { stateCode: stateCode };

        // Encrypt the request body (as per your working pattern)
        const encryptedPayload = encryptionService.prepareRequest(requestBody);

        const response = await axios.post(url, encryptedPayload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'userId': USER_ID,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        // Response structure same as state list: { successStatus, data: "encryptedString" }
        const encryptedData = response.data?.data;
        if (!encryptedData) {
            throw new Error('No data field in city list response');
        }

        const decryptedString = encryptionService.decrypt(encryptedData);
        if (!decryptedString) {
            throw new Error('Failed to decrypt city list');
        }

        const cityList = JSON.parse(decryptedString); // Array of { code, description, ... }

        const formatted = cityList.map(c => ({
            code: c.code?.trim(),
            name: c.description,
            original: c
        }));

        return {
            success: true,
            data: formatted,
            raw: cityList
        };
    } catch (error) {
        console.error('❌ City list error:', error.message);
        return { success: false, data: [], error: error.message };
    }
};

// ------------------------ EXPORT THESE ------------------------


/**
 * Step 3 – Merchant Registration (one‑time per user)
 * @param {string} userId - Your internal user ID (used to store merchantCode)
 * @returns {Promise<{merchantCode: string}>}
 */
const registerMerchant = async (userId) => {
    // The spec says the payload for MerchantRegistrationuat is empty or minimal
    // Some implementations require a dummy object. We'll send {}.
    const payload = {};

    const response = await makeRequest('/api/Payment/MerchantRegistrationuat', payload);

    // Extract merchantCode from decrypted response
    const merchantCode = response?.data?.merchantCode || response?.data?.MerchantCode;
    if (!merchantCode) {
        throw new Error('Merchant registration did not return a merchantCode');
    }

    // Store merchantCode in your database (implement this according to your DB)
    // Example: await db.collection('users').updateOne({ _id: userId }, { $set: { bbpsMerchantCode: merchantCode } });
    console.log(`✅ Merchant registered for user ${userId}: ${merchantCode}`);
    return { merchantCode };
};

/**
 * Step 4a – Fetch Bill
 * @param {string} userId - Internal user ID (to look up merchantCode)
 * @param {object} billFetchParams - { billerId, consumerNumber, ... }
 * @returns {Promise<FetchBillResult>}
 */
const fetchBill = async (userId, billFetchParams) => {
    // Retrieve merchantCode from your database (example – replace with your actual DB call)
    // For demonstration, we assume a function getUserMerchantCode(userId) exists.
    const merchantCode = await getUserMerchantCode(userId);
    if (!merchantCode) {
        throw new Error('User not registered for BBPS. Please call registerMerchant first.');
    }

    // Build the payload as per spec
    const payload = {
        merchantCode: merchantCode,
        billerId: billFetchParams.billerId,
        consumerNumber: billFetchParams.consumerNumber,
        // Optional: additional params like 'mobileNumber', 'email', etc.
        ...(billFetchParams.additionalParams && { additionalParams: billFetchParams.additionalParams })
    };

    // Generate a unique merchantRefId for this transaction (UUID)
    const merchantRefId = generateUUID();
    payload.merchantRefId = merchantRefId;

    const response = await makeRequest('/api/Payment/FetchBill', payload);

    // The decrypted response.data should contain billerResponse object
    const billerResponse = response?.data?.billerResponse || response?.data;
    if (!billerResponse) {
        throw new Error('FetchBill response missing billerResponse');
    }

    // Return a structured result that can be used for Pay Now
    const fetchBillResult = {
        success: true,
        merchantRefId: merchantRefId,
        fetchRefId: billerResponse.fetchRefId,
        billerId: payload.billerId,
        merchantCode: merchantCode,
        customerParams: billerResponse.customerParams || [],
        amount: billerResponse.amount,
        dueDate: billerResponse.dueDate,
        billerName: billerResponse.billerName,
        // Store the raw billerResponse if needed for further fields
        rawResponse: billerResponse
    };

    return fetchBillResult;
};

/**
 * Step 4b – Pay Bill
 * @param {string} userId - Internal user ID
 * @param {object} transactionRequest - As built from fetchBill result
 * @returns {Promise<BillPaymentResult>}
 */
const payBill = async (userId, transactionRequest) => {
    // Ensure merchantCode exists (could also be inside transactionRequest)
    const merchantCode = await getUserMerchantCode(userId);
    if (!merchantCode) {
        throw new Error('User not registered for BBPS.');
    }

    // The transactionRequest must contain at least:
    // billerId, merchantRefId (same as fetch), fetchRefId, txnAmount, customerParams
    const payload = {
        merchantCode: merchantCode,
        ...transactionRequest
    };

    const response = await makeRequest('/api/Payment/PayBill', payload);

    // Extract payment result
    const paymentData = response?.data || response;
    return {
        success: paymentData?.responseCode === '000',
        transactionId: paymentData?.transactionId,
        transactionRefId: paymentData?.transactionRefId,
        paymentStatus: paymentData?.status,
        message: paymentData?.message,
        rawResponse: paymentData
    };
};

// ------------------------------------------------------------------
// Helper: generate UUID v4 (replace with a library if preferred)
const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};

// ------------------------------------------------------------------
// STORAGE FOR USER MERCHANT CODES (REPLACE WITH YOUR ACTUAL DB CODE)
// This is a simple in‑memory map for demonstration.
// In production, store this in your User collection or a separate table.
const userMerchantMap = new Map();

async function getUserMerchantCode(userId) {
    // Example: fetch from database
    // return await db.collection('users').findOne({ _id: userId }).then(u => u?.bbpsMerchantCode);
    return userMerchantMap.get(userId) || null;
}

// Expose a function to save merchantCode after registration – call this from your controller
const saveMerchantCodeForUser = async (userId, merchantCode) => {
    // Replace with your actual DB update
    userMerchantMap.set(userId, merchantCode);
    // await db.collection('users').updateOne({ _id: userId }, { $set: { bbpsMerchantCode: merchantCode } }, { upsert: true });
    console.log(`Saved merchantCode ${merchantCode} for user ${userId}`);
};

// ------------------------------------------------------------------
// EXPORT all public methods
module.exports = {
    authorize,               // only if you need to force re‑auth
    registerMerchant,
    fetchBill,
    payBill,
    saveMerchantCodeForUser,
    getStateList,
    getCityList,
    // Helper for testing
    getBearerToken
};

