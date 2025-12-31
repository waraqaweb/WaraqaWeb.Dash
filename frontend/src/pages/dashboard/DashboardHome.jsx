// frontend/src/components/dashboard/DashboardHome.jsx
import React, { useState, useEffect } from "react";
import { formatDateDDMMMYYYY } from '../../utils/date';
import api from '../../api/axios';
import { useAuth } from "../../contexts/AuthContext";
import { useNavigate, useLocation } from 'react-router-dom';
import useFeedbackPrompts from '../../hooks/useFeedbackPrompts';
import FirstClassFeedbackModal from '../../components/feedback/FirstClassFeedbackModal';
import MonthlyFeedbackModal from '../../components/feedback/MonthlyFeedbackModal';
import GuardianFollowUpModal from '../../components/meetings/GuardianFollowUpModal';
import TeacherSyncModal from '../../components/meetings/TeacherSyncModal';
import Toast from '../../components/ui/Toast';
import {
  Users,
  Calendar,
  DollarSign,
  Clock,
  AlertCircle,
  CheckCircle,
} from "lucide-react";

import StatCard from '../../components/dashboard/widgets/StatCard';
import NextClassCard from '../../components/dashboard/widgets/NextClassCard';
import PendingReportsList from '../../components/dashboard/widgets/PendingReportsList';
import FirstClassReminder from '../../components/dashboard/widgets/FirstClassReminder';
import DashboardChartCard from '../../components/dashboard/widgets/DashboardChartCard';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
} from 'recharts';

const formatClassDate = (d) => {
  if (!d) return '—';
  const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '—';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekday = days[date.getDay()];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  let hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${weekday}, ${day} ${month} ${year} ${hour}:${minute} ${ampm}`;
};

/**
 * DashboardHome
 * - One file containing Admin / Teacher / Guardian / Student dashboards
 */

const DashboardHome = () => {
  const { user, isAdmin, isTeacher, isGuardian, isStudent } = useAuth();
  const [compactAdmin, setCompactAdmin] = React.useState(false);

  const userRole = user?.role;

  // --- UI / data state
  const [stats, setStats] = useState({ loading: true, data: {}, role: null, error: null });

  // Fetch real dashboard stats from the server (extracted so we can retry)
  const fetchStats = React.useCallback(async () => {
    let mounted = true;
    setStats((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api.get('/dashboard/stats');
      const payload = res.data;
      if (!mounted) return;
      if (!payload) {
        setStats({ loading: false, data: {}, role: null, error: 'No data' });
        return;
      }
      // payload shape: { success: true, role: 'teacher', stats: { ... } }
      const role = payload.role ?? userRole ?? null;
      const data = payload.stats || payload;
      const cached = payload.cached ?? false;
      setStats({ loading: false, data, role, error: null, cached });
    } catch (err) {
      console.error('Failed to load dashboard stats', err);
      setStats({ loading: false, data: {}, role: null, error: err?.message || 'Failed to load' });
    }
    return () => { mounted = false; };
  }, [userRole]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Refresh dashboard stats when other screens (e.g., Class Report modal) signal an update
  useEffect(() => {
    const handler = () => {
      try { fetchStats(); } catch (e) {}
    };
    window.addEventListener('waraqa:dashboard-stats-refresh', handler);
    return () => window.removeEventListener('waraqa:dashboard-stats-refresh', handler);
  }, [fetchStats]);

  // Debug: help trace why student names might be missing on dashboard views
  useEffect(() => {
    if (stats.loading) return;
    try {
      const data = stats.data || {};
      const roleLabel = (stats.role || userRole || 'unknown');
      // Candidate student collections used in dashboard cards by role
      const candidates = [];
      if (isGuardian && typeof isGuardian === 'function' && isGuardian()) {
        if (Array.isArray(data.myChildren)) candidates.push(['myChildren', data.myChildren]);
        if (Array.isArray(data.pendingFirstClassStudents)) candidates.push(['pendingFirstClassStudents', data.pendingFirstClassStudents]);
      }
      if (isTeacher && typeof isTeacher === 'function' && isTeacher()) {
        if (Array.isArray(data.pendingFirstClassStudents)) candidates.push(['pendingFirstClassStudents', data.pendingFirstClassStudents]);
        if (Array.isArray(data.students)) candidates.push(['students', data.students]);
      }

      if (candidates.length === 0) return; // nothing to inspect for this role

      console.groupCollapsed('[Dashboard] Student name diagnostics');
      console.log('Role:', roleLabel);
      candidates.forEach(([label, arr]) => {
        const total = arr.length;
        const missing = arr.filter(s => !s || !(s.firstName || '').trim() || !(s.lastName || '').trim());
        const summary = {
          label,
          total,
          missingCount: missing.length,
          examplesMissing: missing.slice(0, 3).map(s => ({ id: s?._id || s?.id, firstName: s?.firstName, lastName: s?.lastName, guardianId: s?.studentInfo?.guardianId || s?.guardianId, guardianName: s?.guardianName }))
        };
        console.log('Collection:', summary);
      });
      console.groupEnd();
    } catch (e) {
      // keep the UI safe; this is just diagnostics
      console.warn('[Dashboard] Student name diagnostics failed:', e?.message || e);
    }
  }, [stats, isGuardian, isTeacher, userRole]);

  const navigate = useNavigate();
  const location = useLocation();

  // --- Greeting: compute a warm, contextual greeting based on lastLogin
  const nowForGreeting = new Date();
  const lastLoginGlobal = user?.lastLogin ? new Date(user.lastLogin) : null;
  let greetingTitle = `Assalamu Alaykum${user?.firstName ? `, ${user.firstName}` : ''}!`;
  let greetingSubtitle = '';
  if (!lastLoginGlobal) {
    // First-time or missing lastLogin: friendly onboarding message
    greetingTitle = `Assalamu Alaykum${user?.firstName ? `, ${user.firstName}` : ''}!`;
    greetingSubtitle = `Welcome — we're glad you're here. Start by adding a student or scheduling a class.`;
  } else {
    const diffMsG = nowForGreeting - lastLoginGlobal;
    const diffDaysG = Math.floor(diffMsG / (1000 * 60 * 60 * 24));
    if (diffDaysG === 0) {
      greetingTitle = `Assalamu Alaykum${user?.firstName ? `, ${user.firstName}` : ''}!`;
      greetingSubtitle = `Great to see you today — here's a quick summary since your last visit.`;
    } else if (diffDaysG <= 3) {
      greetingTitle = `Welcome back${user?.firstName ? `, ${user.firstName}` : ''}!`;
      greetingSubtitle = `Nice to have you back — we've kept things ready for you.`;
    } else if (diffDaysG <= 14) {
      greetingTitle = `We missed you, ${user?.firstName || 'there'}!`;
      greetingSubtitle = `Welcome back — here's what happened while you were away.`;
    } else if (diffDaysG <= 60) {
      greetingTitle = `Assalamu Alaykum — it's been a while`;
      greetingSubtitle = `It's been ${diffDaysG} days — let's catch you up and get back on track.`;
    } else {
      greetingTitle = `Assalamu Alaykum — welcome back!`;
      greetingSubtitle = `Long time no see — we've missed you. Let's get you set up.`;
    }
  }

  // Feedback prompts
  const { loading: promptsLoading, firstClassPrompts, monthlyPrompts, refresh } = useFeedbackPrompts();
  const [showFirstClassModal, setShowFirstClassModal] = useState(false);
  const [showMonthlyModal, setShowMonthlyModal] = useState(false);
  const [activeFirstPrompt, setActiveFirstPrompt] = useState(null);
  const [activeMonthlyPrompt, setActiveMonthlyPrompt] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showGuardianFollowUpModal, setShowGuardianFollowUpModal] = useState(false);
  const [guardianBookingSuccess, setGuardianBookingSuccess] = useState(null);
  const [showTeacherSyncModal, setShowTeacherSyncModal] = useState(false);
  const [teacherSyncSuccess, setTeacherSyncSuccess] = useState(null);
  const [feedbackToast, setFeedbackToast] = useState({ show: false, type: 'success', message: '' });
  const [latestFeedback, setLatestFeedback] = useState(null);

  useEffect(() => {
    if (!promptsLoading) {
      if (firstClassPrompts && firstClassPrompts.length > 0) {
        setActiveFirstPrompt(firstClassPrompts[0]);
        setShowFirstClassModal(true);
        try { window.history.pushState({ modal: 'firstClass' }, ''); } catch(e){}
      } else if (monthlyPrompts && monthlyPrompts.length > 0) {
        setActiveMonthlyPrompt(monthlyPrompts[0]);
        setShowMonthlyModal(true);
        try { window.history.pushState({ modal: 'monthly' }, ''); } catch(e){}
      }
    }
  }, [promptsLoading, firstClassPrompts, monthlyPrompts]);

  // Welcome modal: show once for new users
  useEffect(() => {
    try {
      if (!user) return;
      const key = `welcome_shown_v1_${user._id || 'anon'}`;
      const already = localStorage.getItem(key) === 'true';
      if (already) return;
      const now = new Date();
      const lastLogin = user.lastLogin ? new Date(user.lastLogin) : null;
      const createdAt = user.createdAt ? new Date(user.createdAt) : null;
      const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      const isNew = !lastLogin || (createdAt && (now.getTime() - createdAt.getTime() <= ONE_WEEK_MS));
      if (isNew) setShowWelcome(true);
    } catch (e) {
      console.warn('Welcome modal check failed', e);
    }
  }, [user]);

  // Close modals when user navigates back (popstate)
  useEffect(() => {
    const onPop = (e) => {
      // if modal was open and state no longer indicates it, close
      if (showFirstClassModal && !(e.state && e.state.modal === 'firstClass')) {
        setShowFirstClassModal(false);
      }
      if (showMonthlyModal && !(e.state && e.state.modal === 'monthly')) {
        setShowMonthlyModal(false);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [showFirstClassModal, showMonthlyModal]);

  const handleFeedbackSubmitted = React.useCallback((result) => {
    refresh();
    if (!result) return;

    const friendlyLabel = result.type === 'monthly' ? 'Monthly check-in' : 'First class';

    if (result.action === 'submitted') {
      const summary = result.feedback || {};
      const teacherName = summary.teacherName
        || `${summary.teacher?.firstName || ''} ${summary.teacher?.lastName || ''}`.trim()
        || 'Teacher';

      setLatestFeedback({
        type: result.type,
        teacherName,
        notes: summary.notes || summary.message || '',
        rating: summary.teacherRating || summary.teacherPerformanceRating || summary.firstClassRating || null,
        classRating: summary.classRating || null,
        progressEvaluation: typeof summary.progressEvaluation === 'number' ? summary.progressEvaluation : null,
        submittedAt: summary.createdAt || new Date().toISOString(),
      });

      setFeedbackToast({ show: true, type: 'success', message: `${friendlyLabel} feedback submitted.` });
    } else if (result.action === 'dismissed') {
      setFeedbackToast({ show: true, type: 'info', message: `${friendlyLabel} feedback snoozed. We'll remind you later.` });
    } else if (result.action === 'error') {
      setFeedbackToast({ show: true, type: 'error', message: `${friendlyLabel} feedback could not be updated. Please try again.` });
    }
  }, [refresh]);

  const handleGuardianFollowUpBooked = React.useCallback((payload) => {
    setGuardianBookingSuccess(payload);
    try {
      fetchStats();
    } catch (err) {
      console.warn('Unable to refresh stats after booking', err);
    }
  }, [fetchStats]);

  const handleTeacherSyncBooked = React.useCallback((payload) => {
    setTeacherSyncSuccess(payload);
    try {
      fetchStats();
    } catch (err) {
      console.warn('Unable to refresh stats after teacher sync booking', err);
    }
  }, [fetchStats]);

  // StatCard moved to a separate widget component

  const RecentActivityCard = () => {
    const data = stats.data || {};
    const items = data.recentActivity || data.recentActivities || [];
    if (!items || items.length === 0) return null;

    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Recent Activity</h3>
        <div className="space-y-3">
          {items.slice(0, 6).map((it, idx) => {
            const type = (it.type || it.eventType || '').toLowerCase();
            let IconComp = CheckCircle;
            let text = it.message || it.title || '';
            let timeLabel = it.timeAgo || it.relativeTime || (it.createdAt ? new Date(it.createdAt).toLocaleString() : '');

            if (!text) {
              if (type.includes('teacher') && it.user) text = `New teacher registered: ${it.user.firstName || ''} ${it.user.lastName || ''}`;
              else if (type.includes('class') && it.classInfo) text = `Class scheduled: ${it.classInfo.title || it.classInfo._id || ''}`;
              else if (type.includes('payment') && it.amount != null) text = `Payment received $${it.amount}`;
              else text = it.summary || 'Activity';
            }

            if (type.includes('class')) IconComp = Calendar;
            else if (type.includes('payment')) IconComp = DollarSign;
            else if (type.includes('teacher') || type.includes('user')) IconComp = Users;

            return (
              <div key={idx} className="flex items-center space-x-3 p-2">
                <IconComp className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-foreground truncate">{text}</span>
                <span className="text-xs text-muted-foreground ml-auto">{timeLabel}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderAdminDashboard = () => {
            const data = stats.data || {};
            // Users: support many payload shapes from server.
            // Try multiple known keys and fall back to zeros.
            let totalUsers = 0, totalTeachers = 0;
            // Attempt common locations in order of likelihood
            const tryNumber = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
            const pickFirst = (vals) => { for (const v of vals) { const n = tryNumber(v); if (n != null) return n; } return 0; };

            // total users: several possible keys
            totalUsers = pickFirst([
              data.totalUsers,
              data.users?.total,
              data.users?.totalUsers,
              data.summary?.users?.total,
              data.usersCount,
              data.totalUsersCount,
              (Array.isArray(data.users) ? data.users.reduce((s, u) => s + (tryNumber(u.count) || 0), 0) : null)
            ]);

            // teachers by role
            totalTeachers = pickFirst([
              data.users?.byRole?.teacher,
              data.users?.teacher,
              data.summary?.users?.byRole?.teacher,
              data.teachersCount,
              data.users?.byRole?.teachers,
              (Array.isArray(data.users) ? (data.users.find(u => (u._id === 'teacher' || u.role === 'teacher') )?.count) : null)
            ]);

            // New users this month (best-effort)
            const newUsersThisMonth = pickFirst([
              data.newUsersThisMonth,
              data.users?.newThisMonth,
              data.summary?.growth?.newUsersThisMonth,
              data.summary?.users?.newThisMonth,
              data.users?.newUsersThisMonth,
              data.growth?.newUsersThisMonth,
              data.growth?.newUsers
            ]);

            // Active users by schedule (best-effort)
            const activeUsersByScheduleCount = pickFirst([
              data.activeUsersByScheduleCount,
              data.activeUsersCount,
              data.summary?.classes?.activeUsersByScheduleCount,
              data.summary?.classes?.activeUsersCount,
              data.activeUsers,
              data.activeUsersThisMonth,
              data.users?.activeCount
            ]);

            // Daily unique dashboard users (count each user once per day)
            const dailyUniqueDashboardUsers = pickFirst([
              data.dailyUniqueDashboardUsers,
              data.dailyUniqueUsers,
              data.dailyUniqueDashboardUsersCount,
              data.summary?.usage?.dailyUniqueDashboardUsers,
              data.usage?.dailyUniqueUsers,
              data.dailyActiveUsers,
            ]);

            // Unique users in last 30 days (deduplicated)
            const uniqueUsersLast30Days = pickFirst([
              data.uniqueUsersLast30Days,
              data.uniqueUsers30Days,
              data.summary?.usage?.uniqueUsersLast30Days,
              data.growth?.uniqueUsersLast30Days,
              data.uniqueUsersLast30,
              data.uniqueUsers
            ]);

            // Current number of users using the dashboard (real-time, may be server-local)
            const currentActiveDashboardUsers = pickFirst([
              data.currentActiveDashboardUsers,
              data.currentActiveUsers,
              data.activeNow,
              data.currentlyActiveUsers,
              data.realtime?.activeUsers
            ]);

            // Classes: support old array aggregate and new object
            let classesToday = 0;
            let classesNext7Days = 0;
            if (data.classes && typeof data.classes === 'object') {
              classesToday = data.classes.scheduledToday ?? data.classes.scheduledTodayCount ?? data.classesToday ?? 0;
              classesNext7Days = data.classes.scheduledNext7 ?? data.classes.scheduledNext7Days ?? data.classesNext7Days ?? 0;
            }

            // Revenue
            const monthlyRevenue = data.revenue?.monthly?.total ?? data.revenue?.totalRevenue ?? data.revenue?.total ?? (data.revenue && data.revenue.total) ?? 0;
            const unpaidBalance = data.revenue?.unpaidBalanceTotal ?? data.unpaidBalanceTotal ?? 0;

            return (
              <div className="space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl sm:text-2xl font-bold">{greetingTitle}</h2>
                        {greetingSubtitle ? (
                          <p className="text-sm text-muted-foreground">{greetingSubtitle}</p>
                        ) : (
                          <p className="text-sm text-muted-foreground">Overview — a concise snapshot of system health and activity.</p>
                        )}
                      </div>
                  <div className="flex items-center space-x-3">
                    <div className="text-sm text-muted-foreground">
                      {stats.data && stats.data.timestamps && stats.data.timestamps.computedAt && (
                        <span>Last updated {new Date(stats.data.timestamps.computedAt).toLocaleTimeString()}</span>
                      )}
                    </div>
                    <button
                      className="px-3 py-1 rounded border border-border bg-card text-sm"
                      onClick={async () => { try { await api.post('/dashboard/refresh'); await fetchStats(); } catch (e) { console.error(e); } }}
                    >↻ Refresh</button>
                    <button
                      className="px-3 py-1 rounded border border-border bg-card text-sm"
                      onClick={() => setCompactAdmin(!compactAdmin)}
                      aria-pressed={compactAdmin}
                    >{compactAdmin ? 'Compact: On' : 'Compact: Off'}</button>
                  </div>
                </div>

                {/* Top area: three vertical columns for Classes, Users, Finance */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Classes column (single consolidated box) */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-foreground">Classes</div>
                    <div className="bg-card rounded-lg p-4">
                      <div className="grid grid-cols-1 gap-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Upcoming (30 days)</div>
                          <div className="text-base sm:text-lg font-semibold">{data.classes?.upcomingNext30 ?? data.upcomingClasses30 ?? data.upcomingClasses ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Expected (30 days)</div>
                          <div className="text-base sm:text-lg font-semibold">{data.classes?.expectedNext30 ?? data.expectedClasses ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Scheduled Today</div>
                          <div className="text-base sm:text-lg font-semibold">{classesToday ?? data.classesToday ?? data.scheduledToday ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Next 7 Days</div>
                          <div className="text-base sm:text-lg font-semibold">{classesNext7Days ?? data.classesNext7Days ?? data.scheduledNext7 ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Completed (month)</div>
                          <div className="text-base sm:text-lg font-semibold">{Number(data.completedHoursThisMonth ?? 0).toFixed(2)} hrs</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Cancellations (month)</div>
                          <div className="text-base sm:text-lg font-semibold">{Number(data.cancelledHoursThisMonth ?? 0).toFixed(2)} hrs</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Next Auto-Generation</div>
                          <div className="text-xs">{(data.timestamps && data.timestamps.nextAutoGeneration) ? new Date(data.timestamps.nextAutoGeneration).toLocaleString() : (data.nextAutoGeneration ? new Date(data.nextAutoGeneration).toLocaleString() : '—')}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Users column (single consolidated box) */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-foreground">Users</div>
                    <div className="bg-card rounded-lg p-4">
                      <div className="grid grid-cols-1 gap-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Total users</div>
                          <div className="text-base sm:text-lg font-semibold">{totalUsers}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Teachers</div>
                          <div className="text-base sm:text-lg font-semibold">{totalTeachers}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">New users (this month)</div>
                          <div className="text-base sm:text-lg font-semibold">{newUsersThisMonth ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Active users (by schedule)</div>
                          <div className="text-base sm:text-lg font-semibold">{activeUsersByScheduleCount ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Unique users (today)</div>
                          <div className="text-base sm:text-lg font-semibold">{dailyUniqueDashboardUsers ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Unique users (last 30 days)</div>
                          <div className="text-base sm:text-lg font-semibold">{uniqueUsersLast30Days ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Currently online (dashboard)</div>
                          <div className="text-base sm:text-lg font-semibold">{currentActiveDashboardUsers ?? 0}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Finance column (single consolidated box) */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-foreground">Finance</div>
                    <div className="bg-card rounded-lg p-4">
                      <div className="grid grid-cols-1 gap-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Monthly Revenue</div>
                          <div className="text-base sm:text-lg font-semibold">${monthlyRevenue ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Unpaid Balance</div>
                          <div className="text-base sm:text-lg font-semibold">${unpaidBalance ?? data.unpaidBalanceTotal ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Pending Invoices</div>
                          <div className="text-base sm:text-lg font-semibold">{data.pendingInvoicesCount ?? data.revenue?.pendingInvoicesCount ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Overdue invoices</div>
                          <div className="text-base sm:text-lg font-semibold">{data.overdueInvoicesCount ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">YTD Revenue</div>
                          <div className="text-base sm:text-lg font-semibold">${data.ytdRevenue ?? data.revenue?.ytd ?? 0}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Charts moved to the bottom: three compact chart cards */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <DashboardChartCard title="Revenue (last 30 days)" subtitle="Daily revenue">
                    {(() => {
                      const ts = data.summary?.timeseries ?? data.timeseries ?? null;
                      const dates = (ts && ts.dates) ?? [];
                      const revenue = (ts && ts.revenue) ?? [];
                      const chartData = dates.map((d, i) => ({ date: d.slice(5), revenue: revenue[i] ?? 0 }));
                      return chartData.length === 0 ? (
                        <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">No revenue data</div>
                      ) : (
                        <ResponsiveContainer height={180}>
                          <LineChart data={chartData} margin={{ top: 6, right: 6, left: 0, bottom: 6 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
                            <XAxis dataKey="date" />
                            <YAxis />
                            <Tooltip />
                            <Line type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      );
                    })()}
                  </DashboardChartCard>

                  <DashboardChartCard title="Classes (last 30 days)" subtitle="Scheduled vs Completed">
                    {(() => {
                      const ts = data.summary?.timeseries ?? data.timeseries ?? null;
                      const dates = (ts && ts.dates) ?? [];
                      const scheduled = (ts && ts.classesScheduled) ?? [];
                      const completed = (ts && ts.classesCompleted) ?? [];
                      const chartData = dates.map((d, i) => ({ date: d.slice(5), scheduled: scheduled[i] ?? 0, completed: completed[i] ?? 0 }));
                      return chartData.length === 0 ? (
                        <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">No class data</div>
                      ) : (
                        <ResponsiveContainer height={180}>
                          <BarChart data={chartData} margin={{ top: 6, right: 6, left: 0, bottom: 6 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
                            <XAxis dataKey="date" />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="scheduled" fill="#10b981" />
                            <Bar dataKey="completed" fill="#4f46e5" />
                          </BarChart>
                        </ResponsiveContainer>
                      );
                    })()}
                  </DashboardChartCard>

                  <DashboardChartCard title="Active Users / Teachers (last 30 days)" subtitle="Daily active users and teachers">
                    {(() => {
                      const ts = data.summary?.timeseries ?? data.timeseries ?? null;
                      const dates = (ts && ts.dates) ?? [];
                      const activeUsers = (ts && (ts.activeUsers ?? ts.users ?? ts.active)) ?? [];
                      const teachers = (ts && ts.teachers) ?? [];
                      const chartData = dates.map((d, i) => ({ date: d.slice(5), activeUsers: activeUsers[i] ?? 0, teachers: teachers[i] ?? 0 }));
                      return chartData.length === 0 ? (
                        <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">No activity data</div>
                      ) : (
                        <ResponsiveContainer height={180}>
                          <LineChart data={chartData} margin={{ top: 6, right: 6, left: 0, bottom: 6 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
                            <XAxis dataKey="date" />
                            <YAxis />
                            <Tooltip />
                            <Line type="monotone" dataKey="activeUsers" stroke="#f59e0b" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="teachers" stroke="#2C736C" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      );
                    })()}
                  </DashboardChartCard>
                </div>

                {/* Secondary lists placed side-by-side to reduce vertical length */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="bg-card rounded-lg border border-border p-4">
                    <h3 className="text-sm font-semibold mb-2">Top Owing Guardians</h3>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      {(data.topOwingGuardians || data.guardians?.topOwingGuardians || []).slice(0,5).map((g, idx) => (
                        <div key={idx} className="flex items-center justify-between">
                          <div className="truncate">{g.guardian?.firstName ? `${g.guardian.firstName} ${g.guardian.lastName || ''}` : g.guardianId || 'Unknown'}</div>
                          <div className="font-semibold">${g.totalOwed || 0}</div>
                        </div>
                      ))}
                      {((data.topOwingGuardians || data.guardians?.topOwingGuardians || []).length === 0) && <div className="text-xs text-muted-foreground">No outstanding balances</div>}
                    </div>
                  </div>

                  <div className="bg-card rounded-lg border border-border p-4">
                    <h3 className="text-sm font-semibold mb-2">Guardians Low on Hours</h3>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      {(data.guardiansLowHours || data.guardians?.guardiansLowHours || []).slice(0,5).map((g, idx) => (
                        <div key={idx} className="flex items-center justify-between">
                          <div className="truncate">{g.firstName} {g.lastName}</div>
                          <div className="text-xs">{g.guardianInfo?.totalHours ?? g.totalHours ?? '-' } hrs</div>
                        </div>
                      ))}
                      {((data.guardiansLowHours || data.guardians?.guardiansLowHours || []).length === 0) && <div className="text-xs text-muted-foreground">No guardians need topping up</div>}
                    </div>
                  </div>

                  <div className="bg-card rounded-lg border border-border p-4">
                    <h3 className="text-sm font-semibold mb-2">Teachers on Vacation</h3>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      {(data.teachersOnVacationList || data.teachers?.teachersOnVacationList || []).slice(0,8).map((t, idx) => (
                        <div key={idx} className="flex items-center justify-between">
                          <div className="truncate">{t.firstName} {t.lastName}</div>
                          <div className="text-xs">{t.vacationStartDate ? formatDateDDMMMYYYY(t.vacationStartDate) : ''}</div>
                        </div>
                      ))}
                      {((data.teachersOnVacationList || data.teachers?.teachersOnVacationList || []).length === 0) && <div className="text-xs text-muted-foreground">No teachers on vacation</div>}
                    </div>
                  </div>
                </div>
              </div>
            );
  };

  const renderTeacherDashboard = () => {
    const data = stats.data || {};
    const upcomingCount = Array.isArray(data.upcomingClasses)
      ? data.upcomingClasses.length
      : Number(data.upcomingClasses || 0);
    const pendingTotal = (Array.isArray(data.pendingReports) ? data.pendingReports.length : 0)
      + (Array.isArray(data.overdueReports) ? data.overdueReports.length : 0);
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="bg-card rounded-lg p-4 sm:p-6 border border-border">
          <h2 className="text-xl sm:text-2xl font-semibold mb-1 sm:mb-2 text-foreground">{greetingTitle}</h2>
          {greetingSubtitle ? (
            <p className="text-sm text-muted-foreground">{greetingSubtitle}</p>
          ) : (
            <p className="text-sm text-muted-foreground">You have <strong className="text-foreground">{upcomingCount}</strong> classes scheduled for today. Keep up the great work!</p>
          )}
        </div>

        {teacherSyncSuccess?.meeting && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-emerald-900">Teacher sync booked ✔</p>
                <p className="text-xs text-emerald-800">{formatClassDate(teacherSyncSuccess.meeting.scheduledStart)}</p>
              </div>
              <button
                type="button"
                className="text-xs text-emerald-900 underline"
                onClick={() => setTeacherSyncSuccess(null)}
              >
                Dismiss
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {teacherSyncSuccess.calendar?.googleCalendarLink && (
                <button
                  type="button"
                  onClick={() => window.open(teacherSyncSuccess.calendar.googleCalendarLink, '_blank')}
                  className="rounded-full border border-emerald-200 px-3 py-1 text-emerald-900"
                >
                  Google Calendar
                </button>
              )}
              {teacherSyncSuccess.calendar?.outlookCalendarLink && (
                <button
                  type="button"
                  onClick={() => window.open(teacherSyncSuccess.calendar.outlookCalendarLink, '_blank')}
                  className="rounded-full border border-emerald-200 px-3 py-1 text-emerald-900"
                >
                  Outlook link
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Unbilled hours (this month)" value={`${Number(data.hoursThisMonth || 0).toFixed(2)}`} Icon={Clock} color="bg-slate-100 text-slate-700" />
          <StatCard title="Active Students" value={data.activeStudentCount || data.studentsWithClassesThisMonth || 0} Icon={Users} color="bg-amber-50 text-amber-700" />
          <StatCard title="Cancellations (month)" value={data.cancellationsThisMonth || 0} Icon={AlertCircle} color="bg-rose-50 text-rose-700" />
          <StatCard title="Classes (this month)" value={data.classesCompletedThisMonth || 0} Icon={Calendar} color="bg-violet-50 text-violet-700" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          <div className="lg:col-span-1">
            <NextClassCard nextClass={data.nextClass} />
          </div>

          <div className="lg:col-span-2">
            <div className="space-y-4">
              <div className="rounded-2xl border border-[#FACC15] bg-[#FFF9DB] p-4 shadow-sm flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.25em] text-[#c0680e]">Monthly sync</p>
                  <div className="text-sm font-semibold text-[#2f2001] truncate">Align with the admin team</div>
                  <div className="text-xs text-[#5f4506] truncate">Use this yellow slot for escalations or planning.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTeacherSyncModal(true)}
                  className="inline-flex items-center justify-center rounded-full bg-[#2C736C] px-4 py-1.5 text-xs font-semibold text-white shadow"
                >
                  Book sync
                </button>
              </div>

              {((stats.data?.recentActivity || stats.data?.recentActivities || []).length > 0) && (
                <RecentActivityCard />
              )}

              <div className="bg-card rounded-lg border border-border p-6">
                <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">Pending Reports ({pendingTotal || 0})</h3>
                  <PendingReportsList
                    reports={[...(data.pendingReports || []), ...(data.overdueReports || []).map(x => ({ ...x, _isOverdue: true }))]}
                    onOpen={(r) => navigate(`/classes/${r._id || r.id}/report`, { state: { background: location, reportClass: r } })}
                  />
              </div>
            </div>
          </div>
        </div>

        {/* First-class reminders */}
        {data.pendingFirstClassStudents && data.pendingFirstClassStudents.length > 0 && (
          <FirstClassReminder
            items={data.pendingFirstClassStudents}
            onOpen={(c) => navigate(`/classes/${c._id || c.id}/report`, { state: { background: location, reportClass: c } })}
          />
        )}
      </div>
    );
  };

  const renderGuardianDashboard = () => {
    const data = stats.data || {};
    const myChildrenCount = Array.isArray(data.myChildren)
      ? data.myChildren.length
      : Number(data.myChildren || 0);
    const lastPaid = data.lastPaidInfo || data.lastPaidInvoice || null;
    const upcomingClass = Array.isArray(data.upcomingClasses) && data.upcomingClasses.length > 0 ? data.upcomingClasses[0] : (data.nextClass || null);

    // (greeting computed globally as greetingTitle/greetingSubtitle)

    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="bg-gradient-to-r from-[#eaf5f2] to-[#2c736c] rounded-lg p-4 sm:p-5 text-foreground">
          <h2 className="text-xl font-semibold mb-1">{greetingTitle}</h2>
          {greetingSubtitle ? (
            <p className="text-sm opacity-85">{greetingSubtitle}</p>
          ) : (
            <p className="text-sm opacity-85">{lastLoginGlobal ? `Last visit: ${lastLoginGlobal ? formatClassDate(lastLoginGlobal) : '—'}` : `Welcome—this looks like your first visit.`}</p>
          )}
        </div>

        {guardianBookingSuccess?.meeting && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-emerald-900">Follow-up booked ✔</p>
                <p className="text-xs text-emerald-800">{formatClassDate(guardianBookingSuccess.meeting.scheduledStart)}</p>
              </div>
              <button
                type="button"
                className="text-xs text-emerald-900 underline"
                onClick={() => setGuardianBookingSuccess(null)}
              >
                Dismiss
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {guardianBookingSuccess.calendar?.googleCalendarLink && (
                <button
                  type="button"
                  onClick={() => window.open(guardianBookingSuccess.calendar.googleCalendarLink, '_blank')}
                  className="rounded-full border border-emerald-200 px-3 py-1 text-emerald-900"
                >
                  Google Calendar
                </button>
              )}
              {guardianBookingSuccess.calendar?.outlookCalendarLink && (
                <button
                  type="button"
                  onClick={() => window.open(guardianBookingSuccess.calendar.outlookCalendarLink, '_blank')}
                  className="rounded-full border border-emerald-200 px-3 py-1 text-emerald-900"
                >
                  Outlook link
                </button>
              )}
            </div>
          </div>
        )}

        <div className="rounded-3xl border border-[#FACC15] bg-[#FFF9DB] p-5 shadow-sm flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[#c0680e]">Need a check-in?</p>
            <h3 className="text-lg font-semibold text-[#2f2001]">Schedule an admin follow-up</h3>
            <p className="text-sm text-[#5f4506]">Pick a yellow slot to review progress, billing, or future plans. One per student each month.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowGuardianFollowUpModal(true)}
            className="inline-flex items-center justify-center rounded-full bg-[#2C736C] px-5 py-2 text-sm font-semibold text-white shadow"
          >
            Schedule follow-up
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <StatCard title="My Students" value={myChildrenCount} Icon={Users} color="bg-slate-50 text-slate-700" />
          {/* Combined Hours card: total hours + small per-student list */}
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Hours (last 30 days)</p>
                <p className="text-lg sm:text-xl font-semibold text-foreground">{(data.totalHoursLast30 ?? 0)} hrs</p>
                {/* small per-student list inside the same card (full list, small font) */}
                {Array.isArray(data.recentStudentHours) && data.recentStudentHours.length > 0 ? (
                  <div className="mt-2 space-y-1 max-h-40 overflow-auto">
                    {data.recentStudentHours.map(s => (
                      <div key={s._id} className="flex items-center justify-between">
                        <div className="text-xs text-foreground truncate">{s.studentName || 'Student'}</div>
                        <div className="text-xs text-muted-foreground">{s.totalHours} hrs</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">No hours recorded in the last 30 days</div>
                )}
              </div>
              <div className="flex flex-col items-center">
                <div className="h-10 w-10 rounded-full flex items-center justify-center bg-accent/10 text-accent">
                  <Calendar className="h-5 w-5" />
                </div>
                {Array.isArray(data.recentStudentHours) && data.recentStudentHours.length > 0 && (
                  <button
                    className="mt-2 text-xs text-accent hover:underline"
                    onClick={() => navigate(isGuardian() ? '/dashboard/my-students' : '/dashboard/students')}
                  >
                    View all
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Custom Last Paid Hours card: larger hours, smaller timestamp, small message when none */}
          <div className="bg-card rounded-lg border border-border p-4">
            <p className="text-sm font-medium text-muted-foreground">Last paid hours</p>
            {lastPaid && (lastPaid.hours != null) ? (
              <div className="mt-2">
                <div className="text-lg sm:text-xl font-semibold text-foreground">{lastPaid.hours} hrs</div>
                <div className="text-xs text-muted-foreground mt-1">from {lastPaid.fromDate ? formatClassDate(lastPaid.fromDate) : (lastPaid.from ? formatClassDate(lastPaid.from) : '—')}</div>
              </div>
            ) : (
              <div className="mt-2 text-xs text-muted-foreground">No paid hours yet</div>
            )}
          </div>
          <StatCard title="Remaining hours" value={`${(data.guardianHours ?? data.guardianInfo?.totalHours ?? 0)} hrs`} Icon={Clock} color="bg-card text-foreground" />
        </div>
        {/* per-student list merged into the Hours card above */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {upcomingClass && (
            <div className="bg-card rounded-lg border border-border p-4">
              <h3 className="text-lg font-semibold mb-2">Upcoming Class</h3>
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <div className="text-sm font-medium">{upcomingClass.student?.studentName || `${upcomingClass.student?.firstName || ''} ${upcomingClass.student?.lastName || ''}`.trim()}</div>
                  <div className="text-xs text-muted-foreground">{formatClassDate(upcomingClass.scheduledDate)}</div>
                  <div className="text-xs text-muted-foreground mt-1">{upcomingClass.duration ? `${upcomingClass.duration} min` : ''} {upcomingClass.subject ? `• ${upcomingClass.subject}` : ''}</div>
                </div>
                <div className="text-sm text-muted-foreground">With {`${upcomingClass.teacher?.firstName || ''} ${upcomingClass.teacher?.lastName || ''}`.trim()}</div>
              </div>
            </div>
          )}

          {/* Hours per student merged into the Hours card above */}

          { (Array.isArray(data.recentLastClasses) && data.recentLastClasses.length > 0) && (
            <div className="bg-card rounded-lg border border-border p-4">
              <h3 className="text-lg font-semibold mb-2">Recent classes</h3>
              <div className="space-y-3">
                {data.recentLastClasses.slice(0,6).map((c) => (
                  <div key={c._id} className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{c.studentName || 'Student'}</div>
                      <div className="text-xs text-muted-foreground">{formatClassDate(c.scheduledDate)} • {c.duration ? `${c.duration} min` : ''} {c.subject ? `• ${c.subject}` : ''}</div>
                      {c.lessonTopic && <div className="text-xs text-muted-foreground mt-1 truncate">Topic: {c.lessonTopic}</div>}
                      {c.teacherNotes && <div className="text-xs text-muted-foreground mt-1 truncate">Notes: {c.teacherNotes}</div>}
                      {(c.recitedQuran || c.surah) && (
                        <div className="text-xs text-muted-foreground mt-1 truncate">
                          {c.recitedQuran ? `Quran: ${c.recitedQuran}` : `Surah: ${c.surah?.name || '—'} ${c.verseEnd ? `(up to verse ${c.verseEnd})` : ''}`}
                        </div>
                      )}
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      {c.classScore != null && <div className="font-semibold">Score: {c.classScore}</div>}
                      <div className="mt-1">With {c.teacher ? `${c.teacher.firstName || ''} ${c.teacher.lastName || ''}`.trim() : 'Teacher'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderStudentDashboard = () => (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-slate-300 to-slate-100 rounded-lg p-6 text-foreground">
        <h2 className="text-2xl font-bold mb-2">{greetingTitle}</h2>
        {greetingSubtitle ? (
          <p className="opacity-90">{greetingSubtitle}</p>
        ) : (
          <p className="opacity-90">You have {stats.data.upcomingClasses || 0} classes coming up.</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Enrolled Classes" value={stats.data.enrolledClasses || 0} Icon={Calendar} color="bg-purple-50 text-purple-700" />
        <StatCard title="Attendance Rate" value={`${stats.data.attendance || 0}%`} Icon={CheckCircle} color="bg-green-50 text-green-700" />
        <StatCard title="Completed Classes" value={stats.data.completedClasses || 0} Icon={Clock} color="bg-blue-50 text-blue-700" />
        <StatCard title="Pending Assignments" value={stats.data.assignments || 0} Icon={AlertCircle} color="bg-yellow-50 text-yellow-700" />
      </div>
    </div>
  );

  // ----- Loading state -----
  if (stats.loading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-32 bg-muted rounded-lg"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-muted rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ----- Error state -----
  if (stats.error) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-2">Failed to load dashboard</h3>
          <p className="text-sm text-muted-foreground mb-4">{stats.error}</p>
          <div className="flex space-x-2">
            <button className="px-4 py-2 rounded bg-primary text-primary-foreground" onClick={() => fetchStats()}>Retry</button>
            <button className="px-4 py-2 rounded border" onClick={() => setStats((s) => ({ ...s, error: null }))}>Dismiss</button>
          </div>
        </div>
      </div>
    );
  }

  // ----- Final render (role-based) -----
  return (
    <div className="p-4 sm:p-6">
      {latestFeedback && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground">Last submitted feedback</p>
              <h3 className="text-lg font-semibold text-foreground">{latestFeedback.teacherName}</h3>
              <p className="text-xs text-muted-foreground">{latestFeedback.type === 'monthly' ? 'Monthly check-in' : 'First class'} • {formatDateDDMMMYYYY(latestFeedback.submittedAt)}</p>
            </div>
            {typeof isAdmin === 'function' && isAdmin() && (
              <button
                type="button"
                onClick={() => navigate('/dashboard/feedbacks')}
                className="inline-flex items-center rounded-full border border-primary/40 px-4 py-1 text-xs font-semibold text-primary transition hover:bg-primary/10"
              >
                View Feedback Inbox
              </button>
            )}
          </div>
          <div className="mt-3 grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
            {typeof latestFeedback.rating === 'number' && (
              <div className="rounded-xl border border-border/60 bg-background px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Teacher rating</p>
                <p className="text-base font-semibold text-foreground">{Math.round(latestFeedback.rating)} / 10</p>
              </div>
            )}
            {typeof latestFeedback.classRating === 'number' && (
              <div className="rounded-xl border border-border/60 bg-background px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Class rating</p>
                <p className="text-base font-semibold text-foreground">{Math.round(latestFeedback.classRating)} / 10</p>
              </div>
            )}
            {typeof latestFeedback.progressEvaluation === 'number' && (
              <div className="rounded-xl border border-border/60 bg-background px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Progress</p>
                <p className="text-base font-semibold text-foreground">{latestFeedback.progressEvaluation} / 10</p>
              </div>
            )}
          </div>
          {latestFeedback.notes && (
            <p className="mt-3 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">{latestFeedback.notes}</p>
          )}
        </div>
      )}

      {isAdmin() && renderAdminDashboard()}
      {isTeacher() && renderTeacherDashboard()}
      {isGuardian() && renderGuardianDashboard()}
      {isStudent() && renderStudentDashboard()}
      {/* Feedback modals */}
      {/* Welcome modal (one-time) */}
      {showWelcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black opacity-40" onClick={() => { setShowWelcome(false); }}></div>
          <div className="bg-white rounded-lg shadow-xl max-w-xl w-[calc(100%-2rem)] max-h-[85vh] overflow-y-auto p-5 sm:p-6 z-10" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <h3 id="welcome-title" className="text-2xl font-bold">Welcome to Waraqa platform{user?.firstName ? `, ${user.firstName}` : ''}!</h3>
                <p className="text-sm text-muted-foreground mt-2">We’re delighted to have you with us. <br />
                Please complete your profile, then add your student(s) on the Students. This helps us personalize your experience and get classes scheduled faster. <br />

                </p>

                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={() => {
                      try { localStorage.setItem(`welcome_shown_v1_${user._id || 'anon'}`, 'true'); } catch(e){}
                      setShowWelcome(false);
                      navigate('/dashboard/profile');
                    }}
                    className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >Complete your profile</button>
                  <button
                    onClick={() => { try { localStorage.setItem(`welcome_shown_v1_${user._id || 'anon'}`, 'true'); } catch(e){} setShowWelcome(false); }}
                    className="px-4 py-2 rounded-md border border-border bg-muted text-foreground hover:opacity-90"
                  >Maybe later</button>
                </div>
              </div>
              <div className="w-40 hidden md:block">
                {/* Inline SVG illustration so welcome graphic always appears without external asset */}
                <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto" role="img" aria-label="Welcome illustration">
                  <defs>
                    <linearGradient id="g1" x1="0" x2="1">
                      <stop offset="0%" stopColor="#60a5fa" />
                      <stop offset="100%" stopColor="#7c3aed" />
                    </linearGradient>
                  </defs>
                  <rect rx="12" width="120" height="120" fill="#f8fafc" />
                  <g transform="translate(12,18)">
                    <circle cx="36" cy="18" r="18" fill="url(#g1)" opacity="0.95" />
                    <rect x="0" y="44" width="72" height="34" rx="6" fill="#e6eefc" />
                    <g transform="translate(6,50)">
                      <rect x="0" y="0" width="60" height="6" rx="3" fill="#fff" opacity="0.8" />
                      <rect x="0" y="10" width="42" height="6" rx="3" fill="#fff" opacity="0.7" />
                    </g>
                  </g>
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}
      <GuardianFollowUpModal
        open={showGuardianFollowUpModal}
        onClose={() => setShowGuardianFollowUpModal(false)}
        students={(stats.data && stats.data.myChildren) || []}
        onBooked={handleGuardianFollowUpBooked}
      />
      <TeacherSyncModal
        open={showTeacherSyncModal}
        onClose={() => setShowTeacherSyncModal(false)}
        onBooked={handleTeacherSyncBooked}
      />
      <FirstClassFeedbackModal
        open={showFirstClassModal}
        // onClose should only close the modal; do NOT refresh prompts here because that would re-open it immediately
        onClose={() => { setShowFirstClassModal(false); try { window.history.back(); } catch(e){} }}
        prompt={activeFirstPrompt}
        onSubmitted={handleFeedbackSubmitted}
      />

      <MonthlyFeedbackModal
        open={showMonthlyModal}
        // onClose only closes the modal; refresh will be triggered by onSubmitted after submit/dismiss
        onClose={() => { setShowMonthlyModal(false); try { window.history.back(); } catch(e){} }}
        prompt={activeMonthlyPrompt}
        onSubmitted={handleFeedbackSubmitted}
      />

      {feedbackToast.show && (
        <Toast
          type={feedbackToast.type}
          message={feedbackToast.message}
          onClose={() => setFeedbackToast((prev) => ({ ...prev, show: false }))}
        />
      )}
    </div>
  );
};

export default DashboardHome;
