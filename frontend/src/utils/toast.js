export const guessToastType = (message) => {
  const text = String(message || '').toLowerCase();
  if (!text) return 'info';
  if (/(fail|failed|error|invalid|unable|denied|missing|cannot|couldn\'t|could not)/.test(text)) {
    return 'error';
  }
  if (/(warn|warning|caution)/.test(text)) {
    return 'warning';
  }
  if (/(success|saved|created|updated|deleted|removed|sent|copied)/.test(text)) {
    return 'success';
  }
  return 'info';
};

export const showToast = (message, type) => {
  if (typeof window === 'undefined') return;
  const text = String(message || '').trim();
  if (!text) return;
  const toastType = type || guessToastType(text);
  window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: text, type: toastType } }));
};
