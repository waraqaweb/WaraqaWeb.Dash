#!/usr/bin/env node
/**
 * migration-audit-guardian-hours.js
 * ─────────────────────────────────
 * READ-ONLY audit script — never writes to the database.
 *
 * For every guardian it computes:
 *   EXPECTED totalHours = SUM(paidHours from paymentLogs) - SUM(consumed hours from attended classes)
 *
 * Then it compares against the CURRENT value stored in User.guardianInfo.totalHours
 * and produces a detailed JSON report + console summary showing:
 *  • guardians whose hours match
 *  • guardians whose hours drift (with delta and per-student breakdown)
 *  • aggregated drift statistics
 *
 * Usage:
 *   node scripts/migration-audit-guardian-hours.js                # all guardians
 *   node scripts/migration-audit-guardian-hours.js <email|id>     # single guardian
 *   node scripts/migration-audit-guardian-hours.js --json         # JSON output to stdout
 *
 * The script also writes a timestamped report to backend/tmp/
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');
const Guardian = require('../models/Guardian');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const selectorArg = args.find(a => a !== '--json');

const COUNTABLE_STATUSES = new Set(['attended', 'missed_by_student', 'absent']);
const EPSILON = 0.001;

const round3 = v => Math.round((Number(v || 0) + Number.EPSILON) * 1000) / 1000;

const resolveStudentKey = v => {
  if (!v) return null;
  if (typeof v === 'object' && v._id) return String(v._id);
  return String(v);
};

const extractPaidHours = (invoice, guardianRate) => {
  const logs = Array.isArray(invoice.paymentLogs) ? invoice.paymentLogs : [];
  const rate = Number(invoice?.guardianFinancial?.hourlyRate || 0)
    || Number(guardianRate || 0) || 10;
  let total = 0;
  for (const log of logs) {
    if (!log || typeof log.amount !== 'number' || log.amount <= 0) continue;
    if (log.method === 'refund' || log.method === 'tip_distribution') continue;
    if (log.paidHours != null) {
      total += Number(log.paidHours) || 0;
    } else {
      total += Number(log.amount || 0) / rate;
    }
  }
  return round3(total);
};

async function auditGuardian(guardian) {
  const info = guardian.guardianInfo || {};
  const students = Array.isArray(info.students) ? info.students : [];

  // ── consumed hours from classes ──
  const classes = await Class.find({
    'student.guardianId': guardian._id,
    deleted: { $ne: true }
  }).select('student status duration billedInInvoiceId paidByGuardian').lean();

  const consumedByStudent = new Map();
  let totalConsumed = 0;
  let totalClasses = 0;
  let countableClasses = 0;

  for (const cls of classes) {
    totalClasses++;
    if (!COUNTABLE_STATUSES.has(cls?.status)) continue;
    const h = Number(cls?.duration || 0) / 60;
    if (!Number.isFinite(h) || h <= 0) continue;
    countableClasses++;
    totalConsumed += h;
    const sid = cls?.student?.studentId ? String(cls.student.studentId) : null;
    if (sid) consumedByStudent.set(sid, round3((consumedByStudent.get(sid) || 0) + h));
  }
  totalConsumed = round3(totalConsumed);

  // ── paid hours from invoices ──
  const invoices = await Invoice.find({
    guardian: guardian._id,
    deleted: { $ne: true }
  }).lean();

  const paidByStudent = new Map();
  let totalPaid = 0;
  let unassignedPaid = 0;
  const invoiceBreakdown = [];

  for (const inv of invoices) {
    const items = Array.isArray(inv.items) ? [...inv.items].sort((a, b) =>
      new Date(a?.date || 0).getTime() - new Date(b?.date || 0).getTime()
    ) : [];
    const totalItemHours = items.reduce((s, i) => s + (Number(i?.duration || 0) / 60), 0);
    if (totalItemHours <= 0) { invoiceBreakdown.push({ id: inv._id, number: inv.invoiceNumber, status: inv.status, paidHours: 0, note: 'no items' }); continue; }

    let paidHours = extractPaidHours(inv, info.hourlyRate || 0);
    const isPaid = inv.status === 'paid';
    const coverageMax = Number(inv?.coverage?.maxHours);
    if (Number.isFinite(coverageMax) && coverageMax >= 0) {
      paidHours = Math.min(totalItemHours, coverageMax);
    } else if (paidHours <= EPSILON && isPaid) {
      paidHours = totalItemHours;
    }

    invoiceBreakdown.push({
      id: inv._id,
      number: inv.invoiceNumber,
      status: inv.status,
      paidHours: round3(paidHours),
      totalItemHours: round3(totalItemHours),
      paymentLogs: (inv.paymentLogs || []).length
    });

    if (paidHours <= EPSILON) continue;
    totalPaid += paidHours;

    const coverage = Math.min(totalItemHours, paidHours);
    let remaining = coverage;
    for (const item of items) {
      if (remaining <= EPSILON) break;
      if (item?.excludeFromStudentBalance || item?.exemptFromGuardian ||
          (item?.flags && (item.flags.notCountForBoth || item.flags.exemptFromGuardian))) continue;
      const ih = (Number(item?.duration || 0) || 0) / 60;
      if (ih <= 0) continue;
      const slice = Math.min(ih, remaining);
      const sk = resolveStudentKey(item.student);
      if (sk) {
        paidByStudent.set(sk, round3((paidByStudent.get(sk) || 0) + slice));
      } else {
        unassignedPaid = round3(unassignedPaid + slice);
      }
      remaining = round3(remaining - slice);
    }
  }
  totalPaid = round3(totalPaid);

  // ── expected values ──
  const expectedPerStudent = [];
  for (const s of students) {
    const candidateIds = [s?._id, s?.id, s?.studentId, s?.standaloneStudentId, s?.studentInfo?.standaloneStudentId]
      .filter(Boolean).map(String);
    const unique = [...new Set(candidateIds)];
    const consumed = unique.reduce((sum, id) => sum + (consumedByStudent.get(id) || 0), 0);
    const paid = unique.reduce((sum, id) => sum + (paidByStudent.get(id) || 0), 0);
    const expected = round3(paid - consumed);
    const current = round3(s.hoursRemaining || 0);
    expectedPerStudent.push({
      name: s.name || s.studentInfo?.name || '(unnamed)',
      id: String(s._id || s.studentId),
      current,
      expected,
      delta: round3(current - expected),
      paid: round3(paid),
      consumed: round3(consumed)
    });
  }

  const studentTotal = expectedPerStudent.reduce((s, e) => s + e.expected, 0);
  const expectedTotalHours = round3(studentTotal + unassignedPaid);
  const currentTotalHours = round3(info.totalHours || 0);
  const delta = round3(currentTotalHours - expectedTotalHours);

  return {
    guardianId: String(guardian._id),
    email: guardian.email || '(no email)',
    name: guardian.name || guardian.guardianInfo?.displayName || '(unnamed)',
    current: {
      totalHours: currentTotalHours,
      autoTotalHours: info.autoTotalHours
    },
    expected: {
      totalHours: expectedTotalHours,
      totalPaid: round3(totalPaid),
      totalConsumed,
      unassignedPaid: round3(unassignedPaid)
    },
    delta,
    driftDetected: Math.abs(delta) > EPSILON,
    students: expectedPerStudent,
    stats: {
      totalClasses,
      countableClasses,
      invoiceCount: invoices.length,
      paidInvoices: invoices.filter(i => i.status === 'paid').length
    },
    invoiceBreakdown
  };
}

async function main() {
  await mongoose.connect(uri);
  console.error(`Connected to ${uri.replace(/\/\/[^@]+@/, '//***@')}`);

  const filter = { role: 'guardian' };
  if (selectorArg) {
    if (mongoose.Types.ObjectId.isValid(selectorArg)) {
      filter._id = selectorArg;
    } else {
      filter.email = selectorArg.toLowerCase();
    }
  }

  const guardians = await User.find(filter);
  console.error(`Found ${guardians.length} guardian(s) to audit`);

  const results = [];
  for (const g of guardians) {
    results.push(await auditGuardian(g));
  }

  // ── summary stats ──
  const drifted = results.filter(r => r.driftDetected);
  const matched = results.filter(r => !r.driftDetected);
  const totalDrift = round3(drifted.reduce((s, r) => s + Math.abs(r.delta), 0));

  const summary = {
    auditDate: new Date().toISOString(),
    totalGuardians: results.length,
    matched: matched.length,
    drifted: drifted.length,
    totalAbsDrift: totalDrift,
    driftedGuardians: drifted.map(r => ({
      email: r.email,
      name: r.name,
      current: r.current.totalHours,
      expected: r.expected.totalHours,
      delta: r.delta,
      paidHours: r.expected.totalPaid,
      consumedHours: r.expected.totalConsumed
    }))
  };

  const report = { summary, guardians: results };

  if (jsonMode) {
    process.stdout.write(JSON.stringify(report, null, 2));
  } else {
    // Console summary
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║          GUARDIAN HOURS AUDIT REPORT                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    console.log(`  Total guardians:  ${results.length}`);
    console.log(`  Matched (OK):     ${matched.length}`);
    console.log(`  Drifted:          ${drifted.length}`);
    console.log(`  Total abs drift:  ${totalDrift} hours\n`);

    if (drifted.length > 0) {
      console.log('─── DRIFTED GUARDIANS ────────────────────────────────────\n');
      for (const r of drifted) {
        const sign = r.delta > 0 ? '+' : '';
        console.log(`  ${r.email} (${r.name})`);
        console.log(`    Current:   ${r.current.totalHours}h`);
        console.log(`    Expected:  ${r.expected.totalHours}h  (paid ${r.expected.totalPaid}h - consumed ${r.expected.totalConsumed}h)`);
        console.log(`    Delta:     ${sign}${r.delta}h  ← ${r.delta > 0 ? 'over-credited' : 'under-credited'}`);
        if (r.students.some(s => Math.abs(s.delta) > EPSILON)) {
          console.log('    Students:');
          for (const s of r.students.filter(s => Math.abs(s.delta) > EPSILON)) {
            const sSign = s.delta > 0 ? '+' : '';
            console.log(`      ${s.name}: current=${s.current}h expected=${s.expected}h delta=${sSign}${s.delta}h (paid=${s.paid}h consumed=${s.consumed}h)`);
          }
        }
        console.log('');
      }
    }

    if (matched.length > 0 && !selectorArg) {
      console.log('─── MATCHED GUARDIANS ───────────────────────────────────\n');
      for (const r of matched) {
        console.log(`  ✓ ${r.email}: ${r.current.totalHours}h (paid=${r.expected.totalPaid}h consumed=${r.expected.totalConsumed}h)`);
      }
      console.log('');
    }
  }

  // Always write report file
  const tmpDir = path.join(__dirname, '..', 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const reportPath = path.join(tmpDir, `guardian-hours-audit-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.error(`\nReport saved: ${reportPath}`);

  await mongoose.disconnect();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
