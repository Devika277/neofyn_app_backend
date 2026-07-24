const mockProvider = require('./mock/mockCardpayOutProvider');
let vimopayProvider = null;

function getCardpayOutProvider() {
  const providerName = (process.env.CARDPAY_OUT_PROVIDER || 'mock').toLowerCase();

  if (providerName === 'vimopay') {
    if (!vimopayProvider) {
      try {
        vimopayProvider = require('./vimopayProvider');
        console.log('[CardpayOutProviderRouter] Loaded VimoPay provider');
      } catch (err) {
        console.error('[CardpayOutProviderRouter] Failed to load vimopayProvider:', err.message);
        throw new Error('vimopay provider not available');
      }
    }
    return vimopayProvider;
  }

  console.log('[CardpayOutProviderRouter] Using Mock provider (fallback)');
  return mockProvider;
}

module.exports = { getCardpayOutProvider };
