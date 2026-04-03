#!/usr/bin/env node
/**
 * find-removed-classes.js
 * Finds all invoices where classes were removed after payment,
 * and identifies the "replacement" invoices that auto-attached those classes.
 */
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/waraqadb');
  const Invoice = require('../models/Invoice');
  const Class = require('../models/Class');

  console.log('=== PHASE 1: Find invoices with class_deleted adjustments ===');
  const withAdjustments = await Invoice.find({
    deleted: { $ne: true },
    'adjustments.reason': 'class_deleted'
  }).select('_id invoiceNumber invoiceName invoiceSlug status paidAmount total subtotal items adjustments guardian billingPeriod changeHistory').lean();
  
  console.log(`Found ${withAdjustments.length} invoices with class_deleted adjustments`);
  for (const inv of withAdjustments) {
    const classDeletedAdj = (inv.adjustments || []).filter(a => a.reason === 'class_deleted');
    console.log(JSON.stringify({
      id: inv._id,
      num: inv.invoiceNumber,
      name: inv.invoiceName,
      slug: inv.invoiceSlug,
      status: inv.status,
      paid: inv.paidAmount,
      total: inv.total,
      subtotal: inv.subtotal,
      itemCount: (inv.items || []).length,
      guardian: inv.guardian,
      period: inv.billingPeriod,
      adjustments: classDeletedAdj.map(a => ({
        classId: a.classId,
        type: a.type,
        reason: a.reason,
        desc: a.description,
        hoursDelta: a.hoursDelta,
        amountDelta: a.amountDelta,
        snapshot: a.classSnapshot,
        settled: a.settled,
        settledIn: a.settledInInvoiceId,
        createdAt: a.createdAt
      }))
    }, null, 2));
  }

  console.log('\n=== PHASE 2: Find classes referenced in adjustments ===');
  const removedClassIds = [];
  for (const inv of withAdjustments) {
    for (const adj of (inv.adjustments || [])) {
      if (adj.reason === 'class_deleted' && adj.classId) {
        removedClassIds.push(adj.classId);
      }
    }
  }
  
  if (removedClassIds.length > 0) {
    const removedClasses = await Class.find({
      _id: { $in: removedClassIds }
    }).select('_id scheduledDate duration subject status deleted student teacher billedInInvoiceId').lean();
    
    console.log(`Found ${removedClasses.length} removed classes:`);
    for (const cls of removedClasses) {
      console.log(JSON.stringify({
        id: cls._id,
        date: cls.scheduledDate,
        duration: cls.duration,
        subject: cls.subject,
        status: cls.status,
        deleted: cls.deleted,
        student: cls.student?.studentName,
        teacher: cls.teacher,
        billedIn: cls.billedInInvoiceId
      }));
    }
  }

  console.log('\n=== PHASE 3: Find invoices with "Auto-attach" in changeHistory ===');
  // changeHistory stores diffs as objects, search for auto-attach notes
  const allInvoices = await Invoice.find({
    deleted: { $ne: true },
    status: { $in: ['draft', 'pending', 'sent', 'overdue', 'paid'] }
  }).select('_id invoiceNumber invoiceName invoiceSlug status paidAmount total subtotal items guardian billingPeriod changeHistory createdAt').lean();
  
  const autoAttached = [];
  for (const inv of allInvoices) {
    const history = inv.changeHistory || [];
    for (const entry of history) {
      const note = entry.note || entry.changes || '';
      const diffStr = JSON.stringify(entry.diff || {});
      if (/auto.?attach/i.test(note) || /auto.?attach/i.test(diffStr)) {
        autoAttached.push({
          invoiceId: inv._id,
          num: inv.invoiceNumber,
          name: inv.invoiceName,
          slug: inv.invoiceSlug,
          status: inv.status,
          paid: inv.paidAmount,
          total: inv.total,
          guardian: inv.guardian,
          period: inv.billingPeriod,
          itemCount: (inv.items || []).length,
          createdAt: inv.createdAt,
          autoAttachEntry: { note, at: entry.changedAt, by: entry.changedBy, diff: entry.diff }
        });
      }
    }
  }
  
  console.log(`Found ${autoAttached.length} auto-attach entries`);
  for (const aa of autoAttached) {
    console.log(JSON.stringify(aa, null, 2));
  }

  console.log('\n=== PHASE 4: Find invoices with "Removed deleted class" in changeHistory ===');
  const removedFromHistory = [];
  for (const inv of allInvoices) {
    const history = inv.changeHistory || [];
    for (const entry of history) {
      const note = entry.note || entry.changes || '';
      const diffStr = JSON.stringify(entry.diff || {});
      if (/removed deleted class/i.test(note) || /removed deleted class/i.test(diffStr)) {
        removedFromHistory.push({
          invoiceId: inv._id,
          num: inv.invoiceNumber,
          name: inv.invoiceName,
          slug: inv.invoiceSlug,
          status: inv.status,
          paid: inv.paidAmount,
          total: inv.total,
          guardian: inv.guardian,
          period: inv.billingPeriod,
          itemCount: (inv.items || []).length,
          entry: { note, at: entry.changedAt, by: entry.changedBy }
        });
      }
    }
  }
  
  console.log(`Found ${removedFromHistory.length} "Removed deleted class" entries`);
  for (const r of removedFromHistory) {
    console.log(JSON.stringify(r, null, 2));
  }

  console.log('\n=== PHASE 5: Check invoiceSlug duplicates ===');
  const slugAgg = await Invoice.aggregate([
    { $match: { deleted: { $ne: true }, invoiceSlug: { $ne: null } } },
    { $group: { _id: '$invoiceSlug', count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } }
  ]);
  console.log(`Found ${slugAgg.length} duplicate slugs`);
  for (const s of slugAgg) {
    console.log(JSON.stringify(s));
  }

  // Also check for the specific user-reported invoices
  console.log('\n=== PHASE 6: Specific invoices from user report ===');
  const specificIds = [
    '69aff5495727102e277490ba', // hatu march - original paid
    '69cd437cbc1284f9dba7e66c', // hatu march - auto-created
    '69aff5495727102e27749111', // arif feb - original paid  
    '69cd437dbc1284f9dba7e6bb', // arif feb - auto-created
    '69a97c16930d30782d41e0c2', // slug error invoice
  ];
  
  for (const id of specificIds) {
    try {
      const inv = await Invoice.findById(id)
        .select('_id invoiceNumber invoiceName invoiceSlug status paidAmount total subtotal items adjustments guardian billingPeriod changeHistory createdAt')
        .lean();
      if (inv) {
        console.log(JSON.stringify({
          id: inv._id,
          num: inv.invoiceNumber,
          name: inv.invoiceName,
          slug: inv.invoiceSlug,
          status: inv.status,
          paid: inv.paidAmount,
          total: inv.total,
          subtotal: inv.subtotal,
          itemCount: (inv.items || []).length,
          items: (inv.items || []).map(it => ({
            itemId: it._id,
            classId: it.class,
            lessonId: it.lessonId,
            date: it.date,
            duration: it.duration,
            amount: it.amount,
            status: it.status,
            desc: it.description
          })),
          guardian: inv.guardian,
          period: inv.billingPeriod,
          adjustments: (inv.adjustments || []).map(a => ({
            type: a.type,
            reason: a.reason,
            classId: a.classId,
            desc: a.description,
            hoursDelta: a.hoursDelta,
            amountDelta: a.amountDelta,
            snapshot: a.classSnapshot,
            settled: a.settled,
            settledIn: a.settledInInvoiceId
          })),
          changeHistory: (inv.changeHistory || []).map(ch => ({
            note: ch.note || ch.changes,
            at: ch.changedAt,
            by: ch.changedBy,
            action: ch.action
          })),
          createdAt: inv.createdAt
        }, null, 2));
      } else {
        console.log(`Invoice ${id}: NOT FOUND`);
      }
    } catch (e) {
      console.log(`Invoice ${id}: ERROR - ${e.message}`);
    }
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
