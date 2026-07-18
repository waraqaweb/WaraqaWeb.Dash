import React, { useEffect, useState } from 'react';
import { CheckCircle2, FileText, Loader2, ShieldCheck } from 'lucide-react';
import { acceptPublicTeacherAgreement, getPublicTeacherAgreement } from '../../api/teacherContract';

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10';
const containsArabic = (value = '') => /[\u0600-\u06FF]/.test(String(value));

export default function PublicTeacherAgreementPage() {
  const token = new URLSearchParams(window.location.search).get('token') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [fullName, setFullName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acceptedAt, setAcceptedAt] = useState(null);

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setError('This contract link is invalid or has expired.');
      setLoading(false);
      return () => { mounted = false; };
    }
    getPublicTeacherAgreement(token)
      .then((res) => {
        if (!mounted) return;
        setData(res);
        setFullName(res.acceptedName || res.name || '');
        setAcceptedAt(res.acceptedAt || null);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err?.response?.data?.message || 'This contract link is invalid or has expired.');
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [token]);

  const handleAccept = async () => {
    if (!fullName.trim() || !accepted) {
      setError('Please write your full legal name and confirm you agree to the terms.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await acceptPublicTeacherAgreement(token, fullName.trim());
      setAcceptedAt(res.acceptedAt || new Date().toISOString());
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to record your acceptance. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading contract…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-800">
        <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Contract unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  if (acceptedAt) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-800">
        <div className="max-w-md rounded-3xl border border-emerald-100 bg-white p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h1 className="mt-3 text-xl font-semibold text-slate-900">Contract accepted</h1>
          <p className="mt-2 text-sm text-slate-600">
            Thank you{fullName ? `, ${fullName}` : ''}. Your acceptance was recorded on{' '}
            {new Date(acceptedAt).toLocaleString()}. The Waraqa team will be in touch with the next steps.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-800">
      <div className="mx-auto max-w-3xl rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-4 border-b border-slate-100 pb-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 shadow-sm">
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <FileText className="h-3.5 w-3.5" />Teacher contract
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">Review &amp; accept your contract</h1>
            {data?.name ? <p className="mt-1 text-sm text-slate-500">Prepared for {data.name}</p> : null}
          </div>
        </div>

        <div
          className={`mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-7 text-slate-700 ${containsArabic(data?.contractText) ? 'text-right' : 'text-left'}`}
          dir={containsArabic(data?.contractText) ? 'rtl' : 'ltr'}
        >
          <div className="whitespace-pre-wrap leading-7 text-slate-700">{data?.contractText || 'Contract text is not available.'}</div>
        </div>

        {error ? <p className="mt-4 text-sm font-medium text-rose-600">{error}</p> : null}

        <div className="mt-6 space-y-4">
          <input
            className={inputClass}
            placeholder="Full legal name *"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>I have read the contract above and agree to its terms.</span>
          </label>
          <button
            type="button"
            onClick={handleAccept}
            disabled={saving || !fullName.trim() || !accepted}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Accept contract
          </button>
        </div>
      </div>
    </div>
  );
}
