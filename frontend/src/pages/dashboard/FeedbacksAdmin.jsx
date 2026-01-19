import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { formatDateDDMMMYYYY } from '../../utils/date';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import { useSearch } from '../../contexts/SearchContext';
import { Archive, Check, ChevronLeft, ChevronRight, MessageSquare, Search as SearchIcon } from 'lucide-react';
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';

const STATUS_TABS = [
  { key: 'unread', label: 'Unread' },
  { key: 'read', label: 'Read' },
];

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
  monthly: 'border-border bg-muted/30 text-foreground',
  first_class: 'border-border bg-muted/30 text-foreground',
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
          className={`h-4 w-4 ${idx < normalized ? 'text-primary' : 'text-muted-foreground/30'}`}
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
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold text-foreground">{safeValue}</span>
        <span className="text-sm text-muted-foreground">/ 10</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${percentage}%` }} />
        </div>
        <StarRating value={value} />
      </div>
    </div>
  );
};

const NoteBlock = ({ label, text }) => (
  <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-foreground">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="mt-2 whitespace-pre-wrap leading-relaxed">{text}</p>
  </div>
);

const SummaryCard = ({ label, value, helper }) => (
  <div className="min-w-[140px] rounded-lg border border-border bg-muted/30 px-4 py-3 text-center shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
  </div>
);

const LoadingPlaceholder = () => (
  <div className="space-y-4">
    {Array.from({ length: 3 }).map((_, idx) => (
      <div key={idx} className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="h-4 w-48 animate-pulse rounded-full bg-muted" />
        <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-muted/60" />
        <div className="mt-2 h-3 w-3/4 animate-pulse rounded-full bg-muted/60" />
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="h-20 animate-pulse rounded-lg bg-muted/60" />
          <div className="h-20 animate-pulse rounded-lg bg-muted/60" />
        </div>
      </div>
    ))}
  </div>
);

const FeedbacksAdmin = () => {
  const { searchTerm } = useSearch();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [feedbacks, setFeedbacks] = useState([]);
  const [activeTab, setActiveTab] = useState('unread');
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const feedbacksRef = useRef([]);
  const fetchListInFlightRef = useRef(false);
  const fetchListKeyRef = useRef('');
  const fetchListAbortRef = useRef(null);
  const fetchListRequestIdRef = useRef(0);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedQ(q);
    }, 300);
    return () => clearTimeout(handle);
  }, [q]);

  useEffect(() => {
    feedbacksRef.current = feedbacks || [];
  }, [feedbacks]);

  const fetchList = useCallback(async () => {
    try {
      const requestSignature = JSON.stringify({ q: debouncedQ, page, limit, archived: false });
      if (fetchListInFlightRef.current && fetchListKeyRef.current === requestSignature) {
        return;
      }

      fetchListKeyRef.current = requestSignature;
      fetchListInFlightRef.current = true;

      const requestId = fetchListRequestIdRef.current + 1;
      fetchListRequestIdRef.current = requestId;

      if (fetchListAbortRef.current) {
        try {
          fetchListAbortRef.current.abort();
        } catch (e) {
          // ignore abort errors
        }
      }

      const controller = new AbortController();
      fetchListAbortRef.current = controller;

      const cacheKey = makeCacheKey('feedbacks:list', 'admin', { q: debouncedQ, page, limit, archived: false });
      const cached = readCache(cacheKey, { deps: ['feedbacks'] });
      if (cached.hit && cached.value) {
        setFeedbacks(cached.value.feedbacks || []);
        setTotal(cached.value.total || 0);
        if (cached.ageMs < 60_000) {
          fetchListInFlightRef.current = false;
          return;
        }
      }

      const hasExisting = (feedbacksRef.current || []).length > 0;
      setLoading(!hasExisting);
      const res = await api.get('/feedbacks', { params: { q: debouncedQ, page, limit, archived: false }, signal: controller.signal });
      if (requestId !== fetchListRequestIdRef.current) {
        return;
      }
      if (res.data && res.data.success) {
        setFeedbacks(res.data.feedbacks || []);
        setTotal(res.data.total || 0);
        writeCache(
          cacheKey,
          { feedbacks: res.data.feedbacks || [], total: res.data.total || 0 },
          { ttlMs: 5 * 60_000, deps: ['feedbacks'] }
        );
      }
    } catch (err) {
      const isCanceled = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
      if (!isCanceled) {
        console.error('Fetch feedbacks admin error', err);
      }
    } finally {
      setLoading(false);
      fetchListInFlightRef.current = false;
    }
  }, [debouncedQ, page, limit]);

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

  const totalPages = useMemo(() => {
    const safeTotal = Number(total) || 0;
    const safeLimit = Number(limit) || 1;
    return Math.max(1, Math.ceil(safeTotal / safeLimit));
  }, [total, limit]);

  return (
    <div className="p-6 bg-background min-h-screen">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <section className="bg-card rounded-lg shadow-sm border border-border p-5">
          <div className="flex flex-wrap items-start gap-6">
            <div className="flex min-w-[220px] flex-1 flex-col gap-2">
              <h1 className="text-xl font-semibold text-foreground">Feedbacks</h1>
              <p className="text-sm text-muted-foreground">Guardian feedback and ratings overview.</p>
              
            </div>
            <div className="flex flex-wrap gap-4">
              <SummaryCard label="Unread" value={summary.unread}  />
              <SummaryCard label="Read" value={summary.read}  />
              <SummaryCard
                label="Avg. teacher score"
                value={summary.avgTeacher != null ? `${summary.avgTeacher} / 10` : '--'}
                
              />
              <SummaryCard label="New alerts" value={notifCount} />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              {STATUS_TABS.map((tab) => {
                const isSelected = activeTab === tab.key;
                const count = tab.key === 'unread' ? summary.unread : summary.read;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => handleTabChange(tab.key)}
                    className={`px-4 py-2 rounded-full border text-sm font-medium transition-colors ${
                      isSelected
                        ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                        : 'bg-transparent border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="relative min-w-[220px] flex-1">
              <input
                type="search"
                value={q}
                onChange={handleQueryChange}
                className="w-full rounded-md border border-border bg-input px-9 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                placeholder="Search guardians, teachers, classes, or IDs"
              />
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                <SearchIcon className="h-4 w-4" />
              </span>
            </div>

            <div className="text-xs font-medium text-muted-foreground">
              Showing {filteredFeedbacks.length} of {total || filteredFeedbacks.length}
            </div>
          </div>
        </section>

        <section>
          {loading ? (
            <LoadingPlaceholder />
          ) : filteredFeedbacks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-muted-foreground">
              <MessageSquare className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-base font-semibold text-foreground">No feedback matches your filters</p>
              <p className="mt-1 text-sm">Switch tabs, clear search, or wait for submissions.</p>
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
                    className="bg-card rounded-lg shadow-sm border border-border p-4"
                  >
                    <div className="flex flex-wrap items-start gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted/30 text-lg font-semibold text-foreground">
                        {getGuardianInitials(f)}
                      </div>
                      <div className="min-w-[220px] flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                          <span className="text-base font-semibold text-foreground">{getGuardianName(f)}</span>
                          {teacherName && (
                            <>
                              <span className="text-muted-foreground/40" aria-hidden="true">|</span>
                              <span>Teacher {teacherName}</span>
                            </>
                          )}
                          {f.class?.name && (
                            <>
                              <span className="text-muted-foreground/40" aria-hidden="true">|</span>
                              <span>{f.class.name}</span>
                            </>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{formatDateTime(f.createdAt)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                            isRead
                              ? 'border-border bg-muted/30 text-muted-foreground'
                              : 'border-primary/20 bg-primary/10 text-primary'
                          }`}
                        >
                          {isRead ? 'Read' : 'Unread'}
                        </span>
                        {f.type && (
                          <span
                            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                              TYPE_STYLES[f.type] || 'border-border bg-muted/30 text-foreground'
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
                            className="inline-flex items-center rounded-full border border-border bg-muted/30 px-3 py-0.5 text-xs font-medium text-muted-foreground"
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
                      <span className="text-xs text-muted-foreground">Ref #{String(f._id).slice(-6)}</span>
                      <div className="flex flex-wrap gap-2">
                        {!isRead && (
                          <button
                            onClick={() => markRead(f._id)}
                            className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-border bg-input text-foreground hover:bg-muted transition-colors"
                            title="Mark as read"
                            aria-label="Mark as read"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => archive(f._id)}
                          className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-border bg-input text-foreground hover:bg-muted transition-colors"
                          title="Archive"
                          aria-label="Archive"
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {totalPages > 1 && (
          <div className="flex justify-center items-center space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="h-9 w-9 inline-flex items-center justify-center border border-border rounded-md bg-input text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted transition-colors"
              aria-label="Previous page"
              title="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 py-2 text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="h-9 w-9 inline-flex items-center justify-center border border-border rounded-md bg-input text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted transition-colors"
              aria-label="Next page"
              title="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FeedbacksAdmin;
