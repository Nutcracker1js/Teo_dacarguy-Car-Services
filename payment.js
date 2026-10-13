const paymentLookupForm = document.querySelector('#payment-lookup-form');

if (paymentLookupForm) {
  const referenceInput = document.querySelector('#payment-reference');
  const phoneInput = document.querySelector('#payment-phone');
  const lookupButton = document.querySelector('#payment-lookup-button');
  const errorElement = document.querySelector('#payment-error');
  const resultSection = document.querySelector('#payment-result');
  const checkoutForm = document.querySelector('#payment-checkout-form');
  const checkoutButton = document.querySelector('#payment-checkout-button');
  const apiBaseUrl = document.querySelector('meta[name="api-base-url"]')?.content || '';
  const query = new URLSearchParams(window.location.search);
  referenceInput.value = query.get('reference') || query.get('bookingReference') || '';
  let activeBooking = null;

  const money = (value) => new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 2,
  }).format(Number(value));

  const dateLabel = (value) => {
    if (!value) return 'To be arranged';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.valueOf())
      ? value
      : new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(date);
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

  const renderBooking = (booking) => {
    activeBooking = booking;
    const approved = ['APPROVED', 'CONFIRMED'].includes(booking.status);
    const paid = booking.payment_status === 'PAID';
    const checkoutAllowed = ['UNPAID', 'AWAITING_PAYMENT'].includes(booking.payment_status);
    const amount = Number(booking.amount_expected);
    const hasAmount = Number.isFinite(amount) && amount > 0;
    const appointmentTime = booking.preferred_time
      ? new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit' })
        .format(new Date(`2000-01-01T${booking.preferred_time}:00`))
      : '';

    document.querySelector('#payment-status-label').textContent = paid
      ? 'PAYMENT VERIFIED'
      : approved && hasAmount
        ? 'PAYMENT READY'
        : 'BOOKING UPDATE';
    document.querySelector('#payment-status-title').textContent = paid
      ? 'Payment received.'
      : approved && hasAmount
        ? 'Review your payment.'
        : 'Payment is not available yet.';
    document.querySelector('#payment-booking-reference').textContent = booking.reference;
    document.querySelector('#payment-service').textContent =
      booking.service_other || serviceLabels[booking.service] || booking.service;
    document.querySelector('#payment-appointment').textContent =
      [dateLabel(booking.preferred_date), appointmentTime].filter(Boolean).join(' · ') || 'To be arranged';
    document.querySelector('#payment-amount').textContent = hasAmount ? money(amount) : 'To be confirmed';
    document.querySelector('#payment-status').textContent = paid
      ? 'Paid'
      : booking.payment_status === 'AWAITING_PAYMENT'
        ? 'Awaiting payment'
        : booking.payment_status || 'Unpaid';
    document.querySelector('#payment-next-step').textContent = paid
      ? 'Your payment has been verified. Teo will confirm your appointment separately.'
      : !approved
        ? 'Teo will contact you after reviewing your booking. Do not make a payment until you receive approval.'
        : !hasAmount
          ? 'Teo will confirm the final price before you can proceed with payment.'
          : !checkoutAllowed
            ? 'Contact Teo to arrange the next step for this payment.'
            : 'Your booking has been approved. Continue to Paystack to complete the confirmed payment.';
    checkoutForm.hidden = !approved || paid || !hasAmount || !checkoutAllowed;
    resultSection.hidden = false;
  };

  paymentLookupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorElement.hidden = true;
    resultSection.hidden = true;
    activeBooking = null;
    if (!paymentLookupForm.reportValidity()) return;
    lookupButton.disabled = true;
    lookupButton.textContent = 'Checking…';
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/booking-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(paymentLookupForm).entries())),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not check this booking.');
      renderBooking(result.booking);
    } catch (error) {
      errorElement.textContent = error instanceof TypeError
        ? 'Could not reach the booking service. Please try again or contact us on WhatsApp.'
        : error.message;
      errorElement.hidden = false;
    } finally {
      lookupButton.disabled = false;
      lookupButton.textContent = 'Check booking';
    }
  });

  checkoutForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeBooking) return;
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Connecting to Paystack…';
    errorElement.hidden = true;
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/payments/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: activeBooking.reference,
          phone: phoneInput.value,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not start secure checkout.');
      const checkoutUrl = new URL(result.authorizationUrl);
      if (checkoutUrl.origin !== 'https://checkout.paystack.com') {
        throw new Error('The payment provider returned an invalid checkout link.');
      }
      window.location.assign(checkoutUrl.toString());
    } catch (error) {
      errorElement.textContent = error instanceof TypeError
        ? 'Could not reach secure checkout. Please try again or contact Teo.'
        : error.message;
      errorElement.hidden = false;
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Continue to secure payment';
    }
  });
}