// Frontend helper to compute canonical invoice totals and hours based on
// live class coverage rules (matches InvoiceViewModal logic).

const REFILL_LINE_REGEX = /refill|top\s?-?up|auto\s?top\s?-?up/i;

export const roundCurrency = (value) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
};

const toFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const resolveDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const resolveGuardianRate = (invoice = {}) => {
  const candidates = [
    invoice?.guardian?.guardianInfo?.hourlyRate,
    invoice?.guardianFinancial?.hourlyRate,
    invoice?.guardianRate
  ]
    .map((val) => Number(val))
    .filter((val) => Number.isFinite(val) && val > 0);

  if (candidates.length > 0) {
    return candidates[0];
  }

  const rawItems = Array.isArray(invoice?.items) ? invoice.items : [];
  const itemWithRate = rawItems.find((it) => Number(it?.rate || 0) > 0);
  if (itemWithRate) {
    const rate = Number(itemWithRate.rate);
    if (Number.isFinite(rate) && rate > 0) {
      return rate;
    }
  }

  const totalMinutes = rawItems.reduce((sum, item) => sum + (Number(item?.duration || 0) || 0), 0);
  const totalAmount = rawItems.reduce((sum, item) => sum + (Number(item?.amount || 0) || 0), 0);
  const hours = totalMinutes / 60;
  if (hours > 0 && totalAmount > 0) {
    return Math.round((totalAmount / hours) * 100) / 100;
  }

  return 0;
};

const computeTransferFeeAmount = (transferFeeDetails = {}, subtotal = null) => {
  if (!transferFeeDetails) return 0;

  const normalizedMode = typeof transferFeeDetails.mode === 'string'
    ? transferFeeDetails.mode.trim().toLowerCase()
    : null;

  if (normalizedMode === 'percent') {
    if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
    const percent = Number(transferFeeDetails.value ?? transferFeeDetails.amount ?? 0);
    if (!Number.isFinite(percent) || percent <= 0) return 0;
    return roundCurrency((subtotal * percent) / 100);
  }

  const amount = Number(transferFeeDetails.amount ?? 0);
  const fallback = Number(transferFeeDetails.value ?? 0);
  const resolved = Number.isFinite(amount) && amount > 0
    ? amount
    : (Number.isFinite(fallback) && fallback > 0 ? fallback : 0);
  return roundCurrency(resolved);
};

const buildClassEntriesFromItems = (sourceItems = [], coverage = {}) => {
  const rawItems = Array.isArray(sourceItems) ? sourceItems.filter(Boolean) : [];
  if (!rawItems.length) {
    return { items: [], totalMinutes: 0, totalHours: 0 };
  }

  const maxHours = toFiniteNumber(coverage.maxHours);
  const hasCap = Number.isFinite(maxHours) && maxHours > 0;
  const capMinutes = hasCap ? Math.round(maxHours * 60) : null;

  let endBoundaryTimestamp = null;
  if (!hasCap && coverage.endDate) {
    const boundary = resolveDate(coverage.endDate);
    if (boundary) {
      boundary.setHours(23, 59, 59, 999);
      endBoundaryTimestamp = boundary.getTime();
    }
  }

  const normalized = rawItems
    .filter((item) => {
      if (!item) return false;
      if (item.class || item.lessonId || item.classId) return true;
      const desc = String(item.description || '').toLowerCase();
      return !REFILL_LINE_REGEX.test(desc);
    })
    .map((item) => {
      const dateCandidate = resolveDate(
        item.date ||
        item.scheduledDate ||
        item.class?.scheduledDate ||
        item.class?.dateTime
      );
      const durationMinutes = toFiniteNumber(item.duration)
        ?? toFiniteNumber(item.minutes)
        ?? 0;
      return {
        original: item,
        timestamp: dateCandidate ? dateCandidate.getTime() : null,
        rawDate: dateCandidate,
        durationMinutes: Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 0
      };
    })
    .sort((a, b) => {
      if (a.timestamp === null && b.timestamp === null) return 0;
      if (a.timestamp === null) return 1;
      if (b.timestamp === null) return -1;
      return a.timestamp - b.timestamp;
    });

  let filtered = [];
  let accumulatedMinutes = 0;
  for (const entry of normalized) {
    if (endBoundaryTimestamp !== null && entry.timestamp !== null && entry.timestamp > endBoundaryTimestamp) {
      continue;
    }

    if (capMinutes !== null) {
      if (accumulatedMinutes + entry.durationMinutes > capMinutes) {
        break;
      }
      accumulatedMinutes += entry.durationMinutes;
      filtered.push(entry);
    } else {
      filtered.push(entry);
    }
  }

  if (filtered.length === 0 && normalized.length > 0 && capMinutes !== null) {
    // No entries survived the cap loop (likely because first entry exceeds cap)
    // In that case just respect the first entry if it matches the boundary.
    const first = normalized[0];
    filtered = first ? [first] : [];
    accumulatedMinutes = first ? first.durationMinutes : 0;
  }

  const totalMinutes = filtered.reduce((sum, entry) => sum + (entry.durationMinutes || 0), 0);
  const totalHours = totalMinutes / 60;

  return {
    items: filtered.map((entry) => entry.original),
    totalMinutes,
    totalHours
  };
};

const buildStaticClassEntries = (invoice = {}) => {
  return buildClassEntriesFromItems(invoice.items, invoice.coverage || {});
};

export const resolveInvoiceClassEntries = (invoice = {}) => {
  if (!invoice) {
    return { items: [], totalMinutes: 0, totalHours: 0 };
  }

  const dynamicPayload = invoice.dynamicClasses;
  if (dynamicPayload && Array.isArray(dynamicPayload.items) && dynamicPayload.items.length) {
    const filteredDynamic = buildClassEntriesFromItems(dynamicPayload.items, invoice.coverage || {});
    if (filteredDynamic.items.length > 0) {
      return filteredDynamic;
    }

    const fallbackMinutes = toFiniteNumber(dynamicPayload.totalMinutes);
    const fallbackHours = toFiniteNumber(dynamicPayload.totalHours);
    return {
      items: dynamicPayload.items.filter(Boolean),
      totalMinutes: Number.isFinite(fallbackMinutes) ? fallbackMinutes : null,
      totalHours: Number.isFinite(fallbackHours) ? fallbackHours : null
    };
  }

  return buildStaticClassEntries(invoice);
};

export function computeInvoiceTotals(invoice = {}) {
  const inv = invoice || {};
  const coverage = inv.coverage || {};
  const { items: classItems, totalMinutes, totalHours } = resolveInvoiceClassEntries(inv);

  const guardianRate = resolveGuardianRate(inv);

  let derivedSubtotal = null;
  if (classItems.length) {
    const subtotalAmount = classItems.reduce((sum, item) => {
      const amount = Number(item?.amount);
      if (Number.isFinite(amount) && amount >= 0) {
        return sum + amount;
      }
      const duration = Number(item?.duration || item?.minutes || 0) || 0;
      const hours = duration / 60;
      if (guardianRate > 0 && hours > 0) {
        return sum + (guardianRate * hours);
      }
      return sum;
    }, 0);
    derivedSubtotal = roundCurrency(subtotalAmount);
  }

  const rawSubtotalField = Number(inv.subtotal);
  const storedSubtotal = Number.isFinite(rawSubtotalField) ? roundCurrency(rawSubtotalField) : null;
  const subtotal = Number.isFinite(derivedSubtotal) && derivedSubtotal >= 0
    ? derivedSubtotal
    : (Number.isFinite(storedSubtotal) && storedSubtotal >= 0 ? storedSubtotal : null);

  const discountAmount = roundCurrency(Math.max(0, Number(inv.discount) || 0));
  const lateFeeAmount = roundCurrency(Math.max(0, Number(inv.lateFee) || 0));
  const tipAmount = roundCurrency(Math.max(0, Number(inv.tip) || 0));

  const transferFeeSource = inv?.guardianFinancial?.transferFee
    || inv?.guardian?.guardianInfo?.transferFee
    || {};
  const transferFeeAmount = computeTransferFeeAmount(transferFeeSource, subtotal);
  const transferFeeWaived = Boolean(coverage.waiveTransferFee || transferFeeSource.waived);
  const effectiveTransferFee = transferFeeWaived ? 0 : transferFeeAmount;

  const computedTotal = Number.isFinite(subtotal)
    ? roundCurrency(Math.max(0, subtotal - discountAmount + lateFeeAmount + tipAmount + effectiveTransferFee))
    : null;

  const fallbackTotals = [inv.adjustedTotal, inv.total, inv.amount]
    .map((val) => Number(val))
    .filter((val) => Number.isFinite(val) && val >= 0);
  const fallbackTotal = fallbackTotals.length ? roundCurrency(fallbackTotals[0]) : 0;
  const total = Number.isFinite(computedTotal) ? computedTotal : fallbackTotal;

  const paid = roundCurrency(Number(inv.paidAmount));
  const remaining = Number.isFinite(Number(inv.remainingBalance))
    ? roundCurrency(Number(inv.remainingBalance))
    : roundCurrency(Math.max(0, total - paid));

  let derivedHours = Number.isFinite(totalHours) ? totalHours : null;
  if (!Number.isFinite(derivedHours) && classItems.length) {
    const minutes = Number.isFinite(totalMinutes)
      ? totalMinutes
      : classItems.reduce((sum, item) => sum + (Number(item?.duration || item?.minutes || 0) || 0), 0);
    derivedHours = Math.round(((minutes / 60) || 0) * 1000) / 1000;
  }

  const fallbackHours = Number.isFinite(Number(inv.hoursCovered)) ? Number(inv.hoursCovered) : null;
  const hours = Number.isFinite(derivedHours)
    ? derivedHours
    : (Number.isFinite(fallbackHours) ? fallbackHours : 0);

  return {
    total,
    paid,
    remaining,
    hours,
    transferFee: effectiveTransferFee,
    subtotal: Number.isFinite(subtotal) ? subtotal : null
  };
}
