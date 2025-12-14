const Setting = require('../models/Setting');

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEFAULT_PREFIX = 'Waraqa';
const DEFAULT_SEQUENCE_START = 1000;

const sequenceKeyForType = (type = 'guardian_invoice') => `invoiceSequence:${type}`;

const safeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const safeDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

async function allocateNextSequence(type = 'guardian_invoice') {
  const key = sequenceKeyForType(type);
  const updated = await Setting.findOneAndUpdate(
    { key },
    { $inc: { value: 1 } },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );

  let sequence = safeNumber(updated?.value, 0);
  if (sequence === 0) {
    sequence = DEFAULT_SEQUENCE_START;
    updated.value = sequence;
    await updated.save();
  }

  return sequence;
}

async function ensureSequenceAtLeast(type = 'guardian_invoice', sequence = 0) {
  if (!Number.isFinite(sequence) || sequence <= 0) return;
  const key = sequenceKeyForType(type);
  const existing = await Setting.findOne({ key });
  if (!existing) {
    await Setting.findOneAndUpdate(
      { key },
      { value: sequence },
      { upsert: true, new: true }
    );
    return;
  }
  const current = safeNumber(existing.value, 0);
  if (sequence > current) {
    existing.value = sequence;
    await existing.save();
  }
}

function formatSequence(sequence) {
  const numeric = safeNumber(sequence, DEFAULT_SEQUENCE_START);
  return numeric.toString().padStart(4, '0');
}

function computeMajorityMonth(items = [], billingPeriod = {}) {
  const monthStats = new Map();

  const record = (date, weight = 1) => {
    const safe = safeDate(date);
    if (!safe) return;
    const year = safe.getUTCFullYear();
    const monthIndex = safe.getUTCMonth();
    const key = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    if (!monthStats.has(key)) {
      monthStats.set(key, { count: 0, minutes: 0, year, monthIndex });
    }
    const entry = monthStats.get(key);
    entry.count += weight;
    entry.minutes += weight;
  };

  items.forEach((item) => {
    record(item?.date, safeNumber(item?.duration, 60));
  });

  if (monthStats.size === 0) {
    if (billingPeriod?.startDate) {
      record(billingPeriod.startDate, 1);
    }
    if (billingPeriod?.endDate) {
      record(billingPeriod.endDate, 1);
    }
  }

  if (monthStats.size === 0) {
    const now = new Date();
    record(now, 1);
  }

  let best = null;
  monthStats.forEach((value) => {
    if (!best) {
      best = value;
      return;
    }
    if (value.count > best.count) {
      best = value;
      return;
    }
    if (value.count === best.count) {
      if (value.minutes > best.minutes) {
        best = value;
        return;
      }
      if (value.minutes === best.minutes) {
        const valueKey = value.year * 12 + value.monthIndex;
        const bestKey = best.year * 12 + best.monthIndex;
        if (valueKey > bestKey) {
          best = value;
        }
      }
    }
  });

  const monthIndex = best?.monthIndex ?? (safeNumber(billingPeriod?.month, new Date().getUTCMonth() + 1) - 1);
  const year = best?.year ?? safeNumber(billingPeriod?.year, new Date().getUTCFullYear());
  const monthShort = MONTH_NAMES_SHORT[monthIndex] || MONTH_NAMES_SHORT[new Date().getUTCMonth()];
  const monthNumeric = String(monthIndex + 1).padStart(2, '0');

  return {
    year,
    monthIndex,
    monthNumeric,
    monthShort,
    label: `${monthShort}`
  };
}

function slugifyInvoiceName(name, sequence) {
  const base = (name || '').toString().trim().toLowerCase();
  const normalized = base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const collapsed = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  const seq = safeNumber(sequence, DEFAULT_SEQUENCE_START);
  if (!collapsed) return `invoice-${seq}`;
  const suffix = seq.toString();
  if (collapsed.endsWith(suffix)) return collapsed;
  return `${collapsed}-${suffix}`;
}

function buildInvoiceIdentifiers({
  type = 'guardian_invoice',
  sequence,
  monthContext,
  manualName = null,
  paypalInvoiceNumber = null,
  prefix = DEFAULT_PREFIX
}) {
  const seqNumeric = safeNumber(sequence, DEFAULT_SEQUENCE_START);
  const seqDisplay = formatSequence(seqNumeric);
  const monthInfo = monthContext || computeMajorityMonth();
  const accountPrefix = type === 'teacher_payment' ? 'PAY' : 'INV';
  const monthNumeric = monthInfo?.monthNumeric || '01';
  const year = monthInfo?.year || new Date().getUTCFullYear();
  const basePaypal = paypalInvoiceNumber && typeof paypalInvoiceNumber === 'string'
    ? paypalInvoiceNumber
    : seqDisplay;

  const invoiceNumber = `${accountPrefix}-${year}${monthNumeric}-${seqDisplay}`;
  const defaultName = `${prefix}-${monthInfo?.monthShort || 'Month'}-${year}-${basePaypal}`;
  const invoiceName = manualName && manualName.trim() ? manualName.trim() : defaultName;
  const invoiceSlug = slugifyInvoiceName(invoiceName, seqNumeric);

  return {
    invoiceNumber,
    invoiceName,
    invoiceSlug,
    paypalInvoiceNumber: basePaypal,
    sequence: seqNumeric
  };
}

function extractSequenceFromName(name) {
  if (!name) return null;
  const match = String(name).match(/(\d+)(?!.*\d)/);
  if (!match) return null;
  const numeric = parseInt(match[1], 10);
  return Number.isFinite(numeric) ? numeric : null;
}

module.exports = {
  allocateNextSequence,
  ensureSequenceAtLeast,
  formatSequence,
  computeMajorityMonth,
  buildInvoiceIdentifiers,
  extractSequenceFromName,
  slugifyInvoiceName,
  MONTH_NAMES_SHORT
};
