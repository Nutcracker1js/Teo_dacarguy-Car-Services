require('dotenv').config();
const { createApp } = require('./app');
const { createPool } = require('./db');
const path = require('node:path');
const {
  createCustomerEmailSender,
  createNotificationSender,
  getNotificationReadiness,
} = require('./notifications');
const { createCustomerNotificationService } = require('./customer-notifications');
const { createPaystackGateway } = require('./payments');
const { startBookingExpiryWorker } = require('./booking-expiry');

const port = Number(process.env.PORT || 3000);
const configuredCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigins = [...new Set([
  'https://nutcracker1js.github.io',
  ...configuredCorsOrigins,
])];
const pool = createPool();
const paymentExpiryHours = readHours('PAYMENT_EXPIRY_HOURS', 24);
const bookingReviewTtlHours = readHours('BOOKING_REVIEW_TTL_HOURS', 48);
const notificationReadiness = getNotificationReadiness();
Object.entries(notificationReadiness).forEach(([channel, readiness]) => {
  if (!readiness.configured) {
    console.warn(`Submission ${channel} notifications are not configured; missing: ${readiness.missing.join(', ')}.`);
  }
});
const paymentGateway = createPaystackGateway();
const sendCustomerEmail = createCustomerEmailSender();
if (!sendCustomerEmail.readiness.configured) {
  console.warn(`Customer email notifications are not configured; missing: ${sendCustomerEmail.readiness.missing.join(', ')}.`);
}
const bookingNotifications = createCustomerNotificationService({
  pool,
  sendEmail: sendCustomerEmail,
});
if (!paymentGateway.configured) {
  console.warn('Paystack checkout is not configured; set PAYSTACK_SECRET_KEY before accepting online payments.');
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 16) {
  console.warn('Admin inbox is disabled until ADMIN_USERNAME and an ADMIN_PASSWORD of at least 16 characters are configured.');
}
const uploadDirectory = path.resolve(
  process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'teo-dacarguy-private-uploads'),
);
const serveWebsite = process.env.SERVE_WEBSITE === 'true'
  || (process.env.SERVE_WEBSITE !== 'false' && process.env.NODE_ENV === 'production');
const app = createApp({
  pool,
  corsOrigins,
  uploadDirectory,
  sendNotifications: createNotificationSender(),
  paymentGateway,
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY,
  bookingReviewTtlHours,
  paymentExpiryHours,
  bookingNotifications,
  publicSiteUrl: process.env.PUBLIC_SITE_URL || process.env.RENDER_EXTERNAL_URL || '',
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD,
  trustProxy: process.env.NODE_ENV === 'production' ? 1 : false,
  serveWebsite,
});
const stopExpiryWorker = startBookingExpiryWorker({ pool, paymentGateway, bookingNotifications });
const server = app.listen(port, () => {
  console.log(`API listening on port ${port}.`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  stopExpiryWorker();
  server.close(async (error) => {
    if (error) {
      console.error('HTTP server shutdown failed:', error.message);
      process.exitCode = 1;
    }
    try {
      await pool.end();
    } catch (poolError) {
      console.error('Database pool shutdown failed:', poolError.message);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

function readHours(name, fallback) {
  const configured = process.env[name];
  if (configured === undefined || configured === '') return fallback;
  const value = Number(configured);
  if (!Number.isInteger(value) || value < 1 || value > 720) {
    console.warn(`${name} must be a whole number between 1 and 720; using ${fallback}.`);
    return fallback;
  }
  return value;
}
