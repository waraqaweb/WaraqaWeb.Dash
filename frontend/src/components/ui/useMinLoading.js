import { useEffect, useRef, useState } from 'react';

// NOTE: Historically this hook enforced a *minimum visible spinner duration*.
// That caused UX issues where empty states were delayed even when the API
// returned instantly.
//
// New behavior: immediate spinner by default.
// - Spinner appears as soon as loading starts.
// - Spinner hides immediately when loading becomes false.
const DEFAULT_DELAY_MS = 0;

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
