const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Class = require('../models/Class');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';

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

const toId = (value) => {
  if (!value) return null;
  try {
    return value.toString();
  } catch (_) {
    return null;
  }
};

async function run() {
  const args = parseArgs();
  const guardianId = args.guardianId || args.guardian || null;
  const sinceDays = Number.isFinite(Number(args.sinceDays)) ? Number(args.sinceDays) : 365;

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const paidInvoices = await Invoice.find({
    deleted: { $ne: true },
    status: { $in: ['paid', 'refunded'] },
    ...(guardianId ? { guardian: guardianId } : {}),
    createdAt: { $gte: sinceDate }
  }).select('invoiceNumber guardian items createdAt').lean();

  const unpaidInvoices = await Invoice.find({
    deleted: { $ne: true },
    status: { $in: ['draft', 'pending', 'sent', 'overdue', 'partially_paid'] },
    ...(guardianId ? { guardian: guardianId } : {}),
    createdAt: { $gte: sinceDate }
  }).select('invoiceNumber guardian items createdAt').lean();

  const paidClassIds = new Set();
  const paidInvoiceMap = {};
  for (const inv of paidInvoices) {
    const invKey = inv.invoiceNumber || toId(inv._id);
    const classIds = (inv.items || []).map((it) => toId(it?.class || it?.lessonId)).filter(Boolean);
    classIds.forEach((id) => paidClassIds.add(id));
    paidInvoiceMap[invKey] = classIds;
  }

  const unpaidClassIds = new Set();
  const unpaidInvoiceMap = {};
  for (const inv of unpaidInvoices) {
    const invKey = inv.invoiceNumber || toId(inv._id);
    const classIds = (inv.items || []).map((it) => toId(it?.class || it?.lessonId)).filter(Boolean);
    classIds.forEach((id) => unpaidClassIds.add(id));
    unpaidInvoiceMap[invKey] = classIds;
  }

  const classes = await Class.find({
    ...(guardianId ? { 'student.guardianId': guardianId } : {}),
    scheduledDate: { $gte: sinceDate }
  }).select('_id scheduledDate duration status student teacher billedInInvoiceId paidByGuardian').lean();

  const markedPaid = classes.filter((cls) => cls.paidByGuardian === true);
  const markedUnpaid = classes.filter((cls) => !cls.paidByGuardian);

  console.log('\n=== Paid invoice class IDs ===');
  console.log(JSON.stringify(paidInvoiceMap, null, 2));

  console.log('\n=== Unpaid invoice class IDs ===');
  console.log(JSON.stringify(unpaidInvoiceMap, null, 2));

  console.log('\n=== Classes marked paid (paidByGuardian=true) ===');
  console.log(JSON.stringify(markedPaid.map((cls) => ({
    id: toId(cls._id),
    scheduledDate: cls.scheduledDate,
    duration: cls.duration,
    status: cls.status,
    billedInInvoiceId: toId(cls.billedInInvoiceId)
  })), null, 2));

  console.log('\n=== Classes marked unpaid (paidByGuardian!=true) ===');
  console.log(JSON.stringify(markedUnpaid.map((cls) => ({
    id: toId(cls._id),
    scheduledDate: cls.scheduledDate,
    duration: cls.duration,
    status: cls.status,
    billedInInvoiceId: toId(cls.billedInInvoiceId)
  })), null, 2));

  await mongoose.connection.close();
}

run().catch((err) => {
  console.error('Report failed:', err);
  process.exit(1);
});
