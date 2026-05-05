import { bumpDomainVersion } from './sessionCache';

export const DOMAIN_REFRESH_EVENT_PREFIX = 'waraqa:refresh:';

const COMPATIBILITY_EVENTS = {
  classes: ['classes:refresh'],
  availability: ['availability:refresh'],
  dashboard: ['waraqa:dashboard-stats-refresh'],
};

export const getDomainRefreshEventName = (domain) => `${DOMAIN_REFRESH_EVENT_PREFIX}${domain}`;

const dispatchWindowEvent = (eventName, detail) => {
  if (typeof window === 'undefined') return;

  try {
    if (detail === undefined) {
      window.dispatchEvent(new Event(eventName));
      return;
    }

    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  } catch (error) {
    // ignore event dispatch failures
  }
};

export const broadcastDomainRefresh = (domains, options = {}) => {
  const detail = options?.detail;
  const normalizedDomains = Array.from(new Set(
    (Array.isArray(domains) ? domains : [domains])
      .map((domain) => String(domain || '').trim())
      .filter(Boolean)
  ));

  normalizedDomains.forEach((domain) => {
    try {
      bumpDomainVersion(domain);
    } catch (error) {
      // ignore cache version bump failures
    }

    dispatchWindowEvent(getDomainRefreshEventName(domain), detail);

    const compatibilityEvents = COMPATIBILITY_EVENTS[domain] || [];
    compatibilityEvents.forEach((eventName) => dispatchWindowEvent(eventName, detail));
  });

  return normalizedDomains;
};