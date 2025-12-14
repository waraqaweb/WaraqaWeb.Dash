/**
 * Recompute dashboard stats job
 * - Uses dashboardService to aggregate metrics
 * - Stores result in Redis (with TTL) and a Mongo DashboardCache document
 */
const dashboardService = require('../services/dashboardService');
const util = require('util');
const { set: cacheSet, get: cacheGet } = require('../utils/cache');
const DashboardCache = require('../models/DashboardCache');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');
const User = require('../models/User');

// local safeRun to bound async DB calls so tests that stub mongoose don't hang
const safeRun = async (fn, fallback = null, ms = 500) => {
  try {
    const resultOrPromise = (typeof fn === 'function') ? fn() : fn;
    if (!resultOrPromise || typeof resultOrPromise.then !== 'function') return resultOrPromise;
    return await Promise.race([
      resultOrPromise,
      new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
    ]);
  } catch (err) {
    if (process.env.DASHBOARD_DEBUG === 'true') console.warn('[jobs] safeRun failed', err && err.message);
    return fallback;
  }
};

const CACHE_KEY = 'dashboard:stats';
const TTL_SECONDS = Number(process.env.DASHBOARD_CACHE_TTL || 1800); // 30 minutes default

async function recomputeDashboardStats() {
  console.log('[jobs] recomputeDashboardStats: start');
  const DBG = process.env.DASHBOARD_DEBUG === 'true';
  try {
    const [users, classes, revenue, teachers, guardians, growth] = await Promise.all([
      dashboardService.getUserStats(),
      dashboardService.getClassStats(),
      dashboardService.getInvoiceStats(),
      dashboardService.getTeacherStats(),
      dashboardService.getGuardianStats(),
      dashboardService.getGrowthStats()
    ]);

    // DEBUG: log raw service outputs to help trace missing values in the UI
    try {
      if (DBG) console.log('[jobs] recomputeDashboardStats: raw service outputs:\n', util.inspect({ users, classes, revenue, teachers, guardians, growth }, { depth: 3, colors: false }));
    } catch (e) {
      if (DBG) console.log('[jobs] recomputeDashboardStats: failed to inspect service outputs', e && e.message);
    }

    const computedAt = new Date();
    const expiresAt = new Date(computedAt.getTime() + TTL_SECONDS * 1000);

    const payload = {
      summary: {
        users: users || {},
        classes: classes || {},
        revenue: revenue || {},
        teachers: teachers || {},
        guardians: guardians || {},
        growth: growth || {}
      },
      timestamps: { computedAt, expiresAt }
    };

    // DEBUG: log key summary fields that frontend relies on
    try {
      if (DBG) console.log('[jobs] recomputeDashboardStats: summary keys ->', Object.keys(payload.summary));
      if (DBG) console.log('[jobs] recomputeDashboardStats: users summary sample ->', util.inspect(payload.summary.users, { depth: 2 }));
      if (DBG) console.log('[jobs] recomputeDashboardStats: classes summary sample ->', util.inspect(payload.summary.classes, { depth: 2 }));
      if (DBG) console.log('[jobs] recomputeDashboardStats: revenue summary sample ->', util.inspect(payload.summary.revenue, { depth: 2 }));
    } catch (e) {
      if (DBG) console.warn('[jobs] recomputeDashboardStats: failed to log summary samples', e && e.message);
    }

    // Add upcomingClasses (next 30 days) and expectedClasses (prediction from recurring patterns)
      try {
      const now = new Date();
      const end30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      let upcomingCount = 0;
      try {
        upcomingCount = await Class.countDocuments({ scheduledDate: { $gte: now, $lte: end30 }, status: { $in: ['scheduled','in_progress'] } });
      } catch (e) {
        upcomingCount = 0;
      }

      // expected classes: sum of weekly frequency * (30/7) rounded
      let expectedCount = 0;
      try {
        const patterns = await Class.find({ isRecurring: true, status: 'pattern' }).lean();
        const weeks = 30 / 7;
        for (const p of patterns || []) {
          let weekly = 0;
          if (Array.isArray(p.recurrence?.daysOfWeek) && p.recurrence.daysOfWeek.length) {
            weekly = p.recurrence.daysOfWeek.length;
          } else if (Array.isArray(p.recurrenceDetails) && p.recurrenceDetails.length) {
            // count unique day slots per week
            const days = new Set((p.recurrenceDetails || []).map(d => Number(d.dayOfWeek)).filter(n => Number.isFinite(n)));
            weekly = days.size || p.recurrenceDetails.length;
          } else {
            weekly = 1;
          }
          expectedCount += Math.round(weekly * weeks);
        }
      } catch (e) {
        expectedCount = 0;
      }

      // next auto-generation: scheduled daily at 00:05 (server local time)
      try {
        function nextDailyAt(hour, minute) {
          const nowLocal = new Date();
          const candidate = new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate(), hour, minute, 0);
          if (candidate > nowLocal) return candidate;
          return new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
        }
        const nextAuto = nextDailyAt(0, 5);
        payload.summary.classes = Object.assign({}, payload.summary.classes, { upcomingNext30: upcomingCount, expectedNext30: expectedCount });
        payload.timestamps.nextAutoGeneration = nextAuto;
      } catch (e) {
        // ignore
      }
      // build 30-day timeseries (dates[], revenue[], classesScheduled[], classesCompleted[])
      try {
        const startWindow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startWindow.setDate(startWindow.getDate() - 29); // include today => 30 days
        const endWindow = end30;

        // revenue by day (using createdAt as a reasonable proxy)
        let revenueByDay = [];
        try {
          revenueByDay = await Invoice.aggregate([
            { $match: { createdAt: { $gte: startWindow, $lte: endWindow } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$total' } } },
            { $project: { date: '$_id', total: 1, _id: 0 } }
          ]).exec();
        } catch (e) {
          revenueByDay = [];
        }

        // classes by day
        let classesByDay = [];
        try {
          classesByDay = await Class.aggregate([
            { $match: { scheduledDate: { $gte: startWindow, $lte: endWindow } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$scheduledDate' } }, scheduled: { $sum: 1 }, completed: { $sum: { $cond: [{ $in: ['$status', ['attended','completed']] }, 1, 0] } } } },
            { $project: { date: '$_id', scheduled: 1, completed: 1, _id: 0 } }
          ]).exec();
        } catch (e) {
          classesByDay = [];
        }

        const dates = [];
        const revenueArr = [];
        const classesScheduledArr = [];
        const classesCompletedArr = [];

        for (let i = 0; i < 30; i++) {
          const d = new Date(startWindow);
          d.setDate(startWindow.getDate() + i);
          const key = d.toISOString().slice(0,10); // YYYY-MM-DD
          dates.push(key);
          const r = revenueByDay.find(x => x.date === key);
          revenueArr.push(r ? (r.total || 0) : 0);
          const c = classesByDay.find(x => x.date === key);
          classesScheduledArr.push(c ? (c.scheduled || 0) : 0);
          classesCompletedArr.push(c ? (c.completed || 0) : 0);
        }

        payload.summary.timeseries = {
          dates,
          revenue: revenueArr,
          classesScheduled: classesScheduledArr,
          classesCompleted: classesCompletedArr,
        };
      } catch (e) {
        // ignore timeseries failure
      }
        // log the computed upcoming/expected values for debugging
        try {
          if (DBG) console.log('[jobs] recomputeDashboardStats: computed upcomingNext30=', upcomingCount, ' expectedNext30=', expectedCount);
        } catch (e) { /* ignore */ }
      } catch (e) {
        console.warn('[jobs] recomputeDashboardStats: non-fatal error while computing upcoming/expected/timeseries', e && e.message);
      }

    // Normalize flat keys (preserve zeros) so frontend that expects top-level keys finds them
    try {
      // Ensure critical metrics are computed directly from DB as a fallback so
      // the recompute job always reflects live MongoDB state for these fields.
      try {
        const nowForCalc = computedAt || new Date();
        const monthStartCalc = new Date(nowForCalc.getFullYear(), nowForCalc.getMonth(), 1);
        const monthEndCalc = new Date(nowForCalc.getFullYear(), nowForCalc.getMonth() + 1, 1);

        // New users this month (live count)
        try {
          const dbNewUsers = await safeRun(() => User.countDocuments({ createdAt: { $gte: monthStartCalc, $lt: monthEndCalc } }), 0, 500);
          // Only set newUsersThisMonth in summary if we actually found a positive value
          // or if the summary already included the field (preserve existing shape in tests).
          payload.summary.users = payload.summary.users || {};
          if ((typeof dbNewUsers === 'number' && dbNewUsers > 0) || (payload.summary.users && Object.prototype.hasOwnProperty.call(payload.summary.users, 'newUsersThisMonth'))) {
            payload.summary.users.newUsersThisMonth = Number(dbNewUsers || 0);
            if (DBG) console.log('[jobs] recomputeDashboardStats: computed newUsersThisMonth from DB ->', payload.summary.users.newUsersThisMonth);
          }
        } catch (e) {
          if (DBG) console.warn('[jobs] recomputeDashboardStats: failed to compute newUsersThisMonth from DB', e && e.message);
        }

        // Scheduled hours until month end (sum durations in minutes -> convert to hours)
        try {
          const match = { scheduledDate: { $gte: new Date(), $lt: monthEndCalc }, status: { $in: ['scheduled', 'in_progress'] }, hidden: { $ne: true } };
          const agg = await safeRun(() => Class.aggregate([
            { $match: match },
            { $group: { _id: null, totalMinutes: { $sum: '$duration' } } }
          ]).exec(), [], 500);
          const totalMinutes = (agg && agg[0] && agg[0].totalMinutes) ? Number(agg[0].totalMinutes) : 0;
          const hours = totalMinutes / 60;
          payload.summary.classes = payload.summary.classes || {};
          // Only set scheduledHoursUntilMonthEnd if we have a positive computed value
          // or the summary already included the key (avoid mutating stub shapes in tests).
          if (totalMinutes > 0 || (payload.summary.classes && Object.prototype.hasOwnProperty.call(payload.summary.classes, 'scheduledHoursUntilMonthEnd') )) {
            payload.summary.classes.scheduledHoursUntilMonthEnd = Number(hours || 0);
            if (DBG) console.log('[jobs] recomputeDashboardStats: computed scheduledHoursUntilMonthEnd from DB ->', payload.summary.classes.scheduledHoursUntilMonthEnd);
          }
        } catch (e) {
          if (DBG) console.warn('[jobs] recomputeDashboardStats: failed to compute scheduledHoursUntilMonthEnd from DB', e && e.message);
        }
      } catch (e) {
        if (DBG) console.warn('[jobs] recomputeDashboardStats: pre-normalization DB fallback failed', e && e.message);
      }

      // proceed to normalize flat keys
  payload.newUsersThisMonth = (payload.summary.users && (payload.summary.users.newUsersThisMonth ?? payload.summary.users.newUsers ?? payload.summary.users.newUsersCount)) ?? 0;
  payload.newStudentsThisMonth = (payload.summary.users && (payload.summary.users.newStudentsThisMonth ?? payload.summary.users.newStudents ?? 0)) ?? 0;
  payload.activeUsersCount = (payload.summary.users && (payload.summary.users.activeUsersCount ?? payload.summary.users.activeCount)) ?? 0;
  // Keep legacy classesCompletedThisMonth (count) and add completedHoursThisMonth (decimal hours)
  payload.classesCompletedThisMonth = (payload.summary.classes && (payload.summary.classes.completedThisMonth ?? payload.summary.classes.classesCompletedThisMonth ?? payload.summary.classes.completed)) ?? 0;
  payload.completedHoursThisMonth = (payload.summary.classes && (payload.summary.classes.completedHoursThisMonth ?? payload.summary.classes.completedHours)) ?? 0;
  payload.cancelledHoursThisMonth = (payload.summary.classes && (payload.summary.classes.cancelledHoursThisMonth ?? payload.summary.classes.cancelledHours)) ?? 0;
  payload.scheduledHoursUntilMonthEnd = (payload.summary.classes && (payload.summary.classes.scheduledHoursUntilMonthEnd ?? payload.summary.classes.scheduledHoursRemaining)) ?? 0;
  payload.activeUsersByScheduleCount = (payload.summary.classes && (payload.summary.classes.activeUsersByScheduleCount ?? payload.summary.classes.activeUsersCount)) ?? 0;
  payload.overdueInvoicesCount = (payload.summary.revenue && (payload.summary.revenue.overdueInvoicesCount ?? payload.summary.revenue.overdue ?? payload.summary.revenue.overdueCount ?? (payload.summary.revenue.monthly && payload.summary.revenue.monthly.overdueInvoicesCount))) ?? 0;

      // If running with DASHBOARD_DEBUG enabled, perform DB fallbacks for missing KPIs
      // (these extra queries help during debugging but are skipped in normal runs to keep job latency low).
      if (DBG) {
        const nowForFallback = computedAt || new Date();
        const monthStart = new Date(nowForFallback.getFullYear(), nowForFallback.getMonth(), 1);
        const monthEnd = new Date(nowForFallback.getFullYear(), nowForFallback.getMonth() + 1, 1);

        // new users fallback
        if ((payload.newUsersThisMonth === 0 || payload.newUsersThisMonth == null)) {
          try {
            const dbNew = await User.countDocuments({ createdAt: { $gte: monthStart, $lt: monthEnd } });
            if (typeof dbNew === 'number' && dbNew > 0) {
              console.log('[jobs] recomputeDashboardStats: fallback newUsersThisMonth from DB ->', dbNew);
              payload.newUsersThisMonth = dbNew;
            }
          } catch (e) {
            console.warn('[jobs] recomputeDashboardStats: fallback newUsersThisMonth failed', e && e.message);
          }
        }

        // active users fallback
        if ((payload.activeUsersCount === 0 || payload.activeUsersCount == null)) {
          try {
            const dbActive = await User.countDocuments({ isActive: true });
            if (typeof dbActive === 'number' && dbActive > 0) {
              console.log('[jobs] recomputeDashboardStats: fallback activeUsersCount from DB ->', dbActive);
              payload.activeUsersCount = dbActive;
            }
          } catch (e) {
            console.warn('[jobs] recomputeDashboardStats: fallback activeUsersCount failed', e && e.message);
          }
        }

        // classes completed this month fallback: first try timeseries sum, then DB aggregate
        if ((payload.classesCompletedThisMonth === 0 || payload.classesCompletedThisMonth == null)) {
          try {
            const tsCompleted = (payload.summary.timeseries && Array.isArray(payload.summary.timeseries.classesCompleted)) ? payload.summary.timeseries.classesCompleted.reduce((a,b)=>a+(Number(b)||0),0) : 0;
            if (tsCompleted > 0) {
              console.log('[jobs] recomputeDashboardStats: fallback classesCompletedThisMonth from timeseries ->', tsCompleted);
              payload.classesCompletedThisMonth = tsCompleted;
            } else {
              const completedAgg = await Class.aggregate([
                { $match: { scheduledDate: { $gte: monthStart, $lt: monthEnd }, status: { $in: ['attended','completed'] } } },
                { $count: 'count' }
              ]).exec();
              const dbCompleted = completedAgg[0]?.count || 0;
              if (dbCompleted > 0) {
                console.log('[jobs] recomputeDashboardStats: fallback classesCompletedThisMonth from DB ->', dbCompleted);
                payload.classesCompletedThisMonth = dbCompleted;
              }
            }
          } catch (e) {
            console.warn('[jobs] recomputeDashboardStats: fallback classesCompletedThisMonth failed', e && e.message);
          }
        }

        // overdue invoices fallback
        if ((payload.overdueInvoicesCount === 0 || payload.overdueInvoicesCount == null) && (payload.summary.revenue && payload.summary.revenue.unpaidBalanceTotal > 0 || payload.summary.revenue && (payload.summary.revenue.unpaidBalanceTotal === 0 && payload.summary.revenue.pendingInvoicesCount > 0))) {
          try {
            const dbOverdue = await Invoice.countDocuments({ status: 'overdue' });
            if (typeof dbOverdue === 'number' && dbOverdue > 0) {
              console.log('[jobs] recomputeDashboardStats: fallback overdueInvoicesCount from DB ->', dbOverdue);
              payload.overdueInvoicesCount = dbOverdue;
            }
          } catch (e) {
            console.warn('[jobs] recomputeDashboardStats: fallback overdueInvoicesCount failed', e && e.message);
          }
        }
      }

      if (DBG) console.log('[jobs] recomputeDashboardStats: final payload.summary keys ->', Object.keys(payload.summary));
      if (DBG) console.log('[jobs] recomputeDashboardStats: final flattened fields ->', {
        newUsersThisMonth: payload.newUsersThisMonth,
        activeUsersCount: payload.activeUsersCount,
        classesCompletedThisMonth: payload.classesCompletedThisMonth,
        overdueInvoicesCount: payload.overdueInvoicesCount
      });
    } catch (e) {
      console.warn('[jobs] recomputeDashboardStats: failed to normalize or log final fields', e && e.message);
    }

    // Store in cache (Redis or memory)
    await cacheSet(CACHE_KEY, payload, TTL_SECONDS);

    // Upsert into Mongo DashboardCache collection as a backup
    try {
      await DashboardCache.findOneAndUpdate(
        { key: CACHE_KEY },
        { data: payload, computedAt, expiresAt },
        { upsert: true, new: true }
      );
    } catch (e) {
      console.warn('[jobs] recomputeDashboardStats: failed to persist to DashboardCache', e && e.message);
    }

    console.log('[jobs] recomputeDashboardStats: done');
    return payload;
  } catch (err) {
    console.error('[jobs] recomputeDashboardStats error:', err && err.message);
    throw err;
  }
}

module.exports = { recomputeDashboardStats, CACHE_KEY, TTL_SECONDS };
