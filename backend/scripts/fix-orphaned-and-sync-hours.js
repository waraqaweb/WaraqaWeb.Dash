/**
 * Repair orphaned classes: classes that have billedInInvoiceId pointing to a paid invoice
 * but NO matching item in that invoice. Adds the missing item back.
 *
 * Also syncs all standalone Student.hoursRemaining from computed values.
 *
 * Usage: node scripts/fix-orphaned-and-sync-hours.js [--dry-run] [--fix]
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');
  const Class = require('../models/Class');
  const Invoice = require('../models/Invoice');
  const User = require('../models/User');
  const Student = require('../models/Student');
  const { computeGuardianHoursFromPaidInvoices, normalizeId, roundHours } = require('../services/guardianHoursService');

  const dryRun = !process.argv.includes('--fix');
  if (dryRun) console.log('=== DRY RUN (pass --fix to apply) ===\n');
  else console.log('=== APPLYING FIXES ===\n');

  // ── PART 1: Fix orphaned classes (missing items in paid invoices) ──

  const COUNTABLE = new Set(['attended', 'missed_by_student', 'absent']);
  const paidInvoices = await Invoice.find({ status: 'paid', deleted: { $ne: true } }).lean();

  const invoiceItemClassIds = new Map();
  for (const inv of paidInvoices) {
    const classIds = new Set();
    for (const item of (inv.items || [])) {
      const cid = item.class ? String(item.class) : item.lessonId ? String(item.lessonId) : null;
      if (cid) classIds.add(cid);
    }
    invoiceItemClassIds.set(String(inv._id), classIds);
  }

  const paidInvIds = paidInvoices.map(i => i._id);
  const orphanedClasses = await Class.find({
    billedInInvoiceId: { $in: paidInvIds },
    status: { $in: Array.from(COUNTABLE) },
    deleted: { $ne: true }
  }).select('student status duration scheduledDate subject billedInInvoiceId').lean();

  let orphanFixed = 0;
  for (const c of orphanedClasses) {
    const classId = String(c._id);
    const invoiceId = String(c.billedInInvoiceId);
    const itemSet = invoiceItemClassIds.get(invoiceId);
    if (itemSet && itemSet.has(classId)) continue;

    const studentId = c.student?.studentId || c.student?._id;
    const studentName = c.student?.studentName || 'unknown';
    const date = c.scheduledDate ? new Date(c.scheduledDate).toISOString().slice(0, 10) : '?';

    console.log(`ORPHAN: ${date} | ${studentName} | ${c.status} | ${c.duration}min | inv=${invoiceId} | class=${classId}`);

    if (!dryRun) {
      // Add missing item to the invoice
      const newItem = {
        class: c._id,
        student: studentId,
        date: c.scheduledDate,
        duration: c.duration,
        amount: 0, // No price recalculation needed for paid invoice
        status: c.status,
        attended: COUNTABLE.has(c.status),
        subject: c.subject,
        description: `${studentName} - ${c.subject || 'Class'} (${date})`,
      };

      await Invoice.updateOne(
        { _id: invoiceId },
        { $push: { items: newItem } }
      );
      orphanFixed++;
    }
  }

  console.log(`\nOrphaned items: ${orphanFixed} fixed${dryRun ? ' (dry run)' : ''}\n`);

  // ── PART 2: Sync all guardian hours to embedded + standalone ──

  const guardians = await User.find({ role: 'guardian', deleted: { $ne: true } })
    .select('_id guardianInfo')
    .lean();

  const guardianIds = guardians.map(g => String(g._id));
  console.log(`Syncing hours for ${guardianIds.length} guardians...\n`);

  // Process in batches of 20 to avoid memory issues
  const BATCH = 20;
  let synced = 0;
  let embeddedUpdated = 0;
  let standaloneUpdated = 0;

  for (let i = 0; i < guardianIds.length; i += BATCH) {
    const batch = guardianIds.slice(i, i + BATCH);
    const hoursMap = await computeGuardianHoursFromPaidInvoices(batch);

    for (const guardianId of batch) {
      const entry = hoursMap.get(guardianId);
      if (!entry) continue;

      const guardian = await User.findById(guardianId).select('guardianInfo');
      if (!guardian || !guardian.guardianInfo) continue;

      const embedded = Array.isArray(guardian.guardianInfo.students) ? guardian.guardianInfo.students : [];
      let changed = false;

      for (const es of embedded) {
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

          // Sync embedded
          if (Math.abs((es.hoursRemaining || 0) - rounded) > 0.001) {
            if (!dryRun) es.hoursRemaining = rounded;
            changed = true;
            embeddedUpdated++;
          }

          // Sync standalone
          if (standaloneId) {
            const standaloneDoc = await Student.findById(standaloneId).select('hoursRemaining');
            if (standaloneDoc && Math.abs((standaloneDoc.hoursRemaining || 0) - rounded) > 0.001) {
              if (!dryRun) {
                standaloneDoc.hoursRemaining = rounded;
                await standaloneDoc.save();
              }
              standaloneUpdated++;
            }
          }
        }
      }

      if (changed && !dryRun) {
        guardian.markModified('guardianInfo.students');
        await guardian.save();
      }

      synced++;
    }
  }

  console.log(`Hours sync complete:`);
  console.log(`  Guardians processed: ${synced}`);
  console.log(`  Embedded students updated: ${embeddedUpdated}${dryRun ? ' (dry run)' : ''}`);
  console.log(`  Standalone students updated: ${standaloneUpdated}${dryRun ? ' (dry run)' : ''}`);

  await mongoose.disconnect();
})();
