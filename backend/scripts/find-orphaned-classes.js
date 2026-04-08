// Find ALL classes that have billedInInvoiceId pointing to a paid invoice but no matching item
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');
  const Class = require('../models/Class');
  const Invoice = require('../models/Invoice');
  const User = require('../models/User');

  const COUNTABLE = new Set(['attended', 'missed_by_student', 'absent']);

  // All paid invoices with items
  const paidInvoices = await Invoice.find({ status: 'paid', deleted: { $ne: true } }).lean();

  // Build map: invoiceId -> set of classIds in items
  const invoiceItemClassIds = new Map();
  for (const inv of paidInvoices) {
    const classIds = new Set();
    for (const item of (inv.items || [])) {
      const cid = item.class ? String(item.class) : item.lessonId ? String(item.lessonId) : null;
      if (cid) classIds.add(cid);
    }
    invoiceItemClassIds.set(String(inv._id), classIds);
  }

  // Find all consumed classes with billedInInvoiceId
  const paidInvIds = paidInvoices.map(i => i._id);
  const orphanedClasses = await Class.find({
    billedInInvoiceId: { $in: paidInvIds },
    status: { $in: Array.from(COUNTABLE) },
    deleted: { $ne: true }
  }).select('student status duration scheduledDate subject billedInInvoiceId').sort({ scheduledDate: 1 }).lean();

  let orphanCount = 0;
  let totalOrphanedHours = 0;
  const byGuardian = {};

  for (const c of orphanedClasses) {
    const classId = String(c._id);
    const invoiceId = String(c.billedInInvoiceId);
    const itemSet = invoiceItemClassIds.get(invoiceId);

    if (itemSet && itemSet.has(classId)) continue; // has a matching item, OK

    orphanCount++;
    const hours = (c.duration || 0) / 60;
    totalOrphanedHours += hours;

    const gid = c.student?.guardianId ? String(c.student.guardianId) : 'unknown';
    if (!byGuardian[gid]) byGuardian[gid] = [];
    byGuardian[gid].push({
      classId,
      date: c.scheduledDate ? new Date(c.scheduledDate).toISOString().slice(0, 10) : '?',
      student: c.student?.studentName || '?',
      status: c.status,
      duration: c.duration,
      subject: c.subject,
      invoiceId,
    });
  }

  console.log(`=== ORPHANED CLASSES (in paid invoices, no matching item) ===`);
  console.log(`Total orphaned: ${orphanCount} classes, ${totalOrphanedHours.toFixed(2)}h\n`);

  // Get guardian names
  const guardianIds = Object.keys(byGuardian).filter(id => id !== 'unknown');
  const guardianUsers = await User.find({ _id: { $in: guardianIds } }).select('firstName lastName').lean();
  const nameMap = new Map(guardianUsers.map(u => [String(u._id), `${u.firstName} ${u.lastName}`]));

  for (const [gid, classes] of Object.entries(byGuardian)) {
    const name = nameMap.get(gid) || gid;
    const totalH = classes.reduce((s, c) => s + c.duration / 60, 0);
    console.log(`\n${name} (${gid}) — ${classes.length} orphaned, ${totalH.toFixed(2)}h:`);
    for (const c of classes) {
      console.log(`  ${c.date} | ${c.student.padEnd(20)} | ${c.status.padEnd(20)} | ${c.duration}min | inv=${c.invoiceId} | class=${c.classId}`);
    }
  }

  await mongoose.disconnect();
})();
