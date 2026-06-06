import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive, CheckCircle2, ChevronDown, ChevronUp, Circle, Copy, RotateCcw,
  UserPlus, Users, ClipboardList, Ban,
} from 'lucide-react';
import api from '../../../api/axios';
import {
  archiveRegistrationLead, convertRegistrationLead, getOnboardingTodos, updateLeadOnboarding,
} from '../../../api/leads';

// Turn a date into a friendly relative phrase: today / yesterday / Tuesday / last Tuesday / 3 Jan.
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

const statusBadge = {
  new: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  converted: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  archived: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  account: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  cancelled: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};

const statusLabel = {
  new: 'Needs follow-up',
  converted: 'Account created',
  archived: 'Cancelled',
  account: 'Has account',
  cancelled: 'Cancelled',
};

export default function OnboardingTodoPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = async () => {
    try {
      setError('');
      const { leads, signups } = await getOnboardingTodos();
      const merged = [...leads, ...signups].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setRows(merged);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load onboarding to-dos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const rowId = (row) => (row.kind === 'lead' ? `lead_${row._id}` : `user_${row.userId}`);
  const nameOf = (row) => row.personalInfo?.fullName
    || [row.personalInfo?.firstName, row.personalInfo?.lastName].filter(Boolean).join(' ')
    || '—';

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); setMessage('Message copied.'); }
    catch { setMessage('Could not copy — please copy manually.'); }
  };

  const handleConvert = async (leadId) => {
    try {
      setBusyId(`lead_${leadId}`); setMessage('');
      const result = await convertRegistrationLead(leadId);
      setMessage(`Account created. Temporary password: ${result.password}`);
      await load();
    } catch (err) {
      setMessage(err?.response?.data?.message || 'Failed to create account');
    } finally { setBusyId(''); }
  };

  const handleArchive = async (leadId, archived) => {
    const reason = archived ? (window.prompt('Reason this guardian cancelled? (optional)') ?? '') : '';
    try {
      setBusyId(`lead_${leadId}`); setMessage('');
      await archiveRegistrationLead(leadId, archived, reason);
      setMessage(archived ? 'Marked as cancelled.' : 'Restored.');
      await load();
    } catch (err) {
      setMessage(err?.response?.data?.message || 'Failed to update');
    } finally { setBusyId(''); }
  };

  const handleSignupCancel = async (userId, deactivate) => {
    if (deactivate && !window.confirm('Mark this guardian as cancelled? Their account will be deactivated.')) return;
    try {
      setBusyId(`user_${userId}`); setMessage('');
      await api.put(`/users/${userId}/status`, { isActive: !deactivate });
      setMessage(deactivate ? 'Guardian marked as cancelled.' : 'Guardian reactivated.');
      await load();
    } catch (err) {
      setMessage(err?.response?.data?.message || 'Failed to update guardian');
    } finally { setBusyId(''); }
  };

  const handleOnboardingToggle = async (leadId, step, done) => {
    const fieldKey = { contacted: 'contactedAt', evaluationDone: 'evaluationDoneAt', classScheduled: 'classScheduledAt' }[step];
    setRows((prev) => prev.map((r) => (r.kind === 'lead' && r._id === leadId
      ? { ...r, onboarding: { ...(r.onboarding || {}), [fieldKey]: done ? new Date().toISOString() : null } }
      : r)));
    try { await updateLeadOnboarding(leadId, step, done); }
    catch (err) { setMessage(err?.response?.data?.message || 'Failed to update step'); await load(); }
  };

  const counts = useMemo(() => ({
    total: rows.length,
    needsAction: rows.filter((r) => (r.kind === 'lead' && r.status === 'new')).length,
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
            <span className="rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-blue-700">{counts.needsAction} need follow-up</span>
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
        <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
          {rows.map((row) => {
            const id = rowId(row);
            const isOpen = expandedId === id;
            const name = nameOf(row);
            const badge = sourceBadge[row.kind] || sourceBadge.lead;
            const studentCount = Array.isArray(row.students) ? row.students.length : 0;
            const busy = busyId === id;
            const ob = row.onboarding || {};

            return (
              <div key={id} className="rounded-lg border border-border bg-background/40">
                <div className="flex items-center gap-2 p-2.5">
                  <button
                    type="button"
                    onClick={() => row.kind === 'lead' && setExpandedId(isOpen ? '' : id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-foreground">{name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.tone}`}>{badge.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadge[row.status] || 'bg-slate-100 text-slate-600'}`}>
                        {statusLabel[row.status] || row.status}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>{naturalDate(row.createdAt)}</span>
                      {studentCount ? <span>{studentCount} student{studentCount === 1 ? '' : 's'}</span> : null}
                      {row.personalInfo?.timezone ? <span>{row.personalInfo.timezone}</span> : null}
                      {row.personalInfo?.email ? <span className="truncate">{row.personalInfo.email}</span> : null}
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {row.kind === 'lead' && row.status !== 'converted' && row.status !== 'archived' && (
                      <button
                        type="button"
                        onClick={() => handleConvert(row._id)}
                        disabled={busy}
                        title="Create the guardian account from this registration (this is how you confirm them)."
                        className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                      >
                        <UserPlus className="h-3 w-3" /> {busy ? '…' : 'Confirm'}
                      </button>
                    )}
                    {row.kind === 'lead' && row.status === 'new' && (
                      <button
                        type="button"
                        onClick={() => handleArchive(row._id, true)}
                        disabled={busy}
                        title="Report that this guardian cancelled / is not proceeding."
                        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 disabled:opacity-60"
                      >
                        <Archive className="h-3 w-3" /> Cancel
                      </button>
                    )}
                    {row.kind === 'lead' && row.status === 'archived' && (
                      <button
                        type="button"
                        onClick={() => handleArchive(row._id, false)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                      >
                        <RotateCcw className="h-3 w-3" /> Restore
                      </button>
                    )}
                    {row.kind === 'signup' && row.status !== 'cancelled' && (
                      <button
                        type="button"
                        onClick={() => handleSignupCancel(row.userId, true)}
                        disabled={busy}
                        title="Report that this guardian cancelled (deactivates their account)."
                        className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-60"
                      >
                        <Ban className="h-3 w-3" /> Cancel
                      </button>
                    )}
                    {row.kind === 'signup' && row.status === 'cancelled' && (
                      <button
                        type="button"
                        onClick={() => handleSignupCancel(row.userId, false)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                      >
                        <RotateCcw className="h-3 w-3" /> Reactivate
                      </button>
                    )}
                    {row.kind === 'lead' && (
                      <span className="text-muted-foreground">{isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
                    )}
                  </div>
                </div>

                {row.kind === 'lead' && isOpen && (
                  <div className="border-t border-border/60 px-2.5 pb-3 pt-2">
                    <div className="flex flex-wrap gap-2">
                      {[
                        { key: 'registered', label: 'Registered', done: true, locked: true },
                        { key: 'contacted', label: 'Contacted', done: Boolean(ob.contactedAt) },
                        { key: 'evaluationDone', label: 'Evaluated', done: Boolean(ob.evaluationDoneAt) },
                        { key: 'accountCreated', label: 'Account', done: row.status === 'converted', locked: true },
                        { key: 'classScheduled', label: 'Class set', done: Boolean(ob.classScheduledAt) },
                      ].map((step) => {
                        const msg = buildStepMessage(step.key, name);
                        return (
                          <div key={step.key} className={`min-w-[130px] flex-1 rounded-lg border p-2 ${step.done ? 'border-emerald-300 bg-emerald-50/40' : 'border-border bg-background'}`}>
                            <div className="flex items-center gap-1.5">
                              {step.done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Circle className="h-3.5 w-3.5 text-slate-300" />}
                              <span className={`text-xs font-semibold ${step.done ? 'text-emerald-800' : 'text-slate-600'}`}>{step.label}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              {!step.locked && (
                                <button type="button" onClick={() => handleOnboardingToggle(row._id, step.key, !step.done)} className="text-[10px] font-medium text-emerald-700 underline">
                                  {step.done ? 'Undo' : 'Mark done'}
                                </button>
                              )}
                              {msg && (
                                <button type="button" onClick={() => copyText(msg)} className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 hover:text-emerald-700" title="Copy message">
                                  <Copy className="h-3 w-3" /> Copy
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {studentCount > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {row.students.map((s, i) => (
                          <span key={`${id}-s${i}`} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                            <Users className="h-3 w-3" />{s.firstName} {s.lastName}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
