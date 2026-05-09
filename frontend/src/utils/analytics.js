/**
 * Lightweight Google Tag Manager helpers for the dashboard SPA.
 *
 * The GTM container is loaded from `index.html`. React Router does not trigger
 * a full page reload when the URL changes, so GTM never sees a "Page View"
 * trigger automatically. We push a synthetic `page_view` event whenever the
 * route changes; in GTM, configure a GA4 Event tag (event name `page_view`)
 * triggered by Custom Event = `page_view` to forward these into GA4.
 *
 * Cross-domain measurement is configured in the GTM UI (GA4 Configuration tag
 * → Configure your domains → add `waraqaweb.com` and `app.waraqaweb.com`).
 */

export function trackPageView({ path, title }) {
  if (typeof window === 'undefined') return;
  if (!Array.isArray(window.dataLayer)) {
    window.dataLayer = window.dataLayer || [];
  }
  window.dataLayer.push({
    event: 'page_view',
    page_path: path,
    page_location: window.location.href,
    page_title: title || document.title,
  });
}
