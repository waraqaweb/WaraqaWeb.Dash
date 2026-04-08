const Invoice = require('../models/Invoice');
const Class = require('../models/Class');

const COUNTABLE_CLASS_STATUSES = new Set(['attended', 'missed_by_student', 'absent']);
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

const resolveItemHours = (item) => {
  const qty = Number(item?.quantityHours);
  if (Number.isFinite(qty) && qty > 0) return qty;
  const minutes = Number(item?.duration || 0) || 0;
  return minutes > 0 ? minutes / 60 : 0;
};

const shouldCountClass = (cls) => {
  const attendance = cls?.classReport?.attendance || null;
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
      perGuardian.set(guardianId, { studentPaid: new Map() });
    }

    const entry = perGuardian.get(guardianId);
    const items = Array.isArray(invoice.items) ? invoice.items : [];

    // Sum per-student hours from items (used for proportional distribution)
    const perStudentItems = new Map();
    let totalItemHours = 0;
    for (const item of items) {
      const studentId = normalizeId(item?.student);
      if (!studentId) continue;
      const hours = resolveItemHours(item);
      if (!Number.isFinite(hours) || hours <= 0) continue;
      perStudentItems.set(studentId, roundHours((perStudentItems.get(studentId) || 0) + hours));
      totalItemHours = roundHours(totalItemHours + hours);
    }

    // Sum paid hours from paymentLogs (reflects actual payment, survives item removal)
    let totalPaidHours = 0;
    const paymentLogs = Array.isArray(invoice.paymentLogs) ? invoice.paymentLogs : [];
    for (const log of paymentLogs) {
      if (!log || Number(log.amount || 0) <= 0) continue;
      if (log.method === 'refund' || log.method === 'tip_distribution') continue;
      totalPaidHours = roundHours(totalPaidHours + (Number(log.paidHours) || 0));
    }

    // Use paymentLogs.paidHours when available (it reflects what was actually paid,
    // even if items were later removed e.g. cancelled classes). Fall back to item totals.
    const effectiveCredit = totalPaidHours > 0 ? totalPaidHours : totalItemHours;

    if (totalItemHours > 0 && effectiveCredit > 0) {
      const scale = effectiveCredit / totalItemHours;
      perStudentItems.forEach((itemHours, studentId) => {
        const allocated = roundHours(itemHours * scale);
        entry.studentPaid.set(studentId, roundHours((entry.studentPaid.get(studentId) || 0) + allocated));
      });
    }
  }

  return perGuardian;
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
    .select('guardian items.student items.duration items.quantityHours paymentLogs.paidHours paymentLogs.amount paymentLogs.method')
    .lean();

  const allocations = buildPaidInvoiceAllocations(invoices);
  const result = new Map();

  for (const guardianId of normalized) {
    const allocation = allocations.get(guardianId) || { studentPaid: new Map() };
    const consumedAll = await computeConsumedHoursAllTime(guardianId);
    const studentHours = new Map();

    allocation.studentPaid.forEach((paidHours, studentId) => {
      const used = consumedAll.get(studentId) || 0;
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

/**
 * Sync computed student hours to standalone Student documents and embedded guardianInfo.
 * Call after computing hours to keep all storage layers consistent.
 * @param {Map} hoursMap - result from computeGuardianHoursFromPaidInvoices
 */
const syncComputedHoursToStorage = async (hoursMap) => {
  if (!hoursMap || !hoursMap.size) return;

  const User = require('../models/User');
  const Student = require('../models/Student');

  for (const [guardianId, entry] of hoursMap) {
    if (!entry || !entry.studentHours) continue;

    try {
      const guardian = await User.findById(guardianId).select('guardianInfo');
      if (!guardian || !guardian.guardianInfo) continue;

      const embedded = Array.isArray(guardian.guardianInfo.students) ? guardian.guardianInfo.students : [];
      let embeddedChanged = false;

      for (const es of embedded) {
        // Try to find hours for this embedded student (check embedded _id, then standaloneStudentId)
        const embeddedId = normalizeId(es._id);
        const standaloneId = normalizeId(es.standaloneStudentId);
        let hours = null;

        if (embeddedId && entry.studentHours.has(embeddedId)) {
          hours = entry.studentHours.get(embeddedId);
        } else if (standaloneId && entry.studentHours.has(standaloneId)) {
          hours = entry.studentHours.get(standaloneId);
        }

        if (hours != null) {
          const rounded = roundHours(hours);
          // Sync to embedded student
          if (Math.abs((es.hoursRemaining || 0) - rounded) > 0.001) {
            es.hoursRemaining = rounded;
            embeddedChanged = true;
          }
          // Sync to standalone student
          if (standaloneId) {
            await Student.updateOne(
              { _id: standaloneId },
              { $set: { hoursRemaining: rounded } }
            );
          }
        }
      }

      if (embeddedChanged) {
        guardian.markModified('guardianInfo.students');
        await guardian.save();
      }
    } catch (err) {
      console.warn(`syncComputedHoursToStorage: failed for guardian ${guardianId}:`, err && err.message);
    }
  }
};

module.exports = {
  computeGuardianHoursFromPaidInvoices,
  syncComputedHoursToStorage,
  normalizeId,
  roundHours
};
