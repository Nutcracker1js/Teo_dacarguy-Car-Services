CREATE TABLE IF NOT EXISTS enquiries (
  id UUID PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  whatsapp VARCHAR(32),
  email VARCHAR(254),
  enquiry_type VARCHAR(80) NOT NULL,
  description VARCHAR(3000) NOT NULL,
  vehicle_make VARCHAR(80),
  vehicle_model VARCHAR(80),
  vehicle_year SMALLINT,
  status VARCHAR(24) NOT NULL DEFAULT 'NEW',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS booking_reference_seq START WITH 999;

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY,
  reference VARCHAR(24) DEFAULT ('TEO-' || nextval('booking_reference_seq')::text),
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  whatsapp VARCHAR(32),
  email VARCHAR(254) NOT NULL,
  whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  vehicle_make VARCHAR(80) NOT NULL,
  vehicle_model VARCHAR(80) NOT NULL,
  vehicle_year SMALLINT,
  registration VARCHAR(32),
  service VARCHAR(32) NOT NULL,
  service_other VARCHAR(120),
  service_option VARCHAR(32),
  preferred_date DATE NOT NULL,
  preferred_time TIME,
  location VARCHAR(32) NOT NULL,
  location_other VARCHAR(240),
  details VARCHAR(3000),
  policy_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  policy_version VARCHAR(160) NOT NULL DEFAULT 'Booking, Cancellation & Refund Policy v1',
  status VARCHAR(24) NOT NULL DEFAULT 'NEW',
  payment_status VARCHAR(24) NOT NULL DEFAULT 'UNPAID',
  amount_expected NUMERIC(12, 2),
  amount_received NUMERIC(12, 2) NOT NULL DEFAULT 0,
  payment_reference VARCHAR(160),
  payment_checkout_url TEXT,
  payment_date TIMESTAMPTZ,
  payment_verification VARCHAR(24) NOT NULL DEFAULT 'UNVERIFIED',
  refund_status VARCHAR(24) NOT NULL DEFAULT 'NONE',
  resolution VARCHAR(24),
  request_expires_at TIMESTAMPTZ,
  payment_expires_at TIMESTAMPTZ,
  slip_token_hash CHAR(64),
  slip_token_expires_at TIMESTAMPTZ,
  proposed_preferred_date DATE,
  proposed_preferred_time TIME,
  proposed_previous_status VARCHAR(24),
  proposed_response_token_hash CHAR(64),
  proposed_response_expires_at TIMESTAMPTZ,
  appointment_instructions VARCHAR(2000),
  decline_reason VARCHAR(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reference VARCHAR(24);
UPDATE bookings
SET reference = 'TD-' || upper(substr(replace(id::text, '-', ''), 1, 12))
WHERE reference IS NULL;
ALTER TABLE bookings ALTER COLUMN reference SET DEFAULT ('TEO-' || nextval('booking_reference_seq')::text);
ALTER TABLE bookings ALTER COLUMN reference SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_reference_idx ON bookings (reference);
SELECT setval(
  'booking_reference_seq',
  GREATEST(
    999,
    COALESCE((SELECT MAX(SUBSTRING(reference FROM 5)::BIGINT)
      FROM bookings WHERE reference ~ '^TEO-[0-9]+$'), 999),
    (SELECT last_value FROM booking_reference_seq)
  ),
  TRUE
);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS policy_accepted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS policy_version VARCHAR(160) NOT NULL DEFAULT 'Booking, Cancellation & Refund Policy v1';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status VARCHAR(24) NOT NULL DEFAULT 'UNPAID';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS amount_expected NUMERIC(12, 2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS amount_received NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(160);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email VARCHAR(254);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_checkout_url TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_option VARCHAR(32);
UPDATE bookings
SET service_option = CASE
  WHEN details LIKE 'Selected tint: Classic smoke / charcoal (%' THEN 'classic-smoke'
  WHEN details LIKE 'Selected tint: Blue or green tint (%' THEN 'blue-green'
  WHEN details LIKE 'Selected tint: Bronze / coloured finish (%' THEN 'bronze-coloured'
  WHEN details LIKE 'Selected tint: Ceramic colour options (%' THEN 'ceramic'
  ELSE service_option
END
WHERE service = 'TINT' AND service_option IS NULL AND details LIKE 'Selected tint:%';
UPDATE bookings
SET amount_expected = CASE service_option
  WHEN 'classic-smoke' THEN 80000
  WHEN 'blue-green' THEN 100000
  WHEN 'bronze-coloured' THEN 110000
  WHEN 'ceramic' THEN 150000
  ELSE amount_expected
END
WHERE service = 'TINT' AND service_option IS NOT NULL AND amount_expected IS NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_verification VARCHAR(24) NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_status VARCHAR(24) NOT NULL DEFAULT 'NONE';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS resolution VARCHAR(24);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS request_expires_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS slip_token_hash CHAR(64);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS slip_token_expires_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS proposed_preferred_date DATE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS proposed_preferred_time TIME;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS proposed_previous_status VARCHAR(24);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS proposed_response_token_hash CHAR(64);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS proposed_response_expires_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS proposed_response VARCHAR(16);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS appointment_instructions VARCHAR(2000);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS decline_reason VARCHAR(1000);

CREATE TABLE IF NOT EXISTS booking_status_history (
  id UUID PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  previous_status VARCHAR(24),
  status VARCHAR(24) NOT NULL,
  resolution VARCHAR(24),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_internal_notes (
  id UUID PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  note VARCHAR(3000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_notifications (
  id UUID PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  event_key VARCHAR(200) NOT NULL UNIQUE,
  event_type VARCHAR(48) NOT NULL,
  recipient VARCHAR(254),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (delivery_status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error VARCHAR(1000),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS paystack_webhook_receipts (
  event_key VARCHAR(200) PRIMARY KEY,
  transaction_reference VARCHAR(160) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_activity_history (
  id UUID PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  action VARCHAR(48) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_payment_documents (
  id UUID PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  storage_key VARCHAR(80) NOT NULL UNIQUE,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(80) NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_working_hours (
  weekday SMALLINT PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  is_open BOOLEAN NOT NULL DEFAULT FALSE,
  opens_at TIME,
  closes_at TIME,
  CHECK ((is_open = FALSE) OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND opens_at < closes_at))
);

CREATE TABLE IF NOT EXISTS booking_service_durations (
  service VARCHAR(32) PRIMARY KEY,
  duration_minutes SMALLINT NOT NULL CHECK (duration_minutes BETWEEN 15 AND 720)
);

CREATE TABLE IF NOT EXISTS booking_availability_blocks (
  id UUID PRIMARY KEY,
  blocked_date DATE NOT NULL,
  starts_at TIME,
  ends_at TIME,
  reason VARCHAR(240) NOT NULL DEFAULT '',
  CHECK ((starts_at IS NULL AND ends_at IS NULL) OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND starts_at < ends_at))
);

CREATE TABLE IF NOT EXISTS submission_attachments (
  id UUID PRIMARY KEY,
  enquiry_id UUID REFERENCES enquiries (id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings (id) ON DELETE CASCADE,
  storage_key VARCHAR(80) NOT NULL UNIQUE,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(80) NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 15728640),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((enquiry_id IS NOT NULL) <> (booking_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  vehicle VARCHAR(80),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review VARCHAR(1500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS enquiries_created_at_idx ON enquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS enquiries_status_idx ON enquiries (status);
CREATE INDEX IF NOT EXISTS bookings_preferred_date_idx ON bookings (preferred_date);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings (status);
CREATE INDEX IF NOT EXISTS bookings_payment_status_idx ON bookings (payment_status);
CREATE INDEX IF NOT EXISTS bookings_schedule_idx ON bookings (preferred_date, preferred_time)
  WHERE preferred_time IS NOT NULL AND status NOT IN ('DECLINED', 'CANCELLED', 'COMPLETED', 'CLOSED');
CREATE INDEX IF NOT EXISTS booking_status_history_booking_idx ON booking_status_history (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS booking_internal_notes_booking_idx ON booking_internal_notes (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS booking_notifications_pending_idx
  ON booking_notifications (delivery_status, queued_at)
  WHERE delivery_status IN ('PENDING', 'FAILED');
CREATE INDEX IF NOT EXISTS booking_activity_history_booking_idx
  ON booking_activity_history (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS booking_payment_documents_booking_idx ON booking_payment_documents (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS booking_availability_blocks_date_idx ON booking_availability_blocks (blocked_date);
CREATE INDEX IF NOT EXISTS submission_attachments_enquiry_idx ON submission_attachments (enquiry_id);
CREATE INDEX IF NOT EXISTS submission_attachments_booking_idx ON submission_attachments (booking_id);
CREATE INDEX IF NOT EXISTS reviews_created_at_idx ON reviews (created_at DESC);
