// backend/services/paymentLinkService.js
// ============================================================
// Credit-Pool Allocation Engine  (Slide & Re-Map)
// ============================================================
const mongoose = require('mongoose');
const PaymentLink = require('../models/PaymentLink');

// Statuses that mean the class actually happened (credit consumed).
// Only attended and missed_by_student are billable to guardians.
const CONFIRMED_STATUSES = new Set([
  'attended', 'missed_by_student'
]);

// Statuses that mean the class is expected but hasn't happened yet
const PROJECTED_STATUSES = new Set([
  'scheduled', 'in_progress'
]);

// Statuses that should NOT consume credit at all
const EXCLUDED_STATUSES = new Set([
  'cancelled', 'cancelled_by_teacher', 'cancelled_by_student',
  'cancelled_by_guardian', 'cancelled_by_admin', 'no_show_both',
  'completed', 'absent', 'on_hold',
  'pattern'
]);

function linkTypeForStatus(status) {
  const s = String(status || '').toLowerCase();
  if (CONFIRMED_STATUSES.has(s)) return 'confirmed';
  if (PROJECTED_STATUSES.has(s)) return 'projected';
  return null; // excluded — no link created
}

/**
 * Round hours to 4 decimal places to avoid floating-point drift.
 */
function roundHours(val) {
  return Math.round((Number(val) || 0) * 10000) / 10000;
}

// ============================================================
// Report submission window check
// ============================================================

/**
 * Check if a past class still has its report submission window open.
 * If open, the class should still appear and consume credit as 'projected'.
 * If the admin extended it, it stays open until extension expires.
 */
function isReportWindowOpen(cls, now = new Date()) {
  const rs = cls.reportSubmission || {};

  // If report was already submitted or class reached a final status, not relevant
  if (rs.status === 'submitted') return false;
  if (rs.status === 'unreported') return false;

  // Admin extension — if granted, check expiry
  if (rs.adminExtension?.granted) {
    const expiresAt = rs.adminExtension.expiresAt
      ? new Date(rs.adminExtension.expiresAt) : null;
    if (!expiresAt || now <= expiresAt) return true;
  }

  // Teacher deadline window
  const deadline = rs.teacherDeadline ? new Date(rs.teacherDeadline) : null;
  if (deadline && now <= deadline) return true;

  // If status is 'open' or 'admin_extended' or 'pending' but no deadline set,
  // use a fallback: 72 hours after class end
  if (!deadline) {
    const classEnd = cls.endsAt
      ? new Date(cls.endsAt)
      : new Date(new Date(cls.scheduledDate).getTime() + (cls.duration || 60) * 60000);
    const fallbackDeadline = new Date(classEnd.getTime() + 72 * 3600000);
    if (now <= fallbackDeadline) return true;
  }

  return false;
}

// ============================================================
// Core algorithm
// ============================================================

/**
 * slideAndReMap(guardianId, fromDate)
 *
 * Wipes all PaymentLinks for classes from `fromDate` onward,
 * then re-allocates credit from paid invoices chronologically.
 *
 * @param {ObjectId|string} guardianId
 * @param {Date}            fromDate    – re-map classes from this date
 * @param {object}          [opts]
 * @param {ClientSession}   [opts.session]  – Mongo session for transactions
 * @returns {{ created: number, uncoveredClasses: array, auditEntries: array }}
 */
async function slideAndReMap(guardianId, fromDate, opts = {}) {
  const Invoice = require('../models/Invoice');
  const Class   = require('../models/Class');
  const session  = opts.session || null;
  const qOpts   = session ? { session } : {};

  const gId = new mongoose.Types.ObjectId(String(guardianId));

  // -------------------------------------------------------
  // 1. THE WIPE  – delete links for classes >= fromDate
  // -------------------------------------------------------
  // Find ALL classes in range (including excluded statuses) so that
  // stale links for newly-cancelled classes get cleaned up too.
  const affectedClasses = await Class.find({
    'student.guardianId': gId,
    scheduledDate: { $gte: fromDate },
    hidden: { $ne: true }
  }).select('_id').lean(qOpts);

  const affectedIds = affectedClasses.map(c => c._id);

  let deletedCount = 0;
  if (affectedIds.length) {
    const res = await PaymentLink.deleteMany(
      { guardian: gId, class: { $in: affectedIds } },
      qOpts
    );
    deletedCount = res.deletedCount || 0;
  }

  // -------------------------------------------------------
  // 2. THE CREDIT POOL  – all paid invoices, oldest first
  // -------------------------------------------------------
  const paidInvoices = await Invoice.find({
    guardian: gId,
    type: 'guardian_invoice',
    status: 'paid',
    deleted: { $ne: true }
  }).sort({ 'billingPeriod.startDate': 1, createdAt: 1 })
    .select('_id billingPeriod creditHours hoursCovered items guardianFinancial coverage total paidAmount')
    .lean(qOpts);

  // Build pool: for each invoice, calculate remaining hours
  // Remaining = creditHours − SUM(hoursCovered of existing links NOT wiped)
  const pools = [];
  for (const inv of paidInvoices) {
    const creditHours = roundHours(inv.creditHours);
    if (creditHours <= 0) continue;

    // Sum hours already allocated (for classes BEFORE fromDate, still valid)
    const usedAgg = await PaymentLink.aggregate([
      { $match: { invoice: inv._id, guardian: gId } },
      { $group: { _id: null, total: { $sum: '$hoursCovered' } } }
    ]);
    const usedHours = roundHours(usedAgg.length ? usedAgg[0].total : 0);
    const remaining = roundHours(creditHours - usedHours);

    if (remaining > 0) {
      pools.push({
        invoiceId: inv._id,
        creditHours,
        remaining,
        billingStart: inv.billingPeriod?.startDate
      });
    }
  }

  // -------------------------------------------------------
  // 3. THE CHRONOLOGICAL ALLOCATION  (The Slide)
  // -------------------------------------------------------
  const classesToAllocate = await Class.find({
    'student.guardianId': gId,
    scheduledDate: { $gte: fromDate },
    status: { $nin: [...EXCLUDED_STATUSES] },
    hidden: { $ne: true }
  }).sort({ scheduledDate: 1 })
    .select('_id scheduledDate duration status student endsAt reportSubmission')
    .lean(qOpts);

  const now = new Date();
  let poolIdx = 0;
  const linksToInsert = [];
  const uncoveredClasses = [];
  const auditEntries = [];

  for (const cls of classesToAllocate) {
    const classHours = roundHours((cls.duration || 60) / 60);
    let type = linkTypeForStatus(cls.status);
    if (!type) continue; // excluded status

    // For projected classes (scheduled/in_progress) that are in the past:
    // only keep them if the report submission window is still active or
    // the admin extended it. Otherwise they should not consume credit.
    if (type === 'projected') {
      const classEnd = cls.endsAt
        ? new Date(cls.endsAt)
        : new Date(new Date(cls.scheduledDate).getTime() + (cls.duration || 60) * 60000);
      if (classEnd < now && !isReportWindowOpen(cls, now)) {
        continue; // window expired — don't allocate credit
      }
    }

    let hoursNeeded = classHours;

    while (hoursNeeded > 0.0001 && poolIdx < pools.length) {
      const pool = pools[poolIdx];

      if (pool.remaining <= 0.0001) {
        poolIdx++;
        continue;
      }

      const hoursFromThisInvoice = roundHours(Math.min(hoursNeeded, pool.remaining));

      linksToInsert.push({
        guardian: gId,
        student: cls.student?.studentId || null,
        class: cls._id,
        invoice: pool.invoiceId,
        hoursCovered: hoursFromThisInvoice,
        type
      });

      pool.remaining = roundHours(pool.remaining - hoursFromThisInvoice);
      hoursNeeded = roundHours(hoursNeeded - hoursFromThisInvoice);

      if (pool.remaining <= 0.0001) {
        poolIdx++;
      }
    }

    // 4. THE SETTLEMENT – uncovered hours
    if (hoursNeeded > 0.0001) {
      uncoveredClasses.push({
        classId: cls._id,
        scheduledDate: cls.scheduledDate,
        totalHours: classHours,
        uncoveredHours: hoursNeeded
      });
    }
  }

  // Bulk insert
  if (linksToInsert.length) {
    await PaymentLink.insertMany(linksToInsert, qOpts);
  }

  return {
    deletedLinks: deletedCount,
    created: linksToInsert.length,
    uncoveredClasses,
    auditEntries,
    pools: pools.map(p => ({
      invoiceId: p.invoiceId,
      creditHours: p.creditHours,
      remainingAfter: p.remaining
    }))
  };
}

// ============================================================
// Convenience wrappers
// ============================================================

/**
 * Called when a class changes (status, duration, created, deleted).
 * Determines the earliest affected date and re-maps from there.
 */
async function onClassChanged(classDoc, opts = {}) {
  if (!classDoc?.student?.guardianId) return null;
  const fromDate = classDoc.scheduledDate || new Date();
  return slideAndReMap(classDoc.student.guardianId, fromDate, opts);
}

/**
 * Called when an invoice is paid — re-map all classes for this guardian.
 */
async function onInvoicePaid(invoiceDoc, opts = {}) {
  if (!invoiceDoc?.guardian) return null;
  // Re-map from the beginning of time (all classes)
  return slideAndReMap(invoiceDoc.guardian, new Date(0), opts);
}

/**
 * Full re-map for a guardian (used during migration or manual repair).
 */
async function fullReMap(guardianId, opts = {}) {
  return slideAndReMap(guardianId, new Date(0), opts);
}

// ============================================================
// Query helpers
// ============================================================

/**
 * Get all payment links for an invoice, with class details populated.
 */
async function getLinksForInvoice(invoiceId) {
  return PaymentLink.find({ invoice: invoiceId })
    .populate('class', 'scheduledDate duration status subject student')
    .sort({ 'class.scheduledDate': 1 })
    .lean();
}

/**
 * Get all payment links for a class (shows which invoices cover it).
 */
async function getLinksForClass(classId) {
  return PaymentLink.find({ class: classId })
    .populate('invoice', 'invoiceNumber invoiceName status billingPeriod')
    .lean();
}

/**
 * Get credit summary for an invoice:
 *  { creditHours, confirmedHours, projectedHours, remainingHours }
 */
async function getInvoiceCreditSummary(invoiceId) {
  const Invoice = require('../models/Invoice');
  const inv = await Invoice.findById(invoiceId).select('creditHours').lean();
  if (!inv) return null;

  const agg = await PaymentLink.aggregate([
    { $match: { invoice: new mongoose.Types.ObjectId(String(invoiceId)) } },
    { $group: {
      _id: '$type',
      total: { $sum: '$hoursCovered' }
    }}
  ]);

  const byType = {};
  for (const row of agg) {
    byType[row._id] = roundHours(row.total);
  }

  const creditHours = roundHours(inv.creditHours || 0);
  const confirmedHours = byType.confirmed || 0;
  const projectedHours = byType.projected || 0;

  return {
    creditHours,
    confirmedHours,
    projectedHours,
    usedHours: roundHours(confirmedHours + projectedHours),
    remainingHours: roundHours(creditHours - confirmedHours - projectedHours)
  };
}

/**
 * Check if a class is fully covered by payment links.
 */
async function isClassCovered(classId) {
  const Class = require('../models/Class');
  const cls = await Class.findById(classId).select('duration').lean();
  if (!cls) return false;

  const classHours = roundHours((cls.duration || 60) / 60);

  const agg = await PaymentLink.aggregate([
    { $match: { class: new mongoose.Types.ObjectId(String(classId)) } },
    { $group: { _id: null, total: { $sum: '$hoursCovered' } } }
  ]);

  const coveredHours = roundHours(agg.length ? agg[0].total : 0);
  return coveredHours >= classHours - 0.001;
}

/**
 * Validate that no invoice is over-allocated.
 * Returns array of violations (empty = clean).
 */
async function validateGuardianAllocations(guardianId) {
  const Invoice = require('../models/Invoice');
  const gId = new mongoose.Types.ObjectId(String(guardianId));

  const invoices = await Invoice.find({
    guardian: gId,
    type: 'guardian_invoice',
    status: 'paid',
    deleted: { $ne: true }
  }).select('_id invoiceNumber creditHours').lean();

  const violations = [];

  for (const inv of invoices) {
    const agg = await PaymentLink.aggregate([
      { $match: { invoice: inv._id } },
      { $group: { _id: null, total: { $sum: '$hoursCovered' } } }
    ]);

    const allocated = roundHours(agg.length ? agg[0].total : 0);
    const credit = roundHours(inv.creditHours || 0);

    if (allocated > credit + 0.001) {
      violations.push({
        invoiceId: inv._id,
        invoiceNumber: inv.invoiceNumber,
        creditHours: credit,
        allocatedHours: allocated,
        overage: roundHours(allocated - credit)
      });
    }
  }

  return violations;
}

module.exports = {
  slideAndReMap,
  onClassChanged,
  onInvoicePaid,
  fullReMap,
  getLinksForInvoice,
  getLinksForClass,
  getInvoiceCreditSummary,
  isClassCovered,
  isReportWindowOpen,
  validateGuardianAllocations,
  // Expose for testing
  linkTypeForStatus,
  roundHours,
  CONFIRMED_STATUSES,
  PROJECTED_STATUSES,
  EXCLUDED_STATUSES
};
