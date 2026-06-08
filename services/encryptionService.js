// // backend/services/encryptionService.js
// const crypto = require('crypto');

// class EncryptionService {
//     constructor() {
//         // From the curl examples - these are the correct keys
//         this.secretKey = process.env._secretKey || 'f37701ee0778cfe1dd97b7537ae71709';
//         this.saltKey = process.env._saltKey || 'bb13602c407b1ddd6506d59e410bafeb';
//         this.encryptDecryptKey = process.env.ENCRYPT_DECRYPT_KEY || '47cdba1911f078afe863774a8dffcb26';
//         this.userId = process.env._userId || 'E5B82667-9A9D-4A5A-A55C-F3B1E10BF370';
//     }

//     /**
//      * Encrypt plaintext using AES-256-GCM
//      * Used for encrypting request payloads
//      */
//     encrypt(plainText) {
//         try {
//             // Use encryptDecryptKey as the encryption key
//             const key = Buffer.from(this.encryptDecryptKey, 'utf8');
//             // Use saltKey as IV
//             const iv = Buffer.from(this.saltKey, 'utf8');
            
//             const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
//             let encrypted = cipher.update(plainText, 'utf8');
//             encrypted = Buffer.concat([encrypted, cipher.final()]);
//             const tag = cipher.getAuthTag();
            
//             return Buffer.concat([encrypted, tag]).toString('base64');
//         } catch (error) {
//             console.error('Encryption error:', error);
//             throw new Error(`Encryption failed: ${error.message}`);
//         }
//     }

//     /**
//      * Decrypt encrypted text using AES-256-GCM
//      * Used for decrypting response data ONLY (not for auth response)
//      */
//     decrypt(encryptedText) {
//         try {
//             const key = Buffer.from(this.encryptDecryptKey, 'utf8');
//             const iv = Buffer.from(this.saltKey, 'utf8');
            
//             const encryptedBuffer = Buffer.from(encryptedText, 'base64');
//             const tag = encryptedBuffer.slice(-16);
//             const ciphertext = encryptedBuffer.slice(0, -16);
            
//             const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
//             decipher.setAuthTag(tag);
            
//             let decrypted = decipher.update(ciphertext, null, 'utf8');
//             decrypted += decipher.final('utf8');
            
//             return decrypted.replace(/\0/g, '').trim();
//         } catch (error) {
//             console.error(':', error);
//             throw new Error(`Decryption failed: ${error.message}`);
//         }
//     }

//     /**
//      * Prepare request body for payout API
//      * Encrypts the payload before sending
//      */
//     prepareRequest(data) {
//         const plainText = JSON.stringify(data);
//         const encryptedData = this.encrypt(plainText);
//         return { requestBody: encryptedData };
//     }

//     /**
//      * Parse response from API
//      * Only decrypts if the data is encrypted (long base64 string)
//      * Auth responses don't need decryption
//      */
//     parseResponse(response) {
//         if (response && response.data && typeof response.data === 'string') {
//             // Check if it looks like encrypted data (long base64 string)
//             // Auth token is much shorter (~200-300 chars), encrypted data is longer
//             if (response.data.length > 500) {
//                 try {
//                     const decryptedText = this.decrypt(response.data);
//                     return {
//                         ...response,
//                         data: JSON.parse(decryptedText)
//                     };
//                 } catch (error) {
//                     console.error('Failed to parse encrypted response:', error);
//                     return response;
//                 }
//             }
//         }
//         return response;
//     }

//     /**
//      * Get authorization headers for initial auth API
//      */
//     getAuthHeaders() {
//         return {
//             'secretKey': this.secretKey,
//             'saltKey': this.saltKey,
//             'encryptdecryptKey': this.encryptDecryptKey,
//             'userId': this.userId,
//             'Content-Type': 'application/json'
//         };
//     }

//     /**
//      * Get headers for authenticated APIs (after getting bearer token)
//      */
//     getAuthenticatedHeaders(bearerToken) {
//         return {
//             'Authorization': `Bearer ${bearerToken}`,
//             'userId': this.userId,
//             'Content-Type': 'application/json'
//         };
//     }

//     /**
//      * Extract bearer token from authorization response (no decryption needed)
//      */
//     extractBearerToken(authResponse) {
//         if (authResponse.successStatus && authResponse.data) {
//             // Auth response returns plain text token directly
//             return authResponse.data;
//         }
//         return null;
//     }
// }

// module.exports = new EncryptionService();



// backend/services/encryptionService.js
const crypto = require('crypto');

class EncryptionService {
    constructor() {
        // Read inside constructor, not at top level
        this.secretKey = process.env.PAYOUT_SECRET_KEY;
        this.saltKey = process.env.PAYOUT_SALT_KEY;
        this.encryptDecryptKey = process.env.PAYOUT_ENCRYPT_DECRYPT_KEY;
        this.userId = process.env.PAYOUT_USER_ID;
        this.baseUrl = process.env.PAYOUT_BASE_URL;
    }

    /**
     * AES-256-GCM Encryption with UTF8 encoding
     * Uses secretKey as EDKey and saltKey as IVKey
     */
    encrypt(plainText) {
        try {
            // ✅ CORRECT: Use secretKey as EDKey (32 bytes UTF8)
            const key = Buffer.from(this.secretKey, 'utf8');
            // ✅ CORRECT: Use saltKey as IVKey (32 bytes UTF8)
            const iv = Buffer.from(this.saltKey, 'utf8');
            
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            let encrypted = cipher.update(plainText, 'utf8');
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            const tag = cipher.getAuthTag();
            
            return Buffer.concat([encrypted, tag]).toString('base64');
        } catch (error) {
            console.error('Encryption error:', error);
            throw new Error(`Encryption failed: ${error.message}`);
        }
    }

    /**
     * AES-256-GCM Decryption
     * Returns null on failure (never throws)
     */
    decrypt(encryptedText) {
        try {
            const key = Buffer.from(this.secretKey, 'utf8');
            const iv = Buffer.from(this.saltKey, 'utf8');
            
            const encryptedBuffer = Buffer.from(encryptedText, 'base64');
            const tag = encryptedBuffer.slice(-16);
            const ciphertext = encryptedBuffer.slice(0, -16);
            
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            
            let decrypted = decipher.update(ciphertext, null, 'utf8');
            decrypted += decipher.final('utf8');
            
            return decrypted.replace(/\0/g, '').trim();
        } catch (error) {
            // ✅ CORRECT: Return null on failure, never throw
            console.error('Decryption error:', error.message);
            return null;
        }
    }

    /**
     * Prepare request body (encrypt payload)
     */
    prepareRequest(data) {
        const plainText = JSON.stringify(data);
        const encryptedData = this.encrypt(plainText);
        return { requestBody: encryptedData };
    }

    /**
     * Parse response - only decrypt if data is encrypted
     */
 parseResponse(response) {
    if (!response) return response;

    // 1. If this is an error response (like the 401 you are getting), just return it
    if (response.status && response.status !== 200) {
        return response;
    }

    // 2. Auth tokens are raw strings. Master lists/Payouts are encrypted JSON.
    // If it's a success response but it's NOT the authorize token, try to decrypt.
    if (response.data && typeof response.data === 'string' && response.data.length > 500) {
        
        // Check if it's a JWT/Bearer token (Auth tokens usually start with 'eyJ' or similar)
        // If it's the authorize response, we don't want to decrypt it.
        if (response.message === "Success" && response.responseCode === "000") {
             // Likely the Auth token, return as is
             return response;
        }

        const decryptedText = this.decrypt(response.data);
        if (decryptedText) {
            try {
                return {
                    ...response,
                    data: JSON.parse(decryptedText)
                };
            } catch (e) {
                console.error('Decryption worked but JSON parse failed');
                return response;
            }
        }
    }
    
    return response;
}

    /**
     * Get auth headers for initial API call
     */
    getAuthHeaders() {
        return {
            'secretKey': this.secretKey,
            'saltKey': this.saltKey,
            'encryptdecryptKey': this.encryptDecryptKey,  // Auth header only
            'userId': this.userId,
            'Content-Type': 'application/json'
        };
    }

    /**
     * Get authenticated headers for subsequent calls
     */
    getAuthenticatedHeaders(bearerToken) {
        return {
            'Authorization': `Bearer ${bearerToken}`,
            'userId': this.userId,
            'Content-Type': 'application/json'
        };
    }

    /**
     * Extract token from auth response (no decryption needed)
     */
    extractBearerToken(authResponse) {
        if (authResponse.successStatus && authResponse.data) {
            // ✅ CORRECT: Use raw token directly, no decryption
            return authResponse.data.replace(/[\r\n]/g, '');
        }
        return null;
    }
}

module.exports = new EncryptionService();