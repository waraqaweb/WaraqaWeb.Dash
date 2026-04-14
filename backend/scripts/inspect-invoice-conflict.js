#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const invoiceId = '69d6ca9081fad8c1eabf1dbb';
  const invoice = await Invoice.findById(invoiceId).lean();

  if (!invoice) {
    console.log('Invoice not found');
    process.exit(1);
  }

  console.log('=== Target invoice ===');
  console.log(JSON.stringify({
    _id: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    type: invoice.type,
    guardian: invoice.guardian,
    totalAmount: invoice.totalAmount,
    paidAmount: invoice.paidAmount,
    itemCount: (invoice.items || []).length,
    classIds: invoice.classIds,
  }, null, 2));

  // Get all class IDs from this invoice
  const classIds = [
    ...new Set([
      ...(invoice.items || []).map(it => it.class?.toString()).filter(Boolean),
      ...(invoice.classIds || []).map(id => id?.toString()).filter(Boolean)
    ])
  ];

  console.log(`\nClass IDs in this invoice: ${classIds.length}`);

  // Find conflicting invoices
  if (classIds.length) {
    const classObjectIds = classIds.map(id => {
      try { return new mongoose.Types.ObjectId(id); } catch { return null; }
    }).filter(Boolean);
    
    const conflicts = await Invoice.find({
      _id: { $ne: invoice._id },
      type: 'guardian_invoice',
      status: { $in: ['draft', 'unpaid', 'paid', 'partially_paid', 'overdue', 'sent'] },
      $or: [
        { 'items.class': { $in: classObjectIds } },
        { classIds: { $in: classObjectIds } },
        { classIds: { $in: classIds } },
      ]
    }).select('_id invoiceNumber status type guardian totalAmount paidAmount items classIds').lean();

    console.log(`\n=== Conflicting invoices: ${conflicts.length} ===`);
    for (const c of conflicts) {
      console.log(JSON.stringify({
        _id: c._id,
        invoiceNumber: c.invoiceNumber,
        status: c.status,
        type: c.type,
        guardian: c.guardian,
        totalAmount: c.totalAmount,
        paidAmount: c.paidAmount,
        itemCount: (c.items || []).length,
        classIdsCount: (c.classIds || []).length,
      }, null, 2));

      // Find overlapping class IDs
      const cClassIds = [
        ...(c.items || []).map(it => it.class?.toString()).filter(Boolean),
        ...(c.classIds || []).map(id => id?.toString()).filter(Boolean)
      ];
      const overlap = classIds.filter(id => cClassIds.includes(id));
      console.log(`  Overlapping classes: ${overlap.length} — ${overlap.slice(0, 5).join(', ')}${overlap.length > 5 ? '...' : ''}`);
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
