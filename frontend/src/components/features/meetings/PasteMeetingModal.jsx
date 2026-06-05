import React, { useMemo, useState } from 'react';
import { ClipboardPaste, Loader2, X, Sparkles, Calendar, Users, Mail, Phone, FileText, AlertCircle, Trash2, Plus } from 'lucide-react';
import { adminCreateMeeting } from '../../../api/meetings';
import { parseMeetingPaste } from '../../../utils/parseMeetingPaste';

const formatPreviewWhen = (iso, timezone) => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZone: timezone || 'UTC',
      timeZoneName: 'short',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
};

const MEETING_TYPE_OPTIONS = [
  { value: 'new_student_evaluation', label: 'New student evaluation' },
  { value: 'current_student_follow_up', label: 'Guardian follow-up' },
  { value: 'teacher_sync', label: 'Teacher sync' },
];

export default function PasteMeetingModal({ open, onClose, onCreated }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [parseError, setParseError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');

  if (!open) return null;

  const reset = () => {
    setText('');
    setParsed(null);
    setParseError('');
    setServerError('');
    setSubmitting(false);
  };

  const close = () => { reset(); onClose?.(); };

  const handleParse = () => {
    setServerError('');
    const result = parseMeetingPaste(text);
    if (!result.ok) {
      setParseError(result.error || 'Could not parse the pasted text.');
      setParsed(result.value || null);
      return;
    }
    setParseError('');
    setParsed(result.value);
  };

  const updateParsed = (patch) => setParsed((prev) => ({ ...prev, ...patch }));
  const updateGuardian = (patch) => setParsed((prev) => ({
    ...prev,
    guardian: { ...(prev?.guardian || {}), ...patch },
  }));
  const updateStudent = (idx, patch) => setParsed((prev) => {
    const students = [...(prev?.students || [])];
    students[idx] = { ...students[idx], ...patch };
    return { ...prev, students };
  });
  const removeStudent = (idx) => setParsed((prev) => {
    const students = (prev?.students || []).filter((_, i) => i !== idx);
    return { ...prev, students };
  });
  const addStudent = () => setParsed((prev) => ({
    ...prev,
    students: [...(prev?.students || []), { studentName: '', age: undefined, gender: '', courses: [], notes: '' }],
  }));

  const handleSubmit = async () => {
    if (!parsed) return;
    setSubmitting(true);
    setServerError('');
    try {
      const meeting = await adminCreateMeeting({
        meetingType: parsed.meetingType,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        timezone: parsed.timezone,
        guardian: parsed.guardian,
        students: (parsed.students || []).map((s) => ({
          studentName: s.studentName,
          notes: [s.notes, (s.courses || []).join('\n')].filter(Boolean).join('\n\n') || undefined,
        })),
        notes: parsed.notes,
        calendarPreference: parsed.calendarPreference,
        meetingLink: parsed.meetingLink,
      });
      onCreated?.(meeting);
      close();
    } catch (err) {
      setServerError(err?.response?.data?.message || err?.message || 'Failed to create meeting');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-teal-50">
          <div className="flex items-center gap-2">
            <ClipboardPaste className="h-5 w-5 text-emerald-700" />
            <div>
              <h2 className="text-base font-semibold text-emerald-900">Create meeting from paste</h2>
              <p className="text-[11px] text-emerald-700/80">Paste a booking summary — labels in any order are accepted.</p>
            </div>
          </div>
          <button type="button" onClick={close} className="text-slate-500 hover:text-slate-700 rounded-full p-1 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!parsed ? (
            <>
              <textarea
                className="w-full min-h-[260px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-mono leading-snug focus:outline-none focus:ring-2 focus:ring-emerald-400"
                placeholder={`Full name\nCassandra Joof\nGuardian first name\nCassandra\n…\nStarts (your timezone)\n06 Jun 2026, 20:00\nEnds (your timezone)\n06 Jun 2026, 20:30\nStudents\nCassandra Joof\n\nAge: 45 · Gender: female\n…`}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              {parseError ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{parseError}</span>
                </div>
              ) : null}
            </>
          ) : (
            <ParsedPreview
              parsed={parsed}
              parseError={parseError}
              serverError={serverError}
              onUpdate={updateParsed}
              onUpdateGuardian={updateGuardian}
              onUpdateStudent={updateStudent}
              onRemoveStudent={removeStudent}
              onAddStudent={addStudent}
              onEditRaw={() => { setParsed(null); setParseError(''); setServerError(''); }}
            />
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button type="button" onClick={close} className="px-3 py-1.5 rounded-full border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-100">
            Cancel
          </button>
          {!parsed ? (
            <button
              type="button"
              onClick={handleParse}
              disabled={!text.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles className="h-4 w-4" /> Parse paste
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !parsed.startTime}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
              {submitting ? 'Creating…' : 'Create meeting'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

const ParsedPreview = ({
  parsed,
  parseError,
  serverError,
  onUpdate,
  onUpdateGuardian,
  onUpdateStudent,
  onRemoveStudent,
  onAddStudent,
  onEditRaw,
}) => {
  const meetingTypeOption = useMemo(
    () => MEETING_TYPE_OPTIONS.find((o) => o.value === parsed.meetingType) || MEETING_TYPE_OPTIONS[0],
    [parsed.meetingType],
  );

  return (
    <div className="space-y-4">
      {parseError ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>{parseError}</span>
        </div>
      ) : null}
      {serverError ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>{serverError}</span>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
          <Calendar className="h-4 w-4 text-sky-600" /> Meeting
        </h3>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <Field label="Meeting type">
            <select
              className="w-full rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={parsed.meetingType}
              onChange={(e) => onUpdate({ meetingType: e.target.value })}
            >
              {MEETING_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Timezone (admin)">
            <input
              className="w-full rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={parsed.timezone || ''}
              onChange={(e) => onUpdate({ timezone: e.target.value })}
            />
          </Field>
          <Field label={`Starts (${parsed.timezone || 'UTC'})`}>
            <div className="text-sm text-slate-700">
              {formatPreviewWhen(parsed.startTime, parsed.timezone)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">{parsed.startTime || 'missing'}</div>
          </Field>
          <Field label={`Ends (${parsed.timezone || 'UTC'})`}>
            <div className="text-sm text-slate-700">
              {formatPreviewWhen(parsed.endTime, parsed.timezone)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">{parsed.endTime || '(auto-calc)'}</div>
          </Field>
        </div>
        <p className="text-[11px] text-slate-500">
          Detected as <strong>{meetingTypeOption.label}</strong>. Slot/availability guards are bypassed for paste-created meetings.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
          <Mail className="h-4 w-4 text-indigo-600" /> Guardian
        </h3>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <Field label="Full name">
            <input
              className="w-full rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={parsed.guardian?.guardianName || ''}
              onChange={(e) => onUpdateGuardian({ guardianName: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              className="w-full rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={parsed.guardian?.guardianEmail || ''}
              onChange={(e) => onUpdateGuardian({ guardianEmail: e.target.value })}
            />
          </Field>
          <Field label="WhatsApp / phone">
            <div className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-slate-400" />
              <input
                className="w-full rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={parsed.guardian?.guardianPhone || ''}
                onChange={(e) => onUpdateGuardian({ guardianPhone: e.target.value })}
              />
            </div>
          </Field>
          <Field label="Student timezone">
            <input
              className="w-full rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={parsed.studentTimezone || ''}
              onChange={(e) => onUpdate({ studentTimezone: e.target.value })}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
            <Users className="h-4 w-4 text-emerald-600" /> Students ({(parsed.students || []).length})
          </h3>
          <button type="button" onClick={onAddStudent} className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        {(parsed.students || []).map((s, idx) => (
          <div key={idx} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <input
                className="flex-1 rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium"
                value={s.studentName || ''}
                onChange={(e) => onUpdateStudent(idx, { studentName: e.target.value })}
                placeholder="Student name"
              />
              <button type="button" onClick={() => onRemoveStudent(idx)} className="text-rose-600 hover:bg-rose-100 p-1.5 rounded-full">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid sm:grid-cols-3 gap-2 text-xs">
              <Field label="Age">
                <input
                  type="number"
                  className="w-full rounded-xl border border-slate-300 bg-white px-2 py-1 text-sm"
                  value={s.age ?? ''}
                  onChange={(e) => onUpdateStudent(idx, { age: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                />
              </Field>
              <Field label="Gender">
                <input
                  className="w-full rounded-xl border border-slate-300 bg-white px-2 py-1 text-sm"
                  value={s.gender || ''}
                  onChange={(e) => onUpdateStudent(idx, { gender: e.target.value })}
                />
              </Field>
            </div>
            {(s.courses || []).length ? (
              <div className="rounded-lg bg-white border border-slate-200 px-2 py-1.5 text-[11px] text-slate-600 leading-snug">
                <span className="font-semibold text-slate-700">Courses</span>
                <ul className="list-disc list-inside mt-0.5">
                  {(s.courses || []).map((c, ci) => <li key={ci}>{c}</li>)}
                </ul>
              </div>
            ) : null}
            <Field label="Student notes">
              <textarea
                className="w-full rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm min-h-[60px]"
                value={s.notes || ''}
                onChange={(e) => onUpdateStudent(idx, { notes: e.target.value })}
              />
            </Field>
          </div>
        ))}
        {!(parsed.students || []).length ? (
          <div className="text-xs text-slate-500">No students detected. Add at least one to proceed.</div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
          <FileText className="h-4 w-4 text-amber-600" /> Notes &amp; link
        </h3>
        <Field label="Meeting link">
          <input
            className="w-full rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm"
            value={parsed.meetingLink || ''}
            onChange={(e) => onUpdate({ meetingLink: e.target.value })}
            placeholder="https://meet.google.com/…"
          />
        </Field>
        <Field label="Notes (from booker)">
          <textarea
            className="w-full rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm min-h-[80px]"
            value={parsed.notes || ''}
            onChange={(e) => onUpdate({ notes: e.target.value })}
          />
        </Field>
      </section>

      <button type="button" onClick={onEditRaw} className="text-[11px] text-slate-500 hover:text-slate-700 underline">
        ← Edit raw paste
      </button>
    </div>
  );
};

const Field = ({ label, children }) => (
  <div>
    <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">{label}</label>
    {children}
  </div>
);
