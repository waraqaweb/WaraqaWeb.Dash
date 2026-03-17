import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, FileBadge2, RefreshCw, UserRound } from 'lucide-react';
import { listTeacherContractResponses } from '../../../api/teacherContract';
import { makeCacheKey, readCache, writeCache } from '../../../utils/sessionCache';

const formatDate = (value) => {
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
  } catch {
    return '—';
  }
};

const formatDateTime = (value) => {
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
  } catch {
    return '—';
  }
};

const sourceTone = {
  public: 'bg-sky-50 text-sky-700 border-sky-200',
  dashboard: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const openAsset = async (url, mimeType = '') => {
  if (!url) return;

  if (!String(url).startsWith('data:')) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  const popup = window.open('', '_blank');
  if (!popup) return;
  popup.document.write('<p style="font-family: sans-serif; padding: 16px;">Opening file…</p>');

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    popup.location.replace(blobUrl);
    popup.addEventListener('beforeunload', () => {
      URL.revokeObjectURL(blobUrl);
    }, { once: true });
  } catch {
    popup.close();
  }
};

export default function TeacherResponsesPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState('');

  const load = async () => {
    try {
      const cacheKey = makeCacheKey('meetings:teacherResponses', 'admin');
      const cached = readCache(cacheKey, { deps: ['teacher-contract'] });
      if (cached.hit && Array.isArray(cached.value?.items)) {
        setItems(cached.value.items);
        setLoading(false);
        if (cached.ageMs < 60_000) {
          setError('');
          return;
        }
      } else {
        setLoading((prev) => prev && items.length === 0);
      }

      setError('');
      const data = await listTeacherContractResponses();
      const nextItems = data || [];
      setItems(nextItems);
      writeCache(cacheKey, { items: nextItems }, { ttlMs: 5 * 60_000, deps: ['teacher-contract'] });
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load teacher responses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const summary = useMemo(() => ({
    total: items.length,
    publicCount: items.filter((item) => item.source === 'public').length,
    dashboardCount: items.filter((item) => item.source === 'dashboard').length,
  }), [items]);

  return (
    <div className="space-y-6">
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading teacher responses…</div> : null}

      {!loading ? (
        <div className="space-y-3">
          {items.length ? items.map((item) => {
            const isOpen = expandedId === item.id;
            const source = item.source || 'public';
            return (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <button type="button" onClick={() => setExpandedId(isOpen ? '' : item.id)} className="flex w-full items-start justify-between gap-3 text-left">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${sourceTone[source] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>{source}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{formatDateTime(item.submittedAt)}</span>
                    </div>
                    <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-4 xl:grid-cols-6">
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Name</p><p className="break-words font-semibold text-slate-900">{item.personalInfo?.fullName || item.contract?.fullName || '—'}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Email</p><p className="break-words">{item.personalInfo?.email || '—'}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Phone</p><p>{item.personalInfo?.mobileNumber || '—'}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">WhatsApp</p><p>{item.personalInfo?.whatsappNumber || '—'}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Nationality</p><p>{item.personalInfo?.nationality || '—'}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Occupation</p><p>{item.personalInfo?.occupation || '—'}</p></div>
                    </div>
                  </div>
                  {isOpen ? <ChevronUp className="mt-1 h-4 w-4 text-slate-400" /> : <ChevronDown className="mt-1 h-4 w-4 text-slate-400" />}
                </button>
                {isOpen ? (
                  <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                        <div className="flex items-center gap-2 font-semibold text-slate-900"><UserRound className="h-4 w-4 text-[#2C736C]" />Personal details</div>
                        <p className="mt-2"><span className="font-medium text-slate-800">Birth date:</span> {item.personalInfo?.birthDate ? formatDate(item.personalInfo.birthDate) : '—'}</p>
                        <p><span className="font-medium text-slate-800">Gender:</span> {item.personalInfo?.gender || '—'}</p>
                        <p><span className="font-medium text-slate-800">Meeting link:</span> {item.personalInfo?.meetingLink || item.personalInfo?.skypeId || '—'}</p>
                        <p><span className="font-medium text-slate-800">Address:</span> {[item.personalInfo?.address?.street, item.personalInfo?.address?.city, item.personalInfo?.address?.country].filter(Boolean).join(', ') || '—'}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                        <div className="flex items-center gap-2 font-semibold text-slate-900"><FileBadge2 className="h-4 w-4 text-[#2C736C]" />Documents</div>
                        <div className="mt-2 space-y-2">
                          {[
                            ['Identity', item.verification?.identityDocument?.url, item.verification?.identityDocument?.mimeType],
                            ['Education', item.verification?.educationDocuments?.url, item.verification?.educationDocuments?.mimeType],
                            ['Photo', item.verification?.profilePhoto?.url, item.verification?.profilePhoto?.mimeType],
                          ].map(([label, url, mimeType]) => (
                            <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <span>{label}</span>
                              {url ? <button type="button" onClick={() => openAsset(url, mimeType)} className="inline-flex items-center gap-1 text-[#2C736C] hover:underline">Open <ExternalLink className="h-3.5 w-3.5" /></button> : <span className="text-slate-400">—</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                      <p className="font-semibold text-slate-900">Introduction</p>
                      <p className="mt-2 whitespace-pre-wrap">{item.verification?.introEssay || '—'}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          }) : <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No teacher responses found.</div>}
        </div>
      ) : null}
    </div>
  );
}
