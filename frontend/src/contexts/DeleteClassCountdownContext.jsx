import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/axios';

const STORAGE_KEY = 'waraqa:deleteClassCountdown:v1';
const DEFAULT_DURATION_SECONDS = 5;
const REFRESH_EVENT = 'classes:refresh';

const DeleteClassCountdownContext = createContext(null);

const safeParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const computeSecondsLeft = (endsAtMs) => {
  const msLeft = endsAtMs - Date.now();
  return Math.max(0, Math.ceil(msLeft / 1000));
};

export const DeleteClassCountdownProvider = ({ children }) => {
  const [active, setActive] = useState(false);
  const [classId, setClassId] = useState(null);
  const [scope, setScope] = useState(null);
  const [message, setMessage] = useState('Deleting class');
  const [endsAtMs, setEndsAtMs] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState('');

  const intervalRef = useRef(null);
  const executingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const persist = useCallback((payload) => {
    try {
      if (!payload) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    setActive(false);
    setClassId(null);
    setScope(null);
    setEndsAtMs(null);
    setSecondsLeft(0);
    setMessage('Deleting class');
    setError('');
    persist(null);
    executingRef.current = false;
  }, [clearTimer, persist]);

  const undo = useCallback(() => {
    reset();
  }, [reset]);

  const start = useCallback(({ classId: nextClassId, scope: nextScope, message: nextMessage, durationSeconds }) => {
    if (!nextClassId || !nextScope) return;

    const duration = Number.isFinite(durationSeconds) ? Math.max(1, durationSeconds) : DEFAULT_DURATION_SECONDS;
    const endsAt = Date.now() + duration * 1000;

    setActive(true);
    setClassId(nextClassId);
    setScope(nextScope);
    setMessage(nextMessage || 'Deleting class');
    setEndsAtMs(endsAt);
    setSecondsLeft(duration);
    setError('');

    persist({
      active: true,
      classId: nextClassId,
      scope: nextScope,
      message: nextMessage || 'Deleting class',
      endsAtMs: endsAt
    });
  }, [persist]);

  const executeDelete = useCallback(async () => {
    if (!classId || !scope) return;
    if (executingRef.current) return;
    executingRef.current = true;

    try {
      await api.delete(`/classes/${classId}?deleteType=${scope}`);
      try {
        window.dispatchEvent(new Event(REFRESH_EVENT));
      } catch {
        // ignore
      }
      reset();
    } catch (err) {
      if (err?.response?.status === 404) {
        // Idempotent delete: treat "not found" as already deleted.
        try {
          window.dispatchEvent(new Event(REFRESH_EVENT));
        } catch {
          // ignore
        }
        reset();
        executingRef.current = false;
        return;
      }
      console.error('Delete class failed after countdown', err);
      const msg = err?.response?.data?.message || 'Failed to delete class';
      setError(msg);
      // Keep toast visible until user dismisses/undos.
      setActive(true);
      clearTimer();
      persist({
        active: true,
        classId,
        scope,
        message,
        endsAtMs: Date.now()
      });
      setSecondsLeft(0);
      setEndsAtMs(Date.now());
    } finally {
      executingRef.current = false;
    }
  }, [classId, scope, message, reset, clearTimer, persist]);

  // Keep state in sync across browser tabs/windows.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== STORAGE_KEY) return;
      const parsed = event.newValue ? safeParse(event.newValue) : null;
      if (!parsed?.active || !parsed?.classId || !parsed?.scope || !parsed?.endsAtMs) {
        reset();
        return;
      }

      const restoredSeconds = computeSecondsLeft(parsed.endsAtMs);
      setActive(true);
      setClassId(parsed.classId);
      setScope(parsed.scope);
      setMessage(parsed.message || 'Deleting class');
      setEndsAtMs(parsed.endsAtMs);
      setSecondsLeft(restoredSeconds);
      setError('');
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [reset]);

  // Restore from localStorage on mount
  useEffect(() => {
    const raw = (() => {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    })();

    const parsed = raw ? safeParse(raw) : null;
    if (!parsed?.active || !parsed?.classId || !parsed?.scope || !parsed?.endsAtMs) {
      return;
    }

    const restoredSeconds = computeSecondsLeft(parsed.endsAtMs);
    if (restoredSeconds <= 0) {
      // If it already elapsed while the user navigated away, execute immediately.
      setActive(true);
      setClassId(parsed.classId);
      setScope(parsed.scope);
      setMessage(parsed.message || 'Deleting class');
      setEndsAtMs(parsed.endsAtMs);
      setSecondsLeft(0);
      return;
    }

    setActive(true);
    setClassId(parsed.classId);
    setScope(parsed.scope);
    setMessage(parsed.message || 'Deleting class');
    setEndsAtMs(parsed.endsAtMs);
    setSecondsLeft(restoredSeconds);
  }, []);

  // Drive ticking + completion
  useEffect(() => {
    if (!active || !endsAtMs) {
      clearTimer();
      return;
    }

    clearTimer();
    intervalRef.current = setInterval(() => {
      const next = computeSecondsLeft(endsAtMs);
      setSecondsLeft(next);
      if (next <= 0) {
        clearTimer();
      }
    }, 250);

    return () => {
      clearTimer();
    };
  }, [active, endsAtMs, clearTimer]);

  useEffect(() => {
    if (!active || !endsAtMs) return;
    if (secondsLeft > 0) return;
    if (error) return;
    // Countdown finished
    executeDelete();
  }, [active, endsAtMs, secondsLeft, error, executeDelete]);

  const value = useMemo(() => ({
    isActive: active,
    secondsLeft,
    message,
    error,
    start,
    undo,
    dismiss: reset
  }), [active, secondsLeft, message, error, start, undo, reset]);

  return (
    <DeleteClassCountdownContext.Provider value={value}>
      {children}
    </DeleteClassCountdownContext.Provider>
  );
};

export const useDeleteClassCountdown = () => {
  const ctx = useContext(DeleteClassCountdownContext);
  if (!ctx) {
    throw new Error('useDeleteClassCountdown must be used within DeleteClassCountdownProvider');
  }
  return ctx;
};
