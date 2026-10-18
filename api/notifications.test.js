const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createCustomerEmailSender,
  createNotificationSender,
  getNotificationReadiness,
  renderCustomerEmail,
} = require('./notifications');

const notificationEnvironment = {
  RESEND_API_KEY: 'test-api-key-value',
  RESEND_FROM: 'Teo Garage <bookings@example.test>',
  NOTIFICATION_EMAIL: 'owner@example.test',
};

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return 'resend-request-id'; } },
    async text() { return JSON.stringify(body); },
  };
}

test('business booking notifications use email only', async () => {
  let request;
  const sendNotifications = createNotificationSender(
    notificationEnvironment,
    { fetch: async (...args) => { request = args; return response(200); } },
  );

  const result = await sendNotifications({
    type: 'booking',
    id: 'request-reference',
    reference: 'TEO-1000',
    data: {
      fullName: 'Ada Customer',
      phone: '+234 801 234 5678',
      whatsapp: '+234 801 234 5678',
      email: 'ada@example.test',
      service: 'MAINTENANCE',
      preferredDate: '2027-01-20',
      preferredTime: '10:30',
      location: 'OUR_LOCATION',
    },
    attachmentCount: 1,
  });

  assert.deepEqual(result, { email: 'sent' });
  assert.equal(request[0], 'https://api.resend.com/emails');
  assert.equal(request[1].method, 'POST');
  assert.match(request[1].headers.Authorization, /^Bearer /);
  assert.equal(request[1].headers['Idempotency-Key'], 'submission-request-reference');
  const email = JSON.parse(request[1].body);
  assert.equal(email.from, notificationEnvironment.RESEND_FROM);
  assert.equal(email.to, 'owner@example.test');
  assert.match(email.subject, /New booking request · TEO-1000/);
  assert.match(email.text, /Booking reference: TEO-1000/);
  assert.match(email.text, /Preferred date: 2027-01-20/);
  assert.match(email.text, /Uploaded files: 1 file\(s\), available in the secure admin workflow/);
  assert.match(email.html, /New booking request/);
  assert.match(email.html, /Ada Customer/);
  assert.match(email.html, /WhatsApp/);
});

test('customer email templates cover proposal confirmation, decline reason, payment receipt and completion', () => {
  const confirmedProposal = renderCustomerEmail({
    eventType: 'RESCHEDULE_CONFIRMED',
    customerName: 'Ada',
    reference: 'TEO-1000',
    service: 'TINT',
    proposedDate: '2027-01-20',
    proposedTime: '10:30',
    paymentPageUrl: 'https://teo.example.test/payment.html?reference=TEO-1000',
  });
  assert.match(confirmedProposal.subject, /new appointment date is confirmed/i);
  assert.match(confirmedProposal.text, /2027-01-20 at 10:30/);
  assert.match(confirmedProposal.text, /payment.html/);

  const declined = renderCustomerEmail({
    eventType: 'BOOKING_DECLINED',
    customerName: 'Ada',
    reference: 'TEO-1000',
    declineReason: 'The requested date is unavailable.',
  });
  assert.match(declined.text, /The requested date is unavailable/);

  const payment = renderCustomerEmail({
    eventType: 'PAYMENT_SUCCESSFUL',
    customerName: 'Ada',
    reference: 'TEO-1000',
    amountReceived: 80000,
    transactionReference: 'pay-123',
    bookingStatusUrl: 'https://teo.example.test/booking-status.html?reference=TEO-1000',
  });
  assert.match(payment.text, /pay-123/);
  assert.match(payment.text, /booking-status\.html/);

  const completed = renderCustomerEmail({
    eventType: 'JOB_COMPLETED',
    customerName: 'Ada',
    reference: 'TEO-1000',
  });
  assert.match(completed.text, /Thank you for trusting Teo DaCarguy Car Services/);
});

test('unconfigured email notifications are reported rather than silently treated as sent', async () => {
  const readiness = getNotificationReadiness({});
  const sendNotifications = createNotificationSender({}, {
    async fetch() {
      throw new Error('Unconfigured HTTPS email transport was called.');
    },
  });

  assert.equal(readiness.email.configured, false);
  assert.deepEqual(
    await sendNotifications({ id: 'request-reference', type: 'enquiry', data: {}, attachmentCount: 0 }),
    { email: 'not_configured' },
  );
});

test('customer email transport sends APPOINTMENT_CONFIRMED over HTTPS with idempotency key', async () => {
  let request;
  const sendEmail = createCustomerEmailSender(notificationEnvironment, {
    fetch: async (...args) => { request = args; return response(200); },
  });

  await sendEmail({
    id: '15b25862-3b05-47e0-8ba4-ac1cf4e0beb0',
    to: 'customer@example.test',
    eventType: 'APPOINTMENT_CONFIRMED',
    customerName: 'Ada Customer',
    reference: 'TEO-1001',
    service: 'MAINTENANCE',
    preferredDate: '2027-01-20',
    preferredTime: '10:30',
    attachments: [{ filename: 'booking-TEO-1001.pdf', content: Buffer.from('%PDF-1.7').toString('base64') }],
  });

  const email = JSON.parse(request[1].body);
  assert.equal(request[0], 'https://api.resend.com/emails');
  assert.equal(request[1].headers['Idempotency-Key'], 'customer-notification-15b25862-3b05-47e0-8ba4-ac1cf4e0beb0');
  assert.equal(email.to, 'customer@example.test');
  assert.match(email.subject, /appointment is confirmed/i);
  assert.match(email.text, /Teo has confirmed your appointment/);
  assert.match(email.text, /booking slip is attached as a PDF/i);
  assert.match(email.html, /Your appointment is confirmed/);
  assert.deepEqual(email.attachments, [{
    filename: 'booking-TEO-1001.pdf',
    content: Buffer.from('%PDF-1.7').toString('base64'),
  }]);
});

test('transient Resend responses retry with the same idempotency key', async () => {
  const requests = [];
  const delays = [];
  let calls = 0;
  const sendEmail = createCustomerEmailSender(notificationEnvironment, {
    async fetch(url, options) {
      requests.push({ url, options });
      calls += 1;
      return calls < 3 ? response(503, { message: 'temporarily unavailable' }) : response(200);
    },
    async sleep(milliseconds) { delays.push(milliseconds); },
  });

  await sendEmail({
    id: 'notification-retry',
    to: 'customer@example.test',
    eventType: 'APPOINTMENT_CONFIRMED',
  });

  assert.equal(requests.length, 3);
  assert.deepEqual(delays, [250, 500]);
  assert.equal(new Set(requests.map(({ options }) => options.headers['Idempotency-Key'])).size, 1);
});

test('failed notification provider does not claim delivery', async () => {
  let logged = '';
  const originalError = console.error;
  console.error = (message) => { logged = message; };
  try {
    const sendNotifications = createNotificationSender(
      notificationEnvironment,
      {
        async fetch() { return response(400, { message: 'Invalid sender.' }); },
        async sleep() {},
      },
    );
    const result = await sendNotifications({
      type: 'enquiry',
      id: 'request-reference',
      data: {
        fullName: 'Ada Customer',
        phone: '+234 801 234 5678',
        enquiryType: 'General Enquiry',
        description: 'Please call me.',
      },
      attachmentCount: 0,
    });

    assert.deepEqual(result, { email: 'failed' });
    assert.match(logged, /notification delivery failed/);
    assert.match(logged, /Invalid sender/);
  } finally {
    console.error = originalError;
  }
});
