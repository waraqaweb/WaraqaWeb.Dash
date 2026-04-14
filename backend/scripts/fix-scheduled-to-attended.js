require('dotenv').config();
const mongoose = require('mongoose');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');

const CLASS_IDS = [
  '699ee10bc5432a1df0007891',
  '699ee10bc5432a1df0007899',
  '6995eacdc3fa30ad10b2ed77'
];
const INVOICE_ID = '69ca9831e0d3ffaac507d2c8';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  // 1. Update class status to attended
  for (const id of CLASS_IDS) {
    const res = await Class.updateOne(
      { _id: id, status: 'scheduled' },
      { $set: { status: 'attended' } }
    );
    console.log('Class', id, '→ attended:', res.modifiedCount ? 'OK' : 'already/not-found');
  }

  // 2. Update invoice items
  for (const id of CLASS_IDS) {
    const res = await Invoice.updateOne(
      { _id: INVOICE_ID, 'items.class': new mongoose.Types.ObjectId(id) },
      { $set: {
        'items.$.status': 'attended',
        'items.$.attended': true,
        'items.$.attendanceStatus': 'attended'
      }}
    );
    console.log('Invoice item for', id, '→ attended:', res.modifiedCount ? 'OK' : 'already/not-found');
  }

  // 3. Verify
  const inv = await Invoice.findById(INVOICE_ID).lean();
  const items = inv.items || [];
  let remaining = 0;
  for (const it of items) {
    if (it.status === 'scheduled') remaining++;
  }
  console.log('\nInvoice items still scheduled:', remaining);
  console.log('All items:');
  items.forEach((it, i) => {
    console.log('  [' + i + ']', it.status, it.attended ? 'Y' : 'N', it.date, (it.description || '').substring(0, 40));
  });

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
