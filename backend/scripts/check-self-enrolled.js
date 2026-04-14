#!/usr/bin/env node
const mongoose = require('mongoose');
require('../models/User');
require('../models/Student');
const User = mongoose.model('User');
const Student = mongoose.model('Student');

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://mongo:27017/waraqa');

  // Find all self-enrolled guardians (embedded)
  const guardians = await User.find({
    role: 'guardian',
    'guardianInfo.students.selfGuardian': true
  }).select('firstName lastName guardianInfo.students').lean();

  console.log('Guardians with self-enrolled students:', guardians.length);
  for (const g of guardians) {
    const selfStudents = (g.guardianInfo?.students || []).filter(s => s.selfGuardian);
    for (const s of selfStudents) {
      console.log(JSON.stringify({
        guardianId: g._id,
        guardianName: `${g.firstName} ${g.lastName}`,
        embeddedStudentId: s._id,
        studentName: `${s.firstName} ${s.lastName}`,
        standaloneId: s.standaloneStudentId || null
      }));
    }
  }

  // Check standalone self-enrolled
  const standalones = await Student.find({ selfGuardian: true }).lean();
  console.log('\nStandalone self-enrolled:', standalones.length);
  for (const s of standalones) {
    console.log(JSON.stringify({
      standaloneId: s._id,
      guardian: s.guardian,
      name: `${s.firstName} ${s.lastName}`,
      selfGuardian: s.selfGuardian
    }));
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
