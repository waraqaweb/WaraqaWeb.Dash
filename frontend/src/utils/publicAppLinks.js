export function getPublicAppUrl(pathname = '/') {
  if (typeof window === 'undefined') return pathname;
  const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';
  const normalizedBase = baseUrl === '/' ? '' : String(baseUrl).replace(/\/$/, '');
  const normalizedPath = String(pathname || '/').startsWith('/') ? String(pathname || '/') : `/${String(pathname || '')}`;
  return `${window.location.origin}${normalizedBase}${normalizedPath}`;
}
