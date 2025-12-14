const DEFAULT_CALENDAR_PREFERENCE = 'google';
const STORAGE_KEY = 'waraqa.calendarPreference';

const hasWindow = typeof window !== 'undefined';
const getStorage = () => {
  if (!hasWindow || !window.localStorage) return null;
  return window.localStorage;
};

export const CALENDAR_PREFERENCE_OPTIONS = [
  { value: 'google', label: 'Google Calendar' },
  { value: 'outlook', label: 'Outlook / Office 365' },
  { value: 'apple', label: 'Apple Calendar (.ics)' }
];

export const getStoredCalendarPreference = (fallback = DEFAULT_CALENDAR_PREFERENCE) => {
  try {
    const storage = getStorage();
    if (!storage) return fallback;
    return storage.getItem(STORAGE_KEY) || fallback;
  } catch (err) {
    console.warn('Unable to read stored calendar preference', err);
    return fallback;
  }
};

export const storeCalendarPreference = (value) => {
  try {
    const storage = getStorage();
    if (!storage) return;
    storage.setItem(STORAGE_KEY, value);
  } catch (err) {
    console.warn('Unable to persist calendar preference', err);
  }
};

export const downloadIcsFile = (icsContent, filename = 'meeting.ics') => {
  if (!icsContent || !hasWindow) return false;
  try {
    const blob = new Blob([icsContent], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('Failed to trigger ICS download', err);
    return false;
  }
};
