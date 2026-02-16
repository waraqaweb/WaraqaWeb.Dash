const STORAGE_PREFIX = 'notificationPrefs:v1:';

const defaults = {
  liveAlertsEnabled: true,
  notificationSoundEnabled: true,
  classStartSoundEnabled: true,
};

const safeParse = (raw) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
};

const getStorageKey = (userId) => `${STORAGE_PREFIX}${userId || 'anon'}`;

export const getNotificationPreferences = (userId) => {
  if (typeof window === 'undefined') return { ...defaults };
  try {
    const parsed = safeParse(window.localStorage.getItem(getStorageKey(userId)));
    return {
      ...defaults,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    };
  } catch (e) {
    return { ...defaults };
  }
};

export const setNotificationPreferences = (userId, next) => {
  if (typeof window === 'undefined') return;
  const current = getNotificationPreferences(userId);
  const merged = {
    ...current,
    ...(next && typeof next === 'object' ? next : {}),
  };
  try {
    window.localStorage.setItem(getStorageKey(userId), JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent('notification-preferences-changed', {
      detail: {
        userId: userId || 'anon',
        preferences: merged,
      },
    }));
  } catch (e) {
    // ignore storage failures
  }
};

export const requestBrowserNotificationPermission = async () => {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  try {
    const status = await Notification.requestPermission();
    return status;
  } catch (e) {
    return Notification.permission || 'default';
  }
};

export const canUseBrowserNotifications = () => {
  return typeof window !== 'undefined' && typeof Notification !== 'undefined';
};
