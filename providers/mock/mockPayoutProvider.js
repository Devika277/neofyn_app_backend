/**
 * Mock Payout Provider
 * 
 * Simulates IYDA (or any real provider) responses for:
 * - transfer (initiate a payout)
 * - verifyAccount (penny drop for bank, VPA lookup for UPI)
 * - getTransactionStatus (polling for status)
 * 
 * Use environment variable PAYOUT_MOCK_FAIL=true to simulate failures.
 */

const MOCK_FAIL = process.env.PAYOUT_MOCK_FAIL === 'true';

const mockPayoutProvider = {
  /**
   * Initiate a transfer
   * @param {Object} params - { merchantRefId, amount, mode, accountDetails? }
   * @returns {Promise<Object>} Response with status, message, references
   */
  transfer: async ({ merchantRefId, amount, mode }) => {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    if (MOCK_FAIL) {
      return {
        status: '001',
        message: 'Account not found',
        merchantRefId,
        providerRefId: null,
        bankRefNo: null,
        transferMode: mode,
        amount: String(amount),
        timestamp: new Date().toISOString()
      };
    }

    return {
      status: '000',
      message: 'Transfer Successful',
      merchantRefId: merchantRefId,
      providerRefId: 'IYDA-' + Date.now(),
      bankRefNo: 'UTR' + Math.floor(Math.random() * 999999999999),
      transferMode: mode,
      amount: String(amount),
      timestamp: new Date().toISOString()
    };
  },

  /**
   * Verify bank account (penny drop) or UPI ID (VPA lookup)
   * @param {Object} params - { accountNo?, ifsc?, upiId?, mode }
   * @returns {Promise<Object>} Verification result with account name, etc.
   */
  verifyAccount: async ({ accountNo, ifsc, upiId, mode }) => {
    await new Promise(resolve => setTimeout(resolve, 800));

    if (MOCK_FAIL) {
      return {
        status: '001',
        message: 'Verification failed',
        isValid: false
      };
    }

    if (mode === 'upi') {
      return {
        status: '000',
        accountName: 'Mock UPI User',
        isValid: true
      };
    }

    return {
      status: '000',
      accountName: 'Mock Account Holder',
      bankName: 'State Bank of India',
      isValid: true
    };
  },

  /**
   * Fetch status of a previously initiated transfer
   * @param {Object} params - { merchantRefId }
   * @returns {Promise<Object>} Current status
   */
  getTransactionStatus: async ({ merchantRefId }) => {
    await new Promise(resolve => setTimeout(resolve, 500));

    if (MOCK_FAIL) {
      return {
        status: '001',
        txnStatus: 'failed',
        providerRefId: null,
        bankRefNo: null
      };
    }

    return {
      status: '000',
      txnStatus: 'success',
      providerRefId: 'IYDA-' + Date.now(),
      bankRefNo: 'UTR' + Math.floor(Math.random() * 999999999999)
    };
  }
};

module.exports = mockPayoutProvider;