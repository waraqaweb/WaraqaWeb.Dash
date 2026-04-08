// Quick inspect script for guardian 696360fd5e85608fd2216371
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');
  const Class = require('./models/Class');
  const Invoice = require('./models/Invoice');
  const User = require('./models/User');

  // The specific class
  const cls = await Class.findById('69b184fa5727102e2774e050').lean();
  console.log('=== CLASS 69b184fa5727102e2774e050 ===');
  console.log('  status:', cls?.status);
  console.log('  duration:', cls?.duration, 'min');
  console.log('  scheduledDate:', cls?.scheduledDate);
  console.log('  subject:', cls?.subject);
  console.log('  student:', cls?.student?.studentName);
  console.log('  billedInInvoiceId:', cls?.billedInInvoiceId);

  // The specific invoice
  const inv = await Invoice.findById('69ba8615b4f70197c08b0272').lean();
  console.log('\n=== INVOICE 69ba8615b4f70197c08b0272 ===');
  console.log('  status:', inv?.status);
  console.log('  total:', inv?.total);
  console.log('  paidAmount:', inv?.paidAmount);
  console.log('  billingPeriod:', JSON.stringify(inv?.billingPeriod));
  console.log('  items:', (inv?.items || []).length);
  for (const item of (inv?.items || [])) {
    const cid = item.class ? String(item.class) : item.lessonId;
    console.log(`    classId=${cid} duration=${item.duration}min amount=$${item.amount} status=${item.status} attended=${item.attended} date=${item.date}`);
  }
  console.log('  paymentLogs:');
  for (const l of (inv?.paymentLogs || [])) {
    console.log(`    method=${l.method} amount=${l.amount} paidHours=${l.paidHours}`);
  }
  console.log('  adjustments:', JSON.stringify(inv?.adjustments || []));

  // All invoices for this guardian
  const allInvs = await Invoice.find({ guardian: '696360fd5e85608fd2216371', deleted: { $ne: true } }).lean();
  console.log('\n=== ALL INVOICES ===');
  for (const i of allInvs) {
    const itemH = (i.items || []).reduce((s, it) => s + (Number(it.duration || 0) / 60), 0);
    let paidH = 0;
    for (const l of (i.paymentLogs || [])) {
      if (!l || l.amount <= 0) continue;
      if (l.method === 'refund' || l.method === 'tip_distribution') continue;
      paidH += l.paidHours != null ? Number(l.paidHours) : 0;
    }
    console.log(`  ${i.invoiceNumber || i._id} | status=${i.status} | items=${(i.items||[]).length} | itemHours=${itemH.toFixed(2)} | paidHours=${paidH.toFixed(2)}`);
  }

  // Guardian data
  const g = await User.findById('696360fd5e85608fd2216371').select('guardianInfo.totalHours guardianInfo.students firstName lastName').lean();
  console.log('\n=== GUARDIAN DB STATE ===');
  console.log('  name:', g?.firstName, g?.lastName);
  console.log('  totalHours:', g?.guardianInfo?.totalHours);
  for (const s of (g?.guardianInfo?.students || [])) {
    console.log(`  student ${s.name || s._id}: hoursRemaining=${s.hoursRemaining}`);
  }

  // All countable classes
  const COUNTABLE = new Set(['attended', 'missed_by_student', 'absent']);
  const classes = await Class.find({
    'student.guardianId': '696360fd5e85608fd2216371',
    deleted: { $ne: true }
  }).select('student status duration scheduledDate billedInInvoiceId subject').sort({ scheduledDate: 1 }).lean();

  const countable = classes.filter(c => COUNTABLE.has(c.status));
  console.log('\n=== COUNTABLE CLASSES ===');
  let totalH = 0;
  for (const c of countable) {
    const h = Number(c.duration || 0) / 60;
    totalH += h;
    const d = c.scheduledDate ? new Date(c.scheduledDate).toISOString().slice(0, 10) : '?';
    console.log(`  ${d} | ${c.status.padEnd(20)} | ${h.toFixed(2)}h | billed=${c.billedInInvoiceId || 'no'} | ${c.subject || ''}`);
  }
  console.log(`  TOTAL: ${totalH.toFixed(2)}h (${countable.length} classes)`);

  await mongoose.disconnect();
})();
