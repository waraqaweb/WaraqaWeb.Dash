// Find consumed classes NOT in any invoice for a guardian
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

  // All invoices (paid + unpaid)
  const invoices = await Invoice.find({ guardian: guardianId, deleted: { $ne: true } }).lean();

  // Build set of all class IDs that are in any invoice item
  const billedClassIds = new Set();
  for (const inv of invoices) {
    for (const item of (inv.items || [])) {
      const cid = item.class ? String(item.class) : item.lessonId ? String(item.lessonId) : null;
      if (cid) billedClassIds.add(cid);
    }
  }

  console.log(`Guardian: ${guardianId}`);
  console.log(`Total countable classes: ${classes.length}`);
  console.log(`Total billed class IDs across all invoices: ${billedClassIds.size}\n`);

  // Per-student breakdown
  const byStudent = {};
  let unbilledTotal = 0;

  for (const c of classes) {
    const sid = c.student?.studentId || c.student?._id;
    const sname = c.student?.studentName || `${c.student?.firstName || ''} ${c.student?.lastName || ''}`.trim();
    const key = String(sid);
    if (!byStudent[key]) byStudent[key] = { name: sname, paid: 0, unpaid: 0, unbilled: 0, classes: [] };

    const classId = String(c._id);
    const inBilled = billedClassIds.has(classId);
    const billedInvoice = c.billedInInvoiceId ? String(c.billedInInvoiceId) : null;

    // Find which invoice this class is in (if any)
    let invoiceStatus = null;
    if (billedInvoice) {
      const inv = invoices.find(i => String(i._id) === billedInvoice);
      invoiceStatus = inv?.status || 'unknown';
    } else if (inBilled) {
      // Find it by searching invoice items
      for (const inv of invoices) {
        for (const item of (inv.items || [])) {
          const cid = item.class ? String(item.class) : item.lessonId ? String(item.lessonId) : null;
          if (cid === classId) {
            invoiceStatus = inv.status;
            break;
          }
        }
        if (invoiceStatus) break;
      }
    }

    const hours = (c.duration || 0) / 60;
    const date = c.scheduledDate ? new Date(c.scheduledDate).toISOString().slice(0, 10) : '?';

    if (invoiceStatus === 'paid') {
      byStudent[key].paid += hours;
    } else if (invoiceStatus) {
      byStudent[key].unpaid += hours;
    } else {
      byStudent[key].unbilled += hours;
      unbilledTotal += hours;
      byStudent[key].classes.push({
        classId,
        date,
        status: c.status,
        duration: c.duration,
        subject: c.subject || '',
        billedInInvoiceId: billedInvoice,
        foundInInvoice: inBilled,
      });
    }
  }

  console.log('=== PER-STUDENT BREAKDOWN ===');
  for (const [sid, data] of Object.entries(byStudent)) {
    console.log(`\nStudent: ${data.name} (${sid})`);
    console.log(`  In paid invoices: ${data.paid.toFixed(2)}h`);
    console.log(`  In unpaid invoices: ${data.unpaid.toFixed(2)}h`);
    console.log(`  NOT in any invoice: ${data.unbilled.toFixed(2)}h`);
    if (data.classes.length > 0) {
      console.log('  Unbilled classes:');
      for (const c of data.classes) {
        console.log(`    ${c.date} | ${c.status} | ${c.duration}min | ${c.subject} | classId=${c.classId} | billedInInvoiceId=${c.billedInInvoiceId}`);
      }
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total unbilled consumed hours: ${unbilledTotal.toFixed(2)}h`);
  console.log(`This explains the gap between expected (-2.5h from unpaid invoice) and actual (-4.5h)`);

  // Also show all invoices for reference
  console.log('\n=== ALL INVOICES ===');
  for (const inv of invoices) {
    const itemH = (inv.items || []).reduce((s, it) => s + (Number(it.duration || 0) / 60), 0);
    console.log(`  ${inv.invoiceNumber || inv._id} | status=${inv.status} | items=${(inv.items||[]).length} | itemHours=${itemH.toFixed(2)}h`);
  }

  await mongoose.disconnect();
})();
