import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { X, RefreshCcw, DollarSign, Clock } from 'lucide-react';
import api from '../../api/axios';
import LoadingSpinner from '../ui/LoadingSpinner';

const roundCurrency = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
};

const roundHours = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
};

const formatHoursDisplay = (value) => {
  if (!Number.isFinite(value) || value <= 0) return '';
  const fixed = value.toFixed(3);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};

const formatCurrencyDisplay = (value) => {
  if (!Number.isFinite(value) || value <= 0) return '';
  return value.toFixed(2);
};

const RefundInvoiceModal = ({ invoiceId, onClose, onUpdated }) => {
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [validation, setValidation] = useState('');
  const [successMessage, setSuccessMessage] = useState(''); // ✅ NEW: Store success message
  const [form, setForm] = useState({
    amount: '',
    hours: '',
    reason: 'Refund issued',
    reference: ''
  });

  useEffect(() => {
    const fetchInvoice = async () => {
      try {
        const { data } = await api.get(`/invoices/${invoiceId}`);
        const inv = data.invoice || data;
        setInvoice(inv);
      } catch (err) {
        console.error('Failed to load invoice for refund modal', err);
        // If invoice not found (404), close the modal automatically
        if (err.response?.status === 404) {
          console.warn('Invoice not found, closing refund modal');
          onClose();
          return;
        }
        setError('Failed to load invoice details. Please close and try again.');
      } finally {
        setLoading(false);
      }
    };
    fetchInvoice();
  }, [invoiceId, onClose]);

  const coverageHours = useMemo(() => {
    if (!invoice) return 0;
    const raw = invoice?.coverage?.maxHours;
    if (!Number.isFinite(raw)) return 0;
    return roundHours(raw);
  }, [invoice]);

  const hourlyRate = useMemo(() => {
    if (!invoice) return 10;
    const fromInvoice = Number(invoice?.guardianFinancial?.hourlyRate || 0) || 0;
    if (fromInvoice > 0) return fromInvoice;
    const fromGuardian = Number(invoice?.guardian?.guardianInfo?.hourlyRate || 0) || 0;
    if (fromGuardian > 0) return fromGuardian;
    const items = Array.isArray(invoice?.items) ? invoice.items : [];
    const itemWithRate = items.find((it) => Number(it?.rate || 0) > 0);
    if (itemWithRate) return Number(itemWithRate.rate);
    const hours = items.reduce((sum, it) => sum + ((Number(it?.duration || 0) || 0) / 60), 0);
    const amount = items.reduce((sum, it) => sum + (Number(it?.amount || 0) || 0), 0);
    if (hours > 0 && amount > 0) {
      return roundCurrency(amount / hours);
    }
    return 10;
  }, [invoice]);

  const transferFeeAmount = useMemo(() => {
    const tf = invoice?.guardianFinancial?.transferFee;
    if (!tf || tf.waived) return 0;
    const amount = Number(tf.amount || 0);
    return Number.isFinite(amount) && amount > 0 ? roundCurrency(amount) : 0;
  }, [invoice]);

  const transferFeeStatus = useMemo(() => {
    // Transfer fee is considered "paid" if the invoice is paid
    // (The transfer fee object doesn't have a status field - it's applied when invoice is paid)
    return invoice?.status === 'paid' ? 'paid' : 'unpaid';
  }, [invoice]);

  const totalInvoiceItems = useMemo(() => {
    const items = Array.isArray(invoice?.items) ? invoice.items : [];
    // Filter to match backend logic: exclude exempted items
    return items.filter((it) => 
      it && !it.excludeFromStudentBalance && !it.exemptFromGuardian && 
      !(it.flags && (it.flags.notCountForBoth || it.flags.exemptFromGuardian))
    ).length;
  }, [invoice]);

  const totalInvoiceHours = useMemo(() => {
    const items = Array.isArray(invoice?.items) ? invoice.items : [];
    // Calculate total hours from refundable items (matching backend logic)
    const refundableItems = items.filter((it) => 
      it && !it.excludeFromStudentBalance && !it.exemptFromGuardian && 
      !(it.flags && (it.flags.notCountForBoth || it.flags.exemptFromGuardian))
    );
    return refundableItems.reduce((sum, it) => sum + ((Number(it?.duration || 0) || 0) / 60), 0);
  }, [invoice]);

  const computeAmountNumberFromHours = useCallback((hoursValue) => {
    const hrs = Number(hoursValue);
    if (!Number.isFinite(hrs) || hrs <= 0) return 0;
    const base = roundCurrency(hrs * hourlyRate);
    
    console.log('🔍 [RefundModal] Transfer fee check', {
      transferFeeAmount,
      transferFeeStatus,
      shouldIncludeFee: transferFeeAmount > 0 && transferFeeStatus === 'paid'
    });
    
    // If no transfer fee or waived, return base only
    if (transferFeeAmount <= 0 || transferFeeStatus !== 'paid') {
      return base;
    }
    
    // ✅ MATCH BACKEND LOGIC: Use coverage hours if available, otherwise total invoice hours
    // Backend: const feeCoverageHours = hasCoverageCap ? coverageBefore : computeInvoiceItemHours(invoice);
    const feeCoverageHours = coverageHours > 0 ? coverageHours : totalInvoiceHours;
    
    // Simple hours-based proportion - match backend logic
    const hoursRatio = feeCoverageHours > 0 ? Math.min(hrs / feeCoverageHours, 1) : 0;
    const proportionalFee = roundCurrency(transferFeeAmount * hoursRatio);
    const total = roundCurrency(base + proportionalFee);
    
    console.log('💰 [RefundModal] Transfer fee calculation', {
      hrs,
      hourlyRate,
      base,
      transferFeeAmount,
      coverageHours,
      totalInvoiceHours,
      feeCoverageHours,
      hoursRatio: Math.round(hoursRatio * 10000) / 10000,
      proportionalFee,
      total
    });
    
    return total;
  }, [hourlyRate, transferFeeAmount, transferFeeStatus, coverageHours, totalInvoiceHours]);

  const computeAmountDisplayFromHours = useCallback((hoursValue) => {
    const num = computeAmountNumberFromHours(hoursValue);
    return formatCurrencyDisplay(num);
  }, [computeAmountNumberFromHours]);

  const computeHoursFromAmount = useCallback((amountValue) => {
    const amt = Number(amountValue);
    if (!Number.isFinite(amt) || amt <= 0) return '';
    const guesses = [];
    if (hourlyRate > 0) {
      guesses.push(Math.max(0, amt / hourlyRate));
    }
    if (transferFeeAmount > 0 && coverageHours > 0) {
      const effectiveRate = hourlyRate + (transferFeeAmount / coverageHours);
      if (effectiveRate > 0) {
        guesses.push(Math.max(0, amt / effectiveRate));
      }
    }
    if (!guesses.length) return '';
    const target = roundCurrency(amt);
    let best = null;
    let bestDiff = Number.MAX_SAFE_INTEGER;
    guesses.forEach((guess) => {
      const clamped = Math.max(0, Math.min(coverageHours, roundHours(guess)));
      const diff = Math.abs(computeAmountNumberFromHours(clamped) - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = clamped;
      }
    });
    return best ?? '';
  }, [hourlyRate, transferFeeAmount, coverageHours, computeAmountNumberFromHours]);

  useEffect(() => {
    if (!invoice || coverageHours <= 0) return;
    const defaultHours = coverageHours;
    const defaultAmount = computeAmountDisplayFromHours(defaultHours);
    setForm((prev) => ({
      amount: defaultAmount,
      hours: formatHoursDisplay(defaultHours),
      reason: prev.reason || 'Refund issued',
      reference: ''
    }));
  }, [invoice, coverageHours, computeAmountDisplayFromHours]);

  const handleHoursChange = (value) => {
    setValidation('');
    if (!invoice) return;
    if (value === '') {
      setForm((prev) => ({ ...prev, hours: '', amount: '' }));
      return;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      setForm((prev) => ({ ...prev, hours: value }));
      return;
    }
    const clamped = Math.max(0, Math.min(coverageHours, roundHours(numeric)));
    if (clamped !== roundHours(numeric) || clamped === coverageHours && numeric > coverageHours) {
      setValidation(`Refund hours cannot exceed ${coverageHours}h.`);
    }
    const amountDisplay = computeAmountDisplayFromHours(clamped);
    setForm((prev) => ({
      ...prev,
      hours: formatHoursDisplay(clamped),
      amount: amountDisplay
    }));
  };

  const handleAmountChange = (value) => {
    setValidation('');
    if (!invoice) return;
    if (value === '') {
      setForm((prev) => ({ ...prev, amount: '', hours: '' }));
      return;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      setForm((prev) => ({ ...prev, amount: value }));
      return;
    }
    const derivedHours = computeHoursFromAmount(numeric);
    if (derivedHours === '') {
      setForm((prev) => ({ ...prev, amount: formatCurrencyDisplay(roundCurrency(numeric)) }));
      return;
    }
    if (derivedHours > coverageHours) {
      setValidation(`Refund hours cannot exceed ${coverageHours}h.`);
    }
    const clamped = Math.max(0, Math.min(coverageHours, roundHours(derivedHours)));
    
    // ✅ NEW: Validate that the amount matches the expected calculation for the derived hours
    const expectedAmount = computeAmountNumberFromHours(clamped);
    const amountDiff = Math.abs(numeric - expectedAmount);
    const EPSILON = 0.015;
    if (amountDiff > EPSILON) {
      const feeNote = transferFeeAmount > 0 
        ? ` (including $${formatCurrencyDisplay(roundCurrency(expectedAmount - clamped * hourlyRate))} proportional transfer fee)`
        : '';
      setValidation(
        `For ${formatHoursDisplay(clamped)}h at $${hourlyRate.toFixed(2)}/hr, amount should be $${expectedAmount.toFixed(2)}${feeNote}.`
      );
    }
    
    setForm((prev) => ({
      ...prev,
      amount: formatCurrencyDisplay(roundCurrency(numeric)),
      hours: formatHoursDisplay(clamped)
    }));
  };

  const handleReasonChange = (value) => {
    setForm((prev) => ({ ...prev, reason: value }));
  };

  const handleReferenceChange = (value) => {
    setForm((prev) => ({ ...prev, reference: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!invoice) return;
    setValidation('');

    const parsedHours = Number(form.hours);
    const parsedAmount = Number(form.amount);

    if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
      setValidation('Enter a valid number of hours to refund.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setValidation('Enter a valid refund amount.');
      return;
    }
    if (!form.reason || !form.reason.trim()) {
      setValidation('A refund reason is required.');
      return;
    }
    if (parsedHours - coverageHours > 0.0005) {
      setValidation(`Refund hours cannot exceed ${coverageHours}h.`);
      return;
    }

    // ✅ NEW: Validate amount matches expected calculation including transfer fee
    const expectedAmount = computeAmountNumberFromHours(parsedHours);
    const amountDiff = Math.abs(parsedAmount - expectedAmount);
    const EPSILON = 0.015; // Allow 1.5 cent tolerance for rounding
    if (amountDiff > EPSILON) {
      const feeNote = transferFeeAmount > 0 
        ? ` (including ${formatCurrencyDisplay(roundCurrency(expectedAmount - parsedHours * hourlyRate))} proportional transfer fee)`
        : '';
      setValidation(
        `Refund amount must match ${parsedHours}h at $${hourlyRate.toFixed(2)}/hr = $${expectedAmount.toFixed(2)}${feeNote}. Please adjust the amount or hours.`
      );
      return;
    }

    setSaving(true);
    try {
      const payload = {
        refundAmount: roundCurrency(parsedAmount),
        refundHours: roundHours(parsedHours),
        reason: form.reason.trim(),
        refundReference: form.reference ? form.reference.trim() : undefined
      };

      const { data } = await api.post(`/invoices/${invoiceId}/refund`, payload);
      if (data?.success) {
        // ✅ NEW: Show success message from backend summary
        const message = data?.summary?.message || data?.message || 'Refund processed successfully.';
        setSuccessMessage(message);
        
        // Call onUpdated callback but DON'T close yet - let user read the message
        if (typeof onUpdated === 'function') {
          onUpdated(data.invoice);
        }
        // Modal will stay open to show the message - user can close it manually
      } else {
        setValidation(data?.message || data?.error || 'Failed to apply refund.');
      }
    } catch (err) {
      console.error('Refund invoice request failed', err);
      const message = err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Failed to apply refund.';
      setValidation(message);
    } finally {
      setSaving(false);
    }
  };

  const remainingHours = useMemo(() => {
    const currentHours = Number(form.hours);
    if (!Number.isFinite(currentHours)) return coverageHours;
    return Math.max(0, roundHours(coverageHours - currentHours));
  }, [coverageHours, form.hours]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
        <div className="rounded-2xl bg-white p-10 shadow-xl">
          <LoadingSpinner size="lg" label="Loading invoice..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
        <div className="max-w-md rounded-2xl bg-white p-8 shadow-xl">
          <h2 className="text-lg font-semibold text-slate-900">Refund invoice</h2>
          <p className="mt-4 text-sm text-rose-600">{error}</p>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => onClose?.()}
              className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const refundDisabled = saving || coverageHours <= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
        <button
          type="button"
          onClick={() => onClose?.()}
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
          aria-label="Close refund modal"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="px-6 py-5">
          <h2 className="text-xl font-semibold text-slate-900">Record Refund</h2>
          <p className="mt-1 text-sm text-slate-500">Reduce the paid hours and amount for this invoice. Covered hours after refund will update automatically.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6 border-t border-slate-100 px-6 pb-6 pt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Refund hours</span>
              <div className="relative flex items-center">
                <Clock className="absolute left-3 h-4 w-4 text-slate-400" />
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  inputMode="decimal"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={form.hours}
                  onChange={(e) => handleHoursChange(e.target.value)}
                  placeholder="0.000"
                />
              </div>
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Refund amount (USD)</span>
              <div className="relative flex items-center">
                <DollarSign className="absolute left-3 h-4 w-4 text-slate-400" />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={form.amount}
                  onChange={(e) => handleAmountChange(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </label>
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reason</span>
            <textarea
              rows={3}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              value={form.reason}
              onChange={(e) => handleReasonChange(e.target.value)}
              placeholder="Why is this refund being issued?"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reference</span>
            <input
              type="text"
              value={form.reference}
              onChange={(e) => handleReferenceChange(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              placeholder="Transaction or reference number"
            />
          </label>

          <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-sm text-slate-600">
            <div className="flex items-center gap-2 text-slate-500">
              <RefreshCcw className="h-4 w-4" />
              <span>Summary</span>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              <li><span className="font-medium text-slate-700">Covered hours before refund:</span> {coverageHours}h</li>
              <li><span className="font-medium text-slate-700">Covered hours after refund:</span> {remainingHours}h</li>
              <li><span className="font-medium text-slate-700">Hourly rate:</span> ${hourlyRate.toFixed(2)}/hr</li>
              {transferFeeAmount > 0 && (
                <li><span className="font-medium text-slate-700">Transfer fee applied:</span> ${transferFeeAmount.toFixed(2)}</li>
              )}
            </ul>
          </div>

          {coverageHours <= 0 && (
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              This invoice does not have any covered hours to refund.
            </div>
          )}

          {validation && (
            <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-600">{validation}</div>
          )}

          {successMessage && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-emerald-800 mb-2">Refund Processed Successfully</h4>
                  <div className="text-sm text-emerald-700 whitespace-pre-line">{successMessage}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onClose?.()}
                  className="text-emerald-600 hover:text-emerald-800 font-semibold text-lg"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>
          )}

          {!successMessage && (
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => onClose?.()}
                className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={refundDisabled}
                className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
              >
                {saving ? 'Processing…' : 'Record Refund'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default RefundInvoiceModal;
