const preloader = document.querySelector('.site-preloader');

if (preloader) {
  const preloaderStartedAt = performance.now();
  let preloaderClosing = false;

  function closePreloader() {
    if (preloaderClosing) return;
    preloaderClosing = true;
    const minimumDisplay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 520;
    const remaining = Math.max(0, minimumDisplay - (performance.now() - preloaderStartedAt));
    window.setTimeout(() => {
      preloader.classList.add('is-hidden');
      window.setTimeout(() => preloader.remove(), 500);
    }, remaining);
  }

  if (document.readyState !== 'loading') closePreloader();
  else document.addEventListener('DOMContentLoaded', closePreloader, { once: true });
  window.setTimeout(closePreloader, 5000);
}

const menuToggle = document.querySelector('.menu-toggle');
const primaryNavigation = document.querySelector('.primary-navigation');
const dropdownTrigger = document.querySelector('.dropdown-trigger');
const dropdownMenu = document.querySelector('#services-menu');
const siteHeader = document.querySelector('.site-header');

function updateHeaderOnScroll() {
  siteHeader.classList.toggle('is-scrolled', window.scrollY > 40);
}

window.addEventListener('scroll', updateHeaderOnScroll, { passive: true });
updateHeaderOnScroll();

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
  dropdownTrigger.setAttribute('aria-expanded', 'false');
  dropdownMenu.hidden = true;
}

function closeNavigation() {
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open navigation');
  primaryNavigation.classList.remove('is-open');
  closeDropdown();
}

menuToggle.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Open navigation' : 'Close navigation');
  primaryNavigation.classList.toggle('is-open', !isOpen);
});

dropdownTrigger.addEventListener('click', () => {
  const isOpen = dropdownTrigger.getAttribute('aria-expanded') === 'true';
  dropdownTrigger.setAttribute('aria-expanded', String(!isOpen));
  dropdownMenu.hidden = isOpen;
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.nav-dropdown')) closeDropdown();
  if (!event.target.closest('.site-header')) closeNavigation();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeNavigation();
    menuToggle.focus();
  }
});

primaryNavigation.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', closeNavigation);
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 800) closeNavigation();
});

document.querySelector('#year').textContent = new Date().getFullYear();

const enquiryForm = document.querySelector('#consultation-form');

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
    enquiryError.hidden = true;
    if (!enquiryForm.reportValidity()) return;
    enquiryLayout.hidden = true;
    enquiryConfirmation.hidden = false;
    enquiryConfirmation.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  resetEnquiry.addEventListener('click', () => {
    enquiryConfirmation.hidden = true;
    enquiryLayout.hidden = false;
    enquiryForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

const bookingForm = document.querySelector('#booking-form');

if (bookingForm) {
  const bookingLayout = document.querySelector('.consultation-layout');
  const bookingDate = document.querySelector('#booking-date');
  const bookingFiles = document.querySelector('#booking-attachments');
  const bookingPreviews = document.querySelector('#booking-upload-preview');
  const bookingError = document.querySelector('#booking-form-error');
  const bookingConfirmation = document.querySelector('#booking-confirmation');
  const editBooking = document.querySelector('#edit-booking');
  const bookingService = document.querySelector('#booking-service');
  const bookingLocation = document.querySelector('#booking-location');
  const serviceOtherField = document.querySelector('#booking-service-other');
  const serviceOtherInput = document.querySelector('#booking-service-specify');
  const locationOtherField = document.querySelector('#booking-location-other');
  const locationOtherInput = document.querySelector('#booking-location-specify');
  const selectedBookingFiles = [];

  const today = new Date();
  bookingDate.min = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');

  const yearOptions = document.querySelector('#booking-year-options');
  const currentYear = today.getFullYear();
  for (let year = currentYear + 1; year >= 1950; year -= 1) {
    const option = document.createElement('option');
    option.value = String(year);
    yearOptions.append(option);
  }

  function bindOtherDetails(select, field, input) {
    const updateField = () => {
      const isOther = select.value === 'OTHER';
      field.hidden = !isOther;
      input.disabled = !isOther;
      input.required = isOther;
      if (!isOther) input.value = '';
    };
    select.addEventListener('change', updateField);
    updateField();
  }

  bindOtherDetails(bookingService, serviceOtherField, serviceOtherInput);
  bindOtherDetails(bookingLocation, locationOtherField, locationOtherInput);

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
    bookingError.hidden = true;
    if (!bookingForm.reportValidity()) return;
    bookingLayout.hidden = true;
    bookingConfirmation.hidden = false;
    bookingConfirmation.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  editBooking.addEventListener('click', () => {
    bookingConfirmation.hidden = true;
    bookingLayout.hidden = false;
    bookingForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
