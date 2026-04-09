// Verify what the admin endpoints actually return for a guardian
require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');
  const User = require('../models/User');
  const Student = require('../models/Student');
  const { computeGuardianHoursFromPaidInvoices, normalizeId } = require('../services/guardianHoursService');

  const guardianId = process.argv[2] || '696360fd5e85608fd2216371';

  // 1. What computeGuardianHoursFromPaidInvoices returns
  const hoursMap = await computeGuardianHoursFromPaidInvoices([guardianId]);
  const entry = hoursMap.get(guardianId);
  console.log('=== COMPUTED HOURS MAP ===');
  console.log('totalHours:', entry?.totalHours);
  if (entry?.studentHours) {
    entry.studentHours.forEach((h, sid) => console.log(`  key=${sid} hours=${h}`));
  }

  // 2. Check if admin student search returns these students
  const students = await Student.find({
    $or: [
      { firstName: { $regex: 'Yeota', $options: 'i' } },
      { lastName: { $regex: 'Imam', $options: 'i' } },
    ]
  }).lean();
  console.log('\n=== STUDENT SEARCH "Yeota" ===');
  console.log('Results:', students.length);
  for (const s of students) {
    console.log(`  _id=${s._id} name="${s.firstName} ${s.lastName}" guardian=${s.guardian} hoursRemaining=${s.hoursRemaining} isActive=${s.isActive}`);
  }

  // 3. Simulate what GET /users/:guardianId/students returns
  // This is the endpoint called when admin expands a guardian
  const guardian = await User.findById(guardianId).lean();
  const embedded = guardian?.guardianInfo?.students || [];
  const standalone = await Student.find({ guardian: guardianId }).lean();

  console.log('\n=== MERGED STUDENTS (what admin expansion returns) ===');
  // Simulate the dedup logic from users.js
  const byKey = new Map();
  for (const s of embedded) {
    const obj = typeof s.toObject === 'function' ? s.toObject() : { ...s };
    obj.guardianId = guardianId;
    obj._source = 'embedded';
    const key = obj.standaloneStudentId ? String(obj.standaloneStudentId) : `emb-${obj._id}`;
    byKey.set(key, obj);
  }
  for (const s of standalone) {
    const obj = { ...s, guardianId, _source: 'standalone' };
    const key = String(s._id);
    const existing = byKey.get(key);
    if (!existing) byKey.set(key, obj);
  }

  const combined = Array.from(byKey.values());
  console.log('Combined count:', combined.length);

  // Simulate applyComputedStudentHours
  for (const student of combined) {
    const candidateIds = [
      student.standaloneStudentId,
      student.studentInfo?.standaloneStudentId,
      student.studentId,
      student._id,
      student.id
    ].map(normalizeId).filter(Boolean);

    let hours = 0;
    if (entry) {
      for (const candidate of candidateIds) {
        if (entry.studentHours.has(candidate)) {
          hours = entry.studentHours.get(candidate);
          break;
        }
      }
    }

    console.log(`  name="${student.firstName} ${student.lastName}" _source=${student._source} candidates=[${candidateIds.join(',')}] computedHours=${hours} storedHours=${student.hoursRemaining}`);
  }

  // 4. Check admin guardian list — what totalHours is returned
  console.log('\n=== ADMIN GUARDIAN LIST ===');
  console.log('Store totalHours:', guardian?.guardianInfo?.totalHours);
  console.log('Computed totalHours:', entry?.totalHours);

  await mongoose.disconnect();
})();
