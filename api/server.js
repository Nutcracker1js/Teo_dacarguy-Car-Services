require('dotenv').config();
const { createApp } = require('./app');
const { createPool } = require('./db');
const path = require('node:path');
const { createNotificationSender, getNotificationReadiness } = require('./notifications');
const { createPaystackGateway } = require('./payments');

const port = Number(process.env.PORT || 3000);
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const pool = createPool();
const notificationReadiness = getNotificationReadiness();
Object.entries(notificationReadiness).forEach(([channel, readiness]) => {
  if (!readiness.configured) {
    console.warn(`Submission ${channel} notifications are not configured; missing: ${readiness.missing.join(', ')}.`);
  }
});
const paymentGateway = createPaystackGateway();
if (!paymentGateway.configured) {
  console.warn('Paystack checkout is not configured; set PAYSTACK_SECRET_KEY before accepting online payments.');
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 16) {
  console.warn('Admin inbox is disabled until ADMIN_USERNAME and an ADMIN_PASSWORD of at least 16 characters are configured.');
}
const uploadDirectory = path.resolve(
  process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'teo-dacarguy-private-uploads'),
);
const app = createApp({
  pool,
  corsOrigins,
  uploadDirectory,
  sendNotifications: createNotificationSender(),
  paymentGateway,
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD,
  serveWebsite: process.env.SERVE_WEBSITE === 'true',
});
const server = app.listen(port, () => {
  console.log(`API listening on port ${port}.`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
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
