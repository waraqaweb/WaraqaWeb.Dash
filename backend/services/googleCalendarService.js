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

const extractSummaryIdentifier = (summary) => {
  const raw = String(summary || '').trim();
  if (!raw) return '';
  const idx = raw.indexOf(':');
  if (idx === -1) return '';
  return raw.slice(idx + 1).trim().toLowerCase();
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

const findSameTimeExistingEvent = async ({ calendar, calendarId, meeting }) => {
  const meetingStart = new Date(meeting.scheduledStart);
  const meetingEnd = new Date(meeting.scheduledEnd);
  if (Number.isNaN(meetingStart.getTime()) || Number.isNaN(meetingEnd.getTime())) {
    return null;
  }

  // Narrow search window to nearby events then match exact time with a small
  // tolerance to account for minor serialization differences.
  const windowStart = new Date(meetingStart.getTime() - 5 * 60 * 1000);
  const windowEnd = new Date(meetingEnd.getTime() + 5 * 60 * 1000);
  const response = await calendar.events.list({
    calendarId,
    timeMin: windowStart.toISOString(),
    timeMax: windowEnd.toISOString(),
    singleEvents: true,
    showDeleted: false,
    maxResults: 25,
    orderBy: 'startTime',
  });

  const items = Array.isArray(response?.data?.items) ? response.data.items : [];
  const meetingIdString = String(meeting._id || '');

  const matched = items.find((event) => {
    if (!event || event.status === 'cancelled') return false;

    const startRaw = event.start?.dateTime || event.start?.date;
    const endRaw = event.end?.dateTime || event.end?.date;
    if (!startRaw || !endRaw) return false;

    const eventStart = new Date(startRaw);
    const eventEnd = new Date(endRaw);
    if (Number.isNaN(eventStart.getTime()) || Number.isNaN(eventEnd.getTime())) return false;

    const startDiffMs = Math.abs(eventStart.getTime() - meetingStart.getTime());
    const endDiffMs = Math.abs(eventEnd.getTime() - meetingEnd.getTime());
    const isTimeMatch = startDiffMs <= 60 * 1000 && endDiffMs <= 60 * 1000;
    if (!isTimeMatch) return false;

    const mappedMeetingId = event.extendedProperties?.private?.waraqaMeetingId;
    if (mappedMeetingId && mappedMeetingId !== meetingIdString) {
      return false;
    }

    return true;
  });

  return matched || null;
};

const findExistingEventBySummaryIdentifier = async ({ calendar, calendarId, meeting }) => {
  const targetSummary = getSummary(meeting);
  const targetIdentifier = extractSummaryIdentifier(targetSummary);
  if (!targetIdentifier) return null;

  const types = Object.values(MEETING_TYPE_LABELS).join(' OR ');
  const query = `${targetIdentifier} (${types})`;
  const now = new Date();
  const farPast = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  let pageToken;
  for (let page = 0; page < 8; page += 1) {
    const response = await calendar.events.list({
      calendarId,
      q: query,
      timeMin: farPast.toISOString(),
      timeMax: farFuture.toISOString(),
      singleEvents: true,
      showDeleted: false,
      maxResults: 250,
      pageToken,
      orderBy: 'startTime',
    });

    const items = Array.isArray(response?.data?.items) ? response.data.items : [];
    const meetingIdString = String(meeting._id || '');

    const match = items.find((event) => {
      if (!event || event.status === 'cancelled') return false;

      const eventIdentifier = extractSummaryIdentifier(event.summary || '');
      if (!eventIdentifier || eventIdentifier !== targetIdentifier) return false;

      const mappedMeetingId = event.extendedProperties?.private?.waraqaMeetingId;
      if (mappedMeetingId && mappedMeetingId !== meetingIdString) {
        return false;
      }

      return true;
    });

    if (match) return match;

    pageToken = response?.data?.nextPageToken;
    if (!pageToken) break;
  }

  return null;
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

  let eventId = meeting.calendar?.googleEventId || getEventIdForMeeting(meeting._id);
  if (!eventId) {
    return { ok: false, skipped: true, reason: 'invalid-event-id' };
  }

  const { calendarId } = getConfig();
  const calendar = getCalendarClient();

  // For cancelled meetings, attempt to mark existing event cancelled. If not
  // found, skip quietly so cancellation does not create a new event.
  const isCancelled = mode === 'cancel' || meeting.status === MEETING_STATUSES.CANCELLED;
  if (!isCancelled && !meeting.calendar?.googleEventId) {
    try {
      const byIdentifier = await findExistingEventBySummaryIdentifier({ calendar, calendarId, meeting });
      if (byIdentifier?.id) {
        eventId = byIdentifier.id;
      }
    } catch (lookupError) {
      console.warn('[googleCalendarService] Identifier dedup lookup failed:', lookupError.message || lookupError);
    }

    try {
      const existing = await findSameTimeExistingEvent({ calendar, calendarId, meeting });
      if (existing?.id) {
        eventId = existing.id;
      }
    } catch (lookupError) {
      console.warn('[googleCalendarService] Same-time dedup lookup failed:', lookupError.message || lookupError);
    }
  }

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
