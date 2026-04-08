// Check paymentLogs.paidHours vs item totals for paid invoices
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');
  const Invoice = require('../models/Invoice');

  const guardianId = process.argv[2]; // optional

  const query = { status: 'paid', deleted: { $ne: true } };
  if (guardianId) query.guardian = guardianId;

  const invoices = await Invoice.find(query).select('guardian invoiceNumber items paymentLogs adjustments').lean();

  let mismatches = 0;
  let noPaidHours = 0;

  for (const inv of invoices) {
    const itemHours = (inv.items || []).reduce((s, it) => s + ((it.duration || 0) / 60), 0);
    let paidHours = 0;
    let hasAnyPaidHours = false;
    for (const log of (inv.paymentLogs || [])) {
      if (!log || log.amount <= 0) continue;
      if (log.method === 'refund' || log.method === 'tip_distribution') continue;
      if (log.paidHours != null) hasAnyPaidHours = true;
      paidHours += Number(log.paidHours || 0);
    }

    const diff = Math.abs(paidHours - itemHours);
    if (!hasAnyPaidHours) noPaidHours++;
    if (diff > 0.01) {
      mismatches++;
      console.log(`MISMATCH: ${inv.invoiceNumber || inv._id} | guardian=${inv.guardian} | items=${itemHours.toFixed(2)}h | paidHours=${paidHours.toFixed(2)}h | diff=${(paidHours - itemHours).toFixed(2)}h | adjustments=${(inv.adjustments || []).length}`);
    }
  }

  console.log(`\nTotal paid invoices: ${invoices.length}`);
  console.log(`Mismatches (paidHours != items): ${mismatches}`);
  console.log(`Invoices with no paidHours in logs: ${noPaidHours}`);

  await mongoose.disconnect();
})();
