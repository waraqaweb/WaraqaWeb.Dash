import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, ChevronDown, ChevronUp, Clock3, FileText, RefreshCw, Users } from 'lucide-react';
import { listMeetings } from '../../../api/meetings';
import { MEETING_TYPE_LABELS } from '../../../constants/meetingConstants';
import { makeCacheKey, readCache, writeCache } from '../../../utils/sessionCache';

const toneByStatus = {
  scheduled: 'bg-sky-50 text-sky-700 border-sky-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
  no_show: 'bg-amber-50 text-amber-700 border-amber-200',
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

export default function MeetingActivityPanel({ timezone }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState('');

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
      scheduled: scheduledList.sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart)),
      reported: reportedList.sort((a, b) => new Date(b.report?.submittedAt || b.updatedAt) - new Date(a.report?.submittedAt || a.updatedAt)),
    };
  }, [items]);

  const renderCard = (meeting, mode = 'scheduled') => {
    const isOpen = expandedId === meeting._id;
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
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                {MEETING_TYPE_LABELS[meeting.meetingType] || 'Meeting'}
              </span>
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
        {isOpen ? (
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
            {contactEmail ? <p><span className="font-semibold text-slate-800">Email:</span> {contactEmail}</p> : null}
            {meeting?.bookingPayload?.guardianPhone ? <p><span className="font-semibold text-slate-800">Phone:</span> {meeting.bookingPayload.guardianPhone}</p> : null}
            {meeting?.bookingPayload?.notes ? <p><span className="font-semibold text-slate-800">Notes:</span> {meeting.bookingPayload.notes}</p> : null}
            {meeting?.report?.notes ? <p><span className="font-semibold text-slate-800">Report:</span> {meeting.report.notes}</p> : null}
          </div>
        ) : null}
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
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Clock3 className="h-4 w-4 text-sky-600" />Scheduled</div>
            {scheduled.length ? scheduled.map((meeting) => renderCard(meeting, 'scheduled')) : <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No scheduled meetings.</div>}
          </section>
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Responses</div>
            {reported.length ? reported.map((meeting) => renderCard(meeting, 'reported')) : <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No submitted responses.</div>}
          </section>
        </div>
      ) : null}
    </div>
  );
}
