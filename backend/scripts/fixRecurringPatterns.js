require('dotenv').config();
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const Class = require('../models/Class');

function normalizeTimeString(time) {
  if (typeof time !== 'string') return undefined;
  const match = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return undefined;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function buildPerDayMap(details, timezone, fallbackDate, duration) {
  const map = new Map();
  if (Array.isArray(details) && details.length) {
    details.forEach((slot) => {
      const day = Number(slot?.dayOfWeek);
      const normalizedTime = normalizeTimeString(slot?.time);
      if (!Number.isInteger(day) || day < 0 || day > 6 || !normalizedTime) return;
      const [hours, minutes] = normalizedTime.split(':').map((s) => Number(s));
      const entry = {
        hours,
        minutes,
        duration: Number.isFinite(Number(slot?.duration)) ? Number(slot.duration) : duration,
        timezone: slot?.timezone || timezone,
      };
      const existing = map.get(day) || [];
      existing.push(entry);
      map.set(day, existing);
    });
  }

  if (map.size === 0 && fallbackDate) {
    const zoned = moment.tz(fallbackDate, timezone);
    const fallbackDay = zoned.day();
    const hours = zoned.hour();
    const minutes = zoned.minute();
    map.set(fallbackDay, [{
      hours,
      minutes,
      duration,
      timezone,
    }]);
  }
  return map;
}

(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
  await mongoose.connect(uri);

  try {
    const patterns = await Class.find({ status: 'pattern' });
    console.log(`Found ${patterns.length} recurring patterns to inspect.`);
    for (const pattern of patterns) {
      const timezone = pattern.timezone || 'UTC';
      const patternDuration = Number(pattern.duration) || 60;
      let details = Array.isArray(pattern.recurrenceDetails) ? pattern.recurrenceDetails : [];
      let updated = false;

      if (!details.length) {
        const scheduled = moment(pattern.scheduledDate);
        const dayOfWeek = scheduled.tz(timezone).day();
        const timeString = scheduled.tz(timezone).format('HH:mm');
        details = [{
          dayOfWeek,
          time: timeString,
          duration: patternDuration,
          timezone,
        }];
        pattern.recurrenceDetails = details;
          pattern.markModified('recurrenceDetails');
        updated = true;
        console.log(`Pattern ${pattern._id}: populated recurrenceDetails fallback ${dayOfWeek} ${timeString}`);
      }

      const daysFromDetails = Array.from(new Set(details.map((slot) => Number(slot.dayOfWeek)).filter((d) => Number.isInteger(d)) ));
      if (!Array.isArray(pattern.recurrence?.daysOfWeek) || !pattern.recurrence.daysOfWeek.length) {
        pattern.recurrence = { ...(pattern.recurrence || {}), daysOfWeek: daysFromDetails };
          pattern.markModified('recurrence');
        updated = true;
      }
      if (!pattern.recurrence.duration) {
        pattern.recurrence.duration = details[0]?.duration || patternDuration;
          pattern.markModified('recurrence');
        updated = true;
      }
      if (!pattern.recurrence.generationPeriodMonths) {
        pattern.recurrence.generationPeriodMonths = 2;
          pattern.markModified('recurrence');
        updated = true;
      }
      if (updated) {
        pattern.recurrence.lastGenerated = new Date(0);
        await pattern.save();
      }

      const perDayMap = buildPerDayMap(pattern.recurrenceDetails, timezone, pattern.scheduledDate, pattern.duration);
      const activeDays = pattern.recurrence.daysOfWeek && pattern.recurrence.daysOfWeek.length
        ? pattern.recurrence.daysOfWeek
        : Array.from(perDayMap.keys());

      if (!activeDays.length) {
        console.warn(`Pattern ${pattern._id} has no active days even after fallback; skipping.`);
        continue;
      }

      const startDate = moment().startOf('day');
      const periodMonths = pattern.recurrence.generationPeriodMonths || 2;
      const endDate = startDate.clone().add(periodMonths, 'months');
      let generatedCount = 0;

      for (let dateCursor = startDate.clone(); dateCursor.isSameOrBefore(endDate, 'day'); dateCursor.add(1, 'day')) {
        const dow = dateCursor.day();
        if (!activeDays.includes(dow)) continue;
        const slotsForDay = perDayMap.get(dow) || [];
        for (const slot of slotsForDay) {
          const instanceMoment = moment.tz({
            year: dateCursor.year(),
            month: dateCursor.month(),
            day: dateCursor.date(),
            hour: slot.hours,
            minute: slot.minutes,
          }, slot.timezone || timezone).utc();
          const scheduledDate = instanceMoment.toDate();

          const exists = await Class.findOne({
            parentRecurringClass: pattern._id,
            scheduledDate,
          }).lean();
          if (exists) continue;

          const instance = new Class({
            title: pattern.title,
            description: pattern.description,
            subject: pattern.subject,
            teacher: pattern.teacher,
            student: pattern.student,
            scheduledDate,
            duration: slot.duration || pattern.duration,
            timezone: pattern.timezone,
            isRecurring: false,
            parentRecurringClass: pattern._id,
            meetingLink: pattern.meetingLink,
            materials: pattern.materials,
            createdBy: pattern.createdBy,
            status: 'scheduled',
          });
          await instance.save();
          generatedCount += 1;
        }
      }
      if (generatedCount) {
        console.log(`Pattern ${pattern._id}: generated ${generatedCount} classes.`);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
})();
