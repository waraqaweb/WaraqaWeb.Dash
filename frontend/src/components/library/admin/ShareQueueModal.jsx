import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ShieldCheck, X } from 'lucide-react';
import {
  decideLibraryShareRequest,
  listLibraryShareRequests,
  revokeLibraryShare
} from '../../../api/library';

const FILTERS = ['pending', 'approved', 'denied', 'revoked', 'all'];

const statusBadgeClasses = (status) => {
  switch (status) {
    case 'approved':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'denied':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'revoked':
      return 'bg-rose-100 text-rose-700 border-rose-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
};

const ShareQueueModal = ({ open, onClose, onUpdated }) => {
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [processingId, setProcessingId] = useState(null);
  const [decisionDrafts, setDecisionDrafts] = useState({});

  const fetchRequests = useCallback(async () => {
    try {
      setIsLoading(true);
      const params = filter === 'all' ? {} : { status: filter };
      const { permissions } = await listLibraryShareRequests(params);
      setRequests(permissions || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load share requests.');
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (open) {
      fetchRequests();
    }
  }, [open, fetchRequests]);

  useEffect(() => {
    const nextDrafts = {};
    requests.forEach((permission) => {
      nextDrafts[permission._id] = {
        downloadAllowed: Boolean(permission.downloadAllowed),
        expiresAt: permission.expiresAt ? permission.expiresAt.slice(0, 10) : ''
      };
    });
    setDecisionDrafts(nextDrafts);
  }, [requests]);

  const updateDraft = (permissionId, field, value) => {
    setDecisionDrafts((prev) => ({
      ...prev,
      [permissionId]: {
        ...(prev[permissionId] || {}),
        [field]: value
      }
    }));
  };

  const handleDecision = async (permissionId, status) => {
    setProcessingId(permissionId);
    setError(null);
    const draft = decisionDrafts[permissionId] || {};
    try {
      await decideLibraryShareRequest(permissionId, {
        status,
        downloadAllowed: status === 'approved' ? !!draft.downloadAllowed : undefined,
        expiresAt: status === 'approved' && draft.expiresAt ? draft.expiresAt : undefined
      });
      await fetchRequests();
      onUpdated?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to update request.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleRevoke = async (permissionId) => {
    setProcessingId(permissionId);
    setError(null);
    try {
      await revokeLibraryShare(permissionId);
      await fetchRequests();
      onUpdated?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to revoke access.');
    } finally {
      setProcessingId(null);
    }
  };

  const visibleRequests = useMemo(() => requests || [], [requests]);
  const pendingCount = useMemo(
    () => (requests || []).filter((permission) => permission.status === 'pending').length,
    [requests]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-5xl rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Manage access
              </p>
              <h2 className="text-lg font-semibold text-foreground">Share requests</h2>
              {pendingCount > 0 && (
                <p className="text-xs text-emerald-600">
                  {pendingCount} pending request{pendingCount > 1 ? 's' : ''} awaiting review
                </p>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              className={`rounded-full px-3 py-1 text-xs font-semibold text-foreground ${
                filter === status ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>
        )}

        <div className="max-h-[60vh] overflow-auto rounded-2xl border border-border bg-background/80">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Requester</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Downloads</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">
                    Loading requests…
                  </td>
                </tr>
              ) : visibleRequests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">
                    No requests in this bucket.
                  </td>
                </tr>
              ) : (
                visibleRequests.map((request) => {
                  const permissionId = request._id;
                  const draft = decisionDrafts[permissionId] || {};
                  const downloadAllowed =
                    typeof draft.downloadAllowed === 'boolean'
                      ? draft.downloadAllowed
                      : Boolean(request.downloadAllowed);
                  const expiresValue =
                    typeof draft.expiresAt === 'string'
                      ? draft.expiresAt
                      : request.expiresAt
                        ? request.expiresAt.slice(0, 10)
                        : '';
                  return (
                    <tr key={permissionId} className="border-t border-border/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-foreground">{request.grantedToName || request.grantedToEmail}</p>
                        <p className="text-xs text-muted-foreground">{request.grantedToEmail}</p>
                        {request.reason && (
                          <p className="mt-1 text-xs text-muted-foreground">{request.reason}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {request.scopeType}
                        {request.includeDescendants && <span className="ml-1 text-xs">(+children)</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusBadgeClasses(request.status)}`}>
                          {request.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            disabled={request.status !== 'pending' && request.status !== 'approved'}
                            checked={downloadAllowed}
                            onChange={(event) => updateDraft(permissionId, 'downloadAllowed', event.target.checked)}
                            className="rounded border-border"
                          />
                          Allow downloads
                        </label>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {request.status === 'approved' || request.status === 'pending' ? (
                          <input
                            type="date"
                            value={expiresValue}
                            onChange={(event) => updateDraft(permissionId, 'expiresAt', event.target.value)}
                            className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
                          />
                        ) : request.expiresAt ? (
                          format(new Date(request.expiresAt), 'dd MMM yyyy')
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2 text-xs">
                          {request.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleDecision(permissionId, 'approved')}
                                className="rounded-lg bg-emerald-600 px-3 py-1 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                                disabled={processingId === permissionId}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDecision(permissionId, 'denied')}
                                className="rounded-lg border border-border px-3 py-1 font-semibold text-muted-foreground hover:bg-muted disabled:opacity-60"
                                disabled={processingId === permissionId}
                              >
                                Deny
                              </button>
                            </>
                          )}
                          {request.status === 'approved' && (
                            <button
                              type="button"
                              onClick={() => handleRevoke(permissionId)}
                              className="rounded-lg border border-red-200 px-3 py-1 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                              disabled={processingId === permissionId}
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ShareQueueModal;
