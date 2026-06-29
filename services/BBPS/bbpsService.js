const { v4: uuidv4 } = require('uuid');
const db = require('../../config/db');
const logger = require('../../utils/logger');
const walletService = require('../walletService');
const providerRouter = require('../providerRouter');
const { processCommission } = require('../Commission/commissionService');

class PaymentService {
  
  // ─── NORMALIZE BILL TYPE ──────────────────────────────────────────────
  /**
   * Normalize bill type to a consistent value
   * @param {string} serviceType - Raw service type from request
   * @returns {string} Normalized service type
   */
  _normalizeBillType(serviceType) {
    if (!serviceType) return 'others';
    
    const type = serviceType.toLowerCase().trim();
    
    // Electricity
    if (['electricity', 'electric', 'eb', 'tneb', 'kesco', 'bescom', 
         'tata power', 'adani electricity', 'ksebl0000ker01'].includes(type)) {
      return 'electricity';
    }
    
    // Fastag - All variations
    if (['fastag', 'Fastag', 'FASTAG', 'thef00000natzo', 'idfc00000natxm',
         'federal bank', 'idfc', 'idfc bank', 'federal', 'federal bank - fastag',
         'idfc first bank fastag', 'federal bank - fastag', 'thef00000natzo'].includes(type) ||
        type.includes('fastag')) {
      return 'fastag';
    }
    
    // Water
    if (['water', 'water supply'].includes(type)) {
      return 'water';
    }
    
    // LPG Gas
    if (['lpg', 'lpg_gas', 'indane', 'bharat gas', 'hp gas'].includes(type)) {
      return 'lpg_gas';
    }
    
    // Piped Gas
    if (['piped gas', 'piped_gas'].includes(type)) {
      return 'piped_gas';
    }
    
    // Postpaid
    if (['postpaid', 'mobile postpaid', 'airtel postpaid', 'jio postpaid', 'vi postpaid'].includes(type)) {
      return 'postpaid';
    }
    
    // Broadband
    if (['broadband', 'internet', 'wifi'].includes(type)) {
      return 'broadband';
    }
    
    // Landline
    if (['landline', 'phone'].includes(type)) {
      return 'landline';
    }
    
    // Credit Card
    if (['credit_card', 'credit card', 'cc'].includes(type)) {
      return 'credit_card';
    }
    
    // Loan Repayment
    if (['loan', 'loan_repayment', 'emi'].includes(type)) {
      return 'loan_repayment';
    }
    
    // Education Fees
    if (['education', 'education_fees', 'school fees', 'college fees'].includes(type)) {
      return 'education_fees';
    }
    
    // Municipal Taxes
    if (['municipal', 'municipal_taxes', 'property tax'].includes(type)) {
      return 'municipal_taxes';
    }
    
    // Others
    if (['rental', 'rent', 'subscription', 'cable_tv', 'cable', 'donation',
         'ncmc', 'ncmc_recharge', 'metro', 'recurring_deposit', 'rd',
         'housing_society', 'society', 'hospitals', 'hospital', 'medical',
         'municipal_services', 'clubs_associations', 'club'].includes(type)) {
      return type;
    }
    
    return 'others';
  }

  // ─── PROCESS PAYMENT ──────────────────────────────────────────────────
  async processPayment(userId, paymentData, idempotencyKey = null) {
    const { serviceType, customerId, additionalData = {}, step } = paymentData;
    const client = await db.connect();
    const transactionRef = `PAY_${uuidv4().replace(/-/g, '').slice(0, 24)}`;

    try {
      await client.query('BEGIN');

      if (!serviceType || !customerId) {
        throw new Error('Missing required fields: serviceType, customerId');
      }

      // Normalize service type
      const normalizedServiceType = this._normalizeBillType(serviceType);
      logger.info(`Normalized bill type: ${serviceType} → ${normalizedServiceType}`);

      // Skip service validation for BBPS fetch/pay steps
      if (step !== 'fetch' && step !== 'pay') {
        const serviceCheck = await client.query(
          'SELECT id FROM services WHERE name = $1 AND is_active = true',
          [normalizedServiceType]
        );
        if (serviceCheck.rows.length === 0) {
          throw new Error(`Service ${normalizedServiceType} not found or inactive`);
        }
      }

      if (step === 'fetch') {
        return await this._fetchBill(
          client, userId, normalizedServiceType, customerId, additionalData, idempotencyKey, transactionRef
        );
      }

      if (step === 'pay') {
        return await this._payBill(
          client, userId, paymentData, idempotencyKey, transactionRef
        );
      }

      throw new Error('Invalid or missing "step". Use "fetch" or "pay".');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`PaymentService: Error processing payment`, {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  // ─── FETCH BILL ──────────────────────────────────────────────────────
  async _fetchBill(client, userId, serviceType, customerId, additionalData, idempotencyKey, transactionRef) {
    // Idempotency check
    if (idempotencyKey) {
      const existing = await client.query(
        `SELECT id, api_response FROM transactions 
         WHERE idempotency_key = $1 AND user_id = $2 AND type = $3`,
        [idempotencyKey, userId, serviceType]
      );
      if (existing.rows.length > 0) {
        const tx = existing.rows[0];
        await client.query('ROLLBACK');
        logger.info(`Duplicate fetch prevented for key ${idempotencyKey}`);
        const fetchData = tx.api_response?.fetchBillResult || {};
        return {
          success: true,
          message: 'Bill details already fetched',
          transactionId: tx.id,
          fetchBillResult: fetchData,
        };
      }
    }

    const fetchResult = await providerRouter.routeBillPayment({
      step: 'fetch',
      serviceType,
      customerId,
      additionalData,
    });

    if (fetchResult && fetchResult.error) {
      throw new Error(fetchResult.error);
    }

    const insertResult = await client.query(
      `INSERT INTO transactions 
       (user_id, type, consumer_number, plan_amount, status, idempotency_key, api_response) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id`,
      [
        userId,
        serviceType, // Already normalized
        customerId,
        0,
        'pending',
        idempotencyKey,
        JSON.stringify({ step: 'fetch', fetchBillResult: fetchResult }),
      ]
    );
    const transactionId = insertResult.rows[0].id;

    if (fetchResult.fetchRefId) {
      await client.query(
        `UPDATE transactions SET provider_txn_id = $1 WHERE id = $2`,
        [fetchResult.fetchRefId, transactionId]
      );
    }

    if (fetchResult.amount && !isNaN(fetchResult.amount)) {
      await client.query(
        'UPDATE transactions SET plan_amount = $1 WHERE id = $2',
        [parseFloat(fetchResult.amount), transactionId]
      );
    }

    // Also update operator field for easier identification
    await client.query(
      `UPDATE transactions SET operator = $1 WHERE id = $2`,
      [serviceType, transactionId]
    );

    await client.query('COMMIT');
    logger.info(`Fetch bill completed, transaction ${transactionId} created with type: ${serviceType}`);

    // Log fetch call
    const startTime = Date.now();
    try {
      await providerRouter.logProviderCall({
        transaction_id: transactionId,
        provider_id: null,
        request_payload: JSON.stringify({ step: 'fetch', serviceType, customerId, additionalData }),
        response_payload: JSON.stringify(fetchResult),
        status: fetchResult ? 'success' : 'failed',
        module: 'BBPS',
        transaction_type: 'fetch',
        merchant_ref_id: additionalData.merchantRefId || null,
        http_status: 200,
        response_time_ms: Date.now() - startTime,
        final_status: 'pending',
        error_message: null,
      });
    } catch (logError) {
      logger.error('Failed to log BBPS fetch call', { error: logError.message });
    }

    return {
      success: true,
      message: 'Bill details fetched successfully',
      transactionId,
      fetchBillResult: fetchResult,
    };
  }

  // ─── HELPER: GET BBPS MERCHANT CODE ──────────────────────────────────
  async _getMerchantCode(client, userId) {
    const result = await client.query(
      `SELECT bbps_merchant_code FROM merchant_onboarding WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    if (!result.rows[0]?.bbps_merchant_code) {
      throw new Error('Merchant is not onboarded with BBPS or missing bbps_merchant_code');
    }
    return result.rows[0].bbps_merchant_code;
  }

  // ─── PAY BILL ──────────────────────────────────────────────────────────
  async _payBill(client, userId, paymentData, idempotencyKey, transactionRef) {
    const { serviceType, customerId, additionalData = {}, transactionId } = paymentData;

    if (!transactionId) {
      throw new Error('transactionId is required for the pay step');
    }

    // Retrieve fetch transaction
    const fetchTx = await client.query(
      `SELECT id, plan_amount, provider_txn_id, status, type, operator
       FROM transactions 
       WHERE id = $1 AND user_id = $2`,
      [transactionId, userId]
    );
    if (fetchTx.rows.length === 0) {
      throw new Error('No fetch transaction found. Please complete the fetch step first.');
    }
    const tx = fetchTx.rows[0];
    if (tx.status !== 'pending') {
      throw new Error('This transaction is no longer pending.');
    }

    const serviceTypeFromDb = tx.type;
    const fetchRefId = tx.provider_txn_id;
    if (!fetchRefId) {
      throw new Error('Fetch Bill must be completed first. fetchRefId not found.');
    }

    const apiResult = await client.query(
      `SELECT api_response FROM transactions WHERE id = $1`,
      [transactionId]
    );
    const fetchBillResult = apiResult.rows[0]?.api_response?.fetchBillResult || {};

    const billerId = fetchBillResult.billerId || fetchBillResult.billerCode;
    if (!billerId) {
      throw new Error('Biller ID (or Biller Code) is missing from fetch result');
    }

    let amount = parseFloat(paymentData.amount);
    if (isNaN(amount) || amount <= 0) {
      amount = parseFloat(tx.plan_amount);
    }
    if (isNaN(amount) || amount <= 0) {
      throw new Error('Invalid bill amount');
    }

    const merchantCode = await this._getMerchantCode(client, userId);
    logger.info(`Using BBPS merchant code: ${merchantCode} for user ${userId}`);

    const enrichedAdditionalData = {
      ...additionalData,
      merchantCode,
      fetchRefId,
    };

    const balance = await walletService.getBalance(userId);
    if (balance < amount) {
      throw new Error(`Insufficient balance. Available: ₹${balance}, Required: ₹${amount}`);
    }

    const deductResult = await walletService.deductMoney(
      userId, amount, `${serviceType} payment for ${customerId}`, transactionId
    );
    logger.info(`Wallet deducted for pay step. New balance: ${deductResult.newBalance}`);

    if (tx.plan_amount === 0) {
      await client.query('UPDATE transactions SET plan_amount = $1 WHERE id = $2', [amount, transactionId]);
    }

    const payStartTime = Date.now();

    const providerResponse = await providerRouter.routeBillPayment(
      {
        step: 'pay',
        serviceType: serviceTypeFromDb,
        customerId,
        amount,
        transaction_id: transactionId,
        user_id: userId,
        additionalData: enrichedAdditionalData,
        testMode: paymentData.testMode,
      },
      fetchBillResult
    );

    const status = providerResponse.status === 'success' ? 'success' :
                   providerResponse.status === 'pending' ? 'pending' : 'failed';

    // Update transaction with final status and ensure operator is set
    await client.query(
      `UPDATE transactions 
       SET status = $1, 
           provider_txn_id = $2, 
           api_response = $3, 
           operator = $4,
           updated_at = NOW() 
       WHERE id = $5`,
      [
        status,
        providerResponse.provider_txn_id || null,
        JSON.stringify({ fetchStep: fetchBillResult, payStep: providerResponse.raw_response }),
        serviceTypeFromDb, // Ensure operator is set
        transactionId,
      ]
    );

    let refundProcessed = false;
    if (status === 'failed' || status === 'pending') {
      const reason = status === 'pending'
        ? `Refund for pending bill payment ${transactionId}`
        : `Refund for failed bill payment ${transactionId}`;

      const refundResult = await walletService.addMoney(
        userId, amount, reason, null
      );
      logger.info(`Refund processed (${status}). New balance: ${refundResult.newBalance}`);
      refundProcessed = true;

      await client.query(
        `UPDATE transactions SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [transactionId]
      );
    }

    await client.query('COMMIT');

    // ✅ Commission Credit (only on success)
    if (status === 'success') {
      await processCommission(
        'billpay',
        amount,
        userId,
        { serviceType: serviceTypeFromDb }
      ).catch(err => {
        logger.error(`Commission failed for payment tx ${transactionId}:`, err.message);
      });
    }

    // Log BBPS pay call
    try {
      await providerRouter.logProviderCall({
        transaction_id: transactionId,
        provider_id: null,
        request_payload: JSON.stringify({ step: 'pay', amount, additionalData: enrichedAdditionalData }),
        response_payload: JSON.stringify(providerResponse),
        status,
        module: 'BBPS',
        transaction_type: 'pay',
        merchant_ref_id: additionalData.merchantRefId || null,
        http_status: 200,
        response_time_ms: Date.now() - payStartTime,
        final_status: status,
        error_message: status === 'failed' ? (providerResponse.message || 'Payment failed') : null,
      });
    } catch (logError) {
      logger.error('Failed to log BBPS pay call', { error: logError.message });
    }

    const message =
      status === 'success' ? 'Payment successful' :
      status === 'pending' ? 'Payment is processing' :
      `Payment failed: ${providerResponse.message || 'Unknown error'}`;

    return {
      success: status === 'success',
      message,
      transactionId,
      provider: providerResponse.provider_txn_id,
      refunded: refundProcessed,
    };
  }

  // ─── USER HISTORY ──────────────────────────────────────────────────────
  async getUserHistory(userId, serviceType = null, startDate = null, endDate = null, limit = 50, offset = 0) {
    try {
      let query = `
        SELECT id, type as service_type, consumer_number, plan_amount as amount, 
               status, provider_txn_id, provider_name, created_at
        FROM transactions 
        WHERE user_id = $1 
        AND LOWER(type) != 'mobile_recharge'
      `;
      const params = [userId];
      let paramIndex = 2;

      if (serviceType) {
        query += ` AND LOWER(type) = $${paramIndex}`;
        params.push(serviceType.toLowerCase());
        paramIndex++;
      }
      if (startDate) {
        query += ` AND created_at >= $${paramIndex}::date`;
        params.push(startDate);
        paramIndex++;
      }
      if (endDate) {
        query += ` AND created_at <= ($${paramIndex}::date + interval '1 day' - interval '1 second')`;
        params.push(endDate);
        paramIndex++;
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error(`Error fetching user history`, { error: error.message });
      throw error;
    }
  }

  // ─── GET SINGLE TRANSACTION ──────────────────────────────────────────
  async getTransactionById(userId, transactionId) {
    try {
      const result = await db.query(
        `SELECT id, type as service_type, consumer_number, plan_amount as amount,
                status, provider_txn_id, provider_name, api_response, created_at, updated_at
         FROM transactions 
         WHERE id = $1 AND user_id = $2`,
        [transactionId, userId]
      );
      if (result.rows.length === 0) throw new Error('Transaction not found');
      return result.rows[0];
    } catch (error) {
      logger.error(`Error fetching transaction`, { error: error.message });
      throw error;
    }
  }

  // ─── GET ACTIVE SERVICES ─────────────────────────────────────────────
  async getActiveServices() {
    try {
      const result = await db.query(
        `SELECT id, name, display_name, category, icon 
         FROM services 
         WHERE is_active = true 
         ORDER BY category, display_name`
      );
      return result.rows;
    } catch (error) {
      logger.error(`Error fetching services`, { error: error.message });
      throw error;
    }
  }

  // ─── ADMIN: GET ALL PAYMENTS ─────────────────────────────────────────
  async getAllPayments(filters = {}, limit = 50, offset = 0) {
    try {
      let whereClause = "WHERE type != 'MOBILE_RECHARGE'";
      const params = [];
      let paramIndex = 1;
      if (filters.serviceType) {
        whereClause += ` AND type = $${paramIndex}`;
        params.push(filters.serviceType);
        paramIndex++;
      }
      if (filters.status) {
        whereClause += ` AND status = $${paramIndex}`;
        params.push(filters.status);
        paramIndex++;
      }
      if (filters.search) {
        whereClause += ` AND consumer_number ILIKE $${paramIndex}`;
        params.push(`%${filters.search}%`);
        paramIndex++;
      }
      const countQuery = await db.query(
        `SELECT COUNT(*) FROM transactions ${whereClause}`,
        params
      );
      const result = await db.query(
        `SELECT t.*, 
                CONCAT(u.first_name, ' ', u.last_name) as user_name, 
                u.email, 
                u.phone as user_mobile
         FROM transactions t
         JOIN users u ON u.id = t.user_id
         ${whereClause}
         ORDER BY t.created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset]
      );
      return {
        transactions: result.rows,
        total: parseInt(countQuery.rows[0].count),
        limit,
        offset,
      };
    } catch (error) {
      logger.error(`Error fetching all payments`, { error: error.message });
      throw error;
    }
  }
}

module.exports = new PaymentService();