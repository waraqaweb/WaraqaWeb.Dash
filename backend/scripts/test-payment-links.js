#!/usr/bin/env node
// backend/scripts/test-payment-links.js
// ============================================================
// Automated test suite for the PaymentLink credit-pool system.
//
// Prerequisites:
//   1. MongoDB running locally
//   2. Run  node backend/scripts/seed-payment-link-test.js  first
//
// Usage:
//   node backend/scripts/test-payment-links.js
//
// Tests:
//   1. Initial full re-map for all 3 guardians
//   2. Validation: no invoice over-allocated
//   3. Scenario A: class duration extended (1h → 1.5h) re-map
//   4. Scenario B: class deleted → credit freed, downstream re-allocated
//   5. Scenario C: new class inserted → re-map shifts coverage
//   6. Scenario D: invoice paid → formerly-uncovered classes get credit
//   7. Scenario E: class cancelled → freed hours cover next class
//   8. Guardian balance summary report
// ============================================================

const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');
const PaymentLink = require('../models/PaymentLink');
const {
  slideAndReMap,
  fullReMap,
  onClassChanged,
  onInvoicePaid,
  getLinksForInvoice,
  getInvoiceCreditSummary,
  isClassCovered,
  validateGuardianAllocations
} = require('../services/paymentLinkService');

const TEST_DB = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb_test';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL: ${label}`);
  }
}

function assertApprox(actual, expected, label, tolerance = 0.01) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    passed++;
    console.log(`  ✅ ${label}  (${actual})`);
  } else {
    failed++;
    console.log(`  ❌ FAIL: ${label}  (expected ${expected}, got ${actual})`);
  }
}

function section(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

async function printInvoiceSummary(invoiceId, label) {
  const summary = await getInvoiceCreditSummary(invoiceId);
  if (!summary) {
    console.log(`    ${label}: [not found]`);
    return summary;
  }
  console.log(`    ${label}: credit=${summary.creditHours}h | confirmed=${summary.confirmedHours}h | projected=${summary.projectedHours}h | remaining=${summary.remainingHours}h`);
  return summary;
}

// ============================================================
async function main() {
  console.log(`\n🔗 Connecting to ${TEST_DB} …`);
  await mongoose.connect(TEST_DB);
  console.log('✅ Connected\n');

  // Verify seed data exists
  const userCount = await User.countDocuments();
  const classCount = await Class.countDocuments();
  const invoiceCount = await Invoice.countDocuments();
  console.log(`📊 Found: ${userCount} users, ${invoiceCount} invoices, ${classCount} classes`);

  if (classCount === 0 || invoiceCount === 0) {
    console.error('\n❌ No seed data! Run first: node backend/scripts/seed-payment-link-test.js');
    process.exit(1);
  }

  // Load references
  const guardianA = await User.findOne({ email: 'mariam@test.waraqa.co' });
  const guardianB = await User.findOne({ email: 'khaled@test.waraqa.co' });
  const guardianC = await User.findOne({ email: 'fatima@test.waraqa.co' });

  const invA1 = await Invoice.findOne({ invoiceNumber: 'TEST-A1' });
  const invA2 = await Invoice.findOne({ invoiceNumber: 'TEST-A2' });
  const invA3 = await Invoice.findOne({ invoiceNumber: 'TEST-A3' });
  const invB1 = await Invoice.findOne({ invoiceNumber: 'TEST-B1' });
  const invC1 = await Invoice.findOne({ invoiceNumber: 'TEST-C1' });
  const invC2 = await Invoice.findOne({ invoiceNumber: 'TEST-C2' });
  const invC3 = await Invoice.findOne({ invoiceNumber: 'TEST-C3' });

  // ============================================================
  // TEST 1: Initial full re-map
  // ============================================================
  section('TEST 1: Initial Full Re-Map');

  console.log('\n  --- Guardian A (Mariam) ---');
  const resA = await fullReMap(guardianA._id);
  console.log(`  Created ${resA.created} links, ${resA.uncoveredClasses.length} uncovered`);

  const sumA1 = await printInvoiceSummary(invA1._id, 'invA1 (last month, 4h)');
  const sumA2 = await printInvoiceSummary(invA2._id, 'invA2 (this month, 6h)');

  // invA1: 4 attended classes × 1h = 4h used, 0h remaining
  assertApprox(sumA1.confirmedHours, 4, 'invA1 confirmed = 4h (4 attended classes)');
  assertApprox(sumA1.remainingHours, 0, 'invA1 remaining = 0h (fully consumed)');

  // invA2: 6h credit, classes: 1+1.5+1+1+1+1 = 6.5h needed (4 attended=4.5h + 2 scheduled=2h)
  // Only 6h credit available → last scheduled class partially/uncovered
  assertApprox(sumA2.usedHours, 6, 'invA2 used = 6h (maxed out)', 0.01);
  assertApprox(sumA2.remainingHours, 0, 'invA2 remaining = 0h');

  // At least 1 class should be uncovered for Guardian A
  assert(resA.uncoveredClasses.length >= 1, `Guardian A has ${resA.uncoveredClasses.length} uncovered class(es)`);

  console.log('\n  --- Guardian B (Khaled) ---');
  const resB = await fullReMap(guardianB._id);
  console.log(`  Created ${resB.created} links, ${resB.uncoveredClasses.length} uncovered`);

  const sumB1 = await printInvoiceSummary(invB1._id, 'invB1 (this month, 3h)');

  // invB1: 3h credit, 2 attended (2h) + 1 scheduled (1h) = 3h, 4th class = uncovered
  assertApprox(sumB1.usedHours, 3, 'invB1 used = 3h (filled exactly)');
  assert(resB.uncoveredClasses.length === 1, `Guardian B has exactly 1 uncovered class (last scheduled)`);

  console.log('\n  --- Guardian C (Fatima) ---');
  const resC = await fullReMap(guardianC._id);
  console.log(`  Created ${resC.created} links, ${resC.uncoveredClasses.length} uncovered`);

  const sumC1 = await printInvoiceSummary(invC1._id, 'invC1 (2 months ago, 4h)');
  const sumC2 = await printInvoiceSummary(invC2._id, 'invC2 (last month, 4h)');

  // invC1: 4 attended = 4h exact
  assertApprox(sumC1.confirmedHours, 4, 'invC1 confirmed = 4h');
  assertApprox(sumC1.remainingHours, 0, 'invC1 remaining = 0h');

  // invC2: 4h credit, 3.5h used last month + 0.5h spillover to this month's first class
  assertApprox(sumC2.usedHours, 4, 'invC2 used = 4h (3.5h last month + 0.5h spillover)', 0.01);

  // This month: 5h needed but only 0.5h spillover from invC2, rest uncovered
  assert(resC.uncoveredClasses.length >= 3, `Guardian C has ${resC.uncoveredClasses.length} uncovered classes (unpaid month)`);

  // ============================================================
  // TEST 2: Validation — no over-allocation
  // ============================================================
  section('TEST 2: Validation — No Over-Allocation');

  for (const [label, id] of [['A', guardianA._id], ['B', guardianB._id], ['C', guardianC._id]]) {
    const violations = await validateGuardianAllocations(id);
    assert(violations.length === 0, `Guardian ${label}: no over-allocation violations (${violations.length})`);
    if (violations.length) {
      console.log('    Violations:', JSON.stringify(violations, null, 2));
    }
  }

  // ============================================================
  // TEST 3: Scenario A — Class Duration Extended
  // ============================================================
  section('TEST 3: Scenario A — Class Duration Extended');

  // Find a Guardian A attended class this month and extend it from 60 → 90 min
  const extendTarget = await Class.findOne({
    'student.guardianId': guardianA._id,
    status: 'attended',
    duration: 60,
    description: /Ali.*Week 1 this month/
  });

  if (extendTarget) {
    console.log(`  Extending class ${extendTarget._id} from 60 → 90 min`);
    await Class.updateOne({ _id: extendTarget._id }, { $set: { duration: 90 } });

    const extendResult = await onClassChanged({ ...extendTarget.toObject(), duration: 90 });
    console.log(`  Re-mapped: ${extendResult.created} links, ${extendResult.uncoveredClasses.length} uncovered`);

    const sumA2after = await printInvoiceSummary(invA2._id, 'invA2 after extend');
    assertApprox(sumA2after.usedHours, 6, 'invA2 still maxed at 6h after extend');

    // More classes should be uncovered now
    assert(extendResult.uncoveredClasses.length >= 1, 'Extended class pushes more classes uncovered');

    // Validate
    const v = await validateGuardianAllocations(guardianA._id);
    assert(v.length === 0, 'No over-allocation after extend');

    // Restore original duration
    await Class.updateOne({ _id: extendTarget._id }, { $set: { duration: 60 } });
    await fullReMap(guardianA._id);
    console.log('  (Duration restored to 60 min)');
  } else {
    console.log('  ⚠️ Could not find extend target class');
  }

  // ============================================================
  // TEST 4: Scenario B — Class Deleted
  // ============================================================
  section('TEST 4: Scenario B — Class Deleted');

  // Delete an attended class from Guardian C last month and verify credit is freed
  const deleteTarget = await Class.findOne({
    'student.guardianId': guardianC._id,
    status: 'attended',
    description: /Youssef.*Last month W1/
  });

  if (deleteTarget) {
    const beforeLinks = await PaymentLink.countDocuments({ guardian: guardianC._id });
    console.log(`  Deleting class ${deleteTarget._id} (Youssef last month W1)`);

    // Mark as cancelled (simulating deletion)
    await Class.updateOne({ _id: deleteTarget._id }, { $set: { status: 'cancelled', hidden: true } });

    const delResult = await fullReMap(guardianC._id);
    const afterLinks = await PaymentLink.countDocuments({ guardian: guardianC._id });
    console.log(`  Links before: ${beforeLinks}, after: ${afterLinks}`);

    const sumC2after = await printInvoiceSummary(invC2._id, 'invC2 after delete');

    // invC2 should have more remaining now (freed 1h)
    // Before: 3.5h last month + 0.5h spillover = 4h
    // After: 2.5h last month + 1.5h spillover to cover more this-month classes
    assertApprox(sumC2after.usedHours, 4, 'invC2 still fully used (spillover fills gap)', 0.01);

    // With one last-month class deleted, the freed credit hour spills over to cover
    // one more this-month class (was 5 uncovered, now should be 4).
    // But if the pool was already fully consumed before the deleted class's date,
    // the freed hour just reduces remaining in that pool.
    assert(delResult.uncoveredClasses.length <= resC.uncoveredClasses.length,
      `Uncovered after delete: was ${resC.uncoveredClasses.length}, now ${delResult.uncoveredClasses.length}`);

    // Validate
    const v = await validateGuardianAllocations(guardianC._id);
    assert(v.length === 0, 'No over-allocation after delete');

    // Restore
    await Class.updateOne({ _id: deleteTarget._id }, { $set: { status: 'attended', hidden: false } });
    await fullReMap(guardianC._id);
    console.log('  (Class restored)');
  } else {
    console.log('  ⚠️ Could not find delete target class');
  }

  // ============================================================
  // TEST 5: Scenario C — New Class Inserted
  // ============================================================
  section('TEST 5: Scenario C — New Class Inserted');

  const sAli = guardianA.guardianInfo.students[0];
  const teacher1 = await User.findOne({ email: 'ahmed.teacher@test.waraqa.co' });

  // Insert a new attended class for Guardian A in this month
  const admin = await User.findOne({ role: 'admin' });
  const newClass = await Class.create({
    title: 'Extra Class',
    subject: 'Quran',
    teacher: teacher1._id,
    student: { guardianId: guardianA._id, studentId: sAli._id, studentName: 'Ali A' },
    scheduledDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    duration: 60,
    status: 'attended',
    timezone: 'Africa/Cairo',
    description: 'TEST: Extra inserted class',
    createdBy: admin._id,
    endsAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 3600000)
  });

  console.log(`  Inserted new class ${newClass._id}`);
  const insertResult = await onClassChanged(newClass);
  console.log(`  Re-mapped: ${insertResult.created} links, ${insertResult.uncoveredClasses.length} uncovered`);

  const sumA2insert = await printInvoiceSummary(invA2._id, 'invA2 after insert');
  assertApprox(sumA2insert.usedHours, 6, 'invA2 maxed at 6h (can\'t exceed credit)');

  // More uncovered
  assert(insertResult.uncoveredClasses.length >= 2, `More uncovered after insert: ${insertResult.uncoveredClasses.length}`);

  const v5 = await validateGuardianAllocations(guardianA._id);
  assert(v5.length === 0, 'No over-allocation after insert');

  // Cleanup
  await Class.deleteOne({ _id: newClass._id });
  await fullReMap(guardianA._id);
  console.log('  (Extra class removed)');

  // ============================================================
  // TEST 6: Scenario D — Invoice Paid → uncovered classes get credit
  // ============================================================
  section('TEST 6: Scenario D — Invoice Paid → Uncovered Classes Get Credit');

  // Guardian C's invC3 is pending (unpaid, 0 creditHours)
  // Mark it as paid with 6 hours credit
  console.log('  Paying invC3 (Fatima this month) with 6h credit …');
  await Invoice.updateOne(
    { _id: invC3._id },
    { $set: { status: 'paid', paidAmount: 60, paidDate: new Date(), creditHours: 6 } }
  );

  const payResult = await onInvoicePaid({ guardian: guardianC._id });
  console.log(`  Re-mapped: ${payResult.created} links, ${payResult.uncoveredClasses.length} uncovered`);

  const sumC3paid = await printInvoiceSummary(invC3._id, 'invC3 after payment');
  assert(sumC3paid.usedHours > 0, `invC3 now has ${sumC3paid.usedHours}h used`);

  // Should have fewer uncovered classes now
  assert(payResult.uncoveredClasses.length < resC.uncoveredClasses.length,
    `Fewer uncovered after payment: was ${resC.uncoveredClasses.length}, now ${payResult.uncoveredClasses.length}`);

  const v6 = await validateGuardianAllocations(guardianC._id);
  assert(v6.length === 0, 'No over-allocation after payment');

  // Restore
  await Invoice.updateOne(
    { _id: invC3._id },
    { $set: { status: 'pending', paidAmount: 0, paidDate: null, creditHours: 0 } }
  );
  await fullReMap(guardianC._id);
  console.log('  (invC3 restored to pending)');

  // ============================================================
  // TEST 7: Scenario E — Class Cancelled → credit freed
  // ============================================================
  section('TEST 7: Scenario E — Class Cancelled → Credit Freed');

  // Cancel one of Guardian B's attended classes (should free 1h)
  const cancelTarget = await Class.findOne({
    'student.guardianId': guardianB._id, status: 'attended', description: /Omar.*Week 1/
  });

  if (cancelTarget) {
    console.log(`  Cancelling class ${cancelTarget._id} (Omar Week 1)`);
    await Class.updateOne({ _id: cancelTarget._id }, { $set: { status: 'cancelled_by_admin' } });

    const cancelResult = await fullReMap(guardianB._id);
    console.log(`  Re-mapped: ${cancelResult.created} links, ${cancelResult.uncoveredClasses.length} uncovered`);

    const sumB1cancel = await printInvoiceSummary(invB1._id, 'invB1 after cancel');

    // Was: 2h attended + 1h scheduled = 3h, 1 uncovered
    // Now: 1h attended + 2h scheduled = 3h, 0 uncovered (freed hour covers the 4th class)
    assertApprox(sumB1cancel.usedHours, 3, 'invB1 used = 3h');
    assert(cancelResult.uncoveredClasses.length === 0,
      `No uncovered classes after cancel (was 1, now ${cancelResult.uncoveredClasses.length})`);

    const v7 = await validateGuardianAllocations(guardianB._id);
    assert(v7.length === 0, 'No over-allocation after cancel');

    // Restore
    await Class.updateOne({ _id: cancelTarget._id }, { $set: { status: 'attended' } });
    await fullReMap(guardianB._id);
    console.log('  (Class restored)');
  }

  // ============================================================
  // TEST 8: Guardian Balance Summary Report
  // ============================================================
  section('TEST 8: Guardian Balance Summary');

  for (const g of [guardianA, guardianB, guardianC]) {
    const invoices = await Invoice.find({
      guardian: g._id, type: 'guardian_invoice', status: 'paid', deleted: { $ne: true }
    }).select('invoiceNumber creditHours').lean();

    let totalCredit = 0;
    let totalUsed = 0;

    for (const inv of invoices) {
      const sum = await getInvoiceCreditSummary(inv._id);
      totalCredit += sum.creditHours;
      totalUsed += sum.usedHours;
    }

    const totalClasses = await Class.countDocuments({
      'student.guardianId': g._id,
      status: { $nin: ['cancelled', 'cancelled_by_teacher', 'cancelled_by_student', 'cancelled_by_guardian', 'cancelled_by_admin', 'no_show_both', 'pattern'] },
      hidden: { $ne: true }
    });

    const totalClassHours = await Class.aggregate([
      {
        $match: {
          'student.guardianId': g._id,
          status: { $nin: ['cancelled', 'cancelled_by_teacher', 'cancelled_by_student', 'cancelled_by_guardian', 'cancelled_by_admin', 'no_show_both', 'pattern'] },
          hidden: { $ne: true }
        }
      },
      { $group: { _id: null, total: { $sum: '$duration' } } }
    ]);

    const classHours = ((totalClassHours[0]?.total || 0) / 60).toFixed(2);

    console.log(`\n  ${g.firstName} ${g.lastName} (${g.email}):`);
    console.log(`    Total paid credit:  ${totalCredit}h`);
    console.log(`    Allocated (used):   ${totalUsed}h`);
    console.log(`    Remaining credit:   ${(totalCredit - totalUsed).toFixed(2)}h`);
    console.log(`    Total classes:      ${totalClasses} (${classHours}h)`);
    console.log(`    Uncovered hours:    ${Math.max(0, classHours - totalCredit).toFixed(2)}h`);
  }

  // ============================================================
  // TEST 9: Report Window Visibility (Guardian D)
  // ============================================================
  section('TEST 9: Report Window — Past Scheduled Classes');

  const guardianD = await User.findOne({ email: 'sara@test.waraqa.co' });
  if (!guardianD) {
    console.log('  ⚠️  Guardian D not found — skipping (re-run seed script)');
  } else {
    const resD = await fullReMap(guardianD._id);
    console.log(`  Created ${resD.created} links, ${resD.uncoveredClasses.length} uncovered`);

    const invD1 = await Invoice.findOne({ invoiceNumber: 'TEST-D1' });
    const sumD1 = await printInvoiceSummary(invD1._id, 'invD1 (5h credit)');

    // Links should be:
    // D1 (attended) → confirmed 1h
    // D2 (missed_by_student) → confirmed 1h
    // D5 (admin extended, past scheduled) → projected 1h (admin reopened)
    // D3 (past scheduled, window open) → projected 1h
    // D7 (future scheduled) → projected 1h
    // Total = 5h, exactly fills the pool
    //
    // NOT linked:
    // D4 (past scheduled, window expired) → skipped
    // D6 (no_show_both) → excluded status

    assertApprox(sumD1.usedHours, 5, 'invD1 used = 5h (fills exactly)');

    // Verify type breakdown
    assertApprox(sumD1.confirmedHours, 2, 'invD1 confirmed = 2h (attended + missed_by_student)');
    assertApprox(sumD1.projectedHours, 3, 'invD1 projected = 3h (window-open + admin-extended + future)');
    assert(sumD1.remainingHours < 0.01, `invD1 remaining ≈ 0h (${sumD1.remainingHours})`);

    // The expired-window class (D4) should NOT have any PaymentLink
    const expiredClass = await Class.findOne({
      'student.guardianId': guardianD._id, description: /WINDOW EXPIRED/
    });
    if (expiredClass) {
      const expiredLinks = await PaymentLink.find({ class: expiredClass._id });
      assert(expiredLinks.length === 0,
        `Expired-window class has 0 links (got ${expiredLinks.length})`);
      console.log('  ✅ Expired-window class correctly excluded from allocation');
    }

    // The no_show_both class (D6) should NOT have any PaymentLink
    const noShowClass = await Class.findOne({
      'student.guardianId': guardianD._id, description: /no_show_both/
    });
    if (noShowClass) {
      const noShowLinks = await PaymentLink.find({ class: noShowClass._id });
      assert(noShowLinks.length === 0,
        `no_show_both class has 0 links (got ${noShowLinks.length})`);
      console.log('  ✅ no_show_both class correctly excluded from allocation');
    }

    // The admin-extended class should have a projected link
    const extendedClass = await Class.findOne({
      'student.guardianId': guardianD._id, description: /ADMIN EXTENDED/
    });
    if (extendedClass) {
      const extLinks = await PaymentLink.find({ class: extendedClass._id });
      assert(extLinks.length === 1 && extLinks[0].type === 'projected',
        `Admin-extended class has 1 projected link (got ${extLinks.length}, type=${extLinks[0]?.type})`);
      console.log('  ✅ Admin-extended class correctly included as projected');
    }

    const v9 = await validateGuardianAllocations(guardianD._id);
    assert(v9.length === 0, 'No over-allocation for Guardian D');
  }

  // ============================================================
  // RESULTS
  // ============================================================
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n❌ Some tests FAILED. Review output above.\n');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL TESTS PASSED!\n');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Test error:', err);
  process.exit(1);
});
