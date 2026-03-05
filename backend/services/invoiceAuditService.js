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
  const defaultExemptPredicate = (cls) => {
    try {
      const flags = cls.flags || cls.metadata || {};
      return Boolean(flags.exemptFromGuardian || flags.notCountForBoth || flags.exemptFromInvoice);
    } catch (_) {
      return false;
    }
  };
  const exemptPredicate = typeof options.exemptPredicate === 'function' ? options.exemptPredicate : defaultExemptPredicate;

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
    .select('_id status scheduledDate student teacher duration flags metadata billedInInvoiceId paidByGuardian')
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

    if (!cls.student?.guardianId) {
      uninvoiced.push({
        classId: id,
        scheduledDate: cls.scheduledDate,
        duration: cls.duration,
        status: cls.status,
        billedInInvoiceId: billedInvoiceId,
        teacher: cls.teacher || null,
        student: cls.student || null,
        guardian: null,
        reasonCode: 'missing_guardian',
        reason: 'Guardian is missing on this class, so it cannot be invoiced.',
        suggestedFix: 'Assign a guardian to the student, then re-sync unpaid invoices.'
      });
      continue;
    }

    if (!cls.student?.studentId) {
      uninvoiced.push({
        classId: id,
        scheduledDate: cls.scheduledDate,
        duration: cls.duration,
        status: cls.status,
        billedInInvoiceId: billedInvoiceId,
        teacher: cls.teacher || null,
        student: cls.student || null,
        guardian: cls.student?.guardianId || null,
        reasonCode: 'missing_student',
        reason: 'Student is missing on this class, so it cannot be invoiced.',
        suggestedFix: 'Assign a student to this class, then re-sync unpaid invoices.'
      });
      continue;
    }

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
    let suggestedFix = 'Create or sync an unpaid invoice for this guardian, then re-run the resolver.';
    if (billedInvoiceId) {
      reasonCode = 'linked_invoice_missing_or_voided';
      reason = 'Class links to an invoice that is missing, deleted, or voided.';
      suggestedFix = 'Re-attach this class to an active invoice (resolver will clear the broken link).';
    }

    if (cls.paidByGuardian === true) {
      reasonCode = 'paid_flag_without_invoice';
      reason = 'Class is marked as paid by guardian but has no invoice item.';
      suggestedFix = 'Re-link the class to its paid invoice or clear the paid flag and re-sync.';
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
      reason,
      suggestedFix,
      diagnostics: {
        billedInvoiceId: billedInvoiceId || null,
        billedInvoiceStatus: billedInvoiceId ? invoiceLinkMap.get(billedInvoiceId) || null : null,
        paidByGuardian: Boolean(cls.paidByGuardian)
      }
    });
  }

  return uninvoiced;
}

async function resolveUninvoicedLessons(options = {}) {
  const { sinceDays, includeCancelled, limit, adminUserId } = options || {};
  const lessons = await findUninvoicedLessons({ sinceDays, includeCancelled });
  const capped = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? lessons.slice(0, Number(limit))
    : lessons;

  const summary = {
    total: lessons.length,
    processed: 0,
    attached: 0,
    created: 0,
    skipped: 0,
    errors: []
  };

  if (!capped.length) return { success: true, summary };

  const InvoiceService = require('./invoiceService');
  const User = require('../models/User');

  for (const lesson of capped) {
    summary.processed += 1;
    const classId = lesson?.classId || lesson?._id;
    if (!classId) {
      summary.skipped += 1;
      continue;
    }

    try {
      const classDoc = await Class.findById(classId);
      if (!classDoc) {
        summary.skipped += 1;
        continue;
      }

      if (classDoc.billedInInvoiceId) {
        const linked = await Invoice.findById(classDoc.billedInInvoiceId).select('_id deleted status').lean();
        const isValid = linked && !linked.deleted && String(linked.status || '').toLowerCase() !== 'cancelled';
        if (isValid) {
          summary.skipped += 1;
          continue;
        }
        await Class.updateOne(
          { _id: classDoc._id, billedInInvoiceId: classDoc.billedInInvoiceId },
          { $set: { billedInInvoiceId: null, billedAt: null } }
        );
        classDoc.billedInInvoiceId = null;
        classDoc.billedAt = null;
      }

      const alreadyInInvoice = await Invoice.findOne({
        $or: [
          { 'items.class': classDoc._id },
          { 'items.lessonId': String(classDoc._id) }
        ],
        deleted: { $ne: true },
        status: { $nin: ['cancelled'] }
      });

      if (alreadyInInvoice) {
        summary.skipped += 1;
        continue;
      }

      const guardianId = classDoc.student?.guardianId;
      if (!guardianId) {
        summary.skipped += 1;
        continue;
      }

      const paidInsert = await InvoiceService.insertClassIntoPaidInvoiceChain(classDoc);
      if (paidInsert?.handled) {
        summary.attached += 1;
        continue;
      }

      const openInvoice = await Invoice.findOne({
        guardian: guardianId,
        type: 'guardian_invoice',
        status: { $in: ['draft', 'pending', 'sent', 'overdue'] },
        deleted: { $ne: true }
      }).sort({ createdAt: 1 });

      if (openInvoice) {
        const syncResult = await InvoiceService.syncUnpaidInvoiceItems(openInvoice, {
          note: 'Auto-sync uninvoiced lesson',
          cleanupDuplicates: true,
          transferOnDuplicate: true,
          adminUserId: adminUserId || null
        });

        const invoiceDoc = syncResult?.invoice || openInvoice;
        const hasClass = (invoiceDoc?.items || []).some((item) => {
          const key = item?.class ? String(item.class) : (item?.lessonId ? String(item.lessonId) : null);
          return key === String(classDoc._id);
        });

        if (!hasClass) {
          const guardian = await User.findById(guardianId).lean();
          const rate = guardian?.guardianInfo?.hourlyRate || 10;
          const duration = Number(classDoc.duration || 60);
          const hours = duration / 60;
          const amount = Math.round(hours * rate * 100) / 100;

          const studentName = classDoc.student?.studentName || '';
          const [firstName, ...rest] = String(studentName).trim().split(' ').filter(Boolean);
          const lastName = rest.join(' ');

          const attachResult = await InvoiceService.updateInvoiceItems(
            String(openInvoice._id),
            {
              addItems: [{
                lessonId: String(classDoc._id),
                class: classDoc._id,
                student: classDoc.student?.studentId || null,
                studentSnapshot: { firstName: firstName || studentName, lastName: lastName || '', email: '' },
                teacher: classDoc.teacher || null,
                description: `${classDoc.subject || 'Class'}`,
                date: classDoc.scheduledDate || new Date(),
                duration,
                rate,
                amount,
                attended: classDoc.status === 'attended',
                status: classDoc.status || 'scheduled'
              }],
              note: 'Auto-attach uninvoiced lesson',
              transferOnDuplicate: true
            },
            adminUserId || null
          );

          if (!attachResult?.success) {
            summary.errors.push({ classId: String(classDoc._id), error: attachResult?.error || 'Failed to attach' });
            continue;
          }
        }

        summary.attached += 1;
        continue;
      }

      const guardian = await User.findById(guardianId);
      if (!guardian) {
        summary.skipped += 1;
        continue;
      }

      await InvoiceService.createInvoiceForFirstLesson(guardian, classDoc, {
        createdBy: adminUserId || null
      });
      summary.created += 1;
    } catch (innerErr) {
      summary.errors.push({ classId: String(classId), error: innerErr?.message || 'Failed to attach' });
    }
  }

  return { success: true, summary };
}

module.exports = {
  findUninvoicedLessons,
  resolveUninvoicedLessons,
};
