import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ChevronDown, ChevronUp, ExternalLink, FileBadge2, FileSpreadsheet, HelpCircle, LayoutGrid, Mail, Maximize2, MessageCircle, Minimize2, Phone, Play, RefreshCw, Save, Send, Settings2, Star, Table2, UserPlus, X } from 'lucide-react';
import { convertCandidateToTeacher, getRecruitmentEmailTemplates, getSheetSyncConfig, listRecruitmentCampaigns, listTeacherContractResponses, runSheetSyncNow, saveSheetSyncConfig, sendCandidateEmail, updateTeacherContractResponse } from '../../../api/teacherContract';
import { bumpDomainVersion, makeCacheKey, readCache, writeCache } from '../../../utils/sessionCache';
import { standardizeSubject } from '../../../utils/subjectStandardization';
import { useSearch } from '../../../contexts/SearchContext';

const formatDate = (value) => {
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
  } catch {
    return '—';
  }
};

// Grows a textarea to fit its content (starting at one row) so fields like
// admin notes only take up the vertical space they actually need.
const autoResizeTextarea = (event) => {
  const element = event.currentTarget;
  element.style.height = 'auto';
  element.style.height = `${Math.min(Math.max(element.scrollHeight, 44), 320)}px`;
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

// Ordered ratings the star control cycles through (not_available = 0 stars).
const STAR_RATING_VALUES = ['weak', 'good', 'very_good', 'excellent'];
export { RATING_OPTIONS, STAR_RATING_VALUES };

const REJECTION_CATEGORY_OPTIONS = [
  { value: '', label: 'Select a category…' },
  { value: 'not_selected', label: 'Not selected' },
  { value: 'needs_improvement', label: 'Needs improvement' },
  { value: 'failed_interview', label: 'Failed interview' },
  { value: 'unresponsive', label: 'Unresponsive / no-show' },
  { value: 'availability_mismatch', label: 'Availability / hours mismatch' },
  { value: 'salary_mismatch', label: 'Salary expectations mismatch' },
  { value: 'future_pool', label: 'Future pool' },
  { value: 'other', label: 'Other' },
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

// Rating fields tied to a specific subject — only shown for a candidate when
// they've indicated (via subjectsCanTeach/positionsInterested) that they can
// teach the matching subject. See resolveSubjectRatingKeys(). Only Quran gets
// its own star box; every other subject shares the single "Topic" rating
// below since candidates upload one lesson-topic file regardless of how many
// non-Quran subjects they teach.
const SUBJECT_RATING_FIELDS = [
  ['quran', 'Quran'],
];

// Rating fields shown for every candidate regardless of subjects taught.
const GENERAL_RATING_FIELDS = [
  ['english', 'English'],
  ['teachingDemo', 'Topic'],
  ['professionalism', 'Professionalism'],
];


const RATING_FIELDS = [...SUBJECT_RATING_FIELDS, ...GENERAL_RATING_FIELDS];

// Full per-subject list (unlike SUBJECT_RATING_FIELDS above) — used by the
// Interviews tab, which shows one mark per subject the candidate teaches
// rather than collapsing non-Quran subjects into a single "Topic" field.
export const ALL_SUBJECT_RATING_FIELDS = [
  ['quran', 'Quran'],
  ['arabic', 'Arabic'],
  ['islamicStudies', 'Islamic Studies'],
  ['readingBasics', 'Reading Basics'],
];

// Maps the app-wide standardized subject taxonomy to the evaluation rating
// keys above, so we know which subject-specific fields to show per candidate.
export const SUBJECT_TO_RATING_KEY = {
  'Quran (Memorization)': 'quran',
  'Quran (Recitation/Tajweed)': 'quran',
  'Arabic Language': 'arabic',
  'Islamic Studies': 'islamicStudies',
  'Reading Basics': 'readingBasics',
};

/** Which subject-specific rating fields should be shown for this candidate. */
export function resolveSubjectRatingKeys(item, fallbackFields = SUBJECT_RATING_FIELDS) {
  const rawSubjects = [
    ...(item?.application?.teachingProfile?.subjectsCanTeach || []),
    ...(item?.application?.positionsInterested || []),
  ];
  const keys = new Set();
  rawSubjects.forEach((subject) => {
    const standardized = standardizeSubject(subject);
    const key = standardized && SUBJECT_TO_RATING_KEY[standardized];
    if (key) keys.add(key);
  });
  // Fall back to showing every subject field when we can't confidently match
  // any (e.g. legacy/unparsed data) so nothing is hidden by mistake.
  if (!keys.size) fallbackFields.forEach(([key]) => keys.add(key));
  return keys;
}

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

// Degree/subject-count/credential ranking used ONLY to order the "Under
// review" stage, so admins see the strongest applicants first. The `degree`
// field is free-form text synced from the Google Form (no fixed enum), so we
// rank it via keyword matching rather than an exact value match.
const DEGREE_RANK_PATTERNS = [
  { rank: 5, patterns: [/ph\.?\s?d/i, /doctor/i] },
  { rank: 4, patterns: [/master/i, /\bm\.?a\.?\b/i, /\bm\.?sc\.?\b/i, /magist(er|ir)/i] },
  { rank: 3, patterns: [/bachelor/i, /\bb\.?a\.?\b/i, /\bb\.?sc\.?\b/i, /licen[cs]e/i, /undergraduate/i] },
  { rank: 2, patterns: [/diploma/i, /associate/i] },
  { rank: 1, patterns: [/high\s?school/i, /secondary/i] },
];

const rankDegree = (degreeText) => {
  const text = String(degreeText || '').trim();
  if (!text) return 0;
  const match = DEGREE_RANK_PATTERNS.find(({ patterns }) => patterns.some((re) => re.test(text)));
  return match ? match.rank : 1; // unrecognized-but-present text still outranks having no degree at all
};

// Al-Azhar/Ijazah credentials outrank other backgrounds; holding both outranks either alone.
const ELIGIBILITY_RANK = { both: 3, al_azhar: 2, ijazah: 2, other: 1 };
const rankEligibility = (path) => ELIGIBILITY_RANK[path] || 0;

// Orders candidates in the "Under review" stage strongest-first:
// 1) highest academic degree, 2) most subjects they can teach,
// 3) Al-Azhar/Ijazah credential holders, 4) most recent submission (tie-breaker).
const sortUnderReviewCandidates = (rows) => [...rows].sort((a, b) => {
  const aEdu = a?.application?.education || {};
  const bEdu = b?.application?.education || {};
  const degreeDiff = rankDegree(bEdu.degree) - rankDegree(aEdu.degree);
  if (degreeDiff !== 0) return degreeDiff;
  const subjectsDiff = (b?.application?.teachingProfile?.subjectsCanTeach?.length || 0)
    - (a?.application?.teachingProfile?.subjectsCanTeach?.length || 0);
  if (subjectsDiff !== 0) return subjectsDiff;
  const eligibilityDiff = rankEligibility(bEdu.eligibilityPath) - rankEligibility(aEdu.eligibilityPath);
  if (eligibilityDiff !== 0) return eligibilityDiff;
  return new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0);
});

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

// Session-scoped key for remembering the admin's active stage/campaign filters
// across navigation within the same browser tab session.
const FILTER_STORAGE_KEY = 'waraqa.teacherResponses.filters';

const loadStoredFilters = () => {
  try {
    const raw = sessionStorage.getItem(FILTER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

// Shared by the candidate list AND the stage-pill counters so the numbers
// shown always match what a click on that stage will actually display.
const matchesSearchQuery = (item, query) => {
  if (!query) return true;
  const haystack = [
    item.personalInfo?.fullName,
    item.contract?.fullName,
    item.personalInfo?.email,
    item.personalInfo?.mobileNumber,
    item.personalInfo?.whatsappNumber,
    item.user?.email,
    item.user?.firstName,
    item.user?.lastName,
    ...(item?.application?.positionsInterested || []),
    ...(item?.application?.teachingProfile?.subjectsCanTeach || []),
    ...(Array.isArray(item?.recruitment?.tags) ? item.recruitment.tags : []),
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
};


/** Clickable 4-star control for an evaluation rating (not_available = 0 stars). */
export function StarRating({ value, onChange, disabled, compact = false }) {
  const activeIndex = STAR_RATING_VALUES.indexOf(value);
  return (
    <div className={`flex items-center ${compact ? 'gap-1' : 'gap-2'}`}>
      <div className="flex items-center gap-0.5">
        {STAR_RATING_VALUES.map((option, index) => {
          const filled = index <= activeIndex;
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => onChange(activeIndex === index ? 'not_available' : option)}
              title={RATING_OPTIONS.find((o) => o.value === option)?.label}
              className="rounded p-0.5 disabled:cursor-not-allowed"
            >
              <Star className={`${compact ? 'h-3.5 w-3.5' : 'h-5 w-5'} ${filled ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
            </button>
          );
        })}
      </div>
      {!compact ? (
        value && value !== 'not_available'
          ? <span className="text-xs text-slate-500">{RATING_OPTIONS.find((o) => o.value === value)?.label}</span>
          : <span title="Not available / not yet rated"><HelpCircle className="h-4 w-4 text-slate-300" /></span>
      ) : null}
    </div>
  );
}

/** Small pill showing an item's autosave state ("Saving…", "Saved", error retry). */
function AutosaveStatus({ status, onRetry }) {
  if (status === 'saving') {
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500"><RefreshCw className="h-3 w-3 animate-spin" /> Saving…</span>;
  }
  if (status === 'pending') {
    return <span className="text-xs font-medium text-slate-400">Unsaved changes…</span>;
  }
  if (status === 'error') {
    return <button type="button" onClick={onRetry} className="text-xs font-semibold text-rose-600 underline">Save failed — click to retry</button>;
  }
  if (status === 'saved') {
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><Save className="h-3 w-3" /> Saved</span>;
  }
  return null;
}

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
  evaluation: RATING_FIELDS.reduce((acc, [key]) => {
    acc[key] = item?.recruitment?.evaluation?.[key] || 'not_available';
    return acc;
  }, {}),
});

const getStatusLabel = (value) => STATUS_OPTIONS.find((option) => option.value === value)?.label || 'New';

// Mirrors the backend's {{var}} substitution so client-side previews match
// exactly what will be sent once the admin hits "Send email".
const renderTemplateVars = (text, vars = {}) => String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (
  vars[key] == null ? '' : String(vars[key])
));

// Base, human-readable explanation per rejection category — kept warm and
// professional regardless of the underlying reason.
const REJECTION_REASON_TEXT = {
  '': 'After careful review, we have decided not to move forward with your application at this time.',
  not_selected: 'After careful review, we have decided not to move forward with your application at this time.',
  needs_improvement: 'After reviewing your application and submitted materials, we found some areas that need further development before we can move forward.',
  failed_interview: 'After your interview, we found that this is not the right fit for our current openings.',
  unresponsive: 'We were unable to reach you or receive the requested information in time to continue your application.',
  availability_mismatch: 'Your available teaching hours do not currently align with our open schedules.',
  salary_mismatch: 'We were unable to reach an agreement on compensation that works for both sides at this time.',
  future_pool: 'While we are not moving forward right now, we would like to keep your profile on file and reach out as soon as a suitable opening becomes available.',
  other: 'After careful review, we have decided not to move forward with your application at this time.',
};

// Categories where it makes sense to also name specific weak-rated skill
// areas as supporting detail (skipped for logistics-only reasons like
// availability/salary/unresponsive, where naming "weak skills" wouldn't apply).
const REJECTION_CATEGORIES_WITH_SKILL_DETAIL = new Set(['not_selected', 'needs_improvement', 'failed_interview', 'other', '']);

// Scorecard fields that are assessed FROM a submitted file. Left "not
// available" here usually means the file was missing, unreadable, or in the
// wrong language — not that the candidate is weak — so it gets its own
// general (non-accusatory) clause inviting them to resubmit, rather than
// being treated as a skill weakness.
const FILE_BASED_RATING_FIELDS = new Set(['english', 'quran', 'teachingDemo']);

/** Builds the human-readable "why" paragraph from the rejection category + scorecard. */
function composeRejectionReason(draft, subjectRatingKeys, resubmitLink) {
  const category = draft.rejectionCategory || '';
  let text = REJECTION_REASON_TEXT[category] || REJECTION_REASON_TEXT[''];

  if (REJECTION_CATEGORIES_WITH_SKILL_DETAIL.has(category)) {
    const visibleFields = [...SUBJECT_RATING_FIELDS.filter(([key]) => subjectRatingKeys.has(key)), ...GENERAL_RATING_FIELDS];
    const weakLabels = visibleFields.filter(([key]) => draft.evaluation?.[key] === 'weak').map(([, label]) => label);
    if (weakLabels.length) {
      const list = weakLabels.length === 1
        ? weakLabels[0]
        : `${weakLabels.slice(0, -1).join(', ')} and ${weakLabels[weakLabels.length - 1]}`;
      text += ` In particular, we noted room for growth in: ${list}.`;
    }
  }

  const hasMissingFiles = [...FILE_BASED_RATING_FIELDS].some((key) => (draft.evaluation?.[key] || 'not_available') === 'not_available');
  if (hasMissingFiles) {
    text += ` We also weren't able to fully review one or more of the materials you submitted — this can happen if a file didn't upload correctly, was sent in a different language than requested, or the link could not be opened. If you'd like to complete or resend your application materials, please use this link: ${resubmitLink}`;
  }

  return text;
}

/**
 * Composes a ready-to-send subject/body for the candidate's CURRENT pipeline
 * stage. Only "rejected" and "interview_pending" are automated here — later
 * stages (post-interview outcomes) already have their own dedicated email
 * flow in the Interviews tab.
 */
function buildRecruitmentMessage(item, draft, subjectRatingKeys, emailTemplates) {
  const name = item?.personalInfo?.fullName || item?.contract?.fullName || `${item?.user?.firstName || ''} ${item?.user?.lastName || ''}`.trim() || 'there';

  if (draft.pipelineStatus === 'rejected') {
    const template = emailTemplates?.templates?.screening_rejected || emailTemplates?.defaults?.screening_rejected
      || { subject: 'Update on your Waraqa application', body: 'Dear {{name}},\n\n{{reason}}\n\nWaraqa Recruitment Team' };
    const resubmitLink = `${window.location.origin}/teacher-contract`;
    const reason = composeRejectionReason(draft, subjectRatingKeys, resubmitLink);
    return {
      event: 'screening_rejected',
      subject: renderTemplateVars(template.subject, { name }),
      body: renderTemplateVars(template.body, { name, reason }),
    };
  }

  if (draft.pipelineStatus === 'interview_pending') {
    const template = emailTemplates?.templates?.interview_invite || emailTemplates?.defaults?.interview_invite
      || { subject: 'Your Waraqa teacher interview', body: 'Dear {{name}},\n\nPlease book a slot here:\n{{link}}\n\nWaraqa Recruitment Team' };
    const link = `${window.location.origin}/public/meetings/evaluation?type=new_teacher_interview`;
    return {
      event: 'interview_invite',
      subject: renderTemplateVars(template.subject, { name, link }),
      body: renderTemplateVars(template.body, { name, link }),
    };
  }

  return null;
}

const getDriveId = (url) => {
  const s = String(url || '');
  let m = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return '';
};

// Decide how to render a file inline (image/audio/video player or embedded iframe).
// `hint` tells us what kind of file a form field is expected to hold (e.g. the
// three recording uploads are audio) when Drive URLs carry no mime type.
const resolveMedia = (url, mimeType = '', hint = '') => {
  const raw = String(url || '');
  const lower = raw.toLowerCase();
  const type = String(mimeType || '').toLowerCase();
  if (/drive\.google\.com|docs\.google\.com/.test(lower)) {
    const driveId = getDriveId(raw);
    const preview = driveId ? `https://drive.google.com/file/d/${driveId}/preview` : raw;
    // Audio/video recordings: stream the file directly so the native player
    // (with jump controls) works. If direct streaming fails — e.g. the file
    // isn't shared publicly — the viewer falls back to the Drive preview
    // iframe, which is the previous behaviour.
    const generic = !type || type === 'application/octet-stream';
    const isAudio = type.startsWith('audio/') || (generic && hint === 'audio');
    const isVideo = type.startsWith('video/') || (generic && hint === 'video');
    if (driveId && (isAudio || isVideo)) {
      return {
        kind: isVideo ? 'video' : 'audio',
        src: `https://drive.google.com/uc?export=download&id=${driveId}`,
        fallback: preview,
        download: raw,
      };
    }
    return { kind: 'iframe', src: preview, download: raw };
  }
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(lower)) return { kind: 'image', src: raw, download: raw };
  if (type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|oga)(\?|$)/i.test(lower)) return { kind: 'audio', src: raw, download: raw };
  if (type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(lower)) return { kind: 'video', src: raw, download: raw };
  return { kind: 'iframe', src: raw, download: raw };
};

// Native audio/video player with 5s/10s jump controls (works in the mini
// floating player and expanded view). `onFail` lets the viewer swap to the
// Drive preview iframe when direct streaming isn't possible.
function MediaPlayer({ kind, src, min, onFail }) {
  const mediaRef = useRef(null);
  const skip = (seconds) => {
    const el = mediaRef.current;
    if (!el) return;
    const next = Math.max(0, el.currentTime + seconds);
    el.currentTime = Number.isFinite(el.duration) ? Math.min(next, el.duration) : next;
  };
  return (
    <div className={`w-full ${min ? 'p-1.5' : ''}`}>
      {kind === 'video' ? (
        <video ref={mediaRef} src={src} controls autoPlay onError={onFail} className={min ? 'h-44 w-full rounded-lg bg-black' : 'max-h-[58vh] w-full rounded-lg bg-black'} />
      ) : (
        <audio ref={mediaRef} src={src} controls autoPlay onError={onFail} className="w-full" />
      )}
      <div className={`flex items-center justify-center gap-1.5 ${min ? 'mt-1.5' : 'mt-2'}`}>
        {[[-10, '−10s'], [-5, '−5s'], [5, '+5s'], [10, '+10s']].map(([seconds, label]) => (
          <button key={label} type="button" onClick={() => skip(seconds)} title={`Jump ${label}`} className="min-w-[44px] rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

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
      {wa ? <a href={wa} target="_blank" rel="noreferrer" className={`${base} bg-green-600 text-white hover:bg-green-700`}><MessageCircle className={icon} /> {compact ? 'WA' : 'WhatsApp'}</a> : null}
      {mailto ? <a href={mailto} className={`${base} bg-sky-600 text-white hover:bg-sky-700`}><Mail className={icon} /> {compact ? 'Mail' : 'Email'}</a> : null}
      {phone && !compact ? <a href={`tel:${phone}`} className={`${base} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}><Phone className={icon} /> Call</a> : null}
      {phone && compact ? <a href={`tel:${phone}`} className={`${base} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}><Phone className={icon} /> Call</a> : null}
    </div>
  );
}

const displayValue = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || '—';
  return value == null || value === '' ? '—' : value;
};

const responseKey = (item) => `${item?.source || 'public'}:${item?.id || ''}`;

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

function FileActionGrid({ item, openViewer, compact = false }) {
  const files = [
    ['Resume', item.application?.files?.resume, FileBadge2, 'doc'],
    ['Intro audio', item.application?.files?.englishIntroduction, Play, 'audio'],
    ['Quran recitation', item.application?.files?.quranRecitation, Play, 'audio'],
    ['Topic explanation', item.application?.files?.teachingTopicExplanation, Play, 'audio'],
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
    <div className="flex flex-wrap gap-1.5">
      {available.map(([label, file, Icon, hint]) => (
        <button key={label} type="button" onClick={() => openViewer(label, file.url, file.mimeType, hint)} className={`inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/5 text-primary hover:bg-primary/10 ${compact ? 'px-2 py-1 text-[11px] font-medium' : 'px-3 py-1.5 text-xs font-semibold'}`}>
          <Icon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} /> {compact ? (label === 'Resume' ? 'CV' : label === 'Intro audio' ? 'Intro' : label === 'Quran recitation' ? 'Quran' : 'Topic') : label}
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
function ApplicantTable({ rows, openViewer, onQuickStage, quickStageId, selectedIds, onToggleSelect, onToggleSelectAll, onArchive, searchTerm }) {
  const cell = (value) => (value == null || value === '' ? '—' : value);
  const fileButtons = (item) => {
    const files = [
      ['Resume', item.application?.files?.resume, 'doc'],
      ['Intro', item.application?.files?.englishIntroduction, 'audio'],
      ['Recitation', item.application?.files?.quranRecitation, 'audio'],
      ['Explanation', item.application?.files?.teachingTopicExplanation, 'audio'],
    ].filter(([, file]) => file?.url);
    if (!files.length) return <span className="text-slate-400">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {files.map(([label, file, hint]) => (
          <button key={label} type="button" onClick={() => openViewer(label, file.url, file.mimeType, hint)} className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10">
            <Play className="h-3 w-3" />{label}
          </button>
        ))}
      </div>
    );
  };
  const columns = ['Name', 'Email', 'Phone', 'Gender', 'Birth date', 'Address', 'Positions', 'Graduation', 'Faculty / University', 'Degree', 'Certificates', 'Teaching experience', 'Current job', 'What we should know', 'Stage', 'Contact', 'Files', ''];
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(responseKey(row)));
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
                  <input type="checkbox" checked={selectedIds.includes(responseKey(item))} onChange={() => onToggleSelect(item)} className="h-3.5 w-3.5 rounded border-slate-300" aria-label={`Select ${p.fullName || p.email || 'candidate'}`} />
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
            <tr><td colSpan={columns.length + 1} className="px-3 py-6 text-center text-slate-500">{searchTerm ? `No candidates match "${searchTerm}" for the current filters.` : 'No teacher responses found for the current filters.'}</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default function TeacherResponsesPanel({ headerSlot = null }) {
  const { searchTerm } = useSearch();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [statusFilter, setStatusFilter] = useState(() => loadStoredFilters().statusFilter || 'all');
  const [campaignFilter, setCampaignFilter] = useState(() => loadStoredFilters().campaignFilter || 'all');
  const [drafts, setDrafts] = useState({});
  // Mirrors `drafts` synchronously so the debounced autosave always reads the
  // very latest edits, even when a save fires from a stale render closure
  // (previously caused rapid star clicks to be sent/saved with old values,
  // which then overwrote the UI back to "not selected").
  const draftsRef = useRef({});
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  const [autosaveStatus, setAutosaveStatus] = useState({});
  const autosaveTimers = useRef({});
  const [notice, setNotice] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [convertingId, setConvertingId] = useState('');
  const [convertForm, setConvertForm] = useState({});
  const [viewer, setViewer] = useState(null);
  const [viewMode, setViewMode] = useState('cards');
  const [syncConfig, setSyncConfig] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [showSyncSettings, setShowSyncSettings] = useState(false);
  const [syncDraft, setSyncDraft] = useState({ sheetUrl: '', formUrl: '', autoSync: true, intervalMinutes: 720 });
  const [savingSync, setSavingSync] = useState(false);
  const [quickStageId, setQuickStageId] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkStage, setBulkStage] = useState('');
  const [bulkMoving, setBulkMoving] = useState(false);
  const [viewerMin, setViewerMin] = useState(false);
  const [archiveConfirmItem, setArchiveConfirmItem] = useState(null);
  const [emailTemplates, setEmailTemplates] = useState(null);
  const [messagePreview, setMessagePreview] = useState(null);
  const [sendingMessage, setSendingMessage] = useState(false);

  const openViewer = (label, url, mimeType, hint) => {
    if (!url) return;
    const media = resolveMedia(url, mimeType, hint);
    // Recordings open in the small floating player first — use the
    // maximize button to expand.
    setViewerMin(media.kind === 'audio' || media.kind === 'video');
    setViewer({ label, ...media });
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
          intervalMinutes: config.intervalMinutes || 720,
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
        intervalMinutes: Number(syncDraft.intervalMinutes) || 720,
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
        setItems((prev) => prev.map((entry) => (entry.id === item.id && entry.source === item.source ? updated : entry)));
        setDrafts((prev) => (prev[item.id] ? { ...prev, [item.id]: createDraftFromItem(updated) } : prev));
        bumpDomainVersion('teacher-contract');
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to move candidate.');
    } finally {
      setQuickStageId('');
    }
  };

  const toggleSelect = (item) => {
    const key = responseKey(item);
    setSelectedIds((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  // Soft-delete: archiving hides the applicant from the default list but keeps every record.
  const handleArchive = async (item) => {
    const isArchived = (item?.recruitment?.status || item.status) === 'archived';
    if (!isArchived) {
      setArchiveConfirmItem(item);
      return;
    }
    await handleQuickStage(item, 'new');
  };

  const confirmArchive = async () => {
    const item = archiveConfirmItem;
    setArchiveConfirmItem(null);
    if (!item) return;
    await handleQuickStage(item, 'archived');
  };

  const toggleSelectAll = (rows) => {
    const ids = rows.map((row) => responseKey(row));
    setSelectedIds((prev) => (ids.every((id) => prev.includes(id)) ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids]))));
  };

  const applyBulkStage = async () => {
    if (!bulkStage || !selectedIds.length) return;
    try {
      setBulkMoving(true);
      setError('');
      let moved = 0;
      for (const key of selectedIds) {
        const item = items.find((entry) => responseKey(entry) === key);
        if (!item) continue;
        // Sequential to keep server load light and preserve history entries.
        // eslint-disable-next-line no-await-in-loop
        const updated = await updateTeacherContractResponse(item.source, item.id, { pipelineStatus: bulkStage });
        if (updated) {
          moved += 1;
          setItems((prev) => prev.map((entry) => (entry.id === item.id && entry.source === item.source ? updated : entry)));
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

  // Loaded once so the "prepare message" preview renders the admin's actual
  // customized templates (subject/body + {{name}}/{{reason}}/{{link}} vars).
  useEffect(() => {
    let mounted = true;
    getRecruitmentEmailTemplates().then((data) => {
      if (mounted) setEmailTemplates(data || null);
    }).catch(() => {
      if (mounted) setEmailTemplates(null);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => () => {
    Object.values(autosaveTimers.current).forEach(clearTimeout);
  }, []);

  // Remember the active stage/campaign filters for the rest of this browser session.
  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ statusFilter, campaignFilter }));
    } catch { /* ignore */ }
  }, [statusFilter, campaignFilter]);

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
        entry.id === item.id && entry.source === item.source
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

  const performAutosave = async (item) => {
    const draft = draftsRef.current[item.id];
    if (!draft) return;
    if (autosaveTimers.current[item.id]) {
      clearTimeout(autosaveTimers.current[item.id]);
      delete autosaveTimers.current[item.id];
    }
    try {
      setAutosaveStatus((prev) => ({ ...prev, [item.id]: 'saving' }));
      setError('');
      const payload = {
        pipelineStatus: draft.pipelineStatus,
        reviewed: draft.reviewed,
        adminNotes: draft.adminNotes,
        rejectionCategory: draft.rejectionCategory,
        tags: draft.tags,
        evaluation: draft.evaluation,
      };
      const updated = await updateTeacherContractResponse(item.source, item.id, payload);
      if (!updated) return;

      setItems((prev) => prev.map((entry) => (entry.id === item.id && entry.source === item.source ? updated : entry)));
      setDrafts((prev) => ({ ...prev, [item.id]: createDraftFromItem(updated) }));
      setAutosaveStatus((prev) => ({ ...prev, [item.id]: 'saved' }));
      writeCache(makeCacheKey('meetings:teacherResponses', 'admin'), { items: items.map((entry) => (entry.id === item.id && entry.source === item.source ? updated : entry)) }, { ttlMs: 5 * 60_000, deps: ['teacher-contract'] });
    } catch (err) {
      setAutosaveStatus((prev) => ({ ...prev, [item.id]: 'error' }));
      setError(err?.response?.data?.message || 'Failed to save recruitment review');
    }
  };

  // Schedules an autosave for an item's current draft. Use a short delay for
  // immediate controls (selects, star ratings) and a longer one for free-text
  // fields so we don't fire a save on every keystroke.
  const scheduleAutosave = (item, delay = 500) => {
    setAutosaveStatus((prev) => ({ ...prev, [item.id]: 'pending' }));
    if (autosaveTimers.current[item.id]) clearTimeout(autosaveTimers.current[item.id]);
    autosaveTimers.current[item.id] = setTimeout(() => {
      delete autosaveTimers.current[item.id];
      performAutosave(item);
    }, delay);
  };

  // Opens the reason/invite-message preview for the candidate's current
  // stage (rejected -> why; interview_pending -> booking invite).
  const openMessagePreview = (item) => {
    const draft = draftsRef.current[item.id] || createDraftFromItem(item);
    const subjectRatingKeys = resolveSubjectRatingKeys(item);
    const message = buildRecruitmentMessage(item, draft, subjectRatingKeys, emailTemplates);
    if (!message) return;
    setMessagePreview({ item, ...message });
  };

  const handleSendPreviewEmail = async () => {
    if (!messagePreview) return;
    const { item, event, subject, body } = messagePreview;
    const to = item?.personalInfo?.email || item?.user?.email || '';
    if (!to) {
      setError('This candidate has no email address on file.');
      return;
    }
    try {
      setSendingMessage(true);
      setError('');
      await sendCandidateEmail(item.source, item.id, { event, subject, body });
      setNotice(`Email queued to ${to}.`);
      setMessagePreview(null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to send email.');
    } finally {
      setSendingMessage(false);
    }
  };

  const openPreviewWhatsapp = () => {
    if (!messagePreview) return;
    const { item, body } = messagePreview;
    const wa = waLink(item?.personalInfo?.whatsappNumber || item?.personalInfo?.mobileNumber);
    if (!wa) {
      setError('This candidate has no WhatsApp/phone number on file.');
      return;
    }
    window.open(`${wa}?text=${encodeURIComponent(body)}`, '_blank', 'noreferrer');
  };

  // Live funnel counts per pipeline stage. These honor the current search
  // and campaign filter (but not the stage filter itself) so a badge's
  // number always matches what clicking that stage will actually show.
  const funnelCounts = useMemo(() => {
    const query = String(searchTerm || '').trim().toLowerCase();
    const counts = {};
    STATUS_OPTIONS.forEach((option) => { counts[option.value] = 0; });
    items.forEach((item) => {
      if (campaignFilter !== 'all' && String(item?.recruitment?.fit?.campaignId || '') !== String(campaignFilter)) return;
      if (!matchesSearchQuery(item, query)) return;
      const status = item?.recruitment?.status || item.status || 'new';
      if (counts[status] != null) counts[status] += 1;
      else counts.new += 1;
    });
    return counts;
  }, [items, campaignFilter, searchTerm]);

  // "All" = every non-archived stage under the current search/campaign filter.
  const allStagesCount = useMemo(() => (
    STATUS_OPTIONS.filter((option) => option.value !== 'archived')
      .reduce((sum, option) => sum + (funnelCounts[option.value] || 0), 0)
  ), [funnelCounts]);

  const filteredItems = useMemo(() => {
    const query = String(searchTerm || '').trim().toLowerCase();
    return items.filter((item) => {
      const itemStatus = item?.recruitment?.status || item.status || 'new';
      if (statusFilter !== 'all' && itemStatus !== statusFilter) {
        return false;
      }
      // Keep archived rows hidden by default in "All"; use Archived stage to view them.
      if (statusFilter === 'all' && itemStatus === 'archived') return false;
      if (campaignFilter !== 'all' && String(item?.recruitment?.fit?.campaignId || '') !== String(campaignFilter)) {
        return false;
      }
      if (!matchesSearchQuery(item, query)) return false;
      return true;
    });
  }, [campaignFilter, items, statusFilter, searchTerm]);

  // Strongest-applicant-first ordering, applied only to the "Under review"
  // stage (see sortUnderReviewCandidates above). Other stages/tabs keep the
  // default order.
  const sortedItems = useMemo(() => (
    statusFilter === 'under_review' ? sortUnderReviewCandidates(filteredItems) : filteredItems
  ), [filteredItems, statusFilter]);

  const exportToExcel = () => {
    const rows = sortedItems;
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
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="max-h-[25vh] space-y-2 overflow-auto">
              {headerSlot ? <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-2">{headerSlot}</div> : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-900">Recruitment control center</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {syncConfig?.lastSyncAt ? `Synced ${formatDateTime(syncConfig.lastSyncAt)}` : 'Not synced yet'}
                    {syncConfig?.autoSync !== false
                      ? ` • every ${(syncConfig?.intervalMinutes || 720) >= 60 ? `${Math.round((syncConfig?.intervalMinutes || 720) / 60)}h` : `${syncConfig?.intervalMinutes}m`}`
                      : ' • auto OFF'}
                    {syncConfig?.lastResult ? ` • ${syncConfig.lastResult.totalRows ?? 0} rows` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={handleSyncNow} disabled={syncing} className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50"><RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />{syncing ? 'Sync…' : 'Sync'}</button>
                  {syncConfig?.sheetUrl ? <a href={syncConfig.sheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"><FileSpreadsheet className="h-3 w-3" />Sheet</a> : null}
                  {syncConfig?.formUrl ? <a href={syncConfig.formUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"><ExternalLink className="h-3 w-3" />Form</a> : null}
                  <button type="button" onClick={() => setShowSyncSettings((open) => !open)} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"><Settings2 className="h-3 w-3" />Source</button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-stretch gap-1">
                  <button type="button" onClick={() => setStatusFilter('all')} className={`flex min-w-[64px] flex-col items-center rounded-lg border px-2 py-1 text-center transition ${statusFilter === 'all' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}>
                    <span className="text-sm font-bold leading-tight">{allStagesCount}</span>
                    <span className="text-[9px] font-semibold uppercase tracking-wide opacity-80">All</span>
                  </button>
                  {STATUS_OPTIONS.map((option) => (
                    <button key={option.value} type="button" onClick={() => setStatusFilter((current) => (current === option.value ? 'all' : option.value))} className={`flex min-w-[64px] flex-col items-center rounded-lg border px-2 py-1 text-center transition ${statusFilter === option.value ? 'ring-2 ring-primary ring-offset-1' : 'hover:opacity-80'} ${STATUS_TONES[option.value] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                      <span className="text-sm font-bold leading-tight">{funnelCounts[option.value] || 0}</span>
                      <span className="text-[9px] font-semibold uppercase tracking-wide opacity-80">{option.label}</span>
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <select value={campaignFilter} onChange={(event) => setCampaignFilter(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-primary">
                    <option value="all">All campaigns</option>
                    {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}
                  </select>
                  <button type="button" onClick={load} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"><RefreshCw className="h-3 w-3" />Refresh</button>
                  <button type="button" onClick={() => setViewMode((mode) => (mode === 'table' ? 'cards' : 'table'))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50">{viewMode === 'table' ? <><LayoutGrid className="h-3 w-3" />Cards</> : <><Table2 className="h-3 w-3" />Table</>}</button>
                  <button type="button" onClick={exportToExcel} disabled={!sortedItems.length} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"><FileSpreadsheet className="h-3 w-3" />Export</button>
                </div>
              </div>

              {syncConfig?.lastError ? <p className="text-[11px] font-medium text-rose-600">Sync error: {syncConfig.lastError}</p> : null}
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
                rows={sortedItems}
                openViewer={openViewer}
                onQuickStage={handleQuickStage}
                quickStageId={quickStageId}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onArchive={handleArchive}
                searchTerm={searchTerm}
              />
            </>
          ) : (
          <div className="space-y-3">
          {sortedItems.length ? sortedItems.map((item) => {
            const isOpen = expandedId === item.id;
            const source = item.source || 'public';
            const draft = drafts[item.id] || createDraftFromItem(item);
            const statusValue = item?.recruitment?.status || item.status || 'new';
            const overall = item?.recruitment?.overall || {};
            return (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sourceTone[source] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>{source}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONES[statusValue] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>{getStatusLabel(statusValue)}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${item?.recruitment?.reviewed ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{item?.recruitment?.reviewed ? 'Reviewed' : 'New review'}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{formatDateTime(item.submittedAt)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ContactActions item={item} compact />
                    <FileActionGrid item={item} openViewer={openViewer} compact />
                    <button
                      type="button"
                      onClick={() => handleArchive(item)}
                      disabled={quickStageId === item.id}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-500 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                    >
                      <Archive className="h-3 w-3" /> {statusValue === 'archived' ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                </div>
                <button type="button" onClick={() => { ensureDraft(item); setExpandedId(isOpen ? '' : item.id); }} className="flex w-full items-start justify-between gap-3 text-left">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
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
                {isOpen ? (() => {
                  const subjectRatingKeys = resolveSubjectRatingKeys(item);
                  return (
                  <div className="mt-4 space-y-5 border-t border-slate-100 pt-4">
                    <CandidateFacts item={item} />

                    <div className="grid gap-4">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-900">Recruitment review</p>
                          <div className="flex flex-wrap items-center gap-3">
                            <AutosaveStatus status={autosaveStatus[item.id]} onRetry={() => performAutosave(item)} />
                            <span className="text-xs text-slate-500">Overall: {item?.recruitment?.overall?.label || 'Not rated'}</span>
                            {draft.pipelineStatus === 'rejected' || draft.pipelineStatus === 'interview_pending' ? (
                              <button type="button" onClick={() => openMessagePreview(item)} className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90">
                                <Send className="h-3 w-3" />
                                {draft.pipelineStatus === 'rejected' ? 'Prepare rejection message' : 'Prepare interview invite'}
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {/* Row 1: stage / rejection category / tags */}
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <label className="text-sm text-slate-700">
                            <span className="mb-1 block font-medium">Stage</span>
                            <select value={draft.pipelineStatus} onChange={(event) => { updateDraft(item.id, (current) => ({ ...current, pipelineStatus: event.target.value })); scheduleAutosave(item, 300); }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10">
                              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </label>
                          <label className="text-sm text-slate-700">
                            <span className="mb-1 block font-medium">Rejection category</span>
                            <select value={draft.rejectionCategory} onChange={(event) => { updateDraft(item.id, (current) => ({ ...current, rejectionCategory: event.target.value })); scheduleAutosave(item, 300); }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10">
                              {REJECTION_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              {draft.rejectionCategory && !REJECTION_CATEGORY_OPTIONS.some((option) => option.value === draft.rejectionCategory)
                                ? <option value={draft.rejectionCategory}>{draft.rejectionCategory} (legacy)</option>
                                : null}
                            </select>
                          </label>
                          <label className="text-sm text-slate-700">
                            <span className="mb-1 block font-medium">Tags</span>
                            <input value={draft.tags} onChange={(event) => { updateDraft(item.id, (current) => ({ ...current, tags: event.target.value })); scheduleAutosave(item, 1200); }} placeholder="strong english, tajweed, future pool" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                          </label>
                        </div>

                        {/* Row 2: evaluation scorecard, packed as many fields per row as fit */}
                        <div className="mt-4">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Evaluation scorecard</p>
                          <div className="flex flex-wrap gap-2">
                            {[...SUBJECT_RATING_FIELDS.filter(([key]) => subjectRatingKeys.has(key)), ...GENERAL_RATING_FIELDS].map(([key, label]) => (
                              <div key={key} className="w-fit rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                                <div className="flex items-center justify-between gap-1">
                                  <p className="whitespace-nowrap text-[11px] font-medium text-slate-600" title={label}>{label}</p>
                                  {draft.evaluation[key] === 'not_available' ? <span title="Not available / not yet rated"><HelpCircle className="h-3 w-3 shrink-0 text-slate-300" /></span> : null}
                                </div>
                                <StarRating
                                  compact
                                  value={draft.evaluation[key]}
                                  onChange={(nextValue) => { updateDraft(item.id, (current) => ({ ...current, evaluation: { ...current.evaluation, [key]: nextValue } })); scheduleAutosave(item, 300); }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Row 3: admin notes + review summary */}
                        <div className="mt-4 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
                          <label className="text-sm text-slate-700">
                            <span className="mb-1 block font-medium">Admin notes</span>
                            <textarea
                              value={draft.adminNotes}
                              onChange={(event) => { updateDraft(item.id, (current) => ({ ...current, adminNotes: event.target.value })); scheduleAutosave(item, 1200); }}
                              onInput={autoResizeTextarea}
                              rows={1}
                              placeholder="Interview notes, missing data, strengths, concerns…"
                              className="w-full resize-none overflow-hidden rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                            />
                          </label>
                          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommendation: <span className="normal-case text-slate-900">{item?.recruitment?.overall?.recommendation || 'review'}</span></p>
                            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                              <p><span className="font-semibold text-slate-900">Reviewed by:</span> {item?.recruitment?.reviewedBy ? `${item.recruitment.reviewedBy.firstName || ''} ${item.recruitment.reviewedBy.lastName || ''}`.trim() || item.recruitment.reviewedBy.email : '—'}</p>
                              <p><span className="font-semibold text-slate-900">Last reviewed:</span> {item?.recruitment?.reviewedAt ? formatDateTime(item.recruitment.reviewedAt) : '—'}</p>
                            </div>
                          </div>
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
                    </div>
                  </div>
                  );
                })() : null}
              </div>
            );
          }) : <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">{searchTerm ? `No candidates match "${searchTerm}" for the current filters.` : 'No teacher responses found for the current filters.'}</div>}
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
              ) : viewer.kind === 'audio' || viewer.kind === 'video' ? (
                <MediaPlayer
                  key={viewer.src}
                  kind={viewer.kind}
                  src={viewer.src}
                  min={viewerMin}
                  onFail={viewer.fallback ? () => setViewer((current) => (current && current.fallback ? { ...current, kind: 'iframe', src: current.fallback, fallback: null } : current)) : undefined}
                />
              ) : (
                <div className="w-full">
                  <iframe title={viewer.label} src={viewer.src} className={viewerMin ? 'h-44 w-full' : 'h-[64vh] w-full rounded-lg'} allow="autoplay" />
                  {!viewerMin && /drive\.google\.com|docs\.google\.com/.test(String(viewer.src)) ? (
                    <p className="mt-1.5 text-center text-[11px] text-slate-500">
                      Blank preview? The Drive file isn&apos;t shared publicly — use{' '}
                      <a href={viewer.download} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">Open</a>{' '}
                      to view it in Drive (sharing must be &ldquo;Anyone with the link&rdquo;).
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {archiveConfirmItem ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setArchiveConfirmItem(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-900">Archive candidate</h3>
            <p className="mt-1 text-xs text-slate-600">
              Archive {archiveConfirmItem.personalInfo?.fullName || archiveConfirmItem.personalInfo?.email || 'this applicant'}? They will disappear from the list but stay saved under the &ldquo;Archived&rdquo; stage.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setArchiveConfirmItem(null)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">Cancel</button>
              <button type="button" onClick={confirmArchive} className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">Archive</button>
            </div>
          </div>
        </div>
      ) : null}

      {messagePreview ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setMessagePreview(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-900">
              {messagePreview.event === 'screening_rejected' ? 'Rejection message' : 'Interview invite message'}
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Review and edit before sending to {messagePreview.item?.personalInfo?.fullName || messagePreview.item?.personalInfo?.email || 'this applicant'}. Nothing is sent until you choose an action below.
            </p>
            <label className="mt-3 block text-xs font-medium text-slate-700">
              Subject
              <input
                value={messagePreview.subject}
                onChange={(event) => setMessagePreview((prev) => ({ ...prev, subject: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-slate-700">
              Message
              <textarea
                value={messagePreview.body}
                onChange={(event) => setMessagePreview((prev) => ({ ...prev, body: event.target.value }))}
                rows={9}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
              />
            </label>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setMessagePreview(null)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">Close</button>
              <button type="button" onClick={openPreviewWhatsapp} className="inline-flex items-center gap-1 rounded-full bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700">
                <MessageCircle className="h-3.5 w-3.5" /> Open WhatsApp
              </button>
              <button type="button" onClick={handleSendPreviewEmail} disabled={sendingMessage} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
                <Mail className="h-3.5 w-3.5" /> {sendingMessage ? 'Sending…' : 'Send email'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
