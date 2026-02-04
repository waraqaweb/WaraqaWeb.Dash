const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const InvoiceService = require('../services/invoiceService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.replace(/^--/, '');
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = value;
      i += 1;
    }
  }
  return out;
};

async function run() {
  const args = parseArgs();
  const guardianId = args.guardianId || args.guardian || null;
  const sinceDays = Number.isFinite(Number(args.sinceDays)) ? Number(args.sinceDays) : 120;

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const paidInvoices = await Invoice.find({
    deleted: { $ne: true },
    status: { $in: ['paid', 'refunded'] },
    ...(guardianId ? { guardian: guardianId } : {})
  }).select('_id items').lean();

  const paidClassIds = new Set();
  (paidInvoices || []).forEach((inv) => {
    (inv.items || []).forEach((it) => {
      const id = it?.class || it?.lessonId;
      if (id) paidClassIds.add(String(id));
    });
  });

  if (!paidClassIds.size) {
    console.log('No paid classes found.');
    await mongoose.connection.close();
    return;
  }

  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const unpaidFilter = {
    deleted: { $ne: true },
    status: { $in: ['draft', 'pending', 'sent', 'overdue', 'partially_paid'] },
    ...(guardianId ? { guardian: guardianId } : {}),
    createdAt: { $gte: sinceDate }
  };

  const unpaidInvoices = await Invoice.find(unpaidFilter);
  let cleaned = 0;

  for (const invoice of unpaidInvoices) {
    const removeItemIds = [];
    (invoice.items || []).forEach((it) => {
      const id = it?.class || it?.lessonId;
      if (id && paidClassIds.has(String(id)) && it?._id) {
        removeItemIds.push(String(it._id));
      }
    });

    if (!removeItemIds.length) continue;

    const result = await InvoiceService.updateInvoiceItems(
      String(invoice._id),
      { removeItemIds, note: 'Removed classes already billed on paid invoice' },
      null
    );

    if (result?.success) {
      cleaned += 1;
      console.log(`✅ Cleaned ${invoice.invoiceNumber || invoice._id}`);
    } else {
      console.log(`⚠️ Failed to clean ${invoice.invoiceNumber || invoice._id}: ${result?.error || 'unknown error'}`);
    }
  }

  console.log(`Done. Cleaned ${cleaned} unpaid invoice(s).`);
  await mongoose.connection.close();
}

run().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
