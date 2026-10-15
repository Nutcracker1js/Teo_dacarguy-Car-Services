(() => {
  const STORAGE_KEY = 'teo-car-services-browser-data-v1';
  const MAX_SAVED_BOOKINGS = 10;

  function readState() {
    try {
      const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        draft: value && typeof value.draft === 'object' && !Array.isArray(value.draft) ? value.draft : null,
        bookings: Array.isArray(value?.bookings) ? value.bookings : [],
      };
    } catch (error) {
      console.warn('Could not read saved booking details from this browser.', error);
      return { draft: null, bookings: [] };
    }
  }

  function writeState(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      console.warn('Could not save booking details in this browser.', error);
      return false;
    }
  }

  function validReference(reference) {
    return typeof reference === 'string' && /^TD-[A-Z0-9-]{4,20}$/i.test(reference.trim());
  }

  function getBooking(reference) {
    const state = readState();
    const booking = state.bookings.find((item) => item.reference === String(reference || '').trim().toUpperCase());
    return booking ? { ...booking } : null;
  }

  function getLatestBooking() {
    const state = readState();
    return state.bookings.length ? { ...state.bookings[0] } : null;
  }

  window.bookingBrowserStorage = Object.freeze({
    isAvailable() {
      const testKey = `${STORAGE_KEY}-check`;
      try {
        window.localStorage.setItem(testKey, '1');
        window.localStorage.removeItem(testKey);
        return true;
      } catch (error) {
        console.warn('This browser does not allow local booking storage.', error);
        return false;
      }
    },
    getDraft() {
      return readState().draft;
    },
    saveDraft(draft) {
      const state = readState();
      state.draft = draft;
      return writeState(state);
    },
    clearDraft() {
      const state = readState();
      state.draft = null;
      return writeState(state);
    },
    rememberBooking(reference, phone) {
      if (!validReference(reference) || typeof phone !== 'string' || !phone.trim() || phone.length > 32) return false;
      const state = readState();
      const normalizedReference = reference.trim().toUpperCase();
      state.bookings = [
        { reference: normalizedReference, phone: phone.trim(), savedAt: new Date().toISOString() },
        ...state.bookings.filter((item) => item?.reference !== normalizedReference),
      ].slice(0, MAX_SAVED_BOOKINGS);
      return writeState(state);
    },
    getBooking,
    getLatestBooking,
    listBookings() {
      return readState().bookings
        .filter((item) => validReference(item?.reference) && typeof item.phone === 'string')
        .map((item) => ({ ...item }));
    },
    clearAll() {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        return true;
      } catch (error) {
        console.warn('Could not clear saved booking details from this browser.', error);
        return false;
      }
    },
  });
})();
