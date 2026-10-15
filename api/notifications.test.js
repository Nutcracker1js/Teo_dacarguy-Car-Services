const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createCustomerEmailSender,
  createNotificationSender,
  getNotificationReadiness,
  renderCustomerEmail,
} = require('./notifications');

const notificationEnvironment = {
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_USER: 'api@example.test',
  SMTP_PASSWORD: 'test-password',
  SMTP_FROM: 'Teo Garage <api@example.test>',
  NOTIFICATION_EMAIL: 'owner@example.test',
};

test('business booking notifications use email only', async () => {
  let sentEmail;
  const sendNotifications = createNotificationSender(
    notificationEnvironment,
    (options) => ({
      async sendMail(message) {
        sentEmail = { options, message };
      },
    }),
  );

  const result = await sendNotifications({
    type: 'booking',
    id: 'request-reference',
    data: {
      fullName: 'Ada Customer',
      phone: '+234 801 234 5678',
      service: 'MAINTENANCE',
      preferredDate: '2027-01-20',
      preferredTime: '10:30',
    },
    attachmentCount: 1,
  });

  assert.deepEqual(result, { email: 'sent' });
  assert.equal(sentEmail.message.to, 'owner@example.test');
  assert.equal(sentEmail.options.requireTLS, true);
  assert.match(sentEmail.message.text, /request-reference/);
  assert.match(sentEmail.message.text, /Attachments: 1/);
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
  const sendNotifications = createNotificationSender({}, () => {
    throw new Error('Unconfigured SMTP transport was called.');
  });

  assert.equal(readiness.email.configured, false);
  assert.deepEqual(
    await sendNotifications({ id: 'request-reference', type: 'enquiry', data: {}, attachmentCount: 0 }),
    { email: 'not_configured' },
  );
});

test('email notifications default to the standard submission port', () => {
  const environment = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_USER: 'api@example.test',
    SMTP_PASSWORD: 'test-password',
    NOTIFICATION_EMAIL: 'owner@example.test',
  };
  let transportOptions;
  createNotificationSender(environment, (options) => {
    transportOptions = options;
    return { async sendMail() {} };
  });
  assert.equal(getNotificationReadiness(environment).email.configured, true);
  assert.equal(transportOptions.port, 587);
  assert.equal(transportOptions.localAddress, '0.0.0.0');
});

test('customer email transport uses IPv4 for the SMTP connection', async () => {
  let transportOptions;
  let sentMessage;
  const sendEmail = createCustomerEmailSender({
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'api@example.test',
    SMTP_PASSWORD: 'test-password',
  }, (options) => {
    transportOptions = options;
    return {
      async sendMail(message) {
        sentMessage = message;
      },
    };
  });

  await sendEmail({
    to: 'customer@example.test',
    eventType: 'BOOKING_RECEIVED',
    customerName: 'Ada Customer',
    reference: 'TD-1001',
    service: 'MAINTENANCE',
  });

  assert.equal(transportOptions.port, 465);
  assert.equal(transportOptions.secure, true);
  assert.equal(transportOptions.localAddress, '0.0.0.0');
  assert.equal(sentMessage.to, 'customer@example.test');
});

test('failed notification provider does not claim delivery', async () => {
  let logged = '';
  const originalError = console.error;
  console.error = (message) => { logged = message; };
  try {
    const sendNotifications = createNotificationSender(
      notificationEnvironment,
      () => ({ async sendMail() { throw new Error('SMTP unavailable.'); } }),
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
  } finally {
    console.error = originalError;
  }
});
