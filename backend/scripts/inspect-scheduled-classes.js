require('dotenv').config();
const mongoose = require('mongoose');
const Class = require('../models/Class');
const ClassReport = require('../models/ClassReport');
const Invoice = require('../models/Invoice');

const CLASS_IDS = [
  '699ee10bc5432a1df0007891',
  '699ee10bc5432a1df0007899',
  '6995eacdc3fa30ad10b2ed77'
];
const INVOICE_ID = '69ca9831e0d3ffaac507d2c8';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  console.log('=== CLASSES ===');
  for (const id of CLASS_IDS) {
    const c = await Class.findById(id).lean();
    if (!c) { console.log(id, '— NOT FOUND'); continue; }
    console.log(id, {
      status: c.status,
      scheduledDate: c.scheduledDate,
      duration: c.duration,
      subject: c.subject,
      studentName: c.student?.studentName,
      teacherName: c.teacher?.teacherName,
      billedInInvoiceId: c.billedInInvoiceId ? String(c.billedInInvoiceId) : null,
      classReportId: c.classReportId ? String(c.classReportId) : null,
      recurring: c.recurringGroupId ? true : false
    });
    // Check if there's a class report for this class
    const report = await ClassReport.findOne({ classId: id }).lean();
    console.log('  report:', report ? { _id: String(report._id), status: report.status, createdAt: report.createdAt } : 'NONE');
  }

  console.log('\n=== INVOICE ===');
  const inv = await Invoice.findById(INVOICE_ID).lean();
  console.log('Invoice:', { status: inv.status, slug: inv.slug, totalAmount: inv.totalAmount, paidAmount: inv.paidAmount, itemCount: (inv.items||[]).length });
  console.log('Billing:', { start: inv.billingPeriod?.startDate, end: inv.billingPeriod?.endDate, month: inv.billingPeriod?.month, year: inv.billingPeriod?.year });

  // Show only the affected items
  const items = inv.items || [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const classRef = it.class ? String(it.class) : (it.lessonId || null);
    const isTarget = CLASS_IDS.includes(classRef);
    if (isTarget || it.status === 'scheduled') {
      console.log(`  item[${i}]:`, {
        class: classRef,
        status: it.status,
        attended: it.attended,
        date: it.date,
        duration: it.duration,
        student: it.description?.substring(0, 40),
        amount: it.amount
      });
    }
  }

  // Check how many countable classes exist for same students in same period that are NOT billed
  const guardian = inv.guardian ? String(inv.guardian) : null;
  console.log('\n=== GUARDIAN:', guardian, '===');

  // Get all classes for this guardian's students in the billing period
  const start = inv.billingPeriod?.startDate;
  const end = inv.billingPeriod?.endDate;
  const allClasses = await Class.find({
    'student.guardianId': guardian ? new mongoose.Types.ObjectId(guardian) : null,
    scheduledDate: { $gte: start, $lte: end }
  }).select('status scheduledDate duration student.studentName billedInInvoiceId subject').sort('scheduledDate').lean();

  console.log('Total classes in period:', allClasses.length);
  const unbilled = allClasses.filter(c => !c.billedInInvoiceId && ['attended','missed_by_student','absent'].includes(c.status));
  console.log('Unbilled countable in period:', unbilled.length);
  unbilled.forEach(c => {
    console.log('  ', String(c._id), c.status, c.scheduledDate, c.student?.studentName, c.duration + 'min');
  });

  const stillScheduled = allClasses.filter(c => c.status === 'scheduled');
  console.log('Still scheduled in period:', stillScheduled.length);
  stillScheduled.forEach(c => {
    console.log('  ', String(c._id), c.scheduledDate, c.student?.studentName, 'billed:', c.billedInInvoiceId ? String(c.billedInInvoiceId) : 'no');
  });

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
