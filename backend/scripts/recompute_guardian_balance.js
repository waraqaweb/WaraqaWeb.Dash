require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const Class = require('../models/Class');
require('../models/Student');
const GuardianModel = require('../models/Guardian');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/online-class-manager';

const GUARDIAN_ATTENDANCE_STATUSES = new Set(['attended']);

aSyncMain().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});

async function aSyncMain() {
  const emailArg = process.argv[2];
  if (!emailArg) {
    console.error('Usage: node scripts/recompute_guardian_balance.js <guardian-email>');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  const guardian = await User.findOne({ email: emailArg, role: 'guardian' });
  if (!guardian) {
    console.error('Guardian not found for email', emailArg);
    process.exit(1);
  }

  const guardianId = guardian._id;

  const invoices = await Invoice.find({ guardian: guardianId, deleted: { $ne: true } }).lean();
  let creditedHours = 0;
  for (const invoice of invoices) {
    const logs = Array.isArray(invoice.paymentLogs) ? invoice.paymentLogs : [];
    const invoiceRate = Number(invoice?.guardianFinancial?.hourlyRate || 0) || Number(guardian.guardianInfo?.hourlyRate || 0) || 10;
    for (const log of logs) {
      if (!log || typeof log.amount !== 'number' || log.amount <= 0) continue;
      if (log.method === 'refund' || log.method === 'tip_distribution') continue;
      if (log.paidHours !== undefined && log.paidHours !== null) {
        creditedHours += Number(log.paidHours) || 0;
      } else {
        creditedHours += Number(log.amount || 0) / invoiceRate;
      }
    }
  }

  const classes = await Class.find({
    'student.guardianId': guardianId,
    deleted: { $ne: true }
  }).lean();

  let consumedHours = 0;
  for (const cls of classes) {
    const attendance = cls?.classReport?.attendance;
    const countsAsConsumed = GUARDIAN_ATTENDANCE_STATUSES.has(attendance) || (
      attendance === 'missed_by_student' && cls?.classReport?.countAbsentForBilling
    );
    if (!countsAsConsumed) continue;
    const durationHours = Number(cls?.duration || 0) / 60;
    if (Number.isFinite(durationHours) && durationHours > 0) {
      consumedHours += durationHours;
    }
  }

  const previousTotal = Number(guardian.guardianInfo?.totalHours || 0);
  const newTotal = Math.round((creditedHours - consumedHours) * 1000) / 1000;

  guardian.guardianInfo = guardian.guardianInfo || {};
  guardian.guardianInfo.autoTotalHours = false;
  guardian.guardianInfo.totalHours = newTotal;
  await guardian.save();

  try {
    await GuardianModel.updateTotalRemainingMinutes(guardianId);
  } catch (err) {
    console.warn('⚠️ Failed to sync guardian minutes:', err?.message || err);
  }

  console.log('Guardian:', guardian.firstName, guardian.lastName);
  console.log('Previous total hours:', previousTotal);
  console.log('Credited hours from payments:', creditedHours);
  console.log('Consumed hours from classes:', consumedHours);
  console.log('✅ Updated total hours:', newTotal);

  await mongoose.disconnect();
  process.exit(0);
}
