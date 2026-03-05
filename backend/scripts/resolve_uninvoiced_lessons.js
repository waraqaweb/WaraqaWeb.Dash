#!/usr/bin/env node

const mongoose = require('mongoose');
const { findUninvoicedLessons, resolveUninvoicedLessons } = require('../services/invoiceAuditService');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.replace(/^--/, '');
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = value;
      i += 1;
    }
  }
  return out;
};

async function run() {
  const args = parseArgs();
  const sinceDays = Number.isFinite(Number(args.sinceDays)) ? Number(args.sinceDays) : 90;
  const includeCancelled = String(args.includeCancelled || 'false').toLowerCase() === 'true';
  const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : undefined;

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
  await mongoose.connect(mongoUri, { dbName: process.env.MONGO_DB || undefined });

  const result = await resolveUninvoicedLessons({ sinceDays, includeCancelled, limit, adminUserId: null });
  const summary = result?.summary || {};
  console.log('Resolve summary:', summary);

  const remaining = await findUninvoicedLessons({ sinceDays, includeCancelled });
  if (!remaining.length) {
    console.log('✅ No uninvoiced lessons remain.');
  } else {
    console.log(`⚠️ ${remaining.length} uninvoiced lessons remain.`);
    remaining.slice(0, 25).forEach((lesson) => {
      console.log(` - ${lesson.classId} (${lesson.status}) ${lesson.reasonCode || ''}`);
    });
    if (remaining.length > 25) {
      console.log(` ...and ${remaining.length - 25} more.`);
    }
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Resolve script failed:', err);
  process.exitCode = 1;
});
