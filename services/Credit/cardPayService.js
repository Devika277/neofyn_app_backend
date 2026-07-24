const axios = require('axios');
const pool = require('../config/db');
const logger = require('../utils/logger');
const CardPayEncryptionService = require('./cardPayEncryptionService');
const VidualGatewayProvider = require('../providers/vidualGatewayProvider');

const STATUS_CODE_MAP = {
  '000': '1000',
  '001': '2001',
  '002': '3002',
  '003': '4003',
  '004': '5004',
};

const VIDUAL_ENVIRONMENT = process.env.VIDUAL_ENVIRONMENT || 'sandbox';

class CardPayService {
  async initiatePayment(payload) {
    const {
      userId, amount, mobile, name, email,
      location, lat, long, udf1, udf2, udf3,
    } = payload;

    const merchantRefId = `CARD-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO cardpay_wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );

      const txnRes = await client.query(
        `INSERT INTO cardpay_transactions
         (user_id, merchant_ref_id, amount, location, latitude, longitude, udf1, udf2, udf3, txn_status, gateway_request)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [userId, merchantRefId, amount, location, lat, long, udf1, udf2, udf3, 'pending', JSON.stringify(payload)]
      );
      const txnId = txnRes.rows[0].id;

      await client.query(
        `INSERT INTO cardpay_customer_snapshots (cardpay_transaction_id, name, mobile, email)
         VALUES ($1, $2, $3, $4)`,
        [txnId, name, mobile, email]
      );

      await client.query('COMMIT');

      const configs = await pool.query(
        `SELECT key_name, key_value FROM cardpay_configurations WHERE environment = $1`,
        [VIDUAL_ENVIRONMENT]
      );
      const configMap = Object.fromEntries(configs.rows.map(r => [r.key_name, r.key_value]));

      const encryptionService = new CardPayEncryptionService(
        configMap.secretKey,
        configMap.saltKey
      );
      const provider = new VidualGatewayProvider();

      const authRes = await provider.authorize(
        configMap.secretKey,
        configMap.saltKey,
        configMap.encryptdecryptKey,
        configMap.userId
      );
      const bearerToken = authRes.data;
      logger.info('CardPay: received auth token', { hasToken: !!bearerToken });

      const plainPayload = JSON.stringify({
        amount,
        merchantRefId,
        custMobile: mobile,
        location,
        custName: name,
        email,
        lat,
        long,
        udf1,
        udf2,
        udf3,
      });
      const encrypted = encryptionService.encrypt(plainPayload);
      logger.info('CardPay: sending payment gateway request', {
        encryptedLength: encrypted?.length,
        merchantRefId,
      });

      const paymentRes = await provider.initiatePayment(
        bearerToken,
        configMap.userId,
        encrypted
      );

      let decryptedResponse = paymentRes;
      if (paymentRes.data) {
        try {
          const decrypted = encryptionService.decrypt(paymentRes.data);
          decryptedResponse = JSON.parse(decrypted);
        } catch (e) {
          logger.error('CardPay: failed to decrypt payment gateway response', { error: e.message, merchantRefId });
          throw new Error('Failed to process payment gateway response');
        }
      }

      await pool.query(
        `UPDATE cardpay_transactions
         SET payment_link = $1, gateway_response = $2
         WHERE id = $3`,
        [
          decryptedResponse.paymentUrl,
          JSON.stringify(decryptedResponse),
          txnId,
        ]
      );

      return {
        merchantRefId,
        paymentLink: decryptedResponse.paymentUrl,
        txnId,
      };
    } catch (error) {
      logger.error('CardPayService: initiatePayment error', { error: error.message, stack: error.stack });
      throw error;
    } finally {
      client.release();
    }
  }

  async getStateList() {
    try {
      const configs = await pool.query(
        `SELECT key_name, key_value FROM cardpay_configurations WHERE environment = $1`,
        [VIDUAL_ENVIRONMENT]
      );
      const configMap = Object.fromEntries(configs.rows.map(r => [r.key_name, r.key_value]));
      logger.info('DIAGNOSTIC: raw configMap', {
        keys: Object.keys(configMap),
        secretKeyLast4: configMap.secretKey ? configMap.secretKey.slice(-4) : 'MISSING',
        saltKeyLast4: configMap.saltKey ? configMap.saltKey.slice(-4) : 'MISSING',
        encryptdecryptKeyLast4: configMap.encryptdecryptKey ? configMap.encryptdecryptKey.slice(-4) : 'MISSING',
        rawRowCount: configs.rows.length,
        rawRowKeyNames: configs.rows.map(r => r.key_name),
      });

      const encryptionService = new CardPayEncryptionService(
        configMap.secretKey,
        configMap.saltKey
      );

      const diagKey = encryptionService.key;
      const diagIv = encryptionService.iv;
      logger.info('DIAGNOSTIC: key.length=%d iv.length=%d keyLast4=%s ivLast4=%s',
        diagKey.length, diagIv.length,
        diagKey.toString('utf8').slice(-4),
        diagIv.toString('utf8').slice(-4)
      );
      {
        const _testPlain = JSON.stringify({ test: 'roundtrip', ts: Date.now() });
        try {
          const _testEnc = encryptionService.encrypt(_testPlain);
          const _testDec = encryptionService.decrypt(_testEnc);
          logger.info('DIAGNOSTIC: round-trip %s', _testDec === _testPlain ? 'PASSED' : 'FAILED - content mismatch');
        } catch (e) {
          logger.error('DIAGNOSTIC: round-trip FAILED - %s', e.message);
        }
      }

      const provider = new VidualGatewayProvider();

      const authRes = await provider.authorize(
        configMap.secretKey,
        configMap.saltKey,
        configMap.encryptdecryptKey,
        configMap.userId
      );
      const token = authRes.data;
      const stateRes = await axios.get(
        'http://gateway.vimopay.in/masterapi/api/master/statelistuat',
        {
          headers: {
            Authorization: `Bearer ${token}`,
            userId: configMap.userId,
          },
        }
      );

      if (stateRes.data.data) {
        const rawDataField = stateRes.data.data;
        logger.info('DIAGNOSTIC: pre-decrypt value', {
          typeofRawDataField: typeof rawDataField,
          length: rawDataField?.length,
          first20: typeof rawDataField === 'string' ? rawDataField.slice(0, 20) : typeof rawDataField,
          last20: typeof rawDataField === 'string' ? rawDataField.slice(-20) : typeof rawDataField,
          isFullResponseObject: typeof stateRes.data === 'object' && rawDataField === stateRes.data,
          hasSuccessStatus: stateRes.data?.successStatus,
          responseCode: stateRes.data?.responseCode,
        });
        const decrypted = encryptionService.decrypt(rawDataField);
        return JSON.parse(decrypted);
      }

      return [];
    } catch (err) {
      logger.error('CardPayService: getStateList error', { error: err.message });
      throw err;
    }
  }

  async processCallback(callbackData) {
    const {
      merchantRefId,
      txnStatus,
      txnStatusCode,
      holderName,
      cardNumber,
      cardType,
      cardNetwork,
      rrn,
      charges,
    } = callbackData;

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const txnRes = await client.query(
        `SELECT id, user_id, amount, wallet_credited
         FROM cardpay_transactions
         WHERE merchant_ref_id = $1
         FOR UPDATE`,
        [merchantRefId]
      );

      if (txnRes.rows.length === 0) {
        await client.query('COMMIT');
        logger.warn('CardPay callback: transaction not found', { merchantRefId });
        return { success: false, successStatus: false, message: 'Transaction not found', responseCode: '4003' };
      }

      const txn = txnRes.rows[0];

      if (txn.wallet_credited) {
        await client.query('COMMIT');
        logger.info('CardPay callback: already processed (idempotent)', { merchantRefId });
        return { success: true, successStatus: true, message: 'Already processed', responseCode: '3002' };
      }

      const statusMap = {
        '000': 'success',
        '001': 'failed',
        '002': 'pending',
        '003': 'failed',
        '004': 'pending',
      };
      const status = statusMap[txnStatus] || 'failed';

      if (status === 'success') {
        const walletRes = await client.query(
          `SELECT balance FROM cardpay_wallets WHERE user_id = $1 FOR UPDATE`,
          [txn.user_id]
        );
        const wallet = walletRes.rows[0];
        if (!wallet) {
          throw new Error(
            `CardPay wallet record not found for merchantRefId=${merchantRefId} (userId=${txn.user_id}) — cannot credit balance`
          );
        }

        const balanceBefore = parseFloat(wallet.balance);
        const amount = parseFloat(txn.amount);

        await client.query(
          `UPDATE cardpay_wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2`,
          [amount, txn.user_id]
        );

        const walletAfterRes = await client.query(
          `SELECT balance FROM cardpay_wallets WHERE user_id = $1`,
          [txn.user_id]
        );
        const balanceAfter = parseFloat(walletAfterRes.rows[0].balance);

        await client.query(
          `INSERT INTO cardpay_wallet_ledger (user_id, cardpay_transaction_id, amount, balance_before, balance_after)
           VALUES ($1, $2, $3, $4, $5)`,
          [txn.user_id, txn.id, amount, balanceBefore, balanceAfter]
        );

        await client.query(
          `UPDATE cardpay_transactions SET
            txn_status = $1,
            txn_status_code = $2,
            card_holder_name = $3,
            card_last_four = $4,
            card_network = $5,
            rrn = $6,
            charges = $7,
            wallet_credited = TRUE,
            updated_at = NOW()
           WHERE id = $8`,
          [
            'success',
            txnStatusCode,
            holderName,
            cardNumber ? cardNumber.slice(-4) : null,
            cardNetwork,
            rrn,
            charges ? parseFloat(charges) : null,
            txn.id,
          ]
        );

        logger.info('CardPay callback: wallet credited', {
          userId: txn.user_id,
          amount,
          merchantRefId,
          balanceBefore,
          balanceAfter,
        });
      } else {
        await client.query(
          `UPDATE cardpay_transactions SET
            txn_status = $1,
            txn_status_code = $2,
            updated_at = NOW()
           WHERE id = $3`,
          [status, txnStatusCode, txn.id]
        );

        logger.info('CardPay callback: transaction not successful', {
          merchantRefId,
          status,
          txnStatusCode,
        });
      }

      await client.query('COMMIT');
      return { success: true, successStatus: true, message: 'Callback processed successfully', responseCode: STATUS_CODE_MAP[txnStatus] || '2001' };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('CardPayService: processCallback error', { error: error.message, stack: error.stack });
      throw error;
    } finally {
      client.release();
    }
  }

  async checkStatus(merchantRefId) {
    const result = await pool.query(
      `SELECT
        t.id, t.merchant_ref_id, t.amount, t.txn_status, t.txn_status_code,
        t.payment_link, t.created_at, t.updated_at,
        t.card_holder_name, t.card_last_four, t.card_network, t.rrn, t.charges,
        t.wallet_credited,
        cs.name, cs.mobile, cs.email,
        wl.balance_before, wl.balance_after
      FROM cardpay_transactions t
      LEFT JOIN cardpay_customer_snapshots cs ON cs.cardpay_transaction_id = t.id
      LEFT JOIN cardpay_wallet_ledger wl ON wl.cardpay_transaction_id = t.id
      WHERE t.merchant_ref_id = $1`,
      [merchantRefId]
    );
    return result.rows[0] || null;
  }

  async getDashboard() {
    const stats = await pool.query(`
      SELECT
        COUNT(*) AS total_transactions,
        COUNT(CASE WHEN txn_status = 'success' THEN 1 END) AS success_count,
        COUNT(CASE WHEN txn_status = 'failed' THEN 1 END) AS failed_count,
        COUNT(CASE WHEN txn_status = 'pending' THEN 1 END) AS pending_count,
        COALESCE(SUM(CASE WHEN txn_status = 'success' THEN amount END), 0) AS total_collected
      FROM cardpay_transactions
    `);

    const today = await pool.query(`
      SELECT COALESCE(SUM(CASE WHEN txn_status = 'success' THEN amount END), 0) AS today_collected
      FROM cardpay_transactions
      WHERE created_at::date = CURRENT_DATE
    `);

    return {
      totalTransactions: parseInt(stats.rows[0].total_transactions),
      successCount: parseInt(stats.rows[0].success_count),
      failedCount: parseInt(stats.rows[0].failed_count),
      pendingCount: parseInt(stats.rows[0].pending_count),
      totalCollected: parseFloat(stats.rows[0].total_collected),
      todayCollected: parseFloat(today.rows[0].today_collected),
    };
  }

  async getTransactions(filters = {}, limit = 50, offset = 0) {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (filters.status) {
      conditions.push(`t.txn_status = $${paramIndex++}`);
      params.push(filters.status);
    }
    if (filters.search) {
      conditions.push(`t.merchant_ref_id ILIKE $${paramIndex++}`);
      params.push(`%${filters.search}%`);
    }
    if (filters.startDate) {
      conditions.push(`t.created_at >= $${paramIndex++}::date`);
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push(`t.created_at <= ($${paramIndex++}::date + interval '1 day' - interval '1 second')`);
      params.push(filters.endDate);
    }
    if (filters.userId) {
      conditions.push(`t.user_id = $${paramIndex++}`);
      params.push(filters.userId);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM cardpay_transactions t ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await pool.query(
      `SELECT
        t.*,
        cs.name, cs.mobile, cs.email
      FROM cardpay_transactions t
      LEFT JOIN cardpay_customer_snapshots cs ON cs.cardpay_transaction_id = t.id
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    return { transactions: dataRes.rows, total };
  }

  async exportReport(filters = {}) {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (filters.status) {
      conditions.push(`t.txn_status = $${paramIndex++}`);
      params.push(filters.status);
    }
    if (filters.startDate) {
      conditions.push(`t.created_at >= $${paramIndex++}::date`);
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push(`t.created_at <= ($${paramIndex++}::date + interval '1 day' - interval '1 second')`);
      params.push(filters.endDate);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await pool.query(
      `SELECT
        t.id, t.merchant_ref_id, t.amount, t.txn_status, t.txn_status_code,
        t.card_holder_name, t.card_last_four, t.card_network, t.rrn, t.charges,
        t.wallet_credited, t.created_at, t.updated_at,
        cs.name, cs.mobile, cs.email,
        wl.balance_before, wl.balance_after
      FROM cardpay_transactions t
      LEFT JOIN cardpay_customer_snapshots cs ON cs.cardpay_transaction_id = t.id
      LEFT JOIN cardpay_wallet_ledger wl ON wl.cardpay_transaction_id = t.id
      ${whereClause}
      ORDER BY t.created_at DESC`,
      params
    );

    return result.rows;
  }

  async getConfig() {
    const result = await pool.query(
      'SELECT id, key_name, environment, created_at FROM cardpay_configurations ORDER BY key_name'
    );
    return result.rows;
  }

  async updateConfig(id, keyValue) {
    await pool.query(
      'UPDATE cardpay_configurations SET key_value = $1 WHERE id = $2',
      [keyValue, id]
    );
    return { success: true, successStatus: true, message: 'Configuration updated', responseCode: '000' };
  }

  async moveToMain(userId, amount) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const walletRes = await client.query(
        'SELECT balance FROM cardpay_wallets WHERE user_id = $1 FOR UPDATE',
        [userId]
      );

      if (walletRes.rows.length === 0) {
        throw new Error('CardPay wallet not found');
      }

      const currentBalance = parseFloat(walletRes.rows[0].balance);
      if (amount > currentBalance) {
        throw new Error('Insufficient CardPay balance');
      }

      const newCardPayBalance = currentBalance - amount;
      await client.query(
        'UPDATE cardpay_wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
        [newCardPayBalance, userId]
      );

      await client.query(
        `INSERT INTO cardpay_wallet_ledger
         (user_id, cardpay_transaction_id, amount, balance_before, balance_after, remarks)
         VALUES ($1, NULL, $2, $3, $4, $5)`,
        [userId, -amount, currentBalance, newCardPayBalance, 'Transfer to Main Wallet']
      );

      const mainWalletRes = await client.query(
        'SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE',
        [userId]
      );
      const mainWallet = mainWalletRes.rows[0];
      const currentMainBalance = parseFloat(mainWallet?.balance || 0);
      const newMainBalance = currentMainBalance + amount;
      await client.query(
        'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2',
        [newMainBalance, userId]
      );

      await client.query(
        `INSERT INTO wallet_ledger
         (wallet_id, transaction_type, amount, balance_after, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [mainWallet.id, 'credit', amount, newMainBalance, 'Transfer from CardPay']
      );

      await client.query('COMMIT');

      return {
        message: `₹${amount} moved to your main wallet`,
        newCardPayBalance,
        newMainBalance,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('CardPayService: moveToMain error', { error: error.message, stack: error.stack });
      throw error;
    } finally {
      client.release();
    }
  }

  async getCardPayLedger(userId, limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT
        id, amount, balance_before, balance_after, remarks, created_at
       FROM cardpay_wallet_ledger
       WHERE user_id = $1 AND remarks = 'Transfer to Main Wallet'
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  }

  async getWalletBalance(userId) {
    const result = await pool.query(
      'SELECT balance FROM cardpay_wallets WHERE user_id = $1',
      [userId]
    );
    return result.rows[0] ? parseFloat(result.rows[0].balance) : 0;
  }

  async getUserBalance(userId) {
    const res = await pool.query(
      'SELECT balance FROM cardpay_wallets WHERE user_id = $1',
      [userId]
    );
    if (res.rows.length === 0) {
      return { balance: 0 };
    }
    return { balance: parseFloat(res.rows[0].balance) };
  }

  async adminGetAllUserBalances() {
    const res = await pool.query(`
      SELECT
        u.id AS user_id,
        u.first_name || ' ' || u.last_name AS name,
        u.phone AS mobile,
        COALESCE(cw.balance, 0) AS cardpay_balance,
        cw.updated_at AS last_activity
      FROM users u
      LEFT JOIN cardpay_wallets cw ON cw.user_id = u.id
      ORDER BY cardpay_balance DESC
    `);
    return res.rows;
  }

  async adminGetCardPayLedger(filters) {
    const { limit = 20, offset = 0, startDate, endDate, searchTerm } = filters;
    let query = `
      SELECT
        wl.id,
        wl.user_id,
        u.first_name || ' ' || u.last_name AS user_name,
        u.phone AS mobile,
        wl.amount,
        wl.balance_before,
        wl.balance_after,
        wl.remarks,
        wl.created_at,
        t.merchant_ref_id,
        t.txn_status_code
      FROM cardpay_wallet_ledger wl
      LEFT JOIN users u ON u.id = wl.user_id
      LEFT JOIN cardpay_transactions t ON t.id = wl.cardpay_transaction_id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (startDate) {
      query += ` AND wl.created_at >= $${paramCount++}::date`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND wl.created_at <= ($${paramCount++}::date + interval '1 day' - interval '1 second')`;
      params.push(endDate);
    }
    if (searchTerm) {
      query += ` AND (u.first_name || ' ' || u.last_name ILIKE $${paramCount} OR u.phone ILIKE $${paramCount + 1} OR t.merchant_ref_id ILIKE $${paramCount + 2})`;
      params.push(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
      paramCount += 3;
    }

    query += ` ORDER BY wl.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(limit, offset);

    const res = await pool.query(query, params);

    let countQuery = `
      SELECT COUNT(*) AS total
      FROM cardpay_wallet_ledger wl
      LEFT JOIN users u ON u.id = wl.user_id
      WHERE 1=1
    `;
    const countParams = [];
    let countParamCount = 1;
    if (startDate) {
      countQuery += ` AND wl.created_at >= $${countParamCount++}::date`;
      countParams.push(startDate);
    }
    if (endDate) {
      countQuery += ` AND wl.created_at <= ($${countParamCount++}::date + interval '1 day' - interval '1 second')`;
      countParams.push(endDate);
    }
    if (searchTerm) {
      countQuery += ` AND (u.first_name || ' ' || u.last_name ILIKE $${countParamCount} OR u.phone ILIKE $${countParamCount + 1} OR t.merchant_ref_id ILIKE $${countParamCount + 2})`;
      countParams.push(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
      countParamCount += 3;
    }
    const countRes = await pool.query(countQuery, countParams);
    const total = parseInt(countRes.rows[0].total);

    return { data: res.rows, total };
  }
}

const cardPayServiceInstance = new CardPayService();
cardPayServiceInstance.STATUS_CODE_MAP = STATUS_CODE_MAP;
module.exports = cardPayServiceInstance;
