/**
 * Check system data for testing
 */

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Class = require('../models/Class');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');

dayjs.extend(utc);

async function checkData() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB\n');

    // Check teachers
    console.log('👨‍🏫 Checking teachers...');
    const teachers = await User.find({ role: 'teacher' }).select('firstName lastName email teacherInfo.isActive');
    console.log(`Found ${teachers.length} teachers:`);
    teachers.slice(0, 5).forEach(t => {
      const isActive = t.teacherInfo?.isActive ? '✓' : '✗';
      console.log(`  ${isActive} ${t.firstName} ${t.lastName} (${t.email})`);
    });
    if (teachers.length > 5) console.log(`  ... and ${teachers.length - 5} more`);

    // Check classes in last 3 months
    console.log('\n📅 Checking recent classes...');
    const threeMonthsAgo = dayjs.utc().subtract(3, 'month').startOf('month').toDate();
    const now = new Date();

    const classes = await Class.find({
      startTime: { $gte: threeMonthsAgo, $lte: now }
    });

    console.log(`Found ${classes.length} classes in last 3 months`);

    // Group by status
    const byStatus = {};
    classes.forEach(c => {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    });

    console.log('Classes by status:');
    Object.entries(byStatus).forEach(([status, count]) => {
      console.log(`  - ${status}: ${count}`);
    });

    // Check attended/absent classes per month
    console.log('\n📊 Attended/Absent classes by month:');
    const attendedOrAbsent = classes.filter(c => c.status === 'attended' || c.status === 'absent');
    
    const byMonth = {};
    attendedOrAbsent.forEach(c => {
      const key = dayjs.utc(c.startTime).format('YYYY-MM');
      byMonth[key] = (byMonth[key] || 0) + 1;
    });

    Object.keys(byMonth).sort().forEach(month => {
      console.log(`  ${month}: ${byMonth[month]} classes`);
    });

    console.log('\n✨ Done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkData();
