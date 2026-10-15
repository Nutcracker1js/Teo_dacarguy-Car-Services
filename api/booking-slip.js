const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');

const RED = '#c62026';
const BLACK = '#171717';
const MUTED = '#626262';
const RULE = '#dedede';

function canIssueBookingSlip(booking) {
  const amountExpected = Number(booking.amount_expected || 0);
  return booking.status === 'CONFIRMED'
    && (amountExpected <= 0
      || (booking.payment_status === 'PAID' && booking.payment_verification === 'VERIFIED'));
}

function createBookingSlip(booking) {
  if (!canIssueBookingSlip(booking)) {
    throw new Error('A booking slip is available only after final appointment confirmation and any required payment verification.');
  }

  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: [420, 595],
      margin: 28,
      info: { Title: `Booking slip ${booking.reference}`, Author: 'Teo DaCarguy Car Services' },
    });
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.once('error', reject);
    document.once('end', () => resolve(Buffer.concat(chunks)));

    document.rect(0, 0, 420, 92).fill(BLACK);
    const logo = path.join(__dirname, '..', 'images', 'logo-trimmed.png');
    if (fs.existsSync(logo)) document.image(logo, 28, 20, { fit: [52, 52] });
    document.fillColor('#ffffff').font('Helvetica-Bold').fontSize(12)
      .text('TEO DACARGUY', 92, 24, { characterSpacing: 0.6 });
    document.fontSize(9).text('CAR SERVICES', 92, 41, { characterSpacing: 1.2 });
    document.fillColor('#ffffff').fontSize(19).text('BOOKING SLIP', 92, 59);

    let y = 108;
    document.fillColor(RED).font('Helvetica-Bold').fontSize(10).text('BOOKING REFERENCE', 28, y);
    y += 15;
    document.fillColor(BLACK).fontSize(17).text(safeText(booking.reference), 28, y);
    y += 28;

    y = addSection(document, 'CUSTOMER', [
      ['Name', booking.full_name],
      ['Phone', booking.phone],
      ['Email', booking.email],
    ], y);
    y = addSection(document, 'SERVICE & APPOINTMENT', [
      ['Service', booking.service_other || booking.service],
      ['Vehicle', [booking.vehicle_year, booking.vehicle_make, booking.vehicle_model].filter(Boolean).join(' ') || 'Not provided'],
      ['Date & time', `${formatDate(booking.preferred_date)} · ${formatTime(booking.preferred_time)}`],
      ['Location', booking.location_other || booking.location],
    ], y);
    y = addSection(document, 'PAYMENT', [
      ['Payment status', Number(booking.amount_expected || 0) > 0 ? 'Paid · verified' : 'Not required'],
      ['Amount', money(booking.amount_expected)],
      ['Transaction reference', booking.payment_reference || 'Not applicable'],
    ], y);

    document.moveTo(28, 548).lineTo(392, 548).strokeColor(RULE).lineWidth(1).stroke();
    document.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text('Thank you for choosing Teo DaCarguy Car Services. Please contact us through the official website for appointment changes.', 28, 556, {
        width: 364,
        lineGap: 2,
      });
    document.end();
  });
}

function addSection(document, title, fields, startY) {
  let y = startY + 4;
  document.fillColor(RED).font('Helvetica-Bold').fontSize(9).text(title, 28, y);
  y += 17;
  fields.forEach(([label, value]) => {
    const labelText = label ? `${label}: ` : '';
    const text = `${labelText}${safeText(value || 'Not provided')}`;
    document.fillColor(BLACK).font('Helvetica').fontSize(9)
      .text(text, 28, y, { width: 364, lineGap: 1 });
    y = document.y + 3;
  });
  document.moveTo(28, y + 1).lineTo(392, y + 1).strokeColor(RULE).lineWidth(0.6).stroke();
  return y + 5;
}

function safeText(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 2000);
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? `NGN ${amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
    : 'Not required';
}

function formatDate(value) {
  if (!value) return 'To be arranged';
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function formatTime(value) {
  return value ? String(value).slice(0, 5) : 'To be arranged';
}

module.exports = { canIssueBookingSlip, createBookingSlip };
