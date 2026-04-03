#!/usr/bin/env node
/**
 * repair-invoice-classes.js
 * 
 * Repairs invoices where classes were incorrectly removed from paid invoices
 * and ended up in auto-created duplicate invoices.
 * 
 * For each pair (original paid + auto-created pending):
 * 1. Move items from auto-created invoice into original paid invoice
 * 2. Update Class.billedInInvoiceId to point to original
 * 3. Cancel the auto-created invoice (set status=cancelled, mark deleted)
 * 4. Record change history on both invoices
 * 
 * Usage: DRY_RUN=1 node scripts/repair-invoice-classes.js   (preview)
 *        node scripts/repair-invoice-classes.js               (apply)
 */
const mongoose = require('mongoose');

const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/waraqadb');
  const Invoice = require('../models/Invoice');
  const Class = require('../models/Class');

  console.log(`=== REPAIR INVOICE CLASSES (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) ===\n`);

  // Define the pairs to repair
  const repairPairs = [
    {
      label: 'HATU',
      originalId: '69aff5495727102e277490ba',
      autoCreatedId: '69cd437cbc1284f9dba7e66c'
    },
    {
      label: 'ARIF',
      originalId: '69aff5495727102e27749111',
      autoCreatedId: '69cd437dbc1284f9dba7e6bb'
    }
  ];

  for (const pair of repairPairs) {
    console.log(`\n--- ${pair.label} ---`);
    
    const original = await Invoice.findById(pair.originalId);
    const autoCreated = await Invoice.findById(pair.autoCreatedId);

    if (!original) {
      console.log(`  ERROR: Original invoice ${pair.originalId} not found`);
      continue;
    }
    if (!autoCreated) {
      console.log(`  ERROR: Auto-created invoice ${pair.autoCreatedId} not found`);
      continue;
    }

    console.log(`  Original: ${original.invoiceNumber} (${original.invoiceName})`);
    console.log(`    Status: ${original.status}, Paid: $${original.paidAmount}, Total: $${original.total}, Items: ${original.items.length}`);
    console.log(`  Auto-created: ${autoCreated.invoiceNumber} (${autoCreated.invoiceName})`);
    console.log(`    Status: ${autoCreated.status}, Paid: $${autoCreated.paidAmount}, Total: $${autoCreated.total}, Items: ${autoCreated.items.length}`);

    if (autoCreated.status === 'paid' || autoCreated.paidAmount > 0) {
      console.log(`  SKIP: Auto-created invoice has payments, cannot safely modify`);
      continue;
    }

    // Get items to move from auto-created to original
    const itemsToMove = autoCreated.items.map(item => item.toObject());
    const classIdsToMove = itemsToMove.map(it => String(it.class || it.lessonId)).filter(Boolean);

    console.log(`  Moving ${itemsToMove.length} items from auto-created to original:`);
    for (const item of itemsToMove) {
      console.log(`    - Class ${item.class || item.lessonId}: ${item.description} (${item.date?.toISOString()?.split('T')[0]}) ${item.duration}min $${item.amount}`);
    }

    // Check for duplicates (don't add items already in original)
    const existingClassIds = new Set(
      original.items.map(it => String(it.class || it.lessonId)).filter(Boolean)
    );
    const newItems = itemsToMove.filter(it => {
      const cid = String(it.class || it.lessonId);
      return !existingClassIds.has(cid);
    });

    if (newItems.length === 0) {
      console.log(`  SKIP: All items already exist in original invoice`);
    } else {
      console.log(`  Adding ${newItems.length} new items to original (${itemsToMove.length - newItems.length} already present)`);
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would move ${newItems.length} items, cancel auto-created invoice`);
      continue;
    }

    // STEP 1: Cancel and clear auto-created invoice FIRST (removes conflict)
    if (!Array.isArray(autoCreated.changeHistory)) autoCreated.changeHistory = [];
    autoCreated.changeHistory.push({
      changedAt: new Date(),
      changedBy: null,
      action: 'repair',
      changes: `Repair: cancelled and deleted. ${itemsToMove.length} class(es) moved back to original invoice ${original.invoiceNumber || original.invoiceName}. This invoice was auto-created after class deletion incorrectly removed items from the paid invoice.`,
      note: 'Automated repair script'
    });
    autoCreated.markModified('changeHistory');
    autoCreated.status = 'cancelled';
    autoCreated.deleted = true;
    autoCreated.items = [];
    autoCreated.markModified('items');
    autoCreated._skipRecalculate = true;
    await autoCreated.save();
    console.log(`  ✅ Cancelled and deleted auto-created invoice ${autoCreated.invoiceNumber || autoCreated.invoiceName}`);

    // STEP 2: Update Class.billedInInvoiceId for moved classes
    for (const cid of classIdsToMove) {
      try {
        const result = await Class.updateOne(
          { _id: cid },
          { $set: { billedInInvoiceId: original._id, billedAt: new Date() } }
        );
        if (result.modifiedCount > 0) {
          console.log(`  ✅ Updated Class ${cid} billedInInvoiceId → ${original._id}`);
        }
      } catch (e) {
        console.warn(`  ⚠️ Failed to update Class ${cid}: ${e.message}`);
      }
    }

    // STEP 3: Add items to original invoice (conflict now cleared)
    if (newItems.length > 0) {
      for (const item of newItems) {
        delete item._id;
        original.items.push(item);
      }
      original.markModified('items');

      if (!Array.isArray(original.changeHistory)) original.changeHistory = [];
      original.changeHistory.push({
        changedAt: new Date(),
        changedBy: null,
        action: 'repair',
        changes: `Repair: moved ${newItems.length} class(es) from auto-created invoice ${autoCreated.invoiceNumber || autoCreated.invoiceName}. Classes were incorrectly split into separate invoice after class deletion.`,
        note: 'Automated repair script'
      });
      original.markModified('changeHistory');

      // Skip recalculation on paid invoices - keep paidAmount as is
      original._skipRecalculate = true;
      await original.save();

      console.log(`  ✅ Added ${newItems.length} items to original invoice (now ${original.items.length} items)`);
    }
  }

  // Handle SINAN case (has adjustment but class is gone)
  console.log('\n--- SINAN (adjustment cleanup) ---');
  const sinanInvoice = await Invoice.findById('69aff5465727102e27748f1d');
  if (sinanInvoice) {
    const classDeletedAdj = (sinanInvoice.adjustments || []).filter(a => a.reason === 'class_deleted');
    console.log(`  Invoice: ${sinanInvoice.invoiceNumber} (${sinanInvoice.invoiceName})`);
    console.log(`  Status: ${sinanInvoice.status}, Paid: $${sinanInvoice.paidAmount}, Total: $${sinanInvoice.total}`);
    console.log(`  Adjustments: ${classDeletedAdj.length} class_deleted`);
    
    if (classDeletedAdj.length > 0) {
      console.log(`  Adjustments detail:`);
      for (const adj of classDeletedAdj) {
        console.log(`    - Class ${adj.classId}: ${adj.classSnapshot?.studentName} ${adj.classSnapshot?.subject} (${adj.hoursDelta}h, $${adj.amountDelta})`);
      }
      
      if (!DRY_RUN) {
        // Mark adjustments as settled (informational only)
        for (const adj of sinanInvoice.adjustments) {
          if (adj.reason === 'class_deleted' && !adj.settled) {
            adj.settled = true;
            adj.settledAt = new Date();
          }
        }
        sinanInvoice.markModified('adjustments');
        
        if (!Array.isArray(sinanInvoice.changeHistory)) sinanInvoice.changeHistory = [];
        sinanInvoice.changeHistory.push({
          changedAt: new Date(),
          changedBy: null,
          action: 'repair',
          changes: `Repair: marked ${classDeletedAdj.length} class_deleted adjustment(s) as settled. Original class was deleted from DB and cannot be restored.`,
          note: 'Automated repair script'
        });
        sinanInvoice.markModified('changeHistory');
        
        sinanInvoice._skipRecalculate = true;
        await sinanInvoice.save();
        console.log(`  ✅ Marked adjustments as settled`);
      } else {
        console.log(`  [DRY RUN] Would mark adjustments as settled`);
      }
    }
  }

  console.log('\n=== REPAIR COMPLETE ===');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
