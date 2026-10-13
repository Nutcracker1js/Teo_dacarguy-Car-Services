const ENQUIRY_TYPES = new Set([
  'General Enquiry',
  'Maintenance & Repairs',
  'Car Sales / Sourcing',
  'Car Preorder',
  'Parts',
  'Tint / Glass Fortification',
  'Car Wrapping',
  'Registration',
  'Detailing',
  'Upgrades & Modification',
  'Other',
]);

const BOOKING_SERVICES = new Set([
  'MAINTENANCE',
  'DETAILING',
  'WRAPPING',
  'TINT',
  'UPGRADES',
  'REGISTRATION',
  'OTHER',
]);

const BOOKING_LOCATIONS = new Set([
  'OUR_LOCATION',
  'HOME_SERVICE',
  'PICKUP',
  'INTERSTATE',
  'OTHER',
]);

const PHONE_PATTERN = /^[+()\d\s.-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TINT_OPTIONS = require('../tint-options.json');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function isValidDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function todayInLagos() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function isValidBookingTime(value) {
  if (!TIME_PATTERN.test(value)) return false;
  const [, minutes] = value.split(':').map(Number);
  return minutes % 30 === 0;
}

function validatePayload(payload, fields, requiredFields) {
  const errors = {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { data: null, errors: { body: 'Request body must be a JSON object.' } };
  }

  Object.keys(payload).forEach((key) => {
    if (!fields[key]) errors[key] = 'This field is not accepted.';
  });

  const data = {};
  Object.entries(fields).forEach(([key, definition]) => {
    const value = cleanString(payload[key]);
    if (value === undefined || value === '') {
      if (requiredFields.has(key)) errors[key] = 'This field is required.';
      data[key] = null;
      return;
    }

    if (definition.type === 'boolean') {
      const normalized = typeof value === 'boolean' ? value : String(value).trim().toLowerCase();
      if (normalized === true || normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes') {
        data[key] = true;
        return;
      }
      if (normalized === false || normalized === 'false' || normalized === '0' || normalized === 'off' || normalized === 'no') {
        data[key] = false;
        return;
      }
      errors[key] = 'Choose whether you accept the booking policy before continuing.';
      return;
    }

    if (typeof value !== 'string' && definition.type !== 'year') {
      errors[key] = 'This field must be text.';
      return;
    }

    if (definition.type === 'year') {
      const year = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(year) || year < definition.min || year > definition.max) {
        errors[key] = `Enter a year from ${definition.min} to ${definition.max}.`;
      } else {
        data[key] = year;
      }
      return;
    }

    if (value.length > definition.max) {
      errors[key] = `Use no more than ${definition.max} characters.`;
      return;
    }
    if (definition.min && value.length < definition.min) {
      errors[key] = `Use at least ${definition.min} characters.`;
      return;
    }
    if (definition.enum && !definition.enum.has(value)) {
      errors[key] = 'Choose one of the supported options.';
      return;
    }
    if (definition.pattern && !definition.pattern.test(value)) {
      errors[key] = definition.pattern === PHONE_PATTERN
        ? 'Enter a valid phone number.'
        : 'Enter a valid email address.';
      return;
    }
    if (definition.validate && !definition.validate(value)) {
      errors[key] = definition.message;
      return;
    }

    data[key] = value;
  });

  return { data, errors };
}

const CURRENT_YEAR = new Date().getFullYear();
const ENQUIRY_FIELDS = {
  fullName: { max: 120, min: 2 },
  phone: { max: 32, min: 7, pattern: PHONE_PATTERN },
  whatsapp: { max: 32, min: 7, pattern: PHONE_PATTERN },
  email: { max: 254, pattern: EMAIL_PATTERN },
  enquiryType: { max: 80, enum: ENQUIRY_TYPES },
  description: { max: 3000, min: 5 },
  make: { max: 80 },
  model: { max: 80 },
  year: { type: 'year', min: 1900, max: CURRENT_YEAR + 1 },
};
const BOOKING_FIELDS = {
  fullName: { max: 120, min: 2 },
  phone: { max: 32, min: 7, pattern: PHONE_PATTERN },
  whatsapp: { max: 32, min: 7, pattern: PHONE_PATTERN },
  email: { max: 254, pattern: EMAIL_PATTERN },
  whatsappOptIn: { type: 'boolean' },
  make: { max: 80 },
  model: { max: 80 },
  year: { type: 'year', min: 1950, max: CURRENT_YEAR + 1 },
  registration: { max: 32 },
  service: { max: 32, enum: BOOKING_SERVICES },
  serviceOther: { max: 120 },
  preferredDate: {
    max: 10,
    validate: isValidDate,
    message: 'Enter a valid date in YYYY-MM-DD format.',
  },
  preferredTime: {
    max: 5,
    validate: isValidBookingTime,
    message: 'Choose an available appointment time.',
  },
  location: { max: 32, enum: BOOKING_LOCATIONS },
  locationOther: { max: 240 },
  details: { max: 3000 },
  tintOption: { max: 32, enum: new Set(Object.keys(TINT_OPTIONS)) },
  policyAccepted: { type: 'boolean' },
};

function validateEnquiry(payload) {
  return validatePayload(
    payload,
    ENQUIRY_FIELDS,
    new Set(['fullName', 'phone', 'enquiryType', 'description']),
  );
}

function validateBooking(payload) {
  const result = validatePayload(
    payload,
    BOOKING_FIELDS,
    new Set([
      'fullName',
      'phone',
      'whatsapp',
      'email',
      'make',
      'model',
      'service',
      'preferredDate',
      'preferredTime',
      'location',
    ]),
  );
  if (!result.data) return result;

  if (result.data.policyAccepted === false) {
    result.errors.policyAccepted = 'Please accept the booking policy before submitting your request.';
  }
  if (result.data.service === 'OTHER' && !result.data.serviceOther) {
    result.errors.serviceOther = 'Specify the service you need.';
  }
  if (result.data.tintOption && result.data.service !== 'TINT') {
    result.errors.tintOption = 'Tint options can only be selected for a tint service.';
  }
  if (result.data.location && result.data.location !== 'OUR_LOCATION' && !result.data.locationOther) {
    result.errors.locationOther = 'Provide the service address or travel details.';
  }
  if (result.data.preferredDate && isValidDate(result.data.preferredDate)) {
    if (result.data.preferredDate < todayInLagos()) {
      result.errors.preferredDate = 'Choose today or a future date.';
    }
  }
  return result;
}

function validateReview(payload) {
  const { data, errors } = validatePayload(
    payload,
    {
      name: { max: 80, min: 2 },
      vehicle: { max: 80 },
      rating: { max: 1, enum: new Set(['1', '2', '3', '4', '5']) },
      review: { max: 1500, min: 10 },
    },
    new Set(['name', 'rating', 'review']),
  );
  if (data && !errors.rating) {
    data.rating = Number(data.rating);
  }
  return { data, errors };
}

module.exports = { TINT_OPTIONS, validateBooking, validateEnquiry, validateReview };
