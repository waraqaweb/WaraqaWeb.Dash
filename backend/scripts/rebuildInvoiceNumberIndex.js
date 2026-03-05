/*
  Rebuild the invoiceNumber index to allow missing values.

  Why:
  - New invoices can be created without a number (manual numbering).
  - The index must be unique + sparse to allow multiple null/undefined values.

  Usage:
    MONGODB_URI="mongodb://..." node scripts/rebuildInvoiceNumberIndex.js
*/

const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });

  const Invoice = require('../models/Invoice');

  const indexes = await Invoice.collection.indexes();
  const invoiceNumberIndex = indexes.find((idx) => idx.key && idx.key.invoiceNumber === 1);

  if (invoiceNumberIndex) {
    console.log(`Dropping index: ${invoiceNumberIndex.name}`);
    await Invoice.collection.dropIndex(invoiceNumberIndex.name);
  } else {
    console.log('No existing invoiceNumber index found.');
  }

  console.log('Creating sparse unique invoiceNumber index...');
  await Invoice.collection.createIndex(
    { invoiceNumber: 1 },
    { unique: true, sparse: true }
  );

  console.log('Done.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('rebuildInvoiceNumberIndex failed:', err);
  process.exitCode = 1;
});
