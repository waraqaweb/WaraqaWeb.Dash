// Detailed class-by-class breakdown for a guardian
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');
  const Class = require('../models/Class');
  const Invoice = require('../models/Invoice');

  const guardianId = process.argv[2] || '69596d8ead2e3bb3fb0981b0';

  // All countable classes
  const COUNTABLE = new Set(['attended', 'missed_by_student', 'absent']);
  const classes = await Class.find({
    'student.guardianId': guardianId,
    status: { $in: Array.from(COUNTABLE) },
    deleted: { $ne: true }
  }).select('student status duration scheduledDate subject billedInInvoiceId').sort({ scheduledDate: 1 }).lean();

  // All invoices
  const invoices = await Invoice.find({ guardian: guardianId, deleted: { $ne: true } }).lean();
  const invMap = new Map(invoices.map(i => [String(i._id), i]));

  // Build map: classId -> invoice item info
  const classToInvItem = new Map();
  for (const inv of invoices) {
    for (const item of (inv.items || [])) {
      const cid = item.class ? String(item.class) : item.lessonId ? String(item.lessonId) : null;
      if (cid) {
        classToInvItem.set(cid, {
          invoiceId: String(inv._id),
          invoiceNumber: inv.invoiceNumber,
          invoiceStatus: inv.status,
          itemDuration: item.duration,
        });
      }
    }
  }

  const summary = { paidCredit: {}, consumed: {}, inPaidItems: {}, inUnpaidItems: {} };

  console.log('=== ALL CONSUMED CLASSES (chronological) ===');
  for (const c of classes) {
    const sid = String(c.student?.studentId || c.student?._id || '?');
    const sname = c.student?.studentName || 'unknown';
    const date = c.scheduledDate ? new Date(c.scheduledDate).toISOString().slice(0, 16) : '?';
    const hours = (c.duration || 0) / 60;
    const classId = String(c._id);

    // Check billedInInvoiceId
    const billedInv = c.billedInInvoiceId ? invMap.get(String(c.billedInInvoiceId)) : null;
    // Check if in items
    const itemInfo = classToInvItem.get(classId);

    const invStatus = billedInv?.status || itemInfo?.invoiceStatus || 'NONE';
    const invNum = billedInv?.invoiceNumber || itemInfo?.invoiceNumber || '-';

    console.log(`  ${date} | ${sname.padEnd(15)} | ${c.status.padEnd(20)} | ${c.duration}min | inv=${invNum} (${invStatus}) | hasItem=${!!itemInfo} | billedIn=${c.billedInInvoiceId || 'null'} | classId=${classId}`);

    if (!summary.consumed[sname]) summary.consumed[sname] = 0;
    summary.consumed[sname] += hours;
  }

  // Count paid invoice items per student
  console.log('\n=== PAID INVOICE ITEMS (what buildPaidInvoiceAllocations counts) ===');
  for (const inv of invoices) {
    if (inv.status !== 'paid') continue;
    console.log(`\nInvoice ${inv.invoiceNumber} (${inv.status}):`);
    for (const item of (inv.items || [])) {
      const sid = String(item.student);
      // Find student name from classes
      const cls = classes.find(c => String(c.student?.studentId) === sid || String(c.student?._id) === sid);
      const sname = cls?.student?.studentName || sid;
      const cid = item.class ? String(item.class) : item.lessonId ? String(item.lessonId) : null;
      console.log(`  ${sname.padEnd(15)} | ${item.duration}min | classId=${cid || 'null'}`);
      if (!summary.paidCredit[sname]) summary.paidCredit[sname] = 0;
      summary.paidCredit[sname] += (item.duration || 0) / 60;
    }
  }

  // Unpaid invoice items
  console.log('\n=== OVERDUE/UNPAID INVOICE ITEMS ===');
  for (const inv of invoices) {
    if (inv.status === 'paid' || inv.status === 'cancelled' || inv.status === 'refunded') continue;
    console.log(`\nInvoice ${inv.invoiceNumber || inv._id} (${inv.status}):`);
    for (const item of (inv.items || [])) {
      const sid = String(item.student);
      const cls = classes.find(c => String(c.student?.studentId) === sid || String(c.student?._id) === sid);
      const sname = cls?.student?.studentName || sid;
      const cid = item.class ? String(item.class) : item.lessonId ? String(item.lessonId) : null;
      // Check if this class is consumed
      const isConsumed = cid ? classes.some(c => String(c._id) === cid) : false;
      console.log(`  ${sname.padEnd(15)} | ${item.duration}min | status=${item.status || '?'} | classId=${cid || 'null'} | consumed=${isConsumed}`);
    }
  }

  console.log('\n=== FINAL TALLY ===');
  for (const name of Object.keys(summary.consumed)) {
    const credit = summary.paidCredit[name] || 0;
    const consumed = summary.consumed[name] || 0;
    console.log(`${name}: credit=${credit}h consumed=${consumed}h remaining=${(credit - consumed).toFixed(2)}h`);
  }

  await mongoose.disconnect();
})();
