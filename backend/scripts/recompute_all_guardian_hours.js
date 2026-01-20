require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');
const Guardian = require('../models/Guardian');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
const mode = String(process.argv[2] || 'billing').toLowerCase(); // billing | students
const dryRun = String(process.argv[3] || '').toLowerCase() === 'dry';

const COUNTABLE_STATUSES = new Set(['attended', 'missed_by_student', 'absent']);

async function computeForGuardian(guardian) {
  guardian.guardianInfo = guardian.guardianInfo && typeof guardian.guardianInfo === 'object' ? guardian.guardianInfo : {};
  const students = Array.isArray(guardian.guardianInfo.students) ? guardian.guardianInfo.students : [];

  const classes = await Class.find({
    'student.guardianId': guardian._id,
    deleted: { $ne: true }
  })
    .select('_id student status duration classReport')
    .lean();

  const consumedByStudent = new Map();
  let totalConsumed = 0;
  for (const cls of classes) {
    const status = cls?.status;
    if (!COUNTABLE_STATUSES.has(status)) continue;
    const durationHours = Number(cls?.duration || 0) / 60;
    if (!Number.isFinite(durationHours) || durationHours <= 0) continue;
    totalConsumed += durationHours;
    const sid = cls?.student?.studentId ? String(cls.student.studentId) : null;
    if (!sid) continue;
    consumedByStudent.set(sid, (consumedByStudent.get(sid) || 0) + durationHours);
  }

  const perStudent = [];
  for (const s of students) {
    const candidateIds = [
      s?._id,
      s?.id,
      s?.studentId,
      s?.standaloneStudentId,
      s?.studentInfo?.standaloneStudentId
    ]
      .filter(Boolean)
      .map((v) => String(v));
    const consumed = candidateIds.reduce((sum, id) => sum + (consumedByStudent.get(id) || 0), 0);
    const newHoursRemaining = Math.round((-consumed) * 1000) / 1000;
    perStudent.push({ id: s?._id || s?.studentId || s?.standaloneStudentId || null, consumedHours: consumed, hoursRemaining: newHoursRemaining });
  }

  let creditedHours = 0;
  if (mode === 'billing') {
    const invoices = await Invoice.find({ guardian: guardian._id, deleted: { $ne: true } }).lean();
    for (const invoice of invoices) {
      const logs = Array.isArray(invoice.paymentLogs) ? invoice.paymentLogs : [];
      const invoiceRate = Number(invoice?.guardianFinancial?.hourlyRate || 0)
        || Number(guardian.guardianInfo?.hourlyRate || 0)
        || 10;
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
  }

  const normalizedConsumed = Math.round(totalConsumed * 1000) / 1000;
  const normalizedCredited = Math.round(creditedHours * 1000) / 1000;
  const totalHours = mode === 'billing'
    ? Math.round((normalizedCredited - normalizedConsumed) * 1000) / 1000
    : perStudent.reduce((sum, s) => sum + (Number(s.hoursRemaining) || 0), 0);

  if (!dryRun) {
    const studentsArray = Array.isArray(guardian.guardianInfo.students) ? guardian.guardianInfo.students : [];
    perStudent.forEach((entry) => {
      const target = String(entry.id || '');
      const idx = studentsArray.findIndex((s) => {
        const candidates = [
          s?._id,
          s?.id,
          s?.studentId,
          s?.standaloneStudentId,
          s?.studentInfo?.standaloneStudentId
        ]
          .filter(Boolean)
          .map((v) => String(v));
        return candidates.includes(target);
      });
      if (idx !== -1) studentsArray[idx].hoursRemaining = entry.hoursRemaining;
    });

    guardian.guardianInfo.autoTotalHours = mode === 'students';
    guardian.guardianInfo.totalHours = totalHours;
    guardian.markModified('guardianInfo.students');
    guardian.markModified('guardianInfo');
    await guardian.save();
    try {
      await Guardian.updateTotalRemainingMinutes(guardian._id);
    } catch (_) {}
  }

  return { totalConsumed: normalizedConsumed, totalCredited: normalizedCredited, totalHours };
}

async function main() {
  await mongoose.connect(uri);
  const guardians = await User.find({ role: 'guardian' });
  let processed = 0;
  for (const guardian of guardians) {
    const result = await computeForGuardian(guardian);
    processed += 1;
    console.log(`${guardian.email || guardian._id}: totalHours=${result.totalHours} (consumed=${result.totalConsumed}, credited=${result.totalCredited})`);
  }
  console.log(`Done. Guardians processed: ${processed}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
