/**
 * Dashboard Service
 * Implements server-side aggregations used by the admin dashboard.
 * Exports functions used by routes to fetch structured metric objects.
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');
const Student = require('../models/Student');

// safeRun will execute an async function (fn) and if it returns a promise
// we'll bound it with a timeout so tests that stub mongoose methods won't hang.
const parsedTimeout = Number.parseInt(process.env.DASHBOARD_QUERY_TIMEOUT_MS || '4000', 10);
const DEFAULT_TIMEOUT_MS = Number.isFinite(parsedTimeout) ? parsedTimeout : 4000;
const safeRun = async (fn, fallback = null, ms = DEFAULT_TIMEOUT_MS) => {
  try {
    const resultOrPromise = (typeof fn === 'function') ? fn() : fn;
    if (!resultOrPromise || typeof resultOrPromise.then !== 'function') return resultOrPromise;
    return await Promise.race([
      resultOrPromise,
      new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
    ]);
  } catch (err) {
    console.warn('[dashboardService] aggregation failed', err && err.message);
    return fallback;
  }
};

const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth() + 1, 1);

async function getUserStats() {
  return safeRun(async () => {
    const totalAgg = await User.aggregate([{ $count: 'total' }]);
    const byRoleAgg = await User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]);
    const activeByRoleAgg = await User.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);
    const newUsersAgg = await User.aggregate([
      { $match: { createdAt: { $gte: monthStart, $lt: monthEnd } } },
      { $count: 'count' }
    ]);
    const activeAgg = await User.aggregate([{ $match: { isActive: true } }, { $count: 'count' }]);

    const byRole = (Array.isArray(byRoleAgg) ? byRoleAgg : []).reduce((acc, r) => {
      acc[r._id] = r.count || 0; return acc;
    }, {});

    const activeByRole = (Array.isArray(activeByRoleAgg) ? activeByRoleAgg : []).reduce((acc, r) => {
      acc[r._id] = r.count || 0; return acc;
    }, {});

    // also include new students this month
    const newStudentsAgg = await Student.aggregate([
      { $match: { createdAt: { $gte: monthStart, $lt: monthEnd } } },
      { $count: 'count' }
    ]);

    // total/active students from standalone Student collection
    const totalStudentsAgg = await Student.aggregate([{ $count: 'count' }]);
    const activeStudentsAgg = await Student.aggregate([{ $match: { isActive: true } }, { $count: 'count' }]);

    return {
      total: totalAgg[0]?.total || 0,
      byRole,
      activeByRole,
      newUsersThisMonth: newUsersAgg[0]?.count || 0,
      newStudentsThisMonth: newStudentsAgg[0]?.count || 0,
      activeUsersCount: activeAgg[0]?.count || 0,
      totalTeachers: byRole.teacher || 0,
      totalGuardians: byRole.guardian || 0,
      totalStudents: totalStudentsAgg[0]?.count || 0,
      activeTeachersTotal: activeByRole.teacher || 0,
      activeGuardiansTotal: activeByRole.guardian || 0,
      activeStudentsTotal: activeStudentsAgg[0]?.count || 0
    };
  }, { total: 0, byRole: {}, newUsersThisMonth: 0, activeUsersCount: 0 });
}

async function getClassStats() {
  return safeRun(async () => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const next7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const scheduledToday = (await Class.aggregate([{ $match: { scheduledDate: { $gte: startOfDay, $lt: endOfDay } } }, { $count: 'count' }]))[0]?.count || 0;
    const scheduledNext7 = (await Class.aggregate([{ $match: { scheduledDate: { $gte: now, $lt: next7 }, status: { $in: ['scheduled', 'in_progress'] } } }, { $count: 'count' }]))[0]?.count || 0;

    // scheduled hours until the end of the current month (minutes -> hours)
    const scheduledHoursAgg = await Class.aggregate([
      { $match: { scheduledDate: { $gte: now, $lt: monthEnd }, status: { $in: ['scheduled', 'in_progress'] } } },
      { $group: { _id: null, totalMinutes: { $sum: '$duration' } } }
    ]);
    const scheduledHoursUntilMonthEnd = (scheduledHoursAgg[0]?.totalMinutes || 0) / 60;

    // completed hours this month (sum durations for reports submitted this month)
    const completedAgg = await Class.aggregate([
      {
        $match: {
          'classReport.submittedAt': { $gte: monthStart, $lt: monthEnd },
          status: { $in: ['attended','completed','missed_by_student','absent'] }
        }
      },
      { $group: { _id: null, totalMinutes: { $sum: '$duration' } } }
    ]);
    const completedHoursThisMonth = (completedAgg[0]?.totalMinutes || 0) / 60;

    // cancelled hours this month
    const cancelledAgg = await Class.aggregate([
      { $match: { scheduledDate: { $gte: monthStart, $lt: monthEnd }, status: { $in: ['cancelled','cancelled_by_teacher','cancelled_by_guardian','cancelled_by_admin','cancelled_by_student'] } } },
      { $group: { _id: null, totalMinutes: { $sum: '$duration' } } }
    ]);
    const cancelledHoursThisMonth = (cancelledAgg[0]?.totalMinutes || 0) / 60;

    // active users (teachers + guardians) with future scheduled classes (distinct)
    const upcomingMatch = { scheduledDate: { $gte: now }, status: { $in: ['scheduled','in_progress'] } };
    const distinctTeachers = await Class.distinct('teacher', upcomingMatch) || [];
    const distinctGuardians = await Class.distinct('student.guardianId', upcomingMatch) || [];
    const activeUsersByScheduleCount = (Array.isArray(distinctTeachers) ? distinctTeachers.length : 0) + (Array.isArray(distinctGuardians) ? distinctGuardians.length : 0);

    const statusAgg = await Class.aggregate([
      { $match: { scheduledDate: { $gte: monthStart, $lt: monthEnd } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    let completed = 0; let cancelled = 0;
    (statusAgg || []).forEach(r => {
      if (r._id === 'attended' || r._id === 'completed') completed += r.count || 0;
      if (typeof r._id === 'string' && (r._id.includes('cancel') || r._id === 'cancelled')) cancelled += r.count || 0;
    });

    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const withoutReports = (await Class.aggregate([
      { $match: { scheduledDate: { $gte: sevenDaysAgo, $lt: sixHoursAgo }, status: { $nin: ['pattern', 'cancelled_by_teacher', 'cancelled_by_guardian', 'cancelled_by_admin'] } } },
      { $match: { $or: [ { 'classReport.submittedAt': { $exists: false } }, { 'classReport.submittedAt': null } ] } },
      { $count: 'count' }
    ]))[0]?.count || 0;

    const pendingReschedules = (await Class.aggregate([{ $match: { 'pendingReschedule.status': 'pending' } }, { $count: 'count' }]))[0]?.count || 0;

    return {
      scheduledToday,
      scheduledNext7,
      completedThisMonth: completed,
      cancelledThisMonth: cancelled,
      classesWithoutReportsCount: withoutReports,
      pendingReschedulesCount: pendingReschedules,
      // new hour-based metrics
      scheduledHoursUntilMonthEnd,
      completedHoursThisMonth,
      cancelledHoursThisMonth,
      activeUsersByScheduleCount
    };
  }, { scheduledToday:0, scheduledNext7:0, completedThisMonth:0, cancelledThisMonth:0, classesWithoutReportsCount:0, pendingReschedulesCount:0 });
}

async function getInvoiceStats() {
  return safeRun(async () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const monthlyAgg = await Invoice.aggregate([
      { $match: { 'billingPeriod.year': currentYear, 'billingPeriod.month': currentMonth, status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } }
    ]);
    const ytdAgg = await Invoice.aggregate([
      { $match: { 'billingPeriod.year': currentYear, status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);
    const unpaidAgg = await Invoice.aggregate([
      { $match: { status: { $ne: 'paid' } } },
      { $group: { _id: null, unpaid: { $sum: { $subtract: ['$total', { $ifNull: ['$paidAmount', 0] }] } } } }
    ]);
    const pendingCount = (await Invoice.aggregate([{ $match: { status: { $in: ['draft','sent','partially_paid','pending'] } } }, { $count: 'count' }]))[0]?.count || 0;
    const overdueCount = (await Invoice.aggregate([{ $match: { status: 'overdue' } }, { $count: 'count' }]))[0]?.count || 0;

    return {
      monthly: { total: monthlyAgg[0]?.total || 0, invoiceCount: monthlyAgg[0]?.count || 0 },
      ytd: ytdAgg[0]?.total || 0,
      unpaidBalanceTotal: unpaidAgg[0]?.unpaid || 0,
      pendingInvoicesCount: pendingCount,
      overdueInvoicesCount: overdueCount
    };
  }, { monthly: { total:0, invoiceCount:0 }, ytd:0, unpaidBalanceTotal:0, pendingInvoicesCount:0, overdueInvoicesCount:0 });
}

async function getTeacherStats() {
  return safeRun(async () => {
    const now = new Date();
    const last30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const prev30Start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const prev30End = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    // teachers on vacation
    const onVacation = await User.find({ role: 'teacher', vacationStartDate: { $lte: now }, vacationEndDate: { $gte: now } }).select('firstName lastName vacationStartDate vacationEndDate').lean();
    const teachersOnVacationCount = Array.isArray(onVacation) ? onVacation.length : 0;

    const totalTeachersAgg = await User.aggregate([
      { $match: { role: 'teacher' } },
      { $count: 'count' }
    ]);
    const activeTeachersAgg = await User.aggregate([
      { $match: { role: 'teacher', isActive: true } },
      { $count: 'count' }
    ]);
    const activeTeachersLast30 = await Class.distinct('teacher', { scheduledDate: { $gte: last30Start, $lt: now } });
    const activeTeachersPrev30 = await Class.distinct('teacher', { scheduledDate: { $gte: prev30Start, $lt: prev30End } });

    // monthly teacher earnings aggregated across teacher_payment invoices
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const earningsAgg = await Invoice.aggregate([
      { $match: { type: 'teacher_payment', status: 'paid', 'billingPeriod.year': currentYear, 'billingPeriod.month': currentMonth } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);
    const monthlyTeacherEarnings = earningsAgg[0]?.total || 0;

    return {
      teachersOnVacationCount,
      teachersOnVacationList: onVacation,
      monthlyTeacherEarnings,
      totalTeachers: totalTeachersAgg[0]?.count || 0,
      activeTeachersTotal: activeTeachersAgg[0]?.count || 0,
      activeTeachersLast30: Array.isArray(activeTeachersLast30) ? activeTeachersLast30.length : 0,
      activeTeachersPrev30: Array.isArray(activeTeachersPrev30) ? activeTeachersPrev30.length : 0
    };
  }, { teachersOnVacationCount:0, teachersOnVacationList:[], monthlyTeacherEarnings:0 });
}

async function getGuardianStats({ lowHoursThreshold = 2, topLimit = 5 } = {}) {
  return safeRun(async () => {
    const now = new Date();
    const last30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const prev30Start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const prev30End = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const totalGuardiansAgg = await User.aggregate([
      { $match: { role: 'guardian' } },
      { $count: 'count' }
    ]);
    const activeGuardiansAgg = await User.aggregate([
      { $match: { role: 'guardian', isActive: true } },
      { $count: 'count' }
    ]);
    const activeGuardiansLast30 = await Class.distinct('student.guardianId', { scheduledDate: { $gte: last30Start, $lt: now } });
    const activeGuardiansPrev30 = await Class.distinct('student.guardianId', { scheduledDate: { $gte: prev30Start, $lt: prev30End } });

    // top owing guardians
    const topOwing = await Invoice.aggregate([
      { $match: { status: { $ne: 'paid' } } },
      { $project: { guardian: 1, remaining: { $subtract: ['$total', { $ifNull: ['$paidAmount', 0] }] } } },
      { $group: { _id: '$guardian', totalOwed: { $sum: '$remaining' } } },
      { $sort: { totalOwed: -1 } },
      { $limit: topLimit },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'guardian' } },
      { $unwind: { path: '$guardian', preserveNullAndEmptyArrays: true } },
      { $project: { guardianId: '$_id', totalOwed: 1, 'guardian.firstName': 1, 'guardian.lastName': 1, 'guardian.guardianInfo.totalHours': 1 } }
    ]);

    // guardians low on hours
    const lowHourGuardians = await User.find({ role: 'guardian', 'guardianInfo.totalHours': { $lt: lowHoursThreshold } }).select('firstName lastName guardianInfo.totalHours').limit(10).lean();

    return {
      topOwingGuardians: Array.isArray(topOwing) ? topOwing : [],
      guardiansLowHours: Array.isArray(lowHourGuardians) ? lowHourGuardians : [],
      totalGuardians: totalGuardiansAgg[0]?.count || 0,
      activeGuardiansTotal: activeGuardiansAgg[0]?.count || 0,
      activeGuardiansLast30: Array.isArray(activeGuardiansLast30) ? activeGuardiansLast30.length : 0,
      activeGuardiansPrev30: Array.isArray(activeGuardiansPrev30) ? activeGuardiansPrev30.length : 0
    };
  }, { topOwingGuardians: [], guardiansLowHours: [] });
}

async function getStudentStats() {
  return safeRun(async () => {
    const now = new Date();
    const last30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const inactiveCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const totalStudentsAgg = await Student.aggregate([{ $count: 'count' }]);
    const activeStudentsAgg = await Student.aggregate([{ $match: { isActive: true } }, { $count: 'count' }]);

    const inactiveStudents = await Student.find({
      isActive: false,
      updatedAt: { $gte: last30Start, $lte: inactiveCutoff },
      $or: [
        { currentTeachers: { $exists: false } },
        { currentTeachers: { $size: 0 } }
      ]
    })
      .select('firstName lastName guardian updatedAt')
      .lean();

    const ids = (inactiveStudents || []).map((s) => s?._id).filter(Boolean);
    let lastClassById = new Map();
    if (ids.length) {
      const classAgg = await Class.aggregate([
        { $match: { 'student.studentId': { $in: ids }, status: { $ne: 'pattern' } } },
        {
          $group: {
            _id: '$student.studentId',
            lastClassAt: { $max: '$scheduledDate' },
            classCount: { $sum: 1 },
            studentName: { $first: '$student.studentName' },
            guardianId: { $first: '$student.guardianId' }
          }
        }
      ]);
      lastClassById = new Map((classAgg || []).map((row) => [String(row._id), row]));
    }

    const inactiveAfterActivity = (inactiveStudents || [])
      .map((student) => {
        const row = lastClassById.get(String(student._id));
        if (!row || !row.lastClassAt) return null;
        if (row.lastClassAt > student.updatedAt) return null;
        const fullName = `${student.firstName || ''} ${student.lastName || ''}`.trim();
        return {
          studentId: student._id,
          studentName: fullName || row.studentName || 'Student',
          guardianId: row.guardianId || student.guardian || null,
          inactiveAt: student.updatedAt,
          lastClassAt: row.lastClassAt,
          classCount: row.classCount || 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.inactiveAt) - new Date(a.inactiveAt))
      .slice(0, 20);

    const newStudentsFirstClasses = await Class.aggregate([
      {
        $match: {
          createdAt: { $exists: true },
          teacher: { $exists: true },
          'student.studentId': { $exists: true },
          status: { $ne: 'pattern' },
          hidden: { $ne: true }
        }
      },
      {
        $group: {
          _id: { teacher: '$teacher', student: '$student.studentId' },
          firstCreatedAt: { $min: '$createdAt' },
          firstScheduledAt: { $min: '$scheduledDate' },
          studentName: { $first: '$student.studentName' }
        }
      },
      { $match: { firstCreatedAt: { $gte: last30Start } } },
      { $sort: { firstCreatedAt: -1 } },
      { $limit: 30 },
      { $lookup: { from: 'users', localField: '_id.teacher', foreignField: '_id', as: 'teacher' } },
      { $unwind: { path: '$teacher', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'students', localField: '_id.student', foreignField: '_id', as: 'student' } },
      { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          teacherId: '$_id.teacher',
          studentId: '$_id.student',
          firstCreatedAt: 1,
          firstScheduledAt: 1,
          studentName: 1,
          teacherName: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ['$teacher.firstName', ''] },
                  ' ',
                  { $ifNull: ['$teacher.lastName', ''] }
                ]
              }
            }
          },
          studentProfileName: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ['$student.firstName', ''] },
                  ' ',
                  { $ifNull: ['$student.lastName', ''] }
                ]
              }
            }
          }
        }
      }
    ]);

    const pairKeys = (Array.isArray(newStudentsFirstClasses) ? newStudentsFirstClasses : [])
      .map((row) => ({ teacher: row.teacherId, student: row.studentId }))
      .filter((p) => p.teacher && p.student);

    let firstAttendedByPair = new Map();
    if (pairKeys.length) {
      const orPairs = pairKeys.map((p) => ({ teacher: p.teacher, 'student.studentId': p.student }));
      const attendedAgg = await Class.aggregate([
        {
          $match: {
            status: { $in: ['attended', 'completed'] },
            $or: orPairs
          }
        },
        {
          $group: {
            _id: { teacher: '$teacher', student: '$student.studentId' },
            firstAttendedAt: { $min: '$scheduledDate' }
          }
        }
      ]);
      firstAttendedByPair = new Map(
        (attendedAgg || []).map((row) => [`${String(row._id.teacher)}:${String(row._id.student)}`, row.firstAttendedAt])
      );
    }

    const newStudentsLast30Days = (Array.isArray(newStudentsFirstClasses) ? newStudentsFirstClasses : [])
      .map((row) => {
        const studentLabel = row.studentProfileName || row.studentName || 'Student';
        const teacherLabel = row.teacherName || 'Teacher';
        const key = `${String(row.teacherId)}:${String(row.studentId)}`;
        const firstAttendedAt = firstAttendedByPair.get(key) || null;
        return {
          studentId: row.studentId,
          studentName: studentLabel,
          teacherId: row.teacherId,
          teacherName: teacherLabel,
          firstCreatedAt: row.firstCreatedAt,
          firstScheduledAt: row.firstScheduledAt || null,
          firstAttendedAt
        };
      });

    return {
      totalStudents: totalStudentsAgg[0]?.count || 0,
      activeStudentsTotal: activeStudentsAgg[0]?.count || 0,
      inactiveStudentsAfterActivity: inactiveAfterActivity,
      inactiveStudentsAfterActivityCount: inactiveAfterActivity.length,
      newStudentsLast30Days,
      newStudentsLast30DaysCount: newStudentsLast30Days.length
    };
  }, {
    totalStudents: 0,
    activeStudentsTotal: 0,
    inactiveStudentsAfterActivity: [],
    inactiveStudentsAfterActivityCount: 0,
    newStudentsLast30Days: [],
    newStudentsLast30DaysCount: 0
  });
}

async function getGrowthStats() {
  return safeRun(async () => {
    const now = new Date();
    const thisMonthStart = startOfMonth(now);
    const lastMonthStart = new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth() - 1, 1);
    const thisMonthEnd = endOfMonth(now);

    const classesThisMonth = (await Class.aggregate([{ $match: { scheduledDate: { $gte: thisMonthStart, $lt: thisMonthEnd } } }, { $count: 'count' }]))[0]?.count || 0;
    const classesLastMonth = (await Class.aggregate([{ $match: { scheduledDate: { $gte: lastMonthStart, $lt: thisMonthStart } } }, { $count: 'count' }]))[0]?.count || 0;

    const revenueThisMonthAgg = await Invoice.aggregate([{ $match: { status: 'paid', 'billingPeriod.year': thisMonthStart.getFullYear(), 'billingPeriod.month': thisMonthStart.getMonth() + 1 } }, { $group: { _id: null, total: { $sum: '$total' } } }]);
    const revenueLastMonthAgg = await Invoice.aggregate([{ $match: { status: 'paid', 'billingPeriod.year': lastMonthStart.getFullYear(), 'billingPeriod.month': lastMonthStart.getMonth() + 1 } }, { $group: { _id: null, total: { $sum: '$total' } } }]);

    const revenueThis = revenueThisMonthAgg[0]?.total || 0;
    const revenueLast = revenueLastMonthAgg[0]?.total || 0;

    const pct = (current, prev) => {
      if (prev === 0) return current === 0 ? 0 : 100;
      return Math.round(((current - prev) / Math.abs(prev)) * 100 * 100) / 100;
    };

    return {
      classesThisMonth,
      classesLastMonth,
      classesChangePct: pct(classesThisMonth, classesLastMonth),
      revenueThisMonth: revenueThis,
      revenueLastMonth: revenueLast,
      revenueChangePct: pct(revenueThis, revenueLast)
    };
  }, { classesThisMonth:0, classesLastMonth:0, classesChangePct:0, revenueThisMonth:0, revenueLastMonth:0, revenueChangePct:0 });
}

module.exports = {
  getUserStats,
  getClassStats,
  getInvoiceStats,
  getTeacherStats,
  getGuardianStats,
  getGrowthStats,
  getStudentStats
};
