// Simulate the exact API responses admin and guardian would see
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');
  const User = require('../models/User');
  const Student = require('../models/Student');
  const { computeGuardianHoursFromPaidInvoices, normalizeId, roundHours } = require('../services/guardianHoursService');

  const guardianId = process.argv[2] || '696360fd5e85608fd2216371';

  // ── TEST 1: Admin guardian list (GET /users?role=guardian) ──
  console.log('=== TEST 1: Admin guardian list view ===');
  const hoursMap = await computeGuardianHoursFromPaidInvoices([guardianId]);
  const entry = hoursMap.get(guardianId);
  console.log('  guardianInfo.totalHours (computed):', entry?.totalHours ?? 'NOT COMPUTED');
  console.log('  Per-student hours:');
  if (entry?.studentHours) {
    entry.studentHours.forEach((h, sid) => console.log(`    ${sid}: ${h}h`));
  }
  console.log('  Admin would see:', entry?.totalHours ?? 0, 'hours\n');

  // ── TEST 2: Admin expand guardian → linked students (GET /users/:id/students) ──
  console.log('=== TEST 2: Admin expanded guardian students ===');
  const guardian = await User.findById(guardianId).select('guardianInfo').lean();
  const embedded = guardian?.guardianInfo?.students || [];
  const standalone = await Student.find({ guardian: guardianId }).lean();

  // Simulate the merge + applyComputedStudentHours
  const merged = [];
  const seenKeys = new Set();

  for (const es of embedded) {
    const key = String(es.standaloneStudentId || es._id);
    seenKeys.add(key);
    merged.push({
      ...es,
      guardianId,
      _source: 'embedded',
    });
  }
  for (const ss of standalone) {
    const key = String(ss._id);
    if (!seenKeys.has(key)) {
      merged.push({ ...ss, guardianId, _source: 'standalone' });
    }
  }

  // Apply computed hours (simulating applyComputedStudentHours)
  for (const student of merged) {
    const candidateIds = [
      student.standaloneStudentId,
      student.studentId,
      student._id,
    ].map(normalizeId).filter(Boolean);

    let hours = 0;
    if (entry) {
      for (const c of candidateIds) {
        if (entry.studentHours.has(c)) {
          hours = entry.studentHours.get(c);
          break;
        }
      }
    }

    console.log(`  Student: ${student.firstName} ${student.lastName}`);
    console.log(`    _id: ${student._id}`);
    console.log(`    standaloneStudentId: ${student.standaloneStudentId || 'N/A'}`);
    console.log(`    hoursRemaining (computed): ${roundHours(hours)}`);
    console.log(`    isActive: ${student.isActive}`);
    console.log(`    matched via: ${candidateIds.find(c => entry?.studentHours?.has(c)) || 'NONE'}`);
  }

  // ── TEST 3: Admin student search (GET /api/students) ──
  console.log('\n=== TEST 3: Admin student search ===');
  const searchResults = await Student.find({
    $or: [
      { firstName: { $regex: 'yeota', $options: 'i' } },
      { lastName: { $regex: 'yeota', $options: 'i' } },
    ]
  }).populate('guardian', 'firstName lastName').lean();
  console.log(`  Search "yeota" returns ${searchResults.length} result(s):`);
  for (const s of searchResults) {
    console.log(`    ${s.firstName} ${s.lastName} | guardian=${s.guardian?.firstName} ${s.guardian?.lastName} | hoursRemaining=${s.hoursRemaining} | isActive=${s.isActive}`);
  }

  // Also search "imam" 
  const searchResults2 = await Student.find({
    $or: [
      { firstName: { $regex: 'imam', $options: 'i' } },
      { lastName: { $regex: 'imam', $options: 'i' } },
    ]
  }).lean();
  console.log(`  Search "imam" returns ${searchResults2.length} result(s):`);
  for (const s of searchResults2) {
    console.log(`    ${s.firstName} ${s.lastName} | hoursRemaining=${s.hoursRemaining}`);
  }

  // ── TEST 4: All students endpoint (GET /users/admin/all-students) ──
  console.log('\n=== TEST 4: Check all-students endpoint data ===');
  const allStandalones = await Student.find({ guardian: guardianId }).select('firstName lastName hoursRemaining isActive guardian').lean();
  console.log(`  Standalone students for guardian: ${allStandalones.length}`);
  for (const s of allStandalones) {
    console.log(`    ${s.firstName} ${s.lastName} | _id=${s._id} | hoursRemaining=${s.hoursRemaining} | isActive=${s.isActive} | guardian=${s.guardian}`);
  }

  await mongoose.disconnect();
})();
