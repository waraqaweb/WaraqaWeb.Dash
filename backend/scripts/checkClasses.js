require('dotenv').config();
const mongoose = require('mongoose');
const Class = require('../models/Class');

(async () => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
    await mongoose.connect(uri);
    const teacherId = process.argv[2] || '';
    if (!teacherId) {
      console.error('Usage: node scripts/checkClasses.js <teacherId>');
      process.exit(1);
    }

    const classes = await Class.find({ teacher: teacherId, status: { $ne: 'pattern' } })
      .sort({ scheduledDate: 1 })
      .limit(20)
      .lean();

    console.log('Classes count:', classes.length);
    console.log(classes.map(cls => ({
      id: cls._id,
      subject: cls.subject,
      scheduledDate: cls.scheduledDate,
      hidden: cls.hidden,
      status: cls.status,
      parentRecurringClass: cls.parentRecurringClass,
      timezone: cls.timezone,
      createdAt: cls.createdAt
    })));

    const patterns = await Class.find({ teacher: teacherId, status: 'pattern' }).lean();
    console.log('Patterns count:', patterns.length);
    console.log(patterns.map(p => ({
      id: p._id,
      subject: p.subject,
      daysOfWeek: p.recurrence?.daysOfWeek,
      duration: p.recurrence?.duration,
      generationPeriodMonths: p.recurrence?.generationPeriodMonths,
      recurrenceDetails: (p.recurrenceDetails || []).map(d => ({ dayOfWeek: d.dayOfWeek, time: d.time, duration: d.duration, timezone: d.timezone })),
      scheduledDate: p.scheduledDate,
      createdAt: p.createdAt
    })));
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.connection.close();
  }
})();
