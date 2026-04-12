/**
 * Backfill: mark all unsettled class_cancelled credit adjustments as settled.
 *
 * Cancelled classes were never delivered, so there is nothing to carry forward.
 * Going forward, createPaidInvoiceAdjustment auto-settles these.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const invoices = await Invoice.find({
    'adjustments': {
      $elemMatch: {
        reason: 'class_cancelled',
        type: 'credit',
        settled: { $ne: true }
      }
    }
  });

  let totalSettled = 0;
  for (const inv of invoices) {
    let changed = false;
    for (const adj of inv.adjustments) {
      if (adj.reason === 'class_cancelled' && adj.type === 'credit' && !adj.settled) {
        adj.settled = true;
        totalSettled++;
        changed = true;
      }
    }
    if (changed) {
      inv.markModified('adjustments');
      inv._skipRecalculate = true;
      await inv.save();
      console.log(`  ✅ ${inv.invoiceNumber}: settled ${inv.adjustments.filter(a => a.reason === 'class_cancelled' && a.type === 'credit' && a.settled).length} cancelled-class credit(s)`);
    }
  }

  console.log(`\nDone. Settled ${totalSettled} cancelled-class credit adjustment(s) across ${invoices.length} invoice(s).`);
  await mongoose.disconnect();
})();
