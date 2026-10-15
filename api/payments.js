const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const crypto = require('node:crypto');

function verifyPaystackSignature(rawBody, signature, secretKey) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string'
    || !/^[a-f0-9]{128}$/i.test(signature) || typeof secretKey !== 'string' || !secretKey) {
    return false;
  }
  const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
  const suppliedBytes = Buffer.from(signature.toLowerCase(), 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return suppliedBytes.length === expectedBytes.length
    && crypto.timingSafeEqual(suppliedBytes, expectedBytes);
}

function createPaystackGateway(environment = process.env, fetchImplementation = fetch) {
  const secretKey = environment.PAYSTACK_SECRET_KEY || '';
  const publicSiteUrl = environment.PUBLIC_SITE_URL || environment.RENDER_EXTERNAL_URL || '';

  async function requestPaystack(path, options = {}) {
    if (!secretKey) {
      return { error: { status: 'not_configured', message: 'Paystack is not configured on the server.' } };
    }
    const response = await fetchImplementation(`https://api.paystack.co${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(15000),
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('Paystack returned an unreadable response.');
    }
    if (!response.ok || result.status !== true) {
      throw new Error(typeof result.message === 'string' ? result.message : `Paystack returned HTTP ${response.status}.`);
    }
    return { data: result.data };
  }

  return {
    configured: Boolean(secretKey),
    async initialize({ booking, email }) {
      let callbackUrl;
      try {
        callbackUrl = new URL('/booking-status.html', publicSiteUrl);
      } catch {
        throw new Error('Set PUBLIC_SITE_URL before enabling Paystack checkout.');
      }
      if (callbackUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(callbackUrl.hostname)) {
        throw new Error('PUBLIC_SITE_URL must use HTTPS for Paystack checkout.');
      }
      callbackUrl.searchParams.set('bookingReference', booking.reference);
      const amountNgn = Number(booking.amount_expected);
      const amountKobo = Math.round(amountNgn * 100);
      if (!Number.isSafeInteger(amountKobo) || amountKobo < 100) {
        throw new Error('The booking has no valid payment amount. Contact Teo to confirm the price.');
      }
      const result = await requestPaystack('/transaction/initialize', {
        method: 'POST',
        body: JSON.stringify({
          email,
          amount: amountKobo,
          currency: 'NGN',
          callback_url: callbackUrl.toString(),
          metadata: {
            booking_reference: booking.reference,
          },
        }),
      });
      if (result.error) return result;
      const authorizationUrl = result.data.authorization_url;
      const reference = result.data.reference;
      if (typeof authorizationUrl !== 'string' || typeof reference !== 'string') {
        throw new Error('Paystack returned an incomplete checkout session.');
      }
      return { data: { authorizationUrl, reference } };
    },
    async verify(reference) {
      if (!/^[A-Za-z0-9._=-]{1,100}$/.test(reference)) {
        throw new Error('Paystack transaction reference is invalid.');
      }
      return requestPaystack(`/transaction/verify/${encodeURIComponent(reference)}`);
    },
  };
}

function normalizeNigerianPhone(value) {
  let phone = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  if (/^0\d{10}$/.test(phone)) phone = `234${phone.slice(1)}`;
  return /^[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value.trim());
}

module.exports = {
  createPaystackGateway,
  normalizeNigerianPhone,
  validEmail,
  verifyPaystackSignature,
};