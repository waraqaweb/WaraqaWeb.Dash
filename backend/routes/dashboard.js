/**
 * Dashboard Routes
 * 
 * Handles:
 * - Dashboard statistics
 * - Analytics data
 * - Summary information
 */

const express = require('express');
const User = require('../models/User');
const UserActivity = require('../models/UserActivity');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');
const Student = require('../models/Student');
const Vacation = require('../models/Vacation');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { decodeToken } = require('../utils/jwt');

const resolveQueryResult = async (queryLike, fallbackValue = []) => {
  try {
    if (!queryLike) return fallbackValue;
    if (typeof queryLike.exec === 'function') return await queryLike.exec();
    if (typeof queryLike.lean === 'function') return await queryLike.lean();
    if (typeof queryLike.then === 'function') return await queryLike;
    return queryLike;
  } catch (err) {
    console.warn('dashboard: resolveQueryResult failed', err && err.message);
    return fallbackValue;
  }
};

const normalize = (value = '') => String(value || '').trim().toLowerCase();
const normalizeDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

// Dedupe key that does NOT rely on email/phone (multiple students can share guardian contact info).
// Prefer a direct embedded<->standalone linkage when available.
const makeStudentKey = (student = {}) => {
  const guardianId = String(student.guardianId || student.guardian || '');
  if (!guardianId) return null;

  const source = String(student._source || '');
  const selfGuardian = Boolean(student.selfGuardian || student.studentInfo?.selfGuardian);

  const linkedStandaloneId =
    source === 'standalone'
      ? (student._id || student.id)
      : (student.standaloneStudentId || student.studentInfo?.standaloneStudentId);
  if (linkedStandaloneId) return `${guardianId}|standalone:${String(linkedStandaloneId)}`;

  if (selfGuardian) return `${guardianId}|selfGuardian`;

  const first = normalize(student.firstName || student.studentInfo?.firstName);
  const last = normalize(student.lastName || student.studentInfo?.lastName);
  const dob = normalizeDate(student.dateOfBirth || student.studentInfo?.dateOfBirth);
  if (dob && (first || last)) return `${guardianId}|name:${first || 'unknown'}|last:${last || 'unknown'}|dob:${dob}`;

  const idPart = student._id || student.id || student.studentId;
  if (idPart) return `${guardianId}|${source || 'unknown'}:${String(idPart)}`;

  return `${guardianId}|hash:${Buffer.from(JSON.stringify(student)).toString('base64').slice(0, 24)}`;
};

const dedupeStudents = (students = []) => {
  const byKey = new Map();
  const extras = [];
  (students || []).forEach((student) => {
    const key = makeStudentKey(student);
    if (!key) return;
    if (!byKey.has(key)) {
      byKey.set(key, student);
      return;
    }

    const existing = byKey.get(key);
    // Prefer standalone record when it's the same logical student.
    if (existing && existing._source === 'embedded' && student._source === 'standalone') {
      byKey.set(key, student);
      return;
    }

    const existingId = existing && (existing._id || existing.id || existing.studentId);
    const incomingId = student && (student._id || student.id || student.studentId);
    if (existingId && incomingId && String(existingId) !== String(incomingId)) {
      extras.push(student);
    }
  });
  return [...Array.from(byKey.values()), ...extras];
};

const router = express.Router();

/**
 * Get dashboard statistics
 * GET /api/dashboard/stats
 * - Authenticated users receive a role-specific payload
 */
router.get('/stats', authenticateToken, async (req, res) => {
  // small helper to avoid hanging on stubbed promises in test environment
  const runWithTimeout = async (p, ms = 400) => {
    try {
      if (!p || typeof p.then !== 'function') return p;
      return await Promise.race([
        p,
        new Promise((resolve) => setTimeout(() => resolve(null), ms))
      ]);
    } catch (e) {
      return null;
    }
  };
  try {
    // Record that this user accessed the dashboard today (idempotent - one record per user/day)
    try {
      const authHeader = req.headers["authorization"];
      const token = authHeader && authHeader.split(" ")[1];
      const decoded = token ? decodeToken(token) : null;
      const isImpersonatedSession = Boolean(decoded?.impersonatedBy || decoded?.isImpersonated);
      const isAdminSession = String(req.user?.role || decoded?.role || '').toLowerCase() === 'admin';
      const deviceId = req.headers['x-device-id'] || null;
      if (req.user && req.user._id && !isImpersonatedSession && !isAdminSession) {
        await UserActivity.recordVisit(req.user._id, {
          deviceId,
          auth: {
            isImpersonated: Boolean(decoded?.isImpersonated),
            impersonatedBy: decoded?.impersonatedBy || null,
            isAdmin: isAdminSession
          }
        });
      }
    } catch (e) {
      console.warn('Failed to record user dashboard visit', e && e.message);
    }
    const role = req.user?.role;
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Compute dashboard usage metrics (daily unique users, unique last 30 days, current active users)
    let dailyUniqueDashboardUsers = 0;
    let uniqueUsersLast30Days = 0;
    let currentActiveDashboardUsers = 0;
    try {
      // UTC midnight today
      const today = new Date();
      const utcMidnight = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      // Unique users by deviceId (fallback to user id). Exclude impersonated sessions.
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 29); // include today and 29 previous days = 30-day window
      const start30 = new Date(Date.UTC(thirtyDaysAgo.getUTCFullYear(), thirtyDaysAgo.getUTCMonth(), thirtyDaysAgo.getUTCDate()));

      const activityMatch = { date: { $gte: start30 } };
      const authMatch = {
        $and: [
          { $or: [ { 'auth.isImpersonated': { $ne: true } }, { 'auth.isImpersonated': { $exists: false } } ] },
          { $or: [ { 'auth.isAdmin': { $ne: true } }, { 'auth.isAdmin': { $exists: false } } ] }
        ]
      };

      const dailyAgg = await UserActivity.aggregate([
        { $match: { date: utcMidnight } },
        { $match: authMatch },
        { $group: { _id: { $ifNull: ['$deviceId', '$user'] } } },
        { $count: 'count' }
      ]);
      dailyUniqueDashboardUsers = dailyAgg?.[0]?.count || 0;

      const monthlyAgg = await UserActivity.aggregate([
        { $match: activityMatch },
        { $match: authMatch },
        { $group: { _id: { $ifNull: ['$deviceId', '$user'] } } },
        { $count: 'count' }
      ]);
      uniqueUsersLast30Days = monthlyAgg?.[0]?.count || 0;

      // Current active users tracked by socket connections map on io
      const io = req.app.get('io');
      if (io && io.connectedUsers && typeof io.connectedUsers.size === 'number') {
        currentActiveDashboardUsers = io.connectedUsers.size;
      }
    } catch (e) {
      console.warn('Failed to compute dashboard usage metrics', e && e.message);
    }

    // Admin overview (delegated to dashboardService)
    if (role === 'admin') {
      // Attempt to serve from cache (Redis or memory) first
      const cacheUtil = require('../utils/cache');
      const { recomputeDashboardStats, CACHE_KEY } = require('../jobs/recomputeDashboardStats');
      console.time('dashboard:admin');
    try {
      const cachedRaw = await cacheUtil.get(CACHE_KEY);
        if (cachedRaw) {
          let payload = cachedRaw;
          try { payload = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch (e) { /* noop */ }
          // If payload was very recently computed (e.g. within 10s), treat it as fresh so UI
          // doesn't show "Data from cache" immediately after a manual refresh.
          const computedAtRaw = payload?.timestamps?.computedAt;
          const computedAt = computedAtRaw ? new Date(computedAtRaw) : null;
          const isRecent = computedAt ? ((Date.now() - computedAt.getTime()) < 10000) : false;
          console.timeEnd('dashboard:admin');
          // Keep backward-compatible flat keys while returning the new nested shape
          const flatStats = Object.assign({}, payload.summary || {});
          // Map old flat keys into top-level for backward compatibility (preserve zeros)
          flatStats.topOwingGuardians = payload.summary.guardians?.topOwingGuardians ?? [];
          flatStats.guardiansLowHours = payload.summary.guardians?.guardiansLowHours ?? [];
          flatStats.classesWithoutReportsCount = payload.summary.classes?.classesWithoutReportsCount ?? 0;
          flatStats.pendingReschedulesCount = payload.summary.classes?.pendingReschedulesCount ?? 0;
          flatStats.teachersOnVacationCount = (payload.summary.teachers?.teachersOnVacationCount ?? (payload.summary.teachers?.teachersOnVacationList ?? []).length) ?? 0;
          flatStats.teachersOnVacationList = payload.summary.teachers?.teachersOnVacationList ?? [];
          flatStats.unpaidBalanceTotal = payload.summary.revenue?.unpaidBalanceTotal ?? 0;
          flatStats.pendingInvoicesCount = payload.summary.revenue?.pendingInvoicesCount ?? 0;
          flatStats.overdueInvoicesCount = payload.summary.revenue?.overdueInvoicesCount ?? 0;
          flatStats.ytdRevenue = payload.summary.revenue?.ytd ?? 0;
          flatStats.upcomingClasses = (payload.summary.classes?.scheduledNext7 ?? payload.summary.classes?.scheduledNext7Days) ?? 0;
          flatStats.upcomingClasses30 = payload.summary.classes?.upcomingNext30 ?? 0;
          flatStats.expectedClasses = payload.summary.classes?.expectedNext30 ?? 0;
          flatStats.totalTeachers = payload.summary.teachers?.totalTeachers ?? payload.summary.users?.totalTeachers ?? 0;
          flatStats.activeTeachersTotal = payload.summary.teachers?.activeTeachersTotal ?? payload.summary.users?.activeTeachersTotal ?? 0;
          flatStats.activeTeachersLast30 = payload.summary.teachers?.activeTeachersLast30 ?? 0;
          flatStats.activeTeachersPrev30 = payload.summary.teachers?.activeTeachersPrev30 ?? 0;
          flatStats.totalGuardians = payload.summary.guardians?.totalGuardians ?? payload.summary.users?.totalGuardians ?? 0;
          flatStats.activeGuardiansTotal = payload.summary.guardians?.activeGuardiansTotal ?? payload.summary.users?.activeGuardiansTotal ?? 0;
          flatStats.activeGuardiansLast30 = payload.summary.guardians?.activeGuardiansLast30 ?? 0;
          flatStats.activeGuardiansPrev30 = payload.summary.guardians?.activeGuardiansPrev30 ?? 0;
          flatStats.totalStudents = payload.summary.students?.totalStudents ?? payload.summary.users?.totalStudents ?? 0;
          flatStats.activeStudentsTotal = payload.summary.students?.activeStudentsTotal ?? payload.summary.users?.activeStudentsTotal ?? 0;
          flatStats.inactiveStudentsAfterActivity = payload.summary.students?.inactiveStudentsAfterActivity ?? [];
          flatStats.inactiveStudentsAfterActivityCount = payload.summary.students?.inactiveStudentsAfterActivityCount ?? 0;
          flatStats.newStudentsLast30Days = payload.summary.students?.newStudentsLast30Days ?? [];
          flatStats.newStudentsLast30DaysCount = payload.summary.students?.newStudentsLast30DaysCount ?? 0;
          // expose new hour-based and active-by-schedule metrics
          flatStats.scheduledHoursUntilMonthEnd = payload.summary.classes?.scheduledHoursUntilMonthEnd ?? payload.summary.classes?.scheduledHoursRemaining ?? 0;
          flatStats.completedHoursThisMonth = payload.summary.classes?.completedHoursThisMonth ?? payload.summary.classes?.completedHours ?? 0;
          flatStats.cancelledHoursThisMonth = payload.summary.classes?.cancelledHoursThisMonth ?? payload.summary.classes?.cancelledHours ?? 0;
          flatStats.activeUsersByScheduleCount = payload.summary.classes?.activeUsersByScheduleCount ?? payload.summary.classes?.activeUsersCount ?? 0;
          flatStats.nextAutoGeneration = payload.timestamps?.nextAutoGeneration ?? null;
          // expose timestamps at top-level
          flatStats.timestamps = payload.timestamps ?? {};
          // Attach usage metrics
          flatStats.dailyUniqueDashboardUsers = dailyUniqueDashboardUsers;
          flatStats.uniqueUsersLast30Days = uniqueUsersLast30Days;
          flatStats.currentActiveDashboardUsers = currentActiveDashboardUsers;
          // Attach active student vacations (computed live so it stays correct even when stats are cached)
          try {
            const now = new Date();
            const activeStudentVacations = await Vacation.find({
              role: 'student',
              approvalStatus: 'approved',
              status: { $in: ['approved', 'active'] },
              startDate: { $lte: now },
              $expr: { $gte: [ { $ifNull: ['$actualEndDate', '$endDate'] }, now ] }
            }).select('user userName guardianId startDate endDate actualEndDate').lean();

            flatStats.studentsOnVacationList = (activeStudentVacations || []).map(v => ({
              studentId: v.user,
              studentName: v.userName || 'Student',
              guardianId: v.guardianId || null,
              startDate: v.startDate,
              endDate: v.actualEndDate || v.endDate
            }));
            flatStats.studentsOnVacationCount = flatStats.studentsOnVacationList.length;
          } catch (e) {
            flatStats.studentsOnVacationList = [];
            flatStats.studentsOnVacationCount = 0;
          }

          return res.json({ success: true, role: 'admin', meta: { generatedAt: new Date() }, cached: !isRecent, stats: Object.assign({}, flatStats, { nested: payload }) });
        }

        // Cache miss -> in test environments call the service layer directly (faster,
        // avoids invoking the full recompute job which may run DB fallback queries).
        let payload = null;
  if (process.env.NODE_ENV === 'test' || typeof global.describe === 'function') {
          const dashboardService = require('../services/dashboardService');
          const [users, classes, revenue, teachers, guardians, growth, students] = await Promise.all([
            dashboardService.getUserStats(),
            dashboardService.getClassStats(),
            dashboardService.getInvoiceStats(),
            dashboardService.getTeacherStats(),
            dashboardService.getGuardianStats(),
            dashboardService.getGrowthStats(),
            dashboardService.getStudentStats()
          ]);
          payload = { summary: { users: users || {}, classes: classes || {}, revenue: revenue || {}, teachers: teachers || {}, guardians: guardians || {}, growth: growth || {}, students: students || {} }, timestamps: { computedAt: new Date(), expiresAt: new Date(Date.now() + 1000 * 60) } };
        } else {
          payload = await runWithTimeout(recomputeDashboardStats(), 5000);
          if (!payload) {
            console.timeEnd('dashboard:admin');
            return res.status(500).json({ success: false, message: 'Failed to recompute dashboard stats' });
          }
        }
  console.timeEnd('dashboard:admin');
  const flatStats = Object.assign({}, payload.summary || {});
  flatStats.topOwingGuardians = payload.summary.guardians?.topOwingGuardians ?? [];
  flatStats.guardiansLowHours = payload.summary.guardians?.guardiansLowHours ?? [];
  flatStats.classesWithoutReportsCount = payload.summary.classes?.classesWithoutReportsCount ?? 0;
  flatStats.pendingReschedulesCount = payload.summary.classes?.pendingReschedulesCount ?? 0;
  flatStats.teachersOnVacationCount = (payload.summary.teachers?.teachersOnVacationCount ?? (payload.summary.teachers?.teachersOnVacationList ?? []).length) ?? 0;
  flatStats.teachersOnVacationList = payload.summary.teachers?.teachersOnVacationList ?? [];
  flatStats.unpaidBalanceTotal = payload.summary.revenue?.unpaidBalanceTotal ?? 0;
  flatStats.pendingInvoicesCount = payload.summary.revenue?.pendingInvoicesCount ?? 0;
  flatStats.overdueInvoicesCount = payload.summary.revenue?.overdueInvoicesCount ?? 0;
  flatStats.ytdRevenue = payload.summary.revenue?.ytd ?? 0;
  flatStats.upcomingClasses = (payload.summary.classes?.scheduledNext7 ?? payload.summary.classes?.scheduledNext7Days) ?? 0;
  flatStats.upcomingClasses30 = payload.summary.classes?.upcomingNext30 ?? 0;
  flatStats.expectedClasses = payload.summary.classes?.expectedNext30 ?? 0;
  flatStats.totalTeachers = payload.summary.teachers?.totalTeachers ?? payload.summary.users?.totalTeachers ?? 0;
  flatStats.activeTeachersTotal = payload.summary.teachers?.activeTeachersTotal ?? payload.summary.users?.activeTeachersTotal ?? 0;
  flatStats.activeTeachersLast30 = payload.summary.teachers?.activeTeachersLast30 ?? 0;
  flatStats.activeTeachersPrev30 = payload.summary.teachers?.activeTeachersPrev30 ?? 0;
  flatStats.totalGuardians = payload.summary.guardians?.totalGuardians ?? payload.summary.users?.totalGuardians ?? 0;
  flatStats.activeGuardiansTotal = payload.summary.guardians?.activeGuardiansTotal ?? payload.summary.users?.activeGuardiansTotal ?? 0;
  flatStats.activeGuardiansLast30 = payload.summary.guardians?.activeGuardiansLast30 ?? 0;
  flatStats.activeGuardiansPrev30 = payload.summary.guardians?.activeGuardiansPrev30 ?? 0;
  flatStats.totalStudents = payload.summary.students?.totalStudents ?? payload.summary.users?.totalStudents ?? 0;
  flatStats.activeStudentsTotal = payload.summary.students?.activeStudentsTotal ?? payload.summary.users?.activeStudentsTotal ?? 0;
  flatStats.inactiveStudentsAfterActivity = payload.summary.students?.inactiveStudentsAfterActivity ?? [];
  flatStats.inactiveStudentsAfterActivityCount = payload.summary.students?.inactiveStudentsAfterActivityCount ?? 0;
  flatStats.newStudentsLast30Days = payload.summary.students?.newStudentsLast30Days ?? [];
  flatStats.newStudentsLast30DaysCount = payload.summary.students?.newStudentsLast30DaysCount ?? 0;
  // expose new hour-based and active-by-schedule metrics
  flatStats.scheduledHoursUntilMonthEnd = payload.summary.classes?.scheduledHoursUntilMonthEnd ?? payload.summary.classes?.scheduledHoursRemaining ?? 0;
  flatStats.completedHoursThisMonth = payload.summary.classes?.completedHoursThisMonth ?? payload.summary.classes?.completedHours ?? 0;
  flatStats.cancelledHoursThisMonth = payload.summary.classes?.cancelledHoursThisMonth ?? payload.summary.classes?.cancelledHours ?? 0;
  flatStats.activeUsersByScheduleCount = payload.summary.classes?.activeUsersByScheduleCount ?? payload.summary.classes?.activeUsersCount ?? 0;
  flatStats.nextAutoGeneration = payload.timestamps?.nextAutoGeneration ?? null;
  flatStats.timestamps = payload.timestamps ?? {};
  // Attach usage metrics
  flatStats.dailyUniqueDashboardUsers = dailyUniqueDashboardUsers;
  flatStats.uniqueUsersLast30Days = uniqueUsersLast30Days;
  flatStats.currentActiveDashboardUsers = currentActiveDashboardUsers;
  // Attach active student vacations (computed live)
  try {
    const now = new Date();
    const activeStudentVacations = await Vacation.find({
      role: 'student',
      approvalStatus: 'approved',
      status: { $in: ['approved', 'active'] },
      startDate: { $lte: now },
      $expr: { $gte: [ { $ifNull: ['$actualEndDate', '$endDate'] }, now ] }
    }).select('user userName guardianId startDate endDate actualEndDate').lean();

    flatStats.studentsOnVacationList = (activeStudentVacations || []).map(v => ({
      studentId: v.user,
      studentName: v.userName || 'Student',
      guardianId: v.guardianId || null,
      startDate: v.startDate,
      endDate: v.actualEndDate || v.endDate
    }));
    flatStats.studentsOnVacationCount = flatStats.studentsOnVacationList.length;
  } catch (e) {
    flatStats.studentsOnVacationList = [];
    flatStats.studentsOnVacationCount = 0;
  }

  return res.json({ success: true, role: 'admin', meta: { generatedAt: new Date() }, cached: false, stats: Object.assign({}, flatStats, { nested: payload }) });
      } catch (err) {
        console.timeEnd('dashboard:admin');
        console.error('dashboard: admin error', err && err.message);
        return res.status(500).json({ success: false, message: 'Failed to build admin dashboard stats', error: err && err.message });
      }
    }

    // Teacher view
    if (role === 'teacher') {
      const teacherId = req.user._id;
      // Active student vacations for this teacher's students (last 90 days)
      let studentsOnVacationList = [];
      try {
        const now = new Date();
        const activeWindow = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const studentAgg = await Class.aggregate([
          { $match: { teacher: teacherId, scheduledDate: { $gte: activeWindow } } },
          { $group: { _id: '$student.studentId', studentName: { $first: '$student.studentName' } } },
          { $limit: 500 }
        ]).exec();
        const studentIds = (studentAgg || []).map(r => r?._id).filter(Boolean);
        if (studentIds.length) {
          const activeVac = await Vacation.find({
            role: 'student',
            user: { $in: studentIds },
            approvalStatus: 'approved',
            status: { $in: ['approved', 'active'] },
            startDate: { $lte: now },
            $expr: { $gte: [ { $ifNull: ['$actualEndDate', '$endDate'] }, now ] }
          }).select('user userName startDate endDate actualEndDate').lean();
          const nameById = new Map((studentAgg || []).map(r => [String(r._id), r.studentName]));
          studentsOnVacationList = (activeVac || []).map(v => ({
            studentId: v.user,
            studentName: v.userName || nameById.get(String(v.user)) || 'Student',
            startDate: v.startDate,
            endDate: v.actualEndDate || v.endDate
          }));
        }
      } catch (e) {
        studentsOnVacationList = [];
      }

      // Hours & classes completed this month
      const monthStart = new Date(currentYear, currentMonth - 1, 1);
      const monthEnd = new Date(currentYear, currentMonth, 1);

      // Aggregate all classes for general stats (classes/cancellations, etc.)
      const teacherAggAll = await Class.aggregate([
        { $match: { teacher: teacherId, scheduledDate: { $gte: monthStart, $lt: monthEnd } } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalMinutes: { $sum: '$duration' }
          }
        }
      ]);

      const statusMapAll = {};
      teacherAggAll.forEach((r) => { statusMapAll[r._id] = r; });

      // Aggregate UNBILLED, countable teacher hours for the month.
      // This keeps the dashboard "hours" counter aligned with teacher invoicing.
      const teacherAggUnbilled = await Class.aggregate([
        {
          $match: {
            teacher: teacherId,
            scheduledDate: { $gte: monthStart, $lt: monthEnd },
            deleted: { $ne: true },
            billedInTeacherInvoiceId: null,
            status: { $in: ['attended', 'missed_by_student', 'absent', 'completed'] }
          }
        },
        {
          $group: {
            _id: '$status',
            totalMinutes: { $sum: '$duration' }
          }
        }
      ]);

      const statusMapUnbilled = {};
      teacherAggUnbilled.forEach((r) => { statusMapUnbilled[r._id] = r; });

      const hoursThisMonth = (
        (statusMapUnbilled.attended?.totalMinutes || 0) +
        (statusMapUnbilled.missed_by_student?.totalMinutes || 0) +
        (statusMapUnbilled.absent?.totalMinutes || 0) +
        (statusMapUnbilled.completed?.totalMinutes || 0)
      ) / 60;

      const classesCompletedThisMonth = (statusMapAll.attended?.count || 0) + (statusMapAll.completed?.count || 0);
      const cancellationsThisMonth = (statusMapAll.cancelled_by_teacher?.count || 0) + (statusMapAll.cancelled?.count || 0);

      // Distinct students with classes this month
      const studentsWithClasses = await Class.aggregate([
        { $match: { teacher: teacherId, scheduledDate: { $gte: monthStart, $lt: monthEnd } } },
        { $group: { _id: '$student.studentId' } },
        { $count: 'count' }
      ]);
      const studentsWithClassesThisMonth = studentsWithClasses[0]?.count || 0;

      // Next scheduled class
      const nextClass = await Class.findOne({ teacher: teacherId, scheduledDate: { $gte: new Date() }, status: { $in: ['scheduled', 'in_progress'] } })
        .populate('student.guardianId', 'firstName lastName')
        .lean();

      // If the next class exists but the teacher has not submitted its classReport,
      // attach the most recent previous class (for the same teacher+student pair)
      // that DOES have a submitted classReport. This helps the frontend show the
      // last known lessonTopic, teacherNotes and Quran-related fields.
      if (nextClass) {
        try {
          const prev = await Class.findOne({
            teacher: teacherId,
            'student.studentId': nextClass.student?.studentId,
            'classReport.submittedAt': { $exists: true, $ne: null },
            'classReport.attendance': 'attended',
            scheduledDate: { $lt: nextClass.scheduledDate || new Date() }
          })
            .sort({ scheduledDate: -1 })
            .select('scheduledDate classReport._id classReport.teacherNotes classReport.lessonTopic classReport.recitedQuran classReport.quranRecitation classReport.surah classReport.verseEnd classReport.classScore classReport.submittedAt')
            .lean();

          if (prev && prev.classReport) {
            nextClass.previousReport = {
              _id: prev._id,
              scheduledDate: prev.scheduledDate,
              teacherNotes: prev.classReport.teacherNotes || null,
              lessonTopic: prev.classReport.lessonTopic || null,
              recitedQuran: prev.classReport.recitedQuran || prev.classReport.quranRecitation || null,
              surah: prev.classReport.surah || null,
              verseEnd: prev.classReport.verseEnd || null,
              classScore: prev.classReport.classScore ?? null,
              submittedAt: prev.classReport.submittedAt || null
            };
          }
        } catch (e) {
          // Non-fatal: don't block dashboard if lookup fails
          console.warn('dashboard: previousReport lookup failed', e && e.message);
        }
      }

      // Pending reports: past classes (in last 7 days) without submitted classReport.submittedAt
      const pastWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const handledAttendances = ['attended', 'missed_by_student', 'cancelled_by_teacher', 'no_show_both'];
      const handledStatuses = [
        'completed',
        'attended',
        'missed_by_student',
        'cancelled_by_teacher',
        'cancelled_by_guardian',
        'cancelled_by_admin',
        'no_show_both',
        'cancelled'
      ];

      // Select past classes in the recent window that have no submitted report
      // and whose attendance wasn't recorded as attended/missed/cancelled.
      // NOTE: use $and to avoid accidental key overwrites (duplicate $or keys).
      const pendingReports = await Class.find({
        teacher: teacherId,
        scheduledDate: { $lt: new Date(), $gte: pastWindow },
        $and: [
          {
            $or: [
              { 'classReport.submittedAt': { $exists: false } },
              { 'classReport.submittedAt': null }
            ]
          },
          {
            $or: [
              { 'classReport.attendance': { $exists: false } },
              { 'classReport.attendance': { $nin: handledAttendances } }
            ]
          },
          {
            // Also exclude classes where attendance was recorded via the top-level
            // attendance object or where status already indicates handled.
            $nor: [
              { status: { $in: handledStatuses } },
              { 'attendance.markedAt': { $exists: true } },
              { 'attendance.teacherPresent': true },
              { 'attendance.studentPresent': true }
            ]
          }
        ]
      })
        .limit(20)
        .populate('student.guardianId', 'firstName lastName')
        .lean();

      // Older overdue reports: classes older than the pastWindow with no submitted report
      // Only include older classes if they are still within the teacher submission
      // allowance window (teacherDeadline in the future) or an admin extension
      // was granted and hasn't expired.
      const now = new Date();
      // Older classes: include only those without submitted report and where
      // attendance does not indicate the class was handled (attended/missed/cancelled).
      const overdueReports = await Class.find({
        teacher: teacherId,
        scheduledDate: { $lt: pastWindow },
        $and: [
          {
            $or: [
              { 'classReport.submittedAt': { $exists: false } },
              { 'classReport.submittedAt': null }
            ]
          },
          {
            $or: [
              { 'reportSubmission.teacherDeadline': { $gte: now } },
              { 'reportSubmission.adminExtension.granted': true, 'reportSubmission.adminExtension.expiresAt': { $gte: now } }
            ]
          },
          {
            $or: [
              { 'classReport.attendance': { $exists: false } },
              { 'classReport.attendance': { $nin: handledAttendances } }
            ]
          },
          {
            $nor: [
              { status: { $in: handledStatuses } },
              { 'attendance.markedAt': { $exists: true } },
              { 'attendance.teacherPresent': true },
              { 'attendance.studentPresent': true }
            ]
          }
        ]
      })
        .sort({ scheduledDate: -1 })
        .limit(20)
        .populate('student.guardianId', 'firstName lastName')
        .lean();

      const pendingReportsCount = pendingReports.length;
      const overdueReportsCount = overdueReports.length;

      // Server-side dedupe: ensure we return a single entry per teacher+student+scheduledDate
      const dedupeByKey = (arr) => {
        const map = new Map();
        for (const it of (arr || [])) {
          try {
            const when = it.scheduledDate ? new Date(it.scheduledDate) : null;
            const key = `${it.teacher?.toString() || ''}::${it.student?.studentId?.toString() || it.student?.studentId || ''}::${when ? when.toISOString() : it._id}`;
            const existing = map.get(key);
            if (!existing) {
              map.set(key, it);
              continue;
            }
            // Prefer entries that are not marked as overdue and that have an open teacherDeadline
            const existingScore = (existing._isOverdue ? 0 : 1) + (existing.reportSubmission?.teacherDeadline && new Date(existing.reportSubmission.teacherDeadline) >= new Date() ? 1 : 0);
            const newScore = (it._isOverdue ? 0 : 1) + (it.reportSubmission?.teacherDeadline && new Date(it.reportSubmission.teacherDeadline) >= new Date() ? 1 : 0);
            if (newScore > existingScore) map.set(key, it);
          } catch (e) {
            // fallback: keep first
            continue;
          }
        }
        return Array.from(map.values());
      };

      const pendingReportsDedupe = dedupeByKey(pendingReports);
      const overdueReportsDedupe = dedupeByKey(overdueReports);

      // Optional debug output when requested via query param
      if (req.query && req.query.debug === '1') {
        console.log('dashboard: pendingReports (raw):', pendingReports.map(c => ({ id: c._id, scheduledDate: c.scheduledDate, status: c.status, classReport: { submittedAt: c.classReport?.submittedAt, attendance: c.classReport?.attendance }, attendance: c.attendance, reportSubmission: c.reportSubmission })));
        console.log('dashboard: pendingReports (deduped):', pendingReportsDedupe.map(c => ({ id: c._id, scheduledDate: c.scheduledDate, status: c.status })));
        console.log('dashboard: overdueReports (raw):', overdueReports.map(c => ({ id: c._id, scheduledDate: c.scheduledDate, status: c.status, classReport: { submittedAt: c.classReport?.submittedAt, attendance: c.classReport?.attendance }, attendance: c.attendance, reportSubmission: c.reportSubmission })));
        console.log('dashboard: overdueReports (deduped):', overdueReportsDedupe.map(c => ({ id: c._id, scheduledDate: c.scheduledDate, status: c.status })));
      }

      // Pending first-class reminders: students who have exactly one class recorded (ever)
      // and that class has no submitted report yet. Limit to 20.
      const pendingFirstAgg = await Class.aggregate([
        { $match: { teacher: teacherId } },
        { $group: { _id: '$student.studentId', count: { $sum: 1 }, classIds: { $push: '$_id' } } },
        { $match: { count: 1 } },
        { $unwind: '$classIds' },
        {
          $lookup: {
            from: 'classes',
            localField: 'classIds',
            foreignField: '_id',
            as: 'classDoc'
          }
        },
        { $unwind: '$classDoc' },
        { $replaceRoot: { newRoot: '$classDoc' } },
        // Ensure the single-class candidate has no submitted report and no recorded attendance
        // of attended/missed/cancelled so it truly needs a report.
        { $match: { 
            $or: [ { 'classReport.submittedAt': { $exists: false } }, { 'classReport.submittedAt': null } ],
            $or: [
              { 'classReport.attendance': { $exists: false } },
              { 'classReport.attendance': { $nin: ['attended', 'missed_by_student', 'cancelled_by_teacher', 'cancelled'] } }
            ],
            $nor: [
              { status: { $in: ['attended', 'missed_by_student', 'cancelled_by_teacher', 'cancelled'] } },
              { 'attendance.markedAt': { $exists: true } },
              { 'attendance.teacherPresent': true },
              { 'attendance.studentPresent': true }
            ]
         } },
        { $sort: { scheduledDate: -1 } },
        { $limit: 20 }
      ]).exec();

      const pendingFirstClassStudents = pendingFirstAgg || [];

      // Active student count (distinct students taught in last 90 days)
      const activeWindow = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const activeStudentsAgg = await Class.aggregate([
        { $match: { teacher: teacherId, scheduledDate: { $gte: activeWindow } } },
        { $group: { _id: '$student.studentId' } },
        { $count: 'count' }
      ]);
      const activeStudentCount = activeStudentsAgg[0]?.count || 0;

      // Monthly earnings (sum of teacher_payment invoices for this teacher and billingPeriod.month/year)
      const teacherInvoices = await Invoice.aggregate([
        { $match: { teacher: teacherId, type: 'teacher_payment', 'billingPeriod.year': currentYear, 'billingPeriod.month': currentMonth, status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]);
      const monthlyEarnings = teacherInvoices[0]?.total || 0;

      return res.json({
        success: true,
        role: 'teacher',
        stats: {
          hoursThisMonth: Number(hoursThisMonth.toFixed(2)),
          classesCompletedThisMonth,
          cancellationsThisMonth,
          studentsWithClassesThisMonth,
          nextClass,
          studentsOnVacationCount: studentsOnVacationList.length,
          studentsOnVacationList,
          pendingReportsCount,
          pendingReports,
          overdueReportsCount,
          overdueReports,
          pendingFirstClassStudents,
          activeStudentCount,
          monthlyEarnings
        }
      });
    }
      

    // Guardian view
    if (role === 'guardian') {
      const guardianId = req.user._id;
      console.log('dashboard: guardian branch start for', guardianId);

      // Support both real mongoose Query objects and test stubs that return promises/arrays
      let upcomingClasses = [];
      try {
        const q = Class.find({ 'student.guardianId': guardianId, scheduledDate: { $gte: new Date() }, status: { $in: ['scheduled', 'in_progress'] } });
        if (q && typeof q.then === 'function' && !q.limit) {
          // stubbed to return a promise/array
          upcomingClasses = await q;
        } else if (q && typeof q.limit === 'function') {
          upcomingClasses = await q.limit(10).populate('teacher', 'firstName lastName').lean();
        } else {
          upcomingClasses = await q;
        }
      } catch (err) {
        // fallback: attempt a simple find
        try {
          upcomingClasses = await Class.find({ 'student.guardianId': guardianId, scheduledDate: { $gte: new Date() }, status: { $in: ['scheduled', 'in_progress'] } });
        } catch (e) {
          upcomingClasses = [];
        }
      }

  console.log('dashboard: guardian upcomingClasses length', Array.isArray(upcomingClasses) ? upcomingClasses.length : upcomingClasses);

      let upcomingClassesCount = 0;
      try {
        upcomingClassesCount = await Class.countDocuments({ 'student.guardianId': guardianId, scheduledDate: { $gte: new Date() }, status: { $in: ['scheduled', 'in_progress'] } });
      } catch (e) {
        upcomingClassesCount = Array.isArray(upcomingClasses) ? upcomingClasses.length : 0;
      }

      // Compute the guardian's children (students) list.
      // IMPORTANT:
      // - Do not derive this solely from classes (a guardian can have multiple students even if only one has classes yet).
      // - Merge embedded (User.guardianInfo.students) + standalone (Student collection) + a small legacy class-derived list.
      let myChildren = [];
      try {
        const guardianUser = await User.findById(guardianId).select('guardianInfo').lean();
        const embedded = Array.isArray(guardianUser?.guardianInfo?.students) ? guardianUser.guardianInfo.students : [];
        const embeddedChildren = embedded.map((s) => {
          const studentName = (`${s.firstName || ''} ${s.lastName || ''}`).replace(/\s+/g, ' ').trim();
          return {
            _id: s._id,
            guardianId,
            firstName: s.firstName,
            lastName: s.lastName,
            dateOfBirth: s.dateOfBirth || s.studentInfo?.dateOfBirth,
            selfGuardian: Boolean(s.selfGuardian || s.studentInfo?.selfGuardian),
            standaloneStudentId: s.standaloneStudentId || s.studentInfo?.standaloneStudentId,
            studentName: studentName || 'Student',
            _source: 'embedded'
          };
        });

        let standaloneChildren = [];
        try {
          const studentsFromCollection = await Student.find({ guardian: guardianId, isActive: { $ne: false } })
            .select('firstName lastName fullName dateOfBirth selfGuardian')
            .limit(200)
            .lean();
          standaloneChildren = (studentsFromCollection || []).map((student) => {
            const studentName = (student.fullName || `${student.firstName || ''} ${student.lastName || ''}`).replace(/\s+/g, ' ').trim();
            return {
              _id: student._id,
              guardianId,
              firstName: student.firstName,
              lastName: student.lastName,
              dateOfBirth: student.dateOfBirth,
              selfGuardian: Boolean(student.selfGuardian),
              studentName: studentName || 'Student',
              _source: 'standalone'
            };
          });
        } catch (fallbackErr) {
          console.warn('dashboard: myChildren fetch via Student collection failed', fallbackErr && fallbackErr.message);
        }

        let legacyClassChildren = [];
        try {
          // Include cases where the guardian is the student themselves (self-enrolled):
          // either student.guardianId === guardianId OR student.studentId === guardianId.
          const childrenAgg = await Class.aggregate([
            { $match: { $or: [{ 'student.guardianId': guardianId }, { 'student.studentId': guardianId }] } },
            { $group: { _id: '$student.studentId', studentName: { $first: '$student.studentName' } } },
            { $limit: 200 }
          ]).exec();
          legacyClassChildren = Array.isArray(childrenAgg)
            ? childrenAgg.map((c) => ({
              _id: c._id,
              guardianId,
              studentName: c.studentName || 'Student',
              _source: 'classAgg'
            }))
            : [];
        } catch (e) {
          console.warn('dashboard: myChildren legacy class aggregation failed', e && e.message);
          legacyClassChildren = [];
        }

        myChildren = dedupeStudents([...embeddedChildren, ...standaloneChildren, ...legacyClassChildren]).map((s) => ({
          _id: s._id,
          studentName: s.studentName || 'Student',
          selfGuardian: Boolean(s.selfGuardian)
        }));
      } catch (e) {
        console.warn('dashboard: myChildren computation failed', e && e.message);
        myChildren = [];
      }

      // Active student vacations for this guardian's children
      let studentsOnVacationList = [];
      try {
        const now = new Date();
        const childIds = (myChildren || []).map(c => c?._id).filter(Boolean);
        if (childIds.length) {
          const activeVac = await Vacation.find({
            role: 'student',
            user: { $in: childIds },
            approvalStatus: 'approved',
            status: { $in: ['approved', 'active'] },
            startDate: { $lte: now },
            $expr: { $gte: [ { $ifNull: ['$actualEndDate', '$endDate'] }, now ] }
          }).select('user userName startDate endDate actualEndDate').lean();
          const nameById = new Map((myChildren || []).map(c => [String(c._id), c.studentName]));
          studentsOnVacationList = (activeVac || []).map(v => ({
            studentId: v.user,
            studentName: v.userName || nameById.get(String(v.user)) || 'Student',
            startDate: v.startDate,
            endDate: v.actualEndDate || v.endDate
          }));
        }
      } catch (e) {
        studentsOnVacationList = [];
      }
      // Fetch guardian record to read guardianInfo.totalHours (remaining hours)
      let guardianHours = null;
      try {
        const UsersModel = require('../models/User');
        const result = UsersModel && typeof UsersModel.findById === 'function'
          ? UsersModel.findById(guardianId)
          : null;

        let guardianUser = null;
        if (result && typeof result.select === 'function') {
          const selected = result.select('guardianInfo');
          guardianUser = typeof selected.lean === 'function' ? await selected.lean() : await selected;
        } else if (result && typeof result.then === 'function') {
          guardianUser = await result;
        } else if (result) {
          guardianUser = result;
        }

        guardianHours = guardianUser?.guardianInfo?.totalHours ?? guardianUser?.guardianInfo?.hoursRemaining ?? null;
      } catch (e) {
        console.warn('dashboard: failed to fetch guardian hours', e && e.message);
        guardianHours = null;
      }

      // Compute pending invoices via aggregate (safer in test environments where .find may not be stubbed)
      let pendingInvoices = [];
      let pendingPaymentsCount = 0;
      console.log('dashboard: before pending invoices fetch');
      try {
        if (typeof Invoice.aggregate === 'function') {
          const invAgg = await runWithTimeout(Invoice.aggregate([
            { $match: { guardian: guardianId, status: { $in: ['draft','sent','overdue','partially_paid'] } } },
            { $limit: 10 }
          ]), 400);
          pendingInvoices = Array.isArray(invAgg) ? invAgg : [];
          pendingPaymentsCount = pendingInvoices.length;
        } else {
          pendingInvoices = [];
          pendingPaymentsCount = 0;
        }
      } catch (e) {
        pendingInvoices = [];
        pendingPaymentsCount = 0;
      }

      const monthlyInvoicesAgg = await runWithTimeout(Invoice.aggregate([
        { $match: { guardian: guardianId, 'billingPeriod.year': currentYear, 'billingPeriod.month': currentMonth } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]), 400);
  const monthlyBill = Array.isArray(monthlyInvoicesAgg) && monthlyInvoicesAgg[0] ? monthlyInvoicesAgg[0].total : 0;
  console.log('dashboard: monthlyBill', monthlyBill);

  const nextClass = upcomingClasses.length ? upcomingClasses[0] : null;
  console.log('dashboard: about to return guardian stats');

      // Find the most recent paid invoice for this guardian to show last paid hours
      let lastPaidInfo = null;
      try {
        const lastPaidInv = await Invoice.findOne({ guardian: guardianId, status: 'paid' })
          .sort({ paidDate: -1, createdAt: -1 })
          .select('hoursCovered billingPeriod.firstLessonDate billingPeriod.startDate firstLessonDate paidDate paymentLogs paidAmount items.duration items.quantityHours teacherPayment.totalHours')
          .lean();
        if (lastPaidInv) {
          // Prefer hoursCovered, then paymentLogs.paidHours, else null
          let hours = null;
          if (typeof lastPaidInv.hoursCovered === 'number') hours = lastPaidInv.hoursCovered;
          else if (Array.isArray(lastPaidInv.paymentLogs) && lastPaidInv.paymentLogs.length) {
            const pl = lastPaidInv.paymentLogs.find(p => p && typeof p.paidHours === 'number');
            if (pl) hours = pl.paidHours;
          }
          // Fallback: compute from invoice items durations or quantityHours
          if (hours == null && Array.isArray(lastPaidInv.items) && lastPaidInv.items.length) {
            try {
              const totalMinutes = lastPaidInv.items.reduce((s, it) => {
                if (!it) return s;
                if (typeof it.quantityHours === 'number') return s + (it.quantityHours * 60);
                if (typeof it.duration === 'number') return s + it.duration;
                return s;
              }, 0);
              if (totalMinutes > 0) hours = totalMinutes / 60;
            } catch (e) {
              // ignore
            }
          }
          // Fallback: teacherPayment.totalHours (for teacher invoices) - not typical for guardian but safe
          if (hours == null && lastPaidInv.teacherPayment && typeof lastPaidInv.teacherPayment.totalHours === 'number') {
            hours = lastPaidInv.teacherPayment.totalHours;
          }
          const fromDate = lastPaidInv.billingPeriod?.startDate || lastPaidInv.firstLessonDate || lastPaidInv.paidDate || null;
          lastPaidInfo = { hours: hours != null ? hours : null, fromDate: fromDate || null, paidAmount: lastPaidInv.paidAmount ?? null };
        }
      } catch (e) {
        console.warn('dashboard: failed to fetch last paid invoice', e && e.message);
        lastPaidInfo = null;
      }

      // Compute per-student hours (attended or missed) in the last 30 days for this guardian
      let recentStudentHours = [];
      let totalHoursLast30 = 0;
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const hrsAgg = await Class.aggregate([
          { $match: { 'student.guardianId': guardianId, scheduledDate: { $gte: thirtyDaysAgo, $lt: new Date() }, status: { $in: ['attended','missed_by_student','completed','absent'] } } },
          { $group: { _id: '$student.studentId', studentName: { $first: '$student.studentName' }, totalMinutes: { $sum: '$duration' } } },
          { $project: { _id: 1, studentName: 1, totalHours: { $divide: ['$totalMinutes', 60] } } },
          { $sort: { studentName: 1 } }
        ]).exec();
        recentStudentHours = Array.isArray(hrsAgg) ? hrsAgg.map(r => ({ _id: r._id, studentName: r.studentName, totalHours: Number((r.totalHours || 0).toFixed(2)) })) : [];
        totalHoursLast30 = recentStudentHours.reduce((s, r) => s + (Number(r.totalHours) || 0), 0);
        totalHoursLast30 = Number(totalHoursLast30.toFixed(2));
      } catch (e) {
        console.warn('dashboard: failed to compute recentStudentHours', e && e.message);
        recentStudentHours = [];
        totalHoursLast30 = 0;
      }

      // Recent last class per student (last 7 days)
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recentLastClassesAgg = await Class.aggregate([
          { $match: { 'student.guardianId': guardianId, scheduledDate: { $gte: sevenDaysAgo, $lte: new Date() } } },
          { $sort: { scheduledDate: -1 } },
          { $group: { _id: '$student.studentId', doc: { $first: '$$ROOT' } } },
          { $replaceRoot: { newRoot: '$doc' } },
          {
            $lookup: {
              from: 'users',
              localField: 'teacher',
              foreignField: '_id',
              as: 'teacher'
            }
          },
          { $unwind: { path: '$teacher', preserveNullAndEmptyArrays: true } },
      { $project: {
        _id: 1,
        scheduledDate: 1,
        duration: 1,
        subject: 1,
        'student.studentName': 1,
        'classReport.lessonTopic': 1,
        'classReport.classScore': 1,
        'classReport.submittedAt': 1,
        'classReport.teacherNotes': 1,
        'classReport.recitedQuran': 1,
        'classReport.quranRecitation': 1,
        'classReport.surah': 1,
        'classReport.verseEnd': 1,
        'teacher._id': 1,
        'teacher.firstName': 1,
        'teacher.lastName': 1
      } },
          { $sort: { scheduledDate: -1 } },
          { $limit: 20 }
        ]).exec();

        // Normalize into a simple array
        const recentLastClasses = (recentLastClassesAgg || []).map(c => ({
          _id: c._id,
          scheduledDate: c.scheduledDate,
          duration: c.duration,
          subject: c.subject,
          studentName: c.student?.studentName || null,
          lessonTopic: c.classReport?.lessonTopic || null,
          classScore: c.classReport?.classScore ?? null,
          submittedAt: c.classReport?.submittedAt || null,
          teacherNotes: c.classReport?.teacherNotes || null,
          recitedQuran: c.classReport?.recitedQuran || c.classReport?.quranRecitation || null,
          surah: c.classReport?.surah || null,
          verseEnd: c.classReport?.verseEnd || null,
          teacher: c.teacher ? { _id: c.teacher._id, firstName: c.teacher.firstName, lastName: c.teacher.lastName } : null
        }));

        // attach to data for guardian view
        return res.json({ success: true, role: 'guardian', stats: { upcomingClassesCount, upcomingClasses, pendingPaymentsCount, pendingInvoices, monthlyBill, nextClass, recentLastClasses, myChildren, guardianHours, lastPaidInfo, recentStudentHours, totalHoursLast30, studentsOnVacationCount: studentsOnVacationList.length, studentsOnVacationList } });
      } catch (e) {
        console.warn('dashboard: failed to build recentLastClasses', e && e.message);
        return res.json({ success: true, role: 'guardian', stats: { upcomingClassesCount, upcomingClasses, pendingPaymentsCount, pendingInvoices, monthlyBill, nextClass, myChildren, guardianHours, lastPaidInfo, recentStudentHours, totalHoursLast30, studentsOnVacationCount: studentsOnVacationList.length, studentsOnVacationList } });
      }

      return res.json({ success: true, role: 'guardian', stats: { upcomingClassesCount, upcomingClasses, pendingPaymentsCount, pendingInvoices, monthlyBill, nextClass, myChildren, guardianHours, lastPaidInfo, recentStudentHours, totalHoursLast30, studentsOnVacationCount: studentsOnVacationList.length, studentsOnVacationList } });
    }

    // Student (embedded under guardian) or other roles: provide lightweight view
    if (req.user.role === 'student' || !role) {
      // If student (not directly modeled as top-level user role inside this app), attempt to supply a compact view.
      // Fallback to safe empty stats
      return res.json({ success: true, role: 'student', stats: { message: 'Student dashboard not yet detailed on server.' } });
    }

    // Default fallback
    res.json({ success: true, role: role || 'unknown', stats: {} });

  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard statistics', error: error.message });
  }
});

// Admin-triggered manual refresh endpoint
router.post('/refresh', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { recomputeDashboardStats } = require('../jobs/recomputeDashboardStats');
    // Invalidate cache before recompute to ensure we force use of live DB data
    const cacheUtil = require('../utils/cache');
    const CACHE_KEY = require('../jobs/recomputeDashboardStats').CACHE_KEY;
    try { await cacheUtil.del(CACHE_KEY); } catch (e) { /* ignore */ }
    // Run recompute and return the fresh timestamps
    const payload = await recomputeDashboardStats();
    return res.status(202).json({ refreshed: true, cached: false, timestamps: payload.timestamps, stats: payload.summary });
  } catch (err) {
    console.error('dashboard: refresh error', err && err.message);
    return res.status(500).json({ refreshed: false, error: err && err.message });
  }
});

module.exports = router;


