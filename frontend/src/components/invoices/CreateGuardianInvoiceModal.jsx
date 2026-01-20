import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Clock, DollarSign, X } from 'lucide-react';
import api from '../../api/axios';
import LoadingSpinner from '../ui/LoadingSpinner';
import SearchSelect from '../ui/SearchSelect';
import { getGuardianById, searchGuardians } from '../../services/entitySearch';

const clampNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const formatIsoDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const CreateGuardianInvoiceModal = ({ open, onClose, onCreated }) => {
  const [selectedGuardianId, setSelectedGuardianId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState(formatIsoDate(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)));
  const [hoursLimit, setHoursLimit] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const abortRef = useRef(null);
  const debounceRef = useRef(null);

  const fetchGuardianOptions = useMemo(() => (term = '') => searchGuardians(term), []);
  const fetchGuardianById = useMemo(() => (id) => getGuardianById(id), []);

  useEffect(() => {
    if (!open) return;
    setError('');
  }, [open]);

  const resetForm = () => {
    setSelectedGuardianId('');
    setDueDate(formatIsoDate(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)));
    setHoursLimit('');
    setNotes('');
    setError('');
    setPreview(null);
  };

  const handleClose = () => {
    if (saving) return;
    resetForm();
    onClose?.();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;

    if (!selectedGuardianId) {
      setError('Select a guardian first.');
      return;
    }

    const dueValue = dueDate ? new Date(dueDate) : null;
    if (!dueValue || Number.isNaN(dueValue.getTime())) {
      setError('Due date is invalid.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        guardianId: selectedGuardianId,
        dueDate: dueValue,
        notes: notes.trim() || undefined,
        hoursLimit: hoursLimit ? clampNumber(hoursLimit, 0) : undefined,
      };

      const { data } = await api.post('/invoices/manual/guardian', payload);
      if (data?.success) {
        onCreated?.(data.invoice);
        resetForm();
        onClose?.();
      } else {
        setError(data?.message || data?.error || 'Failed to create invoice.');
      }
    } catch (err) {
      console.error('Create invoice failed', err);
      setError(err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Failed to create invoice.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (!selectedGuardianId) {
      setPreview(null);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch (e) {
          // ignore
        }
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setPreviewLoading(true);
      setError('');
      try {
        const payload = {
          guardianId: selectedGuardianId,
          hoursLimit: hoursLimit ? clampNumber(hoursLimit, 0) : undefined,
        };
        const { data } = await api.post('/invoices/manual/guardian/preview', payload, { signal: controller.signal });
        if (data?.success) {
          setPreview(data.preview || null);
        } else {
          setPreview(null);
          setError(data?.message || data?.error || 'Unable to preview invoice.');
        }
      } catch (err) {
        if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
          console.error('Preview invoice failed', err);
          setError(err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Unable to preview invoice.');
          setPreview(null);
        }
      } finally {
        setPreviewLoading(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, selectedGuardianId, hoursLimit]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl rounded-3xl bg-white shadow-2xl">
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
          aria-label="Close create invoice modal"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 py-5">
          <h2 className="text-xl font-semibold text-slate-900">Create guardian invoice</h2>
          <p className="mt-1 text-sm text-slate-500">Manually create a single-item invoice for a guardian.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 border-t border-slate-100 px-6 pb-6 pt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <SearchSelect
              label="Guardian *"
              placeholder="Search guardians by name or email"
              value={selectedGuardianId}
              onChange={(option) => setSelectedGuardianId(option?.id || '')}
              fetchOptions={fetchGuardianOptions}
              fetchById={fetchGuardianById}
              required
            />
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Hours limit (optional)</span>
              <div className="relative flex items-center">
                <Clock className="absolute left-3 h-4 w-4 text-slate-400" />
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  inputMode="decimal"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={hoursLimit}
                  onChange={(e) => setHoursLimit(e.target.value)}
                  placeholder="Leave empty for 30-day period"
                />
              </div>
            </label>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-700">Invoice preview</div>
              {previewLoading && <LoadingSpinner size="sm" text="" />}
            </div>
            {preview ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  <div className="text-xs text-slate-400">Start date</div>
                  <div className="font-medium">{formatIsoDate(preview.startDate)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  <div className="text-xs text-slate-400">End date</div>
                  <div className="font-medium">{formatIsoDate(preview.endDate)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  <div className="text-xs text-slate-400">Total hours</div>
                  <div className="font-medium">{preview.totalHours?.toFixed?.(2) ?? preview.totalHours}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  <div className="text-xs text-slate-400">Amount (USD)</div>
                  <div className="font-medium">${preview.totalAmount?.toFixed?.(2) ?? preview.totalAmount}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  <div className="text-xs text-slate-400">Transfer fee</div>
                  <div className="font-medium">
                    {preview.transferFeeWaived
                      ? 'Waived'
                      : `$${(preview.transferFeeAmount ?? 0).toFixed(2)}`}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500">Select a guardian to preview unpaid classes.</div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Due date</span>
              <div className="relative flex items-center">
                <Calendar className="absolute left-3 h-4 w-4 text-slate-400" />
                <input
                  type="date"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Rate (USD/hr)</span>
              <div className="relative flex items-center">
                <DollarSign className="absolute left-3 h-4 w-4 text-slate-400" />
                <input
                  type="number"
                  readOnly
                  className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 py-2 pl-9 pr-3 text-sm text-slate-700"
                  value={preview?.rate ?? ''}
                />
              </div>
            </label>
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notes (optional)</span>
            <textarea
              rows={3}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional internal note"
            />
          </label>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !preview}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? <LoadingSpinner size="sm" text="" /> : null}
              Create invoice
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateGuardianInvoiceModal;
