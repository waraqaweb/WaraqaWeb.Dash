/**
 * EvaluationPage — Waraqa live evaluation studio.
 *
 * Admin-only. Branded, full-screen capable slide deck used to assess a
 * new student in Qur'an, Arabic reading, Tajweed and Arabic skills.
 *
 * Highlights:
 *   • Branded gradient stage with the Waraqa logo and Arabic display type.
 *   • Welcome slide lets the admin (or student) pick which sections to test.
 *   • Letters / words drilled as randomised colourful tiles (Noor Al-Bayan
 *     style: similar shapes & sounds contrasted, e.g. noon vs taa vs baa).
 *   • Quran verse numbers rendered in Arabic-Indic digits.
 *   • Each item is per-admin customisable (add / remove / reorder) — overrides
 *     are stored locally per admin until a backend store is added.
 *   • Tokenised post-session feedback link / email (existing backend).
 *   • Sessions history drawer for revisiting past students.
 *   • Real-time admin toast when a guardian/student submits feedback.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import { showToast } from '../../utils/toast';
import {
  DEFAULT_BIO,
  READING_LETTERS, READING_WORDS,
  QURAN_PASSAGES, TAJWEED_THEORY, TAJWEED_PRACTICAL,
  WEAKNESS_AREAS, FEEDBACK_QUESTIONS,
  ARABIC_SKILLS,
} from '../../data/evaluationContent';
import { SURAHS } from '../../data/surahs';
import { subjects as CLASS_SUBJECTS } from '../../constants/reportTopicsConfig';
import '../../styles/quran-fonts.css';
import {
  ChevronRight, ChevronLeft, ChevronDown, Plus, Trash2, Copy, CheckCircle2,
  XCircle, MinusCircle, Send, Link as LinkIcon, Users,
  History, Maximize2, Minimize2, Shuffle, Pencil, Save,
  ArrowUp, ArrowDown, RefreshCw, BookOpen, Flag, Sparkles,
   PanelLeftClose, PanelLeftOpen, MessageCircle, CalendarClock, Wand2, Trophy,
  PenTool, Tag,
} from 'lucide-react';
import { getCurrentAdminMeeting, listMeetings } from '../../api/meetings';
import { TIMEZONE_LIST, DEFAULT_TIMEZONE } from '../../utils/timezoneUtils';
import { buildTeacherSummaryMessage, formatAvailability, addMinutesToTime, surahNameFor } from '../../utils/evaluationMessage';

const WhiteboardModal = React.lazy(() => import('../../components/library/WhiteboardModal'));
const TicTacToeModal = React.lazy(() => import('../../components/library/TicTacToeModal'));

const evaluationActionButtonClass = 'inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white/85 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm transition hover:bg-white hover:text-emerald-950';

/* ────────────────────────────────────────────────────────────────────────── */
/* Constants & helpers                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

const ALL_SECTIONS = [
  { key: 'intro',             title: 'Meet your evaluator',     ar: 'تعرّف على معلمك',     icon: '🤝', testable: false },
  { key: 'student',           title: 'About the student',       ar: 'بياناتك',              icon: '🧑‍🎓', testable: false },
  { key: 'reading-letters',   title: 'Reading · Letters',       ar: 'قراءة · الحروف',        icon: '🔤', testable: true },
  { key: 'reading-words',     title: 'Reading · Words',         ar: 'قراءة · الكلمات',       icon: '📖', testable: true },
  { key: 'quran-recitation',  title: 'Qur’an Recitation',       ar: 'تلاوة القرآن',          icon: '۝', testable: true },
  { key: 'quran-memorization',title: 'Qur’an Memorization',     ar: 'تحفيظ القرآن',        icon: '📜', testable: true },
  { key: 'tajweed',           title: 'Tajweed',                 ar: 'التجويد',               icon: '🎓', testable: true },
  { key: 'arabic-skills',     title: 'Arabic Skills',           ar: 'مهارات العربية',        icon: '🌐', testable: true },
  { key: 'summary',           title: 'Summary & next steps',    ar: 'الخلاصة',               testable: false },
  { key: 'links',             title: 'Important links',         ar: 'روابط مهمة',            testable: false },
];

const VERDICTS = [
  { v: 'correct',   label: 'Correct',   icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  { v: 'partial',   label: 'Partial',   icon: MinusCircle,  cls: 'bg-amber-100 text-amber-700 border-amber-300' },
  { v: 'incorrect', label: 'Incorrect', icon: XCircle,      cls: 'bg-rose-100 text-rose-700 border-rose-300' },
];

// Vibrant palette for letter / word tiles.
const TILE_GRADIENTS = [
  'linear-gradient(135deg,#10b981,#059669)',
  'linear-gradient(135deg,#0ea5e9,#1d4ed8)',
  'linear-gradient(135deg,#f59e0b,#ea580c)',
  'linear-gradient(135deg,#ec4899,#db2777)',
  'linear-gradient(135deg,#8b5cf6,#6d28d9)',
  'linear-gradient(135deg,#14b8a6,#0d9488)',
  'linear-gradient(135deg,#f43f5e,#be123c)',
  'linear-gradient(135deg,#84cc16,#4d7c0f)',
  'linear-gradient(135deg,#06b6d4,#0e7490)',
  'linear-gradient(135deg,#a16207,#854d0e)',
];

// Numbers in the evaluation studio are intentionally rendered with Latin
// (Western) digits to keep them readable for international evaluators.
// Earlier revisions converted to Arabic-Indic digits; the helper is kept as
// an identity function so call-sites don't need to change.
const toArabicDigits = (input) => String(input);

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const stripDiacritics = (s) => String(s).replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');

// Pick a writing direction for a mixed-language prompt by scanning for the
// first character with strong directional class (Latin or Arabic / Hebrew).
// Whitespace, digits, punctuation, brackets are skipped so a sentence that
// begins with quotes or numbers like "1) كَتَبَ ..." still picks the
// language of the first actual word. If the first word is English we lay
// the whole row LTR; if it's Arabic we lay it RTL.
const directionFor = (text) => {
  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charCodeAt(i);
    // Latin upper / lower → LTR
    if ((ch >= 0x41 && ch <= 0x5A) || (ch >= 0x61 && ch <= 0x7A)) return 'ltr';
    // Arabic / Arabic Supplement / Arabic Extended-A / Presentation Forms → RTL
    if (
      (ch >= 0x0590 && ch <= 0x08FF)
      || (ch >= 0xFB1D && ch <= 0xFDFF)
      || (ch >= 0xFE70 && ch <= 0xFEFF)
    ) return 'rtl';
  }
  return 'ltr';
};

const emptyStudent = (name = '') => ({
  name: name || 'Student',
  age: undefined,
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  contactNote: '',
  desiredSubjects: [],
  availability: '',
  generalNotes: '',
  difficulty: { reading: 'easy', quran: 'easy', tajweed: 'easy' },
  answers: [],
  weaknesses: [],
  strengths: [],
  recommendedLevel: '',
  adminSummary: '',
});

const normalizeStudentKey = (value = '') => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const cloneValue = (value) => {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneValue(v)]));
  }
  return value;
};

// ─── Customisable content (per-admin, localStorage) ─────────────────────────
const CUSTOM_KEY = (adminId) => `waraqa.eval.custom.${adminId || 'anon'}`;

const loadCustom = (adminId) => {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY(adminId));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};
const saveCustom = (adminId, data) => {
  try { localStorage.setItem(CUSTOM_KEY(adminId), JSON.stringify(data || {})); } catch { /* noop */ }
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Root component                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

const EvaluationPage = ({ isActive = true }) => {
  const { user, socket } = useAuth();
  const adminId = user?._id || user?.id || 'anon';
  const adminName = user?.fullName
    || `${user?.firstName || ''} ${user?.lastName || ''}`.trim()
    || 'Waraqa Team';

  // ── Session state ─────────────────────────────────────────────────────────
  const [session, setSession] = useState(null);
  const [activeStudentIdx, setActiveStudentIdx] = useState(0);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [bio, setBio] = useState(DEFAULT_BIO);
  const [quranFont, setQuranFont] = useState('uthmani');
  const [diacritics, setDiacritics] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [editorOn, setEditorOn] = useState(false);
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [ticTacToeOpen, setTicTacToeOpen] = useState(false);
  const [branding, setBranding] = useState({ title: 'Waraqa', slogan: '', logoUrl: null });
  const [customContent, setCustomContent] = useState(() => loadCustom(adminId));
  const [selectedSections, setSelectedSections] = useState([]);
  const [welcomeShown, setWelcomeShown] = useState(true);
  const [welcomeStepHint, setWelcomeStepHint] = useState('evaluator');
  const [sideMenuHidden, setSideMenuHidden] = useState(false);
  const [evalLinks, setEvalLinks] = useState([]);
  const [linksLoaded, setLinksLoaded] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [currentMeeting, setCurrentMeeting] = useState(null);
  const [meetingPrefilled, setMeetingPrefilled] = useState(false);
  const [meetingPickerOpen, setMeetingPickerOpen] = useState(false);
  const [meetingChoices, setMeetingChoices] = useState([]);
  const [meetingChoicesLoading, setMeetingChoicesLoading] = useState(false);

  const shellRef = useRef(null);
  const saveTimer = useRef(null);

  // Notify Dashboard shell to hide/show its sidebar+header for this page.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('dashboard:set-focus-mode', { detail: sideMenuHidden }));
    return () => window.dispatchEvent(new CustomEvent('dashboard:set-focus-mode', { detail: false }));
  }, [sideMenuHidden]);

  // ── Visible sections = (selected, in chosen order) + summary + links
  //    Welcome screen handles greeting + evaluator + student intro.
  const visibleSections = useMemo(() => {
    const byKey = Object.fromEntries(ALL_SECTIONS.map((s) => [s.key, s]));
    const result = [];
    selectedSections.forEach((k) => {
      const s = byKey[k];
      if (s && s.testable) result.push(s);
    });
    result.push(byKey.summary, byKey.links);
    return result.filter(Boolean);
  }, [selectedSections]);

  // ── Branding load ─────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get('/settings/branding');
        const b = data?.branding;
        if (alive && b) {
          setBranding({
            title: b?.title || 'Waraqa',
            slogan: b?.slogan || '',
            logoUrl: b?.logo?.url || b?.logo?.dataUri || null,
          });
        }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, []);

  // ── Important links + WhatsApp number (admin-editable Setting) ───────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [linksRes, waRes] = await Promise.all([
          api.get('/settings/evaluation/links').catch(() => null),
          api.get('/settings/evaluation/whatsapp').catch(() => null),
        ]);
        if (!alive) return;
        const links = Array.isArray(linksRes?.data?.links) ? linksRes.data.links : [];
        setEvalLinks(links.map((l) => ({
          label: l.label || '',
          url: l.url || '',
          description: l.description || '',
          includeInFeedback: Boolean(l.includeInFeedback),
        })));
        setWhatsappNumber(waRes?.data?.number || '');
      } finally {
        if (alive) setLinksLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  // ── Current meeting (for evaluation prefill banner) ──────────────────────
  useEffect(() => {
    if (!isActive) return undefined;
    let alive = true;
    (async () => {
      try {
        const meeting = await getCurrentAdminMeeting({ windowMinutes: 90 });
        if (alive) setCurrentMeeting(meeting || null);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [isActive]);

  // ── Load or create session ────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) return undefined;
    let cancel = false;
    (async () => {
      try {
        // Single round-trip: backend returns the full latest active session
        // doc inline when `full=true` is set, avoiding the previous
        // list→detail waterfall.
        const { data } = await api.get('/evaluations', { params: { limit: 1, status: 'active', full: 'true' } });
        if (cancel) return;
        const latest = (data?.sessions || [])[0];
        if (latest) {
          setSession({ ...latest, students: latest.students?.length ? latest.students : [emptyStudent()] });
        } else {
          setSession({
            _id: null,
            title: '',
            status: 'active',
            students: [emptyStudent()],
          });
        }
      } catch (err) {
        console.error('Failed to load evaluation session', err);
        showToast('Failed to load evaluation session');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [isActive]);

  // ── Debounced autosave ────────────────────────────────────────────────────
  const saveSessionNow = useCallback(async (snapshot, { status } = {}) => {
    if (!snapshot) return null;

    const payload = {
      title: snapshot.title || '',
      status: status || snapshot.status || 'active',
      students: snapshot.students || [],
    };

    let sessionId = snapshot._id || null;
    let createdSession = null;

    if (!sessionId) {
      const { data } = await api.post('/evaluations', { title: payload.title });
      createdSession = data?.session || null;
      sessionId = createdSession?._id || null;
    }

    if (!sessionId) return null;

    const { data } = await api.put(`/evaluations/${sessionId}`, payload);
    const savedSession = data?.session || createdSession || { ...snapshot, _id: sessionId };
    // Only propagate _id and server-generated metadata back — never overwrite
    // the user's current in-memory content with a stale server echo.
    setSession((prev) => {
      if (!prev) return { ...(savedSession || {}), _id: sessionId };
      const patch = { _id: sessionId };
      if (savedSession?.updatedAt) patch.updatedAt = savedSession.updatedAt;
      if (savedSession?.createdAt && !prev.createdAt) patch.createdAt = savedSession.createdAt;
      return { ...prev, ...patch };
    });
    return { ...savedSession, _id: sessionId };
  }, []);

  const persist = useCallback((next) => {
    if (!next) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        setSaving(true);
        await saveSessionNow(next);
      } catch (err) {
        console.error('Autosave failed', err);
      } finally {
        setSaving(false);
      }
    }, 600);
  }, [saveSessionNow]);

  const updateSession = useCallback((mutator) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = typeof mutator === 'function' ? mutator(prev) : mutator;
      persist(next);
      return next;
    });
  }, [persist]);

  const updateStudent = useCallback((mutator) => {
    updateSession((prev) => {
      const students = [...(prev.students || [])];
      if (!students[activeStudentIdx]) students[activeStudentIdx] = emptyStudent();
      const current = students[activeStudentIdx];
      students[activeStudentIdx] = typeof mutator === 'function' ? mutator(current) : { ...current, ...mutator };
      return { ...prev, students };
    });
  }, [activeStudentIdx, updateSession]);

  // Apply a patch to every student in the session (used by "apply to all" toggles).
  const updateAllStudents = useCallback((patch) => {
    updateSession((prev) => {
      const students = (prev.students || []).map((s) => ({ ...s, ...cloneValue(patch) }));
      return { ...prev, students };
    });
  }, [updateSession]);

  // ── Important links: save (admin) ─────────────────────────────────────────
  const saveEvalLinks = useCallback(async (next) => {
    setEvalLinks(next);
    try {
      await api.put('/settings/evaluation/links', { links: next });
    } catch (err) {
      console.error('Failed to save evaluation links', err);
      showToast('Failed to save important links');
    }
  }, []);

  const saveWhatsappNumber = useCallback(async (next) => {
    setWhatsappNumber(next);
    try {
      await api.put('/settings/evaluation/whatsapp', { number: next });
    } catch (err) {
      console.error('Failed to save WhatsApp number', err);
    }
  }, []);

  // ── Prefill the active student from the current meeting ──────────────────
  const prefillFromMeetingSource = useCallback((meeting, toastLabel = 'Filled from selected meeting') => {
    if (!meeting) return;
    const payload = meeting.bookingPayload || {};
    const guardianName = meeting.guardianName
      || payload.guardianName
      || meeting.attendees?.guardianName
      || '';
    const guardianEmail = meeting.guardianEmail
      || payload.guardianEmail
      || '';
    const guardianPhone = meeting.guardianPhone
      || payload.guardianPhone
      || '';
    const studentsFromMeeting = Array.isArray(meeting.students) && meeting.students.length
      ? meeting.students
      : (Array.isArray(payload.students) ? payload.students : []);
    updateSession((prev) => {
      if (!prev) return prev;
      const existingByName = new Map(
        (prev.students || [])
          .map((s) => [normalizeStudentKey(s?.name), s])
          .filter(([k]) => Boolean(k))
      );

      const baseStudents = studentsFromMeeting.length
        ? studentsFromMeeting.map((m, i) => {
            const meetingStudentName = m.studentName || m.name || `Student ${i + 1}`;
            const existing = existingByName.get(normalizeStudentKey(meetingStudentName)) || emptyStudent();
            const meetingCourses = Array.isArray(m.courses) ? m.courses.filter(Boolean) : [];
            const mergedNotes = [m.notes, payload.notes, meeting.notes].filter(Boolean).join('\n').trim();
            return {
              ...existing,
              name: meetingStudentName,
              age: m.age ?? existing.age,
              contactName: existing.contactName || guardianName || '',
              contactEmail: existing.contactEmail || guardianEmail || '',
              contactPhone: existing.contactPhone || guardianPhone || '',
              desiredSubjects: meetingCourses.length ? meetingCourses : (existing.desiredSubjects || []),
              generalNotes: mergedNotes || existing.generalNotes || '',
            };
          })
        : (prev.students || []);
      const title = prev.title || (guardianName ? `Evaluation · ${guardianName}` : prev.title);
      return { ...prev, title, students: baseStudents.length ? baseStudents : prev.students };
    });
    setMeetingPrefilled(true);
    showToast(toastLabel);
  }, [updateSession]);

  const prefillFromMeeting = useCallback(() => {
    if (!currentMeeting) return;
    prefillFromMeetingSource(currentMeeting, 'Filled from current meeting');
  }, [currentMeeting, prefillFromMeetingSource]);

  const openMeetingPicker = useCallback(async () => {
    setMeetingPickerOpen(true);
    setMeetingChoicesLoading(true);
    try {
      const now = new Date();
      const rangeStart = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000)).toISOString();
      const rangeEnd = new Date(now.getTime() + (14 * 24 * 60 * 60 * 1000)).toISOString();
      const rows = await listMeetings({
        meetingType: 'new_student_evaluation',
        rangeStart,
        rangeEnd,
        limit: 80,
      });
      const unique = [];
      const seen = new Set();
      (rows || []).forEach((m) => {
        const id = String(m?._id || '');
        if (!id || seen.has(id)) return;
        seen.add(id);
        unique.push(m);
      });
      unique.sort((a, b) => {
        const ta = new Date(a?.scheduledStart || 0).getTime();
        const tb = new Date(b?.scheduledStart || 0).getTime();
        return Math.abs(ta - now.getTime()) - Math.abs(tb - now.getTime());
      });
      setMeetingChoices(unique.slice(0, 14));
    } catch (err) {
      console.error('Failed to load meeting choices', err);
      showToast('Could not load scheduled meetings');
    } finally {
      setMeetingChoicesLoading(false);
    }
  }, []);

  const upsertAnswer = useCallback((entry) => {
    updateStudent((s) => {
      const answers = [...(s.answers || [])];
      const idx = answers.findIndex((a) => a.questionId === entry.questionId);
      const next = { askedAt: new Date().toISOString(), ...(idx >= 0 ? answers[idx] : {}), ...entry };
      if (idx >= 0) answers[idx] = next; else answers.push(next);
      return { ...s, answers };
    });
  }, [updateStudent]);

  // ── Customisable content helpers ──────────────────────────────────────────
  const setCustom = useCallback((sectionKey, payload) => {
    setCustomContent((prev) => {
      const next = { ...prev, [sectionKey]: payload };
      saveCustom(adminId, next);
      return next;
    });
  }, [adminId]);

  const resetCustom = useCallback((sectionKey) => {
    setCustomContent((prev) => {
      const next = { ...prev };
      delete next[sectionKey];
      saveCustom(adminId, next);
      return next;
    });
  }, [adminId]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const goNext = () => setSectionIdx((i) => Math.min(visibleSections.length - 1, i + 1));
  const goPrev = () => setSectionIdx((i) => Math.max(0, i - 1));

  const startEvaluation = () => {
    setWelcomeShown(false);
    setSectionIdx(0);
  };

  const openWelcomeStudentStep = useCallback(() => {
    setWelcomeStepHint('student');
    setWelcomeShown(true);
  }, []);

  const pickStudentFromHeader = useCallback((idx) => {
    setActiveStudentIdx(idx);
    setWelcomeStepHint('student');
    setWelcomeShown(true);
  }, []);

  const endTest = async () => {
    if (!session) return;
    if (!window.confirm('Finish this evaluation and open a fresh one for a new student?')) return;
    try {
      // Persist completion immediately so the finished session stays open for
      // feedback actions without forcing the user into a fresh blank draft.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await saveSessionNow(session, { status: 'completed' });
    } catch (err) {
      console.error('Failed to finalize evaluation', err);
      showToast('Could not save before finishing');
      return;
    }
    setSession((prev) => (prev ? { ...prev, status: 'completed' } : prev));
    showToast('Evaluation finished. You can send feedback now or start a new session from history.');
  };

  // ── History drawer ────────────────────────────────────────────────────────
  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const { data } = await api.get('/evaluations', { params: { limit: 50 } });
      setHistory(data?.sessions || []);
    } catch {
      showToast('Failed to load sessions');
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadSession = async (id) => {
    try {
      const { data } = await api.get(`/evaluations/${id}`);
      if (data?.session) {
        setSession({ ...data.session, students: data.session.students?.length ? data.session.students : [emptyStudent()] });
        setActiveStudentIdx(0);
        setSectionIdx(0);
        setWelcomeShown(false);
        setHistoryOpen(false);
      }
    } catch { showToast('Failed to open session'); }
  };

  const startNewSession = async () => {
    try {
      const { data } = await api.post('/evaluations', { title: '' });
      if (data?.session) {
        setSession({ ...data.session, students: [emptyStudent()] });
        setActiveStudentIdx(0);
        setSectionIdx(0);
        setWelcomeShown(true);
        setHistoryOpen(false);
      }
    } catch { showToast('Failed to start new session'); }
  };

  const deleteSession = async (id) => {
    if (!window.confirm('Delete this session permanently?')) return;
    try {
      await api.delete(`/evaluations/${id}`);
      setHistory((h) => h.filter((s) => s._id !== id));
      if (session?._id === id) await startNewSession();
    } catch { showToast('Failed to delete'); }
  };

  // ── Fullscreen ────────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(async () => {
    try {
      const el = shellRef.current;
      if (!document.fullscreenElement) {
        await el?.requestFullscreen?.();
        setFullscreen(true);
      } else {
        await document.exitFullscreen?.();
        setFullscreen(false);
      }
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ── Socket: live feedback ─────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return undefined;
    const handler = async (payload) => {
      try {
        const overall = payload?.ratings?.overall ? `${payload.ratings.overall}/5` : 'New';
        showToast(`✨ Feedback from ${payload.studentName} — ${overall}`);
        if (session?._id && payload.sessionId === session._id) {
          const { data } = await api.get(`/evaluations/${session._id}`);
          if (data?.session) setSession(data.session);
        }
      } catch { /* noop */ }
    };
    socket.on('evaluation-feedback-received', handler);
    return () => socket.off('evaluation-feedback-received', handler);
  }, [socket, session?._id]);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading || !session) {
    return (
      <div className="eval-shell min-h-[60vh] flex items-center justify-center">
        <div className="text-emerald-700 animate-pulse">Loading evaluation studio…</div>
      </div>
    );
  }

  const activeStudent = session.students?.[activeStudentIdx] || emptyStudent();
  const section = visibleSections[sectionIdx] || visibleSections[0];

  const renameStudent = (i, name) => updateSession((prev) => {
    const arr = [...(prev.students || [])];
    if (!arr[i]) return prev;
    arr[i] = { ...arr[i], name };
    return { ...prev, students: arr };
  });
  const removeStudent = (i) => updateSession((prev) => {
    const arr = (prev.students || []).filter((_, j) => j !== i);
    setActiveStudentIdx((x) => Math.max(0, Math.min(arr.length - 1, x)));
    return { ...prev, students: arr.length ? arr : [emptyStudent()] };
  });
  const addStudentInline = (name) => {
    const newName = (name || `Student ${(session.students?.length || 0) + 1}`).trim() || 'Student';
    updateSession((prev) => ({ ...prev, students: [...(prev.students || []), emptyStudent(newName)] }));
  };

  const toggleSection = (key) => setSelectedSections((curr) =>
    curr.includes(key) ? curr.filter((k) => k !== key) : [...curr, key],
  );

  /* ─── Render (v2 layout: fixed viewport, side rails, scrollable centre) ─ */

  return (
    <div ref={shellRef} className="eval-app-shell">
      <BrandedHeader
        branding={branding}
        adminName={adminName}
        saving={saving}
        sessionStatus={session.status}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        onOpenHistory={openHistory}
        editorOn={editorOn}
        onToggleEditor={() => setEditorOn((x) => !x)}
        students={session.students || []}
        activeStudentIdx={activeStudentIdx}
        onPickStudent={pickStudentFromHeader}
        onAddStudent={() => addStudentInline()}
        sideMenuHidden={sideMenuHidden}
        onToggleSideMenu={() => setSideMenuHidden((x) => !x)}
        onOpenWelcome={openWelcomeStudentStep}
        onOpenWhiteboard={() => setWhiteboardOpen(true)}
        onOpenGame={() => setTicTacToeOpen(true)}
        onOpenMeetingPicker={openMeetingPicker}
        hasMeetingContext={Boolean(currentMeeting)}
      />

      {!welcomeShown && (
        <JourneyBar
          sections={visibleSections}
          activeIdx={sectionIdx}
          onJump={setSectionIdx}
        />
      )}

      <div className="eval-body">
        {/* Centre — scrollable content */}
        <main className="eval-content">
          {welcomeShown ? (
            <>
              {currentMeeting && !meetingPrefilled && (
                <MeetingPrefillBanner
                  meeting={currentMeeting}
                  onPrefill={prefillFromMeeting}
                  onDismiss={() => setCurrentMeeting(null)}
                />
              )}
              <WelcomeSlide
                branding={branding}
                adminName={adminName}
                initialStep={welcomeStepHint}
                bio={bio}
                onBioChange={setBio}
                activeStudent={activeStudent}
                onUpdateStudent={updateStudent}
                students={session.students || []}
                activeStudentIdx={activeStudentIdx}
                onPickStudent={setActiveStudentIdx}
                onAddStudent={addStudentInline}
                onRenameStudent={renameStudent}
                onRemoveStudent={removeStudent}
                allSections={ALL_SECTIONS}
                selected={selectedSections}
                onToggle={toggleSection}
                onStart={startEvaluation}
              />
            </>
          ) : (
            <>
              <div className="eval-slide-v2 slide-anim" key={section.key}>
                <SlideHeading section={section} index={sectionIdx} total={visibleSections.length} />
                {section.key === 'intro' && (
                  <IntroSlide bio={bio} onBioChange={setBio} adminName={adminName} branding={branding} />
                )}
                {section.key === 'student' && (
                  <StudentSlide student={activeStudent} onChange={updateStudent} />
                )}
                {section.key === 'reading-letters' && (
                  <ReadingLettersSlide
                    student={activeStudent}
                    onChange={updateStudent}
                    onAnswer={upsertAnswer}
                    editorOn={editorOn}
                    custom={customContent.letters}
                    setCustom={(p) => setCustom('letters', p)}
                    resetCustom={() => resetCustom('letters')}
                  />
                )}
                {section.key === 'reading-words' && (
                  <ReadingWordsSlide
                    student={activeStudent}
                    onChange={updateStudent}
                    onAnswer={upsertAnswer}
                    diacritics={diacritics}
                    onToggleDiacritics={() => setDiacritics((d) => !d)}
                    editorOn={editorOn}
                    custom={customContent.words}
                    setCustom={(p) => setCustom('words', p)}
                    resetCustom={() => resetCustom('words')}
                  />
                )}
                {section.key === 'quran-recitation' && (
                  <QuranSlide
                    student={activeStudent}
                    onAnswer={upsertAnswer}
                    font={quranFont}
                    onChangeFont={setQuranFont}
                    editorOn={editorOn}
                    custom={customContent.quran}
                    setCustom={(p) => setCustom('quran', p)}
                    resetCustom={() => resetCustom('quran')}
                  />
                )}
                {section.key === 'quran-memorization' && (
                  <QuranMemorizationSlide
                    student={activeStudent}
                    onAnswer={upsertAnswer}
                  />
                )}
                {section.key === 'tajweed' && (
                  <TajweedSlide
                    student={activeStudent}
                    onAnswer={upsertAnswer}
                    editorOn={editorOn}
                    customTheory={customContent.tajweedTheory}
                    setCustomTheory={(p) => setCustom('tajweedTheory', p)}
                    resetCustomTheory={() => resetCustom('tajweedTheory')}
                    customPractical={customContent.tajweedPractical}
                    setCustomPractical={(p) => setCustom('tajweedPractical', p)}
                    resetCustomPractical={() => resetCustom('tajweedPractical')}
                  />
                )}
                {section.key === 'arabic-skills' && (
                  <ArabicSkillsSlide
                    student={activeStudent}
                    onAnswer={upsertAnswer}
                    editorOn={editorOn}
                    custom={customContent.arabicSkills}
                    setCustom={(p) => setCustom('arabicSkills', p)}
                    resetCustom={() => resetCustom('arabicSkills')}
                  />
                )}
                {section.key === 'summary' && (
                  <SummarySlide
                    session={session}
                    student={activeStudent}
                    students={session.students || []}
                    activeStudentIdx={activeStudentIdx}
                    onPickStudent={setActiveStudentIdx}
                    onChange={updateStudent}
                    onUpdateAllStudents={updateAllStudents}
                  />
                )}
                {section.key === 'links' && (
                  <LinksSlide
                    session={session}
                    students={session.students || []}
                    activeStudentIdx={activeStudentIdx}
                    onPickStudent={setActiveStudentIdx}
                    onUpdateStudent={updateStudent}
                    onUpdateAllStudents={updateAllStudents}
                    links={evalLinks}
                    linksLoaded={linksLoaded}
                    onSaveLinks={saveEvalLinks}
                    whatsappNumber={whatsappNumber}
                    onSaveWhatsappNumber={saveWhatsappNumber}
                    onSendFeedback={async (email, opts = {}) => {
                      try {
                        const links = Array.isArray(opts.links)
                          ? opts.links
                          : evalLinks.filter((l) => l.includeInFeedback);
                        const { data } = await api.post(
                          `/evaluations/${session._id}/students/${activeStudent._id || ''}/send-feedback`,
                          { email, links, subject: opts.subject, intro: opts.intro },
                        );
                        showToast('Feedback request sent.');
                        return data?.link || '';
                      } catch (err) {
                        const link = err?.response?.data?.link;
                        showToast(err?.response?.data?.message || 'Failed to send feedback email');
                        return link || '';
                      }
                    }}
                  />
                )}
              </div>

              <div className="eval-footer-bar">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={sectionIdx === 0}
                  className="px-3 py-2 rounded-full border border-emerald-300 bg-white/80 text-emerald-800 text-sm disabled:opacity-40 hover:bg-white inline-flex items-center gap-1 font-display-en"
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <div className="text-xs text-emerald-700/80 font-display-en">
                  <bdi>Stage {sectionIdx + 1} of {visibleSections.length}</bdi>
                </div>
                <button
                  type="button"
                  onClick={sectionIdx === visibleSections.length - 1 ? endTest : goNext}
                  className="px-4 py-2 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm shadow inline-flex items-center gap-1 font-display-en"
                >
                  {sectionIdx === visibleSections.length - 1 ? (<><Flag className="h-4 w-4" /> Finish</>) : (<>Next <ChevronRight className="h-4 w-4" /></>)}
                </button>
              </div>
            </>
          )}
        </main>

      </div>

      {historyOpen && (
        <HistoryDrawer
          history={history}
          loading={historyLoading}
          currentId={session._id}
          onClose={() => setHistoryOpen(false)}
          onOpen={loadSession}
          onNew={startNewSession}
          onDelete={deleteSession}
        />
      )}
      {whiteboardOpen && (
        <React.Suspense fallback={null}>
          <WhiteboardModal open onClose={() => setWhiteboardOpen(false)} />
        </React.Suspense>
      )}
      {ticTacToeOpen && (
        <React.Suspense fallback={null}>
          <TicTacToeModal open onClose={() => setTicTacToeOpen(false)} />
        </React.Suspense>
      )}
      {meetingPickerOpen && (
        <MeetingPickerModal
          loading={meetingChoicesLoading}
          meetings={meetingChoices}
          onClose={() => setMeetingPickerOpen(false)}
          onPick={(meeting) => {
            prefillFromMeetingSource(meeting);
            setCurrentMeeting(meeting);
            setMeetingPickerOpen(false);
          }}
        />
      )}
    </div>
  );
};

/* ─── Branded top bar (compact) ────────────────────────────────────────── */

const BrandedHeader = ({
  branding, adminName, saving, sessionStatus,
  students, activeStudentIdx, onPickStudent, onAddStudent,
  sideMenuHidden, onToggleSideMenu,
  onOpenWelcome, onToggleEditor, editorOn,
  onOpenWhiteboard, onOpenHistory, onOpenGame,
  onOpenMeetingPicker, hasMeetingContext,
  fullscreen, onToggleFullscreen,
}) => (
  <header className="eval-topbar px-4 py-2.5">
    <div className="mx-auto max-w-[1400px] flex items-center gap-3 flex-nowrap overflow-x-auto">
      <div className="flex items-center gap-3">
        {branding.logoUrl ? (
          <img src={branding.logoUrl} alt="" className="h-10 w-10 rounded-xl shadow ring-1 ring-emerald-200 bg-white object-contain floaty" />
        ) : (
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white font-bold floaty">و</div>
        )}
        <div className="leading-tight">
          <div className="font-display-en text-[10px] uppercase tracking-[0.32em] text-emerald-700 font-semibold">
            <bdi>{branding.title || 'Waraqa'} · Live Evaluation</bdi>
          </div>
          <h1 className="font-thuluth text-xl text-emerald-900" dir="rtl">استوديو التقييم</h1>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-nowrap">
        <button type="button" className={evaluationActionButtonClass} onClick={onToggleSideMenu} title={sideMenuHidden ? 'Show dashboard sidebar' : 'Hide dashboard sidebar'}>
          {sideMenuHidden ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {sideMenuHidden ? 'Show' : 'Hide'}
        </button>
        <button type="button" className={evaluationActionButtonClass} onClick={onOpenWelcome} title="Open welcome slide">
          <Sparkles className="h-4 w-4" />
          Welcome
        </button>
        <button type="button" className={evaluationActionButtonClass} onClick={onToggleEditor} title={editorOn ? 'Stop editing' : 'Customize items'}>
          <Pencil className="h-4 w-4" />
          Edit
        </button>
        <button type="button" className={evaluationActionButtonClass} onClick={onOpenWhiteboard} title="Open interactive whiteboard">
          <PenTool className="h-4 w-4" />
          Board
        </button>
        <button type="button" className={evaluationActionButtonClass} onClick={onOpenGame} title="Open Tic Tac Toe game">
          <Trophy className="h-4 w-4" />
          Game
        </button>
        <button
          type="button"
          className={evaluationActionButtonClass}
          onClick={onOpenMeetingPicker}
          title={hasMeetingContext ? 'Fill fields from a scheduled meeting (or current one)' : 'Fill fields from a scheduled meeting'}
        >
          <CalendarClock className="h-4 w-4" />
          Fill meeting
        </button>
        <button type="button" className={evaluationActionButtonClass} onClick={onOpenHistory} title="Past sessions">
          <History className="h-4 w-4" />
          History
        </button>
        <button type="button" className={evaluationActionButtonClass} onClick={onToggleFullscreen} title={fullscreen ? 'Exit full screen' : 'Full screen'}>
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          Full
        </button>
      </div>

      <div className="flex items-center gap-1.5 ms-auto flex-nowrap">
        <Users className="h-4 w-4 text-emerald-700" />
        {(students || []).map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPickStudent(i)}
            className={`px-3 py-1 rounded-full text-xs border font-display-en transition ${
              i === activeStudentIdx
                ? 'bg-emerald-600 text-white border-emerald-700 shadow'
                : 'bg-white/80 border-emerald-200 text-emerald-900 hover:bg-white'
            }`}
            title={s.name}
          >
            <bdi>{s.name || `Student ${i + 1}`}</bdi>
          </button>
        ))}
        <button
          type="button"
          onClick={onAddStudent}
          className="px-2.5 py-1 rounded-full text-xs border border-dashed border-emerald-400 text-emerald-700 hover:bg-emerald-50 inline-flex items-center gap-1 font-display-en"
        >
          <Plus className="h-3.5 w-3.5" /> Student
        </button>
        <div className="hidden lg:block text-[11px] text-emerald-700/70 ms-2 font-display-en">
          <bdi>{saving ? 'Saving…' : 'All saved'} · {sessionStatus}</bdi>
        </div>
      </div>
    </div>
  </header>
);

/* ─── Horizontal journey bar (chevron breadcrumb) ──────────────────────── */

const arabicNum = (n) => {
  const map = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  return String(n).split('').map((d) => map[+d] ?? d).join('');
};

const JourneyBar = ({ sections, activeIdx, onJump }) => (
  <nav className="eval-journey-top" aria-label="Evaluation journey">
    {sections.map((s, i) => {
      const cls = i === activeIdx ? 'is-active' : i < activeIdx ? 'is-done' : '';
      return (
        <button
          key={s.key}
          type="button"
          className={`j-step ${cls}`}
          onClick={() => onJump(i)}
          title={`${s.title} — ${s.ar}`}
        >
          <span className="j-num">{arabicNum(i + 1)}</span>
          <span className="j-en"><bdi>{s.title}</bdi></span>
          <span className="j-ar" dir="rtl">{s.ar}</span>
        </button>
      );
    })}
  </nav>
);

/* ─── Vertical journey rail (legacy, kept for back-compat) ─────────────── */

const JourneyRail = ({ sections, activeIdx, onJump, allSections, selected, onToggle }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const available = allSections.filter((s) => s.testable && !selected.includes(s.key));
  return (
    <div className="flex flex-col h-full">
      <div className="text-center mb-2">
        <div className="font-thuluth text-emerald-900 text-xl" dir="rtl">رحلتك</div>
        <div className="font-display-en text-[10px] uppercase tracking-widest text-emerald-700/80">Your journey</div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {sections.map((s, i) => {
          const active = i === activeIdx;
          const done = i < activeIdx;
          const cls = `journey-step ${active ? 'is-active' : done ? 'is-done' : ''}`;
          return (
            <React.Fragment key={s.key}>
              <button type="button" onClick={() => onJump(i)} className={cls}>
                <span className="num">{toArabicDigits(i + 1)}</span>
                <span className="min-w-0">
                  <span className="label-en truncate block"><bdi>{s.title}</bdi></span>
                  <span className="label-ar truncate block" dir="rtl">{s.ar}</span>
                </span>
                <span aria-hidden>{s.icon || ''}</span>
              </button>
              {i < sections.length - 1 && (
                <div className="journey-arrow"><ChevronDown className="h-4 w-4" /></div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {available.length > 0 && (
        <div className="border-t border-emerald-100 mt-2 pt-2">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="w-full px-3 py-2 rounded-xl border border-dashed border-emerald-400 text-emerald-700 text-xs inline-flex items-center justify-center gap-1 font-display-en hover:bg-emerald-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add subject
          </button>
          {pickerOpen && (
            <div className="mt-2 space-y-1 slide-anim">
              {available.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => { onToggle(s.key); setPickerOpen(false); }}
                  className="w-full text-start px-2 py-1.5 rounded-lg hover:bg-emerald-50 text-xs text-emerald-900 inline-flex items-center gap-2"
                >
                  <span>{s.icon}</span>
                  <bdi className="font-display-en">{s.title}</bdi>
                  <span className="ms-auto text-emerald-700/70" dir="rtl">{s.ar}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ─── Slide heading ────────────────────────────────────────────────────── */

const SlideHeading = ({ section, index, total }) => (
  <div className="slide-heading">
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <span className="slide-progress-pill">
          <bdi>Stage {index + 1} / {total}</bdi>
        </span>
        {section.icon && <span className="text-2xl">{section.icon}</span>}
      </div>
      <h2><bdi>{section.title}</bdi></h2>
      <div className="ar mt-0.5" dir="rtl">{section.ar}</div>
    </div>
  </div>
);

/* ─── Stepper (legacy · horizontal, kept for back-compat) ──────────────── */

const Stepper = ({ sections, activeIdx, onJump }) => (
  <nav className="flex flex-wrap gap-1.5">
    {sections.map((s, i) => {
      const active = i === activeIdx;
      const done = i < activeIdx;
      return (
        <button
          key={s.key}
          type="button"
          onClick={() => onJump(i)}
          className={`group inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs transition ${
            active
              ? 'bg-emerald-700 border-emerald-800 text-white shadow'
              : done
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
              : 'bg-white/70 border-emerald-200 text-emerald-900 hover:bg-white'
          }`}
        >
          <span className={`eval-step-dot ${active ? 'bg-white/20 text-white' : done ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
            {toArabicDigits(i + 1)}
          </span>
          <span className="font-medium">{s.title}</span>
          <span className="hidden md:inline opacity-70" dir="rtl">· {s.ar}</span>
        </button>
      );
    })}
  </nav>
);

/* ─── Welcome (multi-student + ordered subjects) ───────────────────────── */

const WelcomeSlide = ({
  initialStep = 'evaluator',
  branding, adminName, bio, onBioChange,
  activeStudent, onUpdateStudent,
  students, activeStudentIdx,
  onPickStudent, onAddStudent, onRenameStudent, onRemoveStudent,
  allSections, selected, onToggle, onStart,
}) => {
  const [step, setStep] = useState(initialStep); // 'evaluator' | 'student' | 'subjects'
  const [newName, setNewName] = useState('');
  const [editingBio, setEditingBio] = useState(false);

  useEffect(() => {
    if (initialStep === 'evaluator' || initialStep === 'student' || initialStep === 'subjects') {
      setStep(initialStep);
    }
  }, [initialStep]);

  const handleAdd = () => {
    const v = (newName || '').trim();
    if (!v) return;
    onAddStudent(v);
    setNewName('');
  };

  const bullets = (bio.paragraphs || []).filter(Boolean);
  // Always include role/title as a leading bullet if not already in paragraphs.
  const introBullets = [
    bio.title ? `${bio.title}${bio.subtitle ? ` · ${bio.subtitle}` : ''}` : null,
    ...bullets,
  ].filter(Boolean).slice(0, 4);

  const StepChips = (
    <div className="welcome-steps">
      <button type="button" onClick={() => setStep('evaluator')} className={`welcome-step ${step === 'evaluator' ? 'is-on' : 'is-done'}`}>
        <span className="num">1</span> <bdi>Meet evaluator</bdi>
      </button>
      <span className="welcome-step-sep" />
      <button type="button" onClick={() => setStep('student')} className={`welcome-step ${step === 'student' ? 'is-on' : step === 'subjects' ? 'is-done' : ''}`}>
        <span className="num">2</span> <bdi>About you</bdi>
      </button>
      <span className="welcome-step-sep" />
      <button type="button" onClick={() => setStep('subjects')} className={`welcome-step ${step === 'subjects' ? 'is-on' : ''}`}>
        <span className="num">3</span> <bdi>Subjects</bdi>
      </button>
    </div>
  );

  if (step === 'evaluator') {
    return (
      <div className="welcome-stage slide-anim">
        <div className="welcome-card is-tall tint-emerald">
          {StepChips}

          <div className="hero-evaluator">
            <div className="halo">
              <div className="halo-inner">
                {branding.logoUrl ? (
                  <img src={branding.logoUrl} alt="" className="h-[110px] w-[110px] object-contain" />
                ) : (
                  <div className="h-[110px] w-[110px] rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white text-4xl font-bold">و</div>
                )}
              </div>
            </div>

            <div className="font-display-en text-[11px] uppercase tracking-[0.32em] text-emerald-700 font-semibold mt-3">
              <bdi>Today's evaluator</bdi>
            </div>
            <h2>{adminName}</h2>
            <p className="greeting-ar" dir="rtl">أهلًا وسهلًا · بسم الله نبدأ</p>
            <p className="tagline">
              <bdi>A short introduction before we begin. Click <strong>Continue</strong> when you're ready.</bdi>
            </p>

            <div className="bio-bullets">
              {introBullets.map((p, i) => (
                <div key={i} className="bio-bullet">
                  <span className="dot">{toArabicDigits(i + 1)}</span>
                  <span className="text"><bdi>{p}</bdi></span>
                </div>
              ))}
              {introBullets.length === 0 && (
                <div className="bio-bullet">
                  <span className="dot">1</span>
                  <span className="text font-display-en text-emerald-700/70 italic">
                    <bdi>Click "Edit bio" below to add introduction points.</bdi>
                  </span>
                </div>
              )}
            </div>

            {editingBio && (
              <div className="grid gap-2 mt-4 w-full max-w-[700px] mx-auto">
                <input className="eval-input" placeholder="Title (e.g. CEO at Waraqa)" value={bio.title} onChange={(e) => onBioChange({ ...bio, title: e.target.value })} />
                <input className="eval-input" placeholder="Subtitle (e.g. Qur'an & Arabic expert)" value={bio.subtitle} onChange={(e) => onBioChange({ ...bio, subtitle: e.target.value })} />
                {(bio.paragraphs || []).map((p, i) => (
                  <textarea
                    key={i}
                    className="eval-input min-h-[48px]"
                    placeholder={`Bullet point ${i + 1}`}
                    value={p}
                    onChange={(e) => {
                      const next = [...bio.paragraphs];
                      next[i] = e.target.value;
                      onBioChange({ ...bio, paragraphs: next });
                    }}
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setEditingBio((v) => !v)}
              className="welcome-back mt-3"
            >
              {editingBio ? 'Done editing' : 'Edit bio (this session)'}
            </button>
          </div>

          <div className="welcome-footer">
            <span className="font-display-en text-xs text-emerald-700/70"><bdi>Step 1 of 3</bdi></span>
            <button type="button" onClick={() => setStep('student')} className="welcome-cta">
              <bdi>Continue · about the student</bdi> <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'student') {
    return (
      <div className="welcome-stage slide-anim">
        <div className="welcome-card is-tall tint-indigo">
          {StepChips}

          <div className="px-2 pt-2 pb-4 flex-1 flex flex-col justify-center">
            <div className="text-center mb-4">
              <h2 className="font-thuluth text-3xl text-slate-900" dir="rtl">عرّفنا بنفسك</h2>
              <div className="font-display-en text-sm text-indigo-700 font-semibold mt-1">
                <bdi>Tell us about the student</bdi>
              </div>
              <p className="font-display-en text-xs text-slate-500 mt-1">
                <bdi>Quick details so we can tailor the evaluation.</bdi>
              </p>
            </div>

            {students.length > 1 && (
              <div className="flex flex-wrap gap-1.5 justify-center mb-3">
                {students.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onPickStudent(i)}
                    className={`px-2.5 py-1 rounded-full text-[11px] inline-flex items-center gap-1 border font-display-en ${
                      i === activeStudentIdx ? 'bg-indigo-600 text-white border-indigo-600 shadow' : 'bg-white/70 border-indigo-200 text-indigo-800'
                    }`}
                  >
                    <span className="font-bold">{toArabicDigits(i + 1)}</span>
                    <bdi>{s.name || `Student ${i + 1}`}</bdi>
                  </button>
                ))}
              </div>
            )}

            <div className="student-form-grid">
              <div>
                <label className="eval-field-label">Name · <span dir="rtl" className="font-naskh">الاسم</span></label>
                <input className="eval-input" value={activeStudent.name || ''} onChange={(e) => onUpdateStudent({ name: e.target.value })} />
              </div>
              <div>
                <label className="eval-field-label">Age · <span dir="rtl" className="font-naskh">العمر</span></label>
                <input type="number" className="eval-input" value={activeStudent.age || ''} onChange={(e) => onUpdateStudent({ age: Number(e.target.value) || undefined })} />
              </div>
              <div className="full">
                <label className="eval-field-label">Intro note · <span dir="rtl" className="font-naskh">ملاحظة سريعة</span></label>
                <input
                  className="eval-input"
                  placeholder="Anything you want to remember about this student…"
                  value={activeStudent.contactNote || ''}
                  onChange={(e) => onUpdateStudent({ contactNote: e.target.value })}
                />
              </div>
              <div className="full">
                <label className="eval-field-label">Subjects of interest · <span dir="rtl" className="font-naskh">المواد المطلوبة</span></label>
                <SubjectChipsPicker
                  value={activeStudent.desiredSubjects || []}
                  onChange={(next) => onUpdateStudent({ desiredSubjects: next })}
                />
              </div>
              <div className="full flex items-center gap-2 mt-1">
                <input
                  className="eval-input flex-1 font-display-en"
                  placeholder="Add another student (optional)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                />
                <button type="button" onClick={handleAdd}
                  className="px-3 py-2 rounded-full bg-indigo-600 text-white text-xs inline-flex items-center gap-1 font-display-en shadow">
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
                {students.length > 1 && (
                  <button type="button" onClick={() => onRemoveStudent(activeStudentIdx)} className="text-rose-700 hover:bg-rose-50 p-2 rounded-full" title="Remove current student">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="welcome-footer">
            <button type="button" onClick={() => setStep('evaluator')} className="welcome-back inline-flex items-center gap-1">
              <ChevronLeft className="h-4 w-4" /> back to evaluator
            </button>
            <button type="button" onClick={() => setStep('subjects')} className="welcome-cta">
              <bdi>Continue · choose subjects</bdi> <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* step === 'subjects' */
  return (
    <div className="welcome-stage slide-anim">
      <div className="welcome-card is-tall tint-amber">
        {StepChips}

        <div className="flex items-baseline justify-between px-2">
          <div>
            <h3 className="font-thuluth text-emerald-900 text-3xl" dir="rtl">ماذا نختبر اليوم؟</h3>
            <p className="font-display-en text-sm text-emerald-800 mt-1 font-medium">
              <bdi>Tap subjects in the order you want to test them.</bdi>
            </p>
          </div>
          <span className="slide-progress-pill"><bdi>{selected.length} chosen</bdi></span>
        </div>

        <div className="subject-grid">
          {allSections.filter((s) => s.testable).map((s) => {
            const order = selected.indexOf(s.key);
            const on = order >= 0;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onToggle(s.key)}
                className={`subject-card ${on ? 'is-on' : ''}`}
              >
                {on && <span className="order-pill">{toArabicDigits(order + 1)}</span>}
                <div className="subj-icon" aria-hidden="true">{s.icon || '📘'}</div>
                <div className="subj-title font-display-en font-bold text-emerald-900"><bdi>{s.title}</bdi></div>
                <div className="subj-ar font-naskh text-emerald-700" dir="rtl">{s.ar}</div>
              </button>
            );
          })}
        </div>

        <div className="welcome-footer">
          <button type="button" onClick={() => setStep('student')} className="welcome-back inline-flex items-center gap-1">
            <ChevronLeft className="h-4 w-4" /> back to student
          </button>
          <button
            type="button"
            onClick={onStart}
            disabled={selected.length === 0}
            className="welcome-cta"
          >
            <bdi>Start evaluation</bdi> <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─── Intro / bio ──────────────────────────────────────────────────────── */

const IntroSlide = ({ bio, onBioChange, adminName, branding }) => {
  const [editing, setEditing] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-4">
        {branding.logoUrl
          ? <img src={branding.logoUrl} alt="" className="h-16 w-16 rounded-xl bg-white ring-1 ring-emerald-200 shadow object-contain" />
          : <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white text-xl font-bold">و</div>}
        <div>
          <h2 className="text-2xl font-semibold text-emerald-900">{adminName}</h2>
          {!editing ? (
            <p className="text-emerald-700 mt-1">{bio.title} · {bio.subtitle}</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2 mt-2">
              <input className="eval-input" value={bio.title} onChange={(e) => onBioChange({ ...bio, title: e.target.value })} />
              <input className="eval-input" value={bio.subtitle} onChange={(e) => onBioChange({ ...bio, subtitle: e.target.value })} />
            </div>
          )}
        </div>
      </div>

      <ul className="mt-6 grid sm:grid-cols-2 gap-3">
        {(bio.paragraphs || []).map((p, i) => (
          <li key={i} className="rounded-xl border border-emerald-100 bg-white/70 p-3 text-emerald-900 text-sm">
            {!editing ? (
              <span>{p}</span>
            ) : (
              <textarea
                className="eval-input min-h-[80px]"
                value={p}
                onChange={(e) => {
                  const next = [...bio.paragraphs];
                  next[i] = e.target.value;
                  onBioChange({ ...bio, paragraphs: next });
                }}
              />
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setEditing((v) => !v)}
        className="mt-4 text-xs text-emerald-700 underline"
      >
        {editing ? 'Done' : 'Edit bio (this session)'}
      </button>
    </div>
  );
};

/* ─── About the student ────────────────────────────────────────────────── */

const StudentSlide = ({ student, onChange }) => (
  <div>
    <h3 className="text-lg font-semibold text-emerald-900 mb-3">About the student</h3>
    <div className="grid sm:grid-cols-2 gap-3">
      <Field label="Name"><input className="eval-input" value={student.name || ''} onChange={(e) => onChange({ name: e.target.value })} /></Field>
      <Field label="Age"><input type="number" className="eval-input" value={student.age || ''} onChange={(e) => onChange({ age: Number(e.target.value) || undefined })} /></Field>
      <Field label="Guardian name" full>
        <input
          className="eval-input"
          placeholder="Parent / guardian full name (shown in the feedback hub)"
          value={student.contactName || ''}
          onChange={(e) => onChange({ contactName: e.target.value })}
        />
      </Field>
      <Field label="Intro note" full>
        <input
          className="eval-input"
          placeholder="Anything you want to remember about this student…"
          value={student.contactNote || ''}
          onChange={(e) => onChange({ contactNote: e.target.value })}
        />
      </Field>
      <Field label="Subjects of interest" full>
        <SubjectChipsPicker
          value={student.desiredSubjects || []}
          onChange={(next) => onChange({ desiredSubjects: next })}
        />
      </Field>
    </div>
    <p className="mt-3 text-[11px] text-emerald-700/80">
      Availability, general notes, contact email and phone will be collected on the closing
      <span className="font-semibold"> Important links</span> tab.
    </p>
  </div>
);

const SubjectChipsPicker = ({ value, onChange }) => {
  const selected = Array.isArray(value) ? value : [];
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);
  const toggle = (s) => {
    if (selected.includes(s)) onChange(selected.filter((x) => x !== s));
    else onChange([...selected, s]);
  };
  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-[38px] flex items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-white/70 px-3 py-1.5 text-left hover:bg-indigo-50"
      >
        <span className="flex flex-wrap gap-1.5 min-w-0">
          {selected.length === 0 ? (
            <span className="text-[11px] text-indigo-400">Select subjects…</span>
          ) : (
            selected.map((s) => (
              <span key={s} className="px-2 py-0.5 rounded-full text-[11px] bg-indigo-600 text-white inline-flex items-center gap-1">
                <bdi>{s}</bdi>
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => { e.stopPropagation(); toggle(s); }}
                  className="opacity-80 hover:opacity-100"
                  aria-label={`Remove ${s}`}
                >×</span>
              </span>
            ))
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-indigo-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-60 overflow-auto rounded-xl border border-indigo-200 bg-white shadow-lg p-1.5">
          {CLASS_SUBJECTS.map((s) => {
            const on = selected.includes(s);
            return (
              <label
                key={s}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] cursor-pointer ${on ? 'bg-indigo-50 text-indigo-900' : 'text-indigo-800 hover:bg-indigo-50/60'}`}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(s)} className="accent-indigo-600" />
                <bdi>{s}</bdi>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Field = ({ label, children, full }) => (
  <div className={full ? 'sm:col-span-2' : ''}>
    <label className="block text-xs font-semibold text-emerald-800 mb-1">{label}</label>
    {children}
  </div>
);

const DifficultyPicker = ({ value, onChange }) => (
  <div className="inline-flex rounded-full border border-emerald-200 bg-white/60 overflow-hidden">
    {['easy', 'medium', 'advanced'].map((d) => (
      <button
        key={d}
        type="button"
        onClick={() => onChange(d)}
        className={`px-3 py-1 text-xs font-medium ${value === d ? 'bg-emerald-600 text-white' : 'text-emerald-800 hover:bg-emerald-50'}`}
      >{d}</button>
    ))}
  </div>
);

const VerdictRow = ({ answer, onChange }) => (
  <div className="inline-flex gap-1">
    {VERDICTS.map((v) => {
      const Icon = v.icon;
      const active = answer?.expertVerdict === v.v;
      return (
        <button key={v.v} type="button" onClick={() => onChange(v.v)} title={v.label}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] border ${active ? v.cls : 'bg-white/60 border-emerald-200 text-emerald-700'}`}>
          <Icon className="h-3 w-3" /> {v.label}
        </button>
      );
    })}
  </div>
);

/* ─── Per-tile testing helpers (Reading · Letters / Words / Sentences) ──── */

const tileVerdictClass = (v) => (
  v === 'correct'   ? 'letter-tile-correct'   :
  v === 'partial'   ? 'letter-tile-partial'   :
  v === 'incorrect' ? 'letter-tile-incorrect' :
  ''
);

/**
 * Hook for tile-level testing inside Reading · Letters / Words slides.
 *
 * UX:
 *   • Tap a tile → a focus overlay opens with the letter/word enlarged
 *     and the three verdict buttons (Correct / Partial / Incorrect).
 *   • Pick a verdict → the tile is graded and the overlay closes.
 *   • Tapping an already-graded tile re-opens the overlay so the admin can
 *     change or clear the verdict.
 *   • No “skipped” — untouched tiles simply have no verdict.
 */
const useTileTesting = ({ items, qid, section, level, groupTitle, onAnswer, answers }) => {
  const [activeTile, setActiveTile] = useState(null);

  const itemQid = (idx) => `${qid}.t${idx}`;
  const verdictOf = (idx) => {
    const a = answers.find((x) => x.questionId === itemQid(idx));
    const v = a?.expertVerdict;
    return v && v !== 'na' ? v : null;
  };

  const openTile = (idx) => setActiveTile(idx);
  const closeTile = () => setActiveTile(null);

  const setVerdict = (idx, verdict) => {
    onAnswer({
      questionId: itemQid(idx),
      section,
      level,
      prompt: `${groupTitle} · ${items[idx]}`,
      expertVerdict: verdict || 'na',
    });
    closeTile();
  };

  const counts = useMemo(() => {
    const c = { correct: 0, partial: 0, incorrect: 0, graded: 0, total: items.length };
    items.forEach((_, idx) => {
      const v = verdictOf(idx);
      if (v) {
        c.graded += 1;
        c[v] = (c[v] || 0) + 1;
      }
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, answers]);

  return { activeTile, openTile, closeTile, setVerdict, verdictOf, counts };
};

/* Floating overlay shown when a tile is tapped. The tile content is enlarged
   for students using a phone, and the three verdict buttons are presented. */
const TileFocusOverlay = ({ text, verdict, onPick, onClose, dir }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // Lock background scroll while the focus overlay is open so the enlarged
    // tile always sits in the centre of the current viewport.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);
  // Portal to <body> so `position: fixed` is relative to the true viewport and
  // never trapped inside a transformed/scrolled studio ancestor.
  return ReactDOM.createPortal(
    <div className="tile-focus-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="tile-focus-card" onClick={(e) => e.stopPropagation()} dir={dir}>
        <div className="tile-focus-text">{text}</div>
        <div className="tile-focus-actions">
          {VERDICTS.map((v) => {
            const Icon = v.icon;
            const on = verdict === v.v;
            return (
              <button
                key={v.v}
                type="button"
                onClick={() => onPick(v.v)}
                className={`tile-focus-btn tile-focus-${v.v} ${on ? 'is-on' : ''}`}
              >
                <Icon className="h-5 w-5" /> {v.label}
              </button>
            );
          })}
          {verdict && (
            <button type="button" onClick={() => onPick(null)} className="tile-focus-clear">
              Clear
            </button>
          )}
        </div>
        <button type="button" onClick={onClose} className="tile-focus-close" aria-label="Close">
          ✕
        </button>
      </div>
    </div>,
    document.body,
  );
};

/* ─── Reading · Letters ────────────────────────────────────────────────── */

const ReadingLettersSlide = ({ student, onChange, onAnswer, editorOn, custom, setCustom, resetCustom }) => {
  const level = student.difficulty?.reading || 'easy';
  const catalog = READING_LETTERS[level] || { groups: [] };
  // Memoise groups so their identity is stable across re-renders (an answer click
  // shouldn't visually re-shuffle the tiles).
  const groups = useMemo(() => {
    if (custom && custom[level]) return custom[level];
    return (catalog.groups || []).map((g) => ({ id: g.id, title: g.title, note: g.note, items: g.letters || g.items || [] }));
  }, [custom, level, catalog]);
  const [shuffleSeed, setShuffleSeed] = useState(0);
  // Shuffle once per (student, level, seed) — never on every parent re-render.
  const shuffledByGroup = useMemo(
    () => groups.map((g) => shuffle(g.items || [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shuffleSeed, level, student._id, groups],
  );

  const updateGroups = (next) => {
    const merged = { ...(custom || {}), [level]: next };
    setCustom(merged);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="text-xl font-bold text-emerald-900">Reading · Letters</h3>
          <p className="text-base text-emerald-800" dir="rtl">{catalog.description || 'حروف منثورة على لوحة ملوّنة — لكل حرف بطاقته الخاصة.'}</p>
        </div>
        <div className="flex items-center gap-2">
          <DifficultyPicker value={level} onChange={(d) => onChange({ difficulty: { ...student.difficulty, reading: d } })} />
          <button type="button" onClick={() => setShuffleSeed((x) => x + 1)} className="px-2 py-1 rounded-full border border-emerald-200 bg-white/70 text-xs text-emerald-800 inline-flex items-center gap-1">
            <Shuffle className="h-3 w-3" /> Shuffle
          </button>
          {editorOn && (
            <button type="button" onClick={() => { if (window.confirm('Reset letters for this level to defaults?')) resetCustom(); }} className="px-2 py-1 rounded-full border border-amber-300 bg-amber-50 text-xs text-amber-800 inline-flex items-center gap-1">
              <RefreshCw className="h-3 w-3" /> Reset
            </button>
          )}
        </div>
      </div>

      <div className="space-y-5">
        {groups.map((g, gi) => {
          const items = shuffledByGroup[gi] || g.items || [];
          const qid = `letters.${level}.${g.id || gi}`;
          const dir = directionFor(g.title);
          return (
            <LettersGroupCard
              key={g.id || gi}
              group={g}
              items={items}
              qid={qid}
              level={level}
              section="reading-letters"
              dir={dir}
              gi={gi}
              answers={student.answers || []}
              onAnswer={onAnswer}
              editorOn={editorOn}
              onSave={(next) => { const arr = [...groups]; arr[gi] = next; updateGroups(arr); }}
              onDelete={() => { const arr = groups.filter((_, i) => i !== gi); updateGroups(arr); }}
              onMove={(dir2) => {
                const arr = [...groups]; const j = gi + dir2;
                if (j < 0 || j >= arr.length) return;
                [arr[gi], arr[j]] = [arr[j], arr[gi]]; updateGroups(arr);
              }}
              total={groups.length}
            />
          );
        })}

        {editorOn && (
          <button
            type="button"
            onClick={() => updateGroups([...groups, { id: `custom-${Date.now()}`, title: 'New group', items: [] }])}
            className="px-3 py-2 rounded-full border border-dashed border-emerald-400 text-emerald-700 text-sm inline-flex items-center gap-1"
          ><Plus className="h-4 w-4" /> Add group</button>
        )}
      </div>
    </div>
  );
};

const LettersGroupCard = ({ group: g, items, qid, level, section, dir, gi, answers, onAnswer, editorOn, onSave, onDelete, onMove, total }) => {
  const tiles = useTileTesting({ items, qid, section, level, groupTitle: g.title, answers, onAnswer });
  const allGraded = tiles.counts.total > 0 && tiles.counts.graded === tiles.counts.total;
  return (
    <div
      dir={dir}
      className={`tile-group-card ${allGraded ? 'is-done' : ''}`}
    >
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-base font-bold text-emerald-900 truncate">{g.title}</div>
          {g.note && <div className="text-sm text-emerald-700">{g.note}</div>}
          <div className="text-[11px] text-emerald-700/80 mt-1">
            {tiles.counts.graded}/{tiles.counts.total} graded
            {tiles.counts.incorrect > 0 && (
              <span className="ml-2 text-rose-700 font-semibold">· {tiles.counts.incorrect} incorrect</span>
            )}
            {tiles.counts.partial > 0 && (
              <span className="ml-2 text-amber-700 font-semibold">· {tiles.counts.partial} partial</span>
            )}
          </div>
        </div>
      </div>

      <div className="letter-row">
        {items.map((ch, idx) => {
          const v = tiles.verdictOf(idx);
          const cls = ['letter-tile', v ? tileVerdictClass(v) : ''].filter(Boolean).join(' ');
          return (
            <button
              key={`${ch}-${idx}`}
              type="button"
              onClick={() => tiles.openTile(idx)}
              className={cls}
              style={{ background: TILE_GRADIENTS[(gi * 7 + idx) % TILE_GRADIENTS.length] }}
              title={`${ch}${v ? ` · ${v}` : ''}`}
            >
              {ch}
            </button>
          );
        })}
      </div>

      {tiles.activeTile !== null && (
        <TileFocusOverlay
          text={items[tiles.activeTile]}
          verdict={tiles.verdictOf(tiles.activeTile)}
          onPick={(v) => tiles.setVerdict(tiles.activeTile, v)}
          onClose={tiles.closeTile}
          dir={dir}
        />
      )}

      {editorOn && (
        <GroupEditor
          group={g}
          index={gi}
          total={total}
          onSave={onSave}
          onDelete={onDelete}
          onMove={onMove}
        />
      )}
    </div>
  );
};

/* ─── Custom question helpers (Quran / Tajweed / Arabic Skills) ────────── */

/**
 * Shape of a `custom` payload used by every question slide (other than the
 * Reading · Letters / Words slides which keep their own group-shaped editor):
 *
 *   {
 *     added:   [ ...customItemsWithSchemaShape... ],   // appended after defaults
 *     deleted: [ ...idsOfDefaultsToHide... ],
 *   }
 */
const customAdded   = (c) => (c && Array.isArray(c.added))   ? c.added   : [];
const customDeleted = (c) => (c && Array.isArray(c.deleted)) ? c.deleted : [];

const mergeWithCustom = (defaults, custom) => {
  const del = new Set(customDeleted(custom));
  return [
    ...defaults.filter((d) => !del.has(d.id)),
    ...customAdded(custom),
  ];
};

const addCustomItem = (custom, item) => ({
  ...(custom || {}),
  added: [...customAdded(custom), item],
});
const updateCustomItem = (custom, id, patch) => ({
  ...(custom || {}),
  added: customAdded(custom).map((it) => (it.id === id ? { ...it, ...patch } : it)),
});
const removeCustomItem = (custom, id, isDefault) => {
  if (isDefault) {
    return { ...(custom || {}), deleted: [...customDeleted(custom), id] };
  }
  return { ...(custom || {}), added: customAdded(custom).filter((it) => it.id !== id) };
};

const newCustomId = (prefix) => `${prefix}-c-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

/**
 * Small inline editor used by the four "Add custom question" forms in
 * QuranSlide, TajweedTheorySlide, TajweedPracticalSlide and ArabicSkillsSlide.
 * It exposes a compact "+" floating panel matching the studio's amber editor
 * theme so the admin can author their own items per slide.
 */
const CustomItemEditor = ({ item, onChange, onDelete, schema }) => {
  // schema: 'mcq' | 'expect' | 'prompt' | 'passage' | 'quran'
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-amber-800 font-semibold">Custom · {schema}</span>
        <button type="button" onClick={onDelete} className="text-rose-700 inline-flex items-center gap-1 text-xs">
          <Trash2 className="h-3 w-3" /> Delete
        </button>
      </div>
      {schema === 'quran' ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <input className="eval-input text-sm" placeholder="Surah (e.g. Al-Fatihah)" value={item.surah || ''} onChange={(e) => onChange({ surah: e.target.value })} />
            <input className="eval-input text-sm" placeholder="Range (e.g. 1–7)" value={item.range || ''} onChange={(e) => onChange({ range: e.target.value })} />
          </div>
          <textarea className="eval-input text-sm min-h-[60px] font-quran-uthmani text-lg" dir="rtl" placeholder="Verse text…" value={item.text || ''} onChange={(e) => onChange({ text: e.target.value, verses: [{ text: e.target.value }] })} />
        </>
      ) : (
        <textarea className="eval-input text-sm min-h-[50px]" dir="auto" placeholder={schema === 'passage' ? 'Passage text…' : 'Question / prompt…'} value={(schema === 'passage' ? item.passage : item.prompt) || ''} onChange={(e) => onChange(schema === 'passage' ? { passage: e.target.value } : { prompt: e.target.value })} />
      )}
      {schema === 'mcq' && (
        <div className="space-y-1">
          {(item.options || ['', '', '', '']).map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name={`correct-${item.id}`} checked={Number(item.correctIndex) === i} onChange={() => onChange({ correctIndex: i })} />
              <input className="eval-input text-sm flex-1" dir="auto" placeholder={`Option ${i + 1}`} value={opt} onChange={(e) => {
                const opts = [...(item.options || ['', '', '', ''])];
                opts[i] = e.target.value;
                onChange({ options: opts });
              }} />
            </div>
          ))}
        </div>
      )}
      {schema === 'expect' && (
        <input className="eval-input text-sm" dir="auto" placeholder="Expected answer (for evaluator reference)" value={item.expected || item.expects || ''} onChange={(e) => onChange({ expected: e.target.value, expects: e.target.value })} />
      )}
      {schema === 'passage' && (
        <textarea className="eval-input text-sm min-h-[44px]" dir="auto" placeholder="One question per line" value={(item.questions || []).join('\n')} onChange={(e) => onChange({ questions: e.target.value.split('\n').filter(Boolean) })} />
      )}
    </div>
  );
};

/**
 * Toolbar shown at the top of the editable lists in non-Reading slides
 * when the admin toggles "Edit questions" on the rail. Lets them add a
 * new custom item matching the slide's schema and reset overrides.
 */
const CustomToolbar = ({ label, onAdd, onReset, canReset }) => (
  <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/40 p-2 mb-3 flex items-center justify-between">
    <span className="text-xs text-amber-800 font-semibold">{label}</span>
    <div className="flex items-center gap-2">
      <button type="button" onClick={onAdd} className="px-2.5 py-1 rounded-full bg-amber-600 text-white text-xs inline-flex items-center gap-1">
        <Plus className="h-3 w-3" /> Add custom
      </button>
      {canReset && (
        <button type="button" onClick={onReset} className="px-2.5 py-1 rounded-full border border-amber-400 bg-white/80 text-amber-800 text-xs inline-flex items-center gap-1">
          <RefreshCw className="h-3 w-3" /> Reset
        </button>
      )}
    </div>
  </div>
);

const DeleteDefaultBtn = ({ onClick }) => (
  <button type="button" onClick={onClick} title="Remove this question" className="text-rose-700/80 hover:text-rose-700 px-1.5 py-0.5 rounded text-[10px] inline-flex items-center gap-1">
    <Trash2 className="h-3 w-3" /> Remove
  </button>
);

const GroupEditor = ({ group, index, total, onSave, onDelete, onMove }) => {
  const [title, setTitle] = useState(group.title || '');
  const [items, setItems] = useState((group.items || []).join(' '));
  return (
    <div className="mt-3 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-amber-800">Editing group {index + 1} / {total}</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onMove(-1)} className="p-1 text-amber-800 hover:bg-amber-100 rounded"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" onClick={() => onMove(1)} className="p-1 text-amber-800 hover:bg-amber-100 rounded"><ArrowDown className="h-4 w-4" /></button>
          <button type="button" onClick={onDelete} className="p-1 text-rose-700 hover:bg-rose-100 rounded"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      <input className="eval-input mb-2" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Group title" />
      <textarea
        className="eval-input min-h-[60px] font-arabic-display text-lg"
        dir="rtl"
        value={items}
        onChange={(e) => setItems(e.target.value)}
        placeholder="Space-separated items (letters or words)"
      />
      <div className="mt-2 flex justify-end">
        <button type="button"
          onClick={() => onSave({ ...group, title, items: items.split(/\s+/).filter(Boolean) })}
          className="px-3 py-1.5 rounded-full bg-amber-600 text-white text-xs inline-flex items-center gap-1"
        ><Save className="h-3 w-3" /> Save group</button>
      </div>
    </div>
  );
};

/* ─── Reading · Words & Sentences ──────────────────────────────────────── */

const ReadingWordsSlide = ({ student, onChange, onAnswer, diacritics, onToggleDiacritics, editorOn, custom, setCustom, resetCustom }) => {
  const level = student.difficulty?.reading || 'easy';
  const fromCatalog = READING_WORDS.filter((w) => w.level === level);
  // Keep lesson order stable — Noor Al-Bayan is a progressive curriculum, so the
  // sequence of groups should follow the catalog's authored order, never shuffled.
  const items = useMemo(
    () => (custom && custom[level]) || fromCatalog,
    [custom, level, fromCatalog],
  );
  const ordered = items;

  const updateItems = (next) => setCustom({ ...(custom || {}), [level]: next });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-xl font-bold text-emerald-900">Reading · Words & Sentences</h3>
          <p className="text-base text-emerald-800">Noor Al-Bayan progression — diacritics, tanween, sukūn, shadda, sentences.</p>
        </div>
        <div className="flex items-center gap-2">
          <DifficultyPicker value={level} onChange={(d) => onChange({ difficulty: { ...student.difficulty, reading: d } })} />
          <button type="button" onClick={onToggleDiacritics} className={`px-2 py-1 rounded-full text-xs border ${diacritics ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white/70 text-emerald-800 border-emerald-200'}`}>
            ◌َ Diacritics
          </button>
          {editorOn && (
            <button type="button" onClick={() => { if (window.confirm('Reset words for this level?')) resetCustom(); }} className="px-2 py-1 rounded-full border border-amber-300 bg-amber-50 text-xs text-amber-800 inline-flex items-center gap-1">
              <RefreshCw className="h-3 w-3" /> Reset
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {ordered.map((g, gi) => {
          const qid = `words.${level}.${g.id || gi}`;
          const dir = directionFor(g.title);
          return (
            <WordsGroupCard
              key={g.id || gi}
              group={g}
              qid={qid}
              level={level}
              dir={dir}
              gi={gi}
              diacritics={diacritics}
              answers={student.answers || []}
              onAnswer={onAnswer}
              editorOn={editorOn}
              total={ordered.length}
              onSave={(next) => {
                const arr = [...items];
                const realIdx = arr.findIndex((x) => x.id === g.id);
                if (realIdx >= 0) arr[realIdx] = next;
                updateItems(arr);
              }}
              onDelete={() => updateItems(items.filter((x) => x.id !== g.id))}
              onMove={(dir2) => {
                const arr = [...items];
                const i = arr.findIndex((x) => x.id === g.id);
                const j = i + dir2;
                if (i < 0 || j < 0 || j >= arr.length) return;
                [arr[i], arr[j]] = [arr[j], arr[i]]; updateItems(arr);
              }}
            />
          );
        })}

        {editorOn && (
          <button
            type="button"
            onClick={() => updateItems([...items, { id: `w-${Date.now()}`, level, title: 'New group', items: [] }])}
            className="px-3 py-2 rounded-full border border-dashed border-emerald-400 text-emerald-700 text-sm inline-flex items-center gap-1"
          ><Plus className="h-4 w-4" /> Add group</button>
        )}
      </div>
    </div>
  );
};

const WordsGroupCard = ({ group: g, qid, level, dir, gi, diacritics, answers, onAnswer, editorOn, total, onSave, onDelete, onMove }) => {
  const rawItems = g.items || [];
  const tiles = useTileTesting({ items: rawItems, qid, section: 'reading-words', level, groupTitle: g.title, answers, onAnswer });
  const allGraded = tiles.counts.total > 0 && tiles.counts.graded === tiles.counts.total;
  return (
    <div
      dir={dir}
      className={`tile-group-card ${allGraded ? 'is-done' : ''}`}
    >
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-base font-bold text-emerald-900 truncate">{g.title}</div>
          {g.note && <div className="text-sm text-emerald-700">{g.note}</div>}
          <div className="text-[11px] text-emerald-700/80 mt-1">
            {tiles.counts.graded}/{tiles.counts.total} graded
            {tiles.counts.incorrect > 0 && (
              <span className="ml-2 text-rose-700 font-semibold">· {tiles.counts.incorrect} incorrect</span>
            )}
            {tiles.counts.partial > 0 && (
              <span className="ml-2 text-amber-700 font-semibold">· {tiles.counts.partial} partial</span>
            )}
          </div>
        </div>
      </div>
      <div className="letter-row row-word">
        {rawItems.map((w, idx) => {
          const text = diacritics ? w : stripDiacritics(w);
          const v = tiles.verdictOf(idx);
          const cls = ['letter-tile word', v ? tileVerdictClass(v) : ''].filter(Boolean).join(' ');
          return (
            <button
              key={`${w}-${idx}`}
              type="button"
              onClick={() => tiles.openTile(idx)}
              className={cls}
              style={{ background: TILE_GRADIENTS[(gi * 5 + idx) % TILE_GRADIENTS.length] }}
              title={`${text}${v ? ` · ${v}` : ''}`}
            >{text}</button>
          );
        })}
      </div>

      {tiles.activeTile !== null && (
        <TileFocusOverlay
          text={diacritics ? rawItems[tiles.activeTile] : stripDiacritics(rawItems[tiles.activeTile])}
          verdict={tiles.verdictOf(tiles.activeTile)}
          onPick={(v) => tiles.setVerdict(tiles.activeTile, v)}
          onClose={tiles.closeTile}
          dir={dir}
        />
      )}

      {editorOn && (
        <GroupEditor
          group={g}
          index={gi}
          total={total}
          onSave={onSave}
          onDelete={onDelete}
          onMove={onMove}
        />
      )}
    </div>
  );
};

/* ─── Qur'an recitation ───────────────────────────────────────────────── */

// Helper: read the per-passage word-mistake map from an answer note.
// Shape: { mistakes: { [verseIdx]: { [wordIdx]: 'obvious'|'advanced' } } }
const parseQuranNote = (note) => {
  if (!note) return { mistakes: {}, comment: '' };
  try {
    const parsed = JSON.parse(note);
    if (parsed && typeof parsed === 'object') {
      return {
        mistakes: parsed.mistakes && typeof parsed.mistakes === 'object' ? parsed.mistakes : {},
        comment: typeof parsed.comment === 'string' ? parsed.comment : '',
      };
    }
  } catch {
    // Legacy notes were free-form text; surface as comment.
    return { mistakes: {}, comment: String(note) };
  }
  return { mistakes: {}, comment: '' };
};

const stringifyQuranNote = (data) => JSON.stringify({
  mistakes: data.mistakes || {},
  comment: data.comment || '',
  surah: data.surah || '',
  range: data.range || '',
  marks: data.marks || [],
});

const QuranSlide = ({ student, onAnswer, font, onChangeFont, editorOn, custom, setCustom, resetCustom }) => {
  const passages = mergeWithCustom(QURAN_PASSAGES, custom);
  const defaultIds = new Set(QURAN_PASSAGES.map((p) => p.id));
  const cycleSeverity = (curr) => {
    if (!curr) return 'obvious';
    if (curr === 'obvious') return 'advanced';
    return null;
  };
  return (
  <div>
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div>
        <h3 className="text-lg font-semibold text-emerald-900 inline-flex items-center gap-2"><BookOpen className="h-5 w-5" /> Qur’an Recitation</h3>
        <p className="text-sm text-emerald-700/80" dir="rtl">اضغط على أي كلمة لتسجيل خطأ — لون أحمر للخطأ الواضح ولون كهرماني للخطأ المتقدّم.</p>
      </div>
      <div className="inline-flex rounded-full border border-emerald-200 overflow-hidden bg-white/70">
        <button type="button" onClick={() => onChangeFont('uthmani')} className={`px-3 py-1 text-xs ${font === 'uthmani' ? 'bg-emerald-700 text-white' : 'text-emerald-800'}`}>Uthmani · Madinah</button>
        <button type="button" onClick={() => onChangeFont('indopak')} className={`px-3 py-1 text-xs ${font === 'indopak' ? 'bg-emerald-700 text-white' : 'text-emerald-800'}`}>IndoPak / Urdu</button>
      </div>
    </div>

    <div className="mb-3 inline-flex items-center gap-3 text-[11px] text-emerald-800/80">
      <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-rose-500" /> Obvious mistake</span>
      <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-amber-400" /> Advanced mistake</span>
      <span className="text-emerald-700/70">· Tap a word to cycle: none → obvious → advanced → none.</span>
    </div>

    {editorOn && (
      <CustomToolbar
        label="Custom passages for this slide"
        onAdd={() => setCustom(addCustomItem(custom, { id: newCustomId('q'), surah: 'New passage', range: '1–1', verses: [{ text: '﷽' }] }))}
        onReset={resetCustom}
        canReset={Boolean(custom)}
      />
    )}

    <div className="space-y-4">
      {passages.map((p) => {
        const qid = `quran.${p.id}`;
        const answer = (student.answers || []).find((a) => a.questionId === qid);
        const parsed = parseQuranNote(answer?.note);
        const mistakes = parsed.mistakes;
        const totalMistakes = Object.values(mistakes).reduce((sum, row) => sum + Object.keys(row || {}).length, 0);
        const obviousCount = Object.values(mistakes).reduce((sum, row) => sum + Object.values(row || {}).filter((v) => v === 'obvious').length, 0);
        const advancedCount = totalMistakes - obviousCount;
        const isDefault = defaultIds.has(p.id);

        const writeNext = (nextMistakes, nextComment = parsed.comment) => {
          // Capture the actual mistaken word text so the Summary can list the
          // words per surah (instead of opaque verse/word indices).
          const marks = [];
          Object.entries(nextMistakes).forEach(([vIdx, row]) => {
            const verse = (p.verses || [])[Number(vIdx)];
            const verseText = typeof verse === 'string' ? verse : verse?.text;
            const words = String(verseText || '').split(/\s+/).filter(Boolean);
            Object.entries(row || {}).forEach(([wIdx, sev]) => {
              marks.push({
                verse: Number(vIdx) + 1,
                word: Number(wIdx) + 1,
                text: words[Number(wIdx)] || '',
                sev,
              });
            });
          });
          const next = { mistakes: nextMistakes, comment: nextComment, surah: p.surah, range: p.range, marks };
          const totals = Object.values(nextMistakes).reduce((acc, row) => {
            Object.values(row || {}).forEach((sev) => { acc[sev] = (acc[sev] || 0) + 1; });
            return acc;
          }, { obvious: 0, advanced: 0 });
          const verdict = totals.advanced > 0 ? 'incorrect' : totals.obvious > 0 ? 'partial' : 'correct';
          onAnswer({
            questionId: qid, section: 'quran-recitation', level: 'na',
            prompt: `${p.surah} ${p.range}`,
            expertVerdict: verdict,
            note: stringifyQuranNote(next),
          });
        };

        const toggleWord = (verseIdx, wordIdx) => {
          const row = { ...(mistakes[verseIdx] || {}) };
          const next = cycleSeverity(row[wordIdx]);
          if (next) row[wordIdx] = next;
          else delete row[wordIdx];
          const nextMistakes = { ...mistakes };
          if (Object.keys(row).length === 0) delete nextMistakes[verseIdx];
          else nextMistakes[verseIdx] = row;
          writeNext(nextMistakes);
        };

        const clearAll = () => writeNext({});

        return (
          <div key={p.id} className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/60 to-white p-4">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div className="text-sm font-semibold text-emerald-900">{p.surah} <span className="text-emerald-700/70">· {p.range}</span></div>
              <div className="flex items-center gap-2 flex-wrap">
                {totalMistakes > 0 && (
                  <span className="text-[11px] inline-flex items-center gap-2 rounded-full bg-white border border-emerald-200 px-2 py-0.5 text-emerald-800">
                    <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-rose-500" /> {obviousCount}</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-amber-400" /> {advancedCount}</span>
                  </span>
                )}
                {totalMistakes > 0 && (
                  <button type="button" onClick={clearAll} className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50">Clear marks</button>
                )}
                {editorOn && <DeleteDefaultBtn onClick={() => setCustom(removeCustomItem(custom, p.id, isDefault))} />}
              </div>
            </div>
            <div
              dir="rtl"
              className={font === 'indopak' ? 'font-quran-indopak text-emerald-900' : 'font-quran-uthmani text-emerald-900'}
              style={{ textAlign: 'center', lineHeight: 2.2 }}
            >
              {(p.verses || []).map((v, vIdx) => {
                const text = typeof v === 'string' ? v : v.text;
                const words = String(text).split(/\s+/).filter(Boolean);
                return (
                  <span key={vIdx} style={{ display: 'inline' }}>
                    {words.map((w, wIdx) => {
                      const sev = mistakes[vIdx]?.[wIdx];
                      const cls = sev === 'obvious'
                        ? 'quran-word is-obvious'
                        : sev === 'advanced'
                          ? 'quran-word is-advanced'
                          : 'quran-word';
                      return (
                        <button
                          key={wIdx}
                          type="button"
                          onClick={() => toggleWord(vIdx, wIdx)}
                          className={cls}
                          title={sev ? `Marked: ${sev} (tap to change)` : 'Tap to mark mistake'}
                        >{w}</button>
                      );
                    })}
                    {' '}
                  </span>
                );
              })}
            </div>
            <textarea
              className="eval-input mt-3 text-sm min-h-[44px]"
              placeholder="General notes (tajweed, fluency, makhārij…)"
              value={parsed.comment}
              onChange={(e) => writeNext(mistakes, e.target.value)}
            />
            {editorOn && !isDefault && (
              <CustomItemEditor
                item={p}
                schema="quran"
                onChange={(patch) => setCustom(updateCustomItem(custom, p.id, patch))}
                onDelete={() => setCustom(removeCustomItem(custom, p.id, false))}
              />
            )}
          </div>
        );
      })}
    </div>
  </div>
  );
};

/* ─── Qur'an memorization ─────────────────────────────────────────────── */

/**
 * Per-surah memorization tracker. Each surah can have one of three statuses
 * (memorized · partial · not memorized) with an optional notes textarea
 * (e.g. "memorized up to ayah 50", "needs review of last 10 ayat").
 *
 * Statuses persist as a single answer keyed `memorization.summary` with the
 * structured payload encoded in `note`, so no backend changes are required.
 */
const MEM_STATUSES = [
  { v: 'memorized', label: 'Memorized', short: 'M', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', on: 'bg-emerald-600 text-white border-emerald-700' },
  { v: 'partial',   label: 'Partial',   short: 'P', cls: 'bg-amber-100 text-amber-800 border-amber-300',     on: 'bg-amber-500 text-white border-amber-600' },
  { v: 'none',      label: 'Not yet',   short: '·', cls: 'bg-rose-100 text-rose-800 border-rose-200',         on: 'bg-rose-500 text-white border-rose-600' },
];

const QuranMemorizationSlide = ({ student, onAnswer }) => {
  const qid = 'memorization.summary';
  const answer = (student.answers || []).find((a) => a.questionId === qid);
  let stored = { surahs: {} };
  try {
    if (answer?.note) {
      const parsed = JSON.parse(answer.note);
      // Migrate the legacy `surahs: [{ id, startsFrom }]` shape to the new map.
      if (Array.isArray(parsed?.surahs)) {
        const map = {};
        parsed.surahs.forEach((s) => {
          map[s.id] = { status: 'memorized', note: s.startsFrom || '' };
        });
        stored = { surahs: map };
      } else if (parsed?.surahs && typeof parsed.surahs === 'object') {
        stored = { surahs: parsed.surahs };
      }
    }
  } catch {
    stored = { surahs: {} };
  }

  const [picked, setPicked] = useState(stored);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const persist = (next) => {
    setPicked(next);
    const totals = Object.values(next.surahs || {}).reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});
    onAnswer({
      questionId: qid,
      section: 'quran-memorization',
      level: 'na',
      prompt: 'Qur’an memorization summary',
      expertVerdict: (totals.memorized || totals.partial) ? 'partial' : 'na',
      note: JSON.stringify(next),
    });
  };

  const term = search.trim().toLowerCase();
  const matches = !term
    ? []
    : SURAHS.filter((s) => {
        if (String(s.id) === term) return true;
        if (s.en.toLowerCase().includes(term)) return true;
        if (s.ar.includes(search.trim())) return true;
        return false;
      }).slice(0, 12);

  const setStatus = (id, status) => {
    const row = picked.surahs[id] || { note: '' };
    persist({ ...picked, surahs: { ...picked.surahs, [id]: { ...row, status } } });
  };
  const setNote = (id, note) => {
    const row = picked.surahs[id] || { status: 'memorized' };
    persist({ ...picked, surahs: { ...picked.surahs, [id]: { ...row, note } } });
  };
  const removeSurah = (id) => {
    const next = { ...picked.surahs };
    delete next[id];
    persist({ ...picked, surahs: next });
  };

  const trackedIds = Object.keys(picked.surahs).map((n) => Number(n));
  const tracked = SURAHS.filter((s) => trackedIds.includes(s.id));
  const counts = trackedIds.reduce((acc, id) => {
    const st = picked.surahs[id]?.status || 'none';
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, { memorized: 0, partial: 0, none: 0 });

  const renderRow = (s) => {
    const row = picked.surahs[s.id] || { status: null, note: '' };
    return (
      <div key={s.id} className="rounded-2xl border border-emerald-100 bg-white/70 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex items-center gap-3 sm:flex-1 min-w-0">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold shrink-0">{s.id}</span>
            <div className="min-w-0">
              <div className="font-naskh text-emerald-900 text-lg leading-tight" dir="rtl">{s.ar}</div>
              <div className="text-xs text-emerald-700/80">{s.en} · {s.ayat} āyāt</div>
            </div>
          </div>
          <div className="inline-flex rounded-full border border-emerald-200 overflow-hidden text-[11px]">
            {MEM_STATUSES.map((st) => {
              const on = row.status === st.v;
              return (
                <button key={st.v} type="button" onClick={() => setStatus(s.id, st.v)}
                  className={`px-2.5 py-1 border-r last:border-r-0 ${on ? st.on : st.cls}`}>{st.label}</button>
              );
            })}
          </div>
          {row.status && (
            <button type="button" onClick={() => removeSurah(s.id)}
              className="text-rose-700/80 hover:text-rose-700 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-rose-200 bg-white/70">
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
        {row.status && (
          <textarea
            className="eval-input mt-2 text-xs min-h-[36px]"
            placeholder="Notes (e.g. memorized up to ayah 50, weak in tajweed of ayat 5–7…)"
            value={row.note || ''}
            onChange={(e) => setNote(s.id, e.target.value)}
          />
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-lg font-semibold text-emerald-900 inline-flex items-center gap-2">
          <BookOpen className="h-5 w-5" /> Qur’an Memorization
        </h3>
        <p className="text-sm text-emerald-700/80" dir="rtl">سجِّل حالة كل سورة وأضف ملاحظة قصيرة عند الحاجة.</p>
      </div>

      <div className="rounded-2xl border border-emerald-100 bg-white/60 p-4 mb-4">
        <label className="eval-field-label">Search through all 114 surahs · <span dir="rtl" className="font-naskh">ابحث عن السورة</span></label>
        <input
          className="eval-input"
          placeholder="e.g. Al-Fatihah, البقرة, 36 …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {matches.length > 0 && (
          <div className="mt-2 rounded-xl border border-emerald-200 bg-white max-h-60 overflow-y-auto divide-y divide-emerald-50">
            {matches.map((s) => {
              const status = picked.surahs[s.id]?.status;
              return (
                <button key={s.id} type="button"
                  onClick={() => { setStatus(s.id, status || 'memorized'); setSearch(''); }}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-emerald-50"
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold shrink-0">{s.id}</span>
                    <span className="font-naskh text-emerald-900 text-base" dir="rtl">{s.ar}</span>
                    <span className="text-emerald-700/80 text-xs">{s.en}</span>
                  </span>
                  <span className="text-[10px] text-emerald-700/70">{status ? `· ${status}` : `${s.ayat} āyāt`}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between flex-wrap gap-2">
          <div className="text-[11px] text-emerald-700/80">
            Tracked: <strong>{tracked.length}</strong> · Memorized {counts.memorized} · Partial {counts.partial} · Not yet {counts.none}
          </div>
          <button type="button" onClick={() => setShowAll((x) => !x)}
            className="text-[11px] px-2.5 py-1 rounded-full border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50">
            {showAll ? 'Hide full list' : 'Show all 114 surahs'}
          </button>
        </div>
      </div>

      {tracked.length > 0 && (
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-emerald-700/80 font-semibold mb-2">
            Tracked surahs · {tracked.length}
          </div>
          <div className="space-y-2">{tracked.map(renderRow)}</div>
        </div>
      )}

      {showAll && (
        <div>
          <div className="text-xs uppercase tracking-wide text-emerald-700/80 font-semibold mb-2">
            All surahs · 114
          </div>
          <div className="space-y-2">{SURAHS.map(renderRow)}</div>
        </div>
      )}
    </div>
  );
};

/* ─── Tajweed (merged Theory + Practical) ─────────────────────────────── */

const TajweedSlide = ({
  student, onAnswer, editorOn,
  customTheory, setCustomTheory, resetCustomTheory,
  customPractical, setCustomPractical, resetCustomPractical,
}) => {
  const [tab, setTab] = useState('theory');
  return (
    <div>
      <div className="flex items-center justify-center mb-4">
        <div className="inline-flex rounded-full border border-emerald-200 overflow-hidden bg-white/70">
          <button
            type="button"
            onClick={() => setTab('theory')}
            className={`px-4 py-1.5 text-sm font-display-en ${tab === 'theory' ? 'bg-emerald-700 text-white' : 'text-emerald-800'}`}
          >Theory · نظري</button>
          <button
            type="button"
            onClick={() => setTab('practical')}
            className={`px-4 py-1.5 text-sm font-display-en ${tab === 'practical' ? 'bg-emerald-700 text-white' : 'text-emerald-800'}`}
          >Practical · تطبيقي</button>
        </div>
      </div>
      {tab === 'theory' ? (
        <TajweedTheorySlide
          student={student} onAnswer={onAnswer} editorOn={editorOn}
          custom={customTheory} setCustom={setCustomTheory} resetCustom={resetCustomTheory}
        />
      ) : (
        <TajweedPracticalSlide
          student={student} onAnswer={onAnswer} editorOn={editorOn}
          custom={customPractical} setCustom={setCustomPractical} resetCustom={resetCustomPractical}
        />
      )}
    </div>
  );
};

/* ─── Tajweed theory ───────────────────────────────────────────────────── */

const TajweedTheorySlide = ({ student, onAnswer, editorOn, custom, setCustom, resetCustom }) => {
  const items = mergeWithCustom(TAJWEED_THEORY, custom);
  const defaultIds = new Set(TAJWEED_THEORY.map((q) => q.id));
  return (
  <div>
    <h3 className="text-lg font-semibold text-emerald-900 mb-1">Tajweed · Theory</h3>
    <p className="text-sm text-emerald-700/80 mb-3">Multiple choice. The correct option is highlighted after picking.</p>
    {editorOn && (
      <CustomToolbar
        label="Custom MCQ for Tajweed Theory"
        onAdd={() => setCustom(addCustomItem(custom, { id: newCustomId('tt'), level: 'easy', question: 'New question', options: ['Option A', 'Option B', 'Option C', 'Option D'], correctIndex: 0 }))}
        onReset={resetCustom}
        canReset={Boolean(custom)}
      />
    )}
    <div className="space-y-3">
      {items.map((q, idx) => {
        const qid = `tajweed.theory.${q.id}`;
        const answer = (student.answers || []).find((a) => a.questionId === qid);
        const chosenIdx = answer?.chosen?.[0] !== undefined ? Number(answer.chosen[0]) : null;
        const answered = chosenIdx !== null;
        const dir = directionFor(q.question || q.prompt);
        const isDefault = defaultIds.has(q.id);
        return (
          <div
            key={q.id}
            dir={dir}
            className={`rounded-2xl border border-emerald-100 bg-white/60 p-4 transition-opacity ${answered ? 'opacity-60 hover:opacity-100' : ''}`}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-emerald-700/70 font-semibold mb-0.5">Question {idx + 1}</div>
                <div className="font-medium text-emerald-900" dir="auto" style={{ textAlign: 'start' }}>{q.question || q.prompt}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] uppercase tracking-wide text-emerald-700">{q.level}</span>
                {editorOn && <DeleteDefaultBtn onClick={() => setCustom(removeCustomItem(custom, q.id, isDefault))} />}
              </div>
            </div>
            <div className="rounded-xl bg-emerald-50/40 p-2">
              <div className="text-[10px] uppercase tracking-wide text-emerald-700/80 mb-1.5 font-semibold">Options</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {q.options.map((opt, i) => {
                  const isChosen = chosenIdx === i;
                  const isCorrect = i === q.correctIndex;
                  const revealed = chosenIdx !== null;
                  const cls = revealed
                    ? (isCorrect ? 'bg-emerald-50 border-emerald-400 text-emerald-800'
                      : isChosen ? 'bg-rose-50 border-rose-400 text-rose-800'
                      : 'bg-white/70 border-emerald-100')
                    : 'bg-white/70 border-emerald-100 hover:bg-emerald-50';
                  return (
                    <button
                      key={i}
                      type="button"
                      dir="auto"
                      onClick={() => onAnswer({
                        questionId: qid, section: 'tajweed-theory', level: q.level,
                        prompt: q.question || q.prompt, chosen: [String(i)],
                        expertVerdict: i === q.correctIndex ? 'correct' : 'incorrect',
                      })}
                      className={`text-left px-3 py-2 rounded-xl border text-sm ${cls}`}
                    >{opt}</button>
                  );
                })}
              </div>
            </div>
            {editorOn && !isDefault && (
              <CustomItemEditor
                item={{ ...q, prompt: q.question }}
                schema="mcq"
                onChange={(patch) => setCustom(updateCustomItem(custom, q.id, { ...patch, question: patch.prompt || q.question }))}
                onDelete={() => setCustom(removeCustomItem(custom, q.id, false))}
              />
            )}
          </div>
        );
      })}
    </div>
  </div>
  );
};

/* ─── Tajweed practical ────────────────────────────────────────────────── */

const TajweedPracticalSlide = ({ student, onAnswer, editorOn, custom, setCustom, resetCustom }) => {
  const items = mergeWithCustom(TAJWEED_PRACTICAL, custom);
  const defaultIds = new Set(TAJWEED_PRACTICAL.map((q) => q.id));
  return (
  <div>
    <h3 className="text-lg font-semibold text-emerald-900 mb-1">Tajweed · Practical</h3>
    <p className="text-sm text-emerald-700/80 mb-3">Listen and assess each application.</p>
    {editorOn && (
      <CustomToolbar
        label="Custom practical drills"
        onAdd={() => setCustom(addCustomItem(custom, { id: newCustomId('tp'), level: 'easy', prompt: 'بسم الله الرحمن الرحيم', expects: 'Apply tajweed correctly' }))}
        onReset={resetCustom}
        canReset={Boolean(custom)}
      />
    )}
    <div className="space-y-3">
      {items.map((q) => {
        const qid = `tajweed.practical.${q.id}`;
        const answer = (student.answers || []).find((a) => a.questionId === qid);
        const answered = answer?.expertVerdict && answer.expertVerdict !== 'na';
        const dir = directionFor(q.prompt);
        const isDefault = defaultIds.has(q.id);
        return (
          <div
            key={q.id}
            dir={dir}
            className={`rounded-2xl border border-emerald-100 bg-white/60 p-4 transition-opacity ${answered ? 'opacity-60 hover:opacity-100' : ''}`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wide text-emerald-700">{q.level}</span>
              <div className="flex items-center gap-2">
                {editorOn && <DeleteDefaultBtn onClick={() => setCustom(removeCustomItem(custom, q.id, isDefault))} />}
                <VerdictRow
                  answer={answer}
                  onChange={(v) => onAnswer({ questionId: qid, section: 'tajweed-practical', level: q.level, prompt: q.prompt, expertVerdict: v })}
                />
              </div>
            </div>
            <div
              className="font-arabic-display text-2xl text-emerald-900 leading-loose mb-1"
              dir="auto"
              style={{ textAlign: 'start' }}
            >{q.prompt}</div>
            <div className="text-xs text-emerald-700/80">Expects: {q.expects}</div>
            <textarea
              className="eval-input mt-2 text-sm min-h-[44px]"
              placeholder="Notes / what to improve…"
              value={answer?.note || ''}
              onChange={(e) => onAnswer({
                questionId: qid, section: 'tajweed-practical', level: q.level,
                prompt: q.prompt, expertVerdict: answer?.expertVerdict || 'na', note: e.target.value,
              })}
            />
            {editorOn && !isDefault && (
              <CustomItemEditor
                item={q}
                schema="expect"
                onChange={(patch) => setCustom(updateCustomItem(custom, q.id, patch))}
                onDelete={() => setCustom(removeCustomItem(custom, q.id, false))}
              />
            )}
          </div>
        );
      })}
    </div>
  </div>
  );
};

/* ─── Arabic skills ────────────────────────────────────────────────────── */

const ArabicSkillsSlide = ({ student, onAnswer, editorOn, custom, setCustom, resetCustom }) => {
  const [skillKey, setSkillKey] = useState('grammar');
  const [level, setLevel] = useState('easy');
  const [questionIdx, setQuestionIdx] = useState(0);
  const skill = ARABIC_SKILLS.find((s) => s.key === skillKey) || ARABIC_SKILLS[0];
  const defaultItems = skill.content?.[level] || [];
  const slotKey = `${skillKey}.${level}`;
  const slotCustom = (custom && custom[slotKey]) || null;
  const items = mergeWithCustom(defaultItems, slotCustom);
  const defaultIds = new Set(defaultItems.map((q) => q.id));
  const setSlot = (next) => setCustom({ ...(custom || {}), [slotKey]: next });
  const sectionFor = {
    grammar: 'arabic-grammar',
    vocab: 'arabic-vocab',
    comprehension: 'arabic-comprehension',
    writing: 'arabic-writing',
    speaking: 'arabic-speaking',
  }[skillKey];

  useEffect(() => { setQuestionIdx(0); }, [skillKey, level]);

  const addStub = () => {
    const id = newCustomId(`${skillKey}-${level}`);
    if (skill.type === 'mcq') {
      return { id, prompt: 'New question', options: ['Option A', 'Option B', 'Option C', 'Option D'], correctIndex: 0 };
    }
    if (skill.type === 'expect') return { id, prompt: 'New prompt', expected: '' };
    if (skill.type === 'passage') return { id, passage: 'النص…', questions: ['سؤال؟'] };
    return { id, prompt: 'New prompt' };
  };

  const total = items.length;
  const safeIdx = Math.min(questionIdx, Math.max(0, total - 1));
  const q = items[safeIdx];
  const answered = (qq) => {
    const a = (student.answers || []).find((x) => x.questionId === `arabic.${skillKey}.${qq.id}`);
    if (skill.type === 'mcq') return a?.chosen?.[0] !== undefined;
    return a?.expertVerdict && a.expertVerdict !== 'na';
  };

  const renderQuestion = () => {
    if (!q) {
      return (
        <div className="text-sm text-emerald-700 italic text-center">No items for this level yet.</div>
      );
    }
    const qid = `arabic.${skillKey}.${q.id}`;
    const answer = (student.answers || []).find((a) => a.questionId === qid);
    const dir = directionFor(q.prompt || q.passage || '');
    const isDefault = defaultIds.has(q.id);
    const deleteBtn = editorOn ? <DeleteDefaultBtn onClick={() => setSlot(removeCustomItem(slotCustom, q.id, isDefault))} /> : null;
    const editor = editorOn && !isDefault ? (
      <CustomItemEditor
        item={skill.type === 'passage' ? q : q}
        schema={skill.type}
        onChange={(patch) => setSlot(updateCustomItem(slotCustom, q.id, patch))}
        onDelete={() => setSlot(removeCustomItem(slotCustom, q.id, false))}
      />
    ) : null;

    if (skill.type === 'mcq') {
      const chosenIdx = answer?.chosen?.[0] !== undefined ? Number(answer.chosen[0]) : null;
      return (
        <div className="w-full" dir={dir}>
          <div className="flex justify-end mb-2">{deleteBtn}</div>
          <div className="text-2xl sm:text-3xl font-medium text-emerald-900 text-center leading-snug mb-6" dir="auto">{q.prompt}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
            {q.options.map((opt, i) => {
              const isChosen = chosenIdx === i;
              const isCorrect = i === q.correctIndex;
              const revealed = chosenIdx !== null;
              const cls = revealed
                ? (isCorrect ? 'bg-emerald-50 border-emerald-400 text-emerald-800'
                  : isChosen ? 'bg-rose-50 border-rose-400 text-rose-800'
                  : 'bg-white/70 border-emerald-100')
                : 'bg-white/70 border-emerald-200 hover:bg-emerald-50';
              return (
                <button key={i} type="button" dir="auto"
                  onClick={() => onAnswer({
                    questionId: qid, section: sectionFor, level,
                    prompt: q.prompt, chosen: [String(i)],
                    expertVerdict: i === q.correctIndex ? 'correct' : 'incorrect',
                  })}
                  className={`px-4 py-3 rounded-xl border text-base text-center ${cls}`}>{opt}</button>
              );
            })}
          </div>
          {editor}
        </div>
      );
    }

    if (skill.type === 'expect') {
      return (
        <div className="w-full max-w-2xl mx-auto" dir={dir}>
          <div className="flex justify-end mb-2 gap-2">
            <VerdictRow answer={answer} onChange={(v) => onAnswer({ questionId: qid, section: sectionFor, level, prompt: q.prompt, expertVerdict: v })} />
            {deleteBtn}
          </div>
          <div className="font-arabic-display text-3xl sm:text-4xl text-emerald-900 text-center leading-loose mb-4" dir="auto">{q.prompt}</div>
          <div className="text-sm text-emerald-700/80 text-center mb-3">Expected: {q.expected}</div>
          <textarea className="eval-input text-sm min-h-[80px]" placeholder="Student's answer / notes…"
            value={answer?.note || ''}
            onChange={(e) => onAnswer({ questionId: qid, section: sectionFor, level, prompt: q.prompt, expertVerdict: answer?.expertVerdict || 'na', note: e.target.value })} />
          {editor}
        </div>
      );
    }

    if (skill.type === 'passage') {
      return (
        <div className="w-full max-w-3xl mx-auto" dir={dir}>
          <div className="flex justify-end mb-2 gap-2">
            <VerdictRow answer={answer} onChange={(v) => onAnswer({ questionId: qid, section: sectionFor, level, prompt: q.passage, expertVerdict: v })} />
            {deleteBtn}
          </div>
          <div className="font-arabic-display text-xl sm:text-2xl text-emerald-900 leading-loose mb-4 text-center" dir="auto">{q.passage}</div>
          <ol className="list-decimal pl-6 text-sm sm:text-base text-emerald-800 mb-3 space-y-1 max-w-xl mx-auto">
            {q.questions.map((qq, i) => <li key={i} dir="auto">{qq}</li>)}
          </ol>
          <textarea className="eval-input text-sm min-h-[80px]" placeholder="What did the student get / miss?"
            value={answer?.note || ''}
            onChange={(e) => onAnswer({ questionId: qid, section: sectionFor, level, prompt: q.passage, expertVerdict: answer?.expertVerdict || 'na', note: e.target.value })} />
          {editor}
        </div>
      );
    }

    // prompt
    return (
      <div className="w-full max-w-2xl mx-auto" dir={dir}>
        <div className="flex justify-end mb-2 gap-2">
          <VerdictRow answer={answer} onChange={(v) => onAnswer({ questionId: qid, section: sectionFor, level, prompt: q.prompt, expertVerdict: v })} />
          {deleteBtn}
        </div>
        <div className="text-2xl sm:text-3xl font-medium text-emerald-900 text-center leading-snug mb-4" dir="auto">{q.prompt}</div>
        <textarea className="eval-input text-sm min-h-[100px]"
          placeholder={skillKey === 'writing' ? 'Transcribe what the student wrote…' : 'Notes on fluency, accuracy, vocabulary…'}
          value={answer?.note || ''}
          onChange={(e) => onAnswer({ questionId: qid, section: sectionFor, level, prompt: q.prompt, expertVerdict: answer?.expertVerdict || 'na', note: e.target.value })} />
        {editor}
      </div>
    );
  };

  return (
    <div>
      <div className="text-center mb-2">
        <h3 className="text-lg font-semibold text-emerald-900">Arabic Skills</h3>
        <p className="text-sm text-emerald-700/80">Probe each skill at the level that best matches the student.</p>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3 justify-center">
        {ARABIC_SKILLS.map((s) => (
          <button key={s.key} type="button" onClick={() => setSkillKey(s.key)}
            className={`px-3 py-1 rounded-full text-xs border ${skillKey === s.key ? 'bg-emerald-700 text-white border-emerald-800' : 'bg-white/70 border-emerald-200 text-emerald-800'}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-center gap-2 mb-4">
        <span className="text-xs text-emerald-700/80">Level:</span>
        <DifficultyPicker value={level} onChange={setLevel} />
      </div>

      {editorOn && (
        <CustomToolbar
          label={`Custom ${skill.label} · ${level}`}
          onAdd={() => setSlot(addCustomItem(slotCustom, addStub()))}
          onReset={() => {
            const next = { ...(custom || {}) };
            delete next[slotKey];
            if (Object.keys(next).length === 0) resetCustom();
            else setCustom(next);
          }}
          canReset={Boolean(slotCustom)}
        />
      )}

      <div className="rounded-2xl bg-white/60 px-3 py-5 sm:p-6 flex flex-col items-center">
        {q && (
          <div className="text-[11px] uppercase tracking-wider text-emerald-700/70 mb-3 font-display-en">
            <bdi>Question {safeIdx + 1} / {total}</bdi>
          </div>
        )}
        {renderQuestion()}
        {total > 0 && (
          <div className="mt-6 flex items-center gap-2">
            <button type="button"
              disabled={safeIdx === 0}
              onClick={() => setQuestionIdx((i) => Math.max(0, i - 1))}
              className="px-3 py-1.5 rounded-full border border-emerald-300 bg-white text-emerald-800 text-xs inline-flex items-center gap-1 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" /> Prev
            </button>
            <div className="flex items-center gap-1">
              {items.map((it, i) => (
                <button key={it.id} type="button" onClick={() => setQuestionIdx(i)}
                  className={`w-2.5 h-2.5 rounded-full ${i === safeIdx ? 'bg-emerald-700' : answered(it) ? 'bg-emerald-400' : 'bg-emerald-200'}`}
                  title={`Question ${i + 1}`} />
              ))}
            </div>
            <button type="button"
              disabled={safeIdx >= total - 1}
              onClick={() => setQuestionIdx((i) => Math.min(total - 1, i + 1))}
              className="px-3 py-1.5 rounded-full border border-emerald-300 bg-white text-emerald-800 text-xs inline-flex items-center gap-1 disabled:opacity-40">
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── Summary ──────────────────────────────────────────────────────────── */

// Smart per-section "starting point" — find the deepest level where the student
// scored ≥1 correct/partial. Returns a label suggesting where to begin next.
const LEVEL_ORDER = ['easy', 'medium', 'advanced'];
const SECTION_LABELS = {
  'reading-letters':   { en: 'Reading · Letters',   ar: 'قراءة · الحروف' },
  'reading-words':     { en: 'Reading · Words',     ar: 'قراءة · الكلمات' },
  'quran-recitation':  { en: 'Qur’an Recitation',   ar: 'تلاوة القرآن' },
  'tajweed-theory':    { en: 'Tajweed · Theory',    ar: 'تجويد · نظري' },
  'tajweed-practical': { en: 'Tajweed · Practical', ar: 'تجويد · تطبيقي' },
  'tajweed':           { en: 'Tajweed',              ar: 'التجويد' },
  'arabic-grammar':    { en: 'Arabic · Grammar',    ar: 'العربية · النحو' },
  'arabic-vocab':      { en: 'Arabic · Vocabulary', ar: 'العربية · المفردات' },
  'arabic-comprehension': { en: 'Arabic · Comprehension', ar: 'العربية · الفهم' },
  'arabic-writing':    { en: 'Arabic · Writing',    ar: 'العربية · الكتابة' },
  'arabic-speaking':   { en: 'Arabic · Speaking',   ar: 'العربية · التحدث' },
};
const NEXT_LEVEL = { easy: 'medium', medium: 'advanced', advanced: 'advanced+' };

// Which evaluation category each weakness tag belongs to, so the Summary page
// can show only the tags relevant to the sections the student was tested in.
const WEAKNESS_CATEGORY = {
  'Letter recognition (similar shapes)': 'reading',
  'Letter pronunciation (heavy / light)': 'reading',
  'Short vowels (fatḥa / kasra / ḍamma)': 'reading',
  'Long vowels (alif / wāw / yāʾ)': 'reading',
  'Tanwīn': 'reading',
  'Lām shamsiyya / qamariyya': 'reading',
  'Sukūn': 'reading',
  'Shadda': 'reading',
  'Reading fluency (two/three words & sentences)': 'reading',
  'Silent letters': 'reading',
  'Stopping rules': 'tajweed',
  'Quran recitation accuracy': 'quran',
  'Tajweed theory': 'tajweed',
  'Tajweed application': 'tajweed',
};

const summarizeJourney = (answers = []) => {
  // Only consider items the admin actually graded. Untouched questions
  // are treated as "not asked" and excluded from the summary entirely.
  const VALID = new Set(['correct', 'partial', 'incorrect']);
  const graded = (answers || []).filter((a) => a && VALID.has(a.expertVerdict));
  const bySection = {};
  graded.forEach((a) => {
    if (!a.section) return;
    if (a.section === 'reading-letters' || a.section === 'reading-words' || a.section === 'quran-recitation'
        || a.section === 'tajweed-theory' || a.section === 'tajweed-practical'
        || a.section.startsWith('arabic-')) {
      bySection[a.section] = bySection[a.section] || [];
      bySection[a.section].push(a);
    }
  });
  const out = [];
  Object.entries(bySection).forEach(([sec, list]) => {
    const counts = { easy: 0, medium: 0, advanced: 0, none: 0 };
    const passed = { easy: false, medium: false, advanced: false };
    list.forEach((a) => {
      const lv = LEVEL_ORDER.includes(a.level) ? a.level : 'none';
      counts[lv] = (counts[lv] || 0) + 1;
      if ((a.expertVerdict === 'correct' || a.expertVerdict === 'partial') && lv !== 'none') passed[lv] = true;
    });
    let deepest = null;
    LEVEL_ORDER.forEach((lv) => { if (passed[lv]) deepest = lv; });
    let nextPoint;
    if (!deepest) nextPoint = 'easy';
    else nextPoint = NEXT_LEVEL[deepest];
    out.push({ section: sec, deepest, nextPoint, total: list.length });
  });
  return out;
};

const SummarySlide = ({ session, student, students = [], activeStudentIdx = 0, onPickStudent, onChange, onUpdateAllStudents }) => {
  const totals = useMemo(() => {
    const t = { correct: 0, partial: 0, incorrect: 0, total: 0 };
    (student.answers || []).forEach((a) => {
      if (!a.expertVerdict || a.expertVerdict === 'na') return;
      t.total += 1;
      t[a.expertVerdict] = (t[a.expertVerdict] || 0) + 1;
    });
    return t;
  }, [student.answers]);

  // Derive structured mistake lists from the student's answers.
  // Quran-recitation answers store word-level mistakes inside `note` as JSON;
  // they are expanded into per-word entries so the summary lists every word.
  const { majorMistakes, minorMistakes } = useMemo(() => {
    const major = [];
    const minor = [];
    // Quran-recitation mistakes are grouped per surah AND per ayah so each
    // surah name appears once, with its mistaken words listed under the exact
    // verse number they occurred in (much easier for a teacher to read).
    const quranMajor = {}; // surah -> { verse -> [words] }
    const quranMinor = {};
    const addWord = (bucket, surah, verse, word) => {
      const s = (bucket[surah] = bucket[surah] || {});
      (s[verse] = s[verse] || []).push(word);
    };
    (student.answers || []).forEach((a) => {
      if (!a.section) return;
      // The memorization summary is not a "mistake"; it is rendered in its own
      // humanized section below, so skip it here.
      if (a.section === 'quran-memorization' || a.questionId === 'memorization.summary') return;
      const labelObj = SECTION_LABELS[a.section] || { en: a.section };
      const label = labelObj.en;
      if (a.section === 'quran-recitation') {
        try {
          const parsed = a.note ? JSON.parse(a.note) : null;
          const surah = (parsed?.surah || a.prompt || 'Qur’an').trim();
          const marks = Array.isArray(parsed?.marks) ? parsed.marks : [];
          if (marks.length) {
            marks.forEach((m) => {
              const verse = m.verse || 1;
              const word = m.text || `word ${m.word}`;
              if (m.sev === 'advanced') addWord(quranMajor, surah, verse, word);
              else if (m.sev === 'obvious') addWord(quranMinor, surah, verse, word);
            });
          } else {
            // Legacy notes without word text — fall back to verse/word indices.
            const mistakes = parsed?.mistakes || {};
            Object.entries(mistakes).forEach(([vIdx, row]) => {
              Object.entries(row || {}).forEach(([wIdx, sev]) => {
                const verse = Number(vIdx) + 1;
                const word = `word ${Number(wIdx) + 1}`;
                if (sev === 'advanced') addWord(quranMajor, surah, verse, word);
                else if (sev === 'obvious') addWord(quranMinor, surah, verse, word);
              });
            });
          }
          if (parsed?.comment && parsed.comment.trim()) {
            minor.push({ section: label, prompt: surah, detail: parsed.comment.trim() });
          }
        } catch { /* legacy note */ }
        return;
      }
      if (a.expertVerdict === 'incorrect') {
        major.push({ section: label, prompt: a.prompt || '', detail: a.note || '' });
      } else if (a.expertVerdict === 'partial') {
        minor.push({ section: label, prompt: a.prompt || '', detail: a.note || '' });
      }
    });
    const toVerses = (byVerse) => Object.entries(byVerse)
      .map(([verse, words]) => ({ verse: Number(verse), words }))
      .sort((x, y) => x.verse - y.verse);
    Object.entries(quranMajor).forEach(([surah, byVerse]) => major.unshift({ section: 'Qur’an Recitation', surah, verses: toVerses(byVerse) }));
    Object.entries(quranMinor).forEach(([surah, byVerse]) => minor.unshift({ section: 'Qur’an Recitation', surah, verses: toVerses(byVerse) }));
    return { majorMistakes: major, minorMistakes: minor };
  }, [student.answers]);

  // Humanized memorization summary derived from the memorization.summary answer.
  const memorization = useMemo(() => {
    const ans = (student.answers || []).find((a) => a.questionId === 'memorization.summary');
    if (!ans?.note) return [];
    try {
      const parsed = JSON.parse(ans.note);
      const surahs = parsed?.surahs && typeof parsed.surahs === 'object' ? parsed.surahs : {};
      return Object.entries(surahs)
        .map(([id, row]) => ({
          id: Number(id),
          name: surahNameFor(id),
          status: row?.status || 'memorized',
          note: row?.note || '',
        }))
        .sort((a, b) => a.id - b.id);
    } catch {
      return [];
    }
  }, [student.answers]);

  const journey = useMemo(() => summarizeJourney(student.answers), [student.answers]);

  // Weakness tags relevant to what was actually evaluated. Each weakness area
  // belongs to a category; we only surface categories the student was tested in
  // (so the dropdown stays short and compatible with the selected levels).
  const relevantWeaknesses = useMemo(() => {
    const tested = new Set();
    (student.answers || []).forEach((a) => {
      if (!a.section || !['correct', 'partial', 'incorrect'].includes(a.expertVerdict)) return;
      if (a.section.startsWith('reading')) tested.add('reading');
      else if (a.section === 'quran-recitation' || a.section === 'quran-memorization') tested.add('quran');
      else if (a.section.startsWith('tajweed')) tested.add('tajweed');
      else if (a.section.startsWith('arabic')) tested.add('arabic');
    });
    if (!tested.size) return WEAKNESS_AREAS;
    return WEAKNESS_AREAS.filter((area) => tested.has(WEAKNESS_CATEGORY[area] || 'reading'));
  }, [student.answers]);

  // Recommended levels — stored as an array of "<subject>:<level>" strings
  // (e.g. "Qur'an Recitation:intermediate"). Each subject cycles off → beg →
  // intermediate → advanced → off when its chip is tapped.
  const recommended = Array.isArray(student.recommendedLevels) && student.recommendedLevels.length
    ? student.recommendedLevels
    : (student.recommendedLevel ? [student.recommendedLevel] : []);
  const RECO_LEVELS = ['beginner', 'intermediate', 'advanced'];
  const recoMap = useMemo(() => {
    const m = {};
    recommended.forEach((entry) => {
      const [sub, lv] = String(entry).split(':');
      if (sub && RECO_LEVELS.includes(lv)) m[sub.trim()] = lv;
    });
    return m;
  }, [recommended]);
  const cycleSubject = (subject) => {
    const curr = recoMap[subject];
    const nextLevel = curr === 'beginner' ? 'intermediate' : curr === 'intermediate' ? 'advanced' : curr === 'advanced' ? null : 'beginner';
    const nextMap = { ...recoMap };
    if (nextLevel) nextMap[subject] = nextLevel;
    else delete nextMap[subject];
    const next = Object.entries(nextMap).map(([s, l]) => `${s}:${l}`);
    onChange({ recommendedLevels: next, recommendedLevel: next.join(', ') });
  };
  const subjectsForRecommendation = useMemo(() => {
    const base = student.desiredSubjects?.length ? student.desiredSubjects : CLASS_SUBJECTS;
    const fromReco = Object.keys(recoMap);
    return Array.from(new Set([...base, ...fromReco]));
  }, [student.desiredSubjects, recoMap]);

  const exportText = useMemo(() => {
    const lines = [];
    lines.push(`Waraqa Evaluation · ${session.title || ''}`);
    lines.push(`Student: ${student.name}${student.age ? ` (${student.age})` : ''}`);
    if (student.desiredSubjects?.length) lines.push(`Subjects: ${student.desiredSubjects.join(', ')}`);
    if (student.availability) lines.push(`Availability: ${student.availability}`);
    lines.push(`\nVerdicts: ${totals.correct}/${totals.total} correct · ${totals.partial} partial · ${totals.incorrect} incorrect`);
    if (recommended.length) lines.push(`Recommended: ${recommended.join(', ')}`);
    const renderMistakeLine = (m) => {
      if (Array.isArray(m.verses) && m.verses.length) {
        lines.push(`  · ${m.surah}:`);
        m.verses.forEach((v) => lines.push(`      – Ayah ${v.verse}: ${v.words.join('، ')}`));
      } else if (Array.isArray(m.words)) {
        lines.push(`  · ${m.surah}: ${m.words.join('، ')}`);
      } else {
        lines.push(`  · ${m.section} — ${m.prompt}${m.detail ? ` (${m.detail})` : ''}`);
      }
    };
    if (majorMistakes.length) {
      lines.push('\nMistakes:');
      majorMistakes.forEach(renderMistakeLine);
    }
    if (minorMistakes.length) {
      lines.push('\nMinor mistakes:');
      minorMistakes.forEach(renderMistakeLine);
    }
    if (memorization.length) {
      lines.push('\nMemorization:');
      memorization.forEach((s) => lines.push(`  · ${s.name}: ${s.status}${s.note ? ` — review: ${s.note}` : ''}`));
    }
    if (student.adminSummary) lines.push(`\nNotes: ${student.adminSummary}`);
    return lines.join('\n');
  }, [session.title, student, totals, recommended, majorMistakes, minorMistakes, memorization]);

  // Copy a well-phrased hand-off message for the teacher. Availability is shown
  // in the student's own timezone and (when different) also in Cairo time.
  const copyForTeacher = () => {
    const journeyForMsg = journey.map((j) => ({
      ...j,
      label: (SECTION_LABELS[j.section] || { en: j.section }).en,
    }));
    const msg = buildTeacherSummaryMessage({
      student,
      majorMistakes,
      minorMistakes,
      journey: journeyForMsg,
      memorization,
      sessionDate: session.createdAt || session.date || '',
    });
    navigator.clipboard?.writeText(msg);
    showToast('Copied for teacher');
  };

  // Render a single mistake entry inside the rose/amber boxes. Quran entries
  // are grouped per ayah (verse number shown once, words in a single row).
  const renderMistakeBody = (m, tone) => {
    const chipCls = tone === 'rose'
      ? 'bg-rose-100 text-rose-900'
      : 'bg-amber-100 text-amber-900';
    const verseLblCls = tone === 'rose' ? 'text-rose-700/70' : 'text-amber-700/70';
    if (Array.isArray(m.verses) && m.verses.length) {
      return (
        <div className="mt-1 space-y-1">
          {m.verses.map((v) => (
            <div key={v.verse} className="flex items-start gap-1.5" dir="rtl">
              <span className={`shrink-0 mt-0.5 text-[10px] font-display-en ${verseLblCls}`} dir="ltr">Ayah {v.verse}</span>
              <div className="flex flex-wrap gap-1">
                {v.words.map((w, wi) => (
                  <span key={wi} className={`font-naskh px-1.5 py-0.5 rounded ${chipCls} text-base leading-tight`}>{w}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (Array.isArray(m.words)) {
      return (
        <div className="flex flex-wrap gap-1 mt-1" dir="rtl">
          {m.words.map((w, wi) => (
            <span key={wi} className={`font-naskh px-1.5 py-0.5 rounded ${chipCls} text-base leading-tight`}>{w}</span>
          ))}
        </div>
      );
    }
    return (
      <>
        <div className={`text-xs leading-snug ${tone === 'rose' ? 'text-rose-900' : 'text-amber-900'}`} dir="auto">{m.prompt || '—'}</div>
        {m.detail && <div className={`text-[11px] italic mt-0.5 ${tone === 'rose' ? 'text-rose-700/80' : 'text-amber-700/80'}`} dir="auto">{m.detail}</div>}
      </>
    );
  };

  return (
    <div>
      {students.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {students.map((s, i) => (
            <button key={s._id || i} type="button"
              onClick={() => onPickStudent && onPickStudent(i)}
              className={`px-2.5 py-1 rounded-full text-[11px] inline-flex items-center gap-1 border font-display-en ${
                i === activeStudentIdx ? 'bg-emerald-600 text-white border-emerald-600 shadow' : 'bg-white/70 border-emerald-200 text-emerald-800'
              }`}>
              <bdi>{s.name || `Student ${i + 1}`}</bdi>
            </button>
          ))}
        </div>
      )}

      <h3 className="text-lg font-semibold text-emerald-900 mb-3">
        Summary for <bdi>{student.name}</bdi>
      </h3>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <Stat label="Correct"   value={totals.correct}   cls="from-emerald-500 to-teal-600" />
        <Stat label="Partial"   value={totals.partial}   cls="from-amber-500 to-orange-500" />
        <Stat label="Incorrect" value={totals.incorrect} cls="from-rose-500 to-pink-600" />
      </div>

      <div className="grid lg:grid-cols-2 gap-3 mb-4 items-start">
      {journey.length > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-white p-4">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <h4 className="font-display-en text-sm font-semibold text-emerald-900">Starting point recommendation</h4>
            <span className="font-naskh text-emerald-800 text-base" dir="rtl">نقطة الانطلاق المقترحة</span>
          </div>
          <ul className="space-y-1.5">
            {journey.map((j) => {
              const label = SECTION_LABELS[j.section] || { en: j.section, ar: '' };
              const reached = j.deepest ? `Reached ${j.deepest}` : 'Did not pass easy';
              return (
                <li key={j.section} className="flex items-center justify-between gap-3 rounded-xl bg-white/80 border border-emerald-100 px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-display-en text-sm font-semibold text-emerald-900 truncate"><bdi>{label.en}</bdi></div>
                    <div className="font-naskh text-emerald-700/80 text-xs truncate" dir="rtl">{label.ar}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display-en text-[10px] uppercase tracking-wider text-emerald-700/70"><bdi>{reached}</bdi></div>
                    <div className="font-display-en text-sm font-bold text-emerald-800">
                      <bdi>Next → {j.nextPoint}</bdi>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-emerald-100 bg-white/50 p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <label className="text-xs font-semibold text-emerald-800">Recommended subjects & levels</label>
          <span className="text-[10px] text-emerald-700/60">Tap to cycle: beginner → intermediate → advanced → off</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {subjectsForRecommendation.map((sub) => {
            const lv = recoMap[sub];
            const cls = !lv
              ? 'bg-white/70 border-emerald-200 text-emerald-800'
              : lv === 'beginner'
                ? 'bg-emerald-100 border-emerald-400 text-emerald-900'
                : lv === 'intermediate'
                  ? 'bg-amber-100 border-amber-400 text-amber-900'
                  : 'bg-rose-100 border-rose-400 text-rose-900';
            return (
              <button key={sub} type="button" onClick={() => cycleSubject(sub)}
                className={`px-2.5 py-1 rounded-full text-xs border ${cls}`}>
                {sub}{lv ? ` · ${lv}` : ''}
              </button>
            );
          })}
        </div>
      </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <div className="rounded-2xl border border-rose-200 bg-rose-50/30 p-3">
          <div className="text-xs font-semibold text-rose-800 mb-2 inline-flex items-center gap-1">
            <XCircle className="h-3.5 w-3.5" /> Clear mistakes · {majorMistakes.length}
          </div>
          {majorMistakes.length === 0 ? (
            <div className="text-[11px] text-rose-700/70 italic">No serious mistakes recorded.</div>
          ) : (
            <ul className="space-y-1.5">
              {majorMistakes.map((m, i) => (
                <li key={i} className="rounded-lg bg-white/80 border border-rose-100 px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-rose-700/70">{m.surah || m.section}</div>
                  {renderMistakeBody(m, 'rose')}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/30 p-3">
          <div className="text-xs font-semibold text-amber-800 mb-2 inline-flex items-center gap-1">
            <MinusCircle className="h-3.5 w-3.5" /> Minor slips · {minorMistakes.length}
          </div>
          {minorMistakes.length === 0 ? (
            <div className="text-[11px] text-amber-700/70 italic">No minor mistakes recorded.</div>
          ) : (
            <ul className="space-y-1.5">
              {minorMistakes.map((m, i) => (
                <li key={i} className="rounded-lg bg-white/80 border border-amber-100 px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-amber-700/70">{m.surah || m.section}</div>
                  {renderMistakeBody(m, 'amber')}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {memorization.length > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/30 p-3 mb-4">
          <div className="text-xs font-semibold text-emerald-800 mb-2 inline-flex items-center gap-1">
            <BookOpen className="h-3.5 w-3.5" /> Qur’an memorization · {memorization.length}
          </div>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {memorization.map((s) => (
              <div key={s.id} className="rounded-lg bg-white/80 border border-emerald-100 px-2 py-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-emerald-900">{s.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${s.status === 'memorized' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {s.status === 'memorized' ? 'Memorized' : s.status === 'partial' ? 'Partial' : s.status}
                  </span>
                </div>
                {s.note && s.note.trim() && (
                  <div className="text-[11px] text-emerald-700/80 mt-0.5 font-naskh" dir="rtl">{s.note}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-start gap-2">
        <details className="relative shrink-0">
          <summary className="list-none cursor-pointer select-none px-3 py-1.5 rounded-full text-xs border border-emerald-200 bg-white/70 text-emerald-800 inline-flex items-center gap-1">
            <Tag className="h-3 w-3" /> Weakness tags{(student.weaknesses || []).length ? ` · ${(student.weaknesses || []).length}` : ''}
            <ChevronDown className="h-3 w-3" />
          </summary>
          <div className="absolute z-20 mt-1 w-64 max-h-56 overflow-y-auto rounded-xl border border-emerald-200 bg-white shadow-lg p-2 space-y-0.5">
            {relevantWeaknesses.map((area) => {
              const on = (student.weaknesses || []).some((w) => w.area === area);
              return (
                <label key={area} className="flex items-center gap-2 text-xs text-emerald-900 px-1.5 py-1 rounded hover:bg-emerald-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const list = student.weaknesses || [];
                      const next = on ? list.filter((w) => w.area !== area) : [...list, { area }];
                      onChange({ weaknesses: next });
                    }}
                  />
                  <span>{area}</span>
                </label>
              );
            })}
          </div>
        </details>
        <div className="flex flex-wrap gap-1">
          {(student.weaknesses || []).map((w) => (
            <span key={w.area} className="px-2 py-0.5 rounded-full text-[11px] bg-amber-100 text-amber-900 inline-flex items-center gap-1">
              {w.area}
              <button type="button" className="text-amber-700 hover:text-amber-900"
                onClick={() => onChange({ weaknesses: (student.weaknesses || []).filter((x) => x.area !== w.area) })}>×</button>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <label className="block text-xs font-semibold text-emerald-800 mb-1">Admin notes</label>
        <textarea className="eval-input min-h-[80px]" value={student.adminSummary || ''} onChange={(e) => onChange({ adminSummary: e.target.value })} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { navigator.clipboard?.writeText(exportText); showToast('Copied summary'); }}
          className="px-3 py-1.5 rounded-full bg-emerald-700 text-white text-xs inline-flex items-center gap-1"><Copy className="h-3 w-3" /> Copy summary</button>
        <button type="button" onClick={copyForTeacher}
          className="px-3 py-1.5 rounded-full bg-indigo-700 text-white text-xs inline-flex items-center gap-1" title="Includes availability in the student's timezone and Cairo time">
          <Copy className="h-3 w-3" /> Copy for teacher</button>
      </div>

      {/* Quick intro note captured on the student slide */}
      {student.contactNote && student.contactNote.trim() && (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3">
          <div className="flex items-baseline justify-between mb-1">
            <label className="text-xs font-semibold text-emerald-800">Intro note</label>
            <span dir="rtl" className="font-naskh text-emerald-700/80 text-sm">ملاحظة سريعة</span>
          </div>
          <p className="text-sm text-emerald-900 whitespace-pre-wrap" dir="auto">{student.contactNote}</p>
        </div>
      )}

      {/* Availability & general notes (moved here from the closing slide) */}
      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        <AvailabilitySlotsEditor student={student} onChange={onChange} />
        <WrapUpField
          full
          textarea
          label="General notes"
          ar="ملاحظات عامة"
          value={student.generalNotes || ''}
          onChange={(v) => onChange({ generalNotes: v })}
          onApplyAll={() => onUpdateAllStudents && onUpdateAllStudents({ generalNotes: student.generalNotes || '' })}
          showApplyAll={students.length > 1}
        />
      </div>

      {/* Received feedback */}
      {student.feedback?.submittedAt && (
        <div className="mt-4 rounded-2xl border border-emerald-300 bg-white p-3">
          <div className="text-xs text-emerald-700 mb-1">Feedback received {new Date(student.feedback.submittedAt).toLocaleString()}</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {FEEDBACK_QUESTIONS.map((q) => (
              <div key={q.key} className="rounded-lg bg-emerald-50 p-2 text-center">
                <div className="text-[10px] uppercase text-emerald-700">{q.key}</div>
                <div className="text-lg font-bold text-emerald-900">{student.feedback.ratings?.[q.key] ?? '—'}/5</div>
              </div>
            ))}
          </div>
          {student.feedback.comment && (
            <div className="mt-2 text-sm text-emerald-900 italic">“{student.feedback.comment}”</div>
          )}
        </div>
      )}
    </div>
  );
};

const Stat = ({ label, value, cls }) => (
  <div className={`rounded-2xl bg-gradient-to-br ${cls} text-white p-3 shadow`}>
    <div className="text-xs uppercase tracking-wider opacity-90">{label}</div>
    <div className="text-2xl font-bold mt-1">{value}</div>
  </div>
);

/* ─── Meeting prefill banner ──────────────────────────────────────────── */

const MeetingPrefillBanner = ({ meeting, onPrefill, onDismiss }) => {
  const start = meeting?.scheduledStart ? new Date(meeting.scheduledStart) : null;
  const end = meeting?.scheduledEnd ? new Date(meeting.scheduledEnd) : null;
  const guardianName = meeting?.guardianName
    || meeting?.bookingPayload?.guardianName
    || meeting?.attendees?.guardianName
    || 'Guardian';
  const studentNames = (Array.isArray(meeting?.students) && meeting.students.length
    ? meeting.students
    : (meeting?.bookingPayload?.students || []))
    .map((s) => s.studentName || s.name)
    .filter(Boolean)
    .join(', ');
  const range = start && end
    ? `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : '';
  return (
    <div className="mb-4 rounded-2xl border border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-full bg-emerald-600 text-white p-2 shrink-0">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-emerald-900">
              Meeting now: <bdi>{guardianName}</bdi>
            </div>
            <div className="text-xs text-emerald-800/80">
              {range}
              {studentNames && <> · Students: <bdi>{studentNames}</bdi></>}
            </div>
            {(meeting?.notes || meeting?.bookingPayload?.notes) && (
              <div className="text-[11px] text-emerald-700/80 mt-1 italic line-clamp-2">{meeting.notes || meeting.bookingPayload.notes}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onPrefill}
            className="px-3 py-1.5 rounded-full bg-emerald-700 text-white text-sm inline-flex items-center gap-1 shadow"
          ><Wand2 className="h-3.5 w-3.5" /> Prefill from meeting</button>
          <button
            type="button"
            onClick={onDismiss}
            className="px-2 py-1.5 rounded-full border border-emerald-300 bg-white text-emerald-800 text-xs inline-flex items-center gap-1"
            title="Dismiss banner"
          ><XCircle className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </div>
  );
};

const MeetingPickerModal = ({ loading, meetings, onClose, onPick }) => {
  const formatRange = (meeting) => {
    const start = meeting?.scheduledStart ? new Date(meeting.scheduledStart) : null;
    const end = meeting?.scheduledEnd ? new Date(meeting.scheduledEnd) : null;
    if (!start) return 'No time';
    const day = start.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const from = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const to = end ? end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `${day} · ${from}${to ? ` - ${to}` : ''}`;
  };

  const guardianNameOf = (meeting) => (
    meeting?.guardianName
    || meeting?.bookingPayload?.guardianName
    || meeting?.attendees?.guardianName
    || 'Guardian'
  );

  const studentsLabelOf = (meeting) => {
    const arr = Array.isArray(meeting?.students) && meeting.students.length
      ? meeting.students
      : (meeting?.bookingPayload?.students || []);
    return arr.map((s) => s.studentName || s.name).filter(Boolean).join(', ');
  };

  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-emerald-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-emerald-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-emerald-900">Pick a scheduled evaluation meeting</h3>
            <p className="text-xs text-emerald-700/80">Use this when the evaluation starts earlier than the booked slot.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 hover:text-slate-800" aria-label="Close meeting picker">
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3">
          {loading ? (
            <div className="py-10 text-center text-sm text-emerald-700">Loading meetings...</div>
          ) : meetings.length === 0 ? (
            <div className="py-10 text-center text-sm text-emerald-700/80">No nearby evaluation meetings found.</div>
          ) : (
            <div className="space-y-2">
              {meetings.map((meeting) => {
                const key = String(meeting?._id || Math.random());
                const students = studentsLabelOf(meeting);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onPick(meeting)}
                    className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-left transition hover:border-emerald-400 hover:bg-emerald-50"
                  >
                    <div className="text-sm font-semibold text-emerald-900">
                      <bdi>{guardianNameOf(meeting)}</bdi>
                    </div>
                    <div className="mt-0.5 text-xs text-emerald-700/90">
                      {formatRange(meeting)}
                      {students ? <> · Students: <bdi>{students}</bdi></> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─── Links ────────────────────────────────────────────────────────────── */

// Where guardians are sent to create their account + add students (the
// registration funnel). Kept as a single constant so the WhatsApp message and
// the email stay in sync.
const REGISTER_URL = 'https://app.waraqaweb.com/dashboard/register-student';

// Builds the post-evaluation WhatsApp message. Shared so the live "Open"
// button and the preview produce identical text.
const buildWhatsAppMessage = ({ name = '', links = [], feedbackLink = '' }) => {
  const greeting = `Assalāmu ʿalaykum ${name || ''},`.trim();
  const lines = [
    greeting,
    '',
    'Thank you for joining the evaluation with Waraqa today. Here are the next steps.',
    '',
    'Please create your account so that we can start the registration process:',
    '',
    REGISTER_URL,
    '',
    'After that we will send you a confirmation message with all confirmed classes details as soon as we assign you a teacher.',
  ];
  if (links.length) {
    lines.push('', 'Helpful links:');
    links.forEach((l) => lines.push(`* ${l.label}: ${l.url}`));
  }
  lines.push(
    '',
    "It was a pleasure meeting you. We'd love a quick note on how the session went — it should take less than a minute.",
  );
  if (feedbackLink) lines.push(feedbackLink);
  lines.push('', 'Looking forward to start!', 'Thank you');
  return lines.join('\n');
};

/* Email preview/edit modal shown before sending the feedback email. The admin
   can tweak the subject and intro text and see the rendered HTML. */
const EmailPreviewModal = ({ sessionId, student, links, onClose, onSend }) => {
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [intro, setIntro] = useState('');
  const [html, setHtml] = useState('');
  const [email, setEmail] = useState(student?.contactEmail || '');
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async (subjOverride, introOverride) => {
    if (!sessionId || !student?._id) return;
    setLoading(true);
    try {
      const { data } = await api.post(
        `/evaluations/${sessionId}/students/${student._id}/feedback-preview`,
        { links, subject: subjOverride, intro: introOverride },
      );
      setSubject((s) => (subjOverride != null ? subjOverride : (s || data.subject || '')));
      setIntro((s) => (introOverride != null ? introOverride : (s || data.defaultIntro || '')));
      setHtml(data.html || '');
      if (!email) setEmail(data.to || '');
    } catch {
      showToast('Failed to build email preview');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, student?._id, links]);

  useEffect(() => { refresh(); }, [refresh]);

  const doSend = async () => {
    if (!email) { showToast('Enter a recipient email'); return; }
    setSending(true);
    try {
      await onSend(email, { subject, intro });
      onClose();
    } finally {
      setSending(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-emerald-100 bg-emerald-50">
          <h3 className="text-sm font-semibold text-emerald-900 inline-flex items-center gap-2"><Send className="h-4 w-4" /> Preview & edit email</h3>
          <button type="button" onClick={onClose} className="text-emerald-700 hover:text-emerald-900">✕</button>
        </header>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className="eval-field-label">Recipient</label>
            <input className="eval-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </div>
          <div>
            <label className="eval-field-label">Subject</label>
            <input className="eval-input" value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={() => refresh(subject, intro)} />
          </div>
          <div>
            <label className="eval-field-label">Intro message</label>
            <textarea className="eval-input min-h-[90px]" value={intro} onChange={(e) => setIntro(e.target.value)} onBlur={() => refresh(subject, intro)} />
          </div>
          <div>
            <label className="eval-field-label">Preview</label>
            <div className="rounded-xl border border-emerald-100 overflow-hidden bg-white">
              {loading ? (
                <div className="p-6 text-center text-sm text-emerald-700">Building preview…</div>
              ) : (
                <iframe title="Email preview" srcDoc={html} className="w-full h-[320px] border-0" sandbox="" />
              )}
            </div>
          </div>
        </div>
        <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-emerald-100 bg-white">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-full border border-emerald-300 bg-white text-emerald-800 text-sm">Cancel</button>
          <button type="button" onClick={doSend} disabled={sending} className="px-4 py-1.5 rounded-full bg-emerald-700 text-white text-sm inline-flex items-center gap-1 disabled:opacity-50">
            <Send className="h-3 w-3" /> {sending ? 'Sending…' : 'Send email'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
};

const LinksSlide = ({
  session,
  students = [],
  activeStudentIdx = 0,
  onPickStudent,
  onUpdateStudent,
  onUpdateAllStudents,
  links = [],
  linksLoaded = true,
  onSaveLinks,
  whatsappNumber = '',
  onSaveWhatsappNumber,
  onSendFeedback,
}) => {
  const active = students[activeStudentIdx] || null;

  const [editingLinks, setEditingLinks] = useState(false);
  const [draftLinks, setDraftLinks] = useState(links);
  useEffect(() => { if (!editingLinks) setDraftLinks(links); }, [links, editingLinks]);

  const [waDraft, setWaDraft] = useState(whatsappNumber);
  useEffect(() => { setWaDraft(whatsappNumber); }, [whatsappNumber]);

  const [feedbackEmail, setFeedbackEmail] = useState(active?.contactEmail || '');
  const [feedbackLink, setFeedbackLink] = useState('');
  const [sending, setSending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    setFeedbackEmail(active?.contactEmail || '');
    setFeedbackLink('');
  }, [activeStudentIdx, active?.contactEmail]);

  const includedLinks = (links || []).filter((l) => l.includeInFeedback);

  const applyToAll = (patch) => {
    if (typeof onUpdateAllStudents === 'function') {
      onUpdateAllStudents(patch);
      showToast('Applied to all students');
    }
  };

  const copyAll = () => {
    const text = (links || []).map((l) => `${l.label}: ${l.url}`).join('\n');
    navigator.clipboard?.writeText(text);
    showToast('All links copied');
  };

  const sendFeedbackEmail = async (overrides = {}) => {
    if (!active?._id) { showToast('Save the session first'); return; }
    if (!feedbackEmail) { showToast('Please enter an email first'); return; }
    setSending(true);
    try {
      const link = await onSendFeedback(feedbackEmail, { links: includedLinks, ...overrides });
      if (link) setFeedbackLink(link);
    } finally {
      setSending(false);
    }
  };

  const sendWhatsApp = async () => {
    if (!active) return;
    const phoneRaw = (active.contactPhone || whatsappNumber || '').trim();
    if (!phoneRaw) { showToast('Add a contact phone or default WhatsApp number first'); return; }
    const digits = phoneRaw.replace(/[^\d]/g, '');
    if (!digits) { showToast('Phone number is not valid'); return; }
    // Make sure a feedback link exists so it can be woven into the message.
    let link = feedbackLink;
    if (!link && active._id && session?._id) {
      try {
        const { data } = await api.post(`/evaluations/${session._id}/students/${active._id}/feedback-link`);
        link = data?.link || '';
        if (link) setFeedbackLink(link);
      } catch {
        /* fall back to a message without the feedback link */
      }
    }
    const body = buildWhatsAppMessage({ name: active.name, links: includedLinks, feedbackLink: link });
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const addLink = () => {
    setDraftLinks([...draftLinks, { label: '', url: '', description: '', includeInFeedback: true }]);
  };
  const updateDraftLink = (idx, patch) => {
    setDraftLinks(draftLinks.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const removeDraftLink = (idx) => {
    setDraftLinks(draftLinks.filter((_, i) => i !== idx));
  };
  const saveDraftLinks = async () => {
    const cleaned = draftLinks
      .map((l) => ({
        label: (l.label || '').trim(),
        url: (l.url || '').trim(),
        description: (l.description || '').trim(),
        includeInFeedback: Boolean(l.includeInFeedback),
      }))
      .filter((l) => l.label && l.url);
    await onSaveLinks(cleaned);
    setEditingLinks(false);
    showToast('Important links saved');
  };

  const toggleIncluded = (idx) => {
    const next = links.map((l, i) => (i === idx ? { ...l, includeInFeedback: !l.includeInFeedback } : l));
    onSaveLinks(next);
  };

  return (
    <div>
      {students.length > 0 && active && (
        <div className="mb-5">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-lg font-semibold text-emerald-900">Wrap-up details</h3>
            <span className="font-naskh text-emerald-700/80 text-sm" dir="rtl">تفاصيل الختام</span>
          </div>

          {students.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {students.map((s, i) => (
                <button
                  key={s._id || i}
                  type="button"
                  onClick={() => onPickStudent && onPickStudent(i)}
                  className={`px-2.5 py-1 rounded-full text-[11px] inline-flex items-center gap-1 border font-display-en ${
                    i === activeStudentIdx ? 'bg-emerald-600 text-white border-emerald-600 shadow' : 'bg-white/70 border-emerald-200 text-emerald-800'
                  }`}
                >
                  <bdi>{s.name || `Student ${i + 1}`}</bdi>
                </button>
              ))}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <WrapUpField
              label="Contact email"
              ar="البريد الإلكتروني"
              value={active.contactEmail || ''}
              onChange={(v) => onUpdateStudent({ contactEmail: v })}
              onApplyAll={() => applyToAll({ contactEmail: active.contactEmail || '' })}
              showApplyAll={students.length > 1}
              placeholder="name@example.com"
            />
            <WrapUpField
              label="Contact phone"
              ar="رقم الهاتف"
              value={active.contactPhone || ''}
              onChange={(v) => onUpdateStudent({ contactPhone: v })}
              onApplyAll={() => applyToAll({ contactPhone: active.contactPhone || '' })}
              showApplyAll={students.length > 1}
              placeholder="+1 555 123 4567"
            />
          </div>
        </div>
      )}

      {/* Important links */}
      <div className="mb-6 rounded-2xl border border-emerald-100 bg-white/60 p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold text-emerald-900 inline-flex items-center gap-2">
              <LinkIcon className="h-4 w-4" /> Important links
            </h3>
            <p className="text-xs text-emerald-700/70">Tick the ones to include in the feedback email & WhatsApp message.</p>
          </div>
          <div className="flex items-center gap-2">
            {!editingLinks && (
              <>
                <button type="button" onClick={copyAll} className="text-xs px-2.5 py-1 rounded-full border border-emerald-300 bg-white text-emerald-800 inline-flex items-center gap-1">
                  <Copy className="h-3 w-3" /> Copy all
                </button>
                <button type="button" onClick={() => setEditingLinks(true)} className="text-xs px-2.5 py-1 rounded-full bg-emerald-700 text-white inline-flex items-center gap-1">
                  <Pencil className="h-3 w-3" /> Edit links
                </button>
              </>
            )}
            {editingLinks && (
              <>
                <button type="button" onClick={() => { setEditingLinks(false); setDraftLinks(links); }} className="text-xs px-2.5 py-1 rounded-full border border-emerald-300 bg-white text-emerald-800">
                  Cancel
                </button>
                <button type="button" onClick={saveDraftLinks} className="text-xs px-2.5 py-1 rounded-full bg-emerald-700 text-white inline-flex items-center gap-1">
                  <Save className="h-3 w-3" /> Save
                </button>
              </>
            )}
          </div>
        </div>

        {!linksLoaded && <div className="text-sm text-emerald-700">Loading links…</div>}

        {editingLinks ? (
          <div className="space-y-2">
            {draftLinks.map((l, idx) => (
              <div key={idx} className="rounded-xl border border-emerald-100 bg-white/80 p-3">
                <div className="grid sm:grid-cols-2 gap-2">
                  <input
                    className="eval-input"
                    placeholder="Label (e.g. Pricing)"
                    value={l.label}
                    onChange={(e) => updateDraftLink(idx, { label: e.target.value })}
                  />
                  <input
                    className="eval-input"
                    placeholder="https://…"
                    value={l.url}
                    onChange={(e) => updateDraftLink(idx, { url: e.target.value })}
                  />
                </div>
                <input
                  className="eval-input mt-2"
                  placeholder="Short description (shown in the email)"
                  value={l.description}
                  onChange={(e) => updateDraftLink(idx, { description: e.target.value })}
                />
                <div className="mt-2 flex items-center justify-between">
                  <label className="inline-flex items-center gap-1.5 text-xs text-emerald-800">
                    <input
                      type="checkbox"
                      checked={Boolean(l.includeInFeedback)}
                      onChange={(e) => updateDraftLink(idx, { includeInFeedback: e.target.checked })}
                    />
                    Include by default in feedback email & WhatsApp
                  </label>
                  <button type="button" onClick={() => removeDraftLink(idx)} className="text-rose-700 hover:text-rose-900 text-xs inline-flex items-center gap-1">
                    <Trash2 className="h-3 w-3" /> Remove
                  </button>
                </div>
              </div>
            ))}
            <button type="button" onClick={addLink} className="text-xs px-3 py-1.5 rounded-full border border-dashed border-emerald-400 text-emerald-800 inline-flex items-center gap-1">
              <Plus className="h-3 w-3" /> Add link
            </button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {(links || []).map((l, idx) => (
              <div key={`${l.url}-${idx}`} className="rounded-xl border border-emerald-100 bg-white/80 p-3 flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={Boolean(l.includeInFeedback)}
                  onChange={() => toggleIncluded(idx)}
                  title="Include in feedback email & WhatsApp"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-emerald-900 truncate">{l.label}</div>
                  <a className="text-xs text-emerald-700 underline truncate block" href={l.url} target="_blank" rel="noreferrer">{l.url}</a>
                  {l.description && <div className="text-[11px] text-emerald-700/80 mt-0.5">{l.description}</div>}
                </div>
                <button type="button" onClick={() => { navigator.clipboard?.writeText(l.url); showToast('Copied'); }}
                  className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs inline-flex items-center gap-1 shrink-0">
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            ))}
            {(!links || links.length === 0) && linksLoaded && (
              <div className="text-sm text-emerald-700/80 italic col-span-full">No links yet. Click <strong>Edit links</strong> to add some.</div>
            )}
          </div>
        )}
      </div>

      {/* WhatsApp default number */}
      <div className="mb-6 rounded-2xl border border-emerald-100 bg-white/60 p-4">
        <div className="flex items-baseline justify-between mb-2">
          <h4 className="text-sm font-semibold text-emerald-900 inline-flex items-center gap-2">
            <MessageCircle className="h-4 w-4" /> Default WhatsApp number
          </h4>
          <span className="text-[11px] text-emerald-700/70">Used when the student has no contact phone</span>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="eval-input flex-1"
            placeholder="+1 555 123 4567"
            value={waDraft}
            onChange={(e) => setWaDraft(e.target.value)}
            onBlur={() => {
              if (waDraft !== whatsappNumber) onSaveWhatsappNumber(waDraft);
            }}
          />
        </div>
      </div>

      {/* Closing actions */}
      <div className="mb-4 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-white p-4">
        <h4 className="text-sm font-semibold text-emerald-900 mb-3 inline-flex items-center gap-1">
          <Send className="h-4 w-4" /> Closing actions for <bdi>{active?.name || 'this student'}</bdi>
        </h4>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="eval-field-label">Feedback email</label>
            <div className="flex gap-2">
              <input
                className="eval-input flex-1"
                placeholder="name@example.com"
                value={feedbackEmail}
                onChange={(e) => setFeedbackEmail(e.target.value)}
              />
              <button
                type="button"
                onClick={() => {
                  if (!active?._id) { showToast('Save the session first'); return; }
                  if (!feedbackEmail) { showToast('Please enter an email first'); return; }
                  setPreviewOpen(true);
                }}
                disabled={sending}
                className="px-3 py-1.5 rounded-full bg-emerald-700 text-white text-sm inline-flex items-center gap-1 disabled:opacity-50"
              ><Send className="h-3 w-3" /> Preview &amp; send</button>
            </div>
            {feedbackLink && (
              <div className="mt-2 text-[11px] flex items-center gap-2 text-emerald-800 break-all">
                <LinkIcon className="h-3 w-3" />
                <a href={feedbackLink} className="underline flex-1 min-w-0 truncate" target="_blank" rel="noreferrer">{feedbackLink}</a>
                <button type="button" className="text-emerald-700 underline shrink-0" onClick={() => { navigator.clipboard?.writeText(feedbackLink); showToast('Link copied'); }}>Copy</button>
              </div>
            )}
            <div className="text-[11px] text-emerald-700/70 mt-1">
              {includedLinks.length > 0
                ? `Will include ${includedLinks.length} important link${includedLinks.length === 1 ? '' : 's'}.`
                : 'No links will be included — tick links above to add them.'}
            </div>
          </div>

          <div>
            <label className="eval-field-label">WhatsApp message</label>
            <div className="flex gap-2">
              <input
                className="eval-input flex-1"
                placeholder="Phone (uses student's, then default)"
                value={active?.contactPhone || whatsappNumber}
                readOnly
              />
              <button
                type="button"
                onClick={sendWhatsApp}
                className="px-3 py-1.5 rounded-full bg-emerald-600 text-white text-sm inline-flex items-center gap-1"
              ><MessageCircle className="h-3 w-3" /> Open</button>
            </div>
            <div className="text-[11px] text-emerald-700/70 mt-1">Opens WhatsApp Web with a prefilled message including the selected links.</div>
          </div>
        </div>
      </div>

      {previewOpen && active && (
        <EmailPreviewModal
          sessionId={session?._id}
          student={active}
          links={includedLinks}
          onClose={() => setPreviewOpen(false)}
          onSend={async (email, opts) => {
            const link = await onSendFeedback(email, { links: includedLinks, ...opts });
            if (link) setFeedbackLink(link);
          }}
        />
      )}
    </div>
  );
};

const WrapUpField = ({ label, ar, value, onChange, onApplyAll, showApplyAll, placeholder, textarea, full }) => (
  <div className={full ? 'sm:col-span-2' : ''}>
    <div className="flex items-baseline justify-between mb-1">
      <label className="eval-field-label">
        {label} {ar && <span dir="rtl" className="font-naskh">· {ar}</span>}
      </label>
      {showApplyAll && (
        <button
          type="button"
          onClick={onApplyAll}
          className="text-[10px] font-display-en text-emerald-700 hover:text-emerald-900 underline"
          title="Copy this value to every student in the session"
        >Apply to all students</button>
      )}
    </div>
    {textarea ? (
      <textarea
        className="eval-input min-h-[52px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    ) : (
      <input
        className="eval-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    )}
  </div>
);

/* ─── Availability slots editor (create-class-modal style) ──────────────── */

const DOW = [
  { v: 0, label: 'Sun' }, { v: 1, label: 'Mon' }, { v: 2, label: 'Tue' },
  { v: 3, label: 'Wed' }, { v: 4, label: 'Thu' }, { v: 5, label: 'Fri' }, { v: 6, label: 'Sat' },
];

const AvailabilitySlotsEditor = ({ student, onChange }) => {
  const slots = Array.isArray(student.availabilitySlots) ? student.availabilitySlots : [];
  const timezone = student.availabilityTimezone || DEFAULT_TIMEZONE;
  const [duration, setDuration] = useState(30);

  const patchSlot = (idx, patch) => {
    const next = slots.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange({ availabilitySlots: next });
  };
  const addSlot = (seed) => {
    const base = seed || slots[slots.length - 1] || { day: 1, start: '17:00', durationMinutes: duration };
    const nextDay = ((Number(base.day) || 0) + 1) % 7;
    const start = base.start || '17:00';
    onChange({
      availabilitySlots: [
        ...slots,
        { day: nextDay, start, end: base.end || addMinutesToTime(start, base.durationMinutes || duration), durationMinutes: base.durationMinutes || duration },
      ],
    });
  };
  const removeSlot = (idx) => onChange({ availabilitySlots: slots.filter((_, i) => i !== idx) });

  return (
    <div className="sm:col-span-2 rounded-2xl border border-emerald-200 bg-white/60 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <label className="eval-field-label">Availability · <span dir="rtl" className="font-naskh">المواعيد المتاحة</span></label>
        <span className="text-[10px] text-emerald-700/60">Same style as create-class: pick a day, a start time and (optionally) an end time.</span>
      </div>

      <div className="grid sm:grid-cols-3 gap-2 mb-3">
        <div>
          <label className="block text-[10px] text-emerald-700/80 mb-0.5">Student's timezone (converted to Cairo for the teacher)</label>
          <select
            className="eval-input"
            value={timezone}
            onChange={(e) => onChange({ availabilityTimezone: e.target.value })}
          >
            {TIMEZONE_LIST.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-emerald-700/80 mb-0.5">Default class duration (min)</label>
          <input
            type="number"
            min={5}
            step={5}
            className="eval-input"
            value={duration}
            onChange={(e) => setDuration(Math.max(5, Number(e.target.value) || 30))}
          />
        </div>
        <div>
          <label className="block text-[10px] text-emerald-700/80 mb-0.5">Expected starting date</label>
          <input
            type="date"
            className="eval-input"
            value={student.expectedStartDate || ''}
            onChange={(e) => onChange({ expectedStartDate: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        {slots.map((s, idx) => (
          <div key={idx} className="flex flex-wrap items-end gap-2 rounded-xl border border-emerald-100 bg-white/80 p-2">
            <div>
              <label className="block text-[10px] text-emerald-700/80 mb-0.5">Day</label>
              <select
                className="eval-input"
                value={Number(s.day)}
                onChange={(e) => patchSlot(idx, { day: Number(e.target.value) })}
              >
                {DOW.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-emerald-700/80 mb-0.5">Start</label>
              <input
                type="time"
                className="eval-input"
                value={s.start || ''}
                onChange={(e) => {
                  const start = e.target.value;
                  // Auto-fill end from the duration; the admin can still override it.
                  patchSlot(idx, { start, end: addMinutesToTime(start, s.durationMinutes || duration) });
                }}
              />
            </div>
            <div>
              <label className="block text-[10px] text-emerald-700/80 mb-0.5">End (window)</label>
              <input
                type="time"
                className="eval-input"
                value={s.end || ''}
                onChange={(e) => patchSlot(idx, { end: e.target.value })}
              />
            </div>
            <button
              type="button"
              onClick={() => addSlot(s)}
              className="px-2 py-1.5 rounded-full border border-emerald-300 bg-white text-emerald-800 text-[11px] inline-flex items-center gap-1"
              title="Duplicate this slot to the next day"
            ><Copy className="h-3 w-3" /> Duplicate</button>
            <button
              type="button"
              onClick={() => removeSlot(idx)}
              className="px-2 py-1.5 rounded-full border border-rose-200 bg-white text-rose-700 text-[11px] inline-flex items-center gap-1"
            ><Trash2 className="h-3 w-3" /></button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => addSlot()}
          className="text-xs px-3 py-1.5 rounded-full border border-dashed border-emerald-400 text-emerald-800 inline-flex items-center gap-1"
        ><Plus className="h-3 w-3" /> Add availability slot</button>
      </div>
    </div>
  );
};

/* ─── History drawer ───────────────────────────────────────────────────── */

const HistoryDrawer = ({ history, loading, currentId, onClose, onOpen, onNew, onDelete }) => {
  const [query, setQuery] = useState('');

  const formatSessionDate = useCallback((value) => {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '';
    const day = dt.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
    const time = dt.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    return `${day} ${time}`;
  }, []);

  const studentHoverText = useCallback((student = {}, idx = 0) => {
    const lines = [];
    lines.push(student.name || `Student ${idx + 1}`);
    const contacts = [
      student.contactName ? `Guardian: ${student.contactName}` : '',
      student.contactEmail ? `Email: ${student.contactEmail}` : '',
      student.contactPhone ? `Phone: ${student.contactPhone}` : '',
    ].filter(Boolean);
    if (contacts.length) lines.push(contacts.join(' · '));
    if (student.generalNotes) lines.push(`Notes: ${student.generalNotes}`);
    if (!contacts.length && !student.generalNotes) lines.push('No extra details saved');
    return lines.join('\n');
  }, []);

  const filteredHistory = useMemo(() => {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) return history || [];

    return (history || []).filter((session) => {
      const studentText = (session.students || [])
        .map((student) => [student.name, student.contactName, student.contactEmail, student.contactPhone, student.generalNotes]
          .filter(Boolean)
          .join(' '))
        .join(' ')
        .toLowerCase();
      const haystack = [session.title, session.status, studentText, session.endedAt, session.updatedAt, session.createdAt]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [history, query]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-emerald-200 bg-gradient-to-r from-emerald-700 to-teal-700 px-4 py-3 text-white">
          <div className="flex items-center gap-2"><History className="h-4 w-4" /><h3 className="font-semibold">Past evaluations</h3></div>
          <button type="button" onClick={onClose} className="text-sm opacity-90 hover:opacity-100">Close</button>
        </header>
        <div className="border-b border-emerald-100 p-3 space-y-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, student, phone, notes..."
            className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
          />
          <button type="button" onClick={onNew}
            className="w-full inline-flex items-center justify-center gap-1 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-2 text-sm text-white">
            <Plus className="h-4 w-4" /> New session
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-6 text-sm text-emerald-700 text-center">Loading…</div>}
          {!loading && filteredHistory.length === 0 && (
            <div className="p-6 text-sm text-emerald-700 text-center">No sessions yet.</div>
          )}
          {!loading && filteredHistory.map((s) => {
            const isCurrent = s._id === currentId;
            const studentsCount = (s.students || []).length;
            const feedbackCount = (s.students || []).filter((st) => st.feedback?.submittedAt).length;
            const when = s.endedAt || s.updatedAt || s.createdAt;
            const displayDate = formatSessionDate(when);
            const isAutoTitle = /^Evaluation\s+\d{4}-\d{2}-\d{2}/i.test(String(s.title || ''));
            const displayTitle = isAutoTitle ? 'Evaluation session' : (s.title || 'Untitled evaluation');
            const accentClass = s.status === 'completed'
              ? 'border-sky-200 bg-sky-50/70'
              : 'border-emerald-200 bg-emerald-50/70';

            return (
              <div key={s._id} className={`border-b ${isCurrent ? 'bg-emerald-50' : ''}`}>
                <div className={`mx-3 my-3 rounded-2xl border p-3 shadow-sm ${accentClass}`}>
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => onOpen(s._id)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-base font-semibold text-slate-900">{displayTitle}</div>
                      <div className="mt-1 text-xs font-medium text-slate-700">
                        {studentsCount} student{studentsCount === 1 ? '' : 's'} · {feedbackCount} feedback · <span className={s.status === 'active' ? 'text-emerald-700' : 'text-sky-700'}>{s.status}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">{displayDate}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(s.students || []).map((student, idx) => (
                          <span
                            key={`${student._id || student.name || 'student'}-${idx}`}
                            title={studentHoverText(student, idx)}
                            className="inline-flex max-w-full cursor-help items-center rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-900"
                          >
                            <span className="truncate">{student.name || `Student ${idx + 1}`}</span>
                          </span>
                        ))}
                        {studentsCount === 0 && (
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">Student</span>
                        )}
                      </div>
                    </button>
                    <button type="button" onClick={() => onDelete(s._id)} className="rounded-full p-1.5 text-rose-600 transition hover:bg-white hover:text-rose-700" title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
};

export default EvaluationPage;
