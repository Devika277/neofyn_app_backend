// backend/services/providerRouter.js
const db = require('../config/db');
const logger = require('../utils/logger');

const mockProvider = require('../providers/mock/mockProvider');
const vimopayRecharge = require('../providers/vimopay/vimopayRecharge');
const bbpsBillPay = require('../providers/bbps/bbpsBillPay');

class ProviderRouter {
  constructor() {
    this.providers = {
      MOCK: mockProvider,
      VIMOPAY_RECHARGE: vimopayRecharge,
      BBPS: bbpsBillPay,
    };
  }

  // ---------- RECHARGE ROUTING (updated per Vimopay doc v1.0.5) ----------
  async routeRecharge(request) {
    const mode = (process.env.PAYMENT_MODE || 'mock').toLowerCase();
    logger.info(`ProviderRouter: Routing recharge in ${mode} mode`, {
      mobile: request.mobile,
      amount: request.amount,
    });

    // Mock mode – unchanged, still uses mockProvider
    if (mode === 'mock') {
      return await this.providers.MOCK.process({ ...request, type: 'RECHARGE' });
    }

    // sandbox and live both use the new Vimopay recharge provider
    if (mode === 'sandbox' || mode === 'live') {
      return await this.providers.VIMOPAY_RECHARGE.process(request);
    }

    throw new Error(`Invalid PAYMENT_MODE: ${mode}. Use 'mock', 'sandbox', or 'live'`);
  }

  // ---------- BILL PAYMENT ROUTING (unchanged, two‑step flow) ----------
  async routeBillPayment(request, storedFetchResult = null) {
    const mode = (process.env.PAYMENT_MODE || 'mock').toLowerCase();
    logger.info(`ProviderRouter: Routing bill payment in ${mode} mode`, {
      step: request.step,
      serviceType: request.serviceType,
    });

    // Mock mode – uses mockProvider
    if (mode === 'mock') {
      return await this.providers.MOCK.process({ ...request, type: 'BILL' });
    }

    // Sandbox / live – two‑step bill payment
    if (mode === 'sandbox' || mode === 'live') {
      if (request.step === 'fetch') {
        return await this.providers.BBPS.fetchBill(request);
      }
      if (request.step === 'pay') {
        if (!storedFetchResult) {
          throw new Error(
            'Missing fetchBillResult for pay step – did you store the fetch response?'
          );
        }
        return await this.providers.BBPS.payNow(request, storedFetchResult);
      }
      throw new Error('Unknown bill payment step. Use "fetch" or "pay".');
    }

    throw new Error(`Invalid PAYMENT_MODE: ${mode}. Use 'mock', 'sandbox', or 'live'`);
  }

  // ---------- PROVIDER LOGGING (updated to support all fields) ----------
  async logProviderCall(logData, retries = 3) {
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await db.query(
          `INSERT INTO provider_logs
           (transaction_id, provider_id, request_payload, response_payload, status, error_message,
            module, transaction_type, merchant_ref_id, http_status, response_time_ms, final_status, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
          [
            logData.transaction_id || null,
            logData.provider_id || null,
            logData.request_payload || null,
            logData.response_payload || null,
            logData.status || null,
            logData.error_message || null,
            logData.module || null,
            logData.transaction_type || null,
            logData.merchant_ref_id || null,
            logData.http_status || null,
            logData.response_time_ms || null,
            logData.final_status || null,
          ]
        );
        return;
      } catch (error) {
        if (
          error.code === '23503' &&
          error.constraint === 'provider_logs_transaction_id_fkey' &&
          attempt < retries
        ) {
          logger.warn(
            `ProviderRouter: FK violation on transaction_id ${logData.transaction_id}, retrying in ${attempt * 100}ms...`
          );
          await delay(attempt * 100);
        } else {
          logger.error('ProviderRouter: Failed to log provider call after retries', {
            error: error.message,
            transaction_id: logData.transaction_id,
          });
          return;
        }
      }
    }
  }
}

module.exports = new ProviderRouter();