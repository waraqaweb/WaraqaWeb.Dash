import React, { useCallback, useEffect, useState } from 'react';
import moment from 'moment-timezone';
import { CheckCircle2, XCircle, Loader2, RefreshCw, Inbox } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';

const STATUS_COLORS = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-gray-50 text-gray-700 border-gray-200',
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatRecurrence = (r) => {
  if (!r) return '—';
  const parts = [];
  if (r.frequency) parts.push(r.frequency);
  if (r.interval && r.interval !== 1) parts.push(`every ${r.interval}`);
  if (Array.isArray(r.daysOfWeek) && r.daysOfWeek.length) {
    parts.push(r.daysOfWeek.map((d) => DAY_LABELS[d]).join(','));
  }
  return parts.join(' · ') || '—';
};

const renderDiff = (current = {}, changes = {}) => {
  const rows = [];
  const fields = ['subject', 'description', 'duration'];
  fields.forEach((k) => {
    if (changes[k] !== undefined) {
      rows.push({ label: k, from: current[k] ?? '—', to: changes[k] });
    }
  });
  if (changes.recurrence) {
    rows.push({ label: 'recurrence', from: formatRecurrence(current.recurrence), to: formatRecurrence(changes.recurrence) });
  }
  return rows;
};

const ClassChangeRequestsPage = ({ isActive }) => {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [actingId, setActingId] = useState(null);
  const [notes, setNotes] = useState({});

  const isAdmin = user?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/class-change-requests', { params: { status: statusFilter, limit: 100 } });
      setRows(Array.isArray(res?.data?.requests) ? res.data.requests : []);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { if (isActive) load(); }, [isActive, load]);

  const handleApprove = async (id) => {
    if (!isAdmin) return;
    if (!window.confirm('Approve this change? Future classes in the series will be updated.')) return;
    setActingId(id);
    try {
      await api.post(`/class-change-requests/${id}/approve`, { reviewerNotes: notes[id] || '' });
      await load();
    } catch (err) {
      window.alert(err?.response?.data?.message || 'Failed to approve');
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (id) => {
    if (!isAdmin) return;
    const reason = window.prompt('Reason for rejecting? (optional)') || '';
    setActingId(id);
    try {
      await api.post(`/class-change-requests/${id}/reject`, { reviewerNotes: reason });
      await load();
    } catch (err) {
      window.alert(err?.response?.data?.message || 'Failed to reject');
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-lg font-semibold text-foreground">Class change requests</div>
          <div className="text-xs text-muted-foreground">
            {isAdmin ? 'Review pending teacher requests to permanently change class details.' : 'Your pending and past requests for class changes.'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border border-gray-200 bg-white px-3 py-1.5 text-sm"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
            <option value="">All</option>
          </select>
          <button onClick={load} className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-3 py-1.5 text-sm">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 mb-3">{error}</div>}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Inbox className="h-8 w-8 mb-2" />
          <div className="text-sm">No requests found.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const diffs = renderDiff(r?.currentSnapshot, r?.requestedChanges);
            const cls = r?.class;
            return (
              <div key={r._id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      {cls?.title || r?.currentSnapshot?.subject || 'Class change'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Teacher: <strong>{r?.teacher?.name || r?.teacher?.username || '—'}</strong> · submitted {moment(r.submittedAt).format('MMM D, YYYY HH:mm')}
                    </div>
                  </div>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[r.status] || ''}`}>
                    {r.status}
                  </span>
                </div>

                {r.reason && (
                  <div className="mt-3 rounded bg-gray-50 px-3 py-2 text-xs text-gray-700">
                    <strong>Reason:</strong> {r.reason}
                  </div>
                )}

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 pr-3">Field</th>
                        <th className="py-1 pr-3">Current</th>
                        <th className="py-1">Requested</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diffs.map((d) => (
                        <tr key={d.label} className="border-t border-gray-100">
                          <td className="py-1 pr-3 font-medium text-foreground">{d.label}</td>
                          <td className="py-1 pr-3 text-muted-foreground">{typeof d.from === 'object' ? JSON.stringify(d.from) : String(d.from)}</td>
                          <td className="py-1 text-foreground">{typeof d.to === 'object' ? JSON.stringify(d.to) : String(d.to)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {r.reviewerNotes && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    <strong>Reviewer notes:</strong> {r.reviewerNotes}
                  </div>
                )}

                {isAdmin && r.status === 'pending' && (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      placeholder="Reviewer notes (optional)"
                      value={notes[r._id] || ''}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [r._id]: e.target.value }))}
                      className="flex-1 min-w-[200px] rounded border border-gray-200 px-3 py-1.5 text-xs"
                    />
                    <button
                      onClick={() => handleApprove(r._id)}
                      disabled={actingId === r._id}
                      className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => handleReject(r._id)}
                      disabled={actingId === r._id}
                      className="inline-flex items-center gap-1 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ClassChangeRequestsPage;
