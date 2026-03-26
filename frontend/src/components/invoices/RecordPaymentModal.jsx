import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../../api/axios';
import { computeInvoiceTotals, resolveInvoiceClassEntries } from '../../utils/invoiceTotals';
import LoadingSpinner from '../ui/LoadingSpinner';
import { X, DollarSign, CreditCard, ClipboardSignature } from 'lucide-react';
import { formatDateDDMMMYYYY } from '../../utils/date';
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';
import { useAuth } from '../../contexts/AuthContext';

const isEditableElement = (element) => {
  if (!element) return false;
  const tag = String(element.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(element.isContentEditable);
};

const RecordPaymentModal = ({ invoice, invoiceId, onClose, onUpdated, onOpenInvoiceOverview }) => {
  const { user } = useAuth();
  const [localInvoice, setLocalInvoice] = useState(invoice || null);
  const [loading, setLoading] = useState(!invoice);
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
  const [isDirty, setIsDirty] = useState(false);
  const [invoiceNameParts, setInvoiceNameParts] = useState({ prefix: 'Waraqa', month: 'Mar', year: '2026', seq: '' });
  const [seqEditing, setSeqEditing] = useState(false);
  const [seqDraft, setSeqDraft] = useState('');
  const [editingPaypal, setEditingPaypal] = useState(false);
  const seqInputRef = useRef(null);
  const paypalInputRef = useRef(null);
  const lastInvoiceIdRef = useRef(null);
  const isDirtyRef = useRef(false);
  const coverageDirtyRef = useRef(false);
  const fetchAbortRef = useRef(null);

  const mergeInvoiceUpdate = React.useCallback((prev, updated) => {
    if (!updated || typeof updated !== 'object') return prev;
    if (!prev) return updated;
    const next = { ...prev, ...updated };
    if (!updated.items && prev.items) next.items = prev.items;
    if (!updated.dynamicClasses && prev.dynamicClasses) next.dynamicClasses = prev.dynamicClasses;
    if (!updated.guardian && prev.guardian) next.guardian = prev.guardian;
    if (!updated.guardianFinancial && prev.guardianFinancial) next.guardianFinancial = prev.guardianFinancial;
    return next;
  }, []);

  const parseInvoiceNameParts = React.useCallback((name) => {
    const raw = String(name || '').trim();
    const chunks = raw.split('-').map((chunk) => chunk.trim()).filter(Boolean);
    if (chunks.length >= 4) {
      return {
        prefix: chunks[0] || 'Waraqa',
        month: chunks[1] || 'Mar',
        year: chunks[2] || String(new Date().getUTCFullYear()),
        seq: chunks.slice(3).join('-')
      };
    }
    return {
      prefix: chunks[0] || 'Waraqa',
      month: chunks[1] || 'Mar',
      year: chunks[2] || String(new Date().getUTCFullYear()),
      seq: ''
    };
  }, []);

  const buildInvoiceNameFromParts = React.useCallback((parts) => {
    const prefix = String(parts?.prefix || 'Waraqa').trim();
    const month = String(parts?.month || '').trim();
    const year = String(parts?.year || '').trim();
    const seq = String(parts?.seq || '').trim();
    return [prefix, month, year, seq].filter(Boolean).join('-') + (seq ? '' : '-');
  }, []);

  const resolvedClassEntries = useMemo(
    () => resolveInvoiceClassEntries(localInvoice || {}),
    [localInvoice]
  );

  // Resolve a consistent hourly rate for conversions (matches backend fallbacks)
  const hourlyRate = useMemo(() => {
    const inv = localInvoice || {};
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
  }, [localInvoice, resolvedClassEntries]);

  const transferFeeAmount = useMemo(() => {
    const tf = localInvoice?.guardianFinancial?.transferFee;
    if (!tf || tf.waived) return 0;
    const amount = Number(tf.amount || 0);
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
  }, [localInvoice]);

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
    if (invoice) {
      setLocalInvoice((prev) => mergeInvoiceUpdate(prev, invoice));
      setLoading(false);
      if (!seqEditing) {
        const parts = parseInvoiceNameParts(invoice?.invoiceName || '');
        setInvoiceNameParts(parts);
        setSeqDraft(parts.seq || '');
      }
    }
  }, [invoice, seqEditing]);

  useEffect(() => {
    if (!invoiceId) return;

    if (fetchAbortRef.current) {
      try {
        fetchAbortRef.current.abort();
      } catch (e) {
        // ignore abort cleanup errors
      }
    }

    const controller = new AbortController();
    fetchAbortRef.current = controller;

    const fetchInvoice = async () => {
      try {
        const cacheKey = makeCacheKey('invoices:detail', user?._id, { id: invoiceId });
        const cached = readCache(cacheKey, { deps: ['invoices'] });
        if (cached.hit && cached.value?.invoice) {
          const cachedInvoice = cached.value.invoice;
          const cachedComputed = computeInvoiceTotals(cachedInvoice);
          setLocalInvoice((prev) => mergeInvoiceUpdate(prev, {
            ...cachedInvoice,
            __computedTotal: cachedComputed.total,
            __computedHours: cachedComputed.hours,
            __computedTransferFee: cachedComputed.transferFee,
          }));
          setLoading(false);
        }

        const { data } = await api.get(`/invoices/${invoiceId}`, { signal: controller.signal });
        const inv = data.invoice || data;
        const computed = computeInvoiceTotals(inv);
        const normalizedInvoice = {
          ...inv,
          __computedTotal: computed.total,
          __computedHours: computed.hours,
          __computedTransferFee: computed.transferFee,
        };
        setLocalInvoice((prev) => mergeInvoiceUpdate(prev, normalizedInvoice));
        if (!seqEditing) {
          const parts = parseInvoiceNameParts(inv?.invoiceName || '');
          setInvoiceNameParts(parts);
          setSeqDraft(parts.seq || '');
        }

        const isNewInvoice = lastInvoiceIdRef.current !== invoiceId;
        if (isNewInvoice) {
          lastInvoiceIdRef.current = invoiceId;
          setIsDirty(false);
          isDirtyRef.current = false;
        }

        const computedTotal = Number(computed?.total || 0);
        const computedPaid = Number(computed?.paid || 0);
        const computedDue = Math.max(0, Math.round((computedTotal - computedPaid) * 100) / 100);
        const initialAmountRaw = computedDue > 0 ? computedDue : computedTotal;
        const initialHoursRaw = Number(computed?.hours || 0);
        const formattedAmount = Number.isFinite(initialAmountRaw) && initialAmountRaw > 0
          ? (Math.round(initialAmountRaw * 100) / 100).toFixed(2)
          : '';
        const formattedHours = Number.isFinite(initialHoursRaw) && initialHoursRaw > 0
          ? (Math.round(initialHoursRaw * 100) / 100).toFixed(2)
          : '';

        if (isNewInvoice || !isDirtyRef.current) {
          coverageDirtyRef.current = false;
          setForm({
            amount: formattedAmount,
            paymentMethod: (inv.guardian && inv.guardian.paymentMethod) || inv.paymentMethod || 'paypal',
            transactionId: inv.invoiceReferenceLink || '',
            hoursPaid: formattedHours,
            tip: inv.tip ? String(inv.tip) : '',
            paypalInvoiceNumber: inv.paypalInvoiceNumber || ''
          });
        }
        setError('');
        writeCache(cacheKey, { invoice: inv }, { ttlMs: 2 * 60_000, deps: ['invoices'] });
      } catch (err) {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        console.error(err);
        setError('Failed to load invoice details');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchInvoice();

    return () => {
      try {
        controller.abort();
      } catch (e) {
        // ignore abort cleanup errors
      }
    };
  }, [invoiceId, mergeInvoiceUpdate, user?._id]);

  useEffect(() => {
    if (!seqEditing || !seqInputRef.current) return;
    const target = seqInputRef.current;
    target.focus();
    target.select();
    setTimeout(() => {
      try {
        target.focus();
        target.select();
      } catch (_) {}
    }, 0);
  }, [seqEditing]);

  useEffect(() => {
    if (!editingPaypal || !paypalInputRef.current) return;
    const target = paypalInputRef.current;
    target.focus();
    target.select();
    setTimeout(() => {
      try {
        target.focus();
        target.select();
      } catch (_) {}
    }, 0);
  }, [editingPaypal]);

  const handleSaveSeq = async (nextSeqValue) => {
    const targetInvoiceId = localInvoice?._id || invoiceId;
    if (!targetInvoiceId) return;
    const prevName = localInvoice?.invoiceName || '';
    const nextSeq = typeof nextSeqValue === 'string' ? nextSeqValue : seqDraft;
    const nextParts = {
      ...invoiceNameParts,
      seq: nextSeq
    };
    const nextName = buildInvoiceNameFromParts(nextParts);
    setInvoiceNameParts(parseInvoiceNameParts(nextName));
    setSeqDraft(nextSeq);
    setLocalInvoice((prev) => mergeInvoiceUpdate(prev, { invoiceName: nextName }));
    try {
      const { data } = await api.put(`/invoices/${targetInvoiceId}`, { invoiceName: nextName });
      const updated = data?.invoice || data;
        if (updated) {
        setLocalInvoice((prev) => mergeInvoiceUpdate(prev, updated));
        setInvoiceNameParts(parseInvoiceNameParts(updated?.invoiceName || nextName));
        setSeqDraft(parseInvoiceNameParts(updated?.invoiceName || nextName).seq || '');
        const cacheKey = makeCacheKey('invoices:detail', user?._id, { id: targetInvoiceId });
        writeCache(cacheKey, { invoice: updated }, { ttlMs: 2 * 60_000, deps: ['invoices'] });
      }
    } catch (err) {
      console.error('Invoice name update failed:', err);
      setInvoiceNameParts(parseInvoiceNameParts(prevName));
      setSeqDraft(parseInvoiceNameParts(prevName).seq || '');
      setLocalInvoice((prev) => mergeInvoiceUpdate(prev, { invoiceName: prevName }));
    }
  };

  // Compute the same billing window used in the view modal and invoices page
  const [billingWindow, setBillingWindow] = useState({ start: null, end: null, loading: true });
  // Class-boundary guidance for payments (derived strictly from resolved class entries)
  const [boundaries, setBoundaries] = useState({ hours: [], dates: [] });
  const [boundaryHint, setBoundaryHint] = useState(null);
  useEffect(() => {
    if (!localInvoice) return;
    // Prefer resolved class entries (dynamic-aware) to compute boundaries
    const items = (resolvedClassEntries.items || []).slice().filter(Boolean);
    const normalized = items
      .map(it => ({
        rawDate: (it.date ? new Date(it.date) : (it.scheduledDate ? new Date(it.scheduledDate) : null)),
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
    // Billing window from filtered items (respects coverage end date)
    const hasItems = filteredNormalized.length > 0;
    const start = hasItems ? new Date(Math.min(...filteredNormalized.map(e => e.rawDate.getTime()))) : (localInvoice.billingPeriod?.startDate ? new Date(localInvoice.billingPeriod.startDate) : null);
    const end = hasItems ? new Date(Math.max(...filteredNormalized.map(e => e.rawDate.getTime()))) : (localInvoice.billingPeriod?.endDate ? new Date(localInvoice.billingPeriod.endDate) : null);
    setBillingWindow({
      start: start ? formatDateDDMMMYYYY(start) : null,
      end: end ? formatDateDDMMMYYYY(end) : null,
      loading: false,
    });
  }, [localInvoice, resolvedClassEntries]);

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

  const computeEndDateFromHours = React.useCallback((hoursValue) => {
    const hrs = Number(hoursValue);
    if (!Number.isFinite(hrs) || hrs <= 0) return '';
    if (!Array.isArray(boundaries.hours) || boundaries.hours.length === 0) return '';
    const EPS = 0.005;
    let idx = boundaries.hours.findIndex((h) => h >= hrs - EPS);
    if (idx === -1) idx = boundaries.hours.length - 1;
    const date = boundaries.dates[idx];
    if (!date) return '';
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
  }, [boundaries]);

  const effectiveInvoiceStatus = useMemo(
    () => String(localInvoice?.status || invoice?.status || '').toLowerCase(),
    [localInvoice?.status, invoice?.status]
  );

  const handlePersistPaypalNumber = React.useCallback(async () => {
    const targetInvoiceId = localInvoice?._id || invoiceId;
    if (!targetInvoiceId) return;

    const normalized = String(form.paypalInvoiceNumber || '').trim();
    const existing = String(localInvoice?.paypalInvoiceNumber || '').trim();
    if (normalized === existing) return;

    try {
      const { data } = await api.put(`/invoices/${targetInvoiceId}`, {
        paypalInvoiceNumber: normalized || null
      });
      const updated = data?.invoice || data;
      if (updated && typeof updated === 'object') {
        setLocalInvoice((prev) => mergeInvoiceUpdate(prev, updated));
        setForm((prev) => ({
          ...prev,
          paypalInvoiceNumber: String(updated.paypalInvoiceNumber || normalized || '')
        }));
      }
    } catch (err) {
      console.error('Failed to persist PayPal invoice number', err);
    }
  }, [localInvoice?._id, localInvoice?.paypalInvoiceNumber, invoiceId, form.paypalInvoiceNumber, mergeInvoiceUpdate]);

  useEffect(() => {
    if (loading) return;
    if (['paid', 'refunded'].includes(effectiveInvoiceStatus)) return;
    if (!invoiceId) return;
    if (!coverageDirtyRef.current) return;
    const hrs = Number(form.hoursPaid);
    if (!Number.isFinite(hrs) || hrs <= 0) return;

    const nextEndDate = computeEndDateFromHours(hrs);
    const payload = {
      strategy: 'cap_hours',
      maxHours: Math.round(hrs * 1000) / 1000,
      endDate: nextEndDate || null
    };

    const timer = setTimeout(async () => {
      try {
        const { data } = await api.put(`/invoices/${invoiceId}/coverage`, payload);
        const updated = data?.invoice || data;
        if (updated && typeof updated === 'object') {
          setLocalInvoice((prev) => mergeInvoiceUpdate(prev, updated));
        }
        coverageDirtyRef.current = false;
      } catch (err) {
        const statusCode = Number(err?.response?.status || 0);
        const message = String(err?.response?.data?.message || '').toLowerCase();
        if (statusCode === 400 && message.includes('coverage settings are locked')) {
          return;
        }
        console.error('Failed to sync invoice coverage from payment modal', err);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [form.hoursPaid, invoiceId, hourlyRate, computeEndDateFromHours, mergeInvoiceUpdate, effectiveInvoiceStatus, loading]);

  const handleChange = e => {
    const { name, value } = e.target;
    if (name === 'amount') {
      setIsDirty(true);
      isDirtyRef.current = true;
      coverageDirtyRef.current = true;
      setActiveField('amount');
      const hours = computeHoursFromAmount(value);
        setForm(prev => ({
          ...prev,
          amount: value,
          hoursPaid: hours === null ? '' : hours.toFixed(2)
        }));
      return;
    }
    if (name === 'hoursPaid') {
      setIsDirty(true);
      isDirtyRef.current = true;
      coverageDirtyRef.current = true;
      setActiveField('hours');
      const amount = computeAmountFromHours(value);
        setForm(prev => ({
          ...prev,
          hoursPaid: value,
          amount: amount === null ? '' : amount.toFixed(2)
        }));
      return;
    }
    setIsDirty(true);
    isDirtyRef.current = true;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const calcTransferFee = (tipValue) => {
    const numeric = Number(tipValue) || 0;
    return Math.round(numeric * 0.05 * 100) / 100;
  };
  const calcNetTip = (tipValue) => {
    const numeric = Number(tipValue) || 0;
    return Math.round((numeric - calcTransferFee(numeric)) * 100) / 100;
  };
  const teacherRecipients = useMemo(() => {
    const map = {};
    (resolvedClassEntries.items || []).forEach((item) => {
      if (!item || item.excludeFromTeacherPayment) return;

      const teacherObj = item.teacher && typeof item.teacher === 'object' ? item.teacher : null;
      const teacherIdRaw = teacherObj?._id || item.teacher || null;
      const teacherId = teacherIdRaw ? String(teacherIdRaw) : null;

      const snapshotFirst = (item?.teacherSnapshot?.firstName || teacherObj?.firstName || item?.teacherFirstName || '').toString().trim();
      const snapshotLast = (item?.teacherSnapshot?.lastName || teacherObj?.lastName || item?.teacherLastName || '').toString().trim();
      const fallbackName = item?.teacherName || teacherObj?.name || null;
      const teacherName = [snapshotFirst, snapshotLast].filter(Boolean).join(' ').trim() || fallbackName || 'Unknown teacher';

      const key = teacherId || `${snapshotFirst}:${snapshotLast}`;
      if (!key) return;

      if (!map[key]) {
        map[key] = {
          key,
          teacherId,
          name: teacherName
        };
      }
    });
    return Object.values(map);
  }, [resolvedClassEntries]);

  const teachersCount = teacherRecipients.length;
  const netTipAmount = calcNetTip(form.tip || 0);

  const buildDefaultBonusDraft = (netTipValue, recipients) => {
    const safeRecipients = Array.isArray(recipients) ? recipients : [];
    const count = safeRecipients.length;
    if (count === 0 || netTipValue <= 0) return {};

    const base = Math.floor((netTipValue / count) * 100) / 100;
    const baseTotal = Math.round(base * 100) / 100 * count;
    const remainder = Math.round((netTipValue - baseTotal) * 100) / 100;

    const next = {};
    safeRecipients.forEach((recipient, idx) => {
      const amount = idx === count - 1
        ? Math.round((base + remainder) * 100) / 100
        : Math.round(base * 100) / 100;
      next[recipient.key] = {
        include: true,
        amount
      };
    });
    return next;
  };

  const [bonusOverridesEnabled, setBonusOverridesEnabled] = useState(false);
  const [teacherBonusDraft, setTeacherBonusDraft] = useState({});

  useEffect(() => {
    if (bonusOverridesEnabled) return;
    setTeacherBonusDraft(buildDefaultBonusDraft(netTipAmount, teacherRecipients));
  }, [bonusOverridesEnabled, netTipAmount, teacherRecipients]);

  useEffect(() => {
    if (typeof onOpenInvoiceOverview !== 'function') return;

    const handleShortcut = (event) => {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (String(event.key || '').toLowerCase() !== 'v') return;
      if (isEditableElement(document.activeElement)) return;

      event.preventDefault();
      onOpenInvoiceOverview(localInvoice || invoice || invoiceId);
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [onOpenInvoiceOverview, localInvoice, invoice, invoiceId]);

  const effectiveTeacherBonuses = useMemo(() => {
    if (!teacherRecipients.length || netTipAmount <= 0) return [];

    if (!bonusOverridesEnabled) {
      const defaults = buildDefaultBonusDraft(netTipAmount, teacherRecipients);
      return teacherRecipients.map((recipient) => ({
        ...recipient,
        include: true,
        amount: Number(defaults?.[recipient.key]?.amount || 0)
      }));
    }

    return teacherRecipients.map((recipient) => {
      const draft = teacherBonusDraft?.[recipient.key] || {};
      const include = draft.include !== false;
      const amount = Math.max(0, Math.round((Number(draft.amount || 0) || 0) * 100) / 100);
      return {
        ...recipient,
        include,
        amount
      };
    });
  }, [bonusOverridesEnabled, teacherBonusDraft, teacherRecipients, netTipAmount]);

  const totalAllocatedBonus = useMemo(() => {
    return Math.round(
      effectiveTeacherBonuses.reduce((sum, entry) => sum + (entry.include ? Number(entry.amount || 0) : 0), 0) * 100
    ) / 100;
  }, [effectiveTeacherBonuses]);

  const unallocatedBonus = Math.round((Math.max(0, netTipAmount - totalAllocatedBonus)) * 100) / 100;
  const perTeacherTip = teachersCount > 0 ? Math.round((netTipAmount / teachersCount) * 100) / 100 : 0;

  const handleSubmit = e => {
    e.preventDefault();
    // Open confirmation modal; actual submission is performed in handleConfirm
    setConfirmOpen(true);
  };

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
      if (bonusOverridesEnabled && totalAllocatedBonus > netTipAmount + 0.01) {
        throw new Error(`Teacher bonus allocation exceeds net tip (${netTipAmount.toFixed(2)}).`);
      }

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

      // Coverage caps are applied by the payment endpoint when paidHours is provided.

      const payload = {
        amount: normalizedAmount,
        paymentMethod: form.paymentMethod,
        transactionId: form.transactionId || undefined,
        tip: form.tip ? Number(form.tip) : undefined,
        // ✅ Always send paidHours - this is the actual payment amount, not an estimate
        paidHours: normalizedHours,
        paypalInvoiceNumber: String(form.paypalInvoiceNumber || localInvoice?.paypalInvoiceNumber || '').trim() || undefined,
        teacherBonusAllocations: bonusOverridesEnabled
          ? effectiveTeacherBonuses
              .filter((entry) => entry.include && Number(entry.amount || 0) > 0)
              .map((entry) => ({
                teacherId: entry.teacherId || undefined,
                teacherKey: entry.key,
                teacherName: entry.name,
                amountUSD: Math.round(Number(entry.amount || 0) * 100) / 100
              }))
          : undefined
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
  const savedTotal = Number(localInvoice?.total ?? localInvoice?.amount ?? localInvoice?.__computedTotal ?? 0) || 0;
  const savedHours = Number.isFinite(Number(localInvoice?.__computedHours))
    ? Number(localInvoice.__computedHours)
    : ((typeof localInvoice?.hoursCovered === 'number') ? localInvoice.hoursCovered : (localInvoice?.paidHours ?? localInvoice?.hoursPaid ?? null));
  const showSeqInput = seqEditing || !invoiceNameParts.seq;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-8 backdrop-blur-sm">
  <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-lg">
        <button
          type="button"
          onClick={() => onOpenInvoiceOverview?.(localInvoice || invoice || invoiceId)}
          className="absolute right-16 top-6 inline-flex items-center justify-center rounded-full border border-slate-200 bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 shadow hover:border-slate-300 hover:text-slate-800"
          title="Open invoice overview (Alt+Shift+V)"
        >
          Invoice overview
        </button>
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
              <div className="mt-1 flex items-center gap-2">
                <h2 className="text-xl font-semibold leading-tight">
                  {`${invoiceNameParts.prefix || 'Waraqa'}-${invoiceNameParts.month || ''}-${invoiceNameParts.year || ''}-`}
                </h2>
                {showSeqInput ? (
                  <input
                    ref={seqInputRef}
                    value={seqDraft}
                    onChange={(e) => setSeqDraft(e.target.value)}
                    autoFocus={showSeqInput}
                    onFocus={(e) => e.target.select()}
                    onClick={(e) => e.currentTarget.select()}
                    onBlur={() => {
                      setSeqEditing(false);
                      handleSaveSeq(seqInputRef.current?.value ?? seqDraft);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        setSeqEditing(false);
                        handleSaveSeq(e.currentTarget.value);
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        const parts = parseInvoiceNameParts(localInvoice?.invoiceName || '');
                        setInvoiceNameParts(parts);
                        setSeqDraft(parts.seq || '');
                        setSeqEditing(false);
                      }
                    }}
                    className="w-20 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-lg font-semibold text-emerald-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSeqDraft(invoiceNameParts.seq || '');
                      setSeqEditing(true);
                    }}
                    className="rounded-md px-1 text-lg font-semibold text-emerald-900 hover:text-emerald-700"
                    title="Click to edit invoice number"
                  >
                    {invoiceNameParts.seq || ''}
                  </button>
                )}
              </div>

              {/* Compact guardian info: role • name • email (single compact row, truncated) */}
              <div className="mt-1 flex items-center gap-3 text-sm text-white/90 truncate">
                <span className="text-xs text-white/80 truncate">{localInvoice?.guardian?.role || localInvoice?.guardian?.relationship || 'Guardian'}</span>
                <span className="text-xs text-white/90 truncate">• {localInvoice?.guardian?.firstName} {localInvoice?.guardian?.lastName}</span>
                <span className="text-xs text-white/90 truncate">• {localInvoice?.guardian?.email || '—'}</span>
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
            maxHeight: 'calc(90vh - 120px)',
            overflow: 'auto',
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
          <form onSubmit={handleSubmit} className="col-span-1">
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
                                const tf = localInvoice?.guardianFinancial?.transferFee || {};
                                const feeAmount = Number(tf.amount || 0);
                                const feeWaived = tf.waived === true;
                                if (isFinal && feeAmount > 0 && !feeWaived) {
                                  a = Math.round((a + feeAmount) * 100) / 100;
                                }
                              } catch (_) {}
                              setActiveField('hours');
                              coverageDirtyRef.current = true;
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
                                const tf = localInvoice?.guardianFinancial?.transferFee || {};
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
                          {form.paypalInvoiceNumber || (localInvoice?.paypalInvoiceNumber || '—')}
                        </button>
                      ) : (
                        <input
                          ref={paypalInputRef}
                          type="text"
                          name="paypalInvoiceNumber"
                          value={form.paypalInvoiceNumber}
                          onChange={handleChange}
                          onFocus={(e) => e.target.select()}
                          onClick={(e) => e.currentTarget.select()}
                          onBlur={async () => {
                            setEditingPaypal(false);
                            await handlePersistPaypalNumber();
                          }}
                          className="rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-800"
                        />
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-xs uppercase text-slate-400">Total paid so far</div>
                    <div className="text-sm font-semibold text-slate-700">${Number(localInvoice?.paidAmount || 0).toFixed(2)}</div>
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-2 text-sm text-slate-600 sm:col-span-1">
                <span className="flex items-center gap-2 font-medium text-slate-800">
                  <CreditCard className="h-4 w-4 text-slate-400" />
                  Via
                </span>
                <select
                  name="paymentMethod"
                  value={form.paymentMethod}
                  onChange={handleChange}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-slate-800 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-100"
                  required
                >
                  <option value="paypal">PayPal</option>
                  <option value="wise_transfer">Wise Transfer</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="credit_card">Credit Card</option>
                  <option value="cash">Cash</option>
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-slate-600 sm:col-span-2">
                <span className="flex items-center gap-2 font-medium text-slate-800">
                  <ClipboardSignature className="h-4 w-4 text-slate-400" />
                  Reference
                </span>
                <input
                  type="text"
                  name="transactionId"
                  value={form.transactionId}
                  onChange={handleChange}
                  autoComplete="off"
                  className="rounded-md border border-slate-200 px-3 py-2 text-slate-800 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-100"
                  placeholder="Paste PayPal invoice link or transaction reference"
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
                    <div className="font-semibold">{localInvoice?.invoiceName || localInvoice?.invoiceNumber}</div>
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
                  <span className="font-medium text-slate-800">${calcTransferFee(form.tip || 0).toFixed(2)}</span>
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
                    {teacherRecipients.length === 0 ? (
                      <span className="text-xs text-slate-500">—</span>
                    ) : (
                      <div className="space-y-1.5">
                        {teacherRecipients.map((teacher) => {
                          const current = effectiveTeacherBonuses.find((entry) => entry.key === teacher.key) || {
                            include: true,
                            amount: 0
                          };

                          return (
                            <div key={teacher.key} className="flex items-center justify-between gap-2 text-xs">
                              <span className="text-slate-700 truncate">{teacher.name}</span>

                              {form.tip && Number(form.tip) > 0 ? (
                                bonusOverridesEnabled ? (
                                  <div className="inline-flex items-center gap-2">
                                    <label className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                                      <input
                                        type="checkbox"
                                        checked={current.include !== false}
                                        onChange={(e) => {
                                          const checked = e.target.checked;
                                          setTeacherBonusDraft((prev) => ({
                                            ...prev,
                                            [teacher.key]: {
                                              include: checked,
                                              amount: Number(prev?.[teacher.key]?.amount ?? current.amount ?? 0)
                                            }
                                          }));
                                        }}
                                      />
                                      Add
                                    </label>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      disabled={current.include === false}
                                      value={Number(current.amount || 0).toFixed(2)}
                                      onChange={(e) => {
                                        const nextAmount = Math.max(0, Number(e.target.value || 0));
                                        setTeacherBonusDraft((prev) => ({
                                          ...prev,
                                          [teacher.key]: {
                                            include: prev?.[teacher.key]?.include !== false,
                                            amount: Math.round(nextAmount * 100) / 100
                                          }
                                        }));
                                      }}
                                      className="w-20 rounded border border-slate-200 px-1.5 py-0.5 text-right text-[11px] text-slate-700"
                                    />
                                  </div>
                                ) : (
                                  <span className="text-emerald-600 font-medium whitespace-nowrap">
                                    ${perTeacherTip.toFixed(2)}
                                  </span>
                                )
                              ) : (
                                <span className="text-slate-400">$0.00</span>
                              )}
                            </div>
                          );
                        })}

                        {form.tip && Number(form.tip) > 0 && teacherRecipients.length > 0 && (
                          <>
                            <div className="pt-1 mt-1 border-t border-slate-100 text-[11px] text-slate-500">
                              {bonusOverridesEnabled
                                ? `${teacherRecipients.length} teacher${teacherRecipients.length !== 1 ? 's' : ''} • allocated $${totalAllocatedBonus.toFixed(2)}${unallocatedBonus > 0 ? ` • unallocated $${unallocatedBonus.toFixed(2)}` : ''}`
                                : `${teacherRecipients.length} teacher${teacherRecipients.length !== 1 ? 's' : ''} • $${perTeacherTip.toFixed(2)} each`}
                            </div>

                            <label className="mt-1 inline-flex items-center justify-end gap-1 text-[11px] text-slate-500">
                              <input
                                type="checkbox"
                                checked={bonusOverridesEnabled}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setBonusOverridesEnabled(checked);
                                  if (checked) {
                                    setTeacherBonusDraft(buildDefaultBonusDraft(netTipAmount, teacherRecipients));
                                  }
                                }}
                              />
                              Customize bonus split
                            </label>
                          </>
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
