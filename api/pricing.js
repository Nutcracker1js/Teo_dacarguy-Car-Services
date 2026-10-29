const TINT_OPTIONS = require('../tint-options.json');

const LEGACY_TINT_PRICES = {
  'all-round': 300000,
  'windshield-front-doors': 200000,
  'windshield-only': 150000,
  'purple-chameleon': 200000,
  'rose-red': 220000,
  'green-chameleon': 200000,
  'blue-chameleon': 200000,
  'classic-smoke': 50,
  'blue-green': 65,
  'bronze-coloured': 80,
  ceramic: 100,
};

function getFixedServicePrice(service, serviceOption, location) {
  if (service === 'INSPECTION') {
    if (location === 'BENIN') return 100000;
    if (location === 'INTERSTATE') return 200000;
    return null;
  }
  if (service !== 'TINT' || typeof serviceOption !== 'string') return null;
  const option = TINT_OPTIONS[serviceOption];
  return option?.amountNgn ?? LEGACY_TINT_PRICES[serviceOption] ?? null;
}

module.exports = { getFixedServicePrice };
