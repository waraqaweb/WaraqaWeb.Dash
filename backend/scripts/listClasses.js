const mongoose = require('mongoose');
const Class = require('../models/Class');
const User = require('../models/User');

async function main() {
  try {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/online-class-manager';
    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    const filter = {};
    const [, , arg] = process.argv;
    if (arg) {
      if (arg.startsWith('id=')) {
        filter._id = new mongoose.Types.ObjectId(arg.slice(3));
      } else if (arg.startsWith('teacher=')) {
        filter.teacher = new mongoose.Types.ObjectId(arg.slice(8));
      }
    }

    const classes = await Class.find(filter).sort({ scheduledDate: 1 }).limit(50).lean();
    const teachers = await User.find({ _id: { $in: classes.map(c => c.teacher) } }).select('firstName lastName').lean();
    const teacherMap = new Map(teachers.map(t => [String(t._id), `${t.firstName || ''} ${t.lastName || ''}`.trim()]));

    for (const cls of classes) {
      console.log({
        id: cls._id,
        title: cls.title,
        teacher: teacherMap.get(String(cls.teacher)) || cls.teacher,
        subject: cls.subject,
        scheduledDate: cls.scheduledDate,
        hidden: cls.hidden,
        status: cls.status,
        isRecurring: cls.isRecurring,
        parentRecurringClass: cls.parentRecurringClass,
        recurrence: cls.recurrence,
        recurrenceDetails: cls.recurrenceDetails,
      });
    }
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
