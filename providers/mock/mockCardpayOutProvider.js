const MOCK_FAIL = process.env.CARDPAY_OUT_MOCK_FAIL === 'true';
const MOCK_STATUS = process.env.CARDPAY_OUT_MOCK_STATUS || 'SUCCESS';

const mockCardpayOutProvider = {
  transfer: async ({ merchantRefId, amount, mode }) => {
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

    if (MOCK_STATUS === 'PENDING') {
      return {
        status: '002',
        message: 'Transaction pending',
        merchantRefId,
        providerRefId: 'CPO-' + Date.now(),
        bankRefNo: null,
        transferMode: mode,
        amount: String(amount),
        timestamp: new Date().toISOString()
      };
    }

    if (MOCK_STATUS === 'VALIDATION_FAILED') {
      return {
        status: '003',
        message: 'Validation Failed',
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
      merchantRefId,
      providerRefId: 'CPO-' + Date.now(),
      bankRefNo: 'UTR' + Math.floor(Math.random() * 999999999999),
      transferMode: mode,
      amount: String(amount),
      timestamp: new Date().toISOString()
    };
  },

  verifyAccount: async ({ accountNo, ifsc }) => {
    await new Promise(resolve => setTimeout(resolve, 800));

    if (MOCK_FAIL) {
      return { status: '001', message: 'Verification failed', isValid: false };
    }

    return {
      status: '000',
      accountName: 'Mock Account Holder',
      bankName: 'State Bank of India',
      isValid: true
    };
  },

  getTransactionStatus: async ({ merchantRefId }) => {
    await new Promise(resolve => setTimeout(resolve, 500));

    if (MOCK_FAIL) {
      return { status: '001', txnStatus: 'failed', providerRefId: null, bankRefNo: null };
    }

    return {
      status: '000',
      txnStatus: 'success',
      providerRefId: 'CPO-' + Date.now(),
      bankRefNo: 'UTR' + Math.floor(Math.random() * 999999999999)
    };
  }
};

module.exports = mockCardpayOutProvider;
