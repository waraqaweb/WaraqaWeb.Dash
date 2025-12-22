const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const ensureLeadingSlash = (value: string) => {
  if (!value) return '/';
  if (value.startsWith('/')) return value;
  return `/${value}`;
};

const WARAQA_HOSTNAME_RE = /(^|\.)waraqa\.com$|(^|\.)waraqaweb\.com$/i;

export const getDashboardBaseUrl = () => {
  const raw = process.env.NEXT_PUBLIC_DASHBOARD_URL || process.env.NEXT_PUBLIC_DASHBOARD_BASE_URL || '';
  return trimTrailingSlash(raw.trim());
};

const isProbablyAbsoluteUrl = (href: string) => /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href);

export const stripWaraqaOrigin = (href: string) => {
  if (!href) return href;
  if (!/^https?:\/\//i.test(href)) return href;

  try {
    const url = new URL(href);
    if (!WARAQA_HOSTNAME_RE.test(url.hostname)) return href;
    return `${url.pathname}${url.search}${url.hash}` || '/';
  } catch {
    return href;
  }
};

export const isDashboardPath = (href: string) => {
  const normalized = ensureLeadingSlash(href);
  return (
    normalized.startsWith('/dashboard') ||
    normalized.startsWith('/book/') ||
    normalized === '/login' ||
    normalized.startsWith('/admin')
  );
};

export const dashboardHref = (path: string) => {
  const baseUrl = getDashboardBaseUrl();
  const normalizedPath = ensureLeadingSlash(path);

  if (!baseUrl) return normalizedPath;

  // Supports either an absolute origin (https://...) or an in-domain base path (/app)
  if (baseUrl.startsWith('/')) return `${baseUrl}${normalizedPath}`;

  return `${baseUrl}${normalizedPath}`;
};

export const resolveWaraqaHref = (href: string) => {
  if (!href) return href;

  // Keep non-http schemes (mailto:, tel:, etc.) and hash links as-is.
  if (href.startsWith('#') || (isProbablyAbsoluteUrl(href) && !href.startsWith('http'))) return href;

  const stripped = stripWaraqaOrigin(href);

  // External (non-waraqa) absolute links remain absolute.
  if (/^https?:\/\//i.test(stripped)) return stripped;

  // Relative marketing/dashboard paths.
  const normalized = stripped.startsWith('/') ? stripped : ensureLeadingSlash(stripped);
  return isDashboardPath(normalized) ? dashboardHref(normalized) : normalized;
};
