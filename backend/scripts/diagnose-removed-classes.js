#!/usr/bin/env node
/**
 * diagnose-removed-classes.js
 * Focused diagnosis of classes removed from paid invoices
 */
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/waraqadb');
  const Invoice = require('../models/Invoice');
  const Class = require('../models/Class');

  // 1. Find ALL paid invoices that have adjustments with reason=class_deleted
  const paidWithAdj = await Invoice.find({
    deleted: { $ne: true },
    status: 'paid',
    'adjustments.reason': 'class_deleted'
  }).select('_id invoiceNumber invoiceName invoiceSlug status paidAmount total subtotal items adjustments guardian billingPeriod').lean();

  console.log('=== PAID INVOICES WITH class_deleted ADJUSTMENTS ===');
  console.log('Count:', paidWithAdj.length);

  for (const inv of paidWithAdj) {
    const adj = (inv.adjustments || []).filter(a => a.reason === 'class_deleted');
    const removedClassIds = adj.map(a => String(a.classId));
    
    // Check if removed classes still exist
    const removedClasses = await Class.find({ _id: { $in: removedClassIds } })
      .select('_id scheduledDate duration subject status deleted student teacher billedInInvoiceId')
      .lean();

    // Find the NEW invoices that auto-attached these classes
    const newInvoices = await Invoice.find({
      deleted: { $ne: true },
      guardian: inv.guardian,
      _id: { $ne: inv._id },
      $or: [
        { 'items.class': { $in: removedClassIds.map(id => new mongoose.Types.ObjectId(id)) } },
        { 'items.lessonId': { $in: removedClassIds } }
      ]
    }).select('_id invoiceNumber invoiceName invoiceSlug status paidAmount total subtotal items createdAt').lean();

    console.log(JSON.stringify({
      ORIGINAL_INVOICE: {
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
        period: inv.billingPeriod
      },
      REMOVED_ADJUSTMENTS: adj.map(a => ({
        classId: a.classId,
        type: a.type,
        hoursDelta: a.hoursDelta,
        amountDelta: a.amountDelta,
        snapshot: a.classSnapshot
      })),
      REMOVED_CLASSES_IN_DB: removedClasses.map(c => ({
        id: c._id,
        date: c.scheduledDate,
        duration: c.duration,
        subject: c.subject,
        status: c.status,
        deleted: c.deleted,
        student: c.student?.studentName,
        billedIn: c.billedInInvoiceId
      })),
      CLASSES_FOUND_IN_OTHER_INVOICES: newInvoices.map(ni => ({
        id: ni._id,
        num: ni.invoiceNumber,
        name: ni.invoiceName,
        status: ni.status,
        paid: ni.paidAmount,
        total: ni.total,
        itemCount: (ni.items || []).length,
        createdAt: ni.createdAt
      }))
    }, null, 2));
  }

  // 2. Find auto-created invoices (changeHistory with auto-attach) for these guardians
  const guardianIds = [...new Set(paidWithAdj.map(i => String(i.guardian)))];
  console.log('\n=== AUTO-CREATED INVOICES FOR AFFECTED GUARDIANS ===');
  
  for (const gid of guardianIds) {
    const gInvoices = await Invoice.find({
      guardian: gid,
      deleted: { $ne: true },
      status: { $in: ['draft', 'pending', 'sent', 'overdue'] }
    }).select('_id invoiceNumber invoiceName invoiceSlug status total subtotal items billingPeriod createdAt').lean();
    
    for (const inv of gInvoices) {
      // Check each item - is it a class that was originally in a paid invoice?
      const classIds = (inv.items || []).map(it => it.class || it.lessonId).filter(Boolean);
      
      // Check if any of these classes have billedInInvoiceId pointing elsewhere
      const classes = await Class.find({ _id: { $in: classIds } })
        .select('_id scheduledDate duration status deleted billedInInvoiceId')
        .lean();
      
      console.log(JSON.stringify({
        invoice: {
          id: inv._id,
          num: inv.invoiceNumber,
          name: inv.invoiceName,
          slug: inv.invoiceSlug,
          status: inv.status,
          total: inv.total,
          itemCount: (inv.items || []).length,
          period: inv.billingPeriod,
          createdAt: inv.createdAt
        },
        guardian: gid,
        classes: classes.map(c => ({
          id: c._id,
          date: c.scheduledDate,
          duration: c.duration,
          status: c.status,
          deleted: c.deleted,
          billedIn: c.billedInInvoiceId
        }))
      }, null, 2));
    }
  }

  // 3. Check the specific invoices from user report
  console.log('\n=== SPECIFIC INVOICES FROM USER REPORT ===');
  const pairs = [
    { original: '69aff5495727102e277490ba', autoCreated: '69cd437cbc1284f9dba7e66c', label: 'HATU' },
    { original: '69aff5495727102e27749111', autoCreated: '69cd437dbc1284f9dba7e6bb', label: 'ARIF' },
  ];

  for (const pair of pairs) {
    const orig = await Invoice.findById(pair.original)
      .select('_id invoiceNumber invoiceName status paidAmount total subtotal items adjustments billingPeriod guardian')
      .lean();
    const auto = await Invoice.findById(pair.autoCreated)
      .select('_id invoiceNumber invoiceName status paidAmount total subtotal items billingPeriod guardian')
      .lean();
    
    if (orig && auto) {
      // Find which classes in auto-created are NOT in original
      const origClassIds = new Set((orig.items || []).map(it => String(it.class || it.lessonId)));
      const autoOnlyItems = (auto.items || []).filter(it => !origClassIds.has(String(it.class || it.lessonId)));
      
      console.log(JSON.stringify({
        label: pair.label,
        original: {
          id: orig._id,
          num: orig.invoiceNumber,
          status: orig.status,
          paid: orig.paidAmount,
          total: orig.total,
          subtotal: orig.subtotal,
          itemCount: (orig.items || []).length,
          adjustments: (orig.adjustments || []).filter(a => a.reason === 'class_deleted').map(a => ({
            classId: a.classId,
            snapshot: a.classSnapshot,
            hoursDelta: a.hoursDelta,
            amountDelta: a.amountDelta
          }))
        },
        autoCreated: {
          id: auto._id,
          num: auto.invoiceNumber,
          status: auto.status,
          paid: auto.paidAmount,
          total: auto.total,
          subtotal: auto.subtotal,
          itemCount: (auto.items || []).length,
          items: (auto.items || []).map(it => ({
            classId: it.class,
            lessonId: it.lessonId,
            date: it.date,
            duration: it.duration,
            amount: it.amount,
            status: it.status,
            desc: it.description
          }))
        },
        autoOnlyItems: autoOnlyItems.map(it => ({
          classId: it.class,
          date: it.date,
          duration: it.duration,
          amount: it.amount
        }))
      }, null, 2));
    }
  }

  // 4. Check for invoiceSlug duplicates  
  console.log('\n=== DUPLICATE SLUGS ===');
  const slugDups = await Invoice.aggregate([
    { $match: { deleted: { $ne: true }, invoiceSlug: { $ne: null, $exists: true } } },
    { $group: { _id: '$invoiceSlug', count: { $sum: 1 }, ids: { $push: { id: '$_id', num: '$invoiceNumber', status: '$status' } } } },
    { $match: { count: { $gt: 1 } } }
  ]);
  console.log('Duplicate slugs:', slugDups.length);
  for (const d of slugDups) {
    console.log(JSON.stringify(d));
  }

  // Check invoiceSlug index
  const indexes = await Invoice.collection.indexes();
  const slugIdx = indexes.find(i => i.key && i.key.invoiceSlug);
  console.log('\ninvoiceSlug index:', JSON.stringify(slugIdx));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
