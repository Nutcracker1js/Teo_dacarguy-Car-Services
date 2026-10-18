const paymentLookupForm = document.querySelector('#payment-lookup-form');

if (paymentLookupForm) {
  const referenceInput = document.querySelector('#payment-reference');
  const phoneInput = document.querySelector('#payment-phone');
  const lookupButton = document.querySelector('#payment-lookup-button');
  const errorElement = document.querySelector('#payment-error');
  const resultSection = document.querySelector('#payment-result');
  const checkoutForm = document.querySelector('#payment-checkout-form');
  const checkoutButton = document.querySelector('#payment-checkout-button');
  const configuredApiBaseUrl = document.querySelector('meta[name="api-base-url"]')?.content.trim() || '';
  const isLocalWebsite = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const hostedApiBaseUrl = window.location.hostname === 'nutcracker1js.github.io'
    ? 'https://teo-dacarguy-car-services.onrender.com'
    : '';
  const apiBaseUrl = (configuredApiBaseUrl
    || (isLocalWebsite ? `${window.location.protocol}//${window.location.hostname}:3000` : '')
    || hostedApiBaseUrl)
    .replace(/\/$/, '');
  const query = new URLSearchParams(window.location.search);
  referenceInput.value = query.get('reference') || query.get('bookingReference') || '';
  const savedBooking = referenceInput.value
    ? window.bookingBrowserStorage?.getBooking(referenceInput.value)
    : window.bookingBrowserStorage?.getLatestBooking();
  if (!referenceInput.value && savedBooking) referenceInput.value = savedBooking.reference;
  if (savedBooking) phoneInput.value = savedBooking.phone;
  let activeBooking = null;
  let inlineCheckout = null;
  let legacyCheckoutUrl = null;
  let pendingTransactionReference = null;
  let checkoutAttempt = 0;

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

  const showError = (message) => {
    errorElement.textContent = message;
    errorElement.hidden = false;
  };

  const prepareCheckout = async (booking) => {
    const attempt = ++checkoutAttempt;
    inlineCheckout = null;
    legacyCheckoutUrl = null;
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Preparing secure checkout…';
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/payments/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: booking.reference, phone: phoneInput.value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not prepare secure checkout.');
      if (attempt !== checkoutAttempt) return;
      if (result.authorizationUrl) {
        const checkoutUrl = new URL(result.authorizationUrl);
        if (checkoutUrl.origin !== 'https://checkout.paystack.com') {
          throw new Error('The payment provider returned an invalid checkout link.');
        }
        legacyCheckoutUrl = checkoutUrl.toString();
      } else if (typeof result.publicKey === 'string'
        && /^pk_(test|live)_[A-Za-z0-9]+$/.test(result.publicKey)
        && typeof result.reference === 'string'
        && /^[A-Za-z0-9._=-]{1,100}$/.test(result.reference)
        && Number.isSafeInteger(result.amount) && result.amount >= 100
        && result.currency === 'NGN'
        && typeof result.email === 'string') {
        inlineCheckout = result;
      } else {
        throw new Error('The payment service returned incomplete checkout details.');
      }
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Pay with Paystack';
      errorElement.hidden = true;
    } catch (error) {
      if (attempt !== checkoutAttempt) return;
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Try payment again';
      showError(error instanceof TypeError
        ? 'Could not reach secure checkout. Please try again or contact Teo.'
        : error.message);
    }
  };

  const verifyInlinePayment = async (transactionReference) => {
    pendingTransactionReference = transactionReference;
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Verifying payment…';
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/payments/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: activeBooking.reference,
          phone: phoneInput.value,
          transactionReference,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Paystack has not verified this payment yet.');
      if (!['PAID', 'FAILED'].includes(result.paymentStatus)) {
        throw new Error('Payment is still being confirmed. Please check your booking again shortly.');
      }
      const statusResponse = await fetch(`${apiBaseUrl}/api/v1/booking-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: activeBooking.reference, phone: phoneInput.value }),
      });
      const statusResult = await statusResponse.json();
      if (!statusResponse.ok) throw new Error(statusResult.error || 'Payment was verified, but the booking status could not be refreshed.');
      pendingTransactionReference = null;
      renderBooking(statusResult.booking);
    } catch (error) {
      showError(error instanceof TypeError
        ? 'Could not reach the payment verification service. Please check your booking again shortly.'
        : error.message);
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Check payment status';
    }
  };

  const renderBooking = (booking) => {
    activeBooking = booking;
    const approved = ['APPROVED', 'CONFIRMED'].includes(booking.status);
    const paid = booking.payment_status === 'PAID';
    const checkoutAllowed = ['UNPAID', 'AWAITING_PAYMENT', 'FAILED', 'EXPIRED'].includes(booking.payment_status);
    const amount = Number(booking.amount_expected);
    const hasAmount = Number.isFinite(amount) && amount > 0;
    const appointmentTime = booking.preferred_time
      ? new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit' })
        .format(new Date(`2000-01-01T${booking.preferred_time}:00`))
      : '';

    document.querySelector('#payment-status-label').textContent = paid
      ? 'PAID'
      : approved && hasAmount
        ? 'PAYMENT DUE'
        : 'BOOKING STATUS';
    document.querySelector('#payment-status-title').textContent = paid
      ? 'Payment received'
      : approved && hasAmount
        ? 'Payment details'
        : approved
          ? 'Price pending'
          : 'Awaiting approval';
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
    const nextStep = paid
      ? 'Payment verified. Teo will confirm your appointment separately.'
      : !approved
        ? 'Payment is available after your booking is approved.'
        : !hasAmount
          ? 'Teo will confirm the final price before payment.'
          : !checkoutAllowed
            ? 'Please contact Teo to arrange payment.'
            : ['FAILED', 'EXPIRED'].includes(booking.payment_status)
              ? 'Payment was not completed. You can try again.'
              : '';
    const nextStepElement = document.querySelector('#payment-next-step');
    nextStepElement.textContent = nextStep;
    nextStepElement.hidden = !nextStep;
    checkoutForm.hidden = !approved || paid || !hasAmount || !checkoutAllowed;
    resultSection.hidden = false;
    if (!checkoutForm.hidden) prepareCheckout(booking);
  };

  paymentLookupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorElement.hidden = true;
    resultSection.hidden = true;
    activeBooking = null;
    checkoutAttempt += 1;
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
      window.bookingBrowserStorage?.rememberBooking(
        result.booking.reference,
        phoneInput.value,
      );
      renderBooking(result.booking);
    } catch (error) {
      showError(error instanceof TypeError
        ? 'Could not reach the booking service. Please try again or contact us on WhatsApp.'
        : error.message);
    } finally {
      lookupButton.disabled = false;
      lookupButton.textContent = 'Check booking';
    }
  });

  checkoutForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeBooking) return;
    errorElement.hidden = true;
    if (pendingTransactionReference) {
      await verifyInlinePayment(pendingTransactionReference);
      return;
    }
    if (!inlineCheckout && !legacyCheckoutUrl) {
      await prepareCheckout(activeBooking);
      if (!inlineCheckout && !legacyCheckoutUrl) return;
    }
    if (legacyCheckoutUrl) {
      window.location.assign(legacyCheckoutUrl);
      return;
    }
    if (typeof window.PaystackPop?.setup !== 'function') {
      showError('The secure Paystack checkout could not load. Refresh the page and try again.');
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Pay with Paystack';
      return;
    }
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Connecting to Paystack…';
    try {
      window.PaystackPop.setup({
        key: inlineCheckout.publicKey,
        email: inlineCheckout.email,
        amount: inlineCheckout.amount,
        currency: inlineCheckout.currency,
        ref: inlineCheckout.reference,
        metadata: inlineCheckout.metadata,
        callback: (response) => verifyInlinePayment(response.reference),
        onClose: () => {
          checkoutButton.disabled = false;
          checkoutButton.textContent = 'Continue to secure payment';
        },
      }).openIframe();
    } catch {
      showError('Could not open Paystack checkout. Please try again or contact Teo.');
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Continue to secure payment';
    }
  });

  if (referenceInput.value && phoneInput.value) paymentLookupForm.requestSubmit();
}
