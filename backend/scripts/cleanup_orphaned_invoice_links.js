require('dotenv').config();
const mongoose = require('mongoose');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb';
const dryRun = String(process.argv[2] || '').toLowerCase() === 'dry';

const SAFE_STATUSES = new Set(['paid', 'refunded']);

async function main() {
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  const classes = await Class.find({ billedInInvoiceId: { $exists: true, $ne: null } })
    .select('_id billedInInvoiceId billedAt')
    .lean();

  const invoiceIds = Array.from(new Set(classes.map(c => String(c.billedInInvoiceId))));
  const invoices = await Invoice.find({ _id: { $in: invoiceIds } })
    .select('_id status deleted')
    .lean();

  const invoiceMap = new Map(invoices.map(inv => [String(inv._id), inv]));

  const toClear = [];
  classes.forEach((cls) => {
    const inv = invoiceMap.get(String(cls.billedInInvoiceId));
    if (!inv) {
      toClear.push(cls._id);
      return;
    }
    if (inv.deleted === true && !SAFE_STATUSES.has(String(inv.status || '').toLowerCase())) {
      toClear.push(cls._id);
    }
  });

  console.log(`Classes with billedInInvoiceId: ${classes.length}`);
  console.log(`Invoices referenced: ${invoiceIds.length}`);
  console.log(`Classes to clear: ${toClear.length}`);

  if (!dryRun && toClear.length) {
    await Class.updateMany(
      { _id: { $in: toClear } },
      { $unset: { billedInInvoiceId: 1, billedAt: 1 } }
    );
  }

  await mongoose.disconnect();
  console.log('✅ Done');
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});