// backend/models/PayoutTransaction.js
const pool = require('../config/db'); // adjust path to your db.js

class PayoutTransaction {
static async create(data) {
    const {
        user_id, merchant_ref_id, amount, beneficiary_bank, payment_purpose,
        payment_mode, beneficiary_account_number, beneficiary_ifsc,
        beneficiary_mobile, beneficiary_name, beneficiary_location,
        lat, long, udf1, udf2, udf3
    } = data;

    const sql = `
        INSERT INTO payout_transaction 
        (user_id, merchant_ref_id, amount, beneficiary_bank, payment_purpose,
         payment_mode, beneficiary_account_number, beneficiary_ifsc,
         beneficiary_mobile, beneficiary_name, beneficiary_location,
         lat, long, udf1, udf2, udf3, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'QUEUED')
        RETURNING id
    `;
    const params = [
        user_id,                      // $1
        merchant_ref_id,              // $2
        amount,                       // $3
        beneficiary_bank,             // $4
        payment_purpose,              // $5
        payment_mode,                 // $6
        beneficiary_account_number,   // $7
        beneficiary_ifsc,             // $8
        beneficiary_mobile,           // $9
        beneficiary_name,             // $10
        beneficiary_location,         // $11
        lat || '28.7041',             // $12
        long || '77.1025',            // $13
        udf1 || null,                 // $14
        udf2 || null,                 // $15
        udf3 || null,                 // $16  ← was missing
    ];

    const result = await pool.query(sql, params);
    return result.rows[0].id;
}

    static async updateStatus(merchant_ref_id, status, txn_id = null, callbackData = null) {
        const sql = `
            UPDATE payout_transaction 
            SET status = $1, 
                txn_id = COALESCE($2, txn_id), 
                vimopay_callback = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE merchant_ref_id = $4
        `;
        const params = [status, txn_id, callbackData ? JSON.stringify(callbackData) : null, merchant_ref_id];
        const result = await pool.query(sql, params);
        return result.rowCount; // number of rows affected
    }

    static async findByMerchantRef(merchant_ref_id) {
        const sql = `SELECT * FROM payout_transaction WHERE merchant_ref_id = $1`;
        const result = await pool.query(sql, [merchant_ref_id]);
        return result.rows[0];
    }

    static async getUserTransactions(userId) {
        // If you have a user_id column, add it to the table and use it here
        const sql = `SELECT * FROM payout_transaction WHERE user_id = $1 ORDER BY created_at DESC`;
        const result = await pool.query(sql, [userId]);
        return result.rows;
    }
}

module.exports = PayoutTransaction;