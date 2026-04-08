/**
 * Test: Delete a paid invoice and verify guardian hours + classes are properly reversed.
 * Run: node scripts/test-delete-paid-invoice.js
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/waraqa';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const User = require('../models/User');
  const Invoice = require('../models/Invoice');
  const Class = require('../models/Class');
  const Payment = require('../models/Payment');

  // Find a paid invoice with a guardian that has items
  const paidInvoice = await Invoice.findOne({
    status: 'paid',
    paidAmount: { $gt: 0 },
    'items.0': { $exists: true },
    guardian: { $exists: true, $ne: null }
  }).sort({ updatedAt: -1 });

  if (!paidInvoice) {
    console.log('No paid invoices with items found. Creating a test scenario...');
    console.log('\nTo test manually:');
    console.log('1. Create an invoice for a guardian');
    console.log('2. Record a payment on it');
    console.log('3. Note the guardian totalHours');
    console.log('4. Delete the invoice (force=true)');
    console.log('5. Check guardian totalHours decreased by the paid hours');
    await mongoose.disconnect();
    return;
  }

  const guardianId = paidInvoice.guardian._id || paidInvoice.guardian;
  const guardian = await User.findById(guardianId);
  if (!guardian) {
    console.log('Guardian not found:', guardianId);
    await mongoose.disconnect();
    return;
  }

  const hourlyRate = (() => {
    const fromInvoice = Number(paidInvoice?.guardianFinancial?.hourlyRate || 0);
    if (fromInvoice > 0) return fromInvoice;
    const items = paidInvoice.items || [];
    const hours = items.reduce((s, it) => s + ((Number(it?.duration || 0)) / 60), 0);
    const amount = items.reduce((s, it) => s + (Number(it?.amount || 0)), 0);
    if (hours > 0 && amount > 0) return Math.round((amount / hours) * 100) / 100;
    return 10;
  })();

  // Calculate net credited hours from payment logs
  const logs = Array.isArray(paidInvoice.paymentLogs) ? paidInvoice.paymentLogs : [];
  let netCreditedHours = 0;
  for (const log of logs) {
    if (!log || log.method === 'tip_distribution') continue;
    const amount = Number(log.amount || 0);
    const loggedHours = Number.isFinite(log.paidHours) ? Number(log.paidHours)
      : (hourlyRate > 0 ? Math.abs(amount) / hourlyRate : 0);
    if (!Number.isFinite(loggedHours) || loggedHours <= 0) continue;
    if (amount < 0 || log.method === 'refund') {
      netCreditedHours -= loggedHours;
    } else {
      netCreditedHours += loggedHours;
    }
  }
  netCreditedHours = Math.max(0, Math.round(netCreditedHours * 1000) / 1000);

  const classIds = (paidInvoice.items || []).map(it => it.class || it.lessonId).filter(Boolean);
  const linkedClasses = await Class.countDocuments({ _id: { $in: classIds }, billedInInvoiceId: paidInvoice._id });
  const payments = await Payment.countDocuments({ invoice: paidInvoice._id });

  console.log('\n=== PRE-DELETE STATE ===');
  console.log(`Invoice: ${paidInvoice.invoiceNumber} (${paidInvoice._id})`);
  console.log(`Status: ${paidInvoice.status}, paidAmount: $${paidInvoice.paidAmount}`);
  console.log(`Items: ${(paidInvoice.items || []).length}`);
  console.log(`Payment logs: ${logs.length}, netCreditedHours: ${netCreditedHours}`);
  console.log(`Hourly rate: $${hourlyRate}`);
  console.log(`Guardian: ${guardian._id}, totalHours: ${guardian.guardianInfo?.totalHours}`);
  console.log(`Classes linked to invoice: ${linkedClasses} / ${classIds.length}`);
  console.log(`Payment records: ${payments}`);
  console.log(`Expected guardian hours after delete: ${Math.round(((guardian.guardianInfo?.totalHours || 0) - netCreditedHours) * 1000) / 1000}`);

  console.log('\n⚠️  This is a READ-ONLY test. To actually test deletion:');
  console.log(`   curl -X DELETE "http://localhost:5000/api/invoices/${paidInvoice._id}?force=true&preserveHours=false" -H "Authorization: Bearer <token>"`);
  console.log('\nThen verify:');
  console.log(`   - Guardian totalHours decreased by ${netCreditedHours}`);
  console.log(`   - ${classIds.length} classes have billedInInvoiceId cleared`);
  console.log(`   - ${payments} Payment records deleted`);

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
