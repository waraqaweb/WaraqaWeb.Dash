require('dotenv').config();
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
const dryRun = String(process.argv[2] || '').toLowerCase() === 'dry';

const run = async () => {
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const invoices = await Invoice.find({ status: 'partially_paid', deleted: { $ne: true } });
  if (!invoices.length) {
    console.log('No partially_paid invoices found.');
    await mongoose.connection.close();
    return;
  }

  console.log(`Found ${invoices.length} partially_paid invoice(s).`);

  let updated = 0;
  for (const invoice of invoices) {
    const nextPaidAt = invoice.paidAt || invoice.updatedAt || new Date();
    const nextTotal = Number(invoice.total || 0);

    if (!dryRun) {
      invoice.status = 'paid';
      invoice.paidAmount = nextTotal;
      invoice.paidAt = nextPaidAt;
      await invoice.save();
    }

    updated += 1;
    console.log(`[${dryRun ? 'dry-run' : 'updated'}] ${invoice._id} -> paid (${nextTotal})`);
  }

  console.log(`${dryRun ? 'Would update' : 'Updated'} ${updated} invoice(s).`);
  await mongoose.connection.close();
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  mongoose.connection.close().catch(() => {});
  process.exit(1);
});
