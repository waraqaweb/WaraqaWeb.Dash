/**
 * Availability Service - Helper functions for teacher availability validation
 * 
 * This service provides validation functions that can be used throughout
 * the application to check teacher availability before scheduling classes.
 */

const AvailabilitySlot = require('../models/AvailabilitySlot');
const UnavailablePeriod = require('../models/UnavailablePeriod');
const Class = require('../models/Class');
const User = require('../models/User');
const tzUtils = require('../utils/timezoneUtils');
const moment = require('moment-timezone');

const BUSY_CLASS_STATUSES = ['scheduled', 'in_progress'];

// Helper: convert HH:MM to minutes
function timeToMinutes(timeStr) {
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  return h * 60 + m;
}

function canFitInSlot(slotStart, slotEnd, requestedStart, requestedEnd) {
  const slotStartMin = timeToMinutes(slotStart);
  const slotEndMin = timeToMinutes(slotEnd);
  const reqStartMin = timeToMinutes(requestedStart);
  const reqEndMin = timeToMinutes(requestedEnd);
  return reqStartMin >= slotStartMin && reqEndMin <= slotEndMin;
}

async function getBusyIntervalsForWindow(teacherId, windowStartUtc, windowEndUtc) {
  if (!teacherId || !(windowStartUtc instanceof Date) || !(windowEndUtc instanceof Date)) {
    return [];
  }

  const [classConflicts, unavailableConflicts] = await Promise.all([
    Class.find({
      teacher: teacherId,
      status: { $in: BUSY_CLASS_STATUSES },
      scheduledDate: { $lt: windowEndUtc },
      $expr: {
        $gt: [
          { $add: ['$scheduledDate', { $multiply: ['$duration', 60000] }] },
          windowStartUtc
        ]
      }
    }).select('scheduledDate duration subject student.studentName'),
    UnavailablePeriod.find({
      teacherId,
      isActive: true,
      status: 'approved',
      startDateTime: { $lt: windowEndUtc },
      endDateTime: { $gt: windowStartUtc }
    }).select('startDateTime endDateTime reason description')
  ]);

  const intervals = [];

  for (const cls of classConflicts) {
    const classStart = cls.scheduledDate;
    const classEnd = new Date(classStart.getTime() + (cls.duration || 0) * 60000);
    const start = classStart > windowStartUtc ? classStart : windowStartUtc;
    const end = classEnd < windowEndUtc ? classEnd : windowEndUtc;
    if (end > start) {
      intervals.push({
        start,
        end,
        type: 'class',
        meta: {
          subject: cls.subject,
          studentName: cls.student?.studentName || null
        }
      });
    }
  }

  for (const period of unavailableConflicts) {
    const start = period.startDateTime > windowStartUtc ? period.startDateTime : windowStartUtc;
    const end = period.endDateTime < windowEndUtc ? period.endDateTime : windowEndUtc;
    if (end > start) {
      intervals.push({
        start,
        end,
        type: 'unavailable',
        meta: {
          reason: period.reason,
          description: period.description || null
        }
      });
    }
  }

  if (intervals.length === 0) {
    return [];
  }

  intervals.sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const current = intervals[i];
    const last = merged[merged.length - 1];

    if (current.start.getTime() <= last.end.getTime()) {
      if (current.end.getTime() > last.end.getTime()) {
        last.end = current.end;
      }
      if (last.meta && current.meta) {
        last.meta = Array.isArray(last.meta) ? last.meta : [last.meta];
        last.meta.push(current.meta);
      }
    } else {
      merged.push(current);
    }
  }

  return merged;
}

async function sliceAvailabilityByConflicts(teacherId, windowStartUtc, windowEndUtc) {
  if (!teacherId || !(windowStartUtc instanceof Date) || !(windowEndUtc instanceof Date)) {
    return [];
  }

  if (windowEndUtc.getTime() <= windowStartUtc.getTime()) {
    return [];
  }

  const busyIntervals = await getBusyIntervalsForWindow(teacherId, windowStartUtc, windowEndUtc);
  if (!busyIntervals.length) {
    return [{ start: windowStartUtc, end: windowEndUtc }];
  }

  const available = [];
  let cursor = windowStartUtc;

  for (const interval of busyIntervals) {
    if (interval.start.getTime() > cursor.getTime()) {
      const freeEnd = interval.start.getTime() < windowEndUtc.getTime() ? interval.start : windowEndUtc;
      if (freeEnd.getTime() > cursor.getTime()) {
        available.push({ start: cursor, end: freeEnd });
      }
    }

    if (interval.end.getTime() > cursor.getTime()) {
      cursor = interval.end.getTime() < windowEndUtc.getTime() ? interval.end : windowEndUtc;
    }

    if (cursor.getTime() >= windowEndUtc.getTime()) {
      break;
    }
  }

  if (cursor.getTime() < windowEndUtc.getTime()) {
    available.push({ start: cursor, end: windowEndUtc });
  }

  return available.filter(segment => segment.end.getTime() > segment.start.getTime());
}

function formatDurationLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return '';
  }
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const parts = [];
  if (hrs > 0) parts.push(`${hrs}h`);
  if (mins > 0) parts.push(`${mins}m`);
  return parts.join(' ');
}

/**
 * Check if a teacher is available for a specific time slot
 * @param {string} teacherId - Teacher's ID
 * @param {Date} startDateTime - Class start time in UTC
 * @param {Date} endDateTime - Class end time in UTC
 * @param {string} excludeClassId - Optional class ID to exclude from conflict check
 * @returns {Object} Validation result with availability status and details
 */
async function validateTeacherAvailability(teacherId, startDateTime, endDateTime, excludeClassId = null) {
  try {
    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'teacher') {
      return {
        isAvailable: false,
        reason: 'Teacher not found',
        conflictType: 'invalid_teacher'
      };
    }

    // If teacher hasn't set up custom availability and it's not required, allow booking
    let availabilityStatus = teacher.teacherInfo?.availabilityStatus || 'default_24_7';
    if (availabilityStatus !== 'default_24_7') {
      const activeSlotCount = await AvailabilitySlot.countDocuments({
        teacherId,
        isActive: true,
        $or: [
          { effectiveTo: null },
          { effectiveTo: { $gte: new Date() } }
        ]
      });
      if (activeSlotCount === 0) {
        availabilityStatus = 'default_24_7';
        await User.findByIdAndUpdate(teacherId, {
          'teacherInfo.availabilityStatus': 'default_24_7'
        });
      }
    }
    if (availabilityStatus === 'default_24_7') {
      // Still check for unavailable periods and existing classes
      return await checkUnavailabilityAndConflicts(teacherId, startDateTime, endDateTime, excludeClassId);
    }

    // NOTE: Availability slots are stored as dayOfWeek + HH:MM strings.
    // In practice, the UI provides these in the teacher/slot timezone (not UTC).
    // So we must evaluate the requested UTC time window in the slot timezone.
    const teacherTimezone = teacher?.timezone || 'UTC';
    const slots = await AvailabilitySlot.findActiveByTeacher(teacherId);

    const fitsAnySlot = slots.some((slot) => {
      const slotTimezone = slot?.timezone || teacherTimezone;

      const startLocal = moment(startDateTime).tz(slotTimezone);
      const endLocal = moment(endDateTime).tz(slotTimezone);

      // If the class crosses midnight in slot timezone, we currently treat it as not-fitting.
      // (The availability model is day-based and does not support cross-day windows.)
      if (startLocal.format('YYYY-MM-DD') !== endLocal.format('YYYY-MM-DD')) {
        return false;
      }

      const dayOfWeekLocal = startLocal.day();
      if (Number(slot.dayOfWeek) !== Number(dayOfWeekLocal)) {
        return false;
      }

      const startTimeLocal = startLocal.format('HH:mm');
      const endTimeLocal = endLocal.format('HH:mm');

      return canFitInSlot(slot.startTime, slot.endTime, startTimeLocal, endTimeLocal);
    });

    if (!fitsAnySlot) {
      return {
        isAvailable: false,
        reason: 'Teacher not available during this time',
        conflictType: 'no_availability',
        suggestedAction: 'Please choose a time when the teacher is available'
      };
    }

    // Check for unavailable periods and existing class conflicts
    return await checkUnavailabilityAndConflicts(teacherId, startDateTime, endDateTime, excludeClassId);

  } catch (error) {
    console.error('Error validating teacher availability:', error);
    return {
      isAvailable: false,
      reason: 'Error checking availability',
      conflictType: 'system_error',
      error: error.message
    };
  }
}

/**
 * Check for unavailable periods and existing class conflicts
 * @param {string} teacherId - Teacher's ID
 * @param {Date} startDateTime - Class start time
 * @param {Date} endDateTime - Class end time
 * @param {string} excludeClassId - Optional class ID to exclude
 * @returns {Object} Validation result
 */
async function checkUnavailabilityAndConflicts(teacherId, startDateTime, endDateTime, excludeClassId = null) {
  // Check for unavailable periods
  const unavailableConflict = await UnavailablePeriod.hasConflictForTeacher(
    teacherId,
    startDateTime,
    endDateTime
  );

  if (unavailableConflict) {
    return {
      isAvailable: false,
      reason: `Teacher marked unavailable: ${unavailableConflict.reason}`,
      conflictType: 'unavailable_period',
      conflictDetails: {
        reason: unavailableConflict.reason,
        startDateTime: unavailableConflict.startDateTime,
        endDateTime: unavailableConflict.endDateTime,
        description: unavailableConflict.description
      }
    };
  }

  // Check for existing class conflicts
  const classConflictQuery = {
    teacher: teacherId,
    status: { $in: ['scheduled', 'in_progress'] },
    $or: [
      // Class starts before requested time and ends after start
      {
        scheduledDate: { $lte: startDateTime },
        $expr: {
          $gte: [
            { $add: ['$scheduledDate', { $multiply: ['$duration', 60000] }] },
            startDateTime
          ]
        }
      },
      // Class starts within requested time period
      {
        scheduledDate: { $gte: startDateTime, $lt: endDateTime }
      }
    ]
  };

  if (excludeClassId) {
    classConflictQuery._id = { $ne: excludeClassId };
  }

  const classConflicts = await Class.findOne(classConflictQuery)
    .populate('student.guardianId', 'firstName lastName');

  if (classConflicts) {
    const conflictEndTime = new Date(classConflicts.scheduledDate.getTime() + classConflicts.duration * 60000);
    return {
      isAvailable: false,
      reason: `Teacher has existing class with ${classConflicts.student.studentName} from ${classConflicts.scheduledDate.toLocaleTimeString()} to ${conflictEndTime.toLocaleTimeString()}`,
      conflictType: 'existing_class',
      conflictDetails: {
        classId: classConflicts._id,
        studentName: classConflicts.student.studentName,
        startTime: classConflicts.scheduledDate,
        endTime: conflictEndTime,
        subject: classConflicts.subject
      }
    };
  }

  return {
    isAvailable: true,
    reason: 'Teacher is available'
  };
}

/**
 * Get alternative available time slots for a teacher
 * @param {string} teacherId - Teacher's ID
 * @param {number} duration - Required duration in minutes
 * @param {Array} preferredDays - Array of preferred day numbers (0-6)
 * @param {number} lookAheadDays - How many days to look ahead for alternatives
 * @returns {Array} Array of alternative time slots
 */
async function getAlternativeTimeSlots(teacherId, duration, preferredDays = [], lookAheadDays = 14) {
  try {
    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'teacher') {
      return [];
    }

    // If teacher uses default 24/7 availability, generate some common time slots
    const availabilityStatus = teacher.teacherInfo?.availabilityStatus || 'default_24_7';
    if (availabilityStatus === 'default_24_7') {
      return generateDefaultAlternatives(teacherId, duration, preferredDays, lookAheadDays);
    }

    // Get teacher's availability slots
    const availabilitySlots = await AvailabilitySlot.findActiveByTeacher(teacherId);
    const alternatives = [];

    const now = new Date();
    for (let i = 0; i < lookAheadDays; i++) {
      const checkDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const dayOfWeek = checkDate.getUTCDay();

      // Skip if not in preferred days and preferred days are specified
      if (preferredDays.length > 0 && !preferredDays.includes(dayOfWeek)) {
        continue;
      }

      // Find slots for this day
      const daySlots = availabilitySlots.filter(slot => slot.dayOfWeek === dayOfWeek);

      for (const slot of daySlots) {
        // Generate potential start times within this slot
        const slotDuration = slot.durationMinutes;
        if (slotDuration >= duration) {
          const [startHour, startMin] = slot.startTime.split(':').map(Number);
          const [endHour, endMin] = slot.endTime.split(':').map(Number);

          // Try different start times within the slot
          for (let hour = startHour; hour <= endHour; hour++) {
            for (let minute = 0; minute < 60; minute += 30) { // 30-minute intervals
              if (hour === endHour && minute >= endMin) break;

              const proposedStart = new Date(checkDate);
              proposedStart.setUTCHours(hour, minute, 0, 0);
              const proposedEnd = new Date(proposedStart.getTime() + duration * 60000);

              // Check if this fits within the slot
              const proposedEndTime = `${String(proposedEnd.getUTCHours()).padStart(2, '0')}:${String(proposedEnd.getUTCMinutes()).padStart(2, '0')}`;
              if (proposedEndTime <= slot.endTime) {
                // Validate this time slot
                const validation = await validateTeacherAvailability(teacherId, proposedStart, proposedEnd);
                if (validation.isAvailable) {
                  alternatives.push({
                    startDateTime: proposedStart,
                    endDateTime: proposedEnd,
                    dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
                    timeDisplay: `${proposedStart.toLocaleTimeString()} - ${proposedEnd.toLocaleTimeString()}`,
                    timezone: slot.timezone
                  });
                }
              }
            }
          }
        }
      }
    }

    return alternatives.slice(0, 10); // Return top 10 alternatives

  } catch (error) {
    console.error('Error getting alternative time slots:', error);
    return [];
  }
}

/**
 * Generate default alternatives for teachers with 24/7 availability
 */
async function generateDefaultAlternatives(teacherId, duration, preferredDays, lookAheadDays) {
  const alternatives = [];
  const commonHours = [9, 10, 11, 14, 15, 16, 17, 19, 20]; // Common teaching hours

  const now = new Date();
  for (let i = 0; i < lookAheadDays; i++) {
    const checkDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const dayOfWeek = checkDate.getUTCDay();

    if (preferredDays.length > 0 && !preferredDays.includes(dayOfWeek)) {
      continue;
    }

    for (const hour of commonHours) {
      const proposedStart = new Date(checkDate);
      proposedStart.setUTCHours(hour, 0, 0, 0);
      const proposedEnd = new Date(proposedStart.getTime() + duration * 60000);

      const validation = await checkUnavailabilityAndConflicts(teacherId, proposedStart, proposedEnd);
      if (validation.isAvailable) {
        alternatives.push({
          startDateTime: proposedStart,
          endDateTime: proposedEnd,
          dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
          timeDisplay: `${proposedStart.toLocaleTimeString()} - ${proposedEnd.toLocaleTimeString()}`,
          timezone: 'UTC'
        });
      }

      if (alternatives.length >= 10) break;
    }
    if (alternatives.length >= 10) break;
  }

  return alternatives;
}

/**
 * Check if teacher meets minimum availability requirements
 * @param {string} teacherId - Teacher's ID
 * @returns {Object} Compliance status and details
 */
async function checkAvailabilityCompliance(teacherId) {
  try {
    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'teacher') {
      return { isCompliant: false, reason: 'Teacher not found' };
    }

    const config = teacher.teacherInfo?.availabilityConfig;
    if (!config?.isAvailabilityRequired) {
      return { isCompliant: true, reason: 'No availability requirements set' };
    }

    const availabilityStatus = teacher.teacherInfo?.availabilityStatus || 'default_24_7';
    if (availabilityStatus === 'default_24_7') {
      return {
        isCompliant: true,
        reason: 'Teacher is using default 24/7 availability',
        mode: 'default_24_7'
      };
    }

    const slots = await AvailabilitySlot.findActiveByTeacher(teacherId);

    // Group slots by day and calculate total hours per day
    const hoursByDay = {};
    slots.forEach(slot => {
      if (!hoursByDay[slot.dayOfWeek]) {
        hoursByDay[slot.dayOfWeek] = 0;
      }
      hoursByDay[slot.dayOfWeek] += slot.durationMinutes / 60;
    });

    // Check minimum days requirement
    const daysWithMinHours = Object.entries(hoursByDay)
      .filter(([day, hours]) => hours >= config.minHoursPerDay)
      .length;

    const isCompliant = daysWithMinHours >= config.minDaysPerWeek;

    return {
      isCompliant,
      currentDays: daysWithMinHours,
      requiredDays: config.minDaysPerWeek,
      currentHoursPerDay: hoursByDay,
      requiredHoursPerDay: config.minHoursPerDay,
      details: isCompliant 
        ? 'Teacher meets all availability requirements'
        : `Teacher needs ${config.minDaysPerWeek - daysWithMinHours} more days with ${config.minHoursPerDay} hours each`
    };

  } catch (error) {
    console.error('Error checking availability compliance:', error);
    return { isCompliant: false, reason: 'Error checking compliance', error: error.message };
  }
}

/**
 * Search teachers (reusable) and build a timezone-converted share message
 * @param {Object} searchPayload - { studentAvailability, additionalCriteria, flexibility }
 * @param {string} targetTimezone - IANA timezone to convert times into for the message
 * @returns {Object} { results, message }
 */
async function searchTeachersForSharing(searchPayload, targetTimezone = tzUtils.DEFAULT_TIMEZONE) {
  try {
    // Reuse the same logic as the route-based search but keep it service-level
    const { studentAvailability, additionalCriteria = {}, flexibility = {}, teacherId = null } = searchPayload;
    const { preferredDays = [], timeSlots = [], duration = 60 } = studentAvailability || {};

    const results = {
      exactMatches: [],
      flexibleMatches: [],
      stats: {
        totalTeachers: 0,
        exactMatches: 0,
        flexibleMatches: 0,
        excluded: 0
      }
    };

  const teacherQuery = { role: 'teacher', isActive: true };
  if (teacherId) teacherQuery._id = teacherId;
  const teachers = await User.find(teacherQuery).populate('teacherInfo');
    results.stats.totalTeachers = teachers.length;

    for (const teacher of teachers) {
      let teacherScore = 0;
      let availableSlots = [];
      let isExactMatch = false;
      // Build a map of day -> time slots to check. timeSlots entries may include optional dayOfWeek
      // If no timeSlots provided for a day (or no timeSlots at all), we'll treat that day as "show all times"
      const dayToSlots = {}; // dayNum -> array of {startTime,endTime}

      // initialize with preferredDays (if empty -> all days)
      const daysToConsider = (preferredDays && preferredDays.length > 0) ? preferredDays : [0,1,2,3,4,5,6];
      for (const d of daysToConsider) dayToSlots[d] = [];

      if (timeSlots && timeSlots.length > 0) {
        for (const ts of timeSlots) {
          if (typeof ts.dayOfWeek === 'number') {
            if (!dayToSlots[ts.dayOfWeek]) dayToSlots[ts.dayOfWeek] = [];
            dayToSlots[ts.dayOfWeek].push({ startTime: ts.startTime, endTime: ts.endTime });
          } else {
            // apply to all preferred days
            for (const d of daysToConsider) {
              dayToSlots[d].push({ startTime: ts.startTime, endTime: ts.endTime });
            }
          }
        }
      }

      // For each day, if dayToSlots[day] is empty -> treat as 'show all times' for that day
      for (const dayNum of Object.keys(dayToSlots).map(Number)) {
        const slotsForDay = dayToSlots[dayNum];

        // Fetch teacher's availability slots for this day
        const teacherSlots = await AvailabilitySlot.find({ teacherId: teacher._id, dayOfWeek: dayNum, isActive: true });

        if (slotsForDay.length === 0) {
          const now = new Date();
          const daysAhead = (dayNum - now.getUTCDay() + 7) % 7;
          const sampleDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
          const dateStr = `${sampleDate.getUTCFullYear()}-${String(sampleDate.getUTCMonth() + 1).padStart(2, '0')}-${String(sampleDate.getUTCDate()).padStart(2, '0')}`;
          const messageTimezone = targetTimezone || teacher.timezone || tzUtils.DEFAULT_TIMEZONE;

          if (teacherSlots.length > 0) {
            for (const slot of teacherSlots) {
              const slotTz = slot.timezone || teacher.timezone || tzUtils.DEFAULT_TIMEZONE;
              const slotStart = tzUtils.convertToUTC(`${dateStr} ${slot.startTime}`, slotTz);
              const slotEnd = tzUtils.convertToUTC(`${dateStr} ${slot.endTime}`, slotTz);
              const freeSegments = await sliceAvailabilityByConflicts(teacher._id, slotStart, slotEnd);

              for (const segment of freeSegments) {
                const convertedStart = tzUtils.convertFromUTC(segment.start, messageTimezone);
                const convertedEnd = tzUtils.convertFromUTC(segment.end, messageTimezone);
                const displayStartOnly = tzUtils.formatTimeInTimezone(segment.start, messageTimezone, 'HH:mm');
                const displayEndOnly = tzUtils.formatTimeInTimezone(segment.end, messageTimezone, 'HH:mm');
                const durationMinutes = Math.round((segment.end.getTime() - segment.start.getTime()) / 60000);

                availableSlots.push({
                  dayOfWeek: dayNum,
                  dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayNum],
                  originalStart: segment.start,
                  originalEnd: segment.end,
                  startConverted: convertedStart,
                  endConverted: convertedEnd,
                  originalTimezone: slotTz,
                  targetTimezone: messageTimezone,
                  displayStart: displayStartOnly,
                  displayEnd: displayEndOnly,
                  durationMinutes,
                  matchScore: 100
                });
                teacherScore += 100;
                isExactMatch = true;
              }
            }
          } else if (teacher.teacherInfo?.availabilityStatus === 'default_24_7') {
            const tz = teacher.timezone || tzUtils.DEFAULT_TIMEZONE;
            const dayStart = tzUtils.convertToUTC(`${dateStr} 00:00`, tz);
            const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
            const freeSegments = await sliceAvailabilityByConflicts(teacher._id, dayStart, dayEnd);

            for (const segment of freeSegments) {
              const convertedStart = tzUtils.convertFromUTC(segment.start, messageTimezone);
              const convertedEnd = tzUtils.convertFromUTC(segment.end, messageTimezone);
              const durationMinutes = Math.round((segment.end.getTime() - segment.start.getTime()) / 60000);
              const isFullDay = durationMinutes >= 1440;
              const displayStartOnly = tzUtils.formatTimeInTimezone(segment.start, messageTimezone, 'HH:mm');
              const displayEndOnly = isFullDay ? '24:00' : tzUtils.formatTimeInTimezone(segment.end, messageTimezone, 'HH:mm');

              availableSlots.push({
                dayOfWeek: dayNum,
                dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayNum],
                originalStart: segment.start,
                originalEnd: segment.end,
                startConverted: convertedStart,
                endConverted: convertedEnd,
                originalTimezone: tz,
                targetTimezone: messageTimezone,
                displayStart: displayStartOnly,
                displayEnd: displayEndOnly,
                durationMinutes,
                matchScore: 100
              });
              teacherScore += 100;
              isExactMatch = true;
            }
          }
        } else {
          // We have explicit requested slots for this day -> test each requested slot against teacherSlots and default_24_7
          for (const requested of slotsForDay) {
            // If teacher has explicit availability slots, check if any accommodates requested slot
            let matched = false;
            for (const slot of teacherSlots) {
              if (canFitInSlot(slot.startTime, slot.endTime, requested.startTime, requested.endTime)) {
                const sampleDate = new Date();
                const daysAhead = (dayNum - sampleDate.getUTCDay() + 7) % 7;
                const sample = new Date(sampleDate.getTime() + daysAhead * 24 * 60 * 60 * 1000);
                const dateStr = `${sample.getUTCFullYear()}-${String(sample.getUTCMonth() + 1).padStart(2, '0')}-${String(sample.getUTCDate()).padStart(2, '0')}`;
                const slotTz = slot.timezone || teacher.timezone || tzUtils.DEFAULT_TIMEZONE;
                const slotStart = tzUtils.convertToUTC(`${dateStr} ${requested.startTime}`, slotTz);
                const slotEnd = tzUtils.convertToUTC(`${dateStr} ${requested.endTime}`, slotTz);
                const freeSegments = await sliceAvailabilityByConflicts(teacher._id, slotStart, slotEnd);

                if (freeSegments.length > 0) {
                  const messageTimezone = targetTimezone || slotTz;
                  for (const segment of freeSegments) {
                    const convertedStart = tzUtils.convertFromUTC(segment.start, messageTimezone);
                    const convertedEnd = tzUtils.convertFromUTC(segment.end, messageTimezone);
                    const durationMinutes = Math.round((segment.end.getTime() - segment.start.getTime()) / 60000);
                    const isFullDay = durationMinutes >= 1440;

                    availableSlots.push({
                      dayOfWeek: dayNum,
                      dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayNum],
                      originalStart: segment.start,
                      originalEnd: segment.end,
                      startConverted: convertedStart,
                      endConverted: convertedEnd,
                      originalTimezone: slotTz,
                      targetTimezone: messageTimezone,
                      displayStart: tzUtils.formatTimeInTimezone(segment.start, messageTimezone, 'HH:mm'),
                      displayEnd: isFullDay ? '24:00' : tzUtils.formatTimeInTimezone(segment.end, messageTimezone, 'HH:mm'),
                      durationMinutes,
                      matchScore: 100
                    });
                    teacherScore += 100;
                    isExactMatch = true;
                    matched = true;
                  }
                }
              }
            }

            // If teacher has no explicit slots but is default_24_7, validate requested slot against unavailability/classes
            if (!matched && teacher.teacherInfo?.availabilityStatus === 'default_24_7') {
              const sampleDate = new Date();
              const daysAhead = (dayNum - sampleDate.getUTCDay() + 7) % 7;
              const sample = new Date(sampleDate.getTime() + daysAhead * 24 * 60 * 60 * 1000);
              const dateStr = `${sample.getUTCFullYear()}-${String(sample.getUTCMonth()+1).padStart(2,'0')}-${String(sample.getUTCDate()).padStart(2,'0')}`;
              const tz = teacher.timezone || tzUtils.DEFAULT_TIMEZONE;
              const slotStart = tzUtils.convertToUTC(`${dateStr} ${requested.startTime}`, tz);
              const slotEnd = tzUtils.convertToUTC(`${dateStr} ${requested.endTime}`, tz);
              const freeSegments = await sliceAvailabilityByConflicts(teacher._id, slotStart, slotEnd);
              if (freeSegments.length > 0) {
                const messageTimezone = targetTimezone || tz;
                for (const segment of freeSegments) {
                  const convertedStart = tzUtils.convertFromUTC(segment.start, messageTimezone);
                  const convertedEnd = tzUtils.convertFromUTC(segment.end, messageTimezone);
                  const durationMinutes = Math.round((segment.end.getTime() - segment.start.getTime()) / 60000);
                  const isFullDay = durationMinutes >= 1440;
                  availableSlots.push({
                    dayOfWeek: dayNum,
                    dayName: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayNum],
                    originalStart: segment.start,
                    originalEnd: segment.end,
                    startConverted: convertedStart,
                    endConverted: convertedEnd,
                    originalTimezone: tz,
                    targetTimezone: messageTimezone,
                    displayStart: tzUtils.formatTimeInTimezone(segment.start, messageTimezone, 'HH:mm'),
                    displayEnd: isFullDay ? '24:00' : tzUtils.formatTimeInTimezone(segment.end, messageTimezone, 'HH:mm'),
                    durationMinutes,
                    matchScore: 100
                  });
                  teacherScore += 100;
                  isExactMatch = true;
                }
              }
            }
          }
        }
      }

      // Additional filters
      let passesFilters = true;
      // If searching for student age or range, ensure teacher's preference ranges accept it
      if (additionalCriteria.ageRange || additionalCriteria.studentAge) {
        // compute requested min/max
        const reqMin = additionalCriteria.ageRange ? additionalCriteria.ageRange.min : additionalCriteria.studentAge;
        const reqMax = additionalCriteria.ageRange ? additionalCriteria.ageRange.max : additionalCriteria.studentAge;
        // If a gender preference is set, use gender-specific teacher preference ranges where available
        if (additionalCriteria.genderPreference && additionalCriteria.genderPreference !== 'any') {
          const pref = additionalCriteria.genderPreference === 'female' ? teacher.teacherInfo?.preferredFemaleAgeRange : teacher.teacherInfo?.preferredMaleAgeRange;
          const pmin = pref?.min ?? teacher.teacherInfo?.preferredStudentAgeRange?.min ?? 3;
          const pmax = pref?.max ?? teacher.teacherInfo?.preferredStudentAgeRange?.max ?? 70;
          if (reqMin < pmin || reqMax > pmax) passesFilters = false;
        } else {
          const pref = teacher.teacherInfo?.preferredStudentAgeRange;
          const pmin = pref?.min ?? 3;
          const pmax = pref?.max ?? 70;
          if (reqMin < pmin || reqMax > pmax) passesFilters = false;
        }
      }
      if (additionalCriteria.genderPreference && additionalCriteria.genderPreference !== 'any') {
        if (teacher.gender !== additionalCriteria.genderPreference) passesFilters = false;
      }
      if (additionalCriteria.courses && additionalCriteria.courses.length > 0) {
        const teacherSubjects = teacher.teacherInfo?.subjects || [];
        const hasMatchingCourse = additionalCriteria.courses.some(course => teacherSubjects.some(subject => subject.toLowerCase().includes(course.toLowerCase())));
        if (!hasMatchingCourse) passesFilters = false;
      }

      if (!passesFilters) {
        results.stats.excluded++;
        continue;
      }

      if (availableSlots.length > 0) {
        const teacherResult = {
          teacher: {
            id: teacher._id,
            name: `${teacher.firstName} ${teacher.lastName}`,
            timezone: teacher.timezone || tzUtils.DEFAULT_TIMEZONE,
            hourlyRate: teacher.teacherInfo?.hourlyRate || 0
          },
          availableSlots,
          overallScore: teacherScore
        };

        if (isExactMatch) {
          results.exactMatches.push(teacherResult);
          results.stats.exactMatches++;
        } else {
          results.flexibleMatches.push(teacherResult);
          results.stats.flexibleMatches++;
        }
      } else {
        results.stats.excluded++;
      }
    }

    // Build human-readable message
    const lines = [];
    lines.push(`Available teachers (${results.stats.exactMatches + results.stats.flexibleMatches}):`);
    const list = results.exactMatches.concat(results.flexibleMatches);
    for (const r of list) {
      lines.push(`- ${r.teacher.name} (${r.teacher.timezone})`);
      for (const s of r.availableSlots) {
        // weekday + time, no date
        const timezoneLabel = s.targetTimezone || targetTimezone || tzUtils.DEFAULT_TIMEZONE;
        const durationLabel = formatDurationLabel(s.durationMinutes);
        const durationSuffix = durationLabel ? ` • ${durationLabel}` : '';
        lines.push(`   • ${s.dayName}: ${s.displayStart} — ${s.displayEnd} (${timezoneLabel})${durationSuffix}`);
      }
    }

    const message = lines.join('\n');

    return { results, message };
  } catch (error) {
    console.error('Error in searchTeachersForSharing:', error);
    return { results: null, message: 'Error generating share message' };
  }
}

module.exports = {
  validateTeacherAvailability,
  getAlternativeTimeSlots,
  checkAvailabilityCompliance,
  checkUnavailabilityAndConflicts,
  searchTeachersForSharing
};
