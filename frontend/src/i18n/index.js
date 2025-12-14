// Simple i18n helper with a single English bundle.
// Usage: import { t } from '../i18n'; t('common.cancel')

import en from './en.json';

const bundles = { en };
let current = 'en';

export function t(key, fallback) {
  try {
    const parts = String(key).split('.');
    let cur = bundles[current];
    for (const p of parts) {
      if (!cur || typeof cur !== 'object') return fallback ?? key;
      cur = cur[p];
    }
    return (cur ?? fallback ?? key);
  } catch (_) {
    return fallback ?? key;
  }
}

export function setLocale(locale = 'en') {
  if (bundles[locale]) current = locale;
}

export function getLocale() {
  return current;
}
