const assert = require('node:assert/strict');
const express = require('express');
const { after, before, test } = require('node:test');
const { createAdminRouter } = require('./admin');

const bookingId = '7f015c78-18f1-4cff-a5cb-f957d0031704';
const username = 'workflow-admin';
const password = 'workflow-test-password';
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const queryLog = [];
const notificationPayloads = [];
let currentBookingStatus = 'AWAITING_APPROVAL';
let currentPaymentStatus = 'UNPAID';
let currentService = {
  service: 'MAINTENANCE',
  service_option: null,
  payment_status: 'UNPAID',
  payment_verification: 'UNVERIFIED',
  amount_received: '0',
  amount_expected: null,
  payment_reference: null,
  refund_status: 'NONE',
};
let server;
let baseUrl;

const pool = {
  async query(sql, values = []) {
    queryLog.push({ sql, values });
    if (sql.includes('SELECT storage_key FROM booking_payment_documents')) return { rows: [] };
    if (sql.includes('payments')) {
      return { rows: [{ awaiting_review: 2, awaiting_payment: 1, awaiting_approval: 3, upcoming: 4, payments_verified: 5 }] };
    }
    if (sql.includes('COUNT(*) OVER()')) {
      return {
        rows: [{
          id: bookingId,
          full_name: 'Ada Customer',
          status: 'AWAITING_APPROVAL',
          payment_status: 'PAID',
          total: 1,
        }],
      };
    }
    if (sql.includes('INSERT INTO booking_internal_notes')) {
      return { rows: [{ id: '8f015c78-18f1-4cff-a5cb-f957d0031704', note: values[2], created_at: '2026-10-11T10:00:00.000Z' }] };
    }
    if (sql.startsWith('DELETE FROM bookings')) {
      return { rowCount: values[0] === bookingId ? 1 : 0, rows: values[0] === bookingId ? [{ id: bookingId }] : [] };
    }
    if (sql.includes("UPDATE bookings SET payment_status = 'AWAITING_PAYMENT'")) {
      return { rowCount: 1, rows: [{ id: bookingId }] };
    }
    if (sql.includes('UPDATE bookings SET amount_expected')) {
      return { rowCount: 1, rows: [{ id: bookingId }] };
    }
    if (sql.includes('UPDATE bookings SET payment_status')) {
      return {
        rowCount: 1,
        rows: [{ id: bookingId, payment_status: values[0], amount_expected: values[1], amount_received: values[2] }],
      };
    }
    if (sql.includes('SELECT service, service_option, payment_status')) {
      return { rowCount: 1, rows: [currentService] };
    }
    if (sql.replace(/\s+/g, ' ').includes('SELECT id, reference, full_name, phone, whatsapp, email, whatsapp_opt_in, service, service_other')) {
      return {
        rowCount: 1,
        rows: [{
          id: bookingId,
          reference: 'TD-1001',
          full_name: 'Ada Customer',
          phone: '+234 801 234 5678',
          whatsapp: null,
          email: 'ada@example.test',
          whatsapp_opt_in: true,
          service: 'TINT',
          service_option: 'classic-smoke',
          service_other: null,
          preferred_date: '2027-01-20',
          preferred_time: '10:30',
          status: currentBookingStatus,
          payment_status: currentPaymentStatus,
          payment_verification: currentPaymentStatus === 'PAID' ? 'VERIFIED' : 'UNVERIFIED',
          amount_received: currentPaymentStatus === 'PAID' ? '50000' : '0',
          amount_expected: null,
          payment_reference: null,
          payment_checkout_url: null,
        }],
      };
    }
    if (sql.includes('SELECT id, blocked_date::text AS blocked_date')) {
      return {
        rows: [{
          id: '9f015c78-18f1-4cff-a5cb-f957d0031704',
          blocked_date: '2026-11-03',
          starts_at: null,
          ends_at: null,
          reason: 'Closed',
        }],
      };
    }
    if (sql.includes('FROM bookings WHERE id')) return { rowCount: 1, rows: [{ id: bookingId }] };
    if (sql.includes('booking_working_hours')) return { rows: [] };
    if (sql.includes('booking_service_durations')) return { rows: [] };
    if (sql.includes('booking_availability_blocks')) return { rows: [] };
    return { rows: [] };
  },
  async connect() {
    return {
      async query(sql, values = []) {
        queryLog.push({ sql, values });
        if (sql.includes('SELECT id, reference, status, payment_status')) {
          return {
            rowCount: 1,
            rows: [{
              id: bookingId,
              reference: 'TD-1001',
              status: currentBookingStatus,
              payment_status: 'PAID',
              payment_verification: 'VERIFIED',
              amount_expected: '50000',
              amount_received: '50000',
              service: 'MAINTENANCE',
            }],
          };
        }
        if (sql.includes('UPDATE bookings SET status')) {
          currentBookingStatus = values[0];
          return {
            rowCount: 1,
            rows: [{ id: bookingId, status: values[0], resolution: values[1], payment_status: 'REFUND_PENDING', refund_status: 'INITIATED' }],
          };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
  },
};

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin', createAdminRouter({
    pool,
    username,
    password,
    privateDirectory: process.cwd(),
    publicSiteUrl: 'https://teo.example.test',
    bookingNotifications: {
      async enqueueAndDeliver(notification) {
        notificationPayloads.push(notification);
        return { status: 'failed', error: 'SMTP connection failed.' };
      },
    },
  }));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/admin`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { Authorization: authorization, ...(options.headers || {}) },
  });
}

test('booking dashboard summary is calculated from booking records', async () => {
  const response = await request('/dashboard');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.summary.awaiting_approval, 3);
  assert.ok(queryLog.at(-1).sql.includes('FROM bookings'));
});

test('booking search accepts a customer or TD reference and returns payment separately', async () => {
  const response = await request('/bookings?search=TD-7f015c78&paymentStatus=PAID');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.bookings[0].payment_status, 'PAID');
  assert.equal(result.bookings[0].status, 'AWAITING_APPROVAL');
  assert.deepEqual(queryLog.at(-1).values.slice(0, 3), ['ALL', 'PAID', 'TD-7f015c78']);
});

test('approving a booking prepares payment without automatically sending a WhatsApp message', async () => {
  const response = await request(`/bookings/${bookingId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'APPROVED' }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'APPROVED');
  assert.equal(currentBookingStatus, 'APPROVED');
  assert.equal(result.paymentCheckout.status, 'ready');
  assert.equal(result.paymentCheckout.paymentPageUrl, 'https://teo.example.test/payment.html?reference=TD-1001');
  assert.equal(result.customerEmail.status, 'failed');
  assert.equal(notificationPayloads.at(-1).payload.paymentPageUrl, result.paymentCheckout.paymentPageUrl);
  const statusUpdate = queryLog.find(({ sql }) => sql.includes('UPDATE bookings SET status = $1::varchar'));
  assert.ok(statusUpdate.sql.includes("$1::varchar NOT IN ('NEW', 'PENDING_REVIEW')"));
  assert.ok(statusUpdate.sql.includes('$6::char(64) IS NULL'));
  assert.ok(statusUpdate.sql.includes('$10::char(64)'));
  const amountUpdate = queryLog.find(({ sql }) => sql.includes('UPDATE bookings SET amount_expected'));
  assert.equal(amountUpdate.values[0], 80000);

  const prepared = await request(`/bookings/${bookingId}/payment-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(prepared.status, 200);
  assert.equal((await prepared.json()).paymentPageUrl, 'https://teo.example.test/payment.html?reference=TD-1001');
});

test('re-approving an approved booking retries payment and email preparation', async () => {
  currentBookingStatus = 'APPROVED';
  const response = await request(`/bookings/${bookingId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'APPROVED' }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.paymentCheckout.status, 'ready');
  assert.equal(result.customerEmail.status, 'failed');
});

test('admin message API no longer sends customer WhatsApp messages', async () => {
  const legacyMessage = await request(`/bookings/${bookingId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'CUSTOM', message: 'Your booking is ready.' }),
  });
  assert.equal(legacyMessage.status, 404);
});

test('admin can delete one booking and cascades its related records', async () => {
  const response = await request(`/bookings/${bookingId}`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: bookingId, deleted: true });
  assert.ok(queryLog.some(({ sql }) => sql.includes('SELECT storage_key FROM submission_attachments')));
  assert.ok(queryLog.some(({ sql }) => sql.includes('SELECT storage_key FROM booking_payment_documents')));
  assert.ok(queryLog.some(({ sql }) => sql.startsWith('DELETE FROM bookings')));

  const invalid = await request('/bookings/not-a-uuid', { method: 'DELETE' });
  assert.equal(invalid.status, 404);
});

test('paid bookings cannot be declined without a reschedule or refund resolution', async () => {
  const denied = await request(`/bookings/${bookingId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'DECLINED' }),
  });
  assert.equal(denied.status, 409);
  assert.equal((await denied.json()).requiresResolution, true);

  const resolved = await request(`/bookings/${bookingId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'DECLINED', resolution: 'INITIATE_REFUND' }),
  });
  assert.equal(resolved.status, 200);
  const result = await resolved.json();
  assert.equal(result.status, 'DECLINED');
  assert.equal(result.payment_status, 'REFUND_PENDING');
  assert.ok(queryLog.some(({ sql }) => sql.includes('INSERT INTO booking_status_history')));
});

test('admin cannot manually mark a payment as paid or verified', async () => {
  currentService = {
    service: 'MAINTENANCE',
    service_option: null,
    payment_status: 'UNPAID',
    payment_verification: 'UNVERIFIED',
    amount_received: '0',
    amount_expected: null,
    payment_reference: null,
    refund_status: 'NONE',
  };
  const response = await request(`/bookings/${bookingId}/payment`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentStatus: 'PAID',
      amountExpected: 50000,
      amountReceived: 50000,
      reference: 'PAY-001',
      verification: 'VERIFIED',
      refundStatus: 'NONE',
    }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /paystack verifies/i);
});

test('fixed tint prices are enforced by the server on payment updates', async () => {
  currentService = {
    service: 'TINT',
    service_option: 'ceramic',
    payment_status: 'UNPAID',
    payment_verification: 'UNVERIFIED',
    amount_received: '0',
    amount_expected: null,
    payment_reference: null,
    refund_status: 'NONE',
  };
  const response = await request(`/bookings/${bookingId}/payment`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentStatus: 'UNPAID',
      amountExpected: 1,
      amountReceived: 0,
      reference: null,
      verification: 'UNVERIFIED',
      refundStatus: 'NONE',
    }),
  });
  assert.equal(response.status, 200);
  const update = queryLog.at(-1);
  assert.ok(update.sql.includes('UPDATE bookings SET payment_status'));
  assert.equal(update.values[1], 150000);
  currentService = {
    service: 'MAINTENANCE',
    service_option: null,
    payment_status: 'UNPAID',
    payment_verification: 'UNVERIFIED',
    amount_received: '0',
    amount_expected: null,
    payment_reference: null,
    refund_status: 'NONE',
  };
});

test('internal booking notes are saved privately', async () => {
  const response = await request(`/bookings/${bookingId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'Customer prefers morning appointment.' }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).note.note, 'Customer prefers morning appointment.');
});

test('availability blocks preserve calendar dates in the admin response', async () => {
  const response = await request('/availability');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.blocks[0].blocked_date, '2026-11-03');
  assert.match(queryLog.find(({ sql }) => sql.includes('SELECT id, blocked_date::text AS blocked_date')).sql, /blocked_date::text/);
});
