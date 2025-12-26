import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { formatDateDDMMMYYYY } from '../../utils/date';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import { useSearch } from '../../contexts/SearchContext';

const METRIC_FIELDS = [
  { key: 'firstClassRating', label: 'First class' },
  { key: 'teacherPerformanceRating', label: 'Teacher performance' },
  { key: 'teacherRating', label: 'Teacher rating' },
  { key: 'classRating', label: 'Class experience' },
  { key: 'attendanceOnTime', label: 'Attendance on time' },
  { key: 'connectionQuality', label: 'Connection quality' },
  { key: 'progressEvaluation', label: 'Progress evaluation' },
];

const TEXT_FIELDS = [
  { key: 'notes', label: 'Guardian notes' },
  { key: 'message', label: 'Message' },
  { key: 'followUpNotes', label: 'Follow-up notes' },
  { key: 'adminNotes', label: 'Admin notes' },
];

const TYPE_STYLES = {
  monthly: 'border-violet-100 bg-violet-50 text-violet-700',
  first_class: 'border-sky-100 bg-sky-50 text-sky-700',
};

const formatTypeLabel = (value = '') => {
  if (!value) return 'Feedback';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
};

const humanizeKey = (value = '') => {
  if (!value) return '';
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (m) => m.toUpperCase());
};

const collectMetrics = (feedback = {}) => {
  const metrics = [];
  const seen = new Set();

  const pushMetric = (label, value) => {
    if (value == null) return;
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    metrics.push({ label, value: numeric });
  };

  METRIC_FIELDS.forEach((field) => pushMetric(field.label, feedback[field.key]));

  if (feedback.metrics && typeof feedback.metrics === 'object') {
    Object.entries(feedback.metrics).forEach(([key, value]) => {
      pushMetric(humanizeKey(key), value);
    });
  }

  return metrics;
};

const collectNotes = (feedback = {}) =>
  TEXT_FIELDS
    .map((field) => {
      const raw = feedback[field.key];
      if (!raw || !String(raw).trim()) return null;
      return { label: field.label, text: String(raw).trim() };
    })
    .filter(Boolean);

const collectMetaChips = (feedback = {}) => {
  const chips = [];
  const className = feedback.class?.name || feedback.className;
  const studentName = feedback.student ? `${feedback.student.firstName || ''} ${feedback.student.lastName || ''}`.trim() : '';
  if (className) chips.push({ label: className });
  if (studentName) chips.push({ label: `Student ${studentName}` });
  if (feedback.scheduledDate) chips.push({ label: `Class on ${formatDateDDMMMYYYY(feedback.scheduledDate)}` });
  if (feedback.promptMonth) chips.push({ label: `Month ${feedback.promptMonth}` });
  return chips;
};

const getGuardianName = (feedback = {}) => {
  const first = feedback.user?.firstName || '';
  const last = feedback.user?.lastName || '';
  const name = `${first} ${last}`.trim();
  return name || 'Guardian';
};

const getGuardianInitials = (feedback = {}) => {
  const name = getGuardianName(feedback).split(' ');
  const letters = name.filter(Boolean).map((part) => part[0]);
  return letters.slice(0, 2).join('').toUpperCase() || 'G';
};

const getTeacherName = (feedback = {}) => {
  const first = feedback.teacher?.firstName || '';
  const last = feedback.teacher?.lastName || '';
  const name = `${first} ${last}`.trim();
  return name || '';
};

const StarRating = ({ value = 0 }) => {
  const normalized = Math.max(0, Math.min(5, Math.round((Number(value) || 0) / 2)));
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, idx) => (
        <svg
          key={idx}
          className={`h-4 w-4 ${idx < normalized ? 'text-amber-400' : 'text-slate-200'}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.97a1 1 0 00.95.69h4.18c.969 0 1.371 1.24.588 1.81l-3.384 2.455a1 1 0 00-.363 1.118l1.287 3.97c.3.921-.755 1.688-1.54 1.118L10 13.347l-3.384 2.455c-.784.57-1.84-.197-1.54-1.118l1.287-3.97a1 1 0 00-.363-1.118L2.615 9.397c-.783-.57-.38-1.81.588-1.81h4.18a1 1 0 00.95-.69l1.286-3.97z" />
        </svg>
      ))}
    </div>
  );
};

const MetricTile = ({ label, value }) => {
  const safeValue = Math.round((Number(value) || 0) * 10) / 10;
  const percentage = Math.max(0, Math.min(100, (Number(value) || 0) * 10));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold text-slate-900">{safeValue}</span>
        <span className="text-sm text-slate-400">/ 10</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percentage}%` }} />
        </div>
        <StarRating value={value} />
      </div>
    </div>
  );
};

const NoteBlock = ({ label, text }) => (
  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-2 whitespace-pre-wrap leading-relaxed">{text}</p>
  </div>
);

const SummaryCard = ({ label, value, helper }) => (
  <div className="min-w-[140px] rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-center shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    {helper && <p className="text-xs text-slate-500">{helper}</p>}
  </div>
);

const LoadingPlaceholder = () => (
  <div className="space-y-4">
    {Array.from({ length: 3 }).map((_, idx) => (
      <div key={idx} className="rounded-3xl border border-slate-200 bg-white/70 p-5 shadow-sm">
        <div className="h-4 w-48 animate-pulse rounded-full bg-slate-200" />
        <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-slate-100" />
        <div className="mt-2 h-3 w-3/4 animate-pulse rounded-full bg-slate-100" />
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </div>
    ))}
  </div>
);

const FeedbacksAdmin = () => {
  const { searchTerm } = useSearch();
  const [q, setQ] = useState('');
  const [feedbacks, setFeedbacks] = useState([]);
  const [activeTab, setActiveTab] = useState('unread');
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notifCount, setNotifCount] = useState(0);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/feedbacks', { params: { q, page, limit, archived: false } });
      if (res.data && res.data.success) {
        setFeedbacks(res.data.feedbacks || []);
        setTotal(res.data.total || 0);
      }
    } catch (err) {
      console.error('Fetch feedbacks admin error', err);
    } finally {
      setLoading(false);
    }
  }, [q, page, limit]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const { socket } = useAuth();

  useEffect(() => {
    if (!socket) return;
    const handleNewFeedback = () => {
      setNotifCount((c) => c + 1);
      fetchList();
    };

    socket.on('feedback:new', handleNewFeedback);
    return () => {
      socket.off('feedback:new', handleNewFeedback);
    };
  }, [socket, fetchList]);

  const markRead = async (id) => {
    try {
      await api.put(`/feedbacks/${id}/read`);
      fetchList();
      try {
        const c = await api.get('/feedbacks/count/unread');
        if (c.data?.success) setNotifCount(c.data.count || 0);
      } catch (e) {
        /* noop */
      }
    } catch (err) {
      console.error('Mark read error', err);
    }
  };

  const archive = async (id) => {
    if (!window.confirm('Archive this feedback?')) return;
    try {
      await api.delete(`/feedbacks/${id}`);
      fetchList();
      try {
        const c = await api.get('/feedbacks/count/unread');
        if (c.data?.success) setNotifCount(c.data.count || 0);
      } catch (e) {
        /* noop */
      }
    } catch (err) {
      console.error('Archive error', err);
    }
  };

  const filteredFeedbacks = useMemo(() => {
    let result = feedbacks || [];

    if (activeTab === 'unread') result = result.filter((f) => !(f.read ?? f.isRead));
    if (activeTab === 'read') result = result.filter((f) => f.read ?? f.isRead);

    if (searchTerm && searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter((feedback) => {
        const userName = feedback.user ? `${feedback.user.firstName} ${feedback.user.lastName}`.toLowerCase() : '';
        const className = feedback.class ? (feedback.class.name || '').toLowerCase() : '';
        const message = (feedback.notes || feedback.message || '').toLowerCase();
        const type = (feedback.type || '').toLowerCase();
        const date = (formatDateDDMMMYYYY(feedback.createdAt) || '').toLowerCase();

        return (
          userName.includes(term) ||
          className.includes(term) ||
          message.includes(term) ||
          type.includes(term) ||
          date.includes(term) ||
          String(feedback._id).includes(term)
        );
      });
    }

    return result;
  }, [feedbacks, searchTerm, activeTab]);

  const summary = useMemo(() => {
    const unread = feedbacks.filter((f) => !(f.read ?? f.isRead)).length;
    const read = feedbacks.length - unread;
    let teacherScoreTotal = 0;
    let teacherScoreCount = 0;
    feedbacks.forEach((f) => {
      const score = f.teacherPerformanceRating ?? f.teacherRating ?? null;
      if (score != null && !Number.isNaN(Number(score))) {
        teacherScoreTotal += Number(score);
        teacherScoreCount += 1;
      }
    });
    const avgTeacher = teacherScoreCount ? Math.round((teacherScoreTotal / teacherScoreCount) * 10) / 10 : null;
    return { unread, read, avgTeacher };
  }, [feedbacks]);

  const formatDateTime = (iso) => {
    if (!iso) return '--';
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (e) {
      return iso;
    }
  };

  const handleQueryChange = (event) => {
    setQ(event.target.value);
    setPage(1);
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setPage(1);
  };

  return (
    <div className="min-h-[calc(100vh-120px)] bg-gradient-to-br from-slate-50 via-white to-slate-100 pb-10 pt-4">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4">
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-start gap-6">
            <div className="flex min-w-[220px] flex-1 flex-col gap-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Feedback hub</p>
              <h1 className="text-3xl font-semibold text-slate-900">Guardian insights</h1>
              <p className="text-sm text-slate-500">
                Track every submission, acknowledge what was shared, and stay ahead on follow-ups.
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              <SummaryCard label="Unread" value={summary.unread} helper="Awaiting review" />
              <SummaryCard label="Read" value={summary.read} helper="Filed & acknowledged" />
              <SummaryCard
                label="Avg. teacher score"
                value={summary.avgTeacher != null ? `${summary.avgTeacher} / 10` : '--'}
                helper="Across submitted ratings"
              />
              <SummaryCard label="New alerts" value={notifCount} helper="Arrived live" />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
              {['unread', 'read'].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => handleTabChange(tab)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                    activeTab === tab ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {tab === 'unread' ? `Unread (${summary.unread})` : `Read (${summary.read})`}
                </button>
              ))}
            </div>

            <div className="relative min-w-[220px] flex-1">
              <input
                type="search"
                value={q}
                onChange={handleQueryChange}
                className="w-full rounded-2xl border border-slate-200 bg-white/80 px-4 py-2 text-sm shadow-inner placeholder:text-slate-400"
                placeholder="Search guardians, teachers, classes, or IDs"
              />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-slate-400">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="9" cy="9" r="5" />
                  <path d="M13.5 13.5L17 17" strokeLinecap="round" />
                </svg>
              </span>
            </div>

            <div className="text-xs font-medium text-slate-500">
              Showing {filteredFeedbacks.length} of {total || filteredFeedbacks.length} entries
            </div>
          </div>
        </section>

        <section>
          {loading ? (
            <LoadingPlaceholder />
          ) : filteredFeedbacks.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-10 text-center text-slate-500">
              <p className="text-base font-semibold text-slate-600">No feedback matches your filters</p>
              <p className="mt-1 text-sm">Try switching tabs, clearing the search, or wait for new submissions.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredFeedbacks.map((f) => {
                const isRead = !!(f.read ?? f.isRead);
                const teacherName = getTeacherName(f);
                const metrics = collectMetrics(f);
                const notes = collectNotes(f);
                const chips = collectMetaChips(f);

                return (
                  <article
                    key={f._id}
                    className="rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-[0_25px_60px_-35px_rgba(15,23,42,0.45)] transition hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <div className="flex flex-wrap items-start gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-lg font-semibold text-slate-600">
                        {getGuardianInitials(f)}
                      </div>
                      <div className="min-w-[220px] flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                          <span className="text-base font-semibold text-slate-900">{getGuardianName(f)}</span>
                          {teacherName && (
                            <>
                              <span className="text-slate-300" aria-hidden="true">|</span>
                              <span>Teacher {teacherName}</span>
                            </>
                          )}
                          {f.class?.name && (
                            <>
                              <span className="text-slate-300" aria-hidden="true">|</span>
                              <span>{f.class.name}</span>
                            </>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">{formatDateTime(f.createdAt)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                            isRead
                              ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                              : 'border-amber-100 bg-amber-50 text-amber-700'
                          }`}
                        >
                          {isRead ? 'Read' : 'Unread'}
                        </span>
                        {f.type && (
                          <span
                            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                              TYPE_STYLES[f.type] || 'border-slate-200 bg-slate-50 text-slate-700'
                            }`}
                          >
                            {formatTypeLabel(f.type)}
                          </span>
                        )}
                      </div>
                    </div>

                    {chips.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {chips.map((chip) => (
                          <span
                            key={`${chip.label}`}
                            className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-0.5 text-xs font-medium text-slate-600"
                          >
                            {chip.label}
                          </span>
                        ))}
                      </div>
                    )}

                    {notes.length > 0 && (
                      <div className="mt-4 grid gap-3">
                        {notes.map((block) => (
                          <NoteBlock key={`${f._id}-${block.label}`} label={block.label} text={block.text} />
                        ))}
                      </div>
                    )}

                    {metrics.length > 0 && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {metrics.map((metric) => (
                          <MetricTile key={`${f._id}-${metric.label}`} label={metric.label} value={metric.value} />
                        ))}
                      </div>
                    )}

                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
                      <span className="text-xs text-slate-400">Ref #{String(f._id).slice(-6)}</span>
                      <div className="flex flex-wrap gap-2">
                        {!isRead && (
                          <button
                            onClick={() => markRead(f._id)}
                            className="rounded-full border border-emerald-200 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-500/20"
                          >
                            Mark as read
                          </button>
                        )}
                        <button
                          onClick={() => archive(f._id)}
                          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Archive
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <span>Total records: {total}</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={`rounded-full border px-4 py-2 font-medium transition ${
                page <= 1 ? 'cursor-not-allowed border-slate-200 text-slate-300' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Previous
            </button>
            <button
              disabled={page * limit >= total}
              onClick={() => setPage((p) => p + 1)}
              className={`rounded-full border px-4 py-2 font-medium transition ${
                page * limit >= total
                  ? 'cursor-not-allowed border-slate-200 text-slate-300'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeedbacksAdmin;
