const Invoice = require('../models/Invoice');
const Class = require('../models/Class');

/**
 * Find lessons that should belong to at least one invoice but currently do not.
 * Options:
 *  - sinceDays: scan only lessons updated/scheduled within N days (default 90)
 *  - includeCancelled: include cancelled lessons (default false)
 *  - exemptPredicate(klass): return true if lesson exempt from invoicing rules
 */
async function findUninvoicedLessons(options = {}) {
  const sinceDays = Number(options.sinceDays || 90);
  const includeCancelled = Boolean(options.includeCancelled || false);
  const exemptPredicate = typeof options.exemptPredicate === 'function' ? options.exemptPredicate : () => false;

  const now = new Date();
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  // Only consider lessons that have already happened (scheduledDate < now)
  // and are billable under our policy.
  // Modern statuses from Class model
  const baseBillable = ['attended', 'missed_by_student', 'completed'];
  const cancelledStatuses = ['cancelled_by_teacher', 'cancelled_by_guardian', 'cancelled_by_admin'];
  const legacyCompat = ['absent']; // legacy values kept for compatibility
  const billableStatuses = includeCancelled
    ? [...baseBillable, ...cancelledStatuses, ...legacyCompat]
    : [...baseBillable, ...legacyCompat];

  const classes = await Class.find({
    scheduledDate: { $gte: sinceDate, $lt: now },
    status: { $in: billableStatuses }
  })
    .select('_id status scheduledDate student teacher duration flags metadata billedInInvoiceId')
    .populate('teacher', 'firstName lastName email')
    .populate('student.guardianId', 'firstName lastName email')
    .lean();

  if (!classes.length) return [];

  const lessonIds = classes.map(c => String(c._id));
  const classObjectIds = classes.map(c => c._id).filter(Boolean);

  const activeInvoiceFilter = {
    deleted: { $ne: true },
    // Refunded invoices are still invoices; treat them as valid attachments so we don't
    // double-invoice lessons that were previously paid/refunded.
    status: { $nin: ['cancelled'] }
  };

  const invoiced = new Set();
  const invoiceMatches = await Invoice.aggregate([
    { $match: activeInvoiceFilter },
    { $unwind: '$items' },
    {
      $match: {
        $or: [
          { 'items.lessonId': { $in: lessonIds } },
          { 'items.class': { $in: classObjectIds } }
        ]
      }
    },
    { $project: { lessonId: '$items.lessonId', classId: '$items.class' } }
  ]);

  for (const row of invoiceMatches) {
    if (row.lessonId) invoiced.add(String(row.lessonId));
    if (row.classId) invoiced.add(String(row.classId));
  }

  const billedInvoiceIds = classes
    .map((cls) => cls.billedInInvoiceId)
    .filter(Boolean);
  const invoiceLinkMap = new Map();

  if (billedInvoiceIds.length) {
    const linkedInvoices = await Invoice.find(
      { _id: { $in: billedInvoiceIds } },
      '_id deleted status'
    ).lean();
    linkedInvoices.forEach((inv) => {
      invoiceLinkMap.set(String(inv._id), { deleted: !!inv.deleted, status: inv.status });
    });
  }

  const uninvoiced = [];
  for (const cls of classes) {
    const id = String(cls._id);
    if (invoiced.has(id)) continue;

    const billedInvoiceId = cls.billedInInvoiceId ? String(cls.billedInInvoiceId) : null;
    if (billedInvoiceId) {
      const linkMeta = invoiceLinkMap.get(billedInvoiceId);
      const isValidInvoice = linkMeta && !linkMeta.deleted && !['cancelled'].includes(linkMeta.status);
      if (isValidInvoice) continue;
    }

    if (exemptPredicate(cls)) continue;

    const teacher = cls.teacher && typeof cls.teacher === 'object'
      ? {
          id: cls.teacher._id?.toString?.() || cls.teacher._id,
          name: [cls.teacher.firstName, cls.teacher.lastName].filter(Boolean).join(' ').trim() || null,
          email: cls.teacher.email || null
        }
      : null;
    const guardian = cls.student?.guardianId && typeof cls.student.guardianId === 'object'
      ? {
          id: cls.student.guardianId._id?.toString?.() || cls.student.guardianId._id,
          name: [cls.student.guardianId.firstName, cls.student.guardianId.lastName].filter(Boolean).join(' ').trim() || null,
          email: cls.student.guardianId.email || null
        }
      : null;
    const student = cls.student && typeof cls.student === 'object'
      ? {
          id: cls.student.studentId?.toString?.() || cls.student.studentId || null,
          name: cls.student.studentName || null
        }
      : null;

    let reasonCode = 'missing_invoice_link';
    let reason = 'No invoice item found and no invoice link is present.';
    if (billedInvoiceId) {
      reasonCode = 'linked_invoice_missing_or_voided';
      reason = 'Class links to an invoice that is missing, deleted, or voided.';
    }

    uninvoiced.push({
      classId: id,
      scheduledDate: cls.scheduledDate,
      duration: cls.duration,
      status: cls.status,
      billedInInvoiceId: billedInvoiceId,
      teacher,
      student,
      guardian,
      reasonCode,
      reason
    });
  }

  return uninvoiced;
}

module.exports = {
  findUninvoicedLessons,
};
