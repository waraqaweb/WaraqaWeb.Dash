const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const {
  authenticateToken,
  optionalAuth,
  requireAdmin
} = require('../middleware/auth');
const meetingService = require('../services/meetingService');
const Meeting = require('../models/Meeting');
const User = require('../models/User');
const { MEETING_TYPES } = require('../constants/meetingConstants');

const sendError = (res, error) => {
  const status = error.status || 500;
  return res.status(status).json({
    message: error.message || 'Meeting service error',
    ...(error.meta ? { meta: error.meta } : {})
  });
};

const parseAdminId = (req) => {
  if (req.query.adminId) return req.query.adminId;
  if (req.body && req.body.adminId) return req.body.adminId;
  if (req.user && req.user.role === 'admin') return req.user._id;
  return null;
};

// --- Inbound website booking webhook ---------------------------------------
// The public marketing site (waraqaweb.com) POSTs a signed JSON payload here
// whenever a visitor confirms a booking. The route is unauthenticated at the
// session level and instead verifies an HMAC signature; on success it feeds the
// same meetingService.adminCreateMeeting flow used by the admin "Create from
// paste" dialog.

// Map the website's meetingType values onto the internal meeting-type enum.
const WEBHOOK_MEETING_TYPE_MAP = {
  evaluation: MEETING_TYPES.NEW_STUDENT_EVALUATION,
  new_student_evaluation: MEETING_TYPES.NEW_STUDENT_EVALUATION,
  follow_up: MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP,
  current_student_follow_up: MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP,
};

const mapWebhookMeetingType = (raw) => {
  const key = String(raw || '').trim().toLowerCase();
  return WEBHOOK_MEETING_TYPE_MAP[key] || MEETING_TYPES.NEW_STUDENT_EVALUATION;
};

// Verify the HMAC-SHA256 signature the website attaches to each delivery. The
// signature is computed over `${timestamp}.${rawBody}` with the shared secret.
// Rejects requests with a missing/old timestamp (replay protection: +/- 5 min)
// and uses a constant-time comparison. Returns true only on an exact match.
const verifyWebhookSignature = (req, secret) => {
  const ts = req.get('X-Waraqa-Timestamp');
  const sigHeader = req.get('X-Waraqa-Signature') || '';
  if (!ts || !sigHeader) return false;
  if (!/^\d+$/.test(String(ts))) return false;
  // Replay protection: reject anything older (or newer) than 5 minutes.
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 300) return false;
  const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  const provided = sigHeader.replace(/^sha256=/, '');
  let a;
  let b;
  try {
    a = Buffer.from(expected, 'hex');
    b = Buffer.from(provided, 'hex');
  } catch (e) {
    return false;
  }
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Resolve the admin account that owns webhook-created meetings. There is no
// logged-in user, so look it up from env (id preferred, then email). Returns
// null when neither is configured or matches an admin.
const resolveWebhookAdmin = async () => {
  const adminId = process.env.WEBHOOK_DEFAULT_ADMIN_ID;
  const adminEmail = process.env.WEBHOOK_DEFAULT_ADMIN_EMAIL;
  if (adminId) {
    const byId = await User.findById(adminId).catch(() => null);
    if (byId && byId.role === 'admin') return byId;
  }
  if (adminEmail) {
    const byEmail = await User.findOne({
      email: String(adminEmail).trim().toLowerCase(),
      role: 'admin',
    });
    if (byEmail) return byEmail;
  }
  return null;
};

// Translate the website booking payload into the shape adminCreateMeeting wants.
// schedule.startAt / endAt are absolute ISO-8601 UTC strings; courses are folded
// into each student's notes (mirroring the "Create from paste" mapping).
const mapWebsiteBookingToMeetingPayload = (booking) => {
  const guardian = booking.guardian || {};
  const schedule = booking.schedule || {};
  const guardianName = guardian.fullName
    || [guardian.firstName, guardian.lastName].filter(Boolean).join(' ').trim()
    || guardian.email
    || '';
  const students = Array.isArray(booking.students) ? booking.students : [];

  return {
    meetingType: mapWebhookMeetingType(booking.meetingType),
    startTime: schedule.startAt,
    endTime: schedule.endAt || undefined,
    timezone: schedule.scheduleTimezone || undefined,
    guardian: {
      guardianName,
      guardianFirstName: guardian.firstName || '',
      guardianLastName: guardian.lastName || '',
      guardianEmail: guardian.email || '',
      guardianPhone: guardian.whatsapp || guardian.phone || '',
      timezone: schedule.studentTimezone || undefined,
    },
    students: students.map((s) => {
      const name = [s.firstName, s.lastName].filter(Boolean).join(' ').trim();
      const courseLines = Array.isArray(s.courses) ? s.courses.filter(Boolean).join('\n') : '';
      const studentNotes = [s.notes, courseLines].filter(Boolean).join('\n\n');
      return {
        studentName: name || 'Student',
        notes: studentNotes || undefined,
      };
    }),
    notes: booking.notes || '',
    meetingLink: booking.meetingLink || undefined,
    sourceBookingId: booking.id,
  };
};

// Public (HMAC-authenticated) endpoint. Final URL: /api/meetings/webhook/website-booking
router.post('/webhook/website-booking', async (req, res) => {
  const bookingId = req.body && req.body.booking && req.body.booking.id;
  try {
    const secret = process.env.WEBSITE_WEBHOOK_SECRET;
    if (!secret) {
      console.error('[webhook:website-booking] WEBSITE_WEBHOOK_SECRET is not configured');
      return res.status(500).json({ ok: false, error: 'webhook not configured' });
    }

    if (!verifyWebhookSignature(req, secret)) {
      return res.status(401).json({ ok: false, error: 'invalid signature' });
    }

    const booking = req.body && req.body.booking;
    if (!booking || !booking.id) {
      return res.status(400).json({ ok: false, error: 'missing booking payload' });
    }
    if (!booking.schedule || !booking.schedule.startAt) {
      return res.status(400).json({ ok: false, error: 'missing schedule.startAt' });
    }

    // Idempotency: if this booking was already imported, do not create a second
    // meeting. Always return 2xx so the website considers the delivery handled.
    const existing = await Meeting.findOne({ sourceBookingId: booking.id }).select('_id');
    if (existing) {
      return res.status(200).json({ ok: true, duplicate: true, meetingId: existing._id });
    }

    const admin = await resolveWebhookAdmin();
    if (!admin) {
      console.error('[webhook:website-booking] could not resolve default admin; set WEBHOOK_DEFAULT_ADMIN_ID or WEBHOOK_DEFAULT_ADMIN_EMAIL');
      return res.status(500).json({ ok: false, error: 'default admin not configured' });
    }

    const payload = mapWebsiteBookingToMeetingPayload(booking);
    const result = await meetingService.adminCreateMeeting({
      adminId: admin._id,
      requester: admin,
      payload,
    });

    const meetingId = result.meeting && (result.meeting._id || result.meeting.id);
    return res.status(201).json({ ok: true, meetingId });
  } catch (error) {
    // Concurrent deliveries can both pass the idempotency check and then collide
    // on the unique sourceBookingId index — treat that as a successful duplicate.
    if (error && error.code === 11000 && bookingId) {
      const existing = await Meeting.findOne({ sourceBookingId: bookingId }).select('_id').catch(() => null);
      if (existing) {
        return res.status(200).json({ ok: true, duplicate: true, meetingId: existing._id });
      }
    }
    const status = error && error.status;
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({ ok: false, error: error.message || 'invalid payload' });
    }
    console.error('[webhook:website-booking] failed to import booking:', error);
    return res.status(500).json({ ok: false, error: 'internal error' });
  }
});

router.get('/availability/slots', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { meetingType, includeInactive } = req.query;
    const adminId = parseAdminId(req);
    const response = await meetingService.listAvailabilitySlots({
      adminId,
      meetingType,
      includeInactive: includeInactive !== 'false'
    });
    res.json({
      slots: response.slots,
      timezone: response.admin.adminSettings?.meetingTimezone || response.admin.timezone,
      meetingTypes: Object.values(MEETING_TYPES)
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/availability/slots', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const slot = await meetingService.createAvailabilitySlot({
      adminId: parseAdminId(req),
      payload: req.body
    });
    res.status(201).json({ message: 'Slot created', slot });
  } catch (error) {
    sendError(res, error);
  }
});

router.put('/availability/slots/:slotId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const slot = await meetingService.updateAvailabilitySlot({
      adminId: parseAdminId(req),
      slotId: req.params.slotId,
      updates: req.body
    });
    res.json({ message: 'Slot updated', slot });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/availability/slots/:slotId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await meetingService.deleteAvailabilitySlot({
      adminId: parseAdminId(req),
      slotId: req.params.slotId
    });
    res.json({ message: 'Slot deleted' });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/availability', optionalAuth, async (req, res) => {
  try {
    const { meetingType, rangeStart, rangeEnd, timezone } = req.query;
    if (!meetingType) {
      return res.status(400).json({ message: 'meetingType is required' });
    }
    const windows = await meetingService.getAvailabilityWindows({
      adminId: parseAdminId(req),
      meetingType,
      rangeStart,
      rangeEnd,
      timezone: timezone || req.user?.timezone
    });
    res.json({ windows });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/availability/timeoff', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { rangeStart, rangeEnd, includeInactive } = req.query;
    const response = await meetingService.listMeetingTimeOff({
      adminId: parseAdminId(req),
      rangeStart,
      rangeEnd,
      includeInactive: includeInactive === 'true'
    });
    res.json({ periods: response.periods });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/availability/timeoff', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const period = await meetingService.createMeetingTimeOff({
      adminId: parseAdminId(req),
      payload: req.body
    });
    res.status(201).json({ message: 'Time off created', period });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/availability/timeoff/:timeOffId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await meetingService.deleteMeetingTimeOff({
      adminId: parseAdminId(req),
      timeOffId: req.params.timeOffId
    });
    res.json({ message: 'Time off deleted' });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/book', optionalAuth, async (req, res) => {
  try {
    const {
      meetingType,
      startTime,
      timezone,
      students,
      guardian = {},
      teacher = {},
      notes,
      calendarPreference
    } = req.body;

    if (!meetingType) {
      return res.status(400).json({ message: 'meetingType is required' });
    }

    if (!startTime) {
      return res.status(400).json({ message: 'startTime is required' });
    }

    const result = await meetingService.bookMeeting({
      meetingType,
      requestedStart: startTime,
      requester: req.user,
      timezone,
      students: Array.isArray(students) ? students : [],
      guardianPayload: guardian,
      teacherPayload: teacher,
      notes,
      adminId: parseAdminId(req),
      calendarPreference,
      bookingMeta: {
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
      }
    });

    res.status(201).json({
      message: 'Meeting booked successfully',
      meeting: result.meeting,
      calendar: result.calendarLinks
    });
  } catch (error) {
    sendError(res, error);
  }
});

// Admin-only meeting creator used by the "Create from paste" dialog. Skips
// availability / slot / time-off guards; the admin is recording an out-of-band
// booking with explicit start/end times.
router.post('/admin-create', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await meetingService.adminCreateMeeting({
      adminId: parseAdminId(req),
      requester: req.user,
      payload: req.body || {},
    });
    res.status(201).json({ message: 'Meeting created', meeting: result.meeting });
  } catch (error) {
    sendError(res, error);
  }
});

// Returns the meeting the admin is currently in (or closest to now within a
// configurable window). Used by the evaluation studio to offer a prefill
// without re-entering guardian / student data.
router.get('/current', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const windowMinutes = Number(req.query.windowMinutes) || 90;
    const result = await meetingService.getCurrentMeetingForAdmin({
      adminId: parseAdminId(req),
      windowMinutes,
    });
    res.json({ meeting: result.meeting });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const meetings = await meetingService.listMeetings({
      requester: req.user,
      filters: req.query
    });
    res.json({ meetings });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:meetingId/report', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const meeting = await meetingService.submitMeetingReport({
      meetingId: req.params.meetingId,
      payload: req.body,
      submittedBy: req.user
    });
    res.json({ message: 'Report saved', meeting });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/:meetingId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const meeting = await meetingService.cancelMeeting({
      meetingId: req.params.meetingId,
      adminId: parseAdminId(req),
      reason: req.body?.reason
    });
    res.json({ message: 'Meeting cancelled', meeting });
  } catch (error) {
    sendError(res, error);
  }
});

router.patch('/:meetingId/reschedule', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const meeting = await meetingService.rescheduleMeeting({
      meetingId: req.params.meetingId,
      adminId: parseAdminId(req),
      startTime: req.body?.startTime,
      endTime: req.body?.endTime,
      durationMinutes: req.body?.durationMinutes,
      reason: req.body?.reason
    });
    res.json({ message: 'Meeting rescheduled', meeting });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:meetingId/remind', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await meetingService.sendMeetingReminder({
      meetingId: req.params.meetingId,
      adminId: parseAdminId(req)
    });
    res.json({ message: 'Reminder sent', meeting: result.meeting, results: result.results });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/:meetingId/hard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await meetingService.hardDeleteMeeting({
      meetingId: req.params.meetingId,
      adminId: parseAdminId(req)
    });
    res.json({ message: 'Meeting deleted', ...result });
  } catch (error) {
    sendError(res, error);
  }
});

router.patch('/:meetingId/attendance', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const meeting = await meetingService.setMeetingAttendance({
      meetingId: req.params.meetingId,
      adminId: parseAdminId(req),
      attendanceStatus: req.body?.attendanceStatus
    });
    res.json({ message: 'Attendance updated', meeting });
  } catch (error) {
    sendError(res, error);
  }
});

module.exports = router;
