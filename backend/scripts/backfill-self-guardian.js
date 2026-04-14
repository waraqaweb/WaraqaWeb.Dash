#!/usr/bin/env node
// Backfill selfGuardian=true for all guardian-students where the student name matches the guardian name.
// This covers bulk-imported data where the flag wasn't set.
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');

  const guardians = await User.find({ role: 'guardian' }).select('firstName lastName guardianInfo').lean();
  console.log('Total guardians:', guardians.length);

  let fixedEmbedded = 0;
  let fixedStandalone = 0;
  let alreadyCorrect = 0;

  for (const g of guardians) {
    var gFirst = (g.firstName || '').trim();
    var gLast = (g.lastName || '').trim();
    if (!gFirst && !gLast) continue;
    var gNameLower = (gFirst + ' ' + gLast).toLowerCase();

    var embedded = g.guardianInfo && g.guardianInfo.students ? g.guardianInfo.students : [];
    for (var i = 0; i < embedded.length; i++) {
      var s = embedded[i];
      var sName = ((s.firstName || '') + ' ' + (s.lastName || '')).trim().toLowerCase();
      if (sName !== gNameLower) continue;

      if (s.selfGuardian) {
        alreadyCorrect++;
        continue;
      }

      // Fix embedded student
      var embeddedPath = 'guardianInfo.students.' + i + '.selfGuardian';
      var embeddedUpdate = {};
      embeddedUpdate['$set'] = {};
      embeddedUpdate['$set'][embeddedPath] = true;
      await User.updateOne({ _id: g._id }, embeddedUpdate);
      fixedEmbedded++;
      console.log('Fixed embedded:', gFirst, gLast, '| guardian:', String(g._id), '| student._id:', String(s._id));

      // Fix standalone if linked
      if (s.standaloneStudentId) {
        var result = await Student.updateOne(
          { _id: s.standaloneStudentId },
          { $set: { selfGuardian: true } }
        );
        if (result.modifiedCount > 0) {
          fixedStandalone++;
          console.log('  Fixed standalone:', String(s.standaloneStudentId));
        }
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log('Already correct:', alreadyCorrect);
  console.log('Fixed embedded:', fixedEmbedded);
  console.log('Fixed standalone:', fixedStandalone);

  process.exit(0);
}
main().catch(function(e) { console.error(e); process.exit(1); });
