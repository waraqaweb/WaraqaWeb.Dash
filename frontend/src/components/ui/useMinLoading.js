import { useEffect, useRef, useState } from 'react';

const DEFAULT_MIN_DURATION_MS = 5000;

const useMinLoading = (loading, minDurationMs = DEFAULT_MIN_DURATION_MS) => {
  const [showLoading, setShowLoading] = useState(Boolean(loading));
  const startRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (loading) {
      startRef.current = Date.now();
      setShowLoading(true);
      return undefined;
    }

    if (!showLoading) return undefined;

    const elapsed = Date.now() - (startRef.current || Date.now());
    const remaining = Math.max(0, Number(minDurationMs) - elapsed);
    if (remaining === 0) {
      setShowLoading(false);
      return undefined;
    }

    timerRef.current = setTimeout(() => {
      setShowLoading(false);
      timerRef.current = null;
    }, remaining);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [loading, minDurationMs, showLoading]);

  return showLoading;
};

export default useMinLoading;
