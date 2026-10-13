const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createBookingApprovalNotifier,
  createBookingMessageSender,
  createNotificationSender,
  getNotificationReadiness,
} = require('./notifications');

const notificationEnvironment = {
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_USER: 'api@example.test',
  SMTP_PASSWORD: 'test-password',
  SMTP_FROM: 'Teo Garage <api@example.test>',
  NOTIFICATION_EMAIL: 'owner@example.test',
  WHATSAPP_ACCESS_TOKEN: 'test-access-token',
  WHATSAPP_PHONE_NUMBER_ID: '123456789',
  WHATSAPP_RECIPIENT: '+2348012345678',
  WHATSAPP_TEMPLATE_NAME: 'new_service_request',
  WHATSAPP_TEMPLATE_LANGUAGE: 'en_US',
  WHATSAPP_GRAPH_VERSION: 'v23.0',
};

test('both configured channels notify the business about a new booking', async () => {
  let sentEmail;
  let whatsappRequest;
  const sendNotifications = createNotificationSender(
    notificationEnvironment,
    async (url, options) => {
      whatsappRequest = { url, options, body: JSON.parse(options.body) };
      return { ok: true, status: 200 };
    },
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

  assert.deepEqual(result, { email: 'sent', whatsapp: 'sent' });
  assert.equal(sentEmail.message.to, 'owner@example.test');
  assert.equal(sentEmail.options.requireTLS, true);
  assert.match(sentEmail.message.text, /request-reference/);
  assert.match(sentEmail.message.text, /Attachments: 1/);
  assert.equal(whatsappRequest.url, 'https://graph.facebook.com/v23.0/123456789/messages');
  assert.equal(whatsappRequest.options.headers.Authorization, 'Bearer test-access-token');
  assert.equal(whatsappRequest.body.to, '2348012345678');
  assert.equal(whatsappRequest.body.template.name, 'new_service_request');
  assert.equal(whatsappRequest.body.template.components[0].parameters[3].text, 'request-reference');
  assert.equal(whatsappRequest.body.template.components[0].parameters.length, 5);
});

test('approval notification sends the accepted message with a direct Paystack button', async () => {
  let whatsappRequest;
  const notifyApproval = createBookingApprovalNotifier({
    WHATSAPP_ACCESS_TOKEN: 'test-access-token',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_APPROVAL_TEMPLATE_NAME: 'booking_approved',
    WHATSAPP_TEMPLATE_LANGUAGE: 'en_US',
    PUBLIC_SITE_URL: 'https://teo.example.test',
    WHATSAPP_GRAPH_VERSION: 'v23.0',
  }, async (url, options) => {
    whatsappRequest = { url, body: JSON.parse(options.body) };
    return { ok: true, status: 200 };
  });
  const result = await notifyApproval({
    full_name: 'Ada Customer',
    reference: 'TD-1001',
    phone: '+234 801 234 5678',
    whatsapp: null,
    service: 'Tint',
    preferred_date: '2027-01-20',
    preferred_time: '10:30',
    whatsapp_opt_in: true,
    payment_url: 'https://checkout.paystack.com/abc123',
  });

  assert.deepEqual(result, { status: 'sent' });
  assert.equal(whatsappRequest.url, 'https://graph.facebook.com/v23.0/123456789/messages');
  assert.equal(whatsappRequest.body.to, '2348012345678');
  assert.equal(whatsappRequest.body.template.name, 'booking_approved');
  const parameters = whatsappRequest.body.template.components[0].parameters;
  assert.equal(parameters[0].text, 'Ada Customer');
  assert.equal(parameters[1].text, 'TD-1001');
  assert.match(parameters[2].text, /Tint.*2027-01-20.*10:30/);
  assert.equal(parameters[3].text, 'https://teo.example.test/booking-status.html?reference=TD-1001');
  assert.deepEqual(whatsappRequest.body.template.components[1], {
    type: 'button',
    sub_type: 'url',
    index: '0',
    parameters: [{ type: 'text', text: 'abc123' }],
  });
});

test('approval notification is blocked unless the customer opted in', async () => {
  let requestCount = 0;
  const notifyApproval = createBookingApprovalNotifier({
    WHATSAPP_ACCESS_TOKEN: 'test-access-token',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_APPROVAL_TEMPLATE_NAME: 'booking_approved',
    PUBLIC_SITE_URL: 'https://teo.example.test',
  }, async () => {
    requestCount += 1;
    return { ok: true, status: 200 };
  });
  const result = await notifyApproval({
    full_name: 'Ada Customer',
    reference: 'TD-1001',
    phone: '+234 801 234 5678',
    payment_url: 'https://checkout.paystack.com/abc123',
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /not opted in/i);
  assert.equal(requestCount, 0);
});

test('approval notifications explicitly report missing configuration', async () => {
  const notifyApproval = createBookingApprovalNotifier({});
  const result = await notifyApproval({
    full_name: 'Ada Customer',
    reference: 'TD-1001',
    phone: '+234 801 234 5678',
  });
  assert.equal(result.status, 'not_configured');
  assert.ok(result.missing.includes('WHATSAPP_APPROVAL_TEMPLATE_NAME'));
});

test('booking message sender delivers custom WhatsApp messages to opted-in customers', async () => {
  let requestBody;
  const sendMessage = createBookingMessageSender({
    WHATSAPP_ACCESS_TOKEN: 'test-access-token',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
  }, async (url, options) => {
    assert.equal(url, 'https://graph.facebook.com/v23.0/123456789/messages');
    requestBody = JSON.parse(options.body);
    return { ok: true, status: 200 };
  });
  const result = await sendMessage({
    full_name: 'Ada Customer',
    reference: 'TD-1001',
    phone: '+234 801 234 5678',
    whatsapp_opt_in: true,
  }, { type: 'CUSTOM', message: 'Your appointment is ready.' });
  assert.deepEqual(result, { status: 'sent' });
  assert.equal(requestBody.to, '2348012345678');
  assert.equal(requestBody.type, 'text');
  assert.equal(requestBody.text.body, 'Your appointment is ready.');
});

test('payment verified WhatsApp message uses its approved template and amount', async () => {
  let requestBody;
  const sendMessage = createBookingMessageSender({
    WHATSAPP_ACCESS_TOKEN: 'test-access-token',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_PAYMENT_VERIFIED_TEMPLATE_NAME: 'payment_verified',
  }, async (url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, status: 200 };
  });
  const result = await sendMessage({
    full_name: 'Ada Customer',
    reference: 'TD-1001',
    phone: '08012345678',
    whatsapp_opt_in: true,
    amount_received: '80000',
  }, { type: 'PAYMENT_VERIFIED', message: '' });
  assert.deepEqual(result, { status: 'sent' });
  assert.equal(requestBody.template.name, 'payment_verified');
  assert.deepEqual(
    requestBody.template.components[0].parameters.map(({ text }) => text),
    ['Ada Customer', 'TD-1001', 'NGN 80,000'],
  );
});

test('unconfigured notification channels are reported rather than silently treated as sent', async () => {
  const readiness = getNotificationReadiness({});
  const sendNotifications = createNotificationSender({}, async () => {
    throw new Error('Unconfigured WhatsApp transport was called.');
  }, () => {
    throw new Error('Unconfigured SMTP transport was called.');
  });

  assert.equal(readiness.email.configured, false);
  assert.equal(readiness.whatsapp.configured, false);
  assert.deepEqual(
    await sendNotifications({ id: 'request-reference', type: 'enquiry', data: {}, attachmentCount: 0 }),
    { email: 'not_configured', whatsapp: 'not_configured' },
  );
});

test('failed notification provider does not claim delivery', async () => {
  let logged = '';
  const originalError = console.error;
  console.error = (message) => { logged = message; };
  try {
    const sendNotifications = createNotificationSender(
      notificationEnvironment,
      async () => ({ ok: false, status: 503 }),
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

    assert.deepEqual(result, { email: 'failed', whatsapp: 'failed' });
    assert.match(logged, /notification delivery failed/);
  } finally {
    console.error = originalError;
  }
});
