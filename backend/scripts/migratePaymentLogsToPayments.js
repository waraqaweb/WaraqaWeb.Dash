#!/usr/bin/env node
/*
  migratePaymentLogsToPayments.js

  Usage:
    node migratePaymentLogsToPayments.js --dry-run
    node migratePaymentLogsToPayments.js --apply
    node migratePaymentLogsToPayments.js --apply --batch-size=50

  This script scans invoices with `paymentLogs` and creates corresponding
  `Payment` documents (backend/models/Payment). By default it runs in dry-run
  mode and prints a summary of what would be created. Use `--apply` to persist
  the Payment documents.

  IMPORTANT: Run on staging first. This script attempts to avoid duplicates by
  checking for existing Payments with the same `invoice + transactionId`, or
  a heuristic match on `invoice + amount + paidAt`.
*/

const mongoose = require('mongoose');
const minimist = require('minimist');
const crypto = require('crypto');

const argv = minimist(process.argv.slice(2), { boolean: ['dry-run', 'apply'], default: { 'dry-run': true } });
const DRY_RUN = !argv.apply;
const BATCH_SIZE = Number(argv['batch-size'] || 100);

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/waraqadb';

async function connect() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
}

async function main() {
  console.log('Migration mode:', DRY_RUN ? 'DRY RUN' : 'APPLY');
  console.log('Connecting to', MONGO_URI);
  await connect();

  const Invoice = require('../models/Invoice');
  const Payment = require('../models/Payment');

  // Find invoices that contain paymentLogs
  const query = { paymentLogs: { $exists: true, $ne: [] } };
  const cursor = Invoice.find(query).cursor();

  let processedInvoices = 0;
  let createdCount = 0;
  let skippedCount = 0;
  const createdExamples = [];

  for await (const inv of cursor) {
    processedInvoices++;
    const logs = Array.isArray(inv.paymentLogs) ? inv.paymentLogs : [];
    if (!logs.length) continue;

    for (let idx = 0; idx < logs.length; idx++) {
      const log = logs[idx];
      if (!log) continue;

      // Skip tip_distribution entries
      if (log.method === 'tip_distribution') continue;

      const amount = Number(log.amount || 0) || 0;
      if (amount === 0) continue;

      // Normalize candidate identifiers
      const transactionId = (log.transactionId || log.tx || log.transaction || null) ? String(log.transactionId || log.tx || log.transaction) : null;
      const paidAt = log.paidAt ? new Date(log.paidAt) : (log.createdAt ? new Date(log.createdAt) : (inv.createdAt || new Date()));
      const adminUser = log.adminUser || log.recordedBy || null;
      const paidHours = Number.isFinite(Number(log.paidHours)) ? Number(log.paidHours) : undefined;

      // Heuristic duplicate check
      const dupQuery = { invoice: inv._id };
      const or = [];
      if (transactionId) or.push({ transactionId });
      // Match similar amount + timestamp within 2 minutes + adminUser
      or.push({ amount: amount, paidAt: { $gte: new Date(paidAt.getTime() - 1000 * 60 * 2), $lte: new Date(paidAt.getTime() + 1000 * 60 * 2) } });
      dupQuery.$or = or;

      const existing = await Payment.findOne(dupQuery).lean().exec();
      if (existing) {
        skippedCount++;
        continue;
      }

      const paymentDoc = {
        invoice: inv._id,
        amount: amount,
        paymentMethod: log.method || log.paymentMethod || 'manual',
        transactionId: transactionId || undefined,
        idempotencyKey: log.idempotencyKey || undefined,
        adminUser: adminUser || undefined,
        paidHours: paidHours !== undefined ? paidHours : undefined,
        tip: Number(log.tip || 0) || 0,
        paidAt: paidAt || undefined,
        status: 'applied',
        appliedAt: paidAt || new Date(),
        logSnapshot: log
      };

      if (DRY_RUN) {
        createdExamples.push({ invoice: String(inv._id), amount: paymentDoc.amount, transactionId: paymentDoc.transactionId, paidAt: paymentDoc.paidAt });
        createdCount++;
      } else {
        try {
          const created = await Payment.create(paymentDoc);
          createdCount++;
        } catch (err) {
          // Handle duplicate insertion gracefully
          if (err && err.code === 11000) {
            skippedCount++;
            continue;
          }
          console.error('Failed to create Payment for invoice', inv._id, 'log index', idx, err && err.message);
        }
      }
    }

    // Optionally stop early for batch size when in DRY_RUN mode
    if (DRY_RUN && processedInvoices >= BATCH_SIZE) break;
  }

  console.log('Processed invoices:', processedInvoices);
  console.log('Payments created (or would be created):', createdCount);
  console.log('Payments skipped (existing):', skippedCount);
  if (createdExamples.length) {
    console.log('\nExamples:');
    createdExamples.slice(0, 10).forEach((ex) => console.log(' ', ex));
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Migration failed:', err && err.message);
  process.exit(1);
});
