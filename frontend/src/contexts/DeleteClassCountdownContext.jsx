import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/axios';

const STORAGE_KEY = 'waraqa:deleteClassCountdown:v1';
const DEFAULT_PRE_DELETE_SECONDS = 2;
const DEFAULT_UNDO_SECONDS = 3;
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
  const [classPayload, setClassPayload] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [message, setMessage] = useState('Deleting class');
  const [endsAtMs, setEndsAtMs] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [preDelaySeconds, setPreDelaySeconds] = useState(DEFAULT_PRE_DELETE_SECONDS);
  const [undoSeconds, setUndoSeconds] = useState(DEFAULT_UNDO_SECONDS);
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
    setClassPayload(null);
    setPhase('idle');
    setEndsAtMs(null);
    setSecondsLeft(0);
    setMessage('Deleting class');
    setPreDelaySeconds(DEFAULT_PRE_DELETE_SECONDS);
    setUndoSeconds(DEFAULT_UNDO_SECONDS);
    setError('');
    persist(null);
    executingRef.current = false;
  }, [clearTimer, persist]);

  const normalizeId = (value) => {
    if (!value) return null;
    if (typeof value === 'string' || typeof value === 'number') return value.toString();
    if (typeof value === 'object') {
      if (value._id) return value._id.toString();
      if (value.id) return value.id.toString();
    }
    return value?.toString?.() || null;
  };

  const buildRestorePayload = useCallback((payload) => {
    if (!payload) return null;
    const teacherId = normalizeId(payload.teacher);
    const guardianId = normalizeId(payload.student?.guardianId);
    const studentId = normalizeId(payload.student?.studentId);
    if (!teacherId || !guardianId || !studentId) return null;

    return {
      title: payload.title || payload.subject || 'Class',
      description: payload.description || '',
      subject: payload.subject || 'Class',
      teacher: teacherId,
      student: {
        guardianId,
        studentId,
        studentName: payload.student?.studentName || payload.student?.name || ''
      },
      scheduledDate: payload.scheduledDate || payload.date || null,
      duration: Number(payload.duration || 60),
      timezone: payload.timezone || payload.scheduledTimezone || 'UTC',
      isRecurring: false,
      meetingLink: payload.meetingLink || null,
      materials: Array.isArray(payload.materials) ? payload.materials : []
    };
  }, []);

  const start = useCallback(({ classId: nextClassId, scope: nextScope, message: nextMessage, preDelaySeconds: nextPreDelay, undoSeconds: nextUndoSeconds, classPayload: nextPayload }) => {
    if (!nextClassId || !nextScope) return;

    const undoWindow = Number.isFinite(nextUndoSeconds) ? Math.max(1, nextUndoSeconds) : DEFAULT_UNDO_SECONDS;

    setActive(true);
    setClassId(nextClassId);
    setScope(nextScope);
    setClassPayload(nextPayload || null);
    setPhase('deleting');
    setMessage(nextMessage || 'Deleting class');
    setEndsAtMs(null);
    setSecondsLeft(0);
    setPreDelaySeconds(Number.isFinite(nextPreDelay) ? Math.max(0, nextPreDelay) : DEFAULT_PRE_DELETE_SECONDS);
    setUndoSeconds(undoWindow);
    setError('');

    persist({
      active: true,
      classId: nextClassId,
      scope: nextScope,
      classPayload: nextPayload || null,
      phase: 'deleting',
      message: nextMessage || 'Deleting class',
      endsAtMs: null,
      preDelaySeconds: Number.isFinite(nextPreDelay) ? Math.max(0, nextPreDelay) : DEFAULT_PRE_DELETE_SECONDS,
      undoSeconds: undoWindow
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

      const allowUndo = scope === 'single' && classPayload;
      if (!allowUndo) {
        reset();
        return;
      }

      const undoWindow = Number.isFinite(undoSeconds) ? Math.max(1, undoSeconds) : DEFAULT_UNDO_SECONDS;
      const endsAt = Date.now() + undoWindow * 1000;
      setPhase('undo');
      setMessage('Deleted class');
      setEndsAtMs(endsAt);
      setSecondsLeft(undoWindow);
      setPreDelaySeconds(0);
      setError('');

      persist({
        active: true,
        classId,
        scope,
        classPayload,
        phase: 'undo',
        message: 'Deleted class',
        endsAtMs: endsAt,
        preDelaySeconds: 0,
        undoSeconds: undoWindow
      });
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
      setPhase('error');
      persist({
        active: true,
        classId,
        scope,
        classPayload,
        phase: 'error',
        message,
        endsAtMs: Date.now(),
        preDelaySeconds,
        undoSeconds
      });
      setSecondsLeft(0);
      setEndsAtMs(Date.now());
    } finally {
      executingRef.current = false;
    }
  }, [classId, scope, classPayload, message, preDelaySeconds, undoSeconds, reset, clearTimer, persist]);

  useEffect(() => {
    if (!active || phase !== 'deleting') return;
    executeDelete();
  }, [active, phase, executeDelete]);

  const undo = useCallback(async () => {
    if (phase !== 'undo') {
      reset();
      return;
    }

    const payload = buildRestorePayload(classPayload);
    if (!payload) {
      setError('Cannot undo: missing class details');
      clearTimer();
      return;
    }

    try {
      await api.post('/classes', payload);
      try {
        window.dispatchEvent(new Event(REFRESH_EVENT));
      } catch {
        // ignore
      }
      reset();
    } catch (err) {
      console.error('Undo delete failed', err);
      const msg = err?.response?.data?.message || 'Failed to undo delete';
      setError(msg);
      clearTimer();
    }
  }, [phase, classPayload, buildRestorePayload, reset, clearTimer]);

  // Keep state in sync across browser tabs/windows.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== STORAGE_KEY) return;
      const parsed = event.newValue ? safeParse(event.newValue) : null;
      if (!parsed?.active || !parsed?.classId || !parsed?.scope) {
        reset();
        return;
      }

      const restoredSeconds = parsed.endsAtMs ? computeSecondsLeft(parsed.endsAtMs) : 0;
      setActive(true);
      setClassId(parsed.classId);
      setScope(parsed.scope);
      setClassPayload(parsed.classPayload || null);
      setPhase(parsed.phase || 'deleting');
      setMessage(parsed.message || 'Deleting class');
      setEndsAtMs(parsed.endsAtMs);
      setSecondsLeft(restoredSeconds);
      setPreDelaySeconds(Number.isFinite(parsed.preDelaySeconds) ? parsed.preDelaySeconds : DEFAULT_PRE_DELETE_SECONDS);
      setUndoSeconds(Number.isFinite(parsed.undoSeconds) ? parsed.undoSeconds : DEFAULT_UNDO_SECONDS);
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
    if (!parsed?.active || !parsed?.classId || !parsed?.scope) {
      return;
    }

    const restoredSeconds = parsed.endsAtMs ? computeSecondsLeft(parsed.endsAtMs) : 0;
    setActive(true);
    setClassId(parsed.classId);
    setScope(parsed.scope);
    setClassPayload(parsed.classPayload || null);
    setPhase(parsed.phase || 'deleting');
    setMessage(parsed.message || 'Deleting class');
    setEndsAtMs(parsed.endsAtMs);
    setSecondsLeft(restoredSeconds);
    setPreDelaySeconds(Number.isFinite(parsed.preDelaySeconds) ? parsed.preDelaySeconds : DEFAULT_PRE_DELETE_SECONDS);
    setUndoSeconds(Number.isFinite(parsed.undoSeconds) ? parsed.undoSeconds : DEFAULT_UNDO_SECONDS);
  }, []);

  // Drive ticking + completion
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
