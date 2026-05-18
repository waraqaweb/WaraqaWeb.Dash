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
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import { showToast } from '../../utils/toast';
import {
  IMPORTANT_LINKS, DEFAULT_BIO,
  READING_LETTERS, READING_WORDS,
  QURAN_PASSAGES, TAJWEED_THEORY, TAJWEED_PRACTICAL,
  WEAKNESS_AREAS, FEEDBACK_QUESTIONS,
  ARABIC_SKILLS,
} from '../../data/evaluationContent';
import { SURAHS } from '../../data/surahs';
import '../../styles/quran-fonts.css';
import {
  ChevronRight, ChevronLeft, ChevronDown, Plus, Trash2, Copy, CheckCircle2,
  XCircle, MinusCircle, Send, Link as LinkIcon, Users,
  History, Maximize2, Minimize2, Shuffle, Pencil, Save,
  ArrowUp, ArrowDown, RefreshCw, BookOpen, Flag, Sparkles,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';

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
  { key: 'tajweed-theory',    title: 'Tajweed · Theory',        ar: 'تجويد · نظري',          icon: '🎓', testable: true },
  { key: 'tajweed-practical', title: 'Tajweed · Practical',     ar: 'تجويد · تطبيقي',        icon: '🎧', testable: true },
  { key: 'arabic-skills',     title: 'Arabic Skills',           ar: 'مهارات العربية',        icon: '🌐', testable: true },
  { key: 'summary',           title: 'Summary & next steps',    ar: 'الخلاصة',               testable: false },
  { key: 'links',             title: 'Important links',         ar: 'روابط مهمة',            testable: false },
];

const VERDICTS = [
  { v: 'correct',   label: 'Correct',   icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  { v: 'partial',   label: 'Partial',   icon: MinusCircle,  cls: 'bg-amber-100 text-amber-700 border-amber-300' },
  { v: 'incorrect', label: 'Incorrect', icon: XCircle,      cls: 'bg-rose-100 text-rose-700 border-rose-300' },
  { v: 'skipped',   label: 'Skipped',   icon: MinusCircle,  cls: 'bg-zinc-100 text-zinc-700 border-zinc-300' },
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
  contactEmail: '',
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
  const [branding, setBranding] = useState({ title: 'Waraqa', slogan: '', logoUrl: null });
  const [customContent, setCustomContent] = useState(() => loadCustom(adminId));
  const [selectedSections, setSelectedSections] = useState([]);
  const [welcomeShown, setWelcomeShown] = useState(true);
  const [sideMenuHidden, setSideMenuHidden] = useState(false);

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
          const { data: created } = await api.post('/evaluations', { title: '' });
          if (cancel) return;
          setSession({ ...created.session, students: [emptyStudent()] });
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
  const persist = useCallback((next) => {
    if (!next?._id) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        setSaving(true);
        await api.put(`/evaluations/${next._id}`, {
          title: next.title,
          status: next.status,
          students: next.students || [],
        });
      } catch (err) {
        console.error('Autosave failed', err);
      } finally {
        setSaving(false);
      }
    }, 600);
  }, []);

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
  const goTo = (key) => {
    const i = visibleSections.findIndex((s) => s.key === key);
    if (i >= 0) { setSectionIdx(i); setWelcomeShown(false); }
  };

  const startEvaluation = () => {
    setWelcomeShown(false);
    setSectionIdx(0);
  };

  const endTest = () => {
    if (!window.confirm('End this evaluation and mark it completed?')) return;
    updateSession((prev) => ({ ...prev, status: 'completed', endedAt: new Date().toISOString() }));
    goTo('summary');
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
        onPickStudent={(i) => setActiveStudentIdx(i)}
        onAddStudent={() => addStudentInline()}
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
            <WelcomeSlide
              branding={branding}
              adminName={adminName}
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
                {section.key === 'tajweed-theory' && (
                  <TajweedTheorySlide
                    student={activeStudent}
                    onAnswer={upsertAnswer}
                    editorOn={editorOn}
                    custom={customContent.tajweedTheory}
                    setCustom={(p) => setCustom('tajweedTheory', p)}
                    resetCustom={() => resetCustom('tajweedTheory')}
                  />
                )}
                {section.key === 'tajweed-practical' && (
                  <TajweedPracticalSlide
                    student={activeStudent}
                    onAnswer={upsertAnswer}
                    editorOn={editorOn}
                    custom={customContent.tajweedPractical}
                    setCustom={(p) => setCustom('tajweedPractical', p)}
                    resetCustom={() => resetCustom('tajweedPractical')}
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
                    onChange={updateStudent}
                    onSendFeedback={async (email) => {
                      try {
                        const { data } = await api.post(
                          `/evaluations/${session._id}/students/${activeStudent._id || ''}/send-feedback`,
                          { email },
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
                {section.key === 'links' && <LinksSlide />}
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

        {/* Right rail — actions */}
        <aside className="eval-rail-right">
          <button
            type="button"
            className="rail-btn"
            title={sideMenuHidden ? 'Show dashboard menu' : 'Hide dashboard menu'}
            onClick={() => setSideMenuHidden((x) => !x)}
          >
            {sideMenuHidden ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            <span className="rb-cap">{sideMenuHidden ? 'Show' : 'Hide'}</span>
          </button>
          <button type="button" className="rail-btn" title="Welcome / pick subjects" onClick={() => setWelcomeShown(true)}>
            <Sparkles className="h-5 w-5" />
            <span className="rb-cap">Welcome</span>
          </button>
          <button type="button" className="rail-btn" title={editorOn ? 'Stop editing' : 'Customize items'} onClick={() => setEditorOn((x) => !x)}>
            <Pencil className="h-5 w-5" />
            <span className="rb-cap">{editorOn ? 'Done' : 'Edit'}</span>
          </button>
          <button type="button" className="rail-btn" title="Past sessions" onClick={openHistory}>
            <History className="h-5 w-5" />
            <span className="rb-cap">History</span>
          </button>
          <button type="button" className="rail-btn" title={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            <span className="rb-cap">{fullscreen ? 'Exit' : 'Full'}</span>
          </button>
          <div className="flex-1" />
          <button type="button" className="rail-btn is-danger" title="End and mark completed" onClick={endTest}>
            <Flag className="h-5 w-5" />
            <span className="rb-cap">Finish</span>
          </button>
        </aside>
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
    </div>
  );
};

/* ─── Branded top bar (compact) ────────────────────────────────────────── */

const BrandedHeader = ({
  branding, adminName, saving, sessionStatus,
  students, activeStudentIdx, onPickStudent, onAddStudent,
}) => (
  <header className="eval-topbar px-4 py-2.5">
    <div className="mx-auto max-w-[1400px] flex items-center gap-3 flex-wrap">
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

      <div className="flex items-center gap-1.5 ms-auto flex-wrap">
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
        <div className="hidden sm:block text-[11px] text-emerald-700/70 ms-2 font-display-en">
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
  branding, adminName, bio, onBioChange,
  activeStudent, onUpdateStudent,
  students, activeStudentIdx,
  onPickStudent, onAddStudent, onRenameStudent, onRemoveStudent,
  allSections, selected, onToggle, onStart,
}) => {
  const [step, setStep] = useState('evaluator'); // 'evaluator' | 'student' | 'subjects'
  const [newName, setNewName] = useState('');
  const [editingBio, setEditingBio] = useState(false);
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
      <span className={`welcome-step ${step === 'evaluator' ? 'is-on' : 'is-done'}`}>
        <span className="num">١</span> <bdi>Meet evaluator</bdi>
      </span>
      <span className="welcome-step-sep" />
      <span className={`welcome-step ${step === 'student' ? 'is-on' : step === 'subjects' ? 'is-done' : ''}`}>
        <span className="num">٢</span> <bdi>About you</bdi>
      </span>
      <span className="welcome-step-sep" />
      <span className={`welcome-step ${step === 'subjects' ? 'is-on' : ''}`}>
        <span className="num">٣</span> <bdi>Subjects</bdi>
      </span>
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
                  <span className="dot">١</span>
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
                <label className="eval-field-label">Contact email · <span dir="rtl" className="font-naskh">البريد الإلكتروني</span></label>
                <input className="eval-input" placeholder="name@example.com" value={activeStudent.contactEmail || ''} onChange={(e) => onUpdateStudent({ contactEmail: e.target.value })} />
              </div>
              <div className="full">
                <label className="eval-field-label">Availability · <span dir="rtl" className="font-naskh">المواعيد المتاحة</span></label>
                <textarea className="eval-input min-h-[52px]" value={activeStudent.availability || ''} onChange={(e) => onUpdateStudent({ availability: e.target.value })} />
              </div>
              <div className="full">
                <label className="eval-field-label">General notes · <span dir="rtl" className="font-naskh">ملاحظات عامة</span></label>
                <textarea className="eval-input min-h-[52px]" value={activeStudent.generalNotes || ''} onChange={(e) => onUpdateStudent({ generalNotes: e.target.value })} />
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
      <Field label="Contact email"><input className="eval-input" value={student.contactEmail || ''} onChange={(e) => onChange({ contactEmail: e.target.value })} /></Field>
      <Field label="Availability" full>
        <textarea className="eval-input min-h-[60px]" value={student.availability || ''} onChange={(e) => onChange({ availability: e.target.value })} />
      </Field>
      <Field label="General notes" full>
        <textarea className="eval-input min-h-[80px]" value={student.generalNotes || ''} onChange={(e) => onChange({ generalNotes: e.target.value })} />
      </Field>
    </div>
  </div>
);

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
 * • Clicking a tile toggles it into a "tested / pending" state (dimmed, dashed amber).
 * • Re-clicking removes it (back to default), or — if already graded — clears the
 *   grade and puts the tile back into pending.
 * • Section-level Correct/Partial/Incorrect button then bulk-applies that verdict
 *   to ALL currently-pending tiles in that group and clears the pending set.
 */
const useTileTesting = ({ items, qid, section, level, groupTitle, answers, onAnswer }) => {
  const [pending, setPending] = useState(() => new Set());

  const itemQid = (idx) => `${qid}.t${idx}`;
  const verdictOf = (idx) => {
    const a = answers.find((x) => x.questionId === itemQid(idx));
    const v = a?.expertVerdict;
    return v && v !== 'na' ? v : null;
  };

  const togglePending = (idx) => {
    const current = verdictOf(idx);
    if (current) {
      // Clear existing grade and queue for re-grading
      onAnswer({ questionId: itemQid(idx), section, level, prompt: `${groupTitle} · ${items[idx]}`, expertVerdict: 'na' });
      setPending((prev) => { const n = new Set(prev); n.add(idx); return n; });
    } else {
      setPending((prev) => {
        const n = new Set(prev);
        if (n.has(idx)) n.delete(idx); else n.add(idx);
        return n;
      });
    }
  };

  const applyPending = (verdict) => {
    if (!pending.size) return false;
    pending.forEach((idx) => {
      onAnswer({
        questionId: itemQid(idx),
        section,
        level,
        prompt: `${groupTitle} · ${items[idx]}`,
        expertVerdict: verdict,
      });
    });
    setPending(new Set());
    return true;
  };

  const counts = useMemo(() => {
    const c = { graded: 0, pending: pending.size, total: items.length };
    items.forEach((_, idx) => { if (verdictOf(idx)) c.graded += 1; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, pending, answers]);

  return { pending, togglePending, verdictOf, applyPending, counts };
};

/* ─── Reading · Letters ────────────────────────────────────────────────── */

const ReadingLettersSlide = ({ student, onChange, onAnswer, editorOn, custom, setCustom, resetCustom }) => {
  const level = student.difficulty?.reading || 'easy';
  const catalog = READING_LETTERS[level] || { groups: [] };
  const baseGroups = (catalog.groups || []).map((g) => ({ id: g.id, title: g.title, note: g.note, items: g.letters || g.items || [] }));
  const groups = (custom && custom[level]) || baseGroups;
  const [shuffleSeed, setShuffleSeed] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shuffledByGroup = useMemo(() => groups.map((g) => shuffle(g.items || [])), [shuffleSeed, groups]);

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
  const allGraded = tiles.counts.total > 0 && tiles.counts.graded === tiles.counts.total && tiles.counts.pending === 0;
  return (
    <div
      dir={dir}
      className={`rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm transition-opacity ${allGraded ? 'opacity-70 hover:opacity-100' : ''}`}
    >
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-base font-bold text-emerald-900 truncate">{g.title}</div>
          {g.note && <div className="text-sm text-emerald-700">{g.note}</div>}
          <div className="text-[11px] text-emerald-700/80 mt-1">
            {tiles.counts.graded}/{tiles.counts.total} graded
            {tiles.counts.pending > 0 && (
              <span className="ml-2 text-amber-700 font-semibold">· {tiles.counts.pending} tested</span>
            )}
          </div>
        </div>
        <VerdictRow
          answer={null}
          onChange={(v) => {
            const ok = tiles.applyPending(v);
            if (!ok) showToast('Click the tiles you tested first');
          }}
        />
      </div>

      <div className="letter-row">
        {items.map((ch, idx) => {
          const v = tiles.verdictOf(idx);
          const isPending = tiles.pending.has(idx);
          const cls = [
            'letter-tile',
            v ? tileVerdictClass(v) : '',
            isPending ? 'letter-tile-pending' : '',
          ].filter(Boolean).join(' ');
          return (
            <button
              key={`${ch}-${idx}`}
              type="button"
              onClick={() => tiles.togglePending(idx)}
              className={cls}
              style={{ background: TILE_GRADIENTS[(gi * 7 + idx) % TILE_GRADIENTS.length] }}
              title={`${ch}${v ? ` · ${v}` : isPending ? ' · tested' : ''}`}
            >
              {ch}
            </button>
          );
        })}
      </div>

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
  const items = (custom && custom[level]) || fromCatalog;
  const [shuffleSeed, setShuffleSeed] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ordered = useMemo(() => shuffle(items), [shuffleSeed, items]);

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
          <button type="button" onClick={() => setShuffleSeed((x) => x + 1)} className="px-2 py-1 rounded-full border border-emerald-200 bg-white/70 text-xs text-emerald-800 inline-flex items-center gap-1">
            <Shuffle className="h-3 w-3" /> Shuffle
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
  const allGraded = tiles.counts.total > 0 && tiles.counts.graded === tiles.counts.total && tiles.counts.pending === 0;
  return (
    <div
      dir={dir}
      className={`rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm transition-opacity ${allGraded ? 'opacity-70 hover:opacity-100' : ''}`}
    >
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-base font-bold text-emerald-900 truncate">{g.title}</div>
          {g.note && <div className="text-sm text-emerald-700">{g.note}</div>}
          <div className="text-[11px] text-emerald-700/80 mt-1">
            {tiles.counts.graded}/{tiles.counts.total} graded
            {tiles.counts.pending > 0 && (
              <span className="ml-2 text-amber-700 font-semibold">· {tiles.counts.pending} tested</span>
            )}
          </div>
        </div>
        <VerdictRow
          answer={null}
          onChange={(v) => {
            const ok = tiles.applyPending(v);
            if (!ok) showToast('Click the tiles you tested first');
          }}
        />
      </div>
      <div className="letter-row row-word">
        {rawItems.map((w, idx) => {
          const text = diacritics ? w : stripDiacritics(w);
          const v = tiles.verdictOf(idx);
          const isPending = tiles.pending.has(idx);
          const cls = [
            'letter-tile word',
            v ? tileVerdictClass(v) : '',
            isPending ? 'letter-tile-pending' : '',
          ].filter(Boolean).join(' ');
          return (
            <button
              key={`${w}-${idx}`}
              type="button"
              onClick={() => tiles.togglePending(idx)}
              className={cls}
              style={{ background: TILE_GRADIENTS[(gi * 5 + idx) % TILE_GRADIENTS.length] }}
              title={`${text}${v ? ` · ${v}` : isPending ? ' · tested' : ''}`}
            >{text}</button>
          );
        })}
      </div>

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

const QuranSlide = ({ student, onAnswer, font, onChangeFont, editorOn, custom, setCustom, resetCustom }) => {
  const passages = mergeWithCustom(QURAN_PASSAGES, custom);
  const defaultIds = new Set(QURAN_PASSAGES.map((p) => p.id));
  return (
  <div>
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div>
        <h3 className="text-lg font-semibold text-emerald-900 inline-flex items-center gap-2"><BookOpen className="h-5 w-5" /> Qur’an Recitation</h3>
        <p className="text-sm text-emerald-700/80" dir="rtl">اختر المقطع وغيّر النمط (المدينة / الهند والباكستان).</p>
      </div>
      <div className="inline-flex rounded-full border border-emerald-200 overflow-hidden bg-white/70">
        <button type="button" onClick={() => onChangeFont('uthmani')} className={`px-3 py-1 text-xs ${font === 'uthmani' ? 'bg-emerald-700 text-white' : 'text-emerald-800'}`}>Uthmani · Madinah</button>
        <button type="button" onClick={() => onChangeFont('indopak')} className={`px-3 py-1 text-xs ${font === 'indopak' ? 'bg-emerald-700 text-white' : 'text-emerald-800'}`}>IndoPak / Urdu</button>
      </div>
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
        const answered = answer?.expertVerdict && answer.expertVerdict !== 'na';
        const isDefault = defaultIds.has(p.id);
        return (
          <div
            key={p.id}
            className={`rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/60 to-white p-4 transition-opacity ${answered ? 'opacity-60 hover:opacity-100' : ''}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-emerald-900">{p.surah} <span className="text-emerald-700/70">· {p.range}</span></div>
              <div className="flex items-center gap-2">
                {editorOn && <DeleteDefaultBtn onClick={() => setCustom(removeCustomItem(custom, p.id, isDefault))} />}
                <VerdictRow
                  answer={answer}
                  onChange={(v) => onAnswer({ questionId: qid, section: 'quran-recitation', level: 'na', prompt: `${p.surah} ${p.range}`, expertVerdict: v })}
                />
              </div>
            </div>
            <div
              dir="rtl"
              className={font === 'indopak' ? 'font-quran-indopak text-emerald-900' : 'font-quran-uthmani text-emerald-900'}
              style={{ textAlign: 'center' }}
            >
              {(p.verses || []).map((v, i) => (
                <span key={i}>{typeof v === 'string' ? v : v.text} </span>
              ))}
            </div>
            <textarea
              className="eval-input mt-3 text-sm min-h-[44px]"
              placeholder="Notes (tajweed errors, hesitation, makhārij…)"
              value={answer?.note || ''}
              onChange={(e) => onAnswer({
                questionId: qid, section: 'quran-recitation', level: 'na',
                prompt: `${p.surah} ${p.range}`, expertVerdict: answer?.expertVerdict || 'na', note: e.target.value,
              })}
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
 * Searchable picker over the 114 surahs. The admin types a name (in Arabic
 * or English transliteration) or a number, picks one, and the surah is added
 * to the student's known-surahs list with an optional "starts from…" note.
 *
 * The answer is stored as a single record keyed `memorization.summary` with
 * a structured `note` JSON so it round-trips through the existing answer
 * pipeline without backend changes.
 */
const QuranMemorizationSlide = ({ student, onAnswer }) => {
  const qid = 'memorization.summary';
  const answer = (student.answers || []).find((a) => a.questionId === qid);
  let stored = { surahs: [] };
  try {
    if (answer?.note) stored = JSON.parse(answer.note);
    if (!Array.isArray(stored.surahs)) stored.surahs = [];
  } catch {
    stored = { surahs: [] };
  }
  const [picked, setPicked] = useState(stored);
  const [search, setSearch] = useState('');

  const persist = (next) => {
    setPicked(next);
    onAnswer({
      questionId: qid,
      section: 'quran-memorization',
      level: 'na',
      prompt: 'Qur’an memorization summary',
      expertVerdict: next.surahs.length ? 'partial' : 'na',
      note: JSON.stringify(next),
    });
  };

  const term = search.trim().toLowerCase();
  const results = !term ? [] : SURAHS.filter((s) => {
    if (String(s.id) === term) return true;
    if (s.en.toLowerCase().includes(term)) return true;
    if (s.ar.includes(search.trim())) return true;
    return false;
  }).slice(0, 12);

  const pickedSet = new Set(picked.surahs.map((s) => s.id));
  const addSurah = (s) => {
    if (pickedSet.has(s.id)) return;
    persist({ ...picked, surahs: [...picked.surahs, { id: s.id, ar: s.ar, en: s.en, ayat: s.ayat, startsFrom: '' }] });
    setSearch('');
  };
  const removeSurah = (id) => persist({ ...picked, surahs: picked.surahs.filter((s) => s.id !== id) });
  const updateNote = (id, startsFrom) => persist({ ...picked, surahs: picked.surahs.map((s) => (s.id === id ? { ...s, startsFrom } : s)) });

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-lg font-semibold text-emerald-900 inline-flex items-center gap-2">
          <BookOpen className="h-5 w-5" /> Qur’an Memorization
        </h3>
        <p className="text-sm text-emerald-700/80" dir="rtl">اختر السور التي يحفظها الطالب وأضف ملاحظة عن نقطة البداية إن وُجدت.</p>
      </div>

      <div className="rounded-2xl border border-emerald-100 bg-white/60 p-4 mb-4">
        <label className="eval-field-label">Search by surah name or number · <span dir="rtl" className="font-naskh">ابحث عن السورة</span></label>
        <input
          className="eval-input"
          placeholder="e.g. Al-Fatihah, البقرة, 36 …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {results.length > 0 && (
          <div className="mt-2 rounded-xl border border-emerald-200 bg-white max-h-60 overflow-y-auto divide-y divide-emerald-50">
            {results.map((s) => {
              const already = pickedSet.has(s.id);
              return (
                <button key={s.id} type="button" onClick={() => addSurah(s)} disabled={already}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-sm ${already ? 'opacity-50' : 'hover:bg-emerald-50'}`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold shrink-0">{s.id}</span>
                    <span className="font-naskh text-emerald-900 text-base" dir="rtl">{s.ar}</span>
                    <span className="text-emerald-700/80 text-xs">{s.en}</span>
                  </span>
                  <span className="text-[10px] text-emerald-700/70">{s.ayat} āyāt · {s.place}</span>
                </button>
              );
            })}
          </div>
        )}
        {term && results.length === 0 && (
          <div className="mt-2 text-xs text-emerald-700/70 italic">No matching surah.</div>
        )}
      </div>

      <div className="mb-2 text-xs uppercase tracking-wide text-emerald-700/80 font-semibold">
        Memorized surahs · {picked.surahs.length}
      </div>

      <div className="space-y-2">
        {picked.surahs.length === 0 && (
          <div className="text-sm text-emerald-700/70 italic">No surahs added yet.</div>
        )}
        {picked.surahs.map((s) => (
          <div key={s.id} className="rounded-2xl border border-emerald-100 bg-white/60 p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex items-center gap-3 sm:flex-1 min-w-0">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold shrink-0">{s.id}</span>
              <div className="min-w-0">
                <div className="font-naskh text-emerald-900 text-lg leading-tight" dir="rtl">{s.ar}</div>
                <div className="text-xs text-emerald-700/80">{s.en} · {s.ayat} āyāt</div>
              </div>
            </div>
            <input
              className="eval-input text-sm sm:max-w-xs"
              placeholder="Starts from ayah / page (optional)"
              value={s.startsFrom || ''}
              onChange={(e) => updateNote(s.id, e.target.value)}
            />
            <button type="button" onClick={() => removeSurah(s.id)}
              className="text-rose-700/80 hover:text-rose-700 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-rose-200 bg-white/70">
              <Trash2 className="h-3 w-3" /> Remove
            </button>
          </div>
        ))}
      </div>
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
  const skill = ARABIC_SKILLS.find((s) => s.key === skillKey) || ARABIC_SKILLS[0];
  const defaultItems = skill.content?.[level] || [];
  // Custom payload is namespaced by skill+level so admins can curate each pair.
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

  const addStub = () => {
    const id = newCustomId(`${skillKey}-${level}`);
    if (skill.type === 'mcq') {
      return { id, prompt: 'New question', options: ['Option A', 'Option B', 'Option C', 'Option D'], correctIndex: 0 };
    }
    if (skill.type === 'expect') return { id, prompt: 'New prompt', expected: '' };
    if (skill.type === 'passage') return { id, passage: 'النص…', questions: ['سؤال؟'] };
    return { id, prompt: 'New prompt' };
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-emerald-900 mb-1">Arabic Skills</h3>
      <p className="text-sm text-emerald-700/80 mb-3">Probe each skill at the level that best matches the student.</p>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {ARABIC_SKILLS.map((s) => (
          <button key={s.key} type="button" onClick={() => setSkillKey(s.key)}
            className={`px-2.5 py-1 rounded-full text-xs border ${skillKey === s.key ? 'bg-emerald-700 text-white border-emerald-800' : 'bg-white/70 border-emerald-200 text-emerald-800'}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4">
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

      <div className="space-y-3">
        {items.length === 0 && (
          <div className="text-sm text-emerald-700 italic">No items for this level yet.</div>
        )}

        {skill.type === 'mcq' && items.map((q, idx) => {
          const qid = `arabic.${skillKey}.${q.id}`;
          const answer = (student.answers || []).find((a) => a.questionId === qid);
          const chosenIdx = answer?.chosen?.[0] !== undefined ? Number(answer.chosen[0]) : null;
          const answered = chosenIdx !== null;
          const dir = directionFor(q.prompt);
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
                  <div className="font-medium text-emerald-900" dir="auto" style={{ textAlign: 'start' }}>{q.prompt}</div>
                </div>
                {editorOn && <DeleteDefaultBtn onClick={() => setSlot(removeCustomItem(slotCustom, q.id, isDefault))} />}
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
                      <button key={i} type="button" dir="auto"
                        onClick={() => onAnswer({
                          questionId: qid, section: sectionFor, level,
                          prompt: q.prompt, chosen: [String(i)],
                          expertVerdict: i === q.correctIndex ? 'correct' : 'incorrect',
                        })}
                        className={`text-left px-3 py-2 rounded-xl border text-sm ${cls}`}>{opt}</button>
                    );
                  })}
                </div>
              </div>
              {editorOn && !isDefault && (
                <CustomItemEditor
                  item={q}
                  schema="mcq"
                  onChange={(patch) => setSlot(updateCustomItem(slotCustom, q.id, patch))}
                  onDelete={() => setSlot(removeCustomItem(slotCustom, q.id, false))}
                />
              )}
            </div>
          );
        })}

        {skill.type === 'expect' && items.map((q, idx) => {
          const qid = `arabic.${skillKey}.${q.id}`;
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
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-emerald-700/70 font-semibold mb-0.5">Question {idx + 1}</div>
                  <div className="font-arabic-display text-xl text-emerald-900" dir="auto" style={{ textAlign: 'start' }}>{q.prompt}</div>
                </div>
                <div className="flex items-center gap-2">
                  {editorOn && <DeleteDefaultBtn onClick={() => setSlot(removeCustomItem(slotCustom, q.id, isDefault))} />}
                  <VerdictRow answer={answer} onChange={(v) => onAnswer({ questionId: qid, section: sectionFor, level, prompt: q.prompt, expertVerdict: v })} />
                </div>
              </div>
              <div className="text-xs text-emerald-700/80">Expected: {q.expected}</div>
              <textarea className="eval-input mt-2 text-sm min-h-[40px]"
                placeholder="Student's answer / notes…"
                value={answer?.note || ''}
                onChange={(e) => onAnswer({ questionId: qid, section: sectionFor, level, prompt: q.prompt, expertVerdict: answer?.expertVerdict || 'na', note: e.target.value })} />
              {editorOn && !isDefault && (
                <CustomItemEditor item={q} schema="expect"
                  onChange={(patch) => setSlot(updateCustomItem(slotCustom, q.id, patch))}
                  onDelete={() => setSlot(removeCustomItem(slotCustom, q.id, false))} />
              )}
            </div>
          );
        })}

        {skill.type === 'passage' && items.map((q, idx) => {
          const qid = `arabic.${skillKey}.${q.id}`;
          const answer = (student.answers || []).find((a) => a.questionId === qid);
          const answered = answer?.expertVerdict && answer.expertVerdict !== 'na';
          const dir = directionFor(q.passage);
          const isDefault = defaultIds.has(q.id);
          return (
            <div
              key={q.id}
              dir={dir}
              className={`rounded-2xl border border-emerald-100 bg-white/60 p-4 transition-opacity ${answered ? 'opacity-60 hover:opacity-100' : ''}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="text-[11px] uppercase tracking-wide text-emerald-700/70 font-semibold">Passage {idx + 1}</div>
                {editorOn && <DeleteDefaultBtn onClick={() => setSlot(removeCustomItem(slotCustom, q.id, isDefault))} />}
              </div>
              <div className="font-arabic-display text-lg leading-loose text-emerald-900 mb-2" dir="auto" style={{ textAlign: 'start' }}>{q.passage}</div>
              <ol className="list-decimal pl-5 text-sm text-emerald-700 mb-2 space-y-1">
                {q.questions.map((qq, i) => <li key={i} dir="auto">{qq}</li>)}
              </ol>
              <VerdictRow answer={answer} onChange={(v) => onAnswer({ questionId: qid, section: sectionFor, level, prompt: q.passage, expertVerdict: v })} />
              <textarea className="eval-input mt-2 text-sm min-h-[44px]" placeholder="What did the student get / miss?" value={answer?.note || ''}
                onChange={(e) => onAnswer({ questionId: qid, section: sectionFor, level, prompt: q.passage, expertVerdict: answer?.expertVerdict || 'na', note: e.target.value })} />
              {editorOn && !isDefault && (
                <CustomItemEditor item={q} schema="passage"
                  onChange={(patch) => setSlot(updateCustomItem(slotCustom, q.id, patch))}
                  onDelete={() => setSlot(removeCustomItem(slotCustom, q.id, false))} />
              )}
            </div>
          );
        })}

        {skill.type === 'prompt' && items.map((q, idx) => {
          const qid = `arabic.${skillKey}.${q.id}`;
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
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-emerald-700/70 font-semibold mb-0.5">Prompt {idx + 1}</div>
                  <div className="font-medium text-emerald-900" dir="auto" style={{ textAlign: 'start' }}>{q.prompt}</div>
                </div>
                <div className="flex items-center gap-2">
                  {editorOn && <DeleteDefaultBtn onClick={() => setSlot(removeCustomItem(slotCustom, q.id, isDefault))} />}
                  <VerdictRow answer={answer} onChange={(v) => onAnswer({ questionId: qid, section: sectionFor, level, prompt: q.prompt, expertVerdict: v })} />
                </div>
              </div>
              <textarea className="eval-input mt-2 text-sm min-h-[60px]"
                placeholder={skillKey === 'writing' ? 'Transcribe what the student wrote…' : 'Notes on fluency, accuracy, vocabulary…'}
                value={answer?.note || ''}
                onChange={(e) => onAnswer({ questionId: qid, section: sectionFor, level, prompt: q.prompt, expertVerdict: answer?.expertVerdict || 'na', note: e.target.value })} />
              {editorOn && !isDefault && (
                <CustomItemEditor item={q} schema="prompt"
                  onChange={(patch) => setSlot(updateCustomItem(slotCustom, q.id, patch))}
                  onDelete={() => setSlot(removeCustomItem(slotCustom, q.id, false))} />
              )}
            </div>
          );
        })}
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
  'arabic-grammar':    { en: 'Arabic · Grammar',    ar: 'العربية · النحو' },
  'arabic-vocab':      { en: 'Arabic · Vocabulary', ar: 'العربية · المفردات' },
  'arabic-comprehension': { en: 'Arabic · Comprehension', ar: 'العربية · الفهم' },
  'arabic-writing':    { en: 'Arabic · Writing',    ar: 'العربية · الكتابة' },
  'arabic-speaking':   { en: 'Arabic · Speaking',   ar: 'العربية · التحدث' },
};
const NEXT_LEVEL = { easy: 'medium', medium: 'advanced', advanced: 'advanced+' };

const summarizeJourney = (answers = []) => {
  // Only consider items the admin actually graded. Untouched questions
  // are treated as "not asked" and excluded from the summary entirely.
  const VALID = new Set(['correct', 'partial', 'incorrect', 'skipped']);
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

const SummarySlide = ({ session, student, onChange, onSendFeedback }) => {
  const totals = useMemo(() => {
    const t = { correct: 0, partial: 0, incorrect: 0, skipped: 0, total: 0 };
    (student.answers || []).forEach((a) => {
      if (!a.expertVerdict || a.expertVerdict === 'na') return;
      t.total += 1;
      t[a.expertVerdict] = (t[a.expertVerdict] || 0) + 1;
    });
    return t;
  }, [student.answers]);

  const [feedbackEmail, setFeedbackEmail] = useState(
    student.contactEmail || session?.students?.[0]?.contactEmail || ''
  );
  const [feedbackLink, setFeedbackLink] = useState('');

  // Re-default the email field when the active student changes (e.g. switching tabs).
  // Falls back to the first student's contact email if the current one is empty —
  // useful when multiple students share the same guardian email.
  useEffect(() => {
    setFeedbackEmail(student.contactEmail || session?.students?.[0]?.contactEmail || '');
    setFeedbackLink('');
  }, [student._id, student.contactEmail, session?.students]);

  const journey = useMemo(() => summarizeJourney(student.answers), [student.answers]);

  const exportText = useMemo(() => {
    const lines = [];
    lines.push(`Waraqa Evaluation · ${session.title || ''}`);
    lines.push(`Student: ${student.name}${student.age ? ` (${student.age})` : ''}`);
    if (student.desiredSubjects?.length) lines.push(`Subjects: ${student.desiredSubjects.join(', ')}`);
    if (student.availability) lines.push(`Availability: ${student.availability}`);
    lines.push(`\nVerdicts: ${totals.correct}/${totals.total} correct · ${totals.partial} partial · ${totals.incorrect} incorrect · ${totals.skipped} skipped`);
    if (student.recommendedLevel) lines.push(`Recommended level: ${student.recommendedLevel}`);
    if (student.weaknesses?.length) lines.push(`Weaknesses: ${student.weaknesses.map((w) => w.area).join(', ')}`);
    if (student.strengths?.length) lines.push(`Strengths: ${student.strengths.join(', ')}`);
    if (student.adminSummary) lines.push(`\nNotes: ${student.adminSummary}`);
    return lines.join('\n');
  }, [session.title, student, totals]);

  return (
    <div>
      <h3 className="text-lg font-semibold text-emerald-900 mb-3">Summary & next steps</h3>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Stat label="Correct"   value={totals.correct}   cls="from-emerald-500 to-teal-600" />
        <Stat label="Partial"   value={totals.partial}   cls="from-amber-500 to-orange-500" />
        <Stat label="Incorrect" value={totals.incorrect} cls="from-rose-500 to-pink-600" />
        <Stat label="Skipped"   value={totals.skipped}   cls="from-zinc-400 to-zinc-600" />
      </div>

      {journey.length > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-white p-4 mb-4">
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
          <p className="font-display-en text-[11px] text-emerald-700/70 mt-2">
            Tip: untested subjects mean the student stopped earlier — start from the easiest item there.
          </p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-emerald-800 mb-1">Recommended level</label>
          <input className="eval-input" value={student.recommendedLevel || ''} onChange={(e) => onChange({ recommendedLevel: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-emerald-800 mb-1">Strengths (comma separated)</label>
          <input className="eval-input"
            value={(student.strengths || []).join(', ')}
            onChange={(e) => onChange({ strengths: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="block text-xs font-semibold text-emerald-800 mb-1">Weaknesses</label>
        <div className="flex flex-wrap gap-1.5">
          {WEAKNESS_AREAS.map((area) => {
            const on = (student.weaknesses || []).some((w) => w.area === area);
            return (
              <button
                key={area}
                type="button"
                onClick={() => {
                  const list = student.weaknesses || [];
                  const next = on ? list.filter((w) => w.area !== area) : [...list, { area }];
                  onChange({ weaknesses: next });
                }}
                className={`px-2.5 py-1 rounded-full text-xs border ${on ? 'bg-amber-100 border-amber-400 text-amber-900' : 'bg-white/70 border-emerald-200 text-emerald-800'}`}
              >{area}</button>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        <label className="block text-xs font-semibold text-emerald-800 mb-1">Admin notes</label>
        <textarea className="eval-input min-h-[80px]" value={student.adminSummary || ''} onChange={(e) => onChange({ adminSummary: e.target.value })} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { navigator.clipboard?.writeText(exportText); showToast('Copied summary'); }}
          className="px-3 py-1.5 rounded-full bg-emerald-700 text-white text-xs inline-flex items-center gap-1"><Copy className="h-3 w-3" /> Copy summary</button>
      </div>

      {/* Feedback request */}
      <div className="mt-6 rounded-2xl border border-emerald-200 bg-gradient-to-br from-white to-emerald-50 p-4">
        <h4 className="text-sm font-semibold text-emerald-900 mb-2 inline-flex items-center gap-1"><Send className="h-4 w-4" /> Ask {student.name} for feedback</h4>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch">
          <input
            className="eval-input flex-1"
            placeholder="Email"
            value={feedbackEmail}
            onChange={(e) => setFeedbackEmail(e.target.value)}
          />
          <button
            type="button"
            onClick={async () => {
              if (!student._id) { showToast('Save the session first'); return; }
              const link = await onSendFeedback(feedbackEmail);
              if (link) setFeedbackLink(link);
            }}
            className="px-3 py-1.5 rounded-full bg-emerald-700 text-white text-sm"
          >Send</button>
        </div>
        {feedbackLink && (
          <div className="mt-2 text-xs flex items-center gap-2 text-emerald-800 break-all">
            <LinkIcon className="h-3 w-3" /> <a href={feedbackLink} className="underline" target="_blank" rel="noreferrer">{feedbackLink}</a>
            <button type="button" className="ml-auto text-emerald-700 underline" onClick={() => { navigator.clipboard?.writeText(feedbackLink); showToast('Link copied'); }}>Copy</button>
          </div>
        )}

        {student.feedback?.submittedAt && (
          <div className="mt-3 rounded-xl border border-emerald-300 bg-white p-3">
            <div className="text-xs text-emerald-700 mb-1">Received {new Date(student.feedback.submittedAt).toLocaleString()}</div>
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
    </div>
  );
};

const Stat = ({ label, value, cls }) => (
  <div className={`rounded-2xl bg-gradient-to-br ${cls} text-white p-3 shadow`}>
    <div className="text-xs uppercase tracking-wider opacity-90">{label}</div>
    <div className="text-2xl font-bold mt-1">{value}</div>
  </div>
);

/* ─── Links ────────────────────────────────────────────────────────────── */

const LinksSlide = () => {
  const copyAll = () => {
    const text = IMPORTANT_LINKS.map((l) => `${l.label}: ${l.url}`).join('\n');
    navigator.clipboard?.writeText(text);
    showToast('All links copied');
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-emerald-900">Important links</h3>
        <button type="button" onClick={copyAll} className="text-xs px-2.5 py-1 rounded-full bg-emerald-700 text-white inline-flex items-center gap-1"><Copy className="h-3 w-3" /> Copy all</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {IMPORTANT_LINKS.map((l) => (
          <div key={l.url} className="rounded-2xl border border-emerald-100 bg-white/70 p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-emerald-900 truncate">{l.label}</div>
              <a className="text-xs text-emerald-700 underline truncate block" href={l.url} target="_blank" rel="noreferrer">{l.url}</a>
            </div>
            <button type="button" onClick={() => { navigator.clipboard?.writeText(l.url); showToast('Copied'); }}
              className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs inline-flex items-center gap-1"><Copy className="h-3 w-3" /> Copy</button>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ─── History drawer ───────────────────────────────────────────────────── */

const HistoryDrawer = ({ history, loading, currentId, onClose, onOpen, onNew, onDelete }) => (
  <div className="fixed inset-0 z-50 flex">
    <div className="flex-1 bg-black/40" onClick={onClose} />
    <aside className="w-full max-w-md bg-white h-full flex flex-col shadow-xl">
      <header className="flex items-center justify-between px-4 py-3 border-b border-emerald-200 bg-gradient-to-r from-emerald-700 to-teal-700 text-white">
        <div className="flex items-center gap-2"><History className="h-4 w-4" /><h3 className="font-semibold">Past evaluations</h3></div>
        <button type="button" onClick={onClose} className="text-sm opacity-90 hover:opacity-100">Close</button>
      </header>
      <div className="p-3 border-b border-emerald-100">
        <button type="button" onClick={onNew}
          className="w-full px-3 py-2 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm inline-flex items-center justify-center gap-1">
          <Plus className="h-4 w-4" /> New session
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-6 text-sm text-emerald-700 text-center">Loading…</div>}
        {!loading && history.length === 0 && (
          <div className="p-6 text-sm text-emerald-700 text-center">No sessions yet.</div>
        )}
        {!loading && history.map((s) => {
          const isCurrent = s._id === currentId;
          const studentsCount = (s.students || []).length;
          const feedbackCount = (s.students || []).filter((st) => st.feedback?.submittedAt).length;
          const when = s.endedAt || s.updatedAt || s.createdAt;
          return (
            <div key={s._id} className={`px-4 py-3 border-b border-emerald-100 ${isCurrent ? 'bg-emerald-50' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => onOpen(s._id)} className="text-left flex-1">
                  <div className="font-medium text-sm text-emerald-900 truncate">{s.title || 'Untitled'}</div>
                  <div className="text-xs text-emerald-700 mt-0.5">
                    {studentsCount} student{studentsCount === 1 ? '' : 's'} · {feedbackCount} feedback ·{' '}
                    <span className={s.status === 'active' ? 'text-emerald-700' : 'text-zinc-600'}>{s.status}</span>
                  </div>
                  <div className="text-[11px] text-emerald-700/70 mt-0.5">
                    {when ? new Date(when).toLocaleString() : ''}
                  </div>
                  {(s.students || []).slice(0, 3).map((st, i) => (
                    <div key={i} className="text-[11px] text-emerald-700/70 truncate">• {st.name}</div>
                  ))}
                </button>
                <button type="button" onClick={() => onDelete(s._id)} className="text-rose-600 hover:text-rose-700 p-1" title="Delete">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  </div>
);

export default EvaluationPage;
