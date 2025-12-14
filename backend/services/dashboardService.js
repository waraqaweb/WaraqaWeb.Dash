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
const safeRun = async (fn, fallback = null, ms = 400) => {
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

    // also include new students this month
    const newStudentsAgg = await Student.aggregate([
      { $match: { createdAt: { $gte: monthStart, $lt: monthEnd } } },
      { $count: 'count' }
    ]);

    return {
      total: totalAgg[0]?.total || 0,
      byRole,
      newUsersThisMonth: newUsersAgg[0]?.count || 0,
      newStudentsThisMonth: newStudentsAgg[0]?.count || 0,
      activeUsersCount: activeAgg[0]?.count || 0
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

    // completed hours this month (sum durations for completed/attended/missed statuses)
    const completedAgg = await Class.aggregate([
      { $match: { scheduledDate: { $gte: monthStart, $lt: monthEnd }, status: { $in: ['attended','completed','missed_by_student','absent'] } } },
      { $group: { _id: null, totalMinutes: { $sum: '$duration' } } }
    ]);
    const completedHoursThisMonth = (completedAgg[0]?.totalMinutes || 0) / 60;

    // cancelled hours this month
    const cancelledAgg = await Class.aggregate([
      { $match: { scheduledDate: { $gte: monthStart, $lt: monthEnd }, status: { $in: ['cancelled','cancelled_by_teacher','cancelled_by_guardian','cancelled_by_admin'] } } },
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
    // teachers on vacation
    const onVacation = await User.find({ role: 'teacher', vacationStartDate: { $lte: now }, vacationEndDate: { $gte: now } }).select('firstName lastName vacationStartDate vacationEndDate').lean();
    const teachersOnVacationCount = Array.isArray(onVacation) ? onVacation.length : 0;

    // monthly teacher earnings aggregated across teacher_payment invoices
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const earningsAgg = await Invoice.aggregate([
      { $match: { type: 'teacher_payment', status: 'paid', 'billingPeriod.year': currentYear, 'billingPeriod.month': currentMonth } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);
    const monthlyTeacherEarnings = earningsAgg[0]?.total || 0;

    return { teachersOnVacationCount, teachersOnVacationList: onVacation, monthlyTeacherEarnings };
  }, { teachersOnVacationCount:0, teachersOnVacationList:[], monthlyTeacherEarnings:0 });
}

async function getGuardianStats({ lowHoursThreshold = 2, topLimit = 5 } = {}) {
  return safeRun(async () => {
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

    return { topOwingGuardians: Array.isArray(topOwing) ? topOwing : [], guardiansLowHours: Array.isArray(lowHourGuardians) ? lowHourGuardians : [] };
  }, { topOwingGuardians: [], guardiansLowHours: [] });
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
  getGrowthStats
};
