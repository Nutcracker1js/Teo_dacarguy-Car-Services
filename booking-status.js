const statusForm = document.querySelector('#booking-status-form');

if (statusForm) {
  const referenceInput = document.querySelector('#status-reference');
  const errorElement = document.querySelector('#booking-status-error');
  const resultSection = document.querySelector('#booking-status-result');
  const submitButton = statusForm.querySelector('[type="submit"]');
  const paymentForm = document.querySelector('#booking-payment-form');
  const paymentError = document.querySelector('#booking-payment-error');
  const paymentButton = paymentForm.querySelector('[type="submit"]');
  const apiBaseUrl = document.querySelector('meta[name="api-base-url"]')?.content || '';
  const query = new URLSearchParams(window.location.search);
  const requestedReference = query.get('bookingReference') || query.get('reference');
  const transactionReference = query.get('trxref')
    || (query.get('reference') && !query.get('reference').startsWith('TD-') ? query.get('reference') : '');
  if (requestedReference) referenceInput.value = requestedReference;
  if (transactionReference) {
    document.querySelector('#booking-status-intro').textContent =
      'Payment returned from Paystack. Check your booking to verify the payment and view its status.';
  }

  const statusMessages = {
    NEW: ['Request received', 'Your booking request is awaiting review.', 'Teo will contact you after reviewing your request.'],
    PENDING_REVIEW: ['Awaiting review', 'Your booking request is awaiting review.', 'Teo will contact you after reviewing your request.'],
    CONTACTED: ['Update in progress', 'Teo has contacted you about your booking.', 'Please follow the instructions Teo shared with you.'],
    AWAITING_PAYMENT: ['Ready for payment', 'Your booking has been reviewed and is awaiting payment.', 'Teo will share the confirmed amount and payment instructions.'],
    AWAITING_APPROVAL: ['Payment under review', 'Your payment is being verified before final approval.', 'Your appointment is not confirmed until Teo sends the official approval.'],
    CONFIRMED: ['Booking accepted', 'Your booking has been accepted.', 'Teo has confirmed your appointment. Contact us if you need any changes.'],
    APPROVED: ['Booking accepted', 'Your booking has been accepted.', 'Teo has confirmed your appointment. Payment details will be arranged separately if payment is still due.'],
    DECLINED: ['Booking update', 'Teo is unable to accept this booking as requested.', 'Contact Teo using the details below to discuss the next steps.'],
    CANCELLED: ['Booking cancelled', 'This booking has been cancelled.', 'Contact Teo if you need help with rescheduling or a refund.'],
    COMPLETED: ['Service completed', 'This booking is marked as completed.', 'Thank you for choosing Teo DaCarguy Car Services.'],
    CLOSED: ['Booking closed', 'This booking is now closed.', 'Contact Teo if you need further assistance.'],
  };
  const serviceLabels = {
    TINT: 'Tint / Glass Fortification',
    DETAILING: 'Car Detailing',
    MAINTENANCE: 'Maintenance & Repairs',
    WRAPPING: 'Car Wrapping',
    UPGRADES: 'Upgrades & Modification',
    REGISTRATION: 'Registration',
    OTHER: 'Other',
  };

  const dateLabel = (value) => {
    if (!value) return 'To be arranged';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.valueOf())
      ? value
      : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date);
  };

  const money = (value) => new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 2,
  }).format(Number(value));

  const renderBookingStatus = (booking) => {
    const [label, message, nextStep] = statusMessages[booking.status]
      || ['Booking update', 'Your booking status has been updated.', 'Contact Teo if you need further assistance.'];
    document.querySelector('#booking-status-label').textContent = label;
    document.querySelector('#booking-status-message').textContent = message;
    document.querySelector('#booking-status-reference').textContent = booking.reference;
    document.querySelector('#booking-status-service').textContent =
      booking.service_other || serviceLabels[booking.service] || booking.service;
    const time = booking.preferred_time
      ? new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit' })
        .format(new Date(`2000-01-01T${booking.preferred_time}:00`))
      : '';
    document.querySelector('#booking-status-appointment').textContent =
      [dateLabel(booking.preferred_date), time].filter(Boolean).join(' · ') || 'To be arranged';
    const amountExpected = Number(booking.amount_expected);
    const isApproved = ['APPROVED', 'CONFIRMED'].includes(booking.status);
    const isPaid = booking.payment_status === 'PAID';
    document.querySelector('#booking-status-payment').textContent = isPaid
      ? `Paid${booking.amount_received ? ` · ${money(booking.amount_received)}` : ''}`
      : isApproved && Number.isFinite(amountExpected) && amountExpected > 0
        ? `${booking.payment_status === 'AWAITING_PAYMENT' ? 'Payment pending' : 'Payment due'} · ${money(amountExpected)}`
        : isApproved
          ? 'Awaiting confirmed price'
          : 'Payment follows approval';
    document.querySelector('#booking-status-next-step').textContent = isApproved && !isPaid
      ? Number.isFinite(amountExpected) && amountExpected > 0
        ? `Your booking has been accepted. Proceed with the confirmed payment amount below.`
        : 'Your booking has been accepted. Teo will confirm the final price before you can proceed with payment.'
      : isPaid
        ? 'Your payment has been verified. Teo will confirm the appointment separately.'
        : nextStep;
    paymentForm.hidden = !isApproved || isPaid || !Number.isFinite(amountExpected) || amountExpected <= 0;
    resultSection.hidden = false;
  };

  statusForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorElement.hidden = true;
    paymentError.hidden = true;
    resultSection.hidden = true;
    if (!statusForm.reportValidity()) return;
    submitButton.disabled = true;
    submitButton.textContent = 'Checking…';
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/booking-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(statusForm).entries())),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not check this booking.');
      const booking = result.booking;
      if (transactionReference) {
        const verificationResponse = await fetch(`${apiBaseUrl}/api/v1/payments/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reference: booking.reference,
            phone: new FormData(statusForm).get('phone'),
            transactionReference,
          }),
        });
        const verification = await verificationResponse.json();
        if (verificationResponse.ok && verification.paymentStatus === 'PAID') {
          booking.payment_status = 'PAID';
          booking.amount_received = booking.amount_expected;
          document.querySelector('#booking-status-intro').textContent = 'Paystack verified your payment.';
        } else {
          paymentError.textContent = verification.error || 'Payment is not yet confirmed by Paystack.';
          paymentError.hidden = false;
        }
      }
      renderBookingStatus(booking);
    } catch (error) {
      errorElement.textContent = error instanceof TypeError
        ? 'Could not reach the booking service. Please try again or contact us on WhatsApp.'
        : error.message;
      errorElement.hidden = false;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Check status';
    }
  });

  paymentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    paymentError.hidden = true;
    paymentButton.disabled = true;
    paymentButton.textContent = 'Connecting to Paystack…';
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/payments/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: referenceInput.value,
          phone: new FormData(statusForm).get('phone'),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not start Paystack checkout.');
      if (typeof result.authorizationUrl !== 'string'
        || new URL(result.authorizationUrl).origin !== 'https://checkout.paystack.com') {
        throw new Error('Paystack returned an invalid checkout link.');
      }
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      paymentError.textContent = error instanceof TypeError
        ? 'Could not reach secure checkout. Please try again or contact Teo.'
        : error.message;
      paymentError.hidden = false;
      paymentButton.disabled = false;
      paymentButton.textContent = 'Pay with Paystack';
    }
  });
}
