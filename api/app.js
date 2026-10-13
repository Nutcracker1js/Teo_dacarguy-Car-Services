const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { createAdminRouter } = require('./admin');
const { getAvailableSlots, reserveBookingSlot } = require('./availability');
const { TINT_OPTIONS, validateBooking, validateEnquiry, validateReview } = require('./validation');
const { normalizeNigerianPhone, validEmail } = require('./payments');
const { getFixedServicePrice } = require('./pricing');
const {
  createUploadMiddleware,
  inspectUploads,
  persistUploads,
  removeFiles,
  removeStagedUploads,
} = require('./uploads');

function createApp({
  pool,
  corsOrigins = [],
  uploadDirectory = path.resolve(__dirname, '..', '..', 'teo-dacarguy-private-uploads'),
  sendNotifications = async () => ({ email: 'not_configured', whatsapp: 'not_configured' }),
  paymentGateway = { configured: false },
  adminUsername,
  adminPassword,
  serveWebsite = process.env.SERVE_WEBSITE === 'true',
  publicDirectory = path.resolve(__dirname, '..', 'dist'),
}) {
  const app = express();
  const uploads = createUploadMiddleware(uploadDirectory);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        connectSrc: [
          "'self'",
          'https://*.smartsupp.com',
          'https://*.smartsuppchat.com',
          'https://*.smartsuppcdn.com',
          'wss://*.smartsupp.com',
          'wss://*.smartsuppchat.com',
          'wss://*.smartsuppcdn.com',
        ],
        imgSrc: [
          "'self'",
          'data:',
          'https://*.smartsupp.com',
          'https://*.smartsuppchat.com',
          'https://*.smartsuppcdn.com',
        ],
        frameSrc: [
          "'self'",
          'https://maps.google.com',
          'https://www.google.com',
          'https://*.smartsupp.com',
          'https://*.smartsuppchat.com',
          'https://*.smartsuppcdn.com',
        ],
        scriptSrc: [
          "'self'",
          'https://www.smartsuppchat.com',
          'https://*.smartsuppcdn.com',
        ],
      },
    },
  }));
  if (corsOrigins.length) {
    app.use(cors({
      origin(origin, callback) {
        callback(null, !origin || corsOrigins.includes(origin));
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    }));
  }
  app.use(express.json({ limit: '16kb', strict: true }));

  const publicSubmissionLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
  });
  const publicReviewLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many review submissions. Please try again later.' },
  });
  const publicBookingStatusLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many status checks. Please try again later.' },
  });
  const publicPaymentLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many payment attempts. Please try again later.' },
  });

  app.get('/api/health', asyncHandler(async (request, response) => {
    await pool.query('SELECT 1');
    response.json({ status: 'ok' });
  }));

  app.get('/api/v1/availability', asyncHandler(async (request, response) => {
    const { date, service } = request.query;
    const parsedDate = typeof date === 'string' ? new Date(`${date}T00:00:00.000Z`) : null;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || Number.isNaN(parsedDate?.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date
      || typeof service !== 'string' || !/^[A-Z_]{2,32}$/.test(service)) {
      response.status(400).json({ error: 'Choose a valid date and service.' });
      return;
    }
    const availability = await getAvailableSlots(pool, date, service);
    response.set('Cache-Control', 'no-store');
    response.json(availability);
  }));

  app.get('/api/v1/reviews', asyncHandler(async (request, response) => {
    const result = await pool.query(
      `SELECT id, name, vehicle, rating, review, created_at
       FROM reviews
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
    );
    response.set('Cache-Control', 'no-store');
    response.json({ reviews: result.rows });
  }));

  app.post('/api/v1/booking-status', publicBookingStatusLimit, asyncHandler(async (request, response) => {
    const reference = typeof request.body?.reference === 'string' ? request.body.reference.trim().toUpperCase() : '';
    let phone = typeof request.body?.phone === 'string' ? request.body.phone.replace(/\D/g, '') : '';
    if (/^0\d{10}$/.test(phone)) phone = `234${phone.slice(1)}`;
    if (!/^TD-[A-Z0-9-]{4,20}$/.test(reference) || !/^[1-9]\d{7,14}$/.test(phone)) {
      response.status(400).json({ error: 'Enter a valid booking reference and phone number.' });
      return;
    }
    const result = await pool.query(
      `SELECT reference, status, service, service_other, preferred_date::text AS preferred_date,
        to_char(preferred_time, 'HH24:MI') AS preferred_time, payment_status,
        amount_expected, amount_received
       FROM bookings
       WHERE reference = $1
         AND (
           regexp_replace(phone, '[^0-9]', '', 'g') = $2
           OR ($2 LIKE '234%' AND regexp_replace(phone, '[^0-9]', '', 'g') = '0' || substr($2, 4))
         )
       LIMIT 1`,
      [reference, phone],
    );
    response.set('Cache-Control', 'no-store');
    if (!result.rowCount) {
      response.status(404).json({ error: 'We could not find a booking with those details. Check the reference and phone number and try again.' });
      return;
    }
    response.json({ booking: result.rows[0] });
  }));

  app.post('/api/v1/payments/initialize', publicPaymentLimit, asyncHandler(async (request, response) => {
    const reference = typeof request.body?.reference === 'string' ? request.body.reference.trim().toUpperCase() : '';
    const phone = normalizeNigerianPhone(request.body?.phone);
    if (!/^TD-[A-Z0-9-]{4,20}$/.test(reference) || !phone) {
      response.status(400).json({ error: 'Enter a valid booking reference and phone number.' });
      return;
    }
    const lookup = await pool.query(
      `SELECT id, reference, status, payment_status, amount_expected, email,
        payment_reference, payment_checkout_url
       FROM bookings WHERE reference = $1
         AND (
           regexp_replace(phone, '[^0-9]', '', 'g') = $2
           OR ($2 LIKE '234%' AND regexp_replace(phone, '[^0-9]', '', 'g') = '0' || substr($2, 4))
         )
       LIMIT 1`,
      [reference, phone],
    );
    if (!lookup.rowCount) {
      response.status(404).json({ error: 'We could not find a booking with those details.' });
      return;
    }
    const booking = lookup.rows[0];
    if (!['APPROVED', 'CONFIRMED'].includes(booking.status)) {
      response.status(409).json({ error: 'Payment is available only after Teo approves your booking.' });
      return;
    }
    if (booking.payment_status === 'PAID') {
      response.status(409).json({ error: 'This booking is already marked as paid.' });
      return;
    }
    if (['PARTIAL', 'REFUND_PENDING', 'REFUNDED'].includes(booking.payment_status)) {
      response.status(409).json({ error: 'Online checkout is unavailable for this payment status. Contact Teo for assistance.' });
      return;
    }
    if (booking.payment_status === 'AWAITING_PAYMENT'
      && booking.payment_reference
      && isPaystackCheckoutUrl(booking.payment_checkout_url)) {
      response.set('Cache-Control', 'no-store');
      response.json({ authorizationUrl: booking.payment_checkout_url });
      return;
    }
    if (!paymentGateway.configured) {
      response.status(503).json({ error: 'Online payment is not configured yet. Contact Teo to arrange payment.' });
      return;
    }
    if (!validEmail(booking.email)) {
      response.status(409).json({ error: 'The booking needs a valid receipt email. Contact Teo to update your details.' });
      return;
    }
    const checkout = await paymentGateway.initialize({ booking, email: booking.email.trim() });
    if (checkout.error) {
      response.status(checkout.error.status === 'not_configured' ? 503 : 502).json({ error: checkout.error.message });
      return;
    }
    const savedReference = await pool.query(
      `UPDATE bookings SET payment_status = 'AWAITING_PAYMENT', payment_reference = $1,
        payment_checkout_url = $2
       WHERE id = $3 AND status IN ('APPROVED', 'CONFIRMED') AND payment_status <> 'PAID'
       RETURNING id`,
      [checkout.data.reference, checkout.data.authorizationUrl, booking.id],
    );
    if (!savedReference.rowCount) {
      response.status(409).json({ error: 'The booking changed while starting checkout. Check its status and try again.' });
      return;
    }
    response.set('Cache-Control', 'no-store');
    response.json({ authorizationUrl: checkout.data.authorizationUrl });
  }));

  app.post('/api/v1/payments/verify', publicPaymentLimit, asyncHandler(async (request, response) => {
    const reference = typeof request.body?.reference === 'string' ? request.body.reference.trim().toUpperCase() : '';
    const transactionReference = typeof request.body?.transactionReference === 'string'
      ? request.body.transactionReference.trim()
      : '';
    const phone = normalizeNigerianPhone(request.body?.phone);
    if (!/^TD-[A-Z0-9-]{4,20}$/.test(reference) || !phone
      || !/^[A-Za-z0-9._=-]{1,100}$/.test(transactionReference)) {
      response.status(400).json({ error: 'The booking or transaction details are invalid.' });
      return;
    }
    const lookup = await pool.query(
      `SELECT id, reference, status, payment_status, payment_reference, amount_expected
       FROM bookings WHERE reference = $1
         AND (
           regexp_replace(phone, '[^0-9]', '', 'g') = $2
           OR ($2 LIKE '234%' AND regexp_replace(phone, '[^0-9]', '', 'g') = '0' || substr($2, 4))
         )
       LIMIT 1`,
      [reference, phone],
    );
    if (!lookup.rowCount || lookup.rows[0].payment_reference !== transactionReference) {
      response.status(404).json({ error: 'We could not match this payment to the booking.' });
      return;
    }
    const booking = lookup.rows[0];
    if (!['APPROVED', 'CONFIRMED'].includes(booking.status)) {
      response.status(409).json({ error: 'The booking must be approved before payment can be verified.' });
      return;
    }
    if (booking.payment_status === 'PAID') {
      response.json({ paymentStatus: 'PAID' });
      return;
    }
    const verification = await paymentGateway.verify(transactionReference);
    if (verification.error) {
      response.status(verification.error.status === 'not_configured' ? 503 : 502).json({ error: verification.error.message });
      return;
    }
    const transaction = verification.data;
    const expectedKobo = Math.round(Number(booking.amount_expected) * 100);
    if (transaction.status !== 'success' || transaction.currency !== 'NGN'
      || transaction.amount !== expectedKobo
      || transaction.metadata?.booking_reference !== booking.reference) {
      response.status(409).json({ error: 'Paystack has not verified a successful payment for the exact booking amount.' });
      return;
    }
    const updated = await pool.query(
      `UPDATE bookings SET payment_status = 'PAID', amount_received = $1,
        payment_verification = 'VERIFIED', payment_date = COALESCE(payment_date, NOW())
       WHERE id = $2 AND payment_reference = $3 AND status IN ('APPROVED', 'CONFIRMED')
       RETURNING payment_status`,
      [transaction.amount / 100, booking.id, transactionReference],
    );
    if (!updated.rowCount) {
      response.status(409).json({ error: 'The booking changed while the payment was being verified. Contact Teo to confirm your payment.' });
      return;
    }
    response.set('Cache-Control', 'no-store');
    response.json({ paymentStatus: updated.rows[0].payment_status });
  }));

  app.post('/api/v1/reviews', publicReviewLimit, asyncHandler(async (request, response) => {
    const { data, errors } = validateReview(request.body);
    if (Object.keys(errors).length) {
      response.status(400).json({ error: 'Please check your review.', fields: errors });
      return;
    }
    const id = crypto.randomUUID();
    const result = await pool.query(
      `INSERT INTO reviews (id, name, vehicle, rating, review)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, vehicle, rating, review, created_at`,
      [id, data.name, data.vehicle, data.rating, data.review],
    );
    response.status(201).json({ review: result.rows[0] });
  }));

  app.post(
    '/api/v1/enquiries',
    publicSubmissionLimit,
    uploads.middleware,
    createSubmissionHandler({
      pool,
      validate: validateEnquiry,
      uploadType: 'enquiry',
      uploadDirectory: uploads.privateDirectory,
      sendNotifications,
      insert: (id, data) => ({
        sql: `INSERT INTO enquiries (
          id, full_name, phone, whatsapp, email, enquiry_type, description,
          vehicle_make, vehicle_model, vehicle_year
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, status, created_at`,
        values: [
          id, data.fullName, data.phone, data.whatsapp, data.email,
          data.enquiryType, data.description, data.make, data.model, data.year,
        ],
      }),
    }),
  );

  app.post(
    '/api/v1/bookings',
    publicSubmissionLimit,
    uploads.middleware,
    createSubmissionHandler({
      pool,
      validate: validateBooking,
      uploadType: 'booking',
      uploadDirectory: uploads.privateDirectory,
      sendNotifications,
      beforeInsert: (client, data) => reserveBookingSlot(client, data),
      insert: (id, data) => ({
        sql: `INSERT INTO bookings (
          id, full_name, phone, whatsapp, vehicle_make, vehicle_model, vehicle_year,
          registration, service, service_other, preferred_date, preferred_time,
          location, location_other, details, policy_accepted, policy_version, email, whatsapp_opt_in,
          service_option, amount_expected
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        RETURNING id, reference, status, created_at`,
        values: [
          id, data.fullName, data.phone, data.whatsapp, data.make, data.model,
          data.year, data.registration, data.service, data.serviceOther,
          data.preferredDate, data.preferredTime, data.location, data.locationOther,
          [
            data.tintOption
              ? `Selected tint: ${TINT_OPTIONS[data.tintOption].label} (listed price: ₦${TINT_OPTIONS[data.tintOption].amountNgn.toLocaleString('en-NG')}). Payment is due only after booking approval.`
              : null,
            data.details,
          ].filter(Boolean).join('\n\n') || null,
          data.policyAccepted === true, 'Booking, Cancellation & Refund Policy v1',
          data.email,
          data.whatsappOptIn === true,
          data.tintOption,
          getFixedServicePrice(data.service, data.tintOption),
        ],
      }),
    }),
  );

  app.use('/api/v1/admin', createAdminRouter({
    pool,
    username: adminUsername,
    password: adminPassword,
    privateDirectory: uploads.privateDirectory,
    paymentGateway,
  }));

  if (serveWebsite) {
    app.get(['/admin', '/admin/'], (request, response) => {
      const query = request.originalUrl.includes('?')
        ? request.originalUrl.slice(request.originalUrl.indexOf('?'))
        : '';
      response.redirect(302, `/admin.html${query}`);
    });
    app.use(express.static(publicDirectory, {
      dotfiles: 'deny',
      index: 'index.html',
      redirect: false,
    }));
  }

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      response.status(400).json({ error: 'Request body must contain valid JSON.' });
      return;
    }
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      response.status(tooLarge ? 413 : 400).json({
        error: tooLarge
          ? 'Each attachment must be 15 MB or smaller.'
          : 'Choose up to 6 attachments using the attachments field.',
      });
      return;
    }
    if (error.type === 'entity.too.large') {
      response.status(413).json({ error: 'The request is too large.' });
      return;
    }
    if ([400, 409, 503].includes(error.status)) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    console.error(JSON.stringify({
      level: 'error',
      message: 'API request failed.',
      method: request.method,
      path: request.path,
      error: error.message,
    }));
    response.status(500).json({ error: 'The request could not be completed. Please try again.' });
  });

  return app;
}

function createSubmissionHandler({
  pool,
  validate,
  uploadType,
  uploadDirectory,
  sendNotifications,
  beforeInsert,
  insert,
}) {
  return asyncHandler(async (request, response) => {
    const files = request.files || [];
    const { data, errors } = validate(request.body);
    if (Object.keys(errors).length) {
      await removeStagedUploads(files);
      response.status(400).json({ error: 'Please check the submitted fields.', fields: errors });
      return;
    }

    let inspected;
    try {
      inspected = await inspectUploads(files);
    } catch (error) {
      await removeStagedUploads(files);
      if (error.status === 400) {
        response.status(400).json({ error: error.message, fields: error.fields });
        return;
      }
      throw error;
    }

    let client;
    let transactionStarted = false;
    let movedFiles = [];
    try {
      client = await pool.connect();
      const id = crypto.randomUUID();
      const statement = insert(id, data);
      await client.query('BEGIN');
      transactionStarted = true;
      if (beforeInsert) await beforeInsert(client, data);
      const result = await client.query(statement.sql, statement.values);
      if (uploadType === 'booking') {
        await client.query(
          `INSERT INTO booking_status_history (id, booking_id, previous_status, status)
           VALUES ($1, $2, NULL, $3)`,
          [crypto.randomUUID(), result.rows[0].id, result.rows[0].status],
        );
      }
      movedFiles = await persistUploads(client, inspected, uploadType, id, uploadDirectory);
      await client.query('COMMIT');
      transactionStarted = false;
      client.release();
      client = null;
      const submission = { type: uploadType, id, data, attachmentCount: inspected.length };
      let notifications;
      try {
        notifications = await sendNotifications(submission);
      } catch (error) {
        console.error('Submission notification service failed:', error.message);
        notifications = { email: 'failed', whatsapp: 'failed' };
      }
      response.status(201).json({
        id: result.rows[0].id,
        ...(result.rows[0].reference ? { reference: result.rows[0].reference } : {}),
        status: result.rows[0].status,
        submittedAt: result.rows[0].created_at,
        attachmentCount: inspected.length,
        notifications,
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('Database rollback failed:', rollbackError.message);
        }
      }
      await removeFiles(movedFiles);
      await removeStagedUploads(files);
      throw error;
    } finally {
      if (client) client.release();
    }
  });
}

function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function isPaystackCheckoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.paystack.com' && url.pathname.length > 1;
  } catch {
    return false;
  }
}

module.exports = { createApp };
