require('dotenv').config();
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Class = require('../models/Class');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');

  var invoice = await Invoice.findById('69b81fd52ef48a8564ff2351').lean();
  if (!invoice) { console.log('Invoice not found'); process.exit(1); }

  console.log('=== INVOICE OVERVIEW ===');
  console.log('Status:', invoice.status);
  console.log('Billing period:', JSON.stringify(invoice.billingPeriod));
  console.log('Items:', (invoice.items || []).length);
  console.log('Guardian:', String(invoice.guardian));

  // Print full item fields for first and last items
  var items = invoice.items || [];
  console.log('\n=== FULL ITEM KEYS (first item) ===');
  if (items.length > 0) console.log(Object.keys(items[0]).join(', '));
  
  console.log('\n=== ALL ITEMS (full detail) ===');
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    console.log(i + ':', JSON.stringify({
      _id: it._id ? String(it._id) : null,
      classId: it.classId ? String(it.classId) : null,
      class: it.class ? String(it.class) : null,
      classRef: it.classRef ? String(it.classRef) : null,
      scheduledDate: it.scheduledDate || it.date,
      status: it.status,
      duration: it.duration,
      studentName: it.studentName,
      studentId: it.studentId ? String(it.studentId) : null,
      attended: it.attended,
      description: it.description
    }));
  }

  // Find all classes that reference this invoice
  console.log('\n=== CLASSES REFERENCING THIS INVOICE ===');
  var invoiceId = invoice._id;
  var classes = await Class.find({ billedInInvoiceId: invoiceId }).sort({ scheduledDate: 1 }).lean();
  console.log('Total classes billed to this invoice:', classes.length);
  for (var j = 0; j < classes.length; j++) {
    var cls = classes[j];
    console.log(JSON.stringify({
      _id: String(cls._id),
      status: cls.status,
      scheduledDate: cls.scheduledDate,
      duration: cls.duration,
      studentName: cls.student && cls.student.studentName,
      studentId: cls.student && cls.student.studentId ? String(cls.student.studentId) : null
    }));
  }

  // Find eligible unbilled classes for this guardian after the billing period
  var guardianId = invoice.guardian;
  var COUNTABLE = ['attended', 'missed_by_student', 'absent'];
  var unbilled = await Class.find({
    'student.guardianId': guardianId,
    status: { $in: COUNTABLE },
    billedInInvoiceId: null,
    deleted: { $ne: true }
  }).sort({ scheduledDate: 1 }).lean();
  
  console.log('\n=== UNBILLED COUNTABLE CLASSES FOR GUARDIAN ===');
  console.log('Total unbilled countable:', unbilled.length);
  for (var k = 0; k < unbilled.length; k++) {
    console.log(JSON.stringify({
      _id: String(unbilled[k]._id),
      scheduledDate: unbilled[k].scheduledDate,
      status: unbilled[k].status,
      duration: unbilled[k].duration,
      studentName: unbilled[k].student && unbilled[k].student.studentName,
      studentId: unbilled[k].student && unbilled[k].student.studentId ? String(unbilled[k].student.studentId) : null
    }));
  }

  // Find scheduled classes billed to this invoice
  console.log('\n=== SCHEDULED CLASSES BILLED TO THIS INVOICE ===');
  var scheduledBilled = await Class.find({
    billedInInvoiceId: invoiceId,
    status: 'scheduled'
  }).lean();
  console.log('Scheduled classes with billedInInvoiceId pointing here:', scheduledBilled.length);
  for (var m = 0; m < scheduledBilled.length; m++) {
    console.log(JSON.stringify({
      _id: String(scheduledBilled[m]._id),
      scheduledDate: scheduledBilled[m].scheduledDate,
      studentName: scheduledBilled[m].student && scheduledBilled[m].student.studentName
    }));
  }

  process.exit(0);
}
main().catch(function(e) { console.error(e); process.exit(1); });
