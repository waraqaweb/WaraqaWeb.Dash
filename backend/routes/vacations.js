// routes/vacations.js
const express = require('express');
const router = express.Router();
const Vacation = require('../models/Vacation');
const Class = require('../models/Class');
const User = require('../models/User');
const Student = require('../models/Student');
const { requireAdmin, requireAuth } = require('../middleware/auth');
const vacationService = require('../services/vacationService');
const notificationService = require('../services/notificationService');
const { formatTimeInTimezone, DEFAULT_TIMEZONE } = require('../utils/timezoneUtils');

function computeLifecycleStatus(vacationDoc) {
  const now = new Date();
  const status = vacationDoc.status || vacationDoc.approvalStatus;
  const start = vacationDoc.startDate ? new Date(vacationDoc.startDate) : null;
  const effectiveEnd = vacationDoc.actualEndDate ? new Date(vacationDoc.actualEndDate) : (vacationDoc.endDate ? new Date(vacationDoc.endDate) : null);

  if (status === 'rejected') return 'rejected';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'ended') return 'ended';
  if (status === 'active') return 'active';
  if (status === 'approved') {
    if (start && start <= now && effectiveEnd && effectiveEnd >= now) return 'active';
    if (effectiveEnd && effectiveEnd < now) return 'ended';
    return 'approved';
  }
  if (status === 'pending') return 'pending';
  if (start && start > now) return 'approved';
  return status || 'pending';
}

function serializeVacation(vacation) {
  const obj = vacation.toObject({ virtuals: true });
  obj.lifecycleStatus = computeLifecycleStatus(obj);
  obj.effectiveEndDate = obj.actualEndDate || obj.endDate;
  obj.isActive = obj.lifecycleStatus === 'active';
  if (!obj.status) {
    obj.status = obj.lifecycleStatus;
  }
  return obj;
}

function toLocalDayStart(dateValue) {
  const d = dateValue instanceof Date ? new Date(dateValue) : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function toLocalDayEnd(dateValue) {
  const d = dateValue instanceof Date ? new Date(dateValue) : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(23, 59, 59, 999);
  return d;
}

// Search users by name or email
router.get('/search-users', requireAuth, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.json({ users: [] });
    }

    const users = await User.find({
      $or: [
        { fullName: new RegExp(query, 'i') },
        { email: new RegExp(query, 'i') }
      ]
    }).select('_id fullName email role').limit(10);

    res.json({ users });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create a vacation (teacher or student)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { user, role, startDate, endDate, reason } = req.body;

    // Validate required fields
    if (!user || !role || !startDate || !endDate || !reason) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    // Validate dates
    // Normalize to day start/end to support date-only inputs
    const start = toLocalDayStart(startDate);
    const end = toLocalDayEnd(endDate);
    const now = new Date();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    if (!start || !end) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    // Allow starting today
    if (start < startOfToday) {
      return res.status(400).json({ message: 'Start date cannot be in the past' });
    }

    if (end < start) {
      return res.status(400).json({ message: 'End date must be after start date' });
    }

    // Create vacation request
    const vacation = new Vacation({
      user,
      role,
      startDate: start,
      endDate: end,
      reason,
      requestedBy: req.user?._id,
      substitutes: [], // Empty array by default
      status: 'pending',
      approvalStatus: 'pending', // All new requests start as pending
    });

    await vacation.save();

    // Notify admins of new vacation request (per-admin timezone)
    const [vacationUser, admins] = await Promise.all([
      User.findById(user).select('fullName email'),
      User.find({ role: 'admin', isActive: true }).select('_id timezone')
    ]);

    const requesterName = req.user?.fullName || req.user?.email || 'A user';
    const vacationUserName = vacationUser?.fullName || vacationUser?.email || 'the user';

    await Promise.allSettled(
      (admins || []).map((admin) => {
        const tz = admin?.timezone || DEFAULT_TIMEZONE;
        const startLabel = formatTimeInTimezone(start, tz, 'DD MMM YYYY hh:mm A');
        const endLabel = formatTimeInTimezone(end, tz, 'DD MMM YYYY hh:mm A');
        return notificationService.createNotification({
          userId: admin._id,
          title: 'Vacation request submitted',
          message: `${requesterName} submitted a vacation request for ${vacationUserName} (${startLabel} → ${endLabel}).`,
          type: 'request',
          relatedTo: 'vacation',
          relatedId: vacation._id,
          metadata: {
            kind: 'vacation_request_submitted',
            vacationId: String(vacation._id),
            requesterId: String(req.user?._id || ''),
            vacationUserId: String(user),
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            recipientTimezone: tz
          }
        });
      })
    );

    // Notify the user of submission
    {
      const requesterTz = req.user?.timezone || DEFAULT_TIMEZONE;
      const startLabel = formatTimeInTimezone(start, requesterTz, 'DD MMM YYYY hh:mm A');
      const endLabel = formatTimeInTimezone(end, requesterTz, 'DD MMM YYYY hh:mm A');
      await notificationService.createNotification({
        userId: req.user._id,
        title: 'Vacation request submitted',
        message: `Your vacation request (${startLabel} → ${endLabel}) was submitted and is awaiting approval.`,
        type: 'request',
        relatedTo: 'vacation',
        relatedId: vacation._id,
        actionRequired: false,
        metadata: {
          kind: 'vacation_request_submitted',
          vacationId: String(vacation._id),
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          recipientTimezone: requesterTz
        }
      });
    }

    // Send response
    res.status(201).json({ 
      message: 'Vacation request submitted successfully. Awaiting approval.', 
      vacation: serializeVacation(vacation) 
    });
  } catch (err) {
    console.error('Create vacation error:', err);
    res.status(400).json({ message: err.message || 'Failed to create vacation request' });
  }
});

// Guardian: create student vacation requests for multiple active students
router.post('/guardian-students', requireAuth, async (req, res) => {
  try {
    if (req.user?.role !== 'guardian') {
      return res.status(403).json({ message: 'Only guardians can submit student vacation requests' });
    }

    const { studentIds, startDate, endDate, reason } = req.body;
    if (!Array.isArray(studentIds) || studentIds.length === 0 || !startDate || !endDate || !reason) {
      return res.status(400).json({ message: 'Please provide studentIds, startDate, endDate, and reason' });
    }

    const start = toLocalDayStart(startDate);
    const end = toLocalDayEnd(endDate);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    if (!start || !end) {
      return res.status(400).json({ message: 'Invalid date format' });
    }
    if (start < startOfToday) {
      return res.status(400).json({ message: 'Start date cannot be in the past' });
    }
    if (end < start) {
      return res.status(400).json({ message: 'End date must be after start date' });
    }

    const guardianId = req.user._id;
    const guardian = await User.findById(guardianId).select('guardianInfo.students').lean();
    const embeddedStudents = Array.isArray(guardian?.guardianInfo?.students) ? guardian.guardianInfo.students : [];
    const embeddedById = new Map(embeddedStudents.map(s => [String(s?._id), s]));

    const requestedIds = Array.from(new Set(studentIds.map((id) => String(id))));

    // Allow students that exist either as embedded guardianInfo students or in Student collection
    const studentDocs = await Student.find({
      _id: { $in: requestedIds },
      guardian: guardianId,
      isActive: { $ne: false }
    }).select('firstName lastName fullName').lean();
    const studentDocById = new Map((studentDocs || []).map(s => [String(s._id), s]));

    const invalid = [];
    const normalized = [];
    for (const id of requestedIds) {
      const embedded = embeddedById.get(id);
      const doc = studentDocById.get(id);
      const isActive = embedded ? (embedded.isActive !== false) : true;
      if (!embedded && !doc) {
        invalid.push(id);
        continue;
      }
      if (embedded && !isActive) {
        invalid.push(id);
        continue;
      }
      const name = (embedded?.studentName || embedded?.fullName || embedded?.name || embedded?.firstName)
        ? String(embedded?.studentName || embedded?.fullName || embedded?.name || `${embedded?.firstName || ''} ${embedded?.lastName || ''}`).trim()
        : ((doc?.fullName || `${doc?.firstName || ''} ${doc?.lastName || ''}`).replace(/\s+/g, ' ').trim());
      normalized.push({ id, name: name || 'Student' });
    }

    if (invalid.length) {
      return res.status(400).json({ message: 'Some students are not valid/active for this guardian', invalidStudentIds: invalid });
    }

    const vacationsToCreate = normalized.map((s) => ({
      user: s.id,
      role: 'student',
      guardianId,
      userName: s.name,
      startDate: start,
      endDate: end,
      reason,
      requestedBy: guardianId,
      substitutes: [],
      status: 'pending',
      approvalStatus: 'pending'
    }));

    const created = await Vacation.insertMany(vacationsToCreate, { ordered: true });

    // Notify admins (single notification per admin, includes count)
    const admins = await User.find({ role: 'admin', isActive: true }).select('_id timezone').lean();
    const requesterName = req.user?.fullName || req.user?.email || 'A guardian';
    await Promise.allSettled(
      (admins || []).map((admin) => {
        const tz = admin?.timezone || DEFAULT_TIMEZONE;
        const startLabel = formatTimeInTimezone(start, tz, 'DD MMM YYYY');
        const endLabel = formatTimeInTimezone(end, tz, 'DD MMM YYYY');
        return notificationService.createNotification({
          userId: admin._id,
          title: 'Student vacation request submitted',
          message: `${requesterName} submitted a vacation request for ${normalized.length} student${normalized.length === 1 ? '' : 's'} (${startLabel} → ${endLabel}).`,
          type: 'request',
          relatedTo: 'vacation',
          relatedId: created?.[0]?._id,
          metadata: {
            kind: 'student_vacation_request_submitted',
            requesterId: String(guardianId),
            vacationIds: (created || []).map(v => String(v._id)),
            studentIds: normalized.map(s => String(s.id)),
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            recipientTimezone: tz
          }
        });
      })
    );

    // Notify guardian
    {
      const tz = req.user?.timezone || DEFAULT_TIMEZONE;
      const startLabel = formatTimeInTimezone(start, tz, 'DD MMM YYYY');
      const endLabel = formatTimeInTimezone(end, tz, 'DD MMM YYYY');
      await notificationService.createNotification({
        userId: guardianId,
        title: 'Vacation request submitted',
        message: `Your vacation request (${startLabel} → ${endLabel}) was submitted for ${normalized.length} student${normalized.length === 1 ? '' : 's'} and is awaiting approval.`,
        type: 'request',
        relatedTo: 'vacation',
        relatedId: created?.[0]?._id,
        actionRequired: false,
        metadata: {
          kind: 'student_vacation_request_submitted',
          vacationIds: (created || []).map(v => String(v._id)),
          studentIds: normalized.map(s => String(s.id)),
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          recipientTimezone: tz
        }
      });
    }

    return res.status(201).json({ message: 'Student vacation request(s) submitted successfully. Awaiting approval.', vacations: (created || []).map(serializeVacation) });
  } catch (err) {
    console.error('Create guardian student vacation error:', err);
    return res.status(400).json({ message: err.message || 'Failed to create student vacation request(s)' });
  }
});

// Guardian: list student vacations for all of this guardian's students
router.get('/guardian', requireAuth, async (req, res) => {
  try {
    if (req.user?.role !== 'guardian') {
      return res.status(403).json({ message: 'Only guardians can access this endpoint' });
    }
    const guardianId = req.user._id;

    // Try to resolve student ids from embedded list, classes, and Student collection
    const guardian = await User.findById(guardianId).select('guardianInfo.students').lean();
    const embeddedStudents = Array.isArray(guardian?.guardianInfo?.students) ? guardian.guardianInfo.students : [];
    const embeddedIds = embeddedStudents.map(s => s?._id).filter(Boolean).map(id => String(id));

    const classAgg = await Class.aggregate([
      { $match: { $or: [ { 'student.guardianId': guardianId }, { 'student.studentId': guardianId } ] } },
      { $group: { _id: '$student.studentId' } },
      { $limit: 500 }
    ]).exec();
    const classIds = (classAgg || []).map(r => r?._id).filter(Boolean).map(id => String(id));

    const studentDocs = await Student.find({ guardian: guardianId, isActive: { $ne: false } }).select('_id').lean();
    const docIds = (studentDocs || []).map(s => String(s._id));

    const studentIdSet = new Set([ ...embeddedIds, ...classIds, ...docIds ]);
    const studentIds = Array.from(studentIdSet);

    const vacations = await Vacation.find({ role: 'student', user: { $in: studentIds } }).sort({ createdAt: -1 }).lean();
    return res.json({ vacations: (vacations || []).map(v => ({ ...v, lifecycleStatus: computeLifecycleStatus(v), effectiveEndDate: v.actualEndDate || v.endDate })) });
  } catch (err) {
    console.error('Guardian vacations list error:', err);
    return res.status(500).json({ message: 'Failed to load guardian vacations' });
  }
});

// List vacations for a user (teacher or student)
router.get('/user/:userId', requireAuth, async (req, res) => {
  try {
    const vacations = await Vacation.find({ user: req.params.userId });
    res.json({ vacations: vacations.map(serializeVacation) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// List all vacations (admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const vacations = await Vacation.find()
      .populate('user')
      .populate('substitutes.studentId')
      .populate('substitutes.substituteTeacherId');

    const serialized = vacations.map(serializeVacation);

    // Enrich student vacations with impacted teacher names for admin display.
    // (Student vacations store `user` as Student/ObjectId, so populate('user') will be null.)
    await Promise.all(
      (serialized || []).map(async (vac) => {
        if (!vac || vac.role !== 'student' || !vac.user) return;

        const windowStart = toLocalDayStart(vac.startDate) || vac.startDate;
        const windowEnd = toLocalDayEnd(vac.effectiveEndDate || vac.actualEndDate || vac.endDate) || (vac.effectiveEndDate || vac.actualEndDate || vac.endDate);

        const classes = await Class.find({
          'student.studentId': vac.user,
          scheduledDate: { $gte: windowStart, $lte: windowEnd },
          status: { $ne: 'pattern' }
        })
          .select('teacher')
          .lean();

        const teacherIds = Array.from(
          new Set((classes || []).map((c) => String(c.teacher)).filter(Boolean))
        );

        if (teacherIds.length === 0) {
          vac.impactedTeachers = [];
          return;
        }

        const teachers = await User.find({ _id: { $in: teacherIds } })
          .select('_id firstName lastName fullName email')
          .lean();

        vac.impactedTeachers = (teachers || []).map((t) => ({
          _id: t._id,
          name: t.fullName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.email || 'Unknown teacher'
        }));
      })
    );

    res.json({ vacations: serialized });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/teacher/:teacherId/impacted-students', requireAuth, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { start, end, vacationId } = req.query;

    if (!start || !end) {
      return res.status(400).json({ message: 'start and end parameters are required' });
    }

    const requesterId = String(req.user._id || req.user.id || req.user.userId || '');
    const isAdmin = req.user.role === 'admin';
    const isSelfRequest = req.user.role === 'teacher' && requesterId === String(teacherId);

    if (!isAdmin && !isSelfRequest) {
      return res.status(403).json({ message: 'Not authorized to view impacted students for this teacher' });
    }

    let existingMappings = [];
    if (vacationId) {
      const existingVacation = await Vacation.findById(vacationId).select('user substitutes role');
      if (existingVacation && existingVacation.role === 'teacher' && String(existingVacation.user) === String(teacherId)) {
        existingMappings = existingVacation.substitutes || [];
      }
    }

    const impact = await vacationService.getTeacherVacationImpact({
      teacherId,
      startDate: start,
      endDate: end,
      existingMappings
    });

    res.json({ impact });
  } catch (err) {
    console.error('Error fetching impacted students:', err);
    res.status(500).json({ message: 'Failed to determine impacted students' });
  }
});

router.get('/:vacationId/impact', requireAuth, async (req, res) => {
  try {
    const { vacationId } = req.params;
    const vacation = await Vacation.findById(vacationId)
      .populate('user')
      .populate('substitutes.studentId')
      .populate('substitutes.substituteTeacherId');

    if (!vacation) {
      return res.status(404).json({ message: 'Vacation not found' });
    }

    const requesterId = String(req.user._id || req.user.id || req.user.userId || '');
    const vacationOwnerId = String(vacation.user?._id || vacation.user);
    const isAdmin = req.user.role === 'admin';
    const isOwnerTeacher = req.user.role === 'teacher' && vacation.role === 'teacher' && requesterId === vacationOwnerId;

    let isOwnerGuardian = false;
    if (vacation.role === 'student' && req.user.role === 'guardian') {
      const vacGuardianId = String(vacation.guardianId || '');
      if (vacGuardianId && vacGuardianId === requesterId) {
        isOwnerGuardian = true;
      }
    }

    if (!isAdmin && !isOwnerTeacher && !isOwnerGuardian) {
      return res.status(403).json({ message: 'Not authorized to view this vacation impact' });
    }

    let impact = null;
    if (vacation.role === 'teacher') {
      impact = await vacationService.getTeacherVacationImpact({
        teacherId: vacationOwnerId,
        startDate: vacation.startDate,
        endDate: vacation.actualEndDate || vacation.endDate,
        existingMappings: vacation.substitutes || []
      });
    } else if (vacation.role === 'student') {
      const studentId = String(vacation.user);
      const start = toLocalDayStart(vacation.startDate) || vacation.startDate;
      const endRaw = vacation.actualEndDate || vacation.endDate;
      const end = toLocalDayEnd(endRaw) || endRaw;

      const classes = await Class.find({
        'student.studentId': studentId,
        scheduledDate: { $gte: start, $lte: end },
        status: { $ne: 'pattern' }
      })
        .populate('teacher', 'firstName lastName fullName email')
        .select('_id scheduledDate duration subject teacher student')
        .sort({ scheduledDate: 1 })
        .lean();

      const totalMinutes = (classes || []).reduce((sum, cls) => sum + (Number(cls.duration) || 0), 0);

      const guardianId = vacation.guardianId || classes?.[0]?.student?.guardianId || null;
      const guardian = guardianId
        ? await User.findById(guardianId).select('firstName lastName fullName email').lean()
        : null;

      const guardianName = guardian
        ? (guardian.fullName || `${guardian.firstName || ''} ${guardian.lastName || ''}`.trim())
        : null;

      const mappedClasses = (classes || []).map((cls) => ({
        classId: cls._id,
        scheduledDate: cls.scheduledDate,
        duration: cls.duration,
        subject: cls.subject,
        teacherName: cls.teacher
          ? (cls.teacher.fullName || `${cls.teacher.firstName || ''} ${cls.teacher.lastName || ''}`.trim() || cls.teacher.email)
          : null
      }));

      const firstClassStart = mappedClasses.length ? mappedClasses[0].scheduledDate : null;
      const last = mappedClasses.length ? mappedClasses[mappedClasses.length - 1] : null;
      const lastClassEnd = last && last.scheduledDate
        ? new Date(new Date(last.scheduledDate).getTime() + (Number(last.duration) || 0) * 60 * 1000)
        : null;

      const studentName = vacation.userName || classes?.[0]?.student?.studentName || 'Student';

      impact = {
        totalStudents: 1,
        totalClasses: mappedClasses.length,
        totalMinutes,
        students: [
          {
            studentId,
            studentName,
            guardianName,
            guardianEmail: guardian?.email || null,
            configuredHandling: { handling: 'cancel' },
            firstClassStart,
            lastClassEnd,
            classes: mappedClasses
          }
        ]
      };
    }

    res.json({
      vacation: serializeVacation(vacation),
      impact
    });
  } catch (err) {
    console.error('Error fetching vacation impact:', err);
    res.status(500).json({ message: 'Failed to load vacation impact' });
  }
});

// Assign substitutes for a teacher's vacation
router.post('/:vacationId/assign', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { substitutes } = req.body; // [{ studentId, substituteTeacherId }]
    const vacation = await Vacation.findById(req.params.vacationId);
    
    if (!vacation) {
      return res.status(404).json({ message: 'Vacation not found' });
    }
    
    if (vacation.role !== 'teacher') {
      return res.status(400).json({ message: 'Can only assign substitutes to teacher vacations' });
    }

    if (vacation.approvalStatus !== 'approved') {
      return res.status(400).json({ message: 'Can only assign substitutes to approved vacations' });
    }

  vacation.substitutes = substitutes;
  await vacation.save();
  // Re-apply vacation logic to classes
  const impactSummary = await vacationService.applyVacationToClasses(vacation);
  res.json({ message: 'Substitutes assigned successfully', vacation: serializeVacation(vacation), impactSummary });
  } catch (err) {
    console.error('Error assigning substitutes:', err);
    res.status(500).json({ message: 'Failed to assign substitutes' });
  }
});

// Approve or reject a vacation request
router.post('/:vacationId/approval', requireAuth, requireAdmin, async (req, res) => {
  try {
  const { approved, rejectionReason } = req.body;
  const vacation = await Vacation.findById(req.params.vacationId).populate('user');
  let impactSummary = null;
    
    if (!vacation) {
      return res.status(404).json({ message: 'Vacation request not found' });
    }

    vacation.approvalStatus = approved ? 'approved' : 'rejected';
    vacation.status = approved ? 'approved' : 'rejected';
    vacation.approvedBy = req.user._id;
    vacation.approvedAt = new Date();
    vacation.actualEndDate = vacation.endDate;
    
    if (!approved) {
      vacation.rejectionReason = rejectionReason;
    }

    // Save vacation first
    await vacation.save();

    // Create notification for the teacher (student vacations may not map to User)
    if (vacation.role === 'teacher') {
      await notificationService.createVacationStatusNotification(vacation, req.user);
    }

    if (approved) {
      try {
        // For student vacations, collect impacted teachers/guardian before applying changes
        let studentContext = null;
        let impactedTeacherIds = [];
        let guardianId = vacation.guardianId || null;
        if (vacation.role === 'student') {
          const effectiveEnd = vacation.actualEndDate || vacation.endDate;
          const startWindow = new Date(vacation.startDate);
          const endWindow = new Date(effectiveEnd);
          const classesInWindow = await Class.find({
            'student.studentId': vacation.user,
            status: { $nin: ['cancelled', 'cancelled_by_teacher', 'cancelled_by_guardian', 'cancelled_by_admin'] },
            scheduledDate: { $lt: endWindow },
            $expr: {
              $gt: [
                { $add: ['$scheduledDate', { $multiply: ['$duration', 60000] }] },
                startWindow
              ]
            }
          }).select('teacher student.studentName student.guardianId').lean();

          const teacherSet = new Set((classesInWindow || []).map(c => String(c.teacher)).filter(Boolean));
          impactedTeacherIds = Array.from(teacherSet);
          if (!guardianId) {
            const anyGuardian = (classesInWindow || []).find(c => c?.student?.guardianId)?.student?.guardianId;
            guardianId = anyGuardian || null;
          }
          const studentName = vacation.userName || (classesInWindow?.[0]?.student?.studentName) || null;
          studentContext = { studentName };
        }

        // Apply vacation logic when approved
  impactSummary = await vacationService.applyVacationToClasses(vacation);
        
        // If it's a teacher vacation and starts today or in the past, set teacher inactive immediately
        const now = new Date();
        if (vacation.role === 'teacher' && vacation.startDate <= now) {
          await vacationService.setTeacherInactive(vacation);
          vacation.status = 'active';
          vacation.actualStartDate = vacation.actualStartDate || now;
        }
        await vacation.save();

        // Student vacation notifications (guardian + impacted teachers)
        if (vacation.role === 'student') {
          const tz = req.user?.timezone || DEFAULT_TIMEZONE;
          const startLabel = formatTimeInTimezone(vacation.startDate, tz, 'DD MMM YYYY');
          const endLabel = formatTimeInTimezone(vacation.actualEndDate || vacation.endDate, tz, 'DD MMM YYYY');
          const studentName = studentContext?.studentName || vacation.userName || 'Student';

          if (guardianId) {
            await notificationService.createNotification({
              userId: guardianId,
              title: 'Vacation request approved',
              message: `${studentName} vacation was approved (${startLabel} → ${endLabel}). Classes during this period were cancelled.`,
              type: 'success',
              relatedTo: 'vacation',
              relatedId: vacation._id,
              actionRequired: false,
              metadata: {
                kind: 'student_vacation_approved',
                vacationId: String(vacation._id),
                studentId: String(vacation.user),
                startDate: new Date(vacation.startDate).toISOString(),
                endDate: new Date(vacation.actualEndDate || vacation.endDate).toISOString()
              }
            });
          }

          await Promise.allSettled(
            (impactedTeacherIds || []).map((teacherId) => {
              return notificationService.createNotification({
                userId: teacherId,
                title: 'Student on vacation',
                message: `${studentName} will be on vacation (${startLabel} → ${endLabel}). Affected classes were cancelled.`,
                type: 'info',
                relatedTo: 'vacation',
                relatedId: vacation._id,
                actionRequired: false,
                metadata: {
                  kind: 'student_vacation_approved',
                  vacationId: String(vacation._id),
                  studentId: String(vacation.user)
                }
              });
            })
          );
        }

        if (vacation.role === 'teacher') {
          const tz = vacation.user?.timezone || DEFAULT_TIMEZONE;
          const startDisplay = formatTimeInTimezone(vacation.startDate, tz, 'DD MMM YYYY hh:mm A');
          const endTarget = impactSummary?.availabilityWindow?.end || vacation.actualEndDate || vacation.endDate;
          const endDisplay = formatTimeInTimezone(endTarget, tz, 'DD MMM YYYY hh:mm A');
          const classSummary = impactSummary?.processedClasses
            ? `${impactSummary.processedClasses} class${impactSummary.processedClasses === 1 ? '' : 'es'} impacted (${impactSummary.cancelled} cancelled, ${impactSummary.onHold} on hold, ${impactSummary.substituted} reassigned).`
            : 'No scheduled classes were found during this period.';

          const now = new Date();
          const isActiveNow = vacation.startDate <= now && new Date(endTarget) >= now;

          await notificationService.createNotification({
            userId: vacation.user._id || vacation.user,
            title: isActiveNow ? 'Vacation is now active' : 'Vacation scheduled',
            message: `${isActiveNow ? 'Your vacation is now active' : 'Your vacation is scheduled'} (${startDisplay} → ${endDisplay}).${impactSummary?.processedClasses ? ` ${classSummary}` : ''}`,
            type: 'info',
            relatedTo: 'vacation',
            relatedId: vacation._id,
            actionRequired: false,
            metadata: {
              kind: 'vacation_status',
              vacationId: String(vacation._id),
              startDate: new Date(vacation.startDate).toISOString(),
              endDate: new Date(endTarget).toISOString(),
              recipientTimezone: tz
            }
          });
        }

      } catch (error) {
        console.error('Error applying vacation to classes:', error);
        // Create notification about the error
        // Only send this to real users; student vacations are handled separately
        if (vacation.role === 'teacher') {
          await notificationService.createNotification({
            userId: vacation.user,
            title: 'Vacation approved (schedule update pending)',
            message: 'Your vacation request was approved, but we couldn’t fully update the class schedule. An administrator will review this.',
            type: 'warning',
            relatedTo: 'vacation',
            relatedId: vacation._id,
            actionRequired: false
          });
        }
        // Even if class updates fail, the vacation approval was saved
        await vacation.save();
        return res.status(200).json({
          message: 'Vacation approved but there were some issues updating classes',
          warning: error.message,
          vacation: serializeVacation(vacation)
        });
      }
    } else {
      await vacation.save();
    }
    
    res.json({ 
      message: `Vacation request ${approved ? 'approved' : 'rejected'}`,
      vacation: serializeVacation(vacation),
      impactSummary
    });
  } catch (err) {
    console.error('Vacation approval error:', err);
    res.status(500).json({ 
      message: 'Failed to process vacation request',
      error: err.message
    });
  }
});

// End a vacation early (admin or owning teacher)
router.post('/:vacationId/end', requireAuth, async (req, res) => {
  try {
    const { vacationId } = req.params;
    const { endDate, reason } = req.body;

    const vacation = await Vacation.findById(vacationId).populate('user');

    if (!vacation) {
      return res.status(404).json({ message: 'Vacation not found' });
    }

    const isOwner = String(vacation.user?._id || vacation.user) === String(req.user._id);
    const isAdmin = req.user.role === 'admin';

    if (!isAdmin && !(isOwner && vacation.role === 'teacher')) {
      return res.status(403).json({ message: 'You do not have permission to end this vacation' });
    }

    if (!['approved', 'active'].includes(vacation.status)) {
      return res.status(400).json({ message: 'Only approved or active vacations can be ended early' });
    }

    const result = await vacationService.endVacationEarly(vacation, {
      endDate,
      reason,
      endedBy: req.user._id
    });

    if (vacation.role === 'teacher') {
      const tz = vacation.user?.timezone || DEFAULT_TIMEZONE;
      const effectiveLabel = endDate ? formatTimeInTimezone(endDate, tz, 'DD MMM YYYY hh:mm A') : null;
      await notificationService.createNotification({
        userId: vacation.user._id || vacation.user,
        title: 'Vacation ended',
        message: `Your vacation was ended early${effectiveLabel ? ` (effective ${effectiveLabel})` : ' (effective immediately)'}.`,
        type: 'success',
        relatedTo: 'vacation',
        relatedId: vacation._id,
        actionRequired: false
      });
    }

    res.json({
      message: 'Vacation ended successfully',
      restoration: result.restorationResult,
      vacation: serializeVacation(result.vacation)
    });
  } catch (err) {
    console.error('Error ending vacation early:', err);
    res.status(400).json({
      message: err.message || 'Failed to end vacation early'
    });
  }
});

// Update a vacation request (pending only)
router.put('/:vacationId', requireAuth, async (req, res) => {
  try {
    const { vacationId } = req.params;
    const { startDate, endDate, reason, substitutes } = req.body;

    const vacation = await Vacation.findById(vacationId);

    if (!vacation) {
      return res.status(404).json({ message: 'Vacation not found' });
    }

    const isOwner = String(vacation.user) === String(req.user._id);
    const isAdmin = req.user.role === 'admin';

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: 'You do not have permission to update this vacation' });
    }

    if (vacation.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending vacations can be updated' });
    }

    if (startDate) {
      const newStart = new Date(startDate);
      if (isNaN(newStart.getTime())) {
        return res.status(400).json({ message: 'Invalid start date' });
      }
      vacation.startDate = newStart;
    }

    if (endDate) {
      const newEnd = new Date(endDate);
      if (isNaN(newEnd.getTime())) {
        return res.status(400).json({ message: 'Invalid end date' });
      }
      if (newEnd < vacation.startDate) {
        return res.status(400).json({ message: 'End date must be after start date' });
      }
      vacation.endDate = newEnd;
    }

    if (reason) {
      vacation.reason = reason;
    }

    if (Array.isArray(substitutes)) {
      vacation.substitutes = substitutes;
    }

    await vacation.save();

    res.json({
      message: 'Vacation updated successfully',
      vacation: serializeVacation(vacation)
    });
  } catch (err) {
    console.error('Error updating vacation:', err);
    res.status(500).json({ message: err.message || 'Failed to update vacation' });
  }
});

// Delete a vacation request (pending or rejected)
router.delete('/:vacationId', requireAuth, async (req, res) => {
  try {
    const { vacationId } = req.params;
    const vacation = await Vacation.findById(vacationId);

    if (!vacation) {
      return res.status(404).json({ message: 'Vacation not found' });
    }

    const isOwner = String(vacation.user) === String(req.user._id);
    const isAdmin = req.user.role === 'admin';

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: 'You do not have permission to delete this vacation' });
    }

    if (vacation.status !== 'pending' && vacation.status !== 'rejected') {
      return res.status(400).json({ message: 'Only pending or rejected vacations can be deleted' });
    }

    await Vacation.findByIdAndDelete(vacationId);

    res.json({ message: 'Vacation deleted successfully' });
  } catch (err) {
    console.error('Error deleting vacation:', err);
    res.status(500).json({ message: 'Failed to delete vacation' });
  }
});

// Get relevant students and available teachers for a vacation
router.get('/:vacationId/substitute-options', requireAuth, requireAdmin, async (req, res) => {
  try {
    const vacation = await Vacation.findById(req.params.vacationId);
    if (!vacation) {
      return res.status(404).json({ message: 'Vacation not found' });
    }

    // Get all future classes for this teacher
    const now = new Date();
    const classes = await Class.find({
      teacher: vacation.user,
      scheduledDate: { $gte: now },
      status: { $in: ['scheduled', 'in_progress'] }
    }).populate({
      path: 'student.guardianId',
      select: 'fullName email'
    });

    // Get unique students from these classes
    const relevantStudents = Array.from(new Set(classes.map(cls => 
      JSON.stringify({
        _id: cls.student.studentId,
        fullName: cls.student.studentName,
        email: cls.student.guardianId?.email || 'No email'
      })
    ))).map(str => JSON.parse(str));

    // Get all active teachers
    const availableTeachers = await User.find({
      role: 'teacher',
      isActive: true,
      _id: { $ne: vacation.user } // Exclude the teacher who is on vacation
    }).select('_id fullName email firstName lastName');

    // Format teacher names
    const formattedTeachers = availableTeachers.map(teacher => ({
      _id: teacher._id,
      fullName: teacher.fullName || `${teacher.firstName} ${teacher.lastName}`,
      email: teacher.email
    }));

    // Log the data for debugging
    console.log('Vacation ID:', vacation._id);
    console.log('Teacher ID:', vacation.user);
    console.log('Found classes:', classes.length);
    console.log('Found students:', relevantStudents.length);
    console.log('Found teachers:', formattedTeachers.length);

    res.json({
      students: relevantStudents,
      teachers: formattedTeachers
    });
  } catch (err) {
    console.error('Error getting substitute options:', err);
    res.status(500).json({ message: 'Failed to get substitute options' });
  }
});

// List students on hold (no substitute found during vacation)
router.get('/students/on-hold', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Find all student vacations with status 'hold' and current/future dates
    const now = new Date();
    const vacations = await Vacation.find({ 
      role: 'student', 
      status: { $in: ['approved', 'active'] },
      endDate: { $gte: now } 
    }).populate('user');
    res.json({ vacations });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Check and update vacation statuses (admin only)
router.post('/update-statuses', requireAuth, requireAdmin, async (req, res) => {
  try {
    await vacationService.updateTeacherVacationStatuses();
    res.json({ message: 'Vacation statuses updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update vacation statuses' });
  }
});

module.exports = router;
