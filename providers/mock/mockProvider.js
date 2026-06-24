const logger = require('../../utils/logger');

/**
 * Mock Provider - Simulates IYDA and BBPS responses
 * Used when PAYMENT_MODE=mock in .env
 * No real API calls are made
 * 
 * Supports advanced test modes via request.testMode:
 * - 'timeout': Simulates a very long delay to trigger axios timeout
 * - 'pending': Returns a pending response (status = 'pending')
 * - 'retry_fail_first': First call fails, subsequent calls succeed (simulates transient failure)
 * - 'fail_after_deduct': Throws an error after wallet deduction (for atomicity tests)
 */
class MockProvider {
    /**
     * Process a payment through mock provider
     * @param {Object} request - Standardized request object
     * @param {string} request.type - 'RECHARGE' or 'BILL'
     * @param {number} request.amount - Amount to process
     * @param {string} [request.testMode] - Special test mode (timeout, pending, retry_fail_first, fail_after_deduct)
     * @returns {Promise<Object>} Standardized response
     */
    async process(request) {
        const { type, amount, testMode } = request;
        const isRecharge = type === 'RECHARGE';

        // --- Special test mode handling ---
        if (testMode === 'timeout') {
            logger.info(`Mock provider: Simulating timeout (15s delay)`);
            // Simulate a very long delay (15 seconds) which should trigger axios timeout
            await new Promise(resolve => setTimeout(resolve, 15000));
            // After timeout, the service will abort – we won't reach this return
            return {
                status: 'failed',
                provider_txn_id: `TIMEOUT_${Date.now()}`,
                message: 'Mock provider simulated timeout',
                raw_response: { timeout: true }
            };
        }

        if (testMode === 'pending') {
            logger.info(`Mock provider: Returning pending response`);
            return {
                status: 'pending',
                provider_txn_id: `PENDING_${Date.now()}`,
                message: 'Processing, callback will follow',
                raw_response: { pending: true, request_type: type }
            };
        }

        if (testMode === 'retry_fail_first') {
            // Use a global counter to simulate first failure, second success
            if (typeof global.retryCounter === 'undefined') {
                global.retryCounter = 0;
            }
            global.retryCounter++;
            if (global.retryCounter === 1) {
                logger.info(`Mock provider: Returning failure for retry test (attempt 1)`);
                const prefix = isRecharge ? 'MOCK_FAIL_' : 'BBPS_FAIL_';
                return {
                    status: 'failed',
                    provider_txn_id: `${prefix}${Date.now()}`,
                    message: 'Simulated transient failure',
                    raw_response: { retry: true, attempt: 1 }
                };
            } else {
                logger.info(`Mock provider: Returning success for retry test (attempt ${global.retryCounter})`);
                const prefix = isRecharge ? 'MOCK_SUCCESS_' : 'BBPS_MOCK_';
                const txnId = isRecharge 
                    ? `${prefix}${Date.now()}_${Math.floor(Math.random() * 1000)}`
                    : `${prefix}${Date.now()}`;
                return {
                    status: 'success',
                    provider_txn_id: txnId,
                    message: 'Success after retry',
                    raw_response: { retry: true, attempt: global.retryCounter }
                };
            }
        }

        if (testMode === 'fail_after_deduct') {
            logger.info(`Mock provider: Throwing error after deduct simulation`);
            throw new Error('Simulated failure after wallet deduction');
        }

        // --- Normal mock behavior ---
        // Simulate network delay (300-800ms)
        await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));

        const successRate = isRecharge ? 90 : 80;  // 90% for recharge, 80% for bills
        const failureThreshold = parseInt(process.env.MOCK_FAILURE_THRESHOLD) || 10000;

        // Check if amount exceeds failure threshold (forces failure for testing refund)
        const amt = amount || 0;
        if (amt > failureThreshold) {
            logger.info(`Mock provider: Amount ${amt} exceeds threshold ${failureThreshold}, forcing failure`);
            const prefix = isRecharge ? 'MOCK_FAIL_' : 'BBPS_FAIL_';
            return {
                status: 'failed',
                provider_txn_id: `${prefix}${Date.now()}`,
                message: `Mock forced failure: amount exceeds threshold of ${failureThreshold}`,
                raw_response: {
                    mock_mode: true,
                    threshold_triggered: true,
                    amount: amt,
                    threshold: failureThreshold,
                    request_type: type
                }
            };
        }

        // Random success/failure based on success rate
        const random = Math.random() * 100;
        const isSuccess = random < successRate;

        if (isSuccess) {
            logger.info(`Mock provider: Success for request type ${type}`);
            const prefix = isRecharge ? 'MOCK_SUCCESS_' : 'BBPS_MOCK_';
            const txnId = isRecharge 
                ? `${prefix}${Date.now()}_${Math.floor(Math.random() * 1000)}`
                : `${prefix}${Date.now()}`;
            return {
                status: 'success',
                provider_txn_id: txnId,
                message: 'Mock provider processed successfully',
                raw_response: {
                    mock_mode: true,
                    success_rate_used: successRate,
                    request_type: type
                }
            };
        } else {
            logger.info(`Mock provider: Failed for request type ${type}`);
            const prefix = isRecharge ? 'MOCK_FAIL_' : 'BBPS_FAIL_';
            return {
                status: 'failed',
                provider_txn_id: `${prefix}${Date.now()}`,
                message: 'Mock provider simulated failure',
                raw_response: {
                    mock_mode: true,
                    success_rate_used: successRate,
                    request_type: type,
                    error: 'Simulated provider error'
                }
            };
        }
    }
}

module.exports = new MockProvider();