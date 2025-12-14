const Class = require('../models/Class');
const tzUtils = require('../utils/timezone');

/**
 * generateRecurringClasses
 * - Accepts a Mongoose doc or plain object pattern
 * - Generates class instances for the rolling window and returns saved instances
 */
async function generateRecurringClasses(recurringPattern, periodMonths = 2, perDayMapParam) {
  const generated = [];
  try {
    const pattern = recurringPattern.toObject ? recurringPattern.toObject() : recurringPattern;

    // compute generation window
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + (pattern.recurrence?.generationPeriodMonths || periodMonths));

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

          // build UTC date for this day at HH:mm in tz
          const instanceDate = tzUtils.buildUtcFromParts
            ? tzUtils.buildUtcFromParts({ year: current.getFullYear(), month: current.getMonth(), day: current.getDate(), hour: hours, minute: minutes }, tzForDay)
            : new Date(current.getFullYear(), current.getMonth(), current.getDate(), hours, minutes);

          const instanceDuration = typeof slot?.duration === 'number' ? slot.duration : pattern.duration;

          const inst = new Class({
            title: pattern.title,
            description: pattern.description,
            subject: pattern.subject,
            teacher: pattern.teacher,
            student: pattern.student,
            scheduledDate: instanceDate,
            duration: instanceDuration,
            timezone: pattern.timezone || 'UTC',
            isRecurring: false,
            parentRecurringClass: pattern._id,
            meetingLink: pattern.meetingLink || null,
            materials: pattern.materials || [],
            createdBy: pattern.createdBy || null,
            status: 'scheduled',
          });

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
    return generated;
  }
}

module.exports = { generateRecurringClasses };
