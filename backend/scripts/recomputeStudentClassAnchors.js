require('dotenv').config();

const mongoose = require('mongoose');
const Class = require('../models/Class');
const User = require('../models/User');
const {
  buildTimeAnchorForScheduledClass,
  resolveStudentTimezone,
  resolveTeacherTimezone,
  resolveAnchorTimezone,
} = require('../services/classTimezoneService');
const { DEFAULT_TIMEZONE } = require('../utils/timezoneUtils');

const parseArgs = (argv = []) => ({
  dryRun: argv.includes('--dry-run'),
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb';
  await mongoose.connect(mongoUri);

  const classes = await Class.find({
    anchoredTimezone: 'student',
    status: { $in: ['scheduled', 'in_progress'] },
    hidden: { $ne: true },
  })
    .select('teacher student scheduledDate timezone anchoredTimezone timeAnchor')
    .lean();

  const teacherCache = new Map();
  const guardianCache = new Map();
  let updated = 0;

  for (const classDoc of classes) {
    const teacherId = String(classDoc?.teacher || '');
    const guardianId = String(classDoc?.student?.guardianId || '');

    if (teacherId && !teacherCache.has(teacherId)) {
      teacherCache.set(teacherId, await User.findById(teacherId).select('timezone').lean());
    }
    if (guardianId && !guardianCache.has(guardianId)) {
      guardianCache.set(guardianId, await User.findById(guardianId).select('timezone guardianInfo.students').lean());
    }

    const teacherDoc = teacherCache.get(teacherId) || null;
    const guardianDoc = guardianCache.get(guardianId) || null;
    const studentTimezone = resolveStudentTimezone({
      guardianDoc,
      studentId: classDoc?.student?.studentId,
      fallbackTimezone: classDoc?.timeAnchor?.timezone || classDoc?.timezone || DEFAULT_TIMEZONE,
    });
    const teacherTimezone = resolveTeacherTimezone(teacherDoc, DEFAULT_TIMEZONE);
    const anchorTimezone = resolveAnchorTimezone({
      anchorMode: 'student',
      studentTimezone,
      teacherTimezone,
      fallbackTimezone: classDoc?.timezone || DEFAULT_TIMEZONE,
    });

    const nextTimeAnchor = buildTimeAnchorForScheduledClass({
      scheduledDate: classDoc?.scheduledDate,
      anchorMode: 'student',
      requestedTimezone: anchorTimezone,
      studentTimezone,
      teacherTimezone,
      fallbackTimezone: classDoc?.timezone || DEFAULT_TIMEZONE,
    });

    if (args.dryRun) {
      updated += 1;
      continue;
    }

    await Class.updateOne(
      { _id: classDoc._id },
      {
        $set: {
          timeAnchor: nextTimeAnchor,
        },
      }
    );
    updated += 1;
  }

  console.log('[recomputeStudentClassAnchors] done', {
    dryRun: args.dryRun,
    updated,
  });

  await mongoose.connection.close();
}

main().catch(async (error) => {
  console.error('[recomputeStudentClassAnchors] fatal', error);
  try {
    await mongoose.connection.close();
  } catch (closeErr) {
    console.error('[recomputeStudentClassAnchors] close error', closeErr);
  }
  process.exitCode = 1;
});