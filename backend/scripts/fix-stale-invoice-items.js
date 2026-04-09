require('dotenv').config();
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Class = require('../models/Class');

// Statuses that count as "held" — the class actually happened
var COUNTABLE = new Set(['attended', 'missed_by_student', 'absent']);
// Statuses that mean the class was cancelled
var CANCELLED = new Set(['cancelled', 'cancelled_by_teacher', 'cancelled_by_student', 'cancelled_by_admin', 'cancelled_emergency']);

async function main() {
  var dryRun = process.argv.indexOf('--fix') === -1;
  if (dryRun) {
    console.log('=== DRY RUN (pass --fix to apply changes) ===\n');
  } else {
    console.log('=== APPLYING FIXES ===\n');
  }

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');

  // Find all paid invoices
  var invoices = await Invoice.find({ status: 'paid' }).lean();
  console.log('Total paid invoices:', invoices.length);

  var totalStaleItems = 0;
  var totalFixedItems = 0;
  var totalInvoicesAffected = 0;
  var issues = [];

  for (var i = 0; i < invoices.length; i++) {
    var invoice = invoices[i];
    var items = invoice.items || [];
    var staleItems = [];

    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      var classRef = item.class || item.classId || item.lessonId;
      if (!classRef) continue;

      // Only check items that show as scheduled in the invoice
      if (item.status !== 'scheduled') continue;

      // Look up the actual class
      var classDoc = await Class.findById(classRef).select('status scheduledDate duration student').lean();
      if (!classDoc) continue;

      if (COUNTABLE.has(classDoc.status)) {
        // Class was attended but invoice item still says scheduled
        staleItems.push({
          itemIndex: j,
          itemId: item._id ? String(item._id) : null,
          classId: String(classRef),
          invoiceItemStatus: item.status,
          actualClassStatus: classDoc.status,
          scheduledDate: classDoc.scheduledDate,
          studentName: classDoc.student && classDoc.student.studentName,
          action: 'update_to_attended'
        });
      } else if (CANCELLED.has(classDoc.status)) {
        // Class was cancelled but invoice item still says scheduled
        staleItems.push({
          itemIndex: j,
          itemId: item._id ? String(item._id) : null,
          classId: String(classRef),
          invoiceItemStatus: item.status,
          actualClassStatus: classDoc.status,
          scheduledDate: classDoc.scheduledDate,
          studentName: classDoc.student && classDoc.student.studentName,
          action: 'remove_cancelled'
        });
      } else if (classDoc.status === 'scheduled') {
        // Class is STILL scheduled — check if the date has passed
        var now = new Date();
        if (classDoc.scheduledDate && new Date(classDoc.scheduledDate) < now) {
          staleItems.push({
            itemIndex: j,
            itemId: item._id ? String(item._id) : null,
            classId: String(classRef),
            invoiceItemStatus: item.status,
            actualClassStatus: classDoc.status,
            scheduledDate: classDoc.scheduledDate,
            studentName: classDoc.student && classDoc.student.studentName,
            action: 'past_still_scheduled'
          });
        }
      }
    }

    if (staleItems.length > 0) {
      totalInvoicesAffected++;
      totalStaleItems += staleItems.length;

      console.log('\nInvoice:', String(invoice._id), '| slug:', invoice.slug || 'N/A', '| items:', items.length, '| stale:', staleItems.length);
      for (var k = 0; k < staleItems.length; k++) {
        var si = staleItems[k];
        console.log('  [' + si.itemIndex + ']', si.action, '| class:', si.classId, '| date:', si.scheduledDate, '| invoice says:', si.invoiceItemStatus, '| class is:', si.actualClassStatus, '| student:', si.studentName);
      }

      if (!dryRun) {
        // Build update operations
        var updateOps = {};
        var pullClassIds = [];

        for (var m = 0; m < staleItems.length; m++) {
          var fix = staleItems[m];
          if (fix.action === 'update_to_attended') {
            var prefix = 'items.' + fix.itemIndex;
            updateOps[prefix + '.status'] = fix.actualClassStatus;
            updateOps[prefix + '.attended'] = true;
            updateOps[prefix + '.attendanceStatus'] = fix.actualClassStatus;
            totalFixedItems++;
          } else if (fix.action === 'remove_cancelled') {
            pullClassIds.push(new mongoose.Types.ObjectId(fix.classId));
            // Also unlink the class
            await Class.updateOne({ _id: fix.classId }, { $unset: { billedInInvoiceId: 1 } });
            totalFixedItems++;
          }
          // 'past_still_scheduled' — report only, don't auto-fix
        }

        if (Object.keys(updateOps).length > 0) {
          await Invoice.updateOne({ _id: invoice._id }, { $set: updateOps });
          console.log('  -> Updated', Object.keys(updateOps).length / 3, 'items to attended');
        }

        if (pullClassIds.length > 0) {
          // Remove cancelled items by their class reference
          for (var r = 0; r < pullClassIds.length; r++) {
            await Invoice.updateOne(
              { _id: invoice._id },
              { $pull: { items: { class: pullClassIds[r] } } }
            );
          }
          console.log('  -> Removed', pullClassIds.length, 'cancelled items');
        }
      }

      issues.push({
        invoiceId: String(invoice._id),
        slug: invoice.slug,
        staleCount: staleItems.length,
        details: staleItems
      });
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('Paid invoices scanned:', invoices.length);
  console.log('Invoices with stale items:', totalInvoicesAffected);
  console.log('Total stale items found:', totalStaleItems);
  if (!dryRun) {
    console.log('Total items fixed:', totalFixedItems);
  } else {
    console.log('(Dry run — no changes made. Pass --fix to apply.)');
  }

  process.exit(0);
}
main().catch(function(e) { console.error(e); process.exit(1); });
