/**
 * DST (Daylight Saving Time) Service
 *
 * Rules:
 * - Student timezone is the default class anchor.
 * - Teacher dashboard previews teacher-time shifts before a timezone transition.
 * - Automatic corrections update future classes once a transition becomes active.
 * - Manual emergency overrides can be stored in the `timezoneDstOverrides` setting.
 */

const moment = require('moment-timezone');
const Class = require('../models/Class');
const User = require('../models/User');
const Setting = require('../models/Setting');
const notificationService = require('./notificationService');
const {
  normalizeAnchorMode,
  resolveStudentTimezone,
  resolveTeacherTimezone,
  getEmbeddedStudentRecord,
} = require('./classTimezoneService');
const { DEFAULT_TIMEZONE } = require('../utils/timezoneUtils');

const DST_OVERRIDE_SETTING_KEY = 'timezoneDstOverrides';
const ACTIVE_CLASS_STATUSES = ['scheduled', 'in_progress'];

const timezoneCountryAliasMap = {
  cairo: 'Egypt',
  alexandria: 'Egypt',
  riyadh: 'Saudi Arabia',
  jeddah: 'Saudi Arabia',
  mecca: 'Saudi Arabia',
  makkah: 'Saudi Arabia',
  dammam: 'Saudi Arabia',
  dubai: 'United Arab Emirates',
  abu_dhabi: 'United Arab Emirates',
  sharjah: 'United Arab Emirates',
  doha: 'Qatar',
  kuwait: 'Kuwait',
  bahrain: 'Bahrain',
  muscat: 'Oman',
  amman: 'Jordan',
  beirut: 'Lebanon',
  damascus: 'Syria',
  baghdad: 'Iraq',
  jerusalem: 'Palestine',
  gaza: 'Palestine',
  istanbul: 'Turkey',
  london: 'United Kingdom',
  paris: 'France',
  berlin: 'Germany',
  rome: 'Italy',
  madrid: 'Spain',
  lisbon: 'Portugal',
  dublin: 'Ireland',
  new_york: 'United States',
  chicago: 'United States',
  denver: 'United States',
  los_angeles: 'United States',
  toronto: 'Canada',
  vancouver: 'Canada',
  sydney: 'Australia',
  melbourne: 'Australia',
  auckland: 'New Zealand',
  karachi: 'Pakistan',
  lahore: 'Pakistan',
  islamabad: 'Pakistan',
  delhi: 'India',
  kolkata: 'India',
  mumbai: 'India',
  dhaka: 'Bangladesh',
  jakarta: 'Indonesia',
  kuala_lumpur: 'Malaysia',
  singapore: 'Singapore',
};

const buildTransitionKey = (transition) => {
  const normalized = normalizeTransition(transition, transition?.source || 'tzdb');
  if (!normalized) return '';
  return [
    normalized.timezone,
    normalized.date.toISOString(),
    normalized.type,
    Number(normalized.timeDifference || 0),
  ].join('|');
};

const asDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const addDays = (date, days) => new Date(date.getTime() + (days * 24 * 60 * 60 * 1000));
const getHiddenFilter = () => ({ hidden: { $ne: true } });

const deriveCountryFromTimezone = (timezone) => {
  const tz = String(timezone || '').trim();
  if (!tz || !tz.includes('/')) return '';
  const cityPart = tz.split('/').slice(1).join('/').toLowerCase();
  const candidateKey = cityPart.replace(/\s+/g, '_');
  if (timezoneCountryAliasMap[candidateKey]) return timezoneCountryAliasMap[candidateKey];

  const simple = candidateKey.split('/').pop();
  if (timezoneCountryAliasMap[simple]) return timezoneCountryAliasMap[simple];

  return simple.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) || '';
};

const resolveImpactCountry = (anchorInfo = {}) => {
  const storedCountry = String(anchorInfo?.guardianDoc?.uiPreferences?.timezoneCountry || '').trim();
  return storedCountry || deriveCountryFromTimezone(anchorInfo?.anchorTimezone || anchorInfo?.studentTimezone || '');
};

const normalizeTransition = (transition, source = 'tzdb') => {
  const transitionDate = asDate(transition?.date || transition?.transitionAt);
  if (!transitionDate || !transition?.timezone) return null;

  const offsetBefore = Number(transition?.offsetBefore);
  const offsetAfter = Number(transition?.offsetAfter);
  const timeDifference = Number.isFinite(Number(transition?.timeDifference))
    ? Math.abs(Number(transition.timeDifference))
    : (Number.isFinite(offsetBefore) && Number.isFinite(offsetAfter)
      ? Math.abs(offsetAfter - offsetBefore)
      : 0);

  let type = transition?.type;
  if (!type && Number.isFinite(offsetBefore) && Number.isFinite(offsetAfter)) {
    type = offsetAfter > offsetBefore ? 'spring_forward' : 'fall_back';
  }

  return {
    date: transitionDate,
    timezone: String(transition.timezone),
    type: type === 'fall_back' ? 'fall_back' : 'spring_forward',
    offsetBefore: Number.isFinite(offsetBefore) ? offsetBefore : null,
    offsetAfter: Number.isFinite(offsetAfter) ? offsetAfter : null,
    timeDifference,
    source,
    note: transition?.note || transition?.label || '',
  };
};

const dedupeTransitions = (transitions = []) => {
  const byKey = new Map();
  for (const transition of transitions) {
    const normalized = normalizeTransition(transition, transition?.source || 'tzdb');
    if (!normalized) continue;
    const key = `${normalized.timezone}:${normalized.date.toISOString()}`;
    const existing = byKey.get(key);
    if (!existing || normalized.source === 'manual') {
      byKey.set(key, normalized);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.date - b.date);
};

const findDSTTransition = (timezone, start, end) => {
  try {
    let current = start.clone();
    const endTime = end.clone();

    while (current.isBefore(endTime)) {
      const next = current.clone().add(1, 'hour');
      if (current.utcOffset() !== next.utcOffset()) {
        return normalizeTransition({
          date: next.toDate(),
          timezone,
          offsetBefore: current.utcOffset(),
          offsetAfter: next.utcOffset(),
        });
      }
      current = next;
    }

    return null;
  } catch (error) {
    console.error('Find DST transition error:', error);
    return null;
  }
};

const getNativeDSTTransitions = (timezone, year = new Date().getFullYear()) => {
  try {
    const transitions = [];
    for (let month = 0; month < 12; month += 1) {
      const startOfMonth = moment.tz({ year, month, day: 1, hour: 0, minute: 0, second: 0 }, timezone);
      const midMonth = startOfMonth.clone().add(15, 'days');
      const endOfMonth = startOfMonth.clone().endOf('month');

      if (startOfMonth.utcOffset() !== midMonth.utcOffset()) {
        const transition = findDSTTransition(timezone, startOfMonth, midMonth);
        if (transition) transitions.push(transition);
      }

      if (midMonth.utcOffset() !== endOfMonth.utcOffset()) {
        const transition = findDSTTransition(timezone, midMonth, endOfMonth);
        if (transition) transitions.push(transition);
      }
    }
    return dedupeTransitions(transitions);
  } catch (error) {
    console.error('Get DST transitions error:', error);
    return [];
  }
};

const getManualTransitionOverrides = async () => {
  try {
    const setting = await Setting.findOne({ key: DST_OVERRIDE_SETTING_KEY }).lean();
    const raw = Array.isArray(setting?.value) ? setting.value : [];
    return raw
      .filter((entry) => entry && entry.timezone && entry.transitionAt && entry.enabled !== false)
      .map((entry) => {
        const normalized = normalizeTransition({
          transitionAt: entry.transitionAt,
          timezone: entry.timezone,
          offsetBefore: entry.offsetBefore,
          offsetAfter: entry.offsetAfter,
          type: entry.type,
          timeDifference: entry.timeDifference,
          note: entry.note || entry.label || '',
        }, 'manual');
        if (!normalized) return null;
        return {
          ...normalized,
          id: entry.id || null,
          enabled: entry.enabled !== false,
          appliedAt: asDate(entry.appliedAt),
          appliedBy: entry.appliedBy || null,
          lastAppliedResult: entry.lastAppliedResult || null,
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.error('Get manual DST overrides error:', error);
    return [];
  }
};

const getDSTTransitions = async (timezone, year = new Date().getFullYear()) => {
  const nativeTransitions = getNativeDSTTransitions(timezone, year);
  const manualTransitions = await getManualTransitionOverrides();
  return dedupeTransitions([
    ...nativeTransitions,
    ...manualTransitions.filter((transition) => transition.timezone === timezone && transition.date.getUTCFullYear() === year),
  ]);
};

const getTransitionsForWindow = async ({ timezones = [], start, end }) => {
  const uniqueTimezones = Array.from(new Set((timezones || []).filter(Boolean)));
  const transitions = [];

  for (const timezone of uniqueTimezones) {
    const years = new Set([start.getUTCFullYear(), end.getUTCFullYear()]);
    for (const year of years) {
      const yearTransitions = await getDSTTransitions(timezone, year);
      transitions.push(...yearTransitions.filter((transition) => transition.date >= start && transition.date <= end));
    }
  }

  return dedupeTransitions(transitions);
};

const getAnchorInfoForClass = async (classDoc, cache = {}) => {
  const teacherId = String(classDoc?.teacher?._id || classDoc?.teacher || '');
  const guardianId = String(classDoc?.student?.guardianId?._id || classDoc?.student?.guardianId || '');
  const studentId = String(classDoc?.student?.studentId || '');

  let teacherDoc = cache.teachers?.get(teacherId) || null;
  if (!teacherDoc && teacherId) {
    teacherDoc = await User.findById(teacherId).select('timezone firstName lastName').lean();
    cache.teachers = cache.teachers || new Map();
    if (teacherDoc) cache.teachers.set(teacherId, teacherDoc);
  }

  let guardianDoc = cache.guardians?.get(guardianId) || null;
  if (!guardianDoc && guardianId) {
    guardianDoc = await User.findById(guardianId).select('timezone guardianInfo.students uiPreferences.timezoneCountry').lean();
    cache.guardians = cache.guardians || new Map();
    if (guardianDoc) cache.guardians.set(guardianId, guardianDoc);
  }

  let parentPattern = null;
  const parentId = String(classDoc?.parentRecurringClass?._id || classDoc?.parentRecurringClass || '');
  if (parentId) {
    parentPattern = cache.patterns?.get(parentId) || null;
    if (!parentPattern) {
      parentPattern = await Class.findById(parentId)
        .select('timeAnchor recurrenceDetails timezone anchoredTimezone')
        .lean();
      cache.patterns = cache.patterns || new Map();
      if (parentPattern) cache.patterns.set(parentId, parentPattern);
    }
  }

  const anchorMode = normalizeAnchorMode(classDoc?.anchoredTimezone || parentPattern?.anchoredTimezone || classDoc?.timeAnchor?.source || 'student');
  const teacherTimezone = resolveTeacherTimezone(teacherDoc, DEFAULT_TIMEZONE);
  const studentTimezone = resolveStudentTimezone({
    guardianDoc,
    studentId,
    fallbackTimezone: classDoc?.timeAnchor?.timezone || parentPattern?.timeAnchor?.timezone || classDoc?.timezone || DEFAULT_TIMEZONE,
  });

  const anchorTimezone = anchorMode === 'teacher'
    ? teacherTimezone
    : (anchorMode === 'system' ? (classDoc?.timezone || DEFAULT_TIMEZONE) : studentTimezone);

  let anchorLocalTime = classDoc?.timeAnchor?.localTime || parentPattern?.timeAnchor?.localTime || null;
  let anchorDayOfWeek = Number.isInteger(classDoc?.timeAnchor?.dayOfWeek)
    ? classDoc.timeAnchor.dayOfWeek
    : (Number.isInteger(parentPattern?.timeAnchor?.dayOfWeek) ? parentPattern.timeAnchor.dayOfWeek : null);

  if ((!anchorLocalTime || anchorDayOfWeek === null) && Array.isArray(parentPattern?.recurrenceDetails) && parentPattern.recurrenceDetails.length) {
    const localMoment = moment.tz(classDoc?.scheduledDate, anchorTimezone);
    const localDay = localMoment.isValid() ? localMoment.day() : null;
    const matchedSlot = parentPattern.recurrenceDetails.find((slot) => Number(slot?.dayOfWeek) === localDay)
      || parentPattern.recurrenceDetails[0];
    if (matchedSlot) {
      anchorLocalTime = anchorLocalTime || matchedSlot.time || null;
      if (anchorDayOfWeek === null && Number.isInteger(Number(matchedSlot.dayOfWeek))) {
        anchorDayOfWeek = Number(matchedSlot.dayOfWeek);
      }
    }
  }

  if (!anchorLocalTime && classDoc?.scheduledDate) {
    const localMoment = moment.tz(classDoc.scheduledDate, anchorTimezone);
    if (localMoment.isValid()) {
      anchorLocalTime = localMoment.format('HH:mm');
      if (anchorDayOfWeek === null) anchorDayOfWeek = localMoment.day();
    }
  }

  return {
    teacherDoc,
    guardianDoc,
    teacherTimezone,
    studentTimezone,
    anchorMode,
    anchorTimezone,
    anchorLocalTime,
    anchorDayOfWeek,
    parentPattern,
    studentRecord: getEmbeddedStudentRecord(guardianDoc, studentId),
  };
};

const calculateClassAdjustmentPreview = async (classDoc, transition, cache = {}) => {
  const scheduledDate = asDate(classDoc?.scheduledDate);
  if (!scheduledDate || !transition?.timezone) return null;

  const anchorInfo = await getAnchorInfoForClass(classDoc, cache);
  if (anchorInfo.anchorTimezone !== transition.timezone || !anchorInfo.anchorLocalTime) return null;

  const classMomentInAnchorTz = moment.tz(scheduledDate, anchorInfo.anchorTimezone);
  if (!classMomentInAnchorTz.isValid()) return null;

  const [hour = '0', minute = '0'] = String(anchorInfo.anchorLocalTime || '00:00').split(':');
  const adjustedUtc = moment.tz({
    year: classMomentInAnchorTz.year(),
    month: classMomentInAnchorTz.month(),
    day: classMomentInAnchorTz.date(),
    hour: Number(hour),
    minute: Number(minute),
    second: 0,
    millisecond: 0,
  }, anchorInfo.anchorTimezone).utc().toDate();

  const currentTeacherMoment = moment.tz(scheduledDate, anchorInfo.teacherTimezone);
  const adjustedTeacherMoment = moment.tz(adjustedUtc, anchorInfo.teacherTimezone);
  const currentStudentMoment = moment.tz(scheduledDate, anchorInfo.studentTimezone);

  return {
    classId: classDoc._id,
    scheduledDate,
    adjustedDate: adjustedUtc,
    changed: adjustedUtc.getTime() !== scheduledDate.getTime(),
    deltaMinutes: Math.round((adjustedUtc.getTime() - scheduledDate.getTime()) / 60000),
    teacherTimezone: anchorInfo.teacherTimezone,
    studentTimezone: anchorInfo.studentTimezone,
    anchorTimezone: anchorInfo.anchorTimezone,
    transition,
    studentName: classDoc?.student?.studentName || 'Student',
    title: classDoc?.title || classDoc?.subject || 'Class',
    subject: classDoc?.subject || '',
    teacherTimeBefore: currentTeacherMoment.format('ddd, DD MMM YYYY h:mm A'),
    teacherTimeAfter: adjustedTeacherMoment.format('ddd, DD MMM YYYY h:mm A'),
    studentLocalTime: currentStudentMoment.format('ddd, DD MMM YYYY h:mm A'),
  };
};

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

const describeDeltaDirection = (deltaMinutes = 0) => {
  if (deltaMinutes === 0) return 'unchanged';
  return deltaMinutes < 0 ? 'earlier' : 'later';
};

const hasTransitionBeenAppliedToClass = (classDoc, transition) => {
  const transitionKey = buildTransitionKey(transition);
  if (!transitionKey) return false;

  const adjustments = Array.isArray(classDoc?.dstInfo?.dstAdjustments)
    ? classDoc.dstInfo.dstAdjustments
    : [];

  return adjustments.some((entry) => {
    const entryKey = entry?.transitionKey || buildTransitionKey({
      timezone: entry?.affectedTimezone,
      transitionAt: entry?.transitionAt || entry?.adjustmentDate,
      date: entry?.transitionAt || entry?.adjustmentDate,
      type: entry?.adjustmentType,
      timeDifference: entry?.timeDifference,
    });
    return entryKey && entryKey === transitionKey;
  });
};

const getClassesForTransition = async (transition, { startDate, endDate } = {}) => {
  const windowStart = asDate(startDate) || addDays(transition.date, -1);
  const query = {
    scheduledDate: { $gte: windowStart },
    anchoredTimezone: 'student',
    status: { $in: ACTIVE_CLASS_STATUSES },
    ...getHiddenFilter(),
  };

  if (asDate(endDate)) {
    query.scheduledDate.$lte = asDate(endDate);
  }

  return Class.find(query)
    .select('title subject teacher student scheduledDate duration timezone anchoredTimezone timeAnchor parentRecurringClass dstInfo')
    .populate('teacher', 'timezone firstName lastName')
    .populate('student.guardianId', 'timezone guardianInfo.students uiPreferences.timezoneCountry')
    .sort({ scheduledDate: 1 });
};

const getUpcomingStudentAnchoredClasses = async ({ startDate, endDate } = {}) => {
  const windowStart = asDate(startDate) || new Date();
  const query = {
    scheduledDate: { $gte: windowStart },
    anchoredTimezone: 'student',
    status: { $in: ACTIVE_CLASS_STATUSES },
    ...getHiddenFilter(),
  };

  if (asDate(endDate)) {
    query.scheduledDate.$lte = asDate(endDate);
  }

  return Class.find(query)
    .select('title subject teacher student scheduledDate duration timezone anchoredTimezone timeAnchor parentRecurringClass dstInfo')
    .populate('teacher', 'timezone firstName lastName')
    .populate('student.guardianId', 'timezone guardianInfo.students uiPreferences.timezoneCountry')
    .sort({ scheduledDate: 1 })
    .lean();
};

const collectStudentAnchorContext = async ({ startDate, endDate } = {}) => {
  const classes = await getUpcomingStudentAnchoredClasses({ startDate, endDate });
  const cache = { teachers: new Map(), guardians: new Map(), patterns: new Map() };
  const anchorInfoByClass = new Map();
  const timezoneSet = new Set();

  for (const classDoc of classes) {
    const anchorInfo = await getAnchorInfoForClass(classDoc, cache);
    anchorInfoByClass.set(String(classDoc._id), anchorInfo);
    if (anchorInfo.anchorTimezone) timezoneSet.add(anchorInfo.anchorTimezone);
  }

  return {
    classes,
    cache,
    anchorInfoByClass,
    timezones: Array.from(timezoneSet),
  };
};

const buildTransitionImpactPreview = async (transition, { startDate, endDate } = {}) => {
  const classes = await getClassesForTransition(transition, { startDate, endDate });
  const cache = { teachers: new Map(), guardians: new Map(), patterns: new Map() };
  const impactedClasses = [];
  const impactedStudents = new Map();

  for (const classDoc of classes) {
    const preview = await calculateClassAdjustmentPreview(classDoc.toObject(), transition, cache);
    if (!preview || !preview.changed) continue;

    const alreadyApplied = hasTransitionBeenAppliedToClass(classDoc, transition);
    const classId = String(classDoc._id);
    const studentId = String(classDoc?.student?.studentId || classId);
    impactedClasses.push({
      classId,
      teacherId: classDoc?.teacher?._id || classDoc?.teacher || null,
      guardianId: classDoc?.student?.guardianId?._id || classDoc?.student?.guardianId || null,
      studentId,
      studentName: preview.studentName,
      classTitle: preview.title,
      subject: preview.subject,
      teacherName: `${classDoc?.teacher?.firstName || ''} ${classDoc?.teacher?.lastName || ''}`.trim() || 'Teacher',
      studentTimezone: preview.studentTimezone,
      country: String(classDoc?.student?.guardianId?.uiPreferences?.timezoneCountry || '').trim() || deriveCountryFromTimezone(preview.studentTimezone),
      teacherTimeBefore: preview.teacherTimeBefore,
      teacherTimeAfter: preview.teacherTimeAfter,
      studentLocalTime: preview.studentLocalTime,
      deltaMinutes: preview.deltaMinutes,
      direction: describeDeltaDirection(preview.deltaMinutes),
      scheduledDate: preview.scheduledDate,
      adjustedDate: preview.adjustedDate,
      alreadyApplied,
    });
    if (!impactedStudents.has(studentId)) {
      impactedStudents.set(studentId, preview.studentName);
    }
  }

  const pendingClasses = impactedClasses.filter((item) => !item.alreadyApplied);
  const deltaMinutes = pendingClasses[0]?.deltaMinutes || impactedClasses[0]?.deltaMinutes || 0;
  const direction = describeDeltaDirection(deltaMinutes);
  const amountMinutes = Math.abs(deltaMinutes);

  return {
    transition: {
      ...transition,
      transitionKey: buildTransitionKey(transition),
      direction,
      amountMinutes,
      amountHours: amountMinutes / 60,
    },
    impactedClasses,
    pendingClasses,
    impactedStudents: Array.from(impactedStudents, ([studentId, studentName]) => ({ studentId, studentName })),
    summary: {
      totalClasses: impactedClasses.length,
      pendingClasses: pendingClasses.length,
      alreadyAppliedClasses: impactedClasses.length - pendingClasses.length,
      totalStudents: impactedStudents.size,
    },
  };
};

const buildAdminTimezoneImpactSummary = async ({ warningDays = 7, lookaheadDays = 45 } = {}) => {
  const now = new Date();
  const previewEnd = addDays(now, lookaheadDays);
  const warningEnd = addDays(now, warningDays);
  const { classes, cache, anchorInfoByClass, timezones } = await collectStudentAnchorContext({
    startDate: now,
    endDate: previewEnd,
  });

  if (!classes.length || !timezones.length) {
    return {
      alerts: [],
      countries: [],
      summary: {
        alertCount: 0,
        impactedClassCount: 0,
        impactedStudentCount: 0,
        impactedTeacherCount: 0,
        countryCount: 0,
        timezoneCount: 0,
      },
    };
  }

  const transitions = await getTransitionsForWindow({
    timezones,
    start: addDays(now, -1),
    end: warningEnd,
  });

  const alertMap = new Map();
  const countryMap = new Map();
  const impactedClassIds = new Set();
  const impactedStudentIds = new Set();
  const impactedTeacherIds = new Set();

  for (const classDoc of classes) {
    const classId = String(classDoc._id);
    const anchorInfo = anchorInfoByClass.get(classId);
    if (!anchorInfo?.anchorTimezone) continue;

    const relevantTransitions = transitions.filter((transition) => transition.timezone === anchorInfo.anchorTimezone);
    for (const transition of relevantTransitions) {
      if (new Date(classDoc.scheduledDate) < transition.date) continue;
      const preview = await calculateClassAdjustmentPreview(classDoc, transition, cache);
      if (!preview || !preview.changed) continue;

      const key = buildTransitionKey(transition);
      const country = resolveImpactCountry(anchorInfo);
      const teacherId = String(classDoc?.teacher?._id || classDoc?.teacher || '');
      const studentId = String(classDoc?.student?.studentId || classId);

      if (!alertMap.has(key)) {
        alertMap.set(key, {
          transition: {
            ...transition,
            transitionKey: key,
          },
          timezone: transition.timezone,
          country,
          teacherIds: new Set(),
          studentIds: new Set(),
          classIds: new Set(),
          teacherNames: new Set(),
          studentNames: new Set(),
        });
      }

      const alert = alertMap.get(key);
      alert.classIds.add(classId);
      alert.studentIds.add(studentId);
      alert.studentNames.add(preview.studentName || 'Student');
      if (teacherId) {
        alert.teacherIds.add(teacherId);
        alert.teacherNames.add(`${classDoc?.teacher?.firstName || ''} ${classDoc?.teacher?.lastName || ''}`.trim() || 'Teacher');
      }

      impactedClassIds.add(classId);
      impactedStudentIds.add(studentId);
      if (teacherId) impactedTeacherIds.add(teacherId);

      const countryKey = country || 'Other';
      if (!countryMap.has(countryKey)) {
        countryMap.set(countryKey, {
          country: countryKey,
          timezones: new Set(),
          studentIds: new Set(),
          classIds: new Set(),
        });
      }
      const countryEntry = countryMap.get(countryKey);
      countryEntry.timezones.add(transition.timezone);
      countryEntry.studentIds.add(studentId);
      countryEntry.classIds.add(classId);
    }
  }

  const alerts = Array.from(alertMap.values())
    .map((alert) => ({
      transition: alert.transition,
      timezone: alert.timezone,
      country: alert.country,
      impactedClassCount: alert.classIds.size,
      impactedStudentCount: alert.studentIds.size,
      impactedTeacherCount: alert.teacherIds.size,
      teacherNames: Array.from(alert.teacherNames).slice(0, 3),
      studentNames: Array.from(alert.studentNames).slice(0, 3),
    }))
    .sort((a, b) => new Date(a.transition.date) - new Date(b.transition.date));

  const countries = Array.from(countryMap.values())
    .map((countryEntry) => ({
      country: countryEntry.country,
      impactedStudentCount: countryEntry.studentIds.size,
      impactedClassCount: countryEntry.classIds.size,
      timezoneCount: countryEntry.timezones.size,
      timezones: Array.from(countryEntry.timezones).sort(),
    }))
    .sort((a, b) => b.impactedStudentCount - a.impactedStudentCount || a.country.localeCompare(b.country));

  return {
    alerts,
    countries,
    summary: {
      alertCount: alerts.length,
      impactedClassCount: impactedClassIds.size,
      impactedStudentCount: impactedStudentIds.size,
      impactedTeacherCount: impactedTeacherIds.size,
      countryCount: countries.length,
      timezoneCount: new Set(alerts.map((alert) => alert.timezone)).size,
    },
  };
};

const buildTeacherSchedulePreview = async (teacherId, { warningDays = 7, lookaheadDays = 45 } = {}) => {
  const now = new Date();
  const previewEnd = addDays(now, lookaheadDays);
  const warningEnd = addDays(now, warningDays);
  const classes = await Class.find({
    teacher: teacherId,
    scheduledDate: { $gte: now, $lte: previewEnd },
    status: { $in: ACTIVE_CLASS_STATUSES },
    ...getHiddenFilter(),
  })
    .select('title subject teacher student scheduledDate duration timezone anchoredTimezone timeAnchor parentRecurringClass')
    .sort({ scheduledDate: 1 })
    .lean();

  if (!classes.length) {
    return {
      alerts: [],
      conflicts: [],
      summary: { alertCount: 0, conflictCount: 0 },
    };
  }

  const cache = { teachers: new Map(), guardians: new Map(), patterns: new Map() };
  const timezoneSet = new Set();
  const anchorInfoByClass = new Map();

  for (const classDoc of classes) {
    const anchorInfo = await getAnchorInfoForClass(classDoc, cache);
    anchorInfoByClass.set(String(classDoc._id), anchorInfo);
    if (anchorInfo.anchorTimezone) timezoneSet.add(anchorInfo.anchorTimezone);
  }

  const transitions = await getTransitionsForWindow({
    timezones: Array.from(timezoneSet),
    start: addDays(now, -1),
    end: warningEnd,
  });

  const previews = [];
  for (const classDoc of classes) {
    const anchorInfo = anchorInfoByClass.get(String(classDoc._id));
    const relevantTransitions = transitions.filter((transition) => transition.timezone === anchorInfo.anchorTimezone);
    for (const transition of relevantTransitions) {
      if (new Date(classDoc.scheduledDate) < transition.date) continue;
      const preview = await calculateClassAdjustmentPreview(classDoc, transition, cache);
      if (preview && preview.changed) previews.push(preview);
    }
  }

  const scheduleRows = classes
    .map((classDoc) => {
      const preview = previews.find((item) => String(item.classId) === String(classDoc._id));
      const start = preview?.adjustedDate || new Date(classDoc.scheduledDate);
      const end = new Date(start.getTime() + (Number(classDoc.duration || 0) * 60000));
      return {
        classId: String(classDoc._id),
        title: classDoc.title || classDoc.subject || 'Class',
        studentName: classDoc?.student?.studentName || 'Student',
        start,
        end,
        preview,
      };
    })
    .sort((a, b) => a.start - b.start);

  const conflicts = [];
  for (let i = 0; i < scheduleRows.length; i += 1) {
    const current = scheduleRows[i];
    for (let j = i + 1; j < scheduleRows.length; j += 1) {
      const next = scheduleRows[j];
      if (next.start >= current.end) break;
      if (overlaps(current.start, current.end, next.start, next.end) && (current.preview || next.preview)) {
        conflicts.push({
          classId: current.classId,
          conflictingClassId: next.classId,
          classTitle: current.title,
          conflictingClassTitle: next.title,
          studentName: current.studentName,
          conflictingStudentName: next.studentName,
        });
      }
    }
  }

  const alerts = previews.map((preview) => {
    const hoursUntil = Math.round((preview.transition.date.getTime() - now.getTime()) / (60 * 60 * 1000));
    const conflict = conflicts.find((item) => item.classId === String(preview.classId) || item.conflictingClassId === String(preview.classId)) || null;
    return {
      ...preview,
      severity: conflict ? 'error' : 'warning',
      transitionStatus: preview.transition.date > now ? 'upcoming' : 'active',
      hoursUntil,
      conflict,
    };
  });

  return {
    alerts,
    conflicts,
    summary: {
      alertCount: alerts.length,
      conflictCount: conflicts.length,
    },
  };
};

const sendDSTWarningNotification = async (transition, timezone, options = {}) => {
  try {
    const now = new Date();
    const lookaheadDays = Number(options.lookaheadDays) > 0 ? Number(options.lookaheadDays) : 45;
    const impactPreview = options.impactPreview || await buildTransitionImpactPreview(transition, {
      startDate: now,
      endDate: addDays(now, lookaheadDays),
    });
    const pendingClasses = Array.isArray(impactPreview?.pendingClasses) ? impactPreview.pendingClasses : [];
    if (!pendingClasses.length) return;

    const daysUntil = Math.ceil((transition.date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const hours = (transition.timeDifference || 0) / 60;
    const amount = `${hours} hour${hours === 1 ? '' : 's'}`;
    const direction = transition.type === 'spring_forward' ? 'forward' : 'back';
    const dateLabel = moment(transition.date).tz(timezone).format('ddd, MMM D, YYYY h:mm A z');
    const teacherGroups = new Map();

    for (const item of pendingClasses) {
      const teacherId = String(item?.teacherId || '');
      if (!teacherId) continue;
      if (!teacherGroups.has(teacherId)) {
        teacherGroups.set(teacherId, {
          teacherId,
          classes: [],
          studentIds: new Set(),
          timezones: new Set(),
        });
      }
      const group = teacherGroups.get(teacherId);
      group.classes.push(item);
      group.studentIds.add(String(item?.studentId || item?.classId || ''));
      if (item?.studentTimezone) group.timezones.add(item.studentTimezone);
    }

    const teacherNotifications = Array.from(teacherGroups.values()).map((group) => {
      const firstClass = group.classes[0];
      const message = daysUntil <= 0
        ? `${group.classes.length} class time${group.classes.length === 1 ? '' : 's'} for ${group.studentIds.size} student${group.studentIds.size === 1 ? '' : 's'} change today because ${timezone} moves ${direction} by ${amount}. Example: ${firstClass.teacherTimeBefore} → ${firstClass.teacherTimeAfter}.`
        : `${group.classes.length} class time${group.classes.length === 1 ? '' : 's'} for ${group.studentIds.size} student${group.studentIds.size === 1 ? '' : 's'} will change on ${dateLabel}. ${timezone} moves ${direction} by ${amount}. Example: ${firstClass.teacherTimeBefore} → ${firstClass.teacherTimeAfter}.`;

      return notificationService.createNotification({
        userId: group.teacherId,
        title: 'Timezone change reminder',
        message,
        type: 'info',
        relatedTo: 'dst_transition',
        metadata: {
          kind: 'timezone_transition_warning',
          audience: 'teacher',
          timezone,
          transition,
          daysUntil,
          affectedClassCount: group.classes.length,
          affectedStudentCount: group.studentIds.size,
        },
        actionLink: '/dashboard',
      });
    });

    const adminUsers = await User.find({ role: 'admin', isActive: true }).select('_id').lean();
    const affectedCountries = Array.from(new Set(pendingClasses.map((item) => String(item?.country || '').trim()).filter(Boolean)));
    const affectedStudents = new Set(pendingClasses.map((item) => String(item?.studentId || item?.classId || '')).filter(Boolean));
    const adminMessage = daysUntil <= 0
      ? `${affectedStudents.size} active student${affectedStudents.size === 1 ? '' : 's'} across ${affectedCountries.length || 1} countr${affectedCountries.length === 1 ? 'y' : 'ies'} are affected today by the ${timezone} timezone change.`
      : `${affectedStudents.size} active student${affectedStudents.size === 1 ? '' : 's'} across ${affectedCountries.length || 1} countr${affectedCountries.length === 1 ? 'y' : 'ies'} have classes that shift on ${dateLabel}.`;

    const adminNotifications = adminUsers.map((admin) => notificationService.createNotification({
      userId: admin._id,
      title: 'Active student timezone summary',
      message: adminMessage,
      type: 'info',
      relatedTo: 'dst_transition',
      metadata: {
        kind: 'admin_timezone_transition_summary',
        timezone,
        transition,
        daysUntil,
        affectedClassCount: pendingClasses.length,
        affectedStudentCount: affectedStudents.size,
        affectedCountries,
      },
      actionLink: '/dashboard',
    }));

    await Promise.allSettled([...teacherNotifications, ...adminNotifications]);
  } catch (error) {
    console.error('Send DST warning notification error:', error);
  }
};

const checkAndNotifyDSTTransitions = async (warningDays = 7, lookaheadDays = 45) => {
  const now = new Date();
  const warningEnd = addDays(now, warningDays);
  const { timezones } = await collectStudentAnchorContext({
    startDate: now,
    endDate: addDays(now, lookaheadDays),
  });
  if (!timezones.length) return;
  const transitions = await getTransitionsForWindow({
    timezones,
    start: now,
    end: warningEnd,
  });

  for (const transition of transitions) {
    const impactPreview = await buildTransitionImpactPreview(transition, {
      startDate: now,
      endDate: addDays(now, lookaheadDays),
    });
    if (!impactPreview?.pendingClasses?.length) continue;
    await sendDSTWarningNotification(transition, transition.timezone, { impactPreview, lookaheadDays });
  }
};

const applyAdjustmentToClass = async (classDoc, preview, options = {}) => {
  classDoc.scheduledDate = preview.adjustedDate;
  classDoc.timeAnchor = {
    source: normalizeAnchorMode(classDoc.anchoredTimezone || classDoc?.timeAnchor?.source || 'student'),
    timezone: preview.anchorTimezone,
    localTime: classDoc?.timeAnchor?.localTime || moment.tz(preview.adjustedDate, preview.anchorTimezone).format('HH:mm'),
    dayOfWeek: Number.isInteger(classDoc?.timeAnchor?.dayOfWeek)
      ? classDoc.timeAnchor.dayOfWeek
      : moment.tz(preview.adjustedDate, preview.anchorTimezone).day(),
  };

  const adjustmentEntry = {
    adjustmentDate: new Date(),
    reason: `DST ${preview.transition.type} transition`,
    oldTime: preview.scheduledDate,
    newTime: preview.adjustedDate,
    affectedTimezone: preview.transition.timezone,
    adjustmentType: preview.transition.type,
    transitionAt: preview.transition.date,
    timeDifference: preview.transition.timeDifference || Math.abs(preview.deltaMinutes),
    transitionKey: buildTransitionKey(preview.transition),
    source: options.source || preview.transition.source || 'automatic',
    overrideId: options.overrideId || preview.transition.id || null,
  };

  if (!classDoc.dstInfo) {
    classDoc.dstInfo = { lastDSTCheck: new Date(), dstAdjustments: [adjustmentEntry] };
  } else {
    classDoc.dstInfo.lastDSTCheck = new Date();
    classDoc.dstInfo.dstAdjustments = Array.isArray(classDoc.dstInfo.dstAdjustments)
      ? [...classDoc.dstInfo.dstAdjustments, adjustmentEntry]
      : [adjustmentEntry];
  }

  await classDoc.save();
};

const notifyClassTimeAdjustment = async (classDoc, preview) => {
  try {
    const teacherId = classDoc?.teacher?._id || classDoc?.teacher;
    const guardianId = classDoc?.student?.guardianId?._id || classDoc?.student?.guardianId;
    const recipients = Array.from(new Set([teacherId, guardianId].filter(Boolean).map((id) => String(id))));

    await Promise.allSettled(recipients.map((userId) => notificationService.createNotification({
      userId,
      title: 'Class time adjusted for timezone change',
      message: `${preview.title} for ${preview.studentName} moved from ${preview.teacherTimeBefore} to ${preview.teacherTimeAfter} to keep the student's local time fixed.`,
      type: 'warning',
      relatedTo: 'class',
      relatedId: classDoc._id,
      metadata: {
        kind: 'timezone_adjustment_applied',
        classId: String(classDoc._id),
        transition: preview.transition,
        teacherTimezone: preview.teacherTimezone,
        studentTimezone: preview.studentTimezone,
      },
      actionLink: '/dashboard/classes',
    })));
  } catch (error) {
    console.error('Notify class time adjustment error:', error);
  }
};

const adjustClassTimesForDST = async (transition, options = {}) => {
  try {
    const classes = await getClassesForTransition(transition, {
      startDate: options.startDate,
      endDate: options.endDate,
    });

    const cache = { teachers: new Map(), guardians: new Map(), patterns: new Map() };
    let adjustedCount = 0;
    let skippedAlreadyApplied = 0;

    for (const classDoc of classes) {
      if (hasTransitionBeenAppliedToClass(classDoc, transition)) {
        skippedAlreadyApplied += 1;
        continue;
      }
      const preview = await calculateClassAdjustmentPreview(classDoc.toObject(), transition, cache);
      if (!preview || !preview.changed) continue;
      await applyAdjustmentToClass(classDoc, preview, options);
      await notifyClassTimeAdjustment(classDoc, preview);
      adjustedCount += 1;
    }
    return {
      adjustedCount,
      skippedAlreadyApplied,
    };
  } catch (error) {
    console.error('Adjust class times for DST error:', error);
    return {
      adjustedCount: 0,
      skippedAlreadyApplied: 0,
    };
  }
};

const performDSTCheck = async () => {
  try {
    await checkAndNotifyDSTTransitions(7);

    const now = new Date();
    const userTimezones = await User.distinct('timezone');
    const transitions = await getTransitionsForWindow({
      timezones: userTimezones,
      start: addDays(now, -1),
      end: addDays(now, 1),
    });

    for (const transition of transitions) {
      await adjustClassTimesForDST(transition);
    }
  } catch (error) {
    console.error('Perform DST check error:', error);
  }
};

const getDSTInfo = async (timezone) => {
  try {
    const currentYear = new Date().getFullYear();
    const transitions = await getDSTTransitions(timezone, currentYear);
    const now = new Date();
    const upcomingTransitions = transitions.filter((transition) => transition.date > now);
    const recentTransitions = transitions.filter((transition) => transition.date <= now);
    return {
      timezone,
      currentYear,
      hasDST: transitions.length > 0,
      transitions,
      upcomingTransitions,
      recentTransitions,
      nextTransition: upcomingTransitions[0] || null,
      lastTransition: recentTransitions.length ? recentTransitions[recentTransitions.length - 1] : null,
    };
  } catch (error) {
    console.error('Get DST info error:', error);
    return {
      timezone,
      hasDST: false,
      transitions: [],
      upcomingTransitions: [],
      recentTransitions: [],
      nextTransition: null,
      lastTransition: null,
    };
  }
};

module.exports = {
  DST_OVERRIDE_SETTING_KEY,
  deriveCountryFromTimezone,
  getDSTTransitions,
  getDSTInfo,
  getManualTransitionOverrides,
  getTransitionsForWindow,
  calculateClassAdjustmentPreview,
  buildTransitionImpactPreview,
  buildAdminTimezoneImpactSummary,
  buildTransitionKey,
  buildTeacherSchedulePreview,
  checkAndNotifyDSTTransitions,
  describeDeltaDirection,
  sendDSTWarningNotification,
  hasTransitionBeenAppliedToClass,
  adjustClassTimesForDST,
  performDSTCheck,
};
