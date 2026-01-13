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

  const normalizeLocalhost = (url) => {
    if (typeof url !== 'string') return url;
    const origin = window.location?.origin || '';
    const isLocal = /localhost|127\.0\.0\.1|::1/.test(origin);
    if (!isLocal) return url;
    return url.replace(/:\/\/localhost:/, '://127.0.0.1:');
  };

  if (envApiBase) {
    return normalizeLocalhost(envApiBase);
  }

  if (window.__API_BASE__) {
    return normalizeLocalhost(window.__API_BASE__);
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
        const url = String(response?.config?.url || '');
        // Very small, safe invalidation set: bump domain versions so cached GETs
        // are ignored on next read.
        if (url.startsWith('/classes')) {
          bumpDomainVersion('classes');
          bumpDomainVersion('availability');
        }
        if (url.startsWith('/invoices')) bumpDomainVersion('invoices');
        if (url.startsWith('/library')) bumpDomainVersion('library');
        if (url.startsWith('/availability')) bumpDomainVersion('availability');
        if (url.startsWith('/students')) bumpDomainVersion('students');
        if (url.startsWith('/users')) {
          bumpDomainVersion('users');
          bumpDomainVersion('students');
          bumpDomainVersion('teachers');
          bumpDomainVersion('guardians');
        }
        if (url.startsWith('/teachers')) bumpDomainVersion('teachers');
        if (url.startsWith('/guardians')) bumpDomainVersion('guardians');
        if (url.startsWith('/salaries')) bumpDomainVersion('salaries');
      }
    } catch (e) {
      // ignore cache version bump failures
    }

    return response;
  },
  (error) => {
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

    // Log concise, useful info for other errors
    console.error('API Error:', {
      status: error.response?.status,
      message: error.response?.data?.message || error.message,
      detail: error.response?.data?.error || null,
      endpoint: error.config?.url,
      method: error.config?.method,
      hasToken: !!error.config?.headers?.Authorization,
    });

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
