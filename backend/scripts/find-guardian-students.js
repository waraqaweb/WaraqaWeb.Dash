#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');
const Class = require('../models/Class');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');

  const guardians = await User.find({ role: 'guardian' }).select('firstName lastName email guardianInfo.students').lean();
  console.log('Total guardians:', guardians.length);

  const selfAsStudent = [];
  for (const g of guardians) {
    const gName = ((g.firstName || '') + ' ' + (g.lastName || '')).trim().toLowerCase();
    const embedded = g.guardianInfo && g.guardianInfo.students ? g.guardianInfo.students : [];
    for (const s of embedded) {
      const sName = ((s.firstName || '') + ' ' + (s.lastName || '')).trim().toLowerCase();
      if (sName === gName || s.selfGuardian) {
        selfAsStudent.push({
          guardianId: String(g._id),
          guardianName: (g.firstName || '') + ' ' + (g.lastName || ''),
          embeddedStudentId: String(s._id),
          studentName: (s.firstName || '') + ' ' + (s.lastName || ''),
          selfGuardian: !!s.selfGuardian,
          standaloneId: s.standaloneStudentId ? String(s.standaloneStudentId) : null,
        });
      }
    }
  }

  console.log('Guardians who are also students:', selfAsStudent.length);
  for (const r of selfAsStudent) {
    console.log(JSON.stringify(r));
  }

  // Check classes where guardian name matches student name
  console.log('\n=== Classes where guardian IS the student ===');
  for (const g of guardians) {
    var gFirst = (g.firstName || '').trim();
    var gLast = (g.lastName || '').trim();
    if (!gFirst && !gLast) continue;

    var count = await Class.countDocuments({
      'student.guardianId': g._id,
      'student.studentName': gFirst + ' ' + gLast,
      deleted: { $ne: true }
    });
    if (count > 0) {
      var embedded = g.guardianInfo && g.guardianInfo.students ? g.guardianInfo.students : [];
      var gNameLower = (gFirst + ' ' + gLast).toLowerCase();
      var hasEmbedded = embedded.some(function(s) {
        return ((s.firstName || '') + ' ' + (s.lastName || '')).trim().toLowerCase() === gNameLower;
      });
      var standalone = await Student.findOne({ guardian: g._id, firstName: gFirst, lastName: gLast }).lean();

      console.log(JSON.stringify({
        guardianId: String(g._id),
        name: gFirst + ' ' + gLast,
        classesAsStudent: count,
        hasEmbeddedStudent: hasEmbedded,
        hasStandaloneStudent: !!standalone,
        standaloneId: standalone ? String(standalone._id) : null
      }));
    }
  }

  process.exit(0);
}
main().catch(function(e) { console.error(e); process.exit(1); });
