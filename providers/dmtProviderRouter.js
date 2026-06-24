const provider = process.env.PAYOUT_PROVIDER === 'vimopay'
  ? require('./vimopayDmtProvider')
  : require('./mock/mockDmtProvider');

module.exports = provider;