const crypto = require('node:crypto');
const { applyVerifiedPayment } = require('./payment-processing');

async function processExpiredBookings({ pool, paymentGateway, bookingNotifications, limit = 50 }) {
  const reviewRequests = await pool.query(
    `SELECT id FROM bookings
     WHERE status IN ('NEW', 'PENDING_REVIEW') AND request_expires_at <= NOW()
     ORDER BY request_expires_at
     LIMIT $1`,
    [limit],
  );
  for (const { id } of reviewRequests.rows) {
    await expireReviewRequest(pool, id, bookingNotifications);
  }

  const proposals = await pool.query(
    `SELECT id FROM bookings
     WHERE status = 'RESCHEDULE_PROPOSED' AND proposed_response_expires_at <= NOW()
     ORDER BY proposed_response_expires_at
     LIMIT $1`,
    [limit],
  );
  for (const { id } of proposals.rows) {
    await expireRescheduleProposal(pool, id, bookingNotifications);
  }

  const paymentRequests = await pool.query(
    `SELECT id, payment_reference FROM bookings
    WHERE status = 'APPROVED' AND payment_status IN ('AWAITING_PAYMENT', 'FAILED')
       AND payment_expires_at <= NOW()
     ORDER BY payment_expires_at
     LIMIT $1`,
    [limit],
  );
  for (const booking of paymentRequests.rows) {
    if (!booking.payment_reference || !paymentGateway?.configured) continue;
    let verification;
    try {
      verification = await paymentGateway.verify(booking.payment_reference);
    } catch (error) {
      console.error('Expired checkout reconciliation failed; the appointment slot remains reserved:', error.message);
      continue;
    }
    if (verification.error) continue;
    if (verification.data?.status === 'success') {
      try {
        await applyVerifiedPayment({
          pool,
          transaction: verification.data,
          transactionReference: booking.payment_reference,
          bookingNotifications,
        });
      } catch (error) {
        console.error('Successful expired checkout could not be reconciled; the appointment slot remains reserved:', error.message);
      }
      continue;
    }
    if (['failed', 'abandoned'].includes(verification.data?.status)) {
      await expirePaymentRequest(pool, booking.id, booking.payment_reference, bookingNotifications);
    }
  }
}

async function expireRescheduleProposal(pool, bookingId, bookingNotifications) {
  const client = await pool.connect();
  let notificationId = null;
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT id, reference, status, full_name, email, service, service_other, preferred_date::text AS preferred_date,
        to_char(preferred_time, 'HH24:MI') AS preferred_time, proposed_previous_status,
        proposed_response_expires_at
       FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId],
    );
    if (!found.rowCount || found.rows[0].status !== 'RESCHEDULE_PROPOSED'
      || !found.rows[0].proposed_response_expires_at
      || new Date(found.rows[0].proposed_response_expires_at) > new Date()) {
      await client.query('ROLLBACK');
      return;
    }
    const booking = found.rows[0];
    const restoredStatus = booking.proposed_previous_status || 'PENDING_REVIEW';
    await client.query(
      `UPDATE bookings SET status = $1, proposed_preferred_date = NULL,
        proposed_preferred_time = NULL, proposed_previous_status = NULL,
        proposed_response_token_hash = NULL, proposed_response_expires_at = NULL
       WHERE id = $2`,
      [restoredStatus, bookingId],
    );
    await addExpiryHistory(client, bookingId, 'RESCHEDULE_PROPOSED', restoredStatus);
    if (bookingNotifications) {
      notificationId = await bookingNotifications.enqueue(client, {
        bookingId,
        eventKey: `reschedule_proposal_expired:${bookingId}`,
        eventType: 'RESCHEDULE_PROPOSAL_EXPIRED',
        recipient: booking.email,
        payload: notificationPayload(booking),
      });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  if (notificationId) await bookingNotifications.deliver(notificationId);
}

async function expireReviewRequest(pool, bookingId, bookingNotifications) {
  const client = await pool.connect();
  let notificationId = null;
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT id, reference, status, request_expires_at, full_name, email, service, service_other,
        preferred_date::text AS preferred_date, to_char(preferred_time, 'HH24:MI') AS preferred_time
       FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId],
    );
    if (!found.rowCount || !['NEW', 'PENDING_REVIEW'].includes(found.rows[0].status)
      || !found.rows[0].request_expires_at || new Date(found.rows[0].request_expires_at) > new Date()) {
      await client.query('ROLLBACK');
      return;
    }
    const booking = found.rows[0];
    await client.query(
      `UPDATE bookings SET status = 'EXPIRED' WHERE id = $1`,
      [bookingId],
    );
    await addExpiryHistory(client, bookingId, booking.status, 'EXPIRED');
    if (bookingNotifications) {
      notificationId = await bookingNotifications.enqueue(client, {
        bookingId,
        eventKey: `request_expired:${bookingId}`,
        eventType: 'BOOKING_EXPIRED',
        recipient: booking.email,
        payload: notificationPayload(booking),
      });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  if (notificationId) await bookingNotifications.deliver(notificationId);
}

async function expirePaymentRequest(pool, bookingId, transactionReference, bookingNotifications) {
  const client = await pool.connect();
  let notificationId = null;
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT id, reference, status, payment_status, payment_reference, full_name, email, service,
        service_other, preferred_date::text AS preferred_date,
        to_char(preferred_time, 'HH24:MI') AS preferred_time
       FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId],
    );
    if (!found.rowCount || found.rows[0].status !== 'APPROVED'
      || !['AWAITING_PAYMENT', 'FAILED'].includes(found.rows[0].payment_status)
      || found.rows[0].payment_reference !== transactionReference) {
      await client.query('ROLLBACK');
      return;
    }
    const booking = found.rows[0];
    await client.query(
      `UPDATE bookings SET status = 'EXPIRED', payment_status = 'EXPIRED',
        payment_verification = 'FAILED', payment_expires_at = NULL
       WHERE id = $1`,
      [bookingId],
    );
    await addExpiryHistory(client, bookingId, booking.status, 'EXPIRED');
    await client.query(
      `INSERT INTO booking_activity_history (id, booking_id, action, details)
       VALUES ($1, $2, 'PAYMENT_WINDOW_EXPIRED', $3::jsonb)`,
      [crypto.randomUUID(), bookingId, JSON.stringify({ transactionReference })],
    );
    if (bookingNotifications) {
      notificationId = await bookingNotifications.enqueue(client, {
        bookingId,
        eventKey: `payment_expired:${transactionReference}`,
        eventType: 'BOOKING_EXPIRED',
        recipient: booking.email,
        payload: notificationPayload(booking),
      });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  if (notificationId) await bookingNotifications.deliver(notificationId);
}

async function addExpiryHistory(client, bookingId, previousStatus, status) {
  await client.query(
    `INSERT INTO booking_status_history (id, booking_id, previous_status, status)
     VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), bookingId, previousStatus, status],
  );
  await client.query(
    `INSERT INTO booking_activity_history (id, booking_id, action)
     VALUES ($1, $2, 'BOOKING_EXPIRED')`,
    [crypto.randomUUID(), bookingId],
  );
}

function notificationPayload(booking) {
  return {
    customerName: booking.full_name,
    reference: booking.reference,
    service: booking.service,
    serviceOther: booking.service_other,
    preferredDate: booking.preferred_date,
    preferredTime: booking.preferred_time,
  };
}

function startBookingExpiryWorker(options, intervalMs = 60 * 1000) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await processExpiredBookings(options);
      if (options.bookingNotifications) {
        await options.bookingNotifications.deliverPending();
      }
    } catch (error) {
      console.error('Booking expiry worker failed:', error.message);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { processExpiredBookings, startBookingExpiryWorker };
