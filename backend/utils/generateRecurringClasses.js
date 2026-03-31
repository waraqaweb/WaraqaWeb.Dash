const Class = require('../models/Class');
const tzUtils = require('../utils/timezone');
const {
  buildTimeAnchorForScheduledClass,
  resolveStudentTimezone,
  resolveTeacherTimezone,
  resolveAnchorTimezone,
} = require('../services/classTimezoneService');
const systemVacationService = require('../services/systemVacationService');
const User = require('../models/User');

/**
 * generateRecurringClasses
 * - Accepts a Mongoose doc or plain object pattern
 * - Generates class instances for the rolling window and returns saved instances
 */
async function generateRecurringClasses(recurringPattern, periodMonths = 2, perDayMapParam, options = {}) {
  const generated = [];
  const { throwOnError = false } = options || {};
  try {
    const pattern = recurringPattern.toObject ? recurringPattern.toObject() : recurringPattern;
    let teacherDoc = null;
    let guardianDoc = null;
    if (pattern?.teacher) {
      teacherDoc = await User.findById(pattern.teacher).select('timezone').lean();
    }
    if (pattern?.student?.guardianId) {
      guardianDoc = await User.findById(pattern.student.guardianId).select('timezone guardianInfo.students').lean();
    }
    const studentTimezone = resolveStudentTimezone({
      guardianDoc,
      studentId: pattern?.student?.studentId,
      fallbackTimezone: pattern?.timeAnchor?.timezone || pattern?.timezone || 'UTC',
    });
    const teacherTimezone = resolveTeacherTimezone(teacherDoc, pattern?.timezone || 'UTC');
    const activeSystemVacation = await systemVacationService.getCurrentVacation();

    // compute generation window (rolling)
    // - start: now
    // - end: now + N months, but never beyond recurrence.endDate if provided
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + (pattern.recurrence?.generationPeriodMonths || periodMonths));
    if (pattern.recurrence?.endDate) {
      const seriesEnd = new Date(pattern.recurrence.endDate);
      if (!Number.isNaN(seriesEnd.getTime()) && seriesEnd < endDate) {
        endDate.setTime(seriesEnd.getTime());
      }
    }

    let perDayMap = perDayMapParam || new Map();
    if ((!perDayMap || perDayMap.size === 0) && Array.isArray(pattern.recurrenceDetails) && pattern.recurrenceDetails.length) {
      // build a simple map from recurrenceDetails
      for (const slot of pattern.recurrenceDetails) {
        const d = Number(slot.dayOfWeek);
        const [hh, mm] = (slot.time || '').split(':').map((s) => parseInt(s, 10));
        const entry = {
          hours: Number.isFinite(hh) ? hh : undefined,
          minutes: Number.isFinite(mm) ? mm : undefined,
          duration: typeof slot.duration === 'number' ? slot.duration : pattern.duration,
          timezone: slot.timezone || pattern.timezone || 'UTC',
        };
        const existing = perDayMap.get(d) || [];
        existing.push(entry);
        perDayMap.set(d, existing);
      }
    }

    if ((!perDayMap || perDayMap.size === 0) && pattern.scheduledDate) {
      const scheduled = new Date(pattern.scheduledDate);
      if (!Number.isNaN(scheduled.getTime())) {
        const fallbackDay = scheduled.getDay();
        const fallbackSlot = {
          hours: scheduled.getHours(),
          minutes: scheduled.getMinutes(),
          duration: pattern.duration,
          timezone: pattern.timezone || 'UTC',
        };
        perDayMap = new Map([[fallbackDay, [fallbackSlot]]]);
      }
    }

    // iterate day-by-day
    let current = new Date(startDate);
    while (current <= endDate) {
      const dow = current.getDay(); // 0-6
      let activeDays = Array.isArray(pattern.recurrence?.daysOfWeek) && pattern.recurrence.daysOfWeek.length > 0
        ? pattern.recurrence.daysOfWeek
        : Array.from(perDayMap.keys());
      if ((!activeDays || activeDays.length === 0) && pattern.scheduledDate) {
        const scheduled = new Date(pattern.scheduledDate);
        if (!Number.isNaN(scheduled.getTime())) {
          activeDays = [scheduled.getDay()];
        }
      }

      if (activeDays.includes(dow)) {
        const slotsFromMap = perDayMap.get(dow);
        const slotsForDay = Array.isArray(slotsFromMap) && slotsFromMap.length > 0
          ? slotsFromMap
          : [{
              hours: new Date(pattern.scheduledDate).getHours(),
              minutes: new Date(pattern.scheduledDate).getMinutes(),
              duration: pattern.duration,
              timezone: pattern.timezone || 'UTC',
            }];

        for (const slot of slotsForDay) {
          const tzForDay = slot?.timezone || pattern.timezone || 'UTC';

          const hours = typeof slot?.hours === 'number' ? slot.hours : new Date(pattern.scheduledDate).getHours();
          const minutes = typeof slot?.minutes === 'number' ? slot.minutes : new Date(pattern.scheduledDate).getMinutes();

          const anchorLocalTime = slot?.raw?.anchorLocalTime;
          const anchorDayOffset = Number(slot?.raw?.anchorDayOffset);
          const anchorTimezone = slot?.raw?.anchorTimezone || resolveAnchorTimezone({
            anchorMode: pattern.anchoredTimezone || 'student',
            studentTimezone,
            teacherTimezone,
            fallbackTimezone: tzForDay || pattern.timezone || 'UTC',
          });

          // build UTC date for this day at HH:mm in tz
          let instanceDate;
          if ((pattern.anchoredTimezone === 'student' || pattern.anchoredTimezone === 'teacher') && typeof anchorLocalTime === 'string' && Number.isFinite(anchorDayOffset)) {
            const [anchorHour, anchorMinute] = anchorLocalTime.split(':').map((value) => Number.parseInt(value, 10));
            const displayDate = new Date(current.getFullYear(), current.getMonth(), current.getDate());
            const anchorDate = new Date(displayDate.getFullYear(), displayDate.getMonth(), displayDate.getDate() + anchorDayOffset);
            instanceDate = tzUtils.buildUtcFromParts
              ? tzUtils.buildUtcFromParts({
                year: anchorDate.getFullYear(),
                month: anchorDate.getMonth(),
                day: anchorDate.getDate(),
                hour: anchorHour,
                minute: anchorMinute,
              }, anchorTimezone)
              : new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate(), anchorHour, anchorMinute);
          } else {
            instanceDate = tzUtils.buildUtcFromParts
              ? tzUtils.buildUtcFromParts({ year: current.getFullYear(), month: current.getMonth(), day: current.getDate(), hour: hours, minute: minutes }, tzForDay)
              : new Date(current.getFullYear(), current.getMonth(), current.getDate(), hours, minutes);
          }

          const instanceDuration = typeof slot?.duration === 'number' ? slot.duration : pattern.duration;

          const inst = new Class({
            title: pattern.title,
            description: pattern.description,
            subject: pattern.subject,
            teacher: pattern.teacher,
            student: pattern.student,
            scheduledDate: instanceDate,
            duration: instanceDuration,
            timezone: tzForDay,
            anchoredTimezone: pattern.anchoredTimezone || 'student',
            timeAnchor: buildTimeAnchorForScheduledClass({
              scheduledDate: instanceDate,
              anchorMode: pattern.anchoredTimezone || 'student',
              requestedTimezone: resolveAnchorTimezone({
                anchorMode: pattern.anchoredTimezone || 'student',
                studentTimezone,
                teacherTimezone,
                fallbackTimezone: tzForDay || pattern.timezone || 'UTC',
              }),
              studentTimezone,
              teacherTimezone,
              fallbackTimezone: tzForDay || pattern.timezone || 'UTC',
            }),
            isRecurring: false,
            parentRecurringClass: pattern._id,
            meetingLink: pattern.meetingLink || null,
            materials: pattern.materials || [],
            createdBy: pattern.createdBy || null,
            status: 'scheduled',
          });

          if (
            activeSystemVacation?.startDate &&
            activeSystemVacation?.endDate &&
            instanceDate >= activeSystemVacation.startDate &&
            instanceDate <= activeSystemVacation.endDate
          ) {
            systemVacationService.applyVacationHoldToClassDoc(inst, activeSystemVacation, pattern.createdBy || null);
          }

          // Avoid duplicates when the rolling generation job runs repeatedly.
          // Use a 90-minute tolerance window to catch DST-shifted instances
          // (same local time can map to different UTC after a DST change).
          const DST_TOLERANCE_MS = 90 * 60 * 1000;
          const alreadyExists = await Class.exists({
            parentRecurringClass: recurringPattern._id,
            scheduledDate: {
              $gte: new Date(instanceDate.getTime() - DST_TOLERANCE_MS),
              $lte: new Date(instanceDate.getTime() + DST_TOLERANCE_MS),
            },
            duration: instanceDuration,
            status: { $nin: ['pattern', 'cancelled', 'cancelled_by_admin', 'cancelled_by_teacher', 'cancelled_by_student', 'cancelled_by_guardian'] },
          });
          if (alreadyExists) continue;

          await inst.save();
          generated.push(inst);
        }
      }
      current.setDate(current.getDate() + 1);
    }

    // update pattern.lastGenerated if it's a real doc
    try {
      if (recurringPattern._id) {
        await Class.findByIdAndUpdate(recurringPattern._id, { 'recurrence.lastGenerated': new Date() });
      }
    } catch (e) {
      console.warn('Failed to update lastGenerated:', e.message);
    }

    return generated;
  } catch (err) {
    console.error('generateRecurringClasses error:', err);
    if (throwOnError) {
      throw err;
    }
    return generated;
  }
}

module.exports = { generateRecurringClasses };
