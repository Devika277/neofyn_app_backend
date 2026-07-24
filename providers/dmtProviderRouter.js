// providers/dmtProviderRouter.js (in your app)
// const provider = process.env.PAYOUT_PROVIDER === 'vimopay'
//   ? require('./vimopay/vimopayDMT')  // ✅ Use the DMT API provider
//   : require('./mock/mockDmtProvider');

// module.exports = provider;
const provider = process.env.PAYOUT_PROVIDER === 'vimopay'
  ? require('./vimopayDmtProvider')
  : require('./mock/mockDmtProvider');

module.exports = provider;
