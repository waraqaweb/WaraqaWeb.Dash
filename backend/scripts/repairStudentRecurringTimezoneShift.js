require('dotenv').config();

const mongoose = require('mongoose');
const moment = require('moment-timezone');
const Class = require('../models/Class');
const User = require('../models/User');
const {
  buildRecurringSlotAnchor,
  buildTimeAnchorForScheduledClass,
  resolveStudentTimezone,
  resolveTeacherTimezone,
  resolveAnchorTimezone,
} = require('../services/classTimezoneService');
const { DEFAULT_TIMEZONE } = require('../utils/timezoneUtils');

const parseArgs = (argv = []) => ({
  dryRun: argv.includes('--dry-run'),
});

const computeExpectedUtcForSlot = ({ scheduledDate, slot, anchorTimezone }) => {
  const displayTimezone = slot?.timezone || DEFAULT_TIMEZONE;
  const anchorLocalTime = String(slot?.raw?.anchorLocalTime || '').trim();
  const anchorDayOffset = Number(slot?.raw?.anchorDayOffset);
  if (!scheduledDate || !anchorLocalTime || !Number.isFinite(anchorDayOffset)) return null;

  const displayMoment = moment.tz(scheduledDate, displayTimezone);
  if (!displayMoment.isValid()) return null;

  const [hour, minute] = anchorLocalTime.split(':').map((value) => Number.parseInt(value, 10));
  const anchorDate = displayMoment.clone().startOf('day').add(anchorDayOffset, 'days');

  return moment.tz({
    year: anchorDate.year(),
    month: anchorDate.month(),
    day: anchorDate.date(),
    hour,
    minute,
    second: 0,
    millisecond: 0,
  }, anchorTimezone).utc().toDate();
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb';
  await mongoose.connect(mongoUri);

  const now = new Date();
  const patterns = await Class.find({
    status: 'pattern',
    anchoredTimezone: 'student',
    hidden: { $ne: true },
  }).lean();

  let matchedPatterns = 0;
  let updatedPatterns = 0;
  let matchedClasses = 0;
  let updatedClasses = 0;

  for (const pattern of patterns) {
    const guardianDoc = pattern?.student?.guardianId
      ? await User.findById(pattern.student.guardianId).select('timezone guardianInfo.students').lean()
      : null;
    const teacherDoc = pattern?.teacher
      ? await User.findById(pattern.teacher).select('timezone').lean()
      : null;

    const studentTimezone = resolveStudentTimezone({
      guardianDoc,
      studentId: pattern?.student?.studentId,
      fallbackTimezone: pattern?.timeAnchor?.timezone || pattern?.timezone || DEFAULT_TIMEZONE,
    });
    const teacherTimezone = resolveTeacherTimezone(teacherDoc, DEFAULT_TIMEZONE);
    const anchorTimezone = resolveAnchorTimezone({
      anchorMode: 'student',
      studentTimezone,
      teacherTimezone,
      fallbackTimezone: pattern?.timezone || DEFAULT_TIMEZONE,
    });

    const nextDetails = Array.isArray(pattern.recurrenceDetails)
      ? pattern.recurrenceDetails.map((slot) => {
        const anchorMeta = buildRecurringSlotAnchor({
          slot,
          anchorMode: 'student',
          studentTimezone,
          teacherTimezone,
          fallbackTimezone: pattern?.timezone || DEFAULT_TIMEZONE,
          referenceDate: pattern?.scheduledDate || now,
        });
        return {
          ...slot,
          raw: {
            ...(slot?.raw || {}),
            ...(anchorMeta || {}),
          },
        };
      })
      : [];

    matchedPatterns += 1;
    if (!args.dryRun) {
      await Class.updateOne(
        { _id: pattern._id },
        {
          $set: {
            recurrenceDetails: nextDetails,
            timeAnchor: buildTimeAnchorForScheduledClass({
              scheduledDate: pattern.scheduledDate,
              anchorMode: 'student',
              requestedTimezone: anchorTimezone,
              studentTimezone,
              teacherTimezone,
              fallbackTimezone: pattern?.timezone || DEFAULT_TIMEZONE,
            }),
          },
        }
      );
      updatedPatterns += 1;
    }

    const futureClasses = await Class.find({
      parentRecurringClass: pattern._id,
      anchoredTimezone: 'student',
      status: { $in: ['scheduled', 'in_progress'] },
      scheduledDate: { $gte: now },
      hidden: { $ne: true },
    });

    for (const classDoc of futureClasses) {
      const slot = nextDetails.find((candidate) => {
        const displayMoment = moment.tz(classDoc.scheduledDate, candidate?.timezone || pattern?.timezone || DEFAULT_TIMEZONE);
        if (!displayMoment.isValid()) return false;
        return displayMoment.day() === Number(candidate?.dayOfWeek)
          && displayMoment.format('HH:mm') === String(candidate?.time || '');
      }) || nextDetails[0];

      if (!slot) continue;

      const expectedUtc = computeExpectedUtcForSlot({
        scheduledDate: classDoc.scheduledDate,
        slot,
        anchorTimezone,
      });
      if (!expectedUtc) continue;

      matchedClasses += 1;
      if (expectedUtc.getTime() === new Date(classDoc.scheduledDate).getTime()) continue;

      if (!args.dryRun) {
        classDoc.scheduledDate = expectedUtc;
        classDoc.timeAnchor = buildTimeAnchorForScheduledClass({
          scheduledDate: expectedUtc,
          anchorMode: 'student',
          requestedTimezone: anchorTimezone,
          studentTimezone,
          teacherTimezone,
          fallbackTimezone: classDoc?.timezone || pattern?.timezone || DEFAULT_TIMEZONE,
        });
        await classDoc.save();
        updatedClasses += 1;
      }
    }
  }

  console.log('[repairStudentRecurringTimezoneShift] done', {
    dryRun: args.dryRun,
    matchedPatterns,
    updatedPatterns: args.dryRun ? 0 : updatedPatterns,
    matchedClasses,
    updatedClasses: args.dryRun ? 0 : updatedClasses,
  });

  await mongoose.connection.close();
}

main().catch(async (error) => {
  console.error('[repairStudentRecurringTimezoneShift] fatal', error);
  try {
    await mongoose.connection.close();
  } catch (closeErr) {
    console.error('[repairStudentRecurringTimezoneShift] close error', closeErr);
  }
  process.exitCode = 1;
});