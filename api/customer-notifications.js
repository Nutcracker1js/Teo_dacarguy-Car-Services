const crypto = require('node:crypto');
const { validEmail } = require('./payments');

function createCustomerNotificationService({ pool, sendEmail }) {
  async function enqueue(client, {
    bookingId,
    eventKey,
    eventType,
    recipient,
    payload,
  }) {
    const result = await client.query(
      `INSERT INTO booking_notifications
        (id, booking_id, event_key, event_type, recipient, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (event_key) DO NOTHING
       RETURNING id`,
      [crypto.randomUUID(), bookingId, eventKey, eventType, recipient || null, JSON.stringify(payload)],
    );
    return result.rows[0]?.id || null;
  }

  async function enqueueAndDeliver(input) {
    const client = await pool.connect();
    let notificationId;
    try {
      await client.query('BEGIN');
      notificationId = await enqueue(client, input);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (!notificationId) {
      const existing = await pool.query(
        `SELECT id, delivery_status FROM booking_notifications WHERE event_key = $1`,
        [input.eventKey],
      );
      if (!existing.rowCount) {
        throw new Error('Queued customer email could not be found after a duplicate event.');
      }
      if (['PENDING', 'FAILED'].includes(existing.rows[0].delivery_status)) {
        return deliver(existing.rows[0].id);
      }
      return { status: 'already_queued' };
    }
    return deliver(notificationId);
  }

  async function deliver(notificationId) {
    const claim = await pool.query(
      `UPDATE booking_notifications
       SET delivery_status = 'SENDING', attempts = attempts + 1,
         claimed_at = NOW(), last_error = NULL
       WHERE id = $1
         AND (delivery_status IN ('PENDING', 'FAILED')
           OR (delivery_status = 'SENDING' AND claimed_at < NOW() - INTERVAL '10 minutes'))
       RETURNING id, event_type, recipient, payload`,
      [notificationId],
    );
    if (!claim.rowCount) return { status: 'already_sent_or_in_progress' };
    const notification = claim.rows[0];
    if (!validEmail(notification.recipient)) {
      await markFailed(notification.id, 'Customer email is missing or invalid.');
      return { status: 'failed', error: 'Customer email is missing or invalid.' };
    }
    try {
      await sendEmail({
        to: notification.recipient,
        eventType: notification.event_type,
        ...notification.payload,
      });
      await pool.query(
        `UPDATE booking_notifications
         SET delivery_status = 'SENT', sent_at = NOW(), claimed_at = NULL
         WHERE id = $1 AND delivery_status = 'SENDING'`,
        [notification.id],
      );
      return { status: 'sent' };
    } catch (error) {
      const message = safeErrorMessage(error);
      await markFailed(notification.id, message);
      console.error(JSON.stringify({
        level: 'error',
        message: 'Customer email delivery failed.',
        notificationId: notification.id,
        eventType: notification.event_type,
        error: message,
      }));
      return { status: 'failed', error: 'Email could not be delivered. An administrator can retry it.' };
    }
  }

  async function markFailed(notificationId, message) {
    await pool.query(
      `UPDATE booking_notifications
       SET delivery_status = 'FAILED', last_error = $2, claimed_at = NULL
       WHERE id = $1 AND delivery_status = 'SENDING'`,
      [notificationId, message.slice(0, 1000)],
    );
  }

  async function deliverPending(limit = 20) {
    const pending = await pool.query(
      `SELECT id FROM booking_notifications
       WHERE delivery_status = 'PENDING'
          OR (delivery_status = 'SENDING' AND claimed_at < NOW() - INTERVAL '10 minutes')
       ORDER BY queued_at
       LIMIT $1`,
      [limit],
    );
    return Promise.all(pending.rows.map(({ id }) => deliver(id)));
  }

  return { enqueue, enqueueAndDeliver, deliver, deliverPending };
}

function safeErrorMessage(error) {
  const message = typeof error?.message === 'string' ? error.message : 'Email provider error.';
  return message.replace(/(?:password|token|secret|authorization|smtp:\/\/)[^\s]*/gi, '[redacted]');
}

module.exports = { createCustomerNotificationService };
