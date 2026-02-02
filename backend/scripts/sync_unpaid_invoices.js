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

const ACTIVE_UNPAID = ['draft', 'pending', 'sent', 'overdue', 'partially_paid'];

async function run() {
  const args = parseArgs();
  const invoiceId = args.invoiceId || args.invoice || null;
  const guardianId = args.guardianId || args.guardian || null;
  const sinceDays = Number.isFinite(Number(args.sinceDays)) ? Number(args.sinceDays) : 120;
  const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : null;
  const dryRun = Boolean(args['dry-run'] || args.dryRun);

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const filter = {
    deleted: { $ne: true },
    type: 'guardian_invoice',
    status: { $in: ACTIVE_UNPAID }
  };

  if (invoiceId) {
    filter._id = invoiceId;
  }
  if (guardianId) {
    filter.guardian = guardianId;
  }
  if (!invoiceId) {
    const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    filter.createdAt = { $gte: sinceDate };
  }

  let query = Invoice.find(filter).sort({ createdAt: -1 });
  if (limit) query = query.limit(limit);
  const invoices = await query;

  if (!invoices.length) {
    console.log('No matching unpaid guardian invoices found.');
    await mongoose.connection.close();
    return;
  }

  console.log(`Found ${invoices.length} invoice(s) to sync.`);

  let updated = 0;
  for (const invoice of invoices) {
    const label = `${invoice.invoiceNumber || invoice._id}`;
    if (dryRun) {
      console.log(`[dry-run] Would sync ${label}`);
      continue;
    }

    const result = await InvoiceService.syncUnpaidInvoiceItems(invoice, {
      note: 'Synced unpaid invoice classes (script)',
      cleanupDuplicates: true
    });

    if (result && result.success && !result.noChanges) {
      updated += 1;
      console.log(`✅ Synced ${label}`);
    } else if (result && result.noChanges) {
      console.log(`ℹ️ No changes for ${label}`);
    } else {
      console.log(`⚠️ Failed to sync ${label}: ${result?.error || 'unknown error'}`);
    }
  }

  console.log(`Done. Updated ${updated} invoice(s).`);
  await mongoose.connection.close();
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
