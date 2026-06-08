// backend/services/payoutService.js
const crypto = require('crypto');

class PayoutService {
    constructor() {
        this.baseUrl = process.env.PAYOUT_BASE_URL;
        this.userId = process.env.PAYOUT_USER_ID;
        this.secretKey = process.env.PAYOUT_SECRET_KEY;
        this.saltKey = process.env.PAYOUT_SALT_KEY;
        this.encryptDecryptKey = process.env.PAYOUT_ENCRYPT_DECRYPT_KEY;
        this.edKey = process.env.PAYOUT_ED_KEY;     // = secretKey for AES‑256
        this.ivKey = process.env.PAYOUT_IV_KEY;     // = saltKey for AES‑256

        this.bearerToken = null;
        this.tokenExpiry = null;
        this.authorizing = false;
        this.authorizePromise = null;
    }

    encryptPayload(plainText) {
        const key = Buffer.from(this.edKey, 'utf8');
        const iv = Buffer.from(this.ivKey, 'utf8');
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([
            cipher.update(plainText, 'utf8'),
            cipher.final()
        ]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([encrypted, tag]).toString('base64');
    }

    decryptPayload(encryptedBase64) {
        try {
            const key = Buffer.from(this.edKey, 'utf8');
            const iv = Buffer.from(this.ivKey, 'utf8');
            const data = Buffer.from(encryptedBase64, 'base64');
            const tag = data.slice(-16);
            const ct = data.slice(0, -16);
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8').trim();
        } catch (e) {
            return null;
        }
    }

    async _makeRequest(endpoint, method = 'GET', body = null, isAuthRequest = false, retries = 2) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = { 'Content-Type': 'application/json' };

        if (isAuthRequest) {
            headers.secretKey = this.secretKey;
            headers.saltKey = this.saltKey;
            headers.encryptdecryptKey = this.encryptDecryptKey;
            headers.userId = this.userId;
        } else {
            if (!this.bearerToken) await this.ensureValidToken();
            headers.Authorization = `Bearer ${this.bearerToken}`;
            headers.userId = this.userId;
        }

        const options = { method, headers };
        if (body && method === 'POST') options.body = JSON.stringify(body);

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const response = await fetch(url, options);
                const rawText = await response.text();
                let data;
                try {
                    data = JSON.parse(rawText);
                } catch {
                    data = { successStatus: false, message: 'Invalid JSON response' };
                }

                if (!isAuthRequest && data.successStatus === true && data.data && typeof data.data === 'string' && data.data.length > 100) {
                    const decrypted = this.decryptPayload(data.data);
                    if (decrypted) {
                        try {
                            data.data = JSON.parse(decrypted);
                        } catch {
                            // keep as string
                        }
                    }
                }
                return data;
            } catch (error) {
                if (attempt === retries || (error.code !== 'ECONNRESET' && error.code !== 'ETIMEDOUT')) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
            }
        }
    }

    async authorize() {
        const endpoint = '/rechargeapi/api/signature/authorizeuat';
        const response = await this._makeRequest(endpoint, 'POST', null, true);

        if (response && response.successStatus === true && response.data) {
            const rawToken = response.data.replace(/[\r\n]/g, '');
            this.bearerToken = rawToken;
            this.tokenExpiry = Date.now() + 55 * 60 * 1000;
            return this.bearerToken;
        }
        throw new Error(response?.message || 'Authorization failed');
    }

    async ensureValidToken() {
        if (this.bearerToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.bearerToken;
        }
        if (this.authorizing) {
            return this.authorizePromise;
        }
        this.authorizing = true;
        this.authorizePromise = this.authorize().finally(() => {
            this.authorizing = false;
            this.authorizePromise = null;
        });
        return this.authorizePromise;
    }

    async getBankList() {
        await this.ensureValidToken();
        return this._makeRequest('/masterapi/api/master/banklistuat', 'GET');
    }

    async getPurposeList() {
        await this.ensureValidToken();
        return this._makeRequest('/masterapi/api/master/purposelistuat', 'GET');
    }

    async getStateList() {
        await this.ensureValidToken();
        return this._makeRequest('/masterapi/api/master/statelistuat', 'GET');
    }

    async initiatePayout(payoutData) {
        await this.ensureValidToken();

        // Add defaults if missing
        if (!payoutData.lat) payoutData.lat = '28.7041';
        if (!payoutData.long) payoutData.long = '77.1025';
        
        // Generate unique merchantRefId if not provided
        if (!payoutData.merchantRefId) {
            payoutData.merchantRefId = `MER${Date.now()}${Math.random().toString(36).substring(2, 10)}`;
        }
        
        // Store the generated merchantRefId for later use
        const merchantRefId = payoutData.merchantRefId;

        const plainText = JSON.stringify(payoutData);
        const encryptedData = this.encryptPayload(plainText);
        const requestBody = { requestBody: encryptedData };

        const response = await this._makeRequest('/payoutapi/api/payment/payoutsuat', 'POST', requestBody);

        // Decrypt response if needed
        if (response.successStatus && response.data && typeof response.data === 'string') {
            const decrypted = this.decryptPayload(response.data);
            if (decrypted) {
                try {
                    response.data = JSON.parse(decrypted);
                    console.log('✅ Decrypted payout response:', JSON.stringify(response.data, null, 2));

                } catch {
                    // keep as string
                }
            }
        }
        
        // ✅ Attach the merchantRefId to the response object so the route can use it
        response.merchantRefId = merchantRefId;
        
        return response;
    }

    validateIFSC(ifsc) {
        return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase());
    }

    validateMobileNumber(mobile) {
        return /^[6-9]\d{9}$/.test(mobile);
    }
}

module.exports = new PayoutService();