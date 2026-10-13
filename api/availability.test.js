const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getAvailableSlots, reserveBookingSlot } = require('./availability');

const futureDate = '2099-06-15';

test('available times exclude blocked ranges and overlapping reservations', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('booking_working_hours')) {
        if (sql.includes('COUNT(*)')) return { rows: [{ total: 7 }] };
        return { rows: [{ is_open: true, opens_at: '09:00:00', closes_at: '12:00:00' }] };
      }
      if (sql.includes('booking_availability_blocks')) {
        return { rows: [{ starts_at: '10:00:00', ends_at: '11:00:00' }] };
      }
      if (sql.includes('FROM bookings')) {
        return { rows: [{ preferred_time: '09:30:00', duration_minutes: 60 }] };
      }
      if (sql.includes('SELECT duration_minutes FROM booking_service_durations')) {
        return { rowCount: 1, rows: [{ duration_minutes: 60 }] };
      }
      throw new Error(`Unexpected availability query: ${sql}`);
    },
  };

  const result = await getAvailableSlots(pool, futureDate, 'MAINTENANCE');
  assert.equal(result.configured, true);
  assert.deepEqual(result.slots, ['11:00']);
});

test('default schedule offers standard weekday slots and omits reserved times', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('booking_working_hours')) {
        if (sql.includes('COUNT(*)')) return { rows: [{ total: 0 }] };
        return { rows: [] };
      }
      if (sql.includes('booking_availability_blocks')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM bookings')) return { rows: [{ preferred_time: '09:00:00', duration_minutes: 60 }] };
      if (sql.includes('SELECT duration_minutes FROM booking_service_durations')) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected availability query: ${sql}`);
    },
  };

  const result = await getAvailableSlots(pool, futureDate, 'MAINTENANCE');
  assert.equal(result.configured, false);
  assert.ok(result.slots.includes('08:00'));
  assert.ok(!result.slots.includes('09:00'));
  assert.ok(!result.slots.includes('09:30'));
  assert.ok(result.slots.includes('10:00'));
  assert.ok(!result.slots.includes('18:30'));
});

test('slot reservation rejects an overlapping booking while holding the date lock', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('SELECT is_open')) {
        return { rows: [{ is_open: true, opens_at: '09:00:00', closes_at: '17:00:00' }] };
      }
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 7 }] };
      if (sql.includes('SELECT duration_minutes')) return { rows: [{ duration_minutes: 60 }] };
      if (sql.includes('booking_availability_blocks')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM bookings b LEFT JOIN')) return { rows: [{ id: 'reserved' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };

  await assert.rejects(
    reserveBookingSlot(client, {
      preferredDate: futureDate,
      preferredTime: '10:00',
      service: 'MAINTENANCE',
    }),
    /just been reserved/,
  );
  assert.match(statements[0], /pg_advisory_xact_lock/);
});

test('slot reservation uses standard hours when custom hours are not set', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 0 }] };
      if (sql.includes('SELECT is_open')) return { rows: [] };
      if (sql.includes('SELECT duration_minutes')) return { rows: [], rowCount: 0 };
      if (sql.includes('booking_availability_blocks') || sql.includes('FROM bookings b LEFT JOIN')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  await assert.doesNotReject(reserveBookingSlot(client, {
    preferredDate: futureDate,
    preferredTime: '10:00',
    service: 'MAINTENANCE',
  }));
});

test('slot reservation rejects Sunday under the standard schedule', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 0 }] };
      if (sql.includes('SELECT is_open')) return { rows: [] };
      if (sql.includes('SELECT duration_minutes')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
  };

  await assert.rejects(reserveBookingSlot(client, {
    preferredDate: '2099-06-14',
    preferredTime: '10:00',
    service: 'MAINTENANCE',
  }), /not available for appointments/);
});
test('slot reservation allows a valid unoccupied time', async () => {
  const client = {
    async query(sql) {
      if (sql.includes('SELECT is_open')) {
        return { rows: [{ is_open: true, opens_at: '09:00:00', closes_at: '17:00:00' }] };
      }
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 7 }] };
      if (sql.includes('SELECT duration_minutes')) return { rows: [{ duration_minutes: 60 }] };
      if (sql.includes('booking_availability_blocks') || sql.includes('FROM bookings b LEFT JOIN')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  await assert.doesNotReject(reserveBookingSlot(client, {
    preferredDate: futureDate,
    preferredTime: '10:00',
    service: 'MAINTENANCE',
  }));
});
