const PDFDocument = require('pdfkit');

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
    const document = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Booking slip ${booking.reference}` } });
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.once('error', reject);
    document.once('end', () => resolve(Buffer.concat(chunks)));

    document.rect(0, 0, document.page.width, 108).fill('#111111');
    document.fillColor('#c7a45c').font('Helvetica-Bold').fontSize(12)
      .text('TEO DACARGUY CAR SERVICES', 48, 34, { characterSpacing: 1 });
    document.fillColor('#ffffff').fontSize(22).text('BOOKING SLIP', 48, 57);
    document.moveDown(2);
    document.fillColor('#111111').font('Helvetica-Bold').fontSize(14)
      .text(`Booking reference: ${safeText(booking.reference)}`, { continued: false });
    document.moveDown(0.8);

    addSection(document, 'CUSTOMER', [
      ['Name', booking.full_name],
      ['Phone', booking.phone],
      ['Email', booking.email],
    ]);
    addSection(document, 'SERVICE & APPOINTMENT', [
      ['Service', booking.service_other || booking.service],
      ['Vehicle', [booking.vehicle_year, booking.vehicle_make, booking.vehicle_model].filter(Boolean).join(' ') || 'Not provided'],
      ['Registration', booking.registration || 'Not provided'],
      ['Date', formatDate(booking.preferred_date)],
      ['Time', formatTime(booking.preferred_time)],
      ['Location', booking.location_other || booking.location],
    ]);
    addSection(document, 'PAYMENT & STATUS', [
      ['Booking status', booking.status],
      ['Payment status', booking.amount_expected > 0 ? booking.payment_status : 'NOT REQUIRED'],
      ['Approved price', money(booking.amount_expected)],
      ['Amount paid', money(booking.amount_received)],
      ['Transaction reference', booking.payment_reference || 'Not applicable'],
      ['Issued', new Date().toISOString().slice(0, 10)],
    ]);
    if (booking.appointment_instructions) {
      addSection(document, 'INSTRUCTIONS', [['', booking.appointment_instructions]]);
    }
    document.moveDown(1);
    document.font('Helvetica').fontSize(9).fillColor('#555555')
      .text('Please contact Teo DaCarguy Car Services through the official website if you need to change this appointment. Refunds and cancellations are handled under the published booking policy and applicable Nigerian law.', {
        width: document.page.width - 96,
        lineGap: 3,
      });
    document.end();
  });
}

function addSection(document, title, fields) {
  document.moveDown(0.6);
  document.fillColor('#92743d').font('Helvetica-Bold').fontSize(10).text(title);
  document.moveDown(0.25);
  fields.forEach(([label, value]) => {
    const text = label ? `${label}: ${safeText(value || 'Not provided')}` : safeText(value || '');
    document.fillColor('#222222').font('Helvetica').fontSize(10).text(text, { width: document.page.width - 96 });
  });
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
