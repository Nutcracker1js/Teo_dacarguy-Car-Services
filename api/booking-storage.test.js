const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const storageScript = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'js', 'booking-storage.js'),
  'utf8',
);

function createBookingStorage() {
  const values = new Map();
  const localStorage = {
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const window = { localStorage };
  vm.runInNewContext(storageScript, { window, console: { warn() {} }, Date });
  return window.bookingBrowserStorage;
}

test('browser storage preserves drafts and remembers up to ten matching bookings', () => {
  const storage = createBookingStorage();
  assert.equal(storage.isAvailable(), true);
  assert.equal(storage.saveDraft({ fullName: 'Ada', preferredDate: '2027-01-20' }), true);
  assert.equal(storage.rememberBooking('TD-1042', '+234 801 234 5678'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(storage.getDraft())), {
    fullName: 'Ada',
    preferredDate: '2027-01-20',
  });
  assert.equal(storage.getBooking('td-1042').phone, '+234 801 234 5678');
  assert.equal(storage.rememberBooking('TEO-1000', '08012345678'), true);
  assert.equal(storage.getBooking('teo-1000').reference, 'TEO-1000');

  for (let index = 0; index < 12; index += 1) {
    storage.rememberBooking(`TD-REF-${String(index).padStart(4, '0')}`, '08012345678');
  }
  assert.equal(storage.listBookings().length, 10);
  assert.equal(storage.getLatestBooking().reference, 'TD-REF-0011');
});

test('browser storage rejects invalid booking identifiers and clears saved data', () => {
  const storage = createBookingStorage();
  assert.equal(storage.rememberBooking('invalid-reference', '08012345678'), false);
  assert.equal(storage.rememberBooking('TD-1042', ''), false);
  storage.saveDraft({ fullName: 'Ada' });
  storage.rememberBooking('TD-1042', '08012345678');
  assert.equal(storage.clearAll(), true);
  assert.equal(storage.getDraft(), null);
  assert.equal(storage.listBookings().length, 0);
});
