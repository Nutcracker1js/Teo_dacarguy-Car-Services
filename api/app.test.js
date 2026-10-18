const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { after, before, test } = require('node:test');
const { createApp } = require('./app');
const { buildSite } = require('./build-site');

const saved = [];
const savedReviews = [];
const notificationCalls = [];
let publicBookingStatus = 'APPROVED';
let existingCheckoutReady = false;
let checkoutPaymentStatus = 'UNPAID';
let paymentVerification = {
  status: 'success',
  reference: 'paystack-test-01',
  currency: 'NGN',
  amount: 8000000,
  metadata: { booking_reference: 'TD-TEST1001' },
};
const paymentInitializations = [];
const paymentVerifications = [];
const paymentIntentUpdates = [];
const uploadRootPromise = fs.mkdtemp(path.join(os.tmpdir(), 'teo-api-test-'));
const publicSiteRootPromise = fs.mkdtemp(path.join(os.tmpdir(), 'teo-public-site-test-'));
let failAttachmentInsert = false;
const pool = {
  async query(sql, values = []) {
    if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
    if (sql.includes('DELETE FROM reviews')) {
      const index = savedReviews.findIndex((review) => review.id === values[0]);
      const [review] = index === -1 ? [] : savedReviews.splice(index, 1);
      return { rows: review ? [{ id: review.id }] : [], rowCount: review ? 1 : 0 };
    }
    if (sql.includes('FROM reviews')) return { rows: [...savedReviews].slice(0, 100) };
    if (sql.includes('FROM bookings WHERE reference = $1')) {
      if (values[0] !== 'TD-TEST1001'
        || !['2348012345678', '08012345678'].includes(values[1])) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('payment_checkout_url')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'booking-test-id',
            reference: 'TD-TEST1001',
            status: publicBookingStatus,
            payment_status: existingCheckoutReady ? 'AWAITING_PAYMENT' : checkoutPaymentStatus,
            payment_reference: existingCheckoutReady ? 'paystack-test-01' : null,
            payment_checkout_url: existingCheckoutReady ? 'https://checkout.paystack.com/test' : null,
            amount_expected: '80000',
            email: 'customer@example.com',
          }],
        };
      }
      if (sql.includes('payment_reference')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'booking-test-id',
            reference: 'TD-TEST1001',
            status: publicBookingStatus,
            payment_status: 'AWAITING_PAYMENT',
            payment_reference: 'paystack-test-01',
            amount_expected: '80000',
          }],
        };
      }
      if (sql.includes('to_char(preferred_time')) {
        return {
          rowCount: 1,
          rows: [{
            reference: 'TD-TEST1001',
            status: publicBookingStatus,
            service: 'TINT',
            service_other: null,
            preferred_date: '2027-01-20',
            preferred_time: '10:30',
            amount_expected: '80000',
            amount_received: '0',
            payment_status: 'AWAITING_PAYMENT',
          }],
        };
      }
      if (sql.includes('amount_expected')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'booking-test-id',
            reference: 'TD-TEST1001',
            status: publicBookingStatus,
            payment_status: 'UNPAID',
            amount_expected: '80000',
          }],
        };
      }
      return {
        rowCount: 1,
        rows: [{
          reference: 'TD-TEST1001',
          status: publicBookingStatus,
          service: 'TINT',
          service_other: null,
          preferred_date: '2027-01-20',
          preferred_time: '10:30',
          amount_expected: '80000',
          amount_received: '0',
          payment_status: 'AWAITING_PAYMENT',
        }],
      };
    }
    if (sql.includes("regexp_replace(phone, '[^0-9]'")) {
      const matches = values[0] === 'TD-TEST1001' && values[1] === '2348012345678';
      return {
        rowCount: matches ? 1 : 0,
        rows: matches ? [{
          reference: 'TD-TEST1001',
          status: publicBookingStatus,
          service: 'TINT',
          service_other: null,
          preferred_date: '2027-01-20',
          preferred_time: '10:30',
          amount_expected: null,
        }] : [],
      };
    }
    if (sql.includes("SET payment_status = 'PAID'")) {
      return { rowCount: 1, rows: [{ payment_status: 'PAID' }] };
    }
    if (sql.includes("SET payment_status = 'AWAITING_PAYMENT'")) {
      paymentIntentUpdates.push({ sql, values });
      return { rowCount: 1, rows: [{ id: values[2] }] };
    }
    if (sql.includes('INSERT INTO reviews')) {
      const review = {
        id: values[0],
        name: values[1],
        vehicle: values[2],
        rating: values[3],
        review: values[4],
        created_at: '2026-10-07T14:00:00.000Z',
      };
      savedReviews.unshift(review);
      return { rows: [review] };
    }
    saved.push({ sql, values });
    return { rows: [] };
  },
  async connect() {
    return {
      async query(sql, values = []) {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('SELECT id, reference, status, payment_status, payment_reference')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'booking-test-id',
              reference: 'TD-TEST1001',
              status: 'APPROVED',
              payment_status: 'AWAITING_PAYMENT',
              payment_reference: 'paystack-test-01',
              payment_verification: 'UNVERIFIED',
              amount_expected: '80000',
              email: 'customer@example.com',
              full_name: 'Ada Customer',
              service: 'TINT',
              service_other: null,
              preferred_date: '2027-01-20',
              preferred_time: '10:30',
            }],
          };
        }
        if (sql.includes('INSERT INTO paystack_webhook_receipts')) {
          return { rowCount: 1, rows: [{ event_key: values[0] }] };
        }
        if (sql.includes("SET status = 'AWAITING_APPROVAL'")) {
          return {
            rowCount: 1,
            rows: [{ status: 'AWAITING_APPROVAL', payment_status: 'PAID', amount_received: 80000 }],
          };
        }
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (sql.includes('COUNT(*)::int AS total FROM booking_working_hours')) {
          return { rows: [{ total: 7 }] };
        }
        if (sql.includes('SELECT is_open, opens_at::text, closes_at::text FROM booking_working_hours')) {
          return { rows: [{ is_open: true, opens_at: '08:00:00', closes_at: '19:00:00' }] };
        }
        if (sql.includes('SELECT duration_minutes FROM booking_service_durations')) {
          return { rows: [{ duration_minutes: 60 }] };
        }
        if (sql.includes('FROM booking_availability_blocks')) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM bookings b LEFT JOIN booking_service_durations')) return { rows: [], rowCount: 0 };
        if (failAttachmentInsert && sql.includes('submission_attachments')) {
          throw new Error('Simulated attachment database failure.');
        }
        saved.push({ sql, values });
        return {
          rows: [{
            id: values[0],
            ...(sql.includes('INSERT INTO bookings') ? { reference: 'TEO-1000' } : {}),
            status: 'NEW',
            created_at: '2026-10-07T14:00:00.000Z',
          }],
        };
      },
      release() {},
    };
  },
};

function createPng() {
  function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, content) {
    const typeBuffer = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(content.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, content])));
    return Buffer.concat([length, typeBuffer, content, checksum]);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let server;
let baseUrl;
before(async () => {
  server = createApp({
    pool,
    trustProxy: 1,
    corsOrigins: [
      'http://localhost:8080',
      'http://127.0.0.1:8080',
      'http://localhost:8088',
      'http://127.0.0.1:8088',
      'https://nutcracker1js.github.io',
    ],
    uploadDirectory: await uploadRootPromise,
    adminUsername: 'test-admin',
    adminPassword: 'test-password-at-least-16',
    sendNotifications: async (submission) => {
      notificationCalls.push(submission);
      return { email: 'sent', whatsapp: 'not_configured' };
    },
    sendBookingApprovalNotification: async (booking) => {
      notificationCalls.push({ type: 'approval', booking });
      return { status: 'sent' };
    },
    paymentGateway: {
      configured: true,
      publicKey: 'pk_test_publickey123',
      publicKeyMatchesSecret: true,
      async initialize({ booking, email }) {
        paymentInitializations.push({ booking, email });
        return { data: { authorizationUrl: 'https://checkout.paystack.com/test', reference: 'paystack-test-01' } };
      },
      async verify(reference) {
        paymentVerifications.push(reference);
        return { data: paymentVerification };
      },
    },
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(await uploadRootPromise, { recursive: true, force: true });
  await fs.rm(await publicSiteRootPromise, { recursive: true, force: true });
});

test('health endpoint confirms database availability', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  const policy = response.headers.get('content-security-policy');
  assert.match(policy, /frame-src[^;]*https:\/\/checkout\.paystack\.com/);
  assert.match(policy, /script-src[^;]*https:\/\/js\.paystack\.co/);
  assert.match(policy, /connect-src[^;]*https:\/\/api\.paystack\.co/);
  assert.doesNotMatch(policy, /frame-src[^;]*\s\*(?:\s|;)/);
  assert.match(policy, /script-src[^;]*https:\/\/www\.smartsuppchat\.com/);
  assert.match(policy, /script-src[^;]*https:\/\/\*\.smartsuppcdn\.com/);
  assert.match(policy, /connect-src[^;]*wss:\/\/\*\.smartsupp\.com/);
  assert.match(policy, /connect-src[^;]*https:\/\/\*\.smartsuppcdn\.com/);
  assert.match(policy, /frame-src[^;]*https:\/\/\*\.smartsuppchat\.com/);
  assert.match(policy, /img-src[^;]*https:\/\/\*\.smartsuppcdn\.com/);
});

test('customer can check an approved booking using reference and matching phone', async () => {
  const response = await fetch(`${baseUrl}/api/v1/booking-status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reference: 'td-test1001', phone: '+234 801 234 5678' }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.equal(result.booking.status, 'APPROVED');
  assert.equal(result.booking.reference, 'TD-TEST1001');
  assert.equal(result.booking.service, 'TINT');

  const wrongPhone = await fetch(`${baseUrl}/api/v1/booking-status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reference: 'TD-TEST1001', phone: '+234 802 000 0000' }),
  });
  assert.equal(wrongPhone.status, 404);

  const localPhone = await fetch(`${baseUrl}/api/v1/booking-status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reference: 'TD-TEST1001', phone: '08012345678' }),
  });
  assert.equal(localPhone.status, 200);
});

test('Paystack initialization requires an approved booking and uses the confirmed server amount', async () => {
  const response = await fetch(`${baseUrl}/api/v1/payments/initialize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      reference: 'TD-TEST1001',
      phone: '08012345678',
      amount: 1,
      email: 'attacker@example.com',
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.equal(result.publicKey, 'pk_test_publickey123');
  assert.match(result.reference, /^TDPI-[A-F0-9-]{36}$/);
  assert.equal(result.amount, 8000000);
  assert.equal(result.currency, 'NGN');
  assert.equal(result.email, 'customer@example.com');
  assert.deepEqual(result.metadata, { booking_reference: 'TD-TEST1001' });
  assert.equal(paymentInitializations.length, 0);
  assert.equal(paymentIntentUpdates.at(-1).values[0], result.reference);
  assert.equal(paymentIntentUpdates.at(-1).values[2], 'booking-test-id');
  assert.match(paymentIntentUpdates.at(-1).sql, /payment_checkout_url = NULL/);
});

test('Paystack initialization reuses the approved booking checkout link', async () => {
  existingCheckoutReady = true;
  const initializationsBefore = paymentInitializations.length;
  try {
    const response = await fetch(`${baseUrl}/api/v1/payments/initialize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference: 'TD-TEST1001', phone: '08012345678' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authorizationUrl: 'https://checkout.paystack.com/test' });
    assert.equal(paymentInitializations.length, initializationsBefore);
  } finally {
    existingCheckoutReady = false;
  }
});

test('Paystack initialization rejects partial and refunded booking payments', async () => {
  checkoutPaymentStatus = 'PARTIAL';
  try {
    const response = await fetch(`${baseUrl}/api/v1/payments/initialize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference: 'TD-TEST1001', phone: '08012345678' }),
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /contact teo/i);
  } finally {
    checkoutPaymentStatus = 'UNPAID';
  }
});

test('Paystack verification marks only a successful exact payment as paid', async () => {
  const response = await fetch(`${baseUrl}/api/v1/payments/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      reference: 'TD-TEST1001',
      phone: '+234 801 234 5678',
      transactionReference: 'paystack-test-01',
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { paymentStatus: 'PAID', bookingStatus: 'AWAITING_APPROVAL' });
  assert.equal(paymentVerifications.at(-1), 'paystack-test-01');

  paymentVerification = {
    status: 'success',
    reference: 'paystack-test-01',
    currency: 'NGN',
    amount: 100,
    metadata: { booking_reference: 'TD-TEST1001' },
  };
  const mismatched = await fetch(`${baseUrl}/api/v1/payments/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      reference: 'TD-TEST1001',
      phone: '+234 801 234 5678',
      transactionReference: 'paystack-test-01',
    }),
  });
  assert.equal(mismatched.status, 409);
  paymentVerification = {
    status: 'success',
    reference: 'paystack-test-01',
    currency: 'NGN',
    amount: 8000000,
    metadata: { booking_reference: 'TD-TEST1001' },
  };
});

test('public availability endpoint offers standard times before custom hours are configured', async () => {
  const unavailable = await fetch(`${baseUrl}/api/v1/availability?date=2099-06-15&service=MAINTENANCE`);
  assert.equal(unavailable.status, 200);
  const availability = await unavailable.json();
  assert.equal(availability.configured, false);
  assert.ok(availability.slots.includes('08:00'));
  assert.ok(availability.slots.includes('18:00'));
  assert.ok(!availability.slots.includes('18:30'));

  const sunday = await fetch(`${baseUrl}/api/v1/availability?date=2099-06-14&service=MAINTENANCE`);
  assert.deepEqual(await sunday.json(), { configured: false, slots: [] });

  const invalid = await fetch(`${baseUrl}/api/v1/availability?date=2099-02-31&service=MAINTENANCE`);
  assert.equal(invalid.status, 400);
});

test('configured local preview origins can access the public review API', async () => {
  const allowed = await fetch(`${baseUrl}/api/v1/reviews`, {
    headers: { Origin: 'http://localhost:8088' },
  });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:8088');

  const blocked = await fetch(`${baseUrl}/api/v1/reviews`, {
    headers: { Origin: 'http://untrusted.example' },
  });
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
});

test('GitHub Pages can access the public API when its origin is allowed', async () => {
  const allowed = await fetch(`${baseUrl}/api/v1/reviews`, {
    headers: { Origin: 'https://nutcracker1js.github.io' },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://nutcracker1js.github.io');

  const preflight = await fetch(`${baseUrl}/api/v1/bookings`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://nutcracker1js.github.io',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://nutcracker1js.github.io');
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
});

test('API rate limits are counted per forwarded client IP and expose standard headers', async () => {
  const first = await fetch(`${baseUrl}/api/v1/reviews`, {
    headers: { 'X-Forwarded-For': '198.51.100.24' },
  });
  const second = await fetch(`${baseUrl}/api/v1/reviews`, {
    headers: { 'X-Forwarded-For': '198.51.100.24' },
  });
  const otherClient = await fetch(`${baseUrl}/api/v1/reviews`, {
    headers: { 'X-Forwarded-For': '198.51.100.25' },
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(otherClient.status, 200);
  assert.match(first.headers.get('ratelimit'), /limit=300/);
  assert.match(second.headers.get('ratelimit'), /remaining=298/);
  assert.match(otherClient.headers.get('ratelimit'), /remaining=299/);
});

test('API-wide rate limit rejects requests over its window allowance', async () => {
  let lastResponse;
  for (let requestCount = 0; requestCount < 301; requestCount += 1) {
    lastResponse = await fetch(`${baseUrl}/api/health`, {
      headers: { 'X-Forwarded-For': '198.51.100.26' },
    });
  }
  assert.equal(lastResponse.status, 429);
  assert.deepEqual(await lastResponse.json(), { error: 'Too many API requests. Please try again later.' });
});

test('review API publishes valid reviews and lists persisted reviews', async () => {
  const payload = {
    name: 'Ada Customer',
    vehicle: 'Toyota Camry',
    rating: '5',
    review: 'Great service and friendly staff.',
  };
  const response = await fetch(`${baseUrl}/api/v1/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const created = await response.json();

  assert.equal(response.status, 201);
  assert.equal(created.review.name, payload.name);
  assert.equal(created.review.rating, 5);
  assert.equal(created.review.review, payload.review);

  const listResponse = await fetch(`${baseUrl}/api/v1/reviews`);
  const list = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.headers.get('cache-control'), 'no-store');
  assert.equal(list.reviews[0].id, created.review.id);
});

test('review API validates content and stores customer text without interpreting markup', async () => {
  const invalidResponse = await fetch(`${baseUrl}/api/v1/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'A', rating: '6', review: 'Short' }),
  });
  assert.equal(invalidResponse.status, 400);
  assert.ok((await invalidResponse.json()).fields.rating);

  const markup = '<script>alert("review")</script> A helpful experience.';
  const safeResponse = await fetch(`${baseUrl}/api/v1/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '<b>Ada</b>', rating: '4', review: markup }),
  });
  const result = await safeResponse.json();
  assert.equal(safeResponse.status, 201);
  assert.equal(result.review.name, '<b>Ada</b>');
  assert.equal(result.review.review, markup);
});

test('admin can list and delete reviews only when authenticated', async () => {
  const review = savedReviews[0];
  const unauthorized = await fetch(`${baseUrl}/api/v1/admin/reviews`);
  assert.equal(unauthorized.status, 401);

  const authorization = `Basic ${Buffer.from('test-admin:test-password-at-least-16').toString('base64')}`;
  const listed = await fetch(`${baseUrl}/api/v1/admin/reviews`, {
    headers: { Authorization: authorization },
  });
  assert.equal(listed.status, 200);
  assert.ok((await listed.json()).reviews.some((item) => item.id === review.id));

  const invalidId = await fetch(`${baseUrl}/api/v1/admin/reviews/not-a-uuid`, {
    method: 'DELETE',
    headers: { Authorization: authorization },
  });
  assert.equal(invalidId.status, 404);

  const deleted = await fetch(`${baseUrl}/api/v1/admin/reviews/${review.id}`, {
    method: 'DELETE',
    headers: { Authorization: authorization },
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { id: review.id });
  assert.equal(savedReviews.some((item) => item.id === review.id), false);

  const missing = await fetch(`${baseUrl}/api/v1/admin/reviews/${review.id}`, {
    method: 'DELETE',
    headers: { Authorization: authorization },
  });
  assert.equal(missing.status, 404);
});

test('optional website hosting serves only built public files beside the API', async () => {
  const publicSiteRoot = await publicSiteRootPromise;
  const sourceDirectory = path.join(publicSiteRoot, 'source');
  const publicDirectory = path.join(publicSiteRoot, 'dist');
  await fs.mkdir(sourceDirectory);
  await fs.mkdir(path.join(sourceDirectory, 'assets', 'css'), { recursive: true });
  await fs.mkdir(path.join(sourceDirectory, 'assets', 'js'), { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, 'index.html'), '<!doctype html><title>Public site</title>');
  await fs.writeFile(path.join(sourceDirectory, 'admin.html'), '<!doctype html><title>Admin page</title>');
  await fs.writeFile(path.join(sourceDirectory, 'package.json'), '{"private":true}');
  await fs.writeFile(path.join(sourceDirectory, 'tint-options.json'), '{"sample":{"label":"Sample tint","amountNgn":1}}');
  await fs.writeFile(path.join(sourceDirectory, 'assets', 'css', 'styles.css'), 'body { color: black; }');
  await fs.writeFile(path.join(sourceDirectory, 'assets', 'js', 'script.js'), 'window.siteReady = true;');
  await buildSite(sourceDirectory, publicDirectory);
  const app = createApp({
    pool,
    serveWebsite: true,
    publicDirectory,
    uploadDirectory: await uploadRootPromise,
  });
  const hostedServer = app.listen(0);
  await new Promise((resolve) => hostedServer.once('listening', resolve));
  const origin = `http://127.0.0.1:${hostedServer.address().port}`;
  try {
    const website = await fetch(`${origin}/`);
    assert.equal(website.status, 200);
    assert.match(await website.text(), /Public site/);
    const admin = await fetch(`${origin}/admin?dashboard=final`);
    assert.equal(admin.status, 200);
    assert.equal(admin.url, `${origin}/admin.html?dashboard=final`);
    assert.match(await admin.text(), /Admin page/);
    const tintOptions = await fetch(`${origin}/tint-options.json`);
    assert.equal(tintOptions.status, 200);
    assert.deepEqual(await tintOptions.json(), { sample: { label: 'Sample tint', amountNgn: 1 } });
    const stylesheet = await fetch(`${origin}/assets/css/styles.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(await stylesheet.text(), /color: black/);
    const browserScript = await fetch(`${origin}/assets/js/script.js`);
    assert.equal(browserScript.status, 200);
    assert.match(await browserScript.text(), /siteReady/);
    assert.equal((await fetch(`${origin}/package.json`)).status, 404);
  } finally {
    await new Promise((resolve, reject) => hostedServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('production serves the website by default when SERVE_WEBSITE is unset', async () => {
  const publicSiteRoot = await publicSiteRootPromise;
  const publicDirectory = path.join(publicSiteRoot, 'production-dist');
  await fs.mkdir(publicDirectory);
  await fs.writeFile(path.join(publicDirectory, 'index.html'), '<!doctype html><title>Production site</title>');
  const originalNodeEnv = process.env.NODE_ENV;
  const originalServeWebsite = process.env.SERVE_WEBSITE;
  process.env.NODE_ENV = 'production';
  delete process.env.SERVE_WEBSITE;
  let app;
  try {
    app = createApp({
      pool,
      publicDirectory,
      uploadDirectory: await uploadRootPromise,
    });
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalServeWebsite === undefined) delete process.env.SERVE_WEBSITE;
    else process.env.SERVE_WEBSITE = originalServeWebsite;
  }
  const hostedServer = app.listen(0);
  await new Promise((resolve) => hostedServer.once('listening', resolve));
  try {
    const website = await fetch(`http://127.0.0.1:${hostedServer.address().port}/`);
    assert.equal(website.status, 200);
    assert.match(await website.text(), /Production site/);
  } finally {
    await new Promise((resolve, reject) => hostedServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('valid enquiry is saved and returns a reference', async () => {
  const response = await fetch(`${baseUrl}/api/v1/enquiries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: ' Ada Customer ',
      phone: '+234 801 234 5678',
      enquiryType: 'Maintenance & Repairs',
      description: 'Please inspect my car.',
      make: 'Toyota',
      model: 'Camry',
    }),
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.match(result.id, /^[0-9a-f-]{36}$/);
  assert.equal(result.status, 'NEW');
  assert.deepEqual(result.notifications, { email: 'sent', whatsapp: 'not_configured' });
  assert.equal(notificationCalls.at(-1).data.fullName, 'Ada Customer');
  assert.equal(saved.at(-1).values[1], 'Ada Customer');
  assert.match(saved.at(-1).sql, /\$1/);
});

test('valid photo upload is signature-checked and privately stored with the enquiry', async () => {
  const form = new FormData();
  form.set('fullName', 'Ada Customer');
  form.set('phone', '+234 801 234 5678');
  form.set('enquiryType', 'General Enquiry');
  form.set('description', 'Please inspect my car.');
  form.append(
    'attachments',
    new Blob([createPng()], { type: 'image/png' }),
    'vehicle.png',
  );
  const response = await fetch(`${baseUrl}/api/v1/enquiries`, { method: 'POST', body: form });
  const result = await response.json();
  const root = await uploadRootPromise;
  assert.equal(response.status, 201, JSON.stringify(result));
  const files = await fs.readdir(path.join(root, 'private'));
  const attachment = saved.findLast((entry) => entry.sql.includes('submission_attachments'));

  assert.equal(response.status, 201);
  assert.equal(result.attachmentCount, 1);
  assert.equal(notificationCalls.at(-1).attachmentCount, 1);
  assert.equal(files.length, 1);
  assert.match(files[0], /\.png$/);
  assert.equal(attachment.values[3], 'vehicle.png');
  assert.equal(attachment.values[4], 'image/png');
});

test('fake image content is rejected and discarded', async () => {
  const form = new FormData();
  form.set('fullName', 'Ada Customer');
  form.set('phone', '+234 801 234 5678');
  form.set('enquiryType', 'General Enquiry');
  form.set('description', 'Please inspect my car.');
  form.append('attachments', new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
  const response = await fetch(`${baseUrl}/api/v1/enquiries`, { method: 'POST', body: form });
  const result = await response.json();
  const root = await uploadRootPromise;

  assert.equal(response.status, 400);
  assert.ok(result.fields.attachments);
  assert.equal((await fs.readdir(path.join(root, 'private'))).length, 1);
  assert.deepEqual(await fs.readdir(path.join(root, 'staging')), []);
});

test('database failure rolls back and removes the private upload', async () => {
  const form = new FormData();
  form.set('fullName', 'Ada Customer');
  form.set('phone', '+234 801 234 5678');
  form.set('enquiryType', 'General Enquiry');
  form.set('description', 'Please inspect my car.');
  form.append(
    'attachments',
    new Blob([createPng()], { type: 'image/png' }),
    'vehicle.png',
  );
  const root = await uploadRootPromise;
  const storedFilesBefore = await fs.readdir(path.join(root, 'private'));
  failAttachmentInsert = true;
  try {
    const response = await fetch(`${baseUrl}/api/v1/enquiries`, { method: 'POST', body: form });
    assert.equal(response.status, 500);
    assert.deepEqual(await fs.readdir(path.join(root, 'private')), storedFilesBefore);
    assert.deepEqual(await fs.readdir(path.join(root, 'staging')), []);
  } finally {
    failAttachmentInsert = false;
  }
});

test('upload endpoint enforces the maximum number of attachments', async () => {
  const form = new FormData();
  form.set('fullName', 'Ada Customer');
  form.set('phone', '+234 801 234 5678');
  form.set('enquiryType', 'General Enquiry');
  form.set('description', 'Please inspect my car.');
  for (let index = 0; index < 7; index += 1) {
    form.append(
      'attachments',
      new Blob([createPng()], { type: 'image/png' }),
      `vehicle-${index}.png`,
    );
  }
  const response = await fetch(`${baseUrl}/api/v1/enquiries`, { method: 'POST', body: form });

  assert.equal(response.status, 400);
});

test('upload endpoint rejects files larger than 15 MB', async () => {
  const form = new FormData();
  form.set('fullName', 'Ada Customer');
  form.set('phone', '+234 801 234 5678');
  form.set('enquiryType', 'General Enquiry');
  form.set('description', 'Please inspect my car.');
  form.append(
    'attachments',
    new Blob([Buffer.alloc(15 * 1024 * 1024 + 1)], { type: 'image/png' }),
    'oversized.png',
  );
  const response = await fetch(`${baseUrl}/api/v1/enquiries`, { method: 'POST', body: form });

  assert.equal(response.status, 413);
});

test('invalid booking fields are rejected without saving', async () => {
  const countBefore = saved.length;
  const response = await fetch(`${baseUrl}/api/v1/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'A',
      phone: 'abc',
      email: 'invalid',
      make: 'Toyota',
      model: 'Camry',
      service: 'MAINTENANCE',
      preferredDate: 'not-a-date',
      location: 'HOME_SERVICE',
    }),
  });
  const result = await response.json();
  assert.equal(response.status, 400);
  assert.ok(result.fields.fullName);
  assert.ok(result.fields.phone);
  assert.ok(result.fields.whatsapp);
  assert.ok(result.fields.email);
  assert.ok(result.fields.preferredDate);
  assert.ok(result.fields.locationOther);
  assert.equal(saved.length, countBefore);
});

test('booking requires a WhatsApp number even when the phone number is provided', async () => {
  const countBefore = saved.length;
  const response = await fetch(`${baseUrl}/api/v1/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Ada Customer',
      phone: '+234 801 234 5678',
      email: 'ada@example.test',
      make: 'Toyota',
      model: 'Camry',
      service: 'MAINTENANCE',
      preferredDate: '2099-01-20',
      preferredTime: '10:30',
      location: 'OUR_LOCATION',
      policyAccepted: true,
    }),
  });
  const result = await response.json();
  assert.equal(response.status, 400);
  assert.ok(result.fields.whatsapp);
  assert.equal(saved.length, countBefore);
});

test('booking rejects time slots outside configured working hours', async () => {
  const response = await fetch(`${baseUrl}/api/v1/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Ada Customer',
      phone: '+234 801 234 5678',
      whatsapp: '+234 809 876 5432',
      email: 'ada@example.test',
      make: 'Toyota',
      model: 'Camry',
      service: 'MAINTENANCE',
      preferredDate: '2027-01-20',
      preferredTime: '07:30',
      location: 'OUR_LOCATION',
    }),
  });
  const result = await response.json();
  assert.equal(response.status, 409);
  assert.match(result.error, /outside the service hours/i);
});

test('valid booking is saved with its requested service and date', async () => {
  const latestAllowedVehicleYear = new Date().getFullYear() + 1;
  const response = await fetch(`${baseUrl}/api/v1/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Ada Customer',
      phone: '+234 801 234 5678',
      whatsapp: '+234 809 876 5432',
      email: 'ada@example.test',
      make: 'Toyota',
      model: 'Camry',
      year: String(latestAllowedVehicleYear),
      service: 'MAINTENANCE',
      preferredDate: '2027-01-20',
      preferredTime: '10:30',
      location: 'OUR_LOCATION',
      policyAccepted: true,
    }),
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.status, 'NEW');
  assert.match(result.reference, /^TEO-\d+$/);
  const savedBooking = saved.filter((item) => item.sql.includes('INSERT INTO bookings')).at(-1);
  assert.match(savedBooking.sql, /INSERT INTO bookings\s*\(\s*id,\s*full_name/);
  assert.equal(savedBooking.values[10], '2027-01-20');
  assert.equal(savedBooking.values[6], latestAllowedVehicleYear);
  assert.equal(savedBooking.values[17], 'ada@example.test');
  assert.equal(savedBooking.values[3], '+234 809 876 5432');
});

test('tint booking saves its selected option and server-priced amount', async () => {
  const response = await fetch(`${baseUrl}/api/v1/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Ada Customer',
      phone: '+234 801 234 5678',
      whatsapp: '+234 809 876 5432',
      email: 'ada@example.test',
      make: 'Toyota',
      model: 'Camry',
      service: 'TINT',
      tintOption: 'ceramic',
      preferredDate: '2027-01-20',
      preferredTime: '11:00',
      location: 'OUR_LOCATION',
      policyAccepted: true,
    }),
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.match(result.reference, /^TEO-\d+$/);
  const savedBooking = saved.filter((item) => item.sql.includes('INSERT INTO bookings')).at(-1);
  assert.equal(savedBooking.values[18], 'ceramic');
  assert.equal(savedBooking.values[19], 100);
  assert.match(savedBooking.values[14], /Ceramic colour options/);
  assert.match(savedBooking.values[14], /₦100/);
  assert.match(savedBooking.values[14], /payment is due only after booking approval/i);
});

test('booking rejects unknown tint options and tint options on other services', async () => {
  const baseBooking = {
    fullName: 'Ada Customer',
    phone: '+234 801 234 5678',
    whatsapp: '+234 809 876 5432',
    email: 'ada@example.test',
    make: 'Toyota',
    model: 'Camry',
    service: 'TINT',
    preferredDate: '2027-01-20',
    preferredTime: '11:30',
    location: 'OUR_LOCATION',
    policyAccepted: true,
  };
  const invalidOption = await fetch(`${baseUrl}/api/v1/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...baseBooking, tintOption: '999999' }),
  });
  assert.equal(invalidOption.status, 400);

  const wrongService = await fetch(`${baseUrl}/api/v1/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...baseBooking, service: 'DETAILING', tintOption: 'ceramic' }),
  });
  assert.equal(wrongService.status, 400);
});

test('unknown fields and malformed JSON are rejected', async () => {
  const unknownField = await fetch(`${baseUrl}/api/v1/enquiries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ unexpected: 'value' }),
  });
  assert.equal(unknownField.status, 400);

  const malformed = await fetch(`${baseUrl}/api/v1/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 400);
});
