#!/usr/bin/env node
/**
 * reconcile-credits.js
 * ------------------------------------------------------------------
 * Thin operational wrapper around InvoiceService.reconcileGuardianCredits.
 * DRY-RUN by default — pass --apply to persist.
 *
 * Settles only credits whose paid invoice is fully backed by real
 * (delivered/scheduled) classes via the domino-shift engine. Credits still
 * genuinely owed are left untouched. Only flips the `settled` flag — never
 * moves guardian hours or paid totals. Reversible via the /unsettle endpoint.
 *
 *   node scripts/reconcile-credits.js --guardian <id>          # preview one
 *   node scripts/reconcile-credits.js --guardian <id> --apply  # persist one
 *   node scripts/reconcile-credits.js                          # preview all affected
 *   node scripts/reconcile-credits.js --apply                  # persist all affected
 */
require('dotenv').config();
const mongoose = require('mongoose');

const Invoice = require('../models/Invoice');
const User = require('../models/User');
const InvoiceService = require('../services/invoiceService');

const argv = process.argv.slice(2);
const getArg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const onlyGuardian = getArg('--guardian');
const apply = argv.includes('--apply');
const UNSETTLED_REASONS = ['class_deleted', 'duration_changed', 'class_cancelled', 'manual'];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/waraqadb');
  console.log(`🔧 Reconcile credits (${apply ? 'APPLY' : 'DRY-RUN'})\n`);

  let guardianIds = [];
  if (onlyGuardian) {
    guardianIds = [onlyGuardian];
  } else {
    const invs = await Invoice.find({
      type: 'guardian_invoice',
      deleted: { $ne: true },
      status: 'paid',
      adjustments: { $elemMatch: { type: 'credit', settled: { $ne: true }, reason: { $in: UNSETTLED_REASONS } } }
    }).select('guardian').lean();
    guardianIds = Array.from(new Set(invs.map((i) => String(i.guardian)).filter(Boolean)));
  }
  console.log(`Guardians with unsettled paid-invoice credits: ${guardianIds.length}\n`);

  let totalSettled = 0;
  let totalOwed = 0;
  let anyHoursChanged = false;

  for (const gid of guardianIds) {
    const g = await User.findById(gid).select('firstName lastName email').lean();
    const name = g ? (`${g.firstName || ''} ${g.lastName || ''}`.trim() || g.email) : gid;
    try {
      const summary = await InvoiceService.reconcileGuardianCredits(gid, { adminUserId: null, dryRun: !apply });
      totalSettled += summary.settled.length;
      totalOwed += summary.stillOwed.length;
      if (summary.hoursChanged) anyHoursChanged = true;
      console.log(
        `• ${name}: settled ${summary.settled.length}, still owed ${summary.stillOwed.length}; ` +
        `hours ${summary.hoursBefore} → ${summary.hoursAfter}${summary.hoursChanged ? '  ⚠️ HOURS CHANGED' : ''}`
      );
      for (const s of summary.settled) console.log(`    ✔ ${s.invoiceNumber}: ${s.description} (${s.hours}h / $${s.amount})`);
      for (const s of summary.stillOwed) console.log(`    … still owed ${s.invoiceNumber}: ${s.description} (shortfall ${s.shortfallHours}h)`);
    } catch (e) {
      console.warn(`  ✗ ${name}: ${e.message}`);
    }
  }

  console.log('\n──────── SUMMARY ────────');
  console.log(`Credits settled : ${totalSettled}`);
  console.log(`Still owed      : ${totalOwed}`);
  console.log(`Hours changed   : ${anyHoursChanged ? 'YES ⚠️ (should be NO — investigate)' : 'no'}`);
  console.log(`\n${apply ? 'Applied. Reversible via the /unsettle endpoint.' : 'Dry-run only — no data modified.'}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Reconcile failed:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
