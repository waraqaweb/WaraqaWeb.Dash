#!/usr/bin/env node
/**
 * audit-credit-reconciliation.js  (READ-ONLY)
 * ------------------------------------------------------------------
 * Verifies, WITHOUT writing anything, whether the unsettled "credit"
 * adjustments on paid invoices (class_deleted / duration_changed) can be
 * settled by the existing domino-shift engine pulling later delivered/
 * scheduled classes into the freed paid capacity.
 *
 * For every affected guardian it reports:
 *   1. Purchased (paid) hours vs delivered + unpaid-invoiced hours.
 *   2. Per paid invoice: paid capacity vs what the rebalance engine actually
 *      back-fills (shortfall = paid hours NOT backed by any real class).
 *   3. Which unsettled credits are now COVERED (settleable) vs still OWED.
 *   4. Stored guardian.totalHours vs the authoritative recompute (must match;
 *      the planned "settle" step only flips a flag and must not move hours).
 *   5. How each paid invoice's date range would "widen" to include the
 *      back-filled classes (informational).
 *
 * INVARIANT CHECKED (the key business rule):
 *   Every paid hour must be backed by a delivered class OR a class that lives
 *   in some invoice (paid or unpaid). Any leftover is "owed to the guardian".
 *
 * This script NEVER calls .save() / update / delete. It is safe to run on
 * production. Usage (inside the backend container):
 *
 *   docker compose exec backend node scripts/audit-credit-reconciliation.js
 *   docker compose exec backend node scripts/audit-credit-reconciliation.js --guardian <id>
 *   docker compose exec backend node scripts/audit-credit-reconciliation.js --limit 20
 *
 * Full machine-readable report is written to
 *   backend/tmp/credit-reconciliation-audit.json
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const Invoice = require('../models/Invoice');
const Class = require('../models/Class');
const User = require('../models/User');
const InvoiceService = require('../services/invoiceService');
const guardianHoursService = require('../services/guardianHoursService');

// ── settings ────────────────────────────────────────────────────────────────
const EPS_MIN = 1;          // 1-minute tolerance for capacity comparisons
const UNSETTLED_REASONS = ['class_deleted', 'duration_changed', 'class_cancelled', 'manual'];

// ── arg parsing ───────────────────────────────────────────────────────────--
const argv = process.argv.slice(2);
const getArg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const onlyGuardian = getArg('--guardian');
const limit = Number(getArg('--limit') || 0) || 0;
const jsonOut = getArg('--json') || path.join(__dirname, '..', 'tmp', 'credit-reconciliation-audit.json');

// ── helpers ───────────────────────────────────────────────────────────────--
const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const round3 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 1000) / 1000;
const h = (min) => round3((Number(min || 0)) / 60);
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toISOString().slice(0, 10);
};
const netPaidHoursFromLogs = (invoice) => {
  const logs = Array.isArray(invoice?.paymentLogs) ? invoice.paymentLogs : [];
  let total = 0;
  for (const log of logs) {
    if (!log) continue;
    if (log.method === 'tip_distribution' || log.paymentMethod === 'tip_distribution') continue;
    const paidHours = Number(log.paidHours);
    if (!Number.isFinite(paidHours) || paidHours === 0) continue;
    total += paidHours;
  }
  return round3(Math.max(0, total));
};

async function auditGuardian(guardianDoc) {
  const gId = guardianDoc._id;
  const report = {
    guardianId: String(gId),
    guardianName: `${guardianDoc.firstName || ''} ${guardianDoc.lastName || ''}`.trim(),
    email: guardianDoc.email || '',
    storedTotalHours: round3(guardianDoc.guardianInfo?.totalHours || 0),
    expectedTotalHours: null,
    totalHoursMatch: null,
    purchasedPaidHours: 0,
    paidInvoices: [],
    unsettledCredits: [],
    owedHours: 0,
    owedAmount: 0,
    settleableCredits: 0,
    stillOwedCredits: 0,
    overflowEligibleClasses: 0,
    flags: []
  };

  // 1. Authoritative expected hours (READ-ONLY compute; never synced here).
  try {
    const map = await guardianHoursService.computeGuardianHoursFromPaidInvoices([gId]);
    const entry = map.get(String(gId));
    report.expectedTotalHours = entry ? round3(entry.totalHours) : null;
    if (report.expectedTotalHours != null) {
      report.totalHoursMatch = Math.abs(report.expectedTotalHours - report.storedTotalHours) <= 0.01;
      if (!report.totalHoursMatch) {
        report.flags.push(`HOURS_MISMATCH stored=${report.storedTotalHours} expected=${report.expectedTotalHours}`);
      }
    }
  } catch (e) {
    report.flags.push(`hours_compute_error: ${e.message}`);
  }

  // 2. Domino truth: what the display engine assigns to each invoice.
  const chain = await InvoiceService.rebalanceGuardianInvoices(gId);
  const rebalancedById = new Map();
  for (const inv of chain.invoices || []) {
    rebalancedById.set(String(inv.invoiceId), inv);
  }
  report.overflowEligibleClasses = (chain.unassignedClasses || []).length;
  if (report.overflowEligibleClasses > 0) {
    report.flags.push(`${report.overflowEligibleClasses} eligible class(es) overflow past all invoice capacity (need new/unpaid invoice)`);
  }

  // 3. Load all relevant invoices for this guardian (stored view).
  const invoices = await Invoice.find({
    guardian: gId,
    type: 'guardian_invoice',
    deleted: { $ne: true },
    status: { $nin: ['cancelled', 'refunded'] }
  })
    .select('invoiceNumber invoiceSlug status billingPeriod coverage paymentLogs adjustments items guardianFinancial')
    .lean();

  for (const inv of invoices) {
    const isPaid = String(inv.status).toLowerCase() === 'paid';
    if (isPaid) report.purchasedPaidHours = round3(report.purchasedPaidHours + netPaidHoursFromLogs(inv));

    const unsettled = (inv.adjustments || []).filter(
      (a) => a && a.type === 'credit' && a.settled !== true && UNSETTLED_REASONS.includes(a.reason)
    );

    if (!isPaid) continue;

    const reb = rebalancedById.get(String(inv._id));
    const capacityMin = reb && Number.isFinite(reb.capacityMinutes) ? reb.capacityMinutes : null;
    const usedMin = reb ? Number(reb.usedMinutes || 0) : 0;
    const shortfallMin = capacityMin != null ? Math.max(0, capacityMin - usedMin) : 0;

    // Date-range widening: stored period vs back-filled classes' dates.
    const assignedDates = (reb?.items || [])
      .map((it) => it?.date || it?.class?.scheduledDate)
      .map((d) => (d ? new Date(d) : null))
      .filter((d) => d && !Number.isNaN(d.getTime()))
      .sort((a, b) => a - b);
    const assignedStart = assignedDates[0] || null;
    const assignedEnd = assignedDates[assignedDates.length - 1] || null;

    const sumCreditMin = unsettled.reduce((s, a) => s + Math.abs(Number(a.hoursDelta || 0)) * 60, 0);
    const owedMin = Math.min(sumCreditMin, shortfallMin);
    const settleableMin = Math.max(0, sumCreditMin - shortfallMin);

    const invReport = {
      invoiceNumber: inv.invoiceNumber,
      invoiceSlug: inv.invoiceSlug,
      status: inv.status,
      paidHours: netPaidHoursFromLogs(inv),
      capacityHours: capacityMin != null ? h(capacityMin) : null,
      backfilledHours: h(usedMin),
      shortfallHours: h(shortfallMin),
      storedPeriod: { start: fmtDate(inv.billingPeriod?.startDate), end: fmtDate(inv.billingPeriod?.endDate || inv.coverage?.endDate) },
      backfilledDateRange: { start: fmtDate(assignedStart), end: fmtDate(assignedEnd) },
      unsettledCreditCount: unsettled.length,
      unsettledCreditHours: h(sumCreditMin),
      settleableNowHours: h(settleableMin),
      stillOwedHours: h(owedMin)
    };
    report.paidInvoices.push(invReport);

    for (const a of unsettled) {
      const credMin = Math.abs(Number(a.hoursDelta || 0)) * 60;
      // Attribute the invoice-level shortfall proportionally is overkill; use the
      // simple rule: if the invoice has NO shortfall it is fully backed => settleable.
      const settleable = shortfallMin <= EPS_MIN;
      report.unsettledCredits.push({
        invoiceNumber: inv.invoiceNumber,
        adjustmentId: String(a._id),
        reason: a.reason,
        description: a.description,
        hours: h(credMin),
        amount: round2(Math.abs(Number(a.amountDelta || 0))),
        classDate: fmtDate(a.classSnapshot?.scheduledDate),
        settleable
      });
      if (settleable) report.settleableCredits += 1;
      else report.stillOwedCredits += 1;
    }

    report.owedHours = round3(report.owedHours + h(owedMin));
    const rate = Number(inv.guardianFinancial?.hourlyRate || 0) || 0;
    report.owedAmount = round2(report.owedAmount + h(owedMin) * rate);
  }

  if (report.owedHours > 0.01) {
    report.flags.push(`OWED ${report.owedHours}h (~$${report.owedAmount}) of paid hours are NOT backed by any delivered/scheduled class`);
  }

  return report;
}

async function main() {
  const started = Date.now();
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/waraqadb');
  console.log('🔎 Credit-reconciliation audit (READ-ONLY)\n');

  // Determine target guardians.
  let guardianIds = [];
  if (onlyGuardian) {
    guardianIds = [onlyGuardian];
  } else {
    const invs = await Invoice.find({
      type: 'guardian_invoice',
      deleted: { $ne: true },
      status: 'paid',
      adjustments: {
        $elemMatch: { type: 'credit', settled: { $ne: true }, reason: { $in: UNSETTLED_REASONS } }
      }
    }).select('guardian').lean();
    const set = new Set(invs.map((i) => String(i.guardian)).filter(Boolean));
    guardianIds = Array.from(set);
  }
  if (limit > 0) guardianIds = guardianIds.slice(0, limit);

  console.log(`Guardians with unsettled paid-invoice credits: ${guardianIds.length}${limit ? ` (limited to ${limit})` : ''}\n`);

  const reports = [];
  for (const gid of guardianIds) {
    const guardian = await User.findById(gid).select('firstName lastName email guardianInfo role').lean();
    if (!guardian || guardian.role !== 'guardian') continue;
    try {
      const r = await auditGuardian(guardian);
      reports.push(r);
      const owed = r.owedHours > 0.01 ? `  ⚠️ OWED ${r.owedHours}h (~$${r.owedAmount})` : '';
      const mism = r.totalHoursMatch === false ? '  ⚠️ HOURS MISMATCH' : '';
      console.log(
        `• ${r.guardianName || r.email || r.guardianId}: ` +
        `${r.unsettledCredits.length} unsettled credit(s) → ${r.settleableCredits} settleable, ${r.stillOwedCredits} still owed;` +
        ` purchased=${r.purchasedPaidHours}h stored=${r.storedTotalHours}h expected=${r.expectedTotalHours}h${owed}${mism}`
      );
    } catch (e) {
      console.warn(`  ✗ audit failed for ${gid}: ${e.message}`);
      reports.push({ guardianId: String(gid), error: e.message });
    }
  }

  // Roll-up.
  const totals = reports.reduce(
    (acc, r) => {
      if (r.error) { acc.errors += 1; return acc; }
      acc.unsettled += r.unsettledCredits?.length || 0;
      acc.settleable += r.settleableCredits || 0;
      acc.stillOwed += r.stillOwedCredits || 0;
      acc.owedHours = round3(acc.owedHours + (r.owedHours || 0));
      acc.owedAmount = round2(acc.owedAmount + (r.owedAmount || 0));
      if (r.totalHoursMatch === false) acc.hourMismatches += 1;
      if (r.overflowEligibleClasses > 0) acc.withOverflow += 1;
      return acc;
    },
    { unsettled: 0, settleable: 0, stillOwed: 0, owedHours: 0, owedAmount: 0, hourMismatches: 0, withOverflow: 0, errors: 0 }
  );

  console.log('\n──────── SUMMARY ────────');
  console.log(`Guardians audited        : ${reports.length}`);
  console.log(`Unsettled credits total  : ${totals.unsettled}`);
  console.log(`  ↳ settleable by delivery: ${totals.settleable}`);
  console.log(`  ↳ still genuinely owed  : ${totals.stillOwed}`);
  console.log(`Owed (unbacked) hours     : ${totals.owedHours}h  (~$${totals.owedAmount})`);
  console.log(`Guardians w/ hour mismatch: ${totals.hourMismatches}  ← investigate BEFORE any apply`);
  console.log(`Guardians w/ class overflow: ${totals.withOverflow}`);
  console.log(`Audit errors              : ${totals.errors}`);

  try {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), totals, reports }, null, 2));
    console.log(`\n📄 Full report: ${jsonOut}`);
  } catch (e) {
    console.warn(`Could not write JSON report: ${e.message}`);
  }

  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s. No data was modified.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Audit failed:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
