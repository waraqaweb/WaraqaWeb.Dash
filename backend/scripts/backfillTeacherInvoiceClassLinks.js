/*
 * Backfill teacher invoice linkage onto Class documents.
 *
 * Why:
 * - Older TeacherInvoice records may have `classIds` populated, but the Class docs
 *   were never updated with `billedInTeacherInvoiceId`.
 * - New UI counters (and invoice generation safety) rely on this linkage.
 *
 * Usage:
 *   node backend/scripts/backfillTeacherInvoiceClassLinks.js
 *   node backend/scripts/backfillTeacherInvoiceClassLinks.js --dry-run
 *   node backend/scripts/backfillTeacherInvoiceClassLinks.js --limit=200
 */

const mongoose = require('mongoose');
const TeacherInvoice = require('../models/TeacherInvoice');
const Class = require('../models/Class');

function parseArgs(argv = []) {
  const args = { dryRun: false, limit: 0 };
  for (const raw of argv) {
    if (raw === '--dry-run') args.dryRun = true;
    if (raw.startsWith('--limit=')) {
      const n = parseInt(raw.split('=')[1], 10);
      args.limit = Number.isFinite(n) ? n : 0;
    }
  }
  return args;
}

async function main() {
  const { dryRun, limit } = parseArgs(process.argv.slice(2));

  if (!process.env.MONGO_URI) {
    console.error('Missing MONGO_URI env var');
    process.exit(1);
  }

  console.log(`[backfillTeacherInvoiceClassLinks] starting. dryRun=${dryRun} limit=${limit || 'none'}`);
  await mongoose.connect(process.env.MONGO_URI);

  const invoiceQuery = {
    deleted: false,
    classIds: { $exists: true, $type: 'array', $ne: [] }
  };

  const cursor = TeacherInvoice.find(invoiceQuery)
    .select('_id teacher classIds status month year invoiceNumber isAdjustment adjustmentFor')
    .sort({ createdAt: 1 })
    .cursor();

  let processedInvoices = 0;
  let linkedClasses = 0;
  let skippedAlreadyLinked = 0;
  let skippedTeacherMismatch = 0;

  for await (const invoice of cursor) {
    processedInvoices++;
    if (limit && processedInvoices > limit) break;

    const invoiceId = invoice._id;
    const teacherId = invoice.teacher;
    const classIds = Array.isArray(invoice.classIds) ? invoice.classIds : [];
    if (!invoiceId || !teacherId || classIds.length === 0) continue;

    // Only link classes that match the invoice teacher and are currently unlinked.
    // This avoids corrupting data if a classId is mistakenly present on an invoice.
    const filter = {
      _id: { $in: classIds },
      teacher: teacherId,
      $or: [
        { billedInTeacherInvoiceId: null },
        { billedInTeacherInvoiceId: { $exists: false } }
      ]
    };

    const update = {
      $set: {
        billedInTeacherInvoiceId: invoiceId,
        teacherInvoiceBilledAt: new Date()
      }
    };

    if (dryRun) {
      const count = await Class.countDocuments(filter);
      linkedClasses += count;
    } else {
      const res = await Class.updateMany(filter, update);
      linkedClasses += res.modifiedCount || 0;
    }

    // Diagnostics: how many were not linked because they were already linked?
    // (best-effort and cheap)
    const alreadyLinkedCount = await Class.countDocuments({
      _id: { $in: classIds },
      teacher: teacherId,
      billedInTeacherInvoiceId: { $ne: null }
    });
    skippedAlreadyLinked += alreadyLinkedCount;

    // Diagnostics: classIds that don't match the invoice teacher (data hygiene)
    const mismatchCount = await Class.countDocuments({
      _id: { $in: classIds },
      teacher: { $ne: teacherId }
    });
    skippedTeacherMismatch += mismatchCount;

    if (processedInvoices % 50 === 0) {
      console.log(`[backfillTeacherInvoiceClassLinks] processed=${processedInvoices} linked=${linkedClasses}`);
    }
  }

  console.log('[backfillTeacherInvoiceClassLinks] done');
  console.log({
    dryRun,
    processedInvoices,
    linkedClasses,
    skippedAlreadyLinked,
    skippedTeacherMismatch
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[backfillTeacherInvoiceClassLinks] fatal', err);
  process.exit(1);
});
