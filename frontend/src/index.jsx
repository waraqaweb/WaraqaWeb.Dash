import './vite-shims/processEnv';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import './App.css';

const applyDirAuto = (root) => {
  if (!root || !root.querySelectorAll) return;
  const selector = 'input:not([dir]), textarea:not([dir]), select:not([dir]), [contenteditable="true"]:not([dir])';
  root.querySelectorAll(selector).forEach((el) => {
    try {
      el.setAttribute('dir', 'auto');
    } catch (e) {
      // ignore
    }
  });
};

// Make Arabic (and other RTL scripts) type correctly everywhere:
// - cursor direction
// - natural alignment (paired with CSS text-align:start)
try {
  applyDirAuto(document);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node && node.nodeType === 1) {
          applyDirAuto(node);
        }
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
} catch (e) {
  // ignore
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <AuthProvider>
    <App />
  </AuthProvider>
);

// --------------------------------------------------------------------------
// Stale-bundle auto-recovery
// --------------------------------------------------------------------------
// When we redeploy, code-split chunks (e.g. DashboardHome-*.js, lucide icon
// chunks) are renamed with a new content hash and the old chunks are removed
// from the server. A long-lived browser tab still running the previous bundle
// will hit 404s the moment it tries to lazy-load a chunk and the app gets
// stuck. Vite emits `vite:preloadError` for exactly this case; we react by
// forcing a single hard reload so the user transparently lands on the latest
// build. The `__waraqaReloadedAt` sessionStorage guard prevents reload loops
// if the 404 is caused by something other than a stale bundle.
const handleStaleBundle = (event) => {
  try {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    const last = Number(sessionStorage.getItem('__waraqaReloadedAt') || 0);
    if (Date.now() - last < 15000) return; // already reloaded very recently
    sessionStorage.setItem('__waraqaReloadedAt', String(Date.now()));
    window.location.reload();
  } catch (_) {
    /* ignore */
  }
};

window.addEventListener('vite:preloadError', handleStaleBundle);
window.addEventListener('unhandledrejection', (event) => {
  const msg = String(event?.reason?.message || event?.reason || '');
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed')
  ) {
    handleStaleBundle(event);
  }
});
