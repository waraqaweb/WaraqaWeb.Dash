/**
 * EvaluationPage
 *
 * Admin-only live assessment tool launched from Library.
 * Flow: Welcome â†’ Bio â†’ Reading (letters/words/sentences) â†’ Quran â†’
 * Tajweed (theory + practical) â†’ Summary & weaknesses â†’ Important links.
 *
 * Persistence: each session is saved to /api/evaluations and can host
 * multiple students assessed back-to-back. Admin can also send a
 * tokenised feedback request email to the student / guardian.
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
import '../../styles/quran-fonts.css';
import {
  ChevronRight, ChevronLeft, Plus, Trash2, Copy, CheckCircle2,
  XCircle, MinusCircle, Send, Link as LinkIcon, Users,
  History, FileText,
} from 'lucide-react';

const SECTIONS = [
  { key: 'welcome',           title: 'Welcome' },
  { key: 'intro',             title: 'Meet your evaluator' },
  { key: 'student',           title: 'About the student' },
  { key: 'reading-letters',   title: 'Reading Â· Letters' },
  { key: 'reading-words',     title: 'Reading Â· Words & Sentences' },
  { key: 'quran-recitation',  title: 'Qur\u02bcan Recitation' },
  { key: 'tajweed-theory',    title: 'Tajweed Â· Theory' },
  { key: 'tajweed-practical', title: 'Tajweed Â· Practical' },  { key: 'arabic-skills',     title: 'Arabic Skills' },  { key: 'summary',           title: 'Summary & next steps' },
  { key: 'links',             title: 'Important links' },
];

const VERDICTS = [
  { v: 'correct',   label: 'Correct',   icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  { v: 'partial',   label: 'Partial',   icon: MinusCircle,  cls: 'bg-amber-100 text-amber-700 border-amber-300' },
  { v: 'incorrect', label: 'Incorrect', icon: XCircle,      cls: 'bg-rose-100 text-rose-700 border-rose-300' },
  { v: 'skipped',   label: 'Skipped',   icon: MinusCircle,  cls: 'bg-zinc-100 text-zinc-700 border-zinc-300' },
];

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

const sectionForAnswer = (key) => {
  if (key === 'reading-letters') return 'reading-letters';
  if (key === 'reading-words') return 'reading-words';
  if (key === 'quran-recitation') return 'quran-recitation';
  if (key === 'tajweed-theory') return 'tajweed-theory';
  if (key === 'tajweed-practical') return 'tajweed-practical';
  return 'reading-letters';
};

const EvaluationPage = ({ isActive = true }) => {
  const { user, socket } = useAuth();

  const [session, setSession] = useState(null);
  const [activeStudentIdx, setActiveStudentIdx] = useState(0);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [bio, setBio] = useState(DEFAULT_BIO);
  const [quranFont, setQuranFont] = useState('uthmani'); // uthmani | indopak
  const [diacritics, setDiacritics] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const saveTimer = useRef(null);

  // â”€â”€â”€ Load or create session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!isActive) return;
    let cancel = false;
    (async () => {
      try {
        const { data } = await api.get('/evaluations', { params: { limit: 1 } });
        if (cancel) return;
        const latest = (data?.sessions || []).find((s) => s.status === 'active');
        if (latest) {
          setSession(latest);
          setActiveStudentIdx(latest.students?.length ? 0 : 0);
        } else {
          const { data: created } = await api.post('/evaluations', { title: '' });
          if (cancel) return;
          // Start with one default student
          const initial = { ...created.session, students: [emptyStudent()] };
          setSession(initial);
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

  // â”€â”€â”€ Debounced autosave â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€â”€ Loading state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (loading || !session) {
    return <div className="p-8 text-center text-muted-foreground">Loading evaluationâ€¦</div>;
  }

  const activeStudent = session.students?.[activeStudentIdx] || emptyStudent();
  const section = SECTIONS[sectionIdx];

  const goNext = () => setSectionIdx((i) => Math.min(SECTIONS.length - 1, i + 1));
  const goPrev = () => setSectionIdx((i) => Math.max(0, i - 1));
  const goTo = (key) => {
    const i = SECTIONS.findIndex((s) => s.key === key);
    if (i >= 0) setSectionIdx(i);
  };

  const addStudent = () => {
    const name = window.prompt('Student name?', `Student ${(session.students?.length || 0) + 1}`);
    if (!name) return;
    updateSession((prev) => ({ ...prev, students: [...(prev.students || []), emptyStudent(name)] }));
    setActiveStudentIdx((session.students?.length || 0));
    setSectionIdx(2); // jump to "About the student"
  };

  const endTest = () => {
    if (!window.confirm('End this evaluation and mark it completed?')) return;
    updateSession((prev) => ({ ...prev, status: 'completed', endedAt: new Date().toISOString() }));
    goTo('summary');
  };

  // ─── Sessions history drawer ──────────────────────────────────────────────────────
  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const { data } = await api.get('/evaluations', { params: { limit: 50 } });
      setHistory(data?.sessions || []);
    } catch (err) {
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
        setHistoryOpen(false);
      }
    } catch (err) {
      showToast('Failed to open session');
    }
  };

  const startNewSession = async () => {
    try {
      const { data } = await api.post('/evaluations', { title: '' });
      if (data?.session) {
        setSession({ ...data.session, students: [emptyStudent()] });
        setActiveStudentIdx(0);
        setSectionIdx(0);
        setHistoryOpen(false);
      }
    } catch (err) {
      showToast('Failed to start new session');
    }
  };

  const deleteSession = async (id) => {
    if (!window.confirm('Delete this session permanently?')) return;
    try {
      await api.delete(`/evaluations/${id}`);
      setHistory((h) => h.filter((s) => s._id !== id));
      if (session?._id === id) await startNewSession();
    } catch (err) {
      showToast('Failed to delete');
    }
  };

  // ─── Socket: live feedback notification ────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return undefined;
    const handler = async (payload) => {
      try {
        const r = payload?.ratings || {};
        const overall = r.overall ? `${r.overall}/5` : 'New';
        showToast(`✨ Feedback from ${payload.studentName} — ${overall}`);
        // If it concerns the open session, refresh it so the UI shows the new feedback.
        if (session?._id && payload.sessionId === session._id) {
          const { data } = await api.get(`/evaluations/${session._id}`);
          if (data?.session) setSession(data.session);
        }
      } catch (err) { /* noop */ }
    };
    socket.on('evaluation-feedback-received', handler);
    return () => socket.off('evaluation-feedback-received', handler);
  }, [socket, session?._id]);

  // â”€â”€â”€ Render shell â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto">
      {/* Top bar: student tabs + section progress */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Users className="h-4 w-4 text-muted-foreground" />
          {(session.students || []).map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveStudentIdx(i)}
              className={`px-3 py-1.5 rounded-full text-sm border ${i === activeStudentIdx ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border'}`}
            >
              {s.name || `Student ${i + 1}`}
            </button>
          ))}
          <button type="button" onClick={addStudent} className="px-2 py-1.5 rounded-full text-sm border border-dashed border-border text-muted-foreground hover:text-foreground">
            <Plus className="inline h-4 w-4" /> Add student
          </button>
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-3">
          <button
            type="button"
            onClick={openHistory}
            className="px-2 py-1 rounded border border-border hover:bg-accent inline-flex items-center gap-1"
            title="Past sessions"
          >
            <History className="h-3.5 w-3.5" /> History
          </button>
          <span>{saving ? 'Savingâ€¦' : 'All changes saved'} Â· Session {session.status}</span>
        </div>
      </div>

      {/* Section nav (chips) */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {SECTIONS.map((sec, i) => (
          <button
            key={sec.key}
            type="button"
            onClick={() => setSectionIdx(i)}
            className={`px-2.5 py-1 rounded text-xs border ${i === sectionIdx ? 'bg-foreground text-background border-foreground' : 'bg-background text-foreground border-border'}`}
          >
            {i + 1}. {sec.title}
          </button>
        ))}
      </div>

      {/* Card */}
      <div className="bg-card border border-border rounded-xl p-4 sm:p-6 shadow-sm min-h-[420px]">
        {section.key === 'welcome' && (
          <WelcomeSlide adminName={user?.fullName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Waraqa Team'} />
        )}
        {section.key === 'intro' && (
          <IntroSlide
            bio={bio}
            adminName={user?.fullName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Waraqa Admin'}
            onChange={setBio}
          />
        )}
        {section.key === 'student' && (
          <StudentSlide student={activeStudent} onChange={updateStudent} />
        )}
        {section.key === 'reading-letters' && (
          <ReadingLettersSlide
            student={activeStudent}
            onChange={updateStudent}
            onAnswer={upsertAnswer}
          />
        )}
        {section.key === 'reading-words' && (
          <ReadingWordsSlide
            student={activeStudent}
            onChange={updateStudent}
            onAnswer={upsertAnswer}
            diacritics={diacritics}
            onToggleDiacritics={() => setDiacritics((d) => !d)}
          />
        )}
        {section.key === 'quran-recitation' && (
          <QuranSlide
            student={activeStudent}
            onAnswer={upsertAnswer}
            font={quranFont}
            onChangeFont={setQuranFont}
          />
        )}
        {section.key === 'tajweed-theory' && (
          <TajweedTheorySlide student={activeStudent} onAnswer={upsertAnswer} />
        )}
        {section.key === 'tajweed-practical' && (
          <TajweedPracticalSlide student={activeStudent} onAnswer={upsertAnswer} />
        )}
        {section.key === 'arabic-skills' && (
          <ArabicSkillsSlide student={activeStudent} onAnswer={upsertAnswer} />
        )}
        {section.key === 'summary' && (
          <SummarySlide
            session={session}
            student={activeStudent}
            studentIdx={activeStudentIdx}
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

      {/* Footer nav */}
      <div className="flex items-center justify-between mt-4">
        <button type="button" onClick={goPrev} disabled={sectionIdx === 0} className="px-3 py-2 rounded border border-border text-sm disabled:opacity-40">
          <ChevronLeft className="inline h-4 w-4" /> Previous
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={endTest} className="px-3 py-2 rounded border border-rose-300 text-rose-700 text-sm">
            End test
          </button>
          <button type="button" onClick={goNext} disabled={sectionIdx === SECTIONS.length - 1} className="px-3 py-2 rounded bg-primary text-primary-foreground text-sm disabled:opacity-40">
            Next <ChevronRight className="inline h-4 w-4" />
          </button>
        </div>
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

// â”€â”€â”€ Sub-slides â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const HistoryDrawer = ({ history, loading, currentId, onClose, onOpen, onNew, onDelete }) => (
  <div className="fixed inset-0 z-50 flex">
    <div className="flex-1 bg-black/40" onClick={onClose} />
    <aside className="w-full max-w-md bg-card border-l border-border shadow-xl h-full flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4" />
          <h3 className="font-semibold">Past evaluations</h3>
        </div>
        <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">Close</button>
      </header>
      <div className="p-3 border-b border-border">
        <button
          type="button"
          onClick={onNew}
          className="w-full px-3 py-2 rounded bg-primary text-primary-foreground text-sm inline-flex items-center justify-center gap-1"
        >
          <Plus className="h-4 w-4" /> New session
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-6 text-sm text-muted-foreground text-center">Loadingâ€¦</div>}
        {!loading && history.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground text-center">No sessions yet.</div>
        )}
        {!loading && history.map((s) => {
          const isCurrent = s._id === currentId;
          const studentsCount = (s.students || []).length;
          const feedbackCount = (s.students || []).filter((st) => st.feedback?.submittedAt).length;
          const when = s.endedAt || s.updatedAt || s.createdAt;
          return (
            <div key={s._id} className={`px-4 py-3 border-b border-border ${isCurrent ? 'bg-accent/40' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => onOpen(s._id)} className="text-left flex-1">
                  <div className="font-medium text-sm truncate">{s.title || 'Untitled'}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {studentsCount} student{studentsCount === 1 ? '' : 's'} Â· {feedbackCount} feedback Â·{' '}
                    <span className={s.status === 'active' ? 'text-emerald-700' : 'text-zinc-600'}>{s.status}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {when ? new Date(when).toLocaleString() : ''}
                  </div>
                  {(s.students || []).slice(0, 3).map((st, i) => (
                    <div key={i} className="text-[11px] text-muted-foreground truncate">â€¢ {st.name}</div>
                  ))}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(s._id)}
                  className="text-rose-600 hover:text-rose-700 p-1"
                  title="Delete"
                >
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

const WelcomeSlide = ({ adminName }) => (
  <div className="text-center py-10">
    <div className="text-5xl mb-3">ðŸŒ¿</div>
    <h2 className="text-2xl sm:text-3xl font-semibold mb-2">Ahlan wa sahlan!</h2>
    <p className="text-lg text-muted-foreground mb-1">Welcome to your Waraqa evaluation.</p>
    <p className="text-muted-foreground">We&apos;re delighted to have you with us today. {adminName} will guide you through the meeting.</p>
    <p className="mt-6 text-sm text-muted-foreground">This short assessment helps us place you on the right learning path â€” there are no wrong answers, only signals to teach you better. BismillÄh!</p>
  </div>
);

const IntroSlide = ({ bio, adminName, onChange }) => (
  <div>
    <div className="flex items-start justify-between gap-3 mb-3">
      <div>
        <h2 className="text-2xl font-semibold">{adminName}</h2>
        <p className="text-muted-foreground">{bio.title} Â· {bio.subtitle}</p>
      </div>
    </div>
    <ul className="space-y-2 mb-4">
      {bio.paragraphs.map((p, i) => (
        <li key={i} className="flex gap-2 text-foreground">
          <span className="text-primary mt-1">â€¢</span>
          <span>{p}</span>
        </li>
      ))}
    </ul>
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">Edit bio (admin only, this session)</summary>
      <textarea
        className="mt-2 w-full border border-border rounded p-2 text-sm"
        rows={6}
        value={bio.paragraphs.join('\n')}
        onChange={(e) => onChange({ ...bio, paragraphs: e.target.value.split('\n').filter(Boolean) })}
      />
    </details>
  </div>
);

const StudentSlide = ({ student, onChange }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <Field label="Name">
      <input className="eval-input" value={student.name || ''} onChange={(e) => onChange({ name: e.target.value })} />
    </Field>
    <Field label="Age">
      <input type="number" className="eval-input" value={student.age || ''} onChange={(e) => onChange({ age: e.target.value ? Number(e.target.value) : undefined })} />
    </Field>
    <Field label="Contact email (for feedback)">
      <input type="email" className="eval-input" value={student.contactEmail || ''} onChange={(e) => onChange({ contactEmail: e.target.value })} />
    </Field>
    <Field label="Desired subjects (comma-separated)">
      <input className="eval-input" value={(student.desiredSubjects || []).join(', ')} onChange={(e) => onChange({ desiredSubjects: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
    </Field>
    <Field label="Availability (days / times)" full>
      <textarea className="eval-input min-h-[60px]" value={student.availability || ''} onChange={(e) => onChange({ availability: e.target.value })} />
    </Field>
    <Field label="Notes about the student" full>
      <textarea className="eval-input min-h-[80px]" value={student.generalNotes || ''} onChange={(e) => onChange({ generalNotes: e.target.value })} />
    </Field>
  </div>
);

const Field = ({ label, children, full }) => (
  <label className={`block ${full ? 'sm:col-span-2' : ''}`}>
    <div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
    {children}
  </label>
);

const DifficultyPicker = ({ value, onChange }) => (
  <div className="inline-flex rounded border border-border overflow-hidden text-xs">
    {['easy', 'medium', 'advanced'].map((d) => (
      <button
        key={d}
        type="button"
        onClick={() => onChange(d)}
        className={`px-3 py-1 capitalize ${value === d ? 'bg-foreground text-background' : 'bg-background text-foreground'}`}
      >{d}</button>
    ))}
  </div>
);

const VerdictRow = ({ answer, onChange }) => (
  <div className="flex items-center gap-1.5">
    {VERDICTS.map(({ v, label, icon: Icon, cls }) => (
      <button
        key={v}
        type="button"
        title={label}
        onClick={() => onChange(v)}
        className={`px-2 py-1 rounded border text-xs ${answer?.expertVerdict === v ? cls : 'bg-background border-border text-muted-foreground'}`}
      >
        <Icon className="inline h-3.5 w-3.5" /> {label}
      </button>
    ))}
  </div>
);

const ReadingLettersSlide = ({ student, onChange, onAnswer }) => {
  const level = student?.difficulty?.reading || 'easy';
  const bank = READING_LETTERS[level];
  const setLevel = (d) => onChange((s) => ({ ...s, difficulty: { ...(s.difficulty || {}), reading: d } }));
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-lg font-semibold">Reading Â· Letters</h3>
          <p className="text-sm text-muted-foreground">{bank.description}</p>
        </div>
        <DifficultyPicker value={level} onChange={setLevel} />
      </div>
      <div className="space-y-4">
        {bank.groups.map((g) => {
          const qid = `reading.letters.${level}.${g.id}`;
          const answer = (student.answers || []).find((a) => a.questionId === qid);
          return (
            <div key={g.id} className="border border-border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-muted-foreground">{g.title}</div>
                <VerdictRow
                  answer={answer}
                  onChange={(v) => onAnswer({
                    questionId: qid, section: 'reading-letters', level,
                    prompt: g.letters.join(' '), expertVerdict: v,
                  })}
                />
              </div>
              <div className="font-arabic-display text-4xl text-center leading-loose tracking-wide" dir="rtl">
                {g.letters.join('   ')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const stripDiacritics = (s) => s.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');

const ReadingWordsSlide = ({ student, onChange, onAnswer, diacritics, onToggleDiacritics }) => {
  const level = student?.difficulty?.reading || 'easy';
  const setLevel = (d) => onChange((s) => ({ ...s, difficulty: { ...(s.difficulty || {}), reading: d } }));
  const visible = READING_WORDS.filter((w) => {
    if (level === 'easy') return w.level === 'easy';
    if (level === 'medium') return w.level !== 'advanced';
    return true;
  });
  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="text-lg font-semibold">Reading Â· Words & Sentences</h3>
          <p className="text-sm text-muted-foreground">Noor Al-Bayan progression â€” adjust difficulty any time.</p>
        </div>
        <div className="flex items-center gap-2">
          <DifficultyPicker value={level} onChange={setLevel} />
          <button type="button" onClick={onToggleDiacritics} className="px-2 py-1 rounded border border-border text-xs">
            Diacritics: {diacritics ? 'on' : 'off'}
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {visible.map((step) => {
          const qid = `reading.words.${step.id}`;
          const answer = (student.answers || []).find((a) => a.questionId === qid);
          return (
            <div key={step.id} className="border border-border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm font-medium">{step.title}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{step.level}</div>
                </div>
                <VerdictRow
                  answer={answer}
                  onChange={(v) => onAnswer({
                    questionId: qid, section: 'reading-words', level: step.level,
                    prompt: step.items.join(' / '), expertVerdict: v,
                  })}
                />
              </div>
              <div className="font-arabic-display text-3xl text-right leading-loose" dir="rtl">
                {step.items.map((w, i) => (
                  <span key={i} className="inline-block mx-3">{diacritics ? w : stripDiacritics(w)}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const QuranSlide = ({ student, onAnswer, font, onChangeFont }) => {
  const fontClass = font === 'indopak' ? 'font-quran-indopak' : 'font-quran-uthmani';
  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="text-lg font-semibold">Qur&apos;an Recitation</h3>
          <p className="text-sm text-muted-foreground">Ask the student to recite each passage; assess after.</p>
        </div>
        <div className="inline-flex rounded border border-border overflow-hidden text-xs">
          <button type="button" onClick={() => onChangeFont('uthmani')} className={`px-3 py-1 ${font === 'uthmani' ? 'bg-foreground text-background' : 'bg-background'}`}>Uthmani (Saudi)</button>
          <button type="button" onClick={() => onChangeFont('indopak')} className={`px-3 py-1 ${font === 'indopak' ? 'bg-foreground text-background' : 'bg-background'}`}>IndoPak / Urdu</button>
        </div>
      </div>
      <div className="space-y-4">
        {QURAN_PASSAGES.map((p) => {
          const qid = `quran.${p.id}`;
          const answer = (student.answers || []).find((a) => a.questionId === qid);
          return (
            <div key={p.id} className="border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-semibold">{p.surah}</div>
                  <div className="text-xs text-muted-foreground">{p.range}</div>
                </div>
                <VerdictRow
                  answer={answer}
                  onChange={(v) => onAnswer({
                    questionId: qid, section: 'quran-recitation', level: 'na',
                    prompt: `${p.surah} ${p.range}`, expertVerdict: v,
                  })}
                />
              </div>
              <div className={`${fontClass} text-right`} dir="rtl">
                {p.verses.map((v, i) => <p key={i} className="mb-2">{v}</p>)}
              </div>
              <textarea
                className="eval-input mt-2 text-sm min-h-[44px]"
                placeholder="Notes / what to improveâ€¦"
                value={answer?.note || ''}
                onChange={(e) => onAnswer({
                  questionId: qid, section: 'quran-recitation', level: 'na',
                  prompt: `${p.surah} ${p.range}`, expertVerdict: answer?.expertVerdict || 'na', note: e.target.value,
                })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

const TajweedTheorySlide = ({ student, onAnswer }) => (
  <div>
    <h3 className="text-lg font-semibold mb-1">Tajweed Â· Theory</h3>
    <p className="text-sm text-muted-foreground mb-3">Multiple choice. The correct option is highlighted after the student picks.</p>
    <div className="space-y-3">
      {TAJWEED_THEORY.map((q) => {
        const qid = `tajweed.theory.${q.id}`;
        const answer = (student.answers || []).find((a) => a.questionId === qid);
        const chosenIdx = answer?.chosen?.[0] !== undefined ? Number(answer.chosen[0]) : null;
        return (
          <div key={q.id} className="border border-border rounded-lg p-3">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="font-medium">{q.question}</div>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{q.level}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {q.options.map((opt, i) => {
                const isChosen = chosenIdx === i;
                const isCorrect = i === q.correctIndex;
                const revealed = chosenIdx !== null;
                const cls = revealed
                  ? (isCorrect ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : isChosen ? 'bg-rose-50 border-rose-300 text-rose-800'
                    : 'bg-background border-border')
                  : 'bg-background border-border hover:bg-accent';
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onAnswer({
                      questionId: qid, section: 'tajweed-theory', level: q.level,
                      prompt: q.question, chosen: [String(i)],
                      expertVerdict: i === q.correctIndex ? 'correct' : 'incorrect',
                    })}
                    className={`text-left px-3 py-2 rounded border text-sm ${cls}`}
                  >{opt}</button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const TajweedPracticalSlide = ({ student, onAnswer }) => (
  <div>
    <h3 className="text-lg font-semibold mb-1">Tajweed Â· Practical</h3>
    <p className="text-sm text-muted-foreground mb-3">Listen and assess each application.</p>
    <div className="space-y-3">
      {TAJWEED_PRACTICAL.map((q) => {
        const qid = `tajweed.practical.${q.id}`;
        const answer = (student.answers || []).find((a) => a.questionId === qid);
        return (
          <div key={q.id} className="border border-border rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{q.level}</span>
              <VerdictRow
                answer={answer}
                onChange={(v) => onAnswer({
                  questionId: qid, section: 'tajweed-practical', level: q.level,
                  prompt: q.prompt, expertVerdict: v,
                })}
              />
            </div>
            <div className="font-arabic-display text-2xl text-right leading-loose mb-1" dir="rtl">{q.prompt}</div>
            <div className="text-xs text-muted-foreground">Expects: {q.expects}</div>
            <textarea
              className="eval-input mt-2 text-sm min-h-[44px]"
              placeholder="Notes / what to improveâ€¦"
              value={answer?.note || ''}
              onChange={(e) => onAnswer({
                questionId: qid, section: 'tajweed-practical', level: q.level,
                prompt: q.prompt, expertVerdict: answer?.expertVerdict || 'na', note: e.target.value,
              })}
            />
          </div>
        );
      })}
    </div>
  </div>
);

const ArabicSkillsSlide = ({ student, onAnswer }) => {
  const [skillKey, setSkillKey] = useState('grammar');
  const [level, setLevel] = useState('easy');
  const skill = ARABIC_SKILLS.find((s) => s.key === skillKey) || ARABIC_SKILLS[0];
  const items = skill.content?.[level] || [];
  const sectionFor = {
    grammar: 'arabic-grammar',
    vocab: 'arabic-vocab',
    comprehension: 'arabic-comprehension',
    writing: 'arabic-writing',
    speaking: 'arabic-speaking',
  }[skillKey];

  return (
    <div>
      <h3 className="text-lg font-semibold mb-1">Arabic Skills</h3>
      <p className="text-sm text-muted-foreground mb-3">Probe each skill at the level that best matches the student. Switch freely.</p>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {ARABIC_SKILLS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSkillKey(s.key)}
            className={`px-2.5 py-1 rounded text-xs border ${skillKey === s.key ? 'bg-foreground text-background border-foreground' : 'bg-background border-border'}`}
          >{s.label}</button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-muted-foreground">Level:</span>
        <DifficultyPicker value={level} onChange={setLevel} />
      </div>

      <div className="space-y-3">
        {items.length === 0 && (
          <div className="text-sm text-muted-foreground italic">No items for this level yet.</div>
        )}

        {skill.type === 'mcq' && items.map((q) => {
          const qid = `arabic.${skillKey}.${q.id}`;
          const answer = (student.answers || []).find((a) => a.questionId === qid);
          const chosenIdx = answer?.chosen?.[0] !== undefined ? Number(answer.chosen[0]) : null;
          return (
            <div key={q.id} className="border border-border rounded-lg p-3">
              <div className="font-medium mb-2" dir="rtl">{q.prompt}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {q.options.map((opt, i) => {
                  const isChosen = chosenIdx === i;
                  const isCorrect = i === q.correctIndex;
                  const revealed = chosenIdx !== null;
                  const cls = revealed
                    ? (isCorrect ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : isChosen ? 'bg-rose-50 border-rose-300 text-rose-800'
                      : 'bg-background border-border')
                    : 'bg-background border-border hover:bg-accent';
                  return (
                    <button
                      key={i}
                      type="button"
                      dir="rtl"
                      onClick={() => onAnswer({
                        questionId: qid, section: sectionFor, level,
                        prompt: q.prompt, chosen: [String(i)],
                        expertVerdict: i === q.correctIndex ? 'correct' : 'incorrect',
                      })}
                      className={`text-right px-3 py-2 rounded border text-sm ${cls}`}
                    >{opt}</button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {skill.type === 'expect' && items.map((q) => {
          const qid = `arabic.${skillKey}.${q.id}`;
          const answer = (student.answers || []).find((a) => a.questionId === qid);
          return (
            <div key={q.id} className="border border-border rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="font-arabic-display text-xl" dir="rtl">{q.prompt}</div>
                <VerdictRow
                  answer={answer}
                  onChange={(v) => onAnswer({
                    questionId: qid, section: sectionFor, level,
                    prompt: q.prompt, expertVerdict: v,
                  })}
                />
              </div>
              <div className="text-xs text-muted-foreground">Expected: {q.expected}</div>
              <textarea
                className="eval-input mt-2 text-sm min-h-[40px]"
                placeholder="Student's answer / notes&hellip;"
                value={answer?.note || ''}
                onChange={(e) => onAnswer({
                  questionId: qid, section: sectionFor, level,
                  prompt: q.prompt, expertVerdict: answer?.expertVerdict || 'na', note: e.target.value,
                })}
              />
            </div>
          );
        })}

        {skill.type === 'passage' && items.map((q) => {
          const qid = `arabic.${skillKey}.${q.id}`;
          const answer = (student.answers || []).find((a) => a.questionId === qid);
          return (
            <div key={q.id} className="border border-border rounded-lg p-3">
              <div className="font-arabic-display text-lg leading-loose mb-2" dir="rtl">{q.passage}</div>
              <ol className="list-decimal pl-5 text-sm text-muted-foreground mb-2 space-y-1">
                {q.questions.map((qq, i) => <li key={i}>{qq}</li>)}
              </ol>
              <div className="mb-1">
                <VerdictRow
                  answer={answer}
                  onChange={(v) => onAnswer({
                    questionId: qid, section: sectionFor, level,
                    prompt: q.passage, expertVerdict: v,
                  })}
                />
              </div>
              <textarea
                className="eval-input mt-2 text-sm min-h-[44px]"
                placeholder="What did the student get / miss?"
                value={answer?.note || ''}
                onChange={(e) => onAnswer({
                  questionId: qid, section: sectionFor, level,
                  prompt: q.passage, expertVerdict: answer?.expertVerdict || 'na', note: e.target.value,
                })}
              />
            </div>
          );
        })}

        {skill.type === 'prompt' && items.map((q) => {
          const qid = `arabic.${skillKey}.${q.id}`;
          const answer = (student.answers || []).find((a) => a.questionId === qid);
          return (
            <div key={q.id} className="border border-border rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="font-medium">{q.prompt}</div>
                <VerdictRow
                  answer={answer}
                  onChange={(v) => onAnswer({
                    questionId: qid, section: sectionFor, level,
                    prompt: q.prompt, expertVerdict: v,
                  })}
                />
              </div>
              <textarea
                className="eval-input mt-2 text-sm min-h-[60px]"
                placeholder={skillKey === 'writing' ? "Transcribe what the student wrote\u2026" : 'Notes on fluency, accuracy, vocabulary\u2026'}
                value={answer?.note || ''}
                onChange={(e) => onAnswer({
                  questionId: qid, section: sectionFor, level,
                  prompt: q.prompt, expertVerdict: answer?.expertVerdict || 'na', note: e.target.value,
                })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SummarySlide = ({ session, student, studentIdx, onChange, onSendFeedback }) => {
  const totals = useMemo(() => {
    const t = { correct: 0, partial: 0, incorrect: 0, skipped: 0, total: 0 };
    (student.answers || []).forEach((a) => {
      if (!a.expertVerdict || a.expertVerdict === 'na') return;
      t.total += 1;
      t[a.expertVerdict] = (t[a.expertVerdict] || 0) + 1;
    });
    return t;
  }, [student.answers]);

  const [feedbackEmail, setFeedbackEmail] = useState(student.contactEmail || '');
  const [feedbackLink, setFeedbackLink] = useState('');

  const exportText = useMemo(() => {
    const lines = [];
    lines.push(`Waraqa Evaluation Â· ${session.title || ''}`);
    lines.push(`Student: ${student.name}${student.age ? ` (${student.age})` : ''}`);
    if (student.desiredSubjects?.length) lines.push(`Subjects: ${student.desiredSubjects.join(', ')}`);
    if (student.availability) lines.push(`Availability: ${student.availability}`);
    lines.push('');
    lines.push(`Results: ${totals.correct} correct Â· ${totals.partial} partial Â· ${totals.incorrect} incorrect Â· ${totals.skipped} skipped (of ${totals.total})`);
    if (student.recommendedLevel) lines.push(`Recommended level: ${student.recommendedLevel}`);
    if (student.weaknesses?.length) {
      lines.push('');
      lines.push('Areas to focus on:');
      student.weaknesses.forEach((w) => lines.push(` - ${w.area}${w.detail ? `: ${w.detail}` : ''}`));
    }
    if (student.strengths?.length) {
      lines.push('');
      lines.push('Strengths:');
      student.strengths.forEach((s) => lines.push(` - ${s}`));
    }
    if (student.adminSummary) {
      lines.push('');
      lines.push('Notes:');
      lines.push(student.adminSummary);
    }
    return lines.join('\n');
  }, [session, student, totals]);

  const copy = (text) => {
    navigator.clipboard?.writeText(text);
    showToast('Copied to clipboard');
  };

  const exportAll = () => {
    const all = (session.students || []).map((s, i) => {
      const t = { correct: 0, partial: 0, incorrect: 0, skipped: 0, total: 0 };
      (s.answers || []).forEach((a) => {
        if (!a.expertVerdict || a.expertVerdict === 'na') return;
        t.total += 1; t[a.expertVerdict] = (t[a.expertVerdict] || 0) + 1;
      });
      return [
        `# Student ${i + 1}: ${s.name}`,
        `Results: ${t.correct}/${t.total} correct (${t.partial} partial, ${t.incorrect} incorrect)`,
        s.recommendedLevel ? `Recommended level: ${s.recommendedLevel}` : '',
        s.weaknesses?.length ? `Focus on: ${s.weaknesses.map((w) => w.area).join(', ')}` : '',
        s.adminSummary || '',
      ].filter(Boolean).join('\n');
    }).join('\n\n');
    copy(all);
  };

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">Summary Â· {student.name}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Stat label="Correct" value={totals.correct} cls="text-emerald-700" />
        <Stat label="Partial" value={totals.partial} cls="text-amber-700" />
        <Stat label="Incorrect" value={totals.incorrect} cls="text-rose-700" />
        <Stat label="Total answered" value={totals.total} cls="text-foreground" />
      </div>

      <Field label="Recommended level">
        <input className="eval-input" value={student.recommendedLevel || ''} onChange={(e) => onChange({ recommendedLevel: e.target.value })} />
      </Field>

      <div className="mt-3">
        <div className="text-xs font-medium text-muted-foreground mb-1">Areas to focus on</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {WEAKNESS_AREAS.map((area) => {
            const active = (student.weaknesses || []).some((w) => w.area === area);
            return (
              <button
                key={area}
                type="button"
                onClick={() => onChange((s) => ({
                  ...s,
                  weaknesses: active
                    ? (s.weaknesses || []).filter((w) => w.area !== area)
                    : [...(s.weaknesses || []), { area, detail: '' }],
                }))}
                className={`px-2 py-1 rounded-full text-xs border ${active ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-background border-border text-muted-foreground'}`}
              >{area}</button>
            );
          })}
        </div>
      </div>

      <Field label="Notes / next steps">
        <textarea className="eval-input min-h-[100px]" value={student.adminSummary || ''} onChange={(e) => onChange({ adminSummary: e.target.value })} />
      </Field>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => copy(exportText)} className="px-3 py-2 rounded border border-border text-sm">
          <Copy className="inline h-4 w-4" /> Copy this student
        </button>
        <button type="button" onClick={exportAll} className="px-3 py-2 rounded border border-border text-sm">
          <Copy className="inline h-4 w-4" /> Copy all students
        </button>
      </div>

      {/* Feedback */}
      <div className="mt-6 border-t border-border pt-4">
        <div className="font-medium mb-2">Send feedback request</div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="email"
            className="eval-input flex-1 min-w-[220px]"
            placeholder="student@example.com"
            value={feedbackEmail}
            onChange={(e) => setFeedbackEmail(e.target.value)}
          />
          <button
            type="button"
            onClick={async () => {
              const link = await onSendFeedback(feedbackEmail);
              if (link) setFeedbackLink(link);
            }}
            className="px-3 py-2 rounded bg-primary text-primary-foreground text-sm"
          >
            <Send className="inline h-4 w-4" /> Send
          </button>
        </div>
        {(feedbackLink || student.feedback?.token) && (
          <div className="mt-2 flex items-center gap-2 text-sm">
            <LinkIcon className="h-4 w-4 text-muted-foreground" />
            <code className="truncate flex-1">
              {feedbackLink || `${window.location.origin}/dashboard/evaluation/feedback/${student.feedback?.token}`}
            </code>
            <button
              type="button"
              onClick={() => copy(feedbackLink || `${window.location.origin}/dashboard/evaluation/feedback/${student.feedback?.token}`)}
              className="px-2 py-1 rounded border border-border text-xs"
            ><Copy className="inline h-3.5 w-3.5" /></button>
          </div>
        )}
        {student.feedback?.submittedAt && (
          <div className="mt-3 p-3 rounded border border-emerald-300 bg-emerald-50 text-sm">
            <div className="font-medium mb-1 text-emerald-800">Feedback received</div>
            <div className="text-emerald-900 whitespace-pre-wrap">{student.feedback.comment || '(No comment)'}</div>
            <div className="mt-1 text-xs text-emerald-800">
              Overall {student.feedback.ratings?.overall || 'â€“'}/5 Â·
              Knowledge {student.feedback.ratings?.knowledge || 'â€“'}/5 Â·
              Friendliness {student.feedback.ratings?.friendliness || 'â€“'}/5 Â·
              Clarity {student.feedback.ratings?.clarity || 'â€“'}/5 Â·
              Recommend {student.feedback.ratings?.recommend || 'â€“'}/5
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Stat = ({ label, value, cls }) => (
  <div className="border border-border rounded p-2 text-center">
    <div className={`text-2xl font-semibold ${cls}`}>{value}</div>
    <div className="text-xs text-muted-foreground">{label}</div>
  </div>
);

const LinksSlide = () => {
  const copy = (t) => { navigator.clipboard?.writeText(t); showToast('Link copied'); };
  const copyAll = () => copy(IMPORTANT_LINKS.map((l) => `${l.label}: ${l.url}`).join('\n'));
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">Important links</h3>
        <button type="button" onClick={copyAll} className="px-3 py-2 rounded border border-border text-sm">
          <Copy className="inline h-4 w-4" /> Copy all
        </button>
      </div>
      <ul className="divide-y divide-border border border-border rounded">
        {IMPORTANT_LINKS.map((l) => (
          <li key={l.url} className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <div className="font-medium">{l.label}</div>
              <a href={l.url} target="_blank" rel="noreferrer" className="text-xs text-primary truncate block">{l.url}</a>
            </div>
            <button type="button" onClick={() => copy(l.url)} className="px-2 py-1 rounded border border-border text-xs">
              <Copy className="inline h-3.5 w-3.5" /> Copy
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default EvaluationPage;

