/**
 * Google Calendar sync for dashboard meetings.
 *
 * Uses a deterministic event id derived from Meeting._id so inserts are
 * idempotent and repeated syncs update the same event instead of duplicating.
 */

const { google } = require('googleapis');
const moment = require('moment-timezone');
const { MEETING_TYPES, MEETING_STATUSES } = require('../constants/meetingConstants');
const { DEFAULT_TIMEZONE } = require('../utils/timezoneUtils');

const CALENDAR_SCOPE = ['https://www.googleapis.com/auth/calendar'];
const MEETING_TYPE_LABELS = {
  [MEETING_TYPES.NEW_STUDENT_EVALUATION]: 'Waraqa Evaluation Session',
  [MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP]: 'Waraqa Follow-up Meeting',
  [MEETING_TYPES.TEACHER_SYNC]: 'Waraqa Teacher Sync',
  [MEETING_TYPES.NEW_TEACHER_INTERVIEW]: 'Waraqa New Teacher Interview'
};

let cachedAuth = null;
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
  const calendarId = (process.env.GOOGLE_CALENDAR_ID || '').trim();
  const clientEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const privateKey = normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '');
  return { calendarId, clientEmail, privateKey };
};

const isConfigured = () => {
  const cfg = getConfig();
  return Boolean(cfg.calendarId && cfg.clientEmail && cfg.privateKey);
};

const getEventIdForMeeting = (meetingId) => {
  const base = String(meetingId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!base) return null;
  // Google event id must be lowercase letters/digits, and length >= 5.
  return `m${base}`;
};

const getCalendarClient = () => {
  if (cachedCalendarClient) return cachedCalendarClient;

  const { clientEmail, privateKey } = getConfig();
  cachedAuth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: CALENDAR_SCOPE,
  });

  cachedCalendarClient = google.calendar({
    version: 'v3',
    auth: cachedAuth,
  });

  return cachedCalendarClient;
};

const getSummary = (meeting) => {
  const typeLabel = MEETING_TYPE_LABELS[meeting.meetingType] || 'Waraqa Meeting';
  const contactName =
    meeting.attendees?.teacherName
    || meeting.bookingPayload?.guardianName
    || meeting.attendees?.guardianName
    || '';
  return contactName ? `${typeLabel}: ${contactName}` : typeLabel;
};

const buildDescription = (meeting, admin) => {
  const lines = [];

  if (meeting.bookingPayload?.guardianName) {
    lines.push(`Guardian: ${meeting.bookingPayload.guardianName}`);
  }

  if (meeting.bookingPayload?.guardianEmail) {
    lines.push(`Guardian Email: ${meeting.bookingPayload.guardianEmail}`);
  }

  if (meeting.bookingPayload?.guardianPhone) {
    lines.push(`Guardian Phone: ${meeting.bookingPayload.guardianPhone}`);
  }

  if (meeting.attendees?.teacherName) {
    lines.push(`Teacher: ${meeting.attendees.teacherName}`);
  }

  if (Array.isArray(meeting.bookingPayload?.students) && meeting.bookingPayload.students.length) {
    const studentNames = meeting.bookingPayload.students
      .map((student) => student.studentName)
      .filter(Boolean)
      .join(', ');
    if (studentNames) {
      lines.push(`Students: ${studentNames}`);
    }
  }

  if (meeting.bookingPayload?.notes) {
    lines.push(`Notes: ${meeting.bookingPayload.notes}`);
  }

  if (meeting.meetingType) {
    lines.push(`Meeting Type: ${meeting.meetingType}`);
  }

  const meetingLink =
    meeting.meetingLinkSnapshot
    || admin?.adminSettings?.meetingLink
    || admin?.teacherInfo?.googleMeetLink
    || '';

  if (meetingLink) {
    lines.push(`Meeting Link: ${meetingLink}`);
  }

  lines.push(`Waraqa Meeting ID: ${String(meeting._id)}`);
  return lines.join('\n');
};

const buildAttendees = (meeting) => {
  const unique = new Map();
  const pushEmail = (email) => {
    if (!email) return;
    const trimmed = String(email).trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (unique.has(key)) return;
    unique.set(key, trimmed);
  };

  pushEmail(meeting.bookingPayload?.guardianEmail);
  if (Array.isArray(meeting.attendees?.additionalEmails)) {
    meeting.attendees.additionalEmails.forEach(pushEmail);
  }

  return Array.from(unique.values()).map((email) => ({ email }));
};

const shouldAttachAttendees = () => {
  // Service accounts on consumer calendars cannot invite attendees unless
  // domain-wide delegation is configured on a Google Workspace domain.
  // Default disabled to keep sync working for standard setups.
  return String(process.env.GOOGLE_CALENDAR_INCLUDE_ATTENDEES || 'false').toLowerCase() === 'true';
};

const buildEventRequestBody = ({ meeting, admin, eventId, isCancelled = false }) => {
  const timezone =
    meeting.timezone
    || meeting.bookingPayload?.timezone
    || admin?.adminSettings?.meetingTimezone
    || admin?.timezone
    || DEFAULT_TIMEZONE;

  const start = moment(meeting.scheduledStart).tz(timezone);
  const end = moment(meeting.scheduledEnd).tz(timezone);
  const meetingLink =
    meeting.meetingLinkSnapshot
    || admin?.adminSettings?.meetingLink
    || admin?.teacherInfo?.googleMeetLink
    || '';

  const body = {
    id: eventId,
    status: isCancelled ? 'cancelled' : 'confirmed',
    summary: getSummary(meeting),
    description: buildDescription(meeting, admin),
    location: meetingLink || 'Online',
    start: {
      dateTime: start.format(),
      timeZone: timezone,
    },
    end: {
      dateTime: end.format(),
      timeZone: timezone,
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 },
        { method: 'email', minutes: 60 * 24 },
      ],
    },
    extendedProperties: {
      private: {
        waraqaMeetingId: String(meeting._id),
        meetingType: String(meeting.meetingType || ''),
      },
    },
  };

  if (shouldAttachAttendees()) {
    body.attendees = buildAttendees(meeting);
  }

  return body;
};

const syncMeetingEvent = async ({ meeting, admin = null, mode = 'upsert' }) => {
  if (!meeting?._id) {
    return { ok: false, skipped: true, reason: 'missing-meeting-id' };
  }

  if (!isConfigured()) {
    return { ok: true, skipped: true, reason: 'missing-config' };
  }

  const eventId = meeting.calendar?.googleEventId || getEventIdForMeeting(meeting._id);
  if (!eventId) {
    return { ok: false, skipped: true, reason: 'invalid-event-id' };
  }

  const { calendarId } = getConfig();
  const calendar = getCalendarClient();

  // For cancelled meetings, attempt to mark existing event cancelled. If not
  // found, skip quietly so cancellation does not create a new event.
  const isCancelled = mode === 'cancel' || meeting.status === MEETING_STATUSES.CANCELLED;
  const requestBody = buildEventRequestBody({
    meeting,
    admin,
    eventId,
    isCancelled,
  });

  try {
    if (isCancelled) {
      await calendar.events.patch({
        calendarId,
        eventId,
        requestBody,
        sendUpdates: shouldAttachAttendees() ? 'all' : 'none',
      });
    } else {
      try {
        await calendar.events.patch({
          calendarId,
          eventId,
          requestBody,
          sendUpdates: shouldAttachAttendees() ? 'all' : 'none',
        });
      } catch (patchError) {
        if (patchError?.code !== 404) {
          throw patchError;
        }
        await calendar.events.insert({
          calendarId,
          requestBody,
          sendUpdates: shouldAttachAttendees() ? 'all' : 'none',
        });
      }
    }

    return {
      ok: true,
      skipped: false,
      eventId,
    };
  } catch (error) {
    if (isCancelled && error?.code === 404) {
      return {
        ok: true,
        skipped: true,
        reason: 'event-not-found-on-cancel',
        eventId,
      };
    }

    const details = error?.errors?.[0]?.message || error?.message || 'Google Calendar sync failed';
    const wrapped = new Error(details);
    wrapped.cause = error;
    throw wrapped;
  }
};

module.exports = {
  isConfigured,
  getEventIdForMeeting,
  syncMeetingEvent,
};
