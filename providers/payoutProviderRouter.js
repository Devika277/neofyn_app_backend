/**
 * Payout Provider Router
 * 
 * Returns the appropriate payout provider instance based on PAYOUT_PROVIDER env variable.
 * 
 * Environment:
 * - PAYOUT_PROVIDER=mock    → uses mockPayoutProvider (default)
 * - PAYOUT_PROVIDER=vimopay → uses vimopayProvider (real VimoPay)
 * 
 * Usage:
 *   const { getPayoutProvider } = require('./payoutProviderRouter');
 *   const provider = getPayoutProvider();
 *   const result = await provider.transfer({ ... });
 */

const mockProvider = require('./mock/mockPayoutProvider');
let vimopayProvider = null;

function getPayoutProvider() {
  const providerName = (process.env.PAYOUT_PROVIDER || 'mock').toLowerCase();

  if (providerName === 'vimopay') {
    if (!vimopayProvider) {
      try {
        // ✅ Path to your VimoPay provider (adjust if different)
vimopayProvider = require('./vimopayProvider');        console.log('[PayoutProviderRouter] Loaded VimoPay provider');
      } catch (err) {
        console.error('[PayoutProviderRouter] Failed to load vimopayProvider:', err.message);
        throw new Error('vimopay provider not available');
      }
    }
    return vimopayProvider;
  }

  // Default to mock provider
  console.log('[PayoutProviderRouter] Using Mock provider (fallback)');
  return mockProvider;
}

module.exports = { getPayoutProvider };