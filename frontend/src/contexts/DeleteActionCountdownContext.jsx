import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_PRE_DELETE_SECONDS = 1;
const DEFAULT_UNDO_SECONDS = 3;

const DeleteActionCountdownContext = createContext(null);

const computeSecondsLeft = (endsAtMs) => {
  const msLeft = endsAtMs - Date.now();
  return Math.max(0, Math.ceil(msLeft / 1000));
};

export const DeleteActionCountdownProvider = ({ children }) => {
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('Deleting item');
  const [phase, setPhase] = useState('idle');
  const [endsAtMs, setEndsAtMs] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [preDelaySeconds, setPreDelaySeconds] = useState(DEFAULT_PRE_DELETE_SECONDS);
  const [undoSeconds, setUndoSeconds] = useState(DEFAULT_UNDO_SECONDS);
  const [error, setError] = useState('');

  const intervalRef = useRef(null);
  const executingRef = useRef(false);
  const executeRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    setActive(false);
    setEndsAtMs(null);
    setSecondsLeft(0);
    setMessage('Deleting item');
    setPhase('idle');
    setPreDelaySeconds(DEFAULT_PRE_DELETE_SECONDS);
    setUndoSeconds(DEFAULT_UNDO_SECONDS);
    setError('');
    executeRef.current = null;
    executingRef.current = false;
  }, [clearTimer]);

  const undo = useCallback(() => {
    reset();
  }, [reset]);

  const start = useCallback(({ message: nextMessage, onDelete, preDelaySeconds: nextPreDelay, undoSeconds: nextUndoSeconds }) => {
    if (typeof onDelete !== 'function') return;

    const undoWindow = Number.isFinite(nextUndoSeconds) ? Math.max(1, nextUndoSeconds) : DEFAULT_UNDO_SECONDS;

    executeRef.current = onDelete;
    setActive(true);
    setPhase('deleting');
    setMessage(nextMessage || 'Deleting item');
    setEndsAtMs(null);
    setSecondsLeft(0);
    setPreDelaySeconds(Number.isFinite(nextPreDelay) ? Math.max(0, nextPreDelay) : DEFAULT_PRE_DELETE_SECONDS);
    setUndoSeconds(undoWindow);
    setError('');
  }, []);

  const executeDelete = useCallback(async () => {
    if (executingRef.current) return;
    if (typeof executeRef.current !== 'function') return;
    executingRef.current = true;

    try {
      await executeRef.current();
      const undoWindow = Number.isFinite(undoSeconds) ? Math.max(1, undoSeconds) : DEFAULT_UNDO_SECONDS;
      const endsAt = Date.now() + undoWindow * 1000;
      setPhase('undo');
      setMessage('Deleted item');
      setEndsAtMs(endsAt);
      setSecondsLeft(undoWindow);
      setPreDelaySeconds(0);
      setError('');
    } catch (err) {
      console.error('Delete action failed after countdown', err);
      const msg = err?.response?.data?.message || 'Failed to delete';
      setError(msg);
      setActive(true);
      clearTimer();
      setPhase('error');
      setSecondsLeft(0);
      setEndsAtMs(Date.now());
    } finally {
      executingRef.current = false;
    }
  }, [undoSeconds, reset, clearTimer]);

  useEffect(() => {
    if (!active || phase !== 'deleting') return;
    executeDelete();
  }, [active, phase, executeDelete]);

  useEffect(() => {
    if (!active || phase !== 'undo' || !endsAtMs) {
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
    if (!active || phase !== 'undo' || !endsAtMs) return;
    if (secondsLeft > 0) return;
    if (error) return;
    reset();
  }, [active, phase, endsAtMs, secondsLeft, error, reset]);

  const value = useMemo(() => ({
    isActive: active,
    secondsLeft,
    message,
    error,
    preDelaySeconds,
    undoSeconds,
    phase,
    start,
    undo,
    dismiss: reset
  }), [active, secondsLeft, message, error, preDelaySeconds, undoSeconds, phase, start, undo, reset]);

  return (
    <DeleteActionCountdownContext.Provider value={value}>
      {children}
    </DeleteActionCountdownContext.Provider>
  );
};

export const useDeleteActionCountdown = () => {
  const ctx = useContext(DeleteActionCountdownContext);
  if (!ctx) {
    throw new Error('useDeleteActionCountdown must be used within DeleteActionCountdownProvider');
  }
  return ctx;
};
