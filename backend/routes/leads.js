const express = require('express');
const RegistrationLead = require('../models/RegistrationLead');
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const notificationService = require('../services/notificationService');

const router = express.Router();

const DEFAULT_PASSWORD = 'waraqa123';

const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const getGuardianDisplayName = (personalInfo = {}) => (
  personalInfo.fullName || personalInfo.guardianName || [personalInfo.firstName, personalInfo.lastName].filter(Boolean).join(' ').trim()
);

const splitName = (value = '') => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: 'Guardian', lastName: 'Account' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ') || 'Account',
  };
};

const summarizeAvailability = (lead = {}, studentIndex = null) => {
  const allSlots = Array.isArray(lead?.availability?.slots) ? lead.availability.slots : [];
  const relevantSlots = allSlots.filter((slot) => lead?.availability?.schedulingMode === 'separate'
    ? Number(slot.studentIndex) === Number(studentIndex)
    : slot.studentIndex === null || slot.studentIndex === undefined
  );

  if (relevantSlots.length) {
    const slotSummary = relevantSlots
      .slice()
      .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || String(a.startTime).localeCompare(String(b.startTime)))
      .map((slot) => `${slot.day} ${slot.startTime}-${slot.endTime}${slot.duration ? ` (${slot.duration}m)` : ''}`)
      .join(', ');
    return `Availability: ${slotSummary}`;
  }

  if (lead?.availability?.weekdays?.length) {
    return `Preferred days: ${lead.availability.weekdays.join(', ')}`;
  }

  return '';
};

const buildStudentNotes = (student = {}, lead = {}) => {
  const lines = [];
  if (Array.isArray(student.courses) && student.courses.length) {
    lines.push(`Courses: ${student.courses.join(', ')}`);
  }
  if (student.classDuration) {
    lines.push(`Duration: ${student.classDuration} minutes`);
  }
  if (student.classesPerWeek) {
    lines.push(`Classes/week: ${student.classesPerWeek}`);
  }
  if (student.notes) {
    lines.push(`Student notes: ${student.notes}`);
  }
  if (lead?.availability?.preferredStartingDate) {
    lines.push(`Preferred start: ${new Date(lead.availability.preferredStartingDate).toISOString().slice(0, 10)}`);
  }
  const allSlots = Array.isArray(lead?.availability?.slots) ? lead.availability.slots : [];
  const relevantSlots = allSlots.filter((slot) => lead?.availability?.schedulingMode === 'separate'
    ? Number(slot.studentIndex) === Number(student._index)
    : slot.studentIndex === null || slot.studentIndex === undefined
  );
  if (relevantSlots.length) {
    lines.push(summarizeAvailability(lead, student._index));
  } else if (lead?.availability?.weekdays?.length) {
    lines.push(`Preferred days: ${lead.availability.weekdays.join(', ')}`);
  }
  if (lead?.availability?.sharedDuration) {
    lines.push(`Shared duration: ${lead.availability.sharedDuration} minutes`);
  }
  if (Array.isArray(lead?.preferences?.classPreferences) && lead.preferences.classPreferences.length) {
    lines.push(`Class preferences: ${lead.preferences.classPreferences.join(', ')}`);
  }
  if (Array.isArray(lead?.preferences?.teacherPreferences) && lead.preferences.teacherPreferences.length) {
    lines.push(`Teacher preferences: ${lead.preferences.teacherPreferences.join(', ')}`);
  }
  if (lead?.preferences?.notes) {
    lines.push(`Preference notes: ${lead.preferences.notes}`);
  }
  if (lead?.availability?.notes) {
    lines.push(`Lead notes: ${lead.availability.notes}`);
  }
  return lines.join(' | ');
};

const deriveStudentDuration = (student = {}, lead = {}, studentIndex = 0) => {
  if (student.classDuration) return Number(student.classDuration);
  if (lead?.availability?.allDurationsSame && lead?.availability?.sharedDuration) {
    return Number(lead.availability.sharedDuration);
  }
  const relevantSlots = Array.isArray(lead?.availability?.slots)
    ? lead.availability.slots.filter((slot) => lead?.availability?.schedulingMode === 'separate'
      ? Number(slot.studentIndex) === Number(studentIndex)
      : slot.studentIndex === null || slot.studentIndex === undefined)
    : [];
  const durations = [...new Set(relevantSlots.map((slot) => Number(slot.duration)).filter(Boolean))];
  return durations.length === 1 ? durations[0] : undefined;
};

const normalizePublicLeadPayload = (payload = {}, req) => {
  const personalInfo = payload.personalInfo || {};
  const students = Array.isArray(payload.students) ? payload.students.filter((student) => student?.firstName && student?.lastName) : [];
  const guardianDisplayName = getGuardianDisplayName(personalInfo);
  const slots = Array.isArray(payload.availability?.slots)
    ? payload.availability.slots.filter((slot) => slot?.day && slot?.startTime && slot?.endTime)
    : [];

  return {
    guardianDisplayName,
    students,
    slots,
    doc: {
      personalInfo: {
        fullName: guardianDisplayName,
        firstName: personalInfo.firstName || '',
        lastName: personalInfo.lastName || '',
        guardianName: guardianDisplayName,
        email: personalInfo.email,
        phone: personalInfo.phone || '',
        timezone: personalInfo.timezone,
      },
      address: {
        city: payload.address?.city || '',
        state: payload.address?.state || '',
        country: payload.address?.country || '',
      },
      preferences: {
        classPreferences: Array.isArray(payload.preferences?.classPreferences) ? payload.preferences.classPreferences : [],
        teacherPreferences: Array.isArray(payload.preferences?.teacherPreferences) ? payload.preferences.teacherPreferences : [],
        notes: payload.preferences?.notes || '',
      },
      students,
      availability: {
        weekdays: Array.isArray(payload.availability?.weekdays) ? payload.availability.weekdays : [],
        preferredStartingDate: payload.availability?.preferredStartingDate || null,
        schedulingMode: payload.availability?.schedulingMode === 'separate' ? 'separate' : 'consecutive',
        allDurationsSame: payload.availability?.allDurationsSame !== false,
        sharedDuration: payload.availability?.sharedDuration || null,
        slots,
        notes: payload.availability?.notes || '',
      },
      submittedMeta: {
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
      },
    },
  };
};

const validatePublicLeadPayload = ({ guardianDisplayName, personalInfo = {}, students = [], payload = {}, slots = [] }) => {
  if (!guardianDisplayName || !personalInfo.email || !personalInfo.timezone) {
    return 'Full name, email, and timezone are required.';
  }

  if (!students.length) {
    return 'At least one student is required.';
  }

  if (!payload.availability?.preferredStartingDate) {
    return 'Preferred starting date is required.';
  }

  if (!slots.length) {
    return 'At least one availability slot is required.';
  }

  return '';
};

router.post('/public/student-registration', async (req, res) => {
  try {
    const payload = req.body || {};
    const normalized = normalizePublicLeadPayload(payload, req);
    const validationMessage = validatePublicLeadPayload({
      guardianDisplayName: normalized.guardianDisplayName,
      personalInfo: payload.personalInfo || {},
      students: normalized.students,
      payload,
      slots: normalized.slots,
    });

    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const lead = await RegistrationLead.create(normalized.doc);

    const admins = await User.find({ role: 'admin', isActive: true }).select('_id');
    await Promise.allSettled(
      (admins || []).map((admin) => notificationService.createNotification({
        userId: admin._id,
        title: 'New registration lead',
        message: `${normalized.guardianDisplayName} • ${lead.students.length} student(s) • ${lead.personalInfo.timezone}`,
        type: 'meeting',
        relatedTo: 'system',
        actionRequired: true,
        actionLink: '/dashboard/availability?section=leads',
      }))
    );

    return res.status(201).json({
      message: 'Your information has been saved successfully.',
      leadId: lead._id,
    });
  } catch (error) {
    console.error('Create public student registration lead error:', error);
    return res.status(500).json({ message: 'Failed to save registration.' });
  }
});

router.put('/public/student-registration/:leadId', async (req, res) => {
  try {
    const payload = req.body || {};
    const normalized = normalizePublicLeadPayload(payload, req);
    const validationMessage = validatePublicLeadPayload({
      guardianDisplayName: normalized.guardianDisplayName,
      personalInfo: payload.personalInfo || {},
      students: normalized.students,
      payload,
      slots: normalized.slots,
    });

    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const lead = await RegistrationLead.findById(req.params.leadId);
    if (!lead) {
      return res.status(404).json({ message: 'Submission not found.' });
    }
    if (lead.status === 'converted') {
      return res.status(409).json({ message: 'Converted submissions cannot be edited.' });
    }

    Object.assign(lead, normalized.doc);
    lead.status = 'new';
    lead.archive = {
      archivedAt: null,
      archivedBy: null,
      reason: '',
    };
    await lead.save();

    return res.json({
      message: 'Your information has been updated successfully.',
      leadId: lead._id,
    });
  } catch (error) {
    console.error('Update public student registration lead error:', error);
    return res.status(500).json({ message: 'Failed to update registration.' });
  }
});

router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status = 'all', source = 'all', limit = 100 } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;
    if (source && source !== 'all') query.source = source;
    const items = await RegistrationLead.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 100, 1), 300))
      .populate('conversion.guardianUserId', 'firstName lastName email')
      .lean();
    return res.json({ leads: items });
  } catch (error) {
    console.error('List registration leads error:', error);
    return res.status(500).json({ message: 'Failed to load leads.' });
  }
});

router.post('/:leadId/convert', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const lead = await RegistrationLead.findById(req.params.leadId);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }
    if (lead.status === 'converted' && lead.conversion?.guardianUserId) {
      return res.status(409).json({ message: 'Lead already converted.' });
    }

    const existing = await User.findOne({ email: lead.personalInfo.email.toLowerCase().trim() });
    let guardianUser = existing;

    if (guardianUser && guardianUser.role !== 'guardian') {
      return res.status(409).json({ message: 'This email already belongs to a non-guardian account.' });
    }

    if (!guardianUser) {
      const parsedName = splitName(getGuardianDisplayName(lead.personalInfo));
      guardianUser = new User({
        firstName: parsedName.firstName,
        lastName: parsedName.lastName,
        email: lead.personalInfo.email.toLowerCase().trim(),
        password: DEFAULT_PASSWORD,
        role: 'guardian',
        phone: lead.personalInfo.phone || '',
        timezone: lead.personalInfo.timezone || 'Africa/Cairo',
        address: {
          city: lead.address?.city || '',
          state: lead.address?.state || '',
          country: lead.address?.country || '',
        },
        guardianInfo: {
          relationship: 'parent',
          students: [],
        },
        isActive: true,
      });
    }

    if (!guardianUser.guardianInfo) {
      guardianUser.guardianInfo = { relationship: 'parent', students: [] };
    }
    if (!Array.isArray(guardianUser.guardianInfo.students)) {
      guardianUser.guardianInfo.students = [];
    }

    const mappedStudents = (lead.students || []).map((student, index) => ({
      firstName: student.firstName,
      lastName: student.lastName,
      gender: student.gender || 'male',
      dateOfBirth: student.birthDate || null,
      subjects: Array.isArray(student.courses) ? student.courses : [],
      timezone: lead.personalInfo.timezone || 'Africa/Cairo',
      notes: buildStudentNotes({ ...student, _index: index }, lead),
      learningPreferences: [
        `Mode: ${lead.availability?.schedulingMode || 'consecutive'}`,
        summarizeAvailability(lead, index),
        lead.availability?.sharedDuration ? `Preferred duration: ${lead.availability.sharedDuration} minutes` : '',
        Array.isArray(lead?.preferences?.classPreferences) && lead.preferences.classPreferences.length ? `Class preferences: ${lead.preferences.classPreferences.join(', ')}` : '',
        Array.isArray(lead?.preferences?.teacherPreferences) && lead.preferences.teacherPreferences.length ? `Teacher preferences: ${lead.preferences.teacherPreferences.join(', ')}` : '',
      ].filter(Boolean).join(' | '),
      classDuration: deriveStudentDuration(student, lead, index),
      email: '',
      isActive: true,
    }));

    guardianUser.guardianInfo.students.push(...mappedStudents);
    await guardianUser.save();

    lead.status = 'converted';
    lead.conversion = {
      convertedAt: new Date(),
      convertedBy: req.user._id,
      guardianUserId: guardianUser._id,
    };
    await lead.save();

    return res.json({
      message: 'Lead converted to guardian account.',
      guardian: {
        _id: guardianUser._id,
        email: guardianUser.email,
        firstName: guardianUser.firstName,
        lastName: guardianUser.lastName,
      },
      password: DEFAULT_PASSWORD,
    });
  } catch (error) {
    console.error('Convert registration lead error:', error);
    return res.status(500).json({ message: 'Failed to convert lead.' });
  }
});

router.post('/:leadId/archive', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const lead = await RegistrationLead.findById(req.params.leadId);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }
    if (lead.status === 'converted') {
      return res.status(409).json({ message: 'Converted leads cannot be archived.' });
    }

    const shouldArchive = req.body?.archived !== false;
    lead.status = shouldArchive ? 'archived' : 'new';
    lead.archive = shouldArchive
      ? {
          archivedAt: new Date(),
          archivedBy: req.user._id,
          reason: String(req.body?.reason || '').trim(),
        }
      : {
          archivedAt: null,
          archivedBy: null,
          reason: '',
        };
    await lead.save();

    return res.json({
      message: shouldArchive ? 'Lead archived.' : 'Lead restored.',
      lead,
    });
  } catch (error) {
    console.error('Archive registration lead error:', error);
    return res.status(500).json({ message: 'Failed to update lead status.' });
  }
});

module.exports = router;