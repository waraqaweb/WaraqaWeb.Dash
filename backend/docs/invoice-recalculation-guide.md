# Invoice Recalculation System - Financial Safety Guide

## 🎯 Purpose

This system ensures **financial accuracy** when paid classes are deleted or their status changes. It automatically maintains the correct balance of paid/unpaid classes in invoices to prevent revenue loss or incorrect billing.

## 💰 Critical Scenarios Handled

### Scenario 1: Deleted Paid Class

**Problem:** If a class that was already paid for gets deleted, the guardian loses hours they paid for.

**Solution:** Automatically replace with the next unpaid class chronologically.

**Example:**

- Guardian paid for 5 hours (classes A, B, C, D, E)
- Class C gets deleted
- System automatically adds Class F (next unpaid) to maintain 5 paid hours
- Result: Classes A, B, D, E, F are now marked as paid

### Scenario 2: Class Status Changes (Attended ↔ Cancelled)

#### 2a: Attended → Cancelled

**Problem:** A class that was paid for is cancelled, guardian should get credit back.

**Solution:** Remove from invoice, replace with next unpaid class.

**Example:**

- Invoice has classes A (attended), B (attended), C (attended) - all paid
- Class B status changes to cancelled
- System removes B, adds next unpaid class D
- Result: A, C, D are now paid; guardian gets same value

#### 2b: Cancelled → Attended

**Problem:** A cancelled class is marked attended, should be included in paid classes.

**Solution:** Re-add to invoice (chronological position), remove last unpaid class to keep balance.

**Example:**

- Invoice has classes A, C, D (paid) - B was cancelled earlier
- Class B status changes to attended
- System re-adds B in chronological position (A, B, C)
- Removes D (last unpaid) to maintain 3-class coverage
- Result: A, B, C are paid; D moves to unpaid

## 🛠️ Implementation

### Core Functions

#### 1. `recalculateInvoiceCoverage(invoiceId, opts)`

**Centralized recalculation utility** that handles all scenarios.

```javascript
const result = await InvoiceService.recalculateInvoiceCoverage(invoiceId, {
  trigger: "class_deleted",
  deletedClassId: classId,
  session: mongoSession,
  adminUserId: userId,
});
```

**Key Features:**

- Only processes paid/partially-paid invoices (money involved)
- Finds next unpaid class chronologically
- Maintains audit trail
- Logs warnings when no replacement available

#### 2. `handleClassDeletion(classDoc, opts)`

**Automatic handler** triggered when classes are deleted.

```javascript
const result = await InvoiceService.handleClassDeletion(classDoc, {
  session: mongoSession,
  adminUserId: userId,
});
```

**Process:**

1. Finds all paid invoices containing the deleted class
2. Removes the class from each invoice
3. Triggers recalculation to find replacement
4. Updates audit logs

#### 3. Enhanced `onClassStateChanged(classDoc, prev)`

**Detects status changes** and handles Attended ↔ Cancelled transitions.

**For Attended → Cancelled:**

- Removes class from invoice
- Triggers recalculation for replacement
- Logs status change in audit

**For Cancelled → Attended:**

- Re-adds class in chronological order
- Removes last unpaid class to maintain balance
- Updates coverage flags

### Middleware Integration

**Class Model Hooks:**

```javascript
// In backend/models/Class.js

classSchema.pre(
  "deleteOne",
  { document: true, query: false },
  async function (next) {
    await InvoiceService.handleClassDeletion(this);
    next();
  }
);

classSchema.pre("findOneAndDelete", async function (next) {
  const doc = await this.model.findOne(this.getQuery());
  if (doc) await InvoiceService.handleClassDeletion(doc);
  next();
});
```

## 🔒 Safety Features

### 1. Transaction Safety

All recalculations support MongoDB sessions for atomic operations:

```javascript
const session = await mongoose.startSession();
await session.withTransaction(async () => {
  await InvoiceService.recalculateInvoiceCoverage(invoiceId, { session });
});
```

### 2. Audit Logging

Every recalculation creates audit entries:

- Trigger reason (class_deleted, status_change_cancelled, etc.)
- Deleted/changed class ID
- Replacement class ID and amount
- Financial impact assessment

### 3. Error Handling

- Continues even if no replacement available (logs warning)
- Doesn't block class deletion on recalculation failure
- Marks critical issues for manual review

### 4. Financial Safeguards

- **Read-only on unpaid invoices:** Draft/pending invoices handled separately
- **Coverage validation:** Ensures coverage.maxHours is respected
- **Chronological ordering:** Always picks earliest unpaid classes first
- **Amount verification:** Validates monetary calculations before updates

## 📋 Edge Cases Handled

### 1. No Unpaid Classes Available

**Scenario:** Deleted paid class, but no unpaid classes exist.

**Handling:**

- Logs high-severity warning
- Creates audit entry with `requiresManualReview: true`
- Returns success but sets `noReplacementAvailable: true`
- Does NOT block the deletion

### 2. Class Outside Billing Period

**Scenario:** Replacement class found, but outside invoice billing period.

**Handling:**

- Skips classes outside billing window
- Continues searching for valid replacement
- Logs if no valid replacement found

### 3. Multiple Simultaneous Changes

**Scenario:** Multiple classes deleted/changed at once.

**Handling:**

- Each recalculation is transactional
- MongoDB optimistic locking prevents conflicts
- Retries on version errors

### 4. Partial Coverage

**Scenario:** Invoice only partially covers classes (e.g., 3 hours paid, 5 hours of classes).

**Handling:**

- Correctly identifies which classes are paid vs unpaid
- Only replaces classes that were within coverage
- Maintains correct paid/unpaid boundaries

## 🧪 Testing Checklist

### Test Scenario 1: Deleted Paid Class

- [ ] Create paid invoice with 3 classes
- [ ] Delete middle class (should be paid)
- [ ] Verify replacement class added
- [ ] Verify coverage hours maintained
- [ ] Check audit log

### Test Scenario 2: Attended → Cancelled

- [ ] Mark class as attended in paid invoice
- [ ] Change status to cancelled
- [ ] Verify class removed from invoice
- [ ] Verify replacement added
- [ ] Check guardian balance unchanged

### Test Scenario 3: Cancelled → Attended

- [ ] Have cancelled class NOT in invoice
- [ ] Change status to attended
- [ ] Verify class added to invoice
- [ ] Verify last unpaid class removed
- [ ] Check coverage maintained

### Test Scenario 4: No Replacement Available

- [ ] Delete paid class
- [ ] Ensure no unpaid classes exist
- [ ] Verify warning logged
- [ ] Verify audit entry created
- [ ] Verify deletion not blocked

### Test Scenario 5: Multiple Deletions

- [ ] Delete 2 paid classes simultaneously
- [ ] Verify both replaced correctly
- [ ] Check transaction consistency
- [ ] Verify no duplicate replacements

## 🚨 Monitoring & Alerts

### Key Metrics to Monitor

1. **Replacement Success Rate:** Track `noReplacementAvailable` flags
2. **Recalculation Frequency:** Monitor how often recalcs are triggered
3. **Manual Review Queue:** Track `requiresManualReview` audit entries
4. **Financial Impact:** Sum of amounts in replaced classes

### Alert Conditions

- **Critical:** No replacement available for paid class (check daily)
- **High:** More than 5 recalculations per hour (investigate)
- **Medium:** Replacement class amount differs by >20% (review pricing)

## 🔧 Maintenance

### Regular Tasks

1. **Weekly:** Review audit entries with `requiresManualReview: true`
2. **Monthly:** Analyze recalculation patterns for optimization
3. **Quarterly:** Verify no orphaned classes (in invoices but deleted from Classes collection)

### Troubleshooting

**Issue:** Recalculation not triggering

- Check middleware is registered in Class model
- Verify InvoiceService is properly required
- Check console logs for errors

**Issue:** Wrong class being replaced

- Verify chronological sorting logic
- Check billing period filters
- Validate coverage hour calculations

**Issue:** Duplicate replacements

- Check transaction isolation levels
- Verify optimistic locking is working
- Review concurrent request handling

## 📚 API Reference

### `recalculateInvoiceCoverage(invoiceId, opts)`

**Parameters:**

- `invoiceId` (String|ObjectId): Invoice to recalculate
- `opts.trigger` (String): Reason for recalculation
- `opts.deletedClassId` (ObjectId): ID of deleted class
- `opts.changedClassId` (ObjectId): ID of status-changed class
- `opts.session` (MongoSession): Transaction session
- `opts.adminUserId` (ObjectId): User triggering recalc

**Returns:**

```javascript
{
  success: true,
  replaced: true, // If replacement occurred
  deletedClassId: "...",
  replacementClassId: "...",
  replacementAmount: 25.00,
  paidClassesCount: 5,
  coverageHours: 5.0,
  remainingHours: 0.5
}
```

### `handleClassDeletion(classDoc, opts)`

**Parameters:**

- `classDoc` (Object): The deleted class document
- `opts.session` (MongoSession): Transaction session
- `opts.adminUserId` (ObjectId): User triggering deletion

**Returns:**

```javascript
{
  success: true,
  invoicesProcessed: 2,
  results: [
    { invoiceId: "...", invoiceNumber: "INV-001", recalcResult: {...} },
    { invoiceId: "...", invoiceNumber: "INV-002", recalcResult: {...} }
  ]
}
```

## 🎓 Best Practices

1. **Always use transactions** for financial operations
2. **Log before and after states** for audit trail
3. **Test with real data scenarios** before deploying
4. **Monitor replacement patterns** to catch pricing issues
5. **Review manual flags weekly** to catch edge cases
6. **Document custom triggers** when calling recalculation manually

## 🔗 Related Documentation

- [Invoice Architecture Guide](./guardian-invoice-architecture.md)
- [Coverage System Documentation](./coverage-system.md)
- [Audit Trail Guide](./audit-trail.md)
