const bookingForm = document.querySelector('#booking-form');
const bookingLayout = document.querySelector('.consultation-layout');
const bookingDate = document.querySelector('#booking-date');
const bookingFiles = document.querySelector('#booking-attachments');
const bookingPreviews = document.querySelector('#booking-upload-preview');
const bookingError = document.querySelector('#booking-form-error');
const bookingConfirmation = document.querySelector('#booking-confirmation');
const editBooking = document.querySelector('#edit-booking');
const selectedBookingFiles = [];

const today = new Date();
bookingDate.min = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');

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
