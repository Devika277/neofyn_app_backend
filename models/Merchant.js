const pool = require('../config/db');

class MerchantModel {
    /**
     * Save merchant record
     */

     static async save(merchantData) {
        const query = `
            INSERT INTO merchants (
                merchant_ref_id,
                merchant_id,
                first_name,
                last_name,
                phone,
                email,
                aadhaar_no,
                pan_no,
                pipe,
                status,
                user_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `;

        const values = [
            merchantData.merchantRefId,
            merchantData.merchantId,
            merchantData.firstName,
            merchantData.lastName,
            merchantData.mobileNo,          // phone
            merchantData.emailId || '',
            merchantData.aadhaarNo,
            merchantData.panNo,
            merchantData.pipe || '1',
            merchantData.status || 'pending',
            merchantData.userId || null
        ];

        try {
            const result = await pool.query(query, values);  // ✅ use pool, not db
            return result.rows[0];
        } catch (error) {
            console.error('Merchant save error:', error);
            throw error;
        }
    }



    /**
     * Get merchant by ID
     */
    static async getByMerchantId(merchantId) {
        const query = 'SELECT * FROM merchants WHERE merchant_id = $1';
        const result = await pool.query(query, [merchantId]);
        return result.rows[0];
    }

    /**
     * Get merchant by reference ID
     */
    static async getByMerchantRefId(merchantRefId) {
        const query = 'SELECT * FROM merchants WHERE merchant_ref_id = $1';
        const result = await pool.query(query, [merchantRefId]);
        return result.rows[0];
    }

    /**
     * Update merchant verification status
     */
    // static async updateVerificationStatus(merchantId, isVerified) {
    //     const query = 'UPDATE merchants SET is_verified = $2 WHERE merchant_id = $1 RETURNING *';
    //     const result = await pool.query(query, [merchantId, isVerified]);
    //     return result.rows[0];
    // }
    static async updateStatus(merchantId, status) {
    await pool.query(
        `UPDATE merchants SET status = $1 WHERE merchant_id = $2`,
        [status, merchantId]
    );
}

static async findByPhone(phone) {
    const result = await pool.query(
        `SELECT * FROM merchants WHERE phone = $1`,
        [phone]
    );
    return result.rows[0];
}

}

module.exports = MerchantModel;