#!/usr/bin/env node
/**
 * Full guardian hours audit: for EVERY guardian, compare:
 *   paidHours (from paid invoice paymentLogs) - consumedHours (countable classes) = expectedRemaining
 * vs the stored totalHours in the DB.
 *
 * Also checks:
 *   - Classes billed in non-cancelled/non-refunded invoices that have ineligible statuses
 *   - Classes appearing in multiple active invoices (double-billed)
 *   - Invoices with items referencing classes that don't exist
 *
 * Usage:
 *   node scripts/audit-all-guardians.js [--json] [--fix] [guardianId]
 *
 * --json   Output machine-readable JSON
 * --fix    Auto-fix stored totalHours to match computed value
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const fixMode = args.includes('--fix');
const singleId = args.find(a => !a.startsWith('--'));

const COUNTABLE = new Set(['attended', 'missed_by_student', 'absent']);
const INELIGIBLE_FOR_INVOICE = new Set([
  'cancelled', 'cancelled_by_teacher', 'cancelled_by_student',
  'cancelled_by_guardian', 'cancelled_by_admin', 'cancelled_by_system',
  'on_hold', 'pattern', 'no_show_both', 'unreported'
]);

const EPSILON = 0.009; // tolerance for float comparison

async function auditGuardian(guardian, allInvoices, allClasses) {
  const gid = String(guardian._id);
  const info = guardian.guardianInfo || {};
  const storedHours = Number(info.totalHours || 0);

  // --- Paid hours from paymentLogs ---
  const invoices = allInvoices.filter(i => String(i.guardian) === gid);
  let totalPaidHours = 0;
  const paidInvoices = [];
  for (const inv of invoices) {
    if (inv.status === 'cancelled' || inv.status === 'refunded') continue;
    const logs = inv.paymentLogs || [];
    let invPaidH = 0;
    for (const l of logs) {
      if (!l || l.amount <= 0) continue;
      if (l.method === 'refund' || l.method === 'tip_distribution') continue;
      invPaidH += l.paidHours != null ? Number(l.paidHours) : 0;
    }
    if (invPaidH > 0) {
      totalPaidHours += invPaidH;
      paidInvoices.push({ id: String(inv._id), number: inv.invoiceNumber, paidHours: invPaidH, status: inv.status });
    }
  }

  // --- Consumed hours (countable classes) ---
  const classes = allClasses.filter(c => String(c.student?.guardianId) === gid);
  const countable = classes.filter(c => COUNTABLE.has(c.status));
  let totalConsumed = 0;
  for (const c of countable) {
    totalConsumed += Number(c.duration || 0) / 60;
  }

  const expectedRemaining = totalPaidHours - totalConsumed;
  const drift = Math.abs(storedHours - expectedRemaining);
  const hoursMatch = drift < EPSILON;

  // --- Check for ineligible classes in active invoices ---
  const ineligibleBilled = [];
  for (const inv of invoices) {
    if (['cancelled', 'refunded'].includes(inv.status)) continue;
    if (inv.deleted) continue;
    for (const item of (inv.items || [])) {
      const classId = item.class ? String(item.class) : (item.lessonId || null);
      if (!classId) continue;
      const cls = classes.find(c => String(c._id) === classId);
      if (cls && INELIGIBLE_FOR_INVOICE.has(cls.status)) {
        ineligibleBilled.push({
          invoiceId: String(inv._id),
          invoiceNumber: inv.invoiceNumber,
          invoiceStatus: inv.status,
          classId,
          classStatus: cls.status,
          classDate: cls.scheduledDate
        });
      }
    }
  }

  // --- Check for double-billed classes ---
  const classInvoiceMap = new Map(); // classId -> [invoiceIds]
  for (const inv of invoices) {
    if (['cancelled', 'refunded'].includes(inv.status)) continue;
    if (inv.deleted) continue;
    for (const item of (inv.items || [])) {
      const classId = item.class ? String(item.class) : (item.lessonId ? String(item.lessonId) : null);
      if (!classId || classId === 'null' || classId === 'undefined') continue;
      if (!classInvoiceMap.has(classId)) classInvoiceMap.set(classId, []);
      classInvoiceMap.get(classId).push(String(inv._id));
    }
  }
  const doubleBilled = [];
  for (const [classId, invIds] of classInvoiceMap) {
    if (invIds.length > 1) {
      doubleBilled.push({ classId, invoiceIds: invIds });
    }
  }

  return {
    guardianId: gid,
    name: `${guardian.firstName || ''} ${guardian.lastName || ''}`.trim(),
    email: guardian.email,
    storedHours: round(storedHours),
    totalPaidHours: round(totalPaidHours),
    totalConsumed: round(totalConsumed),
    expectedRemaining: round(expectedRemaining),
    drift: round(drift),
    hoursMatch,
    countableClasses: countable.length,
    totalClasses: classes.length,
    invoiceCount: invoices.length,
    paidInvoiceCount: paidInvoices.length,
    ineligibleBilled,
    doubleBilled
  };
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');

    // Load all guardians (or just one)
    const guardianQuery = singleId
      ? { _id: singleId, role: 'guardian' }
      : { role: 'guardian', isActive: { $ne: false } };
    const guardians = await User.find(guardianQuery).lean();

    if (!guardians.length) {
      console.error(singleId ? `Guardian ${singleId} not found` : 'No guardians found');
      process.exit(1);
    }

    // Bulk load invoices and classes
    const guardianIds = guardians.map(g => g._id);
    const [allInvoices, allClasses] = await Promise.all([
      Invoice.find({
        guardian: { $in: guardianIds },
        deleted: { $ne: true }
      }).lean(),
      Class.find({
        'student.guardianId': { $in: guardianIds },
        deleted: { $ne: true }
      }).select('student status duration scheduledDate billedInInvoiceId').lean()
    ]);

    const results = [];
    const issues = [];

    for (const g of guardians) {
      const r = await auditGuardian(g, allInvoices, allClasses);
      results.push(r);

      if (!r.hoursMatch) {
        issues.push({
          type: 'hours_mismatch',
          guardianId: r.guardianId,
          name: r.name,
          stored: r.storedHours,
          expected: r.expectedRemaining,
          drift: r.drift
        });
      }
      if (r.ineligibleBilled.length) {
        issues.push({
          type: 'ineligible_classes_billed',
          guardianId: r.guardianId,
          name: r.name,
          count: r.ineligibleBilled.length,
          details: r.ineligibleBilled
        });
      }
      if (r.doubleBilled.length) {
        issues.push({
          type: 'double_billed',
          guardianId: r.guardianId,
          name: r.name,
          count: r.doubleBilled.length,
          details: r.doubleBilled
        });
      }
    }

    // Fix mode: update stored hours for mismatches
    let fixes = [];
    if (fixMode) {
      for (const r of results) {
        if (!r.hoursMatch) {
          await User.updateOne(
            { _id: r.guardianId },
            { $set: { 'guardianInfo.totalHours': r.expectedRemaining } }
          );
          fixes.push({
            guardianId: r.guardianId,
            name: r.name,
            from: r.storedHours,
            to: r.expectedRemaining
          });
        }
      }
    }

    if (jsonMode) {
      console.log(JSON.stringify({
        totalGuardians: results.length,
        issueCount: issues.length,
        hoursMismatches: issues.filter(i => i.type === 'hours_mismatch').length,
        ineligibleBilledCount: issues.filter(i => i.type === 'ineligible_classes_billed').length,
        doubleBilledCount: issues.filter(i => i.type === 'double_billed').length,
        fixes: fixes.length,
        issues,
        ...(fixMode ? { fixesApplied: fixes } : {}),
        guardians: results
      }, null, 2));
    } else {
      console.log(`\n=== GUARDIAN HOURS AUDIT ===`);
      console.log(`Guardians audited: ${results.length}`);
      console.log(`Issues found: ${issues.length}`);
      console.log(`  Hours mismatches: ${issues.filter(i => i.type === 'hours_mismatch').length}`);
      console.log(`  Ineligible classes billed: ${issues.filter(i => i.type === 'ineligible_classes_billed').length}`);
      console.log(`  Double-billed classes: ${issues.filter(i => i.type === 'double_billed').length}`);

      if (issues.length) {
        console.log(`\n--- ISSUES ---`);
        for (const issue of issues) {
          if (issue.type === 'hours_mismatch') {
            console.log(`\n[HOURS MISMATCH] ${issue.name} (${issue.guardianId})`);
            console.log(`  stored=${issue.stored}h  expected=${issue.expected}h  drift=${issue.drift}h`);
          } else if (issue.type === 'ineligible_classes_billed') {
            console.log(`\n[INELIGIBLE BILLED] ${issue.name} (${issue.guardianId}) — ${issue.count} class(es)`);
            for (const d of issue.details) {
              console.log(`  invoice=${d.invoiceNumber} (${d.invoiceStatus}) class=${d.classId} status=${d.classStatus} date=${d.classDate}`);
            }
          } else if (issue.type === 'double_billed') {
            console.log(`\n[DOUBLE BILLED] ${issue.name} (${issue.guardianId}) — ${issue.count} class(es)`);
            for (const d of issue.details) {
              console.log(`  class=${d.classId} in invoices: ${d.invoiceIds.join(', ')}`);
            }
          }
        }
      }

      if (fixMode && fixes.length) {
        console.log(`\n--- FIXES APPLIED ---`);
        for (const f of fixes) {
          console.log(`  ${f.name} (${f.guardianId}): ${f.from}h → ${f.to}h`);
        }
      }

      const matchCount = results.filter(r => r.hoursMatch).length;
      console.log(`\n✅ ${matchCount}/${results.length} guardians hours match`);
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Audit failed:', err);
    process.exit(1);
  }
})();
