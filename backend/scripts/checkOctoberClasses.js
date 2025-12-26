const mongoose = require('mongoose');
require('dotenv').config();

const Class = require('../models/Class');
const User = require('../models/User');

async function checkOctoberClasses() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb');
    console.log('Connected to MongoDB');

    // Find all teachers
    const teachers = await User.find({ role: 'teacher', isActive: true });
    console.log(`\n✓ Found ${teachers.length} active teachers`);
    teachers.forEach(t => console.log(`  - ${t.firstName} ${t.lastName} (${t.email})`));

    // Find classes in October 2025
    const startDate = new Date('2025-10-01T00:00:00.000Z');
    const endDate = new Date('2025-10-31T23:59:59.999Z');

    const classes = await Class.find({
      scheduledDate: {
        $gte: startDate,
        $lte: endDate
      }
    }).populate('teacher', 'firstName lastName email')
      .populate('student', 'firstName lastName');

    console.log(`\n✓ Found ${classes.length} classes in October 2025`);
    
    if (classes.length > 0) {
      classes.forEach(c => {
        console.log(`  - ${c.scheduledDate.toISOString().split('T')[0]} | ${c.teacher?.firstName || 'Unknown'} ${c.teacher?.lastName || ''} | Student: ${c.student?.firstName || 'Unknown'} | Status: ${c.status} | Duration: ${c.duration}min`);
      });

      // Group by teacher
      const byTeacher = {};
      classes.forEach(c => {
        if (c.teacher) {
          const key = c.teacher._id.toString();
          if (!byTeacher[key]) {
            byTeacher[key] = {
              name: `${c.teacher.firstName} ${c.teacher.lastName}`,
              classes: [],
              totalMinutes: 0
            };
          }
          byTeacher[key].classes.push(c);
          if (c.status === 'completed') {
            byTeacher[key].totalMinutes += c.duration || 0;
          }
        }
      });

      console.log('\n✓ Hours by teacher:');
      Object.values(byTeacher).forEach(t => {
        const hours = (t.totalMinutes / 60).toFixed(2);
        console.log(`  - ${t.name}: ${t.classes.length} classes, ${hours} hours (completed)`);
      });
    } else {
      console.log('\n⚠ No classes found in October 2025');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkOctoberClasses();
