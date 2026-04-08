#!/usr/bin/env node
/**
 * migration-fix-guardian-hours.js
 * ───────────────────────────────
 * Migration script that:
 *  1. Snapshots BEFORE state of every guardian
 *  2. Recomputes each guardian's totalHours = paidHours − consumedHours
 *  3. Recomputes each student's hoursRemaining = paidForStudent − consumedByStudent
 *  4. Snapshots AFTER state
 *  5. Writes a full comparison report (before vs after)
 *
 * Modes:
 *   --dry-run   (default)  Compute expected values but DO NOT write to DB
 *   --apply                Actually update the database
 *   --json                 Output JSON instead of table
 *   <email|id>             Process single guardian only
 *
 * Usage:
 *   node scripts/migration-fix-guardian-hours.js --dry-run            # preview all
 *   node scripts/migration-fix-guardian-hours.js --dry-run user@x.com # preview one
 *   node scripts/migration-fix-guardian-hours.js --apply              # apply all
 *
 * After --apply the script re-reads from DB to confirm write succeeded.
 * Reports saved to backend/tmp/
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
const applyMode = args.includes('--apply');
const jsonMode = args.includes('--json');
const selectorArg = args.find(a => !a.startsWith('--'));

const COUNTABLE = new Set(['attended', 'missed_by_student', 'absent']);
const EPSILON = 0.001;
const r3 = v => Math.round((Number(v || 0) + Number.EPSILON) * 1000) / 1000;

const resolveKey = v => {
  if (!v) return null;
  if (typeof v === 'object' && v._id) return String(v._id);
  return String(v);
};

const extractPaidHours = (inv, gRate) => {
  const logs = Array.isArray(inv.paymentLogs) ? inv.paymentLogs : [];
  const rate = Number(inv?.guardianFinancial?.hourlyRate || 0) || Number(gRate || 0) || 10;
  let t = 0;
  for (const l of logs) {
    if (!l || typeof l.amount !== 'number' || l.amount <= 0) continue;
    if (l.method === 'refund' || l.method === 'tip_distribution') continue;
    t += (l.paidHours != null) ? (Number(l.paidHours) || 0) : (Number(l.amount || 0) / rate);
  }
  return r3(t);
};

function snapshotGuardian(g) {
  const info = g.guardianInfo || {};
  const students = (Array.isArray(info.students) ? info.students : []).map(s => ({
    id: String(s._id || s.studentId || ''),
    name: s.name || s.studentInfo?.name || '(unnamed)',
    hoursRemaining: r3(s.hoursRemaining || 0)
  }));
  return {
    totalHours: r3(info.totalHours || 0),
    autoTotalHours: !!info.autoTotalHours,
    cumulativeConsumedHours: r3(info.cumulativeConsumedHours || 0),
    students
  };
}

async function computeExpected(guardian) {
  const info = guardian.guardianInfo || {};
  const students = Array.isArray(info.students) ? info.students : [];

  // consumed
  const classes = await Class.find({ 'student.guardianId': guardian._id, deleted: { $ne: true } })
    .select('student status duration').lean();
  const consumedMap = new Map();
  let totalConsumed = 0;
  for (const c of classes) {
    if (!COUNTABLE.has(c?.status)) continue;
    const h = Number(c?.duration || 0) / 60;
    if (!Number.isFinite(h) || h <= 0) continue;
    totalConsumed += h;
    const sid = c?.student?.studentId ? String(c.student.studentId) : null;
    if (sid) consumedMap.set(sid, r3((consumedMap.get(sid) || 0) + h));
  }
  totalConsumed = r3(totalConsumed);

  // paid
  const invoices = await Invoice.find({ guardian: guardian._id, deleted: { $ne: true } }).lean();
  const paidMap = new Map();
  let unassigned = 0;
  let totalPaid = 0;

  for (const inv of invoices) {
    const items = Array.isArray(inv.items) ? [...inv.items].sort((a, b) =>
      new Date(a?.date || 0).getTime() - new Date(b?.date || 0).getTime()) : [];
    const totalItemH = items.reduce((s, i) => s + (Number(i?.duration || 0) / 60), 0);
    if (totalItemH <= 0) continue;

    let paid = extractPaidHours(inv, info.hourlyRate || 0);
    const cap = Number(inv?.coverage?.maxHours);
    if (Number.isFinite(cap) && cap >= 0) paid = Math.min(totalItemH, cap);
    else if (paid <= EPSILON && inv.status === 'paid') paid = totalItemH;
    if (paid <= EPSILON) continue;
    totalPaid += paid;

    let remaining = Math.min(totalItemH, paid);
    for (const item of items) {
      if (remaining <= EPSILON) break;
      if (item?.excludeFromStudentBalance || item?.exemptFromGuardian ||
        (item?.flags && (item.flags.notCountForBoth || item.flags.exemptFromGuardian))) continue;
      const ih = (Number(item?.duration || 0) || 0) / 60;
      if (ih <= 0) continue;
      const slice = Math.min(ih, remaining);
      const sk = resolveKey(item.student);
      if (sk) paidMap.set(sk, r3((paidMap.get(sk) || 0) + slice));
      else unassigned = r3(unassigned + slice);
      remaining = r3(remaining - slice);
    }
  }
  totalPaid = r3(totalPaid);

  const perStudent = [];
  for (const s of students) {
    const ids = [s?._id, s?.id, s?.studentId, s?.standaloneStudentId, s?.studentInfo?.standaloneStudentId]
      .filter(Boolean).map(String);
    const unique = [...new Set(ids)];
    const consumed = unique.reduce((sum, id) => sum + (consumedMap.get(id) || 0), 0);
    const paid = unique.reduce((sum, id) => sum + (paidMap.get(id) || 0), 0);
    perStudent.push({
      id: String(s._id || s.studentId || ''),
      name: s.name || s.studentInfo?.name || '(unnamed)',
      hoursRemaining: r3(paid - consumed),
      paid: r3(paid),
      consumed: r3(consumed)
    });
  }

  const studentTotal = perStudent.reduce((s, e) => s + e.hoursRemaining, 0);
  return {
    totalHours: r3(studentTotal + unassigned),
    totalPaid,
    totalConsumed,
    unassigned: r3(unassigned),
    autoTotalHours: unassigned <= EPSILON,
    perStudent
  };
}

async function applyToGuardian(guardian, expected) {
  const info = guardian.guardianInfo || {};
  const studArr = Array.isArray(info.students) ? info.students : [];

  for (const entry of expected.perStudent) {
    const target = entry.id;
    const idx = studArr.findIndex(s => {
      const ids = [s?._id, s?.id, s?.studentId, s?.standaloneStudentId, s?.studentInfo?.standaloneStudentId]
        .filter(Boolean).map(String);
      return ids.includes(target);
    });
    if (idx !== -1) studArr[idx].hoursRemaining = entry.hoursRemaining;
  }

  info.totalHours = expected.totalHours;
  info.autoTotalHours = expected.autoTotalHours;
  info.cumulativeConsumedHours = expected.totalConsumed;
  guardian.markModified('guardianInfo.students');
  guardian.markModified('guardianInfo');
  await guardian.save();

  try { await Guardian.updateTotalRemainingMinutes(guardian._id); } catch (_) {}
}

async function main() {
  await mongoose.connect(uri);
  console.error(`Connected. Mode: ${applyMode ? 'APPLY (writes to DB!)' : 'DRY-RUN (read-only)'}`);

  const filter = { role: 'guardian' };
  if (selectorArg) {
    if (mongoose.Types.ObjectId.isValid(selectorArg)) filter._id = selectorArg;
    else filter.email = selectorArg.toLowerCase();
  }

  const guardians = await User.find(filter);
  console.error(`Processing ${guardians.length} guardian(s)...\n`);

  const records = [];

  for (const g of guardians) {
    const before = snapshotGuardian(g);
    const expected = await computeExpected(g);

    let after = null;
    if (applyMode) {
      await applyToGuardian(g, expected);
      // Re-read from DB to confirm
      const fresh = await User.findById(g._id);
      after = snapshotGuardian(fresh);
    }

    const delta = r3(before.totalHours - expected.totalHours);
    const record = {
      guardianId: String(g._id),
      email: g.email || '(no email)',
      name: g.name || g.guardianInfo?.displayName || '(unnamed)',
      before,
      expected: {
        totalHours: expected.totalHours,
        totalPaid: expected.totalPaid,
        totalConsumed: expected.totalConsumed,
        unassigned: expected.unassigned,
        students: expected.perStudent
      },
      delta,
      driftDetected: Math.abs(delta) > EPSILON,
      deltaExplanation: Math.abs(delta) <= EPSILON
        ? 'No drift — hours are correct'
        : delta > 0
          ? `Over-credited by ${delta}h — current DB has more hours than paid−consumed`
          : `Under-credited by ${Math.abs(delta)}h — current DB has fewer hours than paid−consumed`,
      whichIsCorrect: 'expected',
      reason: 'Expected = SUM(paymentLogs.paidHours) − SUM(attended class durations). This is the source of truth derived from actual payment records and class attendance.',
      ...(after ? {
        after,
        writeVerified: Math.abs(after.totalHours - expected.totalHours) <= EPSILON
      } : {})
    };

    records.push(record);
  }

  // ── Summary ──
  const drifted = records.filter(r => r.driftDetected);
  const totalAbsDrift = r3(drifted.reduce((s, r) => s + Math.abs(r.delta), 0));

  const report = {
    meta: {
      date: new Date().toISOString(),
      mode: applyMode ? 'apply' : 'dry-run',
      mongoUri: uri.replace(/\/\/[^@]+@/, '//***@'),
      totalGuardians: records.length,
      matched: records.length - drifted.length,
      drifted: drifted.length,
      totalAbsDrift,
      ...(applyMode ? { writesVerified: records.every(r => r.writeVerified !== false) } : {})
    },
    guardians: records
  };

  if (jsonMode) {
    process.stdout.write(JSON.stringify(report, null, 2));
  } else {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log(`║  GUARDIAN HOURS MIGRATION ${applyMode ? 'APPLY' : 'DRY-RUN'} REPORT                   ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    console.log(`  Total guardians:  ${records.length}`);
    console.log(`  Matched (OK):     ${records.length - drifted.length}`);
    console.log(`  Drifted:          ${drifted.length}`);
    console.log(`  Total abs drift:  ${totalAbsDrift} hours`);
    if (applyMode) console.log(`  Writes verified:  ${report.meta.writesVerified ? 'YES' : 'SOME FAILED!'}`);
    console.log('');

    if (drifted.length > 0) {
      console.log('─── CHANGES ' + (applyMode ? 'APPLIED' : 'THAT WOULD BE APPLIED') + ' ─────────────────────────\n');
      for (const r of drifted) {
        const sign = r.delta > 0 ? '+' : '';
        console.log(`  ${r.email} (${r.name})`);
        console.log(`    BEFORE:    totalHours = ${r.before.totalHours}h`);
        console.log(`    EXPECTED:  totalHours = ${r.expected.totalHours}h  (paid ${r.expected.totalPaid}h − consumed ${r.expected.totalConsumed}h)`);
        console.log(`    DELTA:     ${sign}${r.delta}h  ${r.deltaExplanation}`);
        if (r.after) {
          console.log(`    AFTER:     totalHours = ${r.after.totalHours}h  ${r.writeVerified ? '✓ verified' : '✗ MISMATCH!'}`);
        }
        // Per-student
        const studentDiffs = (r.expected.students || []).filter(s => {
          const beforeS = (r.before.students || []).find(bs => bs.id === s.id);
          return beforeS && Math.abs(beforeS.hoursRemaining - s.hoursRemaining) > EPSILON;
        });
        if (studentDiffs.length > 0) {
          console.log('    Students:');
          for (const s of studentDiffs) {
            const beforeS = (r.before.students || []).find(bs => bs.id === s.id);
            console.log(`      ${s.name}: ${beforeS.hoursRemaining}h → ${s.hoursRemaining}h (paid=${s.paid}h consumed=${s.consumed}h)`);
          }
        }
        console.log('');
      }
    }

    const okGuardians = records.filter(r => !r.driftDetected);
    if (okGuardians.length > 0 && okGuardians.length <= 50) {
      console.log('─── NO CHANGES NEEDED ───────────────────────────────────\n');
      for (const r of okGuardians) {
        console.log(`  ✓ ${r.email}: ${r.before.totalHours}h (paid=${r.expected.totalPaid}h consumed=${r.expected.totalConsumed}h)`);
      }
      console.log('');
    }
  }

  // Save report file
  const tmpDir = path.join(__dirname, '..', 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tag = applyMode ? 'apply' : 'dryrun';
  const reportPath = path.join(tmpDir, `guardian-hours-migration-${tag}-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.error(`\nReport saved: ${reportPath}`);

  await mongoose.disconnect();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
