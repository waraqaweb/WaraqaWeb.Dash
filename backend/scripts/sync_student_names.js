const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');
const Class = require('../models/Class');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.replace(/^--/, '');
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = value;
      i += 1;
    }
  }
  return out;
};

async function run() {
  const args = parseArgs();
  const studentId = args.studentId || args.student || null;
  const guardianId = args.guardianId || args.guardian || null;

  if (!studentId && !guardianId) {
    console.error('Provide --studentId or --guardianId');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  if (studentId) {
    const student = await Student.findById(studentId).lean();
    if (!student) {
      console.error('Student not found');
      process.exit(1);
    }
    const name = `${student.firstName || ''} ${student.lastName || ''}`.trim();
    if (!name) {
      console.error('Student name is empty');
      process.exit(1);
    }
    const guardian = student.guardian;
    const result = await Class.updateMany(
      { 'student.studentId': student._id, ...(guardian ? { 'student.guardianId': guardian } : {}) },
      { $set: { 'student.studentName': name } }
    );
    console.log(`Updated ${result.modifiedCount || 0} class(es) for student ${student._id}`);
    await mongoose.connection.close();
    return;
  }

  if (guardianId) {
    const guardian = await User.findById(guardianId).lean();
    if (!guardian) {
      console.error('Guardian not found');
      process.exit(1);
    }
    const students = Array.isArray(guardian.guardianInfo?.students) ? guardian.guardianInfo.students : [];
    let updated = 0;
    for (const s of students) {
      const name = `${s.firstName || ''} ${s.lastName || ''}`.trim();
      if (!name) continue;
      const id = s.studentId || s._id || s.standaloneStudentId || s.studentInfo?.standaloneStudentId;
      if (!id) continue;
      const res = await Class.updateMany(
        { 'student.guardianId': guardian._id, 'student.studentId': id },
        { $set: { 'student.studentName': name } }
      );
      updated += res.modifiedCount || 0;
    }
    console.log(`Updated ${updated} class(es) for guardian ${guardian._id}`);
  }

  await mongoose.connection.close();
}

run().catch((err) => {
  console.error('Failed to sync student names:', err);
  process.exit(1);
});
