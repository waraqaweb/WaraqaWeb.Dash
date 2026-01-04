/**
 * Meeting Service - orchestrates admin availability, booking, and reporting
 * for evaluation / guardian follow-up / teacher sync meetings.
 */

const moment = require('moment-timezone');
const mongoose = require('mongoose');
const Meeting = require('../models/Meeting');
const MeetingAvailabilitySlot = require('../models/MeetingAvailabilitySlot');
const MeetingUnavailablePeriod = require('../models/MeetingUnavailablePeriod');
const SystemVacation = require('../models/SystemVacation');
const User = require('../models/User');
const notificationService = require('./notificationService');
const {
  MEETING_TYPES,
  MEETING_STATUSES,
  MEETING_SOURCES,
  MEETING_DEFAULT_DURATIONS,
  MEETING_COLORS
} = require('../constants/meetingConstants');
const {
  DEFAULT_TIMEZONE,
  convertToUTC,
  convertFromUTC
} = require('../utils/timezoneUtils');

const BLOCKING_STATUSES = [MEETING_STATUSES.SCHEDULED, MEETING_STATUSES.NO_SHOW];
const MAX_LOOKAHEAD_DAYS = 35;
const DEFAULT_LOOKAHEAD_DAYS = 21;
const MIN_DURATION_MINUTES = 15;
const ADMIN_CALENDAR_EMAIL = 'waraqainc@gmail.com';

const isMeetingsEnabled = (admin) => {
  // Default true if missing.
  return admin?.adminSettings?.meetingsEnabled !== false;
};

const fetchSystemVacations = async ({ rangeStart, rangeEnd }) => {
  return SystemVacation.find({
    isActive: true,
    startDate: { $lt: rangeEnd },
    endDate: { $gt: rangeStart }
  }).select('startDate endDate name message timezone');
};

const fetchMeetingTimeOff = async ({ adminId, rangeStart, rangeEnd }) => {
  return MeetingUnavailablePeriod.find({
    adminId,
    isActive: true,
    startDateTime: { $lt: rangeEnd },
    endDateTime: { $gt: rangeStart }
  }).sort({ startDateTime: 1 });
};

const createError = (status, message, meta = {}) => {
  const err = new Error(message);
  err.status = status;
  err.meta = meta;
  return err;
};

const toObjectId = (value) => {
  if (!value) return undefined;
  if (mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return undefined;
};

const ensureMeetingType = (meetingType) => {
  if (!Object.values(MEETING_TYPES).includes(meetingType)) {
    throw createError(400, 'Unsupported meeting type', { meetingType });
  }
};

const getMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

const formatMonthKey = (date, timezone = DEFAULT_TIMEZONE) => {
  return moment.tz(date, timezone).format('YYYY-MM');
};

const resolveAdmin = async (adminId, { meetingType } = {}) => {
  let admin;

  if (adminId) {
    admin = await User.findById(adminId);
    if (admin) return admin;
  }

  const pickAdminFromSlots = async (match = {}) => {
    const slotOwner = await MeetingAvailabilitySlot.findOne({ isActive: true, ...match })
      .sort({ updatedAt: -1 })
      .populate('adminId');
    const ownerRecord = slotOwner?.adminId;
    if (ownerRecord && ownerRecord.role === 'admin' && ownerRecord.isActive) {
      return ownerRecord;
    }
    return null;
  };

  if (!admin && meetingType) {
    admin = await pickAdminFromSlots({ meetingType });
  }

  if (!admin) {
    admin = await pickAdminFromSlots();
  }

  if (!admin) {
    admin = await User.findOne({
      role: 'admin',
      isActive: true,
      $or: [
        { 'adminSettings.allowPublicEvaluations': { $exists: false } },
        { 'adminSettings.allowPublicEvaluations': { $ne: false } }
      ]
    }).sort({ createdAt: 1 })
      || await User.findOne({ role: 'admin', isActive: true }).sort({ createdAt: 1 });
  }

  if (!admin) {
    throw createError(404, 'Admin account not found');
  }

  return admin;
};

const getBufferMinutes = (admin, meetingType) => {
  const settings = admin.adminSettings || {};
  const fallback = settings.defaultBufferMinutes ?? 5;
  switch (meetingType) {
    case MEETING_TYPES.NEW_STUDENT_EVALUATION:
      return settings.evaluationBufferMinutes ?? fallback;
    case MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP:
      return settings.guardianBufferMinutes ?? fallback;
    case MEETING_TYPES.TEACHER_SYNC:
      return settings.teacherBufferMinutes ?? fallback;
    default:
      return fallback;
  }
};

const clampRange = (rangeStart, rangeEnd) => {
  const start = rangeStart ? new Date(rangeStart) : new Date();
  const maxEnd = moment(start).add(MAX_LOOKAHEAD_DAYS, 'days').toDate();
  const end = rangeEnd ? new Date(rangeEnd) : moment(start).add(DEFAULT_LOOKAHEAD_DAYS, 'days').toDate();
  return {
    rangeStart: start,
    rangeEnd: end > maxEnd ? maxEnd : end
  };
};

const fetchBusyMeetings = async ({ adminId, meetingType, rangeStart, rangeEnd }) => {
  return Meeting.find({
    adminId,
    meetingType,
    status: { $in: BLOCKING_STATUSES },
    scheduledStart: { $lt: rangeEnd },
    scheduledEnd: { $gt: rangeStart }
  }).select('scheduledStart scheduledEnd buffers');
};

const subtractIntervals = (slotStart, slotEnd, busyIntervals = []) => {
  if (!busyIntervals.length) {
    return [{ start: slotStart, end: slotEnd }];
  }
  const sorted = busyIntervals
    .map((interval) => ({
      start: new Date(Math.max(slotStart.getTime(), interval.start.getTime())),
      end: new Date(Math.min(slotEnd.getTime(), interval.end.getTime()))
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);

  if (!sorted.length) {
    return [{ start: slotStart, end: slotEnd }];
  }

  const available = [];
  let cursor = slotStart;

  for (const interval of sorted) {
    if (interval.start > cursor) {
      available.push({ start: cursor, end: interval.start });
    }
    if (interval.end > cursor) {
      cursor = interval.end;
    }
    if (cursor >= slotEnd) {
      break;
    }
  }

  if (cursor < slotEnd) {
    available.push({ start: cursor, end: slotEnd });
  }

  return available.filter((segment) => segment.end > segment.start);
};

const slotMatchesDate = (slot, dateInSlotTz) => {
  return dateInSlotTz.day() === slot.dayOfWeek;
};

const materializeSlotWindow = (slot, referenceDate) => {
  const tz = slot.timezone || DEFAULT_TIMEZONE;
  const startParts = slot.startTime.split(':').map(Number);
  const endParts = slot.endTime.split(':').map(Number);

  const slotMomentStart = moment.tz(referenceDate, tz)
    .hour(startParts[0])
    .minute(startParts[1])
    .second(0)
    .millisecond(0);

  const slotMomentEnd = moment.tz(referenceDate, tz)
    .hour(endParts[0])
    .minute(endParts[1])
    .second(0)
    .millisecond(0);

  const slotStartUtc = slotMomentStart.clone().tz('UTC').toDate();
  const slotEndUtc = slotMomentEnd.clone().tz('UTC').toDate();

  return { slotStartUtc, slotEndUtc };
};

const computeAvailabilityWindows = async ({
  admin,
  meetingType,
  rangeStart,
  rangeEnd,
  viewerTimezone,
  minimumDuration
}) => {
  ensureMeetingType(meetingType);
  if (!isMeetingsEnabled(admin)) {
    return [];
  }
  const adminId = admin._id;
  const timezone = viewerTimezone || admin.adminSettings?.meetingTimezone || admin.timezone || DEFAULT_TIMEZONE;
  const clamps = clampRange(rangeStart, rangeEnd);
  const scopedStart = clamps.rangeStart;
  const scopedEnd = clamps.rangeEnd;
  const minDuration = Math.max(minimumDuration || MEETING_DEFAULT_DURATIONS[meetingType] || MIN_DURATION_MINUTES, MIN_DURATION_MINUTES);
  const buffer = getBufferMinutes(admin, meetingType);

  const slots = await MeetingAvailabilitySlot.find({
    adminId,
    meetingType,
    isActive: true,
    $or: [
      { effectiveTo: null },
      { effectiveTo: { $gte: scopedStart } }
    ]
  }).sort({ dayOfWeek: 1, startTime: 1 });

  if (!slots.length) {
    return [];
  }

  const [busyMeetings, systemVacations, meetingTimeOff] = await Promise.all([
    fetchBusyMeetings({ adminId, meetingType, rangeStart: scopedStart, rangeEnd: scopedEnd }),
    fetchSystemVacations({ rangeStart: scopedStart, rangeEnd: scopedEnd }),
    fetchMeetingTimeOff({ adminId, rangeStart: scopedStart, rangeEnd: scopedEnd })
  ]);

  const windows = [];
  const cursor = moment(scopedStart).startOf('day');
  const endCursor = moment(scopedEnd).endOf('day');

  while (cursor <= endCursor) {
    const referenceDate = cursor.clone();
    for (const slot of slots) {
      const dateInSlotTz = referenceDate.clone().tz(slot.timezone || DEFAULT_TIMEZONE);
      if (!slotMatchesDate(slot, dateInSlotTz)) continue;

      const { slotStartUtc, slotEndUtc } = materializeSlotWindow(slot, dateInSlotTz);
      if (slotEndUtc <= scopedStart || slotStartUtc >= scopedEnd) {
        continue;
      }

      const overlappingMeetings = busyMeetings
        .filter((meeting) => meeting.scheduledStart < slotEndUtc && meeting.scheduledEnd > slotStartUtc)
        .map((meeting) => ({
          start: new Date(meeting.scheduledStart.getTime() - buffer * 60000),
          end: new Date(meeting.scheduledEnd.getTime() + buffer * 60000)
        }));

      const overlappingVacations = (systemVacations || [])
        .filter((vac) => vac.startDate < slotEndUtc && vac.endDate > slotStartUtc)
        .map((vac) => ({
          start: vac.startDate,
          end: vac.endDate
        }));

      const overlappingTimeOff = (meetingTimeOff || [])
        .filter((period) => period.startDateTime < slotEndUtc && period.endDateTime > slotStartUtc)
        .map((period) => ({
          start: period.startDateTime,
          end: period.endDateTime
        }));

      const freeSegments = subtractIntervals(
        slotStartUtc,
        slotEndUtc,
        [...overlappingMeetings, ...overlappingVacations, ...overlappingTimeOff]
      )
        .filter((segment) => segment.end - segment.start >= minDuration * 60000);

      for (const segment of freeSegments) {
        windows.push({
          startUtc: segment.start,
          endUtc: segment.end,
          start: convertFromUTC(segment.start, timezone),
          end: convertFromUTC(segment.end, timezone),
          timezone,
          meetingType
        });
      }
    }
    cursor.add(1, 'day');
  }

  return windows.sort((a, b) => a.startUtc - b.startUtc);
};

const hasSlotCoverage = ({ slot, adminTimezone, startUtc, endUtc }) => {
  const tz = slot.timezone || adminTimezone || DEFAULT_TIMEZONE;
  const slotStartMinutes = getMinutes(slot.startTime);
  const slotEndMinutes = getMinutes(slot.endTime);

  const startInSlotTz = moment(startUtc).tz(tz);
  const endInSlotTz = moment(endUtc).tz(tz);

  if (startInSlotTz.day() !== slot.dayOfWeek || endInSlotTz.day() !== slot.dayOfWeek) {
    return false;
  }

  const meetingStartMinutes = startInSlotTz.hour() * 60 + startInSlotTz.minute();
  const meetingEndMinutes = endInSlotTz.hour() * 60 + endInSlotTz.minute();

  return meetingStartMinutes >= slotStartMinutes && meetingEndMinutes <= slotEndMinutes;
};

const assertSlotAvailability = async ({ admin, meetingType, startUtc, endUtc }) => {
  ensureMeetingType(meetingType);
  if (!isMeetingsEnabled(admin)) {
    throw createError(400, 'Admin is not accepting meetings right now');
  }
  const adminId = admin._id;
  const adminTimezone = admin.adminSettings?.meetingTimezone || admin.timezone || DEFAULT_TIMEZONE;
  const slots = await MeetingAvailabilitySlot.find({
    adminId,
    meetingType,
    isActive: true
  });

  const coveringSlot = slots.find((slot) => hasSlotCoverage({ slot, adminTimezone, startUtc, endUtc }));
  if (!coveringSlot) {
    throw createError(400, 'Requested time is outside admin availability');
  }

  const buffer = getBufferMinutes(admin, meetingType);
  const blockingMeeting = await Meeting.findOne({
    adminId,
    meetingType,
    status: { $ne: MEETING_STATUSES.CANCELLED },
    scheduledStart: { $lt: new Date(endUtc.getTime() + buffer * 60000) },
    scheduledEnd: { $gt: new Date(startUtc.getTime() - buffer * 60000) }
  });

  if (blockingMeeting) {
    throw createError(409, 'Requested time overlaps another meeting', { conflictId: blockingMeeting._id });
  }

  const [systemVacation, timeOff] = await Promise.all([
    SystemVacation.findOne({
      isActive: true,
      startDate: { $lt: endUtc },
      endDate: { $gt: startUtc }
    }).select('_id name startDate endDate'),
    MeetingUnavailablePeriod.findOne({
      adminId,
      isActive: true,
      startDateTime: { $lt: endUtc },
      endDateTime: { $gt: startUtc }
    }).select('_id startDateTime endDateTime description')
  ]);

  if (systemVacation) {
    throw createError(400, 'Requested time is blocked due to a public vacation', { vacationId: systemVacation._id });
  }

  if (timeOff) {
    throw createError(400, 'Requested time is blocked (admin time off)', { timeOffId: timeOff._id });
  }

  return coveringSlot;
};

const computeDurationMinutes = (meetingType, students = []) => {
  ensureMeetingType(meetingType);
  if (meetingType === MEETING_TYPES.NEW_STUDENT_EVALUATION) {
    const count = Math.max(students.length || 1, 1);
    return count * MEETING_DEFAULT_DURATIONS[meetingType];
  }
  return MEETING_DEFAULT_DURATIONS[meetingType] || 30;
};

const enforceGuardianMonthlyLimit = async ({ guardianId, studentId, meetingType, monthKey }) => {
  if (!guardianId || !studentId) return;
  const query = {
    guardianId,
    meetingType,
    status: { $ne: MEETING_STATUSES.CANCELLED },
    'quotaKeys.monthKey': monthKey,
    'bookingPayload.students.studentId': studentId
  };
  const existing = await Meeting.countDocuments(query);
  if (existing >= 1) {
    throw createError(400, 'Monthly follow-up limit reached for this student', { studentId, monthKey });
  }
};

const buildCalendarLinks = (meeting, admin) => {
  const summary = {
    [MEETING_TYPES.NEW_STUDENT_EVALUATION]: 'Waraqa Evaluation Session',
    [MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP]: 'Waraqa Follow-up Meeting',
    [MEETING_TYPES.TEACHER_SYNC]: 'Waraqa Progress Sync'
  }[meeting.meetingType] || 'Meeting';

  const descriptionParts = [];
  if (meeting.bookingPayload?.guardianName) {
    descriptionParts.push(`Guardian: ${meeting.bookingPayload.guardianName}`);
  }
  if (meeting.bookingPayload?.students?.length) {
    const names = meeting.bookingPayload.students.map((s) => s.studentName).join(', ');
    descriptionParts.push(`Students: ${names}`);
  }
  if (meeting.bookingPayload?.notes) {
    descriptionParts.push(`Notes: ${meeting.bookingPayload.notes}`);
  }

  const meetingLink = admin.adminSettings?.meetingLink || admin.teacherInfo?.googleMeetLink || meeting.meetingLinkSnapshot || '';

  const adminContactEmail = admin.adminSettings?.bookingContactEmail || admin.email || ADMIN_CALENDAR_EMAIL;
  const adminContactPhone = admin.adminSettings?.bookingContactPhone || admin.phone || null;
  if (adminContactEmail || adminContactPhone) {
    const contactPieces = [];
    if (adminContactEmail) {
      contactPieces.push(`email ${adminContactEmail}`);
    }
    if (adminContactPhone) {
      contactPieces.push(`text ${adminContactPhone}`);
    }
    if (contactPieces.length) {
      const contactText = contactPieces.length === 1
        ? contactPieces[0]
        : `${contactPieces[0]} or ${contactPieces[1]}`;
      descriptionParts.push(`Need to cancel or reschedule? Please ${contactText}.`);
    }
  }

  const description = descriptionParts.join('\n');
  const formatIcsDate = (date) => moment.utc(date).format('YYYYMMDDTHHmmss[Z]');
  const start = meeting.scheduledStart;
  const end = meeting.scheduledEnd;
  const uid = `meeting-${meeting._id}@waraqa`;
  const locationLine = meetingLink ? `${meetingLink}` : 'Online';
  const attendeeEmails = (() => {
    const entries = new Map();
    const registerEmail = (email) => {
      if (!email) return;
      const trimmed = String(email).trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (entries.has(key)) return;
      entries.set(key, trimmed);
    };
    registerEmail(meeting.bookingPayload?.guardianEmail);
    if (Array.isArray(meeting.attendees?.additionalEmails)) {
      meeting.attendees.additionalEmails.forEach(registerEmail);
    }
    registerEmail(ADMIN_CALENDAR_EMAIL);
    return Array.from(entries.values());
  })();
  const attendeeLines = attendeeEmails.map((email) => `ATTENDEE;CN=${email}:mailto:${email}`);
  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Waraqa//Meetings//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${summary.replace(/\n/g, ' ')}`,
    `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
    `LOCATION:${locationLine}`,
    ...attendeeLines,
    'BEGIN:VALARM',
    'TRIGGER:-PT24H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];

  const datesParam = `${formatIcsDate(start)}/${formatIcsDate(end)}`;
  const encodedSummary = encodeURIComponent(summary);
  const encodedDescription = encodeURIComponent(description);
  const encodedLocation = encodeURIComponent(locationLine);
  const timezone = meeting.timezone || admin.adminSettings?.meetingTimezone || DEFAULT_TIMEZONE;
  const googleAttendeeParams = attendeeEmails
    .map((email) => `&add=${encodeURIComponent(email)}`)
    .join('');
  const outlookAttendeeParam = attendeeEmails.length
    ? `&to=${encodeURIComponent(attendeeEmails.join(';'))}`
    : '';

  const googleCalendarLink = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodedSummary}&dates=${datesParam}&details=${encodedDescription}&location=${encodedLocation}&ctz=${encodeURIComponent(timezone)}&conference=none${googleAttendeeParams}`;
  const outlookCalendarLink = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodedSummary}&body=${encodedDescription}&startdt=${encodeURIComponent(start.toISOString())}&enddt=${encodeURIComponent(end.toISOString())}&location=${encodedLocation}${outlookAttendeeParam}`;

  return {
    icsContent: icsLines.join('\r\n'),
    googleCalendarLink,
    outlookCalendarLink
  };
};

const formatMeetingResponse = (meeting) => {
  if (!meeting) return null;
  const payload = meeting.toObject({ virtuals: true });
  payload.calendar = payload.calendar || {};
  payload.visibility = payload.visibility || { displayColor: MEETING_COLORS.background };
  return payload;
};

const listAvailabilitySlots = async ({ adminId, meetingType, includeInactive = true }) => {
  const admin = await resolveAdmin(adminId);
  const query = { adminId: admin._id };
  if (meetingType) {
    ensureMeetingType(meetingType);
    query.meetingType = meetingType;
  }
  if (!includeInactive) {
    query.isActive = true;
  }
  const slots = await MeetingAvailabilitySlot.find(query).sort({ meetingType: 1, dayOfWeek: 1, startTime: 1 });
  return {
    admin,
    slots
  };
};

const createAvailabilitySlot = async ({ adminId, payload }) => {
  const admin = await resolveAdmin(adminId);
  ensureMeetingType(payload.meetingType);

  const siblingSlots = await MeetingAvailabilitySlot.find({
    adminId: admin._id,
    meetingType: payload.meetingType,
    dayOfWeek: payload.dayOfWeek,
    isActive: true
  });
  const hasOverlap = siblingSlots.some((slot) => slot.hasConflict(payload.startTime, payload.endTime));
  if (hasOverlap) {
    throw createError(400, 'Slot overlaps existing availability');
  }

  const slot = new MeetingAvailabilitySlot({
    adminId: admin._id,
    meetingType: payload.meetingType,
    dayOfWeek: payload.dayOfWeek,
    startTime: payload.startTime,
    endTime: payload.endTime,
    timezone: payload.timezone || admin.adminSettings?.meetingTimezone || DEFAULT_TIMEZONE,
    label: payload.label,
    description: payload.description,
    capacity: payload.capacity || 1,
    priority: payload.priority || 1,
    effectiveFrom: payload.effectiveFrom || new Date(),
    effectiveTo: payload.effectiveTo || null
  });

  await slot.save();
  return slot;
};

const updateAvailabilitySlot = async ({ adminId, slotId, updates }) => {
  const admin = await resolveAdmin(adminId);
  const slot = await MeetingAvailabilitySlot.findOne({ _id: slotId, adminId: admin._id });
  if (!slot) {
    throw createError(404, 'Slot not found');
  }

  if (updates.meetingType) {
    ensureMeetingType(updates.meetingType);
    slot.meetingType = updates.meetingType;
  }
  ['dayOfWeek', 'startTime', 'endTime', 'timezone', 'label', 'description', 'capacity', 'priority', 'effectiveFrom', 'effectiveTo', 'isActive'].forEach((key) => {
    if (typeof updates[key] !== 'undefined') {
      slot[key] = updates[key];
    }
  });

  if (updates.startTime || updates.endTime || typeof updates.dayOfWeek !== 'undefined') {
    const siblingSlots = await MeetingAvailabilitySlot.find({
      adminId: admin._id,
      meetingType: slot.meetingType,
      dayOfWeek: slot.dayOfWeek,
      isActive: true,
      _id: { $ne: slot._id }
    });
    const overlap = siblingSlots.some((sibling) => sibling.hasConflict(slot.startTime, slot.endTime));
    if (overlap) {
      throw createError(400, 'Updated slot overlaps existing availability');
    }
  }

  await slot.save();
  return slot;
};

const deleteAvailabilitySlot = async ({ adminId, slotId }) => {
  const admin = await resolveAdmin(adminId);
  const slot = await MeetingAvailabilitySlot.findOne({ _id: slotId, adminId: admin._id });
  if (!slot) {
    throw createError(404, 'Slot not found');
  }
  slot.isActive = false;
  await slot.save();
  return true;
};

const listMeetingTimeOff = async ({ adminId, rangeStart, rangeEnd, includeInactive = false }) => {
  const admin = await resolveAdmin(adminId);
  const clamps = clampRange(rangeStart, rangeEnd);
  const scopedStart = clamps.rangeStart;
  const scopedEnd = clamps.rangeEnd;
  const query = {
    adminId: admin._id,
    ...(includeInactive ? {} : { isActive: true })
  };
  if (scopedStart && scopedEnd) {
    query.startDateTime = { $lt: scopedEnd };
    query.endDateTime = { $gt: scopedStart };
  }
  const periods = await MeetingUnavailablePeriod.find(query).sort({ startDateTime: 1 });
  return { admin, periods };
};

const createMeetingTimeOff = async ({ adminId, payload }) => {
  const admin = await resolveAdmin(adminId);
  const effectiveTimezone = payload.timezone || admin.adminSettings?.meetingTimezone || admin.timezone || DEFAULT_TIMEZONE;

  let startDateTime;
  let endDateTime;
  if (payload?.startDateTime && payload?.endDateTime) {
    startDateTime = new Date(payload.startDateTime);
    endDateTime = new Date(payload.endDateTime);
  } else if (payload?.date && payload?.startTime && payload?.endTime) {
    const startInput = `${payload.date} ${payload.startTime}`;
    const endInput = `${payload.date} ${payload.endTime}`;
    startDateTime = convertToUTC(startInput, effectiveTimezone);
    endDateTime = convertToUTC(endInput, effectiveTimezone);
  } else {
    throw createError(400, 'Provide either startDateTime/endDateTime or date/startTime/endTime');
  }

  if (!(startDateTime instanceof Date) || Number.isNaN(startDateTime.getTime())) {
    throw createError(400, 'Invalid start date/time');
  }
  if (!(endDateTime instanceof Date) || Number.isNaN(endDateTime.getTime())) {
    throw createError(400, 'Invalid end date/time');
  }
  if (endDateTime <= startDateTime) {
    throw createError(400, 'End must be after start');
  }

  const record = new MeetingUnavailablePeriod({
    adminId: admin._id,
    startDateTime,
    endDateTime,
    timezone: effectiveTimezone,
    description: payload.description || ''
  });
  await record.save();
  return record;
};

const deleteMeetingTimeOff = async ({ adminId, timeOffId }) => {
  const admin = await resolveAdmin(adminId);
  const record = await MeetingUnavailablePeriod.findOne({ _id: timeOffId, adminId: admin._id });
  if (!record) {
    throw createError(404, 'Time off not found');
  }
  record.isActive = false;
  await record.save();
  return true;
};

const getAvailabilityWindows = async ({ adminId, meetingType, rangeStart, rangeEnd, timezone }) => {
  const admin = await resolveAdmin(adminId, { meetingType });
  const windows = await computeAvailabilityWindows({
    admin,
    meetingType,
    rangeStart,
    rangeEnd,
    viewerTimezone: timezone,
    minimumDuration: MEETING_DEFAULT_DURATIONS[meetingType]
  });
  return windows;
};

const bookMeeting = async ({
  meetingType,
  requestedStart,
  requester,
  timezone,
  students = [],
  guardianPayload = {},
  teacherPayload = {},
  notes = '',
  adminId,
  calendarPreference
}) => {
  ensureMeetingType(meetingType);
  if (!requestedStart) {
    throw createError(400, 'Start time is required');
  }
  const admin = await resolveAdmin(adminId, { meetingType });
  const bookingTimezone = timezone || guardianPayload.timezone || requester?.timezone || admin.adminSettings?.meetingTimezone || DEFAULT_TIMEZONE;
  const startUtc = convertToUTC(requestedStart, bookingTimezone);
  const durationMinutes = computeDurationMinutes(meetingType, students);
  const endUtc = new Date(startUtc.getTime() + durationMinutes * 60000);

  await assertSlotAvailability({ admin, meetingType, startUtc, endUtc });

  const guardianId = requester?.role === 'guardian'
    ? requester._id
    : toObjectId(guardianPayload.guardianId);
  const teacherId = requester?.role === 'teacher'
    ? requester._id
    : toObjectId(teacherPayload.teacherId);

  let studentIdForQuota;
  if (meetingType === MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP) {
    studentIdForQuota = toObjectId(students[0]?.studentId || guardianPayload.studentId);
    if (!studentIdForQuota) {
      throw createError(400, 'Student is required for follow-up meetings');
    }
  }

  const monthKey = formatMonthKey(startUtc, admin.adminSettings?.meetingTimezone || DEFAULT_TIMEZONE);
  if (meetingType === MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP) {
    await enforceGuardianMonthlyLimit({
      guardianId,
      studentId: studentIdForQuota,
      meetingType,
      monthKey
    });
  }

  if (meetingType === MEETING_TYPES.TEACHER_SYNC && !teacherId) {
    throw createError(403, 'Only teachers can book sync meetings');
  }

  const preferredCalendar = calendarPreference
    || guardianPayload.calendarPreference
    || teacherPayload.calendarPreference
    || requester?.calendarPreference
    || null;

  const bookingSource = requester
    ? (requester.role === 'guardian'
        ? MEETING_SOURCES.GUARDIAN
        : requester.role === 'teacher'
          ? MEETING_SOURCES.TEACHER
          : MEETING_SOURCES.ADMIN)
    : MEETING_SOURCES.PUBLIC;

  const additionalEmails = (() => {
    const collected = [];
    const seen = new Set();
    const pushEmail = (value) => {
      if (!value) return;
      const trimmed = String(value).trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      collected.push(trimmed);
    };
    if (Array.isArray(guardianPayload.additionalEmails)) {
      guardianPayload.additionalEmails.forEach(pushEmail);
    }
    if (Array.isArray(teacherPayload.additionalEmails)) {
      teacherPayload.additionalEmails.forEach(pushEmail);
    }
    pushEmail(ADMIN_CALENDAR_EMAIL);
    return collected;
  })();

  const meeting = new Meeting({
    meetingType,
    status: MEETING_STATUSES.SCHEDULED,
    scheduledStart: startUtc,
    scheduledEnd: endUtc,
    durationMinutes,
    timezone: bookingTimezone,
    adminId: admin._id,
    guardianId,
    teacherId,
    bookingSource,
    bookingPayload: {
      guardianName: guardianPayload.guardianName || requester?.fullName || guardianPayload.guardianEmail,
      guardianEmail: guardianPayload.guardianEmail || requester?.email,
      guardianPhone: guardianPayload.guardianPhone || requester?.phone,
      timezone: bookingTimezone,
      notes,
      students: students.map((student) => ({
        studentId: toObjectId(student.studentId) || undefined,
        guardianSubdocumentId: student.guardianSubdocumentId,
        studentName: student.studentName,
        isExistingStudent: Boolean(student.isExistingStudent || meetingType !== MEETING_TYPES.NEW_STUDENT_EVALUATION),
        isGuardianSelf: Boolean(student.isGuardianSelf),
        notes: student.notes
      })),
      preferredCalendar
    },
    attendees: {
      teacherName: teacherPayload.teacherName || (requester?.role === 'teacher' ? requester.fullName : undefined),
      guardianName: guardianPayload.guardianName || requester?.fullName,
      additionalEmails
    },
    quotaKeys: {
      monthKey,
      guardianMonthKey: guardianId ? `${guardianId.toString()}-${monthKey}` : undefined,
      teacherMonthKey: teacherId ? `${teacherId.toString()}-${monthKey}` : undefined
    },
    buffers: {
      beforeMinutes: getBufferMinutes(admin, meetingType),
      afterMinutes: getBufferMinutes(admin, meetingType)
    },
    visibility: {
      showInCalendar: true,
      displayColor: MEETING_COLORS.background
    }
  });

  await meeting.save();
  const calendarLinks = buildCalendarLinks(meeting, admin);
  await notificationService.notifyMeetingScheduled({ meeting, adminUser: admin, triggeredBy: requester });
  return { meeting: formatMeetingResponse(meeting), calendarLinks };
};

const listMeetings = async ({ requester, filters = {} }) => {
  if (!requester) {
    throw createError(401, 'Authentication required');
  }
  const query = {};
  if (filters.meetingType) {
    ensureMeetingType(filters.meetingType);
    query.meetingType = filters.meetingType;
  }
  if (filters.status) {
    query.status = filters.status;
  }
  if (filters.rangeStart || filters.rangeEnd) {
    query.scheduledStart = {};
    if (filters.rangeStart) {
      query.scheduledStart.$gte = new Date(filters.rangeStart);
    }
    if (filters.rangeEnd) {
      query.scheduledStart.$lte = new Date(filters.rangeEnd);
    }
  }

  if (requester.role === 'admin') {
    query.adminId = requester._id;
  } else if (requester.role === 'guardian') {
    query.$or = [
      { guardianId: requester._id },
      { 'bookingPayload.guardianEmail': requester.email }
    ];
  } else if (requester.role === 'teacher') {
    query.teacherId = requester._id;
  } else {
    throw createError(403, 'Role not permitted to view meetings');
  }

  const limit = Math.min(Number(filters.limit) || 50, 200);
  const meetings = await Meeting.find(query)
    .sort({ scheduledStart: 1 })
    .limit(limit);
  return meetings.map(formatMeetingResponse);
};

const submitMeetingReport = async ({ meetingId, payload, submittedBy }) => {
  const meeting = await Meeting.findById(meetingId);
  if (!meeting) {
    throw createError(404, 'Meeting not found');
  }

  const visibility = {
    admin: true,
    guardians: meeting.meetingType === MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP,
    teachers: meeting.meetingType === MEETING_TYPES.TEACHER_SYNC
  };

  meeting.report = {
    submittedBy: submittedBy._id,
    submittedAt: new Date(),
    visibility,
    evaluation: meeting.meetingType === MEETING_TYPES.NEW_STUDENT_EVALUATION
      ? { students: (payload.students || []).map((student) => ({
          studentId: toObjectId(student.studentId) || undefined,
          studentName: student.studentName,
          curricula: student.curricula || [],
          studyPlan: student.studyPlan,
          learningPreferences: student.learningPreferences
        })) }
      : undefined,
    guardianFollowUp: meeting.meetingType === MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP
      ? {
          studentId: toObjectId(payload.studentId) || toObjectId(meeting.bookingPayload?.students?.[0]?.studentId),
          studentName: payload.studentName || meeting.bookingPayload?.students?.[0]?.studentName,
          currentLevel: payload.currentLevel,
          assessmentNotes: payload.assessmentNotes,
          nextPlan: payload.nextPlan
        }
      : undefined,
    teacherSync: meeting.meetingType === MEETING_TYPES.TEACHER_SYNC
      ? {
          teacherId: meeting.teacherId,
          teacherName: submittedBy.fullName || submittedBy.firstName,
          students: (payload.students || []).map((student) => ({
            studentId: toObjectId(student.studentId) || undefined,
            studentName: student.studentName,
            currentLevelNotes: student.currentLevelNotes,
            futurePlan: student.futurePlan
          }))
        }
      : undefined,
    notes: payload.notes
  };

  await meeting.save();
  return formatMeetingResponse(meeting);
};

module.exports = {
  listAvailabilitySlots,
  createAvailabilitySlot,
  updateAvailabilitySlot,
  deleteAvailabilitySlot,
  getAvailabilityWindows,
  bookMeeting,
  listMeetings,
  submitMeetingReport,
  resolveAdmin,
  buildCalendarLinks,
  listMeetingTimeOff,
  createMeetingTimeOff,
  deleteMeetingTimeOff
};
