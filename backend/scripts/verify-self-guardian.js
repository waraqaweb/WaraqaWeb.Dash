require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');
  
  // Check Yeota specifically
  var gId = '696360fd5e85608fd2216371';
  var g = await User.findById(gId).select('firstName lastName guardianInfo.students').lean();
  if (!g) { console.log('Gender not found'); process.exit(1); }
  console.log('Guardian:', g.firstName, g.lastName);
  var students = g.guardianInfo && g.guardianInfo.students ? g.guardianInfo.students : [];
  students.forEach(function(s) {
    console.log('  Student:', s.firstName, s.lastName, '| selfGuardian:', s.selfGuardian, '| typeof:', typeof s.selfGuardian);
  });

  // Check standalone
  var sId = '6963610d5e85608fd2216951';
  var standalone = await Student.findById(sId).select('firstName lastName selfGuardian').lean();
  console.log('Standalone:', standalone && standalone.firstName, standalone && standalone.lastName, '| selfGuardian:', standalone && standalone.selfGuardian);

  // Count all with selfGuardian true in embedded
  var allG = await User.find({ role: 'guardian', 'guardianInfo.students.selfGuardian': true }).select('_id').lean();
  console.log('Guardians with selfGuardian=true embedded students:', allG.length);

  // Count standalone with selfGuardian true
  var standaloneCount = await Student.countDocuments({ selfGuardian: true });
  console.log('Standalone with selfGuardian=true:', standaloneCount);

  process.exit(0);
}
main().catch(function(e) { console.error(e); process.exit(1); });
