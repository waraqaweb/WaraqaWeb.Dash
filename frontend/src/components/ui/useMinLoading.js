import { useEffect, useRef, useState } from 'react';

// NOTE: Historically this hook enforced a *minimum visible spinner duration*.
// That caused UX issues where empty states were delayed even when the API
// returned instantly.
//
// New behavior: delayed-show spinner.
// - If loading resolves quickly (< delayMs), the spinner never appears.
// - If loading is slow, spinner appears after delayMs.
// - Spinner hides immediately when loading becomes false.
const DEFAULT_DELAY_MS = 150;

const useMinLoading = (loading, delayMs = DEFAULT_DELAY_MS) => {
  const [showLoading, setShowLoading] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (loading) {
      const delay = Number(delayMs) || 0;
      if (delay <= 0) {
        setShowLoading(true);
        return undefined;
      }
      timerRef.current = setTimeout(() => {
        setShowLoading(true);
        timerRef.current = null;
      }, delay);
      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    }

    // Not loading: hide immediately.
    setShowLoading(false);
    return undefined;
  }, [loading, delayMs]);

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return showLoading;
};

export default useMinLoading;
