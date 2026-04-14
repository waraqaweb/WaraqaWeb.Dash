#!/usr/bin/env node
/**
 * Verify guardian hours consistency across all data paths.
 * Usage: node verify-guardian-hours.js [guardianId]
 * Default: 696360fd5e85608fd2216371 (Yeota)
 */
const mongoose = require('mongoose');
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://mongo:27017/waraqadb';

async function run() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  const gid = process.argv[2] || '696360fd5e85608fd2216371';

  // 1. Check stored values (embedded)
  const user = await db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(gid) });
  if (!user) { console.log('Guardian not found:', gid); process.exit(1); }
  const embedded = user?.guardianInfo?.students || [];
  console.log('=== STORED VALUES ===');
  console.log('guardianInfo.totalHours:', user?.guardianInfo?.totalHours);
  embedded.forEach(s => console.log('  embedded', s.firstName, 'hoursRemaining:', s.hoursRemaining));

  // 2. Check standalone students
  const standaloneIds = embedded.map(s => s.standaloneStudentId).filter(Boolean);
  if (standaloneIds.length) {
    const standalone = await db.collection('students').find({
      _id: { $in: standaloneIds.map(id => new mongoose.Types.ObjectId(String(id))) }
    }).toArray();
    standalone.forEach(s => console.log('  standalone', s.firstName, 'hoursRemaining:', s.hoursRemaining));
  }

  // 3. Compute hours using the service
  const { computeGuardianHoursFromPaidInvoices } = require('../services/guardianHoursService');
  const hoursMap = await computeGuardianHoursFromPaidInvoices([gid]);
  const entry = hoursMap.get(gid);
  console.log('\n=== COMPUTED VALUES ===');
  console.log('totalHours:', entry?.totalHours);
  (entry?.students || []).forEach(s => console.log('  student', s.studentName, 'remaining:', s.hoursRemaining));

  // 4. Check invoices (paid)
  const invoices = await db.collection('invoices').find({
    guardian: new mongoose.Types.ObjectId(gid), status: 'paid'
  }).toArray();
  console.log('\n=== PAID INVOICES ===');
  invoices.forEach(inv => {
    const paid = (inv.paymentLogs || []).reduce((s, p) => s + (p.paidHours || 0), 0);
    console.log('  Invoice', inv.invoiceNumber, 'items:', inv.items?.length, 'paymentLogs paidHours:', paid);
  });

  // 5. Check consistency
  console.log('\n=== CONSISTENCY CHECK ===');
  const storedTotal = user?.guardianInfo?.totalHours;
  const computedTotal = entry?.totalHours;
  if (storedTotal === computedTotal) {
    console.log('OK: stored totalHours matches computed:', storedTotal);
  } else {
    console.log('MISMATCH: stored', storedTotal, 'vs computed', computedTotal);
  }

  await mongoose.disconnect();
}
run().catch(e => { console.error(e.message); process.exit(1); });
