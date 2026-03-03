const Invoice = require('../models/Invoice');
const Class = require('../models/Class');

const COUNTABLE_CLASS_STATUSES = new Set(['attended', 'missed_by_student']);
const COUNTABLE_ATTENDANCE = new Set(['attended', 'missed_by_student']);

const roundHours = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000;

const normalizeId = (value) => {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    if (value._id) return String(value._id);
    if (typeof value.toString === 'function') {
      const str = value.toString();
      return str && str !== '[object Object]' ? str : null;
    }
  }
  return null;
};

const pickInvoiceStartDate = (invoice) => {
  const billingStart = invoice?.billingPeriod?.startDate ? new Date(invoice.billingPeriod.startDate) : null;
  if (billingStart && !Number.isNaN(billingStart.getTime())) return billingStart;

  const itemDates = Array.isArray(invoice?.items)
    ? invoice.items
        .map((item) => (item?.date ? new Date(item.date) : null))
        .filter((date) => date && !Number.isNaN(date.getTime()))
    : [];
  if (itemDates.length) {
    return new Date(Math.min(...itemDates.map((d) => d.getTime())));
  }

  const createdAt = invoice?.createdAt ? new Date(invoice.createdAt) : null;
  return createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null;
};

const resolveItemHours = (item) => {
  const qty = Number(item?.quantityHours);
  if (Number.isFinite(qty) && qty > 0) return qty;
  const minutes = Number(item?.duration || 0) || 0;
  return minutes > 0 ? minutes / 60 : 0;
};

const shouldCountClass = (cls) => {
  const attendance = cls?.classReport?.attendance || null;
  if (attendance === 'missed_by_student' && cls?.classReport?.countAbsentForBilling === false) return false;
  if (attendance && COUNTABLE_ATTENDANCE.has(attendance)) return true;
  const status = cls?.status || null;
  return COUNTABLE_CLASS_STATUSES.has(status);
};

const buildPaidInvoiceAllocations = (invoices = []) => {
  const perGuardian = new Map();

  for (const invoice of invoices) {
    if (!invoice || !invoice.guardian) continue;
    const guardianId = normalizeId(invoice.guardian);
    if (!guardianId) continue;

    if (!perGuardian.has(guardianId)) {
      perGuardian.set(guardianId, {
        studentPaid: new Map(),
        studentStart: new Map()
      });
    }

    const entry = perGuardian.get(guardianId);
    const invoiceStart = pickInvoiceStartDate(invoice);
    const items = Array.isArray(invoice.items) ? invoice.items : [];

    for (const item of items) {
      const studentId = normalizeId(item?.student);
      if (!studentId) continue;

      const hours = resolveItemHours(item);
      if (!Number.isFinite(hours) || hours <= 0) continue;

      entry.studentPaid.set(studentId, roundHours((entry.studentPaid.get(studentId) || 0) + hours));

      if (invoiceStart) {
        const currentStart = entry.studentStart.get(studentId);
        if (!currentStart || invoiceStart < currentStart) {
          entry.studentStart.set(studentId, invoiceStart);
        }
      }
    }
  }

  return perGuardian;
};

const computeConsumedHours = async (guardianId, studentStartMap) => {
  const consumed = new Map();
  if (!studentStartMap || studentStartMap.size === 0) return consumed;

  const minStart = Array.from(studentStartMap.values())
    .filter(Boolean)
    .reduce((min, date) => (min && min < date ? min : date), null);
  if (!minStart) return consumed;

  const classDocs = await Class.find({
    'student.guardianId': guardianId,
    scheduledDate: { $gte: minStart }
  })
    .select('scheduledDate duration status classReport student.studentId student._id')
    .lean();

  for (const cls of classDocs || []) {
    if (!shouldCountClass(cls)) continue;
    const studentId = normalizeId(cls?.student?.studentId) || normalizeId(cls?.student?._id);
    if (!studentId) continue;
    const startDate = studentStartMap.get(studentId);
    if (startDate) {
      const clsDate = cls?.scheduledDate ? new Date(cls.scheduledDate) : null;
      if (!clsDate || Number.isNaN(clsDate.getTime()) || clsDate < startDate) continue;
    }

    const minutes = Number(cls?.duration || 0) || 0;
    if (minutes <= 0) continue;
    const hours = minutes / 60;
    consumed.set(studentId, roundHours((consumed.get(studentId) || 0) + hours));
  }

  return consumed;
};

const computeConsumedHoursAllTime = async (guardianId) => {
  const consumed = new Map();
  const classDocs = await Class.find({
    'student.guardianId': guardianId,
    $or: [
      { status: { $in: Array.from(COUNTABLE_CLASS_STATUSES) } },
      { 'classReport.attendance': { $in: Array.from(COUNTABLE_ATTENDANCE) } }
    ]
  })
    .select('scheduledDate duration status classReport student.studentId student._id')
    .lean();

  for (const cls of classDocs || []) {
    if (!shouldCountClass(cls)) continue;
    const studentId = normalizeId(cls?.student?.studentId) || normalizeId(cls?.student?._id);
    if (!studentId) continue;
    const minutes = Number(cls?.duration || 0) || 0;
    if (minutes <= 0) continue;
    const hours = minutes / 60;
    consumed.set(studentId, roundHours((consumed.get(studentId) || 0) + hours));
  }

  return consumed;
};

const computeGuardianHoursFromPaidInvoices = async (guardianIds = []) => {
  const normalized = Array.from(new Set((guardianIds || []).map((id) => normalizeId(id)).filter(Boolean)));
  if (!normalized.length) return new Map();

  const invoices = await Invoice.find({
    guardian: { $in: normalized },
    deleted: { $ne: true },
    status: 'paid'
  })
    .select('guardian billingPeriod.startDate createdAt items.student items.date items.duration items.quantityHours')
    .lean();

  const allocations = buildPaidInvoiceAllocations(invoices);
  const result = new Map();

  for (const guardianId of normalized) {
    const allocation = allocations.get(guardianId) || { studentPaid: new Map(), studentStart: new Map() };
    const consumed = await computeConsumedHours(guardianId, allocation.studentStart);
    const consumedAll = await computeConsumedHoursAllTime(guardianId);
    const studentHours = new Map();

    allocation.studentPaid.forEach((paidHours, studentId) => {
      const used = consumed.get(studentId) || 0;
      const remaining = roundHours(paidHours - used);
      studentHours.set(studentId, remaining);
    });

    consumedAll.forEach((usedHours, studentId) => {
      if (!studentHours.has(studentId)) {
        studentHours.set(studentId, roundHours(-usedHours));
      }
    });

    const totalHours = roundHours(Array.from(studentHours.values()).reduce((sum, value) => sum + (Number(value) || 0), 0));
    result.set(guardianId, { studentHours, totalHours });
  }

  return result;
};

module.exports = {
  computeGuardianHoursFromPaidInvoices,
  normalizeId,
  roundHours
};
