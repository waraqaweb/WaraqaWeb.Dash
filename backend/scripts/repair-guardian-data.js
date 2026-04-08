/**
 * Repair guardian data for local test DB.
 *
 * Fixes:
 *  1. Invoice item snapshot: class 69d184216d767f6489cc74e8 duration 55→60, recalc amount
 *  2. Malak hoursRemaining: credit paid hours, debit consumed
 *  3. Guardian totalHours: let pre-save hook recalculate from students
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const Class = require('../models/Class');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb_test');
  console.log('Connected\n');

  // --- 1. Find the guardian ---
  const guardian = await User.findOne({ role: 'guardian', 'guardianInfo.students.firstName': 'Malak' });
  if (!guardian) { console.log('Guardian not found'); process.exit(1); }
  console.log(`Guardian: ${guardian.firstName} ${guardian.lastName} (${guardian._id})`);
  console.log(`  totalHours BEFORE: ${guardian.guardianInfo.totalHours}`);
  console.log(`  autoTotalHours:    ${guardian.autoTotalHours}`);

  // --- 2. Find the paid invoice ---
  const invoice = await Invoice.findOne({ guardian: guardian._id, status: 'paid', deleted: { $ne: true } });
  if (!invoice) { console.log('No paid invoice found'); process.exit(1); }
  console.log(`\nInvoice: ${invoice._id} (${invoice.invoiceNumber})`);
  console.log(`  status: ${invoice.status} | items: ${invoice.items.length}`);

  const rate = invoice.hourlyRate || guardian.guardianInfo?.hourlyRate || 14;
  console.log(`  hourlyRate: ${rate}`);

  // --- 3. Fix stale invoice item snapshots ---
  let invoiceChanged = false;
  for (const item of invoice.items) {
    const cls = await Class.findById(item.class).lean();
    if (!cls) continue;
    if (cls.duration !== item.duration) {
      const oldDur = item.duration;
      const newDur = cls.duration;
      const newAmt = Math.round((newDur / 60) * rate * 100) / 100;
      console.log(`\n  Fixing item ${item.class}:`);
      console.log(`    duration: ${oldDur} → ${newDur}`);
      console.log(`    amount:   ${item.amount} → ${newAmt}`);
      item.duration = newDur;
      item.amount = newAmt;
      invoiceChanged = true;
    }
  }

  if (invoiceChanged) {
    // Recalc subtotal from items
    const newSubtotal = invoice.items.reduce((sum, it) => sum + (it.amount || 0), 0);
    const transferFee = (invoice.total || 0) - (invoice.subtotal || 0);
    console.log(`\n  subtotal: ${invoice.subtotal} → ${Math.round(newSubtotal * 100) / 100}`);
    invoice.subtotal = Math.round(newSubtotal * 100) / 100;
    invoice.total = Math.round((newSubtotal + transferFee) * 100) / 100;
    console.log(`  total:    → ${invoice.total}  (transferFee=${transferFee})`);
    invoice.markModified('items');
    await invoice.save();
    console.log('  ✅ Invoice item snapshots updated');
  } else {
    console.log('\n  Items already in sync with classes');
  }

  // --- 4. Recalculate guardian / student hours ---
  // Paid hours = sum of all invoice item durations (in hours)
  const paidMinutes = invoice.items.reduce((s, it) => s + (it.duration || 0), 0);
  const paidHours = Math.round((paidMinutes / 60) * 10000) / 10000;
  console.log(`\n  paidHours (from invoice items): ${paidHours}h (${paidMinutes} min)`);

  // Consumed hours = classes that are attended or missed_by_student
  const consumedStatuses = ['attended', 'missed_by_student'];
  const classIds = invoice.items.map(it => it.class);
  const classes = await Class.find({ _id: { $in: classIds }, status: { $in: consumedStatuses } }).lean();
  const consumedMinutes = classes.reduce((s, c) => s + (c.duration || 0), 0);
  const consumedHours = Math.round((consumedMinutes / 60) * 10000) / 10000;
  console.log(`  consumedHours (attended/missed_by_student): ${consumedHours}h (${consumedMinutes} min, ${classes.length} classes)`);

  const expectedRemaining = Math.round((paidHours - consumedHours) * 10000) / 10000;
  console.log(`  expectedRemaining: ${expectedRemaining}h`);

  // Find Malak in students array (all invoice items are for her)
  const malakIdx = (guardian.guardianInfo.students || []).findIndex(s => s.firstName === 'Malak');
  if (malakIdx >= 0) {
    const malak = guardian.guardianInfo.students[malakIdx];
    console.log(`\n  Malak hoursRemaining BEFORE: ${malak.hoursRemaining}`);
    malak.hoursRemaining = expectedRemaining;
    console.log(`  Malak hoursRemaining AFTER:  ${malak.hoursRemaining}`);
    guardian.markModified('guardianInfo.students');
  }

  // Remove autoTotalHours=false if set (let pre-save hook recalculate)
  if (guardian.autoTotalHours === false) {
    guardian.autoTotalHours = undefined;
    console.log('  Cleared autoTotalHours=false');
  }

  // Explicitly set totalHours as well (in case pre-save hook doesn't cover it)
  const newTotal = (guardian.guardianInfo.students || []).reduce((s, st) => s + (Number(st.hoursRemaining) || 0), 0);
  guardian.guardianInfo.totalHours = Math.round(newTotal * 10000) / 10000;
  guardian.markModified('guardianInfo');

  await guardian.save();

  // Verify
  const verify = await User.findById(guardian._id).lean();
  console.log(`\n=== AFTER REPAIR ===`);
  console.log(`  totalHours:     ${verify.guardianInfo.totalHours}`);
  console.log(`  autoTotalHours: ${verify.autoTotalHours}`);
  for (const s of verify.guardianInfo.students) {
    console.log(`  ${s.firstName} ${s.lastName} hoursRemaining: ${s.hoursRemaining}`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
