const form = document.querySelector('#consultation-form');
const fileInput = document.querySelector('#attachments');
const previewList = document.querySelector('#upload-preview');
const formError = document.querySelector('#form-error');
const confirmation = document.querySelector('#request-confirmation');
const resetButton = document.querySelector('#reset-preview');
const selectedFiles = [];

function renderPreviews() {
  previewList.replaceChildren();
  selectedFiles.forEach((file, index) => {
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
      selectedFiles.splice(index, 1);
      renderPreviews();
    });
    item.append(title, remove);
    previewList.append(item);
  });
}

fileInput.addEventListener('change', () => {
  formError.hidden = true;
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'application/pdf']);
  const newFiles = Array.from(fileInput.files || []);
  const invalid = newFiles.find((file) => !allowedTypes.has(file.type) || file.size > 15 * 1024 * 1024);
  if (invalid) {
    formError.textContent = 'Choose JPG, PNG, WebP, MP4, MOV or PDF files up to 15 MB each.';
    formError.hidden = false;
    fileInput.value = '';
    return;
  }
  if (selectedFiles.length + newFiles.length > 8) {
    formError.textContent = 'You can add up to 8 files.';
    formError.hidden = false;
    fileInput.value = '';
    return;
  }
  selectedFiles.push(...newFiles);
  renderPreviews();
  fileInput.value = '';
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  formError.hidden = true;
  if (!form.reportValidity()) return;
  const reference = `PREVIEW-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  document.querySelector('#preview-reference').textContent = reference;
  form.hidden = true;
  confirmation.hidden = false;
  confirmation.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

resetButton.addEventListener('click', () => {
  confirmation.hidden = true;
  form.hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
