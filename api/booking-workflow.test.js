const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { processExpiredBookings } = require('./booking-expiry');
const { canIssueBookingSlip, createBookingSlip } = require('./booking-slip');
const { createCustomerNotificationService } = require('./customer-notifications');
const { applyVerifiedPayment } = require('./payment-processing');
const { verifyPaystackSignature } = require('./payments');
const { updateBookingStatus } = require('./admin');

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
  assert.match(pdf.toString('latin1'), /MediaBox \[0 0 420 595\]/);
  assert.match(pdf.toString('latin1'), /\/Subtype \/Image/);
});

test('admin confirmation commits an accepted proposed date without treating it as final approval before payment', async () => {
  const statements = [];
  const client = {
    async query(sql, values = []) {
      statements.push({ sql, values });
      if (sql.includes('FROM bookings WHERE id = $1 FOR UPDATE')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'booking-id',
            reference: 'TEO-1000',
            status: 'RESCHEDULE_PROPOSED',
            payment_status: 'UNPAID',
            payment_verification: 'UNVERIFIED',
            amount_received: 0,
            amount_expected: 80000,
            service: 'TINT',
            proposed_date: '2027-01-20',
            proposed_time: '10:30',
            proposed_response: 'ACCEPTED',
          }],
        };
      }
      if (sql.includes('SELECT is_open, opens_at::text')) {
        return { rows: [{ is_open: true, opens_at: '08:00:00', closes_at: '19:00:00' }] };
      }
      if (sql.includes('SELECT COUNT(*)::int AS total FROM booking_working_hours')) {
        return { rows: [{ total: 7 }] };
      }
      if (sql.includes('SELECT duration_minutes FROM booking_service_durations')) {
        return { rows: [{ duration_minutes: 60 }] };
      }
      if (sql.includes('FROM booking_availability_blocks')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT b.id')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('UPDATE bookings SET status')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'booking-id',
            reference: 'TEO-1000',
            status: values[0],
            payment_status: 'UNPAID',
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const result = await updateBookingStatus(
    { async connect() { return client; } },
    'booking-id',
    'CONFIRMED',
    undefined,
  );

  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.status, 'APPROVED');
  assert.equal(result.body.rescheduleConfirmed, true);
  assert.equal(result.body.confirmedProposedDate, '2027-01-20');
  assert.equal(result.body.confirmedProposedTime, '10:30');
  assert.equal(statements.find(({ sql }) => sql.startsWith('UPDATE bookings SET status')).values[0], 'APPROVED');
  assert.ok(statements.some(({ sql }) => sql.includes('preferred_date = CASE WHEN $12 THEN proposed_preferred_date')));
  assert.ok(statements.some(({ sql }) => sql.includes("INSERT INTO booking_status_history")));
  assert.ok(statements.some(({ sql }) => sql === 'COMMIT'));
});

test('rescheduling cannot be confirmed when the accepted proposed slot is no longer available', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('FROM bookings WHERE id = $1 FOR UPDATE')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'booking-id',
            reference: 'TEO-1000',
            status: 'RESCHEDULE_PROPOSED',
            payment_status: 'UNPAID',
            payment_verification: 'UNVERIFIED',
            amount_received: 0,
            amount_expected: 80000,
            service: 'TINT',
            proposed_date: '2027-01-20',
            proposed_time: '10:30',
            proposed_response: 'ACCEPTED',
          }],
        };
      }
      if (sql.includes('SELECT is_open, opens_at::text')) {
        return { rows: [{ is_open: true, opens_at: '08:00:00', closes_at: '19:00:00' }] };
      }
      if (sql.includes('SELECT COUNT(*)::int AS total FROM booking_working_hours')) {
        return { rows: [{ total: 7 }] };
      }
      if (sql.includes('SELECT duration_minutes FROM booking_service_durations')) {
        return { rows: [{ duration_minutes: 60 }] };
      }
      if (sql.includes('FROM booking_availability_blocks')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT b.id')) return { rowCount: 1, rows: [{ id: 'conflicting-booking' }] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };

  await assert.rejects(
    updateBookingStatus({ async connect() { return client; } }, 'booking-id', 'CONFIRMED'),
    /just been reserved/,
  );
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

test('repeating a proposed-date event retries its existing failed outbox email', async () => {
  let deliveryStatus = 'PENDING';
  let providerCalls = 0;
  const pool = {
    async connect() {
      return {
        async query(sql) {
          if (sql.includes('INSERT INTO booking_notifications')) return { rowCount: 0, rows: [] };
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
    async query(sql) {
      if (sql.includes('SELECT id, delivery_status')) {
        return { rowCount: 1, rows: [{ id: 'proposal-email', delivery_status: deliveryStatus }] };
      }
      if (sql.includes("SET delivery_status = 'SENDING'")) {
        if (!['PENDING', 'FAILED'].includes(deliveryStatus)) return { rowCount: 0, rows: [] };
        deliveryStatus = 'SENDING';
        return {
          rowCount: 1,
          rows: [{
            id: 'proposal-email',
            event_type: 'RESCHEDULE_PROPOSED',
            recipient: 'customer@example.com',
            payload: { reference: 'TEO-1000', proposedDate: '2027-01-20' },
          }],
        };
      }
      if (sql.includes("SET delivery_status = 'FAILED'")) deliveryStatus = 'FAILED';
      if (sql.includes("SET delivery_status = 'SENT'")) deliveryStatus = 'SENT';
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
  const event = {
    bookingId: 'booking-id',
    eventKey: 'reschedule_proposed:booking-id:2027-01-20:10:30',
    eventType: 'RESCHEDULE_PROPOSED',
    recipient: 'customer@example.com',
    payload: { reference: 'TEO-1000', proposedDate: '2027-01-20' },
  };

  assert.equal((await service.deliver('proposal-email')).status, 'failed');
  assert.equal((await service.enqueueAndDeliver(event)).status, 'sent');
  assert.equal(providerCalls, 2);
  assert.equal(deliveryStatus, 'SENT');
});
