require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');
const InvoiceAudit = require('../models/InvoiceAudit');
const GuardianHoursAudit = require('../models/GuardianHoursAudit');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb';
const dryRun = String(process.argv[2] || '').toLowerCase() === 'dry';

const COUNTABLE_ATTENDANCE = new Set(['attended', 'missed_by_student']);
const COUNTABLE_STATUS = new Set(['attended', 'missed_by_student']);

const roundHours = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 1000) / 1000;
};

const shouldCountClass = (cls) => {
  const attendance = cls?.classReport?.attendance || null;
  if (attendance === 'missed_by_student' && cls?.classReport?.countAbsentForBilling === false) return false;
  if (attendance && COUNTABLE_ATTENDANCE.has(attendance)) return true;
  const status = cls?.status || null;
  return COUNTABLE_STATUS.has(status);
};

async function removeGuardianInvoices() {
  const invoices = await Invoice.find({ type: 'guardian_invoice' })
    .select('_id guardian items.class items.lessonId')
    .lean();

  const invoiceIds = invoices.map((inv) => inv._id).filter(Boolean);
  const classIds = new Set();
  invoices.forEach((inv) => {
    const items = Array.isArray(inv.items) ? inv.items : [];
    items.forEach((item) => {
      if (item?.class) classIds.add(String(item.class));
      if (item?.lessonId) classIds.add(String(item.lessonId));
    });
  });

  console.log(`Found guardian invoices: ${invoiceIds.length}`);
  console.log(`Found linked classes: ${classIds.size}`);

  if (dryRun) return { invoiceIds, classIds: Array.from(classIds) };

  if (classIds.size) {
    await Class.updateMany(
      { _id: { $in: Array.from(classIds) } },
      { $unset: { billedInInvoiceId: 1, billedAt: 1 } }
    );
  }

  if (invoiceIds.length) {
    await InvoiceAudit.deleteMany({ invoiceId: { $in: invoiceIds } });
    await Invoice.deleteMany({ _id: { $in: invoiceIds } });
  }

  return { invoiceIds, classIds: Array.from(classIds) };
}

async function recomputeGuardianHours() {
  const guardians = await User.find({ role: 'guardian' });
  let processed = 0;

  for (const guardian of guardians) {
    const guardianId = guardian._id;
    guardian.guardianInfo = guardian.guardianInfo && typeof guardian.guardianInfo === 'object'
      ? guardian.guardianInfo
      : {};

    const firstAttended = await Class.find({
      'student.guardianId': guardianId,
      deleted: { $ne: true },
      $or: [
        { status: 'attended' },
        { 'classReport.attendance': 'attended' }
      ]
    })
      .sort({ scheduledDate: 1 })
      .select('scheduledDate')
      .lean();

    const firstAttendedAt = firstAttended?.[0]?.scheduledDate || null;

    let classes = [];
    if (firstAttendedAt) {
      classes = await Class.find({
        'student.guardianId': guardianId,
        deleted: { $ne: true },
        scheduledDate: { $gte: firstAttendedAt },
        $or: [
          { status: { $in: Array.from(COUNTABLE_STATUS) } },
          { 'classReport.attendance': { $in: Array.from(COUNTABLE_ATTENDANCE) } }
        ]
      })
        .select('duration status classReport student.studentId')
        .lean();
    }

    const consumedByStudent = new Map();
    let totalConsumed = 0;

    for (const cls of classes) {
      if (!shouldCountClass(cls)) continue;
      const durationHours = Number(cls?.duration || 0) / 60;
      if (!Number.isFinite(durationHours) || durationHours <= 0) continue;
      totalConsumed += durationHours;
      const sid = cls?.student?.studentId ? String(cls.student.studentId) : null;
      if (sid) consumedByStudent.set(sid, (consumedByStudent.get(sid) || 0) + durationHours);
    }

    const normalizedConsumed = roundHours(totalConsumed);
    const totalHours = roundHours(-normalizedConsumed);

    const studentsArray = Array.isArray(guardian.guardianInfo.students)
      ? guardian.guardianInfo.students
      : [];

    studentsArray.forEach((s, idx) => {
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
      studentsArray[idx].hoursRemaining = roundHours(-consumed);
    });

    if (!dryRun) {
      guardian.guardianInfo.autoTotalHours = false;
      guardian.guardianInfo.totalHours = totalHours;
      guardian.markModified('guardianInfo.students');
      guardian.markModified('guardianInfo');
      await guardian.save();
    }

    processed += 1;
    console.log(`${guardian.email || guardian._id}: totalHours=${totalHours} (consumed=${normalizedConsumed})`);
  }

  console.log(`Guardians processed: ${processed}`);
}

async function main() {
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  const auditCount = await GuardianHoursAudit.countDocuments({ action: 'hours_manual_adjust' });
  console.log(`Guardian hours audit logs to delete: ${auditCount}`);

  if (!dryRun && auditCount) {
    await GuardianHoursAudit.deleteMany({ action: 'hours_manual_adjust' });
  }

  await removeGuardianInvoices();
  await recomputeGuardianHours();

  await mongoose.disconnect();
  console.log('✅ Done');
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});