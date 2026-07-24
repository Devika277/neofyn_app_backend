const pool = require('../config/db');

class CardPayReceiptService {
  async getReceiptData(merchantRefId) {
    const res = await pool.query(
      `SELECT
        t.*,
        cs.name,
        cs.mobile,
        cs.email,
        wl.balance_before,
        wl.balance_after
      FROM cardpay_transactions t
      LEFT JOIN cardpay_customer_snapshots cs ON cs.cardpay_transaction_id = t.id
      LEFT JOIN cardpay_wallet_ledger wl ON wl.cardpay_transaction_id = t.id
      WHERE t.merchant_ref_id = $1`,
      [merchantRefId]
    );
    return res.rows[0] || null;
  }
}

module.exports = CardPayReceiptService;
