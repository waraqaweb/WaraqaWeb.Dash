import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Clock3, FileText, RefreshCw, Trash2, Users, Pencil, XCircle, UserCheck, UserX, Ban } from 'lucide-react';
import { listMeetings, rescheduleMeeting, deleteMeeting, hardDeleteMeeting, updateMeetingAttendance } from '../../../api/meetings';
import { MEETING_TYPE_LABELS, MEETING_TYPE_TONES } from '../../../constants/meetingConstants';
import { makeCacheKey, readCache, writeCache } from '../../../utils/sessionCache';
import MeetingReportModal from '../../dashboard/MeetingReportModal';

const PAGE_SIZE = 6;

const toneByStatus = {
  scheduled: 'bg-sky-50 text-sky-700 border-sky-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
  no_show: 'bg-amber-50 text-amber-700 border-amber-200',
};

const attendanceLabels = {
  attended: 'Attended',
  no_show: 'No-show',
  cancelled_no_penalty: 'Cancelled (no penalty)',
};

const formatWhen = (value, timezone) => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone || 'UTC',
    }).format(new Date(value));
  } catch {
    return String(value || '');
  }
};

const toLocalDatetimeInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function MeetingActivityPanel({ timezone }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [rescheduleId, setRescheduleId] = useState('');
  const [rescheduleStart, setRescheduleStart] = useState('');
  const [rescheduleSaving, setRescheduleSaving] = useState(false);
  const [rescheduleError, setRescheduleError] = useState('');
  const [reportMeeting, setReportMeeting] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [scheduledPage, setScheduledPage] = useState(1);
  const [reportedPage, setReportedPage] = useState(1);

  const load = async () => {
    try {
      const now = new Date();
      const past = new Date(now);
      past.setMonth(past.getMonth() - 2);
      const future = new Date(now);
      future.setMonth(future.getMonth() + 2);
      const cacheKey = makeCacheKey('meetings:activity', 'admin', {
        start: past.toISOString().slice(0, 10),
        end: future.toISOString().slice(0, 10),
      });
      const cached = readCache(cacheKey, { deps: ['meetings'] });
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
      const data = await listMeetings({ rangeStart: past.toISOString(), rangeEnd: future.toISOString(), limit: 200 });
      const nextItems = data || [];
      setItems(nextItems);
      writeCache(cacheKey, { items: nextItems }, { ttlMs: 5 * 60_000, deps: ['meetings'] });
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const { scheduled, reported } = useMemo(() => {
    const scheduledList = [];
    const reportedList = [];
    (items || []).forEach((item) => {
      if (item?.report?.submittedAt) reportedList.push(item);
      else scheduledList.push(item);
    });
    return {
      scheduled: scheduledList.sort((a, b) => new Date(b.scheduledStart) - new Date(a.scheduledStart)),
      reported: reportedList.sort((a, b) => new Date(b.report?.submittedAt || b.updatedAt) - new Date(a.report?.submittedAt || a.updatedAt)),
    };
  }, [items]);

  const openReschedule = (meeting) => {
    setRescheduleId(meeting._id);
    setRescheduleStart(toLocalDatetimeInput(meeting.scheduledStart));
    setRescheduleError('');
  };

  const closeReschedule = () => {
    setRescheduleId('');
    setRescheduleStart('');
    setRescheduleError('');
    setRescheduleSaving(false);
  };

  const saveReschedule = async (meetingId) => {
    if (!rescheduleStart) {
      setRescheduleError('Pick a new date and time');
      return;
    }
    setRescheduleSaving(true);
    setRescheduleError('');
    try {
      const iso = new Date(rescheduleStart).toISOString();
      const updated = await rescheduleMeeting(meetingId, { startTime: iso });
      setItems((prev) => prev.map((m) => (m._id === meetingId ? { ...m, ...updated } : m)));
      closeReschedule();
    } catch (err) {
      setRescheduleError(err?.response?.data?.message || 'Failed to reschedule');
      setRescheduleSaving(false);
    }
  };

  const cancelOne = async (meetingId) => {
    if (!window.confirm('Cancel this meeting? It stays in history but is marked cancelled.')) return;
    setBusyId(meetingId);
    try {
      const updated = await deleteMeeting(meetingId);
      setItems((prev) => prev.map((m) => (m._id === meetingId ? { ...m, ...updated } : m)));
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to cancel meeting');
    } finally {
      setBusyId('');
    }
  };

  const deleteOne = async (meetingId) => {
    if (!window.confirm('Permanently delete this meeting? This cannot be undone.')) return;
    setBusyId(meetingId);
    try {
      await hardDeleteMeeting(meetingId);
      setItems((prev) => prev.filter((m) => m._id !== meetingId));
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to delete meeting');
    } finally {
      setBusyId('');
    }
  };

  const markAttendance = async (meetingId, attendanceStatus) => {
    setBusyId(meetingId);
    try {
      const updated = await updateMeetingAttendance(meetingId, attendanceStatus);
      setItems((prev) => prev.map((m) => (m._id === meetingId ? { ...m, ...updated } : m)));
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to update attendance');
    } finally {
      setBusyId('');
    }
  };

  const handleReportSaved = (updated) => {
    if (!updated?._id) return;
    setItems((prev) => prev.map((m) => (m._id === updated._id ? { ...m, ...updated } : m)));
  };

  const renderCard = (meeting, mode = 'scheduled') => {
    const isOpen = expandedId === meeting._id;
    const isRescheduling = rescheduleId === meeting._id;
    const studentNames = (meeting?.bookingPayload?.students || []).map((student) => student.studentName).filter(Boolean);
    const contactName = meeting?.attendees?.teacherName || meeting?.bookingPayload?.guardianName;
    const contactEmail = meeting?.bookingPayload?.guardianEmail;
    return (
      <div key={meeting._id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button type="button" onClick={() => setExpandedId(isOpen ? '' : meeting._id)} className="flex w-full items-start justify-between gap-3 text-left">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneByStatus[meeting.status] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                {meeting.status || 'scheduled'}
              </span>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${MEETING_TYPE_TONES[meeting.meetingType] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                {MEETING_TYPE_LABELS[meeting.meetingType] || 'Meeting'}
              </span>
              {meeting?.attendanceStatus ? (
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                  {attendanceLabels[meeting.attendanceStatus] || meeting.attendanceStatus}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              {mode === 'reported' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <CalendarClock className="h-4 w-4 text-sky-600" />}
              <span>{formatWhen(meeting.scheduledStart, timezone || meeting.timezone)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              {studentNames.length ? <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{studentNames.join(', ')}</span> : null}
              {contactName ? <span>{contactName}</span> : null}
              {meeting?.report?.submittedAt ? <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" />{formatWhen(meeting.report.submittedAt, timezone || meeting.timezone)}</span> : null}
            </div>
          </div>
          {isOpen ? <ChevronUp className="mt-1 h-4 w-4 text-slate-400" /> : <ChevronDown className="mt-1 h-4 w-4 text-slate-400" />}
        </button>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {!isRescheduling ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openReschedule(meeting); }}
              className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
            >
              <Pencil className="h-3.5 w-3.5" /> Reschedule
            </button>
          ) : null}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setReportMeeting(meeting); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-100"
          >
            <FileText className="h-3.5 w-3.5" /> {meeting?.report?.submittedAt ? 'Edit report' : 'Add report'}
          </button>
          <button
            type="button"
            disabled={busyId === meeting._id}
            onClick={(e) => { e.stopPropagation(); markAttendance(meeting._id, 'attended'); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
          >
            <UserCheck className="h-3.5 w-3.5" /> Attended
          </button>
          <button
            type="button"
            disabled={busyId === meeting._id}
            onClick={(e) => { e.stopPropagation(); markAttendance(meeting._id, 'no_show'); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60"
          >
            <UserX className="h-3.5 w-3.5" /> No-show
          </button>
          <button
            type="button"
            disabled={busyId === meeting._id}
            onClick={(e) => { e.stopPropagation(); markAttendance(meeting._id, 'cancelled_no_penalty'); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            <Ban className="h-3.5 w-3.5" /> No penalty
          </button>
          {meeting.status !== 'cancelled' ? (
            <button
              type="button"
              disabled={busyId === meeting._id}
              onClick={(e) => { e.stopPropagation(); cancelOne(meeting._id); }}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60"
            >
              <XCircle className="h-3.5 w-3.5" /> Cancel
            </button>
          ) : null}
          <button
            type="button"
            disabled={busyId === meeting._id}
            onClick={(e) => { e.stopPropagation(); deleteOne(meeting._id); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
        {isRescheduling ? (
          <div className="mt-3 space-y-2 rounded-xl border border-sky-200 bg-sky-50/50 p-3">
            <label className="block text-xs font-semibold text-slate-700">New date &amp; time (your local time)</label>
            <input
              type="datetime-local"
              value={rescheduleStart}
              onChange={(e) => setRescheduleStart(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
            />
            {rescheduleError ? <div className="text-xs text-red-600">{rescheduleError}</div> : null}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={rescheduleSaving}
                onClick={() => saveReschedule(meeting._id)}
                className="inline-flex items-center gap-1 rounded-full bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
              >
                {rescheduleSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                disabled={rescheduleSaving}
                onClick={closeReschedule}
                className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <span className="text-[11px] text-slate-500">Duration is preserved. Guardian &amp; teacher get an email automatically.</span>
            </div>
          </div>
        ) : null}
        {isOpen ? (
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
            {contactEmail ? <p><span className="font-semibold text-slate-800">Email:</span> {contactEmail}</p> : null}
            {meeting?.bookingPayload?.guardianPhone ? <p><span className="font-semibold text-slate-800">Phone:</span> {meeting.bookingPayload.guardianPhone}</p> : null}
            {meeting?.bookingPayload?.notes ? <p><span className="font-semibold text-slate-800">Notes:</span> {meeting.bookingPayload.notes}</p> : null}
            {meeting?.report?.notes ? <p><span className="font-semibold text-slate-800">Report:</span> {meeting.report.notes}</p> : null}
            {Array.isArray(meeting?.rescheduleHistory) && meeting.rescheduleHistory.length ? (
              <div>
                <p className="font-semibold text-slate-800">Reschedule history</p>
                <ul className="mt-1 space-y-1 text-xs text-slate-500">
                  {meeting.rescheduleHistory.slice(-5).map((h, i) => (
                    <li key={i}>{formatWhen(h.previousStart, timezone || meeting.timezone)} → {formatWhen(h.newStart, timezone || meeting.timezone)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const scheduledTotalPages = Math.max(1, Math.ceil(scheduled.length / PAGE_SIZE));
  const reportedTotalPages = Math.max(1, Math.ceil(reported.length / PAGE_SIZE));
  const scheduledSlice = useMemo(
    () => scheduled.slice((scheduledPage - 1) * PAGE_SIZE, scheduledPage * PAGE_SIZE),
    [scheduled, scheduledPage]
  );
  const reportedSlice = useMemo(
    () => reported.slice((reportedPage - 1) * PAGE_SIZE, reportedPage * PAGE_SIZE),
    [reported, reportedPage]
  );

  const Pager = ({ page, total, onChange }) => {
    if (total <= 1) return null;
    return (
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <button type="button" disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 disabled:opacity-40">
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </button>
        <span>Page {page} of {total}</span>
        <button type="button" disabled={page >= total} onClick={() => onChange(Math.min(total, page + 1))} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 disabled:opacity-40">
          Next <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading meetings…</div> : null}

      {!loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Clock3 className="h-4 w-4 text-sky-600" />Scheduled <span className="text-xs font-normal text-slate-500">({scheduled.length})</span></div>
            {scheduledSlice.length ? scheduledSlice.map((meeting) => renderCard(meeting, 'scheduled')) : <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No scheduled meetings.</div>}
            <Pager page={scheduledPage} total={scheduledTotalPages} onChange={setScheduledPage} />
          </section>
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Responses <span className="text-xs font-normal text-slate-500">({reported.length})</span></div>
            {reportedSlice.length ? reportedSlice.map((meeting) => renderCard(meeting, 'reported')) : <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No submitted responses.</div>}
            <Pager page={reportedPage} total={reportedTotalPages} onChange={setReportedPage} />
          </section>
        </div>
      ) : null}
      <MeetingReportModal
        isOpen={Boolean(reportMeeting)}
        meeting={reportMeeting}
        onClose={() => setReportMeeting(null)}
        onSaved={handleReportSaved}
      />
    </div>
  );
}
