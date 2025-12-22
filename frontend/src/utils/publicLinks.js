export const PUBLIC_EVALUATION_PATH = '/book/evaluation';

export const resolvePublicSiteBaseUrl = () => {
  const envBase = (process.env.REACT_APP_PUBLIC_SITE_URL || '').trim();
  if (envBase) return envBase.replace(/\/$/, '');
  return '';
};

export const resolvePublicSiteHref = (path = '/') => {
  const base = resolvePublicSiteBaseUrl();
  const safePath = String(path || '/');
  if (base) {
    return `${base}${safePath.startsWith('/') ? '' : '/'}${safePath}`;
  }
  return safePath;
};

export const resolvePublicEvaluationLink = () => {
  const base = resolvePublicSiteBaseUrl();
  if (base) return `${base}${PUBLIC_EVALUATION_PATH}`;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin.replace(/\/$/, '')}${PUBLIC_EVALUATION_PATH}`;
  }
  return PUBLIC_EVALUATION_PATH;
};
