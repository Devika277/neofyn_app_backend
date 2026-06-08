const pool = require('../config/db');

class TransactionModel {
    /**
     * Save transaction record
     */
    static async save(transactionData) {
        const query = `
            INSERT INTO transactions (
                transaction_id, merchant_ref_id, merchant_id, service_type,
                amount, aadhaar_number, bank_code, bank_name, status,
                status_description, rrn, npci_code, npci_message,
                available_balance, response_data
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (transaction_id) DO UPDATE SET
                status = EXCLUDED.status,
                status_description = EXCLUDED.status_description,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `;

        const values = [
            transactionData.transactionId,
            transactionData.merchantRefId,
            transactionData.merchantId,
            transactionData.serviceType,
            transactionData.amount,
            transactionData.aadhaarNumber,
            transactionData.bankCode,
            transactionData.bankName,
            transactionData.status,
            transactionData.statusDescription,
            transactionData.rrn,
            transactionData.npciCode,
            transactionData.npciMessage,
            transactionData.availableBalance,
            JSON.stringify(transactionData.responseData)
        ];

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    /**
     * Get transaction by merchant reference ID
     */
    static async getByMerchantRefId(merchantRefId) {
        const query = 'SELECT * FROM transactions WHERE merchant_ref_id = $1 ORDER BY created_at DESC';
        const result = await pool.query(query, [merchantRefId]);
        return result.rows;
    }

    /**
     * Get transaction by transaction ID
     */
    static async getByTransactionId(transactionId) {
        const query = 'SELECT * FROM transactions WHERE transaction_id = $1';
        const result = await pool.query(query, [transactionId]);
        return result.rows[0];
    }

    /**
     * Update transaction status
     */
    static async updateStatus(transactionId, status, statusDescription, additionalData = {}) {
        const query = `
            UPDATE transactions 
            SET status = $2, status_description = $3, response_data = response_data || $4, updated_at = CURRENT_TIMESTAMP
            WHERE transaction_id = $1
            RETURNING *
        `;
        const result = await pool.query(query, [transactionId, status, statusDescription, JSON.stringify(additionalData)]);
        return result.rows[0];
    }
}

module.exports = TransactionModel;