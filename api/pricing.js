const TINT_OPTIONS = require('../tint-options.json');

function getFixedServicePrice(service, serviceOption) {
  if (service !== 'TINT' || typeof serviceOption !== 'string') return null;
  const option = TINT_OPTIONS[serviceOption];
  return option ? option.amountNgn : null;
}

module.exports = { getFixedServicePrice };
