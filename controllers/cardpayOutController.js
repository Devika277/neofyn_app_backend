const cardpayOutService = require('../services/cardpayOutService');
const db = require('../config/db');
const logger = require('../utils/logger');

async function getBeneficiaries(req, res, next) {
  try {
    const userId = req.user.id;
    const result = await cardpayOutService.getBeneficiaries(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function addBeneficiary(req, res, next) {
  try {
    const userId = req.user.id;
    const { account_holder_name, account_number, ifsc_code, bank_name } = req.body;
    if (!account_number || !ifsc_code) {
      return res.status(400).json({ success: false, error: 'Account number and IFSC are required', successStatus: false, message: 'Account number and IFSC are required', responseCode: '003' });
    }
    const result = await cardpayOutService.addBeneficiary(userId, {
      account_holder_name, account_number, ifsc_code, bank_name
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function deleteBeneficiary(req, res, next) {
  try {
    const userId = req.user.id;
    const beneficiaryId = parseInt(req.params.id);
    await cardpayOutService.deleteBeneficiary(userId, beneficiaryId);
    res.json({ success: true, successStatus: true, message: 'Beneficiary deleted successfully', responseCode: '000' });
  } catch (err) {
    next(err);
  }
}

async function getBalance(req, res, next) {
  try {
    const userId = req.user.id;
    const result = await cardpayOutService.getCardPayBalance(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getLimits(req, res, next) {
  try {
    const userId = req.user.id;
    const result = await cardpayOutService.getWithdrawalLimits(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function initiatePayout(req, res, next) {
  try {
    const userId = req.user.id;
    const { amount, mode, beneficiaryId, tpin, remarks } = req.body;
    if (!amount || !mode || !beneficiaryId || !tpin) {
      return res.status(400).json({ success: false, error: 'Missing required fields: amount, mode, beneficiaryId, tpin', successStatus: false, message: 'Missing required fields: amount, mode, beneficiaryId, tpin', responseCode: '003' });
    }
    const result = await cardpayOutService.initiatePayout(userId, {
      amount, mode, beneficiaryId, tpin, remarks
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getStatus(req, res, next) {
  try {
    const { ref } = req.params;
    const result = await cardpayOutService.getTransactionStatus(ref);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getReceipt(req, res, next) {
  try {
    const { ref } = req.params;
    const result = await cardpayOutService.getReceiptData(ref);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getHistory(req, res, next) {
  try {
    const userId = req.user.id;
    const { status, from, to } = req.query;
    const result = await cardpayOutService.getUserTransactions(userId, { status, from, to });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function processCallback(req, res, next) {
  try {
    const result = await cardpayOutService.processCallback(req.body);
    res.json(result);
  } catch (err) {
    logger.error('cardpayOut callback processing failed', { error: err.message });
    res.status(200).json({ successStatus: false, message: 'Error processing callback', responseCode: '2001' });
  }
}

async function adminGetDashboard(req, res, next) {
  try {
    const result = await cardpayOutService.getAdminDashboard();
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function adminGetTransactions(req, res, next) {
  try {
    const { user_id, status, from, to } = req.query;
    const result = await cardpayOutService.getAllTransactions({ user_id, status, from, to });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function adminGetTransaction(req, res, next) {
  try {
    const { id } = req.params;
    const result = await cardpayOutService.getTransactionDetail(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function adminProcess(req, res, next) {
  try {
    const { id } = req.params;
    const result = await cardpayOutService.adminProcessTransaction(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function adminCancel(req, res, next) {
  try {
    const { id } = req.params;
    const result = await cardpayOutService.adminCancelTransaction(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function adminExportReport(req, res, next) {
  try {
    const { from, to, status } = req.query;
    const result = await cardpayOutService.getExportData({ from, to, status });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function adminGetConfig(req, res, next) {
  try {
    const result = await cardpayOutService.getConfig();
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function adminUpdateConfig(req, res, next) {
  try {
    const { key_name, key_value, environment } = req.body;
    await cardpayOutService.updateConfig(key_name, key_value, environment);
    res.json({ success: true, successStatus: true, message: 'Configuration updated', responseCode: '000' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getBeneficiaries, addBeneficiary, deleteBeneficiary,
  getBalance, getLimits, initiatePayout, getStatus, getReceipt, getHistory,
  processCallback,
  adminGetDashboard, adminGetTransactions, adminGetTransaction,
  adminProcess, adminCancel, adminExportReport, adminGetConfig, adminUpdateConfig
};
