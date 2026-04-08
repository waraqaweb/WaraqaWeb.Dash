/**
 * One-time script: Reset invoice 69d53a6caa665f2941a4f2fd to pre-payment state.
 * 
 * This clears: paidAmount, refunds, paymentLogs, coverage, status → pending,
 *              and resets guardian hours to -1.5 (the pre-payment value).
 * 
 * Usage: node scripts/fix-invoice-reset.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
const INVOICE_ID = '69d53a6caa665f2941a4f2fd';
const GUARDIAN_ID = '69d536bde68732e984bd4fa2'; // guardian user id from logs
const GUARDIAN_HOURS_PRE_PAYMENT = -1.5; // guardian had -1.5h before the 10h payment

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to', MONGO_URI);

  const Invoice = require('../models/Invoice');
  const User = require('../models/User');
  const Payment = require('../models/Payment');
  const Class = require('../models/Class');

  // 1) Reset the invoice
  const invoice = await Invoice.findById(INVOICE_ID);
  if (!invoice) {
    console.error('Invoice not found');
    process.exit(1);
  }

  console.log('Before reset:', {
    status: invoice.status,
    paidAmount: invoice.paidAmount,
    refundsCount: (invoice.refunds || []).length,
    paymentLogsCount: (invoice.paymentLogs || []).length,
    itemsCount: (invoice.items || []).length,
    coverageMaxHours: invoice.coverage?.maxHours
  });

  invoice.status = 'pending';
  invoice.paidAmount = 0;
  invoice.paidAt = null;
  invoice.refunds = [];
  invoice.refund = null;
  invoice.paymentLogs = [];
  invoice.coverage = {};
  invoice.markModified('refunds');
  invoice.markModified('refund');
  invoice.markModified('paymentLogs');
  invoice.markModified('coverage');

  // Clear items so they get refreshed from rebalance on next view
  // (the rebalance engine is the source of truth for unpaid invoices)
  invoice.items = [];
  invoice.markModified('items');

  invoice.recalculateTotals();
  await invoice.save();
  console.log('Invoice reset to pending, paidAmount=0');

  // 2) Reset guardian hours
  const guardian = await User.findById(GUARDIAN_ID);
  if (guardian && guardian.guardianInfo) {
    const before = guardian.guardianInfo.totalHours;
    guardian.guardianInfo.totalHours = GUARDIAN_HOURS_PRE_PAYMENT;
    guardian.guardianInfo.autoTotalHours = false;
    guardian.markModified('guardianInfo');
    await guardian.save();
    console.log(`Guardian hours: ${before} → ${GUARDIAN_HOURS_PRE_PAYMENT}`);
  }

  // 3) Delete test payment records for this invoice
  const deleted = await Payment.deleteMany({ invoice: new mongoose.Types.ObjectId(INVOICE_ID) });
  console.log(`Deleted ${deleted.deletedCount} Payment record(s)`);

  // 4) Unlink all classes from this invoice
  const unlinked = await Class.updateMany(
    { billedInInvoiceId: new mongoose.Types.ObjectId(INVOICE_ID) },
    { $set: { paidByGuardian: false }, $unset: { paidByGuardianAt: 1, billedAt: 1, billedInInvoiceId: 1 } }
  );
  console.log(`Unlinked ${unlinked.modifiedCount} classes`);

  console.log('\nDone. Invoice is back to pre-payment state. You can now:');
  console.log('1. Open the invoice in the dashboard');
  console.log('2. Record a payment (10h, $145)');
  console.log('3. Test refund (5h, $72.50)');
  console.log('4. Test undo-refund');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
