const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPaystackGateway, normalizeNigerianPhone, validEmail } = require('./payments');

test('Paystack initialization uses the server-confirmed amount and booking reference metadata', async () => {
  let request;
  const gateway = createPaystackGateway({
    PAYSTACK_SECRET_KEY: 'sk_test_private',
    PUBLIC_SITE_URL: 'https://teo.example.test',
  }, async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      async json() {
        return {
          status: true,
          data: {
            authorization_url: 'https://checkout.paystack.com/test',
            reference: 'paystack-ref-1',
          },
        };
      },
    };
  });

  const result = await gateway.initialize({
    booking: { reference: 'TD-1042', amount_expected: '80000.00' },
    email: 'customer@example.com',
  });
  assert.equal(request.url, 'https://api.paystack.co/transaction/initialize');
  assert.equal(request.options.headers.Authorization, 'Bearer sk_test_private');
  assert.deepEqual(request.body, {
    email: 'customer@example.com',
    amount: 8000000,
    currency: 'NGN',
    callback_url: 'https://teo.example.test/booking-status.html?bookingReference=TD-1042',
    metadata: { booking_reference: 'TD-1042' },
  });
  assert.deepEqual(result.data, {
    authorizationUrl: 'https://checkout.paystack.com/test',
    reference: 'paystack-ref-1',
  });
});

test('Paystack verification URL-encodes the transaction reference', async () => {
  let requestedUrl;
  const gateway = createPaystackGateway({
    PAYSTACK_SECRET_KEY: 'sk_test_private',
    PUBLIC_SITE_URL: 'https://teo.example.test',
  }, async (url) => {
    requestedUrl = url;
    return { ok: true, async json() { return { status: true, data: { status: 'success' } }; } };
  });
  await gateway.verify('transaction=ref');
  assert.equal(requestedUrl, 'https://api.paystack.co/transaction/verify/transaction%3Dref');
});

test('Render external URL supplies the Paystack callback when no public URL is configured', async () => {
  let requestBody;
  const gateway = createPaystackGateway({
    PAYSTACK_SECRET_KEY: 'sk_test_private',
    RENDER_EXTERNAL_URL: 'https://teo-dacarguy-car-services.onrender.com',
  }, async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          status: true,
          data: {
            authorization_url: 'https://checkout.paystack.com/test',
            reference: 'paystack-ref-1',
          },
        };
      },
    };
  });

  await gateway.initialize({
    booking: { reference: 'TD-1042', amount_expected: '80000.00' },
    email: 'customer@example.com',
  });

  assert.equal(
    requestBody.callback_url,
    'https://teo-dacarguy-car-services.onrender.com/booking-status.html?bookingReference=TD-1042',
  );
});

test('checkout refuses insecure public URLs and invalid amounts', async () => {
  const insecure = createPaystackGateway({
    PAYSTACK_SECRET_KEY: 'sk_test_private',
    PUBLIC_SITE_URL: 'http://example.test',
  }, async () => { throw new Error('Must not call Paystack.'); });
  await assert.rejects(
    insecure.initialize({ booking: { reference: 'TD-1042', amount_expected: '80000' }, email: 'customer@example.com' }),
    /must use HTTPS/i,
  );

  const noAmount = createPaystackGateway({
    PAYSTACK_SECRET_KEY: 'sk_test_private',
    PUBLIC_SITE_URL: 'https://teo.example.test',
  }, async () => { throw new Error('Must not call Paystack.'); });
  await assert.rejects(
    noAmount.initialize({ booking: { reference: 'TD-1042', amount_expected: null }, email: 'customer@example.com' }),
    /no valid payment amount/i,
  );
});

test('phone and email validators accept customer checkout details', () => {
  assert.equal(normalizeNigerianPhone('0801 234 5678'), '2348012345678');
  assert.equal(normalizeNigerianPhone('+234 801 234 5678'), '2348012345678');
  assert.equal(normalizeNigerianPhone('invalid'), null);
  assert.equal(validEmail('customer@example.com'), true);
  assert.equal(validEmail('not-an-email'), false);
});
