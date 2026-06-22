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
        { $match: { status: 'paid', paidDate: { $gte: monthStart, $lt: monthEnd } } },
        { $group: { _id: null, totalRevenue: { $sum: '$total' }, invoiceCount: { $sum: 1 } } }
      ]),
      // Previous month revenue
      Invoice.aggregate([
        { $match: { status: 'paid', paidDate: { $gte: prevMonthStart, $lt: monthStart } } },
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
        { $match: { status: 'paid', paidDate: { $gte: twelveMonthsAgo } } },
        { $group: {
          _id: { year: { $year: '$paidDate' }, month: { $month: '$paidDate' } },
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
        { $match: { status: 'paid', paidDate: { $gte: threeMonthsAgo } } },
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

// ─────────────────────────────────────────────────────────────────────────────
// BI Hub — period-aware, completed-hours-only
// GET /api/analytics/bi-hub?period=thisMonth|prevMonth|ytd|last12months|custom
//   &startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// ─────────────────────────────────────────────────────────────────────────────
router.get('/bi-hub', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { period = 'thisMonth', startDate: qStart, endDate: qEnd } = req.query;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();

    let periodStart, periodEnd, prevStart, prevEnd, periodLabel;
    if (period === 'prevMonth') {
      periodStart = new Date(y, m - 1, 1);
      periodEnd   = new Date(y, m, 1);
      prevStart   = new Date(y, m - 2, 1);
      prevEnd     = new Date(y, m - 1, 1);
      periodLabel = periodStart.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    } else if (period === 'ytd') {
      periodStart = new Date(y, 0, 1);
      periodEnd   = new Date(now.getTime() + 86400000);
      prevStart   = new Date(y - 1, 0, 1);
      prevEnd     = new Date(y - 1, m, now.getDate());
      periodLabel = `YTD ${y}`;
    } else if (period === 'last12months') {
      periodStart = new Date(y - 1, m, 1);
      periodEnd   = new Date(y, m + 1, 1);
      prevStart   = new Date(y - 2, m, 1);
      prevEnd     = new Date(y - 1, m, 1);
      periodLabel = 'Last 12 months';
    } else if (period === 'custom' && qStart && qEnd) {
      periodStart = new Date(qStart);
      periodEnd   = new Date(new Date(qEnd).getTime() + 86400000);
      const span  = periodEnd - periodStart;
      prevStart   = new Date(periodStart - span);
      prevEnd     = new Date(periodStart);
      periodLabel = `${new Date(qStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${new Date(qEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else {
      periodStart = new Date(y, m, 1);
      periodEnd   = new Date(y, m + 1, 1);
      prevStart   = new Date(y, m - 1, 1);
      prevEnd     = new Date(y, m, 1);
      periodLabel = periodStart.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }

    const buildTIMatch = (start, end) => {
      const months = [];
      let d = new Date(start.getFullYear(), start.getMonth(), 1);
      while (d < end) {
        months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      }
      if (!months.length) return null;
      return months.length === 1
        ? { year: months[0].year, month: months[0].month }
        : { $or: months.map(({ year, month }) => ({ year, month })) };
    };

    const COMPLETED  = ['attended', 'completed'];
    const CANCELLED  = ['cancelled_by_teacher', 'cancelled_by_student', 'cancelled_by_guardian', 'cancelled_by_admin', 'cancelled'];
    const histStart  = new Date(y - 1, m, 1);
    const tiCurr     = buildTIMatch(periodStart, periodEnd);
    const tiPrev     = buildTIMatch(prevStart, prevEnd);
    const PAYPAL_PCT = 0.035;
    const MN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const [
      cHoursAgg, cRevenueAgg, cTIAgg,
      cStudentIds, cTeacherIds, cGuardianIds,
      cNewStudents, cCancelledAgg, cTotalAgg,
      pHoursAgg, pRevenueAgg, pTIAgg,
      pStudentIds, pGuardianIds,
      cNewGuardians,
      topGuardRev, topGuardHrs, teacherPerfAgg,
      hist12Hours, hist12Revenue, hist12TI, hist12NewStudents,
      totalStudents, vacResult,
    ] = await Promise.all([
      Class.aggregate([
        { $match: { scheduledDate: { $gte: periodStart, $lt: periodEnd }, status: { $in: COMPLETED } } },
        { $group: { _id: null, min: { $sum: '$duration' }, cnt: { $sum: 1 } } }
      ]),
      Invoice.aggregate([
        { $match: { status: 'paid', paidDate: { $gte: periodStart, $lt: periodEnd } } },
        { $group: { _id: null, total: { $sum: '$total' }, cnt: { $sum: 1 } } }
      ]),
      tiCurr
        ? TeacherInvoice.aggregate([
            { $match: { status: { $in: ['published', 'paid'] }, ...tiCurr } },
            { $group: { _id: null, usd: { $sum: '$totalUSD' }, hrs: { $sum: '$totalHours' } } }
          ])
        : Promise.resolve([]),
      Class.distinct('student.studentId', { scheduledDate: { $gte: periodStart, $lt: periodEnd }, status: { $in: COMPLETED }, 'student.studentId': { $ne: null } }),
      Class.distinct('teacher', { scheduledDate: { $gte: periodStart, $lt: periodEnd }, status: { $in: COMPLETED }, teacher: { $ne: null } }),
      Invoice.distinct('guardian', { status: 'paid', paidDate: { $gte: periodStart, $lt: periodEnd } }),
      Student.countDocuments({ createdAt: { $gte: periodStart, $lt: periodEnd } }),
      Class.aggregate([
        { $match: { scheduledDate: { $gte: periodStart, $lt: periodEnd }, status: { $in: CANCELLED } } },
        { $group: { _id: null, cnt: { $sum: 1 } } }
      ]),
      Class.aggregate([
        { $match: { scheduledDate: { $gte: periodStart, $lt: periodEnd }, status: { $ne: 'pattern' } } },
        { $group: { _id: null, cnt: { $sum: 1 } } }
      ]),
      Class.aggregate([
        { $match: { scheduledDate: { $gte: prevStart, $lt: prevEnd }, status: { $in: COMPLETED } } },
        { $group: { _id: null, min: { $sum: '$duration' }, cnt: { $sum: 1 } } }
      ]),
      Invoice.aggregate([
        { $match: { status: 'paid', paidDate: { $gte: prevStart, $lt: prevEnd } } },
        { $group: { _id: null, total: { $sum: '$total' }, cnt: { $sum: 1 } } }
      ]),
      tiPrev
        ? TeacherInvoice.aggregate([
            { $match: { status: { $in: ['published', 'paid'] }, ...tiPrev } },
            { $group: { _id: null, usd: { $sum: '$totalUSD' }, hrs: { $sum: '$totalHours' } } }
          ])
        : Promise.resolve([]),
      Class.distinct('student.studentId', { scheduledDate: { $gte: prevStart, $lt: prevEnd }, status: { $in: COMPLETED }, 'student.studentId': { $ne: null } }),
      Invoice.distinct('guardian', { status: 'paid', paidDate: { $gte: prevStart, $lt: prevEnd } }),
      User.countDocuments({ role: 'guardian', createdAt: { $gte: periodStart, $lt: periodEnd } }),
      Invoice.aggregate([
        { $match: { status: 'paid', paidDate: { $gte: periodStart, $lt: periodEnd } } },
        { $group: { _id: '$guardian', total: { $sum: '$total' }, cnt: { $sum: 1 } } },
        { $sort: { total: -1 } }, { $limit: 10 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
        { $unwind: { path: '$u', preserveNullAndEmptyArrays: true } },
        { $project: { name: { $trim: { input: { $concat: [{ $ifNull: ['$u.firstName', ''] }, ' ', { $ifNull: ['$u.lastName', ''] }] } } }, total: 1, cnt: 1 } }
      ]),
      Class.aggregate([
        { $match: { scheduledDate: { $gte: periodStart, $lt: periodEnd }, status: { $in: COMPLETED }, 'student.guardianId': { $ne: null } } },
        { $group: { _id: '$student.guardianId', min: { $sum: '$duration' }, cls: { $sum: 1 } } },
        { $sort: { min: -1 } }, { $limit: 10 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
        { $unwind: { path: '$u', preserveNullAndEmptyArrays: true } },
        { $project: { name: { $trim: { input: { $concat: [{ $ifNull: ['$u.firstName', ''] }, ' ', { $ifNull: ['$u.lastName', ''] }] } } }, hours: { $divide: ['$min', 60] }, cls: 1 } }
      ]),
      Class.aggregate([
        { $match: { scheduledDate: { $gte: periodStart, $lt: periodEnd }, status: { $in: COMPLETED }, teacher: { $ne: null } } },
        { $group: { _id: '$teacher', min: { $sum: '$duration' }, cls: { $sum: 1 }, students: { $addToSet: '$student.studentId' } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
        { $unwind: { path: '$u', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'teacherinvoices', let: { tid: '$_id' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$teacher', '$$tid'] }, { $in: ['$status', ['published', 'paid']] }] } } },
            { $sort: { year: -1, month: -1 } }, { $limit: 1 }, { $project: { rateSnapshot: 1 } }
          ], as: 'inv' } },
        { $project: {
          name: { $trim: { input: { $concat: [{ $ifNull: ['$u.firstName', ''] }, ' ', { $ifNull: ['$u.lastName', ''] }] } } },
          hours: { $divide: ['$min', 60] }, cls: 1,
          studentCnt: { $size: '$students' }, rate: { $arrayElemAt: ['$inv.rateSnapshot.rate', 0] }
        }},
        { $sort: { hours: -1 } }
      ]),
      Class.aggregate([
        { $match: { scheduledDate: { $gte: histStart }, status: { $in: COMPLETED } } },
        { $group: {
          _id: { y: { $year: '$scheduledDate' }, m: { $month: '$scheduledDate' } },
          min: { $sum: '$duration' }, cls: { $sum: 1 },
          students: { $addToSet: '$student.studentId' }, teachers: { $addToSet: '$teacher' }
        }},
        { $sort: { '_id.y': 1, '_id.m': 1 } }
      ]),
      Invoice.aggregate([
        { $match: { status: 'paid', paidDate: { $gte: histStart } } },
        { $group: {
          _id: { y: { $year: '$paidDate' }, m: { $month: '$paidDate' } },
          total: { $sum: '$total' }, guardians: { $addToSet: '$guardian' }
        }},
        { $sort: { '_id.y': 1, '_id.m': 1 } }
      ]),
      TeacherInvoice.aggregate([
        { $match: { status: { $in: ['published', 'paid'] }, year: { $gte: histStart.getFullYear() } } },
        { $group: { _id: { y: '$year', m: '$month' }, usd: { $sum: '$totalUSD' }, hrs: { $sum: '$totalHours' } } },
        { $sort: { '_id.y': 1, '_id.m': 1 } }
      ]),
      Student.aggregate([
        { $match: { createdAt: { $gte: histStart } } },
        { $group: { _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } }, cnt: { $sum: 1 } } },
        { $sort: { '_id.y': 1, '_id.m': 1 } }
      ]),
      Student.countDocuments({ isActive: true }),
      (async () => {
        try {
          const Vacation = require('../models/Vacation');
          const [s, g] = await Promise.all([
            Vacation.countDocuments({ lifecycleStatus: 'approved', startDate: { $lte: now }, endDate: { $gte: now } }),
            Vacation.countDocuments({ lifecycleStatus: 'approved', startDate: { $lte: now }, endDate: { $gte: now } })
          ]);
          return { students: s, guardians: g };
        } catch { return { students: 0, guardians: 0 }; }
      })(),
    ]);

    const hrs  = (cHoursAgg[0]?.min || 0) / 60;
    const rev  = cRevenueAgg[0]?.total || 0;
    const tSal = cTIAgg[0]?.usd || 0;
    const pp   = rev * PAYPAL_PCT;
    const gp   = rev - tSal - pp;
    const rph  = hrs > 0 ? rev / hrs : 0;
    const tcph = hrs > 0 ? tSal / hrs : 0;
    const pph  = hrs > 0 ? gp / hrs : 0;
    const completedCnt = cHoursAgg[0]?.cnt || 0;
    const cancelledCnt = cCancelledAgg[0]?.cnt || 0;
    const totalCnt     = cTotalAgg[0]?.cnt || 0;
    const pHrs  = (pHoursAgg[0]?.min || 0) / 60;
    const pRev  = pRevenueAgg[0]?.total || 0;
    const pSal  = pTIAgg[0]?.usd || 0;
    const pGP   = pRev - pSal - pRev * PAYPAL_PCT;

    const activeStuSet  = new Set(cStudentIds.map(String));
    const prevStuSet    = new Set(pStudentIds.map(String));
    const activeGrdSet  = new Set(cGuardianIds.map(String));
    const prevGrdSet    = new Set(pGuardianIds.map(String));
    const activeStuCnt  = activeStuSet.size;
    const prevStuCnt    = prevStuSet.size;
    const activeGrdCnt  = activeGrdSet.size;
    const prevGrdCnt    = prevGrdSet.size;
    const activeTeachCnt= cTeacherIds.length;
    const lostStudents  = [...prevStuSet].filter(id => !activeStuSet.has(id)).length;
    const lostGuardians = [...prevGrdSet].filter(id => !activeGrdSet.has(id)).length;
    const stuRetention  = prevStuCnt > 0 ? ((prevStuCnt - lostStudents) / prevStuCnt) * 100 : 100;
    const grdRetention  = prevGrdCnt > 0 ? ((prevGrdCnt - lostGuardians) / prevGrdCnt) * 100 : 100;
    const attRate       = (completedCnt + cancelledCnt) > 0 ? (completedCnt / (completedCnt + cancelledCnt)) * 100 : 0;
    const cancRate      = totalCnt > 0 ? (cancelledCnt / totalCnt) * 100 : 0;
    const ttlTeachHrs   = teacherPerfAgg.reduce((s, t) => s + (t.hours || 0), 0);
    const avgTeachHrs   = activeTeachCnt > 0 ? ttlTeachHrs / activeTeachCnt : 0;
    const teachRates    = teacherPerfAgg.map(t => t.rate).filter(r => r != null);
    const avgRate       = teachRates.length > 0 ? teachRates.reduce((a, b) => a + b, 0) / teachRates.length : 0;

    const hmap = {};
    hist12Hours.forEach(r => {
      const k = `${r._id.y}-${String(r._id.m).padStart(2, '0')}`;
      hmap[k] = { year: r._id.y, month: r._id.m, period: k, completedHours: +(r.min / 60).toFixed(2), classes: r.cls, activeStudents: r.students.length, activeTeachers: r.teachers.length };
    });
    hist12Revenue.forEach(r => {
      const k = `${r._id.y}-${String(r._id.m).padStart(2, '0')}`;
      if (hmap[k]) { hmap[k].revenue = +(r.total || 0).toFixed(2); hmap[k].activeGuardians = r.guardians.length; }
    });
    hist12TI.forEach(r => {
      const k = `${r._id.y}-${String(r._id.m).padStart(2, '0')}`;
      if (hmap[k]) hmap[k].teacherCost = +(r.usd || 0).toFixed(2);
    });
    hist12NewStudents.forEach(r => {
      const k = `${r._id.y}-${String(r._id.m).padStart(2, '0')}`;
      if (hmap[k]) hmap[k].newStudents = r.cnt;
    });
    const monthlyHistory = Object.values(hmap).sort((a, b) => a.period.localeCompare(b.period)).map(mo => {
      const r = mo.revenue || 0, tc = mo.teacherCost || 0, h = mo.completedHours || 0;
      const pp2 = r * PAYPAL_PCT, gp2 = r - tc - pp2;
      return { ...mo, label: `${MN[mo.month] || mo.month} ${mo.year}`,
        paypalFees: +pp2.toFixed(2), grossProfit: +gp2.toFixed(2),
        revenuePerHour: h > 0 ? +(r / h).toFixed(2) : 0, profitPerHour: h > 0 ? +(gp2 / h).toFixed(2) : 0,
        avgStudentHours: mo.activeStudents > 0 ? +(h / mo.activeStudents).toFixed(2) : 0 };
    });

    const last2 = monthlyHistory.slice(-2);
    const last3 = monthlyHistory.slice(-3);
    const prev3 = monthlyHistory.slice(-6, -3);
    const delt  = (a, b) => (b && b !== 0) ? +((a - b) / Math.abs(b) * 100).toFixed(1) : null;
    const roll  = arr => arr.reduce((s, m) => s + m, 0) / Math.max(arr.length, 1);
    const growthData = {
      hoursGrowthMoM:   last2.length === 2 ? delt(last2[1].completedHours, last2[0].completedHours) : null,
      revenueGrowthMoM: last2.length === 2 ? delt(last2[1].revenue || 0, last2[0].revenue || 0) : null,
      profitGrowthMoM:  last2.length === 2 ? delt(last2[1].grossProfit, last2[0].grossProfit) : null,
      rolling3MonthRevenue: last3.length > 0 ? +roll(last3.map(m => m.revenue || 0)).toFixed(2) : 0,
      rolling3MonthGrowth:  prev3.length > 0 ? delt(roll(last3.map(m => m.revenue || 0)), roll(prev3.map(m => m.revenue || 0))) : null,
      rolling12MonthHours: +monthlyHistory.reduce((s, m) => s + m.completedHours, 0).toFixed(2),
      newStudents: cNewStudents, newGuardians: cNewGuardians,
      studentGrowthRate: totalStudents > 0 ? +(cNewStudents / totalStudents * 100).toFixed(1) : 0,
    };

    const sHours   = pHrs > 0 ? Math.min(100, Math.max(0, (hrs / pHrs) * 100)) : (hrs > 0 ? 60 : 0);
    const sRevenue = pRev > 0 ? Math.min(100, Math.max(0, (rev / pRev) * 100)) : (rev > 0 ? 60 : 0);
    const sProfit  = rev > 0 ? Math.min(100, Math.max(0, (gp / rev) * 250)) : 0;
    const sRetain  = Math.min(100, Math.max(0, stuRetention));
    const sGrowth  = Math.min(100, Math.max(0, cNewStudents > lostStudents ? 50 + (cNewStudents - lostStudents) * 10 : Math.max(0, 50 - lostStudents * 5)));
    const sOverall = +((sHours + sRevenue + sProfit + sRetain + sGrowth) / 5).toFixed(0);

    res.json({ success: true, data: {
      periodLabel,
      period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
      prevPeriod: { start: prevStart.toISOString(), end: prevEnd.toISOString() },
      paypalRate: PAYPAL_PCT,
      critical: {
        completedHours: +hrs.toFixed(2), revenue: +rev.toFixed(2),
        teacherSalaries: +tSal.toFixed(2), paypalFees: +pp.toFixed(2), grossProfit: +gp.toFixed(2),
        activePayingGuardians: activeGrdCnt, activeStudents: activeStuCnt, activeTeachers: activeTeachCnt,
        revenuePerHour: +rph.toFixed(2), teacherCostPerHour: +tcph.toFixed(2), profitPerHour: +pph.toFixed(2),
        completedClasses: completedCnt, cancelledClasses: cancelledCnt, totalClasses: totalCnt,
        prev: {
          completedHours: +pHrs.toFixed(2), revenue: +pRev.toFixed(2),
          teacherSalaries: +pSal.toFixed(2), grossProfit: +pGP.toFixed(2),
          activeStudents: prevStuCnt, activePayingGuardians: prevGrdCnt,
        }
      },
      studentHealth: {
        activeStudents: activeStuCnt, newStudents: cNewStudents, lostStudents,
        retentionRate: +stuRetention.toFixed(1),
        avgHoursPerStudent: activeStuCnt > 0 ? +(hrs / activeStuCnt).toFixed(2) : 0,
        revenuePerStudent: activeStuCnt > 0 ? +(rev / activeStuCnt).toFixed(2) : 0,
        grossProfitPerStudent: activeStuCnt > 0 ? +(gp / activeStuCnt).toFixed(2) : 0,
        attendanceRate: +attRate.toFixed(1), cancellationRate: +cancRate.toFixed(1),
        totalClasses: totalCnt, completedClasses: completedCnt, cancelledClasses: cancelledCnt,
      },
      guardianHealth: {
        activePayingGuardians: activeGrdCnt, newGuardians: cNewGuardians, lostGuardians,
        avgRevenuePerGuardian: activeGrdCnt > 0 ? +(rev / activeGrdCnt).toFixed(2) : 0,
        avgHoursPerGuardian: activeGrdCnt > 0 ? +(hrs / activeGrdCnt).toFixed(2) : 0,
        retentionRate: +grdRetention.toFixed(1),
        topByRevenue: topGuardRev.map(g => ({ name: String(g.name || '').trim() || 'Unknown', revenue: +(g.total || 0).toFixed(2), invoices: g.cnt || 0 })),
        topByHours: topGuardHrs.map(g => ({ name: String(g.name || '').trim() || 'Unknown', hours: +(g.hours || 0).toFixed(2), classes: g.cls || 0 })),
        onVacation: (vacResult.students || 0) + (vacResult.guardians || 0),
        guardiansOnVacation: vacResult.guardians || 0, studentsOnVacation: vacResult.students || 0,
      },
      teacherPerformance: {
        activeTeachers: activeTeachCnt, totalTeacherHours: +ttlTeachHrs.toFixed(2),
        avgTeacherHours: +avgTeachHrs.toFixed(2), avgHourlyRate: +avgRate.toFixed(2),
        salaryCost: +tSal.toFixed(2), costPerTeachingHour: +tcph.toFixed(2),
        teachers: teacherPerfAgg.map(t => ({
          name: String(t.name || '').trim() || 'Unknown',
          hours: +(t.hours || 0).toFixed(2), classes: t.cls || 0, studentCount: t.studentCnt || 0,
          rateUSD: t.rate != null ? +Number(t.rate).toFixed(2) : null,
          estimatedCost: t.rate != null ? +((t.hours || 0) * t.rate).toFixed(2) : null,
        })).sort((a, b) => b.hours - a.hours),
      },
      financial: {
        revenue: +rev.toFixed(2), teacherSalaries: +tSal.toFixed(2), paypalFees: +pp.toFixed(2),
        grossProfit: +gp.toFixed(2), grossMargin: rev > 0 ? +((gp / rev) * 100).toFixed(1) : 0,
        revenueGrowth: delt(rev, pRev), profitGrowth: pGP !== 0 ? delt(gp, pGP) : null,
        revenuePerHour: +rph.toFixed(2), profitPerHour: +pph.toFixed(2),
        prevRevenue: +pRev.toFixed(2), prevGrossProfit: +pGP.toFixed(2),
      },
      vacationAnalytics: { studentsOnVacation: vacResult.students || 0, guardiansOnVacation: vacResult.guardians || 0 },
      growth: growthData,
      monthlyHistory,
      scoreboard: { hours: +sHours.toFixed(0), revenue: +sRevenue.toFixed(0), profit: +sProfit.toFixed(0), retention: +sRetain.toFixed(0), growth: +sGrowth.toFixed(0), overall: sOverall }
    }});
  } catch (error) {
    console.error('[GET /api/analytics/bi-hub] Error:', error);
    res.status(500).json({ success: false, message: 'Failed to get BI hub data', error: error.message });
  }
});
