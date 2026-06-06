import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive, CheckCircle2, Circle, Copy, RotateCcw, UserPlus, Users, ClipboardList,
  Ban, X, Mail, MessageCircle, StickyNote, Send, Clock3,
} from 'lucide-react';
import {
  convertRegistrationLead, getOnboardingTodos, setRegistrationStep,
  addRegistrationNote, sendRegistrationEmail, cancelRegistration,
} from '../../../api/leads';

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

const buildStepMessage = (step, name) => {
  const who = name || 'there';
  switch (step) {
    case 'contacted':
      return `Assalamu alaikum ${who}! 🌟\n\nThank you for registering with Waraqa. We're excited to help your family start learning. To get you set up, we'd love to book a short, free evaluation session at a time that works for you.\n\nWhen would be a good time to talk?`;
    case 'evaluationDone':
      return `Assalamu alaikum ${who},\n\nThank you for attending the evaluation! 🎉 We've noted the level and your preferred schedule. We'll now match you with the best teacher and confirm your class times shortly.`;
    case 'classScheduled':
      return `Assalamu alaikum ${who},\n\nGreat news — your classes are scheduled! 📅 Your teacher will meet you at the agreed times. Please log in to your dashboard to see the details. Welcome to Waraqa!`;
    default:
      return '';
  }
};

const sourceBadge = {
  lead: { label: 'Registration form', tone: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  signup: { label: 'Signed up', tone: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
};

const rowId = (row) => (row.kind === 'lead' ? `lead_${row._id}` : `user_${row.userId}`);

// The funnel steps in order. registered + account are derived/locked.
const FUNNEL = [
  { key: 'registered', label: 'Registered', locked: true },
  { key: 'contacted', label: 'Contacted', field: 'contactedAt' },
  { key: 'evaluationDone', label: 'Evaluated', field: 'evaluationDoneAt' },
  { key: 'accountCreated', label: 'Account created', locked: true },
  { key: 'classScheduled', label: 'Class scheduled', field: 'classScheduledAt' },
];

const isStepDone = (row, step) => {
  const ob = row.onboarding || {};
  const hasAccount = row.kind === 'signup' || row.status === 'converted';
  switch (step.key) {
    case 'registered': return true;
    case 'accountCreated': return hasAccount;
    case 'contacted': return Boolean(ob.contactedAt);
    case 'evaluationDone': return Boolean(ob.evaluationDoneAt);
    case 'classScheduled': return Boolean(ob.classScheduledAt);
    default: return false;
  }
};

const stepStamp = (row, step) => {
  const ob = row.onboarding || {};
  if (step.key === 'registered') return row.createdAt;
  if (step.key === 'accountCreated') return row.conversion?.convertedAt || (row.kind === 'signup' ? row.createdAt : null);
  return ob[step.field];
};

// Current stage = the furthest completed milestone (or Cancelled / New).
const currentStage = (row) => {
  if (row.status === 'cancelled' || row.status === 'archived') {
    return { label: 'Cancelled', tone: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' };
  }
  const ob = row.onboarding || {};
  const hasAccount = row.kind === 'signup' || row.status === 'converted';
  if (ob.classScheduledAt) return { label: 'Class scheduled', tone: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' };
  if (hasAccount) return { label: 'Account created', tone: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' };
  if (ob.evaluationDoneAt) return { label: 'Evaluated', tone: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' };
  if (ob.contactedAt) return { label: 'Contacted', tone: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' };
  return { label: 'New — needs contact', tone: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' };
};

export default function OnboardingTodoPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [activeRow, setActiveRow] = useState(null); // row currently open in the modal

  const load = async () => {
    try {
      setError('');
      const { leads, signups } = await getOnboardingTodos();
      const merged = [...leads, ...signups].sort(
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

  const nameOf = (row) => row.personalInfo?.fullName
    || [row.personalInfo?.firstName, row.personalInfo?.lastName].filter(Boolean).join(' ')
    || '—';

  const counts = useMemo(() => ({
    total: rows.length,
    needsAction: rows.filter((r) => currentStage(r).label.startsWith('New')).length,
  }), [rows]);

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">New registrations to-do</h3>
          <span className="text-xs text-muted-foreground">last 3 weeks</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">{counts.total} total</span>
          {counts.needsAction > 0 && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">{counts.needsAction} need contact</span>
          )}
        </div>
      </div>

      {message ? <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</div> : null}
      {error ? <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}

      {loading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">No new registrations in the last 3 weeks.</div>
      ) : (
        // ~5 rows tall, then scroll inside the panel (page does not grow).
        <div className="max-h-[330px] space-y-2 overflow-y-auto pr-1">
          {rows.map((row) => {
            const id = rowId(row);
            const name = nameOf(row);
            const badge = sourceBadge[row.kind] || sourceBadge.lead;
            const stage = currentStage(row);
            const studentCount = Array.isArray(row.students) ? row.students.length : 0;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveRow(row)}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-background/40 p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-foreground">{name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.tone}`}>{badge.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${stage.tone}`}>{stage.label}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>{naturalDate(row.createdAt)}</span>
                    {studentCount ? <span>{studentCount} student{studentCount === 1 ? '' : 's'}</span> : null}
                    {row.personalInfo?.timezone ? <span>{row.personalInfo.timezone}</span> : null}
                    {row.personalInfo?.email ? <span className="truncate">{row.personalInfo.email}</span> : null}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] font-medium text-primary">Manage →</span>
              </button>
            );
          })}
        </div>
      )}

      {activeRow && (
        <RegistrationManageModal
          row={activeRow}
          name={nameOf(activeRow)}
          onClose={() => setActiveRow(null)}
          onChanged={load}
          setBanner={setMessage}
        />
      )}
    </div>
  );
}

/* ─── Management modal ─────────────────────────────────────────────────── */
function RegistrationManageModal({ row, name, onClose, onChanged, setBanner }) {
  const kind = row.kind;
  const id = kind === 'lead' ? row._id : row.userId;
  const email = row.personalInfo?.email || '';
  const phone = row.personalInfo?.phone || '';
  const cancelled = row.status === 'cancelled' || row.status === 'archived';

  const [busy, setBusy] = useState('');
  const [localError, setLocalError] = useState('');
  const [noteText, setNoteText] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const notes = Array.isArray(row.notes) ? row.notes : [];

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
    if (!digits) { setLocalError('No phone number on file for WhatsApp.'); return; }
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-foreground">{name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`rounded-full px-2 py-0.5 font-semibold ${(sourceBadge[kind] || sourceBadge.lead).tone}`}>{(sourceBadge[kind] || sourceBadge.lead).label}</span>
              <span className={`rounded-full px-2 py-0.5 font-semibold ${currentStage(row).tone}`}>{currentStage(row).label}</span>
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

          {/* Onboarding steps */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Onboarding steps</p>
            <div className="space-y-2">
              {FUNNEL.map((step) => {
                const done = isStepDone(row, step);
                const stamp = stepStamp(row, step);
                const msg = buildStepMessage(step.key, name);
                return (
                  <div key={step.key} className={`rounded-lg border p-2.5 ${done ? 'border-emerald-300 bg-emerald-50/40' : 'border-border bg-background'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-slate-300" />}
                        <span className={`text-sm font-semibold ${done ? 'text-emerald-800' : 'text-slate-600'}`}>{step.label}</span>
                        {stamp ? <span className="text-[11px] text-muted-foreground">{fmtDateTime(stamp)}</span> : null}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {!step.locked && (
                          <button
                            type="button"
                            disabled={busy === `step_${step.key}` || cancelled}
                            onClick={() => run(`step_${step.key}`, () => setRegistrationStep(kind, id, step.key, !done))}
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 ${done ? 'border border-slate-200 bg-white text-slate-600' : 'bg-primary text-white'}`}
                          >
                            {done ? 'Mark not done' : 'Mark done'}
                          </button>
                        )}
                        {step.key === 'accountCreated' && kind === 'lead' && !done && (
                          <button
                            type="button"
                            disabled={busy === 'convert' || cancelled}
                            onClick={() => run('convert', () => convertRegistrationLead(id), 'Guardian account created.')}
                            className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                            title="Create the guardian account from this registration."
                          >
                            <UserPlus className="h-3 w-3" /> {busy === 'convert' ? 'Creating…' : 'Create account'}
                          </button>
                        )}
                      </div>
                    </div>
                    {msg && (
                      <div className="mt-1.5 flex flex-wrap gap-2 pl-6">
                        <button type="button" onClick={() => copyText(msg)} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-emerald-700"><Copy className="h-3 w-3" /> Copy message</button>
                        <button type="button" onClick={() => openWhatsApp(msg)} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-emerald-700"><MessageCircle className="h-3 w-3" /> WhatsApp</button>
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
          <div className="flex items-center gap-2">
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
                onClick={() => {
                  const reason = window.prompt('Reason this registration is cancelled? (optional)') ?? null;
                  if (reason === null) return; // user pressed Cancel on the prompt
                  run('cancel', () => cancelRegistration(kind, id, true, reason), 'Marked as cancelled.');
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50"
              >
                {kind === 'lead' ? <Archive className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />} Report cancelled
              </button>
            )}
            <button type="button" onClick={onClose} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
