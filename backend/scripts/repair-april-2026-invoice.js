/**
 * Repair script: find and fix failed April 2026 teacher invoice
 *
 * Usage (inside the backend container or with local Mongo access):
 *   node backend/scripts/repair-april-2026-invoice.js [--dry-run] [--fix]
 *
 * With --dry-run  → reports what would happen, no writes
 * With --fix      → actually creates the missing invoice
 *
 * Default (no flag) → diagnosis only
 */

'use strict';

const mongoose = require('mongoose');
const path     = require('path');

// ── Load env ──────────────────────────────────────────────────────────────────
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
const TARGET_MONTH = 4;  // April
const TARGET_YEAR  = 2026;
const DRY_RUN = process.argv.includes('--dry-run');
const FIX     = process.argv.includes('--fix');

async function run() {
  console.log('═'.repeat(70));
  console.log(`Repair script — failed invoice for ${TARGET_MONTH}/${TARGET_YEAR}`);
  console.log(`Mode: ${FIX ? 'FIX' : DRY_RUN ? 'DRY RUN' : 'DIAGNOSE ONLY'}`);
  console.log('═'.repeat(70) + '\n');

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB:', MONGO_URI.replace(/\/\/[^@]+@/, '//***@'));

  const TeacherSalaryAudit = require('../models/TeacherSalaryAudit');
  const TeacherInvoice     = require('../models/TeacherInvoice');
  const User               = require('../models/User');
  const TeacherSalaryService = require('../services/teacherSalaryService');
  const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');

  // ── 1. Check audit log for job_run that captured failures ─────────────────
  console.log('── Step 1: Recent audit log entries ─────────────────────────────');
  const auditEntries = await TeacherSalaryAudit.find({
    createdAt: { $gte: new Date('2026-05-01T00:00:00Z') }
  }).sort({ createdAt: -1 }).limit(20).lean();

  if (auditEntries.length === 0) {
    console.log('  No audit entries found after 2026-05-01.');
  } else {
    auditEntries.forEach(e => {
      console.log(`  [${e.createdAt.toISOString()}] action=${e.action} success=${e.success} error=${e.errorMessage || '—'}`);
      if (e.metadata) {
        const m = e.metadata;
        if (m.errors && m.errors.length) {
          console.log('    Errors:', JSON.stringify(m.errors, null, 2));
        }
        if (m.skipped && m.skipped.length) {
          console.log('    Skipped:', m.skipped.map(s => `${s.teacherName} (${s.reason})`).join('; '));
        }
      }
    });
  }

  // ── 2. Find active teachers with no April 2026 invoice ───────────────────
  console.log('\n── Step 2: Active teachers missing April 2026 invoice ───────────');
  const teachers = await User.find({ role: 'teacher', isActive: true })
    .select('_id firstName lastName email teacherInfo').lean();

  const existingInvoices = await TeacherInvoice.find({
    month: TARGET_MONTH, year: TARGET_YEAR, isAdjustment: false, deleted: false
  }).select('teacher').lean();

  const billedIds = new Set(existingInvoices.map(i => i.teacher.toString()));
  const missing   = teachers.filter(t => !billedIds.has(t._id.toString()));

  if (missing.length === 0) {
    console.log('  All active teachers already have an April 2026 invoice.');
    await mongoose.disconnect();
    return;
  }

  console.log(`  Found ${missing.length} teacher(s) with no April 2026 invoice:\n`);

  for (const t of missing) {
    const hasCustomRate = t.teacherInfo?.customRateOverride?.enabled;
    const customRateVal = t.teacherInfo?.customRateOverride?.rateUSD;
    const rateOk = !hasCustomRate || (typeof customRateVal === 'number' && customRateVal > 0);

    // Aggregate hours
    const TeacherSalaryServiceClass = require('../services/teacherSalaryService');
    const { totalHours, meta } = await TeacherSalaryServiceClass.aggregateTeacherHours(
      t._id, TARGET_MONTH, TARGET_YEAR
    );

    console.log(`  Teacher: ${t.firstName} ${t.lastName} (${t._id})`);
    console.log(`    Email       : ${t.email}`);
    console.log(`    Hours (Apr) : ${totalHours}`);
    console.log(`    Custom rate : ${hasCustomRate ? `enabled — rateUSD=${customRateVal} (${rateOk ? 'OK' : '⚠ INVALID'})` : 'no (uses system rate)'}`);
    console.log(`    Class meta  : ${JSON.stringify(meta)}`);

    if (!rateOk) {
      console.log(`\n  ⚠  ROOT CAUSE IDENTIFIED: Custom rate enabled but rateUSD is invalid (${customRateVal}).`);
      console.log(`     Fix: go to Teacher profile → Salary → set a valid custom rate, then rerun with --fix.`);
    }

    if (totalHours === 0) {
      console.log(`     → Would be SKIPPED (zero billable hours). No invoice needed.`);
      continue;
    }

    // Check exchange rate
    const exRate = await MonthlyExchangeRates.findOne({ month: TARGET_MONTH, year: TARGET_YEAR }).lean();
    if (!exRate) {
      console.log(`\n  ⚠  Exchange rate for ${TARGET_MONTH}/${TARGET_YEAR} is not set. Cannot create invoice.`);
      console.log(`     Fix: set the exchange rate for April 2026 in the admin settings, then rerun.`);
      continue;
    }
    console.log(`    Exchange rate: ${exRate.rate} EGP/USD`);

    if (FIX) {
      console.log(`\n  Creating invoice for ${t.firstName} ${t.lastName}…`);
      try {
        const invoice = await TeacherSalaryService.createTeacherInvoice(t._id, TARGET_MONTH, TARGET_YEAR, {
          userId: null,
          monthlyHoursSnapshot: totalHours
        });
        if (invoice) {
          console.log(`  ✓ Invoice created: _id=${invoice._id}, hours=${invoice.totalHours}, USD=${invoice.grossAmountUSD}, EGP=${invoice.netAmountEGP}`);
        } else {
          console.log(`  → Invoice not created (zero hours after re-check).`);
        }
      } catch (err) {
        console.error(`  ✗ Failed: ${err.message}`);
        if (err.errors) {
          Object.entries(err.errors).forEach(([k, v]) => console.error(`    ${k}: ${v.message}`));
        }
      }
    } else {
      console.log(`\n  → Run with --fix to create the missing invoice.`);
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('Done.');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
