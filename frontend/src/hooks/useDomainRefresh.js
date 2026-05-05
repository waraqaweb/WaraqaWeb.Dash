import { useEffect, useMemo, useRef } from 'react';
import { getDomainRefreshEventName } from '../utils/domainRefresh';

const isPageVisible = () => {
  try {
    return typeof document === 'undefined' || document.visibilityState === 'visible';
  } catch (error) {
    return true;
  }
};

const clearTimer = (timerRef) => {
  if (!timerRef.current) return;
  clearTimeout(timerRef.current);
  timerRef.current = null;
};

const useDomainRefresh = ({
  domains = [],
  isActive = true,
  onRefresh,
  minIntervalMs = 1500,
  enabled = true,
}) => {
  const onRefreshRef = useRef(onRefresh);
  const pendingRef = useRef(false);
  const lastRunAtRef = useRef(0);
  const timerRef = useRef(null);
  const scheduleRefreshRef = useRef(() => {});

  const normalizedDomains = useMemo(() => Array.from(new Set(
    (Array.isArray(domains) ? domains : [domains])
      .map((domain) => String(domain || '').trim())
      .filter(Boolean)
  )), [domains]);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled || !normalizedDomains.length || typeof window === 'undefined') {
      scheduleRefreshRef.current = () => {};
      clearTimer(timerRef);
      return undefined;
    }

    const flush = () => {
      if (!enabled) return;
      if (!isActive || !isPageVisible()) {
        pendingRef.current = true;
        return;
      }

      pendingRef.current = false;
      lastRunAtRef.current = Date.now();

      try {
        onRefreshRef.current?.();
      } catch (error) {
        // ignore refresh callback errors
      }
    };

    const schedule = () => {
      pendingRef.current = true;

      if (!enabled || !isActive || !isPageVisible()) {
        return;
      }

      const elapsed = Date.now() - lastRunAtRef.current;
      const remaining = Math.max(0, minIntervalMs - elapsed);

      if (remaining === 0) {
        clearTimer(timerRef);
        flush();
        return;
      }

      if (timerRef.current) return;

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (pendingRef.current) {
          flush();
        }
      }, remaining);
    };

    scheduleRefreshRef.current = schedule;

    const eventListeners = normalizedDomains.map((domain) => {
      const eventName = getDomainRefreshEventName(domain);
      const handler = () => schedule();
      window.addEventListener(eventName, handler);
      return { eventName, handler };
    });

    const handleVisibility = () => {
      if (pendingRef.current && isActive && isPageVisible()) {
        schedule();
      }
    };

    window.addEventListener('focus', handleVisibility);
    window.addEventListener('online', handleVisibility);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      clearTimer(timerRef);
      eventListeners.forEach(({ eventName, handler }) => {
        window.removeEventListener(eventName, handler);
      });
      window.removeEventListener('focus', handleVisibility);
      window.removeEventListener('online', handleVisibility);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [enabled, isActive, minIntervalMs, normalizedDomains]);

  useEffect(() => {
    if (!enabled || !isActive || !pendingRef.current) return;
    scheduleRefreshRef.current();
  }, [enabled, isActive]);
};

export default useDomainRefresh;