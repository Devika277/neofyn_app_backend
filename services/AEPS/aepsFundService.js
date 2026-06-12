// backend/services/aepsFundService.js
const db = require('../config/db');
const aepsWalletService = require('./aepsWalletService');

// ==============================
// User Functions
// ==============================

const createRequest = async (userId, { amount, paymentMode, utrNumber, depositSlip, remarks }) => {
  try {
    const result = await db.query(
      `INSERT INTO aeps_fund_requests 
         (user_id, amount, payment_mode, utr_number, deposit_slip, remarks, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id`,
      [userId, amount, paymentMode, utrNumber, depositSlip, remarks]
    );
    return {
      success: true,
      requestId: result.rows[0].id,
    };
  } catch (error) {
    console.error('createRequest error:', error);
    throw new Error('Failed to create fund request');
  }
};

const getUserRequests = async (userId) => {
  try {
    const result = await db.query(
      `SELECT id, amount, payment_mode, utr_number, deposit_slip, remarks, status, admin_remark, created_at, updated_at
       FROM aeps_fund_requests
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  } catch (error) {
    console.error('getUserRequests error:', error);
    throw new Error('Failed to fetch fund requests');
  }
};

const cancelRequest = async (userId, requestId) => {
  try {
    const check = await db.query(
      `SELECT id FROM aeps_fund_requests 
       WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [requestId, userId]
    );
    if (check.rows.length === 0) {
      throw new Error('Request not found or cannot be cancelled');
    }
    await db.query(
      `UPDATE aeps_fund_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [requestId]
    );
    return { success: true };
  } catch (error) {
    console.error('cancelRequest error:', error);
    throw error;
  }
};

// ==============================
// Admin Functions
// ==============================

const adminGetPendingRequests = async () => {
  try {
    const result = await db.query(
      `SELECT r.*, u.name as user_name, u.email, u.phone
       FROM aeps_fund_requests r
       JOIN users u ON r.user_id = u.id
       WHERE r.status = 'pending'
       ORDER BY r.created_at ASC`
    );
    return result.rows;
  } catch (error) {
    console.error('adminGetPendingRequests error:', error);
    throw new Error('Failed to fetch pending requests');
  }
};

const adminApproveRequest = async (requestId, adminId, adminRemark) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const reqResult = await client.query(
      `SELECT user_id, amount FROM aeps_fund_requests 
       WHERE id = $1 AND status = 'pending'
       FOR UPDATE`,
      [requestId]
    );
    if (reqResult.rows.length === 0) {
      throw new Error('Request not found or already processed');
    }
    const { user_id, amount } = reqResult.rows[0];

    await aepsWalletService.creditAepsWallet(
      user_id,
      amount,
      `AePS fund request approved - Request ID: ${requestId}`,
      `fund_${requestId}`,
      adminId,
      client
    );

    await client.query(
      `UPDATE aeps_fund_requests 
       SET status = 'approved', admin_remark = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [adminRemark, adminId, requestId]
    );

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('adminApproveRequest error:', error);
    throw error;
  } finally {
    client.release();
  }
};

const adminRejectRequest = async (requestId, adminId, adminRemark) => {
  try {
    const result = await db.query(
      `UPDATE aeps_fund_requests 
       SET status = 'rejected', admin_remark = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING id`,
      [adminRemark, adminId, requestId]
    );
    if (result.rows.length === 0) {
      throw new Error('Request not found or already processed');
    }
    return { success: true };
  } catch (error) {
    console.error('adminRejectRequest error:', error);
    throw error;
  }
};

module.exports = {
  createRequest,
  getUserRequests,
  cancelRequest,
  adminGetPendingRequests,
  adminApproveRequest,
  adminRejectRequest,
};