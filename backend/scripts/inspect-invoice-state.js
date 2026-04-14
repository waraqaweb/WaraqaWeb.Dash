#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const invoiceId = '69d6ca9081fad8c1eabf1dbb';
  const inv = await Invoice.findById(invoiceId).select('status paidAmount invoiceNumber invoiceSequence paymentLogs guardian').lean();
  
  console.log('=== Invoice current state ===');
  console.log(JSON.stringify({
    status: inv.status,
    paidAmount: inv.paidAmount,
    invoiceNumber: inv.invoiceNumber,
    invoiceSequence: inv.invoiceSequence,
    guardian: inv.guardian,
    paymentLogsCount: (inv.paymentLogs || []).length,
  }));

  // Check if a Payment record was created (orphaned)
  const payments = await Payment.find({ invoice: invoiceId }).lean();
  console.log(`\nPayment records for this invoice: ${payments.length}`);
  for (const p of payments) {
    console.log(JSON.stringify({
      _id: p._id,
      status: p.status,
      amount: p.amount,
      method: p.paymentMethod,
      transactionId: p.transactionId,
      createdAt: p.createdAt,
      appliedAt: p.appliedAt,
    }));
  }

  // Now do a fresh conflict check
  const fullInv = await Invoice.findById(invoiceId);
  if (fullInv) {
    // Simulate what happens during save: set status to 'paid' and validate
    fullInv.status = 'paid';
    try {
      await fullInv.validate();
      console.log('\n✅ Validation passed — no conflict now');
    } catch (vErr) {
      console.log('\n❌ Validation failed:', vErr.message);
    }
    // Reset
    fullInv.status = inv.status;
  }

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
