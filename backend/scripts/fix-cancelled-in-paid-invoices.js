#!/usr/bin/env node
/**
 * Remove cancelled/ineligible classes from paid invoices and record
 * credit adjustments so the audit trail is preserved.
 *
 * The 4 cases found by audit-all-guardians.js:
 *   1. Dahlia Jaffer:      invoice 69aff5465727102e27748f1d, class 697fda04dba6e42af6577539 (cancelled_by_student)
 *   2. Waad Beaute:        invoice 69ad78c85684217d0b2eecd8, class 697f6646dba6e42af65758cd (cancelled_by_teacher)
 *   3. Hatun Guler:        invoice 69aff5495727102e277490ba, class 699d809ec5432a1df0ffee98 (cancelled_by_student)
 *   4. Yeota Imam-Rashid:  invoice 69ba8615b4f70197c08b0272, class 69b184f95727102e2774e01e (cancelled_by_student)
 *
 * Usage:
 *   node scripts/fix-cancelled-in-paid-invoices.js [--dry-run]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Class = require('../models/Class');

const dryRun = process.argv.includes('--dry-run');

const INELIGIBLE = new Set([
  'cancelled', 'cancelled_by_teacher', 'cancelled_by_student',
  'cancelled_by_guardian', 'cancelled_by_admin', 'cancelled_by_system',
  'on_hold', 'pattern', 'no_show_both', 'unreported'
]);

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');
    console.log(dryRun ? '=== DRY RUN ===' : '=== APPLYING FIXES ===');

    // Find all paid invoices that have items with ineligible class statuses
    const paidInvoices = await Invoice.find({
      status: 'paid',
      deleted: { $ne: true }
    });

    let totalFixed = 0;

    for (const invoice of paidInvoices) {
      const items = invoice.items || [];
      const classIds = items
        .map(it => it.class ? String(it.class) : (it.lessonId || null))
        .filter(Boolean);

      if (!classIds.length) continue;

      // Load actual class statuses
      const classes = await Class.find({ _id: { $in: classIds } })
        .select('_id status duration scheduledDate subject student')
        .lean();

      const classMap = new Map(classes.map(c => [String(c._id), c]));

      const toRemove = [];
      for (const item of items) {
        const cid = item.class ? String(item.class) : (item.lessonId || null);
        if (!cid) continue;
        const cls = classMap.get(cid);
        if (!cls) continue;
        if (INELIGIBLE.has(cls.status)) {
          toRemove.push({ item, cls });
        }
      }

      if (!toRemove.length) continue;

      const guardianId = invoice.guardian?._id || invoice.guardian;
      console.log(`\nInvoice ${invoice.invoiceNumber || invoice._id} (guardian ${guardianId}):`);

      for (const { item, cls } of toRemove) {
        const hours = (Number(item.duration || cls.duration || 0) / 60);
        const amount = Number(item.amount || 0);
        const date = cls.scheduledDate ? new Date(cls.scheduledDate).toISOString().slice(0, 10) : 'unknown';

        console.log(`  REMOVE: class=${cls._id} status=${cls.status} date=${date} hours=${hours.toFixed(2)} amount=$${amount.toFixed(2)}`);

        if (!dryRun) {
          // 1. Record a credit adjustment on the paid invoice
          if (!Array.isArray(invoice.adjustments)) {
            invoice.adjustments = [];
          }
          invoice.adjustments.push({
            type: 'credit',
            reason: 'class_cancelled',
            classId: cls._id,
            classSnapshot: {
              scheduledDate: cls.scheduledDate,
              duration: Number(cls.duration || 0),
              subject: cls.subject || '',
              studentName: cls.student?.studentName || ''
            },
            description: `Removed ${cls.status} class (${date}) from paid invoice`,
            hoursDelta: -hours,
            amountDelta: -amount,
            settled: false,
            createdAt: new Date(),
            createdBy: null
          });

          // 2. Remove the item
          invoice.items = invoice.items.filter(it => {
            const itId = it.class ? String(it.class) : (it.lessonId || null);
            return itId !== String(cls._id);
          });

          // 3. Unlink the class from this invoice
          await Class.updateOne(
            { _id: cls._id },
            { $unset: { billedInInvoiceId: 1, billedAt: 1 } }
          );
        }
      }

      if (!dryRun && toRemove.length) {
        invoice.markModified('items');
        invoice.markModified('adjustments');
        invoice._skipRecalculate = true; // preserve frozen paid totals
        await invoice.save();

        await invoice.recordAuditEntry({
          actor: null,
          action: 'update',
          diff: {
            removedCancelledClasses: toRemove.map(({ cls }) => ({
              classId: String(cls._id),
              status: cls.status,
              date: cls.scheduledDate
            }))
          },
          meta: { note: 'Automated cleanup: removed cancelled classes from paid invoice' }
        });

        totalFixed += toRemove.length;
      }
    }

    console.log(`\n${dryRun ? 'Would fix' : 'Fixed'}: ${totalFixed} cancelled class(es) across paid invoices`);
    await mongoose.disconnect();
  } catch (err) {
    console.error('Fix failed:', err);
    process.exit(1);
  }
})();
