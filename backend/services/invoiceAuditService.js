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
    .lean();

  if (!classes.length) return [];

  const lessonIds = classes.map(c => String(c._id));
  const invoiced = new Set(
    (await Invoice.aggregate([
      { $unwind: '$items' },
      { $match: { 'items.lessonId': { $in: lessonIds } } },
      { $group: { _id: '$items.lessonId' } }
    ])).map(r => String(r._id))
  );

  const uninvoiced = [];
  for (const cls of classes) {
    const id = String(cls._id);
    if (invoiced.has(id)) continue;
    // If the class is already linked to an invoice via linkage field, skip
    if (cls.billedInInvoiceId) continue;
    if (exemptPredicate(cls)) continue;
    uninvoiced.push(cls);
  }

  return uninvoiced;
}

module.exports = {
  findUninvoicedLessons,
};
