// backend/services/aepsProviderRouter.js

const PROVIDER = process.env.AEPS_PROVIDER || 'mock';

let provider;
switch (PROVIDER) {
  case 'vimopay':
    provider = require('../providers/vimopay/vimopayAepsProvider');
    break;
  case 'mock':
  default:
    provider = require('../providers/mock/mockAepsProvider');
    break;
}

if (provider.init) {
  provider.init(process.env);
}

module.exports = {
  registerMerchant: (params) => provider.registerMerchant(params),
  getBankList: () => provider.getBankList(),
  getStateList: () => provider.getStateList(),
  getDistrictList: (stateCode) => provider.getDistrictList(stateCode),
  getBankIINs: () => provider.getBankIINs(),
  sendOTP: (params) => provider.sendOTP(params),
  resendOTP: (params) => provider.resendOTP(params),
  verifyOTP: (params) => provider.verifyOTP(params),
  merchantEkyc: (params) => provider.merchantEkyc(params),   // Task 3: E-KYC
  perform2FA: (params) => provider.perform2FA(params),       // 🆕 Task 4: Daily 2FA
  cashWithdrawal: (params) => provider.cashWithdrawal(params),
  balanceEnquiry: (params) => provider.balanceEnquiry(params),
  miniStatement: (params) => provider.miniStatement(params),
};