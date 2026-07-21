#!/usr/bin/env node
/**
 * inspect-guardian-invoice.js (READ-ONLY)
 * Prints a guardian invoice's stored items vs the rebalanced dynamic list vs the
 * billing period, so we can see exactly why the admin view and the public view
 * differ. Never writes.
 *   node scripts/inspect-guardian-invoice.js --slug waraqa-jun-2026-1739-1783505548091
 *   node scripts/inspect-guardian-invoice.js --id <objectId>
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const InvoiceService = require('../services/invoiceService');

const argv = process.argv.slice(2);
const getArg = (n) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const slug = getArg('--slug');
const id = getArg('--id');

const fmt = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toISOString().slice(0, 16).replace('T', ' ');
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/waraqadb');
  const query = slug ? { invoiceSlug: slug } : { _id: id };
  const inv = await Invoice.findOne(query)
    .populate('items.student', 'firstName lastName')
    .populate('items.teacher', 'firstName lastName');
  if (!inv) { console.log('Invoice not found'); await mongoose.disconnect(); return; }

  console.log(`\n=== ${inv.invoiceSlug || inv._id} (${inv.status}) ===`);
  console.log(`type=${inv.type} billingType=${inv.billingType || '—'} generationSource=${inv.generationSource || '—'}`);
  console.log(`billingPeriod: ${fmt(inv.billingPeriod?.startDate)}  ->  ${fmt(inv.billingPeriod?.endDate)}  (month=${inv.billingPeriod?.month} year=${inv.billingPeriod?.year})`);
  console.log(`coverage: strategy=${inv.coverage?.strategy || '—'} maxHours=${inv.coverage?.maxHours ?? '—'} endDate=${fmt(inv.coverage?.endDate)}`);
  console.log(`stored total=${inv.total} paidAmount=${inv.paidAmount} hoursCovered=${inv.hoursCovered ?? '—'}`);

  const stored = (inv.items || []).map((it) => ({ date: it.date, status: it.status, dur: it.duration, amount: it.amount }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log(`\n--- STORED items (${stored.length}) ---`);
  let sMin = null, sMax = null, sMinutes = 0, sAmount = 0;
  for (const it of stored) {
    const d = new Date(it.date);
    if (!sMin || d < sMin) sMin = d;
    if (!sMax || d > sMax) sMax = d;
    sMinutes += Number(it.dur || 0);
    sAmount += Number(it.amount || 0);
    console.log(`  ${fmt(it.date)}  ${String(it.status).padEnd(18)} ${it.dur}m  $${it.amount}`);
  }
  console.log(`  range ${fmt(sMin)} -> ${fmt(sMax)} | ${(sMinutes / 60).toFixed(2)}h | $${sAmount.toFixed(2)}`);

  const dyn = await InvoiceService.buildDynamicClassListRebalanced(inv);
  const dItems = (dyn?.items || []).map((it) => ({ date: it.date, status: it.status, dur: it.duration, amount: it.amount }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log(`\n--- REBALANCED dynamic items (${dItems.length}) capMinutes=${dyn?.capMinutes ?? '—'} totalHours=${dyn?.totalHours} ---`);
  let dMin = null, dMax = null, dMinutes = 0, dAmount = 0;
  for (const it of dItems) {
    const d = new Date(it.date);
    if (!dMin || d < dMin) dMin = d;
    if (!dMax || d > dMax) dMax = d;
    dMinutes += Number(it.dur || 0);
    dAmount += Number(it.amount || 0);
    console.log(`  ${fmt(it.date)}  ${String(it.status).padEnd(18)} ${it.dur}m  $${it.amount}`);
  }
  console.log(`  range ${fmt(dMin)} -> ${fmt(dMax)} | ${(dMinutes / 60).toFixed(2)}h | $${dAmount.toFixed(2)}`);

  console.log(`\nMISMATCH stored-vs-rebalanced: items ${stored.length} vs ${dItems.length}; ` +
    `range [${fmt(sMin)}->${fmt(sMax)}] vs [${fmt(dMin)}->${fmt(dMax)}]; $${sAmount.toFixed(2)} vs $${dAmount.toFixed(2)}\n`);

  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
