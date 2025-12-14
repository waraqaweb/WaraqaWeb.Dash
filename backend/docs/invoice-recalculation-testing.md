# Invoice Recalculation Testing Guide

## 🧪 Quick Testing Scripts

### Test 1: Verify Recalculation Function Works

```javascript
// In Node.js console or test file
const mongoose = require("mongoose");
const InvoiceService = require("./services/invoiceService");

// Replace with actual invoice ID that has paid status
const invoiceId = "67xxxxxxxxxxxxx";

async function testRecalculation() {
  try {
    const result = await InvoiceService.recalculateInvoiceCoverage(invoiceId, {
      trigger: "manual_test",
      adminUserId: null,
    });

    console.log("✅ Recalculation Result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

testRecalculation();
```

### Test 2: Simulate Class Deletion

```javascript
const Class = require("./models/Class");
const InvoiceService = require("./services/invoiceService");

async function testClassDeletion() {
  // Find a class that's in a paid invoice
  const classToDelete = await Class.findOne({
    billedInInvoiceId: { $exists: true },
    status: "attended",
  });

  if (!classToDelete) {
    console.log("No suitable class found for testing");
    return;
  }

  console.log(`Testing deletion of class ${classToDelete._id}`);

  // Test the handler (without actually deleting)
  const result = await InvoiceService.handleClassDeletion(classToDelete);

  console.log("✅ Deletion Handler Result:", JSON.stringify(result, null, 2));
}

testClassDeletion();
```

### Test 3: Test Status Change (Attended → Cancelled)

```javascript
const Class = require("./models/Class");
const InvoiceService = require("./services/invoiceService");

async function testStatusChange() {
  // Find an attended class in a paid invoice
  const attendedClass = await Class.findOne({
    status: "attended",
    billedInInvoiceId: { $exists: true },
  });

  if (!attendedClass) {
    console.log("No attended class found");
    return;
  }

  console.log(`Testing status change for class ${attendedClass._id}`);

  // Save original status
  const originalStatus = attendedClass.status;

  // Simulate status change
  const prevState = { status: originalStatus };
  attendedClass.status = "cancelled_by_teacher";

  const result = await InvoiceService.onClassStateChanged(
    attendedClass,
    prevState
  );

  console.log("✅ Status Change Result:", JSON.stringify(result, null, 2));

  // Restore original status (important!)
  attendedClass.status = originalStatus;
  await attendedClass.save();
}

testStatusChange();
```

## 🎯 Manual Testing Scenarios

### Scenario A: Delete Paid Class with Replacement Available

**Setup:**

1. Find a paid invoice with at least 3 classes
2. Verify coverage.maxHours covers all classes
3. Identify one class in the middle (chronologically)
4. Ensure there are unpaid classes available for same guardian

**Steps:**

1. Note the invoice number and total
2. Note which classes are marked `paidByGuardian: true`
3. Delete the middle class using MongoDB or API
4. Check console logs for recalculation messages
5. Verify invoice now has different class in that position
6. Verify total paid classes count unchanged
7. Check audit log for replacement entry

**Expected Result:**

- Deleted class removed from invoice
- Next unpaid class added automatically
- Coverage hours maintained
- Audit entry created with `action: 'class_replaced'`

### Scenario B: Delete Paid Class with NO Replacement

**Setup:**

1. Find a paid invoice where all guardian's classes are billed
2. Verify no unpaid classes available

**Steps:**

1. Delete one of the paid classes
2. Check console logs for warning messages
3. Check invoice - class should be removed
4. Check audit log for warning entry

**Expected Result:**

- Class removed from invoice
- Warning logged: "No unpaid classes available"
- Audit entry with `requiresManualReview: true`
- Deletion NOT blocked

### Scenario C: Status Change Attended → Cancelled

**Setup:**

1. Find a paid invoice with attended class
2. Note the invoice total and class count

**Steps:**

1. Change class status to `cancelled_by_teacher`
2. Trigger `onClassStateChanged` (happens automatically)
3. Check invoice - cancelled class should be removed
4. Verify new unpaid class added
5. Check guardian hours updated correctly

**Expected Result:**

- Cancelled class removed
- Replacement class added
- Invoice total adjusted correctly
- Guardian doesn't lose paid hours

### Scenario D: Status Change Cancelled → Attended

**Setup:**

1. Find a cancelled class NOT in any invoice
2. Find related paid invoice for same guardian

**Steps:**

1. Change class status to `attended`
2. Trigger `onClassStateChanged`
3. Check invoice - class should be re-added chronologically
4. Verify last unpaid class removed to maintain balance

**Expected Result:**

- Attended class re-added to invoice
- Positioned chronologically
- Last unpaid class removed
- Coverage balance maintained

## 🔍 Verification Queries

### Check Invoice Class Coverage

```javascript
const Invoice = require("./models/Invoice");

async function checkCoverage(invoiceId) {
  const invoice = await Invoice.findById(invoiceId);
  const coverageHours = invoice.coverage?.maxHours || 0;

  let totalHours = 0;
  const paidClasses = [];

  // Sort items chronologically
  const sorted = invoice.items
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  for (const item of sorted) {
    const itemHours = (item.duration || 0) / 60;
    if (totalHours + itemHours <= coverageHours + 0.001) {
      paidClasses.push({
        classId: item.class,
        description: item.description,
        hours: itemHours,
        date: item.date,
      });
      totalHours += itemHours;
    } else {
      break;
    }
  }

  console.log("Coverage Hours:", coverageHours);
  console.log("Paid Classes Count:", paidClasses.length);
  console.log("Total Paid Hours:", totalHours);
  console.log("Paid Classes:", paidClasses);
}
```

### Check Audit Trail

```javascript
const InvoiceAudit = require("./models/InvoiceAudit");

async function checkAuditTrail(invoiceId) {
  const audits = await InvoiceAudit.find({ invoiceId })
    .sort({ timestamp: -1 })
    .limit(10);

  console.log("Recent Audit Entries:");
  audits.forEach((audit) => {
    console.log(`- ${audit.timestamp}: ${audit.action}`);
    if (audit.action === "class_replaced") {
      console.log(`  Deleted: ${audit.diff.deletedClassId}`);
      console.log(`  Replacement: ${audit.diff.replacementClassId}`);
    }
  });
}
```

### Find Invoices Needing Manual Review

```javascript
const InvoiceAudit = require("./models/InvoiceAudit");

async function findManualReviewNeeded() {
  const audits = await InvoiceAudit.find({
    "meta.requiresManualReview": true,
    action: "recalculation_warning",
  }).populate("invoiceId");

  console.log(`Found ${audits.length} invoices needing manual review`);

  audits.forEach((audit) => {
    console.log(`Invoice: ${audit.invoiceId.invoiceNumber}`);
    console.log(`Issue: ${audit.diff.issue}`);
    console.log(`Coverage: ${audit.diff.coverageHours}h`);
  });
}
```

## 🐛 Debugging Tips

### Enable Detailed Logging

Add this to your test environment:

```javascript
process.env.DEBUG_INVOICE_RECALC = "true";
```

### Check Middleware Is Active

```javascript
// Should see these logs when deleting classes
console.log(Class.schema.s.hooks._pres.get("deleteOne")); // Should not be empty
console.log(Class.schema.s.hooks._pres.get("findOneAndDelete")); // Should not be empty
```

### Verify Coverage Sync

```javascript
const InvoiceService = require("./services/invoiceService");

async function testCoverageSync(invoiceId) {
  const Invoice = require("./models/Invoice");
  const invoice = await Invoice.findById(invoiceId);

  console.log("Before sync:");
  console.log("- Coverage Hours:", invoice.coverage?.maxHours);
  console.log("- Item Count:", invoice.items.length);

  await InvoiceService.syncInvoiceCoverageClasses(invoice);

  console.log("✅ Coverage sync completed");

  // Check Class documents for paidByGuardian flags
  const Class = require("./models/Class");
  const classIds = invoice.items.map((it) => it.class).filter(Boolean);
  const classes = await Class.find({ _id: { $in: classIds } });

  const paidCount = classes.filter((c) => c.paidByGuardian).length;
  console.log("- Paid Classes in DB:", paidCount);
}
```

## 📊 Performance Testing

### Test Concurrent Deletions

```javascript
async function testConcurrentDeletions() {
  const classIds = ["id1", "id2", "id3"]; // Replace with actual IDs

  const promises = classIds.map((id) =>
    InvoiceService.handleClassDeletion({ _id: id })
  );

  const results = await Promise.all(promises);

  console.log("Concurrent deletion results:", results);
  // Check for conflicts or errors
}
```

### Monitor Recalculation Performance

```javascript
async function benchmarkRecalculation(invoiceId) {
  const start = Date.now();

  await InvoiceService.recalculateInvoiceCoverage(invoiceId, {
    trigger: "benchmark",
  });

  const elapsed = Date.now() - start;
  console.log(`Recalculation took ${elapsed}ms`);

  if (elapsed > 1000) {
    console.warn("⚠️  Recalculation is slow, consider optimization");
  }
}
```

## ✅ Test Completion Checklist

- [ ] Recalculation function accessible and runs without errors
- [ ] Class deletion triggers middleware correctly
- [ ] Replacement class added when available
- [ ] Warning logged when no replacement available
- [ ] Audit entries created for all operations
- [ ] Coverage hours maintained correctly
- [ ] Guardian balance unchanged after replacement
- [ ] Status change Attended → Cancelled works
- [ ] Status change Cancelled → Attended works
- [ ] Transaction rollback works on error
- [ ] Concurrent operations handled safely
- [ ] Performance acceptable (<500ms per recalc)

## 🚀 Production Readiness

Before deploying to production:

1. **Run full test suite** against staging data
2. **Backup production database** before deployment
3. **Monitor first 24 hours** closely for errors
4. **Review audit logs** daily for first week
5. **Set up alerts** for `requiresManualReview` flags
6. **Document any edge cases** discovered
7. **Train support team** on manual review process

## 📞 Support

If issues arise:

1. Check audit logs first (`InvoiceAudit` collection)
2. Review console logs for error messages
3. Verify middleware is registered
4. Check transaction isolation settings
5. Contact backend team with invoice ID and timestamp
