// Deep inspect of a single guardian's dual-storage state and admin view
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');
  const Student = require('../models/Student');
  const Guardian = require('../models/Guardian');
  const User = require('../models/User');
  const Invoice = require('../models/Invoice');
  const Class = require('../models/Class');
  const { computeGuardianHoursFromPaidInvoices } = require('../services/guardianHoursService');

  const guardianId = process.argv[2] || '696360fd5e85608fd2216371';
  console.log('=== INSPECTING GUARDIAN:', guardianId, '===\n');

  // 1. User record (embedded)
  const user = await User.findById(guardianId).lean();
  console.log('--- USER RECORD ---');
  console.log('Name:', user?.firstName, user?.lastName);
  console.log('totalHours (stored):', user?.guardianInfo?.totalHours);
  console.log('autoTotalHours:', user?.guardianInfo?.autoTotalHours);
  const embedded = user?.guardianInfo?.students || [];
  console.log('Embedded students:', embedded.length);
  for (const s of embedded) {
    console.log(`  embedded _id=${s._id} name="${s.firstName} ${s.lastName}" hoursRemaining=${s.hoursRemaining} standaloneStudentId=${s.standaloneStudentId} isActive=${s.isActive}`);
  }

  // 2. Standalone students
  const standalones = await Student.find({ guardian: guardianId }).lean();
  console.log('\n--- STANDALONE STUDENTS ---');
  console.log('Count:', standalones.length);
  for (const s of standalones) {
    console.log(`  standalone _id=${s._id} name="${s.firstName} ${s.lastName}" hoursRemaining=${s.hoursRemaining} isActive=${s.isActive} guardian=${s.guardian}`);
  }

  // 3. Guardian model
  const gm = await Guardian.findOne({ user: guardianId }).lean();
  console.log('\n--- GUARDIAN MODEL ---');
  if (gm) {
    console.log(`  _id=${gm._id} students=[${(gm.students || []).join(',')}] totalRemainingMinutes=${gm.totalRemainingMinutes}`);
  } else {
    console.log('  NOT FOUND');
  }

  // 4. Computed hours (what admin would see)
  const hoursMap = await computeGuardianHoursFromPaidInvoices([guardianId]);
  const entry = hoursMap.get(guardianId);
  console.log('\n--- COMPUTED HOURS (admin view) ---');
  console.log('totalHours:', entry?.totalHours);
  if (entry?.studentHours) {
    entry.studentHours.forEach((hours, studentId) => {
      console.log(`  studentId=${studentId} hours=${hours}`);
    });
  }

  // 5. Invoice items - what student IDs they use
  const invoices = await Invoice.find({ guardian: guardianId, deleted: { $ne: true }, status: 'paid' }).lean();
  console.log('\n--- PAID INVOICE ITEMS (student IDs) ---');
  for (const inv of invoices) {
    console.log(`Invoice ${inv.invoiceNumber || inv._id} (${inv.status}):`);
    for (const item of (inv.items || [])) {
      console.log(`  item student=${item.student} duration=${item.duration}min`);
    }
  }

  // 6. Class student IDs
  const classes = await Class.find({
    'student.guardianId': guardianId,
    status: { $in: ['attended', 'missed_by_student', 'absent'] }
  }).select('student status duration').lean();
  console.log('\n--- COUNTABLE CLASSES (student IDs) ---');
  for (const c of classes) {
    console.log(`  class studentId=${c.student?.studentId} student._id=${c.student?._id} status=${c.status} duration=${c.duration}min`);
  }

  // 7. ID mapping summary
  console.log('\n--- ID MAPPING SUMMARY ---');
  const allStudentIds = new Set();
  for (const s of embedded) {
    allStudentIds.add(`embedded:${s._id}`);
    if (s.standaloneStudentId) allStudentIds.add(`embedded→standalone:${s.standaloneStudentId}`);
  }
  for (const s of standalones) allStudentIds.add(`standalone:${s._id}`);
  for (const inv of invoices) {
    for (const item of (inv.items || [])) {
      if (item.student) allStudentIds.add(`invoice_item:${item.student}`);
    }
  }
  for (const c of classes) {
    if (c.student?.studentId) allStudentIds.add(`class.student.studentId:${c.student.studentId}`);
    if (c.student?._id) allStudentIds.add(`class.student._id:${c.student._id}`);
  }
  for (const id of allStudentIds) console.log(`  ${id}`);

  await mongoose.disconnect();
})();
