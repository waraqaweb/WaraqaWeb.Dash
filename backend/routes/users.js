/**
 * User Management Routes
 * 
 * Handles:
 * - User CRUD operations
 * - User profile management
 * - Student management for guardians (embedded students)
 * - Teacher management
 * - Admin impersonation
 */
const { generateToken } = require('../utils/jwt');
const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const User = require('../models/User');
const Teacher = require('../models/Teacher');
const Guardian = require('../models/Guardian');
const Student = require('../models/Student');
const Invoice = require('../models/Invoice');
const GuardianHoursAudit = require('../models/GuardianHoursAudit');
const AccountStatusAudit = require('../models/AccountStatusAudit');
const Notification = require('../models/Notification');
const Class = require('../models/Class');
const { isValidTimezone, DEFAULT_TIMEZONE } = require('../utils/timezoneUtils');
const { 
  authenticateToken, 
  requireAdmin, 
  requireResourceAccess 
} = require('../middleware/auth');

const router = express.Router();
const multer = require('multer');
const { uploadImage, deleteImage } = require('../services/cloudinaryService');

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return null;
};

const normalize = (value = '') => String(value || '').trim().toLowerCase();
const normalizeDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const UPCOMING_STUDENT_STATUS_EXCLUSIONS = [
  'cancelled_by_teacher',
  'cancelled_by_guardian',
  'cancelled_by_student',
  'cancelled_by_admin',
  'cancelled',
  'pattern',
  'no_show_both',
  'on_hold',
];

const buildUpcomingTimeFilter = (referenceDate = new Date()) => {
  const durationMsExpr = { $multiply: [{ $ifNull: ['$duration', 0] }, 60000] };
  const endsAtExpr = { $add: ['$scheduledDate', durationMsExpr] };
  return {
    $or: [
      { endsAt: { $gte: referenceDate } },
      {
        endsAt: { $exists: false },
        scheduledDate: { $exists: true, $ne: null },
        $expr: { $gte: [endsAtExpr, referenceDate] },
      },
      {
        endsAt: null,
        scheduledDate: { $exists: true, $ne: null },
        $expr: { $gte: [endsAtExpr, referenceDate] },
      },
      { scheduledDate: { $gte: referenceDate } },
    ],
  };
};

const extractScheduleIds = (student = {}) => {
  const ids = new Set();
  const candidates = [
    student._id,
    student.id,
    student.studentId,
    student.standaloneStudentId,
    student.studentInfo?.standaloneStudentId,
    student.studentInfo?.studentId,
    student.studentInfo?._id,
  ];
  candidates.filter(Boolean).forEach((id) => ids.add(String(id)));
  return Array.from(ids);
};

const normalizeStudentNameKey = (value = '') => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' ');

const attachScheduleActiveFlags = async (students = []) => {
  if (!Array.isArray(students) || students.length === 0) return;
  const studentIds = new Set();
  const scheduleIdsByIndex = new Map();
  const nameFallbackKeysByIndex = new Map();
  const guardianIdsForNameFallback = new Set();

  students.forEach((student, idx) => {
    const scheduleIds = extractScheduleIds(student);
    scheduleIdsByIndex.set(idx, scheduleIds);
    scheduleIds.forEach((id) => studentIds.add(id));

    const guardianId = student.guardianId || student.guardian;
    const studentName = student.studentName || `${student.firstName || ''} ${student.lastName || ''}`.trim();
    const normalizedName = normalizeStudentNameKey(studentName);
    if (guardianId && normalizedName) {
      const key = `${String(guardianId)}|${normalizedName}`;
      nameFallbackKeysByIndex.set(idx, key);
      guardianIdsForNameFallback.add(String(guardianId));
    }
  });

  const objectIds = Array.from(studentIds)
    .map((id) => toObjectId(id))
    .filter(Boolean);

  const hasObjectIds = objectIds.length > 0;

  const now = new Date();
  const timeFilter = buildUpcomingTimeFilter(now);
  let upcomingSet = new Set();
  if (hasObjectIds) {
    const match = {
      'student.studentId': { $in: objectIds },
      status: { $nin: UPCOMING_STUDENT_STATUS_EXCLUSIONS },
      hidden: { $ne: true },
      deleted: { $ne: true },
      $and: [timeFilter],
    };

    try {
      const upcomingRows = await Class.aggregate([
        { $match: match },
        { $group: { _id: '$student.studentId' } },
      ]);
      upcomingSet = new Set((upcomingRows || []).map((row) => String(row._id)));
    } catch (err) {
      console.warn('Failed to compute upcoming student activity', err?.message || err);
    }
  }

  let upcomingNameSet = new Set();
  if (guardianIdsForNameFallback.size) {
    try {
      const guardianObjectIds = Array.from(guardianIdsForNameFallback)
        .map((id) => toObjectId(id))
        .filter(Boolean);
      if (guardianObjectIds.length) {
        const nameRows = await Class.aggregate([
          {
            $match: {
              'student.guardianId': { $in: guardianObjectIds },
              status: { $nin: UPCOMING_STUDENT_STATUS_EXCLUSIONS },
              hidden: { $ne: true },
              deleted: { $ne: true },
              $and: [timeFilter],
            },
          },
          {
            $project: {
              guardianId: '$student.guardianId',
              studentName: '$student.studentName',
            },
          },
        ]);

        upcomingNameSet = new Set(
          (nameRows || [])
            .map((row) => {
              const g = row?.guardianId ? String(row.guardianId) : null;
              const n = normalizeStudentNameKey(row?.studentName || '');
              return g && n ? `${g}|${n}` : null;
            })
            .filter(Boolean)
        );
      }
    } catch (err) {
      console.warn('Failed to compute upcoming student activity (name fallback)', err?.message || err);
    }
  }

  students.forEach((student, idx) => {
    const scheduleIds = scheduleIdsByIndex.get(idx) || [];
    const hasUpcomingById = scheduleIds.some((id) => upcomingSet.has(String(id)));
    const nameKey = nameFallbackKeysByIndex.get(idx);
    const hasUpcomingByName = nameKey ? upcomingNameSet.has(nameKey) : false;
    const hasUpcoming = hasUpcomingById || hasUpcomingByName;
    student.isActive = Boolean(hasUpcoming);
    const info = student.studentInfo && typeof student.studentInfo === 'object'
      ? student.studentInfo
      : {};
    info.status = hasUpcoming ? 'active' : 'inactive';
    student.studentInfo = info;
  });
};

const makeStudentKey = (student = {}) => {
  const guardianId = String(student.guardianId || student.guardian || '');
  if (!guardianId) return null;

  const source = String(student._source || '');
  const selfGuardian = Boolean(student.selfGuardian || student.studentInfo?.selfGuardian);

  // If we have a linkage between embedded<->standalone, use that as the merge key.
  const linkedStandaloneId =
    source === 'standalone'
      ? (student._id || student.id)
      : (student.standaloneStudentId || student.studentInfo?.standaloneStudentId);
  if (linkedStandaloneId) {
    return `${guardianId}|standalone:${String(linkedStandaloneId)}`;
  }

  // Self-enrollment should always be treated as a single logical student per guardian.
  if (selfGuardian) {
    return `${guardianId}|selfGuardian`;
  }

  // Email/phone are NOT reliable identifiers in this system (multiple students can share guardian contact info).
  // Use name + DOB only when DOB exists.
  const first = normalize(student.firstName || student.studentInfo?.firstName);
  const last = normalize(student.lastName || student.studentInfo?.lastName);
  const dob = normalizeDate(student.dateOfBirth || student.studentInfo?.dateOfBirth);
  if (dob && (first || last)) {
    return `${guardianId}|name:${first || 'unknown'}|last:${last || 'unknown'}|dob:${dob}`;
  }

  // Without email (and without a linkage id), DO NOT dedupe by name/DOB.
  // Guardians can have multiple kids/family members that share names or missing DOBs.
  // Treat each record as distinct by its own id.
  const idPart = student._id || student.id || student.studentId;
  if (idPart) {
    return `${guardianId}|${source || 'unknown'}:${String(idPart)}`;
  }

  return `${guardianId}|hash:${Buffer.from(JSON.stringify(student)).toString('base64').slice(0, 24)}`;
};

const dedupeStudents = (students = [], options = {}) => {
  const prefer = String(options.prefer || 'standalone').toLowerCase();
  const byKey = new Map();
  const extras = [];
  students.forEach((student) => {
    const key = makeStudentKey(student);
    if (!key) return;
    if (!byKey.has(key)) {
      byKey.set(key, student);
      return;
    }

    const existing = byKey.get(key);
    // Prefer one source over the other when we believe these are the same logical student.
    // Default behavior remains "standalone" for admin lists.
    if (prefer === 'standalone') {
      if (existing && existing._source === 'embedded' && student._source === 'standalone') {
        byKey.set(key, student);
        return;
      }
    }
    if (prefer === 'embedded') {
      if (existing && existing._source === 'standalone' && student._source === 'embedded') {
        byKey.set(key, student);
        return;
      }
    }

    // If we somehow have multiple distinct embedded students sharing the same linkage key
    // (commonly caused by shared guardian email/phone), keep the additional records so
    // guardians/admins can see all created students.
    const existingId = existing && (existing._id || existing.id || existing.studentId);
    const incomingId = student && (student._id || student.id || student.studentId);
    if (existingId && incomingId && String(existingId) !== String(incomingId)) {
      extras.push(student);
    }
  });
  return [...Array.from(byKey.values()), ...extras];
};

const sanitizeStudentHours = (students = []) =>
  students.map((student) => {
    const copy = { ...student };
    delete copy.hoursRemaining;
    delete copy.hoursConsumed;
    delete copy.totalHours;
    delete copy.cumulativeConsumedHours;
    if (copy.studentInfo && typeof copy.studentInfo === 'object') {
      const info = { ...copy.studentInfo };
      delete info.hoursRemaining;
      delete info.hoursConsumed;
      copy.studentInfo = info;
    }
    return copy;
  });

const matchesStudentSearch = (student = {}, needle = '') => {
  if (!needle) return true;
  const normalizedNeedle = needle.toLowerCase();
  const haystacks = [
    student.firstName,
    student.lastName,
    student.email,
    student.studentName,
    student.guardianName,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return haystacks.some((value) => value.includes(normalizedNeedle));
};

const sortStudentsAlpha = (students = []) =>
  students.sort((a, b) => {
    const aFirst = (a.firstName || '').toLowerCase();
    const bFirst = (b.firstName || '').toLowerCase();
    if (aFirst !== bFirst) return aFirst.localeCompare(bFirst);
    const aLast = (a.lastName || '').toLowerCase();
    const bLast = (b.lastName || '').toLowerCase();
    return aLast.localeCompare(bLast);
  });

// Multer setup (in-memory)
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

/**
 * Get all users (Admin only)
 * GET /api/users
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      role,
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'createdAt',
      order = 'desc',
      isActive,
    } = req.query;

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 200);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const query = {};
    if (role) {
      query.role = role;
    }

    if (typeof isActive !== 'undefined') {
      const normalized = String(isActive).toLowerCase();
      if (['true', '1', 'yes'].includes(normalized)) {
        query.isActive = true;
      } else if (['false', '0', 'no'].includes(normalized)) {
        query.isActive = false;
      }
    }

    const trimmedSearch = (search || '').trim();
    if (trimmedSearch) {
      const regex = new RegExp(escapeRegex(trimmedSearch), 'i');
      query.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { phone: regex },
        { 'guardianInfo.students.firstName': regex },
        { 'guardianInfo.students.lastName': regex },
        { 'guardianInfo.students.email': regex },
      ];
    }

    const allowedSortFields = new Set(['createdAt', 'firstName', 'lastName', 'email']);
    const resolvedSortBy = allowedSortFields.has(sortBy) ? sortBy : 'createdAt';
    const sortDirection = String(order).toLowerCase() === 'asc' ? 1 : -1;
    const sortOptions = { [resolvedSortBy]: sortDirection, _id: sortDirection };

    const users = await User.find(query)
      .select('-password')
      .limit(parsedLimit)
      .skip(skip)
      .sort(sortOptions);

    const total = await User.countDocuments(query);

    // For the teachers list, compute UNBILLED hours this month from Class durations
    // to keep the UI invoice-aware and avoid relying on teacherInfo.monthlyHours
    // (which is a mutable snapshot).
    let usersPayload = users;
    if (String(role || '').toLowerCase() === 'teacher' && Array.isArray(users) && users.length) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const teacherIds = users.map((u) => u && u._id).filter(Boolean);

      let hoursByTeacherId = {};
      try {
        const rows = await Class.aggregate([
          {
            $match: {
              teacher: { $in: teacherIds },
              scheduledDate: { $gte: monthStart, $lt: monthEnd },
              deleted: { $ne: true },
              billedInTeacherInvoiceId: null,
              status: { $in: ['attended', 'missed_by_student', 'absent', 'completed'] }
            }
          },
          { $group: { _id: '$teacher', totalMinutes: { $sum: '$duration' } } }
        ]);
        hoursByTeacherId = (rows || []).reduce((acc, r) => {
          acc[String(r._id)] = (r.totalMinutes || 0) / 60;
          return acc;
        }, {});
      } catch (e) {
        console.warn('users: failed to aggregate teacher monthly hours', e && e.message);
      }

      usersPayload = users.map((u) => {
        const obj = u.toObject();
        const key = String(obj._id);
        const computed = hoursByTeacherId[key] ?? 0;
        obj.teacherInfo = obj.teacherInfo || {};
        obj.teacherInfo._computedMonthlyHours = computed;
        return obj;
      });
    }

    res.json({
      users: usersPayload,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    });
    
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      message: 'Failed to fetch users',
      error: error.message
    });
  }
});

/**
 * Manual adjust guardian total hours (Admin only)
 * This does NOT create an invoice and does NOT touch classes/students.
 * POST /api/users/admin/guardians/:guardianId/hours
 * Body: { action: 'add'|'subtract'|'set', hours: number, reason?: string }
 */
router.post('/admin/guardians/:guardianId/hours', [
  authenticateToken,
  requireAdmin,
  body('action').isIn(['add', 'subtract', 'set']).withMessage('Action must be add, subtract, or set'),
  body('hours').isNumeric().withMessage('Hours must be a number'),
  body('reason').optional({ nullable: true }).isString().trim().isLength({ max: 500 }).withMessage('Reason must be at most 500 characters'),
], async (req, res) => {
  const { guardianId } = req.params;

  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: errors.array(),
    });
  }

  const { action, hours, reason } = req.body;
  const hoursValue = Number(hours);
  const rounded = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.round(num * 1000) / 1000;
  };

  let guardian = null;
  let beforeSnapshot = null;
  let afterSnapshot = null;

  try {
    guardian = await User.findById(guardianId);
    if (!guardian) {
      return res.status(404).json({ message: 'Guardian not found' });
    }
    if (guardian.role !== 'guardian') {
      return res.status(400).json({ message: 'User is not a guardian' });
    }

    guardian.guardianInfo = guardian.guardianInfo && typeof guardian.guardianInfo === 'object' ? guardian.guardianInfo : {};

    const prevAutoTotalHours = guardian.guardianInfo.autoTotalHours;
    const beforeTotal = Number(guardian.guardianInfo.totalHours || 0);
    const safeBeforeTotal = Number.isFinite(beforeTotal) ? beforeTotal : 0;
    let newTotal = safeBeforeTotal;

    switch (action) {
      case 'add':
        newTotal = safeBeforeTotal + hoursValue;
        break;
      case 'subtract':
        newTotal = safeBeforeTotal - hoursValue;
        break;
      case 'set':
        newTotal = hoursValue;
        break;
      default:
        return res.status(400).json({ message: 'Invalid action' });
    }

    beforeSnapshot = {
      guardianId: guardian._id,
      autoTotalHours: prevAutoTotalHours,
      totalHours: rounded(safeBeforeTotal),
    };

    // Prevent future autosync from overwriting the manual correction.
    guardian.guardianInfo.autoTotalHours = false;
    guardian.guardianInfo.totalHours = rounded(newTotal);

    await guardian.save();

    // Best-effort sync to the legacy Guardian model (if present)
    try {
      const GuardianModel = require('../models/Guardian');
      const guardianModel = await GuardianModel.findOne({ user: guardian._id });
      if (guardianModel) {
        guardianModel.totalRemainingMinutes = Math.max(0, Math.round((Number(guardian.guardianInfo.totalHours || 0) || 0) * 60));
        await guardianModel.save();
      }
    } catch (syncErr) {
      console.warn('Manual guardian hours: failed to sync Guardian model', syncErr && syncErr.message);
    }

    afterSnapshot = {
      guardianId: guardian._id,
      autoTotalHours: guardian.guardianInfo.autoTotalHours,
      totalHours: guardian.guardianInfo.totalHours,
    };

    // Audit (non-blocking)
    try {
      await GuardianHoursAudit.logAction({
        action: 'hours_manual_adjust',
        entityType: 'User',
        entityId: guardian._id,
        actor: req.user?.id || null,
        actorRole: 'admin',
        actorIP: req.ip,
        actorUserAgent: req.get('user-agent'),
        before: beforeSnapshot,
        after: afterSnapshot,
        reason: typeof reason === 'string' ? reason.trim() : null,
        metadata: {
          requestedAction: action,
          requestedHours: hoursValue,
        },
        success: true,
      });
    } catch (auditErr) {
      console.warn('Manual guardian hours: audit log failed', auditErr && auditErr.message);
    }

    return res.json({
      message: 'Guardian hours updated successfully',
      guardianId: guardian._id,
      totalHours: guardian.guardianInfo.totalHours,
      autoTotalHours: guardian.guardianInfo.autoTotalHours,
    });
  } catch (error) {
    console.error('Manual guardian hours error:', error);

    // Attempt to record failed audit (best-effort)
    try {
      await GuardianHoursAudit.logAction({
        action: 'hours_manual_adjust',
        entityType: 'User',
        entityId: guardian ? guardian._id : guardianId,
        actor: req.user?.id || null,
        actorRole: 'admin',
        actorIP: req.ip,
        actorUserAgent: req.get('user-agent'),
        before: beforeSnapshot,
        after: afterSnapshot,
        reason: typeof reason === 'string' ? reason.trim() : null,
        metadata: { requestedAction: action, requestedHours: hoursValue },
        success: false,
        errorMessage: error?.message || 'Unknown error',
      });
    } catch (auditErr) {
      console.warn('Manual guardian hours: failed audit log failed', auditErr && auditErr.message);
    }

    return res.status(500).json({
      message: 'Failed to update guardian hours',
      error: error.message,
    });
  }
});

/**
 * Recompute guardian hours from class reports + payments (Admin only)
 * POST /api/users/admin/guardians/:guardianId/recompute-hours
 * Body: { mode?: 'billing'|'students', dryRun?: boolean }
 */
router.post('/admin/guardians/:guardianId/recompute-hours', [
  authenticateToken,
  requireAdmin,
], async (req, res) => {
  try {
    const { guardianId } = req.params;
    const mode = String(req.body?.mode || 'billing').toLowerCase();
    const dryRun = Boolean(req.body?.dryRun);

    const guardian = await User.findById(guardianId);
    if (!guardian) {
      return res.status(404).json({ message: 'Guardian not found' });
    }
    if (guardian.role !== 'guardian') {
      return res.status(400).json({ message: 'User is not a guardian' });
    }

    guardian.guardianInfo = guardian.guardianInfo && typeof guardian.guardianInfo === 'object' ? guardian.guardianInfo : {};
    const students = Array.isArray(guardian.guardianInfo.students) ? guardian.guardianInfo.students : [];

    const countableStatuses = new Set(['attended', 'missed_by_student', 'absent']);
    const classes = await Class.find({
      'student.guardianId': guardian._id,
      deleted: { $ne: true }
    })
      .select('_id student status duration classReport')
      .lean();

    const consumedByStudent = new Map();
    let totalConsumed = 0;
    for (const cls of classes) {
      const status = cls?.status;
      if (!countableStatuses.has(status)) continue;
      const durationHours = Number(cls?.duration || 0) / 60;
      if (!Number.isFinite(durationHours) || durationHours <= 0) continue;
      totalConsumed += durationHours;
      const sid = cls?.student?.studentId ? String(cls.student.studentId) : null;
      if (!sid) continue;
      consumedByStudent.set(sid, (consumedByStudent.get(sid) || 0) + durationHours);
    }

    const findStudentIndex = (studentId) => {
      if (!studentId) return -1;
      const target = String(studentId);
      return students.findIndex((s) => {
        const candidates = [
          s?._id,
          s?.id,
          s?.studentId,
          s?.standaloneStudentId,
          s?.studentInfo?.standaloneStudentId
        ]
          .filter(Boolean)
          .map((v) => String(v));
        return candidates.includes(target);
      });
    };

    const perStudent = [];
    for (const s of students) {
      const candidateIds = [
        s?._id,
        s?.id,
        s?.studentId,
        s?.standaloneStudentId,
        s?.studentInfo?.standaloneStudentId
      ]
        .filter(Boolean)
        .map((v) => String(v));
      const consumed = candidateIds.reduce((sum, id) => sum + (consumedByStudent.get(id) || 0), 0);
      const newHoursRemaining = Math.round((-consumed) * 1000) / 1000;
      perStudent.push({
        id: s?._id || s?.studentId || s?.standaloneStudentId || null,
        name: `${s?.firstName || ''} ${s?.lastName || ''}`.trim() || s?.studentName || 'Student',
        consumedHours: Math.round(consumed * 1000) / 1000,
        hoursRemaining: newHoursRemaining
      });
      if (!dryRun) {
        const idx = findStudentIndex(s?._id || s?.studentId || s?.standaloneStudentId);
        if (idx !== -1) {
          guardian.guardianInfo.students[idx].hoursRemaining = newHoursRemaining;
        }
      }
    }

    let creditedHours = 0;
    if (mode === 'billing') {
      const invoices = await Invoice.find({ guardian: guardian._id, deleted: { $ne: true } }).lean();
      for (const invoice of invoices) {
        const logs = Array.isArray(invoice.paymentLogs) ? invoice.paymentLogs : [];
        const invoiceRate = Number(invoice?.guardianFinancial?.hourlyRate || 0)
          || Number(guardian.guardianInfo?.hourlyRate || 0)
          || 10;
        for (const log of logs) {
          if (!log || typeof log.amount !== 'number' || log.amount <= 0) continue;
          if (log.method === 'refund' || log.method === 'tip_distribution') continue;
          if (log.paidHours !== undefined && log.paidHours !== null) {
            creditedHours += Number(log.paidHours) || 0;
          } else {
            creditedHours += Number(log.amount || 0) / invoiceRate;
          }
        }
      }
    }

    const normalizedConsumed = Math.round(totalConsumed * 1000) / 1000;
    const normalizedCredited = Math.round(creditedHours * 1000) / 1000;
    const totalHours = mode === 'billing'
      ? Math.round((normalizedCredited - normalizedConsumed) * 1000) / 1000
      : perStudent.reduce((sum, s) => sum + (Number(s.hoursRemaining) || 0), 0);

    if (!dryRun) {
      guardian.guardianInfo.autoTotalHours = mode === 'students';
      guardian.guardianInfo.totalHours = totalHours;
      guardian.markModified('guardianInfo.students');
      guardian.markModified('guardianInfo');
      await guardian.save();
      try {
        await Guardian.updateTotalRemainingMinutes(guardian._id);
      } catch (e) {
        console.warn('Recompute guardian hours: failed to sync Guardian model', e && e.message);
      }
    }

    return res.json({
      message: dryRun ? 'Recompute preview complete' : 'Guardian hours recomputed',
      guardianId: guardian._id,
      mode,
      dryRun,
      totalConsumed: normalizedConsumed,
      totalCredited: normalizedCredited,
      totalHours,
      perStudent
    });
  } catch (error) {
    console.error('Recompute guardian hours error:', error);
    return res.status(500).json({ message: 'Failed to recompute guardian hours', error: error.message });
  }
});

/**
 * Admin: Fetch account audit logs (on-demand)
 * POST /api/users/admin/account-logs
 * Body: { userId?: string, email?: string, userIdOrEmail?: string, limit?: number, includeClasses?: boolean, classLimit?: number }
 */
router.post('/admin/account-logs', [
  authenticateToken,
  requireAdmin,
], async (req, res) => {
  try {
    const { userId, email, userIdOrEmail, limit, includeClasses, classLimit } = req.body || {};
    const maxLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
    const includeClassEntries = includeClasses === true || String(includeClasses).toLowerCase() === 'true';
    const maxClassLimit = Math.min(Math.max(parseInt(classLimit, 10) || 50, 1), 500);

    const normalizeName = (userLike = {}) => {
      const name = `${userLike.firstName || ''} ${userLike.lastName || ''}`.trim();
      if (name) return name;
      return userLike.email || 'Unknown';
    };

    const buildClassEntries = (items = []) => {
      if (!includeClassEntries || !Array.isArray(items) || items.length === 0) {
        return { classEntries: [], classCount: Array.isArray(items) ? items.length : 0, classTruncated: false };
      }
      const limited = items.slice(0, maxClassLimit);
      const classEntries = limited.map((item) => {
        const studentName = item?.studentSnapshot
          ? `${item.studentSnapshot.firstName || ''} ${item.studentSnapshot.lastName || ''}`.trim()
          : '';
        const teacherName = item?.teacherSnapshot
          ? `${item.teacherSnapshot.firstName || ''} ${item.teacherSnapshot.lastName || ''}`.trim()
          : '';
        const durationMinutes = Number(item?.duration || 0) || 0;
        const quantityHoursRaw = Number(item?.quantityHours || 0);
        const hours = Number.isFinite(quantityHoursRaw) && quantityHoursRaw > 0
          ? Math.round(quantityHoursRaw * 1000) / 1000
          : Math.round((durationMinutes / 60) * 1000) / 1000;

        return {
          date: item?.date || null,
          status: item?.status || item?.attendanceStatus || null,
          duration: durationMinutes || null,
          hours,
          description: item?.description || null,
          studentName: studentName || null,
          teacherName: teacherName || null,
        };
      });
      return {
        classEntries,
        classCount: items.length,
        classTruncated: items.length > limited.length
      };
    };

    let user = null;
    const resolveUserIdOrEmail = async (value) => {
      if (!value) return null;
      const trimmed = String(value).trim();
      if (!trimmed) return null;
      if (mongoose.Types.ObjectId.isValid(trimmed)) {
        return await User.findById(trimmed).select('firstName lastName email role');
      }
      if (trimmed.includes('@')) {
        return await User.findOne({ email: trimmed.toLowerCase() }).select('firstName lastName email role');
      }
      return null;
    };

    if (userIdOrEmail) {
      user = await resolveUserIdOrEmail(userIdOrEmail);
    }
    if (!user && userId && mongoose.Types.ObjectId.isValid(String(userId))) {
      user = await User.findById(userId).select('firstName lastName email role');
    } else if (!user && email) {
      user = await User.findOne({ email: String(email).trim().toLowerCase() }).select('firstName lastName email role');
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const logs = [];

    // Manual hours audit logs (guardian hours)
    const hoursLogs = await GuardianHoursAudit.find({ entityType: 'User', entityId: user._id })
      .sort({ timestamp: -1 })
      .limit(maxLimit)
      .lean();

    const actorIds = new Set();

    (hoursLogs || []).forEach((entry) => {
      const beforeHoursRaw = Number(entry?.before?.totalHours);
      const afterHoursRaw = Number(entry?.after?.totalHours);
      const beforeHours = Number.isFinite(beforeHoursRaw) ? Math.round(beforeHoursRaw * 1000) / 1000 : undefined;
      const afterHours = Number.isFinite(afterHoursRaw) ? Math.round(afterHoursRaw * 1000) / 1000 : undefined;
      if (entry.actor) actorIds.add(String(entry.actor));
      logs.push({
        logId: entry._id,
        timestamp: entry.timestamp || entry.createdAt || new Date(),
        source: 'guardian-hours',
        action: entry.action,
        success: entry.success !== false,
        reason: entry.reason || null,
        before: entry.before || null,
        after: entry.after || null,
        balanceBefore: beforeHours,
        balanceAfter: afterHours,
        balanceNote: beforeHours !== undefined || afterHours !== undefined ? 'guardian hours' : undefined,
        metadata: entry.metadata || null,
        message: entry.reason || 'Manual hours adjustment',
        actorId: entry.actor || null,
        canUndo: false,
        canDelete: false,
      });
    });

    const statusFilters = [{ entityType: 'User', entityId: user._id }];
    if (user.role === 'guardian') {
      statusFilters.push({ entityType: 'Student', 'metadata.guardianId': user._id });
    }

    const statusLogs = await AccountStatusAudit.find({ $or: statusFilters })
      .sort({ timestamp: -1 })
      .limit(maxLimit)
      .lean();

    (statusLogs || []).forEach((entry) => {
      if (entry.actor) actorIds.add(String(entry.actor));
      const statusBefore = typeof entry?.before?.isActive === 'boolean' ? entry.before.isActive : undefined;
      const statusAfter = typeof entry?.after?.isActive === 'boolean' ? entry.after.isActive : undefined;
      const entityName = entry.entityName
        || entry?.metadata?.studentName
        || entry?.metadata?.guardianName
        || null;
      const isUndo = entry.action === 'status_undo';
      const statusLabel = (value) => value === true ? 'active' : value === false ? 'inactive' : 'unknown';
      const baseMessage = entry.entityType === 'Student'
        ? `Student ${entityName || ''} status ${statusLabel(statusBefore)} → ${statusLabel(statusAfter)}`.trim()
        : `User status ${statusLabel(statusBefore)} → ${statusLabel(statusAfter)}`;
      logs.push({
        logId: entry._id,
        timestamp: entry.timestamp || entry.createdAt || new Date(),
        source: 'account-status',
        action: entry.action,
        success: entry.success !== false,
        reason: entry.reason || null,
        message: entry.reason || baseMessage,
        actorId: entry.actor || null,
        statusBefore,
        statusAfter,
        entityType: entry.entityType,
        entityName,
        guardianId: entry?.metadata?.guardianId || null,
        guardianName: entry?.metadata?.guardianName || null,
        studentName: entry?.metadata?.studentName || null,
        metadata: entry.metadata || null,
        canUndo: !isUndo,
        canDelete: true,
      });
    });

    // Invoice-related logs for guardians and teachers
    if (user.role === 'guardian' || user.role === 'teacher') {
      const invoiceFilter = user.role === 'guardian'
        ? { guardian: user._id, deleted: { $ne: true } }
        : { teacher: user._id, deleted: { $ne: true } };

      const invoiceSelect = [
        'invoiceNumber',
        'invoiceSlug',
        'status',
        'total',
        'hoursCovered',
        'createdAt',
        'updatedAt',
        'paidDate',
        'paymentLogs',
        'activityLog',
        'billingPeriod',
        'generationSource',
        'notes',
        'type',
        'items'
      ];

      if (!includeClassEntries) {
        const idx = invoiceSelect.indexOf('items');
        if (idx >= 0) invoiceSelect.splice(idx, 1);
      }

      const invoices = await Invoice.find(invoiceFilter)
        .select(invoiceSelect.join(' '))
        .limit(maxLimit)
        .lean();

      (invoices || []).forEach((inv) => {
        const classMeta = buildClassEntries(inv.items || []);
        const hoursCoveredRaw = Number(inv.hoursCovered || 0);
        const hoursCovered = Number.isFinite(hoursCoveredRaw) ? Math.round(hoursCoveredRaw * 1000) / 1000 : undefined;
        const invoiceBase = {
          invoiceNumber: inv.invoiceNumber,
          amount: inv.total,
          hours: hoursCovered,
          billingPeriod: inv.billingPeriod || null,
          generationSource: inv.generationSource || null,
          reason: inv.generationSource === 'legacy-balance'
            ? 'Legacy balance invoice'
            : (inv.notes || null),
          ...classMeta,
        };

        if (inv.createdAt) {
          logs.push({
            timestamp: inv.createdAt,
            source: 'invoice',
            action: 'invoice_created',
            success: true,
            message: inv.generationSource === 'legacy-balance'
              ? `Legacy balance invoice ${inv.invoiceNumber} created`
              : `Invoice ${inv.invoiceNumber} created`,
            ...invoiceBase
          });
        }

        const activityLog = Array.isArray(inv.activityLog) ? inv.activityLog : [];
        activityLog.forEach((a) => {
          if (a?.actor) actorIds.add(String(a.actor));
          logs.push({
            timestamp: a.at || inv.updatedAt || inv.createdAt,
            source: 'invoice',
            action: a.action || 'invoice_update',
            success: true,
            message: a.note || `Invoice ${inv.invoiceNumber} updated`,
            actorId: a.actor || null,
            ...invoiceBase
          });
        });

        const paymentLogs = Array.isArray(inv.paymentLogs) ? inv.paymentLogs : [];
        paymentLogs.forEach((p) => {
          const balanceBefore = Number.isFinite(Number(p?.snapshot?.guardianBalanceBefore))
            ? Math.round(Number(p.snapshot.guardianBalanceBefore) * 1000) / 1000
            : undefined;
          const balanceAfter = Number.isFinite(Number(p?.snapshot?.guardianBalanceAfter))
            ? Math.round(Number(p.snapshot.guardianBalanceAfter) * 1000) / 1000
            : undefined;
          if (p?.processedBy) actorIds.add(String(p.processedBy));
          logs.push({
            timestamp: p.processedAt || inv.paidDate || inv.updatedAt || inv.createdAt,
            source: 'payment',
            action: p.method || 'payment',
            success: true,
            ...invoiceBase,
            note: p.note || null,
            message: `Payment ${p.amount} applied to ${inv.invoiceNumber}`,
            actorId: p.processedBy || null,
            amount: p.amount,
            hours: p.paidHours,
            balanceBefore,
            balanceAfter,
            balanceNote: balanceBefore !== undefined || balanceAfter !== undefined ? 'guardian hours' : undefined,
            invoiceRemainingBefore: p?.snapshot?.invoiceRemainingBefore ?? undefined,
            invoiceRemainingAfter: p?.snapshot?.invoiceRemainingAfter ?? undefined,
          });
        });
      });
    }

    if (actorIds.size > 0) {
      const actorDocs = await User.find({ _id: { $in: Array.from(actorIds) } })
        .select('firstName lastName email')
        .lean();
      const actorMap = (actorDocs || []).reduce((acc, doc) => {
        acc[String(doc._id)] = normalizeName(doc);
        return acc;
      }, {});
      logs.forEach((log) => {
        if (log.actorId && actorMap[log.actorId]) {
          log.actorName = actorMap[log.actorId];
        }
        delete log.actorId;
      });
    }

    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return res.json({
      user: {
        id: user._id,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        email: user.email,
        role: user.role
      },
      logs: logs.slice(0, maxLimit)
    });
  } catch (error) {
    console.error('Account logs error:', error);
    return res.status(500).json({ message: 'Failed to fetch account logs', error: error.message });
  }
});

/**
 * Admin: Undo account log action (limited to status change logs)
 * POST /api/users/admin/account-logs/:logId/undo
 * Body: { source?: 'account-status' }
 */
router.post('/admin/account-logs/:logId/undo', [
  authenticateToken,
  requireAdmin,
], async (req, res) => {
  const { logId } = req.params;
  const { source } = req.body || {};
  const resolvedSource = source || 'account-status';

  if (resolvedSource !== 'account-status') {
    return res.status(400).json({ message: 'Undo not supported for this log source' });
  }

  try {
    const log = await AccountStatusAudit.findById(logId).lean();
    if (!log) return res.status(404).json({ message: 'Log not found' });

    const targetStatus = typeof log?.before?.isActive === 'boolean' ? log.before.isActive : null;
    if (targetStatus === null) {
      return res.status(400).json({ message: 'Log does not contain a reversible status value' });
    }

    if (log.entityType === 'User') {
      const user = await User.findById(log.entityId);
      if (!user) return res.status(404).json({ message: 'User not found' });
      const previous = user.isActive;
      user.isActive = targetStatus;
      await user.save();

      await AccountStatusAudit.logAction({
        action: 'status_undo',
        entityType: 'User',
        entityId: user._id,
        entityName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        actor: req.user?.id || req.user?._id || null,
        actorRole: 'admin',
        actorIP: req.ip,
        actorUserAgent: req.get('user-agent'),
        before: { isActive: previous },
        after: { isActive: targetStatus },
        metadata: { originalLogId: log._id, originalAction: log.action },
        success: true,
      });

      return res.json({ message: 'Status reverted', user });
    }

    if (log.entityType === 'Student') {
      const guardianId = log?.metadata?.guardianId;
      if (!guardianId) {
        return res.status(400).json({ message: 'Missing guardian reference for student log' });
      }

      const guardian = await User.findById(guardianId);
      if (!guardian) return res.status(404).json({ message: 'Guardian not found' });
      const student = guardian.guardianInfo?.students?.id(log.entityId);
      if (!student) return res.status(404).json({ message: 'Student not found under guardian' });

      const previous = student.isActive;
      student.isActive = targetStatus;
      guardian.markModified('guardianInfo.students');
      await guardian.save();

      await AccountStatusAudit.logAction({
        action: 'status_undo',
        entityType: 'Student',
        entityId: student._id,
        entityName: `${student.firstName || ''} ${student.lastName || ''}`.trim() || log.entityName || 'Student',
        actor: req.user?.id || req.user?._id || null,
        actorRole: 'admin',
        actorIP: req.ip,
        actorUserAgent: req.get('user-agent'),
        before: { isActive: previous },
        after: { isActive: targetStatus },
        metadata: {
          originalLogId: log._id,
          originalAction: log.action,
          guardianId: guardian._id,
          guardianName: `${guardian.firstName || ''} ${guardian.lastName || ''}`.trim() || guardian.email,
          studentName: `${student.firstName || ''} ${student.lastName || ''}`.trim()
        },
        success: true,
      });

      return res.json({ message: 'Student status reverted', student });
    }

    return res.status(400).json({ message: 'Unsupported log entity type' });
  } catch (error) {
    console.error('Undo account log error:', error);
    return res.status(500).json({ message: 'Failed to undo log action', error: error.message });
  }
});

/**
 * Admin: Delete account log entry (status logs only)
 * DELETE /api/users/admin/account-logs/:logId
 */
router.delete('/admin/account-logs/:logId', [
  authenticateToken,
  requireAdmin,
], async (req, res) => {
  const { logId } = req.params;
  const { source } = req.query || {};
  const resolvedSource = source || 'account-status';

  if (resolvedSource !== 'account-status') {
    return res.status(400).json({ message: 'Delete not supported for this log source' });
  }

  try {
    const deleted = await AccountStatusAudit.findByIdAndDelete(logId);
    if (!deleted) return res.status(404).json({ message: 'Log not found' });
    return res.json({ message: 'Log entry deleted' });
  } catch (error) {
    console.error('Delete account log error:', error);
    return res.status(500).json({ message: 'Failed to delete log', error: error.message });
  }
});

/**
 * Admin: Adjust guardian student hours reliably
 * POST /api/users/admin/guardians/:guardianId/students/:studentId/hours
 * Body: { action: 'add'|'subtract'|'set', hours: number }
 */
router.post('/admin/guardians/:guardianId/students/:studentId/hours', [
  authenticateToken,
  requireAdmin,
  body('action').isIn(['add', 'subtract', 'set']).withMessage('Action must be add, subtract, or set'),
  body('hours').isNumeric().withMessage('Hours must be a number'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  }

  try {
    const { guardianId, studentId } = req.params;
    const { action, hours } = req.body;

    const guardian = await User.findById(guardianId);
    if (!guardian) return res.status(404).json({ message: 'Guardian not found' });
    if (guardian.role !== 'guardian') return res.status(400).json({ message: 'User is not a guardian' });

    guardian.guardianInfo = guardian.guardianInfo && typeof guardian.guardianInfo === 'object' ? guardian.guardianInfo : {};
    const students = Array.isArray(guardian.guardianInfo.students) ? guardian.guardianInfo.students : [];

    const target = String(studentId);
    const idx = students.findIndex((s) => {
      const candidates = [
        s?._id,
        s?.id,
        s?.studentId,
        s?.standaloneStudentId,
        s?.studentInfo?.standaloneStudentId
      ]
        .filter(Boolean)
        .map((v) => String(v));
      return candidates.includes(target);
    });

    if (idx === -1) {
      return res.status(404).json({ message: 'Student not found under guardian' });
    }

    const current = Number(students[idx].hoursRemaining || 0);
    const delta = Number(hours) || 0;
    let next = current;
    if (action === 'add') next = current + delta;
    if (action === 'subtract') next = current - delta;
    if (action === 'set') next = delta;
    students[idx].hoursRemaining = Math.round(next * 1000) / 1000;

    guardian.guardianInfo.autoTotalHours = true;
    guardian.guardianInfo.totalHours = students.reduce((sum, s) => sum + (Number(s.hoursRemaining) || 0), 0);
    guardian.markModified('guardianInfo.students');
    guardian.markModified('guardianInfo');
    await guardian.save();

    try {
      await Guardian.updateTotalRemainingMinutes(guardian._id);
    } catch (syncErr) {
      console.warn('Student hours adjust: failed to sync Guardian model', syncErr && syncErr.message);
    }

    return res.json({
      message: 'Student hours updated successfully',
      guardianId: guardian._id,
      student: students[idx],
      totalHours: guardian.guardianInfo.totalHours,
      autoTotalHours: guardian.guardianInfo.autoTotalHours
    });
  } catch (error) {
    console.error('Update guardian student hours error:', error);
    return res.status(500).json({ message: 'Failed to update student hours', error: error.message });
  }
});

/**
 * Admin: Adjust teacher monthly hours
 * POST /api/users/admin/teachers/:teacherId/hours
 * Body: { action: 'add'|'subtract'|'set', hours: number }
 */
router.post('/admin/teachers/:teacherId/hours', [
  authenticateToken,
  requireAdmin,
  body('action').isIn(['add', 'subtract', 'set']).withMessage('Action must be add, subtract, or set'),
  body('hours').isNumeric().withMessage('Hours must be a number'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  }

  try {
    const { teacherId } = req.params;
    const { action, hours } = req.body;
    const teacher = await User.findById(teacherId);
    if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
    if (teacher.role !== 'teacher') return res.status(400).json({ message: 'User is not a teacher' });

    teacher.teacherInfo = teacher.teacherInfo || {};
    const current = Number(teacher.teacherInfo.monthlyHours || 0);
    const delta = Number(hours) || 0;
    let change = 0;
    if (action === 'add') change = delta;
    if (action === 'subtract') change = -delta;
    if (action === 'set') change = delta - current;

    await teacher.addTeachingHours(change);

    return res.json({
      message: 'Teacher hours updated successfully',
      teacherId: teacher._id,
      monthlyHours: teacher.teacherInfo?.monthlyHours || 0,
      monthlyRate: teacher.teacherInfo?.monthlyRate || 0,
      monthlyEarnings: teacher.teacherInfo?.monthlyEarnings || 0
    });
  } catch (error) {
    console.error('Update teacher hours error:', error);
    return res.status(500).json({ message: 'Failed to update teacher hours', error: error.message });
  }
});

/**
 * Get user by ID
 * GET /api/users/:id
 */
router.get('/:id', authenticateToken, requireResourceAccess('user'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    console.log("Fetching user with id:", req.params.id || req.body.user);

    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }
    
    res.json({ user });
    
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      message: 'Failed to fetch user',
      error: error.message
    });
  }
});

/**
 * Update user profile
 * PUT /api/users/:id
 */
router.put('/:id', authenticateToken, requireResourceAccess('user'), async (req, res) => {
  try {
    const updates = req.body;
    console.log('Backend PUT /users/:id received updates:', updates);
    console.log('Backend received bio field:', updates.bio);

    // Remove sensitive fields that shouldn't be updated via this endpoint
    delete updates.password;
    delete updates.role;
    delete updates.email;

    console.log('Backend updates after filtering:', updates);
    console.log('Backend bio after filtering:', updates.bio);

    // Fetch current user document to compute diffs and preserve middleware hooks
    const originalUser = await User.findById(req.params.id).select('-password');
    if (!originalUser) return res.status(404).json({ message: 'User not found' });

    // Capture teacher meeting link before mutation so we can propagate changes to upcoming classes.
    const previousTeacherMeetLink = (originalUser.teacherInfo?.googleMeetLink || '').trim();

    // If the stored document already has an invalid gender value (possible from earlier writes), clear it
    try {
      const allowedGenders = ['male', 'female'];
      if (originalUser.gender !== undefined && originalUser.gender !== null && !allowedGenders.includes(originalUser.gender)) {
        console.warn(`Backend: Clearing invalid stored gender value for user ${req.params.id}: ${originalUser.gender}`);
        originalUser.gender = undefined;
      }
    } catch (sanitErr) {
      console.warn('Failed to sanitize originalUser.gender', sanitErr);
    }

    // Remove guardian-specific fields that are no longer supported: top-level bio and instapayName
    try {
      if (originalUser.role === 'guardian') {
        if (originalUser.bio) {
          console.warn(`Backend: Removing stored top-level bio for guardian ${req.params.id}`);
          originalUser.bio = undefined;
        }
        if (originalUser.instapayName) {
          console.warn(`Backend: Removing stored top-level instapayName for guardian ${req.params.id}`);
          originalUser.instapayName = undefined;
        }
        // also guard against any guardianInfo.instapayName if it somehow exists
        if (originalUser.guardianInfo && originalUser.guardianInfo.instapayName) {
          console.warn(`Backend: Removing stored guardianInfo.instapayName for guardian ${req.params.id}`);
          delete originalUser.guardianInfo.instapayName;
        }
      }
    } catch (cleanuperr) {
      console.warn('Failed to cleanup guardian fields', cleanuperr);
    }
    console.log('Backend originalUser bio before update:', originalUser.bio);
    console.log('Backend originalUser role:', originalUser.role);
    console.log('Backend originalUser teacherInfo.bio before update:', originalUser.teacherInfo?.bio);

    // Handle bio field based on user role
    if (updates.bio !== undefined) {
      if (originalUser.role === 'teacher') {
        // For teachers, bio is stored in teacherInfo.bio
        if (!updates.teacherInfo) updates.teacherInfo = {};
        updates.teacherInfo.bio = updates.bio;
        console.log('Backend: Moving bio to teacherInfo.bio for teacher:', updates.bio);
      }
      // Remove top-level bio since it's not in the schema for any role
      delete updates.bio;
    }

    // Sanitize gender to avoid Mongoose enum validation errors
    if (updates.gender !== undefined) {
      const allowedGenders = ['male', 'female'];
      if (!allowedGenders.includes(updates.gender)) {
        console.warn(`Backend: Ignoring invalid gender value in update: ${updates.gender}`);
        delete updates.gender;
      }
    }

    // Handle spokenLanguages sent at top-level - map into role-specific nested object
    if (updates.spokenLanguages !== undefined) {
      try {
        if (originalUser.role === 'teacher') {
          if (!updates.teacherInfo) updates.teacherInfo = {};
          updates.teacherInfo.spokenLanguages = updates.spokenLanguages;
          console.log('Backend: Mapped top-level spokenLanguages into teacherInfo.spokenLanguages');
        } else if (originalUser.role === 'guardian') {
          if (!updates.guardianInfo) updates.guardianInfo = {};
          updates.guardianInfo.spokenLanguages = updates.spokenLanguages;
          console.log('Backend: Mapped top-level spokenLanguages into guardianInfo.spokenLanguages');
        }
      } catch (mapErr) {
        console.warn('Failed mapping spokenLanguages into nested object', mapErr);
      }
      delete updates.spokenLanguages;
    }

    // Map paymentMethod (frontend sometimes sends top-level paymentMethod) into guardianInfo.paymentMethod
    if (updates.paymentMethod !== undefined) {
      if (originalUser.role === 'guardian') {
        if (!updates.guardianInfo) updates.guardianInfo = {};
        // Normalize common frontend values to backend enum
        let pm = updates.paymentMethod;
        if (pm === 'bank' || pm === 'wise') pm = 'bank_transfer';
        if (pm === 'card') pm = 'credit_card';
        updates.guardianInfo.paymentMethod = pm;
        console.log('Backend: Mapped top-level paymentMethod into guardianInfo.paymentMethod');
        delete updates.paymentMethod;
      }
    }

    if (updates.hourlyRate !== undefined && originalUser.role === 'guardian') {
      if (!updates.guardianInfo) updates.guardianInfo = {};
      const hrValue = Number(updates.hourlyRate);
      if (Number.isFinite(hrValue)) {
        updates.guardianInfo.hourlyRate = hrValue;
      }
      delete updates.hourlyRate;
    }

    const transferFeePayload = (() => {
      if (updates.transferFee !== undefined) return updates.transferFee;
      if (updates.transferFees !== undefined) return updates.transferFees;
      return undefined;
    })();

    if (transferFeePayload !== undefined && originalUser.role === 'guardian') {
      if (!updates.guardianInfo) updates.guardianInfo = {};

      let normalized = transferFeePayload;
      if (normalized && typeof normalized === 'object') {
        const mode = typeof normalized.mode === 'string' ? normalized.mode.toLowerCase() : undefined;
        const allowedModes = ['fixed', 'percent'];
        normalized = {
          mode: allowedModes.includes(mode) ? mode : 'fixed',
          value: Number.isFinite(Number(normalized.value)) ? Number(normalized.value) : 5
        };
      } else if (Number.isFinite(Number(normalized))) {
        normalized = { mode: 'fixed', value: Number(normalized) };
      } else {
        normalized = { mode: 'fixed', value: 5 };
      }

      updates.guardianInfo.transferFee = normalized;
      delete updates.transferFee;
      delete updates.transferFees;
    }

    // Allow admins to update teacher preference fields: preferredStudentAgeRange, preferredFemaleAgeRange, preferredMaleAgeRange, studentsTaught
    if (originalUser.role === 'teacher') {
      if (req.user.role === 'admin') {
        // Validate incoming ranges before mapping them
        const validateRange = (r) => {
          if (!r) return null;
          const min = Number(r.min);
          const max = Number(r.max);
          if (isNaN(min) || isNaN(max)) return 'min and max must be numbers';
          if (min < 0 || max < 0 || min > 120 || max > 120) return 'min/max must be between 0 and 120';
          if (min > max) return 'min cannot be greater than max';
          return null;
        };
        const errors = [];
        if (updates.preferredStudentAgeRange !== undefined) {
          const e = validateRange(updates.preferredStudentAgeRange);
          if (e) errors.push({ field: 'preferredStudentAgeRange', message: e });
        }
        if (updates.preferredFemaleAgeRange !== undefined) {
          const e = validateRange(updates.preferredFemaleAgeRange);
          if (e) errors.push({ field: 'preferredFemaleAgeRange', message: e });
        }
        if (updates.preferredMaleAgeRange !== undefined) {
          const e = validateRange(updates.preferredMaleAgeRange);
          if (e) errors.push({ field: 'preferredMaleAgeRange', message: e });
        }
        if (errors.length) {
          return res.status(400).json({ message: 'Invalid preference ranges', errors });
        }
        if (updates.preferredStudentAgeRange !== undefined) {
          if (!updates.teacherInfo) updates.teacherInfo = {};
          updates.teacherInfo.preferredStudentAgeRange = updates.preferredStudentAgeRange;
          delete updates.preferredStudentAgeRange;
        }
        if (updates.preferredFemaleAgeRange !== undefined) {
          if (!updates.teacherInfo) updates.teacherInfo = {};
          updates.teacherInfo.preferredFemaleAgeRange = updates.preferredFemaleAgeRange;
          delete updates.preferredFemaleAgeRange;
        }
        if (updates.preferredMaleAgeRange !== undefined) {
          if (!updates.teacherInfo) updates.teacherInfo = {};
          updates.teacherInfo.preferredMaleAgeRange = updates.preferredMaleAgeRange;
          delete updates.preferredMaleAgeRange;
        }
        if (updates.studentsTaught !== undefined) {
          if (!updates.teacherInfo) updates.teacherInfo = {};
          updates.teacherInfo.studentsTaught = updates.studentsTaught;
          delete updates.studentsTaught;
        }
      } else {
        // Non-admins cannot change these fields; strip them if present
        delete updates.preferredStudentAgeRange;
        delete updates.preferredFemaleAgeRange;
        delete updates.preferredMaleAgeRange;
        delete updates.studentsTaught;
      }
    }

    // Helper to compute changed field paths between two objects
    function diffFields(oldObj, newObj, base = '') {
      const changed = [];
      const keys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);
      keys.forEach((k) => {
        const oldVal = oldObj ? oldObj[k] : undefined;
        const newVal = newObj ? newObj[k] : undefined;
        const path = base ? `${base}.${k}` : k;
        if (oldVal === undefined && newVal !== undefined) {
          changed.push(path);
        } else if (newVal === undefined && oldVal !== undefined) {
          changed.push(path);
        } else if (oldVal && newVal && typeof oldVal === 'object' && typeof newVal === 'object' && !(oldVal instanceof Date) && !(newVal instanceof Date)) {
          changed.push(...diffFields(oldVal, newVal, path));
        } else if ((oldVal instanceof Date) && (newVal instanceof Date)) {
          if (oldVal.getTime() !== newVal.getTime()) changed.push(path);
        } else if (String(oldVal) !== String(newVal)) {
          changed.push(path);
        }
      });
      return changed;
    }

    // If bank details are included in the update, mark them as pendingApproval and stamp lastUpdated
    let notifyAdminForBank = false;
    if (updates.teacherInfo && updates.teacherInfo.bankDetails) {
      updates.teacherInfo.bankDetails = {
        ...(updates.teacherInfo.bankDetails || {}),
        pendingApproval: true,
        lastUpdated: new Date()
      };
      notifyAdminForBank = true;
    }
    if (updates.guardianInfo && updates.guardianInfo.bankDetails) {
      updates.guardianInfo.bankDetails = {
        ...(updates.guardianInfo.bankDetails || {}),
        pendingApproval: true,
        lastUpdated: new Date()
      };
      notifyAdminForBank = true;
    }

    // Normalize admin settings (used by admins to manage meeting links / booking text)
    if (Object.prototype.hasOwnProperty.call(updates, 'adminSettings')) {
      if (!updates.adminSettings || typeof updates.adminSettings !== 'object') {
        delete updates.adminSettings;
      } else {
        const sanitizedAdminSettings = { ...updates.adminSettings };
        if (Object.prototype.hasOwnProperty.call(sanitizedAdminSettings, 'meetingLink')) {
          const trimmedLink = (sanitizedAdminSettings.meetingLink || '').trim();
          sanitizedAdminSettings.meetingLink = trimmedLink;
          const previousLink = (originalUser.adminSettings?.meetingLink || '').trim();
          if (trimmedLink !== previousLink) {
            sanitizedAdminSettings.meetingLinkUpdatedAt = new Date();
          } else if (!sanitizedAdminSettings.meetingLinkUpdatedAt && originalUser.adminSettings?.meetingLinkUpdatedAt) {
            sanitizedAdminSettings.meetingLinkUpdatedAt = originalUser.adminSettings.meetingLinkUpdatedAt;
          }
        }
        updates.adminSettings = sanitizedAdminSettings;
      }
    }

    // If guardianInfo is being updated for a guardian, deep-merge to avoid wiping embedded students
    if (originalUser.role === 'guardian' && updates.guardianInfo && typeof updates.guardianInfo === 'object') {
      try {
        const existing = originalUser.guardianInfo && typeof originalUser.guardianInfo === 'object'
          ? (typeof originalUser.guardianInfo.toObject === 'function' ? originalUser.guardianInfo.toObject() : originalUser.guardianInfo)
          : {};
        const incoming = updates.guardianInfo;

        // Only overwrite students if explicitly provided AND explicitly allowed.
        // Many forms send guardianInfo with defaults (students: []) which would otherwise wipe data.
        // To prevent accidental loss, require a truthy replace flag to allow replacement.
        const willReplaceStudents = Object.prototype.hasOwnProperty.call(incoming, 'students');
        const allowReplaceStudents = (function() {
          try {
            const q = String(req.query.replaceStudents || '').toLowerCase();
            const b = String(incoming.replaceStudents || updates.replaceStudents || '').toLowerCase();
            return q === 'true' || b === 'true';
          } catch (_) { return false; }
        })();

        const merged = { ...existing, ...incoming };
        if (willReplaceStudents) {
          const incomingStudents = Array.isArray(incoming.students) ? incoming.students : null;
          const hasExisting = existing && Array.isArray(existing.students) && existing.students.length > 0;
          // Block accidental wipe: if incoming is [] and we have existing and not explicitly allowed, keep existing
          if (!allowReplaceStudents && hasExisting && incomingStudents && incomingStudents.length === 0) {
            merged.students = existing.students;
          }
        } else if (existing && Array.isArray(existing.students)) {
          // If students wasn't part of the payload, preserve it
          merged.students = existing.students;
        }

        // Remove the helper flag if present in the payload
        if (merged && Object.prototype.hasOwnProperty.call(merged, 'replaceStudents')) {
          delete merged.replaceStudents;
        }
        updates.guardianInfo = merged;
      } catch (mergeErr) {
        console.warn('GuardianInfo merge failed, falling back to shallow set', mergeErr && mergeErr.message);
      }
    }

    // Apply updates onto the Mongoose document to run hooks/validators
    Object.keys(updates).forEach((key) => {
      // Avoid accidentally nulling entire guardianInfo
      if (key === 'guardianInfo' && originalUser.role === 'guardian' && (updates.guardianInfo == null || typeof updates.guardianInfo !== 'object')) {
        return; // skip invalid guardianInfo payloads
      }
      originalUser[key] = updates[key];
    });

    console.log('Backend originalUser bio after applying updates:', originalUser.bio);
    console.log('Backend originalUser teacherInfo.bio after applying updates:', originalUser.teacherInfo?.bio);

    // Save updated user
    await originalUser.save();

    const updatedUser = await User.findById(req.params.id).select('-password');
    console.log('Backend final saved user bio:', updatedUser.bio);
    console.log('Backend final saved user teacherInfo.bio:', updatedUser.teacherInfo?.bio);

    // If profile now has key fields, mark onboarding completed
    try {
      const required = ['phone', 'timezone', 'dateOfBirth', 'gender', 'profilePicture'];
      const hasAll = required.every(f => {
        const v = updatedUser[f];
        return v !== undefined && v !== null && (String(v).length > 0);
      });
      if (hasAll && !updatedUser.onboarding?.completed) {
        updatedUser.onboarding = { ...(updatedUser.onboarding || {}), completed: true };
        await updatedUser.save();
      }
    } catch (e) {
      console.warn('Onboarding completion check failed', e.message || e);
    }

    // Compute changed fields for notification (compare before/after)
    const changedFields = diffFields(originalUser.toObject ? originalUser.toObject() : {}, updatedUser.toObject ? updatedUser.toObject() : {});

    res.json({ message: 'User updated successfully', user: updatedUser });

    // If teacher updated their Google Meet link, propagate to upcoming classes and recurring patterns.
    try {
      if (updatedUser.role === 'teacher') {
        const newTeacherMeetLink = (updatedUser.teacherInfo?.googleMeetLink || '').trim();
        if (newTeacherMeetLink && newTeacherMeetLink !== previousTeacherMeetLink) {
          const Class = require('../models/Class');
          const now = new Date();
          const cancelledStatuses = ['cancelled', 'cancelled_by_admin', 'cancelled_by_teacher', 'cancelled_by_guardian'];

          // Only overwrite classes that are still using the old link (or have none).
          // This preserves any per-class custom meeting links.
          const overwriteFilter = {
            teacher: updatedUser._id,
            scheduledDate: { $gte: now },
            status: { $nin: cancelledStatuses },
            $or: [
              { meetingLink: null },
              { meetingLink: '' },
              ...(previousTeacherMeetLink ? [{ meetingLink: previousTeacherMeetLink }] : []),
            ],
          };

          const patternFilter = {
            teacher: updatedUser._id,
            status: 'pattern',
            $or: [
              { meetingLink: null },
              { meetingLink: '' },
              ...(previousTeacherMeetLink ? [{ meetingLink: previousTeacherMeetLink }] : []),
            ],
          };

          await Promise.all([
            Class.updateMany(overwriteFilter, { $set: { meetingLink: newTeacherMeetLink } }),
            Class.updateMany(patternFilter, { $set: { meetingLink: newTeacherMeetLink } }),
          ]);
        }
      }
    } catch (linkPropErr) {
      console.error('Failed to propagate teacher meeting link to upcoming classes:', linkPropErr);
    }

    // Notification handling
    try {
      const actorId = req.user.id;
      const actorRole = req.user.role;
      const who = `${updatedUser.firstName || ''} ${updatedUser.lastName || ''}`.trim() || updatedUser.email;

      // If the requestor updated their own profile, notify admins about changed fields
      if (actorId === String(updatedUser._id)) {
        if (changedFields.length) {
          const msg = `${who} updated their profile.${changedFields.length ? ` Updated: ${changedFields.join(', ')}.` : ''}`;
          // Notify admins via notificationService
          const notificationService = require('../services/notificationService');
          await notificationService.notifyRole({ role: 'admin', title: 'Profile updated', message: msg, type: 'request', related: { user: updatedUser._id }, actionRequired: false, actionLink: `/admin/users/${updatedUser._id}` });
        }
        // If bank details specifically updated, also notify admins (keeps prior behavior)
        if (notifyAdminForBank) {
          const instapayFromUser = (updatedUser.teacherInfo && updatedUser.teacherInfo.instapayName) || (updatedUser.guardianInfo && updatedUser.guardianInfo.instapayName);
          const messageBase = instapayFromUser
            ? `${who} updated their payment details (Instapay: ${instapayFromUser}). Please review.`
            : `${who} updated their payment details. Please review.`;
          await Notification.create({ role: 'admin', title: 'Payment details updated', message: messageBase, type: 'request', actionRequired: true, actionLink: `/admin/users/${updatedUser._id}` });
        }
      } else if (actorRole === 'admin') {
        // Admin edited a user -> notify that user which fields were changed
        if (changedFields.length) {
          const msg = `Your profile was updated by an administrator.${changedFields.length ? ` Updated: ${changedFields.join(', ')}.` : ''}`;
          const notificationService = require('../services/notificationService');
          await notificationService.createNotification({ userId: updatedUser._id, title: 'Profile updated', message: msg, type: 'info', actionRequired: false, actionLink: '/profile' });
        }
      }
    } catch (nerr) {
      console.error('Failed to create profile update notification:', nerr);
    }

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Failed to update user', error: error.message });
  }
});

/**
 * Get students for a guardian
 * GET /api/users/:guardianId/students
 */
router.get('/:guardianId/students', authenticateToken, async (req, res) => {
  try {
    const { guardianId } = req.params;
    
    // Check if the requesting user is the guardian or an admin
    if (req.user.id !== guardianId && req.user.role !== 'admin') {
      return res.status(403).json({
        message: 'Access denied. You can only view your own students.'
      });
    }
    
  const guardian = await User.findById(guardianId).select('-password');
    
    if (!guardian) {
      return res.status(404).json({
        message: 'Guardian not found'
      });
    }
    
    if (guardian.role !== 'guardian') {
      return res.status(400).json({
        message: 'User is not a guardian'
      });
    }

    const embedded = Array.isArray(guardian.guardianInfo?.students) ? guardian.guardianInfo.students : [];

    // Reconcile embedded -> standalone (best effort):
    // - Ensure every embedded student has its OWN standalone Student doc linked via standaloneStudentId
    // - Repair legacy bad state where multiple embedded students point at the same standaloneStudentId
    const createdStandalone = [];
    const idToEmbedded = new Map();
    for (const s of embedded) {
      const sid = s && (s.standaloneStudentId || s.studentInfo?.standaloneStudentId);
      if (!sid) continue;
      const key = String(sid);
      if (!idToEmbedded.has(key)) idToEmbedded.set(key, []);
      idToEmbedded.get(key).push(s);
    }

    const makeStandaloneFromEmbedded = async (s) => {
      const doc = new Student({
        firstName: s.firstName,
        lastName: s.lastName,
        email: (s.email || '').trim().toLowerCase() || undefined,
        guardian: guardianId,
        grade: s.grade,
        school: s.school,
        language: s.language,
        subjects: Array.isArray(s.subjects) ? s.subjects : [],
        phone: s.phone,
        whatsapp: s.whatsapp,
        learningPreferences: s.learningPreferences,
        evaluation: s.evaluation,
        evaluationSummary: s.evaluationSummary,
        dateOfBirth: s.dateOfBirth,
        gender: s.gender,
        timezone: s.timezone || guardian.timezone,
        profilePicture: s.profilePicture || undefined,
        isActive: typeof s.isActive === 'boolean' ? s.isActive : true,
        hoursRemaining: typeof s.hoursRemaining === 'number' ? s.hoursRemaining : 0,
        selfGuardian: !!s.selfGuardian,
        totalClassesAttended: s.totalClassesAttended || 0,
        currentTeachers: Array.isArray(s.currentTeachers) ? s.currentTeachers : [],
        notes: s.notes,
      });
      await doc.save();
      createdStandalone.push(doc);
      try {
        await Guardian.findOneAndUpdate(
          { user: guardianId },
          { $addToSet: { students: doc._id } },
          { upsert: true }
        );
      } catch (gErr) {
        console.warn('Failed to update Guardian.students during reconcile', gErr && gErr.message);
      }
      return doc;
    };

    // Repair duplicated standalone linkage
    for (const [sid, list] of idToEmbedded.entries()) {
      if (!Array.isArray(list) || list.length <= 1) continue;
      // Keep the first link, split the rest so each embedded student can show up separately.
      for (let i = 1; i < list.length; i++) {
        try {
          const newDoc = await makeStandaloneFromEmbedded(list[i]);
          list[i].standaloneStudentId = newDoc._id;
          if (list[i].studentInfo && typeof list[i].studentInfo === 'object') {
            list[i].studentInfo.standaloneStudentId = newDoc._id;
          }
        } catch (e) {
          console.warn('Failed to split duplicated standalone linkage', e && e.message);
        }
      }
    }

    // Ensure every embedded student has a standalone doc
    for (const s of embedded) {
      const sid = s && (s.standaloneStudentId || s.studentInfo?.standaloneStudentId);
      if (sid) {
        try {
          const exists = await Student.exists({ _id: sid });
          if (exists) continue;
        } catch (e) {
          // fall through to create
        }
      }

      // Self-guardian: keep single standalone when possible
      if (s.selfGuardian) {
        try {
          const existingSelf = await Student.findOne({ guardian: guardianId, selfGuardian: true });
          if (existingSelf) {
            s.standaloneStudentId = existingSelf._id;
            if (s.studentInfo && typeof s.studentInfo === 'object') {
              s.studentInfo.standaloneStudentId = existingSelf._id;
            }
            continue;
          }
        } catch (e) {
          // fall through
        }
      }

      try {
        const newDoc = await makeStandaloneFromEmbedded(s);
        s.standaloneStudentId = newDoc._id;
        if (s.studentInfo && typeof s.studentInfo === 'object') {
          s.studentInfo.standaloneStudentId = newDoc._id;
        }
      } catch (e) {
        console.warn('Failed to create standalone student during reconcile', e && e.message);
      }
    }

    if (createdStandalone.length) {
      try {
        await guardian.save();
      } catch (e) {
        console.warn('Failed to save guardian after reconcile', e && e.message);
      }
    }

    let standalone = [];
    try {
      standalone = await Student.find({ guardian: guardianId }).lean();
    } catch (sErr) {
      console.warn('Failed to fetch standalone students for guardian', guardianId, sErr && sErr.message);
    }

    // Normalize items to a common shape and tag source
      const normEmbedded = embedded.map((s) => ({
        ...(typeof s.toObject === 'function' ? s.toObject() : s),
        guardianId: guardian._id,
        guardianName: guardian.fullName,
        guardianTimezone: guardian.timezone,
        _source: 'embedded'
      }));
      const normStandalone = standalone.map((s) => ({
        ...s,
        guardianId: guardian._id,
        guardianName: guardian.fullName,
        guardianTimezone: guardian.timezone,
        _source: 'standalone'
      }));

    // Deduplicate for guardian view:
    // - Only merge when we have a strong match (linked id / selfGuardian / email)
    // - Prefer embedded when merged (guardian-scoped endpoints rely on embedded _id)
    const byKey = new Map();
    const makeGuardianMergeKey = (s) => {
      const g = String(s.guardianId || guardianId);
      if (!g) return null;

      // Linked embedded<->standalone
      const linkedStandaloneId = s._source === 'standalone' ? s._id : s.standaloneStudentId;
      if (linkedStandaloneId) return `${g}|standalone:${String(linkedStandaloneId)}`;

      if (s.selfGuardian) return `${g}|selfGuardian`;

      // Email/phone are not unique identifiers; do not merge by them.
      const dob = s.dateOfBirth ? new Date(s.dateOfBirth).toISOString().slice(0, 10) : '';
      const first = String(s.firstName || '').trim().toLowerCase();
      const last = String(s.lastName || '').trim().toLowerCase();
      if (dob && (first || last)) return `${g}|name:${first || 'unknown'}|last:${last || 'unknown'}|dob:${dob}`;

      // No safe merge key -> keep each record distinct
      if (s._source === 'embedded' && s._id) return `${g}|embedded:${String(s._id)}`;
      if (s._source === 'standalone' && s._id) return `${g}|standalone:${String(s._id)}`;
      return `${g}|hash:${Buffer.from(JSON.stringify(s)).toString('base64').slice(0, 24)}`;
    };

    for (const s of [...normEmbedded, ...normStandalone]) {
      const k = makeGuardianMergeKey(s);
      if (!k) continue;
      if (!byKey.has(k)) {
        byKey.set(k, s);
        continue;
      }
      const existing = byKey.get(k);

      // If we collide on the linkage key but have two distinct embedded students,
      // keep BOTH (this represents real multiple students, or legacy-bad linkage).
      if (existing && existing._source === 'embedded' && s._source === 'embedded') {
        const exId = existing._id;
        const inId = s._id;
        if (exId && inId && String(exId) !== String(inId)) {
          byKey.set(`${k}|embedded:${String(inId)}`, s);
          continue;
        }
      }

      // Prefer embedded over standalone
      if (existing && existing._source === 'standalone' && s._source === 'embedded') {
        byKey.set(k, s);
      }
    }

    const combinedStudents = Array.from(byKey.values());
    const totalHours = combinedStudents.reduce((sum, s) => sum + (Number(s.hoursRemaining) || 0), 0);
    const cumulativeConsumedHours = Number(guardian.guardianInfo?.cumulativeConsumedHours || 0);

    await attachScheduleActiveFlags(combinedStudents);

    const trimmedSearch = (req.query.search || '').trim().toLowerCase();
    let students = combinedStudents;
    if (trimmedSearch) {
      students = students.filter((student) => matchesStudentSearch(student, trimmedSearch));
    }
    students = sortStudentsAlpha(students);

    res.json({ students, totalHours, cumulativeConsumedHours });
    
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({
      message: 'Failed to fetch students',
      error: error.message
    });
  }
});

/**
 * Batch fetch students for multiple guardians
 * POST /api/users/students/batch
 * Body: { guardianIds: [id1, id2, ...] }
 * Returns: { map: { guardianId: ["First Last", ...], ... } }
 */
router.post('/students/batch', authenticateToken, async (req, res) => {
  try {
    const { guardianIds } = req.body;
    if (!Array.isArray(guardianIds)) {
      return res.status(400).json({ message: 'guardianIds must be an array' });
    }

    const uniqueIds = [...new Set(guardianIds.filter(Boolean))];

    // Authorization: non-admin users may only request their own guardian id
    if (req.user.role !== 'admin') {
      if (uniqueIds.length !== 1 || uniqueIds[0] !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Fetch guardians and return names of their students
    const guardians = await User.find({ _id: { $in: uniqueIds }, role: 'guardian' }).select('firstName lastName guardianInfo');
    const map = {};
    guardians.forEach(g => {
      const students = g.guardianInfo?.students || [];
      map[g._id] = students.map(s => `${s.firstName || ''} ${s.lastName || ''}`.trim());
    });

    res.json({ map });
  } catch (error) {
    console.error('Batch fetch students error:', error);
    res.status(500).json({ message: 'Failed to fetch students batch', error: error.message });
  }
});
/**
 * Get all students for admin (supports search + pagination-style limit)
 * GET /api/users/admin/all-students
 */
router.get('/admin/all-students', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { search = '', limit, guardianId, studentId, light } = req.query;
    const trimmedSearch = (search || '').trim();
    const lightMode = ['true', '1', 'yes'].includes(String(light || '').toLowerCase());
    const guardianObjectId = guardianId ? toObjectId(guardianId) : null;
    const studentObjectId = studentId ? toObjectId(studentId) : null;

    if (guardianId && !guardianObjectId) {
      return res.status(400).json({ message: 'Invalid guardianId' });
    }
    if (studentId && !studentObjectId) {
      return res.status(400).json({ message: 'Invalid studentId' });
    }

    const limitProvided = typeof limit !== 'undefined';
    const safeLimit = limitProvided ? Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200) : 0;
    const shouldUseFilteredFlow = Boolean(trimmedSearch || guardianObjectId || studentObjectId || limitProvided);

    if (shouldUseFilteredFlow) {
      const effectiveLimit = safeLimit || 200;
      const searchRegex = trimmedSearch ? new RegExp(escapeRegex(trimmedSearch), 'i') : null;
      const fetchLimit = Math.max(effectiveLimit * 3, 50);

      const guardianMatch = { role: 'guardian' };
      if (guardianObjectId) guardianMatch._id = guardianObjectId;
      if (studentObjectId) {
        guardianMatch['guardianInfo.students._id'] = studentObjectId;
      } else if (searchRegex) {
        guardianMatch.$or = [
          { 'guardianInfo.students.firstName': searchRegex },
          { 'guardianInfo.students.lastName': searchRegex },
          { 'guardianInfo.students.email': searchRegex },
        ];
      }

      const pipeline = [
        { $match: guardianMatch },
        { $project: { firstName: 1, lastName: 1, timezone: 1, students: '$guardianInfo.students' } },
        { $unwind: '$students' },
      ];

      if (studentObjectId) {
        pipeline.push({ $match: { 'students._id': studentObjectId } });
      } else if (searchRegex) {
        pipeline.push({
          $match: {
            $or: [
              { 'students.firstName': searchRegex },
              { 'students.lastName': searchRegex },
              { 'students.email': searchRegex },
            ],
          },
        });
      }

      pipeline.push(
        {
          $project: {
            guardianId: '$_id',
            guardianFirstName: '$firstName',
            guardianLastName: '$lastName',
            guardianTimezone: '$timezone',
            student: '$students',
          },
        },
        { $sort: { 'student.firstName': 1, 'student.lastName': 1 } },
        { $limit: fetchLimit },
      );

      const embeddedResults = await User.aggregate(pipeline);
      const embeddedStudents = embeddedResults.map((doc) => ({
        ...(doc.student || {}),
        guardianId: doc.guardianId,
        guardianName: `${doc.guardianFirstName || ''} ${doc.guardianLastName || ''}`.trim(),
        guardianTimezone: doc.guardianTimezone,
        _source: 'embedded',
      }));

      const standaloneQuery = {};
      if (guardianObjectId) standaloneQuery.guardian = guardianObjectId;
      if (studentObjectId) {
        standaloneQuery._id = studentObjectId;
      } else if (searchRegex) {
        standaloneQuery.$or = [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex },
        ];
      }

      const standaloneDocs = await Student.find(standaloneQuery)
        .sort({ firstName: 1, lastName: 1 })
        .limit(fetchLimit)
        .populate('guardian', 'firstName lastName timezone')
        .lean();

      const standaloneStudents = standaloneDocs.map((student) => ({
        ...student,
        guardianId: student.guardian?._id || student.guardian,
        guardianName: student.guardian
          ? `${student.guardian.firstName || ''} ${student.guardian.lastName || ''}`.trim()
          : undefined,
        guardianTimezone: student.guardian?.timezone,
        _source: 'standalone',
      }));

      let students = dedupeStudents([...embeddedStudents, ...standaloneStudents]);

      if (trimmedSearch && !studentObjectId) {
        students = students.filter((student) => matchesStudentSearch(student, trimmedSearch));
      }

      students = sortStudentsAlpha(students);

      if (studentObjectId) {
        students = students.filter((student) => String(student._id) === String(studentId));
      }

      if (effectiveLimit) {
        students = students.slice(0, effectiveLimit);
      }

      if (!lightMode) {
        await attachScheduleActiveFlags(students);
      } else {
        students = students.map((student) => ({
          ...student,
          activityState: 'loading'
        }));
      }
      students = sanitizeStudentHours(students);

      return res.json({ students });
    }

    // Legacy full fetch (no filters applied)
    const guardians = await User.find({ role: 'guardian' }).select('firstName lastName guardianInfo timezone').lean();
    const guardianIdList = guardians.map((g) => g._id);

    const embeddedAll = [];
    guardians.forEach((guardian) => {
      const arr = Array.isArray(guardian.guardianInfo?.students) ? guardian.guardianInfo.students : [];
      arr.forEach((student) => {
        const base = student && typeof student === 'object' && typeof student.toObject === 'function' ? student.toObject() : student;
        embeddedAll.push({
          ...base,
          guardianId: guardian._id,
          guardianName: `${guardian.firstName || ''} ${guardian.lastName || ''}`.trim(),
          guardianTimezone: guardian.timezone,
          _source: 'embedded',
        });
      });
    });

    let standaloneAll = [];
    try {
      standaloneAll = await Student.find({ guardian: { $in: guardianIdList } }).lean();
      standaloneAll = standaloneAll.map((student) => ({
        ...student,
        guardianId: student.guardian,
        guardianName: (() => {
          const guardian = guardians.find((g) => String(g._id) === String(student.guardian));
          return guardian ? `${guardian.firstName || ''} ${guardian.lastName || ''}`.trim() : undefined;
        })(),
        guardianTimezone: (() => {
          const guardian = guardians.find((g) => String(g._id) === String(student.guardian));
          return guardian ? guardian.timezone : undefined;
        })(),
        _source: 'standalone',
      }));
    } catch (standaloneErr) {
      console.warn('Admin all-students: failed to fetch standalone students', standaloneErr && standaloneErr.message);
    }

    let students = dedupeStudents([...embeddedAll, ...standaloneAll]);
    if (!lightMode) {
      await attachScheduleActiveFlags(students);
    } else {
      students = students.map((student) => ({
        ...student,
        activityState: 'loading'
      }));
    }
    students = sanitizeStudentHours(students);

    try {
      const guardianIds = [...new Set(students.map((student) => String(student.guardianId || student.guardian)).filter(Boolean))];
      if (guardianIds.length) {
        const guardianRecords = await User.find({ _id: { $in: guardianIds } }).select('firstName lastName timezone').lean();
        const gMap = {};
        guardianRecords.forEach((guardian) => {
          gMap[String(guardian._id)] = guardian;
        });
        students = students.map((student) => {
          const record = gMap[String(student.guardianId || student.guardian)];
          return {
            ...student,
            guardianName: student.guardianName || (record ? `${record.firstName || ''} ${record.lastName || ''}`.trim() : student.guardianName),
            guardianTimezone: student.guardianTimezone || record?.timezone,
          };
        });
      }
    } catch (enrichErr) {
      console.warn('Failed to enrich teacher students with guardian timezone', enrichErr && enrichErr.message);
    }

    res.json({ students });
  } catch (error) {
    console.error('Admin fetch all students error:', error);
    res.status(500).json({ message: 'Failed to fetch all students', error: error.message });
  }
});

/**
 * Get students for a teacher (based on classes - to be implemented)
 * GET /api/users/teacher/:teacherId/students
 */
router.get('/teacher/:teacherId/students', authenticateToken, async (req, res) => {
  try {
    const { teacherId } = req.params;

    if (req.user.id !== teacherId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Collect standalone students taught by this teacher
    let standalone = [];
    try {
      standalone = await Student.find({ currentTeachers: teacherId }).lean();
    } catch (sErr) {
      console.warn('Teacher students: failed to fetch standalone', sErr && sErr.message);
    }

    // Collect embedded students taught by this teacher
    let embedded = [];
    try {
      const guardians = await User.find({ role: 'guardian', 'guardianInfo.students.currentTeachers': teacherId }).select('firstName lastName guardianInfo timezone').lean();
      guardians.forEach(g => {
        const arr = Array.isArray(g.guardianInfo?.students) ? g.guardianInfo.students : [];
        arr.forEach(s => {
          const teachers = Array.isArray(s.currentTeachers) ? s.currentTeachers.map(String) : [];
          if (teachers.includes(String(teacherId))) {
            embedded.push({ ...s, guardianId: g._id, guardianName: `${g.firstName || ''} ${g.lastName || ''}`.trim(), guardianTimezone: g.timezone, _source: 'embedded' });
          }
        });
      });
    } catch (eErr) {
      console.warn('Teacher students: failed to fetch embedded', eErr && eErr.message);
    }

    // Normalize standalone
    const normStandalone = standalone.map(s => ({ ...s, guardianId: s.guardian, _source: 'standalone' }));

    // For teachers, prefer embedded records when duplicates exist.
    // Embedded students generally have the guardian-managed fields (subjects/timezone) that teachers expect,
    // while standalone students can have default values like timezone=UTC.
    let students = dedupeStudents([...embedded, ...normStandalone], { prefer: 'embedded' });
    const totalHours = students.reduce((sum, s) => sum + (Number(s.hoursRemaining) || 0), 0);

    // Enrich with guardian timezone and guardianName when possible
    try {
      const guardianIds = [...new Set(students.map(s => String(s.guardianId || s.guardian)).filter(Boolean))];
      if (guardianIds.length) {
        const guardians = await User.find({ _id: { $in: guardianIds } }).select('firstName lastName timezone').lean();
        const gMap = {};
        guardians.forEach(g => { gMap[String(g._id)] = g; });
        students = students.map(s => {
          const g = gMap[String(s.guardianId || s.guardian)];
          return {
            ...s,
            guardianName: s.guardianName || (g ? `${g.firstName || ''} ${g.lastName || ''}`.trim() : s.guardianName),
            guardianTimezone: s.guardianTimezone || (g ? g.timezone : undefined)
          };
        });
      }
    } catch (enrichErr) {
      console.warn('Failed to enrich teacher students with guardian timezone', enrichErr && enrichErr.message);
    }

    res.json({ students, totalHours });
  } catch (error) {
    console.error('Teacher fetch students error:', error);
    res.status(500).json({ message: 'Failed to fetch teacher students', error: error.message });
  }
});

/**
 * Add a student to a guardian's account
 * POST /api/users/:guardianId/students
 */
router.post('/:guardianId/students', [
  authenticateToken,
  body('firstName').notEmpty().trim().withMessage('First name is required'),
  body('lastName').notEmpty().trim().withMessage('Last name is required'),
  body('email').optional().isEmail().withMessage('Please provide a valid email'),
  body('phone')
    .optional()
    .matches(/^\+?[0-9]{7,15}$/)
    .withMessage('Please provide a valid phone number'),
  body('whatsapp')
    .optional()
    .matches(/^\+?[0-9]{7,15}$/)
    .withMessage('Please provide a valid WhatsApp number'),
  body('dateOfBirth').notEmpty().isISO8601().withMessage('Date of birth is required'),
  body('gender').optional().isIn(['male', 'female']).withMessage('Invalid gender'),
  body('timezone').optional().isString().withMessage('Timezone must be a string'),
  body('grade').optional().isString().withMessage('Grade must be a string'),
  body('school').optional().isString().withMessage('School must be a string'),
  body('language').optional().isString().withMessage('Language must be a string'),
  body('hoursRemaining').optional().isNumeric().withMessage('Hours remaining must be a number'),
  body('selfGuardian').optional().isBoolean().withMessage('Self guardian must be a boolean'),
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const { guardianId } = req.params;
    const studentData = req.body;
    
    // Check if the requesting user is the guardian or an admin
    if (req.user.id !== guardianId && req.user.role !== 'admin') {
      return res.status(403).json({
        message: 'Access denied. You can only add students to your own account.'
      });
    }
    
    const guardian = await User.findById(guardianId);
    
    if (!guardian) {
      return res.status(404).json({
        message: 'Guardian not found'
      });
    }
    
    if (guardian.role !== 'guardian') {
      return res.status(400).json({
        message: 'User is not a guardian'
      });
    }
    
    // If self-enrollment, populate with guardian's data
    if (studentData.selfGuardian) {
      studentData.firstName = guardian.firstName;
      studentData.lastName = guardian.lastName;
      studentData.email = guardian.email;
      studentData.phone = guardian.phone;
      studentData.whatsapp = guardian.phone; // Default to guardian's phone
      // Only override DOB if guardian has one; otherwise keep the submitted DOB (required for identity).
      if (guardian.dateOfBirth) studentData.dateOfBirth = guardian.dateOfBirth;
      if (guardian.gender) studentData.gender = guardian.gender;
      if (guardian.timezone) studentData.timezone = guardian.timezone;
    }
    
    // Add the student using the User model method
    await guardian.addStudent(studentData);
    
    // Fetch the updated guardian to get the new student with _id
    const updatedGuardian = await User.findById(guardianId).select('-password');
    const newStudent = updatedGuardian.guardianInfo.students[updatedGuardian.guardianInfo.students.length - 1];
    
    // Best-effort: mirror to standalone Student model + link back to embedded subdoc.
    // This keeps "normal" Student records available for flows that depend on Student collection.
    try {
      const keyEmail = (newStudent.email || '').trim().toLowerCase();
      const keyDob = newStudent.dateOfBirth ? new Date(newStudent.dateOfBirth).toISOString().slice(0, 10) : '';
      const keyName = `${(newStudent.firstName || '').trim().toLowerCase()}|${(newStudent.lastName || '').trim().toLowerCase()}`;

      // IMPORTANT: students are not identified by email/phone in this system.
      // To avoid collapsing multiple students into one, we create a NEW Student doc
      // for each embedded student (except explicit linkage/self-guardian).
      let standaloneStudent = null;
      if (newStudent.standaloneStudentId) {
        standaloneStudent = await Student.findById(newStudent.standaloneStudentId);
      } else if (newStudent.selfGuardian) {
        standaloneStudent = await Student.findOne({ guardian: guardianId, selfGuardian: true });
      }

      if (!standaloneStudent) {
        standaloneStudent = new Student({
          firstName: newStudent.firstName,
          lastName: newStudent.lastName,
          email: keyEmail || undefined,
          guardian: guardianId,
          grade: newStudent.grade,
          school: newStudent.school,
          language: newStudent.language,
          subjects: Array.isArray(newStudent.subjects) ? newStudent.subjects : [],
          phone: newStudent.phone,
          whatsapp: newStudent.whatsapp,
          learningPreferences: newStudent.learningPreferences,
          evaluation: newStudent.evaluation,
          evaluationSummary: newStudent.evaluationSummary,
          dateOfBirth: newStudent.dateOfBirth,
          gender: newStudent.gender,
          timezone: newStudent.timezone,
          profilePicture: newStudent.profilePicture || undefined,
          isActive: typeof newStudent.isActive === 'boolean' ? newStudent.isActive : true,
          hoursRemaining: typeof newStudent.hoursRemaining === 'number' ? newStudent.hoursRemaining : 0,
          selfGuardian: !!newStudent.selfGuardian,
          totalClassesAttended: newStudent.totalClassesAttended || 0,
          currentTeachers: Array.isArray(newStudent.currentTeachers) ? newStudent.currentTeachers : [],
          notes: newStudent.notes,
        });
        await standaloneStudent.save();

        await Guardian.findOneAndUpdate(
          { user: guardianId },
          { $addToSet: { students: standaloneStudent._id } },
          { upsert: true }
        );
      }

      // Link embedded -> standalone if not already linked
      if (!newStudent.standaloneStudentId) {
        const guardianToLink = await User.findById(guardianId);
        const embeddedToLink = guardianToLink?.guardianInfo?.students?.id(newStudent._id);
        if (embeddedToLink && !embeddedToLink.standaloneStudentId) {
          embeddedToLink.standaloneStudentId = standaloneStudent._id;
          await guardianToLink.save();
        }
      }
    } catch (mirrorErr) {
      console.warn('Failed to mirror embedded student to standalone Student model', mirrorErr && mirrorErr.message);
    }

    res.status(201).json({
      message: 'Student added successfully',
      student: newStudent,
      totalHours: updatedGuardian.guardianInfo?.totalHours || 0
    });
    
  } catch (error) {
    console.error('Add student error:', error);
    
    if (error.message === 'Guardian is already enrolled as a student') {
      return res.status(400).json({
        message: error.message
      });
    }
    
    res.status(500).json({
      message: 'Failed to add student',
      error: error.message
    });
  }
});

/**
 * Update a student in a guardian's account
 * PUT /api/users/:guardianId/students/:studentId
 */
router.put('/:guardianId/students/:studentId', [
  authenticateToken,
  body('firstName').optional({ nullable: true }).notEmpty().trim().withMessage('First name cannot be empty'),
  body('lastName').optional({ nullable: true }).notEmpty().trim().withMessage('Last name cannot be empty'),
  body('email').optional({ nullable: true }).isEmail().withMessage('Please provide a valid email'),
  body('phone')
    .optional({ nullable: true })
    .matches(/^\+?[0-9]{7,15}$/)
    .withMessage('Please provide a valid phone number'),
  body('whatsapp')
    .optional({ nullable: true })
    .matches(/^\+?[0-9]{7,15}$/)
    .withMessage('Please provide a valid WhatsApp number'),
  body('dateOfBirth').optional({ nullable: true }).isISO8601().withMessage('Please provide a valid date of birth'),
  body('gender').optional({ nullable: true }).isIn(['male', 'female']).withMessage('Invalid gender'),
  body('hoursRemaining').optional({ nullable: true }).isNumeric().withMessage('Hours remaining must be a number'),
  body('isActive').optional({ nullable: true }).isBoolean().withMessage('Active status must be a boolean'),
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const { guardianId, studentId } = req.params;
    const updateData = req.body;
    
    // Check if the requesting user is the guardian or an admin
    if (req.user.id !== guardianId && req.user.role !== 'admin') {
      return res.status(403).json({
        message: 'Access denied. You can only update your own students.'
      });
    }
    
    const guardian = await User.findById(guardianId);
    
    if (!guardian) {
      return res.status(404).json({
        message: 'Guardian not found'
      });
    }
    
    if (guardian.role !== 'guardian') {
      return res.status(400).json({
        message: 'User is not a guardian'
      });
    }
    
    // Update the student using the User model method
    await guardian.updateStudent(studentId, updateData);
    
    // Fetch the updated guardian to get the updated student
    const updatedGuardian = await User.findById(guardianId).select('-password');
    const updatedStudent = updatedGuardian.guardianInfo.students.id(studentId);

    if (typeof updateData.isActive === 'boolean' && beforeStatus !== updateData.isActive) {
      try {
        await AccountStatusAudit.logAction({
          action: 'student_status_change',
          entityType: 'Student',
          entityId: updatedStudent._id,
          entityName: `${updatedStudent.firstName || ''} ${updatedStudent.lastName || ''}`.trim() || 'Student',
          actor: req.user?.id || req.user?._id || null,
          actorRole: req.user?.role === 'admin' ? 'admin' : 'system',
          actorIP: req.ip,
          actorUserAgent: req.get('user-agent'),
          before: { isActive: beforeStatus },
          after: { isActive: updateData.isActive },
          metadata: {
            guardianId: updatedGuardian._id,
            guardianName: `${updatedGuardian.firstName || ''} ${updatedGuardian.lastName || ''}`.trim() || updatedGuardian.email,
            studentName: `${updatedStudent.firstName || ''} ${updatedStudent.lastName || ''}`.trim()
          },
          success: true,
        });
      } catch (auditErr) {
        console.warn('Student status audit failed', auditErr && auditErr.message);
      }
    }
    
    res.json({
      message: 'Student updated successfully',
      student: updatedStudent,
      totalHours: updatedGuardian.guardianInfo?.totalHours || 0
    });
    
  } catch (error) {
    console.error('Update student error:', error);
    
    if (error.message === 'Student not found') {
      return res.status(404).json({
        message: error.message
      });
    }
    
    res.status(500).json({
      message: 'Failed to update student',
      error: error.message
    });
  }
});

/**
 * Remove a student from a guardian's account
 * DELETE /api/users/:guardianId/students/:studentId
 */
router.delete('/:guardianId/students/:studentId', authenticateToken, async (req, res) => {
  try {
    const { guardianId, studentId } = req.params;
    
    // Check if the requesting user is the guardian or an admin
    if (req.user.id !== guardianId && req.user.role !== 'admin') {
      return res.status(403).json({
        message: 'Access denied. You can only remove your own students.'
      });
    }
    
    const guardian = await User.findById(guardianId);
    
    if (!guardian) {
      return res.status(404).json({
        message: 'Guardian not found'
      });
    }
    
    if (guardian.role !== 'guardian') {
      return res.status(400).json({
        message: 'User is not a guardian'
      });
    }

    const embedded = guardian.guardianInfo?.students?.id(studentId);
    if (!embedded) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const linkedStandaloneId = embedded.standaloneStudentId || embedded.studentInfo?.standaloneStudentId || null;
    
    // Remove the student using the User model method
    await guardian.removeStudent(studentId);

    // Best-effort: also delete the linked standalone Student doc if no other embedded student references it.
    try {
      if (linkedStandaloneId) {
        const stillReferenced = (guardian.guardianInfo?.students || []).some(
          (s) => String(s.standaloneStudentId || s.studentInfo?.standaloneStudentId || '') === String(linkedStandaloneId)
        );
        if (!stillReferenced) {
          await Guardian.findOneAndUpdate(
            { user: guardianId },
            { $pull: { students: linkedStandaloneId } }
          );
          await Student.findByIdAndDelete(linkedStandaloneId);
        }
      }
    } catch (e) {
      console.warn('Failed to cleanup standalone student during embedded delete', e && e.message);
    }
    
    // Fetch the updated guardian to get the updated total hours
    const updatedGuardian = await User.findById(guardianId).select('-password');
    
    res.json({
      message: 'Student removed successfully',
      totalHours: updatedGuardian.guardianInfo?.totalHours || 0
    });
    
  } catch (error) {
    console.error('Remove student error:', error);
    res.status(500).json({
      message: 'Failed to remove student',
      error: error.message
    });
  }
});

/**
 * Update student hours (Admin only)
 * PUT /api/users/:guardianId/students/:studentId/hours
 */
router.put('/:guardianId/students/:studentId/hours', [
  authenticateToken,
  requireAdmin,
  body('action').isIn(['add', 'subtract', 'set']).withMessage('Action must be add, subtract, or set'),
  body('hours').isNumeric().withMessage('Hours must be a number'),
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const { guardianId, studentId } = req.params;
    const { action, hours } = req.body;
    
    const guardian = await User.findById(guardianId);
    
    if (!guardian) {
      return res.status(404).json({
        message: 'Guardian not found'
      });
    }
    
    if (guardian.role !== 'guardian') {
      return res.status(400).json({
        message: 'User is not a guardian'
      });
    }
    
    const student = guardian.guardianInfo.students.id(studentId);
    if (!student) {
      return res.status(404).json({
        message: 'Student not found'
      });
    }
    
    // Update hours based on action
    let newHours = student.hoursRemaining || 0;
    
    switch (action) {
      case 'add':
        newHours += parseFloat(hours);
        break;
      case 'subtract':
        newHours -= parseFloat(hours);
        break;
      case 'set':
        newHours = parseFloat(hours);
        break;
    }
    
    // Update the student's hours
    await guardian.updateStudent(studentId, { hoursRemaining: newHours });
    
    // Fetch the updated guardian to get the updated student and total hours
    const updatedGuardian = await User.findById(guardianId).select('-password');
    const updatedStudent = updatedGuardian.guardianInfo.students.id(studentId);
    
    res.json({
      message: 'Student hours updated successfully',
      student: updatedStudent,
      totalHours: updatedGuardian.guardianInfo?.totalHours || 0
    });
    
  } catch (error) {
    console.error('Update student hours error:', error);
    res.status(500).json({
      message: 'Failed to update student hours',
      error: error.message
    });
  }
});

/**
 * Upload student profile picture
 * POST /api/users/:guardianId/students/:studentId/profile-picture
 * multipart/form-data { file }
 */
router.post('/:guardianId/students/:studentId/profile-picture', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { guardianId, studentId } = req.params;

    // Authorization: guardian can upload for their students, admins can upload for any
    if (req.user.id !== guardianId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const file = req.file;
    if (!file) return res.status(400).json({ message: 'No file uploaded' });

    // Convert buffer to data URI
    const mime = file.mimetype || 'image/jpeg';
    const dataUri = `data:${mime};base64,${file.buffer.toString('base64')}`;

    let pictureUrl = dataUri;
    let picturePublicId = null;
    let pictureThumb = dataUri;
    let pictureThumbPublicId = null;

    // Try to upload to Cloudinary if configured
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      try {
        const { main, thumb } = await uploadImage(dataUri, { folder: `waraqa/student_pictures/${guardianId}/${studentId}` });
        pictureUrl = main.secure_url || main.url;
        picturePublicId = main.public_id;
        pictureThumb = thumb.secure_url || thumb.url;
        pictureThumbPublicId = thumb.public_id;
      } catch (uErr) {
        console.warn('Cloudinary upload failed for student picture, falling back to base64:', uErr && uErr.message);
      }
    }

    // Try updating embedded student first
    const guardian = await User.findById(guardianId);
    if (!guardian) return res.status(404).json({ message: 'Guardian not found' });

    let updatedStudent = null;

    // If student exists embedded in guardian, update that
    if (guardian.guardianInfo && Array.isArray(guardian.guardianInfo.students)) {
      const s = guardian.guardianInfo.students.id(studentId);
      if (s) {
        // Delete old images if public ids exist
        try {
          const toDelete = [];
          if (s.profilePicturePublicId) toDelete.push(s.profilePicturePublicId);
          if (s.profilePictureThumbnailPublicId) toDelete.push(s.profilePictureThumbnailPublicId);
          if (toDelete.length) await deleteImage(toDelete);
        } catch (dErr) { console.warn('Failed to delete old student images', dErr && dErr.message); }

  s.profilePicture = { url: pictureUrl, publicId: picturePublicId, thumbnail: pictureThumb, thumbnailPublicId: pictureThumbPublicId };

        await guardian.save();
        updatedStudent = guardian.guardianInfo.students.id(studentId);
        return res.json({ message: 'Student picture uploaded', student: updatedStudent });
      }
    }

    // If not embedded, try standalone Student collection
    const student = await Student.findById(studentId);
    if (student && String(student.guardian) === String(guardianId)) {
      try {
        const toDelete = [];
        if (student.profilePicture && student.profilePicture.publicId) toDelete.push(student.profilePicture.publicId);
        if (student.profilePicture && student.profilePicture.thumbnailPublicId) toDelete.push(student.profilePicture.thumbnailPublicId);
        if (toDelete.length) await deleteImage(toDelete);
      } catch (dErr) { console.warn('Failed to delete old standalone student images', dErr && dErr.message); }

  student.profilePicture = { url: pictureUrl, publicId: picturePublicId, thumbnail: pictureThumb, thumbnailPublicId: pictureThumbPublicId };
      await student.save();
      return res.json({ message: 'Student picture uploaded', student });
    }

    return res.status(404).json({ message: 'Student not found for this guardian' });
  } catch (error) {
    console.error('Upload student picture error:', error);
    res.status(500).json({ message: 'Failed to upload student picture', error: error.message });
  }
});

/**
 * Delete student profile picture
 * DELETE /api/users/:guardianId/students/:studentId/profile-picture
 */
router.delete('/:guardianId/students/:studentId/profile-picture', authenticateToken, async (req, res) => {
  try {
    const { guardianId, studentId } = req.params;
    if (req.user.id !== guardianId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const guardian = await User.findById(guardianId);
    if (!guardian) return res.status(404).json({ message: 'Guardian not found' });

    if (guardian.guardianInfo && Array.isArray(guardian.guardianInfo.students)) {
      const s = guardian.guardianInfo.students.id(studentId);
      if (s) {
        try {
          const toDelete = [];
          if (s.profilePicturePublicId) toDelete.push(s.profilePicturePublicId);
          if (s.profilePictureThumbnailPublicId) toDelete.push(s.profilePictureThumbnailPublicId);
          if (toDelete.length) await deleteImage(toDelete);
        } catch (dErr) { console.warn('Failed to delete old student images', dErr && dErr.message); }

  s.profilePicture = null;
        await guardian.save();
        return res.json({ message: 'Student picture removed', student: guardian.guardianInfo.students.id(studentId) });
      }
    }

    const student = await Student.findById(studentId);
    if (student && String(student.guardian) === String(guardianId)) {
      try {
        const toDelete = [];
        if (student.profilePicture && student.profilePicture.publicId) toDelete.push(student.profilePicture.publicId);
        if (student.profilePicture && student.profilePicture.thumbnailPublicId) toDelete.push(student.profilePicture.thumbnailPublicId);
        if (toDelete.length) await deleteImage(toDelete);
      } catch (dErr) { console.warn('Failed to delete standalone student images', dErr && dErr.message); }

  student.profilePicture = null;
      await student.save();
      return res.json({ message: 'Student picture removed', student });
    }

    return res.status(404).json({ message: 'Student not found for this guardian' });
  } catch (error) {
    console.error('Delete student picture error:', error);
    res.status(500).json({ message: 'Failed to delete student picture', error: error.message });
  }
});

/**
 * Update user active status (Admin only)
 * PUT /api/users/:id/status
 */
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  try {
    const existing = await User.findById(id);
    if (!existing) {
      return res.status(404).json({ message: 'User not found' });
    }

    const previous = existing.isActive;
    const user = await User.findByIdAndUpdate(id, { isActive }, { new: true });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (typeof isActive === 'boolean' && previous !== isActive) {
      try {
        await AccountStatusAudit.logAction({
          action: 'user_status_change',
          entityType: 'User',
          entityId: user._id,
          entityName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
          actor: req.user?.id || req.user?._id || null,
          actorRole: 'admin',
          actorIP: req.ip,
          actorUserAgent: req.get('user-agent'),
          before: { isActive: previous },
          after: { isActive },
          metadata: { role: user.role },
          success: true,
        });
      } catch (auditErr) {
        console.warn('User status audit failed', auditErr && auditErr.message);
      }
    }

    res.json({ message: 'User status updated successfully', user });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ message: 'Failed to update status', error: error.message });
  }
});

/**
 * Hard delete a user (Admin only)
 * DELETE /api/users/:id
 *
 * Notes:
 * - Permanent delete; no restore flow (must create new account).
 * - Prevent deleting self.
 * - Best-effort cleanup of related role documents.
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  const requesterId = String(req.user?._id || req.user?.id || req.user?.userId || '');
  if (requesterId && requesterId === String(id)) {
    return res.status(400).json({ message: 'You cannot delete your own account' });
  }

  const userToDelete = await User.findById(id);
  if (!userToDelete) {
    return res.status(404).json({ message: 'User not found' });
  }

  const userId = userToDelete._id;

  const runDelete = async (session = null) => {
    const withSession = (query) => (session ? query.session(session) : query);

    // If the user is a guardian, remove standalone students linked to them.
    await withSession(Student.deleteMany({ guardian: userId }));

    // If the user is a teacher, ensure students don't retain stale references.
    await withSession(Student.updateMany(
      { currentTeachers: userId },
      { $pull: { currentTeachers: userId } }
    ));

    // Delete role documents (if any)
    await withSession(Teacher.deleteMany({ user: userId }));
    await withSession(Guardian.deleteMany({ user: userId }));

    // Finally delete the user.
    await withSession(User.deleteOne({ _id: userId }));
  };

  try {
    // Try transaction first (replica sets / Atlas). Fall back gracefully if unsupported.
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await runDelete(session);
      });
    } catch (txErr) {
      const msg = String(txErr?.message || '');
      const txUnsupported = msg.includes('Transaction') || msg.includes('replica set') || msg.includes('not supported');
      if (!txUnsupported) throw txErr;
      await runDelete(null);
    } finally {
      session.endSession();
    }

    return res.json({
      message: 'User deleted permanently',
      deletedUserId: String(userId),
    });
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({ message: 'Failed to delete user', error: error.message });
  }
});

/**
 * Admin logs in as another user
 */
router.post('/:id/login-as', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userToImpersonate = await User.findById(req.params.id);
    if (!userToImpersonate) {
      return res.status(404).json({ message: 'User not found' });
    }

    const token = generateToken(userToImpersonate, { impersonatedBy: req.user?._id });

    res.json({
      user: userToImpersonate,
      token,
      originalAdmin: true,
    });
  } catch (err) {
    console.error('Login as user failed:', err);
    res.status(500).json({ message: 'Server error during login as user' });
  }
});

/**
 * Update teacher bonus (Admin only)
 * PUT /api/users/:id/bonus
 */
router.put('/:id/bonus', [
  authenticateToken,
  requireAdmin,
  body('bonus').isNumeric().withMessage('Bonus must be a number'),
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const { id } = req.params;
    const { bonus } = req.body;
    
    const user = await User.findById(id);
    
    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }
    
    if (user.role !== 'teacher') {
      return res.status(400).json({
        message: 'User is not a teacher'
      });
    }
    
    // Update teacher's bonus
    if (!user.teacherInfo) {
      user.teacherInfo = {};
    }
    
    user.teacherInfo.bonus = parseFloat(bonus);
    
    // Recalculate monthly earnings
    user.teacherInfo.monthlyEarnings = 
      (user.teacherInfo.monthlyHours || 0) * (user.teacherInfo.monthlyRate || 0) + user.teacherInfo.bonus;
    
    await user.save();
    
    res.json({
      message: 'Teacher bonus updated successfully',
      user: await User.findById(id).select('-password')
    });
    
  } catch (error) {
    console.error('Update teacher bonus error:', error);
    res.status(500).json({
      message: 'Failed to update teacher bonus',
      error: error.message
    });
  }
});

/**
 * Get guardians with zero hours (for invoice generation)
 * GET /api/users/guardians/zero-hours
 */
router.get('/guardians/zero-hours', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const guardians = await User.findGuardiansWithZeroHours();
    
    res.json({
      guardians,
      count: guardians.length
    });
    
  } catch (error) {
    console.error('Get zero hours guardians error:', error);
    res.status(500).json({
      message: 'Failed to fetch guardians with zero hours',
      error: error.message
    });
  }
});

/**
 * Update user timezone
 * PUT /api/users/timezone
 */
router.put('/timezone', 
  authenticateToken,
  [
    body('timezone')
      .notEmpty()
      .withMessage('Timezone is required')
      .custom((value) => {
        if (!isValidTimezone(value)) {
          throw new Error('Invalid timezone');
        }
        return true;
      })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { timezone } = req.body;
      const userId = req.user.id;

      // Update user timezone
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { timezone },
        { new: true, runValidators: true }
      ).select('-password');

      if (!updatedUser) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.json({
        message: 'Timezone updated successfully',
        user: updatedUser,
        timezone
      });
    } catch (error) {
      console.error('Update timezone error:', error);
      res.status(500).json({
        message: 'Failed to update timezone',
        error: error.message
      });
    }
  }
);

/**
 * Get available timezones
 * GET /api/users/timezones
 */
router.get('/timezones', authenticateToken, async (req, res) => {
  try {
    const { getAvailableTimezones } = require('../utils/timezoneUtils');
    const timezones = getAvailableTimezones();
    
    res.json({
      timezones,
      defaultTimezone: DEFAULT_TIMEZONE
    });
  } catch (error) {
    console.error('Get timezones error:', error);
    res.status(500).json({
      message: 'Failed to fetch timezones',
      error: error.message
    });
  }
});

/**
 * Upload profile picture
 * POST /api/users/:id/profile-picture
 * multipart/form-data { file }
 */
router.post('/:id/profile-picture', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const userId = req.params.id;

    // Authorization: user can upload for themselves or admins
    if (req.user.id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const file = req.file;
    if (!file) return res.status(400).json({ message: 'No file uploaded' });

    console.log('File received:', { 
      originalname: file.originalname, 
      mimetype: file.mimetype, 
      size: file.size,
      buffer: !!file.buffer 
    });

    // Convert buffer to base64 data URI
    const mime = file.mimetype || 'image/jpeg';
    const dataUri = `data:${mime};base64,${file.buffer.toString('base64')}`;

    let profilePictureUrl = dataUri;
    let profilePicturePublicId = null;
    let profilePictureThumbnail = dataUri;
    let profilePictureThumbnailPublicId = null;

    // Try to upload to Cloudinary if configured
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      try {
        console.log('Attempting to upload to Cloudinary...');
        const { main, thumb } = await uploadImage(dataUri, { folder: `waraqa/profile_pictures/${userId}` });
        console.log('Cloudinary upload successful:', { main: main?.secure_url, thumb: thumb?.secure_url });
        
        profilePictureUrl = main.secure_url || main.url;
        profilePicturePublicId = main.public_id;
        profilePictureThumbnail = thumb.secure_url || thumb.url;
        profilePictureThumbnailPublicId = thumb.public_id;
      } catch (cloudinaryError) {
        console.warn('Cloudinary upload failed, falling back to base64 storage:', cloudinaryError.message);
        // Continue with base64 fallback
      }
    } else {
      console.log('Cloudinary not configured, using base64 storage');
    }

    // Update user with new picture URL and public ids
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // If existing pictures exist and we have public IDs, remove them (best-effort)
    if (user.profilePicturePublicId || user.profilePictureThumbnailPublicId) {
      try {
        const toDelete = [];
        if (user.profilePicturePublicId) toDelete.push(user.profilePicturePublicId);
        if (user.profilePictureThumbnailPublicId) toDelete.push(user.profilePictureThumbnailPublicId);
        if (toDelete.length) await deleteImage(toDelete);
      } catch (derr) {
        console.warn('Failed to delete old profile pictures', derr.message || derr);
      }
    }

    user.profilePicture = profilePictureUrl;
    user.profilePicturePublicId = profilePicturePublicId;
    user.profilePictureThumbnail = profilePictureThumbnail;
    user.profilePictureThumbnailPublicId = profilePictureThumbnailPublicId;
    await user.save();

    console.log('User updated with new profile picture');

    res.json({ message: 'Profile picture uploaded', user: await User.findById(userId).select('-password') });
  } catch (error) {
    console.error('Upload profile picture error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ message: 'Failed to upload profile picture', error: error.message, stack: error.stack });
  }
});

/**
 * Delete profile picture
 * DELETE /api/users/:id/profile-picture
 */
router.delete('/:id/profile-picture', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    if (req.user.id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const toDelete = [];
    if (user.profilePicturePublicId) toDelete.push(user.profilePicturePublicId);
    if (user.profilePictureThumbnailPublicId) toDelete.push(user.profilePictureThumbnailPublicId);
    if (toDelete.length) await deleteImage(toDelete);

    user.profilePicture = null;
    user.profilePicturePublicId = null;
    user.profilePictureThumbnail = null;
    user.profilePictureThumbnailPublicId = null;
    await user.save();

    res.json({ message: 'Profile picture removed', user: await User.findById(userId).select('-password') });
  } catch (error) {
    console.error('Delete profile picture error:', error);
    res.status(500).json({ message: 'Failed to delete profile picture', error: error.message });
  }
});

module.exports = router;
