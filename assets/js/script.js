const menuToggle = document.querySelector('.menu-toggle');
const primaryNavigation = document.querySelector('.primary-navigation');
const dropdownTrigger = document.querySelector('.dropdown-trigger');
const dropdownMenu = document.querySelector('#services-menu');
const siteHeader = document.querySelector('.site-header');

function updateHeaderOnScroll() {
  if (!siteHeader) return;
  siteHeader.classList.toggle('is-scrolled', window.scrollY > 40);
}

if (siteHeader) {
  window.addEventListener('scroll', updateHeaderOnScroll, { passive: true });
  updateHeaderOnScroll();
}

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const revealTargets = document.querySelectorAll(
  '.intro-band > *, .section-heading, .service-item, .service-category, .why-grid article, .process-layout > *, .process-step, .feature-image, .feature-copy, .gallery-heading, .gallery-item, .sourcing-band > *, .advice-band > *, .vehicle-search-image, .vehicle-search-copy, .garage-guide, .client-feedback > *, .home-faq-heading, .home-faq-list details, .contact-band > *',
);

if (!prefersReducedMotion.matches && 'IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-revealed');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -32px 0px' });

  revealTargets.forEach((element, index) => {
    element.classList.add('reveal-on-scroll');
    element.style.setProperty('--reveal-delay', `${(index % 4) * 65}ms`);
    revealObserver.observe(element);
  });
} else {
  revealTargets.forEach((element) => element.classList.add('is-revealed'));
}

function closeDropdown() {
  if (dropdownTrigger) dropdownTrigger.setAttribute('aria-expanded', 'false');
  if (dropdownMenu) dropdownMenu.hidden = true;
}

function closeNavigation() {
  if (!menuToggle || !primaryNavigation) {
    closeDropdown();
    return;
  }
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open navigation');
  primaryNavigation.classList.remove('is-open');
  closeDropdown();
}

if (menuToggle && primaryNavigation) {
  menuToggle.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!isOpen));
    menuToggle.setAttribute('aria-label', isOpen ? 'Open navigation' : 'Close navigation');
    primaryNavigation.classList.toggle('is-open', !isOpen);
  });
}

if (dropdownTrigger && dropdownMenu) {
  dropdownTrigger.addEventListener('click', () => {
    const isOpen = dropdownTrigger.getAttribute('aria-expanded') === 'true';
    dropdownTrigger.setAttribute('aria-expanded', String(!isOpen));
    dropdownMenu.hidden = isOpen;
  });
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('.nav-dropdown')) closeDropdown();
  if (!event.target.closest('.site-header')) closeNavigation();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeNavigation();
    menuToggle?.focus();
  }
});

primaryNavigation?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', closeNavigation);
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 800) closeNavigation();
});

const footerYear = document.querySelector('#year');
if (footerYear) footerYear.textContent = new Date().getFullYear();

const configuredApiBaseUrl = document.querySelector('meta[name="api-base-url"]')?.content.trim() || '';
const isLocalWebsite = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const isGitHubPages = window.location.hostname === 'nutcracker1js.github.io';
const hostedApiBaseUrl = isGitHubPages ? 'https://teo-dacarguy-car-services.onrender.com' : '';
const apiBaseUrl = (configuredApiBaseUrl
  || (isLocalWebsite ? `${window.location.protocol}//${window.location.hostname}:3000` : '')
  || hostedApiBaseUrl)
  .replace(/\/$/, '');
const localApiHelpMessage = 'Open the website at http://localhost:3000, or add this site address to CORS_ORIGINS in .env and restart the API.';

function apiConnectionErrorMessage(service) {
  const message = `Could not reach the ${service} service.`;
  if (window.location.protocol === 'file:' || isLocalWebsite) {
    return `${message} ${localApiHelpMessage}`;
  }
  return `${message} Check your internet connection and try again.`;
}

const reviewTrigger = document.querySelector('.review-trigger');
const reviewModal = document.querySelector('#review-modal');
const reviewForm = document.querySelector('#review-form');
const reviewSuccess = document.querySelector('#review-success');
const reviewCloseButtons = document.querySelectorAll('.review-modal-close, .review-cancel, .review-close-success, [data-close-review-modal]');
const reviewList = document.querySelector('#client-reviews-list');
const reviewsStatus = document.querySelector('#reviews-status');

if (reviewTrigger && reviewModal) {
  const openReviewModal = () => {
    reviewForm.hidden = false;
    reviewSuccess.hidden = true;
    reviewForm.reset();
    const error = reviewForm.querySelector('.review-error');
    if (error) error.hidden = true;
    reviewModal.classList.add('is-open');
    reviewModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  };

  const closeReviewModal = () => {
    reviewModal.classList.remove('is-open');
    reviewModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  reviewTrigger.addEventListener('click', openReviewModal);
  reviewCloseButtons.forEach((button) => {
    button.addEventListener('click', closeReviewModal);
  });

  reviewModal.addEventListener('click', (event) => {
    if (event.target === reviewModal || event.target.matches('[data-close-review-modal]')) closeReviewModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && reviewModal.classList.contains('is-open')) closeReviewModal();
  });

  reviewForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!reviewForm.reportValidity()) return;
    const submitButton = reviewForm.querySelector('[type="submit"]');
    const originalLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';
    const payload = Object.fromEntries(new FormData(reviewForm).entries());

    fetch(`${apiBaseUrl}/api/v1/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) {
          const fieldErrors = result.fields
            ? Object.values(result.fields).join(' ')
            : '';
          throw new Error([result.error, fieldErrors].filter(Boolean).join(' '));
        }
        if (response.status !== 201 || !result.review) {
          throw new Error('The review response was incomplete. Please try again.');
        }
        addReviewCard(result.review, true);
        refreshReviewListLayout();
        reviewsStatus.textContent = `${reviewList.childElementCount} customer review${reviewList.childElementCount === 1 ? '' : 's'}`;
        reviewForm.hidden = true;
        reviewSuccess.hidden = false;
      })
      .catch((error) => {
        const message = reviewForm.querySelector('.review-error');
        message.textContent = error instanceof TypeError
          ? apiConnectionErrorMessage('review')
          : error.message;
        message.hidden = false;
      })
      .finally(() => {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      });
  });

  function refreshReviewListLayout() {
    reviewList.classList.toggle('is-single', reviewList.children.length <= 1);
  }

  async function loadReviews() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/reviews`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load reviews.');
      reviewList.replaceChildren();
      result.reviews.forEach((review) => addReviewCard(review));
      refreshReviewListLayout();
      reviewsStatus.textContent = result.reviews.length
        ? `${result.reviews.length} customer review${result.reviews.length === 1 ? '' : 's'}`
        : 'No reviews yet. Be the first to share your experience.';
    } catch (error) {
      reviewsStatus.textContent = error instanceof TypeError
        ? apiConnectionErrorMessage('review')
        : 'Reviews are temporarily unavailable. Please try again later.';
    }
  }

  function addReviewCard(review, prepend = false) {
    const card = document.createElement('article');
    card.className = 'client-review-card';
    const header = document.createElement('div');
    header.className = 'client-review-header';
    const identity = document.createElement('div');
    const name = document.createElement('h4');
    name.textContent = review.name;
    identity.append(name);
    if (review.vehicle) {
      const vehicle = document.createElement('p');
      vehicle.textContent = review.vehicle;
      identity.append(vehicle);
    }
    const rating = document.createElement('p');
    rating.className = 'client-review-rating';
    rating.textContent = `${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} (${review.rating}/5)`;
    rating.setAttribute('aria-label', `Rated ${review.rating} out of 5`);
    header.append(identity, rating);
    const text = document.createElement('p');
    text.className = 'client-review-text';
    text.textContent = review.review;
    card.append(header, text);
    if (prepend) {
      reviewList.prepend(card);
      if (reviewList.childElementCount > 50) reviewList.lastElementChild.remove();
    } else {
      reviewList.append(card);
    }
    refreshReviewListLayout();
  }

  const reviewError = document.createElement('p');
  reviewError.className = 'review-error';
  reviewError.setAttribute('role', 'alert');
  reviewError.hidden = true;
  reviewForm.querySelector('.review-form-actions').before(reviewError);
  reviewForm.addEventListener('input', () => {
    reviewError.hidden = true;
  });
  loadReviews();
}

const enquiryForm = document.querySelector('#consultation-form');
const apiMethodNotAllowedMessage = 'This website host does not accept API submissions. For local testing, keep the API running on port 3000. For a deployed site, configure api-base-url to the API server or proxy /api requests to it.';

async function postFormSubmission(form, submitButton, errorElement, endpoint, attachments) {
  errorElement.hidden = true;
  if (!form.reportValidity()) return null;

  const payload = new FormData();
  new FormData(form).forEach((value, key) => {
    if (typeof value === 'string') payload.append(key, value);
  });
  attachments.forEach((file) => payload.append('attachments', file, file.name));

  const submitLabel = submitButton.textContent.trim();
  submitButton.disabled = true;
  submitButton.textContent = 'Sending...';
  form.setAttribute('aria-busy', 'true');

  try {
    const response = await fetch(`${apiBaseUrl}${endpoint}`, {
      method: 'POST',
      body: payload,
    });
    let result;
    try {
      result = await response.json();
    } catch {
      if (response.status === 405) throw new Error(apiMethodNotAllowedMessage);
      throw new Error(response.ok
        ? 'The server returned an unreadable response. Please try again.'
        : `The request failed with status ${response.status}. Please try again.`);
    }
    if (!result || typeof result !== 'object') {
      throw new Error('The server returned an unexpected response. Please try again.');
    }

    if (!response.ok) {
      if (response.status === 405) {
        throw new Error(apiMethodNotAllowedMessage);
      }
      const fieldErrors = result.fields
        ? Object.entries(result.fields).map(([field, message]) => `${field}: ${message}`).join(' ')
        : '';
      throw new Error([result.error, fieldErrors].filter(Boolean).join(' '));
    }
    if (response.status !== 201 || typeof result.id !== 'string') {
      throw new Error('The server response was incomplete. Please try again.');
    }

    return result;
  } catch (error) {
    errorElement.textContent = error instanceof TypeError
      ? apiConnectionErrorMessage('submission')
      : error.message;
    errorElement.hidden = false;
    return null;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = submitLabel;
    form.removeAttribute('aria-busy');
  }
}

if (enquiryForm) {
  const enquiryFileInput = document.querySelector('#attachments');
  const enquiryPreviewList = document.querySelector('#upload-preview');
  const enquiryError = document.querySelector('#form-error');
  const enquiryLayout = document.querySelector('.consultation-layout');
  const enquiryConfirmation = document.querySelector('#request-confirmation');
  const resetEnquiry = document.querySelector('#reset-preview');
  const enquiryType = document.querySelector('#enquiry-type');
  const selectedEnquiryFiles = [];

  const enquiryTypes = {
    MAINTENANCE: 'Maintenance & Repairs',
    CAR_SOURCING: 'Car Sales / Sourcing',
    CAR_SALE: 'Car Sales / Sourcing',
    CAR_IMPORTATION: 'Car Sales / Sourcing',
    SPARE_PART: 'Parts',
    VEHICLE_INSPECTION: 'General Enquiry',
    OTHER: 'Other',
  };
  const requestedType = new URLSearchParams(window.location.search).get('type');
  if (enquiryTypes[requestedType]) enquiryType.value = enquiryTypes[requestedType];

  function renderEnquiryFiles() {
    enquiryPreviewList.replaceChildren();
    selectedEnquiryFiles.forEach((file, index) => {
      const item = document.createElement('li');
      item.className = 'upload-preview-item';
      const title = document.createElement('span');
      title.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-upload';
      remove.setAttribute('aria-label', `Remove ${file.name}`);
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        selectedEnquiryFiles.splice(index, 1);
        renderEnquiryFiles();
      });
      item.append(title, remove);
      enquiryPreviewList.append(item);
    });
  }

  enquiryFileInput.addEventListener('change', () => {
    enquiryError.hidden = true;
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']);
    const newFiles = Array.from(enquiryFileInput.files || []);
    const invalid = newFiles.find((file) => !allowedTypes.has(file.type) || file.size > 15 * 1024 * 1024);
    if (invalid) {
      enquiryError.textContent = 'Choose JPG, PNG, WebP, MP4 or MOV files up to 15 MB each.';
      enquiryError.hidden = false;
      enquiryFileInput.value = '';
      return;
    }
    if (selectedEnquiryFiles.length + newFiles.length > 6) {
      enquiryError.textContent = 'You can add up to 6 files.';
      enquiryError.hidden = false;
      enquiryFileInput.value = '';
      return;
    }
    selectedEnquiryFiles.push(...newFiles);
    renderEnquiryFiles();
    enquiryFileInput.value = '';
  });

  enquiryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    postFormSubmission(
      enquiryForm,
      enquiryForm.querySelector('[type="submit"]'),
      enquiryError,
      '/api/v1/enquiries',
      selectedEnquiryFiles,
    ).then((result) => {
      if (!result) return;
      document.querySelector('#request-confirmation-title').textContent = 'Enquiry Submitted';
      const notified = Object.values(result.notifications || {}).includes('sent');
      document.querySelector('#request-confirmation-message').textContent =
        `Your enquiry has been stored${result.attachmentCount ? ` with ${result.attachmentCount} attachment${result.attachmentCount === 1 ? '' : 's'}` : ''}. ${notified ? 'Teo has been notified.' : 'Automatic notifications are not configured or could not be sent; message Teo on WhatsApp and share this reference.'}`;
      document.querySelector('#request-reference').textContent = `Request reference: ${result.id}`;
      enquiryLayout.hidden = true;
      enquiryConfirmation.hidden = false;
      enquiryConfirmation.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  resetEnquiry.addEventListener('click', () => {
    enquiryConfirmation.hidden = true;
    enquiryLayout.hidden = false;
    document.querySelector('#request-reference').textContent = '';
    enquiryForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

const bookingForm = document.querySelector('#booking-form');

if (bookingForm) {
  const bookingLayout = document.querySelector('.consultation-layout');
  const bookingDate = document.querySelector('#booking-date');
  const bookingTime = document.querySelector('#booking-time');
  const bookingFiles = document.querySelector('#booking-attachments');
  const bookingPreviews = document.querySelector('#booking-upload-preview');
  const bookingError = document.querySelector('#booking-form-error');
  const bookingConfirmation = document.querySelector('#booking-confirmation');
  const editBooking = document.querySelector('#edit-booking');
  const bookingService = document.querySelector('#booking-service');
  const bookingLocation = document.querySelector('#booking-location');
  const bookingTintOption = document.querySelector('#booking-tint-option');
  const bookingTintSelection = document.querySelector('#booking-tint-selection');
  const bookingTintPrice = document.querySelector('#booking-tint-price');
  const bookingPolicy = document.querySelector('#booking-policy');
  const bookingPolicyLink = document.querySelector('[data-open-policy]');
  const bookingPolicyModal = document.querySelector('#booking-policy-modal');
  const bookingPolicyCloseButtons = document.querySelectorAll('.booking-policy-close, [data-close-policy]');
  const bookingSubmitButton = document.querySelector('#booking-submit');
  const serviceOtherField = document.querySelector('#booking-service-other');
  const serviceOtherInput = document.querySelector('#booking-service-specify');
  const locationOtherField = document.querySelector('#booking-location-other');
  const locationOtherInput = document.querySelector('#booking-location-specify');
  const selectedBookingFiles = [];
  const bookingStorage = window.bookingBrowserStorage;
  const draftSaveStatus = document.querySelector('#booking-draft-save-status');
  const draftNotice = document.querySelector('#booking-draft-notice');
  const savedFormDraft = bookingStorage?.getDraft() || null;
  let draftSaveTimer;
  let bookingSubmitted = false;
  let restoringBookingDraft = false;
  let availabilityRequestId = 0;
  let tintOptionsRequest;
  let tintOptionsLoaded = false;

  const today = new Date();
  bookingDate.min = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');

  const yearOptions = document.querySelector('#booking-year-options');
  const bookingYear = document.querySelector('#booking-year');
  const currentYear = today.getFullYear();
  bookingYear.max = String(currentYear + 1);
  for (let year = currentYear + 1; year >= 1950; year -= 1) {
    const option = document.createElement('option');
    option.value = String(year);
    yearOptions.append(option);
  }

  function bindConditionalDetails(select, field, input, shouldShow) {
    const updateField = () => {
      const visible = shouldShow(select.value);
      field.hidden = !visible;
      input.disabled = !visible;
      input.required = visible;
      if (!visible) input.value = '';
    };
    select.addEventListener('change', updateField);
    updateField();
  }

  async function loadAvailableBookingTimes() {
    const requestId = ++availabilityRequestId;
    const hint = bookingTime.parentElement.querySelector('.booking-time-hint');
    const renderTimes = (times) => {
      bookingTime.replaceChildren(new Option('Select an available time', ''));
      times.forEach((time) => {
        const [hours, minutes] = time.split(':').map(Number);
        const suffix = hours >= 12 ? 'PM' : 'AM';
        const displayHour = hours % 12 || 12;
        bookingTime.add(new Option(`${displayHour}:${String(minutes).padStart(2, '0')} ${suffix}`, time));
      });
      const restoredTime = bookingTime.dataset.restoreValue;
      if (restoredTime) {
        if (times.includes(restoredTime)) bookingTime.value = restoredTime;
        else hint.textContent = 'Your saved time is no longer available. Please choose an available time.';
        delete bookingTime.dataset.restoreValue;
      }
    };
    bookingTime.replaceChildren(new Option('Loading available times…', ''));
    bookingTime.disabled = true;
    if (!bookingDate.value || !bookingService.value) {
      bookingTime.replaceChildren(new Option('Select a date and service first', ''));
      hint.textContent = 'Available appointment times will appear after you choose a date and service.';
      bookingTime.disabled = false;
      return;
    }
    try {
      const query = new URLSearchParams({ date: bookingDate.value, service: bookingService.value });
      const response = await fetch(`${apiBaseUrl}/api/v1/availability?${query}`);
      const result = await response.json();
      if (requestId !== availabilityRequestId) return;
      if (!response.ok) throw new Error(result.error || 'Could not load available times.');
      renderTimes(result.slots);
      hint.textContent = result.slots.length
        ? result.configured
          ? 'Times shown are available for the selected date and service.'
          : 'Standard hours are shown (Mon–Sat, 8:00 AM–7:00 PM). Teo can customize them in the booking centre.'
        : 'No appointment times are available on this date. Choose another date.';
    } catch (error) {
      if (requestId !== availabilityRequestId) return;
      const selectedDate = new Date(`${bookingDate.value}T00:00:00.000Z`);
      const times = [];
      const weekday = selectedDate.getUTCDay();
      const nowParts = new Intl.DateTimeFormat('en', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date());
      const now = Object.fromEntries(nowParts.map(({ type, value }) => [type, value]));
      const today = `${now.year}-${now.month}-${now.day}`;
      const currentMinutes = Number(now.hour) * 60 + Number(now.minute);
      if (weekday !== 0 && !Number.isNaN(selectedDate.valueOf())) {
        for (let start = 8 * 60; start + 60 <= 19 * 60; start += 30) {
          if (bookingDate.value === today && start <= currentMinutes) continue;
          times.push(`${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`);
        }
      }
      renderTimes(times);
      hint.textContent = times.length
        ? 'Showing standard hours (Mon–Sat, 8:00 AM–7:00 PM). Availability will be checked again when you submit.'
        : 'No appointment times are available on this date. Choose another date.';
    } finally {
      if (requestId === availabilityRequestId) bookingTime.disabled = false;
    }
  }

  bookingDate.addEventListener('change', loadAvailableBookingTimes);
  bookingService.addEventListener('change', loadAvailableBookingTimes);
  const updateTintSelection = () => {
    const isTintService = bookingService.value === 'TINT';
    bookingTintSelection.hidden = !isTintService;
    bookingTintOption.disabled = !isTintService || !tintOptionsLoaded;
    bookingTintOption.required = isTintService;
    if (!isTintService) {
      bookingTintOption.value = '';
      bookingTintPrice.textContent = '';
      return;
    }
    if (tintOptionsLoaded || tintSelectionLoadFailed) return;
    const emptyTintOption = new Option('', '');
    emptyTintOption.disabled = true;
    emptyTintOption.hidden = true;
    emptyTintOption.selected = true;
    bookingTintOption.replaceChildren(emptyTintOption);
    tintOptionsRequest ||= fetch(new URL('tint-options.json', window.location.href))
      .then((response) => {
        if (!response.ok) throw new Error('Could not load tint options.');
        return response.json();
      })
      .then((options) => {
        if (!options || typeof options !== 'object' || Array.isArray(options)
          || !Object.entries(options).length
          || Object.entries(options).some(([, option]) => (
            !option || typeof option.label !== 'string'
            || !Number.isSafeInteger(option.amountNgn) || option.amountNgn <= 0
          ))) {
          throw new Error('Tint prices are unavailable. Please contact Teo for assistance.');
        }
        const money = new Intl.NumberFormat('en-NG', {
          style: 'currency',
          currency: 'NGN',
          maximumFractionDigits: 0,
        });
        const emptyOption = new Option('', '');
        emptyOption.disabled = true;
        emptyOption.hidden = true;
        emptyOption.selected = true;
        bookingTintOption.replaceChildren(emptyOption);
        Object.entries(options).forEach(([value, option]) => {
          bookingTintOption.add(new Option(`${option.label} — ${money.format(option.amountNgn)}`, value));
        });
        tintOptionsLoaded = true;
        const requestedTint = bookingQuery.get('tintOption') || savedFormDraft?.tintOption || '';
        if (requestedTint && Object.hasOwn(options, requestedTint)) {
          bookingTintOption.value = requestedTint;
        } else if (requestedTint) {
          throw new Error('This tint option is no longer available. Please choose another option.');
        }
        bookingTintOption.disabled = bookingService.value !== 'TINT';
        bookingTintPrice.textContent = bookingTintOption.value
          ? `Listed price: ${money.format(options[bookingTintOption.value].amountNgn)}`
          : 'Select a tint type to view its listed price.';
      })
      .catch((error) => {
        tintSelectionLoadFailed = true;
        const emptyOption = new Option('', '');
        emptyOption.disabled = true;
        emptyOption.hidden = true;
        emptyOption.selected = true;
        bookingTintOption.replaceChildren(emptyOption);
        bookingTintOption.disabled = true;
        bookingError.textContent = error.message;
        bookingError.hidden = false;
      });
  };
  bookingTintOption.addEventListener('change', () => {
    if (!tintOptionsLoaded || !bookingTintOption.value) {
      bookingTintPrice.textContent = 'Select a tint type to view its listed price.';
      return;
    }
    const selectedOption = bookingTintOption.selectedOptions[0];
    bookingTintPrice.textContent = selectedOption
      ? `Selected price: ${selectedOption.textContent.split(' — ').at(-1)}`
      : '';
  });
  bookingService.addEventListener('change', () => {
    updateTintSelection();
  });
  const bookingQuery = new URLSearchParams(window.location.search);
  let tintSelectionLoadFailed = false;
  if (bookingQuery.get('service') === 'TINT') {
    bookingService.value = 'TINT';
  }
  bookingTintOption.disabled = bookingService.value !== 'TINT';
  updateTintSelection();

  function syncBookingPolicyButton() {
    if (!bookingPolicy || !bookingSubmitButton) return;
    bookingPolicy.required = true;
    bookingSubmitButton.disabled = !bookingPolicy.checked;
    bookingSubmitButton.setAttribute('aria-disabled', String(!bookingPolicy.checked));
    bookingSubmitButton.title = bookingPolicy.checked ? '' : 'Please read and accept the booking policy before submitting.';
  }

  bindConditionalDetails(bookingService, serviceOtherField, serviceOtherInput, (value) => value === 'OTHER');
  bindConditionalDetails(bookingLocation, locationOtherField, locationOtherInput, (value) => value !== '' && value !== 'OUR_LOCATION');

  function restoreBookingDraft() {
    if (!savedFormDraft) return;
    restoringBookingDraft = true;
    Array.from(bookingForm.elements).forEach((field) => {
      if (!field.name || field.type === 'file' || field.name === 'policyAccepted'
        || !Object.prototype.hasOwnProperty.call(savedFormDraft, field.name)) return;
      if (field.name === 'preferredTime') {
        bookingTime.dataset.restoreValue = savedFormDraft[field.name];
      } else if (field.type === 'checkbox') {
        field.checked = savedFormDraft[field.name] === true;
      } else if (typeof savedFormDraft[field.name] === 'string') {
        field.value = savedFormDraft[field.name];
      }
    });
    bookingService.dispatchEvent(new Event('change'));
    bookingLocation.dispatchEvent(new Event('change'));
    restoringBookingDraft = false;
    draftNotice.textContent = 'Your unfinished booking was restored from this browser. Selected attachments must be chosen again, and policy acceptance is not saved.';
    draftNotice.hidden = false;
  }

  function saveBookingDraft() {
    if (restoringBookingDraft) return;
    if (bookingSubmitted) return;
    if (!bookingStorage) {
      draftSaveStatus.textContent = 'This browser does not support saving an unfinished booking.';
      return;
    }
    const draft = {};
    Array.from(bookingForm.elements).forEach((field) => {
      if (!field.name || field.type === 'file' || field.name === 'policyAccepted') return;
      draft[field.name] = field.type === 'checkbox' ? field.checked : field.value;
    });
    const saved = bookingStorage.saveDraft(draft);
    draftSaveStatus.textContent = saved
      ? 'Your unfinished booking is saved on this device as you fill in the form.'
      : 'This browser could not save your draft. Keep this page open or copy your details before leaving.';
  }

  restoreBookingDraft();
  if (!bookingStorage || !bookingStorage.isAvailable()) {
    draftSaveStatus.textContent = 'This browser blocks local storage, so an unfinished booking cannot be kept after you leave this page.';
    document.querySelector('#booking-local-storage-note').textContent =
      'This browser blocks local storage. Your details will not be remembered after you leave this page.';
  }
  window.addEventListener('booking:clear-local-data', () => {
    window.clearTimeout(draftSaveTimer);
    bookingForm.reset();
    selectedBookingFiles.length = 0;
    renderBookingFiles();
    bookingService.dispatchEvent(new Event('change'));
    bookingLocation.dispatchEvent(new Event('change'));
    bookingPolicy?.dispatchEvent(new Event('change'));
    draftNotice.hidden = true;
    draftSaveStatus.textContent = 'Saved booking and draft details were cleared from this device.';
  });
  window.addEventListener('pagehide', saveBookingDraft);
  bookingForm.addEventListener('input', () => {
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(saveBookingDraft, 250);
  });
  bookingForm.addEventListener('change', saveBookingDraft);

  if (bookingPolicyLink && bookingPolicyModal) {
    const openPolicyModal = () => {
      bookingPolicyModal.classList.add('is-open');
      bookingPolicyModal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    };
    const closePolicyModal = () => {
      bookingPolicyModal.classList.remove('is-open');
      bookingPolicyModal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    };
    bookingPolicyLink.addEventListener('click', openPolicyModal);
    bookingPolicyCloseButtons.forEach((button) => button.addEventListener('click', closePolicyModal));
    bookingPolicyModal.addEventListener('click', (event) => {
      if (event.target === bookingPolicyModal || event.target.matches('[data-close-policy]')) closePolicyModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && bookingPolicyModal.classList.contains('is-open')) closePolicyModal();
    });
  }

  if (bookingPolicy && bookingSubmitButton) {
    bookingPolicy.addEventListener('change', syncBookingPolicyButton);
    syncBookingPolicyButton();
  }

  function renderBookingFiles() {
    bookingPreviews.replaceChildren();
    selectedBookingFiles.forEach((file, index) => {
      const item = document.createElement('li');
      item.className = 'upload-preview-item';
      const title = document.createElement('span');
      title.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-upload';
      remove.setAttribute('aria-label', `Remove ${file.name}`);
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        selectedBookingFiles.splice(index, 1);
        renderBookingFiles();
      });
      item.append(title, remove);
      bookingPreviews.append(item);
    });
  }

  bookingFiles.addEventListener('change', () => {
    bookingError.hidden = true;
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']);
    const newFiles = Array.from(bookingFiles.files || []);
    const invalid = newFiles.find((file) => !allowedTypes.has(file.type) || file.size > 15 * 1024 * 1024);
    if (invalid) {
      bookingError.textContent = 'Choose JPG, PNG, WebP, MP4 or MOV files up to 15 MB each.';
      bookingError.hidden = false;
      bookingFiles.value = '';
      return;
    }
    if (selectedBookingFiles.length + newFiles.length > 6) {
      bookingError.textContent = 'You can add up to 6 files.';
      bookingError.hidden = false;
      bookingFiles.value = '';
      return;
    }
    selectedBookingFiles.push(...newFiles);
    renderBookingFiles();
    bookingFiles.value = '';
  });

  bookingForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (tintSelectionLoadFailed) {
      bookingError.hidden = false;
      return;
    }
    postFormSubmission(
      bookingForm,
      bookingForm.querySelector('[type="submit"]'),
      bookingError,
      '/api/v1/bookings',
      selectedBookingFiles,
    ).then((result) => {
      if (!result) return;
      bookingSubmitted = true;
      const bookingReference = result.reference || result.id;
      const remembered = bookingStorage?.rememberBooking(
        bookingReference,
        bookingForm.elements.namedItem('phone').value,
      ) || false;
      const draftCleared = bookingStorage?.clearDraft() || false;
      draftSaveStatus.textContent = remembered
        ? 'Your booking reference and phone number were saved on this device for quick status checks.'
        : 'Your booking was received. Keep the reference below and phone number to check it again.';
      if (!draftCleared) {
        draftSaveStatus.textContent += ' The unfinished form draft could not be cleared from this browser.';
      }
      window.dispatchEvent(new CustomEvent('booking:remembered', {
        detail: {
          reference: bookingReference,
          phone: bookingForm.elements.namedItem('phone').value,
        },
      }));
      document.querySelector('#booking-confirmation-title').textContent = 'Booking Request Received';
      const notified = Object.values(result.notifications || {}).includes('sent');
      const selectedTint = bookingTintOption.value
        ? ` Selected tint: ${bookingTintOption.selectedOptions[0].textContent}.`
        : '';
      document.querySelector('#booking-confirmation-message').textContent =
        `Your booking request has been received and is awaiting review.${selectedTint} ${result.attachmentCount ? `We stored ${result.attachmentCount} attachment${result.attachmentCount === 1 ? '' : 's'}.` : ''} Teo will contact you with the next steps. Payment alone does not confirm the appointment; final approval comes separately. ${notified ? 'Teo has been notified.' : 'Automatic notifications are not configured or could not be sent; message Teo on WhatsApp with this reference.'}`;
      document.querySelector('#booking-reference').textContent = `Booking reference: ${bookingReference}`;
      const statusLink = document.querySelector('#check-booking-status');
      statusLink.href = `booking-status.html?reference=${encodeURIComponent(bookingReference)}`;
      bookingLayout.hidden = true;
      bookingConfirmation.hidden = false;
      bookingConfirmation.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  editBooking.addEventListener('click', () => {
    bookingSubmitted = false;
    bookingConfirmation.hidden = true;
    bookingLayout.hidden = false;
    document.querySelector('#booking-reference').textContent = '';
    bookingForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

const workFilters = document.querySelectorAll('[data-work-filter]');
const workCategories = document.querySelectorAll('.gallery-category[data-work-category]');
const workEmptyState = document.querySelector('[data-work-empty]');

const bookingReturnForm = document.querySelector('#booking-return-form');

if (bookingReturnForm) {
  const storage = window.bookingBrowserStorage;
  const referenceInput = document.querySelector('#booking-return-reference');
  const phoneInput = document.querySelector('#booking-return-phone');
  const errorElement = document.querySelector('#booking-return-error');
  const resultSection = document.querySelector('#booking-return-result');
  const submitButton = document.querySelector('#booking-return-submit');
  const clearButton = document.querySelector('#booking-clear-saved');
  const bookingApiBaseUrl = apiBaseUrl;
  const serviceLabels = {
    TINT: 'Tint / Glass Fortification',
    DETAILING: 'Car Detailing',
    MAINTENANCE: 'Maintenance & Repairs',
    WRAPPING: 'Car Wrapping',
    UPGRADES: 'Upgrades & Modification',
    REGISTRATION: 'Registration',
    OTHER: 'Other',
  };

  const formatAppointment = (booking) => {
    const date = booking.preferred_date
      ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(new Date(`${booking.preferred_date}T00:00:00`))
      : 'To be arranged';
    const time = booking.preferred_time
      ? new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit' })
        .format(new Date(`2000-01-01T${booking.preferred_time}:00`))
      : '';
    return [date, time].filter(Boolean).join(' · ');
  };

  const renderStatus = (booking) => {
    const status = String(booking.status || '').replaceAll('_', ' ');
    const paid = booking.payment_status === 'PAID';
    document.querySelector('#booking-return-label').textContent = paid ? 'PAYMENT RECEIVED' : status;
    document.querySelector('#booking-return-title').textContent = paid
      ? 'Your payment has been verified.'
      : ({
        NEW: 'Your request is received.',
        PENDING_REVIEW: 'Your request is awaiting review.',
        APPROVED: 'Your booking is approved.',
        AWAITING_PAYMENT: 'Your booking is awaiting payment.',
        AWAITING_APPROVAL: 'Your payment is being reviewed.',
        CONFIRMED: 'Your appointment is confirmed.',
        RESCHEDULE_PROPOSED: 'A new appointment time is proposed.',
        DECLINED: 'Your booking was declined.',
        CANCELLED: 'Your booking was cancelled.',
        COMPLETED: 'Your service is complete.',
        EXPIRED: 'Your booking request has expired.',
      }[booking.status] || 'Your booking has been updated.');
    document.querySelector('#booking-return-result-reference').textContent = booking.reference;
    document.querySelector('#booking-return-service').textContent =
      booking.service_other || serviceLabels[booking.service] || booking.service || 'Service details unavailable';
    document.querySelector('#booking-return-appointment').textContent = formatAppointment(booking);
    document.querySelector('#booking-return-payment').textContent = paid
      ? 'Paid'
      : booking.payment_status || 'Not yet due';
    document.querySelector('#booking-return-next-step').textContent = paid
      ? 'Payment is verified. Teo will send a separate final appointment confirmation.'
      : ['APPROVED', 'CONFIRMED'].includes(booking.status)
        ? 'Review the full booking details and any payment instructions.'
        : 'Your appointment is not confirmed until you receive official approval.';
    const detailsLink = document.querySelector('#booking-return-details-link');
    detailsLink.href = `booking-status.html?reference=${encodeURIComponent(booking.reference)}`;
    resultSection.hidden = false;
  };

  const latestBooking = storage?.getLatestBooking();
  if (latestBooking) {
    referenceInput.value = latestBooking.reference;
    phoneInput.value = latestBooking.phone;
    }

    bookingReturnForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorElement.hidden = true;
    resultSection.hidden = true;
    if (!bookingReturnForm.reportValidity()) return;
    submitButton.disabled = true;
    submitButton.textContent = 'Checking…';
    try {
      const response = await fetch(`${bookingApiBaseUrl}/api/v1/booking-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(bookingReturnForm).entries())),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not check this booking.');
      const remembered = storage?.rememberBooking(referenceInput.value, phoneInput.value) || false;
      renderStatus(result.booking);
      if (!remembered) {
        document.querySelector('#booking-local-storage-note').textContent =
          'Booking status was checked, but this browser could not save its details for next time.';
      }
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

  window.addEventListener('booking:remembered', () => {
    populateSavedBookings();
    const latest = storage?.getLatestBooking();
    if (latest) {
      referenceInput.value = latest.reference;
      phoneInput.value = latest.phone;
    }
  });

  clearButton.addEventListener('click', () => {
    const cleared = storage?.clearAll() || false;
    window.dispatchEvent(new CustomEvent('booking:clear-local-data'));
    referenceInput.value = '';
    phoneInput.value = '';
    errorElement.hidden = true;
    resultSection.hidden = true;
    document.querySelector('#booking-draft-notice').hidden = true;
    document.querySelector('#booking-local-storage-note').textContent = cleared
      ? 'Saved booking details were cleared from this browser.'
      : 'This browser could not clear saved details. Clear this site’s storage through your browser settings.';
  });
}

if (workFilters.length && workCategories.length && workEmptyState) {
  const applyWorkFilter = (filter) => {
    const category = filter.dataset.workFilter;
    let visibleProjects = 0;

    workFilters.forEach((button) => {
      button.setAttribute('aria-pressed', String(button === filter));
    });

    workCategories.forEach((group) => {
      const isVisible = category === 'all' || group.dataset.workCategory === category;
      group.hidden = !isVisible;
      if (isVisible) visibleProjects += group.querySelectorAll('.gallery-item').length;
    });

    workEmptyState.hidden = visibleProjects > 0;
  };

  workFilters.forEach((filter) => {
    filter.addEventListener('click', () => applyWorkFilter(filter));
  });

  const requestedCategory = new URLSearchParams(window.location.search).get('category');
  const requestedFilter = [...workFilters].find((filter) => filter.dataset.workFilter === requestedCategory);
  if (requestedFilter) applyWorkFilter(requestedFilter);
}

const detailingCarousel = document.querySelector('.detailing-carousel');

if (detailingCarousel) {
  const slides = [...detailingCarousel.querySelectorAll('[data-detailing-slide]')];
  const slideButtons = [...detailingCarousel.querySelectorAll('[data-carousel-slide]')];
  let autoTimer = null;
  const AUTOPLAY_INTERVAL = 4500;
  let currentIndex = slides.findIndex((slide) => slide.classList.contains('is-active'));
  if (currentIndex < 0) currentIndex = 0;

  const showSlide = (index) => {
    const activeIndex = (index + slides.length) % slides.length;
    currentIndex = activeIndex;

    slides.forEach((slide, slideIndex) => {
      const isActive = slideIndex === activeIndex;
      slide.classList.toggle('is-active', isActive);
      slide.setAttribute('aria-hidden', String(!isActive));
    });
    slideButtons.forEach((button, buttonIndex) => {
      button.setAttribute('aria-pressed', String(buttonIndex === activeIndex));
    });
  };

  const advance = () => showSlide(currentIndex + 1);
  const startAutoplay = () => {
    if (!autoTimer && slides.length > 1) {
      autoTimer = setInterval(advance, AUTOPLAY_INTERVAL);
    }
  };

  slideButtons.forEach((button) => {
    button.addEventListener('click', () => {
      showSlide(Number(button.dataset.carouselSlide));
      window.clearInterval(autoTimer);
      autoTimer = null;
      startAutoplay();
    });
  });

  showSlide(currentIndex);
  startAutoplay();
}
