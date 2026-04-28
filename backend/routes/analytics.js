// backend/routes/analytics.js
/**
 * Analytics & Reporting Routes for Teacher Salary System
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const AnalyticsService = require('../services/analyticsService');
const Class = require('../models/Class');
const Student = require('../models/Student');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const TeacherInvoice = require('../models/TeacherInvoice');
const SalarySettings = require('../models/SalarySettings');
const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');
const historicalFinancials = require('../data/historicalFinancials.json');

/**
 * @route   GET /api/analytics/dashboard
 * @desc    Get admin dashboard statistics
 * @access  Admin only
 */
router.get('/dashboard', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { year, startMonth, endMonth } = req.query;
    
    const options = {};
    if (year) options.year = parseInt(year);
    if (startMonth) options.startMonth = parseInt(startMonth);
    if (endMonth) options.endMonth = parseInt(endMonth);

    const stats = await AnalyticsService.getDashboardStats(options);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('[GET /api/analytics/dashboard] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard statistics',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/teacher/:teacherId/trends
 * @desc    Get teacher earning trends
 * @access  Admin or teacher (own data only)
 */
router.get('/teacher/:teacherId/trends', authenticateToken, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { startYear, endYear } = req.query;

    // Authorization: admin or teacher viewing own data
    if (req.user.role !== 'admin' && req.user.id !== teacherId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this data'
      });
    }

    const options = {};
    if (startYear) options.startYear = parseInt(startYear);
    if (endYear) options.endYear = parseInt(endYear);

    const trends = await AnalyticsService.getTeacherEarningTrends(teacherId, options);

    res.json({
      success: true,
      data: trends
    });
  } catch (error) {
    console.error('[GET /api/analytics/teacher/:teacherId/trends] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get teacher trends',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/payment-history
 * @desc    Get payment history report
 * @access  Admin only
 */
router.get('/payment-history', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { startDate, endDate, teacherId, status } = req.query;

    const options = {};
    if (startDate) options.startDate = startDate;
    if (endDate) options.endDate = endDate;
    if (teacherId) options.teacherId = teacherId;
    if (status) options.status = status;

    const history = await AnalyticsService.getPaymentHistory(options);

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('[GET /api/analytics/payment-history] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment history',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/forecast
 * @desc    Get financial forecast
 * @access  Admin only
 */
router.get('/forecast', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { months } = req.query;

    const options = {};
    if (months) options.months = parseInt(months);

    const forecast = await AnalyticsService.getFinancialForecast(options);

    res.json({
      success: true,
      data: forecast
    });
  } catch (error) {
    console.error('[GET /api/analytics/forecast] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get financial forecast',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/export/:type
 * @desc    Export data to Excel
 * @access  Admin only
 * @params  type: 'invoices', 'payments', 'teachers', 'dashboard'
 */
router.get('/export/:type', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { type } = req.params;
    const allowedTypes = ['invoices', 'payments', 'teachers', 'dashboard'];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid export type. Allowed: ${allowedTypes.join(', ')}`
      });
    }

    // Get filter options from query
    const options = {};
    if (req.query.year) options.year = parseInt(req.query.year);
    if (req.query.month) options.month = parseInt(req.query.month);
    if (req.query.startMonth) options.startMonth = parseInt(req.query.startMonth);
    if (req.query.endMonth) options.endMonth = parseInt(req.query.endMonth);
    if (req.query.status) options.status = req.query.status;
    if (req.query.teacherId) options.teacherId = req.query.teacherId;

    const buffer = await AnalyticsService.exportToExcel(type, options);

    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `waraqa_${type}_${timestamp}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error('[GET /api/analytics/export/:type] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export data',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/business-intelligence
 * @desc    Comprehensive business intelligence data for decision-making
 * @access  Admin only
 */
router.get('/business-intelligence', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const BILLABLE_STATUSES = ['attended', 'completed', 'missed_by_student'];
    const CANCELLED_STATUSES = ['cancelled_by_teacher', 'cancelled_by_student', 'cancelled_by_guardian', 'cancelled_by_admin', 'cancelled'];

    const [
      currentHoursAgg,
      cancelledHoursAgg,
      scheduledHoursAgg,
      prevMonthHoursAgg,
      teacherCapacity,
      activeStudentsCount,
      totalStudentsCount,
      newStudents30,
      newStudents60,
      newStudents90,
      atRiskStudents,
      stoppedStudents,
      studentGrowthByMonth,
      timeDistribution,
      revenueThisMonth,
      prevMonthRevenue,
      teacherCostsThisMonth,
      salarySettings,
      latestExchangeRate,
      last12MonthsRevenue,
      last12MonthsTeacherCosts,
      avgChargeRate,
      guardianRates,
      teacherRateWeighted,
      studentClassStats,
      perTeacherRates,
    ] = await Promise.all([
      // Current month completed hours
      Class.aggregate([
        { $match: { scheduledDate: { $gte: monthStart, $lt: monthEnd }, status: { $in: BILLABLE_STATUSES } } },
        { $group: { _id: null, totalMinutes: { $sum: '$duration' }, count: { $sum: 1 } } }
      ]),
      // Cancelled hours this month
      Class.aggregate([
        { $match: { scheduledDate: { $gte: monthStart, $lt: monthEnd }, status: { $in: CANCELLED_STATUSES } } },
        { $group: { _id: null, totalMinutes: { $sum: '$duration' }, count: { $sum: 1 } } }
      ]),
      // Scheduled remaining hours this month
      Class.aggregate([
        { $match: { scheduledDate: { $gte: now, $lt: monthEnd }, status: { $in: ['scheduled', 'in_progress'] } } },
        { $group: { _id: null, totalMinutes: { $sum: '$duration' }, count: { $sum: 1 } } }
      ]),
      // Previous month total hours (for comparison)
      Class.aggregate([
        { $match: { scheduledDate: { $gte: prevMonthStart, $lt: monthStart }, status: { $in: BILLABLE_STATUSES } } },
        { $group: { _id: null, totalMinutes: { $sum: '$duration' }, count: { $sum: 1 } } }
      ]),
      // Teacher capacity — hours per teacher this month
      Class.aggregate([
        { $match: { scheduledDate: { $gte: monthStart, $lt: monthEnd }, status: { $in: [...BILLABLE_STATUSES, 'scheduled', 'in_progress'] }, teacher: { $ne: null } } },
        { $group: {
          _id: '$teacher',
          totalMinutes: { $sum: '$duration' },
          classCount: { $sum: 1 },
          uniqueDays: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$scheduledDate' } } },
          uniqueStudents: { $addToSet: '$student.studentId' }
        }},
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'userInfo' } },
        { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
        { $project: {
          teacherId: '$_id',
          name: { $concat: [{ $ifNull: ['$userInfo.firstName', ''] }, ' ', { $ifNull: ['$userInfo.lastName', ''] }] },
          customRate: '$userInfo.teacherInfo.customRateOverride',
          totalMinutes: 1,
          totalHours: { $divide: ['$totalMinutes', 60] },
          classCount: 1,
          daysActive: { $size: '$uniqueDays' },
          studentCount: { $size: '$uniqueStudents' }
        }},
        { $sort: { totalHours: -1 } }
      ]),
      // Active students
      Student.countDocuments({ isActive: true }),
      Student.countDocuments({}),
      Student.countDocuments({ isActive: true, createdAt: { $gte: thirtyDaysAgo } }),
      Student.countDocuments({ isActive: true, createdAt: { $gte: sixtyDaysAgo } }),
      Student.countDocuments({ isActive: true, createdAt: { $gte: ninetyDaysAgo } }),
      // At-risk: active students with 0 classes in last 30 days
      (async () => {
        const activeWithClasses = await Class.distinct('student.studentId', {
          scheduledDate: { $gte: thirtyDaysAgo },
          status: { $nin: [...CANCELLED_STATUSES, 'pattern'] }
        });
        const activeStudentIds = await Student.find({ isActive: true }).select('_id').lean();
        const withClassSet = new Set(activeWithClasses.map(id => String(id)));
        return activeStudentIds.filter(s => !withClassSet.has(String(s._id))).length;
      })(),
      // Stopped students — inactive, limited to those created in the last 2 years
      Student.find({ isActive: false, createdAt: { $gte: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000) } })
        .select('_id firstName lastName createdAt')
        .limit(500)
        .lean(),
      // Student growth by month (last 12 months): new students created per month
      Student.aggregate([
        { $match: { createdAt: { $gte: twelveMonthsAgo } } },
        { $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          newStudents: { $sum: 1 },
          activeNew: { $sum: { $cond: ['$isActive', 1, 0] } }
        }},
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),
      // Class time distribution (last 3 months)
      Class.aggregate([
        { $match: { scheduledDate: { $gte: threeMonthsAgo, $lt: now }, status: { $nin: [...CANCELLED_STATUSES, 'pattern'] } } },
        { $group: {
          _id: { dayOfWeek: { $dayOfWeek: '$scheduledDate' }, hourUTC: { $hour: '$scheduledDate' } },
          classCount: { $sum: 1 },
          totalMinutes: { $sum: '$duration' }
        }},
        { $project: {
          dayOfWeek: '$_id.dayOfWeek',
          hourUTC: '$_id.hourUTC',
          hourEST: { $mod: [{ $add: [{ $subtract: ['$_id.hourUTC', 5] }, 24] }, 24] },
          classCount: 1,
          totalMinutes: 1
        }},
        { $sort: { dayOfWeek: 1, hourUTC: 1 } }
      ]),
      // Revenue this month (from paid guardian invoices)
      Invoice.aggregate([
        { $match: { status: 'paid', paidAt: { $gte: monthStart, $lt: monthEnd } } },
        { $group: { _id: null, totalRevenue: { $sum: '$total' }, invoiceCount: { $sum: 1 } } }
      ]),
      // Previous month revenue
      Invoice.aggregate([
        { $match: { status: 'paid', paidAt: { $gte: prevMonthStart, $lt: monthStart } } },
        { $group: { _id: null, totalRevenue: { $sum: '$total' }, invoiceCount: { $sum: 1 } } }
      ]),
      // Teacher costs this month
      TeacherInvoice.aggregate([
        { $match: { month: now.getMonth() + 1, year: now.getFullYear(), status: { $in: ['published', 'paid'] } } },
        { $group: { _id: null, totalUSD: { $sum: '$totalUSD' }, totalEGP: { $sum: '$totalEGP' }, totalHours: { $sum: '$totalHours' }, count: { $sum: 1 } } }
      ]),
      // Salary settings
      SalarySettings.findById('global').lean(),
      // Latest exchange rate
      MonthlyExchangeRates.findOne({}).sort({ year: -1, month: -1 }).lean(),
      // Last 12 months revenue trend
      Invoice.aggregate([
        { $match: { status: 'paid', paidAt: { $gte: twelveMonthsAgo } } },
        { $group: {
          _id: { year: { $year: '$paidAt' }, month: { $month: '$paidAt' } },
          totalRevenue: { $sum: '$total' },
          invoiceCount: { $sum: 1 }
        }},
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),
      // Last 12 months teacher costs trend
      TeacherInvoice.aggregate([
        { $match: { status: { $in: ['published', 'paid'] }, year: { $gte: now.getFullYear() - 1 } } },
        { $group: {
          _id: { year: '$year', month: '$month' },
          totalUSD: { $sum: '$totalUSD' },
          totalHours: { $sum: '$totalHours' },
          count: { $sum: 1 }
        }},
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),
      // DYNAMIC: Actual charge rate from recent invoices (last 3 months)
      Invoice.aggregate([
        { $match: { status: 'paid', paidAt: { $gte: threeMonthsAgo } } },
        { $unwind: '$items' },
        { $match: { 'items.rate': { $gt: 0 }, 'items.duration': { $gt: 0 } } },
        { $group: {
          _id: null,
          totalAmount: { $sum: '$items.amount' },
          totalMinutes: { $sum: '$items.duration' },
          avgRate: { $avg: '$items.rate' },
          minRate: { $min: '$items.rate' },
          maxRate: { $max: '$items.rate' },
          itemCount: { $sum: 1 }
        }}
      ]),
      // DYNAMIC: All active guardian hourly rates
      User.aggregate([
        { $match: { role: 'guardian', isActive: true, 'guardianInfo.hourlyRate': { $gt: 0 } } },
        { $group: {
          _id: null,
          avgRate: { $avg: '$guardianInfo.hourlyRate' },
          minRate: { $min: '$guardianInfo.hourlyRate' },
          maxRate: { $max: '$guardianInfo.hourlyRate' },
          count: { $sum: 1 }
        }}
      ]),
      // DYNAMIC: Weighted average teacher rate from last 3 months teacher invoices
      TeacherInvoice.aggregate([
        { $match: { status: { $in: ['published', 'paid'] }, year: { $gte: now.getFullYear() - 1 } } },
        { $match: { $expr: { $gte: [{ $add: [{ $multiply: ['$year', 12] }, '$month'] }, (now.getFullYear() * 12 + now.getMonth() + 1) - 3] } } },
        { $group: {
          _id: null,
          totalUSD: { $sum: '$grossAmountUSD' },
          totalHours: { $sum: '$totalHours' },
          count: { $sum: 1 }
        }}
      ]),
      // Per-student class stats: first/last class date and total hours (for accurate stopped-date calculation)
      Class.aggregate([
        { $match: { status: { $in: BILLABLE_STATUSES }, scheduledDate: { $gte: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000) } } },
        { $group: {
          _id: '$student.studentId',
          firstClass: { $min: '$scheduledDate' },
          lastClass: { $max: '$scheduledDate' },
          totalClasses: { $sum: 1 },
          totalMinutes: { $sum: '$duration' }
        }}
      ]),
      // Per-teacher rates from most recent invoice (any status including draft)
      TeacherInvoice.aggregate([
        { $sort: { year: -1, month: -1 } },
        { $group: {
          _id: '$teacher',
          latestRate: { $first: '$rateSnapshot.rate' },
          latestPartition: { $first: '$rateSnapshot.partition' },
          latestMonth: { $first: '$month' },
          latestYear: { $first: '$year' },
          totalHoursAllTime: { $sum: '$totalHours' }
        }}
      ]),
    ]);

    // Process results
    const completedHours = (currentHoursAgg[0]?.totalMinutes || 0) / 60;
    const cancelledHours = (cancelledHoursAgg[0]?.totalMinutes || 0) / 60;
    const scheduledHours = (scheduledHoursAgg[0]?.totalMinutes || 0) / 60;
    const prevMonthHours = (prevMonthHoursAgg[0]?.totalMinutes || 0) / 60;
    const completedClasses = currentHoursAgg[0]?.count || 0;
    const cancelledClasses = cancelledHoursAgg[0]?.count || 0;
    const scheduledClasses = scheduledHoursAgg[0]?.count || 0;
    const hoursChangeVsPrev = prevMonthHours > 0 ? ((completedHours + scheduledHours - prevMonthHours) / prevMonthHours * 100) : null;

    // Build a map of per-teacher rates from invoices
    const teacherRateMap = {};
    perTeacherRates.forEach(r => {
      teacherRateMap[String(r._id)] = {
        rate: r.latestRate,
        partition: r.latestPartition,
        month: r.latestMonth,
        year: r.latestYear,
        totalHoursAllTime: r.totalHoursAllTime
      };
    });

    // Teacher capacity summary
    const activeTeacherCount = teacherCapacity.length;
    const totalTeacherHours = teacherCapacity.reduce((sum, t) => sum + (t.totalHours || 0), 0);
    const avgHoursPerTeacher = activeTeacherCount > 0 ? totalTeacherHours / activeTeacherCount : 0;
    const maxTeacherHours = teacherCapacity.length > 0 ? Math.max(...teacherCapacity.map(t => t.totalHours || 0)) : 0;

    // DYNAMIC rates from real data
    const ratePartitions = (salarySettings?.ratePartitions || []).filter(p => p.isActive);
    // Weighted teacher rate: use actual teacher invoice data (gross/hours), fall back to salary settings
    const weightedTeacherRate = (teacherRateWeighted[0]?.totalHours > 0)
      ? teacherRateWeighted[0].totalUSD / teacherRateWeighted[0].totalHours
      : (ratePartitions.length > 0 ? ratePartitions.reduce((sum, p) => sum + p.rateUSD, 0) / ratePartitions.length : 3.13);
    // Actual avg teacher rate from this month's invoices
    const thisMonthTeacherRate = (teacherCostsThisMonth[0]?.totalHours > 0)
      ? teacherCostsThisMonth[0].totalUSD / teacherCostsThisMonth[0].totalHours
      : weightedTeacherRate;

    const currentExchangeRate = latestExchangeRate?.rate || 46.86;

    // DYNAMIC charge rate: from actual invoice items, or guardian hourly rates, or historical fallback
    const dynamicChargeRate = avgChargeRate[0]?.avgRate
      || guardianRates[0]?.avgRate
      || 9.53;
    const chargeRateFromInvoices = avgChargeRate[0] || null;
    const guardianRateStats = guardianRates[0] || null;

    // Financial summary
    const revenueUSD = revenueThisMonth[0]?.totalRevenue || 0;
    const prevRevenueUSD = prevMonthRevenue[0]?.totalRevenue || 0;
    const revenueChangeVsPrev = prevRevenueUSD > 0 ? ((revenueUSD - prevRevenueUSD) / prevRevenueUSD * 100) : null;
    const teacherCostsUSD = teacherCostsThisMonth[0]?.totalUSD || 0;

    // DYNAMIC overhead: compute recent average from last historical entry (or configurable)
    const recentHistorical = historicalFinancials.slice(-3);
    const avgOverhead = recentHistorical.length > 0
      ? recentHistorical.reduce((sum, h) => sum + (h.adminExpenses || 0) + (h.hosting || 0) + (h.internet || 0), 0) / recentHistorical.length
      : 112.30;

    // Break-even calculations — all dynamic now
    const currentEstimatedHours = completedHours + scheduledHours;
    const overheadPerHour = currentEstimatedHours > 0 ? avgOverhead / currentEstimatedHours : 0;
    const currentProfitPerHour = dynamicChargeRate - thisMonthTeacherRate - overheadPerHour;
    const targetRate = 4.00;
    const profitPerHourAtTarget = dynamicChargeRate - targetRate - overheadPerHour;
    const currentEstimatedProfit = currentEstimatedHours * currentProfitPerHour;
    const hoursNeededAt4USD = profitPerHourAtTarget > 0 ? currentEstimatedProfit / profitPerHourAtTarget : null;

    // Student growth/stoppage analysis — using last completed class date (not updatedAt)
    const classStatsMap = {};
    studentClassStats.forEach(s => { classStatsMap[String(s._id)] = s; });

    // Only include inactive students who had at least one completed class
    const stoppedWithClassData = stoppedStudents
      .map(s => {
        const stats = classStatsMap[String(s._id)];
        if (!stats) return null;
        return {
          ...s,
          lastClassDate: stats.lastClass,
          firstClassDate: stats.firstClass,
          totalClasses: stats.totalClasses,
          totalHours: stats.totalMinutes / 60
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.lastClassDate) - new Date(a.lastClassDate));

    const stoppedCount = stoppedWithClassData.length;
    const stoppedLast30 = stoppedWithClassData.filter(s => new Date(s.lastClassDate) >= thirtyDaysAgo).length;
    const stoppedLast90 = stoppedWithClassData.filter(s => new Date(s.lastClassDate) >= ninetyDaysAgo).length;
    const stoppedHoursLast90 = stoppedWithClassData
      .filter(s => new Date(s.lastClassDate) >= ninetyDaysAgo)
      .reduce((sum, s) => sum + s.totalHours, 0);

    // Net growth by completed-class basis (3-month window)
    const newByClass3Mo = studentClassStats.filter(s =>
      s.firstClass && new Date(s.firstClass) >= threeMonthsAgo
    ).length;
    const stoppedByClass3Mo = stoppedWithClassData.filter(s =>
      new Date(s.lastClassDate) >= threeMonthsAgo
    ).length;
    const netGrowth3Months = newByClass3Mo - stoppedByClass3Mo;

    // Monthly growth chart: stopped by last-class date
    const growthByMonth = studentGrowthByMonth.map(g => {
      const key = `${g._id.year}-${String(g._id.month).padStart(2, '0')}`;
      const stoppedInMonth = stoppedWithClassData.filter(s => {
        const d = new Date(s.lastClassDate);
        return d.getFullYear() === g._id.year && d.getMonth() + 1 === g._id.month;
      }).length;
      return {
        period: key,
        year: g._id.year,
        month: g._id.month,
        newStudents: g.newStudents,
        stillActive: g.activeNew,
        stopped: stoppedInMonth,
        netGrowth: g.newStudents - stoppedInMonth
      };
    });

    // Merge historical + live trends
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const historicalTrend = historicalFinancials.map(h => ({
      year: h.year,
      month: h.month,
      period: `${h.year}-${String(h.month).padStart(2, '0')}`,
      teachingHours: h.teachingHours,
      currentMonthFees: h.currentMonthFees,
      netProfitUSD: h.netProfitUSD,
      profitPercent: h.profitPercent,
      teacherHourRate: h.teacherHourRate,
      exchangeRate: h.actualExRate || h.teacherExRate,
      moneyOut: h.moneyOut,
      totalMoneyIn: h.totalMoneyIn,
      source: 'historical'
    }));

    // Campaign projections — all rates dynamic
    const avgHrsPerStudent = activeStudentsCount > 0 ? currentEstimatedHours / activeStudentsCount : 8;
    const campaignProjections = {
      monthlyBudget: 100,
      channels: {
        googleAds: {
          budget: 40, expectedCPC: 2.00, expectedClicks: 20,
          conversionRate: 0.08, expectedLeads: 1.6, costPerLead: 25
        },
        facebookInstagram: {
          budget: 25, expectedCPM: 10, expectedImpressions: 2500,
          clickRate: 0.02, expectedClicks: 50, conversionRate: 0.04, expectedLeads: 2
        },
        seo: {
          budget: 20, note: 'Content creation tools',
          expectedOrganicLeadsMonth3: 2, expectedOrganicLeadsMonth6: 5
        },
        tiktok: {
          budget: 15, expectedImpressions: 5000,
          clickRate: 0.01, expectedClicks: 50, conversionRate: 0.02, expectedLeads: 1
        }
      },
      totalExpectedLeadsMonth1: 4.6,
      leadToStudentRate: 0.35,
      expectedNewStudentsMonth1: 1.6,
      expectedNewStudentsMonth3: 3,
      expectedNewStudentsMonth6: 6,
      revenuePerStudentMonthly: +(dynamicChargeRate * avgHrsPerStudent).toFixed(2),
      avgHoursPerStudent: +avgHrsPerStudent.toFixed(2),
      projections: {
        month1:  { newStudents: 1,  additionalRevenue: +(dynamicChargeRate * avgHrsPerStudent * 1).toFixed(2) },
        month3:  { newStudents: 4,  additionalRevenue: +(dynamicChargeRate * avgHrsPerStudent * 4).toFixed(2) },
        month6:  { newStudents: 8,  additionalRevenue: +(dynamicChargeRate * avgHrsPerStudent * 8).toFixed(2) },
        month12: { newStudents: 15, additionalRevenue: +(dynamicChargeRate * avgHrsPerStudent * 15).toFixed(2) }
      }
    };

    // Seasonal analysis
    const monthlyAvgs = {};
    historicalFinancials.forEach(h => {
      if (!monthlyAvgs[h.month]) monthlyAvgs[h.month] = { hours: [], profit: [], revenue: [] };
      monthlyAvgs[h.month].hours.push(h.teachingHours);
      monthlyAvgs[h.month].profit.push(h.netProfitUSD);
      monthlyAvgs[h.month].revenue.push(h.currentMonthFees);
    });
    const seasonalPatterns = Object.entries(monthlyAvgs).map(([month, data]) => ({
      month: Number(month),
      avgHours: data.hours.reduce((a, b) => a + b, 0) / data.hours.length,
      avgProfit: data.profit.reduce((a, b) => a + b, 0) / data.profit.length,
      avgRevenue: data.revenue.reduce((a, b) => a + b, 0) / data.revenue.length,
      dataPoints: data.hours.length
    })).sort((a, b) => a.month - b.month);

    const allHours = historicalFinancials.map(h => h.teachingHours);
    const allProfits = historicalFinancials.map(h => h.netProfitUSD);
    const allProfitPcts = historicalFinancials.map(h => h.profitPercent);

    res.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        currentMonth: { year: currentYear, month: currentMonth },

        hours: {
          completedHours: +completedHours.toFixed(2),
          cancelledHours: +cancelledHours.toFixed(2),
          scheduledHoursRemaining: +scheduledHours.toFixed(2),
          estimatedTotalHours: +(completedHours + scheduledHours).toFixed(2),
          completedClasses,
          cancelledClasses,
          scheduledClasses,
          cancellationRate: completedClasses + cancelledClasses > 0
            ? +((cancelledClasses / (completedClasses + cancelledClasses)) * 100).toFixed(1) : 0,
          prevMonthHours: +prevMonthHours.toFixed(2),
          hoursChangeVsPrev: hoursChangeVsPrev !== null ? +hoursChangeVsPrev.toFixed(1) : null
        },

        teacherCapacity: {
          activeTeachers: activeTeacherCount,
          totalHoursThisMonth: +totalTeacherHours.toFixed(2),
          monthStartDate: monthStart.toISOString(),
          avgHoursPerTeacher: +avgHoursPerTeacher.toFixed(2),
          avgHoursPerTeacherWeekly: +(avgHoursPerTeacher / 4.33).toFixed(2),
          maxTeacherHours: +maxTeacherHours.toFixed(2),
          teachers: teacherCapacity.map(t => {
            const rateInfo = teacherRateMap[String(t.teacherId)] || null;
            const effectiveRate = t.customRate?.enabled
              ? t.customRate.rateUSD
              : rateInfo?.rate ?? null;
            return {
              name: t.name?.trim() || 'Unknown',
              hoursThisMonth: +t.totalHours.toFixed(2),
              hoursPerWeek: +(t.totalHours / 4.33).toFixed(2),
              classCount: t.classCount,
              daysActive: t.daysActive,
              studentCount: t.studentCount,
              hasCustomRate: !!(t.customRate?.enabled),
              customRateUSD: t.customRate?.enabled ? t.customRate.rateUSD : null,
              rateUSD: effectiveRate !== null ? +Number(effectiveRate).toFixed(2) : null,
              ratePartition: t.customRate?.enabled ? 'custom' : (rateInfo?.partition ?? null),
              rateMonth: rateInfo?.month ?? null,
              rateYear: rateInfo?.year ?? null,
            };
          })
        },

        students: {
          activeStudents: activeStudentsCount,
          totalStudents: totalStudentsCount,
          newLast30Days: newStudents30,
          newLast60Days: newStudents60,
          newLast90Days: newStudents90,
          atRiskStudents,
          avgHoursPerStudent: activeStudentsCount > 0
            ? +((completedHours + scheduledHours) / activeStudentsCount).toFixed(2) : 0,
          // Growth tracking (class-date based)
          stoppedLast30Days: stoppedLast30,
          stoppedLast90Days: stoppedLast90,
          stoppedHoursLast90Days: +stoppedHoursLast90.toFixed(1),
          totalStoppedRecent: stoppedCount,
          netGrowth30Days: newStudents30 - stoppedLast30,
          netGrowth3Months,
          newByClass3Mo,
          stoppedByClass3Mo,
          recentlyStoppedStudents: stoppedWithClassData.slice(0, 10).map(s => ({
            name: `${s.firstName || ''} ${s.lastName || ''}`.trim(),
            stoppedAt: s.lastClassDate,
            enrolledAt: s.createdAt,
            totalHours: +s.totalHours.toFixed(1),
            totalClasses: s.totalClasses
          })),
          growthByMonth
        },

        timeDistribution: timeDistribution.map(t => ({
          dayOfWeek: t.dayOfWeek,
          hourUTC: t.hourUTC,
          hourEST: t.hourEST,
          classCount: t.classCount,
          totalHours: +(t.totalMinutes / 60).toFixed(2)
        })),

        financial: {
          // Collected = paid invoices this month (may be $0 mid-month if invoices unpaid)
          revenueThisMonth: +revenueUSD.toFixed(2),
          prevMonthRevenue: +prevRevenueUSD.toFixed(2),
          revenueChangeVsPrev: revenueChangeVsPrev !== null ? +revenueChangeVsPrev.toFixed(1) : null,
          // Earned = completed class hours × charge rate (accrual basis, more useful mid-month)
          earnedRevenueThisMonth: +(completedHours * dynamicChargeRate).toFixed(2),
          scheduledRevenueThisMonth: +(scheduledHours * dynamicChargeRate).toFixed(2),
          completedHoursThisMonth: +completedHours.toFixed(2),
          scheduledHoursThisMonth: +scheduledHours.toFixed(2),
          teacherCostsThisMonth: +teacherCostsUSD.toFixed(2),
          monthlyOverhead: +avgOverhead.toFixed(2),
          // Profit on earned basis (accrual) — much more representative than cash basis
          estimatedProfitThisMonth: +((completedHours * dynamicChargeRate) - teacherCostsUSD - avgOverhead).toFixed(2),
          estimatedProfitCashBasis: +(revenueUSD - teacherCostsUSD - avgOverhead).toFixed(2),
          // DYNAMIC rates
          chargeRatePerHour: +dynamicChargeRate.toFixed(2),
          chargeRateSource: chargeRateFromInvoices ? 'invoices (3mo avg)' : (guardianRateStats ? 'guardian settings' : 'historical'),
          chargeRateDetail: chargeRateFromInvoices ? {
            avg: +chargeRateFromInvoices.avgRate.toFixed(2),
            min: +chargeRateFromInvoices.minRate.toFixed(2),
            max: +chargeRateFromInvoices.maxRate.toFixed(2),
            sampleSize: chargeRateFromInvoices.itemCount
          } : null,
          guardianRates: guardianRateStats ? {
            avg: +guardianRateStats.avgRate.toFixed(2),
            min: +guardianRateStats.minRate.toFixed(2),
            max: +guardianRateStats.maxRate.toFixed(2),
            guardianCount: guardianRateStats.count
          } : null,
          currentAvgTeacherRate: +thisMonthTeacherRate.toFixed(2),
          weightedTeacherRate3Mo: +weightedTeacherRate.toFixed(2),
          currentExchangeRate,
          profitPerHour: +currentProfitPerHour.toFixed(2),
          ratePartitions: ratePartitions.map(p => ({
            name: p.name, minHours: p.minHours, maxHours: p.maxHours, rateUSD: p.rateUSD
          }))
        },

        breakEven: {
          currentTeacherRate: +thisMonthTeacherRate.toFixed(2),
          targetTeacherRate: targetRate,
          currentHours: +currentEstimatedHours.toFixed(2),
          currentProfitPerHour: +currentProfitPerHour.toFixed(2),
          profitPerHourAtTarget: +profitPerHourAtTarget.toFixed(2),
          currentEstimatedProfit: +currentEstimatedProfit.toFixed(2),
          hoursNeededAt4USD: hoursNeededAt4USD ? +hoursNeededAt4USD.toFixed(2) : null,
          additionalHoursNeeded: hoursNeededAt4USD ? +Math.max(0, hoursNeededAt4USD - currentEstimatedHours).toFixed(2) : null,
          additionalStudentsNeeded: hoursNeededAt4USD && activeStudentsCount > 0
            ? Math.ceil(Math.max(0, hoursNeededAt4USD - currentEstimatedHours) / Math.max(avgHrsPerStudent, 1))
            : null,
          canAffordNow: hoursNeededAt4USD !== null && currentEstimatedHours >= hoursNeededAt4USD
        },

        historicalTrend,
        historicalSummary: {
          totalMonths: historicalFinancials.length,
          avgMonthlyHours: +(allHours.reduce((a, b) => a + b, 0) / allHours.length).toFixed(2),
          avgMonthlyHours3Mo: recentHistorical.length > 0
            ? +(recentHistorical.reduce((sum, h) => sum + h.teachingHours, 0) / recentHistorical.length).toFixed(2)
            : null,
          peakHours: Math.max(...allHours),
          peakHoursMonth: historicalFinancials.find(h => h.teachingHours === Math.max(...allHours))?.month ?? null,
          peakHoursYear: historicalFinancials.find(h => h.teachingHours === Math.max(...allHours))?.year ?? null,
          minHours: Math.min(...allHours),
          avgMonthlyProfit: +(allProfits.reduce((a, b) => a + b, 0) / allProfits.length).toFixed(2),
          avgMonthlyProfit3Mo: recentHistorical.length > 0
            ? +(recentHistorical.reduce((sum, h) => sum + h.netProfitUSD, 0) / recentHistorical.length).toFixed(2)
            : null,
          peakProfit: Math.max(...allProfits),
          avgProfitPercent: +(allProfitPcts.reduce((a, b) => a + b, 0) / allProfitPcts.length).toFixed(1)
        },

        seasonalPatterns,
        campaignProjections
      }
    });
  } catch (error) {
    console.error('[GET /api/analytics/business-intelligence] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get business intelligence data',
      error: error.message
    });
  }
});

module.exports = router;
