import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, FileBadge2, RefreshCw, Save, Search, UserPlus, UserRound } from 'lucide-react';
import { convertCandidateToTeacher, listRecruitmentCampaigns, listTeacherContractResponses, updateTeacherContractResponse } from '../../../api/teacherContract';
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

const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'under_review', label: 'Under review' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'interview_pending', label: 'Interview pending' },
  { value: 'interviewed', label: 'Interviewed' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'archived', label: 'Archived' },
];

const RATING_OPTIONS = [
  { value: 'not_available', label: 'Not Available' },
  { value: 'weak', label: 'Weak' },
  { value: 'good', label: 'Good' },
  { value: 'very_good', label: 'Very Good' },
  { value: 'excellent', label: 'Excellent' },
];

const STATUS_TONES = {
  new: 'bg-slate-100 text-slate-700 border-slate-200',
  under_review: 'bg-amber-50 text-amber-700 border-amber-200',
  shortlisted: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  interview_pending: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  interviewed: 'bg-violet-50 text-violet-700 border-violet-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  archived: 'bg-zinc-100 text-zinc-700 border-zinc-200',
};

const RATING_FIELDS = [
  ['english', 'English'],
  ['quran', 'Quran'],
  ['arabic', 'Arabic'],
  ['islamicStudies', 'Islamic Studies'],
  ['teachingDemo', 'Teaching Demo'],
  ['communication', 'Communication'],
  ['punctuality', 'Punctuality'],
  ['professionalism', 'Professionalism'],
  ['flexibility', 'Flexibility'],
];

const GENDER_TONES = {
  male: 'bg-blue-50 text-blue-700 border-blue-200',
  female: 'bg-pink-50 text-pink-700 border-pink-200',
};

const ELIGIBILITY_LABELS = {
  al_azhar: 'Al-Azhar',
  ijazah: 'Ijazah',
  both: 'Al-Azhar + Ijazah',
  other: 'Other background',
};

const ELIGIBILITY_TONES = {
  al_azhar: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ijazah: 'bg-amber-50 text-amber-700 border-amber-200',
  both: 'bg-violet-50 text-violet-700 border-violet-200',
  other: 'bg-slate-100 text-slate-600 border-slate-200',
};

// Stable palette so each selection label keeps a consistent color across cards.
const SELECTION_PALETTE = [
  'bg-sky-50 text-sky-700 border-sky-200',
  'bg-teal-50 text-teal-700 border-teal-200',
  'bg-indigo-50 text-indigo-700 border-indigo-200',
  'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  'bg-lime-50 text-lime-700 border-lime-200',
  'bg-orange-50 text-orange-700 border-orange-200',
  'bg-rose-50 text-rose-700 border-rose-200',
  'bg-cyan-50 text-cyan-700 border-cyan-200',
];

const toneForLabel = (label) => {
  const str = String(label || '');
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return SELECTION_PALETTE[hash % SELECTION_PALETTE.length];
};

const buildSelectionChips = (item) => {
  const chips = [];
  const gender = String(item?.personalInfo?.gender || '').toLowerCase();
  if (gender) {
    chips.push({
      key: `gender-${gender}`,
      label: gender === 'male' ? 'Male' : gender === 'female' ? 'Female' : gender,
      cls: GENDER_TONES[gender] || 'bg-slate-100 text-slate-600 border-slate-200',
    });
  }
  const eligibility = item?.application?.education?.eligibilityPath;
  if (eligibility) {
    chips.push({
      key: `elig-${eligibility}`,
      label: ELIGIBILITY_LABELS[eligibility] || eligibility,
      cls: ELIGIBILITY_TONES[eligibility] || 'bg-slate-100 text-slate-600 border-slate-200',
    });
  }
  (item?.application?.teachingProfile?.subjectsCanTeach || []).forEach((subject) => {
    if (subject) chips.push({ key: `subject-${subject}`, label: subject, cls: toneForLabel(subject) });
  });
  (item?.application?.positionsInterested || []).forEach((position) => {
    if (position) chips.push({ key: `position-${position}`, label: position, cls: toneForLabel(position) });
  });
  return chips;
};

const createDraftFromItem = (item) => ({
  pipelineStatus: item?.recruitment?.status || item?.status || 'new',
  reviewed: item?.recruitment?.reviewed !== false,
  adminNotes: item?.recruitment?.adminNotes || '',
  rejectionCategory: item?.recruitment?.rejectionCategory || '',
  tags: Array.isArray(item?.recruitment?.tags) ? item.recruitment.tags.join(', ') : '',
  fit: {
    campaignId: item?.recruitment?.fit?.campaignId || '',
    subjects: Array.isArray(item?.recruitment?.fit?.subjects) ? item.recruitment.fit.subjects.join(', ') : '',
    genderRequirement: item?.recruitment?.fit?.genderRequirement || '',
    preferredWindow: item?.recruitment?.fit?.preferredWindow || '',
    timezoneNotes: item?.recruitment?.fit?.timezoneNotes || '',
    requiredHoursPerDay: item?.recruitment?.fit?.requiredHoursPerDay ?? '',
  },
  evaluation: RATING_FIELDS.reduce((acc, [key]) => {
    acc[key] = item?.recruitment?.evaluation?.[key] || 'not_available';
    return acc;
  }, {}),
});

const getStatusLabel = (value) => STATUS_OPTIONS.find((option) => option.value === value)?.label || 'New';

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
  const [statusFilter, setStatusFilter] = useState('all');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState('');
  const [notice, setNotice] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [convertingId, setConvertingId] = useState('');
  const [convertForm, setConvertForm] = useState({});

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

  useEffect(() => {
    let mounted = true;
    listRecruitmentCampaigns().then((rows) => {
      if (mounted) setCampaigns(rows || []);
    }).catch(() => {
      if (mounted) setCampaigns([]);
    });
    return () => { mounted = false; };
  }, []);

  const ensureDraft = (item) => {
    setDrafts((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: createDraftFromItem(item) }));
  };

  const updateDraft = (itemId, updater) => {
    setDrafts((prev) => {
      const current = prev[itemId] || createDraftFromItem(items.find((entry) => entry.id === itemId));
      return {
        ...prev,
        [itemId]: updater(current),
      };
    });
  };

  const handleConvert = async (item) => {
    const email = String(convertForm[item.id] ?? item.personalInfo?.email ?? '').trim();
    if (!email) {
      setError('Email is required to create a teacher account.');
      return;
    }
    if (!window.confirm(`Create a teacher account for "${item.personalInfo?.fullName || email}" with email ${email}?`)) return;
    try {
      setConvertingId(item.id);
      setError('');
      setNotice('');
      const result = await convertCandidateToTeacher(item.source, item.id, { email });
      setNotice(`Teacher account created! Email: ${result.email}. Temporary password: ${result.tempPassword} — share this with the teacher and ask them to change it immediately.`);
      setItems((prev) => prev.map((entry) =>
        entry.id === item.id
          ? { ...entry, recruitment: { ...entry.recruitment, status: 'accepted' } }
          : entry
      ));
    } catch (err) {
      if (err?.response?.status === 409) {
        setNotice('A teacher account already exists for this email.');
      } else {
        setError(err?.response?.data?.message || 'Failed to create teacher account.');
      }
    } finally {
      setConvertingId('');
    }
  };

  const handleSave = async (item) => {
    const draft = drafts[item.id] || createDraftFromItem(item);
    try {
      setSavingId(item.id);
      setError('');
      setNotice('');
      const payload = {
        pipelineStatus: draft.pipelineStatus,
        reviewed: draft.reviewed,
        adminNotes: draft.adminNotes,
        rejectionCategory: draft.rejectionCategory,
        tags: draft.tags,
        fit: {
          ...draft.fit,
          campaignId: draft.fit.campaignId || null,
          subjects: draft.fit.subjects,
          requiredHoursPerDay: draft.fit.requiredHoursPerDay,
        },
        evaluation: draft.evaluation,
      };
      const updated = await updateTeacherContractResponse(item.source, item.id, payload);
      if (!updated) return;

      setItems((prev) => prev.map((entry) => (entry.id === item.id ? updated : entry)));
      setDrafts((prev) => ({ ...prev, [item.id]: createDraftFromItem(updated) }));
      setNotice(`Saved review for ${updated.personalInfo?.fullName || updated.contract?.fullName || 'candidate'}.`);
      writeCache(makeCacheKey('meetings:teacherResponses', 'admin'), { items: items.map((entry) => (entry.id === item.id ? updated : entry)) }, { ttlMs: 5 * 60_000, deps: ['teacher-contract'] });
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save recruitment review');
    } finally {
      setSavingId('');
    }
  };

  const summary = useMemo(() => ({
    total: items.length,
    publicCount: items.filter((item) => item.source === 'public').length,
    dashboardCount: items.filter((item) => item.source === 'dashboard').length,
    unreviewed: items.filter((item) => !item?.recruitment?.reviewed).length,
    shortlisted: items.filter((item) => item?.recruitment?.status === 'shortlisted').length,
    interviewPending: items.filter((item) => item?.recruitment?.status === 'interview_pending').length,
  }), [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== 'all' && (item?.recruitment?.status || item.status) !== statusFilter) {
        return false;
      }
      if (campaignFilter !== 'all' && String(item?.recruitment?.fit?.campaignId || '') !== String(campaignFilter)) {
        return false;
      }
      if (!normalizedQuery) return true;
      const haystack = [
        item.personalInfo?.fullName,
        item.personalInfo?.email,
        item.personalInfo?.mobileNumber,
        item.personalInfo?.whatsappNumber,
        item.personalInfo?.nationality,
        item.personalInfo?.occupation,
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [campaignFilter, items, query, statusFilter]);

  return (
    <div className="space-y-6">
      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading teacher responses…</div> : null}

      {!loading ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {[
              ['Total', summary.total],
              ['Unreviewed', summary.unreviewed],
              ['Shortlisted', summary.shortlisted],
              ['Interview pending', summary.interviewPending],
              ['Public forms', summary.publicCount],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search candidates by name, email, phone, or nationality"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
              >
                <option value="all">All stages</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                value={campaignFilter}
                onChange={(event) => setCampaignFilter(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
              >
                <option value="all">All campaigns</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>{campaign.title}</option>
                ))}
              </select>
              <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <RefreshCw className="h-4 w-4" />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <div className="space-y-3">
          {filteredItems.length ? filteredItems.map((item) => {
            const isOpen = expandedId === item.id;
            const source = item.source || 'public';
            const draft = drafts[item.id] || createDraftFromItem(item);
            const statusValue = item?.recruitment?.status || item.status || 'new';
            const overall = item?.recruitment?.overall || {};
            return (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <button type="button" onClick={() => { ensureDraft(item); setExpandedId(isOpen ? '' : item.id); }} className="flex w-full items-start justify-between gap-3 text-left">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${sourceTone[source] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>{source}</span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONES[statusValue] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>{getStatusLabel(statusValue)}</span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${item?.recruitment?.reviewed ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{item?.recruitment?.reviewed ? 'Reviewed' : 'New review'}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{formatDateTime(item.submittedAt)}</span>
                      {overall?.label ? <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white">{overall.label}{overall?.score != null ? ` • ${overall.score}%` : ''}</span> : null}
                    </div>
                    {(() => {
                      const chips = buildSelectionChips(item);
                      return chips.length ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {chips.map((chip) => (
                            <span key={chip.key} className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${chip.cls}`}>{chip.label}</span>
                          ))}
                        </div>
                      ) : null;
                    })()}
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
                        <div className="flex items-center gap-2 font-semibold text-slate-900"><UserRound className="h-4 w-4 text-primary" />Personal details</div>
                        <p className="mt-2"><span className="font-medium text-slate-800">Birth date:</span> {item.personalInfo?.birthDate ? formatDate(item.personalInfo.birthDate) : '—'}</p>
                        <p><span className="font-medium text-slate-800">Gender:</span> {item.personalInfo?.gender || '—'}</p>
                        <p><span className="font-medium text-slate-800">Meeting link:</span> {item.personalInfo?.meetingLink || item.personalInfo?.skypeId || '—'}</p>
                        <p><span className="font-medium text-slate-800">Address:</span> {[item.personalInfo?.address?.street, item.personalInfo?.address?.city, item.personalInfo?.address?.country].filter(Boolean).join(', ') || '—'}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                        <div className="flex items-center gap-2 font-semibold text-slate-900"><FileBadge2 className="h-4 w-4 text-primary" />Documents</div>
                        <div className="mt-2 space-y-2">
                          {[
                            ['Identity', item.verification?.identityDocument?.url, item.verification?.identityDocument?.mimeType],
                            ['Education', item.verification?.educationDocuments?.url, item.verification?.educationDocuments?.mimeType],
                            ['Photo', item.verification?.profilePhoto?.url, item.verification?.profilePhoto?.mimeType],
                          ].map(([label, url, mimeType]) => (
                            <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <span>{label}</span>
                              {url ? <button type="button" onClick={() => openAsset(url, mimeType)} className="inline-flex items-center gap-1 text-primary hover:underline">Open <ExternalLink className="h-3.5 w-3.5" /></button> : <span className="text-slate-400">—</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                      <p className="font-semibold text-slate-900">Introduction</p>
                      <p className="mt-2 whitespace-pre-wrap">{item.verification?.introEssay || '—'}</p>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                        <div className="font-semibold text-slate-900">Application profile</div>
                        <p className="mt-2"><span className="font-medium text-slate-800">Positions:</span> {item.application?.positionsInterested?.join(', ') || '—'}</p>
                        <p><span className="font-medium text-slate-800">Can teach:</span> {item.application?.teachingProfile?.subjectsCanTeach?.join(', ') || '—'}</p>
                        <p><span className="font-medium text-slate-800">Preferred availability:</span> {item.application?.teachingProfile?.preferredAvailability || '—'}</p>
                        <p><span className="font-medium text-slate-800">Alternative availability:</span> {item.application?.teachingProfile?.alternativeAvailability || '—'}</p>
                        <p><span className="font-medium text-slate-800">Current job:</span> {item.application?.experience?.currentJob || '—'}</p>
                        <p><span className="font-medium text-slate-800">Teaching experience:</span> {item.application?.experience?.teachingExperienceLevel || '—'}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                        <div className="font-semibold text-slate-900">Education and tools</div>
                        <p className="mt-2"><span className="font-medium text-slate-800">Eligibility path:</span> {item.application?.education?.eligibilityPath || '—'}</p>
                        <p><span className="font-medium text-slate-800">Graduation:</span> {item.application?.education?.graduationStatus || '—'}</p>
                        <p><span className="font-medium text-slate-800">Faculty / university:</span> {item.application?.education?.facultyUniversity || '—'}</p>
                        <p><span className="font-medium text-slate-800">Degree:</span> {item.application?.education?.degree || '—'}</p>
                        <p><span className="font-medium text-slate-800">Meeting apps:</span> {item.application?.technicalSkills?.meetingApps?.join(', ') || '—'}</p>
                        <p><span className="font-medium text-slate-800">Office tools:</span> {item.application?.technicalSkills?.officeProducts?.join(', ') || '—'}</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                      <div className="font-semibold text-slate-900">About the candidate</div>
                      <p className="mt-2 whitespace-pre-wrap"><span className="font-medium text-slate-800">Profile summary:</span> {item.application?.experience?.profileSummary || '—'}</p>
                      <p className="mt-3 whitespace-pre-wrap"><span className="font-medium text-slate-800">Certificates:</span> {item.application?.education?.additionalCertificates || '—'}</p>
                      <p className="mt-3 whitespace-pre-wrap"><span className="font-medium text-slate-800">Special requests:</span> {item.application?.experience?.specialRequests || '—'}</p>
                      <p className="mt-3 whitespace-pre-wrap"><span className="font-medium text-slate-800">Class tools:</span> {item.application?.technicalSkills?.classTools || '—'}</p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                      <div className="flex items-center gap-2 font-semibold text-slate-900"><FileBadge2 className="h-4 w-4 text-primary" />Application media</div>
                      <div className="mt-2 grid gap-2 lg:grid-cols-2">
                        {[
                          ['Resume', item.application?.files?.resume?.url, item.application?.files?.resume?.mimeType],
                          ['English introduction', item.application?.files?.englishIntroduction?.url, item.application?.files?.englishIntroduction?.mimeType],
                          ['Quran recitation', item.application?.files?.quranRecitation?.url, item.application?.files?.quranRecitation?.mimeType],
                          ['Teaching explanation', item.application?.files?.teachingTopicExplanation?.url, item.application?.files?.teachingTopicExplanation?.mimeType],
                        ].map(([label, url, mimeType]) => (
                          <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <span>{label}</span>
                            {url ? <button type="button" onClick={() => openAsset(url, mimeType)} className="inline-flex items-center gap-1 text-primary hover:underline">Open <ExternalLink className="h-3.5 w-3.5" /></button> : <span className="text-slate-400">—</span>}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-900">Recruitment review</p>
                          <span className="text-xs text-slate-500">Overall: {item?.recruitment?.overall?.label || 'Not rated'}</span>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <label className="text-sm text-slate-700">
                            <span className="mb-1 block font-medium">Stage</span>
                            <select value={draft.pipelineStatus} onChange={(event) => updateDraft(item.id, (current) => ({ ...current, pipelineStatus: event.target.value }))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10">
                              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </label>
                          <label className="text-sm text-slate-700">
                            <span className="mb-1 block font-medium">Rejection category</span>
                            <input value={draft.rejectionCategory} onChange={(event) => updateDraft(item.id, (current) => ({ ...current, rejectionCategory: event.target.value }))} placeholder="Not selected, needs improvement, future pool…" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                          </label>
                          <label className="text-sm text-slate-700 md:col-span-2">
                            <span className="mb-1 block font-medium">Campaign</span>
                            <select value={draft.fit.campaignId} onChange={(event) => updateDraft(item.id, (current) => ({ ...current, fit: { ...current.fit, campaignId: event.target.value } }))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10">
                              <option value="">No campaign</option>
                              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}
                            </select>
                          </label>
                          <label className="text-sm text-slate-700 md:col-span-2">
                            <span className="mb-1 block font-medium">Subjects</span>
                            <input value={draft.fit.subjects} onChange={(event) => updateDraft(item.id, (current) => ({ ...current, fit: { ...current.fit, subjects: event.target.value } }))} placeholder="Quran, Arabic, Islamic Studies" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                          </label>
                          <label className="text-sm text-slate-700">
                            <span className="mb-1 block font-medium">Gender requirement</span>
                            <input value={draft.fit.genderRequirement} onChange={(event) => updateDraft(item.id, (current) => ({ ...current, fit: { ...current.fit, genderRequirement: event.target.value } }))} placeholder="Male, Female, Either" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                          </label>
                          <label className="text-sm text-slate-700">
                            <span className="mb-1 block font-medium">Required hours / day</span>
                            <input type="number" min="0" max="24" step="0.5" value={draft.fit.requiredHoursPerDay} onChange={(event) => updateDraft(item.id, (current) => ({ ...current, fit: { ...current.fit, requiredHoursPerDay: event.target.value } }))} placeholder="4" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                          </label>
                          <label className="text-sm text-slate-700">
                            <span className="mb-1 block font-medium">Preferred Cairo window</span>
                            <input value={draft.fit.preferredWindow} onChange={(event) => updateDraft(item.id, (current) => ({ ...current, fit: { ...current.fit, preferredWindow: event.target.value } }))} placeholder="11 PM - 3 AM Cairo" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                          </label>
                          <label className="text-sm text-slate-700">
                            <span className="mb-1 block font-medium">Timezone notes</span>
                            <input value={draft.fit.timezoneNotes} onChange={(event) => updateDraft(item.id, (current) => ({ ...current, fit: { ...current.fit, timezoneNotes: event.target.value } }))} placeholder="North America overlap, Australia daytime…" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                          </label>
                          <label className="text-sm text-slate-700 md:col-span-2">
                            <span className="mb-1 block font-medium">Tags</span>
                            <input value={draft.tags} onChange={(event) => updateDraft(item.id, (current) => ({ ...current, tags: event.target.value }))} placeholder="strong english, tajweed, future pool" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                          </label>
                          <label className="text-sm text-slate-700 md:col-span-2">
                            <span className="mb-1 block font-medium">Admin notes</span>
                            <textarea value={draft.adminNotes} onChange={(event) => updateDraft(item.id, (current) => ({ ...current, adminNotes: event.target.value }))} rows={5} placeholder="Interview notes, missing data, strengths, concerns…" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                          </label>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-sm font-semibold text-slate-900">Evaluation scorecard</p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {RATING_FIELDS.map(([key, label]) => (
                            <label key={key} className="text-sm text-slate-700">
                              <span className="mb-1 block font-medium">{label}</span>
                              <select value={draft.evaluation[key]} onChange={(event) => updateDraft(item.id, (current) => ({ ...current, evaluation: { ...current.evaluation, [key]: event.target.value } }))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10">
                                {RATING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                            </label>
                          ))}
                        </div>
                        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                          <p><span className="font-semibold text-slate-900">Recommendation:</span> {item?.recruitment?.overall?.recommendation || 'review'}</p>
                          <p className="mt-1"><span className="font-semibold text-slate-900">Reviewed by:</span> {item?.recruitment?.reviewedBy ? `${item.recruitment.reviewedBy.firstName || ''} ${item.recruitment.reviewedBy.lastName || ''}`.trim() || item.recruitment.reviewedBy.email : '—'}</p>
                          <p className="mt-1"><span className="font-semibold text-slate-900">Last reviewed:</span> {item?.recruitment?.reviewedAt ? formatDateTime(item.recruitment.reviewedAt) : '—'}</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {(item?.recruitment?.status === 'accepted' || draft.pipelineStatus === 'accepted') ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                          <p className="mb-2 text-sm font-semibold text-emerald-800">Convert to teacher account</p>
                          <div className="flex gap-2">
                            <input
                              type="email"
                              value={convertForm[item.id] ?? (item.personalInfo?.email || '')}
                              onChange={(e) => setConvertForm((prev) => ({ ...prev, [item.id]: e.target.value }))}
                              placeholder="Confirm teacher email"
                              className="min-w-0 flex-1 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500"
                            />
                            <button type="button" onClick={() => handleConvert(item)} disabled={convertingId === item.id} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                              <UserPlus className="h-4 w-4" />
                              <span>{convertingId === item.id ? 'Creating…' : 'Create account'}</span>
                            </button>
                          </div>
                          <p className="mt-1.5 text-xs text-emerald-700">This creates a teacher login with a temporary password. The candidate's status will be marked as accepted.</p>
                        </div>
                      ) : null}
                      <div className="flex justify-end">
                        <button type="button" onClick={() => handleSave(item)} disabled={savingId === item.id} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60">
                          <Save className="h-4 w-4" />
                          <span>{savingId === item.id ? 'Saving…' : 'Save review'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          }) : <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No teacher responses found for the current filters.</div>}
          </div>
        </>
      ) : null}
    </div>
  );
}
