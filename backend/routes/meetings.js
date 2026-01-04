const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  optionalAuth,
  requireAdmin
} = require('../middleware/auth');
const meetingService = require('../services/meetingService');
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
      calendarPreference
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

module.exports = router;
