export const PUBLIC_EVALUATION_PATH = '/book/evaluation';

export const resolvePublicEvaluationLink = () => {
  const envBase = (process.env.REACT_APP_PUBLIC_SITE_URL || '').trim();
  if (envBase) {
    return `${envBase.replace(/\/$/, '')}${PUBLIC_EVALUATION_PATH}`;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin.replace(/\/$/, '')}${PUBLIC_EVALUATION_PATH}`;
  }
  return PUBLIC_EVALUATION_PATH;
};
