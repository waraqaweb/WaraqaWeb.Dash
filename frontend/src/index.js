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
