import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import useBulkSelect from '../../hooks/useBulkSelect';
import BulkActionBar from '../../components/ui/BulkActionBar';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { Trash2, RotateCcw, FileText, Calendar, DollarSign, Check, AlertTriangle, Settings, Clock } from 'lucide-react';

const TYPE_CONFIG = {
  invoice: { label: 'Invoice', icon: FileText, color: 'text-blue-600 bg-blue-50 ring-blue-200' },
  class: { label: 'Class', icon: Calendar, color: 'text-violet-600 bg-violet-50 ring-violet-200' },
  teacher_invoice: { label: 'Salary', icon: DollarSign, color: 'text-emerald-600 bg-emerald-50 ring-emerald-200' },
};

const TrashPage = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [typeFilter, setTypeFilter] = useState('');
  const [retentionHours, setRetentionHours] = useState(24);
  const [retentionInput, setRetentionInput] = useState('24');
  const [showSettings, setShowSettings] = useState(false);

  const bulk = useBulkSelect(items);

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const params = { page, limit: 50 };
      if (typeFilter) params.type = typeFilter;
      const { data } = await api.get('/trash', { params });
      setItems(data.items || []);
      setPagination(data.pagination || { total: 0, pages: 1 });
    } catch (err) {
      console.error('Failed to fetch trash:', err);
      showToast('error', 'Failed to load trash');
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter]);

  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await api.get('/trash/settings');
      setRetentionHours(data.retentionHours || 24);
      setRetentionInput(String(data.retentionHours || 24));
    } catch {
      // use defaults
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleRestore = async (id) => {
    try {
      await api.post(`/trash/${id}/restore`);
      showToast('success', 'Item restored');
      fetchItems();
    } catch (err) {
      showToast('error', err?.response?.data?.message || 'Failed to restore');
    }
  };

  const handlePermanentDelete = async (id) => {
    if (!window.confirm('Permanently delete this item? This cannot be undone.')) return;
    try {
      await api.delete(`/trash/${id}`);
      showToast('success', 'Permanently deleted');
      fetchItems();
    } catch (err) {
      showToast('error', err?.response?.data?.message || 'Failed to delete');
    }
  };

  const handleEmptyTrash = async () => {
    if (!window.confirm('Permanently delete ALL items in trash? This cannot be undone.')) return;
    try {
      setBulkLoading(true);
      const { data } = await api.post('/trash/empty');
      showToast('success', `${data.deleted} item(s) permanently deleted`);
      fetchItems();
    } catch (err) {
      showToast('error', 'Failed to empty trash');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkRestore = async () => {
    const ids = [...bulk.selected];
    if (ids.length === 0) return;
    try {
      setBulkLoading(true);
      const { data } = await api.post('/trash/bulk/restore', { ids });
      const parts = [];
      if (data.restored) parts.push(`${data.restored} restored`);
      if (data.failed?.length) parts.push(`${data.failed.length} failed`);
      showToast(data.failed?.length ? 'warning' : 'success', parts.join(', ') || 'Done');
      bulk.clearSelection();
      bulk.toggleSelectionMode();
      fetchItems();
    } catch (err) {
      showToast('error', 'Failed to bulk restore');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...bulk.selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Permanently delete ${ids.length} item(s)? This cannot be undone.`)) return;
    try {
      setBulkLoading(true);
      const { data } = await api.post('/trash/bulk/delete', { ids });
      showToast('success', `${data.deleted} item(s) permanently deleted`);
      bulk.clearSelection();
      bulk.toggleSelectionMode();
      fetchItems();
    } catch (err) {
      showToast('error', 'Failed to bulk delete');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleSaveRetention = async () => {
    const hours = parseInt(retentionInput, 10);
    if (!hours || hours < 1 || hours > 8760) {
      showToast('error', 'Enter a value between 1 and 8760 hours');
      return;
    }
    try {
      await api.put('/trash/settings', { retentionHours: hours });
      setRetentionHours(hours);
      showToast('success', `Retention set to ${hours} hours`);
      setShowSettings(false);
    } catch (err) {
      showToast('error', 'Failed to save settings');
    }
  };

  const formatTimeRemaining = (expiresAt) => {
    const ms = new Date(expiresAt) - Date.now();
    if (ms <= 0) return 'Expiring soon';
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Trash</h1>
          <p className="text-xs text-muted-foreground">
            Deleted items are kept for {retentionHours} hour{retentionHours !== 1 ? 's' : ''} before permanent deletion.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {toast && (
            <span className={`text-xs font-medium ${toast.type === 'success' ? 'text-emerald-600' : toast.type === 'error' ? 'text-rose-600' : 'text-amber-600'}`}>
              {toast.message}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </button>
          <button
            type="button"
            onClick={bulk.toggleSelectionMode}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              bulk.selectionMode
                ? 'border-primary/30 bg-primary/5 text-primary'
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            {bulk.selectionMode ? 'Exit' : 'Select'}
          </button>
          {items.length > 0 && (
            <button
              type="button"
              onClick={handleEmptyTrash}
              disabled={bulkLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 transition disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Empty trash
            </button>
          )}
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-medium text-foreground mb-2">Auto-delete settings</h3>
          <div className="flex items-center gap-3">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Retention period (hours):</label>
            <input
              type="number"
              min={1}
              max={8760}
              value={retentionInput}
              onChange={(e) => setRetentionInput(e.target.value)}
              className="w-24 rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="button"
              onClick={handleSaveRetention}
              className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition"
            >
              Save
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Items will be automatically and permanently deleted after this many hours. Common values: 24 (1 day), 168 (1 week), 720 (1 month).
          </p>
        </div>
      )}

      {/* Type filter tabs */}
      <div className="inline-flex items-center gap-1 rounded-full bg-slate-100/80 p-1">
        {[
          { key: '', label: 'All' },
          { key: 'invoice', label: 'Invoices' },
          { key: 'class', label: 'Classes' },
          { key: 'teacher_invoice', label: 'Salaries' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setTypeFilter(key); setPage(1); bulk.clearSelection(); }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              typeFilter === key
                ? 'bg-white text-slate-900 shadow'
                : 'text-slate-500 hover:text-slate-800'
            }`}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {/* Main list */}
      <div className="rounded-xl border border-border bg-card">
        {bulk.selectionMode && (
          <div className="border-b border-border p-3">
            <BulkActionBar
              selectedCount={bulk.selectedCount}
              isAllSelected={bulk.isAllSelected}
              onSelectAll={bulk.selectAll}
              onExit={() => { bulk.clearSelection(); bulk.toggleSelectionMode(); }}
            >
              <button type="button" onClick={handleBulkRestore} disabled={bulk.selectedCount === 0 || bulkLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
                <RotateCcw className="h-3 w-3" /> Restore
              </button>
              <button type="button" onClick={handleBulkDelete} disabled={bulk.selectedCount === 0 || bulkLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-40">
                <Trash2 className="h-3 w-3" /> Delete permanently
              </button>
            </BulkActionBar>
          </div>
        )}

        <div className="divide-y divide-border">
          {loading && items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
              <LoadingSpinner />
              <p className="text-sm">Loading…</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Trash2 className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Trash is empty</p>
              <p className="text-xs text-muted-foreground">Deleted items will appear here for {retentionHours} hours before being permanently removed.</p>
            </div>
          ) : (
            items.map((item) => {
              const cfg = TYPE_CONFIG[item.itemType] || TYPE_CONFIG.invoice;
              const Icon = cfg.icon;
              const selected = bulk.selectionMode && bulk.selected.has(item._id);

              return (
                <div key={item._id} className={`group relative px-4 py-3 transition hover:bg-muted/40 ${selected ? 'bg-primary/5' : ''}`}>
                  <div className="flex items-start gap-3">
                    {bulk.selectionMode && (
                      <button
                        type="button"
                        onClick={() => bulk.toggleItem(item._id)}
                        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border"
                        aria-label={selected ? 'Deselect' : 'Select'}
                      >
                        {selected && <Check className="h-3 w-3 text-primary" />}
                      </button>
                    )}

                    <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ${cfg.color}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-[14px] font-semibold text-foreground leading-tight truncate">
                              {item.label || `${cfg.label} ${String(item.itemId).slice(-6)}`}
                            </h3>
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${cfg.color}`}>
                              {cfg.label}
                            </span>
                            {item.meta?.status && (
                              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">
                                {item.meta.status}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[12px] text-muted-foreground mt-0.5 flex-wrap">
                            {item.meta?.guardianName && <span>{item.meta.guardianName}</span>}
                            {item.meta?.teacherName && <span>{item.meta.teacherName}</span>}
                            {item.meta?.total != null && (
                              <span className="font-mono">${Number(item.meta.total).toFixed(2)}</span>
                            )}
                            {item.meta?.subject && <span>{item.meta.subject}</span>}
                            {item.meta?.scheduledDate && (
                              <span>{new Date(item.meta.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                            )}
                            <span className="text-muted-foreground/30">·</span>
                            <span>Deleted {formatDate(item.deletedAt)}</span>
                            {item.deletedBy && (
                              <>
                                <span className="text-muted-foreground/30">·</span>
                                <span>by {item.deletedBy.firstName} {item.deletedBy.lastName}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground mr-1">
                            <Clock className="h-3 w-3" />
                            {formatTimeRemaining(item.expiresAt)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRestore(item._id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 transition"
                            title="Restore"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span className="hidden sm:inline">Restore</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePermanentDelete(item._id)}
                            className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition"
                            title="Delete permanently"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {pagination.pages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-muted-foreground">
              {page} / {pagination.pages} ({pagination.total} items)
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
              disabled={page >= pagination.pages}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrashPage;
