require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');
const Guardian = require('../models/Guardian');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
const dryRun = String(process.argv[2] || '').toLowerCase() === 'dry';

const COUNTABLE_STATUSES = new Set(['attended', 'missed_by_student', 'absent']);
const EPSILON_HOURS = 0.0001;

const roundHours = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000;

const resolveStudentKey = (value) => {
  if (!value) return null;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

const extractPaidHours = (invoice, guardianHourlyRate) => {
  const logs = Array.isArray(invoice.paymentLogs) ? invoice.paymentLogs : [];
  const invoiceRate = Number(invoice?.guardianFinancial?.hourlyRate || 0)
    || Number(guardianHourlyRate || 0)
    || 10;

  let paidHours = 0;
  for (const log of logs) {
    if (!log || typeof log.amount !== 'number' || log.amount <= 0) continue;
    if (log.method === 'refund' || log.method === 'tip_distribution') continue;
    if (log.paidHours !== undefined && log.paidHours !== null) {
      paidHours += Number(log.paidHours) || 0;
    } else {
      paidHours += Number(log.amount || 0) / invoiceRate;
    }
  }

  return roundHours(paidHours);
};

const computeGuardian = async (guardian) => {
  guardian.guardianInfo = guardian.guardianInfo && typeof guardian.guardianInfo === 'object'
    ? guardian.guardianInfo
    : {};

  const students = Array.isArray(guardian.guardianInfo.students)
    ? guardian.guardianInfo.students
    : [];

  const classes = await Class.find({
    'student.guardianId': guardian._id,
    deleted: { $ne: true }
  }).select('student status duration').lean();

  const consumedByStudent = new Map();
  let totalConsumed = 0;
  for (const cls of classes) {
    if (!COUNTABLE_STATUSES.has(cls?.status)) continue;
    const durationHours = Number(cls?.duration || 0) / 60;
    if (!Number.isFinite(durationHours) || durationHours <= 0) continue;
    totalConsumed += durationHours;
    const sid = cls?.student?.studentId ? String(cls.student.studentId) : null;
    if (!sid) continue;
    consumedByStudent.set(sid, roundHours((consumedByStudent.get(sid) || 0) + durationHours));
  }

  const invoices = await Invoice.find({ guardian: guardian._id, deleted: { $ne: true } }).lean();
  const paidByStudent = new Map();
  let unassignedPaidHours = 0;

  for (const invoice of invoices) {
    const itemsAsc = Array.isArray(invoice.items)
      ? [...invoice.items].sort((a, b) => {
        const da = new Date(a?.date || 0).getTime();
        const db = new Date(b?.date || 0).getTime();
        return da - db;
      })
      : [];

    const totalItemHours = itemsAsc.reduce((sum, item) => sum + (Number(item?.duration || 0) || 0) / 60, 0);
    if (totalItemHours <= 0) continue;

    let coverageHours = null;
    if (invoice.coverage && Number.isFinite(Number(invoice.coverage.maxHours))) {
      coverageHours = Math.min(totalItemHours, Math.max(0, Number(invoice.coverage.maxHours)));
    } else if (invoice.status === 'paid') {
      coverageHours = totalItemHours;
    } else {
      const paidHours = extractPaidHours(invoice, guardian.guardianInfo?.hourlyRate || 0);
      coverageHours = Math.min(totalItemHours, paidHours);
    }

    if (!coverageHours || coverageHours <= EPSILON_HOURS) continue;

    let remaining = coverageHours;
    for (const item of itemsAsc) {
      if (remaining <= EPSILON_HOURS) break;
      if (!item || item.excludeFromStudentBalance || item.exemptFromGuardian || (item.flags && (item.flags.notCountForBoth || item.flags.exemptFromGuardian))) {
        continue;
      }
      const itemHours = (Number(item?.duration || 0) || 0) / 60;
      if (itemHours <= 0) continue;
      const slice = Math.min(itemHours, remaining);
      const studentKey = resolveStudentKey(item.student);
      if (studentKey) {
        paidByStudent.set(studentKey, roundHours((paidByStudent.get(studentKey) || 0) + slice));
      } else {
        unassignedPaidHours = roundHours(unassignedPaidHours + slice);
      }
      remaining = roundHours(remaining - slice);
    }
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
      .map((value) => String(value));

    const consumed = candidateIds.reduce((sum, id) => sum + (consumedByStudent.get(id) || 0), 0);
    const paid = candidateIds.reduce((sum, id) => sum + (paidByStudent.get(id) || 0), 0);
    const newHoursRemaining = roundHours(paid - consumed);
    perStudent.push({
      id: s?._id || s?.studentId || s?.standaloneStudentId || null,
      hoursRemaining: newHoursRemaining
    });
  }

  const studentTotal = perStudent.reduce((sum, s) => sum + (Number(s.hoursRemaining) || 0), 0);
  const totalHours = roundHours(studentTotal + unassignedPaidHours);

  if (!dryRun) {
    const studentsArray = Array.isArray(guardian.guardianInfo.students)
      ? guardian.guardianInfo.students
      : [];

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
          .map((value) => String(value));
        return candidates.includes(target);
      });
      if (idx !== -1) studentsArray[idx].hoursRemaining = entry.hoursRemaining;
    });

    guardian.guardianInfo.autoTotalHours = unassignedPaidHours > EPSILON_HOURS ? false : true;
    guardian.guardianInfo.totalHours = totalHours;
    guardian.guardianInfo.cumulativeConsumedHours = roundHours(totalConsumed);
    guardian.markModified('guardianInfo.students');
    guardian.markModified('guardianInfo');
    await guardian.save();

    try {
      await Guardian.updateTotalRemainingMinutes(guardian._id);
    } catch (_) {}
  }

  return {
    totalConsumed: roundHours(totalConsumed),
    totalPaidUnassigned: unassignedPaidHours,
    totalHours
  };
};

const main = async () => {
  await mongoose.connect(uri);
  const guardians = await User.find({ role: 'guardian' });
  let processed = 0;
  let unassignedCount = 0;

  for (const guardian of guardians) {
    const result = await computeGuardian(guardian);
    processed += 1;
    if (result.totalPaidUnassigned > EPSILON_HOURS) {
      unassignedCount += 1;
      console.log(`[warn] ${guardian.email || guardian._id} has ${result.totalPaidUnassigned} unassigned paid hours`);
    }
    console.log(`${guardian.email || guardian._id}: totalHours=${result.totalHours} (consumed=${result.totalConsumed})`);
  }

  console.log(`Done. Guardians processed: ${processed}. Unassigned hours: ${unassignedCount}`);
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
