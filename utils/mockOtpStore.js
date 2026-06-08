// Simple in-memory OTP store for mock mode
const store = new Map();   // key: merchantRefId, value: { otp, expiresAt }

module.exports = {
    setOtp(merchantRefId, otp, ttlSeconds = 600) {
        store.set(merchantRefId, {
            otp,
            expiresAt: Date.now() + ttlSeconds * 1000
        });
    },
    verifyOtp(merchantRefId, otp) {
        const record = store.get(merchantRefId);
        if (!record) return false;
        if (Date.now() > record.expiresAt) {
            store.delete(merchantRefId);
            return false;
        }
        return record.otp === otp;
    },
    deleteOtp(merchantRefId) {
        store.delete(merchantRefId);
    }
};