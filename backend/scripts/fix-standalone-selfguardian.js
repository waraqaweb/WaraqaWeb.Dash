require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');
  
  // Find all guardians with selfGuardian=true embedded students
  var guardians = await User.find({
    role: 'guardian',
    'guardianInfo.students.selfGuardian': true
  }).select('firstName lastName guardianInfo.students').lean();

  var fixed = 0;
  for (var gi = 0; gi < guardians.length; gi++) {
    var g = guardians[gi];
    var students = g.guardianInfo && g.guardianInfo.students ? g.guardianInfo.students : [];
    for (var si = 0; si < students.length; si++) {
      var s = students[si];
      if (!s.selfGuardian || !s.standaloneStudentId) continue;
      var standalone = await Student.findById(s.standaloneStudentId).select('selfGuardian').lean();
      if (standalone && !standalone.selfGuardian) {
        await Student.updateOne({ _id: s.standaloneStudentId }, { $set: { selfGuardian: true } });
        console.log('Fixed standalone:', String(s.standaloneStudentId), 'for guardian:', g.firstName, g.lastName);
        fixed++;
      }
    }
  }
  console.log('Fixed:', fixed, 'standalone records');
  
  // Verify final count
  var count = await Student.countDocuments({ selfGuardian: true });
  console.log('Total standalone selfGuardian=true:', count);
  
  process.exit(0);
}
main().catch(function(e) { console.error(e); process.exit(1); });
