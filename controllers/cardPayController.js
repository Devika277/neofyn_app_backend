const cardPayService = require('../services/cardPayService');
const CardPayReceiptService = require('../services/cardPayReceiptService');
const logger = require('../utils/logger');

class CardPayController {
  async getStateList(req, res) {
    try {
      const states = await cardPayService.getStateList();
      return res.status(200).json({ success: true, successStatus: true, message: 'States retrieved successfully', responseCode: '000', states });
    } catch (error) {
      logger.error('CardPayController: getStateList error', { error: error.message });
      return res.status(500).json({ success: false, successStatus: false, message: 'Failed to fetch state list', responseCode: '001' });
    }
  }

  async initiate(req, res) {
    try {
      const { amount, mobile, name, email, location, lat, long, udf1, udf2, udf3 } = req.body;

      if (!amount || !mobile || !name) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: amount, mobile, name',
          successStatus: false,
          message: 'Missing required fields: amount, mobile, name',
          responseCode: '003',
        });
      }

      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid amount', successStatus: false, message: 'Invalid amount', responseCode: '003' });
      }
      if (amountNum >= 100000) {
        return res.status(400).json({ success: false, error: 'Amount must be below 1,00,000', successStatus: false, message: 'Amount must be below 1,00,000', responseCode: '003' });
      }

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: 'A valid email is required', successStatus: false, message: 'A valid email is required', responseCode: '003' });
      }

      if (!location) {
        return res.status(400).json({ success: false, error: 'Location (state) is required', successStatus: false, message: 'Location (state) is required', responseCode: '003' });
      }

      if (!lat || !long || isNaN(parseFloat(lat)) || isNaN(parseFloat(long))) {
        return res.status(400).json({ success: false, error: 'Valid lat/long coordinates are required', successStatus: false, message: 'Valid lat/long coordinates are required', responseCode: '003' });
      }

      const result = await cardPayService.initiatePayment({
        userId: req.user.id,
        amount: amountNum,
        mobile,
        name,
        email,
        location,
        lat: lat.toString(),
        long: long.toString(),
        udf1: udf1 || '',
        udf2: udf2 || '',
        udf3: udf3 || '',
      });

      return res.status(200).json({
        success: true,
        successStatus: true,
        message: 'Payment initiated successfully',
        responseCode: '000',
        data: {
          merchantRefId: result.merchantRefId,
          paymentLink: result.paymentLink,
          txnId: result.txnId,
        },
      });
    } catch (error) {
      logger.error('CardPayController: initiate error', { error: error.message, stack: error.stack });
      return res.status(500).json({
        success: false,
        successStatus: false,
        message: error.message || 'Failed to initiate payment. Please try again.',
        responseCode: '001',
        error: error.message || 'Failed to initiate payment. Please try again.',
        ...(error.code && { dbCode: error.code }),
      });
    }
  }

  async callback(req, res) {
    try {
      const result = await cardPayService.processCallback(req.body);

      return res.status(200).json({
        success: true,
        successStatus: true,
        message: result.message,
        responseCode: result.responseCode || '000',
      });
    } catch (error) {
      logger.error('CardPayController: callback error', { error: error.message });
      return res.status(200).json({
        success: false,
        successStatus: false,
        message: 'Callback processing failed',
        responseCode: '2001',
      });
    }
  }

  async status(req, res) {
    try {
      const { ref } = req.params;
      const data = await cardPayService.checkStatus(ref);

      if (!data) {
        return res.status(404).json({
          success: false,
          error: 'Transaction not found',
          successStatus: false,
          message: 'Transaction not found',
          responseCode: '004',
        });
      }

      return res.status(200).json({
        success: true,
        successStatus: true,
        message: 'Transaction status retrieved',
        responseCode: '000',
        data,
      });
    } catch (error) {
      logger.error('CardPayController: status error', { error: error.message });
      return res.status(500).json({
        success: false,
        successStatus: false,
        message: 'Failed to fetch transaction status',
        responseCode: '001',
        error: 'Failed to fetch transaction status',
      });
    }
  }

  async getReceipt(req, res) {
    try {
      const { ref } = req.params;
      const receiptService = new CardPayReceiptService();
      const data = await receiptService.getReceiptData(ref);

      if (!data) {
        return res.status(404).json({
          success: false,
          error: 'Receipt not found',
          successStatus: false,
          message: 'Receipt not found',
          responseCode: '004',
        });
      }

      return res.status(200).json({
        success: true,
        successStatus: true,
        message: 'Receipt retrieved',
        responseCode: '000',
        receipt: data,
      });
    } catch (error) {
      logger.error('CardPayController: receipt error', { error: error.message });
      return res.status(500).json({
        success: false,
        successStatus: false,
        message: 'Failed to fetch receipt',
        responseCode: '001',
        error: 'Failed to fetch receipt',
      });
    }
  }

  async getDashboard(req, res) {
    try {
      const data = await cardPayService.getDashboard();
      return res.status(200).json({ success: true, successStatus: true, message: 'Dashboard data retrieved', responseCode: '000', data });
    } catch (error) {
      logger.error('CardPayController: dashboard error', { error: error.message });
      return res.status(500).json({ success: false, successStatus: false, message: 'Failed to fetch dashboard', responseCode: '001' });
    }
  }

  async getTransactions(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const filters = {
        status: req.query.status,
        search: req.query.search,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        userId: req.query.userId,
      };

      const result = await cardPayService.getTransactions(filters, limit, offset);

      return res.status(200).json({
        success: true,
        successStatus: true,
        message: 'Transactions retrieved',
        responseCode: '000',
        data: result.transactions,
        pagination: {
          limit,
          offset,
          total: result.total,
          count: result.transactions.length,
        },
      });
    } catch (error) {
      logger.error('CardPayController: transactions error', { error: error.message });
      return res.status(500).json({ success: false, successStatus: false, message: 'Failed to fetch transactions', responseCode: '001' });
    }
  }

  async exportReport(req, res) {
    try {
      const filters = {
        status: req.query.status,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      };

      const rows = await cardPayService.exportReport(filters);

      const header = 'ID,Merchant Ref ID,Amount,Status,Status Code,Card Holder,Card Last 4,Card Network,RRN,Charges,Wallet Credited,Customer Name,Mobile,Email,Balance Before,Balance After,Created At\n';
      const csv = rows.map(r =>
        [
          r.id,
          r.merchant_ref_id,
          r.amount,
          r.txn_status,
          r.txn_status_code,
          r.card_holder_name,
          r.card_last_four,
          r.card_network,
          r.rrn,
          r.charges,
          r.wallet_credited,
          r.name,
          r.mobile,
          r.email,
          r.balance_before,
          r.balance_after,
          r.created_at,
        ].join(',')
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=cardpay-report-${Date.now()}.csv`);
      return res.status(200).send(header + csv);
    } catch (error) {
      logger.error('CardPayController: export error', { error: error.message });
      return res.status(500).json({ success: false, successStatus: false, message: 'Failed to export report', responseCode: '001' });
    }
  }

  async getConfig(req, res) {
    try {
      const data = await cardPayService.getConfig();
      return res.status(200).json({ success: true, successStatus: true, message: 'Config retrieved', responseCode: '000', data });
    } catch (error) {
      logger.error('CardPayController: getConfig error', { error: error.message });
      return res.status(500).json({ success: false, successStatus: false, message: 'Failed to fetch config', responseCode: '001' });
    }
  }

  async updateConfig(req, res) {
    try {
      const { id, keyValue } = req.body;
      if (!id || !keyValue) {
        return res.status(400).json({ success: false, error: 'Missing id or keyValue', successStatus: false, message: 'Missing id or keyValue', responseCode: '003' });
      }
      await cardPayService.updateConfig(id, keyValue);
      return res.status(200).json({ success: true, successStatus: true, message: 'Configuration updated', responseCode: '000' });
    } catch (error) {
      logger.error('CardPayController: updateConfig error', { error: error.message });
      return res.status(500).json({ success: false, successStatus: false, message: 'Failed to update config', responseCode: '001' });
    }
  }

  async walletBalance(req, res) {
    try {
      const balance = await cardPayService.getWalletBalance(req.user.id);
      return res.status(200).json({ success: true, successStatus: true, message: 'Wallet balance retrieved', responseCode: '000', balance });
    } catch (error) {
      logger.error('CardPayController: walletBalance error', { error: error.message });
      return res.status(500).json({ success: false, successStatus: false, message: 'Failed to fetch wallet balance', responseCode: '001' });
    }
  }

  async moveToMain(req, res) {
    try {
      const userId = req.user.id;
      const { amount } = req.body;

      if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid amount', successStatus: false, message: 'Invalid amount', responseCode: '003' });
      }

      const result = await cardPayService.moveToMain(userId, parseFloat(amount));
      return res.status(200).json({ success: true, successStatus: true, message: result.message, responseCode: '000', newCardPayBalance: result.newCardPayBalance, newMainBalance: result.newMainBalance });
    } catch (error) {
      logger.error('CardPayController: moveToMain error', { error: error.message });
      const status = error.message.includes('Insufficient') || error.message.includes('not found') ? 400 : 500;
      const responseCode = status === 400 ? '003' : '001';
      return res.status(status).json({ success: false, error: error.message, successStatus: false, message: error.message, responseCode });
    }
  }

  async getCardPayLedger(req, res) {
    try {
      const userId = req.user.id;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const entries = await cardPayService.getCardPayLedger(userId, limit, offset);
      return res.json({ success: true, successStatus: true, message: 'Ledger entries retrieved', responseCode: '000', entries });
    } catch (error) {
      logger.error('CardPayController: getCardPayLedger error', { error: error.message });
      return res.status(500).json({ success: false, successStatus: false, message: error.message, responseCode: '001' });
    }
  }

  async getBalance(req, res) {
    try {
      const result = await cardPayService.getUserBalance(req.user.id);
      return res.json({ success: true, successStatus: true, message: 'Balance retrieved', responseCode: '000', data: result });
    } catch (error) {
      logger.error('CardPayController: getBalance error', { error: error.message });
      return res.status(500).json({ success: false, successStatus: false, message: 'Failed to fetch CardPay balance', responseCode: '001' });
    }
  }

  async adminGetAllUserBalances(req, res) {
    try {
      const data = await cardPayService.adminGetAllUserBalances();
      return res.json({ success: true, successStatus: true, message: 'User balances retrieved', responseCode: '000', data });
    } catch (error) {
      logger.error('CardPayController: adminGetAllUserBalances error', { error: error.message });
      return res.status(500).json({ success: false, successStatus: false, message: 'Failed to fetch user balances', responseCode: '001' });
    }
  }

  async adminGetCardPayLedger(req, res) {
    try {
      const { limit = 20, offset = 0, startDate, endDate, searchTerm } = req.query;
      const result = await cardPayService.adminGetCardPayLedger({
        limit: parseInt(limit),
        offset: parseInt(offset),
        startDate,
        endDate,
        searchTerm,
      });
      return res.json({ success: true, successStatus: true, message: 'Ledger data retrieved', responseCode: '000', data: result.data, total: result.total });
    } catch (error) {
      logger.error('CardPayController: adminGetCardPayLedger error', { error: error.message });
      return res.status(500).json({ success: false, successStatus: false, message: 'Failed to fetch ledger', responseCode: '001' });
    }
  }

  async getUserHistory(req, res) {
    try {
      const userId = req.user.id;
      const { status, startDate, endDate, search, limit = 20, offset = 0 } = req.query;

      const pool = require('../config/db');

      let query = `
        SELECT
          t.id,
          t.merchant_ref_id,
          t.amount,
          t.txn_status,
          t.txn_status_code,
          t.card_last_four,
          t.card_network,
          t.rrn,
          t.charges,
          t.created_at,
          t.updated_at,
          cs.name AS customer_name,
          cs.mobile AS customer_mobile,
          cs.email AS customer_email,
          wl.balance_before,
          wl.balance_after
        FROM cardpay_transactions t
        LEFT JOIN cardpay_customer_snapshots cs ON cs.cardpay_transaction_id = t.id
        LEFT JOIN cardpay_wallet_ledger wl ON wl.cardpay_transaction_id = t.id
        WHERE t.user_id = $1
      `;

      const params = [userId];
      let paramCount = 2;

      if (status && status !== 'all') {
        query += ` AND t.txn_status = $${paramCount++}`;
        params.push(status);
      }

      if (startDate) {
        query += ` AND t.created_at >= $${paramCount++}::date`;
        params.push(startDate);
      }

      if (endDate) {
        query += ` AND t.created_at <= ($${paramCount++}::date + interval '1 day' - interval '1 second')`;
        params.push(endDate);
      }

      if (search) {
        query += ` AND t.merchant_ref_id ILIKE $${paramCount++}`;
        params.push(`%${search}%`);
      }

      const countResult = await pool.query(
        `SELECT COUNT(*) AS total FROM cardpay_transactions t WHERE t.user_id = $1`,
        [userId]
      );
      const total = parseInt(countResult.rows[0].total);

      query += ` ORDER BY t.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
      params.push(parseInt(limit), parseInt(offset));

      const result = await pool.query(query, params);

      return res.json({
        success: true,
        successStatus: true,
        message: 'History retrieved',
        responseCode: '000',
        transactions: result.rows,
        total,
      });
    } catch (error) {
      logger.error('CardPayController: getUserHistory error', { error: error.message });
      return res.status(500).json({ success: false, successStatus: false, message: error.message, responseCode: '001' });
    }
  }
}

module.exports = new CardPayController();
