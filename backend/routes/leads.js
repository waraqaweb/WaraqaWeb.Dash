const express = require('express');
const RegistrationLead = require('../models/RegistrationLead');
const User = require('../models/User');
const EvaluationSession = require('../models/EvaluationSession');
const Class = require('../models/Class');
const Meeting = require('../models/Meeting');
const { MEETING_TYPES, MEETING_STATUSES } = require('../constants/meetingConstants');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { sendMail, loadBrandingAndLogo, baseEmailTemplate } = require('../services/emailService');

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
        epithet: (personalInfo.epithet || '').trim(),
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

    let createdGuardianUser = false;
    if (!guardianUser) {
      createdGuardianUser = true;
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
          epithet: (lead.personalInfo.epithet || '').trim(),
          students: [],
        },
        isActive: true,
      });
    }

    if (!guardianUser.guardianInfo) {
      guardianUser.guardianInfo = { relationship: 'parent', students: [] };
    }
    // Carry the preferred epithet onto the guardian account so emails/WhatsApp greet them correctly.
    if (lead.personalInfo.epithet && !guardianUser.guardianInfo.epithet) {
      guardianUser.guardianInfo.epithet = lead.personalInfo.epithet.trim();
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

    if (createdGuardianUser) {
      notificationService.notifyNewUser(guardianUser).catch(console.error);
    }

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

const ONBOARDING_STEP_FIELDS = {
  contacted: 'onboarding.contactedAt',
  evaluationDone: 'onboarding.evaluationDoneAt',
  classScheduled: 'onboarding.classScheduledAt',
};

router.patch('/:leadId/onboarding', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { step, done } = req.body || {};
    const field = ONBOARDING_STEP_FIELDS[step];
    if (!field) {
      return res.status(400).json({ message: 'Unknown onboarding step.' });
    }

    const lead = await RegistrationLead.findById(req.params.leadId);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found.' });
    }

    if (!lead.onboarding) lead.onboarding = {};
    const key = field.split('.')[1];
    lead.onboarding[key] = done === false ? null : new Date();
    lead.markModified('onboarding');
    await lead.save();

    return res.json({ message: 'Onboarding updated.', lead });
  } catch (error) {
    console.error('Update lead onboarding error:', error);
    return res.status(500).json({ message: 'Failed to update onboarding.' });
  }
});

// ─── Homepage onboarding to-do: recent leads + recent guardian signups ───────
// Surfaces everyone who registered in the last 3 weeks so admins can shepherd
// them from sign-up → first class. Combines the registration funnel (leads)
// with guardians who created their own account directly.
router.get('/onboarding-todos', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const normEmail = (e) => String(e || '').trim().toLowerCase();
    const normName = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');

    // 1) Registration-form leads (within the window).
    const leads = await RegistrationLead.find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .populate('conversion.guardianUserId', 'firstName lastName email')
      .lean();

    // Avoid showing a converted lead twice (once as lead, once as signup).
    const convertedUserIds = new Set(
      leads
        .map((l) => l.conversion?.guardianUserId?._id || l.conversion?.guardianUserId)
        .filter(Boolean)
        .map((id) => String(id))
    );

    // 2) Guardian self-signups (within the window).
    const signupDocs = await User.find({ role: 'guardian', createdAt: { $gte: since } })
      .select('firstName lastName email phone timezone createdAt isActive guardianInfo.students registrationFollowUp')
      .sort({ createdAt: -1 })
      .lean();

    const leadRows = leads.map((l) => ({
      ...l,
      kind: 'lead',
      accountUserId: l.conversion?.guardianUserId?._id || l.conversion?.guardianUserId || null,
      completedAt: l.onboarding?.completedAt || null,
      steps: seedFunnelSteps(l.onboarding?.steps, l.onboarding || {}),
      notes: l.onboardingNotes || [],
      meeting: null,
      isReturning: false,
    }));

    const signupRows = signupDocs
      .filter((u) => !convertedUserIds.has(String(u._id)))
      .map((u) => buildSignupRow(u));

    // 3) Scheduled evaluation meetings = the booking entry point of the funnel.
    //    "later I will wire the website to the dashboard": for now we read any
    //    evaluation meeting that is upcoming, recently happened, or has already
    //    been processed into the historical evaluation flow.
    // Include cancelled meetings too: a meeting that was actively worked in the
    // funnel (then cancelled) must still surface in the Cancelled tab so it can
    // be restored. Stale cancelled no-shows are filtered out below by progress.
    const meetingDocs = await Meeting.find({
      meetingType: MEETING_TYPES.NEW_STUDENT_EVALUATION,
      $or: [
        { scheduledStart: { $gte: since } },
        { status: MEETING_STATUSES.COMPLETED },
        { attendanceStatus: 'attended' },
        { 'onboarding.completedAt': { $exists: true, $ne: null } },
        { 'report.submittedAt': { $exists: true, $ne: null } },
      ],
    })
      .sort({ scheduledStart: -1 })
      .populate('guardianId', 'firstName lastName email phone timezone isActive createdAt guardianInfo.students registrationFollowUp')
      .lean();

    // Look up guardian accounts (any age) for meeting emails so returning
    // guardians — who already have an account and maybe paused — are detected
    // and slotted into the funnel at their existing stage.
    const meetingEmails = [...new Set(
      meetingDocs.map((m) => normEmail(m.bookingPayload?.guardianEmail)).filter(Boolean)
    )];
    const guardiansByEmail = new Map();
    if (meetingEmails.length) {
      const extraGuardians = await User.find({ role: 'guardian', email: { $in: meetingEmails } })
        .select('firstName lastName email phone timezone isActive createdAt guardianInfo.students registrationFollowUp')
        .lean();
      extraGuardians.forEach((g) => guardiansByEmail.set(normEmail(g.email), g));
    }

    // Index emitted rows so a meeting can attach to an existing lead/signup
    // instead of creating a duplicate. We match on email, account id, AND
    // normalized full name so a booking still merges when the email differs or
    // is missing (e.g. a guardian signed up with a slightly different address).
    const rowsByEmail = new Map();
    const rowsByUid = new Map();
    const rowsByName = new Map();
    const indexRow = (row) => {
      const e = normEmail(row.personalInfo?.email);
      if (e) rowsByEmail.set(e, row);
      if (row.accountUserId) rowsByUid.set(String(row.accountUserId), row);
      const n = normName(row.personalInfo?.fullName);
      if (n && !rowsByName.has(n)) rowsByName.set(n, row);
    };
    leadRows.forEach(indexRow);
    signupRows.forEach(indexRow);

    const meetingSummary = (m) => ({
      scheduledStart: m.scheduledStart,
      timezone: m.timezone || m.bookingPayload?.timezone || '',
      status: m.status,
    });

    const meetingRows = [];
    const seenMeetingEmails = new Set();
    const seenMeetingNames = new Set();
    meetingDocs.forEach((m) => {
      const email = normEmail(m.bookingPayload?.guardianEmail);
      const guardianName = m.bookingPayload?.guardianName || m.attendees?.guardianName || '';
      const nameKey = normName(guardianName);
      const guardian = m.guardianId || (email ? guardiansByEmail.get(email) : null);
      const cancelled = m.status === MEETING_STATUSES.CANCELLED;

      // Already represented by a lead or signup row? Attach the booking to it —
      // but never decorate an active funnel row with a cancelled evaluation.
      let existing = email ? rowsByEmail.get(email) : null;
      if (!existing && guardian) existing = rowsByUid.get(String(guardian._id));
      if (!existing && nameKey) existing = rowsByName.get(nameKey);
      if (existing) {
        if (!cancelled) {
          if (!existing.meeting) existing.meeting = meetingSummary(m);
          if (!existing.steps) existing.steps = {};
          if (!existing.steps.booked) existing.steps.booked = m.createdAt || m.scheduledStart;
        }
        return;
      }

      // Keep working a meeting once it has funnel progress, even after its time
      // passes (e.g. right after you mark "Evaluation done", or after it was
      // cancelled). Otherwise only show upcoming evaluations and hide stale
      // bookings that never turned into a lead/account.
      const ob = m.onboarding || {};
      const stepsMap = ob.steps && typeof ob.steps === 'object' ? ob.steps : {};
      const hasProgress = Object.keys(stepsMap).some((k) => k !== 'booked')
        || (Array.isArray(ob.notes) && ob.notes.length > 0)
        || Boolean(ob.completedAt)
        || Boolean(m.report?.submittedAt)
        || m.status === MEETING_STATUSES.COMPLETED
        || m.attendanceStatus === 'attended';
      const isFuture = m.scheduledStart && new Date(m.scheduledStart) >= now;
      if (!isFuture && !hasProgress) return;

      // Only one pure row per email/name (keep the most recent meeting).
      if (email && seenMeetingEmails.has(email)) return;
      if (!email && nameKey && seenMeetingNames.has(nameKey)) return;
      if (email) seenMeetingEmails.add(email);
      if (nameKey) seenMeetingNames.add(nameKey);

      if (guardian && !cancelled) {
        // Returning guardian: existing account, surfaced via a fresh evaluation.
        const row = buildSignupRow(guardian, { isReturning: true, meeting: meetingSummary(m) });
        if (!row.steps.booked) row.steps.booked = m.createdAt || m.scheduledStart;
        signupRows.push(row);
        indexRow(row);
      } else {
        // Brand-new booking with no lead/account yet (or a cancelled meeting that
        // still carries funnel progress, so it can be restored).
        const row = buildMeetingRow(m);
        meetingRows.push(row);
        if (email) rowsByEmail.set(email, row);
        if (nameKey) rowsByName.set(nameKey, row);
      }
    });

    return res.json({ leads: leadRows, signups: signupRows, meetings: meetingRows });
  } catch (error) {
    console.error('Onboarding to-dos error:', error);
    return res.status(500).json({ message: 'Failed to load onboarding to-dos.' });
  }
});

// ─── Unified registration management (works for leads AND guardian signups) ──
// kind ∈ { 'lead', 'signup' }. Leads store onboarding on the RegistrationLead;
// signups store it on the guardian User's registrationFollowUp block.
//
// The funnel is now a flexible map: onboarding.steps / registrationFollowUp.steps
// is { [stepKey]: Date }. These three legacy timestamps are kept in sync so older
// data and any other code that reads them keeps working.
const LEGACY_STEP_MIRROR = {
  booked: 'contactedAt',
  evaluated: 'evaluationDoneAt',
  classesCreated: 'classScheduledAt',
};

// Merge a stored steps map with the three legacy timestamps so old records still
// light up the right funnel steps on the board.
function seedFunnelSteps(steps, legacy = {}) {
  const out = { ...(steps && typeof steps === 'object' ? steps : {}) };
  Object.entries(LEGACY_STEP_MIRROR).forEach(([stepKey, legacyField]) => {
    if (legacy && legacy[legacyField] && !out[stepKey]) out[stepKey] = legacy[legacyField];
  });
  return out;
}

// Build a unified funnel row from a guardian User document. Used both for fresh
// self-signups and for returning guardians detected from a new evaluation
// meeting (pass { isReturning: true, meeting } via `extra`).
function buildSignupRow(u, extra = {}) {
  const rf = u.registrationFollowUp || {};
  return {
    kind: 'signup',
    userId: u._id,
    accountUserId: u._id,
    createdAt: u.createdAt,
    status: u.isActive === false ? 'cancelled' : 'account',
    completedAt: rf.completedAt || null,
    personalInfo: {
      fullName: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
      email: u.email,
      phone: u.phone || '',
      timezone: u.timezone || '',
    },
    students: (u.guardianInfo?.students || []).map((s) => ({
      firstName: s.firstName,
      lastName: s.lastName,
      courses: Array.isArray(s.subjects) ? s.subjects : [],
    })),
    onboarding: {
      contactedAt: rf.contactedAt || null,
      evaluationDoneAt: rf.evaluationDoneAt || null,
      classScheduledAt: rf.classScheduledAt || null,
    },
    steps: seedFunnelSteps(rf.steps, rf),
    notes: Array.isArray(rf.notes) ? rf.notes : [],
    cancelReason: rf.cancelReason || '',
    meeting: null,
    isReturning: false,
    ...extra,
  };
}

// Build a unified funnel row from an evaluation Meeting (the booking entry
// point) when no lead or guardian account exists for it yet.
function buildMeetingRow(m) {
  const ob = m.onboarding || {};
  const bp = m.bookingPayload || {};
  const steps = seedFunnelSteps(ob.steps, {});
  // The booking itself starts the series — light up the "booked" step.
  if (!steps.booked) steps.booked = m.createdAt || m.scheduledStart;
  const splitFullName = (full = '') => {
    const parts = String(full).trim().split(/\s+/).filter(Boolean);
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
  };
  return {
    kind: 'meeting',
    meetingId: m._id,
    accountUserId: null,
    createdAt: m.createdAt || m.scheduledStart,
    status: m.status === MEETING_STATUSES.CANCELLED ? 'cancelled' : 'meeting',
    completedAt: ob.completedAt || null,
    personalInfo: {
      fullName: bp.guardianName || m.attendees?.guardianName || 'Guardian',
      email: bp.guardianEmail || '',
      phone: bp.guardianPhone || '',
      timezone: bp.timezone || m.timezone || '',
    },
    students: (bp.students || []).map((s) => {
      const { firstName, lastName } = splitFullName(s.studentName);
      return { firstName, lastName, courses: [] };
    }),
    onboarding: {},
    steps,
    notes: Array.isArray(ob.notes) ? ob.notes : [],
    cancelReason: m.cancellation?.reason || '',
    meeting: {
      scheduledStart: m.scheduledStart,
      timezone: m.timezone || bp.timezone || '',
      status: m.status,
    },
    isReturning: false,
  };
}

const actorName = (req) => `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || 'Admin';

async function loadRegistration(kind, id) {
  if (kind === 'lead') {
    const doc = await RegistrationLead.findById(id);
    return doc ? { kind, doc } : null;
  }
  if (kind === 'signup') {
    const doc = await User.findById(id);
    return doc && doc.role === 'guardian' ? { kind, doc } : null;
  }
  if (kind === 'meeting') {
    const doc = await Meeting.findById(id);
    return doc ? { kind, doc } : null;
  }
  return null;
}

// Which document field holds the funnel state for each kind. Leads and meetings
// both keep it under `onboarding`; guardian signups under `registrationFollowUp`.
const onboardingBlock = (kind) => (kind === 'signup' ? 'registrationFollowUp' : 'onboarding');

const regEmailOf = (kind, doc) => {
  if (kind === 'lead') return doc.personalInfo?.email;
  if (kind === 'meeting') return doc.bookingPayload?.guardianEmail;
  return doc.email;
};
const regNameOf = (kind, doc) => {
  if (kind === 'lead') {
    return doc.personalInfo?.fullName || doc.personalInfo?.guardianName || `${doc.personalInfo?.firstName || ''} ${doc.personalInfo?.lastName || ''}`.trim();
  }
  if (kind === 'meeting') {
    return doc.bookingPayload?.guardianName || doc.attendees?.guardianName || '';
  }
  return `${doc.firstName || ''} ${doc.lastName || ''}`.trim();
};

// Append a follow-up note to whichever block a registration kind uses.
const pushRegistrationNote = (kind, doc, note) => {
  if (kind === 'lead') {
    if (!Array.isArray(doc.onboardingNotes)) doc.onboardingNotes = [];
    doc.onboardingNotes.push(note);
  } else if (kind === 'meeting') {
    if (!doc.onboarding) doc.onboarding = {};
    if (!Array.isArray(doc.onboarding.notes)) doc.onboarding.notes = [];
    doc.onboarding.notes.push(note);
    doc.markModified('onboarding');
  } else {
    if (!doc.registrationFollowUp) doc.registrationFollowUp = {};
    if (!Array.isArray(doc.registrationFollowUp.notes)) doc.registrationFollowUp.notes = [];
    doc.registrationFollowUp.notes.push(note);
    doc.markModified('registrationFollowUp');
  }
};

// Toggle any onboarding step (writes into the flexible steps map).
router.post('/registration/:kind/:id/step', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const step = String(req.body?.step || '').trim();
    const { done } = req.body || {};
    if (!step) return res.status(400).json({ message: 'Step is required.' });

    const found = await loadRegistration(req.params.kind, req.params.id);
    if (!found) return res.status(404).json({ message: 'Registration not found.' });
    const { kind, doc } = found;
    const stamp = done === false ? null : new Date();
    const block = onboardingBlock(kind);

    if (!doc[block]) doc[block] = {};
    if (!doc[block].steps || typeof doc[block].steps !== 'object') doc[block].steps = {};
    if (stamp) doc[block].steps[step] = stamp;
    else delete doc[block].steps[step];

    // Keep the three legacy timestamps mirrored.
    if (LEGACY_STEP_MIRROR[step]) doc[block][LEGACY_STEP_MIRROR[step]] = stamp;

    doc.markModified(block);
    await doc.save();
    return res.json({ message: 'Step updated.' });
  } catch (error) {
    console.error('Registration step error:', error);
    return res.status(500).json({ message: 'Failed to update step.' });
  }
});

// Mark the whole registration complete (paid + done) and close it out, or reopen.
router.post('/registration/:kind/:id/complete', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const complete = req.body?.complete !== false;
    const found = await loadRegistration(req.params.kind, req.params.id);
    if (!found) return res.status(404).json({ message: 'Registration not found.' });
    const { kind, doc } = found;
    const block = onboardingBlock(kind);
    if (!doc[block]) doc[block] = {};
    doc[block].completedAt = complete ? new Date() : null;
    doc.markModified(block);
    await doc.save();
    return res.json({ message: complete ? 'Registration completed.' : 'Registration reopened.' });
  } catch (error) {
    console.error('Registration complete error:', error);
    return res.status(500).json({ message: 'Failed to update completion.' });
  }
});

// Lazily load the heavy joins for ONE registration (only when the modal opens):
// the linked evaluation's availability (raw slots + timezone) and whether each
// student already has classes scheduled after their expected start date.
const firstNameOf = (value = '') => String(value || '').trim().split(/\s+/)[0] || '';
const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Tolerant name matching for the onboarding reminder: registrations frequently
// hold only a first name, sometimes mis-spelled (e.g. "Mohamed" vs "Mohammed",
// "Ahmed" vs "Ahmad"). We normalise away case/diacritics/punctuation and allow
// a prefix match or a small edit distance so the right class is still found.
const normalizeName = (value = '') =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const nameEditDistance = (a = '', b = '') => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        prevDiag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prevDiag = tmp;
    }
  }
  return prev[b.length];
};

const namesMatch = (a = '', b = '') => {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Partial names: one side is just the first part of the other.
  if (na.length >= 3 && nb.length >= 3 && (na.startsWith(nb) || nb.startsWith(na))) return true;
  // Spelling variants: allow up to 2 edits on longer names, 1 on short ones.
  const threshold = Math.min(na.length, nb.length) >= 6 ? 2 : 1;
  return nameEditDistance(na, nb) <= threshold;
};

router.get('/registration/:kind/:id/details', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const found = await loadRegistration(req.params.kind, req.params.id);
    if (!found) return res.status(404).json({ message: 'Registration not found.' });
    const { kind, doc } = found;
    const email = regEmailOf(kind, doc);
    let guardianUserId = null;
    if (kind === 'signup') guardianUserId = doc._id;
    else if (kind === 'meeting') guardianUserId = doc.guardianId || null;
    else guardianUserId = doc.conversion?.guardianUserId || null;

    // A returning guardian booking a new evaluation may not have linked their
    // account on the meeting — fall back to matching a guardian by email.
    if (!guardianUserId && kind === 'meeting' && email) {
      const match = await User.findOne({ role: 'guardian', email: new RegExp(`^${escapeRegExp(email)}$`, 'i') })
        .select('_id')
        .lean();
      if (match) guardianUserId = match._id;
    }

    // Find the most recent evaluation linked by guardian user or contact email.
    const or = [];
    if (guardianUserId) or.push({ 'students.guardianUser': guardianUserId });
    if (email) or.push({ 'students.contactEmail': new RegExp(`^${escapeRegExp(email)}$`, 'i') });
    let evaluation = null;
    if (or.length) {
      evaluation = await EvaluationSession.findOne({ $or: or })
        .sort({ startedAt: -1, createdAt: -1 })
        .lean();
    }

    const evalStudents = (evaluation?.students || []).map((s) => ({
      name: s.name || '',
      age: s.age || null,
      desiredSubjects: Array.isArray(s.desiredSubjects) ? s.desiredSubjects : [],
      availabilitySlots: Array.isArray(s.availabilitySlots) ? s.availabilitySlots : [],
      availabilityTimezone: s.availabilityTimezone || '',
      availabilityText: s.availability || '',
      expectedStartDate: s.expectedStartDate || null,
      recommendedLevel: s.recommendedLevel || '',
    }));

    // Build the list of student first names to check for scheduled classes.
    let names = evalStudents.map((s) => firstNameOf(s.name)).filter(Boolean);
    if (!names.length && doc.guardianInfo?.students?.length) {
      names = doc.guardianInfo.students.map((s) => firstNameOf(s.firstName)).filter(Boolean);
    }
    if (!names.length && Array.isArray(doc.students)) {
      names = doc.students.map((s) => firstNameOf(s.firstName)).filter(Boolean);
    }
    if (!names.length && Array.isArray(doc.bookingPayload?.students)) {
      names = doc.bookingPayload.students.map((s) => firstNameOf(s.studentName)).filter(Boolean);
    }
    names = [...new Set(names)];

    // Detect which evaluated students already exist under the guardian's
    // account. A returning guardian restarting classes usually keeps the same
    // students; a new child shows up as a name not yet on the account.
    let existingFirstNames = [];
    if (kind === 'signup' && Array.isArray(doc.guardianInfo?.students)) {
      existingFirstNames = doc.guardianInfo.students.map((s) => firstNameOf(s.firstName).toLowerCase()).filter(Boolean);
    } else if (guardianUserId) {
      const gUser = await User.findById(guardianUserId).select('guardianInfo.students').lean();
      existingFirstNames = (gUser?.guardianInfo?.students || []).map((s) => firstNameOf(s.firstName).toLowerCase()).filter(Boolean);
    }
    const existingSet = new Set(existingFirstNames);

    let classesByStudent = [];
    let firstUpcomingClass = null;
    if (guardianUserId && names.length) {
      const classes = await Class.find({
        'student.guardianId': guardianUserId,
        status: { $nin: ['cancelled', 'cancelled_by_admin', 'cancelled_by_teacher', 'cancelled_by_student', 'cancelled_by_guardian', 'pattern'] },
      })
        .select('student.studentName scheduledDate status timezone')
        .sort({ scheduledDate: 1 })
        .lean();

      const now = new Date();
      const isExistingStudentClass = (c) => existingSet.has(firstNameOf(c.student?.studentName).toLowerCase());

      classesByStudent = names.map((fn) => {
        const matched = classes.filter((c) => namesMatch(c.student?.studentName, fn));
        const upcoming = matched.filter((c) => c.scheduledDate && new Date(c.scheduledDate) >= now);
        const next = upcoming[0] || matched[0] || null;
        return {
          name: fn,
          isExistingStudent: existingSet.has(fn.toLowerCase()),
          hasClasses: matched.length > 0,
          totalCount: matched.length,
          upcomingCount: upcoming.length,
          nextClassAt: next?.scheduledDate || null,
          timezone: next?.timezone || null,
        };
      });

      // The onboarding reminder is about the FIRST class. Find the earliest
      // upcoming class for this guardian, preferring a newly-added student
      // (returning guardians may already have ongoing classes for older kids).
      const upcomingAll = classes.filter((c) => c.scheduledDate && new Date(c.scheduledDate) >= now);
      const newStudentUpcoming = upcomingAll.filter((c) => !isExistingStudentClass(c));
      const firstDoc = newStudentUpcoming[0] || upcomingAll[0] || classes[0] || null;
      if (firstDoc) {
        firstUpcomingClass = {
          scheduledDate: firstDoc.scheduledDate,
          timezone: firstDoc.timezone || 'Africa/Cairo',
          studentName: firstDoc.student?.studentName || '',
        };
      }
    } else {
      classesByStudent = names.map((fn) => ({
        name: fn,
        isExistingStudent: existingSet.has(fn.toLowerCase()),
        hasClasses: false,
        totalCount: 0,
        upcomingCount: 0,
        nextClassAt: null,
        timezone: null,
      }));
    }

    return res.json({
      guardianUserId: guardianUserId || null,
      evaluation: evaluation
        ? { _id: evaluation._id, title: evaluation.title || '', status: evaluation.status || '', students: evalStudents }
        : null,
      classesByStudent,
      firstUpcomingClass,
    });
  } catch (error) {
    console.error('Registration details error:', error);
    return res.status(500).json({ message: 'Failed to load registration details.' });
  }
});

// Add a follow-up note.
router.post('/registration/:kind/:id/note', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ message: 'Note text is required.' });

    const found = await loadRegistration(req.params.kind, req.params.id);
    if (!found) return res.status(404).json({ message: 'Registration not found.' });
    const { kind, doc } = found;
    const note = { text: text.slice(0, 2000), by: req.user._id, byName: actorName(req), at: new Date() };

    pushRegistrationNote(kind, doc, note);
    await doc.save();
    return res.json({ message: 'Note added.', note });
  } catch (error) {
    console.error('Registration note error:', error);
    return res.status(500).json({ message: 'Failed to add note.' });
  }
});

// Send a custom email to the guardian and record it as a note.
router.post('/registration/:kind/:id/email', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const subject = String(req.body?.subject || '').trim();
    const body = String(req.body?.body || '').trim();
    if (!subject || !body) return res.status(400).json({ message: 'Subject and message are required.' });

    const found = await loadRegistration(req.params.kind, req.params.id);
    if (!found) return res.status(404).json({ message: 'Registration not found.' });
    const { kind, doc } = found;
    const to = regEmailOf(kind, doc);
    if (!to) return res.status(400).json({ message: 'No email address on file.' });

    const name = regNameOf(kind, doc) || 'there';
    const branding = await loadBrandingAndLogo();
    const safeBody = body
      .split('\n')
      .map((line) => (line.trim() ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#1f2937;">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : ''))
      .join('');
    const html = baseEmailTemplate({
      preheader: subject,
      branding,
      body: `<p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111827;">Assalamu alaikum ${name},</p>${safeBody}`,
    });

    await sendMail({ to, subject, html, text: body });

    // Record the email as a note for the activity trail.
    const note = { text: `Email sent: ${subject}`, by: req.user._id, byName: actorName(req), at: new Date() };
    pushRegistrationNote(kind, doc, note);
    await doc.save();

    return res.json({ message: 'Email sent.', note });
  } catch (error) {
    console.error('Registration email error:', error);
    return res.status(500).json({ message: 'Failed to send email.' });
  }
});

// Mark a registration as cancelled (or restore it).
router.post('/registration/:kind/:id/cancel', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const cancel = req.body?.cancel !== false;
    const reason = String(req.body?.reason || '').trim().slice(0, 500);

    const found = await loadRegistration(req.params.kind, req.params.id);
    if (!found) return res.status(404).json({ message: 'Registration not found.' });
    const { kind, doc } = found;

    if (kind === 'lead') {
      doc.status = cancel ? 'archived' : 'new';
      doc.archive = cancel
        ? { archivedAt: new Date(), archivedBy: req.user._id, reason }
        : { archivedAt: null, archivedBy: null, reason: '' };
    } else if (kind === 'meeting') {
      doc.status = cancel ? MEETING_STATUSES.CANCELLED : MEETING_STATUSES.SCHEDULED;
      doc.cancellation = cancel
        ? { reason, cancelledBy: req.user._id, cancelledAt: new Date() }
        : { reason: '', cancelledBy: null, cancelledAt: null };
    } else {
      doc.isActive = !cancel;
      if (!doc.registrationFollowUp) doc.registrationFollowUp = {};
      doc.registrationFollowUp.cancelledAt = cancel ? new Date() : null;
      doc.registrationFollowUp.cancelReason = cancel ? reason : '';
      doc.markModified('registrationFollowUp');
    }
    await doc.save();
    return res.json({ message: cancel ? 'Marked as cancelled.' : 'Restored.' });
  } catch (error) {
    console.error('Registration cancel error:', error);
    return res.status(500).json({ message: 'Failed to update status.' });
  }
});

module.exports = router;