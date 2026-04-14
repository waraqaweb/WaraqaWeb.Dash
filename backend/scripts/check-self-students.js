#!/usr/bin/env node
const mongoose = require('mongoose');
require('../models/User');
require('../models/Student');
require('../models/Class');
const User = mongoose.model('User');
const Student = mongoose.model('Student');
const Class = mongoose.model('Class');

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://mongo:27017/waraqa');

  // 1. Check Yeota guardian
  const gId = '696360fd5e85608fd2216371';
  const g = await User.findById(gId).select('firstName lastName role guardianInfo').lean();
  console.log('=== Guardian ===');
  console.log('Name:', g?.firstName, g?.lastName, '| Role:', g?.role);
  console.log('Embedded students:', (g?.guardianInfo?.students || []).length);
  for (const s of (g?.guardianInfo?.students || [])) {
    console.log('  -', s.firstName, s.lastName, '| selfGuardian:', !!s.selfGuardian, '| _id:', s._id, '| standaloneId:', s.standaloneStudentId || 'none');
  }

  // 2. Check standalone Student records for this guardian
  const standalones = await Student.find({ guardian: gId }).lean();
  console.log('\nStandalone students for guardian:', standalones.length);
  for (const s of standalones) {
    console.log('  -', s.firstName, s.lastName, '| selfGuardian:', !!s.selfGuardian, '| _id:', s._id);
  }

  // 3. Find classes where guardian IS the student 
  const classes = await Class.find({
    'student.guardianId': new mongoose.Types.ObjectId(gId),
    deleted: { $ne: true }
  }).select('student.studentName student.studentId student.guardianId status scheduledDate duration').lean();
  console.log('\nClasses for this guardian:', classes.length);

  // Group by studentName
  const byName = {};
  for (const c of classes) {
    const name = c.student?.studentName || 'unknown';
    if (!byName[name]) byName[name] = { count: 0, studentId: c.student?.studentId };
    byName[name].count++;
  }
  for (const [name, info] of Object.entries(byName)) {
    console.log('  -', name, '| classes:', info.count, '| studentId:', info.studentId);
  }

  // 4. Find ALL guardians who themselves are students (have classes with their own name)
  // Find guardians whose name matches a student name in their classes
  const allGuardians = await User.find({ role: 'guardian' }).select('firstName lastName guardianInfo.students').lean();
  console.log('\n=== Scanning all guardians for self-as-student ===');
  let selfStudentCount = 0;
  for (const guardian of allGuardians) {
    const gName = `${guardian.firstName || ''} ${guardian.lastName || ''}`.trim().toLowerCase();
    const embedded = guardian.guardianInfo?.students || [];
    const hasSelfEnrolled = embedded.some(s => s.selfGuardian);
    // Check if any embedded student has the same name as guardian
    const hasSameNameStudent = embedded.some(s => {
      const sName = `${s.firstName || ''} ${s.lastName || ''}`.trim().toLowerCase();
      return sName === gName;
    });
    if (hasSameNameStudent || hasSelfEnrolled) {
      selfStudentCount++;
      console.log('  Guardian:', gName, '| id:', guardian._id, '| selfGuardian flag:', hasSelfEnrolled, '| same-name student:', hasSameNameStudent);
    }
  }
  console.log('Total guardians who are also students:', selfStudentCount);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
