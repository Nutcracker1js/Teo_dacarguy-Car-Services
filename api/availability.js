const RESERVED_STATUSES = [
  'NEW',
  'PENDING_REVIEW',
  'AWAITING_PAYMENT',
  'AWAITING_APPROVAL',
  'APPROVED',
  'CONFIRMED',
  'RESCHEDULE_PROPOSED',
];
const DEFAULT_OPENING_MINUTES = 8 * 60;
const DEFAULT_CLOSING_MINUTES = 19 * 60;
const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_WORKING_DAYS = new Set([1, 2, 3, 4, 5, 6]);

function toMinutes(value) {
  const [hours, minutes] = value.slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
}

function toTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function lagosDateTime() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function defaultWorkingDay(date) {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return {
    is_open: DEFAULT_WORKING_DAYS.has(weekday),
    opens_at: '08:00:00',
    closes_at: '19:00:00',
  };
}

async function getAvailableSlots(pool, date, service) {
  const [hours, duration, blocks, bookings, configuredDays] = await Promise.all([
    pool.query(
      'SELECT is_open, opens_at::text, closes_at::text FROM booking_working_hours WHERE weekday = EXTRACT(DOW FROM $1::date)::int',
      [date],
    ),
    pool.query('SELECT duration_minutes FROM booking_service_durations WHERE service = $1', [service]),
    pool.query(
      `SELECT starts_at::text, ends_at::text FROM booking_availability_blocks
       WHERE blocked_date = $1`,
      [date],
    ),
    pool.query(
      `SELECT b.preferred_time::text, COALESCE(d.duration_minutes, 60) AS duration_minutes
       FROM bookings b LEFT JOIN booking_service_durations d ON d.service = b.service
       WHERE b.preferred_date = $1 AND b.preferred_time IS NOT NULL
         AND b.status = ANY($2::varchar[])
         AND (b.status NOT IN ('NEW', 'PENDING_REVIEW')
           OR b.request_expires_at IS NULL OR b.request_expires_at > NOW())
       UNION ALL
       SELECT b.proposed_preferred_time::text, COALESCE(d.duration_minutes, 60) AS duration_minutes
       FROM bookings b LEFT JOIN booking_service_durations d ON d.service = b.service
       WHERE b.proposed_preferred_date = $1 AND b.proposed_preferred_time IS NOT NULL
         AND b.status = 'RESCHEDULE_PROPOSED'`,
      [date, RESERVED_STATUSES],
    ),
    pool.query('SELECT COUNT(*)::int AS total FROM booking_working_hours'),
  ]);
  const hasConfiguredSchedule = configuredDays.rows[0]?.total === 7;
  const workingDay = hasConfiguredSchedule ? hours.rows[0] : defaultWorkingDay(date);
  const isConfigured = hasConfiguredSchedule && Boolean(workingDay) && Boolean(duration.rowCount);
  if (!workingDay || !workingDay.is_open) return { configured: isConfigured, slots: [] };
  const durationMinutes = Number(duration.rows[0]?.duration_minutes || DEFAULT_DURATION_MINUTES);
  const { date: today, minutes } = lagosDateTime();
  const currentMinutes = date === today ? minutes : -1;
  if (date < today) return { configured: isConfigured, slots: [] };
  const opening = workingDay.opens_at ? toMinutes(workingDay.opens_at) : DEFAULT_OPENING_MINUTES;
  const closing = workingDay.closes_at ? toMinutes(workingDay.closes_at) : DEFAULT_CLOSING_MINUTES;
  const unavailable = blocks.rows.map((block) => ({
    start: block.starts_at ? toMinutes(block.starts_at) : opening,
    end: block.ends_at ? toMinutes(block.ends_at) : closing,
  }));
  bookings.rows.forEach((booking) => {
    const start = toMinutes(booking.preferred_time);
    unavailable.push({ start, end: start + Number(booking.duration_minutes) });
  });
  const slots = [];
  for (let start = opening; start + durationMinutes <= closing; start += 30) {
    if (start <= currentMinutes) continue;
    if (!unavailable.some((range) => start < range.end && start + durationMinutes > range.start)) {
      slots.push(toTime(start));
    }
  }
  return { configured: isConfigured, slots };
}

async function reserveBookingSlot(client, booking, { excludeBookingId = null } = {}) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [booking.preferredDate]);
  const { rows: hours } = await client.query(
    `SELECT is_open, opens_at::text, closes_at::text FROM booking_working_hours
     WHERE weekday = EXTRACT(DOW FROM $1::date)::int`,
    [booking.preferredDate],
  );
  const { rows: days } = await client.query('SELECT COUNT(*)::int AS total FROM booking_working_hours');
  const { rows: durations } = await client.query(
    'SELECT duration_minutes FROM booking_service_durations WHERE service = $1',
    [booking.service],
  );
  const hasConfiguredSchedule = days[0]?.total === 7;
  const workingDay = hasConfiguredSchedule ? hours[0] : defaultWorkingDay(booking.preferredDate);
  if (!workingDay || !workingDay.is_open) {
    throw availabilityError(409, 'That date is not available for appointments. Choose another date.');
  }
  if (!booking.preferredTime) {
    throw availabilityError(400, 'Choose an available appointment time.');
  }
  const start = toMinutes(booking.preferredTime);
  const duration = Number(durations[0]?.duration_minutes || DEFAULT_DURATION_MINUTES);
  const now = lagosDateTime();
  if (booking.preferredDate < now.date || (booking.preferredDate === now.date && start <= now.minutes)) {
    throw availabilityError(409, 'That appointment time has passed. Choose another available time.');
  }
  const opening = workingDay.opens_at ? toMinutes(workingDay.opens_at) : DEFAULT_OPENING_MINUTES;
  const closing = workingDay.closes_at ? toMinutes(workingDay.closes_at) : DEFAULT_CLOSING_MINUTES;
  if (start < opening || start + duration > closing) {
    throw availabilityError(409, 'That time is outside the service hours. Choose another available time.');
  }
  const blocks = await client.query(
    `SELECT id FROM booking_availability_blocks
     WHERE blocked_date = $1
       AND (starts_at IS NULL OR (starts_at < $3::time AND ends_at > $2::time))
     LIMIT 1`,
    [booking.preferredDate, booking.preferredTime, toTime(start + duration)],
  );
  if (blocks.rowCount) {
    throw availabilityError(409, 'That appointment time is no longer available. Choose another time.');
  }
  const conflicts = await client.query(
    `SELECT b.id
     FROM bookings b LEFT JOIN booking_service_durations d ON d.service = b.service
     WHERE ((b.preferred_date = $1 AND b.preferred_time IS NOT NULL
         AND b.preferred_time < $3::time
         AND b.preferred_time + (COALESCE(d.duration_minutes, 60) * INTERVAL '1 minute') > $2::time
         AND b.status = ANY($4::varchar[])
         AND (b.status NOT IN ('NEW', 'PENDING_REVIEW')
           OR b.request_expires_at IS NULL OR b.request_expires_at > NOW()))
       OR (b.proposed_preferred_date = $1 AND b.proposed_preferred_time IS NOT NULL
         AND b.proposed_preferred_time < $3::time
         AND b.proposed_preferred_time + (COALESCE(d.duration_minutes, 60) * INTERVAL '1 minute') > $2::time
         AND b.status = 'RESCHEDULE_PROPOSED'))
       AND ($5::uuid IS NULL OR b.id <> $5::uuid)
     LIMIT 1`,
    [booking.preferredDate, booking.preferredTime, toTime(start + duration), RESERVED_STATUSES, excludeBookingId],
  );
  if (conflicts.rowCount) {
    throw availabilityError(409, 'That appointment time has just been reserved. Choose another available time.');
  }
}

function availabilityError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = { getAvailableSlots, reserveBookingSlot };
