const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { validEmail } = require('./payments');
const { getFixedServicePrice } = require('./pricing');
const { canIssueBookingSlip, createBookingSlip } = require('./booking-slip');
const { reserveBookingSlot } = require('./availability');

const STATUSES = new Set([
  'NEW',
  'PENDING_REVIEW',
  'CONTACTED',
  'EXPIRED',
  'CONFIRMED',
  'AWAITING_PAYMENT',
  'AWAITING_APPROVAL',
  'APPROVED',
  'DECLINED',
  'COMPLETED',
  'CANCELLED',
  'CLOSED',
  'RESCHEDULE_PROPOSED',
]);
const PAYMENT_STATUSES = new Set([
  'UNPAID',
  'AWAITING_PAYMENT',
  'PARTIAL',
  'PAID',
  'FAILED',
  'EXPIRED',
  'REFUND_PENDING',
  'REFUNDED',
]);
const PAYMENT_VERIFICATIONS = new Set(['UNVERIFIED', 'VERIFIED', 'FAILED']);
const REFUND_STATUSES = new Set(['NONE', 'INITIATED', 'COMPLETED']);
const RESOLUTIONS = new Set(['RESCHEDULE', 'INITIATE_REFUND']);
const SUBMISSION_TYPES = new Set(['all', 'booking', 'enquiry']);

async function ensureApprovalCheckout(pool, booking, publicSiteUrl) {
  if (booking.payment_status === 'PAID') {
    return { status: 'failed', error: 'Payment is already recorded; no payment link was sent.' };
  }
  const fixedPrice = getFixedServicePrice(booking.service, booking.service_option, booking.location);
  const amountExpected = fixedPrice ?? Number(booking.amount_expected);
  if (!Number.isFinite(amountExpected) || amountExpected <= 0) {
    return { status: 'failed', error: 'Save the confirmed payment amount before sending the acceptance message.' };
  }
  const storedAmount = Number(booking.amount_expected);
  booking.amount_expected = amountExpected;
  if (!validEmail(booking.email)) {
    return { status: 'failed', error: 'Add a valid customer email to the booking before sending its payment link.' };
  }
  const awaitingPayment = booking.payment_status === 'AWAITING_PAYMENT';
  if (awaitingPayment && storedAmount !== amountExpected) {
    return { status: 'failed', error: 'The booking price cannot be changed while a payment session is active. Check its payment status first.' };
  }
  if (awaitingPayment && isPaystackCheckoutUrl(booking.payment_checkout_url)) {
    return { status: 'ready', authorizationUrl: booking.payment_checkout_url };
  }
  if (awaitingPayment && !booking.payment_reference) {
    return { status: 'failed', error: 'The current payment session needs to be checked before sending payment instructions.' };
  }
  const paymentPageUrl = createCustomerPaymentUrl(publicSiteUrl, booking.reference);
  if (!paymentPageUrl) return { status: 'failed', error: 'Set a valid HTTPS PUBLIC_SITE_URL before sending payment instructions.' };
  if (!awaitingPayment) {
    const saved = await pool.query(
      `UPDATE bookings SET amount_expected = $1
     WHERE id = $2 AND status IN ('APPROVED', 'CONFIRMED') AND payment_status <> 'PAID'
       RETURNING id`,
      [amountExpected, booking.id],
    );
    if (!saved.rowCount) {
      return { status: 'failed', error: 'Booking changed while preparing payment instructions. Check the booking and try again.' };
    }
  }
  return { status: 'ready', paymentPageUrl };
}

function isPaystackCheckoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.paystack.com' && url.pathname.length > 1;
  } catch {
    return false;
  }
}

function createCustomerPaymentUrl(publicSiteUrl, reference) {
  try {
    const base = new URL(publicSiteUrl);
    if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) return null;
    const url = new URL('/payment.html', base);
    url.searchParams.set('reference', reference);
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeStatusValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[-\s]+/g, '_').toUpperCase();
  return STATUSES.has(normalized) ? normalized : null;
}
const TABLE_BY_TYPE = { booking: 'bookings', enquiry: 'enquiries' };
const ATTACHMENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']);
const PRIVATE_FILE_PATTERN = /^[0-9a-f-]{36}\.(?:jpg|png|webp|mp4|mov)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_DOCUMENTS = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const PAYMENT_DOCUMENT_KEY_PATTERN = /^[0-9a-f-]{36}\.(?:pdf|jpg|png|webp)$/;
const paymentDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
}).single('document');

function createAdminRouter({
  pool,
  username,
  password,
  privateDirectory,
  bookingNotifications = null,
  paymentExpiryHours = 24,
  publicSiteUrl = '',
  notificationEmail = process.env.NOTIFICATION_EMAIL || '',
}) {
  const router = express.Router();
  const authenticate = createAdminAuth(username, password);
  const adminLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many admin requests. Please try again later.' },
  });
  router.use(adminLimit);
  router.use((request, response, next) => {
    response.set({
      'Cache-Control': 'private, no-store',
      Pragma: 'no-cache',
    });
    next();
  });

  router.get('/dashboard', authenticate, asyncHandler(async (request, response) => {
    const result = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status IN ('NEW', 'PENDING_REVIEW'))::int AS awaiting_review,
        COUNT(*) FILTER (WHERE status = 'AWAITING_PAYMENT')::int AS awaiting_payment,
        COUNT(*) FILTER (WHERE status = 'AWAITING_APPROVAL')::int AS awaiting_approval,
        COUNT(*) FILTER (WHERE status = 'APPROVED' AND preferred_date >= CURRENT_DATE)::int AS upcoming,
        COUNT(*) FILTER (WHERE status = 'APPROVED' AND preferred_date = CURRENT_DATE)::int AS upcoming_today,
        COUNT(*) FILTER (WHERE payment_verification = 'VERIFIED')::int AS payments_verified
       FROM bookings`,
    );
    response.json({ summary: result.rows[0] });
  }));

  router.get('/bookings', authenticate, asyncHandler(async (request, response) => {
    const status = request.query.status || 'ALL';
    const paymentStatus = request.query.paymentStatus || 'ALL';
    const service = request.query.service || 'ALL';
    const from = request.query.from || '';
    const to = request.query.to || '';
    const search = typeof request.query.search === 'string' ? request.query.search.trim().slice(0, 120) : '';
    const limit = Number(request.query.limit || 25);
    const offset = Number(request.query.offset || 0);
    if ((status !== 'ALL' && !normalizeStatusValue(status))
      || (paymentStatus !== 'ALL' && !PAYMENT_STATUSES.has(paymentStatus))
      || (service !== 'ALL' && !/^[A-Z_]{2,32}$/.test(service))
      || (from && !isDateValue(from)) || (to && !isDateValue(to))
      || (from && to && from > to)
      || !Number.isInteger(limit) || limit < 1 || limit > 100
      || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
      response.status(400).json({ error: 'Choose valid booking filters and pagination.' });
      return;
    }
    const result = await pool.query(
      `SELECT b.*,
        COUNT(*) OVER()::int AS total
       FROM bookings b
       WHERE ($1 = 'ALL' OR b.status = $1)
         AND ($2 = 'ALL' OR b.payment_status = $2)
         AND ($6 = 'ALL' OR b.service = $6)
         AND ($7 = '' OR b.preferred_date >= $7::date)
         AND ($8 = '' OR b.preferred_date <= $8::date)
         AND ($3 = '' OR b.full_name ILIKE '%' || $3 || '%'
           OR b.reference ILIKE '%' || $3 || '%'
           OR b.id::text ILIKE '%' || replace($3, 'TD-', '') || '%'
           OR LEFT(b.id::text, 8) ILIKE '%' || replace($3, 'TD-', '') || '%')
       ORDER BY b.preferred_date ASC, b.preferred_time ASC NULLS LAST, b.created_at DESC
       LIMIT $4 OFFSET $5`,
      [
        status === 'ALL' ? 'ALL' : normalizeStatusValue(status),
        paymentStatus,
        search,
        limit,
        offset,
        service,
        from,
        to,
      ],
    );
    response.json({ bookings: result.rows, total: result.rows[0]?.total || 0, limit, offset });
  }));

  router.get('/customers', authenticate, asyncHandler(async (request, response) => {
    const result = await pool.query(
      `SELECT latest.id AS latest_booking_id, latest.full_name, latest.phone,
        latest.whatsapp, latest.amount_received, latest.preferred_date AS last_appointment,
        counts.booking_count
       FROM (
         SELECT DISTINCT ON (phone) id, full_name, phone, whatsapp, amount_received, preferred_date, created_at
         FROM bookings ORDER BY phone, created_at DESC
       ) latest
       JOIN (
         SELECT phone, COUNT(*)::int AS booking_count FROM bookings GROUP BY phone
       ) counts USING (phone)
       ORDER BY latest.full_name`,
    );
    response.json({ customers: result.rows });
  }));

  router.get('/calendar', authenticate, asyncHandler(async (request, response) => {
    const { from, to } = request.query;
    if (!isDateValue(from) || !isDateValue(to) || from > to) {
      response.status(400).json({ error: 'Choose a valid calendar date range.' });
      return;
    }
    const [result, blocks] = await Promise.all([
      pool.query(
        `SELECT id, full_name, phone, vehicle_make, vehicle_model, service, service_other,
          preferred_date AS calendar_date, preferred_time AS calendar_time, status, payment_status,
          FALSE AS is_proposed, NULL::varchar AS proposed_response
         FROM bookings WHERE preferred_date BETWEEN $1 AND $2
           AND status = ANY($3::varchar[])
         UNION ALL
         SELECT id, full_name, phone, vehicle_make, vehicle_model, service, service_other,
          proposed_preferred_date AS calendar_date, proposed_preferred_time AS calendar_time,
          status, payment_status, TRUE AS is_proposed, proposed_response
         FROM bookings
         WHERE status = 'RESCHEDULE_PROPOSED'
           AND proposed_preferred_date BETWEEN $1 AND $2
         ORDER BY calendar_date, calendar_time NULLS LAST`,
        [from, to, ['NEW', 'PENDING_REVIEW', 'AWAITING_PAYMENT', 'AWAITING_APPROVAL', 'APPROVED', 'CONFIRMED', 'RESCHEDULE_PROPOSED']],
      ),
      pool.query(
        `SELECT id, blocked_date::text AS calendar_date, starts_at AS calendar_time, ends_at, reason
         FROM booking_availability_blocks WHERE blocked_date BETWEEN $1 AND $2
         ORDER BY blocked_date, starts_at NULLS FIRST`,
        [from, to],
      ),
    ]);
    response.json({ bookings: result.rows, blocks: blocks.rows });
  }));

  router.get('/bookings/:id', authenticate, asyncHandler(async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const [booking, paymentDocuments, notes, history, activity, notifications] = await Promise.all([
      pool.query(
        `SELECT b.*,
          COALESCE((
            SELECT json_agg(json_build_object(
              'id', a.id, 'originalName', a.original_name, 'mimeType', a.mime_type
            ) ORDER BY a.created_at)
            FROM submission_attachments a WHERE a.booking_id = b.id
          ), '[]'::json) AS attachments
         FROM bookings b WHERE b.id = $1`,
        [request.params.id],
      ),
      pool.query(
        `SELECT id, original_name AS "originalName", mime_type AS "mimeType", created_at
         FROM booking_payment_documents WHERE booking_id = $1 ORDER BY created_at DESC`,
        [request.params.id],
      ),
      pool.query(
        'SELECT id, note, created_at FROM booking_internal_notes WHERE booking_id = $1 ORDER BY created_at DESC',
        [request.params.id],
      ),
      pool.query(
        'SELECT id, previous_status, status, resolution, created_at FROM booking_status_history WHERE booking_id = $1 ORDER BY created_at DESC',
        [request.params.id],
      ),
      pool.query(
        `SELECT id, action, details, created_at FROM booking_activity_history
         WHERE booking_id = $1 ORDER BY created_at DESC`,
        [request.params.id],
      ),
      pool.query(
        `SELECT id, event_type, recipient, delivery_status, attempts, last_error, queued_at, sent_at
         FROM booking_notifications WHERE booking_id = $1 ORDER BY queued_at DESC`,
        [request.params.id],
      ),
    ]);
    if (!booking.rowCount) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const bookingDetails = booking.rows[0];
    bookingDetails.fixed_price = getFixedServicePrice(
      bookingDetails.service,
      bookingDetails.service_option,
      bookingDetails.location,
    );
    response.json({
      booking: bookingDetails,
      paymentDocuments: paymentDocuments.rows,
      notes: notes.rows,
      history: history.rows,
      activity: activity.rows,
      notifications: notifications.rows,
    });
  }));

  router.get('/bookings/:id/slip', authenticate, asyncHandler(async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'Booking slip not found.' });
      return;
    }
    const result = await pool.query(
      `SELECT reference, full_name, phone, email, service, service_other, vehicle_make, vehicle_model,
        vehicle_year, registration, preferred_date::text AS preferred_date,
        to_char(preferred_time, 'HH24:MI') AS preferred_time, location, location_other,
        appointment_instructions, status, payment_status, payment_verification,
        amount_expected, amount_received, payment_reference
       FROM bookings WHERE id = $1`,
      [request.params.id],
    );
    if (!result.rowCount || !canIssueBookingSlip(result.rows[0])) {
      response.status(409).json({ error: 'A booking slip is available only after final confirmation and any required payment verification.' });
      return;
    }
    const pdf = await createBookingSlip(result.rows[0]);
    response.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="booking-${result.rows[0].reference}.pdf"`,
    });
    response.send(pdf);
  }));

  router.post('/notifications/:id/retry', authenticate, asyncHandler(async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id) || !bookingNotifications) {
      response.status(404).json({ error: 'Notification not found.' });
      return;
    }
    const notification = await pool.query(
      `UPDATE booking_notifications n
       SET recipient = COALESCE(NULLIF(n.recipient, ''), NULLIF(b.email, ''))
       FROM bookings b
       WHERE n.id = $1 AND b.id = n.booking_id AND n.delivery_status = 'FAILED'
       RETURNING n.id`,
      [request.params.id],
    );
    if (!notification.rowCount) {
      response.status(404).json({ error: 'Failed notification not found.' });
      return;
    }
    const result = await bookingNotifications.deliver(request.params.id);
    response.status(result.status === 'sent' ? 200 : result.status === 'retry_window_expired' ? 409 : 502).json(result);
  }));

  router.delete('/bookings/:id', authenticate, asyncHandler(async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const [booking, attachments, paymentDocuments] = await Promise.all([
      pool.query('SELECT id FROM bookings WHERE id = $1', [request.params.id]),
      pool.query('SELECT storage_key FROM submission_attachments WHERE booking_id = $1', [request.params.id]),
      pool.query('SELECT storage_key FROM booking_payment_documents WHERE booking_id = $1', [request.params.id]),
    ]);
    if (!booking.rowCount) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const deleted = await pool.query(
      'DELETE FROM bookings WHERE id = $1 RETURNING id',
      [request.params.id],
    );
    if (!deleted.rowCount) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const storedFiles = [
      ...attachments.rows.map(({ storage_key: storageKey }) => ({
        storageKey,
        pattern: PRIVATE_FILE_PATTERN,
      })),
      ...paymentDocuments.rows.map(({ storage_key: storageKey }) => ({
        storageKey,
        pattern: PAYMENT_DOCUMENT_KEY_PATTERN,
      })),
    ];
    const failedFiles = [];
    await Promise.all(storedFiles.map(async ({ storageKey, pattern }) => {
      if (!pattern.test(storageKey)) {
        failedFiles.push('invalid stored file key');
        return;
      }
      try {
        await fs.unlink(path.join(privateDirectory, storageKey));
      } catch (error) {
        if (error.code !== 'ENOENT') {
          failedFiles.push(storageKey);
          console.error(`Could not remove private booking file ${storageKey}:`, error.message);
        }
      }
    }));
    response.json({
      id: deleted.rows[0].id,
      deleted: true,
      ...(failedFiles.length
        ? { cleanupWarning: `${failedFiles.length} private file(s) could not be safely removed.` }
        : {}),
    });
  }));

  router.patch('/bookings/:id/status', authenticate, asyncHandler(async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const status = normalizeStatusValue(request.body?.status);
    const resolution = request.body?.resolution;
    const declineReason = typeof request.body?.declineReason === 'string'
      ? request.body.declineReason.trim()
      : '';
    const appointmentInstructions = typeof request.body?.appointmentInstructions === 'string'
      ? request.body.appointmentInstructions.trim()
      : '';
    const proposedDate = request.body?.proposedDate;
    const proposedTime = request.body?.proposedTime;
    if (!status) {
      response.status(400).json({ error: 'Choose a supported booking status.' });
      return;
    }
    if (status === 'DECLINED' && !declineReason) {
      response.status(400).json({ error: 'Provide a reason for declining this booking.' });
      return;
    }
    if (resolution !== undefined && !RESOLUTIONS.has(resolution)) {
      response.status(400).json({ error: 'Choose rescheduling or refund as the resolution.' });
      return;
    }
    if (declineReason.length > 1000 || appointmentInstructions.length > 2000) {
      response.status(400).json({ error: 'Keep the customer message within its allowed length.' });
      return;
    }
    if (status === 'RESCHEDULE_PROPOSED'
      ? (!isDateValue(proposedDate) || !isTimeValue(proposedTime))
      : (proposedDate !== undefined || proposedTime !== undefined)) {
      response.status(400).json({ error: 'Provide a valid alternative appointment date and time only when proposing a reschedule.' });
      return;
    }
    const issueSlipToken = status === 'CONFIRMED' ? crypto.randomBytes(32).toString('base64url') : null;
    const proposalToken = status === 'RESCHEDULE_PROPOSED'
      ? crypto.randomBytes(32).toString('base64url')
      : null;
    const result = await updateBookingStatus(pool, request.params.id, status, resolution, {
      declineReason,
      appointmentInstructions,
      proposedDate,
      proposedTime,
      proposalTokenHash: proposalToken
        ? crypto.createHash('sha256').update(proposalToken).digest('hex')
        : null,
      slipTokenHash: issueSlipToken
        ? crypto.createHash('sha256').update(issueSlipToken).digest('hex')
        : null,
    });
    if (result.httpStatus === 200 && result.body.status === 'APPROVED') {
      const bookingResult = await pool.query(
        `SELECT id, reference, full_name, phone, whatsapp, email, service, service_other, location,
          service_option, preferred_date::text AS preferred_date, to_char(preferred_time, 'HH24:MI') AS preferred_time,
          amount_expected, payment_status, payment_reference, payment_checkout_url, payment_expires_at
         FROM bookings WHERE id = $1`,
        [request.params.id],
      );
      if (!bookingResult.rowCount) {
        response.status(500).json({ error: 'Booking was approved, but its payment details could not be loaded.' });
        return;
      }
      if (bookingResult.rows[0].payment_status === 'PAID') {
        delete result.body.proposalId;
        response.status(result.httpStatus).json(result.body);
        return;
      }
      result.body.paymentCheckout = await ensureApprovalCheckout(pool, bookingResult.rows[0], publicSiteUrl);
      const eventType = result.body.rescheduleConfirmed
        ? 'RESCHEDULE_CONFIRMED'
        : result.body.paymentCheckout.status === 'ready'
          ? 'BOOKING_ACCEPTED'
          : 'BOOKING_REVIEW_REQUIRED';
      result.body.customerEmail = await notifyBookingEvent(
        pool,
        bookingNotifications,
        request.params.id,
        eventType,
        {
          checkoutUrl: result.body.paymentCheckout.authorizationUrl || null,
          paymentPageUrl: result.body.paymentCheckout.paymentPageUrl || null,
          eventKey: result.body.rescheduleConfirmed
            ? `reschedule_confirmed:${request.params.id}:${result.body.proposalId}`
            : `booking_accepted:${request.params.id}:${result.body.paymentCheckout.paymentPageUrl || result.body.paymentCheckout.authorizationUrl || 'review-required'}`,
          paymentDeadline: result.body.paymentCheckout.authorizationUrl && bookingResult.rows[0].payment_expires_at
            ? paymentDeadline(bookingResult.rows[0].payment_expires_at, paymentExpiryHours)
            : null,
          proposedDate: result.body.confirmedProposedDate || null,
          proposedTime: result.body.confirmedProposedTime || null,
        },
      );
    } else if (result.httpStatus === 200
      && result.body.status === status
      && (result.body.previousStatus !== status || result.body.proposalUpdated)) {
      const notificationType = {
        DECLINED: 'BOOKING_DECLINED',
        RESCHEDULE_PROPOSED: 'RESCHEDULE_PROPOSED',
        CONFIRMED: 'APPOINTMENT_CONFIRMED',
        CANCELLED: 'BOOKING_CANCELLED',
        COMPLETED: 'JOB_COMPLETED',
      }[status];
      if (notificationType) {
        const slipUrl = status === 'CONFIRMED' && issueSlipToken
          ? createCustomerSlipUrl(publicSiteUrl, result.body.reference, issueSlipToken)
          : null;
        const responseUrl = status === 'RESCHEDULE_PROPOSED' && proposalToken
          ? createProposalResponseUrl(publicSiteUrl, result.body.reference, proposalToken)
          : null;
        const confirmedPayment = status === 'CONFIRMED' && result.body.rescheduleConfirmed
          ? await getConfirmedPaymentLink(pool, request.params.id, publicSiteUrl)
          : null;
        result.body.customerEmail = await notifyBookingEvent(
          pool,
          bookingNotifications,
          request.params.id,
          notificationType,
          {
            declineReason: status === 'DECLINED' ? declineReason : null,
            instructions: appointmentInstructions || null,
            slipUrl,
            responseUrl,
            proposedDate,
            proposedTime,
            ...(confirmedPayment || {}),
          },
        );
      }
    }
    response.status(result.httpStatus).json(result.body);
  }));

  router.post('/bookings/:id/payment-link', authenticate, asyncHandler(async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const bookingResult = await pool.query(
      `SELECT id, reference, full_name, phone, whatsapp, email, service, service_other, location,
        service_option, status, preferred_date::text AS preferred_date,
        to_char(preferred_time, 'HH24:MI') AS preferred_time,
        amount_expected, payment_status, payment_reference, payment_checkout_url, payment_expires_at
       FROM bookings WHERE id = $1`,
      [request.params.id],
    );
    if (!bookingResult.rowCount) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const booking = bookingResult.rows[0];
    if (booking.status !== 'APPROVED') {
      response.status(409).json({ error: 'Approve this booking before preparing its payment link.' });
      return;
    }
    const checkout = await ensureApprovalCheckout(pool, booking, publicSiteUrl);
    if (checkout.status !== 'ready') {
      const status = checkout.status === 'not_configured' ? 503 : 409;
      response.status(status).json({
        error: checkout.error || `Payment link is ${checkout.status.replaceAll('_', ' ')}.`,
        ...(checkout.missing ? { missing: checkout.missing } : {}),
      });
      return;
    }
    const customerEmail = await notifyBookingEvent(
      pool,
      bookingNotifications,
      request.params.id,
      'BOOKING_ACCEPTED',
      {
        checkoutUrl: checkout.authorizationUrl || null,
        paymentPageUrl: checkout.paymentPageUrl || null,
        eventKey: `booking_accepted:${request.params.id}:${checkout.paymentPageUrl || checkout.authorizationUrl}`,
        paymentDeadline: checkout.authorizationUrl && booking.payment_expires_at
          ? paymentDeadline(booking.payment_expires_at, paymentExpiryHours)
          : null,
      },
    );
    response.json({
      ...(checkout.authorizationUrl ? { authorizationUrl: checkout.authorizationUrl } : {}),
      ...(checkout.paymentPageUrl ? { paymentPageUrl: checkout.paymentPageUrl } : {}),
      customerEmail,
    });
  }));

  router.patch('/bookings/:id/payment', authenticate, asyncHandler(async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const { paymentStatus, amountExpected, amountReceived, reference, verification, refundStatus, email } = request.body || {};
    const validAmount = (value) => value === null || value === undefined
      || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000000);
    if (!PAYMENT_STATUSES.has(paymentStatus)
      || !PAYMENT_VERIFICATIONS.has(verification)
      || !REFUND_STATUSES.has(refundStatus)
      || !validAmount(amountExpected) || !validAmount(amountReceived)
      || (email !== undefined && email !== null && email !== '' && !validEmail(email))
      || (reference !== null && reference !== undefined && (typeof reference !== 'string' || reference.length > 160))
      || (paymentStatus === 'PAID' && verification !== 'VERIFIED')
      || (paymentStatus === 'PAID' && Number(amountReceived || 0) <= 0)
      || (Number(amountReceived || 0) > 0 && verification !== 'VERIFIED')
      || (paymentStatus === 'REFUNDED' && refundStatus !== 'COMPLETED')) {
      response.status(400).json({ error: 'Enter valid payment amounts, status, verification, refund status and reference.' });
      return;
    }
    const currentBooking = await pool.query(
      `SELECT service, service_option, location, payment_status, payment_verification,
        amount_received, amount_expected, payment_reference, refund_status
       FROM bookings WHERE id = $1`,
      [request.params.id],
    );
    if (!currentBooking.rowCount) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const existing = currentBooking.rows[0];
    if ((paymentStatus === 'PAID' || verification === 'VERIFIED')
      && !(existing.payment_status === 'PAID' && existing.payment_verification === 'VERIFIED')) {
      response.status(409).json({ error: 'A payment can be marked paid only after Paystack verifies it.' });
      return;
    }
    const fixedPrice = getFixedServicePrice(existing.service, existing.service_option, existing.location);
    const expectedAmount = fixedPrice ?? amountExpected ?? null;
    const priceChanged = Number(existing.amount_expected || 0) !== Number(expectedAmount || 0);
    const allowedPaymentStatusChange = ['PAID', 'REFUND_PENDING'].includes(existing.payment_status)
      && ['REFUND_PENDING', 'REFUNDED'].includes(paymentStatus);
    if ((paymentStatus !== existing.payment_status && !allowedPaymentStatusChange)
      || verification !== existing.payment_verification
      || Number(amountReceived || 0) !== Number(existing.amount_received || 0)
      || (reference?.trim() || null) !== (existing.payment_reference || null)
      || (priceChanged && ['AWAITING_PAYMENT', 'PAID', 'REFUND_PENDING', 'REFUNDED'].includes(existing.payment_status))
      || (refundStatus !== existing.refund_status
        && !(['PAID', 'REFUND_PENDING'].includes(existing.payment_status)
          && ['INITIATED', 'COMPLETED'].includes(refundStatus)))) {
      response.status(409).json({ error: 'Payment verification, amounts and transaction references are read-only. Use Paystack verification; only refund progress and an unpaid service amount can be edited here.' });
      return;
    }
    if (paymentStatus === 'REFUNDED' && refundStatus !== 'COMPLETED') {
      response.status(400).json({ error: 'Mark a refund as completed before setting its payment status to refunded.' });
      return;
    }
    const result = await pool.query(
      `UPDATE bookings SET payment_status = $1, amount_expected = $2,
        payment_reference = CASE WHEN amount_expected IS DISTINCT FROM $2 THEN NULL ELSE payment_reference END,
        payment_checkout_url = CASE WHEN amount_expected IS DISTINCT FROM $2 THEN NULL ELSE payment_checkout_url END,
        payment_expires_at = CASE WHEN amount_expected IS DISTINCT FROM $2 THEN NULL ELSE payment_expires_at END,
        refund_status = $3, email = COALESCE($4, email)
       WHERE id = $5
       RETURNING id, payment_status, amount_expected, amount_received, payment_reference,
         payment_date, payment_verification, refund_status, email`,
      [paymentStatus, expectedAmount, refundStatus, email?.trim() || null, request.params.id],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    response.json(result.rows[0]);
  }));

  router.post('/bookings/:id/notes', authenticate, asyncHandler(async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const note = typeof request.body?.note === 'string' ? request.body.note.trim() : '';
    if (!note || note.length > 3000) {
      response.status(400).json({ error: 'Enter an internal note of 1–3000 characters.' });
      return;
    }
    const exists = await pool.query('SELECT id FROM bookings WHERE id = $1', [request.params.id]);
    if (!exists.rowCount) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const result = await pool.query(
      `INSERT INTO booking_internal_notes (id, booking_id, note)
       VALUES ($1, $2, $3) RETURNING id, note, created_at`,
      [crypto.randomUUID(), request.params.id, note],
    );
    response.status(201).json({ note: result.rows[0] });
  }));

  router.post('/bookings/:id/payment-documents', authenticate, (request, response, next) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    paymentDocumentUpload(request, response, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError) {
        response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
          error: error.code === 'LIMIT_FILE_SIZE'
            ? 'Payment document must be 10 MB or smaller.'
            : 'Upload one payment document at a time.',
        });
        return;
      }
      next(error);
    });
  }, asyncHandler(async (request, response) => {
    if (!request.file) {
      response.status(400).json({ error: 'Select a transaction receipt or booking slip.' });
      return;
    }
    const extension = PAYMENT_DOCUMENTS.get(request.file.mimetype);
    if (!extension) {
      response.status(400).json({ error: 'Payment documents must be PDF, JPG, PNG or WebP.' });
      return;
    }
    const { fileTypeFromBuffer } = await import('file-type');
    const detectedType = await fileTypeFromBuffer(request.file.buffer);
    if (!detectedType || detectedType.mime !== request.file.mimetype
      || !PAYMENT_DOCUMENTS.has(detectedType.mime)) {
      response.status(400).json({ error: 'The payment document contents do not match a supported file type.' });
      return;
    }
    const booking = await pool.query('SELECT id FROM bookings WHERE id = $1', [request.params.id]);
    if (!booking.rowCount) {
      response.status(404).json({ error: 'Booking not found.' });
      return;
    }
    const storageKey = `${crypto.randomUUID()}${extension}`;
    const filePath = path.join(privateDirectory, storageKey);
    await fs.mkdir(privateDirectory, { recursive: true });
    await fs.writeFile(filePath, request.file.buffer, { flag: 'wx', mode: 0o600 });
    try {
      const result = await pool.query(
        `INSERT INTO booking_payment_documents (id, booking_id, storage_key, original_name, mime_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, original_name AS "originalName", mime_type AS "mimeType", created_at`,
        [crypto.randomUUID(), request.params.id, storageKey, path.win32.basename(request.file.originalname).slice(0, 255),
          request.file.mimetype, request.file.size],
      );
      response.status(201).json({ document: result.rows[0] });
    } catch (error) {
      await fs.unlink(filePath);
      throw error;
    }
  }));

  router.get('/payment-documents/:id', authenticate, asyncHandler(async (request, response, next) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'Payment document not found.' });
      return;
    }
    const result = await pool.query(
      'SELECT storage_key, original_name, mime_type FROM booking_payment_documents WHERE id = $1',
      [request.params.id],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: 'Payment document not found.' });
      return;
    }
    const document = result.rows[0];
    if (PAYMENT_DOCUMENTS.get(document.mime_type) !== path.extname(document.storage_key)
      || !PAYMENT_DOCUMENT_KEY_PATTERN.test(document.storage_key)) {
      throw new Error('Stored payment document metadata is invalid.');
    }
    const filePath = path.join(privateDirectory, document.storage_key);
    try {
      const info = await fs.stat(filePath);
      if (!info.isFile()) {
        response.status(404).json({ error: 'Payment document is unavailable.' });
        return;
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        response.status(404).json({ error: 'Payment document is unavailable.' });
        return;
      }
      throw error;
    }
    response.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': document.mime_type,
    });
    response.download(filePath, document.original_name, (error) => {
      if (error) next(error);
    });
  }));

  router.get('/availability', authenticate, asyncHandler(async (request, response) => {
    const [hours, durations, blocks] = await Promise.all([
      pool.query('SELECT weekday, is_open, opens_at, closes_at FROM booking_working_hours ORDER BY weekday'),
      pool.query('SELECT service, duration_minutes FROM booking_service_durations ORDER BY service'),
      pool.query(
        `SELECT id, blocked_date::text AS blocked_date, starts_at, ends_at, reason
         FROM booking_availability_blocks WHERE blocked_date >= CURRENT_DATE
         ORDER BY blocked_date, starts_at`,
      ),
    ]);
    response.json({ hours: hours.rows, durations: durations.rows, blocks: blocks.rows });
  }));

  router.put('/availability/hours', authenticate, asyncHandler(async (request, response) => {
    const hours = request.body?.hours;
    const durations = request.body?.durations;
    if (!Array.isArray(hours) || hours.length !== 7
      || hours.some((item, index) => item.weekday !== index || typeof item.isOpen !== 'boolean'
        || (item.isOpen && (!isTimeValue(item.opensAt) || !isTimeValue(item.closesAt)
          || timeMinutes(item.opensAt) >= timeMinutes(item.closesAt))))) {
      response.status(400).json({ error: 'Provide valid working hours for all seven weekdays.' });
      return;
    }
    if (durations !== undefined && (!Array.isArray(durations) || durations.length > 16
      || durations.some((item) => typeof item.service !== 'string'
        || !/^[A-Z_]{2,32}$/.test(item.service)
        || !Number.isInteger(item.durationMinutes) || item.durationMinutes < 15 || item.durationMinutes > 720))) {
      response.status(400).json({ error: 'Provide service durations between 15 minutes and 12 hours.' });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of hours) {
        await client.query(
          `INSERT INTO booking_working_hours (weekday, is_open, opens_at, closes_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (weekday) DO UPDATE SET is_open = EXCLUDED.is_open,
             opens_at = EXCLUDED.opens_at, closes_at = EXCLUDED.closes_at`,
          [item.weekday, item.isOpen, item.isOpen ? item.opensAt : null, item.isOpen ? item.closesAt : null],
        );
      }
      for (const item of durations || []) {
        await client.query(
          `INSERT INTO booking_service_durations (service, duration_minutes)
           VALUES ($1, $2)
           ON CONFLICT (service) DO UPDATE SET duration_minutes = EXCLUDED.duration_minutes`,
          [item.service, item.durationMinutes],
        );
      }
      await client.query('COMMIT');
      response.json({ saved: true });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  router.post('/availability/blocks', authenticate, asyncHandler(async (request, response) => {
    const { date, startsAt, endsAt, reason = '' } = request.body || {};
    if (!isDateValue(date)
      || ((startsAt || endsAt) && (!isTimeValue(startsAt) || !isTimeValue(endsAt)
        || timeMinutes(startsAt) >= timeMinutes(endsAt)))
      || typeof reason !== 'string' || reason.length > 240) {
      response.status(400).json({ error: 'Enter a valid date, optional time range and reason.' });
      return;
    }
    const conflicts = await pool.query(
      `SELECT b.id FROM bookings b
       LEFT JOIN booking_service_durations d ON d.service = b.service
       WHERE b.preferred_date = $1 AND b.status = ANY($4::varchar[])
         AND (b.preferred_time IS NULL OR $2::time IS NULL OR (
           b.preferred_time < $3::time
           AND b.preferred_time + (COALESCE(d.duration_minutes, 60) * INTERVAL '1 minute') > $2::time
         ))
       LIMIT 1`,
      [date, startsAt || null, endsAt || '23:59', ['NEW', 'PENDING_REVIEW', 'AWAITING_PAYMENT', 'AWAITING_APPROVAL', 'APPROVED', 'CONFIRMED']],
    );
    if (conflicts.rowCount) {
      response.status(409).json({ error: 'This date or time has an existing booking. Resolve that booking before blocking it.' });
      return;
    }
    const result = await pool.query(
      `INSERT INTO booking_availability_blocks (id, blocked_date, starts_at, ends_at, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, blocked_date::text AS blocked_date, starts_at, ends_at, reason`,
      [crypto.randomUUID(), date, startsAt || null, endsAt || null, reason.trim()],
    );
    response.status(201).json({ block: result.rows[0] });
  }));

  router.delete('/availability/blocks/:id', authenticate, asyncHandler(async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'Availability block not found.' });
      return;
    }
    const result = await pool.query(
      'DELETE FROM booking_availability_blocks WHERE id = $1 RETURNING id',
      [request.params.id],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: 'Availability block not found.' });
      return;
    }
    response.json({ id: result.rows[0].id });
  }));

  router.get('/submissions', authenticate, asyncHandler(async (request, response) => {
    const type = request.query.type || 'all';
    const requestedStatus = request.query.status || 'ALL';
    const normalizedStatus = requestedStatus === 'ALL' ? 'ALL' : normalizeStatusValue(requestedStatus);
    const limit = Number(request.query.limit || 25);
    const offset = Number(request.query.offset || 0);
    if (!SUBMISSION_TYPES.has(type)) {
      response.status(400).json({ error: 'Choose all, booking or enquiry.' });
      return;
    }
    if (normalizedStatus === null) {
      response.status(400).json({ error: 'Choose a supported status.' });
      return;
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100
      || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
      response.status(400).json({ error: 'Choose a page size of 1–100 and a valid page offset.' });
      return;
    }

    const statusClause = normalizedStatus === 'ALL' ? '' : 'WHERE status = $1';
    const parameters = normalizedStatus === 'ALL' ? [] : [normalizedStatus];
    const limitIndex = parameters.length + 1;
    const offsetIndex = parameters.length + 2;
    const combined = createCombinedSubmissionQuery(type);
    const [items, count] = await Promise.all([
      pool.query(
        `SELECT * FROM (${combined}) AS submissions ${statusClause}
         ORDER BY created_at DESC, id DESC
         LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        [...parameters, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM (${combined}) AS submissions ${statusClause}`,
        parameters,
      ),
    ]);

    response.json({
      submissions: items.rows,
      total: count.rows[0].total,
      limit,
      offset,
    });
  }));

  router.get('/reviews', authenticate, asyncHandler(async (request, response) => {
    const result = await pool.query(
      `SELECT id, name, vehicle, rating, review, created_at
       FROM reviews
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
    );
    response.json({ reviews: result.rows });
  }));

  router.delete('/reviews/:id', authenticate, asyncHandler(async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'Review not found.' });
      return;
    }
    const result = await pool.query(
      'DELETE FROM reviews WHERE id = $1 RETURNING id',
      [request.params.id],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: 'Review not found.' });
      return;
    }
    response.json({ id: result.rows[0].id });
  }));

  router.patch('/submissions/:type/:id/status', authenticate, asyncHandler(async (request, response) => {
    const table = TABLE_BY_TYPE[request.params.type];
    if (!table || !UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'Submission not found.' });
      return;
    }
    const status = normalizeStatusValue(request.body?.status);
    if (!status) {
      response.status(400).json({ error: 'Choose a supported status.' });
      return;
    }
    if (request.params.type === 'booking') {
      const resolution = request.body?.resolution;
      if (resolution !== undefined && !RESOLUTIONS.has(resolution)) {
        response.status(400).json({ error: 'Choose rescheduling or refund as the resolution.' });
        return;
      }
      const result = await updateBookingStatus(pool, request.params.id, status, resolution);
      response.status(result.httpStatus).json(result.body);
      return;
    }

    const result = await pool.query(
      `UPDATE ${table} SET status = $1 WHERE id = $2 RETURNING id, status`,
      [status, request.params.id],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: 'Submission not found.' });
      return;
    }
    response.json(result.rows[0]);
  }));

  router.get('/attachments/:id', authenticate, asyncHandler(async (request, response, next) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'Attachment not found.' });
      return;
    }
    const result = await pool.query(
      `SELECT storage_key, original_name, mime_type
       FROM submission_attachments
       WHERE id = $1`,
      [request.params.id],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: 'Attachment not found.' });
      return;
    }

    const attachment = result.rows[0];
    if (!ATTACHMENT_TYPES.has(attachment.mime_type)
      || !PRIVATE_FILE_PATTERN.test(attachment.storage_key)) {
      throw new Error('Stored attachment metadata is invalid.');
    }
    const filePath = path.join(privateDirectory, attachment.storage_key);
    try {
      const info = await fs.stat(filePath);
      if (!info.isFile()) {
        response.status(404).json({ error: 'Attachment not found.' });
        return;
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        response.status(404).json({ error: 'Attachment file is unavailable.' });
        return;
      }
      throw error;
    }

    response.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': attachment.mime_type,
    });
    response.download(filePath, attachment.original_name, (error) => {
      if (error) next(error);
    });
  }));

  return router;
}

function createAdminAuth(username, password) {
  return (request, response, next) => {
    if (typeof username !== 'string' || username.length < 1
      || typeof password !== 'string' || password.length < 16) {
      response.status(503).json({ error: 'Admin access is not configured.' });
      return;
    }

    const authorization = request.get('authorization') || '';
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(authorization);
    if (!match || match[1].length > 1024) {
      response.status(401).json({ error: 'Enter the admin username and password.' });
      return;
    }
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64') !== match[1]) {
      response.status(401).json({ error: 'Admin credentials are invalid.' });
      return;
    }
    const separator = decoded.indexOf(':');
    if (separator < 1) {
      response.status(401).json({ error: 'Admin credentials are invalid.' });
      return;
    }

    const validUsername = constantTimeEqual(decoded.slice(0, separator), username);
    const validPassword = constantTimeEqual(decoded.slice(separator + 1), password);
    if (!validUsername || !validPassword) {
      response.status(401).json({ error: 'Admin credentials are invalid.' });
      return;
    }
    next();
  };
}

function constantTimeEqual(value, expected) {
  const valueBuffer = Buffer.from(value, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (valueBuffer.length !== expectedBuffer.length) {
    crypto.timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }
  return crypto.timingSafeEqual(valueBuffer, expectedBuffer);
}

async function updateBookingStatus(pool, bookingId, status, resolution, options = {}) {
  if (status === 'DECLINED' && !String(options.declineReason || '').trim()) {
    return { httpStatus: 400, body: { error: 'Provide a reason for declining this booking.' } };
  }
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const current = await client.query(
      `SELECT id, reference, status, payment_status, payment_verification, amount_received,
        amount_expected, service, proposed_preferred_date::text AS proposed_date,
        to_char(proposed_preferred_time, 'HH24:MI') AS proposed_time,
        proposed_response, proposed_response_token_hash
       FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId],
    );
    if (!current.rowCount) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return { httpStatus: 404, body: { error: 'Booking not found.' } };
    }
    const booking = current.rows[0];
    if (booking.status === 'RESCHEDULE_PROPOSED'
      && status === 'RESCHEDULE_PROPOSED'
      && booking.proposed_response_token_hash
      && booking.proposed_response_expires_at
      && booking.proposed_date === options.proposedDate
      && booking.proposed_time === options.proposedTime) {
      await client.query('COMMIT');
      transactionStarted = false;
      return {
        httpStatus: 200,
        body: {
          id: booking.id,
          reference: booking.reference,
          status,
          previousStatus: status,
          proposalUpdated: false,
        },
      };
    }
    if (booking.status === status && status !== 'RESCHEDULE_PROPOSED') {
      await client.query('COMMIT');
      transactionStarted = false;
      return {
        httpStatus: 200,
        body: { id: booking.id, reference: booking.reference, status, previousStatus: status },
      };
    }
    const paid = booking.payment_status === 'PAID' || Number(booking.amount_received) > 0;
    const confirmingAcceptedProposal = status === 'CONFIRMED'
      && booking.status === 'RESCHEDULE_PROPOSED'
      && booking.proposed_response === 'ACCEPTED';
    if (status === 'CONFIRMED' && !confirmingAcceptedProposal && Number(booking.amount_expected || 0) > 0
      && !(booking.payment_status === 'PAID' && booking.payment_verification === 'VERIFIED')) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return {
        httpStatus: 409,
        body: { error: 'Verify the approved payment before confirming this appointment.' },
      };
    }
    const needsResolution = paid && ['DECLINED', 'CANCELLED'].includes(status);
    if (needsResolution && !RESOLUTIONS.has(resolution)) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return {
        httpStatus: 409,
        body: {
          error: 'This booking has a payment. Choose rescheduling or initiate a refund before declining or cancelling it.',
          requiresResolution: true,
        },
      };
    }
    if (status === 'RESCHEDULE_PROPOSED') {
      await reserveBookingSlot(client, {
        preferredDate: options.proposedDate,
        preferredTime: options.proposedTime,
        service: booking.service,
      }, { excludeBookingId: bookingId });
    }
    if (confirmingAcceptedProposal) {
      await reserveBookingSlot(client, {
        preferredDate: booking.proposed_date,
        preferredTime: booking.proposed_time,
        service: booking.service,
      }, { excludeBookingId: bookingId });
    }
    const effectiveStatus = confirmingAcceptedProposal
      && !(booking.payment_status === 'PAID' && booking.payment_verification === 'VERIFIED')
      ? 'APPROVED'
      : status;
    const updated = await client.query(
      `UPDATE bookings SET status = $1::varchar, resolution = $2,
        payment_status = CASE WHEN $3::varchar = 'INITIATE_REFUND' THEN 'REFUND_PENDING' ELSE payment_status END,
        refund_status = CASE WHEN $3::varchar = 'INITIATE_REFUND' THEN 'INITIATED' ELSE refund_status END,
        decline_reason = CASE WHEN $1::varchar = 'DECLINED' THEN NULLIF($4, '') ELSE NULL END,
        preferred_date = CASE WHEN $12 THEN proposed_preferred_date ELSE preferred_date END,
        preferred_time = CASE WHEN $12 THEN proposed_preferred_time ELSE preferred_time END,
        appointment_instructions = CASE
          WHEN $1::varchar = 'CONFIRMED' AND $5 <> '' THEN $5 ELSE appointment_instructions END,
        slip_token_hash = CASE WHEN $6::char(64) IS NULL THEN slip_token_hash ELSE $6::char(64) END,
        slip_token_expires_at = CASE WHEN $6::char(64) IS NULL THEN slip_token_expires_at
          ELSE NOW() + INTERVAL '180 days' END,
        request_expires_at = CASE WHEN $1::varchar NOT IN ('NEW', 'PENDING_REVIEW') THEN NULL ELSE request_expires_at END,
        payment_expires_at = CASE WHEN $1::varchar IN ('DECLINED', 'CANCELLED', 'CONFIRMED') THEN NULL ELSE payment_expires_at END,
        proposed_preferred_date = CASE WHEN $1::varchar = 'RESCHEDULE_PROPOSED' THEN $7::date ELSE NULL END,
        proposed_preferred_time = CASE WHEN $1::varchar = 'RESCHEDULE_PROPOSED' THEN $8::time ELSE NULL END,
        proposed_previous_status = CASE WHEN $1::varchar = 'RESCHEDULE_PROPOSED'
          THEN COALESCE(proposed_previous_status, $9) ELSE NULL END,
        proposed_response_token_hash = CASE WHEN $1::varchar = 'RESCHEDULE_PROPOSED' THEN $10::char(64) ELSE NULL END,
        proposed_response_expires_at = CASE WHEN $1::varchar = 'RESCHEDULE_PROPOSED'
          THEN NOW() + INTERVAL '48 hours' ELSE NULL END,
        proposed_response = NULL
       WHERE id = $11
       RETURNING id, reference, status, resolution, payment_status, refund_status`,
      [
        effectiveStatus,
        needsResolution ? resolution : null,
        needsResolution ? resolution : null,
        options.declineReason || '',
        options.appointmentInstructions || '',
        options.slipTokenHash || null,
        options.proposedDate || null,
        options.proposedTime || null,
        booking.status,
        options.proposalTokenHash || null,
        bookingId,
        confirmingAcceptedProposal,
      ],
    );
    await client.query(
      `INSERT INTO booking_status_history (id, booking_id, previous_status, status, resolution)
       VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), bookingId, booking.status, effectiveStatus, needsResolution ? resolution : null],
    );
    await client.query(
      `INSERT INTO booking_activity_history (id, booking_id, action, details)
       VALUES ($1, $2, 'BOOKING_STATUS_CHANGED', $3::jsonb)`,
      [crypto.randomUUID(), bookingId, JSON.stringify({
        previousStatus: booking.status,
        status: effectiveStatus,
        resolution: needsResolution ? resolution : null,
        proposedDate: options.proposedDate || null,
        proposedTime: options.proposedTime || null,
      })],
    );
    await client.query('COMMIT');
    transactionStarted = false;
    return {
      httpStatus: 200,
      body: {
        ...updated.rows[0],
        previousStatus: booking.status,
        rescheduleConfirmed: confirmingAcceptedProposal,
        ...(confirmingAcceptedProposal ? {
          confirmedProposedDate: booking.proposed_date,
          confirmedProposedTime: booking.proposed_time,
          proposalId: booking.proposed_response_token_hash,
        } : {}),
        ...(status === 'RESCHEDULE_PROPOSED' ? { proposalUpdated: true } : {}),
      },
    };
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function notifyBookingEvent(pool, notifications, bookingId, eventType, extra = {}) {
  if (!notifications) return { status: 'not_configured' };
  const result = await pool.query(
    `SELECT id, reference, full_name, email, service, service_other,
      preferred_date::text AS preferred_date, to_char(preferred_time, 'HH24:MI') AS preferred_time,
      amount_expected, amount_received, payment_reference, payment_status,
      refund_status, resolution, vehicle_make, vehicle_model, vehicle_year, registration,
      phone, location, location_other, appointment_instructions, status, payment_verification
     FROM bookings WHERE id = $1`,
    [bookingId],
  );
  if (!result.rowCount) return { status: 'failed', error: 'Booking is unavailable for notification.' };
  const booking = result.rows[0];
  const { eventKey, ...eventPayload } = extra;
  try {
    const attachments = eventType === 'APPOINTMENT_CONFIRMED' && canIssueBookingSlip(booking)
      ? [{
        filename: `booking-${booking.reference}.pdf`,
        content: (await createBookingSlip(booking)).toString('base64'),
      }]
      : [];
    return await notifications.enqueueAndDeliver({
      bookingId,
      eventKey: eventKey || `${eventType.toLowerCase()}:${bookingId}:${crypto.randomUUID()}`,
      eventType,
      recipient: booking.email,
      payload: {
        customerName: booking.full_name,
        reference: booking.reference,
        service: booking.service,
        serviceOther: booking.service_other,
        preferredDate: booking.preferred_date,
        preferredTime: booking.preferred_time,
        amountExpected: booking.amount_expected === null ? null : Number(booking.amount_expected),
        amountReceived: Number(booking.amount_received || 0),
        transactionReference: booking.payment_reference,
        paymentStatus: booking.payment_status,
        refundStatus: booking.refund_status,
        resolution: booking.resolution,
        vehicle: [booking.vehicle_year, booking.vehicle_make, booking.vehicle_model].filter(Boolean).join(' '),
        registration: booking.registration,
        location: booking.location_other || booking.location,
        ...(attachments.length ? { attachments } : {}),
        ...eventPayload,
      },
    });
  } catch (error) {
    console.error('Booking notification could not be queued:', error.message);
    return { status: 'failed', error: 'The booking was updated, but its email could not be queued.' };
  }
}

function createCustomerSlipUrl(publicSiteUrl, reference, token) {
  try {
    const base = new URL(publicSiteUrl);
    if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) return null;
    const slipUrl = new URL('/api/v1/booking-slip', base);
    slipUrl.searchParams.set('reference', reference);
    slipUrl.searchParams.set('token', token);
    return slipUrl.toString();
  } catch {
    return null;
  }
}

function createProposalResponseUrl(publicSiteUrl, reference, token) {
  try {
    const base = new URL(publicSiteUrl);
    if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) return null;
    const responseUrl = new URL('/booking-status.html', base);
    responseUrl.searchParams.set('reference', reference);
    responseUrl.searchParams.set('responseToken', token);
    return responseUrl.toString();
  } catch {
    return null;
  }
}

function paymentDeadline(value, hours) {
  const deadline = value ? new Date(value) : new Date(Date.now() + hours * 60 * 60 * 1000);
  return Number.isNaN(deadline.valueOf()) ? null : deadline.toISOString();
}

function createCombinedSubmissionQuery(type) {
  const enquiries = type === 'booking' ? '' : `
    SELECT e.id, 'enquiry'::text AS type, NULL::text AS reference, e.full_name, e.phone, e.whatsapp, e.email,
      e.enquiry_type, e.description, e.vehicle_make, e.vehicle_model, e.vehicle_year,
      NULL::text AS registration, NULL::text AS service, NULL::text AS service_other,
      NULL::date AS preferred_date, NULL::time AS preferred_time,
      NULL::text AS location, NULL::text AS location_other, e.status, e.created_at,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', a.id, 'originalName', a.original_name, 'mimeType', a.mime_type
        ) ORDER BY a.created_at)
        FROM submission_attachments a WHERE a.enquiry_id = e.id
      ), '[]'::json) AS attachments
    FROM enquiries e`;
  const bookings = type === 'enquiry' ? '' : `
    SELECT b.id, 'booking'::text AS type, b.reference, b.full_name, b.phone, b.whatsapp,
    b.email, NULL::text AS enquiry_type, b.details AS description,
      b.vehicle_make, b.vehicle_model, b.vehicle_year, b.registration, b.service,
      b.service_other, b.preferred_date, b.preferred_time, b.location, b.location_other,
      b.status, b.created_at,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', a.id, 'originalName', a.original_name, 'mimeType', a.mime_type
        ) ORDER BY a.created_at)
        FROM submission_attachments a WHERE a.booking_id = b.id
      ), '[]'::json) AS attachments
    FROM bookings b`;
  return [enquiries, bookings].filter(Boolean).join('\nUNION ALL\n');
}

async function getConfirmedPaymentLink(pool, bookingId, publicSiteUrl) {
  const result = await pool.query(
    `SELECT id, reference, email, service, service_option, location, payment_status,
      amount_expected, payment_reference, payment_checkout_url
     FROM bookings WHERE id = $1`,
    [bookingId],
  );
  if (!result.rowCount || result.rows[0].payment_status === 'PAID') return null;
  const checkout = await ensureApprovalCheckout(pool, result.rows[0], publicSiteUrl);
  return checkout.status === 'ready'
    ? {
      checkoutUrl: checkout.authorizationUrl || null,
      paymentPageUrl: checkout.paymentPageUrl || null,
    }
    : null;
}

function isTimeValue(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timeMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function isDateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

module.exports = { createAdminRouter, updateBookingStatus };
