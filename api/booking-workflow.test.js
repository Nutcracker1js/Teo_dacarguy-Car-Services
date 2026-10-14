const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { processExpiredBookings } = require('./booking-expiry');
const { canIssueBookingSlip, createBookingSlip } = require('./booking-slip');
const { createCustomerNotificationService } = require('./customer-notifications');
const { applyVerifiedPayment } = require('./payment-processing');
const { verifyPaystackSignature } = require('./payments');

test('Paystack webhook signatures are checked against the exact raw payload', () => {
  const secret = 'test-paystack-secret';
  const payload = Buffer.from('{"event":"charge.success","data":{"reference":"pay-123"}}');
  const signature = crypto.createHmac('sha512', secret).update(payload).digest('hex');

  assert.equal(verifyPaystackSignature(payload, signature, secret), true);
  assert.equal(verifyPaystackSignature(payload, signature.toUpperCase(), secret), true);
  assert.equal(verifyPaystackSignature(Buffer.from(`${payload} `), signature, secret), false);
  assert.equal(verifyPaystackSignature(payload, signature, ''), false);
});

test('verified Paystack payments are recorded with the booking status kept separate', async () => {
  const booking = {
    id: 'booking-id',
    reference: 'TD-TEST1001',
    status: 'APPROVED',
    payment_status: 'AWAITING_PAYMENT',
    payment_reference: 'pay-123',
    payment_verification: 'UNVERIFIED',
    amount_expected: '80000',
    email: 'customer@example.com',
    full_name: 'Test Customer',
    service: 'TINT',
  };
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('FROM bookings WHERE payment_reference')) {
        return { rowCount: 1, rows: [{ ...booking }] };
      }
      if (sql.includes('INSERT INTO paystack_webhook_receipts')) {
        return { rowCount: 1, rows: [{ event_key: 'charge.success:pay-123' }] };
      }
      if (sql.includes("SET status = 'AWAITING_APPROVAL'")) {
        booking.status = 'AWAITING_APPROVAL';
        booking.payment_status = 'PAID';
        booking.payment_verification = 'VERIFIED';
        return {
          rowCount: 1,
          rows: [{ status: booking.status, payment_status: booking.payment_status, amount_received: 80000 }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };

  const result = await applyVerifiedPayment({
    pool,
    transaction: {
      status: 'success',
      reference: 'pay-123',
      currency: 'NGN',
      amount: 8000000,
      metadata: { booking_reference: 'TD-TEST1001' },
    },
    transactionReference: 'pay-123',
  });

  assert.equal(result.status, 'PAID');
  assert.equal(result.bookingStatus, 'AWAITING_APPROVAL');
  assert.ok(statements.includes('COMMIT'));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO paystack_webhook_receipts')));
});

test('a pending Paystack transaction keeps its expired checkout slot reserved', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("WHERE status IN ('NEW', 'PENDING_REVIEW')")) return { rows: [] };
      if (sql.includes("status = 'RESCHEDULE_PROPOSED'")) return { rows: [] };
      if (sql.includes('payment_reference')) {
        return { rows: [{ id: 'booking-id', payment_reference: 'pay-123' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    async connect() {
      throw new Error('An unresolved payment must not release its booking slot.');
    },
  };

  await processExpiredBookings({
    pool,
    paymentGateway: {
      configured: true,
      async verify() {
        return { data: { status: 'pending' } };
      },
    },
  });
});

test('booking slips require final confirmation and verified required payment', async () => {
  const booking = {
    reference: 'TD-TEST1001',
    status: 'CONFIRMED',
    payment_status: 'PAID',
    payment_verification: 'VERIFIED',
    amount_expected: '80000',
    amount_received: '80000',
    full_name: 'Test Customer',
    phone: '08012345678',
    email: 'customer@example.com',
    service: 'TINT',
    preferred_date: '2027-01-20',
    preferred_time: '10:30',
  };

  assert.equal(canIssueBookingSlip(booking), true);
  assert.equal(canIssueBookingSlip({ ...booking, payment_verification: 'UNVERIFIED' }), false);
  const pdf = await createBookingSlip(booking);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});

test('failed customer emails are reported and can be retried', async () => {
  let deliveryAttempts = 0;
  let providerCalls = 0;
  const pool = {
    async query(sql) {
      if (sql.includes("SET delivery_status = 'SENDING'")) {
        deliveryAttempts += 1;
        return {
          rowCount: 1,
          rows: [{
            id: 'notification-id',
            event_type: 'BOOKING_CONFIRMED',
            recipient: 'customer@example.com',
            payload: { reference: 'TD-TEST1001' },
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const service = createCustomerNotificationService({
    pool,
    async sendEmail() {
      providerCalls += 1;
      if (providerCalls === 1) throw new Error('SMTP temporarily unavailable.');
    },
  });

  assert.equal((await service.deliver('notification-id')).status, 'failed');
  assert.equal((await service.deliver('notification-id')).status, 'sent');
  assert.equal(deliveryAttempts, 2);
});

test('repeating an approval email event retries its failed outbox entry', async () => {
  let providerCalls = 0;
  const pool = {
    async connect() {
      return {
        async query(sql) {
          if (sql.includes('INSERT INTO booking_notifications')) {
            return { rowCount: 0, rows: [] };
          }
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
    async query(sql) {
      if (sql.includes('SELECT id, delivery_status')) {
        return { rowCount: 1, rows: [{ id: 'notification-id', delivery_status: 'FAILED' }] };
      }
      if (sql.includes("SET delivery_status = 'SENDING'")) {
        return {
          rowCount: 1,
          rows: [{
            id: 'notification-id',
            event_type: 'BOOKING_ACCEPTED',
            recipient: 'customer@example.com',
            payload: { reference: 'TD-TEST1001' },
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const service = createCustomerNotificationService({
    pool,
    async sendEmail() {
      providerCalls += 1;
    },
  });

  const result = await service.enqueueAndDeliver({
    bookingId: 'booking-id',
    eventKey: 'booking_accepted:booking-id:checkout-url',
    eventType: 'BOOKING_ACCEPTED',
    recipient: 'customer@example.com',
    payload: { reference: 'TD-TEST1001' },
  });

  assert.equal(result.status, 'sent');
  assert.equal(providerCalls, 1);
});
