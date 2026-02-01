// /frontend/src/api/axios.js
import axios from "axios";
import { bumpDomainVersion } from "../utils/sessionCache";

// Prefer environment-configured API base URL, fall back to browser origin.
// Example: REACT_APP_API_URL=https://api.example.com/api
const resolveApiBase = () => {
  const envApiBase = (typeof process !== 'undefined' && process.env?.REACT_APP_API_URL)
    ? process.env.REACT_APP_API_URL
    : null;

  if (typeof window === 'undefined') {
    return envApiBase;
  }

  const upgradeSameHostToHttps = (url) => {
    if (typeof url !== 'string') return url;
    if (!window.location || window.location.protocol !== 'https:') return url;
    if (!url.startsWith('http://')) return url;
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.host === window.location.host) {
        return parsed.toString().replace(/^http:/, 'https:');
      }
    } catch (e) {
      return url;
    }
    return url;
  };

  const normalizeLocalhost = (url) => {
    if (typeof url !== 'string') return url;
    const origin = window.location?.origin || '';
    const isLocal = /localhost|127\.0\.0\.1|::1/.test(origin);
    if (!isLocal) return url;
    return url.replace(/:\/\/localhost:/, '://127.0.0.1:');
  };

  const isProductionHost = (() => {
    const origin = window.location?.origin || '';
    return !/localhost|127\.0\.0\.1|::1/.test(origin);
  })();

  const looksLikeInternalApiBase = (url) => {
    if (typeof url !== 'string') return false;
    // These hosts work inside Docker but NOT in the end-user browser.
    return /:\/\/(?:localhost|127\.0\.0\.1|::1)(?::|\/)/.test(url)
      || /:\/\/backend(?::|\/)/.test(url);
  };

  if (envApiBase) {
    const normalized = normalizeLocalhost(upgradeSameHostToHttps(envApiBase));
    // Production safety: if the build accidentally bakes an internal/localhost URL,
    // ignore it and fall back to same-origin (/api) via nginx.
    if (isProductionHost && looksLikeInternalApiBase(normalized)) {
      return null;
    }
    return normalized;
  }

  if (window.__API_BASE__) {
    return normalizeLocalhost(upgradeSameHostToHttps(window.__API_BASE__));
  }

  const origin = window.location?.origin;
  if (!origin) {
    return null;
  }

  const isLocal = /localhost|127\.0\.0\.1|::1/.test(origin);
  const normalizedOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  return isLocal ? 'http://127.0.0.1:5000/api' : `${normalizedOrigin}/api`;
};

const API_BASE = resolveApiBase() || 'http://127.0.0.1:5000/api';

const instance = axios.create({
  baseURL: API_BASE, // backend base URL
  withCredentials: true, // Enable sending cookies with requests
  timeout: 60000 // Allow up to 60s for large uploads before aborting
});

const DEVICE_ID_KEY = 'waraqa:deviceId';

const getDeviceId = () => {
  try {
    if (typeof window === 'undefined') return null;
    const existing = window.localStorage?.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    let next = null;
    if (typeof window.crypto?.randomUUID === 'function') {
      next = window.crypto.randomUUID();
    } else {
      next = `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    }
    window.localStorage?.setItem(DEVICE_ID_KEY, next);
    return next;
  } catch (e) {
    return null;
  }
};

// Get initial token
const initialToken = localStorage.getItem("token");
if (initialToken) {
  instance.defaults.headers.common['Authorization'] = `Bearer ${initialToken}`;
}

// Add response interceptor to handle auth errors
instance.interceptors.response.use(
  (response) => {
    try {
      const method = String(response?.config?.method || '').toLowerCase();
      if (method && method !== 'get') {
        const rawUrl = String(response?.config?.url || '');
        const normalizedPath = (() => {
          try {
            const pathname = new URL(rawUrl, API_BASE).pathname || '';
            return pathname.replace(/^\/api(\/|$)/, '/');
          } catch (e) {
            return rawUrl;
          }
        })();
        // Very small, safe invalidation set: bump domain versions so cached GETs
        // are ignored on next read.
        if (normalizedPath.startsWith('/classes')) {
          bumpDomainVersion('classes');
          bumpDomainVersion('availability');
        }
        if (normalizedPath.startsWith('/invoices')) bumpDomainVersion('invoices');
        if (normalizedPath.startsWith('/library')) bumpDomainVersion('library');
        if (normalizedPath.startsWith('/availability')) bumpDomainVersion('availability');
        if (normalizedPath.startsWith('/students')) bumpDomainVersion('students');
        if (normalizedPath.startsWith('/users')) {
          bumpDomainVersion('users');
          bumpDomainVersion('students');
          bumpDomainVersion('teachers');
          bumpDomainVersion('guardians');
        }
        if (normalizedPath.startsWith('/teachers')) bumpDomainVersion('teachers');
        if (normalizedPath.startsWith('/guardians')) bumpDomainVersion('guardians');
        if (normalizedPath.startsWith('/salaries')) bumpDomainVersion('salaries');
        if (normalizedPath.startsWith('/teacher-salary')) bumpDomainVersion('teacher-salary');
      }
    } catch (e) {
      // ignore cache version bump failures
    }

    return response;
  },
  (error) => {
    const isCanceled = error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError';
    if (isCanceled) {
      error.isCanceled = true;
      return Promise.reject(error);
    }

    const isTimeout = error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message || '');
    if (isTimeout) {
      error.isTimeout = true;
      return Promise.reject(error);
    }

    // Network / cache failures (no response) happen when the browser
    // fails to read from the HTTP cache/storage (service worker or disk)
    if (!error.response && error.request) {
      // Mark network/cache read failures so callers can handle them specifically
      console.error('API Error: Network or cache failure:', error.message, {
        endpoint: error.config?.url,
        method: error.config?.method,
      });
      error.isNetworkOrCache = true;
      // Keep the original error so callers can inspect details (config, request)
      return Promise.reject(error);
    }

    // Log concise, human-readable info for other errors.
    // NOTE: Logging plain objects often shows up as just "Object" in production/minified builds.
    const status = error.response?.status;
    const method = String(error.config?.method || '').toUpperCase();
    const endpoint = String(error.config?.url || '');
    const responseData = error.response?.data;
    const message = (responseData && typeof responseData === 'object' && responseData.message)
      ? responseData.message
      : (typeof responseData === 'string' ? responseData : error.message);

    const hasToken = !!error.config?.headers?.Authorization;
    const extra = {
      status,
      endpoint,
      method,
      hasToken,
      data: responseData,
    };

    const suppressErrorLog = Boolean(error.config?.suppressErrorLog || error.config?.meta?.suppressErrorLog);

    // Expected user-actionable errors (400/409/422) shouldn't spam the console as errors.
    if (!suppressErrorLog) {
      if (status === 400 || status === 409 || status === 422) {
        console.warn(`[API ${status}] ${method} ${endpoint}: ${message}`, extra);
      } else {
        console.error(`[API ${status || 'ERR'}] ${method} ${endpoint}: ${message}`, extra);
      }
    }

    // Mark auth errors so higher-level code (AuthContext) can decide what to do
    if (error.response?.status === 401) {
      // Attach a flag for callers to detect auth-related failures
      error.isAuthError = true;
      error.authErrorCode = error.response?.data?.error || null;

      // Do NOT remove token or redirect here — let the auth context manage user state and navigation.
      // This avoids double-redirects and makes token handling explicit in one place.
    }

    return Promise.reject(error);
  }
);

// Set up interceptor for future token changes
instance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const deviceId = getDeviceId();
    if (deviceId) {
      config.headers['x-device-id'] = deviceId;
    }
    // Ensure API responses are not served from a stale HTTP cache in the browser
    // Some browsers / service workers may attempt to read from Cache Storage and fail
    // which results in ERR_CACHE_READ_FAILURE. Adding no-cache/no-store hints helps.
    config.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    config.headers['Pragma'] = 'no-cache';
    return config;
  },
  (error) => Promise.reject(error)
);

export default instance;
