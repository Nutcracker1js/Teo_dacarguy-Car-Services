const crypto = require('node:crypto');

async function applyVerifiedPayment({
  pool,
  transaction,
  transactionReference,
  bookingNotifications,
  publicSiteUrl = '',
}) {
  if (!transaction || transaction.status !== 'success'
    || transaction.currency !== 'NGN'
    || !Number.isSafeInteger(transaction.amount)
    || transaction.amount < 100
    || transaction.reference !== transactionReference
    || typeof transaction.metadata?.booking_reference !== 'string') {
    throw paymentError(409, 'Paystack has not verified a valid NGN payment.');
  }

  const client = await pool.connect();
  let notificationId = null;
  let bookingResult;
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const current = await client.query(
      `SELECT id, reference, status, payment_status, payment_reference, payment_verification,
        amount_expected, email, full_name, service, service_other, preferred_date::text AS preferred_date,
        to_char(preferred_time, 'HH24:MI') AS preferred_time
       FROM bookings WHERE payment_reference = $1 FOR UPDATE`,
      [transactionReference],
    );
    if (!current.rowCount) throw paymentError(404, 'This Paystack transaction is not linked to a booking.');
    const booking = current.rows[0];
    if (transaction.metadata.booking_reference !== booking.reference) {
      throw paymentError(409, 'Paystack transaction metadata does not match this booking.');
    }
    if (booking.payment_status === 'PAID' && booking.payment_verification === 'VERIFIED') {
      await client.query('COMMIT');
      transactionStarted = false;
      return { status: 'PAID', bookingStatus: booking.status, alreadyProcessed: true };
    }
    if (!['APPROVED', 'AWAITING_PAYMENT'].includes(booking.status)
      || booking.payment_status !== 'AWAITING_PAYMENT') {
      throw paymentError(409, 'This booking is not awaiting an approved payment.');
    }
    const expectedKobo = Math.round(Number(booking.amount_expected) * 100);
    if (!Number.isSafeInteger(expectedKobo) || transaction.amount !== expectedKobo) {
      throw paymentError(409, 'Paystack payment amount does not match the approved booking price.');
    }
    const receipt = await client.query(
      `INSERT INTO paystack_webhook_receipts (event_key, transaction_reference)
       VALUES ($1, $2)
       ON CONFLICT (event_key) DO NOTHING
       RETURNING event_key`,
      [`charge.success:${transactionReference}`, transactionReference],
    );
    if (!receipt.rowCount) {
      throw paymentError(409, 'This Paystack payment has already been processed.');
    }
    const updated = await client.query(
      `UPDATE bookings
       SET status = 'AWAITING_APPROVAL', payment_status = 'PAID',
         amount_received = $1, payment_verification = 'VERIFIED',
         payment_date = COALESCE(payment_date, NOW()), payment_expires_at = NULL
       WHERE id = $2
       RETURNING status, payment_status, amount_received`,
      [transaction.amount / 100, booking.id],
    );
    await client.query(
      `INSERT INTO booking_status_history (id, booking_id, previous_status, status)
       VALUES ($1, $2, $3, 'AWAITING_APPROVAL')`,
      [crypto.randomUUID(), booking.id, booking.status],
    );
    await client.query(
      `INSERT INTO booking_activity_history (id, booking_id, action, details)
       VALUES ($1, $2, 'PAYMENT_VERIFIED', $3::jsonb)`,
      [crypto.randomUUID(), booking.id, JSON.stringify({
        transactionReference,
        amountNgn: transaction.amount / 100,
        currency: transaction.currency,
      })],
    );
    if (bookingNotifications) {
      notificationId = await bookingNotifications.enqueue(client, {
        bookingId: booking.id,
        eventKey: `payment_success:${transactionReference}`,
        eventType: 'PAYMENT_SUCCESSFUL',
        recipient: booking.email,
        payload: {
          customerName: booking.full_name,
          reference: booking.reference,
          service: booking.service,
          serviceOther: booking.service_other,
          preferredDate: booking.preferred_date,
          preferredTime: booking.preferred_time,
          amountExpected: Number(booking.amount_expected),
          amountReceived: transaction.amount / 100,
          transactionReference,
          status: updated.rows[0].status,
          bookingStatusUrl: createBookingStatusUrl(publicSiteUrl, booking.reference),
        },
      });
    }
    await client.query('COMMIT');
    transactionStarted = false;
    bookingResult = updated.rows[0];
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const email = bookingNotifications && notificationId
    ? await bookingNotifications.deliver(notificationId)
    : { status: 'not_configured' };
  return {
    status: bookingResult.payment_status,
    bookingStatus: bookingResult.status,
    email,
  };
}

function createBookingStatusUrl(publicSiteUrl, reference) {
  try {
    const base = new URL(publicSiteUrl);
    if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) return null;
    const url = new URL('/booking-status.html', base);
    url.searchParams.set('reference', reference);
    return url.toString();
  } catch {
    return null;
  }
}

function paymentError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function recordFailedPayment({ pool, transaction, transactionReference }) {
  if (!transaction || !['failed', 'abandoned'].includes(transaction.status)
    || transaction.reference !== transactionReference
    || typeof transaction.metadata?.booking_reference !== 'string') {
    throw paymentError(409, 'Paystack has not verified a failed or abandoned transaction.');
  }
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const current = await client.query(
      `SELECT id, status, payment_status FROM bookings
       WHERE payment_reference = $1 AND reference = $2 FOR UPDATE`,
      [transactionReference, transaction.metadata.booking_reference],
    );
    if (!current.rowCount || current.rows[0].status !== 'APPROVED') {
      throw paymentError(409, 'Failed payment does not match an active booking checkout.');
    }
    if (current.rows[0].payment_status === 'FAILED') {
      await client.query('COMMIT');
      transactionStarted = false;
      return { status: 'FAILED', alreadyProcessed: true };
    }
    if (current.rows[0].payment_status !== 'AWAITING_PAYMENT') {
      throw paymentError(409, 'Failed payment does not match an active booking checkout.');
    }
    await client.query(
      `UPDATE bookings SET payment_status = 'FAILED', payment_verification = 'FAILED'
       WHERE id = $1`,
      [current.rows[0].id],
    );
    await client.query(
      `INSERT INTO booking_activity_history (id, booking_id, action, details)
       VALUES ($1, $2, 'PAYMENT_FAILED', $3::jsonb)`,
      [crypto.randomUUID(), current.rows[0].id, JSON.stringify({
        transactionReference,
        paymentStatus: transaction.status,
      })],
    );
    await client.query('COMMIT');
    transactionStarted = false;
    return { status: 'FAILED', bookingStatus: 'APPROVED' };
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { applyVerifiedPayment, recordFailedPayment };
