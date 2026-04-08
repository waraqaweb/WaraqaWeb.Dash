// Quick diagnostic: check a guardian's DB state and class breakdown
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');
const Guardian = require('../models/Guardian');

const gid = process.argv[2];
if (!gid) { console.error('Usage: node scripts/check-guardian-hours.js <guardianId>'); process.exit(1); }

const COUNTABLE = new Set(['attended', 'missed_by_student', 'absent']);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');

  const g = await User.findById(gid).lean();
  if (!g) { console.error('Guardian not found'); process.exit(1); }

  const info = g.guardianInfo || {};
  console.log('\n=== GUARDIAN DB STATE ===');
  console.log('  email:', g.email);
  console.log('  totalHours:', info.totalHours);
  console.log('  autoTotalHours:', info.autoTotalHours);
  console.log('  cumulativeConsumedHours:', info.cumulativeConsumedHours);
  (info.students || []).forEach(s => {
    console.log(`  student ${s.name || s._id}: hoursRemaining=${s.hoursRemaining}`);
  });

  // Guardian model sync
  const gDoc = await Guardian.findOne({ userId: gid }).lean();
  if (gDoc) {
    console.log('  Guardian.totalRemainingMinutes:', gDoc.totalRemainingMinutes);
  }

  // Classes
  const classes = await Class.find({
    'student.guardianId': gid,
    deleted: { $ne: true }
  }).select('student status duration startsAt title billedInInvoiceId').lean();

  const countable = classes.filter(c => COUNTABLE.has(c.status));
  let totalConsumed = 0;
  const byStudent = {};

  console.log('\n=== COUNTABLE CLASSES ===');
  for (const c of countable.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))) {
    const h = Number(c.duration || 0) / 60;
    totalConsumed += h;
    const sid = String(c.student?.studentId || 'unknown');
    byStudent[sid] = (byStudent[sid] || 0) + h;
    console.log(`  ${new Date(c.startsAt).toISOString().slice(0,10)} | ${c.status.padEnd(20)} | ${h.toFixed(2)}h | student=${sid} | billed=${c.billedInInvoiceId || 'no'}`);
  }
  console.log(`\n  TOTAL CONSUMED: ${totalConsumed.toFixed(3)}h (${countable.length} classes)`);
  for (const [sid, h] of Object.entries(byStudent)) {
    console.log(`    student ${sid}: ${h.toFixed(3)}h`);
  }

  // Invoices
  const invoices = await Invoice.find({ guardian: gid, deleted: { $ne: true } }).lean();
  console.log('\n=== INVOICES ===');
  for (const inv of invoices) {
    const logs = inv.paymentLogs || [];
    let paidH = 0;
    for (const l of logs) {
      if (!l || l.amount <= 0) continue;
      if (l.method === 'refund' || l.method === 'tip_distribution') continue;
      paidH += l.paidHours != null ? Number(l.paidHours) : 0;
    }
    const itemH = (inv.items || []).reduce((s, i) => s + (Number(i.duration || 0) / 60), 0);
    console.log(`  ${inv.invoiceNumber} | status=${inv.status} | items=${(inv.items||[]).length} | itemHours=${itemH.toFixed(2)} | paidHours=${paidH.toFixed(2)} | paymentLogs=${logs.length}`);

    // Show each item with its duration and flags
    for (const item of (inv.items || [])) {
      const ih = (Number(item.duration || 0) / 60);
      const flags = [];
      if (item.excludeFromStudentBalance) flags.push('excludeFromStudentBalance');
      if (item.exemptFromGuardian) flags.push('exemptFromGuardian');
      if (item.flags?.notCountForBoth) flags.push('notCountForBoth');
      console.log(`    item: ${ih.toFixed(2)}h | student=${item.student?._id || item.student} | ${flags.length ? flags.join(',') : 'normal'}`);
    }
  }

  console.log('\n=== EXPECTED ===');
  console.log(`  paid=${invoices.reduce((s, inv) => {
    const logs = inv.paymentLogs || [];
    let ph = 0;
    for (const l of logs) {
      if (!l || l.amount <= 0) continue;
      if (l.method === 'refund' || l.method === 'tip_distribution') continue;
      ph += l.paidHours != null ? Number(l.paidHours) : 0;
    }
    return s + ph;
  }, 0).toFixed(2)}h - consumed=${totalConsumed.toFixed(2)}h = ${(invoices.reduce((s, inv) => {
    const logs = inv.paymentLogs || [];
    let ph = 0;
    for (const l of logs) {
      if (!l || l.amount <= 0) continue;
      if (l.method === 'refund' || l.method === 'tip_distribution') continue;
      ph += l.paidHours != null ? Number(l.paidHours) : 0;
    }
    return s + ph;
  }, 0) - totalConsumed).toFixed(2)}h`);

  await mongoose.disconnect();
})();
