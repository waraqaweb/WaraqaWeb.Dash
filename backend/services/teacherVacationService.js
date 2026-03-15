const Vacation = require('../models/Vacation');
const User = require('../models/User');
const SystemVacation = require('../models/SystemVacation');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const INCLUDED_STATUSES = new Set(['approved', 'active', 'ended']);
const REQUEST_BLOCKING_STATUSES = new Set(['pending', 'approved', 'active', 'ended']);

const toDayStart = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const toDayEnd = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
};

const getYearBounds = (year = new Date().getFullYear()) => ({
  start: new Date(year, 0, 1, 0, 0, 0, 0),
  end: new Date(year, 11, 31, 23, 59, 59, 999),
});

const toDayKey = (value) => {
  const date = toDayStart(value);
  return date ? date.toISOString().slice(0, 10) : null;
};

const eachDay = (start, end, callback) => {
  const cursor = toDayStart(start);
  const finish = toDayStart(end);
  if (!cursor || !finish || finish < cursor) return;
  while (cursor <= finish) {
    callback(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
};

const normalizeAllowanceConfig = (teacherInfo = {}, year = new Date().getFullYear()) => {
  const allowance = teacherInfo?.vacationAllowance || {};
  const defaultCandidate = Number(
    allowance?.defaultDaysPerYear
    ?? teacherInfo?.vacationAllowanceDaysPerYear
    ?? teacherInfo?.vacationDaysPerYear
    ?? teacherInfo?.allowedVacationDaysPerYear
    ?? teacherInfo?.vacationAllowanceDays
    ?? 0
  );
  const defaultDaysPerYear = Number.isFinite(defaultCandidate) ? Math.max(0, defaultCandidate) : 0;

  const yearlyOverrides = Array.isArray(allowance?.yearlyOverrides)
    ? allowance.yearlyOverrides
        .map((entry) => ({
          year: Number(entry?.year),
          days: Number(entry?.days),
        }))
        .filter((entry) => Number.isInteger(entry.year) && Number.isFinite(entry.days) && entry.days >= 0)
    : [];

  const override = yearlyOverrides.find((entry) => entry.year === year) || null;

  return {
    defaultDaysPerYear,
    yearlyOverrides,
    currentYearOverrideDays: override ? override.days : null,
    allocatedDays: override ? override.days : defaultDaysPerYear,
  };
};

const getOverlappingSystemVacations = async ({ startDate, endDate }) => {
  const start = toDayStart(startDate);
  const end = toDayEnd(endDate);
  if (!start || !end) return [];
  return SystemVacation.find({
    isActive: true,
    startDate: { $lte: end },
    endDate: { $gte: start },
  })
    .select('startDate endDate isActive')
    .lean();
};

const buildSystemVacationDaySet = (systemVacations = [], { startDate, endDate, year }) => {
  const bounds = getYearBounds(year);
  const effectiveStart = toDayStart(startDate) || bounds.start;
  const effectiveEnd = toDayEnd(endDate) || bounds.end;
  const daySet = new Set();

  (systemVacations || []).forEach((vacation) => {
    if (vacation?.isActive === false) return;
    const overlapStart = [toDayStart(vacation.startDate), bounds.start, effectiveStart]
      .filter(Boolean)
      .sort((a, b) => b - a)[0];
    const overlapEnd = [toDayEnd(vacation.endDate), bounds.end, effectiveEnd]
      .filter(Boolean)
      .sort((a, b) => a - b)[0];
    if (!overlapStart || !overlapEnd || overlapEnd < overlapStart) return;
    eachDay(overlapStart, overlapEnd, (day) => {
      const key = toDayKey(day);
      if (key) daySet.add(key);
    });
  });

  return daySet;
};

const buildChargeableDaySet = ({ vacations = [], systemVacations = [], year = new Date().getFullYear(), referenceDate = null, capAtReferenceDate = false, statuses = INCLUDED_STATUSES, excludeVacationId = null }) => {
  const bounds = getYearBounds(year);
  const capEnd = capAtReferenceDate ? (toDayEnd(referenceDate || new Date()) || bounds.end) : bounds.end;
  const systemDaySet = buildSystemVacationDaySet(systemVacations, {
    startDate: bounds.start,
    endDate: capEnd,
    year,
  });
  const daySet = new Set();

  (vacations || []).forEach((vacation) => {
    if (!vacation) return;
    if (excludeVacationId && String(vacation._id || '') === String(excludeVacationId)) return;
    const status = String(vacation.lifecycleStatus || vacation.status || vacation.approvalStatus || '').toLowerCase();
    if (!statuses.has(status)) return;

    const vacationStart = toDayStart(vacation.startDate);
    const vacationEnd = toDayEnd(vacation.actualEndDate || vacation.endDate);
    if (!vacationStart || !vacationEnd) return;

    const overlapStart = [vacationStart, bounds.start].sort((a, b) => b - a)[0];
    const overlapEnd = [vacationEnd, capEnd].sort((a, b) => a - b)[0];
    if (!overlapStart || !overlapEnd || overlapEnd < overlapStart) return;

    eachDay(overlapStart, overlapEnd, (day) => {
      const key = toDayKey(day);
      if (key && !systemDaySet.has(key)) {
        daySet.add(key);
      }
    });
  });

  return daySet;
};

const calculateChargeableDaysForRange = async ({ startDate, endDate, year = new Date().getFullYear() }) => {
  const start = toDayStart(startDate);
  const end = toDayEnd(endDate);
  if (!start || !end || end < start) return 0;
  const systemVacations = await getOverlappingSystemVacations({ startDate: start, endDate: end });
  const systemDaySet = buildSystemVacationDaySet(systemVacations, { startDate: start, endDate: end, year });
  const daySet = new Set();
  eachDay(start, end, (day) => {
    const key = toDayKey(day);
    if (key && !systemDaySet.has(key)) {
      daySet.add(key);
    }
  });
  return daySet.size;
};

const getTeacherVacationAllowanceStatus = async ({ teacherId, year = new Date().getFullYear(), startDate, endDate, excludeVacationId = null }) => {
  const teacher = await User.findById(teacherId).select('teacherInfo').lean();
  const allowance = normalizeAllowanceConfig(teacher?.teacherInfo || {}, year);
  const bounds = getYearBounds(year);
  const vacationQuery = {
    role: 'teacher',
    user: teacherId,
    status: { $in: Array.from(REQUEST_BLOCKING_STATUSES) },
    startDate: { $lte: bounds.end },
    $or: [
      { actualEndDate: { $gte: bounds.start } },
      { actualEndDate: null, endDate: { $gte: bounds.start } },
      { endDate: { $gte: bounds.start } },
    ],
  };
  const vacations = await Vacation.find(vacationQuery)
    .select('_id startDate endDate actualEndDate status approvalStatus')
    .lean();
  const systemVacations = await getOverlappingSystemVacations({ startDate: bounds.start, endDate: bounds.end });
  const reservedDays = buildChargeableDaySet({
    vacations,
    systemVacations,
    year,
    statuses: REQUEST_BLOCKING_STATUSES,
    capAtReferenceDate: false,
    excludeVacationId,
  }).size;
  const requestedDays = (startDate && endDate)
    ? await calculateChargeableDaysForRange({ startDate, endDate, year })
    : 0;
  const remainingDays = Math.max(0, Number(allowance.allocatedDays || 0) - reservedDays);

  return {
    year,
    allocatedDays: Number(allowance.allocatedDays || 0),
    defaultDaysPerYear: Number(allowance.defaultDaysPerYear || 0),
    currentYearOverrideDays: allowance.currentYearOverrideDays,
    reservedDays,
    remainingDays,
    requestedDays,
    canRequest: requestedDays <= remainingDays,
  };
};

const getConsumedVacationDaysForYear = (vacation, year = new Date().getFullYear(), referenceDate = new Date()) => {
  if (!vacation) return 0;
  const status = String(vacation.lifecycleStatus || vacation.status || vacation.approvalStatus || '').toLowerCase();
  if (!INCLUDED_STATUSES.has(status)) return 0;

  const yearBounds = getYearBounds(year);
  const vacationStart = toDayStart(vacation.startDate);
  const effectiveEndRaw = vacation.actualEndDate || vacation.endDate;
  const vacationEnd = toDayEnd(effectiveEndRaw);
  const todayEnd = toDayEnd(referenceDate);

  if (!vacationStart || !vacationEnd || !todayEnd) return 0;
  if (vacationStart > todayEnd) return 0;

  const consumedEnd = vacationEnd < todayEnd ? vacationEnd : todayEnd;
  const overlapStart = vacationStart > yearBounds.start ? vacationStart : yearBounds.start;
  const overlapEnd = consumedEnd < yearBounds.end ? consumedEnd : yearBounds.end;

  if (overlapEnd < overlapStart) return 0;
  return Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / MS_PER_DAY) + 1;
};

const buildTeacherVacationSummary = ({ teacher, vacations = [], year = new Date().getFullYear(), referenceDate = new Date(), usedDaysOverride = null, allowanceOverride = null }) => {
  const teacherInfo = teacher?.teacherInfo || {};
  const allowance = allowanceOverride || normalizeAllowanceConfig(teacherInfo, year);
  const usedDays = Number.isFinite(Number(usedDaysOverride))
    ? Number(usedDaysOverride)
    : vacations.reduce((sum, vacation) => sum + getConsumedVacationDaysForYear(vacation, year, referenceDate), 0);
  const remainingDays = Math.max(0, Number(allowance.allocatedDays || 0) - usedDays);

  return {
    year,
    allocatedDays: Number(allowance.allocatedDays || 0),
    defaultDaysPerYear: Number(allowance.defaultDaysPerYear || 0),
    currentYearOverrideDays: allowance.currentYearOverrideDays,
    usedDays,
    remainingDays,
    vacationCount: vacations.filter(Boolean).length,
  };
};

const getTeacherVacationSummaryMap = async (teacherIds = [], { year = new Date().getFullYear(), teachersById } = {}) => {
  const normalizedIds = Array.from(new Set((teacherIds || []).map((id) => String(id || '')).filter(Boolean)));
  if (!normalizedIds.length) return new Map();

  let teacherDocsById = teachersById instanceof Map ? new Map(teachersById) : new Map();
  const missingIds = normalizedIds.filter((id) => !teacherDocsById.has(id));
  if (missingIds.length) {
    const docs = await User.find({ _id: { $in: missingIds }, role: 'teacher' })
      .select('teacherInfo')
      .lean();
    docs.forEach((doc) => {
      teacherDocsById.set(String(doc._id), doc);
    });
  }

  const vacations = await Vacation.find({
    role: 'teacher',
    user: { $in: normalizedIds },
    status: { $in: Array.from(INCLUDED_STATUSES) },
  })
    .select('user startDate endDate actualEndDate status approvalStatus')
    .lean();

  const yearBounds = getYearBounds(year);
  const systemVacations = await getOverlappingSystemVacations({ startDate: yearBounds.start, endDate: yearBounds.end });

  const groupedVacations = new Map();
  vacations.forEach((vacation) => {
    const teacherId = String(vacation.user || '');
    if (!teacherId) return;
    if (!groupedVacations.has(teacherId)) groupedVacations.set(teacherId, []);
    groupedVacations.get(teacherId).push(vacation);
  });

  const summaries = new Map();
  normalizedIds.forEach((teacherId) => {
    const teacher = teacherDocsById.get(teacherId) || null;
    const teacherVacations = groupedVacations.get(teacherId) || [];
    const usedDays = buildChargeableDaySet({
      vacations: teacherVacations,
      systemVacations,
      year,
      referenceDate: new Date(),
      capAtReferenceDate: true,
      statuses: INCLUDED_STATUSES,
    }).size;
    const allowance = normalizeAllowanceConfig(teacher?.teacherInfo || {}, year);
    summaries.set(teacherId, buildTeacherVacationSummary({
      teacher,
      vacations: teacherVacations,
      year,
      referenceDate: new Date(),
      usedDaysOverride: usedDays,
      allowanceOverride: allowance,
    }));
  });

  return summaries;
};

const getTeacherVacationSummary = async (teacherId, options = {}) => {
  const map = await getTeacherVacationSummaryMap([teacherId], options);
  return map.get(String(teacherId)) || buildTeacherVacationSummary({ teacher: null, vacations: [], year: options.year });
};

module.exports = {
  calculateChargeableDaysForRange,
  getYearBounds,
  getTeacherVacationAllowanceStatus,
  normalizeAllowanceConfig,
  getConsumedVacationDaysForYear,
  buildTeacherVacationSummary,
  buildChargeableDaySet,
  getTeacherVacationSummaryMap,
  getTeacherVacationSummary,
};
