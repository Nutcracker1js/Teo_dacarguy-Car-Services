const nodemailer = require('nodemailer');

const NOT_CONFIGURED = 'not_configured';

function getNotificationReadiness(environment = process.env) {
  const emailMissing = [
    ['SMTP_HOST', environment.SMTP_HOST],
    ['SMTP_USER', environment.SMTP_USER],
    ['SMTP_PASSWORD', environment.SMTP_PASSWORD],
    ['NOTIFICATION_EMAIL', environment.NOTIFICATION_EMAIL],
  ].filter(([, value]) => !value).map(([key]) => key);
  const smtpPort = Number(environment.SMTP_PORT || 587);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    emailMissing.push('SMTP_PORT');
  }
  return { email: { configured: emailMissing.length === 0, missing: emailMissing } };
}

function createNotificationSender(
  environment = process.env,
  transportFactory = nodemailer.createTransport,
) {
  const readiness = getNotificationReadiness(environment);
  const transport = readiness.email.configured
    ? transportFactory({
      host: environment.SMTP_HOST,
      port: Number(environment.SMTP_PORT || 587),
      secure: environment.SMTP_SECURE === 'true',
      requireTLS: environment.SMTP_SECURE !== 'true',
      localAddress: '0.0.0.0',
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
    const email = await sendEmail(transport, environment, readiness.email, submission);
    return { email };
  };
}

function createCustomerEmailSender(environment = process.env, transportFactory = nodemailer.createTransport) {
  const smtpPort = Number(environment.SMTP_PORT || 587);
  const missing = [
    ['SMTP_HOST', environment.SMTP_HOST],
    ['SMTP_USER', environment.SMTP_USER],
    ['SMTP_PASSWORD', environment.SMTP_PASSWORD],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) missing.push('SMTP_PORT');
  if (!environment.SMTP_FROM && !environment.SMTP_USER) missing.push('SMTP_FROM');
  const transport = missing.length ? null : transportFactory({
    host: environment.SMTP_HOST,
    port: smtpPort,
    secure: environment.SMTP_SECURE === 'true',
    requireTLS: environment.SMTP_SECURE !== 'true',
    localAddress: '0.0.0.0',
    auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });

  const sendCustomerEmail = async function sendCustomerEmail(notification) {
    if (!transport) throw new Error(`Customer email is not configured; missing: ${missing.join(', ')}.`);
    const { subject, text, html } = renderCustomerEmail(notification);
    await transport.sendMail({
      from: environment.SMTP_FROM || environment.SMTP_USER,
      to: notification.to,
      subject,
      text,
      html,
    });
  };
  sendCustomerEmail.readiness = { configured: missing.length === 0, missing };
  return sendCustomerEmail;
}

function renderCustomerEmail(notification) {
  const name = String(notification.customerName || 'Customer').slice(0, 120);
  const reference = String(notification.reference || '').slice(0, 24);
  const service = String(notification.service || 'Automotive service').slice(0, 120);
  const appointment = [notification.preferredDate, notification.preferredTime].filter(Boolean).join(' at ')
    || 'To be arranged';
  const amount = formatMoney(notification.amountExpected);
  const received = formatMoney(notification.amountReceived);
  const headings = {
    BOOKING_RECEIVED: ['We received your booking request', 'Your request is with Teo for review. Your appointment is not yet confirmed.'],
    BOOKING_ACCEPTED: ['Your booking request has been accepted', 'The booking is accepted for payment. Your appointment is not confirmed until payment is verified and Teo sends final approval.'],
    BOOKING_QUOTE_REQUIRED: ['Your booking request has been reviewed', 'Teo needs to confirm the service quotation before payment can be arranged. Your appointment is not yet confirmed.'],
    BOOKING_DECLINED: ['An update about your booking', 'Teo is unable to accept this booking as requested.'],
    RESCHEDULE_PROPOSED: ['A new appointment time is proposed', 'Please review the proposed time and confirm or decline it using the secure response link below.'],
    RESCHEDULE_CONFIRMED: ['Your new appointment date is confirmed', 'Teo has confirmed the date you accepted. Use the secure payment link below if payment is still due.'],
    RESCHEDULE_ACCEPTED: ['Your response was recorded', 'You accepted the proposed date. It is not final until Teo confirms it and sends you a separate email.'],
    RESCHEDULE_ACCEPTED_ADMIN: ['Customer accepted a proposed appointment date', 'The customer accepted the proposal below. Confirm the new date in the admin dashboard to finalize it.'],
    BOOKING_RESCHEDULED: ['Your appointment details have been updated', 'Your response to the proposed time has been recorded. Check the details below and wait for any further approval instructions.'],
    RESCHEDULE_PROPOSAL_DECLINED: ['Your reschedule response was received', 'The proposed appointment time was declined. Your original appointment request remains unchanged.'],
    RESCHEDULE_PROPOSAL_EXPIRED: ['Your appointment proposal expired', 'The response period for the proposed appointment has ended. Contact Teo to arrange another time.'],
    PAYMENT_SUCCESSFUL: ['Your payment has been verified', 'Paystack has verified your payment. The appointment remains subject to final approval.'],
    APPOINTMENT_CONFIRMED: ['Your appointment is confirmed', 'Teo has confirmed your appointment.'],
    JOB_COMPLETED: ['Thank you for choosing Teo DaCarguy', 'Your service has been marked complete. Thank you for trusting Teo DaCarguy Car Services with your vehicle.'],
    BOOKING_CANCELLED: ['Your booking has been updated', 'Your booking has been cancelled or rescheduled. Review the details below and contact us if you need help.'],
    BOOKING_EXPIRED: ['Your booking request has expired', 'The request or payment period ended before the booking was completed. Please contact Teo if you would like to make a new request.'],
    BOOKING_SLIP_AVAILABLE: ['Your booking slip is ready', 'Your secure booking slip is available using the link below.'],
  };
  const [title, defaultIntro] = headings[notification.eventType] || ['Booking update', 'There is an update about your booking.'];
  const intro = notification.eventType === 'RESCHEDULE_CONFIRMED'
    && !notification.paymentPageUrl && !notification.checkoutUrl
    && notification.paymentStatus !== 'PAID'
    ? 'Teo confirmed the proposed date. The booking still needs its final price or payment instructions; Teo will email you when they are ready.'
    : defaultIntro;
  const rows = [
    ['Booking reference', reference],
    ['Service', service],
    ['Appointment', appointment],
  ];
  if (notification.vehicle) rows.push(['Vehicle', String(notification.vehicle).slice(0, 160)]);
  if (notification.registration) rows.push(['Registration', String(notification.registration).slice(0, 32)]);
  if (notification.location) rows.push(['Location', String(notification.location).slice(0, 240)]);
  if (notification.amountExpected !== null && notification.amountExpected !== undefined) rows.push(['Agreed price', amount]);
  if (notification.eventType === 'PAYMENT_SUCCESSFUL') {
    rows.push(['Amount paid', received]);
    rows.push(['Transaction reference', String(notification.transactionReference || 'Verified by Paystack').slice(0, 160)]);
  }
  if (notification.paymentDeadline) rows.push(['Payment deadline', String(notification.paymentDeadline)]);
  const proposed = [notification.proposedDate, notification.proposedTime].filter(Boolean).join(' at ');
  if (proposed) rows.push(['Proposed appointment', proposed]);
  const lines = rows.map(([label, value]) => `${label}: ${value}`);
  if (notification.paymentPageUrl) lines.push(`Open the secure payment page: ${notification.paymentPageUrl}`);
  if (notification.bookingStatusUrl) lines.push(`View your booking and receipt details: ${notification.bookingStatusUrl}`);
  if (notification.refundStatus && notification.refundStatus !== 'NONE') {
    lines.push(`Refund update: ${statusText(notification.refundStatus)}.`);
  }
  if (notification.resolution) lines.push(`Booking resolution: ${statusText(notification.resolution)}.`);
  if (notification.paymentStatus) lines.push(`Payment status: ${statusText(notification.paymentStatus)}.`);
  if (notification.declineReason) lines.push(`Message from Teo: ${String(notification.declineReason).slice(0, 1000)}`);
  if (notification.instructions) lines.push(`Instructions: ${String(notification.instructions).slice(0, 2000)}`);
  if (notification.checkoutUrl) lines.push(`Secure Paystack checkout: ${notification.checkoutUrl}`);
  if (notification.paymentNotice) lines.push(`Payment update: ${String(notification.paymentNotice).slice(0, 500)}`);
  if (notification.responseUrl) lines.push(`Respond to the proposed time: ${notification.responseUrl}`);
  if (notification.slipUrl) lines.push(`Download your secure booking slip: ${notification.slipUrl}`);
  if (!['APPOINTMENT_CONFIRMED', 'RESCHEDULE_CONFIRMED', 'JOB_COMPLETED'].includes(notification.eventType)) {
    lines.push('', 'Payment alone does not confirm an appointment. You will receive a separate email when Teo confirms the appointment.');
  }
  const escaped = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const list = rows.map(([label, value]) => (
    `<tr><th align="left" style="padding:8px 12px 8px 0">${escaped(label)}</th><td style="padding:8px 0">${escaped(value)}</td></tr>`
  )).join('');
  const links = [
    notification.checkoutUrl && `<p><a href="${escaped(notification.checkoutUrl)}">Continue to secure Paystack checkout</a></p>`,
    notification.paymentPageUrl && `<p><a href="${escaped(notification.paymentPageUrl)}">Open the secure payment page</a></p>`,
    notification.bookingStatusUrl && `<p><a href="${escaped(notification.bookingStatusUrl)}">View your booking and receipt details</a></p>`,
    notification.responseUrl && `<p><a href="${escaped(notification.responseUrl)}">Respond to the proposed appointment</a></p>`,
    notification.slipUrl && `<p><a href="${escaped(notification.slipUrl)}">Download your booking slip</a></p>`,
  ].filter(Boolean).join('');
  const extra = [
    notification.declineReason && `<p>${escaped(notification.declineReason)}</p>`,
    notification.instructions && `<p><strong>Instructions:</strong> ${escaped(notification.instructions)}</p>`,
    notification.paymentNotice && `<p>${escaped(notification.paymentNotice)}</p>`,
  ].filter(Boolean).join('');
  return {
    subject: `${title} · ${reference}`,
    text: [`Hello ${name},`, '', intro, '', ...lines, '', 'Teo DaCarguy Car Services'].join('\n'),
    html: `<!doctype html><html><body style="margin:0;background:#f4f4f4;font-family:Arial,sans-serif;color:#171717"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 8px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-top:5px solid #c62026;padding:28px"><tr><td><p style="font-weight:bold;letter-spacing:1px">TEO DACARGUY CAR SERVICES</p><h1 style="font-size:24px">${escaped(title)}</h1><p>Hello ${escaped(name)}, ${escaped(intro)}</p><table role="presentation" cellspacing="0" cellpadding="0">${list}</table>${extra}${links}${['APPOINTMENT_CONFIRMED', 'RESCHEDULE_CONFIRMED', 'JOB_COMPLETED'].includes(notification.eventType) ? '' : '<p style="margin-top:28px;font-size:13px;color:#555">Payment alone does not confirm an appointment. You will receive a separate email when Teo confirms the appointment.</p>'}</td></tr></table></td></tr></table></body></html>`,
  };
}

function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `NGN ${amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
    : 'To be confirmed';
}

function statusText(value) {
  return String(value || '').toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  createCustomerEmailSender,
  createNotificationSender,
  getNotificationReadiness,
  renderCustomerEmail,
};
