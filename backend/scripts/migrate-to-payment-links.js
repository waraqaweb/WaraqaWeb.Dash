#!/usr/bin/env node
// backend/scripts/migrate-to-payment-links.js
// ============================================================
// Migration script: converts existing billedInInvoiceId links
// to the new PaymentLink credit-pool model.
//
// Usage:
//   DRY_RUN=1 node backend/scripts/migrate-to-payment-links.js   # preview
//   node backend/scripts/migrate-to-payment-links.js              # execute
//
// Steps:
//   1. Add creditHours to all paid invoices that don't have it
//   2. Create PaymentLinks from existing invoice.items[]
//   3. Run slideAndReMap for each guardian to fix any inconsistencies
//   4. Validate: no invoice over-allocated
// ============================================================

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const Invoice = require('../models/Invoice');
const Class = require('../models/Class');
const User = require('../models/User');
const PaymentLink = require('../models/PaymentLink');
const { fullReMap, validateGuardianAllocations, roundHours } = require('../services/paymentLinkService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

async function main() {
  console.log(`\n🔗 Connecting to ${MONGODB_URI} …`);
  console.log(`   Mode: ${DRY_RUN ? '🔍 DRY RUN (no writes)' : '⚡ LIVE (will modify data)'}\n`);

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected\n');

  // ────────────────────────────────────────────
  // Step 1: Add creditHours to paid invoices
  // ────────────────────────────────────────────
  console.log('📋 Step 1: Backfilling creditHours on paid invoices …');

  const paidInvoices = await Invoice.find({
    type: 'guardian_invoice',
    status: 'paid',
    deleted: { $ne: true }
  }).select('_id invoiceNumber items guardianFinancial total paidAmount coverage creditHours hoursCovered').lean();

  let backfilled = 0;
  let alreadyHas = 0;

  for (const inv of paidInvoices) {
    // If creditHours is already set and > 0, skip
    if (inv.creditHours && inv.creditHours > 0) {
      alreadyHas++;
      continue;
    }

    // Calculate creditHours from items
    let creditHours = 0;

    if (inv.coverage?.maxHours && inv.coverage.maxHours > 0) {
      // If there's a coverage cap, use that
      creditHours = roundHours(inv.coverage.maxHours);
    } else if (Array.isArray(inv.items) && inv.items.length > 0) {
      // Sum duration from items
      const totalMinutes = inv.items.reduce((sum, item) => sum + (Number(item.duration) || 0), 0);
      creditHours = roundHours(totalMinutes / 60);
    } else if (inv.hoursCovered && inv.hoursCovered > 0) {
      creditHours = roundHours(inv.hoursCovered);
    } else {
      // Fallback: derive from total / hourlyRate
      const rate = inv.guardianFinancial?.hourlyRate || 10;
      const total = inv.paidAmount || inv.total || 0;
      creditHours = roundHours(total / rate);
    }

    if (creditHours <= 0) {
      console.log(`  ⚠️  ${inv.invoiceNumber}: could not determine creditHours (total=${inv.total}, items=${inv.items?.length || 0})`);
      continue;
    }

    console.log(`  ${inv.invoiceNumber}: setting creditHours = ${creditHours}`);

    if (!DRY_RUN) {
      await Invoice.updateOne({ _id: inv._id }, { $set: { creditHours } });
    }
    backfilled++;
  }

  console.log(`  → ${backfilled} invoices backfilled, ${alreadyHas} already had creditHours\n`);

  // ────────────────────────────────────────────
  // Step 2: Create PaymentLinks from existing data
  // ────────────────────────────────────────────
  console.log('📋 Step 2: Clearing existing PaymentLinks (clean slate) …');

  const existingLinks = await PaymentLink.countDocuments();
  if (!DRY_RUN && existingLinks > 0) {
    await PaymentLink.deleteMany({});
  }
  console.log(`  → Cleared ${existingLinks} existing links\n`);

  // ────────────────────────────────────────────
  // Step 3: Run slideAndReMap for each guardian
  // ────────────────────────────────────────────
  console.log('📋 Step 3: Running full re-map for all guardians …');

  const guardians = await User.find({
    role: 'guardian',
    isActive: true
  }).select('_id firstName lastName email').lean();

  console.log(`  Found ${guardians.length} active guardians\n`);

  let totalCreated = 0;
  let totalUncovered = 0;
  const guardianResults = [];

  for (const g of guardians) {
    // Check if this guardian has any paid invoices at all
    const hasPaid = await Invoice.countDocuments({
      guardian: g._id, type: 'guardian_invoice', status: 'paid', deleted: { $ne: true }
    });

    if (hasPaid === 0) {
      console.log(`  ${g.firstName} ${g.lastName}: no paid invoices, skipping`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  ${g.firstName} ${g.lastName}: would run fullReMap (${hasPaid} paid invoices)`);
      continue;
    }

    const result = await fullReMap(g._id);
    totalCreated += result.created;
    totalUncovered += result.uncoveredClasses.length;

    guardianResults.push({
      name: `${g.firstName} ${g.lastName}`,
      email: g.email,
      created: result.created,
      uncovered: result.uncoveredClasses.length
    });

    console.log(`  ${g.firstName} ${g.lastName}: ${result.created} links, ${result.uncoveredClasses.length} uncovered`);
  }

  console.log(`\n  → Total: ${totalCreated} links created, ${totalUncovered} uncovered classes\n`);

  // ────────────────────────────────────────────
  // Step 4: Validation
  // ────────────────────────────────────────────
  if (!DRY_RUN) {
    console.log('📋 Step 4: Validating allocations …');

    let violations = 0;
    for (const g of guardians) {
      const v = await validateGuardianAllocations(g._id);
      if (v.length > 0) {
        violations += v.length;
        console.log(`  ❌ ${g.firstName} ${g.lastName}: ${v.length} over-allocation violations!`);
        for (const viol of v) {
          console.log(`     Invoice ${viol.invoiceNumber}: credit=${viol.creditHours}h, allocated=${viol.allocatedHours}h, overage=${viol.overage}h`);
        }
      }
    }

    if (violations === 0) {
      console.log('  ✅ All allocations valid — no invoice is over-allocated\n');
    } else {
      console.log(`\n  ❌ ${violations} violations found! Manual review needed.\n`);
    }
  }

  // ────────────────────────────────────────────
  // Summary
  // ────────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log(`║  MIGRATION ${DRY_RUN ? 'PREVIEW' : 'COMPLETE'}                                  ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Invoices backfilled:  ${String(backfilled).padEnd(30)}║`);
  console.log(`║  PaymentLinks created: ${String(totalCreated).padEnd(30)}║`);
  console.log(`║  Uncovered classes:    ${String(totalUncovered).padEnd(30)}║`);
  console.log(`║  Guardians processed:  ${String(guardianResults.length).padEnd(30)}║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  if (DRY_RUN) {
    console.log('ℹ️  This was a DRY RUN. To execute, run without DRY_RUN=1\n');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
