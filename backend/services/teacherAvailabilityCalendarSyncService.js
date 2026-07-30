const User = require('../models/User');
const {
  isConfigured,
  ensureTeacherCalendar,
  getCalendarClient,
} = require('./teacherClassCalendarSyncService');

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const toDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const makeAvailabilityEventId = (slotId) => {
  const base = String(slotId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!base) return null;
  return `av${base}`;
};

const makeUnavailableEventId = (periodId) => {
  const base = String(periodId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!base) return null;
  return `up${base}`;
};

const parseTimeParts = (hhmm) => {
  const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
};

const computeRecurringStart = (effectiveFrom, dayOfWeek, startTime) => {
  const startParts = parseTimeParts(startTime);
  if (!startParts) return null;

  const anchor = toDate(effectiveFrom) || new Date();
  const date = new Date(Date.UTC(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth(),
    anchor.getUTCDate(),
    startParts.h,
    startParts.m,
    0,
    0
  ));

  const dayDelta = (Number(dayOfWeek) - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + dayDelta);

  if (date < anchor) {
    date.setUTCDate(date.getUTCDate() + 7);
  }

  return date;
};

const addMinutes = (date, minutes) => {
  return new Date(date.getTime() + Number(minutes || 0) * 60000);
};

const loadTeacher = async (teacherId) => {
  if (!teacherId) return null;
  return User.findById(teacherId).select('firstName lastName email timezone teacherInfo').lean();
};

const buildAvailabilityBody = ({ slotDoc, teacher, eventId }) => {
  const start = computeRecurringStart(slotDoc?.effectiveFrom, slotDoc?.dayOfWeek, slotDoc?.startTime);
  const startParts = parseTimeParts(slotDoc?.startTime);
  const endParts = parseTimeParts(slotDoc?.endTime);
  if (!start || !startParts || !endParts) return null;

  const startMinutes = startParts.h * 60 + startParts.m;
  const endMinutes = endParts.h * 60 + endParts.m;
  if (endMinutes <= startMinutes) return null;

  const end = addMinutes(start, endMinutes - startMinutes);
  const recurrence = [];

  const dayCode = DAY_CODES[Number(slotDoc?.dayOfWeek)];
  if (!dayCode) return null;

  let rule = `RRULE:FREQ=WEEKLY;BYDAY=${dayCode}`;
  const effectiveTo = toDate(slotDoc?.effectiveTo);
  if (effectiveTo) {
    const until = new Date(Date.UTC(
      effectiveTo.getUTCFullYear(),
      effectiveTo.getUTCMonth(),
      effectiveTo.getUTCDate(),
      23,
      59,
      59,
      0
    ));
    rule += `;UNTIL=${until.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
  }

  recurrence.push(rule);

  const teacherName = [teacher?.firstName, teacher?.lastName].filter(Boolean).join(' ').trim() || 'Teacher';

  return {
    id: eventId,
    summary: `Waraqa Availability (${teacherName})`,
    description: [
      `Type: Weekly availability slot`,
      `Slot ID: ${String(slotDoc?._id || '')}`,
      `Teacher: ${teacherName}`,
      `Window (UTC): ${slotDoc?.startTime || ''} - ${slotDoc?.endTime || ''}`,
    ].join('\n'),
    start: {
      dateTime: start.toISOString(),
      timeZone: 'UTC',
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: 'UTC',
    },
    recurrence,
    colorId: '10',
    transparency: 'transparent',
    reminders: { useDefault: false },
    extendedProperties: {
      private: {
        waraqaAvailabilitySlotId: String(slotDoc?._id || ''),
        waraqaTeacherId: String(slotDoc?.teacherId || ''),
      },
    },
  };
};

const buildUnavailableBody = ({ periodDoc, teacher, eventId }) => {
  const start = toDate(periodDoc?.startDateTime);
  const end = toDate(periodDoc?.endDateTime);
  if (!start || !end || end <= start) return null;

  const teacherName = [teacher?.firstName, teacher?.lastName].filter(Boolean).join(' ').trim() || 'Teacher';

  return {
    id: eventId,
    summary: `[Unavailable] ${teacherName}`,
    description: [
      `Type: Unavailable period`,
      `Period ID: ${String(periodDoc?._id || '')}`,
      `Reason: ${String(periodDoc?.reason || 'personal')}`,
      periodDoc?.description ? `Notes: ${periodDoc.description}` : null,
    ].filter(Boolean).join('\n'),
    start: {
      dateTime: start.toISOString(),
      timeZone: 'UTC',
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: 'UTC',
    },
    colorId: '11',
    transparency: 'opaque',
    reminders: { useDefault: false },
    extendedProperties: {
      private: {
        waraqaUnavailablePeriodId: String(periodDoc?._id || ''),
        waraqaTeacherId: String(periodDoc?.teacherId || ''),
      },
    },
  };
};

const upsertEvent = async ({ calendarId, eventId, body }) => {
  const calendar = getCalendarClient();
  try {
    await calendar.events.patch({
      calendarId,
      eventId,
      requestBody: body,
      sendUpdates: 'none',
    });
  } catch (patchError) {
    if (patchError?.code !== 404) throw patchError;
    await calendar.events.insert({
      calendarId,
      requestBody: body,
      sendUpdates: 'none',
    });
  }
};

const deleteEvent = async ({ calendarId, eventId }) => {
  const calendar = getCalendarClient();
  try {
    await calendar.events.delete({
      calendarId,
      eventId,
      sendUpdates: 'none',
    });
  } catch (err) {
    if (err?.code !== 404) throw err;
  }
};

const syncAvailabilitySlotEvent = async ({ slotDoc, mode = 'upsert' }) => {
  if (!isConfigured()) return { ok: true, skipped: true, reason: 'not-configured' };
  if (!slotDoc?._id || !slotDoc?.teacherId) return { ok: true, skipped: true, reason: 'missing-slot-or-teacher' };

  const teacher = await loadTeacher(slotDoc.teacherId);
  if (!teacher) return { ok: true, skipped: true, reason: 'teacher-not-found' };

  const teacherCalendarId = await ensureTeacherCalendar(teacher);
  if (!teacherCalendarId) return { ok: false, skipped: true, reason: 'teacher-calendar-missing' };

  const eventId = makeAvailabilityEventId(slotDoc._id);
  if (!eventId) return { ok: false, skipped: true, reason: 'invalid-event-id' };

  const shouldDelete = mode === 'delete' || !slotDoc.isActive;
  if (shouldDelete) {
    await deleteEvent({ calendarId: teacherCalendarId, eventId });
    return { ok: true, skipped: false, deleted: true, eventId, teacherCalendarId };
  }

  const body = buildAvailabilityBody({ slotDoc, teacher, eventId });
  if (!body) return { ok: true, skipped: true, reason: 'invalid-slot-body' };

  await upsertEvent({ calendarId: teacherCalendarId, eventId, body });
  return { ok: true, skipped: false, deleted: false, eventId, teacherCalendarId };
};

const syncUnavailablePeriodEvent = async ({ periodDoc, mode = 'upsert' }) => {
  if (!isConfigured()) return { ok: true, skipped: true, reason: 'not-configured' };
  if (!periodDoc?._id || !periodDoc?.teacherId) return { ok: true, skipped: true, reason: 'missing-period-or-teacher' };

  const teacher = await loadTeacher(periodDoc.teacherId);
  if (!teacher) return { ok: true, skipped: true, reason: 'teacher-not-found' };

  const teacherCalendarId = await ensureTeacherCalendar(teacher);
  if (!teacherCalendarId) return { ok: false, skipped: true, reason: 'teacher-calendar-missing' };

  const eventId = makeUnavailableEventId(periodDoc._id);
  if (!eventId) return { ok: false, skipped: true, reason: 'invalid-event-id' };

  const shouldDelete = mode === 'delete' || !periodDoc.isActive || periodDoc.status !== 'approved';
  if (shouldDelete) {
    await deleteEvent({ calendarId: teacherCalendarId, eventId });
    return { ok: true, skipped: false, deleted: true, eventId, teacherCalendarId };
  }

  const body = buildUnavailableBody({ periodDoc, teacher, eventId });
  if (!body) return { ok: true, skipped: true, reason: 'invalid-period-body' };

  await upsertEvent({ calendarId: teacherCalendarId, eventId, body });
  return { ok: true, skipped: false, deleted: false, eventId, teacherCalendarId };
};

module.exports = {
  isConfigured,
  makeAvailabilityEventId,
  makeUnavailableEventId,
  syncAvailabilitySlotEvent,
  syncUnavailablePeriodEvent,
};
