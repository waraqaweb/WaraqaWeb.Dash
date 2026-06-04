/**
 * Standardize subjects across recurring class series.
 *
 * For each recurring pattern (status='pattern', isRecurring=true) it rewrites the
 * `subject` of every non-cancelled child instance to match the pattern's current
 * subject, then re-syncs any unpaid guardian invoices touching those classes so
 * their item descriptions reflect the standardized name.
 *
 * Usage:
 *   node backend/scripts/standardizeRecurringSubjects.js                  # all patterns
 *   node backend/scripts/standardizeRecurringSubjects.js --patternId <id>
 *   node backend/scripts/standardizeRecurringSubjects.js --guardianId <id>
 *   node backend/scripts/standardizeRecurringSubjects.js --classId <id>   # resolves pattern from a child
 *   node backend/scripts/standardizeRecurringSubjects.js --dry-run
 */

const mongoose = require('mongoose');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');
const InvoiceService = require('../services/invoiceService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';

const CANCELLED_STATUSES = [
  'cancelled',
  'cancelled_by_admin',
  'cancelled_by_teacher',
  'cancelled_by_student',
  'cancelled_by_guardian',
  'cancelled_by_system',
];

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.replace(/^--/, '');
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = value;
      i += 1;
    }
  }
  return out;
};

async function resolvePatterns(args) {
  if (args.patternId) {
    const p = await Class.findById(args.patternId);
    if (!p) throw new Error(`No class found with id ${args.patternId}`);
    if (p.status !== 'pattern') throw new Error(`Class ${args.patternId} is not a pattern (status=${p.status})`);
    return [p];
  }
  if (args.classId) {
    const c = await Class.findById(args.classId).select('parentRecurringClass status');
    if (!c) throw new Error(`No class found with id ${args.classId}`);
    const patternId = c.parentRecurringClass || (c.status === 'pattern' ? c._id : null);
    if (!patternId) throw new Error(`Class ${args.classId} has no parentRecurringClass and is not a pattern`);
    const p = await Class.findById(patternId);
    if (!p) throw new Error(`Pattern ${patternId} not found`);
    return [p];
  }
  const filter = { status: 'pattern', isRecurring: true };
  if (args.guardianId) {
    filter['student.guardianId'] = new mongoose.Types.ObjectId(args.guardianId);
  }
  return Class.find(filter);
}

async function run() {
  const args = parseArgs();
  const dryRun = Boolean(args['dry-run'] || args.dryRun);

  await mongoose.connect(MONGODB_URI);
  console.log(`Connected. dryRun=${dryRun}`);

  const patterns = await resolvePatterns(args);
  console.log(`Found ${patterns.length} pattern(s) to process.`);

  const touchedInvoiceIds = new Set();
  let totalChildrenUpdated = 0;
  let patternsWithDrift = 0;

  for (const pattern of patterns) {
    const patternSubject = (pattern.subject || '').trim();
    if (!patternSubject) {
      console.warn(`  - Pattern ${pattern._id} has empty subject; skipping.`);
      continue;
    }

    const drifted = await Class.find({
      parentRecurringClass: pattern._id,
      status: { $nin: ['pattern', ...CANCELLED_STATUSES] },
      $or: [
        { subject: { $exists: false } },
        { subject: { $ne: patternSubject } },
      ],
    }).select('_id subject scheduledDate student').lean();

    if (!drifted.length) {
      continue;
    }

    patternsWithDrift += 1;
    console.log(`\nPattern ${pattern._id} ("${patternSubject}"): ${drifted.length} child(ren) with drift.`);
    drifted.slice(0, 5).forEach((c) => {
      const d = c.scheduledDate ? new Date(c.scheduledDate).toISOString().slice(0, 10) : 'n/a';
      console.log(`    ${d}  ${c._id}  was: "${c.subject || ''}"`);
    });
    if (drifted.length > 5) console.log(`    ... and ${drifted.length - 5} more`);

    if (!dryRun) {
      const res = await Class.updateMany(
        {
          _id: { $in: drifted.map((c) => c._id) },
        },
        { $set: { subject: patternSubject } }
      );
      totalChildrenUpdated += res.modifiedCount || 0;
      console.log(`    -> updated ${res.modifiedCount} child class subjects.`);

      // Find unpaid invoices for the affected guardians/students so we can refresh descriptions.
      const guardianStudentPairs = new Map();
      for (const c of drifted) {
        const g = c.student?.guardianId;
        const s = c.student?.studentId;
        if (g && s) {
          const key = `${g}:${s}`;
          if (!guardianStudentPairs.has(key)) guardianStudentPairs.set(key, { g, s });
        }
      }
      for (const { g, s } of guardianStudentPairs.values()) {
        const invs = await Invoice.find({
          guardian: g,
          'items.student': s,
          status: { $in: ['draft', 'pending', 'sent', 'overdue'] },
          deleted: { $ne: true },
        }).select('_id');
        invs.forEach((inv) => touchedInvoiceIds.add(String(inv._id)));
      }
    }
  }

  if (!dryRun && touchedInvoiceIds.size) {
    console.log(`\nResyncing ${touchedInvoiceIds.size} unpaid invoice(s) to refresh descriptions...`);
    for (const id of touchedInvoiceIds) {
      try {
        const result = await InvoiceService.syncUnpaidInvoiceItems(id, {
          note: 'Standardized series subjects backfill',
          cleanupDuplicates: false,
        });
        if (result?.success || result?.noChanges) {
          console.log(`  - invoice ${id}: ${result.noChanges ? 'no-op' : 'synced'}`);
        } else {
          console.warn(`  - invoice ${id}: failed (${result?.error || 'unknown'})`);
        }
      } catch (err) {
        console.warn(`  - invoice ${id}: error ${err?.message || err}`);
      }
    }
  }

  console.log(`\nSummary: patternsWithDrift=${patternsWithDrift}, childrenUpdated=${totalChildrenUpdated}, invoicesTouched=${touchedInvoiceIds.size}, dryRun=${dryRun}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('standardizeRecurringSubjects failed:', err);
  process.exit(1);
});
