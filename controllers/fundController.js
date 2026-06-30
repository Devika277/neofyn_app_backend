const fundService = require('../services/Fund/fundService');

// ============================================
// User submits a fund request
// ============================================
const submitRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, payment_mode, reference_number, remark, bank_name } = req.body;

    // Validate required fields
    if (!amount || !payment_mode) {
      return res.status(400).json({
        success: false,
        error: 'Amount and payment mode are required'
      });
    }

    // Validate bankName
if (!bank_name || bank_name.trim() === '') {      return res.status(400).json({
        success: false,
        error: 'Bank name is required'
      });
    }

    if (amount < 100) {
      return res.status(400).json({
        success: false,
        error: 'Minimum amount is ₹100'
      });
    }

    const request = await fundService.createRequest(userId, {
      amount,
      payment_mode,
      reference_number,
      remark,
      bank_name
    });

    res.status(201).json({
      success: true,
      message: 'Fund request submitted successfully',
      data: request
    });

  } catch (error) {
    console.error('Submit request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit fund request'
    });
  }
};

// ============================================
// User gets their own requests
// ============================================
const getMyRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const requests = await fundService.getUserRequests(userId);

    res.json({
      success: true,
      data: requests
    });

  } catch (error) {
    console.error('Get my requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch requests'
    });
  }
};

// ============================================
// User cancels their own pending request
// ============================================
const cancelRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const cancelledRequest = await fundService.cancelRequest(id, userId);

    res.json({
      success: true,
      message: 'Request cancelled successfully',
      data: cancelledRequest
    });

  } catch (error) {
    console.error('Cancel request error:', error);
    
    if (error.message === 'Request not found') {
      return res.status(404).json({
        success: false,
        error: 'Request not found'
      });
    }
    
    if (error.message === 'Only pending requests can be cancelled') {
      return res.status(400).json({
        success: false,
        error: 'Only pending requests can be cancelled'
      });
    }
    
    if (error.message === 'Requests can only be cancelled within 2 hours of submission') {
      return res.status(400).json({
        success: false,
        error: 'Requests can only be cancelled within 2 hours of submission'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to cancel request'
    });
  }
};

// ============================================
// Admin gets all pending requests
// ============================================
const getPendingRequests = async (req, res) => {
  try {
    const requests = await fundService.getPendingRequests();

    res.json({
      success: true,
      data: requests
    });

  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pending requests'
    });
  }
};

// ============================================
// Admin gets all requests (with optional status filter)
// ============================================
const getAllRequests = async (req, res) => {
  try {
    const { status } = req.query;
    
    const requests = await fundService.getAllRequests(status);

    res.json({
      success: true,
      data: requests
    });

  } catch (error) {
    console.error('Get all requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch requests'
    });
  }
};

// ============================================
// Admin approves a request (auto-credits wallet)
// ============================================
const approveRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;
    const { admin_remark } = req.body;

    const result = await fundService.approveRequest(id, adminId, admin_remark);

    res.json({
      success: true,
      message: 'Request approved and wallet credited',
      data: result
    });

  } catch (error) {
    console.error('Approve request error:', error);
    
    if (error.message === 'Request not found') {
      return res.status(404).json({
        success: false,
        error: 'Request not found'
      });
    }
    
    if (error.message === 'Request already processed') {
      return res.status(400).json({
        success: false,
        error: 'Request already processed'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to approve request'
    });
  }
};

// ============================================
// Admin rejects a request
// ============================================
const rejectRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;
    const { admin_remark } = req.body;

    if (!admin_remark) {
      return res.status(400).json({
        success: false,
        error: 'Remark is required for rejection'
      });
    }

    const request = await fundService.rejectRequest(id, adminId, admin_remark);

    res.json({
      success: true,
      message: 'Request rejected',
      data: request
    });

  } catch (error) {
    console.error('Reject request error:', error);
    
    if (error.message === 'Request not found or already processed') {
      return res.status(404).json({
        success: false,
        error: 'Request not found or already processed'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to reject request'
    });
  }
};

module.exports = {
  submitRequest,
  getMyRequests,
  cancelRequest,
  getPendingRequests,
  getAllRequests,
  approveRequest,
  rejectRequest
};