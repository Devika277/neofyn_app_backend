const pool = require('../../config/db');
const walletService = require('../walletService');

// ============================================
// User submits a fund request
// ============================================
const createRequest = async (userId, requestData) => {
  const { amount, payment_mode, reference_number, remark, bank_name } = requestData;

  try {
   const result = await pool.query(
  `INSERT INTO fund_requests
   (
     user_id,
     amount,
     payment_mode,
     reference_number,
     remark,
     status,
     bank_name
   )
   VALUES($1, $2, $3, $4, $5, 'pending', $6)
   RETURNING *`,
  [userId, amount, payment_mode, reference_number, remark, bank_name]
);
console.log("requestData:", requestData);
console.log("bankName:", bank_name);

    return result.rows[0];
  } catch (error) {
    console.error("Fund Request Error:", error);
    throw error;
  }
};

// ============================================
// User views their own requests
// ============================================
const getUserRequests = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT * FROM fund_requests 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    return result.rows;
  } catch (error) {
    throw error;
  }
};

// ============================================
// User cancels their own pending request (within 2 hours)
// ============================================
const cancelRequest = async (requestId, userId) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get the request and verify it belongs to the user
    const requestResult = await client.query(
      'SELECT * FROM fund_requests WHERE id = $1 AND user_id = $2',
      [requestId, userId]
    );

    if (requestResult.rows.length === 0) {
      throw new Error('Request not found');
    }

    const request = requestResult.rows[0];

    // Check if request is still pending
    if (request.status !== 'pending') {
      throw new Error('Only pending requests can be cancelled');
    }

    // Check if within 2 hours (7200 seconds)
    const createdAt = new Date(request.created_at);
    const now = new Date();
    const hoursDiff = (now - createdAt) / (1000 * 60 * 60);

    if (hoursDiff > 2) {
      throw new Error('Requests can only be cancelled within 2 hours of submission');
    }

    // Update status to cancelled
    const result = await client.query(
      `UPDATE fund_requests 
       SET status = 'cancelled' 
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [requestId, userId]
    );

    await client.query('COMMIT');

    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// ============================================
// Admin views all pending requests
// ============================================
const getPendingRequests = async () => {
  try {
    const result = await pool.query(
      `SELECT fr.*, 
        u.first_name, 
        u.last_name, 
        u.email, 
        u.phone 
       FROM fund_requests fr
       JOIN users u ON fr.user_id = u.id
       WHERE fr.status = 'pending'
       ORDER BY fr.created_at DESC`
    );

    return result.rows;
  } catch (error) {
    throw error;
  }
};

// ============================================
// Admin views all requests (with filters)
// ============================================
const getAllRequests = async (status = null) => {
  try {
    let query = `
      SELECT fr.*, 
        u.first_name, 
        u.last_name, 
        u.email, 
        u.phone 
      FROM fund_requests fr
      JOIN users u ON fr.user_id = u.id
    `;

    const params = [];

    if (status) {
      query += ` WHERE fr.status = $1`;
      params.push(status);
    }

    query += ` ORDER BY fr.created_at DESC`;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    throw error;
  }
};

// ============================================
// Admin approves request - connects to wallet
// ============================================
const approveRequest = async (requestId, adminId) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get the request details
    const requestResult = await client.query(
      'SELECT * FROM fund_requests WHERE id = $1',
      [requestId]
    );

    if (requestResult.rows.length === 0) {
      throw new Error('Request not found');
    }

    const request = requestResult.rows[0];

    if (request.status !== 'pending') {
      throw new Error('Request already processed');
    }

    // Update request status – no admin_remark, add reviewed_by
    await client.query(
      `UPDATE fund_requests 
       SET status = 'approved', 
           reviewed_at = CURRENT_TIMESTAMP,
           reviewed_by = $1
       WHERE id = $2`,
      [adminId, requestId]
    );

    // Call wallet service to add money — reuse existing client to avoid nested connection
    await walletService.addMoney(
      request.user_id,
      request.amount,
      `Fund request approved #${requestId}`,
      adminId,
      client
    );

    await client.query('COMMIT');

    return { success: true, message: 'Request approved and wallet credited' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// ============================================
// Admin rejects request
// ============================================
const rejectRequest = async (requestId, adminId, adminRemark) => {
  try {
    const result = await pool.query(
      `UPDATE fund_requests 
       SET status = 'rejected', 
           admin_remark = $1,
           reviewed_at = CURRENT_TIMESTAMP,
           reviewed_by = $2
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [adminRemark, adminId, requestId]
    );

    if (result.rows.length === 0) {
      throw new Error('Request not found or already processed');
    }

    return result.rows[0];
  } catch (error) {
    throw error;
  }
};

module.exports = {
  createRequest,
  getUserRequests,
  cancelRequest,
  getPendingRequests,
  getAllRequests,
  approveRequest,
  rejectRequest
};