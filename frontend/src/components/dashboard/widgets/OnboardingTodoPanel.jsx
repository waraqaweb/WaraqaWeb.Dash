import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive, CheckCircle2, Circle, Copy, RotateCcw, UserPlus, Users, ClipboardList,
  Ban, X, Mail, MessageCircle, StickyNote, Send, Clock3, CheckCheck, Loader2, CalendarClock,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  convertRegistrationLead, getOnboardingTodos, setRegistrationStep,
  addRegistrationNote, sendRegistrationEmail, cancelRegistration,
  completeRegistration, getRegistrationDetails,
} from '../../../api/leads';
import {
  introMessage, postEvaluationMessage, teacherAvailabilityMessage,
  firstClassReminderMessage, firstClassFeedbackMessage, buildRecipient,
} from '../../../utils/onboardingMessages';
import { formatAvailability } from '../../../utils/evaluationMessage';

// Friendly relative phrase: today / yesterday / Tuesday / last Tuesday / 3 Jan.
const naturalDate = (value) => {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const startOf = (x) => { const y = new Date(x); y.setHours(0, 0, 0, 0); return y; };
  const diff = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return DAYS[d.getDay()];
  if (diff < 14) return `last ${DAYS[d.getDay()]}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const fmtDateTime = (v) => {
  try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(v)); }
  catch { return ''; }
};

const sourceBadge = {
  lead: { label: 'Registration form', tone: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  signup: { label: 'Signed up', tone: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  meeting: { label: 'Evaluation meeting', tone: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
};

const rowId = (row) => {
  if (row.kind === 'lead') return `lead_${row._id}`;
  if (row.kind === 'meeting') return `meeting_${row.meetingId}`;
  return `user_${row.userId}`;
};

// The id passed to registration endpoints, keyed by kind.
const regIdOf = (row) => {
  if (row.kind === 'lead') return row._id;
  if (row.kind === 'meeting') return row.meetingId;
  return row.userId;
};

const nameOf = (row) => row.personalInfo?.fullName
  || [row.personalInfo?.firstName, row.personalInfo?.lastName].filter(Boolean).join(' ')
  || '—';

// The full onboarding funnel, in order. `phase` indexes into PHASES (board columns).
// `derived:'account'` is computed from whether the guardian account exists.
// `message` keys map to the copy-ready WhatsApp/email templates.
const STEPS = [
  { key: 'booked',            label: 'Meeting booked',         phase: 0, message: 'intro' },
  { key: 'meetingScheduled',  label: 'Meeting scheduled',      phase: 0 },
  { key: 'evaluated',         label: 'Evaluation done',        phase: 1, message: 'postEval' },
  { key: 'registered',        label: 'Account created',        phase: 2, derived: 'account' },
  { key: 'timesConfirmed',    label: 'Class times confirmed',  phase: 3, message: 'teacher' },
  { key: 'classesCreated',    label: 'Classes created',        phase: 3 },
  { key: 'reminderSent',      label: 'First-class reminder',   phase: 4, message: 'reminder' },
  { key: 'feedbackCollected', label: 'First-class feedback',   phase: 4, message: 'feedback' },
  { key: 'feedbackShared',    label: 'Feedback shared w/ teacher', phase: 4 },
  { key: 'invoiceSent',       label: 'Invoice sent (PayPal)',  phase: 5 },
  { key: 'paid',              label: 'Paid',                   phase: 5 },
  { key: 'onWebsite',         label: 'Added to website',       phase: 5, optional: true },
];

const PHASES = [
  { label: 'Booked',      tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  { label: 'Evaluated',   tone: 'bg-sky-50 text-sky-700 ring-sky-200' },
  { label: 'Registered',  tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  { label: 'Scheduling',  tone: 'bg-blue-50 text-blue-700 ring-blue-200' },
  { label: 'First class', tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
  { label: 'Billing',     tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
];
const READY_TONE = 'bg-emerald-100 text-emerald-800 ring-emerald-300';

const hasAccount = (row) => row.kind === 'signup' || row.status === 'converted' || Boolean(row.accountUserId);

const isStepDone = (row, step) => {
  if (step.derived === 'account') return hasAccount(row);
  return Boolean(row.steps?.[step.key]);
};

const stepStamp = (row, step) => {
  if (step.derived === 'account') return null;
  return row.steps?.[step.key] || null;
};

const requiredSteps = STEPS.filter((s) => !s.optional);

// First incomplete required step's phase = where the card sits. All done => Ready column.
const currentPhaseIndex = (row) => {
  for (const step of requiredSteps) {
    if (!isStepDone(row, step)) return step.phase;
  }
  return PHASES.length; // ready to close
};

const progressOf = (row) => {
  const done = requiredSteps.filter((s) => isStepDone(row, s)).length;
  return { done, total: requiredSteps.length };
};

const isCancelled = (row) => row.status === 'cancelled' || row.status === 'archived';
const isCompleted = (row) => Boolean(row.completedAt);

export default function OnboardingTodoPanel() {
  const { user } = useAuth();
  const adminName = useMemo(
    () => [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'Waraqa',
    [user]
  );

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState('active'); // active | completed | cancelled
  const [activeRow, setActiveRow] = useState(null);
  const [pending, setPending] = useState(''); // `${rowId}:${stepKey}` currently toggling

  const load = async () => {
    try {
      setError('');
      const { leads, signups, meetings } = await getOnboardingTodos();
      const merged = [...leads, ...signups, ...meetings].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setRows(merged);
      // Keep the open modal in sync with refreshed data.
      setActiveRow((prev) => (prev ? merged.find((r) => rowId(r) === rowId(prev)) || null : null));
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load onboarding to-dos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Auto-dismiss the small inline notification next to the header.
  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => setMessage(''), 2500);
    return () => clearTimeout(t);
  }, [message]);

  const buckets = useMemo(() => {
    const active = []; const completed = []; const cancelled = [];
    rows.forEach((r) => {
      if (isCancelled(r)) cancelled.push(r);
      else if (isCompleted(r)) completed.push(r);
      else active.push(r);
    });
    return { active, completed, cancelled };
  }, [rows]);

  // One column per phase + a final "Ready to close" column.
  const boardColumns = useMemo(() => {
    const cols = PHASES.map(() => []);
    cols.push([]);
    buckets.active.forEach((r) => {
      const idx = Math.min(currentPhaseIndex(r), PHASES.length);
      cols[idx].push(r);
    });
    return cols;
  }, [buckets.active]);

  // Toggle a step straight from a card (mark done from outside the modal).
  const toggleStep = async (row, step) => {
    if (step.derived) { setActiveRow(row); return; } // account step: manage in modal
    const key = `${rowId(row)}:${step.key}`;
    const done = isStepDone(row, step);
    setPending(key);
    setRows((prev) => prev.map((r) => (rowId(r) === rowId(row)
      ? { ...r, steps: { ...(r.steps || {}), [step.key]: done ? undefined : new Date().toISOString() } }
      : r)));
    try {
      await setRegistrationStep(row.kind, regIdOf(row), step.key, !done);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to update step');
    } finally {
      setPending('');
      load();
    }
  };

  const completeRow = async (row) => {
    try {
      await completeRegistration(row.kind, regIdOf(row), true);
      setMessage('Registration completed and moved to the Completed tab.');
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to complete registration');
    }
  };

  const tabDefs = [
    ['active', 'Active', buckets.active.length],
    ['completed', 'Completed', buckets.completed.length],
    ['cancelled', 'Cancelled', buckets.cancelled.length],
  ];
  const listRows = buckets[tab] || [];

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Registration funnel</h3>
          <span className="text-xs text-muted-foreground">last 45 days</span>
          {message ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">{message}</span> : null}
        </div>
        <div className="flex items-center gap-1 rounded-full bg-muted p-0.5 text-xs">
          {tabDefs.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-full px-3 py-1 font-semibold transition-colors ${tab === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label} <span className="opacity-70">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {error ? <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
      {loading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
      ) : tab === 'active' ? (
        buckets.active.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No active registrations in the last 45 days.</div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {boardColumns.map((cards, idx) => {
              // Only surface phases that actually hold students — hide empty columns.
              if (cards.length === 0) return null;
              const isReady = idx === PHASES.length;
              const head = isReady ? { label: 'Ready to close', tone: READY_TONE } : PHASES[idx];
              return (
                <div key={idx} className="flex min-w-[210px] max-w-[230px] flex-1 flex-col">
                  <div className={`mb-2 flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ring-1 ${head.tone}`}>
                    <span>{head.label}</span>
                    <span>{cards.length}</span>
                  </div>
                  <div className="max-h-[440px] space-y-2 overflow-y-auto pr-0.5">
                    {cards.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border/60 py-4 text-center text-[11px] text-muted-foreground">—</div>
                    ) : cards.map((row) => (
                      <FunnelCard
                        key={rowId(row)}
                        row={row}
                        pending={pending}
                        ready={isReady}
                        onToggle={toggleStep}
                        onManage={setActiveRow}
                        onComplete={completeRow}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        listRows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Nothing here yet.</div>
        ) : (
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {listRows.map((row) => (
              <SimpleRow key={rowId(row)} row={row} tab={tab} onManage={setActiveRow} />
            ))}
          </div>
        )
      )}

      {activeRow && (
        <RegistrationManageModal
          row={activeRow}
          name={nameOf(activeRow)}
          adminName={adminName}
          onClose={() => setActiveRow(null)}
          onChanged={load}
          setBanner={setMessage}
        />
      )}
    </div>
  );
}

/* ─── Pipeline card (active board) ─────────────────────────────────────── */
function FunnelCard({ row, pending, ready, onToggle, onManage, onComplete }) {
  const studentCount = Array.isArray(row.students) ? row.students.length : 0;
  const { done, total } = progressOf(row);
  const badge = sourceBadge[row.kind] || sourceBadge.lead;
  return (
    <div className="rounded-lg border border-border bg-background/50 p-2.5">
      <button type="button" onClick={() => onManage(row)} className="block w-full text-left">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{nameOf(row)}</span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{done}/{total}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          <span className={`rounded-full px-1.5 py-0.5 font-semibold ${badge.tone}`}>{badge.label}</span>
          {row.isReturning ? <span className="rounded-full bg-purple-50 px-1.5 py-0.5 font-semibold text-purple-700 ring-1 ring-purple-200">Returning</span> : null}
          {row.meeting?.scheduledStart ? <span title="Evaluation meeting time">📅 {naturalDate(row.meeting.scheduledStart)}</span> : <span>{naturalDate(row.createdAt)}</span>}
          {studentCount ? <span>{studentCount} student{studentCount === 1 ? '' : 's'}</span> : null}
        </span>
      </button>
      <div className="mt-2 flex items-center gap-0.5">
        {STEPS.map((step) => {
          const stepDone = isStepDone(row, step);
          const busy = pending === `${rowId(row)}:${step.key}`;
          return (
            <button
              key={step.key}
              type="button"
              title={`${step.label}${stepDone ? ' ✓' : ''}${step.derived ? ' (set automatically)' : ' — click to toggle'}`}
              onClick={() => onToggle(row, step)}
              disabled={busy}
              className={`h-3 w-3 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${stepDone ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 bg-slate-100 hover:border-emerald-400'} ${step.derived ? 'ring-1 ring-offset-1 ring-slate-200' : ''}`}
            />
          );
        })}
      </div>
      {ready && (
        <button
          type="button"
          onClick={() => onComplete(row)}
          className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
        >
          <CheckCheck className="h-3 w-3" /> Complete &amp; close
        </button>
      )}
    </div>
  );
}

/* ─── Simple row (Completed / Cancelled tabs) ──────────────────────────── */
function SimpleRow({ row, tab, onManage }) {
  const badge = sourceBadge[row.kind] || sourceBadge.lead;
  return (
    <button
      type="button"
      onClick={() => onManage(row)}
      className="flex w-full items-center gap-2 rounded-lg border border-border bg-background/40 p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-foreground">{nameOf(row)}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.tone}`}>{badge.label}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>{tab === 'completed'
            ? `Completed ${fmtDateTime(row.completedAt)}`
            : (row.cancelReason ? `Cancelled · ${row.cancelReason}` : 'Cancelled')}</span>
          {row.personalInfo?.email ? <span className="truncate">{row.personalInfo.email}</span> : null}
        </div>
      </div>
      <span className="shrink-0 text-[11px] font-medium text-primary">Open →</span>
    </button>
  );
}

/* ─── Management modal ─────────────────────────────────────────────────── */
function RegistrationManageModal({ row, name, adminName, onClose, onChanged, setBanner }) {
  const kind = row.kind;
  const id = regIdOf(row);
  const email = row.personalInfo?.email || '';
  const phone = row.personalInfo?.phone || '';
  const cancelled = isCancelled(row);
  const completed = isCompleted(row);

  const [busy, setBusy] = useState('');
  const [localError, setLocalError] = useState('');
  const [noteText, setNoteText] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [cancelReasonDraft, setCancelReasonDraft] = useState(null); // string when the in-page reason prompt is open, else null

  const notes = Array.isArray(row.notes) ? row.notes : [];

  // Lazy-load the heavy joins (evaluation availability + scheduled classes)
  // only when this modal opens for this specific registration.
  useEffect(() => {
    let alive = true;
    setDetailsLoading(true);
    getRegistrationDetails(kind, id)
      .then((d) => { if (alive) setDetails(d); })
      .catch(() => { if (alive) setDetails(null); })
      .finally(() => { if (alive) setDetailsLoading(false); });
    return () => { alive = false; };
  }, [kind, id]);

  const run = async (key, fn, okBanner) => {
    setBusy(key); setLocalError('');
    try {
      await fn();
      if (okBanner) setBanner(okBanner);
      await onChanged();
    } catch (err) {
      setLocalError(err?.response?.data?.message || 'Action failed');
    } finally {
      setBusy('');
    }
  };

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); setBanner('Message copied.'); }
    catch { setLocalError('Could not copy — copy manually.'); }
  };

  const openWhatsApp = (text) => {
    const digits = String(phone || '').replace(/[^\d]/g, '');
    const base = digits ? `https://wa.me/${digits}` : 'https://wa.me/';
    window.open(`${base}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  const evalStudents = details?.evaluation?.students || [];
  const classesByStudent = details?.classesByStudent || [];
  const firstUpcomingClass = details?.firstUpcomingClass || null;
  const nextClassAt = firstUpcomingClass?.scheduledDate
    || classesByStudent.find((c) => c.nextClassAt)?.nextClassAt
    || null;
  const nextClassTimezone = firstUpcomingClass?.timezone
    || classesByStudent.find((c) => c.nextClassAt && c.timezone)?.timezone
    || '';

  const startDateLabel = (s) => (s?.expectedStartDate ? new Date(s.expectedStartDate).toLocaleDateString() : '');

  // Personalization: is the guardian the learner, and which honorific to use.
  const recipient = useMemo(
    () => buildRecipient({ guardianName: name, students: row.students, epithet: row.personalInfo?.epithet }),
    [name, row.students, row.personalInfo?.epithet]
  );

  // Build the copy-ready message attached to a step (or '' if none).
  const messageForStep = (step) => {
    switch (step.message) {
      case 'intro': return introMessage(adminName, recipient);
      case 'postEval': return postEvaluationMessage(recipient);
      case 'teacher': {
        const s = evalStudents[0];
        if (!s) return '';
        return teacherAvailabilityMessage({ studentName: s.name, slots: s.availabilitySlots, timezone: s.availabilityTimezone, expectedStartDate: startDateLabel(s) });
      }
      case 'reminder': return firstClassReminderMessage({ recipient, classAt: nextClassAt, studentTimezone: nextClassTimezone });
      case 'feedback': return firstClassFeedbackMessage(recipient);
      default: return '';
    }
  };

  const phaseIdx = currentPhaseIndex(row);
  const stageLabel = cancelled ? 'Cancelled' : completed ? 'Completed'
    : (phaseIdx >= PHASES.length ? 'Ready to close' : PHASES[phaseIdx].label);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-foreground">{name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`rounded-full px-2 py-0.5 font-semibold ${(sourceBadge[kind] || sourceBadge.lead).tone}`}>{(sourceBadge[kind] || sourceBadge.lead).label}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">{stageLabel}</span>
              {row.isReturning ? <span className="rounded-full bg-purple-50 px-2 py-0.5 font-semibold text-purple-700 ring-1 ring-purple-200">Returning guardian</span> : null}
              {row.meeting?.scheduledStart ? <span title="Evaluation meeting">📅 {fmtDateTime(row.meeting.scheduledStart)}</span> : null}
              {email ? <span className="truncate">{email}</span> : null}
              {phone ? <span>{phone}</span> : null}
              {row.personalInfo?.timezone ? <span>{row.personalInfo.timezone}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-4">
          {localError ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{localError}</div> : null}

          {/* Students */}
          {Array.isArray(row.students) && row.students.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {row.students.map((s, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                  <Users className="h-3 w-3" />{s.firstName} {s.lastName}
                  {Array.isArray(s.courses) && s.courses.length ? <span className="text-slate-400">· {s.courses.join(', ')}</span> : null}
                </span>
              ))}
            </div>
          )}

          {detailsLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading availability &amp; scheduled classes…
            </div>
          )}

          {/* Availability from the evaluation (with Cairo conversion) */}
          {!detailsLoading && evalStudents.length > 0 && (
            <section>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" /> Availability (from evaluation)
              </p>
              <div className="space-y-2">
                {evalStudents.map((s, i) => {
                  const tz = s.availabilityTimezone || 'Africa/Cairo';
                  const local = formatAvailability({ slots: s.availabilitySlots, timezone: tz, convertToCairo: false, expectedStartDate: startDateLabel(s) });
                  const cairo = tz !== 'Africa/Cairo'
                    ? formatAvailability({ slots: s.availabilitySlots, timezone: tz, convertToCairo: true })
                    : '';
                  const teacherMsg = teacherAvailabilityMessage({ studentName: s.name, slots: s.availabilitySlots, timezone: tz, expectedStartDate: startDateLabel(s) });
                  return (
                    <div key={i} className="rounded-lg border border-border bg-background p-2.5 text-xs">
                      <div className="font-semibold text-foreground">{s.name || 'Student'}{tz ? <span className="ml-1 font-normal text-muted-foreground">· {tz}</span> : null}</div>
                      {local
                        ? <pre className="mt-1 whitespace-pre-wrap font-sans text-[11px] text-muted-foreground">{local}</pre>
                        : <p className="mt-1 text-[11px] text-muted-foreground">{s.availabilityText || 'No availability recorded in the evaluation.'}</p>}
                      {cairo ? <pre className="mt-1 whitespace-pre-wrap font-sans text-[11px] text-emerald-700">{cairo}</pre> : null}
                      {teacherMsg ? (
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          <button type="button" onClick={() => copyText(teacherMsg)} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-emerald-700"><Copy className="h-3 w-3" /> Copy times for teacher (Cairo)</button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Scheduled classes detection */}
          {!detailsLoading && classesByStudent.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Classes scheduled</p>
              <div className="space-y-1.5">
                {classesByStudent.map((c, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      {c.name}
                      {c.isExistingStudent
                        ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">Existing student</span>
                        : <span className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 ring-1 ring-purple-200">New — add to account</span>}
                    </span>
                    {c.hasClasses
                      ? <span className="text-emerald-700">{c.upcomingCount || c.totalCount} class{(c.upcomingCount || c.totalCount) === 1 ? '' : 'es'}{c.nextClassAt ? ` · next ${fmtDateTime(c.nextClassAt)}` : ''}</span>
                      : <span className="text-amber-600">No classes scheduled yet</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Onboarding steps */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Onboarding steps</p>
            <div className="space-y-2">
              {STEPS.map((step) => {
                const done = isStepDone(row, step);
                const stamp = stepStamp(row, step);
                const msg = messageForStep(step);
                const isAccount = step.derived === 'account';
                return (
                  <div key={step.key} className={`rounded-lg border p-2.5 ${done ? 'border-emerald-300 bg-emerald-50/40' : 'border-border bg-background'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-slate-300" />}
                        <span className={`text-sm font-semibold ${done ? 'text-emerald-800' : 'text-slate-600'}`}>{step.label}</span>
                        {step.optional ? <span className="text-[10px] text-muted-foreground">(optional)</span> : null}
                        {stamp ? <span className="text-[11px] text-muted-foreground">{fmtDateTime(stamp)}</span> : null}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isAccount ? (
                          (kind === 'lead' && !done) ? (
                            <button
                              type="button"
                              disabled={busy === 'convert' || cancelled}
                              onClick={() => run('convert', () => convertRegistrationLead(id), 'Guardian account created.')}
                              className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                              title="Create the guardian account from this registration."
                            >
                              <UserPlus className="h-3 w-3" /> {busy === 'convert' ? 'Creating…' : 'Create account'}
                            </button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">{done ? 'Account exists' : 'Awaiting sign-up'}</span>
                          )
                        ) : (
                          <button
                            type="button"
                            disabled={busy === `step_${step.key}` || cancelled || completed}
                            onClick={() => run(`step_${step.key}`, () => setRegistrationStep(kind, id, step.key, !done))}
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 ${done ? 'border border-slate-200 bg-white text-slate-600' : 'bg-primary text-white'}`}
                          >
                            {done ? 'Mark not done' : 'Mark done'}
                          </button>
                        )}
                      </div>
                    </div>
                    {msg && (
                      <div className="mt-1.5 flex flex-wrap gap-2 pl-6">
                        <button type="button" onClick={() => copyText(msg)} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-emerald-700"><Copy className="h-3 w-3" /> Copy message</button>
                        <button type="button" onClick={() => openWhatsApp(msg)} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-emerald-700"><MessageCircle className="h-3 w-3" /> WhatsApp</button>
                        {(step.message === 'intro' || step.message === 'postEval') && (
                          <button
                            type="button"
                            onClick={() => { setSubject(step.message === 'intro' ? 'Welcome to Waraqa' : 'Your Waraqa evaluation — next steps'); setBody(msg); }}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-emerald-700"
                          >
                            <Mail className="h-3 w-3" /> Use in email
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Compose email */}
          <section>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Mail className="h-3.5 w-3.5" /> Send email</p>
            <div className="space-y-2">
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message… (sent as a branded Waraqa email)"
                rows={4}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">{email ? `To: ${email}` : 'No email on file'}</span>
                <button
                  type="button"
                  disabled={busy === 'email' || !email || !subject.trim() || !body.trim()}
                  onClick={() => run('email', async () => { await sendRegistrationEmail(kind, id, subject.trim(), body.trim()); setSubject(''); setBody(''); }, 'Email sent.')}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" /> {busy === 'email' ? 'Sending…' : 'Send email'}
                </button>
              </div>
            </div>
          </section>

          {/* Notes */}
          <section>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><StickyNote className="h-3.5 w-3.5" /> Notes</p>
            {notes.length > 0 && (
              <div className="mb-2 space-y-1.5">
                {notes.slice().reverse().map((n, i) => (
                  <div key={i} className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-foreground">
                    <p className="whitespace-pre-wrap">{n.text}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{n.byName || 'Admin'} · {n.at ? fmtDateTime(n.at) : ''}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note about this registration…"
                rows={2}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busy === 'note' || !noteText.trim()}
                onClick={() => run('note', async () => { await addRegistrationNote(kind, id, noteText.trim()); setNoteText(''); }, 'Note added.')}
                className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy === 'note' ? 'Adding…' : 'Add note'}
              </button>
            </div>
          </section>
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" /> Registered {row.createdAt ? fmtDateTime(row.createdAt) : ''}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!cancelled && (completed ? (
              <button
                type="button"
                disabled={busy === 'complete'}
                onClick={() => run('complete', () => completeRegistration(kind, id, false), 'Reopened.')}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reopen
              </button>
            ) : (
              <button
                type="button"
                disabled={busy === 'complete'}
                onClick={() => run('complete', () => completeRegistration(kind, id, true), 'Completed and moved to the Completed tab.')}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Complete &amp; close
              </button>
            ))}
            {cancelled ? (
              <button
                type="button"
                disabled={busy === 'cancel'}
                onClick={() => run('cancel', () => cancelRegistration(kind, id, false), 'Restored.')}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </button>
            ) : (
              <button
                type="button"
                disabled={busy === 'cancel'}
                onClick={() => setCancelReasonDraft('')}
                className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50"
              >
                {kind === 'lead' ? <Archive className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />} Report cancelled
              </button>
            )}
            <button type="button" onClick={onClose} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground">Close</button>
          </div>
        </div>
      </div>

      {cancelReasonDraft !== null ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setCancelReasonDraft(null)}>
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">Report cancelled</h3>
            <p className="mt-1 text-xs text-muted-foreground">Reason this registration is cancelled? (optional)</p>
            <textarea
              autoFocus
              rows={3}
              value={cancelReasonDraft}
              onChange={(e) => setCancelReasonDraft(e.target.value)}
              placeholder="e.g. No response after multiple follow-ups"
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelReasonDraft(null)}
                className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy === 'cancel'}
                onClick={() => {
                  const reason = cancelReasonDraft;
                  setCancelReasonDraft(null);
                  run('cancel', () => cancelRegistration(kind, id, true, reason), 'Marked as cancelled.');
                }}
                className="rounded-full bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
