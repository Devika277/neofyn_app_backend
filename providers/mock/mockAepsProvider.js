// backend/providers/mock/mockAepsProvider.js

// Simulate success/failure based on env var AEPS_MOCK_FAIL
const shouldFail = () => process.env.AEPS_MOCK_FAIL === 'true';

// Mock bank list
const bankList = [
  { code: 'SBIN', name: 'State Bank of India' },
  { code: 'PNB', name: 'Punjab National Bank' },
  { code: 'BOB', name: 'Bank of Baroda' },
  { code: 'HDFC', name: 'HDFC Bank' },
  { code: 'ICICI', name: 'ICICI Bank' },
];

// Mock state list
const stateList = [
  { code: 'UP', name: 'Uttar Pradesh' },
  { code: 'MH', name: 'Maharashtra' },
  { code: 'DL', name: 'Delhi' },
  { code: 'TN', name: 'Tamil Nadu' },
  { code: 'KA', name: 'Karnataka' },
];

// Mock district list per state (simplified)
const districts = {
  UP: [
    { code: 'LKO', name: 'Lucknow' },
    { code: 'GZB', name: 'Ghaziabad' },
  ],
  MH: [
    { code: 'MUM', name: 'Mumbai' },
    { code: 'PUN', name: 'Pune' },
  ],
  DL: [{ code: 'ND', name: 'New Delhi' }],
  TN: [{ code: 'CHN', name: 'Chennai' }],
  KA: [{ code: 'BLR', name: 'Bangalore' }],
};

module.exports = {
  // Register merchant mock
  registerMerchant: async ({ stateCode, districtCode }) => {
    if (shouldFail()) {
      return {
        status: '001',
        merchantStatus: 'Failed',
        statusDescription: 'Provider registration failed (mock fail)',
      };
    }
    return {
      status: '000',
      merchantStatus: 'Success',
      statusDescription: 'Registration Done, OTP verification pending!',
      merchantId: `MOCK-MER-${Date.now()}`,
      txnRefId: `MOCK-REG-${Date.now()}`,
      merchantRefId: `MOCK-REF-${Date.now()}`,
      pipe: '1',
    };
  },

  // Get bank list
  getBankList: async () => bankList,

  // Get state list
  getStateList: async () => stateList,

  // Get districts for a state
  getDistrictList: async (stateCode) => districts[stateCode] || [],

  // Cash withdrawal mock (updated signature with aadhaarNo, mobileNo)
  cashWithdrawal: async ({ amount, bankCode, device, aadhaarNo, mobileNo }) => {
    if (shouldFail()) {
      return {
        status: '001',
        merchantStatus: 'Failed',
        statusDescription: 'Biometric mismatch',
        npciCode: '99',
        npciMessage: 'Auth Failed',
      };
    }
    return {
      status: '000',
      merchantStatus: 'Success',
      statusDescription: 'Transaction Success',
      txnRefId: `MOCK-CW-${Date.now()}`,
      merchantRefId: `NEOFYN-MOCK-${Date.now()}`,
      transactionAmount: String(amount),
      aadhaarNo: aadhaarNo || 'XXXXXXXX1234',
      txnDateTime: new Date().toISOString(),
      bankIIN: '608117',
      rrn: `MOCK${Math.floor(Math.random() * 999999999999)}`,
      npciCode: '00',
      npciMessage: 'Successful',
      availableBalance: '12500.00',
      pipe: '1',
      device_used: device || 'mantra',
    };
  },

  // Balance enquiry mock (updated signature with aadhaarNo, mobileNo)
  balanceEnquiry: async ({ bankCode, aadhaarNo, mobileNo }) => {
    if (shouldFail()) {
      return {
        status: '001',
        merchantStatus: 'Failed',
        statusDescription: 'Biometric mismatch',
        npciCode: '99',
        npciMessage: 'Auth Failed',
      };
    }
    return {
      status: '000',
      merchantStatus: 'Success',
      statusDescription: 'Transaction Success',
      txnRefId: `MOCK-BE-${Date.now()}`,
      transactionAmount: '0',
      aadhaarNo: aadhaarNo || 'XXXXXXXX1234',
      txnDateTime: new Date().toISOString(),
      bankIIN: '608117',
      rrn: `MOCK${Math.floor(Math.random() * 999999999999)}`,
      npciCode: '00',
      npciMessage: 'Successful',
      availableBalance: '12500.00',
    };
  },

  // Mini statement mock
  miniStatement: async () => {
    if (shouldFail()) {
      return {
        status: '001',
        merchantStatus: 'Failed',
        statusDescription: 'Biometric mismatch',
        npciCode: '99',
        npciMessage: 'Auth Failed',
      };
    }
    return {
      status: '000',
      merchantStatus: 'Success',
      statusDescription: 'Transaction Success',
      txnRefId: `MOCK-MS-${Date.now()}`,
      transactionAmount: '0',
      aadhaarNo: 'XXXXXXXX1234',
      txnDateTime: new Date().toISOString(),
      rrn: `MOCK${Math.floor(Math.random() * 999999999999)}`,
      npciCode: '00',
      npciMessage: 'Successful',
      availableBalance: '12500.00',
      transactionList: [
        { txnType: 'CR', txnAmount: '1000.00', txnDate: '2026-03-20', narration: 'Cash Deposit' },
        { txnType: 'DR', txnAmount: '500.00', txnDate: '2026-03-21', narration: 'Cash Withdrawal' },
        { txnType: 'CR', txnAmount: '2000.00', txnDate: '2026-03-22', narration: 'NEFT Credit' },
      ],
    };
  },
};