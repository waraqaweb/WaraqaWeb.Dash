#!/usr/bin/env node

const mongoose = require('mongoose');
const path = require('path');
const { findUninvoicedLessons } = require('../services/invoiceAuditService');

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
  await mongoose.connect(mongoUri, { dbName: process.env.MONGO_DB || undefined });

  const exemptPredicate = (cls) => {
    try {
      const flags = cls.flags || cls.metadata || {};
      return Boolean(flags.exemptFromGuardian || flags.notCountForBoth || flags.exemptFromInvoice);
    } catch (_) { return false; }
  };

  const lessons = await findUninvoicedLessons({ sinceDays: Number(process.env.SINCE_DAYS || 90), includeCancelled: false, exemptPredicate });
  if (!lessons.length) {
    console.log('✅ All recent lessons are linked to at least one invoice (or exempt).');
  } else {
    console.log(`⚠️ Found ${lessons.length} lessons without any invoice linkage:`);
    lessons.slice(0, 50).forEach((c) => {
      console.log(` - Lesson ${c._id} (${c.status}) on ${new Date(c.scheduledDate).toISOString()}`);
    });
    if (lessons.length > 50) console.log(` ...and ${lessons.length - 50} more.`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Error enforcing uninvoiced lessons:', err);
  process.exitCode = 1;
});
