/**
 * Teacher class schedule sync (one-way): Dashboard -> Google Calendar.
 *
 * - One dedicated calendar per teacher for class schedules.
 * - Class instances (single + recurring generated instances) are synced as events.
 * - Updates/cancellations/deletions from dashboard are reflected in Google.
 */

const { google } = require('googleapis');
const moment = require('moment-timezone');
const User = require('../models/User');
const { DEFAULT_TIMEZONE } = require('../utils/timezoneUtils');

const CALENDAR_SCOPE = ['https://www.googleapis.com/auth/calendar'];
const CANCELLED_STATUSES = new Set([
  'cancelled',
  'cancelled_by_teacher',
  'cancelled_by_student',
  'cancelled_by_guardian',
  'cancelled_by_admin',
]);

let cachedCalendarClient = null;

const normalizePrivateKey = (raw) => {
  if (!raw) return '';
  let key = String(raw).trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n');
};

const getConfig = () => {
  return {
    enabled: String(process.env.GOOGLE_CLASS_CALENDAR_SYNC_ENABLED || 'false').toLowerCase() === 'true',
    calendarId: (process.env.GOOGLE_CALENDAR_ID || '').trim(),
    clientEmail: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim(),
    privateKey: normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || ''),
    includeAttendees: String(process.env.GOOGLE_CLASS_CALENDAR_INCLUDE_ATTENDEES || 'false').toLowerCase() === 'true',
  };
};

const isConfigured = () => {
  const cfg = getConfig();
  return Boolean(cfg.enabled && cfg.calendarId && cfg.clientEmail && cfg.privateKey);
};

const getCalendarClient = () => {
  if (cachedCalendarClient) return cachedCalendarClient;
  const cfg = getConfig();
  const auth = new google.auth.JWT({
    email: cfg.clientEmail,
    key: cfg.privateKey,
    scopes: CALENDAR_SCOPE,
  });
  cachedCalendarClient = google.calendar({ version: 'v3', auth });
  return cachedCalendarClient;
};

const makeClassEventId = (classId) => {
  const base = String(classId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!base) return null;
  return `cl${base}`;
};

const teacherCalendarSummary = (teacher) => {
  const name = [teacher?.firstName, teacher?.lastName].filter(Boolean).join(' ').trim() || 'Teacher';
  return `Waraqa Classes - ${name}`;
};

const getTeacherCalendarField = (teacher) => {
  return teacher?.teacherInfo?.classCalendarId || null;
};

const setTeacherCalendarField = async (teacherId, calendarId) => {
  await User.updateOne(
    { _id: teacherId },
    {
      $set: {
        'teacherInfo.classCalendarId': calendarId,
        'teacherInfo.classCalendarProvisionedAt': new Date(),
      },
    }
  );
};

const ensureTeacherCalendar = async (teacher) => {
  if (!teacher?._id) return null;
  const calendar = getCalendarClient();
  const existingId = getTeacherCalendarField(teacher);

  if (existingId) {
    try {
      await calendar.calendars.get({ calendarId: existingId });
      return existingId;
    } catch (err) {
      if (err?.code !== 404) {
        throw err;
      }
    }
  }

  const timezone = teacher.timezone || DEFAULT_TIMEZONE;
  const created = await calendar.calendars.insert({
    requestBody: {
      summary: teacherCalendarSummary(teacher),
      timeZone: timezone,
      description: 'Auto-managed by Waraqa dashboard. Edit classes in dashboard.',
    },
  });

  const calendarId = created?.data?.id;
  if (!calendarId) {
    throw new Error('Failed to create teacher calendar');
  }

  // Share read-only with teacher and admin dashboard account.
  const aclTargets = new Set();
  if (teacher.email) {
    aclTargets.add(String(teacher.email).trim().toLowerCase());
  }

  const adminCalendarEmail = String(process.env.GOOGLE_CALENDAR_ID || '').trim().toLowerCase();
  if (adminCalendarEmail.includes('@')) {
    aclTargets.add(adminCalendarEmail);
  }

  for (const email of aclTargets) {
    try {
      await calendar.acl.insert({
        calendarId,
        sendNotifications: true,
        requestBody: {
          role: 'reader',
          scope: {
            type: 'user',
            value: email,
          },
        },
      });
    } catch (aclError) {
      if (aclError?.code === 409) continue;
      // Non-fatal: calendar creation should still succeed even if ACL invite fails.
      console.warn('[teacherClassCalendarSync] Failed to add ACL for calendar share:', aclError.message || aclError);
    }
  }

  await setTeacherCalendarField(teacher._id, calendarId);
  return calendarId;
};

const buildClassSummary = ({ classDoc, teacher }) => {
  const studentName = classDoc?.student?.studentName || 'Student';
  const teacherName = [teacher?.firstName, teacher?.lastName].filter(Boolean).join(' ').trim() || 'Teacher';
  const subject = classDoc?.subject || classDoc?.title || 'Class';
  const status = String(classDoc?.status || '').toLowerCase();
  const prefix = CANCELLED_STATUSES.has(status) ? '[Cancelled] ' : '';
  return `${prefix}${studentName} - ${subject} (${teacherName})`;
};

const buildClassDescription = ({ classDoc, teacher, guardian }) => {
  const lines = [];
  lines.push(`Class ID: ${String(classDoc?._id || '')}`);
  lines.push(`Status: ${classDoc?.status || 'scheduled'}`);
  lines.push(`Subject: ${classDoc?.subject || ''}`);
  lines.push(`Duration: ${Number(classDoc?.duration || 0)} minutes`);

  if (teacher) {
    lines.push(`Teacher: ${[teacher.firstName, teacher.lastName].filter(Boolean).join(' ').trim()}`);
    if (teacher.email) lines.push(`Teacher Email: ${teacher.email}`);
  }

  if (classDoc?.student?.studentName) {
    lines.push(`Student: ${classDoc.student.studentName}`);
  }

  if (guardian) {
    lines.push(`Guardian: ${[guardian.firstName, guardian.lastName].filter(Boolean).join(' ').trim()}`);
    if (guardian.email) lines.push(`Guardian Email: ${guardian.email}`);
  }

  if (classDoc?.meetingLink) {
    lines.push(`Meeting Link: ${classDoc.meetingLink}`);
  }

  const report = classDoc?.classReport;
  if (report?.submittedAt) {
    lines.push('');
    lines.push('Class Report');
    if (report.attendance) lines.push(`- Attendance: ${report.attendance}`);
    if (report.lessonTopic) lines.push(`- Lesson Topic: ${report.lessonTopic}`);
    if (report.newAssignment) lines.push(`- Assignment: ${report.newAssignment}`);
    if (report.teacherNotes) lines.push(`- Teacher Notes: ${report.teacherNotes}`);
    if (report.supervisorNotes) lines.push(`- Supervisor Notes: ${report.supervisorNotes}`);
  }

  return lines.join('\n');
};

const buildAttendees = ({ classDoc, guardian }) => {
  const cfg = getConfig();
  if (!cfg.includeAttendees) return undefined;

  const unique = new Map();
  const push = (email) => {
    if (!email) return;
    const value = String(email).trim().toLowerCase();
    if (!value) return;
    if (!unique.has(value)) unique.set(value, value);
  };

  push(guardian?.email);
  return Array.from(unique.values()).map((email) => ({ email }));
};

const resolveColorId = (status) => {
  const key = String(status || '').toLowerCase();
  if (CANCELLED_STATUSES.has(key)) return '11'; // red
  if (key === 'attended' || key === 'completed') return '2'; // green
  if (key === 'missed_by_student' || key === 'no_show_both') return '5'; // yellow
  return '9'; // blue
};

const toDate = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const buildEventBody = ({ classDoc, teacher, guardian, eventId }) => {
  const timezone = classDoc.timezone || teacher?.timezone || DEFAULT_TIMEZONE;
  const start = toDate(classDoc.scheduledDate);
  const duration = Number(classDoc.duration || 0);
  const end = start ? new Date(start.getTime() + duration * 60000) : null;
  if (!start || !end) return null;

  const attendees = buildAttendees({ classDoc, guardian });

  const body = {
    id: eventId,
    summary: buildClassSummary({ classDoc, teacher }),
    description: buildClassDescription({ classDoc, teacher, guardian }),
    location: classDoc.meetingLink || 'Online',
    start: {
      dateTime: moment(start).tz(timezone).format(),
      timeZone: timezone,
    },
    end: {
      dateTime: moment(end).tz(timezone).format(),
      timeZone: timezone,
    },
    colorId: resolveColorId(classDoc.status),
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 },
      ],
    },
    extendedProperties: {
      private: {
        waraqaClassId: String(classDoc._id),
        waraqaTeacherId: String(classDoc.teacher),
        waraqaGuardianId: String(classDoc?.student?.guardianId || ''),
      },
    },
  };

  if (attendees && attendees.length) {
    body.attendees = attendees;
  }

  return body;
};

const loadTeacherAndGuardian = async (classDoc) => {
  const [teacher, guardian] = await Promise.all([
    User.findById(classDoc.teacher).select('firstName lastName email timezone teacherInfo').lean(),
    classDoc?.student?.guardianId
      ? User.findById(classDoc.student.guardianId).select('firstName lastName email').lean()
      : Promise.resolve(null),
  ]);

  return { teacher, guardian };
};

const syncClassEvent = async ({ classDoc, mode = 'upsert' }) => {
  try {
    if (!isConfigured()) {
      return { ok: true, skipped: true, reason: 'not-configured' };
    }

    if (!classDoc?._id || !classDoc?.teacher) {
      return { ok: true, skipped: true, reason: 'missing-class-or-teacher' };
    }

    // Skip recurring template rows. We sync concrete class instances only.
    if (String(classDoc.status || '').toLowerCase() === 'pattern') {
      return { ok: true, skipped: true, reason: 'pattern-template' };
    }

    const { teacher, guardian } = await loadTeacherAndGuardian(classDoc);
    if (!teacher) {
      return { ok: true, skipped: true, reason: 'teacher-not-found' };
    }

    const calendar = getCalendarClient();
    const teacherCalendarId = await ensureTeacherCalendar(teacher);
    if (!teacherCalendarId) {
      return { ok: false, skipped: true, reason: 'teacher-calendar-missing' };
    }

    const eventId = classDoc?.calendar?.googleEventId || makeClassEventId(classDoc._id);
    if (!eventId) {
      return { ok: false, skipped: true, reason: 'invalid-event-id' };
    }

    if (mode === 'delete') {
      try {
        await calendar.events.delete({
          calendarId: teacherCalendarId,
          eventId,
          sendUpdates: 'none',
        });
      } catch (err) {
        if (err?.code !== 404) throw err;
      }
      return { ok: true, skipped: false, eventId, teacherCalendarId, deleted: true };
    }

    const body = buildEventBody({ classDoc, teacher, guardian, eventId });
    if (!body) {
      return { ok: true, skipped: true, reason: 'invalid-class-dates' };
    }

    try {
      await calendar.events.patch({
        calendarId: teacherCalendarId,
        eventId,
        requestBody: body,
        sendUpdates: getConfig().includeAttendees ? 'all' : 'none',
      });
    } catch (patchError) {
      if (patchError?.code !== 404) throw patchError;
      await calendar.events.insert({
        calendarId: teacherCalendarId,
        requestBody: body,
        sendUpdates: getConfig().includeAttendees ? 'all' : 'none',
      });
    }

    return { ok: true, skipped: false, eventId, teacherCalendarId, deleted: false };
  } catch (error) {
    const details = error?.errors?.[0]?.message || error?.message || 'Class calendar sync failed';
    const wrapped = new Error(details);
    wrapped.cause = error;
    throw wrapped;
  }
};

module.exports = {
  isConfigured,
  syncClassEvent,
  makeClassEventId,
  ensureTeacherCalendar,
  getCalendarClient,
};
