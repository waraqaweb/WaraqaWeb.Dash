require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');
  const gs = await User.find({ role: 'guardian' }).select('guardianInfo.students').lean();
  var total = 0;
  gs.forEach(function(g) {
    total += (g.guardianInfo && g.guardianInfo.students ? g.guardianInfo.students.length : 0);
  });
  console.log('total embedded students:', total);
  var sc = await Student.countDocuments();
  console.log('standalone students:', sc);
  console.log('deduped estimate:', Math.max(total, sc));
  process.exit(0);
}
main().catch(function(e) { console.error(e); process.exit(1); });
