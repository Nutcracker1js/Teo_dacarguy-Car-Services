const nodemailer = require('nodemailer');

const NOT_CONFIGURED = 'not_configured';

function getNotificationReadiness(environment = process.env) {
  const emailMissing = [
    ['SMTP_HOST', environment.SMTP_HOST],
    ['SMTP_USER', environment.SMTP_USER],
    ['SMTP_PASSWORD', environment.SMTP_PASSWORD],
    ['NOTIFICATION_EMAIL', environment.NOTIFICATION_EMAIL],
  ].filter(([, value]) => !value).map(([key]) => key);
  const smtpPort = Number(environment.SMTP_PORT);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    emailMissing.push('SMTP_PORT');
  }
  const whatsappMissing = [
    ['WHATSAPP_ACCESS_TOKEN', environment.WHATSAPP_ACCESS_TOKEN],
    ['WHATSAPP_PHONE_NUMBER_ID', environment.WHATSAPP_PHONE_NUMBER_ID],
    ['WHATSAPP_RECIPIENT', environment.WHATSAPP_RECIPIENT],
    ['WHATSAPP_TEMPLATE_NAME', environment.WHATSAPP_TEMPLATE_NAME],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (environment.WHATSAPP_RECIPIENT && !/^\+?[1-9]\d{7,14}$/.test(environment.WHATSAPP_RECIPIENT)) {
    whatsappMissing.push('WHATSAPP_RECIPIENT (use international format)');
  }

  return {
    email: { configured: emailMissing.length === 0, missing: emailMissing },
    whatsapp: { configured: whatsappMissing.length === 0, missing: whatsappMissing },
  };
}

function createNotificationSender(
  environment = process.env,
  fetchImplementation = fetch,
  transportFactory = nodemailer.createTransport,
) {
  const readiness = getNotificationReadiness(environment);
  const transport = readiness.email.configured
    ? transportFactory({
      host: environment.SMTP_HOST,
      port: Number(environment.SMTP_PORT),
      secure: environment.SMTP_SECURE === 'true',
      requireTLS: environment.SMTP_SECURE !== 'true',
      auth: {
        user: environment.SMTP_USER,
        pass: environment.SMTP_PASSWORD,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    })
    : null;

  return async function sendNotifications(submission) {
    const [email, whatsapp] = await Promise.all([
      sendEmail(transport, environment, readiness.email, submission),
      sendWhatsApp(fetchImplementation, environment, readiness.whatsapp, submission),
    ]);
    return { email, whatsapp };
  };
}

function createBookingApprovalNotifier(environment = process.env, fetchImplementation = fetch) {
  const required = [
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_APPROVAL_TEMPLATE_NAME',
    'PUBLIC_SITE_URL',
  ];
  const missing = required.filter((key) => !environment[key]);
  try {
    const publicUrl = new URL(environment.PUBLIC_SITE_URL);
    if (publicUrl.protocol !== 'https:' && publicUrl.hostname !== 'localhost' && publicUrl.hostname !== '127.0.0.1') {
      missing.push('PUBLIC_SITE_URL (must use HTTPS)');
    }
  } catch {
    if (environment.PUBLIC_SITE_URL) missing.push('PUBLIC_SITE_URL (must be an absolute URL)');
  }
  if (environment.WHATSAPP_ACCESS_TOKEN && environment.WHATSAPP_PHONE_NUMBER_ID
    && environment.WHATSAPP_APPROVAL_TEMPLATE_NAME
    && !environment.WHATSAPP_PHONE_NUMBER_ID.match(/^\d+$/)) {
    missing.push('WHATSAPP_PHONE_NUMBER_ID (must contain digits only)');
  }

  const notifyBookingApproval = async function notifyBookingApproval(booking) {
    if (missing.length) {
      return { status: 'not_configured', missing };
    }
    if (booking.whatsapp_opt_in !== true) {
      return { status: 'failed', error: 'The customer has not opted in to WhatsApp booking updates.' };
    }
    let checkoutSuffix;
    try {
      const checkoutUrl = new URL(booking.payment_url);
      if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.paystack.com'
        || !checkoutUrl.pathname.startsWith('/') || checkoutUrl.pathname.length < 2) {
        throw new Error('not a Paystack checkout URL');
      }
      checkoutSuffix = `${checkoutUrl.pathname.slice(1)}${checkoutUrl.search}${checkoutUrl.hash}`;
    } catch {
      return { status: 'failed', error: 'A valid Paystack checkout link is required before sending the acceptance message.' };
    }
    let customerNumber = String(booking.whatsapp || booking.phone || '').replace(/\D/g, '');
    if (/^0\d{10}$/.test(customerNumber)) customerNumber = `234${customerNumber.slice(1)}`;
    if (!/^[1-9]\d{7,14}$/.test(customerNumber)) {
      return { status: 'failed', error: 'Customer phone number is not in a valid international format.' };
    }
    const statusUrl = new URL('/booking-status.html', environment.PUBLIC_SITE_URL);
    statusUrl.searchParams.set('reference', booking.reference);
    const appointment = `${booking.service} · ${booking.preferred_date}${booking.preferred_time ? ` at ${booking.preferred_time}` : ''}. View acceptance and proceed to payment using the link below.`;
    try {
      const response = await fetchImplementation(
        `https://graph.facebook.com/${environment.WHATSAPP_GRAPH_VERSION || 'v23.0'}/${environment.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${environment.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: customerNumber,
            type: 'template',
            template: {
              name: environment.WHATSAPP_APPROVAL_TEMPLATE_NAME,
              language: { code: environment.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US' },
              components: [{
                type: 'body',
                parameters: [
                  { type: 'text', text: booking.full_name.slice(0, 120) },
                  { type: 'text', text: booking.reference.slice(0, 24) },
                  { type: 'text', text: appointment.slice(0, 200) },
                  { type: 'text', text: statusUrl.toString().slice(0, 1000) },
                ],
              }, {
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [{ type: 'text', text: checkoutSuffix.slice(0, 512) }],
              }],
            },
          }),
        },
      );
      if (!response.ok) throw new Error(`WhatsApp provider returned HTTP ${response.status}.`);
      return { status: 'sent' };
    } catch (error) {
      reportDeliveryFailure('booking_approval_whatsapp', booking.reference, error);
      return { status: 'failed', error: error.message };
    }
  };
  notifyBookingApproval.readiness = { configured: missing.length === 0, missing };
  return notifyBookingApproval;
}

function createBookingMessageSender(environment = process.env, fetchImplementation = fetch) {
  return async function sendBookingMessage(booking, { type, message }) {
    if (!environment.WHATSAPP_ACCESS_TOKEN || !environment.WHATSAPP_PHONE_NUMBER_ID) {
      return {
        status: 'not_configured',
        missing: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'].filter((key) => !environment[key]),
      };
    }
    if (booking.whatsapp_opt_in !== true) {
      return { status: 'failed', error: 'The customer has not opted in to WhatsApp booking updates.' };
    }
    const recipient = String(booking.whatsapp || booking.phone || '').replace(/\D/g, '')
      .replace(/^0(\d{10})$/, '234$1');
    if (!/^[1-9]\d{7,14}$/.test(recipient)) {
      return { status: 'failed', error: 'Customer phone number is not in a valid international format.' };
    }

    let payload;
    if (type === 'PAYMENT_VERIFIED') {
      const templateName = environment.WHATSAPP_PAYMENT_VERIFIED_TEMPLATE_NAME;
      if (!templateName) {
        return { status: 'not_configured', missing: ['WHATSAPP_PAYMENT_VERIFIED_TEMPLATE_NAME'] };
      }
      payload = {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: templateName,
          language: { code: environment.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US' },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: booking.full_name.slice(0, 120) },
              { type: 'text', text: booking.reference.slice(0, 24) },
              { type: 'text', text: moneyText(booking.amount_received || booking.amount_expected) },
            ],
          }],
        },
      };
    } else if (type === 'CUSTOM') {
      payload = {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { preview_url: true, body: message },
      };
    } else {
      return { status: 'failed', error: 'Choose a supported customer message.' };
    }

    try {
      const response = await fetchImplementation(
        `https://graph.facebook.com/${environment.WHATSAPP_GRAPH_VERSION || 'v23.0'}/${environment.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `******`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        let details = '';
        try {
          const result = await response.json();
          details = typeof result.error?.message === 'string' ? ` ${result.error.message}` : '';
        } catch {
          details = '';
        }
        throw new Error(`WhatsApp provider returned HTTP ${response.status}.${details}`);
      }
      return { status: 'sent' };
    } catch (error) {
      reportDeliveryFailure(`booking_${type.toLowerCase()}_whatsapp`, booking.reference, error);
      return { status: 'failed', error: error.message };
    }
  };
}

function moneyText(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `NGN ${amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
    : 'the confirmed amount';
}

async function sendEmail(transport, environment, readiness, submission) {
  if (!readiness.configured) return NOT_CONFIGURED;
  try {
    const isBooking = submission.type === 'booking';
    const summary = isBooking
      ? [
        `Service: ${submission.data.service}${submission.data.serviceOther ? ` - ${submission.data.serviceOther}` : ''}`,
        `Preferred date: ${submission.data.preferredDate}`,
        `Preferred time: ${submission.data.preferredTime || 'Not specified'}`,
        `Location: ${submission.data.location}${submission.data.locationOther ? ` - ${submission.data.locationOther}` : ''}`,
      ].join('\n')
      : `Enquiry type: ${submission.data.enquiryType}\nMessage: ${submission.data.description}`;
    await transport.sendMail({
      from: environment.SMTP_FROM || environment.SMTP_USER,
      to: environment.NOTIFICATION_EMAIL,
      subject: `New ${isBooking ? 'booking request' : 'enquiry'} · ${submission.id}`,
      text: [
        `Reference: ${submission.id}`,
        `Customer: ${submission.data.fullName}`,
        `Phone: ${submission.data.phone}`,
        `WhatsApp: ${submission.data.whatsapp || 'Not provided'}`,
        summary,
        `Attachments: ${submission.attachmentCount}`,
        'Review this request using your private business workflow.',
      ].join('\n'),
    });
    return 'sent';
  } catch (error) {
    reportDeliveryFailure('email', submission.id, error);
    return 'failed';
  }
}

async function sendWhatsApp(fetchImplementation, environment, readiness, submission) {
  if (!readiness.configured) return NOT_CONFIGURED;
  try {
    const isBooking = submission.type === 'booking';
    const summary = isBooking
      ? `${submission.data.service} · ${submission.data.preferredDate}`
      : submission.data.enquiryType;
    const response = await fetchImplementation(
      `https://graph.facebook.com/${environment.WHATSAPP_GRAPH_VERSION || 'v23.0'}/${environment.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${environment.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: environment.WHATSAPP_RECIPIENT.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: environment.WHATSAPP_TEMPLATE_NAME,
            language: { code: environment.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US' },
            components: [{
              type: 'body',
              parameters: [
                { type: 'text', text: isBooking ? 'booking request' : 'enquiry' },
                { type: 'text', text: submission.data.fullName.slice(0, 120) },
                { type: 'text', text: submission.data.phone.slice(0, 32) },
                { type: 'text', text: submission.id },
                { type: 'text', text: summary.slice(0, 200) },
              ],
            }],
          },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`WhatsApp provider returned HTTP ${response.status}.`);
    }
    return 'sent';
  } catch (error) {
    reportDeliveryFailure('whatsapp', submission.id, error);
    return 'failed';
  }
}

function reportDeliveryFailure(channel, reference, error) {
  console.error(JSON.stringify({
    level: 'error',
    message: 'Submission notification delivery failed.',
    channel,
    reference,
    error: error.message,
  }));
}

module.exports = {
  createBookingApprovalNotifier,
  createBookingMessageSender,
  createNotificationSender,
  getNotificationReadiness,
};
