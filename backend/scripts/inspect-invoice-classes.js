require('dotenv').config();
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Class = require('../models/Class');
const User = require('../models/User');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');

  // 1. Inspect the two classes
  var classIds = ['69640c2de33b94ad7e3ec048', '69b806a02ef48a8564ff13e6'];
  console.log('=== CLASSES ===');
  for (var i = 0; i < classIds.length; i++) {
    var cls = await Class.findById(classIds[i]).lean();
    if (!cls) { console.log('Class not found:', classIds[i]); continue; }
    console.log(JSON.stringify({
      _id: String(cls._id),
      status: cls.status,
      scheduledDate: cls.scheduledDate,
      duration: cls.duration,
      studentName: cls.student && cls.student.studentName,
      studentId: cls.student && cls.student.studentId && String(cls.student.studentId),
      guardianId: cls.student && cls.student.guardianId && String(cls.student.guardianId),
      teacherName: cls.teacherName,
      billedInInvoiceId: cls.billedInInvoiceId ? String(cls.billedInInvoiceId) : null,
      deleted: cls.deleted
    }));
  }

  // 2. Inspect the invoice
  var invoiceSlug = 'waraqa-mar-2026-1601-2026';
  var invoice = await Invoice.findOne({ slug: invoiceSlug }).lean();
  if (!invoice) {
    console.log('Invoice not found by slug, trying by URL invoice param');
    invoice = await Invoice.findById('69b81fd52ef48a8564ff2351').lean();
  }
  if (!invoice) { console.log('Invoice not found'); process.exit(1); }

  console.log('\n=== INVOICE ===');
  console.log(JSON.stringify({
    _id: String(invoice._id),
    slug: invoice.slug,
    status: invoice.status,
    guardian: invoice.guardian ? String(invoice.guardian) : null,
    billingPeriod: invoice.billingPeriod,
    totalAmount: invoice.totalAmount,
    totalHours: invoice.totalHours,
    itemCount: invoice.items ? invoice.items.length : 0,
    createdAt: invoice.createdAt,
    paidAt: invoice.paidAt
  }));

  // 3. Show all items in the invoice
  console.log('\n=== INVOICE ITEMS ===');
  var items = invoice.items || [];
  for (var j = 0; j < items.length; j++) {
    var item = items[j];
    console.log(JSON.stringify({
      classId: item.classId ? String(item.classId) : null,
      scheduledDate: item.scheduledDate,
      status: item.status,
      duration: item.duration,
      studentName: item.studentName,
      attended: item.attended
    }));
  }

  // 4. Check: which items are for classes that are still "scheduled" (not yet held)?
  console.log('\n=== SCHEDULED ITEMS IN PAID INVOICE ===');
  var scheduledItems = [];
  for (var k = 0; k < items.length; k++) {
    var it = items[k];
    if (!it.classId) continue;
    var classDoc = await Class.findById(it.classId).lean();
    if (!classDoc) continue;
    if (classDoc.status === 'scheduled') {
      scheduledItems.push({
        classId: String(classDoc._id),
        scheduledDate: classDoc.scheduledDate,
        status: classDoc.status,
        studentName: classDoc.student && classDoc.student.studentName,
        invoiceItemStatus: it.status,
        invoiceItemAttended: it.attended
      });
    }
  }
  console.log('Scheduled classes in this paid invoice:', scheduledItems.length);
  for (var m = 0; m < scheduledItems.length; m++) {
    console.log(JSON.stringify(scheduledItems[m]));
  }

  // 5. Check if there are eligible classes NOT in the invoice (after billing period)
  if (invoice.guardian) {
    var guardianId = invoice.guardian;
    // Find the student from the invoice items
    var studentIds = [];
    for (var n = 0; n < items.length; n++) {
      var sid = items[n].studentId ? String(items[n].studentId) : null;
      if (sid && studentIds.indexOf(sid) === -1) studentIds.push(sid);
    }
    console.log('\n=== ELIGIBLE UNBILLED CLASSES ===');
    var COUNTABLE = ['attended', 'missed_by_student', 'absent'];
    for (var p = 0; p < studentIds.length; p++) {
      var unbilled = await Class.find({
        'student.guardianId': guardianId,
        'student.studentId': new mongoose.Types.ObjectId(studentIds[p]),
        status: { $in: COUNTABLE },
        billedInInvoiceId: null,
        deleted: { $ne: true }
      }).sort({ scheduledDate: 1 }).lean();
      if (unbilled.length > 0) {
        console.log('Student', studentIds[p], '- unbilled countable classes:', unbilled.length);
        for (var q = 0; q < Math.min(unbilled.length, 10); q++) {
          console.log('  ', JSON.stringify({
            _id: String(unbilled[q]._id),
            scheduledDate: unbilled[q].scheduledDate,
            status: unbilled[q].status,
            duration: unbilled[q].duration
          }));
        }
        if (unbilled.length > 10) console.log('  ... and', unbilled.length - 10, 'more');
      }
    }
  }

  process.exit(0);
}
main().catch(function(e) { console.error(e); process.exit(1); });
