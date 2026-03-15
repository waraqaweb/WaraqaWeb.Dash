const moment = require('moment-timezone');
const { DEFAULT_TIMEZONE } = require('../utils/timezoneUtils');

const ANCHOR_MODES = new Set(['student', 'teacher', 'system']);

const normalizeAnchorMode = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return ANCHOR_MODES.has(normalized) ? normalized : 'student';
};

const getEmbeddedStudentRecord = (guardianDoc, studentId) => {
  if (!guardianDoc || !studentId) return null;
  const embedded = guardianDoc?.guardianInfo?.students;
  if (!embedded) return null;

  if (typeof embedded.id === 'function') {
    const match = embedded.id(studentId);
    if (match) return match;
  }

  if (Array.isArray(embedded)) {
    return embedded.find((student) => String(student?._id || student?.studentId || '') === String(studentId)) || null;
  }

  return null;
};

const resolveStudentTimezone = ({ guardianDoc, studentId, fallbackTimezone } = {}) => {
  const embeddedStudent = getEmbeddedStudentRecord(guardianDoc, studentId);
  return (
    embeddedStudent?.timezone
    || guardianDoc?.timezone
    || fallbackTimezone
    || DEFAULT_TIMEZONE
  );
};

const resolveTeacherTimezone = (teacherDoc, fallbackTimezone = DEFAULT_TIMEZONE) => {
  return teacherDoc?.timezone || fallbackTimezone || DEFAULT_TIMEZONE;
};

const resolveAnchorTimezone = ({ anchorMode, studentTimezone, teacherTimezone, fallbackTimezone } = {}) => {
  const normalizedAnchorMode = normalizeAnchorMode(anchorMode);

  if (normalizedAnchorMode === 'teacher') {
    return teacherTimezone || fallbackTimezone || DEFAULT_TIMEZONE;
  }

  if (normalizedAnchorMode === 'student') {
    return studentTimezone || fallbackTimezone || DEFAULT_TIMEZONE;
  }

  return fallbackTimezone || studentTimezone || teacherTimezone || DEFAULT_TIMEZONE;
};

const resolveClassTimezone = ({ requestedTimezone, anchorMode, studentTimezone, teacherTimezone, fallbackTimezone } = {}) => {
  if (requestedTimezone) return requestedTimezone;

  return resolveAnchorTimezone({
    anchorMode,
    studentTimezone,
    teacherTimezone,
    fallbackTimezone,
  });
};

const getLocalDayTimeParts = (dateLike, timezone = DEFAULT_TIMEZONE) => {
  if (!dateLike) return null;
  const localMoment = moment.tz(dateLike, timezone);
  if (!localMoment.isValid()) return null;

  return {
    timezone,
    dayOfWeek: localMoment.day(),
    localTime: localMoment.format('HH:mm'),
    localDate: localMoment.format('YYYY-MM-DD'),
  };
};

const buildTimeAnchorForScheduledClass = ({
  scheduledDate,
  anchorMode,
  requestedTimezone,
  studentTimezone,
  teacherTimezone,
  fallbackTimezone,
} = {}) => {
  const timezone = resolveClassTimezone({
    requestedTimezone,
    anchorMode,
    studentTimezone,
    teacherTimezone,
    fallbackTimezone,
  });

  const localParts = getLocalDayTimeParts(scheduledDate, timezone);
  if (!localParts) {
    return {
      source: normalizeAnchorMode(anchorMode),
      timezone,
      localTime: null,
      dayOfWeek: null,
    };
  }

  return {
    source: normalizeAnchorMode(anchorMode),
    timezone,
    localTime: localParts.localTime,
    dayOfWeek: localParts.dayOfWeek,
  };
};

const buildTimeAnchorForSlot = ({
  slot,
  anchorMode,
  requestedTimezone,
  studentTimezone,
  teacherTimezone,
  fallbackTimezone,
} = {}) => {
  const timezone = resolveClassTimezone({
    requestedTimezone: slot?.timezone || requestedTimezone,
    anchorMode,
    studentTimezone,
    teacherTimezone,
    fallbackTimezone,
  });

  return {
    source: normalizeAnchorMode(anchorMode),
    timezone,
    localTime: typeof slot?.time === 'string' ? slot.time : null,
    dayOfWeek: Number.isInteger(Number(slot?.dayOfWeek)) ? Number(slot.dayOfWeek) : null,
  };
};

module.exports = {
  normalizeAnchorMode,
  getEmbeddedStudentRecord,
  resolveStudentTimezone,
  resolveTeacherTimezone,
  resolveAnchorTimezone,
  resolveClassTimezone,
  getLocalDayTimeParts,
  buildTimeAnchorForScheduledClass,
  buildTimeAnchorForSlot,
};
