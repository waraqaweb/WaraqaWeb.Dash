import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ChevronDown, ChevronUp, ExternalLink, FileBadge2, FileSpreadsheet, LayoutGrid, Mail, Maximize2, MessageCircle, Minimize2, Phone, Play, RefreshCw, Save, Search, Settings2, Table2, UserPlus, X } from 'lucide-react';
import { convertCandidateToTeacher, getSheetSyncConfig, listRecruitmentCampaigns, listTeacherContractResponses, runSheetSyncNow, saveSheetSyncConfig, updateTeacherContractResponse } from '../../../api/teacherContract';
import { bumpDomainVersion, makeCacheKey, readCache, writeCache } from '../../../utils/sessionCache';

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

const getDriveId = (url) => {
  const s = String(url || '');
  let m = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return '';
};

// Decide how to render a file inline (image/audio/video player or embedded iframe).
const resolveMedia = (url, mimeType = '') => {
  const raw = String(url || '');
  const lower = raw.toLowerCase();
  if (/drive\.google\.com|docs\.google\.com/.test(lower)) {
    const driveId = getDriveId(raw);
    if (driveId) return { kind: 'iframe', src: `https://drive.google.com/file/d/${driveId}/preview`, download: raw };
    return { kind: 'iframe', src: raw, download: raw };
  }
  const type = String(mimeType || '').toLowerCase();
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(lower)) return { kind: 'image', src: raw, download: raw };
  if (type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|oga)(\?|$)/i.test(lower)) return { kind: 'audio', src: raw, download: raw };
  if (type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(lower)) return { kind: 'video', src: raw, download: raw };
  return { kind: 'iframe', src: raw, download: raw };
};

// Build a WhatsApp deep link from any phone format (Egyptian local numbers default to +20).
const waLink = (phone) => {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `20${digits.slice(1)}`;
  return `https://wa.me/${digits}`;
};

const mailtoLink = (email) => {
  if (!email) return '';
  return `mailto:${email}?subject=${encodeURIComponent('Waraqa Institute — your teaching application')}`;
};

// Contact action buttons (WhatsApp / Email / Call) reused in cards and the table.
function ContactActions({ item, compact = false }) {
  const p = item.personalInfo || {};
  const wa = waLink(p.whatsappNumber || p.mobileNumber);
  const email = p.email || item.user?.email || '';
  const mailto = mailtoLink(email);
  const phone = p.mobileNumber || p.whatsappNumber || '';
  if (!wa && !mailto && !phone) return <span className="text-slate-400">—</span>;
  const base = compact
    ? 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium'
    : 'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold';
  const icon = compact ? 'h-3 w-3' : 'h-3.5 w-3.5';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {wa ? <a href={wa} target="_blank" rel="noreferrer" className={`${base} bg-green-600 text-white hover:bg-green-700`}><MessageCircle className={icon} /> WhatsApp</a> : null}
      {mailto ? <a href={mailto} className={`${base} bg-sky-600 text-white hover:bg-sky-700`}><Mail className={icon} /> Email</a> : null}
      {phone && !compact ? <a href={`tel:${phone}`} className={`${base} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}><Phone className={icon} /> Call</a> : null}
    </div>
  );
}

const displayValue = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || '—';
  return value == null || value === '' ? '—' : value;
};

// One spreadsheet-style cell: tiny header label + value inside a bordered cell.
function ExcelCell({ label, value, span = 1, clamp = true }) {
  const text = displayValue(value);
  return (
    <td colSpan={span} className="border border-slate-200 bg-white px-2 py-1.5 align-top" title={typeof text === 'string' ? text : undefined}>
      <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 break-words text-xs leading-snug text-slate-800 ${clamp ? 'line-clamp-3' : 'whitespace-pre-wrap'}`}>{text}</p>
    </td>
  );
}

function FileActionGrid({ item, openViewer }) {
  const files = [
    ['Resume', item.application?.files?.resume, FileBadge2],
    ['Intro audio', item.application?.files?.englishIntroduction, Play],
    ['Quran recitation', item.application?.files?.quranRecitation, Play],
    ['Topic explanation', item.application?.files?.teachingTopicExplanation, Play],
  ];
  const available = files.filter(([, file]) => file?.url);
  if (!available.length) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-400">
        <FileBadge2 className="h-3.5 w-3.5" /> No files
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {available.map(([label, file, Icon]) => (
        <button key={label} type="button" onClick={() => openViewer(label, file.url, file.mimeType)} className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10">
          <Icon className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}

// All applicant data compressed into a 3-row spreadsheet-style grid.
function CandidateFacts({ item }) {
  const p = item.personalInfo || {};
  const a = item.application || {};
  const address = [p.address?.street, p.address?.city, p.address?.country].filter(Boolean).join(', ');
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-300">
        <table className="w-full min-w-[980px] table-fixed border-collapse">
          <tbody>
            <tr>
              <ExcelCell label="Name" value={p.fullName || item.contract?.fullName} />
              <ExcelCell label="Email" value={p.email} />
              <ExcelCell label="Phone" value={p.mobileNumber} />
              <ExcelCell label="WhatsApp" value={p.whatsappNumber} />
              <ExcelCell label="Birth date" value={p.birthDate ? formatDate(p.birthDate) : ''} />
              <ExcelCell label="Gender" value={p.gender} />
              <ExcelCell label="Address" value={address} />
            </tr>
            <tr>
              <ExcelCell label="Positions" value={a.positionsInterested} span={2} />
              <ExcelCell label="Graduation" value={a.education?.graduationStatus} />
              <ExcelCell label="Faculty / University" value={a.education?.facultyUniversity} />
              <ExcelCell label="Degree" value={a.education?.degree} />
              <ExcelCell label="Certificates" value={a.education?.additionalCertificates} />
              <ExcelCell label="Experience" value={a.experience?.teachingExperienceLevel} />
            </tr>
            <tr>
              <ExcelCell label="Current job" value={a.experience?.currentJob} span={2} />
              <ExcelCell label="What we should know" value={a.experience?.profileSummary} span={3} clamp={false} />
              <ExcelCell label="Submitted" value={item.submittedAt ? formatDateTime(item.submittedAt) : ''} />
              <ExcelCell label="Stage" value={getStatusLabel(item?.recruitment?.status || item.status)} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Spreadsheet-style overview of every applicant using only the fields the form collects.
function ApplicantTable({ rows, openViewer, onQuickStage, quickStageId, selectedIds, onToggleSelect, onToggleSelectAll, onArchive }) {
  const cell = (value) => (value == null || value === '' ? '—' : value);
  const fileButtons = (item) => {
    const files = [
      ['Resume', item.application?.files?.resume],
      ['Intro', item.application?.files?.englishIntroduction],
      ['Recitation', item.application?.files?.quranRecitation],
      ['Explanation', item.application?.files?.teachingTopicExplanation],
    ].filter(([, file]) => file?.url);
    if (!files.length) return <span className="text-slate-400">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {files.map(([label, file]) => (
          <button key={label} type="button" onClick={() => openViewer(label, file.url, file.mimeType)} className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10">
            <Play className="h-3 w-3" />{label}
          </button>
        ))}
      </div>
    );
  };
  const columns = ['Name', 'Email', 'Phone', 'Gender', 'Birth date', 'Address', 'Positions', 'Graduation', 'Faculty / University', 'Degree', 'Certificates', 'Teaching experience', 'Current job', 'What we should know', 'Stage', 'Contact', 'Files', ''];
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[1600px] border-collapse text-left text-xs text-slate-700">
        <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="w-9 border-b border-slate-200 px-3 py-2">
              <input type="checkbox" checked={allSelected} onChange={() => onToggleSelectAll(rows)} className="h-3.5 w-3.5 rounded border-slate-300" aria-label="Select all" />
            </th>
            {columns.map((header) => (
              <th key={header} className="whitespace-nowrap border-b border-slate-200 px-3 py-2">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const p = item.personalInfo || {};
            const a = item.application || {};
            const address = [p.address?.street, p.address?.city, p.address?.country].filter(Boolean).join(', ');
            return (
              <tr key={item.id} className="align-top odd:bg-white even:bg-slate-50/50">
                <td className="border-b border-slate-100 px-3 py-2">
                  <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => onToggleSelect(item.id)} className="h-3.5 w-3.5 rounded border-slate-300" aria-label={`Select ${p.fullName || p.email || 'candidate'}`} />
                </td>
                <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 font-semibold text-slate-900">{cell(p.fullName || item.contract?.fullName)}</td>
                <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2">{cell(p.email)}</td>
                <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2">{cell(p.mobileNumber)}</td>
                <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 capitalize">{cell(p.gender)}</td>
                <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2">{p.birthDate ? formatDate(p.birthDate) : '—'}</td>
                <td className="min-w-[140px] border-b border-slate-100 px-3 py-2">{cell(address)}</td>
                <td className="min-w-[180px] border-b border-slate-100 px-3 py-2">{cell((a.positionsInterested || []).join(', '))}</td>
                <td className="min-w-[120px] border-b border-slate-100 px-3 py-2">{cell(a.education?.graduationStatus)}</td>
                <td className="min-w-[160px] border-b border-slate-100 px-3 py-2">{cell(a.education?.facultyUniversity)}</td>
                <td className="border-b border-slate-100 px-3 py-2">{cell(a.education?.degree)}</td>
                <td className="min-w-[140px] border-b border-slate-100 px-3 py-2">{cell(a.education?.additionalCertificates)}</td>
                <td className="min-w-[160px] border-b border-slate-100 px-3 py-2">{cell(a.experience?.teachingExperienceLevel)}</td>
                <td className="min-w-[140px] border-b border-slate-100 px-3 py-2">{cell(a.experience?.currentJob)}</td>
                <td className="min-w-[220px] whitespace-pre-wrap border-b border-slate-100 px-3 py-2">{cell(a.experience?.profileSummary)}</td>
                <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2">
                  <select
                    value={item?.recruitment?.status || item.status || 'new'}
                    disabled={quickStageId === item.id}
                    onChange={(event) => onQuickStage(item, event.target.value)}
                    className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] outline-none focus:border-primary disabled:opacity-50"
                  >
                    {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </td>
                <td className="min-w-[150px] border-b border-slate-100 px-3 py-2"><ContactActions item={item} compact /></td>
                <td className="min-w-[180px] border-b border-slate-100 px-3 py-2">{fileButtons(item)}</td>
                <td className="border-b border-slate-100 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onArchive(item)}
                    disabled={quickStageId === item.id}
                    title={(item?.recruitment?.status || item.status) === 'archived' ? 'Restore from archive' : 'Archive (hide from list)'}
                    className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
          {!rows.length ? (
            <tr><td colSpan={columns.length + 1} className="px-3 py-6 text-center text-slate-500">No teacher responses found for the current filters.</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

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
  const [viewer, setViewer] = useState(null);
  const [viewMode, setViewMode] = useState('cards');
  const [syncConfig, setSyncConfig] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [showSyncSettings, setShowSyncSettings] = useState(false);
  const [syncDraft, setSyncDraft] = useState({ sheetUrl: '', formUrl: '', autoSync: true, intervalMinutes: 10 });
  const [savingSync, setSavingSync] = useState(false);
  const [quickStageId, setQuickStageId] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkStage, setBulkStage] = useState('');
  const [bulkMoving, setBulkMoving] = useState(false);
  const [viewerMin, setViewerMin] = useState(false);

  const openViewer = (label, url, mimeType) => {
    if (!url) return;
    setViewerMin(false);
    setViewer({ label, ...resolveMedia(url, mimeType) });
  };

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

  // Load the Google Sheet sync configuration (source of truth for applicants).
  const loadSyncConfig = async () => {
    try {
      const config = await getSheetSyncConfig();
      if (config) {
        setSyncConfig(config);
        setSyncDraft({
          sheetUrl: config.sheetUrl || '',
          formUrl: config.formUrl || '',
          autoSync: config.autoSync !== false,
          intervalMinutes: config.intervalMinutes || 10,
        });
      }
    } catch { /* non-fatal */ }
  };

  useEffect(() => { loadSyncConfig(); }, []);

  const handleSyncNow = async () => {
    try {
      setSyncing(true);
      setError('');
      setNotice('');
      const result = await runSheetSyncNow();
      if (result?.config) setSyncConfig(result.config);
      setNotice(result?.message || 'Sync complete.');
      bumpDomainVersion('teacher-contract');
      const data = await listTeacherContractResponses();
      const nextItems = data || [];
      setItems(nextItems);
      writeCache(makeCacheKey('meetings:teacherResponses', 'admin'), { items: nextItems }, { ttlMs: 5 * 60_000, deps: ['teacher-contract'] });
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to sync from the Google Sheet.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveSyncConfig = async () => {
    try {
      setSavingSync(true);
      setError('');
      const config = await saveSheetSyncConfig({
        sheetUrl: syncDraft.sheetUrl,
        formUrl: syncDraft.formUrl,
        autoSync: Boolean(syncDraft.autoSync),
        intervalMinutes: Number(syncDraft.intervalMinutes) || 10,
      });
      if (config) setSyncConfig(config);
      setNotice('Sync source saved. New submissions will be pulled from this sheet automatically.');
      setShowSyncSettings(false);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save sync settings.');
    } finally {
      setSavingSync(false);
    }
  };

  // Move one candidate to a new funnel stage instantly (no full review needed).
  const handleQuickStage = async (item, status) => {
    try {
      setQuickStageId(item.id);
      setError('');
      const updated = await updateTeacherContractResponse(item.source, item.id, { pipelineStatus: status });
      if (updated) {
        setItems((prev) => prev.map((entry) => (entry.id === item.id ? updated : entry)));
        setDrafts((prev) => (prev[item.id] ? { ...prev, [item.id]: createDraftFromItem(updated) } : prev));
        bumpDomainVersion('teacher-contract');
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to move candidate.');
    } finally {
      setQuickStageId('');
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Soft-delete: archiving hides the applicant from the default list but keeps every record.
  const handleArchive = async (item) => {
    const isArchived = (item?.recruitment?.status || item.status) === 'archived';
    const name = item.personalInfo?.fullName || item.personalInfo?.email || 'this applicant';
    if (!isArchived && !window.confirm(`Archive ${name}? They will disappear from the list but stay saved under the \u201cArchived\u201d stage.`)) return;
    await handleQuickStage(item, isArchived ? 'new' : 'archived');
  };

  const toggleSelectAll = (rows) => {
    const ids = rows.map((row) => row.id);
    setSelectedIds((prev) => (ids.every((id) => prev.includes(id)) ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids]))));
  };

  const applyBulkStage = async () => {
    if (!bulkStage || !selectedIds.length) return;
    try {
      setBulkMoving(true);
      setError('');
      let moved = 0;
      for (const id of selectedIds) {
        const item = items.find((entry) => entry.id === id);
        if (!item) continue;
        // Sequential to keep server load light and preserve history entries.
        // eslint-disable-next-line no-await-in-loop
        const updated = await updateTeacherContractResponse(item.source, item.id, { pipelineStatus: bulkStage });
        if (updated) {
          moved += 1;
          setItems((prev) => prev.map((entry) => (entry.id === item.id ? updated : entry)));
        }
      }
      bumpDomainVersion('teacher-contract');
      setNotice(`Moved ${moved} candidate${moved === 1 ? '' : 's'} to ${getStatusLabel(bulkStage)}.`);
      setSelectedIds([]);
      setBulkStage('');
    } catch (err) {
      setError(err?.response?.data?.message || 'Bulk move failed part-way. Refresh to see the current state.');
    } finally {
      setBulkMoving(false);
    }
  };

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

  // Live funnel counts per pipeline stage.
  const funnelCounts = useMemo(() => {
    const counts = {};
    STATUS_OPTIONS.forEach((option) => { counts[option.value] = 0; });
    items.forEach((item) => {
      const status = item?.recruitment?.status || item.status || 'new';
      if (counts[status] != null) counts[status] += 1;
      else counts.new += 1;
    });
    return counts;
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    return items.filter((item) => {
      const itemStatus = item?.recruitment?.status || item.status || 'new';
      if (statusFilter === 'all') {
        // Archived applicants are hidden by default; open the Archived stage to see them.
        if (itemStatus === 'archived') return false;
      } else if (itemStatus !== statusFilter) {
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

  const exportToExcel = () => {
    const rows = filteredItems;
    if (!rows.length) return;
    const headers = [
      'Name', 'Email', 'Phone', 'WhatsApp', 'Gender', 'Birth date', 'Address',
      'Positions', 'Graduation', 'Faculty/University', 'Degree', 'Certificates',
      'Teaching experience', 'Current job',
      'Profile summary', 'Stage', 'Reviewed', 'Tags', 'Overall', 'Submitted at',
      'Resume',
    ];
    const esc = (value) => {
      const s = value == null ? '' : String(value);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const line = (item) => {
      const p = item.personalInfo || {};
      const a = item.application || {};
      const r = item.recruitment || {};
      const address = [p.address?.street, p.address?.city, p.address?.country].filter(Boolean).join(', ');
      return [
        p.fullName || item.contract?.fullName, p.email, p.mobileNumber, p.whatsappNumber, p.gender,
        p.birthDate ? new Date(p.birthDate).toISOString().slice(0, 10) : '', address,
        (a.positionsInterested || []).join('; '),
        a.education?.graduationStatus, a.education?.facultyUniversity, a.education?.degree, a.education?.additionalCertificates,
        a.experience?.teachingExperienceLevel, a.experience?.currentJob,
        a.experience?.profileSummary,
        getStatusLabel(r.status || item.status), r.reviewed ? 'Yes' : 'No', (r.tags || []).join('; '), r.overall?.label,
        item.submittedAt ? new Date(item.submittedAt).toISOString() : '',
        a.files?.resume?.url,
      ].map(esc).join(',');
    };
    const csv = `\uFEFF${[headers.join(','), ...rows.map(line)].join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `waraqa-applicants-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(href);
  };

  return (
    <div className="space-y-6">
      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading teacher responses…</div> : null}

      {!loading ? (
        <>
          {/* Google Form sync source — full dashboard control over the sheet/account */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${syncConfig?.lastError ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">Google Form applications — auto-sync</p>
                  <p className="truncate text-xs text-slate-500">
                    {syncConfig?.lastSyncAt ? `Last synced ${formatDateTime(syncConfig.lastSyncAt)}` : 'Not synced yet'}
                    {syncConfig?.autoSync !== false ? ` • refreshes automatically every ${syncConfig?.intervalMinutes || 10} min` : ' • auto-sync is OFF'}
                    {syncConfig?.lastResult ? ` • ${syncConfig.lastResult.totalRows ?? 0} rows in sheet` : ''}
                  </p>
                  {syncConfig?.lastError ? <p className="text-xs font-medium text-rose-600">Last sync error: {syncConfig.lastError}</p> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={handleSyncNow} disabled={syncing} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
                  <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Syncing…' : 'Sync now'}
                </button>
                {syncConfig?.sheetUrl ? (
                  <a href={syncConfig.sheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Open sheet
                  </a>
                ) : null}
                {syncConfig?.formUrl ? (
                  <a href={syncConfig.formUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    <ExternalLink className="h-3.5 w-3.5" /> Open form
                  </a>
                ) : null}
                <button type="button" onClick={() => setShowSyncSettings((open) => !open)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <Settings2 className="h-3.5 w-3.5" /> Source settings
                </button>
              </div>
            </div>
            {showSyncSettings ? (
              <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 md:grid-cols-2">
                <label className="text-xs text-slate-700 md:col-span-2">
                  <span className="mb-1 block font-semibold">Google Sheet URL (responses source — change this to switch account/sheet)</span>
                  <input value={syncDraft.sheetUrl} onChange={(event) => setSyncDraft((prev) => ({ ...prev, sheetUrl: event.target.value }))} placeholder="https://docs.google.com/spreadsheets/d/..." className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                </label>
                <label className="text-xs text-slate-700 md:col-span-2">
                  <span className="mb-1 block font-semibold">Google Form URL (what applicants open)</span>
                  <input value={syncDraft.formUrl} onChange={(event) => setSyncDraft((prev) => ({ ...prev, formUrl: event.target.value }))} placeholder="https://docs.google.com/forms/d/e/.../viewform" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input type="checkbox" checked={syncDraft.autoSync} onChange={(event) => setSyncDraft((prev) => ({ ...prev, autoSync: event.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                  Auto-sync when the dashboard opens
                </label>
                <label className="text-xs text-slate-700">
                  <span className="mb-1 block font-semibold">Auto-sync interval (minutes)</span>
                  <input type="number" min="2" max="1440" value={syncDraft.intervalMinutes} onChange={(event) => setSyncDraft((prev) => ({ ...prev, intervalMinutes: event.target.value }))} className="w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                </label>
                <div className="md:col-span-2">
                  <button type="button" onClick={handleSaveSyncConfig} disabled={savingSync} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                    <Save className="h-3.5 w-3.5" /> {savingSync ? 'Saving…' : 'Save source'}
                  </button>
                  <p className="mt-2 text-[11px] text-slate-500">The sheet must be shared as “Anyone with the link (Viewer)”. New form submissions land in the sheet and appear here automatically.</p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Recruitment funnel — click a stage to filter */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">Recruitment funnel</p>
              <p className="text-xs text-slate-500">{summary.unreviewed} awaiting first review • {summary.total} total applicants</p>
            </div>
            <div className="mt-3 flex flex-wrap items-stretch gap-1.5">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`flex min-w-[86px] flex-col items-center rounded-xl border px-3 py-2 text-center transition ${statusFilter === 'all' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
              >
                <span className="text-lg font-bold leading-tight">{summary.total - (funnelCounts.archived || 0)}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">All</span>
              </button>
              {STATUS_OPTIONS.map((option, index) => (
                <React.Fragment key={option.value}>
                  {index > 0 && index < STATUS_OPTIONS.length - 2 ? <span className="self-center text-slate-300">›</span> : null}
                  <button
                    type="button"
                    onClick={() => setStatusFilter((current) => (current === option.value ? 'all' : option.value))}
                    className={`flex min-w-[86px] flex-col items-center rounded-xl border px-3 py-2 text-center transition ${statusFilter === option.value ? 'ring-2 ring-primary ring-offset-1' : 'hover:opacity-80'} ${STATUS_TONES[option.value] || 'bg-slate-50 text-slate-700 border-slate-200'}`}
                  >
                    <span className="text-lg font-bold leading-tight">{funnelCounts[option.value] || 0}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{option.label}</span>
                  </button>
                </React.Fragment>
              ))}
            </div>
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
              <button type="button" onClick={() => setViewMode((mode) => (mode === 'table' ? 'cards' : 'table'))} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                {viewMode === 'table' ? <><LayoutGrid className="h-4 w-4" /><span>Card view</span></> : <><Table2 className="h-4 w-4" /><span>Table view</span></>}
              </button>
              <button type="button" onClick={exportToExcel} disabled={!filteredItems.length} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                <FileSpreadsheet className="h-4 w-4" />
                <span>Export Excel</span>
              </button>
            </div>
          </div>

          {viewMode === 'table' ? (
            <>
              {selectedIds.length ? (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 p-3 text-sm">
                  <span className="font-semibold text-slate-800">{selectedIds.length} selected</span>
                  <select value={bulkStage} onChange={(event) => setBulkStage(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-primary">
                    <option value="">Move to stage…</option>
                    {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <button type="button" onClick={applyBulkStage} disabled={!bulkStage || bulkMoving} className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
                    {bulkMoving ? 'Moving…' : 'Apply'}
                  </button>
                  <button type="button" onClick={() => setSelectedIds([])} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">Clear</button>
                </div>
              ) : null}
              <ApplicantTable
                rows={filteredItems}
                openViewer={openViewer}
                onQuickStage={handleQuickStage}
                quickStageId={quickStageId}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onArchive={handleArchive}
              />
            </>
          ) : (
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
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Birth date</p><p>{item.personalInfo?.birthDate ? formatDate(item.personalInfo.birthDate) : '—'}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Address</p><p className="break-words">{[item.personalInfo?.address?.street, item.personalInfo?.address?.city, item.personalInfo?.address?.country].filter(Boolean).join(', ') || '—'}</p></div>
                    </div>
                  </div>
                  {isOpen ? <ChevronUp className="mt-1 h-4 w-4 text-slate-400" /> : <ChevronDown className="mt-1 h-4 w-4 text-slate-400" />}
                </button>
                {/* Always-visible actions: contact, resume/recordings, archive — no need to expand */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <ContactActions item={item} />
                    <FileActionGrid item={item} openViewer={openViewer} />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleArchive(item)}
                    disabled={quickStageId === item.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                  >
                    <Archive className="h-3.5 w-3.5" /> {statusValue === 'archived' ? 'Restore' : 'Archive'}
                  </button>
                </div>
                {isOpen ? (
                  <div className="mt-4 space-y-5 border-t border-slate-100 pt-4">
                    <CandidateFacts item={item} />

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
          )}
        </>
      ) : null}

      {viewer ? (
        <div
          className={viewerMin
            ? 'fixed bottom-4 left-4 z-50 w-[340px] max-w-[calc(100vw-2rem)]'
            : 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4'}
          onClick={viewerMin ? undefined : () => setViewer(null)}
        >
          <div
            className={viewerMin
              ? 'w-full rounded-2xl border border-slate-200 bg-white p-2.5 shadow-2xl'
              : 'relative w-full max-w-3xl rounded-2xl bg-white p-4 shadow-xl'}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={`flex items-center justify-between gap-3 ${viewerMin ? 'mb-1.5' : 'mb-3'}`}>
              <p className="truncate text-sm font-semibold text-slate-900">{viewer.label}</p>
              <div className="flex shrink-0 items-center gap-2">
                {!viewerMin ? (
                  <a href={viewer.download} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Open <ExternalLink className="h-3.5 w-3.5" /></a>
                ) : null}
                <button type="button" onClick={() => setViewerMin((min) => !min)} title={viewerMin ? 'Expand player' : 'Minimize — keep playing while you work'} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50">
                  {viewerMin ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
                </button>
                <button type="button" onClick={() => setViewer(null)} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className={viewerMin ? 'overflow-hidden rounded-xl bg-slate-50' : 'flex max-h-[70vh] items-center justify-center overflow-auto rounded-xl bg-slate-50 p-2'}>
              {viewer.kind === 'image' ? (
                <img src={viewer.src} alt={viewer.label} className={viewerMin ? 'h-28 w-full object-cover' : 'max-h-[68vh] w-auto object-contain'} />
              ) : viewer.kind === 'audio' ? (
                <audio src={viewer.src} controls autoPlay className="w-full" />
              ) : viewer.kind === 'video' ? (
                <video src={viewer.src} controls autoPlay className={viewerMin ? 'h-44 w-full bg-black' : 'max-h-[68vh] w-full'} />
              ) : (
                <iframe title={viewer.label} src={viewer.src} className={viewerMin ? 'h-44 w-full' : 'h-[68vh] w-full rounded-lg'} allow="autoplay" />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
