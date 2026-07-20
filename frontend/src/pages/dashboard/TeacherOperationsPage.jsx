import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  Copy,
  Edit3,
  GraduationCap,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  Save,
  Send,
  Sliders,
  Star,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import TeacherResponsesPanel from '../../components/features/meetings/TeacherResponsesPanel';
import BusinessIntelligencePage from './BusinessIntelligencePage';
import { useSearch } from '../../contexts/SearchContext';
import {
  createRecruitmentCampaign,
  getTeacherOperationsSummary,
  listRecruitmentCampaigns,
  updateRecruitmentCampaign,
  createTrainingBatch,
  listTrainingBatches,
  updateTrainingBatch,
  updateBatchSession,
  updateCandidateOutcome,
  addBatchSession,
  removeBatchSession,
  getLectureTemplate,
  saveLectureTemplate,
  listTeacherContractResponses,
  saveInterviewScorecard,
  generateContractLink,
  declineContract,
  addCandidateToBatch,
  getRecruitmentEmailTemplates,
  saveRecruitmentEmailTemplates,
  sendCandidateEmail,
  getCapacityConfig,
  saveCapacityConfig,
  importApplicantsFromSheet,
  getPendingCandidateEmails,
  sendPendingCandidateEmails,
  setTeacherAcceptingStudents,
} from '../../api/teacherContract';
import { STANDARD_SUBJECTS } from '../../utils/subjectStandardization';
import { bumpDomainVersion } from '../../utils/sessionCache';

const TABS = [
  { id: 'overview', label: 'Overview', icon: TrendingUp },
  { id: 'pipeline', label: 'Pipeline', icon: BriefcaseBusiness },
  { id: 'interviews', label: 'Interviews', icon: CalendarClock },
  { id: 'training', label: 'Training', icon: GraduationCap },
  { id: 'stats', label: 'Stats & BI', icon: BarChart3 },
];

// Remember which recruitment tab the admin was on across visits.
const TAB_STORAGE_KEY = 'waraqa.teacherOps.activeTab';

const BATCH_STATUS_COLORS = {
  draft: 'text-muted-foreground',
  active: 'text-primary',
  completed: 'text-green-600 dark:text-green-400',
  cancelled: 'text-red-600 dark:text-red-400',
};

const OUTCOME_COLORS = {
  pending: 'text-muted-foreground',
  passed: 'text-green-600 dark:text-green-400',
  failed: 'text-red-600 dark:text-red-400',
  dropped: 'text-muted-foreground',
};

const INTERVIEW_OUTCOMES = [
  { value: 'pending', label: 'Pending' },
  { value: 'passed', label: 'Passed' },
  { value: 'passed_not_selected', label: 'Passed — not selected' },
  { value: 'completed_unsuitable', label: 'Completed — unsuitable' },
  { value: 'failed', label: 'Failed' },
];

const INTERVIEW_SCORE_FIELDS = [
  { key: 'punctuality', label: 'Punctuality' },
  { key: 'english', label: 'English' },
  { key: 'subjectKnowledge', label: 'Subject knowledge' },
  { key: 'teaching', label: 'Teaching' },
  { key: 'flexibility', label: 'Flexibility' },
  { key: 'professionalism', label: 'Professionalism' },
];

const INTERVIEW_OUTCOME_COLORS = {
  pending: 'text-muted-foreground',
  passed: 'text-green-600 dark:text-green-400',
  passed_not_selected: 'text-amber-600 dark:text-amber-400',
  completed_unsuitable: 'text-amber-600 dark:text-amber-400',
  failed: 'text-red-600 dark:text-red-400',
};

// Maps an interview outcome to the recruitment email template event sent to the candidate.
const OUTCOME_TO_EMAIL_EVENT = {
  pending: 'interview_invite',
  passed: 'passed',
  passed_not_selected: 'passed_not_selected',
  completed_unsuitable: 'completed_unsuitable',
  failed: 'failed',
};

const EMAIL_EVENT_LABELS = {
  interview_invite: 'Interview invite',
  missing_info: 'Request missing info',
  passed: 'Passed — welcome',
  passed_not_selected: 'Passed — not selected',
  completed_unsuitable: 'Completed — unsuitable',
  failed: 'Not moving forward',
};

// The three post-interview decisions surfaced as one-click buttons once the
// interview is marked completed. Each maps onto an existing outcome/email
// event so no backend changes to the outcome enum were needed.
const INTERVIEW_DECISIONS = [
  { outcome: 'passed', label: 'Accept', className: 'bg-green-600 hover:bg-green-700 text-white' },
  { outcome: 'passed_not_selected', label: 'Keep in waiting list', className: 'bg-amber-500 hover:bg-amber-600 text-white' },
  { outcome: 'failed', label: 'Reject', className: 'bg-red-600 hover:bg-red-700 text-white' },
];

// Mirrors the backend's {{var}} substitution so the client-side preview
// matches exactly what will be sent once the admin hits "Send".
const renderTemplateVars = (text, vars = {}) => String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (
  vars[key] == null ? '' : String(vars[key])
));

const CAPACITY_DECISION_STYLES = {
  ok: { label: 'Healthy', badge: 'bg-green-100 text-green-700', bar: 'bg-green-500' },
  hire: { label: 'Start hiring', badge: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500' },
  urgent: { label: 'Urgent hiring', badge: 'bg-red-100 text-red-700', bar: 'bg-red-500' },
};

const LIFECYCLE_STAGE_LABELS = {
  applied: 'Applied',
  interview: 'Interview',
  hired: 'Hired',
  training: 'Training',
  active: 'Active',
  paused: 'Paused',
  left: 'Left',
};

const TENURE_FILTER_OPTIONS = [
  { value: 'all', label: 'Any tenure' },
  { value: 'new', label: 'New (< 6 months)' },
  { value: 'mid', label: '6–24 months' },
  { value: 'senior', label: '2+ years' },
];

const GOOGLE_TEACHER_APPLICATION_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfLK5DuXIGA5UNVgNHHhJXpiy9NJRhobB0BOwRFJE38z3rdgA/viewform';

// Left-nav sections for the unified Stats & Business Intelligence view.
const STATS_NAV_GROUPS = [
  {
    label: 'Recruitment & workforce',
    items: [
      { id: 'pipeline', label: 'Pipeline stages' },
      { id: 'workforce', label: 'Workforce breakdown' },
      { id: 'load', label: 'Teacher load' },
    ],
  },
  {
    label: 'Business intelligence',
    items: [
      { id: 'bi-overview', label: 'Overview' },
      { id: 'bi-people', label: 'People' },
      { id: 'bi-financial', label: 'Financial' },
      { id: 'bi-history', label: 'History' },
    ],
  },
];

const staticPolicyCards = [
  { title: 'Working hours', value: '4h / day', note: '≥3h in Cairo prime windows.', icon: Clock3 },
  { title: 'Hiring trigger', value: '75% full', note: 'Urgent alert at 85%.', icon: TrendingUp },
  { title: 'Pipeline focus', value: 'Fit + coverage', note: 'Gender · subject · timezone.', icon: Users },
];

const compactSignalCards = [
  { key: 'pipeline', label: 'Pipeline', valuePath: ['pipeline', 'total'] },
  { key: 'unreviewed', label: 'Unreviewed', valuePath: ['pipeline', 'unreviewed'] },
  { key: 'activeTeachers', label: 'Active Teachers', valuePath: ['teachers', 'activeCount'] },
  { key: 'hours14', label: '14d Hours', valuePath: ['teachers', 'totalUpcomingHours14Days'], suffix: 'h' },
  { key: 'accepted', label: 'Accepted', valuePath: ['pipeline', 'byStatus', 'accepted'] },
  { key: 'shortlisted', label: 'Shortlisted', valuePath: ['pipeline', 'byStatus', 'shortlisted'] },
];

function TabButton({ active, icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
          : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
      ].join(' ')}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}

function SectionCard({ title, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-border bg-card p-3 shadow-sm ${className}`.trim()}>
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function TeacherOperationsPage({ isActive }) {
  const navigate = useNavigate();
  const { searchTerm } = useSearch();
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = localStorage.getItem(TAB_STORAGE_KEY);
      return TABS.some((tab) => tab.id === saved) ? saved : 'overview';
    } catch {
      return 'overview';
    }
  });
  useEffect(() => {
    try { localStorage.setItem(TAB_STORAGE_KEY, activeTab); } catch { /* ignore */ }
  }, [activeTab]);
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [campaignError, setCampaignError] = useState('');
  const [campaignSaving, setCampaignSaving] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState('');
  const [campaignForm, setCampaignForm] = useState({
    title: '', slug: '', status: 'draft', opensAt: '', closesAt: '', targetApplicants: '', targetHires: '',
    male: false, female: false, subjects: '', preferredWindow: '', publicHeadline: '', publicDescription: '', internalNotes: '', reopenLimit: '',
  });
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showCampaignDrawer, setShowCampaignDrawer] = useState(false);
  const [showArchivedCampaigns, setShowArchivedCampaigns] = useState(false);

  // Training batch state
  const [batches, setBatches] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [batchSaving, setBatchSaving] = useState(false);
  const [expandedBatchId, setExpandedBatchId] = useState(null);
  const [batchForm, setBatchForm] = useState({ title: '', totalSessions: 6, startDate: '', endDate: '', campaignId: '', trainerNotes: '' });
  const [sessionEditing, setSessionEditing] = useState(null); // { batchId, sessionNumber }
  const [sessionForm, setSessionForm] = useState({ title: '', scheduledAt: '', durationMinutes: 60, meetingLink: '', status: 'scheduled', trainerNotes: '' });
  const [showBatchModal, setShowBatchModal] = useState(false);

  // Lecture template (reusable topics)
  const [lectureTopics, setLectureTopics] = useState([]);
  const [lectureDraft, setLectureDraft] = useState([]);
  const [lectureSaving, setLectureSaving] = useState(false);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);

  // Interviews
  const [interviewResponses, setInterviewResponses] = useState([]);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [interviewError, setInterviewError] = useState('');
  const [selectedInterviewId, setSelectedInterviewId] = useState('');
  const [interviewForm, setInterviewForm] = useState(null);
  const [interviewSaving, setInterviewSaving] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailNotice, setEmailNotice] = useState('');
  const [contractLinkState, setContractLinkState] = useState({ id: '', url: '', loading: false, notice: '' });
  const [decisionPreview, setDecisionPreview] = useState(null); // { source, id, outcome, event, subject, body }
  const [decisionSending, setDecisionSending] = useState(false);
  const [declineNote, setDeclineNote] = useState('');
  const [decliningContract, setDecliningContract] = useState(false);
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [addToBatchId, setAddToBatchId] = useState('');
  const [addingToBatch, setAddingToBatch] = useState(false);
  const [addToBatchNotice, setAddToBatchNotice] = useState('');

  // Sheet import
  const [showImportModal, setShowImportModal] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');

  // Recruitment email templates editor
  const [showEmailTemplates, setShowEmailTemplates] = useState(false);
  const [emailTemplates, setEmailTemplates] = useState(null);
  const [emailTemplateEvents, setEmailTemplateEvents] = useState([]);
  const [emailTemplatesSaving, setEmailTemplatesSaving] = useState(false);

  // Capacity settings editor
  const [showCapacityModal, setShowCapacityModal] = useState(false);
  const [capacityForm, setCapacityForm] = useState(null);
  const [capacitySaving, setCapacitySaving] = useState(false);

  // Pending outcome emails (one-click "send all")
  const [pendingEmails, setPendingEmails] = useState([]);
  const [pendingEmailsLoading, setPendingEmailsLoading] = useState(false);
  const [sendingPending, setSendingPending] = useState(false);
  const [pendingNotice, setPendingNotice] = useState('');

  // Teacher statistics filters + per-teacher controls
  const [statsFilters, setStatsFilters] = useState({ subject: 'all', gender: 'all', accepting: 'all', tenure: 'all', availability: 'all' });
  const [statsSection, setStatsSection] = useState('pipeline');
  const [togglingTeacherId, setTogglingTeacherId] = useState('');
  const [expandedTeacherId, setExpandedTeacherId] = useState('');

  const headerCopy = useMemo(() => ({
    title: 'Recruitment',
    subtitle: 'Compact hiring command center: pipeline, training, interviews, and BI in one page.',
  }), []);

  const compactSignals = useMemo(() => {
    const get = (obj, path) => path.reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
    return compactSignalCards.map((item) => {
      const raw = get(summary, item.valuePath);
      const value = raw == null ? '—' : `${raw}${item.suffix || ''}`;
      return { ...item, value };
    });
  }, [summary]);

  const filteredTeacherRows = useMemo(() => {
    const rows = summary?.teacherRows || [];
    return rows.filter((t) => {
      if (statsFilters.subject !== 'all') {
        const subs = t.standardizedSubjects || [];
        if (!subs.includes(statsFilters.subject)) return false;
      }
      if (statsFilters.gender !== 'all') {
        if (String(t.gender || '').toLowerCase() !== statsFilters.gender) return false;
      }
      if (statsFilters.accepting !== 'all') {
        const accepting = t.acceptingNewStudents !== false;
        if (statsFilters.accepting === 'yes' && !accepting) return false;
        if (statsFilters.accepting === 'no' && accepting) return false;
      }
      if (statsFilters.tenure !== 'all') {
        const months = Number(t.tenureMonths || 0);
        if (statsFilters.tenure === 'new' && months >= 6) return false;
        if (statsFilters.tenure === 'mid' && (months < 6 || months >= 24)) return false;
        if (statsFilters.tenure === 'senior' && months < 24) return false;
      }
      if (statsFilters.availability !== 'all') {
        if (String(t.availabilityStatus || '') !== statsFilters.availability) return false;
      }
      return true;
    });
  }, [summary, statsFilters]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    const load = async () => {
      try {
        setLoadingSummary(true);
        setSummaryError('');
        const data = await getTeacherOperationsSummary();
        if (!cancelled) setSummary(data);
      } catch (error) {
        if (!cancelled) setSummaryError(error?.response?.data?.message || 'Failed to load teacher operations summary.');
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    const load = async () => {
      try {
        setCampaignLoading(true);
        setCampaignError('');
        const data = await listRecruitmentCampaigns();
        if (!cancelled) setCampaigns(data || []);
      } catch (error) {
        if (!cancelled) setCampaignError(error?.response?.data?.message || 'Failed to load recruitment campaigns.');
      } finally {
        if (!cancelled) setCampaignLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    const load = async () => {
      try {
        setBatchLoading(true);
        setBatchError('');
        const data = await listTrainingBatches();
        if (!cancelled) setBatches(data || []);
      } catch (error) {
        if (!cancelled) setBatchError(error?.response?.data?.message || 'Failed to load training batches.');
      } finally {
        if (!cancelled) setBatchLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [isActive]);

  // Load reusable lecture template
  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await getLectureTemplate();
        if (!cancelled) setLectureTopics(data?.topics || []);
      } catch (error) {
        // Non-fatal: fall back to server defaults on batch create.
      }
    })();
    return () => { cancelled = true; };
  }, [isActive]);

  // Load interview candidates (shortlisted / interview stages)
  useEffect(() => {
    if (!isActive || activeTab !== 'interviews') return;
    let cancelled = false;
    (async () => {
      try {
        setInterviewLoading(true);
        setInterviewError('');
        const data = await listTeacherContractResponses();
        if (!cancelled) {
          // The Interviews tab is a focused queue of candidates awaiting their
          // interview — decided/awaiting-decision candidates naturally fall
          // out of this list once their outcome moves them to the next step.
          const relevant = (data || []).filter((r) => (r?.recruitment?.status || r?.status) === 'interview_pending');
          setInterviewResponses(relevant);
        }
      } catch (error) {
        if (!cancelled) setInterviewError(error?.response?.data?.message || 'Failed to load interview candidates.');
      } finally {
        if (!cancelled) setInterviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isActive, activeTab]);

  // Load the list of pending outcome emails for the one-click "send all" panel.
  const loadPendingEmails = useCallback(async () => {
    try {
      setPendingEmailsLoading(true);
      const data = await getPendingCandidateEmails();
      setPendingEmails(data?.pending || []);
    } catch {
      // Non-fatal: leave the panel empty if it can't load.
    } finally {
      setPendingEmailsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive || activeTab !== 'interviews') return;
    loadPendingEmails();
  }, [isActive, activeTab, loadPendingEmails]);

  const handleSendPendingEmails = async () => {
    try {
      setSendingPending(true);
      setPendingNotice('');
      const res = await sendPendingCandidateEmails();
      const sent = res?.sent ?? 0;
      const failed = res?.failed ?? 0;
      setPendingNotice(failed ? `Sent ${sent}, ${failed} failed.` : `Sent ${sent} email${sent === 1 ? '' : 's'}.`);
      await loadPendingEmails();
      window.setTimeout(() => setPendingNotice(''), 5000);
    } catch (error) {
      setPendingNotice(error?.response?.data?.message || 'Failed to send pending emails.');
    } finally {
      setSendingPending(false);
    }
  };

  const handleToggleAccepting = async (teacherId, next) => {
    try {
      setTogglingTeacherId(teacherId);
      const res = await setTeacherAcceptingStudents(teacherId, next);
      setSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          teacherRows: (prev.teacherRows || []).map((t) => (
            t.id === teacherId ? { ...t, acceptingNewStudents: res?.acceptingNewStudents } : t
          )),
        };
      });
    } catch {
      // Non-fatal: surface nothing; the toggle simply won't flip.
    } finally {
      setTogglingTeacherId('');
    }
  };

  const openTemplateEditor = () => {
    setLectureDraft(lectureTopics.length ? [...lectureTopics] : ['']);
    setShowTemplateEditor(true);
  };

  const handleSaveTemplate = async () => {
    const cleaned = lectureDraft.map((t) => String(t || '').trim()).filter(Boolean);
    if (!cleaned.length) return;
    try {
      setLectureSaving(true);
      const data = await saveLectureTemplate(cleaned);
      setLectureTopics(data?.topics || cleaned);
      setShowTemplateEditor(false);
    } catch (error) {
      setBatchError(error?.response?.data?.message || 'Failed to save lecture template.');
    } finally {
      setLectureSaving(false);
    }
  };

  const handleAddSession = async (batchId) => {
    try {
      setBatchSaving(true);
      const saved = await addBatchSession(batchId, {});
      if (saved) setBatches((prev) => prev.map((b) => (b._id === batchId ? saved : b)));
    } catch (error) {
      setBatchError(error?.response?.data?.message || 'Failed to add lecture.');
    } finally {
      setBatchSaving(false);
    }
  };

  const handleRemoveSession = async (batchId, sessionNumber) => {
    try {
      setBatchSaving(true);
      const saved = await removeBatchSession(batchId, sessionNumber);
      if (saved) setBatches((prev) => prev.map((b) => (b._id === batchId ? saved : b)));
    } catch (error) {
      setBatchError(error?.response?.data?.message || 'Failed to remove lecture.');
    } finally {
      setBatchSaving(false);
    }
  };

  const selectInterview = (response) => {
    setSelectedInterviewId(response.id);
    const iv = response?.recruitment?.interview || {};
    const scores = iv.scores || {};
    setInterviewForm({
      source: response.source,
      id: response.id,
      scheduledAt: iv.scheduledAt ? String(iv.scheduledAt).slice(0, 16) : '',
      completedAt: iv.completedAt ? String(iv.completedAt).slice(0, 16) : '',
      worksElsewhere: Boolean(iv.worksElsewhere),
      outcome: iv.outcome || 'pending',
      notes: iv.notes || '',
      scores: INTERVIEW_SCORE_FIELDS.reduce((acc, f) => {
        acc[f.key] = scores[f.key] ?? '';
        return acc;
      }, {}),
    });
  };

  const handleSaveInterview = async () => {
    if (!interviewForm) return;
    try {
      setInterviewSaving(true);
      setInterviewError('');
      const payload = {
        scheduledAt: interviewForm.scheduledAt || null,
        completedAt: interviewForm.completedAt || null,
        worksElsewhere: interviewForm.worksElsewhere,
        outcome: interviewForm.outcome,
        notes: interviewForm.notes,
        scores: interviewForm.scores,
      };
      const updated = await saveInterviewScorecard(interviewForm.source, interviewForm.id, payload);
      if (updated) {
        setInterviewResponses((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        selectInterview(updated);
      }
      loadPendingEmails();
    } catch (error) {
      setInterviewError(error?.response?.data?.message || 'Failed to save interview scorecard.');
    } finally {
      setInterviewSaving(false);
    }
  };

  const handleSendCandidateEmail = async (event) => {
    if (!interviewForm) return;
    try {
      setEmailSending(true);
      setEmailNotice('');
      setInterviewError('');
      const res = await sendCandidateEmail(interviewForm.source, interviewForm.id, {
        template: event,
        notes: interviewForm.notes || '',
      });
      setEmailNotice(res?.message || 'Email queued.');
      window.setTimeout(() => setEmailNotice(''), 4000);
      loadPendingEmails();
    } catch (error) {
      setInterviewError(error?.response?.data?.message || 'Failed to send email.');
    } finally {
      setEmailSending(false);
    }
  };

  const handleGenerateContractLink = async () => {
    if (!interviewForm) return;
    try {
      setContractLinkState((p) => ({ ...p, loading: true, notice: '' }));
      const res = await generateContractLink(interviewForm.source, interviewForm.id);
      const url = `${window.location.origin}/teacher-agreement?token=${res.token}`;
      let notice = 'Contract link ready.';
      try {
        await navigator.clipboard.writeText(url);
        notice = 'Contract link copied to clipboard.';
      } catch (err) {
        notice = 'Contract link ready (copy it below).';
      }
      setContractLinkState({ id: interviewForm.id, url, loading: false, notice });
      setInterviewResponses((prev) => prev.map((r) => (r.id === interviewForm.id
        ? { ...r, recruitment: { ...(r.recruitment || {}), contract: { ...((r.recruitment || {}).contract || {}), token: res.token, sentAt: res.sentAt } } }
        : r)));
    } catch (error) {
      setContractLinkState((p) => ({ ...p, loading: false, notice: error?.response?.data?.message || 'Failed to generate contract link.' }));
    }
  };

  // Composes a ready-to-edit subject/body for one of the three post-interview
  // decisions (accept / waiting list / reject), pulling the current email
  // template and folding in the admin's interview notes as the human-readable
  // "reason", then opens the preview modal — nothing is sent until "Send".
  const openDecisionPreview = async (outcome) => {
    if (!interviewForm) return;
    const current = interviewResponses.find((r) => r.id === selectedInterviewId);
    if (!current) return;
    let templates = emailTemplates;
    if (!templates) {
      try {
        const data = await getRecruitmentEmailTemplates();
        templates = data?.templates || {};
        setEmailTemplates(templates);
      } catch {
        templates = {};
      }
    }
    const event = OUTCOME_TO_EMAIL_EVENT[outcome] || 'failed';
    const template = templates?.[event] || { subject: 'Waraqa Recruitment', body: 'Dear {{name}},\n\nWaraqa Recruitment Team' };
    const name = current?.personalInfo?.fullName || current?.contract?.fullName
      || `${current?.user?.firstName || ''} ${current?.user?.lastName || ''}`.trim() || 'there';
    const reason = String(interviewForm.notes || '').trim();
    let body = renderTemplateVars(template.body, { name, reason, notes: reason });
    if (reason && !/\{\{\s*(reason|notes)\s*\}\}/.test(template.body || '')) {
      // The default outcome templates don't include a {{reason}} placeholder,
      // so fold the admin's interview notes in as a closing note the admin
      // can still edit before sending.
      body = body.replace(/\n\n(Waraqa Recruitment Team)\s*$/, `\n\n${reason}\n\n$1`);
    }
    setDecisionPreview({
      source: interviewForm.source,
      id: interviewForm.id,
      outcome,
      event,
      subject: renderTemplateVars(template.subject, { name }),
      body,
    });
  };

  const handleSendDecision = async () => {
    if (!decisionPreview) return;
    try {
      setDecisionSending(true);
      setInterviewError('');
      // Persist the decision as the scorecard outcome first (this is what
      // advances the pipeline stage on the backend), then send the message.
      const updated = await saveInterviewScorecard(decisionPreview.source, decisionPreview.id, {
        ...(interviewForm ? {
          scheduledAt: interviewForm.scheduledAt || null,
          completedAt: interviewForm.completedAt || null,
          worksElsewhere: interviewForm.worksElsewhere,
          notes: interviewForm.notes,
          scores: interviewForm.scores,
        } : {}),
        outcome: decisionPreview.outcome,
      });
      if (updated) {
        setInterviewResponses((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        selectInterview(updated);
      }
      const res = await sendCandidateEmail(decisionPreview.source, decisionPreview.id, {
        event: decisionPreview.event,
        subject: decisionPreview.subject,
        body: decisionPreview.body,
      });
      setEmailNotice(res?.message || 'Email queued.');
      window.setTimeout(() => setEmailNotice(''), 4000);
      setDecisionPreview(null);
      loadPendingEmails();
    } catch (error) {
      setInterviewError(error?.response?.data?.message || 'Failed to record the decision and send the email.');
    } finally {
      setDecisionSending(false);
    }
  };

  // Manual negative confirmation: the candidate was accepted but told us
  // (by phone/WhatsApp/email) they don't want to continue.
  const handleDeclineContract = async () => {
    if (!interviewForm) return;
    try {
      setDecliningContract(true);
      setInterviewError('');
      const res = await declineContract(interviewForm.source, interviewForm.id, declineNote);
      if (res?.response) {
        setInterviewResponses((prev) => prev.map((r) => (r.id === res.response.id ? res.response : r)));
        selectInterview(res.response);
      }
      setShowDeclineForm(false);
      setDeclineNote('');
    } catch (error) {
      setInterviewError(error?.response?.data?.message || 'Failed to record the decline.');
    } finally {
      setDecliningContract(false);
    }
  };

  // Once accepted + confirmed, move the candidate to the next step by
  // enrolling them in a training batch.
  const handleAddToTrainingBatch = async () => {
    if (!interviewForm || !addToBatchId) return;
    const current = interviewResponses.find((r) => r.id === selectedInterviewId);
    if (!current) return;
    try {
      setAddingToBatch(true);
      setAddToBatchNotice('');
      const name = current?.personalInfo?.fullName || current?.contract?.fullName
        || `${current?.user?.firstName || ''} ${current?.user?.lastName || ''}`.trim() || 'Candidate';
      const email = current?.personalInfo?.email || current?.user?.email || '';
      const saved = await addCandidateToBatch(addToBatchId, {
        candidateId: interviewForm.id,
        candidateSource: interviewForm.source,
        displayName: name,
        email,
      });
      if (saved) setBatches((prev) => prev.map((b) => (b._id === saved._id ? saved : b)));
      setAddToBatchNotice('Added to the training batch.');
      window.setTimeout(() => setAddToBatchNotice(''), 4000);
    } catch (error) {
      setAddToBatchNotice(error?.response?.data?.message || 'Failed to add to the training batch.');
    } finally {
      setAddingToBatch(false);
    }
  };

  const handleImportSheet = async () => {
    const url = importUrl.trim();
    if (!url) return;
    try {
      setImporting(true);
      setImportError('');
      setImportResult(null);
      const res = await importApplicantsFromSheet(url);
      setImportResult(res);
      // Invalidate the applicant list cache so the pipeline reflects imports/updates.
      if ((res?.imported > 0) || (res?.updated > 0)) {
        bumpDomainVersion('teacher-contract');
      }
      // Refresh interview list if we imported and are on that tab
      if (res?.imported > 0 && activeTab === 'interviews') {
        try {
          const data = await listTeacherContractResponses();
          setInterviewResponses(data || []);
        } catch { /* non-fatal */ }
      }
    } catch (error) {
      setImportError(error?.response?.data?.message || 'Failed to import from the sheet.');
    } finally {
      setImporting(false);
    }
  };

  const openEmailTemplates = async () => {
    setShowEmailTemplates(true);
    if (emailTemplates) return;
    try {
      const data = await getRecruitmentEmailTemplates();
      setEmailTemplates(data?.templates || {});
      setEmailTemplateEvents(data?.events || Object.keys(data?.templates || {}));
    } catch (error) {
      setEmailTemplateEvents([]);
    }
  };

  const handleSaveEmailTemplates = async () => {
    if (!emailTemplates) return;
    try {
      setEmailTemplatesSaving(true);
      const data = await saveRecruitmentEmailTemplates(emailTemplates);
      setEmailTemplates(data?.templates || emailTemplates);
      setShowEmailTemplates(false);
    } catch (error) {
      // Keep modal open on error
    } finally {
      setEmailTemplatesSaving(false);
    }
  };

  const openCapacitySettings = async () => {
    setShowCapacityModal(true);
    if (capacityForm) return;
    try {
      const data = await getCapacityConfig();
      setCapacityForm(data?.config || null);
    } catch (error) {
      setCapacityForm(summary?.capacity?.config || null);
    }
  };

  const handleSaveCapacity = async () => {
    if (!capacityForm) return;
    try {
      setCapacitySaving(true);
      const data = await saveCapacityConfig(capacityForm);
      setCapacityForm(data?.config || capacityForm);
      setShowCapacityModal(false);
      // Reload summary so the capacity card reflects new thresholds
      try {
        const fresh = await getTeacherOperationsSummary();
        setSummary(fresh);
      } catch { /* non-fatal */ }
    } catch (error) {
      // Keep modal open on error
    } finally {
      setCapacitySaving(false);
    }
  };

  const handleCreateBatch = async () => {
    if (!batchForm.title.trim()) return;
    try {
      setBatchSaving(true);
      setBatchError('');
      const payload = {
        title: batchForm.title,
        totalSessions: Number(batchForm.totalSessions) || 6,
        topics: lectureTopics.length ? lectureTopics : undefined,
        startDate: batchForm.startDate || null,
        endDate: batchForm.endDate || null,
        campaignId: batchForm.campaignId || null,
        trainerNotes: batchForm.trainerNotes,
      };
      const saved = await createTrainingBatch(payload);
      if (saved) {
        setBatches((prev) => [saved, ...prev]);
        setBatchForm({ title: '', totalSessions: 6, startDate: '', endDate: '', campaignId: '', trainerNotes: '' });
        setExpandedBatchId(saved._id);
        setShowBatchModal(false);
      }
    } catch (error) {
      setBatchError(error?.response?.data?.message || 'Failed to create training batch.');
    } finally {
      setBatchSaving(false);
    }
  };

  const handleUpdateBatchStatus = async (batchId, status) => {
    try {
      const saved = await updateTrainingBatch(batchId, { status });
      if (saved) setBatches((prev) => prev.map((b) => b._id === batchId ? saved : b));
    } catch (error) {
      setBatchError(error?.response?.data?.message || 'Failed to update batch status.');
    }
  };

  const startSessionEdit = (batchId, session) => {
    setSessionEditing({ batchId, sessionNumber: session.sessionNumber });
    setSessionForm({
      title: session.title || '',
      scheduledAt: session.scheduledAt ? String(session.scheduledAt).slice(0, 16) : '',
      durationMinutes: session.durationMinutes || 60,
      meetingLink: session.meetingLink || '',
      status: session.status || 'scheduled',
      trainerNotes: session.trainerNotes || '',
    });
  };

  const handleSaveSession = async () => {
    if (!sessionEditing) return;
    try {
      setBatchSaving(true);
      const saved = await updateBatchSession(sessionEditing.batchId, sessionEditing.sessionNumber, {
        ...sessionForm,
        scheduledAt: sessionForm.scheduledAt || null,
        durationMinutes: Number(sessionForm.durationMinutes) || 60,
      });
      if (saved) {
        setBatches((prev) => prev.map((b) => b._id === sessionEditing.batchId ? saved : b));
        setSessionEditing(null);
      }
    } catch (error) {
      setBatchError(error?.response?.data?.message || 'Failed to save session.');
    } finally {
      setBatchSaving(false);
    }
  };

  const handleCandidateOutcome = async (batchId, candidateId, outcome) => {
    try {
      const saved = await updateCandidateOutcome(batchId, candidateId, { outcome });
      if (saved) setBatches((prev) => prev.map((b) => b._id === batchId ? saved : b));
    } catch (error) {
      setBatchError(error?.response?.data?.message || 'Failed to update outcome.');
    }
  };

  const newTeacherInterviewLink = useMemo(() => `${window.location.origin}/public/meetings/evaluation?type=new_teacher_interview`, []);

  const filteredInterviewResponses = useMemo(() => {
    const query = String(searchTerm || '').trim().toLowerCase();
    if (!query) return interviewResponses || [];
    return (interviewResponses || []).filter((r) => {
      const haystack = [
        r.personalInfo?.fullName,
        r.contract?.fullName,
        r.personalInfo?.email,
        r.personalInfo?.mobileNumber,
        r.personalInfo?.whatsappNumber,
        r.user?.firstName,
        r.user?.lastName,
        r.user?.email,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [interviewResponses, searchTerm]);

  const handleCopy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice(`${label} copied.`);
      window.setTimeout(() => setCopyNotice(''), 2500);
    } catch (error) {
      setCopyNotice(`Could not copy ${label.toLowerCase()}.`);
    }
  };

  // Build a ready-to-share recruitment message from the campaign's public copy.
  const buildCampaignMessage = (campaign) => {
    const link = GOOGLE_TEACHER_APPLICATION_FORM_URL;
    const headline = (campaign.publicHeadline || campaign.title || "We're hiring teachers at Waraqa").trim();
    const description = (campaign.publicDescription || '').trim();
    const parts = [headline];
    if (description) parts.push('', description);
    parts.push('', `Apply through the application form: ${link}`);
    return parts.join('\n');
  };

  const resetCampaignForm = () => {
    setEditingCampaignId('');
    setCampaignForm({
      title: '', slug: '', status: 'draft', opensAt: '', closesAt: '', targetApplicants: '', targetHires: '',
      male: false, female: false, subjects: '', preferredWindow: '', publicHeadline: '', publicDescription: '', internalNotes: '', reopenLimit: '',
    });
  };

  const startEditCampaign = (campaign) => {
    setEditingCampaignId(campaign.id);
    setShowCampaignModal(true);
    setShowCampaignDrawer(false);
    setCampaignForm({
      title: campaign.title || '',
      slug: campaign.slug || '',
      status: campaign.status || 'draft',
      opensAt: campaign.opensAt ? String(campaign.opensAt).slice(0, 16) : '',
      closesAt: campaign.closesAt ? String(campaign.closesAt).slice(0, 16) : '',
      targetApplicants: campaign.targetApplicants ?? '',
      targetHires: campaign.targetHires ?? '',
      male: Boolean(campaign.roles?.male),
      female: Boolean(campaign.roles?.female),
      subjects: Array.isArray(campaign.subjects) ? campaign.subjects.join(', ') : '',
      preferredWindow: campaign.preferredWindow || '',
      publicHeadline: campaign.publicHeadline || '',
      publicDescription: campaign.publicDescription || '',
      internalNotes: campaign.internalNotes || '',
      reopenLimit: campaign.reopenLimit ?? '',
    });
  };

  const saveCampaign = async () => {
    try {
      setCampaignSaving(true);
      setCampaignError('');
      const payload = {
        title: campaignForm.title,
        slug: campaignForm.slug,
        status: campaignForm.status,
        opensAt: campaignForm.opensAt || null,
        closesAt: campaignForm.closesAt || null,
        targetApplicants: campaignForm.targetApplicants,
        targetHires: campaignForm.targetHires,
        roles: { male: campaignForm.male, female: campaignForm.female },
        subjects: campaignForm.subjects,
        preferredWindow: campaignForm.preferredWindow,
        publicHeadline: campaignForm.publicHeadline,
        publicDescription: campaignForm.publicDescription,
        internalNotes: campaignForm.internalNotes,
        reopenLimit: campaignForm.reopenLimit,
      };
      const saved = editingCampaignId
        ? await updateRecruitmentCampaign(editingCampaignId, payload)
        : await createRecruitmentCampaign(payload);
      if (!saved) return;
      setCampaigns((prev) => {
        const exists = prev.some((item) => item.id === saved.id);
        return exists ? prev.map((item) => item.id === saved.id ? saved : item) : [saved, ...prev];
      });
      resetCampaignForm();
      setShowCampaignModal(false);
    } catch (error) {
      setCampaignError(error?.response?.data?.message || 'Failed to save recruitment campaign.');
    } finally {
      setCampaignSaving(false);
    }
  };

  // Soft-delete: archived campaigns disappear from the list but stay in the database.
  const setCampaignArchived = async (campaign, archived) => {
    if (archived && !window.confirm(`Archive campaign "${campaign.title}"? It will be hidden from the list but kept for records.`)) return;
    try {
      setCampaignError('');
      const saved = await updateRecruitmentCampaign(campaign.id, {
        title: campaign.title,
        slug: campaign.slug,
        status: archived ? 'archived' : 'draft',
        opensAt: campaign.opensAt || null,
        closesAt: campaign.closesAt || null,
        targetApplicants: campaign.targetApplicants,
        targetHires: campaign.targetHires,
        roles: { male: Boolean(campaign.roles?.male), female: Boolean(campaign.roles?.female) },
        subjects: Array.isArray(campaign.subjects) ? campaign.subjects.join(', ') : (campaign.subjects || ''),
        preferredWindow: campaign.preferredWindow || '',
        publicHeadline: campaign.publicHeadline || '',
        publicDescription: campaign.publicDescription || '',
        internalNotes: campaign.internalNotes || '',
        reopenLimit: campaign.reopenLimit,
      });
      if (saved) setCampaigns((prev) => prev.map((entry) => (entry.id === campaign.id ? saved : entry)));
    } catch (error) {
      setCampaignError(error?.response?.data?.message || 'Failed to update campaign.');
    }
  };

  const liveOverviewCards = useMemo(() => {
    const teachers = summary?.teachers || {};
    const pipeline = summary?.pipeline || {};
    return [
      {
        title: 'Active teachers',
        value: teachers.activeCount ?? '—',
        note: `${teachers.withCustomAvailability ?? 0} custom availability, ${teachers.pendingAvailability ?? 0} pending setup.`,
        icon: Users,
      },
      {
        title: 'Unreviewed applications',
        value: pipeline.unreviewed ?? '—',
        note: `${pipeline.byStatus?.shortlisted ?? 0} shortlisted, ${pipeline.byStatus?.interview_pending ?? 0} waiting for interview.`,
        icon: BriefcaseBusiness,
      },
      {
        title: 'Upcoming hours (14d)',
        value: teachers.totalUpcomingHours14Days != null ? `${teachers.totalUpcomingHours14Days}h` : '—',
        note: `${teachers.distinctStudents14Days ?? 0} student slots across the next 14 days.`,
        icon: CalendarClock,
      },
    ];
  }, [summary]);

  return (
    <div className="min-h-full bg-background p-2 sm:p-3">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2.5">
        <section className="rounded-[20px] border border-border bg-gradient-to-br from-card via-card to-primary/5 p-3 shadow-sm">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                <BriefcaseBusiness className="h-3.5 w-3.5" />
                <span>Single sidebar workspace</span>
              </div>
              <h1 className="mt-1.5 text-lg font-semibold text-foreground">{headerCopy.title}</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">{headerCopy.subtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('stats')}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:border-primary/40"
              >
                <BarChart3 className="h-4 w-4" />
                <span>Stats &amp; BI</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/dashboard/availability')}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm"
              >
                <CalendarClock className="h-4 w-4" />
                <span>Manage interviews</span>
              </button>
            </div>
          </div>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
            {compactSignals.map((item) => (
              <div key={item.key} className="rounded-lg border border-border/80 bg-background/80 px-2.5 py-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{item.label}</p>
                <p className="mt-0.5 text-base font-semibold text-foreground leading-none">{item.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {TABS.map((tab) => (
              <TabButton
                key={tab.id}
                active={tab.id === activeTab}
                icon={tab.icon}
                label={tab.label}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </div>
        </section>

        {summaryError ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{summaryError}</div> : null}

        {activeTab === 'overview' ? (
          <div className="grid gap-3 xl:grid-cols-[1.35fr_0.95fr]">
            <SectionCard title="Live operations snapshot">
              {loadingSummary ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading live summary…</div>
              ) : (
                <div className="grid gap-2 md:grid-cols-3">
                  {liveOverviewCards.map((card) => {
                    const Icon = card.icon;
                    return (
                      <div key={card.title} className="rounded-xl border border-border bg-background p-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{card.title}</p>
                            <p className="mt-1 text-lg font-semibold text-foreground">{card.value}</p>
                          </div>
                          <div className="rounded-2xl bg-primary/10 p-2 text-primary">
                            <Icon className="h-4 w-4" />
                          </div>
                        </div>
                        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{card.note}</p>
                      </div>
                    );
                  })}
                </div>
              )}
              {summary?.dataCompleteness?.note ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{summary.dataCompleteness.note}</p> : null}
            </SectionCard>

            <SectionCard title="Recruitment policy seed">
              <div className="grid gap-2 md:grid-cols-3">
                {staticPolicyCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <div key={card.title} className="rounded-xl border border-border bg-background p-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{card.title}</p>
                          <p className="mt-1 text-lg font-semibold text-foreground">{card.value}</p>
                        </div>
                        <div className="rounded-2xl bg-primary/10 p-2 text-primary">
                          <Icon className="h-4 w-4" />
                        </div>
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{card.note}</p>
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            <SectionCard title="Quick links">
              <div className="space-y-1.5">
                <div className="rounded-xl border border-border bg-background p-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Application form</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <input readOnly value={GOOGLE_TEACHER_APPLICATION_FORM_URL} className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground" />
                    <button type="button" onClick={() => handleCopy(GOOGLE_TEACHER_APPLICATION_FORM_URL, 'Application link')} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1.5 text-xs text-foreground hover:border-primary/40"><Copy className="h-3.5 w-3.5" /> Copy</button>
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-background p-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Interview booking</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <input readOnly value={newTeacherInterviewLink} className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground" />
                    <button type="button" onClick={() => handleCopy(newTeacherInterviewLink, 'Interview link')} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1.5 text-xs text-foreground hover:border-primary/40"><Copy className="h-3.5 w-3.5" /> Copy</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  <button type="button" onClick={() => setActiveTab('pipeline')} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40"><BriefcaseBusiness className="h-3.5 w-3.5" /> Pipeline</button>
                  <button type="button" onClick={() => setActiveTab('interviews')} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40"><CalendarClock className="h-3.5 w-3.5" /> Interviews</button>
                  <button type="button" onClick={() => setActiveTab('training')} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40"><GraduationCap className="h-3.5 w-3.5" /> Training</button>
                  <button type="button" onClick={openEmailTemplates} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40"><Mail className="h-3.5 w-3.5" /> Email templates</button>
                  <button type="button" onClick={openCapacitySettings} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40"><Sliders className="h-3.5 w-3.5" /> Capacity rules</button>
                </div>
                {copyNotice ? <p className="text-[11px] text-muted-foreground">{copyNotice}</p> : null}
              </div>
            </SectionCard>

            <SectionCard title="Capacity decision" className="xl:col-span-2">
              {loadingSummary ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Computing capacity…</div>
              ) : (() => {
                const cap = summary?.capacity;
                if (!cap) return <p className="text-xs text-muted-foreground">Capacity data unavailable.</p>;
                const style = CAPACITY_DECISION_STYLES[cap.decision] || CAPACITY_DECISION_STYLES.ok;
                const pct = Math.min(100, Math.max(0, cap.occupancyPct || 0));
                return (
                  <div className="grid gap-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${style.badge}`}>{style.label}</span>
                        <span className="text-sm text-muted-foreground">{cap.recommendedAction}</span>
                      </div>
                      <button type="button" onClick={openCapacitySettings} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:border-primary/40"><Sliders className="h-3 w-3" /> Adjust</button>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Occupancy (next {cap.config?.horizonDays ?? 14} days)</span>
                        <span className="font-semibold text-foreground">{cap.occupancyPct}% • {cap.bookedHours}h / {cap.capacityHours}h</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                        <span>Hire at {cap.config?.hireThresholdPct ?? 75}%</span>
                        <span>Urgent at {cap.config?.urgentThresholdPct ?? 85}%</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded-lg border border-border bg-background px-2.5 py-1.5"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Female</p><p className="text-base font-semibold text-foreground">{cap.femaleCount}</p></div>
                      <div className="rounded-lg border border-border bg-background px-2.5 py-1.5"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Male</p><p className="text-base font-semibold text-foreground">{cap.maleCount}</p></div>
                      <div className="rounded-lg border border-border bg-background px-2.5 py-1.5"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Booked 14d</p><p className="text-base font-semibold text-foreground">{cap.bookedHours}h</p></div>
                      <div className="rounded-lg border border-border bg-background px-2.5 py-1.5"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Capacity</p><p className="text-base font-semibold text-foreground">{cap.capacityHours}h</p></div>
                    </div>
                    {(cap.shortages || []).length ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">Coverage gaps</p>
                        <ul className="space-y-0.5 text-xs text-amber-800">
                          {cap.shortages.map((s, i) => <li key={i}>• {s.label}</li>)}
                        </ul>
                      </div>
                    ) : <p className="text-xs text-muted-foreground">No gender or subject coverage gaps detected.</p>}
                  </div>
                );
              })()}
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 'pipeline' ? (
          <div className="grid gap-2.5">
            {campaignError ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{campaignError}</div> : null}
            <SectionCard title="Candidate pipeline">
              {isActive ? (
                <TeacherResponsesPanel
                  headerSlot={(
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <BriefcaseBusiness className="h-3.5 w-3.5 text-primary" />
                        {(() => {
                          const active = campaigns.filter((c) => c.status !== 'archived').length;
                          return <span><span className="font-semibold text-foreground">{active}</span> campaign{active === 1 ? '' : 's'}</span>;
                        })()}
                        {campaignLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => { resetCampaignForm(); setShowCampaignModal(true); }} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm">
                          <Plus className="h-3.5 w-3.5" /> New
                        </button>
                        <button type="button" onClick={() => { setImportResult(null); setImportError(''); setShowImportModal(true); }} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-foreground hover:border-primary/40">
                          <Upload className="h-3.5 w-3.5" /> Import
                        </button>
                        <button type="button" onClick={() => setShowCampaignDrawer(true)} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-foreground hover:border-primary/40">
                          <BriefcaseBusiness className="h-3.5 w-3.5" /> Campaigns
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                />
              ) : null}
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 'interviews' ? (
          <div className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
            <SectionCard title="Pending outcome emails" className="xl:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-foreground">
                    {pendingEmailsLoading
                      ? 'Checking for candidates awaiting an outcome email…'
                      : pendingEmails.length
                        ? `${pendingEmails.length} candidate${pendingEmails.length === 1 ? '' : 's'} have a decided outcome but no email sent yet.`
                        : 'All decided candidates have been emailed. Nothing pending.'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Emails are only sent when you press this button — nothing goes out automatically.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={loadPendingEmails}
                    disabled={pendingEmailsLoading || sendingPending}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40 disabled:opacity-60"
                  >
                    <Loader2 className={`h-3.5 w-3.5 ${pendingEmailsLoading ? 'animate-spin' : 'hidden'}`} /> Refresh
                  </button>
                  <button
                    type="button"
                    onClick={handleSendPendingEmails}
                    disabled={sendingPending || pendingEmailsLoading || !pendingEmails.length}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-60"
                  >
                    <Send className="h-4 w-4" /> {sendingPending ? 'Sending…' : `Send all${pendingEmails.length ? ` (${pendingEmails.length})` : ''}`}
                  </button>
                </div>
              </div>
              {pendingNotice ? <p className="mt-2 text-xs font-medium text-green-600 dark:text-green-400">{pendingNotice}</p> : null}
              {pendingEmails.length ? (
                <div className="mt-2 space-y-1">
                  {pendingEmails.map((c) => (
                    <div key={`${c.source}-${c.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs">
                      <div className="min-w-0">
                        <span className="font-semibold text-foreground">{c.name || 'Candidate'}</span>
                        <span className="ml-1.5 text-muted-foreground">{c.email}</span>
                      </div>
                      <span className={`shrink-0 rounded-full bg-muted px-2 py-0.5 font-medium ${INTERVIEW_OUTCOME_COLORS[c.outcome] || 'text-foreground'}`}>{EMAIL_EVENT_LABELS[c.event] || (c.outcome || '').replace(/_/g, ' ')}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </SectionCard>

            <SectionCard title="Interview candidates">
              {interviewError ? <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{interviewError}</div> : null}
              <div className="mb-2 rounded-xl border border-border bg-background p-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Booking link</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <input readOnly value={newTeacherInterviewLink} className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground" />
                  <button type="button" onClick={() => handleCopy(newTeacherInterviewLink, 'Interview link')} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1.5 text-xs text-foreground hover:border-primary/40"><Copy className="h-3.5 w-3.5" /> Copy</button>
                  <button type="button" onClick={() => navigate('/dashboard/availability')} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1.5 text-xs text-foreground hover:border-primary/40"><CalendarClock className="h-3.5 w-3.5" /> Slots</button>
                </div>
              </div>
              {interviewLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading candidates…</div>
              ) : (
                <div className="space-y-1.5">
                  {(filteredInterviewResponses || []).map((r) => {
                    const fullName = String(r.personalInfo?.fullName || '').trim();
                    const userName = `${r.user?.firstName || ''} ${r.user?.lastName || ''}`.trim();
                    const name = fullName || userName || r.contract?.fullName || r.id;
                    const outcome = r.recruitment?.interview?.outcome || 'pending';
                    const selected = selectedInterviewId === r.id;
                    return (
                      <button
                        type="button"
                        key={r.id}
                        onClick={() => selectInterview(r)}
                        className={[
                          'w-full rounded-xl border px-3 py-2 text-left transition',
                          selected ? 'border-primary bg-primary/5' : 'border-border bg-background hover:border-primary/40',
                        ].join(' ')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">{name}</p>
                          <span className={`shrink-0 text-[11px] font-semibold ${INTERVIEW_OUTCOME_COLORS[outcome] || 'text-muted-foreground'}`}>{outcome.replace(/_/g, ' ')}</span>
                        </div>
                        <p className="truncate text-[11px] text-muted-foreground">{r.recruitment?.status || r.status} • {r.personalInfo?.email || r.user?.email || '—'}</p>
                      </button>
                    );
                  })}
                  {!(filteredInterviewResponses || []).length ? <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">{(interviewResponses || []).length ? 'No candidates match your search.' : 'No candidates in interview stages yet.'}</div> : null}
                </div>
              )}
            </SectionCard>

            <SectionCard title="Interview scorecard">
              {!interviewForm ? (
                <div className="flex h-full min-h-[160px] items-center justify-center rounded-xl border border-dashed border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
                  Select a candidate to record the interview outcome and scores.
                </div>
              ) : (() => {
                const current = interviewResponses.find((r) => r.id === selectedInterviewId);
                const phone = String(current?.personalInfo?.whatsappNumber || current?.personalInfo?.mobileNumber || current?.user?.phone || '').replace(/[^\d]/g, '');
                const email = current?.personalInfo?.email || current?.user?.email || '';
                const waText = encodeURIComponent(`Assalamu alaikum, this is Waraqa. Please book your teacher interview here: ${newTeacherInterviewLink}`);
                const mailtoHref = email ? `mailto:${email}?subject=${encodeURIComponent('Waraqa Institute — teacher interview')}&body=${encodeURIComponent(`Assalamu alaikum,\n\nThank you for applying to Waraqa. Please book your teacher interview here:\n${newTeacherInterviewLink}\n\nWaraqa Institute`)}` : '';
                return (
                  <div className="grid gap-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{current?.personalInfo?.fullName || current?.contract?.fullName || 'Candidate'}</p>
                        <p className="text-[11px] text-muted-foreground">{current?.personalInfo?.email || current?.user?.email || '—'}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {phone ? (
                          <a href={`https://wa.me/${phone}?text=${waText}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700">
                            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                          </a>
                        ) : null}
                        {mailtoHref ? (
                          <a href={mailtoHref} className="inline-flex items-center gap-1.5 rounded-full bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700">
                            <Mail className="h-3.5 w-3.5" /> Email
                          </a>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-foreground">
                        <span className="mb-1 block font-medium">Scheduled</span>
                        <input type="datetime-local" value={interviewForm.scheduledAt} onChange={(e) => setInterviewForm((p) => ({ ...p, scheduledAt: e.target.value }))} className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                      </label>
                      <label className="text-xs text-foreground">
                        <span className="mb-1 block font-medium">Completed</span>
                        <input type="datetime-local" value={interviewForm.completedAt} onChange={(e) => setInterviewForm((p) => ({ ...p, completedAt: e.target.value }))} className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                      </label>
                    </div>

                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Scores (0–10)</p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {INTERVIEW_SCORE_FIELDS.map((field) => (
                          <label key={field.key} className="text-xs text-foreground">
                            <span className="mb-1 flex items-center gap-1 font-medium"><Star className="h-3 w-3 text-primary" /> {field.label}</span>
                            <input
                              type="number" min="0" max="10"
                              value={interviewForm.scores[field.key]}
                              onChange={(e) => setInterviewForm((p) => ({ ...p, scores: { ...p.scores, [field.key]: e.target.value } }))}
                              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                            />
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-foreground">
                        <span className="mb-1 block font-medium">Outcome</span>
                        <span className={`block rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-medium ${INTERVIEW_OUTCOME_COLORS[interviewForm.outcome] || 'text-foreground'}`}>
                          {INTERVIEW_OUTCOMES.find((o) => o.value === interviewForm.outcome)?.label || 'Pending'}
                        </span>
                      </label>
                      <label className="mt-5 inline-flex items-center gap-2 text-xs text-foreground">
                        <input type="checkbox" checked={interviewForm.worksElsewhere} onChange={(e) => setInterviewForm((p) => ({ ...p, worksElsewhere: e.target.checked }))} />
                        Works elsewhere
                      </label>
                    </div>

                    <label className="text-xs text-foreground">
                      <span className="mb-1 block font-medium">Notes</span>
                      <textarea rows={3} value={interviewForm.notes} onChange={(e) => setInterviewForm((p) => ({ ...p, notes: e.target.value }))} className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm" placeholder="Strengths, concerns, next steps…" />
                    </label>

                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" onClick={handleSaveInterview} disabled={interviewSaving} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-60">
                        <Save className="h-4 w-4" /> {interviewSaving ? 'Saving…' : 'Save scorecard'}
                      </button>
                      <button type="button" onClick={() => { setSelectedInterviewId(''); setInterviewForm(null); }} className="rounded-full border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground">Close</button>
                    </div>

                    <div className="rounded-xl border border-border bg-background p-2.5">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Step 1 · Interview invite</p>
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => handleSendCandidateEmail('interview_invite')} disabled={emailSending} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40 disabled:opacity-60">
                          <Mail className="h-3.5 w-3.5" /> Interview invite
                        </button>
                        <button type="button" onClick={() => handleSendCandidateEmail('missing_info')} disabled={emailSending} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40 disabled:opacity-60">
                          <Mail className="h-3.5 w-3.5" /> Request missing info
                        </button>
                        <button type="button" onClick={openEmailTemplates} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40">
                          <Edit3 className="h-3.5 w-3.5" /> Edit templates
                        </button>
                      </div>
                      {emailNotice ? <p className="mt-1.5 text-[11px] font-medium text-green-600 dark:text-green-400">{emailNotice}</p> : null}
                    </div>

                    <div className="rounded-xl border border-border bg-background p-2.5">
                      <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Step 2 · Interview decision</p>
                      {!interviewForm.completedAt ? (
                        <p className="text-[11px] text-muted-foreground">Mark the interview as completed above to record a decision.</p>
                      ) : (
                        <>
                          <p className="mb-1.5 text-[11px] text-muted-foreground">Each decision composes a dedicated, human-readable message you can edit before sending.</p>
                          <div className="flex flex-wrap gap-1.5">
                            {INTERVIEW_DECISIONS.map((d) => (
                              <button
                                key={d.outcome}
                                type="button"
                                onClick={() => openDecisionPreview(d.outcome)}
                                disabled={interviewSaving}
                                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm disabled:opacity-60 ${d.className}`}
                              >
                                {d.outcome === interviewForm.outcome ? <CheckCircle2 className="h-3.5 w-3.5" /> : null} {d.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="rounded-xl border border-border bg-background p-2.5">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Step 3 · Confirm & contract (after accepting)</p>
                      {current?.recruitment?.contract?.declinedAt ? (
                        <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
                          Candidate told us on {new Date(current.recruitment.contract.declinedAt).toLocaleString()} they don't want to continue{current.recruitment.contract.declineNote ? `: "${current.recruitment.contract.declineNote}"` : '.'}
                        </p>
                      ) : current?.recruitment?.contract?.acceptedAt ? (
                        <p className="text-[11px] font-medium text-green-600 dark:text-green-400">
                          Confirmed by {current.recruitment.contract.acceptedName || 'candidate'} on {new Date(current.recruitment.contract.acceptedAt).toLocaleString()} — ready for training.
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          Generate a private link for the candidate to review and accept the contract, confirming they want to continue.
                          {current?.recruitment?.contract?.sentAt ? ` Link last generated ${new Date(current.recruitment.contract.sentAt).toLocaleString()}.` : ''}
                        </p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <button type="button" onClick={handleGenerateContractLink} disabled={contractLinkState.loading} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40 disabled:opacity-60">
                          {contractLinkState.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                          {current?.recruitment?.contract?.token ? 'Regenerate & copy contract link' : 'Generate & copy contract link'}
                        </button>
                        {!current?.recruitment?.contract?.acceptedAt && !current?.recruitment?.contract?.declinedAt ? (
                          <button type="button" onClick={() => setShowDeclineForm((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-red-600 hover:border-red-300">
                            <XCircle className="h-3.5 w-3.5" /> Candidate won't continue
                          </button>
                        ) : null}
                      </div>
                      {contractLinkState.id === selectedInterviewId && contractLinkState.url ? (
                        <input readOnly value={contractLinkState.url} onFocus={(e) => e.target.select()} className="mt-1.5 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[11px] text-foreground" />
                      ) : null}
                      {contractLinkState.id === selectedInterviewId && contractLinkState.notice ? <p className="mt-1 text-[11px] text-muted-foreground">{contractLinkState.notice}</p> : null}
                      {showDeclineForm ? (
                        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2">
                          <textarea rows={2} value={declineNote} onChange={(e) => setDeclineNote(e.target.value)} className="w-full rounded-lg border border-red-200 bg-white px-2 py-1.5 text-xs" placeholder="Optional: why did they decline? (e.g. accepted another offer, schedule no longer works…)" />
                          <div className="mt-1.5 flex gap-1.5">
                            <button type="button" onClick={handleDeclineContract} disabled={decliningContract} className="rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">{decliningContract ? 'Saving…' : 'Confirm — mark as rejected'}</button>
                            <button type="button" onClick={() => setShowDeclineForm(false)} className="rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-foreground">Cancel</button>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {current?.recruitment?.contract?.acceptedAt ? (
                      <div className="rounded-xl border border-border bg-background p-2.5">
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Step 4 · Move to training</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <select value={addToBatchId} onChange={(e) => setAddToBatchId(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs">
                            <option value="">Select a training batch…</option>
                            {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.title}</option>)}
                          </select>
                          <button type="button" onClick={handleAddToTrainingBatch} disabled={!addToBatchId || addingToBatch} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm disabled:opacity-60">
                            <GraduationCap className="h-3.5 w-3.5" /> {addingToBatch ? 'Adding…' : 'Add to batch'}
                          </button>
                        </div>
                        {addToBatchNotice ? <p className="mt-1 text-[11px] text-muted-foreground">{addToBatchNotice}</p> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })()}
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 'training' ? (
          <div className="grid gap-3">
            {batchError ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{batchError}</div> : null}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <GraduationCap className="h-4 w-4 text-primary" />
                <span><span className="font-semibold text-foreground">{batches.length}</span> batch{batches.length === 1 ? '' : 'es'}</span>
                <span>•</span>
                <span><span className="font-semibold text-foreground">{lectureTopics.length}</span> lecture topics</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setShowBatchModal(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm"><Plus className="h-3.5 w-3.5" /> New batch</button>
                <button type="button" onClick={openTemplateEditor} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-1.5 text-xs font-semibold text-foreground hover:border-primary/40"><Edit3 className="h-3.5 w-3.5" /> Lecture topics</button>
              </div>
            </div>

            <SectionCard title="Training batches">
                {batchLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading batches…</div> : null}
                <div className="space-y-2">
                  {(batches || []).map((batch) => {
                    const isExpanded = expandedBatchId === batch._id;
                    const completedSessions = (batch.sessions || []).filter((s) => s.status === 'completed').length;
                    const passedCount = (batch.candidates || []).filter((c) => c.outcome === 'passed').length;
                    const failedCount = (batch.candidates || []).filter((c) => c.outcome === 'failed').length;
                    return (
                      <div key={batch._id} className="rounded-2xl border border-border bg-background">
                        <div
                          className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2"
                          onClick={() => setExpandedBatchId(isExpanded ? null : batch._id)}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-foreground">{batch.title}</p>
                            <p className="text-xs text-muted-foreground">
                              <span className={BATCH_STATUS_COLORS[batch.status] || 'text-muted-foreground'}>{batch.status}</span>
                              {' • '}{completedSessions}/{batch.totalSessions || 6} sessions
                              {' • '}{batch.candidates?.length || 0} candidates
                              {passedCount > 0 ? ` • ${passedCount} passed` : ''}
                              {failedCount > 0 ? ` • ${failedCount} failed` : ''}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <select
                              value={batch.status}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => handleUpdateBatchStatus(batch._id, e.target.value)}
                              className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground"
                            >
                              <option value="draft">Draft</option>
                              <option value="active">Active</option>
                              <option value="completed">Completed</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                            {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                          </div>
                        </div>

                        {isExpanded ? (
                          <div className="border-t border-border px-3 pb-3 pt-2">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Lectures</p>
                              <button type="button" onClick={() => handleAddSession(batch._id)} disabled={batchSaving} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary/40 disabled:opacity-60"><Plus className="h-3 w-3" /> Add lecture</button>
                            </div>
                            <div className="space-y-2">
                              {(batch.sessions || []).map((session) => {
                                const isEditingThis = sessionEditing?.batchId === batch._id && sessionEditing?.sessionNumber === session.sessionNumber;
                                return (
                                  <div key={session.sessionNumber} className="rounded-lg border border-border bg-card p-2">
                                    {isEditingThis ? (
                                      <div className="grid gap-2">
                                        <div className="grid grid-cols-2 gap-2">
                                          <input value={sessionForm.title} onChange={(e) => setSessionForm((p) => ({ ...p, title: e.target.value }))} placeholder="Session title" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                                          <input type="datetime-local" value={sessionForm.scheduledAt} onChange={(e) => setSessionForm((p) => ({ ...p, scheduledAt: e.target.value }))} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          <input value={sessionForm.meetingLink} onChange={(e) => setSessionForm((p) => ({ ...p, meetingLink: e.target.value }))} placeholder="Meeting link" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                                          <select value={sessionForm.status} onChange={(e) => setSessionForm((p) => ({ ...p, status: e.target.value }))} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
                                            <option value="scheduled">Scheduled</option>
                                            <option value="completed">Completed</option>
                                            <option value="cancelled">Cancelled</option>
                                          </select>
                                        </div>
                                        <textarea rows={2} value={sessionForm.trainerNotes} onChange={(e) => setSessionForm((p) => ({ ...p, trainerNotes: e.target.value }))} placeholder="Trainer notes" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
                                        <div className="flex gap-2">
                                          <button type="button" onClick={handleSaveSession} disabled={batchSaving} className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-60">{batchSaving ? 'Saving…' : 'Save session'}</button>
                                          <button type="button" onClick={() => setSessionEditing(null)} className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground">Cancel</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex items-start justify-between gap-2">
                                        <div>
                                          <p className="text-sm font-medium text-foreground">Session {session.sessionNumber}{session.title ? `: ${session.title}` : ''}</p>
                                          <p className="text-xs text-muted-foreground">
                                            {session.scheduledAt ? new Date(session.scheduledAt).toLocaleString() : 'Not scheduled'}
                                            {' • '}{session.status}
                                            {session.meetingLink ? <> • <a href={session.meetingLink} target="_blank" rel="noreferrer" className="text-primary underline">Join</a></> : null}
                                          </p>
                                          {session.trainerNotes ? <p className="mt-1 text-xs text-muted-foreground">{session.trainerNotes}</p> : null}
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1">
                                          <button type="button" onClick={() => startSessionEdit(batch._id, session)} className="rounded-full border border-border bg-card px-2 py-1 text-xs text-foreground hover:border-primary/40">
                                            <Edit3 className="h-3 w-3" />
                                          </button>
                                          <button type="button" onClick={() => handleRemoveSession(batch._id, session.sessionNumber)} disabled={batchSaving} className="rounded-full border border-border bg-card px-2 py-1 text-xs text-red-600 hover:border-red-400 disabled:opacity-60">
                                            <Trash2 className="h-3 w-3" />
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {(batch.candidates || []).length > 0 ? (
                              <>
                                <p className="mb-2 mt-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Candidates</p>
                                <div className="space-y-2">
                                  {batch.candidates.map((c) => (
                                    <div key={String(c.candidateId)} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2">
                                      <div>
                                        <p className="text-sm font-medium text-foreground">{c.displayName || c.email || String(c.candidateId)}</p>
                                        <p className={`text-xs ${OUTCOME_COLORS[c.outcome] || 'text-muted-foreground'}`}>{c.outcome}</p>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        {c.outcome !== 'passed' ? (
                                          <button type="button" onClick={() => handleCandidateOutcome(batch._id, c.candidateId, 'passed')} className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-200">
                                            <CheckCircle2 className="h-3 w-3" /> Pass
                                          </button>
                                        ) : null}
                                        {c.outcome !== 'failed' ? (
                                          <button type="button" onClick={() => handleCandidateOutcome(batch._id, c.candidateId, 'failed')} className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200">
                                            <XCircle className="h-3 w-3" /> Fail
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <p className="mt-2 text-xs text-muted-foreground">No candidates added to this batch yet. Add them from the Pipeline tab by moving them to training.</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {!batchLoading && !(batches || []).length ? <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">No training batches yet.</div> : null}
                </div>
              </SectionCard>
          </div>
        ) : null}

        {activeTab === 'stats' ? (
          <div className="flex flex-col gap-3 lg:flex-row">
            {/* Left section nav */}
            <nav className="shrink-0 lg:w-52">
              <div className="rounded-2xl border border-border bg-card p-2 lg:sticky lg:top-2">
                {STATS_NAV_GROUPS.map((group) => (
                  <div key={group.label} className="mb-1 last:mb-0">
                    <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{group.label}</p>
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setStatsSection(item.id)}
                        className={[
                          'block w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition',
                          statsSection === item.id ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
                        ].join(' ')}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </nav>

            {/* Right content pane */}
            <div className="min-w-0 flex-1 space-y-3">
              {statsSection === 'pipeline' ? (
              <SectionCard title="Recruitment pipeline stages">
                {loadingSummary ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading pipeline data…</div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ['New', summary?.pipeline?.byStatus?.new ?? 0, 'text-foreground'],
                      ['Under review', summary?.pipeline?.byStatus?.under_review ?? 0, 'text-foreground'],
                      ['Shortlisted', summary?.pipeline?.byStatus?.shortlisted ?? 0, 'text-primary'],
                      ['Interview pending', summary?.pipeline?.byStatus?.interview_pending ?? 0, 'text-primary'],
                      ['Interviewed', summary?.pipeline?.byStatus?.interviewed ?? 0, 'text-foreground'],
                      ['Accepted', summary?.pipeline?.byStatus?.accepted ?? 0, 'text-green-600 dark:text-green-400'],
                      ['Rejected', summary?.pipeline?.byStatus?.rejected ?? 0, 'text-red-600 dark:text-red-400'],
                      ['Archived', summary?.pipeline?.byStatus?.archived ?? 0, 'text-muted-foreground'],
                    ].map(([label, value, colorClass]) => (
                      <div key={label} className="rounded-xl border border-border bg-background px-2.5 py-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
                        <p className={`mt-1 text-xl font-semibold ${colorClass}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Total candidates in pipeline: <span className="font-semibold text-foreground">{summary?.pipeline?.total ?? 0}</span>
                  {' • '}
                  Unreviewed: <span className="font-semibold text-foreground">{summary?.pipeline?.unreviewed ?? 0}</span>
                </p>
              </SectionCard>
              ) : null}

              {statsSection === 'workforce' ? (
              <SectionCard title="Teacher workforce breakdown">
                {loadingSummary ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading teacher stats…</div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ...STANDARD_SUBJECTS.map((subject) => [subject, summary?.teachers?.subjectBreakdown?.[subject] ?? 0]),
                      ['Accepting new students', summary?.teachers?.acceptingNewStudentsCount ?? 0],
                      ['Not accepting', summary?.teachers?.notAcceptingNewStudentsCount ?? 0],
                      ['English-speaking', summary?.teachers?.englishSpeakingCount ?? 0],
                      ['Al-Azhar background', summary?.teachers?.azharCount ?? 0],
                      ['Ijazah background', summary?.teachers?.ijazahCount ?? 0],
                      ['Single-subject', summary?.teachers?.singleSubjectCount ?? 0],
                      ['Multi-subject', summary?.teachers?.multiSubjectCount ?? 0],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                        <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
              ) : null}

              {statsSection === 'load' ? (
            <SectionCard title="Current teacher load">
              {loadingSummary ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading load data…</div>
              ) : (
                <div className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Monthly hours</p>
                      <p className="mt-1 text-xl font-semibold text-foreground">{summary?.teachers?.totalMonthlyHours ?? 0}h</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">Average {summary?.teachers?.averageMonthlyHours ?? 0}h per active teacher this month.</p>
                    </div>
                    <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Next 14 days</p>
                      <p className="mt-1 text-xl font-semibold text-foreground">{summary?.teachers?.withUpcomingClasses ?? 0}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">Teachers with scheduled load; {summary?.teachers?.withoutUpcomingClasses ?? 0} currently have none.</p>
                    </div>
                  </div>

                  {/* Filters */}
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background px-2.5 py-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Filters</span>
                    <select value={statsFilters.subject} onChange={(e) => setStatsFilters((p) => ({ ...p, subject: e.target.value }))} className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground">
                      <option value="all">All subjects</option>
                      {STANDARD_SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select value={statsFilters.gender} onChange={(e) => setStatsFilters((p) => ({ ...p, gender: e.target.value }))} className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground">
                      <option value="all">Any gender</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                    </select>
                    <select value={statsFilters.accepting} onChange={(e) => setStatsFilters((p) => ({ ...p, accepting: e.target.value }))} className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground">
                      <option value="all">Accepting: any</option>
                      <option value="yes">Accepting new students</option>
                      <option value="no">Not accepting</option>
                    </select>
                    <select value={statsFilters.tenure} onChange={(e) => setStatsFilters((p) => ({ ...p, tenure: e.target.value }))} className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground">
                      {TENURE_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <select value={statsFilters.availability} onChange={(e) => setStatsFilters((p) => ({ ...p, availability: e.target.value }))} className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground">
                      <option value="all">Any availability</option>
                      <option value="custom_set">Custom set</option>
                      <option value="default_24_7">Default 24/7</option>
                      <option value="pending_setup">Pending setup</option>
                    </select>
                    <span className="ml-auto text-[11px] text-muted-foreground">{filteredTeacherRows.length} of {(summary?.teacherRows || []).length}</span>
                  </div>

                  <div className="space-y-1.5">
                    {filteredTeacherRows.map((teacher) => {
                      const accepting = teacher.acceptingNewStudents !== false;
                      const expanded = expandedTeacherId === teacher.id;
                      return (
                        <div key={teacher.id} className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="font-semibold text-foreground">{teacher.name}</p>
                                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{LIFECYCLE_STAGE_LABELS[teacher.lifecycleStage] || teacher.lifecycleStage}</span>
                                {!accepting ? <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">Not accepting new students</span> : null}
                              </div>
                              <p className="text-xs text-muted-foreground">{(teacher.standardizedSubjects || []).join(', ') || 'No subjects yet'} • {teacher.timezone}</p>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {teacher.tenureLabel ? <span className="rounded-full bg-muted px-1.5 py-0.5 font-medium text-foreground">{teacher.tenureLabel} tenure</span> : null}
                              <span>{teacher.upcomingHours14Days}h/14d • {teacher.studentCount14Days} students • {teacher.monthlyHours}h/mo</span>
                            </div>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleToggleAccepting(teacher.id, !accepting)}
                              disabled={togglingTeacherId === teacher.id}
                              className={[
                                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-60',
                                accepting
                                  ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300'
                                  : 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300',
                              ].join(' ')}
                            >
                              {togglingTeacherId === teacher.id ? <Loader2 className="h-3 w-3 animate-spin" /> : (accepting ? <XCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />)}
                              {accepting ? 'Stop accepting new students' : 'Resume accepting new students'}
                            </button>
                            <button type="button" onClick={() => setExpandedTeacherId(expanded ? '' : teacher.id)} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:border-primary/40">
                              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Lifecycle
                            </button>
                          </div>
                          {expanded ? (
                            <div className="mt-2 grid gap-1 rounded-lg border border-border bg-card px-2.5 py-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                              <p><span className="font-semibold text-foreground">Stage:</span> {LIFECYCLE_STAGE_LABELS[teacher.lifecycleStage] || teacher.lifecycleStage}</p>
                              <p><span className="font-semibold text-foreground">Joined:</span> {teacher.joiningDate ? new Date(teacher.joiningDate).toLocaleDateString() : (teacher.tenureStart ? `${new Date(teacher.tenureStart).toLocaleDateString()} (from account creation)` : 'Unknown')}</p>
                              <p><span className="font-semibold text-foreground">Tenure:</span> {teacher.tenureMonths != null ? `${teacher.tenureMonths} month${teacher.tenureMonths === 1 ? '' : 's'}` : 'Unknown'}</p>
                              <p><span className="font-semibold text-foreground">Accepting:</span> {accepting ? 'Yes' : 'No'}</p>
                              <p><span className="font-semibold text-foreground">Availability:</span> {teacher.availabilityStatus?.replace(/_/g, ' ') || '—'}</p>
                              <p className="text-[10px]">Edit the joining date from the teacher's profile (admin).</p>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {!filteredTeacherRows.length ? <div className="text-sm text-muted-foreground">{(summary?.teacherRows || []).length ? 'No teachers match the current filters.' : 'No active teachers found.'}</div> : null}
                  </div>
                </div>
              )}
            </SectionCard>
              ) : null}

              <div className={statsSection.startsWith('bi-') ? '' : 'hidden'}>
                <BusinessIntelligencePage isActive={isActive && activeTab === 'stats'} embedded controlledTab={statsSection.startsWith('bi-') ? statsSection.slice(3) : 'overview'} />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Campaign create/edit modal */}
      {showCampaignModal ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" onClick={() => setShowCampaignModal(false)}>
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{editingCampaignId ? 'Edit campaign' : 'New campaign'}</h3>
              <button type="button" onClick={() => setShowCampaignModal(false)} className="rounded-full p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            {campaignError ? <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{campaignError}</div> : null}
            <div className="grid gap-2 md:grid-cols-2">
              <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Title</span><input value={campaignForm.title} onChange={(e) => setCampaignForm((p) => ({ ...p, title: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
              <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Slug</span><input value={campaignForm.slug} onChange={(e) => setCampaignForm((p) => ({ ...p, slug: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" placeholder="school-year-2026" /></label>
              <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Status</span>
                <select value={campaignForm.status} onChange={(e) => setCampaignForm((p) => ({ ...p, status: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2">
                  <option value="draft">Draft</option><option value="open">Open</option><option value="closed">Closed</option><option value="archived">Archived</option>
                </select>
              </label>
              <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Preferred Cairo window</span><input value={campaignForm.preferredWindow} onChange={(e) => setCampaignForm((p) => ({ ...p, preferredWindow: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" placeholder="10 PM - 3 AM Cairo" /></label>
              <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Opens at</span><input type="datetime-local" value={campaignForm.opensAt} onChange={(e) => setCampaignForm((p) => ({ ...p, opensAt: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
              <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Closes at</span><input type="datetime-local" value={campaignForm.closesAt} onChange={(e) => setCampaignForm((p) => ({ ...p, closesAt: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
              <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Target applicants</span><input type="number" min="0" value={campaignForm.targetApplicants} onChange={(e) => setCampaignForm((p) => ({ ...p, targetApplicants: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
              <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Target hires</span><input type="number" min="0" value={campaignForm.targetHires} onChange={(e) => setCampaignForm((p) => ({ ...p, targetHires: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
              <label className="text-sm text-foreground md:col-span-2"><span className="mb-1 block font-medium">Subjects</span><input value={campaignForm.subjects} onChange={(e) => setCampaignForm((p) => ({ ...p, subjects: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" placeholder="Quran, Arabic, Islamic Studies" /></label>
              <label className="text-sm text-foreground md:col-span-2"><span className="mb-1 block font-medium">Public headline</span><input value={campaignForm.publicHeadline} onChange={(e) => setCampaignForm((p) => ({ ...p, publicHeadline: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
              <label className="text-sm text-foreground md:col-span-2"><span className="mb-1 block font-medium">Public description</span><textarea rows={3} value={campaignForm.publicDescription} onChange={(e) => setCampaignForm((p) => ({ ...p, publicDescription: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
              <label className="text-sm text-foreground md:col-span-2"><span className="mb-1 block font-medium">Internal notes</span><textarea rows={2} value={campaignForm.internalNotes} onChange={(e) => setCampaignForm((p) => ({ ...p, internalNotes: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
              <div className="md:col-span-2 flex flex-wrap items-center gap-3 text-sm text-foreground">
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={campaignForm.male} onChange={(e) => setCampaignForm((p) => ({ ...p, male: e.target.checked }))} /> Male teachers</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={campaignForm.female} onChange={(e) => setCampaignForm((p) => ({ ...p, female: e.target.checked }))} /> Female teachers</label>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-1.5">
              <button type="button" onClick={() => setShowCampaignModal(false)} className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground">Cancel</button>
              <button type="button" onClick={saveCampaign} disabled={campaignSaving} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-60">
                {editingCampaignId ? <Edit3 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                <span>{campaignSaving ? 'Saving…' : editingCampaignId ? 'Update campaign' : 'Create campaign'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Campaign list drawer (from right) */}
      {showCampaignDrawer ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setShowCampaignDrawer(false)}>
          <div className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Campaigns</h3>
              <button type="button" onClick={() => setShowCampaignDrawer(false)} className="rounded-full p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="mb-2 rounded-xl border border-border bg-background p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Generic application link</p>
              <div className="mt-1 flex items-center gap-1.5">
                <input readOnly value={GOOGLE_TEACHER_APPLICATION_FORM_URL} className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground" />
                <button type="button" onClick={() => handleCopy(GOOGLE_TEACHER_APPLICATION_FORM_URL, 'Application link')} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1.5 text-xs text-foreground hover:border-primary/40"><Copy className="h-3.5 w-3.5" /> Copy</button>
              </div>
              {copyNotice ? <p className="mt-1 text-[11px] text-muted-foreground">{copyNotice}</p> : null}
            </div>
            <div className="space-y-2">
              {(campaigns || []).filter((campaign) => (showArchivedCampaigns ? campaign.status === 'archived' : campaign.status !== 'archived')).map((campaign) => (
                <div key={campaign.id} className="rounded-xl border border-border bg-background p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{campaign.title}</p>
                      <p className="text-[11px] text-muted-foreground">/{campaign.slug} • {campaign.status} • {campaign.applicationCount} apps</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => handleCopy(GOOGLE_TEACHER_APPLICATION_FORM_URL, 'Application link')} title="Copy application link" className="rounded-full border border-border bg-card px-2 py-1 text-xs text-foreground hover:border-primary/40"><Copy className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => handleCopy(buildCampaignMessage(campaign), 'Outreach message')} title="Copy outreach message" className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-xs text-foreground hover:border-primary/40"><MessageCircle className="h-3.5 w-3.5" /> Message</button>
                      <button type="button" onClick={() => startEditCampaign(campaign)} title="Edit campaign" className="rounded-full border border-border bg-card px-2 py-1 text-xs text-foreground hover:border-primary/40"><Edit3 className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => setCampaignArchived(campaign, campaign.status !== 'archived')} title={campaign.status === 'archived' ? 'Restore campaign' : 'Archive campaign'} className="rounded-full border border-border bg-card px-2 py-1 text-xs text-foreground hover:border-red-300 hover:text-red-600"><Archive className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                  <div className="mt-1.5 grid gap-1 text-[11px] text-foreground">
                    <div className="rounded-lg border border-border bg-card px-2 py-1">Subjects: {campaign.subjects?.join(', ') || 'General'}</div>
                    <div className="rounded-lg border border-border bg-card px-2 py-1">Window: {campaign.preferredWindow || 'Flexible'} • Hires: {campaign.targetHires || 0}</div>
                  </div>
                </div>
              ))}
              {!campaignLoading && !(campaigns || []).filter((campaign) => (showArchivedCampaigns ? campaign.status === 'archived' : campaign.status !== 'archived')).length ? <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">{showArchivedCampaigns ? 'No archived campaigns.' : 'No campaigns yet.'}</div> : null}
              {(campaigns || []).some((campaign) => campaign.status === 'archived') || showArchivedCampaigns ? (
                <button type="button" onClick={() => setShowArchivedCampaigns((open) => !open)} className="w-full rounded-xl border border-dashed border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                  {showArchivedCampaigns ? '← Back to active campaigns' : `Show archived (${(campaigns || []).filter((campaign) => campaign.status === 'archived').length})`}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* New training batch modal */}
      {showBatchModal ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" onClick={() => setShowBatchModal(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">New training batch</h3>
              <button type="button" onClick={() => setShowBatchModal(false)} className="rounded-full p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-2">
              <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Batch title *</span><input value={batchForm.title} onChange={(e) => setBatchForm((p) => ({ ...p, title: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" placeholder="e.g. Training Batch — July 2026" /></label>
              <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Campaign</span>
                <select value={batchForm.campaignId} onChange={(e) => setBatchForm((p) => ({ ...p, campaignId: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2">
                  <option value="">None</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Start date</span><input type="date" value={batchForm.startDate} onChange={(e) => setBatchForm((p) => ({ ...p, startDate: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
                <label className="text-sm text-foreground"><span className="mb-1 block font-medium">End date</span><input type="date" value={batchForm.endDate} onChange={(e) => setBatchForm((p) => ({ ...p, endDate: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
              </div>
              <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Trainer notes</span><textarea rows={2} value={batchForm.trainerNotes} onChange={(e) => setBatchForm((p) => ({ ...p, trainerNotes: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
              <p className="rounded-lg border border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">Lectures are seeded from the {lectureTopics.length || 'default'} shared topics. Add, rename, or remove lectures per batch after creation.</p>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-1.5">
              <button type="button" onClick={() => setShowBatchModal(false)} className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground">Cancel</button>
              <button type="button" onClick={handleCreateBatch} disabled={batchSaving || !batchForm.title.trim()} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-60"><Plus className="h-4 w-4" /> {batchSaving ? 'Creating…' : 'Create batch'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Lecture template editor */}
      {showTemplateEditor ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" onClick={() => setShowTemplateEditor(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Lecture topics</h3>
              <button type="button" onClick={() => setShowTemplateEditor(false)} className="rounded-full p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-2 text-[11px] text-muted-foreground">These topics seed every new training batch. Reorder is by list position.</p>
            <div className="space-y-1.5">
              {lectureDraft.map((topic, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">{idx + 1}</span>
                  <input value={topic} onChange={(e) => setLectureDraft((prev) => prev.map((t, i) => (i === idx ? e.target.value : t)))} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm" placeholder={`Lecture ${idx + 1} topic`} />
                  <button type="button" onClick={() => setLectureDraft((prev) => prev.filter((_, i) => i !== idx))} className="rounded-full border border-border bg-card px-2 py-1.5 text-red-600 hover:border-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setLectureDraft((prev) => [...prev, ''])} className="mt-2 inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40"><Plus className="h-3.5 w-3.5" /> Add topic</button>
            <div className="mt-3 flex flex-wrap justify-end gap-1.5">
              <button type="button" onClick={() => setShowTemplateEditor(false)} className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground">Cancel</button>
              <button type="button" onClick={handleSaveTemplate} disabled={lectureSaving} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-60"><Save className="h-4 w-4" /> {lectureSaving ? 'Saving…' : 'Save topics'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Import applicants from Google Sheet */}
      {showImportModal ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" onClick={() => setShowImportModal(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Import applicants from Google Sheet</h3>
              <button type="button" onClick={() => setShowImportModal(false)} className="rounded-full p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-2 text-[11px] leading-5 text-muted-foreground"><span className="font-semibold text-foreground">Applicants now sync automatically</span> from the Google Form sheet configured in Recruitment → Source settings — you normally don't need to import manually. Use this only to pull from a different sheet (it becomes the new auto-sync source). The link must be shared as <span className="font-medium text-foreground">"Anyone with the link (Viewer)"</span>. Re-importing backfills existing applicants; de-duplicated by email.</p>
            <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Sheet URL</span>
              <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" />
            </label>
            {importError ? <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{importError}</div> : null}
            {importResult ? (
              <div className="mt-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                <p className="font-semibold">{importResult.message}</p>
                <p className="mt-0.5 text-green-700">Imported {importResult.imported} • Updated {importResult.updated || 0} • Duplicates skipped {importResult.duplicates} • Invalid {importResult.invalid} • Rows read {importResult.totalRows}</p>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap justify-end gap-1.5">
              <button type="button" onClick={() => setShowImportModal(false)} className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground">Close</button>
              <button type="button" onClick={handleImportSheet} disabled={importing || !importUrl.trim()} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-60"><Upload className="h-4 w-4" /> {importing ? 'Importing…' : 'Import'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Recruitment email templates editor */}
      {showEmailTemplates ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" onClick={() => setShowEmailTemplates(false)}>
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Recruitment email templates</h3>
              <button type="button" onClick={() => setShowEmailTemplates(false)} className="rounded-full p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-2 text-[11px] text-muted-foreground">Use placeholders <code className="rounded bg-muted px-1">{'{{name}}'}</code>, <code className="rounded bg-muted px-1">{'{{link}}'}</code>, and <code className="rounded bg-muted px-1">{'{{notes}}'}</code> (missing-info only).</p>
            {!emailTemplates ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading templates…</div>
            ) : (
              <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                {(emailTemplateEvents.length ? emailTemplateEvents : Object.keys(emailTemplates)).map((event) => (
                  <div key={event} className="rounded-xl border border-border bg-background p-2.5">
                    <p className="mb-1.5 text-xs font-semibold text-foreground">{EMAIL_EVENT_LABELS[event] || event}</p>
                    <input
                      value={emailTemplates[event]?.subject || ''}
                      onChange={(e) => setEmailTemplates((p) => ({ ...p, [event]: { ...p[event], subject: e.target.value } }))}
                      placeholder="Subject"
                      className="mb-1.5 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
                    />
                    <textarea
                      rows={4}
                      value={emailTemplates[event]?.body || ''}
                      onChange={(e) => setEmailTemplates((p) => ({ ...p, [event]: { ...p[event], body: e.target.value } }))}
                      placeholder="Body"
                      className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap justify-end gap-1.5">
              <button type="button" onClick={() => setShowEmailTemplates(false)} className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground">Cancel</button>
              <button type="button" onClick={handleSaveEmailTemplates} disabled={emailTemplatesSaving || !emailTemplates} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-60"><Save className="h-4 w-4" /> {emailTemplatesSaving ? 'Saving…' : 'Save templates'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Capacity rules editor */}
      {showCapacityModal ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" onClick={() => setShowCapacityModal(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Capacity decision rules</h3>
              <button type="button" onClick={() => setShowCapacityModal(false)} className="rounded-full p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            {!capacityForm ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading settings…</div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Target hours / teacher / day</span><input type="number" min="0.5" step="0.5" value={capacityForm.targetHoursPerTeacherPerDay} onChange={(e) => setCapacityForm((p) => ({ ...p, targetHoursPerTeacherPerDay: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
                <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Horizon (days)</span><input type="number" min="1" value={capacityForm.horizonDays} onChange={(e) => setCapacityForm((p) => ({ ...p, horizonDays: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
                <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Hire threshold (%)</span><input type="number" min="10" max="100" value={capacityForm.hireThresholdPct} onChange={(e) => setCapacityForm((p) => ({ ...p, hireThresholdPct: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
                <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Urgent threshold (%)</span><input type="number" min="10" max="100" value={capacityForm.urgentThresholdPct} onChange={(e) => setCapacityForm((p) => ({ ...p, urgentThresholdPct: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
                <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Min female teachers</span><input type="number" min="0" value={capacityForm.minFemaleTeachers} onChange={(e) => setCapacityForm((p) => ({ ...p, minFemaleTeachers: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
                <label className="text-sm text-foreground"><span className="mb-1 block font-medium">Min male teachers</span><input type="number" min="0" value={capacityForm.minMaleTeachers} onChange={(e) => setCapacityForm((p) => ({ ...p, minMaleTeachers: e.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2" /></label>
              </div>
            )}
            <div className="mt-3 flex flex-wrap justify-end gap-1.5">
              <button type="button" onClick={() => setShowCapacityModal(false)} className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground">Cancel</button>
              <button type="button" onClick={handleSaveCapacity} disabled={capacitySaving || !capacityForm} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-60"><Save className="h-4 w-4" /> {capacitySaving ? 'Saving…' : 'Save rules'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}