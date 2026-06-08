// services/commissionEngine.js
const db = require('../../config/db');

class CommissionEngine {
    async calculate(userId, amount, type, client = null) {
        // Simple commission calculation – 2% for mobile recharge
        const commission = amount * 0.02;
        const query = `
            INSERT INTO commissions (user_id, amount, type, commission, created_at)
            VALUES ($1, $2, $3, $4, NOW())
        `;
        const params = [userId, amount, type, commission];
        
        if (client) {
            await client.query(query, params);
        } else {
            await db.query(query, params);
        }
        return commission;
    }
}

module.exports = new CommissionEngine();