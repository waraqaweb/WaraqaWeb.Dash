'use client';

import { useEffect } from 'react';

type BrandingResponse = {
  branding?: {
    logo?: {
      url?: string;
      dataUri?: string;
    };
  };
};

const DEFAULT_API_BASE = 'http://localhost:5000/api';

const getApiBase = () => {
  return (
    process.env.NEXT_PUBLIC_MARKETING_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.MARKETING_API_BASE_URL ||
    DEFAULT_API_BASE
  ).replace(/\/$/, '');
};

const setFaviconHref = (href: string) => {
  try {
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }

    link.type = href.startsWith('data:image/svg') || href.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    link.href = href;

    // Nice-to-have: keep apple-touch-icon in sync for iOS.
    let apple = document.querySelector("link[rel='apple-touch-icon']") as HTMLLinkElement | null;
    if (!apple) {
      apple = document.createElement('link');
      apple.rel = 'apple-touch-icon';
      document.head.appendChild(apple);
    }
    apple.href = href;
  } catch {
    // ignore DOM failures
  }
};

const fetchBranding = async (): Promise<BrandingResponse | null> => {
  // 1) Prefer same-origin in production (Nginx proxies /api -> backend)
  try {
    const res = await fetch('/api/settings/branding', { cache: 'no-store' });
    if (res.ok) return (await res.json()) as BrandingResponse;
  } catch {
    // fall through
  }

  // 2) Fallback to explicit base (local dev / alternative deployments)
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/settings/branding`, { cache: 'no-store' });
    if (res.ok) return (await res.json()) as BrandingResponse;
  } catch {
    // ignore
  }

  return null;
};

export default function BrandingFavicon() {
  useEffect(() => {
    let mounted = true;

    (async () => {
      const data = await fetchBranding();
      if (!mounted) return;

      const href = data?.branding?.logo?.url || data?.branding?.logo?.dataUri;
      if (href) setFaviconHref(href);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  return null;
}
