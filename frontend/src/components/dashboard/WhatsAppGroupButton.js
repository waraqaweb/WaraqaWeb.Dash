import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api/axios';
import { MessageCircle, Loader2, CheckCircle2, X } from 'lucide-react';

const QR_POLL_INTERVAL = 2000;

/**
 * WhatsApp group-creation button with inline QR auth flow.
 * Props: classId — the class to create a group for.
 */
export default function WhatsAppGroupButton({ classId }) {
  const [status, setStatus] = useState(null); // null | 'checking' | 'qr' | 'creating' | 'done' | 'error'
  const [qrImg, setQrImg] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const createGroup = useCallback(async () => {
    setStatus('creating');
    setQrImg(null);
    try {
      const { data } = await api.post('/whatsapp/create-group', { classId });
      if (!mountedRef.current) return;
      setResult(data);
      setStatus('done');
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err.response?.data?.error || err.message);
      setStatus('error');
    }
  }, [classId]);

  const pollQr = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get('/whatsapp/qr');
        if (!mountedRef.current) return stopPolling();
        if (data.ready) {
          stopPolling();
          createGroup();
        } else if (data.qr) {
          setQrImg(data.qr);
          setStatus('qr');
        }
      } catch {
        // ignore polling errors
      }
    }, QR_POLL_INTERVAL);
  }, [stopPolling, createGroup]);

  const handleClick = async () => {
    if (status === 'qr' || status === 'creating') return; // prevent double-click
    setStatus('checking');
    setError(null);
    setResult(null);
    setQrImg(null);

    try {
      // Check if already ready
      const { data: st } = await api.get('/whatsapp/status');
      if (st.ready) {
        return createGroup();
      }

      // Not ready — init and show QR
      const { data: init } = await api.post('/whatsapp/init');
      if (init.ready) {
        return createGroup();
      }
      if (init.qr) {
        setQrImg(init.qr);
        setStatus('qr');
      }
      // Poll for QR updates / ready
      pollQr();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setStatus('error');
    }
  };

  const dismiss = () => {
    stopPolling();
    setStatus(null);
    setQrImg(null);
    setError(null);
    setResult(null);
  };

  const formatParticipantLabel = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    if (normalized === 'teacher') return 'teacher';
    if (normalized === 'student') return 'student';
    if (normalized === 'guardian') return 'guardian';
    return normalized.replace(/_/g, ' ');
  };

  const invitedSummary = Array.isArray(result?.invitedParticipants)
    ? result.invitedParticipants.map(formatParticipantLabel).filter(Boolean).join(', ')
    : '';
  const missingSummary = Array.isArray(result?.missingParticipants)
    ? result.missingParticipants.map(formatParticipantLabel).filter(Boolean).join(', ')
    : '';

  // QR code overlay
  if (status === 'qr' && qrImg) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
        <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full relative">
          <button onClick={dismiss} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
          <p className="text-base font-semibold text-gray-800 mb-1 text-center">Link Waraqa to WhatsApp</p>
          <p className="text-xs text-gray-500 mb-3 text-center">This QR is for WhatsApp Linked Devices. It links Waraqa first, then the actual group is created automatically.</p>
          <img src={qrImg} alt="WhatsApp QR" className="mx-auto w-56 h-56 rounded-lg border" />
          <ol className="mt-4 text-xs text-gray-600 list-decimal pl-5 space-y-1">
            <li>Open <span className="font-medium">WhatsApp</span> on your phone.</li>
            <li>Tap <span className="font-medium">Settings</span> (or the three dots menu on Android).</li>
            <li>Tap <span className="font-medium">Linked Devices</span> → <span className="font-medium">Link a device</span>.</li>
            <li>Point your phone&apos;s camera at this QR code.</li>
          </ol>
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-center text-[11px] text-emerald-800">After the scan, Waraqa creates a group named like “Waraqa: Student Name” and invites the teacher plus the student or guardian when phone numbers are available.</p>
          <p className="text-xs text-gray-400 mt-3 text-center">Waiting for scan…</p>
        </div>
      </div>
    );
  }

  // Done state
  if (status === 'done' && result) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            Group created
          </div>
          <button type="button" onClick={dismiss} className="text-xs font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900">
            Close
          </button>
        </div>
        <p className="mt-1 text-xs font-semibold">{result.groupName}</p>
        {invitedSummary && (
          <p className="mt-1 text-xs">Invited: {invitedSummary}</p>
        )}
        {missingSummary && (
          <p className="mt-1 text-xs">Missing phone: {missingSummary}</p>
        )}
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md"
        title={error || 'Failed'}
      >
        <MessageCircle className="h-4 w-4" />
        Retry WhatsApp
      </button>
    );
  }

  // Loading / default
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={status === 'checking' || status === 'creating'}
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 disabled:opacity-50 transition-colors"
      title="Create WhatsApp group for this class"
    >
      {status === 'checking' || status === 'creating' ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <MessageCircle className="h-4 w-4" />
      )}
      {status === 'creating' ? 'Creating…' : 'Create WhatsApp group'}
    </button>
  );
}
