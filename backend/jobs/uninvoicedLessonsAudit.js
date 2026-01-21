// backend/jobs/uninvoicedLessonsAudit.js
const { findUninvoicedLessons } = require('../services/invoiceAuditService');
const notificationService = require('../services/notificationService');

/**
 * Run an audit to find lessons that are not linked to any invoice.
 * - Logs a concise summary to the server console
 * - Optionally notifies admins (toggle with env AUDIT_NOTIFY_ADMINS=true)
 * - Bounded scan window via AUDIT_SINCE_DAYS (default 90)
 */
async function runUninvoicedLessonsAudit(options = {}) {
  const sinceDays = Number(process.env.AUDIT_SINCE_DAYS || options.sinceDays || 90);
  const includeCancelled = String(process.env.AUDIT_INCLUDE_CANCELLED || options.includeCancelled || 'false').toLowerCase() === 'true';
  const notifyAdmins = String(process.env.AUDIT_NOTIFY_ADMINS || options.notifyAdmins || 'true').toLowerCase() === 'true';

  try {
    const uninvoiced = await findUninvoicedLessons({ sinceDays, includeCancelled });
    const total = uninvoiced.length;
    if (total === 0) {
      console.log(`[UninvoicedLessonsAudit] No uninvoiced lessons found in the last ${sinceDays} days.`);
      return { success: true, total, details: [] };
    }

    // Log top-50 details to keep console noise reasonable
    const sample = uninvoiced.slice(0, 50).map((c) => ({
      id: c.classId || c._id?.toString?.() || String(c._id),
      status: c.status,
      scheduledDate: c.scheduledDate,
      duration: c.duration,
      student: c.student,
      teacher: c.teacher,
      guardian: c.guardian,
      reason: c.reasonCode || c.reason
    }));

    console.warn(`[UninvoicedLessonsAudit] Found ${total} lessons not tied to any invoice (since ${sinceDays}d). Showing top ${sample.length}.`);
    console.warn(sample);

    // Flag them for UI surfacing
    try {
      const Class = require('../models/Class');
      const ids = uninvoiced
        .map((c) => c.classId || c._id)
        .filter(Boolean);
      if (ids.length) {
        await Class.updateMany({ _id: { $in: ids } }, { $set: { flaggedUninvoiced: true } });
      }
    } catch (flagErr) {
      console.warn('[UninvoicedLessonsAudit] Failed to flag classes:', flagErr && flagErr.message);
    }

    if (notifyAdmins && total > 0) {
      try {
        await notificationService.notifyRole({
          role: 'admin',
          title: 'Uninvoiced lessons detected',
          message: `There are ${total} lessons not attached to any invoice in the last ${sinceDays} days. Review and attach as needed.`,
          type: 'warning',
          // Use a valid relatedTo enum; include extra context via metadata
          related: {
            relatedTo: 'system',
            relatedId: 'uninvoiced-lessons',
            metadata: { category: 'audit', kind: 'uninvoiced_lessons', sinceDays, total }
          }
        });
      } catch (notifyErr) {
        console.warn('[UninvoicedLessonsAudit] Failed to notify admins:', notifyErr && notifyErr.message);
      }
    }

    return { success: true, total, details: sample };
  } catch (err) {
    console.error('[UninvoicedLessonsAudit] Error during audit:', err && err.message);
    return { success: false, error: err && err.message };
  }
}

module.exports = {
  runUninvoicedLessonsAudit,
};
