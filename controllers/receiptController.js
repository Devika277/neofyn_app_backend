const db = require('../config/db');

/**
 * GET /api/receipt/payout/:transactionId
 * Returns payout transaction + agent details for receipt
 */
async function getPayoutReceipt(req, res) {
  const { transactionId } = req.params;
  
  try {
    const query = `
      SELECT 
        pt.id,
        pt.amount,
        pt.transfer_mode,
        pt.merchant_ref_id,
        pt.provider_ref_id,
        pt.bank_ref_no,
        pt.status,
        pt.created_at,
        u.business_name as agent_name,
        u.phone as agent_phone,
        u.business_address as agent_address,
        u.city,
        u.state,
        u.pin_code
      FROM payout_transactions pt
      JOIN users u ON pt.user_id = u.id
      WHERE pt.id = $1
    `;
    const result = await db.query(query, [transactionId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    res.json({ success: true, receipt: result.rows[0] });
  } catch (error) {
    console.error('Receipt error:', error);
    res.status(500).json({ error: 'Failed to fetch receipt data' });
  }
}

/**
 * GET /api/receipt/recharge/:transactionId
 * Returns recharge transaction + agent details for receipt
 */
async function getRechargeReceipt(req, res) {
  const { transactionId } = req.params;
  
  try {
    const query = `
      SELECT 
        t.id,
        t.plan_amount as amount,
        t.mobile,
        t.operator,
        t.provider_txn_id,
        t.status,
        t.created_at,
        u.business_name as agent_name,
        u.phone as agent_phone,
        u.business_address as agent_address,
        u.city,
        u.state,
        u.pin_code
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      WHERE t.id = $1 AND t.type = 'MOBILE_RECHARGE'
    `;
    const result = await db.query(query, [transactionId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    res.json({ success: true, receipt: result.rows[0] });
  } catch (error) {
    console.error('Recharge receipt error:', error);
    res.status(500).json({ error: 'Failed to fetch receipt data' });
  }
}

/**
 * GET /api/receipt/aeps/:transactionId
 * Returns AEPS transaction + merchant/agent details for receipt
 */
async function getAepsReceipt(req, res) {
  const { transactionId } = req.params;

  try {
    const query = `
      SELECT 
        at.id,
        at.txn_type,
        at.amount,
        at.status,
        at.rrn,
        at.bank_iin,
        at.bank_name,
        at.aadhaar_last4,
        at.npci_code,
        at.npci_message,
        at.available_balance,
        at.mini_statement as transaction_list,
        at.created_at,
        at.device_used,
        at.raw_response,
        u.first_name,
        u.last_name,
        u.phone as agent_phone,
        u.email as agent_email,
        am.shop_address,
        am.state_code,
        am.district_code,
        am.shop_pincode,
        am.merchant_id,
        am.merchant_ref_id
      FROM aeps_transactions at
      JOIN users u ON at.user_id = u.id
      LEFT JOIN aeps_merchants am ON am.user_id = u.id
      WHERE at.id = $1
    `;
    const result = await db.query(query, [transactionId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const row = result.rows[0];
    
    // Parse statusDescription from raw_response if available
    let statusDescription = '';
    if (row.raw_response) {
      try {
        const parsed = typeof row.raw_response === 'string' ? JSON.parse(row.raw_response) : row.raw_response;
        statusDescription = parsed.statusDescription || parsed.message || '';
      } catch (e) {}
    }

    // Parse transactionList if it's a string (JSON stringified array)
    let transactionList = [];
    if (row.transaction_list) {
      try {
        transactionList = typeof row.transaction_list === 'string' 
          ? JSON.parse(row.transaction_list) 
          : row.transaction_list;
      } catch (e) {}
    }

    const receiptData = {
      id: row.id,
      txn_type: row.txn_type,
      amount: row.amount,
      status: row.status,
      rrn: row.rrn,
      bank_iin: row.bank_iin,
      bank_name: row.bank_name,
      aadhaar_last4: row.aadhaar_last4,
      npci_code: row.npci_code,
      npci_message: row.npci_message,
      available_balance: row.available_balance,
      transactionList,
      created_at: row.created_at,
      txnDateTime: row.created_at, // fallback if not in raw_response
      statusDescription,
      device_used: row.device_used,
      // Agent / Store info
      first_name: row.first_name,
      last_name: row.last_name,
      agent_phone: row.agent_phone,
      agent_email: row.agent_email,
      shop_address: row.shop_address,
      shop_pincode: row.shop_pincode,
      state_code: row.state_code,
      district_code: row.district_code,
      merchant_id: row.merchant_id,
      merchant_ref_id: row.merchant_ref_id,
    };

    res.json({ success: true, receipt: receiptData });
  } catch (error) {
    console.error('AEPS receipt error:', error);
    res.status(500).json({ error: 'Failed to fetch AEPS receipt data' });
  }
}

/**
 * GET /api/receipt/bbps/:transactionId
 * Returns BBPS bill payment transaction + agent details for receipt
 */
async function getBbpsReceipt(req, res) {
  const { transactionId } = req.params;
  
  try {
    const query = `
      SELECT 
        t.id,
        t.plan_amount as amount,
        t.consumer_number,
        t.provider_txn_id,
        t.status,
        t.created_at,
        t.api_response,
        u.business_name as agent_name,
        u.phone as agent_phone,
        u.business_address as shop_address,
        u.city,
        u.state,
        u.pin_code
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      WHERE t.id = $1
    `;
    const result = await db.query(query, [transactionId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    const row = result.rows[0];
    
    // Extract biller name from api_response (fallback)
    let billerName = '—';
    try {
      const apiResp = typeof row.api_response === 'string' ? JSON.parse(row.api_response) : row.api_response;
      billerName = apiResp?.fetchBillResult?.billerName || 
                   apiResp?.fetchBillResult?.billerId || 
                   apiResp?.payStep?.billerResponse?.billerName || 
                   '—';
    } catch(e) { /* ignore */ }
    
    const kNo = row.provider_txn_id || `TXN${row.id}`;
    
    const receipt = {
      orderId: row.id,
      amount: parseFloat(row.amount),
      consumerNo: row.consumer_number || 'NA',
      billBoard: billerName,
      kNo: kNo,
      agentName: row.agent_name,
      agentPhone: row.agent_phone,
      shopName: row.shop_address,
      refNo: row.provider_txn_id,
      status: row.status,
      createdAt: row.created_at,
    };
    
    res.json({ success: true, receipt });
  } catch (error) {
    console.error('BBPS receipt error:', error);
    res.status(500).json({ error: 'Failed to fetch BBPS receipt data' });
  }
}

module.exports = { 
  getPayoutReceipt, 
  getRechargeReceipt, 
  getAepsReceipt,
  getBbpsReceipt 
};