const NOT_CONFIGURED = 'not_configured';
const RESEND_API_URL = 'https://api.resend.com/emails';
const MAX_PROVIDER_ATTEMPTS = 3;

function getNotificationReadiness(environment = process.env, { requireRecipient = true } = {}) {
  const missing = [
    ['RESEND_API_KEY', environment.RESEND_API_KEY],
    ['RESEND_FROM', environment.RESEND_FROM],
    ...(requireRecipient ? [['NOTIFICATION_EMAIL', environment.NOTIFICATION_EMAIL]] : []),
  ].filter(([, value]) => !value).map(([key]) => key);
  return { email: { configured: missing.length === 0, missing } };
}

function createNotificationSender(
  environment = process.env,
  { fetch: fetchImplementation = globalThis.fetch, sleep = delay } = {},
) {
  const readiness = getNotificationReadiness(environment);
  return async function sendNotifications(submission) {
    const email = await sendEmail(environment, readiness.email, submission, fetchImplementation, sleep);
    return { email };
  };
}

function createCustomerEmailSender(
  environment = process.env,
  { fetch: fetchImplementation = globalThis.fetch, sleep = delay } = {},
) {
  const readiness = getNotificationReadiness(environment, { requireRecipient: false }).email;
  const sendCustomerEmail = async function sendCustomerEmail(notification) {
    if (!readiness.configured) {
      throw new Error(`Customer email is not configured; missing: ${readiness.missing.join(', ')}.`);
    }
    const { subject, text, html } = renderCustomerEmail(notification);
    await sendResendEmail({
      apiKey: environment.RESEND_API_KEY,
      from: environment.RESEND_FROM,
      to: notification.to,
      subject,
      text,
      html,
      idempotencyKey: notification.id && `customer-notification-${notification.id}`,
      fetchImplementation,
      sleep,
    });
  };
  sendCustomerEmail.readiness = readiness;
  return sendCustomerEmail;
}

async function sendResendEmail({
  apiKey,
  from,
  to,
  subject,
  text,
  html,
  idempotencyKey,
  fetchImplementation,
  sleep,
}) {
  if (typeof fetchImplementation !== 'function') throw new Error('HTTPS email transport is unavailable in this Node.js runtime.');
  let lastError;
  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImplementation(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify({ from, to, subject, text, ...(html ? { html } : {}) }),
      });
      if (response.ok) return;

      const details = await readProviderError(response);
      const error = new Error(`Resend API returned HTTP ${response.status}${details.message ? `: ${details.message}` : '.'}`);
      error.statusCode = response.status;
      error.requestId = response.headers?.get('x-resend-id') || details.requestId || null;
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
    } catch (error) {
      if (error.statusCode && error.statusCode !== 429 && error.statusCode < 500) throw error;
      lastError = error;
    }

    if (attempt < MAX_PROVIDER_ATTEMPTS) await sleep(250 * (2 ** (attempt - 1)));
  }
  const error = new Error(`Resend API request failed after ${MAX_PROVIDER_ATTEMPTS} attempts: ${sanitizeProviderMessage(lastError?.message)}`);
  error.statusCode = lastError?.statusCode;
  error.requestId = lastError?.requestId || null;
  throw error;
}

async function readProviderError(response) {
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  return {
    message: sanitizeProviderMessage(data?.message || data?.error || raw),
    requestId: data?.id || data?.request_id || null,
  };
}

function sanitizeProviderMessage(message) {
  return String(message || '').slice(0, 300)
    .replace(/re_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/(?:password|token|secret|authorization|bearer)\s*[:=]?\s*[^\s,;]+/gi, '[redacted]');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    notification.slipUrl && `<p><a href="${escaped(notification.slipUrl)}">Download your secure booking slip</a></p>`,
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

async function sendEmail(environment, readiness, submission, fetchImplementation, sleep) {
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
    await sendResendEmail({
      apiKey: environment.RESEND_API_KEY,
      from: environment.RESEND_FROM,
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
      idempotencyKey: `submission-${submission.id}`,
      fetchImplementation,
      sleep,
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
    providerStatus: error.statusCode || null,
    providerRequestId: error.requestId || null,
    error: sanitizeProviderMessage(error.message),
  }));
}

module.exports = {
  createCustomerEmailSender,
  createNotificationSender,
  getNotificationReadiness,
  renderCustomerEmail,
};
