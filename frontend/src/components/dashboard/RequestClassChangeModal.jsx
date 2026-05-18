import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import api from '../../api/axios';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Teacher-facing modal: submit a permanent class-change request that an
 * admin must approve. Lets the teacher tweak subject / description /
 * duration / recurrence (frequency + interval + days of week).
 *
 * Props:
 *   classItem  — the class document the teacher wants to modify
 *   onClose()  — closes the modal
 *   onSuccess() — called after a successful submission
 */
const RequestClassChangeModal = ({ classItem, onClose, onSuccess }) => {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('');
  const [frequency, setFrequency] = useState('');
  const [interval, setIntervalValue] = useState('');
  const [daysOfWeek, setDaysOfWeek] = useState([]);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [subjectsCatalog, setSubjectsCatalog] = useState([]);

  // Load catalog subjects once for the picker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/settings/subjects-catalog').catch(() => null);
        const list = res?.data?.subjects || res?.data?.setting?.value || res?.data?.value || [];
        if (!cancelled && Array.isArray(list)) {
          setSubjectsCatalog(list.map((s) => (typeof s === 'string' ? s : s?.name || s?.value)).filter(Boolean));
        }
      } catch (_) { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const current = useMemo(() => ({
    subject: classItem?.subject || '',
    description: classItem?.description || '',
    duration: classItem?.duration ?? 60,
    frequency: classItem?.recurrence?.frequency || '',
    interval: classItem?.recurrence?.interval ?? 1,
    daysOfWeek: Array.isArray(classItem?.recurrence?.daysOfWeek) ? classItem.recurrence.daysOfWeek : [],
  }), [classItem]);

  const toggleDay = (d) => {
    setDaysOfWeek((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
  };

  // Build only the fields that the teacher actually changed.
  const buildRequestedChanges = () => {
    const out = {};
    if (subject && subject !== current.subject) out.subject = subject.trim();
    if (description && description !== current.description) out.description = description;
    const durNum = Number(duration);
    if (duration !== '' && Number.isFinite(durNum) && durNum !== current.duration) out.duration = durNum;
    const rec = {};
    if (frequency && frequency !== current.frequency) rec.frequency = frequency;
    const intNum = Number(interval);
    if (interval !== '' && Number.isFinite(intNum) && intNum !== current.interval) rec.interval = intNum;
    if (daysOfWeek.length && JSON.stringify(daysOfWeek) !== JSON.stringify(current.daysOfWeek)) rec.daysOfWeek = daysOfWeek;
    if (Object.keys(rec).length) out.recurrence = rec;
    return out;
  };

  const requestedChanges = buildRequestedChanges();
  const hasChanges = Object.keys(requestedChanges).length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!hasChanges) {
      setError('Please change at least one field before submitting.');
      return;
    }
    if (!reason.trim()) {
      setError('Please add a brief reason for this request.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/class-change-requests', {
        classId: classItem?._id,
        changes: requestedChanges,
        reason: reason.trim(),
      });
      onSuccess?.();
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <div className="text-base font-semibold text-foreground">Request class change</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Sends a pending request to the admin for approval. Past classes are not affected.
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-muted-foreground">
            <div><strong className="text-foreground">Current:</strong> {current.subject || '—'} · {current.duration}min · {current.frequency || 'one-off'}{current.daysOfWeek?.length ? ` · ${current.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ')}` : ''}</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-muted-foreground">
              New subject
              {subjectsCatalog.length > 0 ? (
                <input
                  list="rcc-subjects"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={current.subject}
                  className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
                />
              ) : (
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={current.subject}
                  className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
                />
              )}
              <datalist id="rcc-subjects">
                {subjectsCatalog.map((s) => <option key={s} value={s} />)}
              </datalist>
            </label>

            <label className="text-xs text-muted-foreground">
              New duration (minutes)
              <input
                type="number"
                min={15}
                max={180}
                step={5}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder={String(current.duration)}
                className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-muted-foreground">
              New frequency
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="mt-1 w-full rounded border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">— No change —</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>

            <label className="text-xs text-muted-foreground">
              Interval
              <input
                type="number"
                min={1}
                value={interval}
                onChange={(e) => setIntervalValue(e.target.value)}
                placeholder={String(current.interval)}
                className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div>
            <div className="text-xs text-muted-foreground">New days of week (for weekly/biweekly)</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {DAY_LABELS.map((label, idx) => {
                const active = daysOfWeek.includes(idx);
                return (
                  <button
                    type="button"
                    key={label}
                    onClick={() => toggleDay(idx)}
                    className={`rounded-full border px-3 py-1 text-xs ${active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block text-xs text-muted-foreground">
            New description
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={current.description || 'Leave blank to keep unchanged'}
              className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-xs text-muted-foreground">
            Reason for this request <span className="text-red-500">*</span>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
            />
          </label>

          {error && <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

          <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
            <button type="button" onClick={onClose} className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-foreground hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !hasChanges || !reason.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Send request
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RequestClassChangeModal;
