import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../../api/axios';
import { computeInvoiceTotals, resolveInvoiceClassEntries } from '../../utils/invoiceTotals';
import LoadingSpinner from '../ui/LoadingSpinner';
import { X, DollarSign, CreditCard, ClipboardSignature } from 'lucide-react';
import { formatDateDDMMMYYYY } from '../../utils/date';

const RecordPaymentModal = ({ invoiceId, onClose, onUpdated }) => {
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    amount: '',
    paymentMethod: 'cash',
    transactionId: '',
    hoursPaid: '',
    tip: '',
    paypalInvoiceNumber: ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activeField, setActiveField] = useState('amount'); // 'amount' | 'hours'
  const [savingCoverage, setSavingCoverage] = useState(false);
  const [coverageSaved, setCoverageSaved] = useState(false);
  const [lastSavedHours, setLastSavedHours] = useState(null);
  const autoSaveTimerRef = useRef(null);

  const resolvedClassEntries = useMemo(
    () => resolveInvoiceClassEntries(invoice || {}),
    [invoice]
  );

  // Resolve a consistent hourly rate for conversions (matches backend fallbacks)
  const hourlyRate = useMemo(() => {
    const inv = invoice || {};
    const fromInvoice = Number(inv?.guardianFinancial?.hourlyRate || 0) || 0;
    const fromGuardian = Number(inv?.guardian?.guardianInfo?.hourlyRate || 0) || 0;
    if (fromInvoice > 0) return fromInvoice;
    if (fromGuardian > 0) return fromGuardian;
    const items = resolvedClassEntries.items || [];
    const itemWithRate = items.find((it) => Number(it?.rate || 0) > 0);
    if (itemWithRate) return Number(itemWithRate.rate);
    const hours = items.reduce((s, it) => s + ((Number(it?.duration || 0) || 0) / 60), 0);
    const amt = items.reduce((s, it) => s + (Number(it?.amount || 0) || 0), 0);
    if (hours > 0 && amt > 0) return Math.round((amt / hours) * 100) / 100;
    return 10;
  }, [invoice, resolvedClassEntries]);

  const transferFeeAmount = useMemo(() => {
    const tf = invoice?.guardianFinancial?.transferFee;
    if (!tf || tf.waived) return 0;
    const amount = Number(tf.amount || 0);
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
  }, [invoice]);

  const computeAmountFromHours = React.useCallback((hoursValue) => {
    const hrs = Number(hoursValue);
    if (!Number.isFinite(hrs) || hrs <= 0 || hourlyRate <= 0) {
      return null;
    }
    const base = Math.round((hrs * hourlyRate) * 100) / 100;
    return Math.round((base + transferFeeAmount) * 100) / 100;
  }, [hourlyRate, transferFeeAmount]);

  const computeHoursFromAmount = React.useCallback((amountValue) => {
    const amt = Number(amountValue);
    if (!Number.isFinite(amt) || amt <= 0 || hourlyRate <= 0) {
      return null;
    }
    const basePortion = amt - transferFeeAmount;
    if (basePortion <= 0) {
      return 0;
    }
    return Math.round((basePortion / hourlyRate) * 1000) / 1000;
  }, [hourlyRate, transferFeeAmount]);

  useEffect(() => {
    const fetchInvoice = async () => {
      try {
        
        const { data } = await api.get(`/invoices/${invoiceId}`);
        const inv = data.invoice || data;
        
        const computed = computeInvoiceTotals(inv);
        const fetchedClassEntries = resolveInvoiceClassEntries(inv);
        setInvoice({ ...inv, __computedTotal: computed.total, __computedHours: computed.hours, __computedTransferFee: computed.transferFee });
          const initialAmountRaw = computed.remaining > 0 ? computed.remaining : Number(inv?.total || inv?.amount || 0);
          const rawTransferFee = (() => {
            const tf = inv?.guardianFinancial?.transferFee;
            if (!tf || tf.waived) return 0;
            const amt = Number(tf.amount || 0);
            return Number.isFinite(amt) && amt > 0 ? Math.round(amt * 100) / 100 : 0;
          })();
          const derivedRate = (() => {
            const fromInvoice = Number(inv?.guardianFinancial?.hourlyRate || 0) || 0;
            const fromGuardian = Number(inv?.guardian?.guardianInfo?.hourlyRate || 0) || 0;
            if (fromInvoice > 0) return fromInvoice;
            if (fromGuardian > 0) return fromGuardian;
            const items = fetchedClassEntries.items || [];
            const itemWithRate = items.find((it) => Number(it?.rate || 0) > 0);
            if (itemWithRate) return Number(itemWithRate.rate);
            const hours = items.reduce((s, it) => s + ((Number(it?.duration || 0) || 0) / 60), 0);
            const amt = items.reduce((s, it) => s + (Number(it?.amount || 0) || 0), 0);
            if (hours > 0 && amt > 0) return Math.round((amt / hours) * 100) / 100;
            return 10;
          })();
          const basePortion = Number.isFinite(initialAmountRaw) ? initialAmountRaw - rawTransferFee : NaN;
          const initialHours = (Number.isFinite(basePortion) && basePortion > 0 && derivedRate > 0)
            ? Math.round((basePortion / derivedRate) * 1000) / 1000
            : '';
          const formattedAmount = Number.isFinite(initialAmountRaw) && initialAmountRaw > 0
            ? (Math.round(initialAmountRaw * 100) / 100).toFixed(2)
            : '';
        setForm({
          amount: formattedAmount,
          // prefer guardian's preferred method, then invoice method, then paypal by default
          paymentMethod: (inv.guardian && inv.guardian.paymentMethod) || inv.paymentMethod || 'paypal',
          transactionId: '',
          hoursPaid: Number.isFinite(initialHours) && initialHours > 0 ? initialHours.toFixed(2) : '',
          tip: inv.tip ? String(inv.tip) : '',
          paypalInvoiceNumber: inv.paypalInvoiceNumber || ''
        });
      } catch (err) {
        console.error(err);
        setError('Failed to load invoice details');
      } finally {
        setLoading(false);
      }
    };
    fetchInvoice();
  }, [invoiceId]);

  // Compute the same billing window used in the view modal and invoices page
  const [billingWindow, setBillingWindow] = useState({ start: null, end: null, loading: true });
  // Class-boundary guidance for payments (derived strictly from resolved class entries)
  const [boundaries, setBoundaries] = useState({ hours: [], dates: [] });
  const [boundaryHint, setBoundaryHint] = useState(null);
  // Ensure the initial defaults snap to a valid boundary once invoice and boundaries are known
  const [didInitDefaults, setDidInitDefaults] = useState(false);
  useEffect(() => {
    if (!invoice) return;

    // Prefer resolved class entries (dynamic-aware) to compute boundaries
    const items = (resolvedClassEntries.items || []).slice().filter(Boolean);
    const normalized = items
      .map(it => ({
        rawDate: (it.date ? new Date(it.date) : (it.scheduledDate ? new Date(it.scheduledDate) : null)),
        // durations may be in minutes on items or hours; prefer minutes if present
        durationMin: (typeof it.duration === 'number' && isFinite(it.duration) ? it.duration : (typeof it.minutes === 'number' ? it.minutes : null)),
      }))
      .filter(e => e.rawDate && !Number.isNaN(e.rawDate.getTime()) && typeof e.durationMin === 'number' && e.durationMin > 0);
    normalized.sort((a, b) => a.rawDate - b.rawDate);

    const filteredNormalized = normalized;

    let cumMin = 0;
    const boundariesMinutes = [];
    const boundariesDates = [];
    for (const e of filteredNormalized) {
      cumMin += Number(e.durationMin || 0);
      boundariesMinutes.push(cumMin);
      boundariesDates.push(e.rawDate);
    }
    const boundariesHours = boundariesMinutes.map(m => Math.round((m / 60) * 1000) / 1000);
    setBoundaries({ hours: boundariesHours, dates: boundariesDates });

    // Initialize default amount/hours to the next valid boundary, not the raw remaining amount
    // to avoid cases like $12 (1.2h) on a 1.0h invoice. If the next boundary is the final
    // boundary (i.e., paying 100% of the invoice items), also include the transfer fee so the
    // invoice can transition to paid without a small residual.
    if (!didInitDefaults && boundariesHours.length > 0) {
      // Determine current covered hours from invoice.coverage.maxHours (server source of truth)
      const covered = (invoice.coverage && typeof invoice.coverage.maxHours === 'number' && isFinite(invoice.coverage.maxHours))
        ? Math.max(0, Number(invoice.coverage.maxHours))
        : 0;
      // Pick the next boundary strictly greater than covered; if none, use the last boundary
      const nextIdx = boundariesHours.findIndex((h) => h > covered);
      const targetHours = nextIdx !== -1 ? boundariesHours[nextIdx] : boundariesHours[boundariesHours.length - 1];

      // Base amount from hours
      const computedAmount = computeAmountFromHours(targetHours);
      const targetAmount = computedAmount !== null ? computedAmount : Math.round((targetHours * hourlyRate) * 100) / 100;
      setActiveField('hours');
      setForm((prev) => ({
        ...prev,
        hoursPaid: targetHours.toFixed(2),
        amount: targetAmount.toFixed(2)
      }));
      setDidInitDefaults(true);
    }

    // Billing window from filtered items (respects coverage.maxHours)
    const hasItems = filteredNormalized.length > 0;
    const start = hasItems ? new Date(Math.min(...filteredNormalized.map(e => e.rawDate.getTime()))) : (invoice.billingPeriod?.startDate ? new Date(invoice.billingPeriod.startDate) : null);
    const end = hasItems ? new Date(Math.max(...filteredNormalized.map(e => e.rawDate.getTime()))) : (invoice.billingPeriod?.endDate ? new Date(invoice.billingPeriod.endDate) : null);
    setBillingWindow({
      start: start ? formatDateDDMMMYYYY(start) : null,
      end: end ? formatDateDDMMMYYYY(end) : null,
      loading: false,
    });
  }, [invoice, computeAmountFromHours, didInitDefaults, hourlyRate, resolvedClassEntries]);

  // ✅ Removed boundary validation - hoursPaid accepts any value (actual payment amount)
  // Live boundary hint for reference only (not enforced)
  useEffect(() => {
    const hrs = Number(form.hoursPaid);
    if (!Number.isFinite(hrs) || hrs <= 0 || !Array.isArray(boundaries.hours) || boundaries.hours.length === 0) {
      setBoundaryHint(null);
      return;
    }
    const EPS = 0.005; // 0.3 minute tolerance
    const matchIdx = boundaries.hours.findIndex((h) => Math.abs(h - hrs) <= EPS);
    if (matchIdx !== -1) {
      const coveredDate = boundaries.dates[matchIdx];
      setBoundaryHint({ valid: true, coveredUntil: coveredDate ? formatDateDDMMMYYYY(new Date(coveredDate)) : null });
      return;
    }
    // Show info about nearest boundary for reference only
    let nextIdx = -1;
    for (let i = 0; i < boundaries.hours.length; i++) {
      if (boundaries.hours[i] >= hrs - EPS) { nextIdx = i; break; }
    }
    if (nextIdx === -1) {
      nextIdx = boundaries.hours.length - 1;
    }
    const nextHrs = boundaries.hours[nextIdx] || null;
    const nextAmt = Number.isFinite(nextHrs) ? Math.round(nextHrs * hourlyRate * 100) / 100 : null;
    const coveredDate = boundaries.dates[nextIdx] ? formatDateDDMMMYYYY(new Date(boundaries.dates[nextIdx])) : null;
    // Show as info only, not as validation error
    setBoundaryHint({ valid: true, nextHours: nextHrs, nextAmount: nextAmt, coveredUntil: coveredDate, isInfo: true });
  }, [form.hoursPaid, boundaries, hourlyRate]);

  const handleChange = e => {
    const { name, value } = e.target;
    if (name === 'amount') {
      setActiveField('amount');
      // If user switches to amount field, trigger immediate save of hours if pending
      if (autoSaveTimerRef.current && form.hoursPaid && Number(form.hoursPaid) > 0) {
        clearTimeout(autoSaveTimerRef.current);
        saveCoverageToBackend(form.hoursPaid);
      }
      const hours = computeHoursFromAmount(value);
        setForm(prev => ({
          ...prev,
          amount: value,
          hoursPaid: hours === null ? '' : hours.toFixed(2)
        }));
      return;
    }
    if (name === 'hoursPaid') {
      setActiveField('hours');
      const amount = computeAmountFromHours(value);
        setForm(prev => ({
          ...prev,
          hoursPaid: value,
          amount: amount === null ? '' : amount.toFixed(2)
        }));
      return;
    }
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const [editingPaypal, setEditingPaypal] = useState(false);
  const calcTransferFee = (tipValue) => {
    const numeric = Number(tipValue) || 0;
    return Math.round(numeric * 0.05 * 100) / 100;
  };
  const calcNetTip = (tipValue) => {
    const numeric = Number(tipValue) || 0;
    return Math.round((numeric - calcTransferFee(numeric)) * 100) / 100;
  };
  const teachersList = (resolvedClassEntries.items || [])
    .map(i => i.teacherSnapshot?.firstName ? `${i.teacherSnapshot.firstName} ${i.teacherSnapshot.lastName}` : (i.teacher?.firstName ? `${i.teacher.firstName} ${i.teacher.lastName}` : null))
    .filter(Boolean);
  
  // Get unique teachers only
  const uniqueTeachers = Array.from(new Set(teachersList));
  const teachersCount = uniqueTeachers.length;
  const perTeacherTip = teachersCount > 0 ? Math.round((calcNetTip(form.tip || 0) / teachersCount) * 100) / 100 : 0;

  const handleSubmit = e => {
    e.preventDefault();
    // Open confirmation modal; actual submission is performed in handleConfirm
    setConfirmOpen(true);
  };

  // Auto-save coverage (maxHours) after user stops typing for 1.5 seconds
  const saveCoverageToBackend = React.useCallback(async (hoursValue) => {
    if (!hoursValue || Number(hoursValue) <= 0) {
      return;
    }

    const newHours = Number(hoursValue);

    // Skip if same value already saved
    if (lastSavedHours === newHours) {
      return;
    }

    // Skip if the value matches what's currently in the invoice (no change)
    const currentMaxHours = invoice?.coverage?.maxHours;
    if (typeof currentMaxHours === 'number' && Math.abs(currentMaxHours - newHours) < 0.001) {
      // Values are essentially the same, no need to save
      setLastSavedHours(newHours);
      return;
    }

    setSavingCoverage(true);
    setCoverageSaved(false);

    try {
      const payload = {
        maxHours: newHours
      };

      await api.put(`/invoices/${invoiceId}/coverage`, payload);
      
      // Refresh invoice to show updated coverage
      const { data } = await api.get(`/invoices/${invoiceId}`);
      const inv = data.invoice || data;
      const computed = computeInvoiceTotals(inv);
      setInvoice({ ...inv, __computedTotal: computed.total, __computedHours: computed.hours, __computedTransferFee: computed.transferFee });
      
      setLastSavedHours(newHours);
      setCoverageSaved(true);
      setTimeout(() => setCoverageSaved(false), 3000); // Hide message after 3 seconds
    } catch (err) {
      console.error('Failed to auto-save coverage:', err);
      // Don't show error to user for auto-save failures unless critical
    } finally {
      setSavingCoverage(false);
    }
  }, [invoiceId, invoice?.coverage?.maxHours, lastSavedHours]);

  // Auto-save effect: triggers 1.5 seconds after user stops typing
  useEffect(() => {
    // Clear any existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Only auto-save if user is editing hours field and has valid value
    if (activeField === 'hours' && form.hoursPaid && Number(form.hoursPaid) > 0) {
      // Set new timer to save after 1.5 seconds of no typing
      autoSaveTimerRef.current = setTimeout(() => {
        saveCoverageToBackend(form.hoursPaid);
      }, 1500); // 1.5 second debounce
    }

    // Cleanup timer on unmount or when dependencies change
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [form.hoursPaid, activeField, saveCoverageToBackend]); // Re-run when hoursPaid or activeField changes

  const [confirmOpen, setConfirmOpen] = useState(false);

  const ConfirmModal = ({ open, onCancel, onConfirm }) => {
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40">
        <div className="w-full max-w-md rounded-2xl bg-white p-6">
          <h3 className="text-lg font-semibold">Confirm payment</h3>
          <p className="mt-2 text-sm text-slate-600">This will update the invoice status, credit guardian hours, and mark classes as paid by guardian. Confirm?</p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onCancel} className="rounded-md border px-3 py-1.5 text-sm">Cancel</button>
            <button onClick={onConfirm} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white">Confirm</button>
          </div>
        </div>
      </div>
    );
  };

  const handleConfirm = async () => {
    setConfirmOpen(false);
    // proceed to final submission
    setSaving(true);
    setError('');
    try {
      const paidHoursNumeric = form.hoursPaid ? Number(form.hoursPaid) : undefined;
      let derivedAmount = form.amount ? Number(form.amount) : undefined;
      if (Number.isFinite(paidHoursNumeric) && paidHoursNumeric > 0) {
        const recalculatedAmount = computeAmountFromHours(paidHoursNumeric);
        if (recalculatedAmount !== null) {
          derivedAmount = recalculatedAmount;
          setForm(prev => ({ ...prev, amount: recalculatedAmount.toFixed(2) }));
        }
      }
      const normalizedAmount = Number.isFinite(derivedAmount) ? Math.round(derivedAmount * 100) / 100 : undefined;
      const normalizedHours = Number.isFinite(paidHoursNumeric) && paidHoursNumeric > 0 ? paidHoursNumeric : undefined;

      const payload = {
        amount: normalizedAmount,
        paymentMethod: form.paymentMethod,
        transactionId: form.transactionId || undefined,
        tip: form.tip ? Number(form.tip) : undefined,
        // ✅ Always send paidHours - this is the actual payment amount, not an estimate
        paidHours: normalizedHours,
        paypalInvoiceNumber: form.paypalInvoiceNumber ? String(form.paypalInvoiceNumber).trim() : undefined
      };
      
      const res = await api.post(`/invoices/${invoiceId}/payment`, payload);
      const updated = res?.data || {};
      // Propagate updated entities so parent can refresh UI instantly
      if (onUpdated) onUpdated({
        invoice: updated.invoice || null,
        guardian: updated.guardian || null,
        dashboard: updated.dashboard || null
      });
      onClose();
    } catch (err) {
      console.error(err);
      // Prefer specific validation messages (e.g., class boundary)
      const msg = err.response?.data?.message || 'Failed to record payment';
      setError(msg);
      // If backend provided next valid suggestion, try to surface it
      const m = String(msg).match(/next valid (?:total )?hours?:\s*(\d+(?:\.\d+)?)/i);
      if (m && m[1]) {
        const suggestedHrs = Number(m[1]);
        if (Number.isFinite(suggestedHrs)) {
          const suggestedAmt = Math.round(suggestedHrs * hourlyRate * 100) / 100;
          setBoundaryHint({ valid: false, nextHours: suggestedHrs, nextAmount: suggestedAmt, coveredUntil: boundaryHint?.coveredUntil || null });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  // Display exactly what was saved on the invoice as the primary source of truth, and show computed as secondary
  const savedTotal = Number(invoice?.total ?? invoice?.amount ?? 0) || 0;
  const savedHours = (typeof invoice?.hoursCovered === 'number') ? invoice.hoursCovered : (invoice?.paidHours ?? invoice?.hoursPaid ?? null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-8 backdrop-blur-sm">
  <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-lg">
        <button
          onClick={onClose}
          className="absolute right-5 top-5 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/70 text-slate-500 shadow hover:text-slate-900"
          aria-label="Close record payment"
        >
          <X className="h-5 w-5" />
        </button>

  <div className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-700 px-4 py-3 text-white">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.3em] text-white/70">Record payment</p>
              <h2 className="mt-1 text-xl font-semibold leading-tight truncate">{invoice?.invoiceNumber}</h2>

              {/* Compact guardian info: role • name • email (single compact row, truncated) */}
              <div className="mt-1 flex items-center gap-3 text-sm text-white/90 truncate">
                <span className="text-xs text-white/80 truncate">{invoice?.guardian?.role || invoice?.guardian?.relationship || 'Guardian'}</span>
                <span className="text-xs text-white/90 truncate">• {invoice?.guardian?.firstName} {invoice?.guardian?.lastName}</span>
                <span className="text-xs text-white/90 truncate">• {invoice?.guardian?.email || '—'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Constrain modal content to viewport height and arrange into two columns
            on large screens so content fits without scrolling. We show a condensed
            preview by default and allow expanding details to avoid vertical growth. */}
        <div
          className="space-y-4 px-6 pb-6 pt-4"
          style={{
            maxHeight: 'calc(100vh - 120px)',
            overflow: 'hidden',
            display: 'grid',
            // left column flexible, right column fixed width keeps preview compact and uses empty space
            gridTemplateColumns: '1fr 280px',
            gap: '1rem'
          }}
        >
          {error && (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="col-span-1" style={{ overflow: 'auto' }}>
            <div className="space-y-5">
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 mb-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-600">
                  <DollarSign className="h-4 w-4" />
                  Amount to record
                </div>
                <p className="mt-2 text-2xl font-semibold text-emerald-900">
                  ${Number(form.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                {boundaryHint && (
                  <div className="mt-2 text-[12px] text-emerald-700">
                    {boundaryHint.valid ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium">Covered until {boundaryHint.coveredUntil || '—'}</span>
                    ) : (
                      <div className="inline-flex items-center gap-2">
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">Align to class boundary</span>
                        {Number.isFinite(boundaryHint.nextHours) && (
                          <button
                            type="button"
                            onClick={() => {
                              const h = boundaryHint.nextHours;
                              // Base amount by hours
                              let a = Math.round(h * hourlyRate * 100) / 100;
                              // If this is the final boundary, include transfer fee so invoice can be fully paid
                              try {
                                const lastBoundary = (boundaries.hours || [])[boundaries.hours.length - 1];
                                const EPS = 0.005;
                                const isFinal = Math.abs(Number(h) - Number(lastBoundary)) <= EPS;
                                const tf = invoice?.guardianFinancial?.transferFee || {};
                                const feeAmount = Number(tf.amount || 0);
                                const feeWaived = tf.waived === true;
                                if (isFinal && feeAmount > 0 && !feeWaived) {
                                  a = Math.round((a + feeAmount) * 100) / 100;
                                }
                              } catch (_) {}
                              setActiveField('hours');
                              setForm((prev) => ({ ...prev, hoursPaid: h.toFixed(2), amount: a.toFixed(2) }));
                            }}
                            className="text-emerald-700 underline"
                          >
                            {(() => {
                              const h = boundaryHint.nextHours;
                              let displayAmt = Number(boundaryHint.nextAmount || 0);
                              try {
                                const lastBoundary = (boundaries.hours || [])[boundaries.hours.length - 1];
                                const EPS = 0.005;
                                const isFinal = Math.abs(Number(h) - Number(lastBoundary)) <= EPS;
                                const tf = invoice?.guardianFinancial?.transferFee || {};
                                const feeAmount = Number(tf.amount || 0);
                                const feeWaived = tf.waived === true;
                                if (isFinal && feeAmount > 0 && !feeWaived) {
                                  displayAmt = Math.round((displayAmt + feeAmount) * 100) / 100;
                                }
                              } catch (_) {}
                              return (
                                <>Use {boundaryHint.nextHours?.toFixed?.(2)}h (${displayAmt.toFixed(2)})</>
                              );
                            })()}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* PayPal invoice & total paid moved into this card for clarity */}
                <div className="mt-3 text-sm text-slate-700">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-slate-500">PayPal invoice #</div>
                    <div>
                      {!editingPaypal ? (
                        <button type="button" onClick={() => setEditingPaypal(true)} className="text-sm text-slate-700 underline">
                          {form.paypalInvoiceNumber || (invoice?.paypalInvoiceNumber || '—')}
                        </button>
                      ) : (
                        <input
                          type="text"
                          name="paypalInvoiceNumber"
                          value={form.paypalInvoiceNumber}
                          onChange={handleChange}
                          onBlur={() => setEditingPaypal(false)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-800"
                        />
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-xs uppercase text-slate-400">Total paid so far</div>
                    <div className="text-sm font-semibold text-slate-700">${Number(invoice?.paidAmount || 0).toFixed(2)}</div>
                  </div>
                </div>
              </div>


              {/* Compact single-row inputs: Amount, Hours, Tip */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1 text-sm text-slate-600">
                  <span className="flex items-center gap-2 font-medium text-slate-800">
                    <DollarSign className="h-4 w-4 text-slate-400" />
                    <span className="truncate">Amount received</span>
                  </span>
                  <input
                    type="number"
                    name="amount"
                    step="0.01"
                    min="0"
                    value={form.amount}
                    onChange={handleChange}
                    onFocus={() => setActiveField('amount')}
                    className="rounded-md border border-slate-200 px-2 py-2 text-slate-800 text-right focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-100"
                    required
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm text-slate-600">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">Hours paid</span>
                    {savingCoverage && (
                      <span className="text-xs text-blue-600 animate-pulse">
                        Saving...
                      </span>
                    )}
                    {coverageSaved && !savingCoverage && (
                      <span className="text-xs text-emerald-600 font-medium">
                        ✓ Saved
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    name="hoursPaid"
                    step="0.01"
                    min="0"
                    max="999"
                    value={form.hoursPaid}
                    onChange={handleChange}
                    onFocus={() => setActiveField('hours')}
                    readOnly={activeField === 'amount'}
                    className={`rounded-md border px-2 py-2 text-slate-800 text-right focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-100 ${activeField === 'amount' ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200'}`}
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm text-slate-600">
                  <span className="font-medium text-slate-800">Tip (optional)</span>
                  <input
                    type="number"
                    name="tip"
                    step="0.01"
                    min="0"
                    max="999"
                    value={form.tip}
                    onChange={handleChange}
                    className="rounded-md border border-slate-200 px-2 py-2 text-slate-800 text-right focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-100"
                  />
                </label>
              </div>

              

              
            {/* Payment method + reference on a single row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-2 text-sm text-slate-600">
                <span className="flex items-center gap-2 font-medium text-slate-800">
                  <CreditCard className="h-4 w-4 text-slate-400" />
                  Payment method
                </span>
                <select
                  name="paymentMethod"
                  value={form.paymentMethod}
                  onChange={handleChange}
                  className="rounded-md border border-slate-200 px-3 py-2 text-slate-800 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-100"
                  required
                >
                  <option value="paypal">PayPal</option>
                  <option value="wise_transfer">Wise Transfer</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="credit_card">Credit Card</option>
                  <option value="cash">Cash</option>
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-slate-600">
                <span className="flex items-center gap-2 font-medium text-slate-800">
                  <ClipboardSignature className="h-4 w-4 text-slate-400" />
                  Reference
                </span>
                <input
                  type="text"
                  name="transactionId"
                  value={form.transactionId}
                  onChange={handleChange}
                  className="rounded-md border border-slate-200 px-3 py-2 text-slate-800 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-100"
                  placeholder="e.g. TRANS-12345"
                />
              </label>
            </div>

              <div className="lg:col-span-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center justify-center rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white shadow transition hover:bg-emerald-500 disabled:opacity-60"
                >
                  {saving ? 'Recording…' : 'Record payment'}
                </button>
              </div>
              
            </div>
          </form>

          {/* Right column: compact invoice summary */}
          <div className="space-y-5 col-span-1 border-l border-slate-300 pl-4" style={{ overflow: 'hidden', position: 'relative' }}>
            {/* Invoice summary */}
            <div className="rounded-lg bg-white p-3 text-sm text-slate-700 shadow-sm sticky" style={{ top: '1rem' }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase text-slate-400">Invoice</div>
                    <div className="font-semibold">{invoice?.invoiceName || invoice?.invoiceNumber}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase text-slate-400">Total</div>
                    <div className="font-semibold">${savedTotal.toFixed(2)}</div>
                </div>
              </div>

              {/* Summary rows */}
              <div className="mt-3 space-y-2 text-sm border-t border-slate-100 pt-3">
                <div className="flex justify-between text-slate-600">
                  <span>Hours</span>
                  <span className="font-medium text-slate-800">{typeof savedHours === 'number' ? savedHours.toFixed(2) : '—'}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Paid</span>
                  <span className="font-medium text-slate-800">{form.hoursPaid || '0.00'}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Amount</span>
                  <span className="font-medium text-slate-800">${Number(form.amount || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Fees</span>
                  <span className="font-medium text-slate-800">${((typeof invoice?.__computedTransferFee === 'number' && invoice.__computedTransferFee !== null) ? invoice.__computedTransferFee : calcTransferFee(form.tip || 0)).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tip</span>
                  <span className="font-medium text-slate-800">${calcNetTip(form.tip || 0).toFixed(2)}</span>
                </div>
              </div>

              {/* Billing period */}
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-1 text-xs text-slate-500">
                <div className="flex justify-between">
                  <span>Period start</span>
                  <span>{billingWindow.loading ? '…' : (billingWindow.start || '—')}</span>
                </div>
                <div className="flex justify-between">
                  <span>Period end</span>
                  <span>{billingWindow.loading ? '…' : (billingWindow.end || '—')}</span>
                </div>
              </div>

              {/* Teachers with Tip Distribution */}
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs text-slate-500">Teachers</span>
                  <div className="text-right flex-1">
                    {uniqueTeachers.length === 0 ? (
                      <span className="text-xs text-slate-500">—</span>
                    ) : (
                      <div className="space-y-1">
                        {uniqueTeachers.map((teacher, index) => (
                          <div key={index} className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-slate-700">{teacher}</span>
                            {form.tip && Number(form.tip) > 0 && (
                              <span className="text-emerald-600 font-medium whitespace-nowrap">
                                ${perTeacherTip.toFixed(2)}
                              </span>
                            )}
                          </div>
                        ))}
                        {form.tip && Number(form.tip) > 0 && uniqueTeachers.length > 0 && (
                          <div className="pt-1 mt-1 border-t border-slate-100 text-xs text-slate-500">
                            {uniqueTeachers.length} teacher{uniqueTeachers.length !== 1 ? 's' : ''} • ${perTeacherTip.toFixed(2)} each
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ConfirmModal open={confirmOpen} onCancel={() => setConfirmOpen(false)} onConfirm={handleConfirm} />
    </div>
  );
};

export default RecordPaymentModal;
