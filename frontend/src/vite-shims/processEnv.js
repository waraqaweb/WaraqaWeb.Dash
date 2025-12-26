// Vite shim to preserve CRA-style `process.env.*` access in the browser.
//
// Constraints:
// - Do NOT change business logic.
// - Keep existing `process.env.REACT_APP_*` usages working.
//
// CRA exposes env vars at build time. Vite exposes them via `import.meta.env`.
// We bridge the minimal subset used by this app.

const globalObj = typeof globalThis !== 'undefined' ? globalThis : window;

if (!globalObj.process) globalObj.process = {};
if (!globalObj.process.env) globalObj.process.env = {};

// Match CRA semantics closely.
globalObj.process.env.NODE_ENV = import.meta.env.MODE;

// CRA's `PUBLIC_URL` is the base path (no trailing slash). Vite provides
// `import.meta.env.BASE_URL` with a trailing slash.
// - dev:   BASE_URL === '/'
// - build: BASE_URL === '/dashboard/'
const baseUrl = typeof import.meta !== 'undefined' ? import.meta.env.BASE_URL : '/';
globalObj.process.env.PUBLIC_URL = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

// Expose only the CRA-compatible public vars.
for (const [key, value] of Object.entries(import.meta.env)) {
  if (key.startsWith('REACT_APP_')) {
    globalObj.process.env[key] = value;
  }
}
