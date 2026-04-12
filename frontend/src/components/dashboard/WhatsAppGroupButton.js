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

  // QR code overlay
  if (status === 'qr' && qrImg) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="bg-white rounded-xl shadow-2xl p-6 max-w-xs w-full text-center relative">
          <button onClick={dismiss} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
          <p className="text-sm font-medium text-gray-700 mb-3">Scan with WhatsApp</p>
          <img src={qrImg} alt="WhatsApp QR" className="mx-auto w-56 h-56 rounded-lg" />
          <p className="text-xs text-gray-400 mt-3">Waiting for scan…</p>
        </div>
      </div>
    );
  }

  // Done state
  if (status === 'done' && result) {
    return (
      <button
        type="button"
        onClick={dismiss}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md"
        title={`Group "${result.groupName}" created`}
      >
        <CheckCircle2 className="h-4 w-4" />
        Group created
      </button>
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
        Retry
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
      {status === 'creating' ? 'Creating…' : 'WA Group'}
    </button>
  );
}
