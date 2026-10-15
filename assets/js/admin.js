const configuredApiBaseUrl = document.querySelector('meta[name="api-base-url"]')?.content.trim() || '';
const isLocalWebsite = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const isGitHubPages = window.location.hostname === 'nutcracker1js.github.io';
const hostedApiBaseUrl = isGitHubPages ? 'https://teo-dacarguy-car-services.onrender.com' : '';
const apiBaseUrl = (configuredApiBaseUrl
  || (isLocalWebsite ? `${window.location.protocol}//${window.location.hostname}:3000` : '')
  || hostedApiBaseUrl)
  .replace(/\/$/, '');
const loginForm = document.querySelector('#admin-login');
const inbox = document.querySelector('#admin-inbox');
const message = document.querySelector('#admin-message');
const PAGE_SIZE = 25;
const SERVICES = [
  ['MAINTENANCE', 'Maintenance & repairs'],
  ['DETAILING', 'Detailing'],
  ['WRAPPING', 'Car wrapping'],
  ['TINT', 'Tint / glass fortification'],
  ['UPGRADES', 'Upgrades & modification'],
  ['REGISTRATION', 'Registration'],
  ['OTHER', 'Other'],
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let authorization = '';
let currentOffset = 0;
let currentTotal = 0;
let activePanel = 'dashboard-panel';

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

async function downloadBookingSlip(booking) {
  try {
    const response = await apiRequest(`/api/v1/admin/bookings/${booking.id}/slip`);
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || 'Could not download this booking slip.');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `booking-${reference(booking)}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showMessage(error.message);
  }
}

function encodeCredentials(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

function addText(parent, tag, text, className) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text ?? '';
  parent.append(element);
  return element;
}

function button(text, className, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = text;
  element.addEventListener('click', onClick);
  return element;
}

function dateLabel(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!value) return 'Date not set';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? 'Date unavailable' : date.toLocaleDateString(undefined, options);
}

function timeLabel(value) {
  if (!value) return 'Time not set';
  const [hourText, minuteText] = String(value).slice(0, 5).split(':');
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minuteText} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function statusLabel(value) {
  return String(value || 'NEW').toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value) {
  return value === null || value === undefined ? 'Not set' : `₦${Number(value).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: { Authorization: authorization, ...(options.headers || {}) },
  });
  if (response.status === 401) {
    logout();
    throw new Error('Your admin sign-in expired. Please sign in again.');
  }
  return response;
}

async function getJson(path, errorMessage = 'Could not load booking data.') {
  const response = await apiRequest(path);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || errorMessage);
  return result;
}

async function sendJson(path, method, body, errorMessage) {
  const response = await apiRequest(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || errorMessage);
  return result;
}

function setPanel(panelId) {
  activePanel = panelId;
  document.querySelectorAll('.admin-panel').forEach((panel) => { panel.hidden = panel.id !== panelId; });
  document.querySelectorAll('.admin-nav [data-panel]').forEach((item) => {
    const active = item.dataset.panel === panelId;
    item.classList.toggle('is-active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  showMessage('');
  if (!authorization || inbox.hidden) return;
  if (panelId === 'dashboard-panel') loadDashboard();
  if (panelId === 'bookings-panel') loadBookings();
  if (panelId === 'calendar-panel') {
    loadAvailability();
    loadCalendar();
  }
  if (panelId === 'payments-panel') loadPayments();
  if (panelId === 'customers-panel') loadCustomers();
  if (panelId === 'reviews-panel') loadReviews();
}

function logout() {
  authorization = '';
  currentOffset = 0;
  inbox.hidden = true;
  loginForm.hidden = false;
  loginForm.reset();
  const dialog = document.querySelector('#booking-dialog');
  if (dialog.open) dialog.close();
  setPanel('dashboard-panel');
  showMessage('');
  document.querySelector('#admin-username').focus();
}

function makeBadge(text, className) {
  const badge = document.createElement('span');
  badge.className = `admin-badge ${className}`;
  badge.textContent = statusLabel(text);
  return badge;
}

function serviceName(booking) {
  const known = SERVICES.find(([key]) => key === booking.service);
  return booking.service_other || known?.[1] || booking.service || 'Service not specified';
}

function reference(booking) {
  return booking.reference || `TD-${booking.id.slice(0, 8).toUpperCase()}`;
}

function renderBookingRow(booking) {
  const row = document.createElement('tr');
  const customer = document.createElement('td');
  addText(customer, 'strong', booking.full_name);
  addText(customer, 'small', reference(booking));
  const service = document.createElement('td');
  addText(service, 'strong', serviceName(booking));
  addText(service, 'small', [booking.vehicle_year, booking.vehicle_make, booking.vehicle_model].filter(Boolean).join(' '));
  const appointment = document.createElement('td');
  addText(appointment, 'strong', dateLabel(booking.preferred_date));
  addText(appointment, 'small', timeLabel(booking.preferred_time));
  const bookingStatus = document.createElement('td');
  bookingStatus.append(makeBadge(booking.status, 'booking-status'));
  const paymentStatus = document.createElement('td');
  paymentStatus.append(makeBadge(booking.payment_status, 'payment-status'));
  const actions = document.createElement('td');
  actions.append(button('View booking', 'admin-view-button', () => openBooking(booking.id)));
  actions.append(button('Delete', 'admin-delete-button', () => deleteBooking(booking)));
  row.append(customer, service, appointment, bookingStatus, paymentStatus, actions);
  return row;
}

function buildBookingCard(booking, includePayment = true) {
  const card = document.createElement('article');
  card.className = 'admin-list-card';
  const main = document.createElement('div');
  addText(main, 'strong', booking.full_name);
  addText(main, 'p', `${reference(booking)} · ${serviceName(booking)}`);
  addText(main, 'small', `${dateLabel(booking.preferred_date)} · ${timeLabel(booking.preferred_time)} · ${booking.vehicle_make || ''} ${booking.vehicle_model || ''}`.trim());
  const states = document.createElement('div');
  states.className = 'admin-list-badges';
  states.append(makeBadge(booking.status, 'booking-status'));
  if (includePayment) states.append(makeBadge(booking.payment_status, 'payment-status'));
  card.append(main, states, button('View details', 'admin-view-button', () => openBooking(booking.id)));
  return card;
}

async function loadDashboard() {
  try {
    const [dashboard, newRequests, pendingReview, upcoming, availability] = await Promise.all([
      getJson('/api/v1/admin/dashboard'),
      getJson('/api/v1/admin/bookings?status=NEW&limit=5'),
      getJson('/api/v1/admin/bookings?status=PENDING_REVIEW&limit=5'),
      getJson('/api/v1/admin/bookings?status=APPROVED&limit=5'),
      getJson('/api/v1/admin/availability'),
    ]);
    const summary = dashboard.summary;
    document.querySelector('#metric-review').textContent = summary.awaiting_review;
    document.querySelector('#metric-payment').textContent = summary.awaiting_payment;
    document.querySelector('#metric-approval').textContent = summary.awaiting_approval;
    document.querySelector('#metric-verified').textContent = summary.payments_verified;
    document.querySelector('#metric-upcoming').textContent = summary.upcoming;
    document.querySelector('#metric-upcoming').closest('.admin-metric').querySelector('small').textContent =
      `${summary.upcoming_today} today · ${summary.upcoming} total`;
    const availabilityReady = availability.hours.length === 7
      && availability.hours.some((item) => item.is_open)
      && SERVICES.every(([service]) => availability.durations.some((item) => item.service === service));
    document.querySelector('#availability-setup-alert').hidden = availabilityReady;
    const needsReview = document.querySelector('#dashboard-attention');
    needsReview.replaceChildren();
    [...newRequests.bookings, ...pendingReview.bookings].slice(0, 5)
      .forEach((booking) => needsReview.append(buildBookingCard(booking)));
    if (!newRequests.bookings.length && !pendingReview.bookings.length) addText(needsReview, 'p', 'No bookings are waiting for review.', 'admin-empty');
    const nextAppointments = document.querySelector('#dashboard-upcoming');
    nextAppointments.replaceChildren();
    upcoming.bookings.forEach((booking) => nextAppointments.append(buildBookingCard(booking, false)));
    if (!upcoming.bookings.length) addText(nextAppointments, 'p', 'No upcoming approved appointments.', 'admin-empty');
  } catch (error) {
    showMessage(error.message);
  }
}

async function loadBookings() {
  const list = document.querySelector('#bookings-list');
  list.replaceChildren();
  const query = new URLSearchParams({
    status: document.querySelector('#booking-status-filter').value,
    service: document.querySelector('#booking-service-filter').value,
    paymentStatus: document.querySelector('#booking-payment-filter').value,
    from: document.querySelector('#booking-from-filter').value,
    to: document.querySelector('#booking-to-filter').value,
    search: document.querySelector('#booking-search').value.trim(),
    limit: String(PAGE_SIZE),
    offset: String(currentOffset),
  });
  try {
    const result = await getJson(`/api/v1/admin/bookings?${query}`, 'Could not load bookings.');
    result.bookings.forEach((booking) => list.append(renderBookingRow(booking)));
    currentTotal = result.total;
    document.querySelector('#bookings-count').textContent = `${currentTotal} booking${currentTotal === 1 ? '' : 's'} found`;
    const pages = Math.max(1, Math.ceil(currentTotal / PAGE_SIZE));
    document.querySelector('#bookings-page-label').textContent = `Page ${Math.floor(currentOffset / PAGE_SIZE) + 1} of ${pages}`;
    document.querySelector('#bookings-previous').disabled = currentOffset === 0;
    document.querySelector('#bookings-next').disabled = currentOffset + PAGE_SIZE >= currentTotal;
    if (!result.bookings.length) {
      const row = document.createElement('tr');
      const cell = addText(row, 'td', 'No bookings match these filters.', 'admin-empty');
      cell.colSpan = 6;
      list.append(row);
    }
  } catch (error) {
    showMessage(error.message);
  }
}

async function deleteBooking(booking) {
  const bookingReference = reference(booking);
  if (!window.confirm(`Delete booking ${bookingReference} for ${booking.full_name}?\n\nThis permanently deletes the booking, its status history, notes, payment records and uploaded files.`)) {
    return;
  }
  try {
    const response = await apiRequest(`/api/v1/admin/bookings/${booking.id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not delete this booking.');
    const dialog = document.querySelector('#booking-dialog');
    if (dialog.open) dialog.close();
    if (currentOffset > 0 && currentOffset >= currentTotal - 1) {
      currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
    }
    showMessage(result.cleanupWarning
      ? `Booking ${bookingReference} was deleted, but one or more private files could not be removed: ${result.cleanupWarning}`
      : `Booking ${bookingReference} was deleted.`);
    await loadBookings();
    await loadDashboard();
  } catch (error) {
    showMessage(error.message);
  }
}

function addDetailField(parent, label, value) {
  const item = document.createElement('div');
  item.className = 'booking-detail-field';
  addText(item, 'span', label);
  addText(item, 'strong', value || 'Not provided');
  parent.append(item);
}

function renderDetailSection(parent, title, fields) {
  const section = document.createElement('section');
  section.className = 'booking-detail-section';
  addText(section, 'h3', title);
  const grid = document.createElement('div');
  grid.className = 'booking-detail-grid';
  fields.forEach(([label, value]) => addDetailField(grid, label, value));
  section.append(grid);
  parent.append(section);
  return section;
}

function inputField(form, labelText, type, name, value = '', options = {}) {
  const wrapper = document.createElement('label');
  wrapper.className = 'booking-edit-field';
  addText(wrapper, 'span', labelText);
  let input;
  if (options.values) {
    input = document.createElement('select');
    options.values.forEach(([choice, text]) => input.add(new Option(text, choice)));
  } else {
    input = document.createElement('input');
    input.type = type;
    if (type === 'number') {
      input.min = '0';
      input.step = '0.01';
    }
  }
  input.name = name;
  if (value !== null && value !== undefined) input.value = String(value);
  if (options.required) input.required = true;
  wrapper.append(input);
  form.append(wrapper);
  return input;
}

async function openBooking(id, feedback = null) {
  try {
    const result = await getJson(`/api/v1/admin/bookings/${id}`, 'Could not load this booking.');
    renderBookingDetails(result, feedback);
    const dialog = document.querySelector('#booking-dialog');
    if (!dialog.open) dialog.showModal();
  } catch (error) {
    showMessage(error.message);
  }
}

function renderBookingDetails(result, feedback = null) {
  const booking = result.booking;
  const root = document.querySelector('#booking-dialog-content');
  root.replaceChildren();
  const intro = document.createElement('div');
  intro.className = 'booking-detail-intro';
  addText(intro, 'p', reference(booking));
  intro.append(makeBadge(booking.status, 'booking-status'), makeBadge(booking.payment_status, 'payment-status'));
  root.append(intro);
  if (feedback) {
    const notice = document.createElement('p');
    notice.className = 'booking-action-feedback';
    notice.setAttribute('role', feedback.error ? 'alert' : 'status');
    notice.textContent = feedback.message;
    root.append(notice);
  }
  const customerSection = renderDetailSection(root, 'Customer information', [
    ['Customer', booking.full_name],
    ['Phone', booking.phone],
    ['Email', booking.email],
    ['WhatsApp', booking.whatsapp],
    ['WhatsApp updates', booking.whatsapp_opt_in ? 'Opted in' : 'No consent recorded'],
  ]);
  const contactNumber = String(booking.whatsapp || booking.phone || '').replace(/[^\d]/g, '');
  if (contactNumber) {
    const messageForm = document.createElement('div');
    messageForm.className = 'booking-message-form';
    const defaultMessageType = booking.status === 'APPROVED' && booking.payment_status !== 'PAID'
      ? 'ACCEPTANCE'
      : booking.payment_status === 'PAID' && booking.payment_verification === 'VERIFIED'
        ? 'PAYMENT_VERIFIED'
        : 'CUSTOM';
    let selectedMessageType = defaultMessageType;
    const messageOptions = document.createElement('div');
    messageOptions.className = 'booking-message-options';
    messageOptions.setAttribute('role', 'group');
    messageOptions.setAttribute('aria-label', 'Choose WhatsApp message');
    const messageOptionButtons = [
      ['ACCEPTANCE', 'Booking accepted + payment link'],
      ['PAYMENT_VERIFIED', 'Payment verified'],
      ['CUSTOM', 'Custom message'],
    ].map(([type, label]) => {
      const option = button(label, 'booking-message-option', () => {
        selectedMessageType = type;
        messageOptionButtons.forEach(([optionType, optionButton]) => {
          const active = optionType === type;
          optionButton.classList.toggle('is-active', active);
          optionButton.setAttribute('aria-pressed', String(active));
        });
        customMessage.hidden = type !== 'CUSTOM';
        customMessage.required = type === 'CUSTOM';
      });
      option.setAttribute('aria-pressed', String(type === selectedMessageType));
      return [type, option];
    });
    messageOptionButtons.find(([type]) => type === selectedMessageType)?.[1].classList.add('is-active');
    messageOptionButtons.forEach(([, option]) => messageOptions.append(option));
    messageForm.append(messageOptions);
    const customMessage = document.createElement('textarea');
    customMessage.name = 'message';
    customMessage.rows = 4;
    customMessage.maxLength = 1000;
    customMessage.placeholder = 'Write a message to the customer…';
    customMessage.hidden = selectedMessageType !== 'CUSTOM';
    customMessage.required = selectedMessageType === 'CUSTOM';
    customMessage.setAttribute('aria-label', 'Custom WhatsApp message');
    messageForm.append(customMessage);
    const sendMessage = document.createElement('a');
    sendMessage.className = 'admin-view-button';
    sendMessage.textContent = 'Open WhatsApp with message';
    sendMessage.target = '_blank';
    sendMessage.rel = 'noopener noreferrer';
    sendMessage.href = '#';
    messageForm.append(sendMessage);
    const messageFeedback = document.createElement('p');
    messageFeedback.className = 'booking-message-feedback';
    messageFeedback.setAttribute('role', 'status');
    messageFeedback.setAttribute('aria-live', 'polite');
    messageFeedback.hidden = true;
    messageForm.append(messageFeedback);
    const messageHelp = document.createElement('small');
    messageHelp.textContent = 'Choose a message, then open it as a WhatsApp draft. Review the chat and tap Send in WhatsApp; this admin page never sends the message automatically.';
    messageForm.append(messageHelp);
    sendMessage.addEventListener('click', async (event) => {
      const setMessageFeedback = (text, isError = false) => {
        messageFeedback.textContent = text;
        messageFeedback.classList.toggle('is-error', isError);
        messageFeedback.hidden = !text;
      };
      setMessageFeedback('');
      if (selectedMessageType === 'ACCEPTANCE'
        && (booking.status !== 'APPROVED' || booking.payment_status === 'PAID')) {
        event.preventDefault();
        setMessageFeedback('Approve this unpaid booking before preparing its acceptance and payment link.', true);
        return;
      }
      if (selectedMessageType === 'PAYMENT_VERIFIED'
        && (booking.payment_status !== 'PAID' || booking.payment_verification !== 'VERIFIED')) {
        event.preventDefault();
        setMessageFeedback('Mark the payment as paid and verified before preparing this message.', true);
        return;
      }
      if (selectedMessageType === 'CUSTOM' && !customMessage.value.trim()) {
        event.preventDefault();
        setMessageFeedback('Write a message before opening WhatsApp.', true);
        customMessage.focus();
        return;
      }
      if (!booking.whatsapp_opt_in) {
        event.preventDefault();
        setMessageFeedback('The customer has not opted in to WhatsApp updates.', true);
        return;
      }
      const whatsappNumber = /^0\d{10}$/.test(contactNumber)
        ? `234${contactNumber.slice(1)}`
        : contactNumber;
      if (!/^[1-9]\d{7,14}$/.test(whatsappNumber)) {
        event.preventDefault();
        setMessageFeedback('The customer WhatsApp number is not valid. Add it in international format.', true);
        return;
      }
      let text;
      if (selectedMessageType === 'ACCEPTANCE') {
        const paymentPage = new URL('/payment.html', window.location.origin);
        paymentPage.searchParams.set('reference', booking.reference);
        text = `Hello ${booking.full_name}, your booking request (${reference(booking)}) has been approved.\n\nService: ${serviceName(booking)}\nAppointment: ${dateLabel(booking.preferred_date)} at ${timeLabel(booking.preferred_time)}\n\nReview your confirmed amount and continue to secure payment here: ${paymentPage.toString()}\n\nYour appointment is confirmed after the payment and final approval have been verified.`;
      } else if (selectedMessageType === 'PAYMENT_VERIFIED') {
        text = `Hello ${booking.full_name}, we have verified your payment of ${money(booking.amount_received || booking.amount_expected)} for booking ${reference(booking)}. Thank you.`;
      } else {
        text = customMessage.value.trim();
      }
      sendMessage.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`;
      setMessageFeedback('WhatsApp will open with the message drafted. Review it and tap Send in WhatsApp.');
    });
    customerSection.append(messageForm);
  }
  const tintNames = {
    'classic-smoke': 'Classic smoke / charcoal',
    'blue-green': 'Blue or green tint',
    'bronze-coloured': 'Bronze / coloured finish',
    ceramic: 'Ceramic colour options',
  };
  const locationNames = {
    OUR_LOCATION: 'At our location',
    HOME_SERVICE: 'Home service visit',
    PICKUP: 'Vehicle pickup',
    INTERSTATE: 'Interstate travel',
    OTHER: 'Other',
  };
  renderDetailSection(root, 'What the customer requested', [
    ['Service', serviceName(booking)],
    ...(booking.service_option ? [['Selected option', tintNames[booking.service_option] || booking.service_option]] : []),
    ['Vehicle', [booking.vehicle_year, booking.vehicle_make, booking.vehicle_model].filter(Boolean).join(' ')],
    ['Registration', booking.registration],
    ['Location', [locationNames[booking.location] || booking.location, booking.location_other].filter(Boolean).join(' · ')],
    ['Customer details', booking.details],
    ['Request received', booking.created_at ? new Date(booking.created_at).toLocaleString() : 'Not recorded'],
  ]);
  renderDetailSection(root, 'Appointment date and time', [
    ['Requested date', dateLabel(booking.preferred_date)],
    ['Requested time', timeLabel(booking.preferred_time)],
  ]);
  const paymentSection = document.createElement('section');
  paymentSection.className = 'booking-detail-section';
  addText(paymentSection, 'h3', 'Payment status');
  const paymentInfo = document.createElement('div');
  paymentInfo.className = 'booking-detail-grid';
  addDetailField(paymentInfo, 'Status', statusLabel(booking.payment_status));
  addDetailField(paymentInfo, 'Amount expected', money(booking.amount_expected));
  addDetailField(paymentInfo, 'Amount received', money(booking.amount_received));
  paymentSection.append(paymentInfo);
  if (Array.isArray(booking.attachments) && booking.attachments.length) {
    const requestFiles = document.createElement('details');
    requestFiles.className = 'booking-detail-disclosure';
    addText(requestFiles, 'summary', `Booking files (${booking.attachments.length})`);
    const attachments = document.createElement('div');
    attachments.className = 'admin-attachment-list';
    booking.attachments.forEach((item) => attachments.append(button(`Download ${item.originalName}`, 'admin-attachment', () => downloadAttachment(item))));
    requestFiles.append(attachments);
    root.append(requestFiles);
  }
  const paymentExtras = document.createElement('details');
  paymentExtras.className = 'booking-detail-disclosure';
  addText(paymentExtras, 'summary', 'Receipts and transaction details');
  if (Array.isArray(result.paymentDocuments) && result.paymentDocuments.length) {
    const documents = document.createElement('div');
    documents.className = 'admin-attachment-list';
    result.paymentDocuments.forEach((documentItem) => {
      documents.append(button(`View ${documentItem.originalName}`, 'admin-attachment', () => downloadPaymentDocument(documentItem)));
    });
    paymentExtras.append(documents);
  }
  const paymentDocumentForm = document.createElement('form');
  paymentDocumentForm.className = 'admin-document-form';
  const documentInput = document.createElement('input');
  documentInput.type = 'file';
  documentInput.name = 'document';
  documentInput.accept = 'application/pdf,image/jpeg,image/png,image/webp';
  documentInput.required = true;
  documentInput.setAttribute('aria-label', 'Transaction receipt or booking slip');
  const uploadDocument = document.createElement('button');
  uploadDocument.type = 'submit';
  uploadDocument.className = 'admin-view-button';
  uploadDocument.textContent = 'Upload receipt / booking slip';
  paymentDocumentForm.append(documentInput, uploadDocument);
  paymentDocumentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!documentInput.files.length) return;
    uploadDocument.disabled = true;
    try {
      const response = await apiRequest(`/api/v1/admin/bookings/${booking.id}/payment-documents`, {
        method: 'POST',
        body: new FormData(paymentDocumentForm),
      });
      const uploaded = await response.json();
      if (!response.ok) throw new Error(uploaded.error || 'Could not upload payment document.');
      await openBooking(booking.id);
    } catch (error) {
      showMessage(error.message);
    } finally {
      uploadDocument.disabled = false;
    }
  });
  paymentExtras.append(paymentDocumentForm);
  const paymentForm = document.createElement('form');
  paymentForm.className = 'booking-edit-form';
  const paymentStatusValues = [[booking.payment_status, statusLabel(booking.payment_status)]];
  if (['PAID', 'REFUND_PENDING'].includes(booking.payment_status)) {
    paymentStatusValues.push(['REFUND_PENDING', 'Refund pending'], ['REFUNDED', 'Refunded']);
  }
  const paymentStatus = inputField(paymentForm, 'Payment status', 'select', 'paymentStatus', booking.payment_status, {
    values: [...new Map(paymentStatusValues.map((item) => [item[0], item])).values()],
  });
  const expectedAmountField = inputField(
    paymentForm,
    booking.fixed_price === null || booking.fixed_price === undefined
      ? 'Amount expected (₦)'
      : 'Fixed price (₦)',
    'number',
    'amountExpected',
    booking.fixed_price ?? booking.amount_expected ?? '',
  );
  if ((booking.fixed_price !== null && booking.fixed_price !== undefined)
    || ['AWAITING_PAYMENT', 'PAID', 'REFUND_PENDING', 'REFUNDED'].includes(booking.payment_status)) {
    expectedAmountField.readOnly = true;
    expectedAmountField.title = 'Approved service price cannot be changed while payment is active or verified.';
  }
  const amountReceivedField = inputField(paymentForm, 'Amount received (₦)', 'number', 'amountReceived', booking.amount_received ?? 0);
  amountReceivedField.readOnly = true;
  const paymentAdvanced = document.createElement('details');
  paymentAdvanced.className = 'booking-detail-disclosure';
  addText(paymentAdvanced, 'summary', 'More payment fields');
  inputField(paymentAdvanced, 'Customer email for Paystack', 'email', 'email', booking.email || '');
  // Keep references and verification visible only when staff expand payment details.
  const advancedFields = document.createElement('div');
  advancedFields.className = 'booking-edit-form';
  const paymentReferenceField = inputField(advancedFields, 'Transaction reference', 'text', 'reference', booking.payment_reference || '');
  paymentReferenceField.readOnly = true;
  const verificationField = inputField(advancedFields, 'Verification', 'select', 'verification', booking.payment_verification || 'UNVERIFIED', {
    values: [['UNVERIFIED', 'Unverified'], ['VERIFIED', 'Verified'], ['FAILED', 'Failed']],
  });
  verificationField.disabled = true;
  inputField(advancedFields, 'Refund status', 'select', 'refundStatus', booking.refund_status || 'NONE', {
    values: [['NONE', 'None'], ['INITIATED', 'Initiated'], ['COMPLETED', 'Completed']],
  });
  paymentAdvanced.append(advancedFields);
  paymentForm.append(paymentAdvanced);
  const savePayment = document.createElement('button');
  savePayment.className = 'admin-view-button';
  savePayment.textContent = 'Save payment details';
  paymentForm.append(savePayment);
  paymentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    savePayment.disabled = true;
    try {
      const data = new FormData(paymentForm);
      await sendJson(`/api/v1/admin/bookings/${booking.id}/payment`, 'PATCH', {
        paymentStatus: paymentStatus.value,
        email: data.get('email'),
        amountExpected: data.get('amountExpected') === '' ? null : Number(data.get('amountExpected')),
        amountReceived: Number(booking.amount_received || 0),
        reference: booking.payment_reference,
        verification: booking.payment_verification,
        refundStatus: advancedData.get('refundStatus'),
      }, 'Could not update payment details.');
      await openBooking(booking.id);
      await refreshCurrentPanel();
    } catch (error) {
      showMessage(error.message);
    } finally {
      savePayment.disabled = false;
    }
  });
  paymentSection.append(paymentForm);
  paymentSection.append(paymentExtras);

  const actions = document.createElement('section');
  actions.className = 'booking-detail-section';
  addText(actions, 'h3', 'Booking status');
  const statusForm = document.createElement('form');
  statusForm.className = 'booking-edit-form booking-status-form';
  const statusChoices = [
    ['NEW', 'New request'],
    ['APPROVED', 'Approved'],
    ['RESCHEDULE_PROPOSED', 'Propose another appointment time'],
    ['CONFIRMED', 'Confirm appointment'],
    ['DECLINED', 'Declined'],
    ['COMPLETED', 'Completed'],
    ['CANCELLED', 'Cancelled'],
  ];
  if (!statusChoices.some(([status]) => status === booking.status)) {
    statusChoices.splice(1, 0, [booking.status, statusLabel(booking.status)]);
  }
  const nextStatus = inputField(statusForm, 'Booking status', 'select', 'status', booking.status, {
    values: statusChoices,
  });
  const resolution = inputField(statusForm, 'Resolution for paid booking', 'select', 'resolution', booking.resolution || '', {
    values: [['', 'Choose an action'], ['RESCHEDULE', 'Offer rescheduling'], ['INITIATE_REFUND', 'Record refund as initiated']],
  });
  const resolutionField = resolution.closest('.booking-edit-field');
  const proposedDate = inputField(statusForm, 'Proposed date', 'date', 'proposedDate', booking.proposed_preferred_date || '');
  const proposedTime = inputField(statusForm, 'Proposed time', 'time', 'proposedTime', booking.proposed_preferred_time || '');
  const proposedDateField = proposedDate.closest('.booking-edit-field');
  const proposedTimeField = proposedTime.closest('.booking-edit-field');
  const declineReason = inputField(statusForm, 'Customer-facing decline explanation (optional)', 'text', 'declineReason', booking.decline_reason || '');
  declineReason.maxLength = 1000;
  const appointmentInstructions = inputField(statusForm, 'Appointment instructions (optional)', 'text', 'appointmentInstructions', booking.appointment_instructions || '');
  appointmentInstructions.maxLength = 2000;
  const updateStatusFields = () => {
    const isProposing = nextStatus.value === 'RESCHEDULE_PROPOSED';
    proposedDateField.hidden = !isProposing;
    proposedTimeField.hidden = !isProposing;
    proposedDate.required = isProposing;
    proposedTime.required = isProposing;
    declineReason.closest('.booking-edit-field').hidden = nextStatus.value !== 'DECLINED';
    appointmentInstructions.closest('.booking-edit-field').hidden = nextStatus.value !== 'CONFIRMED';
  };
  const updateResolutionVisibility = () => {
    const required = booking.payment_status === 'PAID'
      && ['DECLINED', 'CANCELLED'].includes(nextStatus.value);
    resolutionField.hidden = !required;
    resolution.required = required;
    if (!required) resolution.value = '';
  };
  nextStatus.addEventListener('change', updateStatusFields);
  nextStatus.addEventListener('change', updateResolutionVisibility);
  updateStatusFields();
  updateResolutionVisibility();
  const updateStatus = document.createElement('button');
  updateStatus.className = 'button button-bright';
  updateStatus.textContent = 'Update booking status';
  const statusFeedback = document.createElement('p');
  statusFeedback.className = 'booking-action-feedback';
  statusFeedback.setAttribute('role', 'status');
  statusFeedback.setAttribute('aria-live', 'polite');
  statusFeedback.hidden = true;
  statusForm.append(statusFeedback);
  statusForm.append(updateStatus);
  statusForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    updateStatus.disabled = true;
    updateStatus.textContent = 'Updating booking...';
    statusFeedback.hidden = false;
    statusFeedback.classList.remove('is-error');
    statusFeedback.textContent = 'Saving the booking update and preparing payment/email. This may take a few seconds.';
    showMessage('');
    try {
      const updated = await sendJson(`/api/v1/admin/bookings/${booking.id}/status`, 'PATCH', {
        status: nextStatus.value,
        resolution: resolution.value || undefined,
        declineReason: declineReason.value,
        appointmentInstructions: appointmentInstructions.value,
        ...(nextStatus.value === 'RESCHEDULE_PROPOSED'
          ? { proposedDate: proposedDate.value, proposedTime: proposedTime.value }
          : {}),
      }, 'Could not update booking status.');
      let feedback;
      if (updated.status === 'APPROVED') {
        feedback = updated.paymentCheckout?.status === 'ready'
          ? `Booking approved and payment page prepared. Customer email: ${statusLabel(updated.customerEmail?.status || 'not configured')}.`
          : `Booking approved. Payment page not ready: ${updated.paymentCheckout?.error || 'check payment settings'}. Customer email: ${statusLabel(updated.customerEmail?.status || 'not configured')}.`;
      } else if (updated.customerEmail) {
        feedback = `Booking updated. Customer email: ${statusLabel(updated.customerEmail.status)}.`;
      } else {
        feedback = `Booking status updated to ${statusLabel(updated.status)}.`;
      }
      await openBooking(booking.id, { message: feedback });
      await refreshCurrentPanel();
    } catch (error) {
      statusFeedback.classList.add('is-error');
      statusFeedback.setAttribute('role', 'alert');
      statusFeedback.textContent = error.message;
    } finally {
      updateStatus.disabled = false;
      updateStatus.textContent = 'Update booking status';
    }
  });
  actions.append(statusForm);
  if (booking.status === 'APPROVED' && booking.payment_status !== 'PAID') {
    actions.append(button('Prepare payment page and email customer', 'admin-view-button', async () => {
      try {
        const result = await sendJson(`/api/v1/admin/bookings/${booking.id}/payment-link`, 'POST', {});
        showMessage(`Payment page is ready. Customer email: ${statusLabel(result.customerEmail?.status || 'not configured')}.`);
        await openBooking(booking.id);
      } catch (error) {
        showMessage(error.message);
      }
    }));
  }
  if (booking.status === 'CONFIRMED'
    && (Number(booking.amount_expected || 0) <= 0
      || (booking.payment_status === 'PAID' && booking.payment_verification === 'VERIFIED'))) {
    actions.append(button('Download booking slip PDF', 'admin-view-button', () => downloadBookingSlip(booking)));
  }
  root.append(actions, paymentSection);
  root.append(button('Delete this booking', 'admin-delete-button booking-detail-delete', () => deleteBooking(booking)));

  const notesSection = document.createElement('details');
  notesSection.className = 'booking-detail-section';
  notesSection.className = 'booking-detail-disclosure';
  addText(notesSection, 'summary', 'Internal notes');
  const notesList = document.createElement('div');
  notesList.className = 'admin-list';
  result.notes.forEach((note) => {
    const item = document.createElement('article');
    item.className = 'admin-note';
    addText(item, 'p', note.note);
    addText(item, 'small', new Date(note.created_at).toLocaleString());
    notesList.append(item);
  });
  if (!result.notes.length) addText(notesList, 'p', 'No internal notes yet.', 'admin-empty');
  const noteForm = document.createElement('form');
  noteForm.className = 'admin-note-form';
  const noteInput = document.createElement('textarea');
  noteInput.name = 'note';
  noteInput.maxLength = 3000;
  noteInput.required = true;
  noteInput.placeholder = 'Add a private note for the team…';
  const saveNote = document.createElement('button');
  saveNote.className = 'admin-view-button';
  saveNote.textContent = 'Add internal note';
  noteForm.append(noteInput, saveNote);
  noteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    saveNote.disabled = true;
    try {
      await sendJson(`/api/v1/admin/bookings/${booking.id}/notes`, 'POST', { note: noteInput.value }, 'Could not save internal note.');
      await openBooking(booking.id);
    } catch (error) {
      showMessage(error.message);
    } finally {
      saveNote.disabled = false;
    }
  });
  notesSection.append(notesList, noteForm);
  root.append(notesSection);

  const historySection = document.createElement('details');
  historySection.className = 'booking-detail-disclosure';
  addText(historySection, 'summary', 'Booking status history');
  const historyList = document.createElement('ol');
  historyList.className = 'booking-history';
  result.history.forEach((entry) => {
    const item = document.createElement('li');
    addText(item, 'strong', `${statusLabel(entry.previous_status || 'Request submitted')} → ${statusLabel(entry.status)}`);
    addText(item, 'small', new Date(entry.created_at).toLocaleString());
    if (entry.resolution) addText(item, 'span', `Resolution: ${statusLabel(entry.resolution)}`);
    historyList.append(item);
  });
  if (!result.history.length) addText(historyList, 'li', 'No status history recorded.');
  historySection.append(historyList);
  root.append(historySection);

  const activitySection = document.createElement('details');
  activitySection.className = 'booking-detail-disclosure';
  addText(activitySection, 'summary', 'Activity and customer email delivery');
  const activityList = document.createElement('div');
  activityList.className = 'admin-list';
  (result.activity || []).forEach((entry) => {
    const item = document.createElement('article');
    item.className = 'admin-note';
    addText(item, 'strong', statusLabel(entry.action));
    addText(item, 'small', new Date(entry.created_at).toLocaleString());
    activityList.append(item);
  });
  (result.notifications || []).forEach((notification) => {
    const item = document.createElement('article');
    item.className = 'admin-note';
    addText(item, 'strong', `${statusLabel(notification.event_type)} · ${statusLabel(notification.delivery_status)}`);
    addText(item, 'small', `${notification.attempts} attempt(s)${notification.last_error ? ` · ${notification.last_error}` : ''}`);
    if (notification.delivery_status === 'FAILED') {
      item.append(button('Retry email', 'admin-view-button', async () => {
        try {
          await sendJson(`/api/v1/admin/notifications/${notification.id}/retry`, 'POST', {});
          await openBooking(booking.id);
        } catch (error) {
          showMessage(error.message);
        }
      }));
    }
    activityList.append(item);
  });
  if (!(result.activity || []).length && !(result.notifications || []).length) {
    addText(activityList, 'p', 'No activity or email records yet.', 'admin-empty');
  }
  activitySection.append(activityList);
  root.append(activitySection);
}

async function refreshCurrentPanel() {
  if (activePanel === 'dashboard-panel') await loadDashboard();
  if (activePanel === 'bookings-panel') await loadBookings();
  if (activePanel === 'payments-panel') await loadPayments();
  if (activePanel === 'customers-panel') await loadCustomers();
  if (activePanel === 'calendar-panel') await loadCalendar();
}

async function downloadAttachment(attachment) {
  showMessage('');
  try {
    const response = await apiRequest(`/api/v1/admin/attachments/${attachment.id}`);
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || 'Could not download this attachment.');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.originalName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showMessage(error.message);
  }
}

async function downloadPaymentDocument(documentItem) {
  try {
    const response = await apiRequest(`/api/v1/admin/payment-documents/${documentItem.id}`);
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || 'Could not download payment document.');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = documentItem.originalName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showMessage(error.message);
  }
}

async function loadPayments() {
  const list = document.querySelector('#payments-list');
  list.replaceChildren();
  try {
    const result = await getJson('/api/v1/admin/bookings?limit=100&paymentStatus=ALL&status=ALL');
    const sorted = result.bookings.sort((left, right) => {
      const leftPriority = ['REFUND_PENDING', 'PARTIAL', 'AWAITING_PAYMENT', 'UNPAID'].indexOf(left.payment_status);
      const rightPriority = ['REFUND_PENDING', 'PARTIAL', 'AWAITING_PAYMENT', 'UNPAID'].indexOf(right.payment_status);
      return (leftPriority < 0 ? 4 : leftPriority) - (rightPriority < 0 ? 4 : rightPriority);
    });
    sorted.forEach((booking) => {
      const card = buildBookingCard(booking);
      const summary = document.createElement('div');
      summary.className = 'admin-payment-summary';
      addText(summary, 'span', `Expected ${money(booking.amount_expected)}`);
      addText(summary, 'span', `Received ${money(booking.amount_received)}`);
      addText(summary, 'span', statusLabel(booking.payment_verification));
      card.insertBefore(summary, card.lastChild);
      list.append(card);
    });
    if (!result.bookings.length) addText(list, 'p', 'No payments to manage.', 'admin-empty');
  } catch (error) {
    showMessage(error.message);
  }
}

async function loadCustomers() {
  const tbody = document.querySelector('#customers-list');
  tbody.replaceChildren();
  try {
    const result = await getJson('/api/v1/admin/customers', 'Could not load customers.');
    document.querySelector('#customers-count').textContent = `${result.customers.length} customers`;
    result.customers.forEach((customer) => {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      addText(name, 'strong', customer.full_name);
      const contact = document.createElement('td');
      addText(contact, 'span', customer.phone);
      addText(contact, 'small', customer.whatsapp || customer.email || '');
      const bookings = document.createElement('td');
      addText(bookings, 'strong', customer.booking_count);
      const lastAppointment = document.createElement('td');
      addText(lastAppointment, 'span', dateLabel(customer.last_appointment));
      const actions = document.createElement('td');
      actions.append(button('View booking', 'admin-view-button', () => openBooking(customer.latest_booking_id)));
      row.append(name, contact, bookings, lastAppointment, actions);
      tbody.append(row);
    });
    if (!result.customers.length) {
      const row = document.createElement('tr');
      const cell = addText(row, 'td', 'No customers yet.', 'admin-empty');
      cell.colSpan = 5;
      tbody.append(row);
    }
  } catch (error) {
    showMessage(error.message);
  }
}

function timeInput(row, name, value) {
  const input = document.createElement('input');
  input.type = 'time';
  input.name = name;
  input.value = value || '';
  return input;
}

async function loadAvailability() {
  try {
    const result = await getJson('/api/v1/admin/availability', 'Could not load availability settings.');
    const hours = document.querySelector('#working-hours-fields');
    hours.replaceChildren();
    const byDay = new Map(result.hours.map((item) => [Number(item.weekday), item]));
    const useDefaultHours = result.hours.length !== 7;
    WEEKDAYS.forEach((day, weekday) => {
      const current = byDay.get(weekday);
      const isDefaultOpen = weekday !== 0;
      const row = document.createElement('div');
      row.className = 'admin-hour-row';
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = `open-${weekday}`;
      checkbox.checked = current ? Boolean(current.is_open) : useDefaultHours && isDefaultOpen;
      label.append(checkbox, document.createTextNode(day));
      const opens = timeInput(row, `opens-${weekday}`, current?.opens_at || (useDefaultHours ? '08:00' : ''));
      const closes = timeInput(row, `closes-${weekday}`, current?.closes_at || (useDefaultHours ? '19:00' : ''));
      opens.setAttribute('aria-label', `${day} opens at`);
      closes.setAttribute('aria-label', `${day} closes at`);
      opens.disabled = closes.disabled = !checkbox.checked;
      checkbox.addEventListener('change', () => {
        opens.disabled = closes.disabled = !checkbox.checked;
      });
      row.prepend(label);
      row.append(opens, closes);
      hours.append(row);
    });
    const durations = document.querySelector('#service-duration-fields');
    durations.replaceChildren();
    const byService = new Map(result.durations.map((item) => [item.service, item.duration_minutes]));
    SERVICES.forEach(([key, name]) => {
      const label = document.createElement('label');
      label.className = 'admin-duration-row';
      addText(label, 'span', name);
      const input = document.createElement('input');
      input.type = 'number';
      input.name = `duration-${key}`;
      input.min = '15';
      input.max = '720';
      input.step = '15';
      input.required = true;
      input.value = byService.get(key) || 60;
      label.append(input);
      durations.append(label);
    });
    renderAvailabilityBlocks(result.blocks);
  } catch (error) {
    showMessage(error.message);
  }
}

function renderAvailabilityBlocks(blocks) {
  const list = document.querySelector('#availability-blocks');
  list.replaceChildren();
  blocks.forEach((block) => {
    const item = document.createElement('article');
    item.className = 'admin-block-item';
    const time = block.starts_at ? `${timeLabel(block.starts_at)}–${timeLabel(block.ends_at)}` : 'Full day';
    addText(item, 'div', `${dateLabel(block.blocked_date)} · ${time}${block.reason ? ` · ${block.reason}` : ''}`);
    item.append(button('Remove', 'admin-remove-button', async () => {
      try {
        await sendJson(`/api/v1/admin/availability/blocks/${block.id}`, 'DELETE', {}, 'Could not remove this block.');
        await loadAvailability();
      } catch (error) {
        showMessage(error.message);
      }
    }));
    list.append(item);
  });
  if (!blocks.length) addText(list, 'p', 'No dates are blocked.', 'admin-empty');
}

function getCalendarRange(dateValue, view) {
  const date = new Date(`${dateValue}T12:00:00`);
  let from = new Date(date);
  let to = new Date(date);
  if (view === 'week') {
    from.setDate(date.getDate() - date.getDay());
    to.setDate(from.getDate() + 6);
  } else if (view === 'month') {
    from = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    to = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
  }
  const asDate = (item) => `${item.getFullYear()}-${String(item.getMonth() + 1).padStart(2, '0')}-${String(item.getDate()).padStart(2, '0')}`;
  return { from: asDate(from), to: asDate(to) };
}

async function loadCalendar() {
  const selectedDate = document.querySelector('#calendar-date').value;
  if (!selectedDate) return;
  const range = getCalendarRange(selectedDate, document.querySelector('#calendar-view').value);
  const list = document.querySelector('#calendar-bookings');
  list.replaceChildren();
  try {
    const result = await getJson(`/api/v1/admin/calendar?${new URLSearchParams(range)}`, 'Could not load the calendar.');
    document.querySelector('#calendar-range').textContent = `${dateLabel(range.from)} – ${dateLabel(range.to)} · ${result.bookings.length} appointments`;
    result.bookings.forEach((booking) => list.append(buildBookingCard(booking)));
    if (!result.bookings.length) addText(list, 'p', 'No appointments in this period.', 'admin-empty');
  } catch (error) {
    showMessage(error.message);
  }
}

async function loadReviews() {
  const list = document.querySelector('#admin-reviews');
  list.replaceChildren();
  try {
    const result = await getJson('/api/v1/admin/reviews', 'Could not load reviews.');
    document.querySelector('#admin-reviews-count').textContent = `${result.reviews.length} customer review${result.reviews.length === 1 ? '' : 's'}`;
    result.reviews.forEach((review) => {
      const card = document.createElement('article');
      card.className = 'admin-submission admin-review';
      addText(card, 'h3', review.name);
      addText(card, 'p', `${review.vehicle || 'Vehicle not specified'} · ${review.rating}/5`);
      addText(card, 'p', review.review);
      card.append(button('Delete review', 'admin-remove-button', async () => {
        if (!window.confirm(`Permanently delete the review from ${review.name}?`)) return;
        try {
          await sendJson(`/api/v1/admin/reviews/${review.id}`, 'DELETE', {}, 'Could not delete this review.');
          await loadReviews();
        } catch (error) {
          showMessage(error.message);
        }
      }));
      list.append(card);
    });
    if (!result.reviews.length) addText(list, 'p', 'No customer reviews to manage.', 'admin-empty');
  } catch (error) {
    showMessage(error.message);
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('');
  authorization = `Basic ${encodeCredentials(document.querySelector('#admin-username').value, document.querySelector('#admin-password').value)}`;
  document.querySelector('#admin-password').value = '';
  const submit = loginForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await getJson('/api/v1/admin/dashboard', 'Admin sign-in failed.');
    loginForm.hidden = true;
    inbox.hidden = false;
    setPanel('dashboard-panel');
  } catch (error) {
    authorization = '';
    showMessage(error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll('.admin-nav [data-panel]').forEach((item) => item.addEventListener('click', () => setPanel(item.dataset.panel)));
document.querySelectorAll('[data-open-panel]').forEach((item) => item.addEventListener('click', () => setPanel(item.dataset.openPanel)));
document.querySelectorAll('[data-refresh]').forEach((item) => item.addEventListener('click', refreshCurrentPanel));
document.querySelector('#admin-logout').addEventListener('click', logout);
document.querySelector('#booking-filters').addEventListener('submit', (event) => {
  event.preventDefault();
  currentOffset = 0;
  loadBookings();
});
document.querySelector('#bookings-previous').addEventListener('click', () => {
  currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
  loadBookings();
});
document.querySelector('#bookings-next').addEventListener('click', () => {
  if (currentOffset + PAGE_SIZE < currentTotal) {
    currentOffset += PAGE_SIZE;
    loadBookings();
  }
});
document.querySelector('#calendar-load').addEventListener('click', loadCalendar);
document.querySelector('#calendar-view').addEventListener('change', loadCalendar);
document.querySelector('#booking-dialog .booking-dialog-close').addEventListener('click', () => document.querySelector('#booking-dialog').close());

document.querySelector('#hours-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const hours = WEEKDAYS.map((day, weekday) => {
    const row = form.querySelectorAll('.admin-hour-row')[weekday];
    const inputs = row.querySelectorAll('input');
    return {
      weekday,
      isOpen: inputs[0].checked,
      opensAt: inputs[1].value,
      closesAt: inputs[2].value,
    };
  });
  const durations = SERVICES.map(([service]) => ({
    service,
    durationMinutes: Number(form.querySelector(`[name="duration-${service}"]`).value),
  }));
  try {
    await sendJson('/api/v1/admin/availability/hours', 'PUT', { hours, durations }, 'Could not save availability settings.');
    showMessage('Availability settings saved.');
  } catch (error) {
    showMessage(error.message);
  }
});

document.querySelector('#block-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const startsAt = form.get('startsAt');
  const endsAt = form.get('endsAt');
  if (Boolean(startsAt) !== Boolean(endsAt)) {
    showMessage('Enter both start and end times, or leave both empty to block the full day.');
    return;
  }
  try {
    await sendJson('/api/v1/admin/availability/blocks', 'POST', {
      date: form.get('date'),
      startsAt: startsAt || null,
      endsAt: endsAt || null,
      reason: form.get('reason'),
    }, 'Could not block this time.');
    event.currentTarget.reset();
    await loadAvailability();
    showMessage('Availability block added.');
  } catch (error) {
    showMessage(error.message);
  }
});

const today = new Date();
const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
document.querySelector('#calendar-date').value = todayValue;
document.querySelector('#calendar-date').addEventListener('change', loadCalendar);
