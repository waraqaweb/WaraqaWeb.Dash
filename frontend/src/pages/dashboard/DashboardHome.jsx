// frontend/src/components/dashboard/DashboardHome.jsx
import React, { useState, useEffect, useRef } from "react";
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
  RefreshCcw,
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
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';

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

const getRegionFromLocale = (locale = '') => {
  const match = String(locale || '').match(/-([A-Z]{2})\b/);
  return match ? match[1] : null;
};

const getRegionFromTimeZone = (timeZone = '') => {
  const tz = String(timeZone || '');
  if (tz === 'Asia/Riyadh') return 'SA';
  if (tz === 'Asia/Dubai') return 'AE';
  if (tz === 'Asia/Qatar') return 'QA';
  if (tz === 'Asia/Kuwait') return 'KW';
  if (tz === 'Asia/Bahrain') return 'BH';
  if (tz === 'Asia/Muscat') return 'OM';
  return null;
};

const getHijriCalendarCandidates = ({ region }) => {
  // Best-effort: use Umm al-Qura where it's the de-facto official source.
  const umalquraRegions = new Set(['SA', 'AE', 'QA', 'KW', 'BH', 'OM']);
  if (region && umalquraRegions.has(region)) {
    return ['islamic-umalqura', 'islamic', 'islamic-civil'];
  }
  // Default to observational Hijri if supported; fallback to civil.
  return ['islamic', 'islamic-civil', 'islamic-umalqura'];
};

const hijriMonthNamesEn = [
  'Muharram',
  'Safar',
  'Rabiʿ al-Awwal',
  'Rabiʿ al-Thani',
  'Jumada al-Ula',
  'Jumada al-Akhirah',
  'Rajab',
  'Sha\'ban',
  'Ramadan',
  'Shawwal',
  'Dhu al-Qa\'dah',
  'Dhu al-Hijjah'
];

const getGregorianYmdInTimeZone = ({ date, timeZone }) => {
  const tz = timeZone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined);
  try {
    const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = typeof dtf.formatToParts === 'function' ? dtf.formatToParts(date) : null;
    const y = parts ? Number(parts.find(p => p.type === 'year')?.value) : NaN;
    const m = parts ? Number(parts.find(p => p.type === 'month')?.value) : NaN;
    const d = parts ? Number(parts.find(p => p.type === 'day')?.value) : NaN;
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) return { y, m, d, timeZone: tz };
  } catch (e) {
    // ignore
  }
  // Fallback to local date parts
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(), timeZone: tz };
};

// Tabular (civil) Hijri conversion as a last resort when Intl Hijri calendars are unsupported.
// This is an approximation and should be labeled as such in the UI.
const gregorianToHijriCivil = ({ y, m, d }) => {
  // Gregorian to Julian Day Number (integer)
  const a = Math.floor((14 - m) / 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  const jdn = d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;

  // Julian day to Islamic civil date
  const islamicEpoch = 1948439; // JDN for 1 Muharram 1 AH (civil) at midnight
  const daysSinceEpoch = jdn - islamicEpoch;
  const year = Math.floor((30 * daysSinceEpoch + 10646) / 10631);

  const islamicToJdn = (iy, im, id) => {
    const monthDays = Math.ceil(29.5 * (im - 1));
    return id + monthDays + (iy - 1) * 354 + Math.floor((3 + 11 * iy) / 30) + islamicEpoch - 1;
  };

  let month = Math.min(12, Math.ceil((jdn - (29 + islamicToJdn(year, 1, 1))) / 29.5) + 1);
  if (!Number.isFinite(month) || month < 1) month = 1;
  if (month > 12) month = 12;
  const day = jdn - islamicToJdn(year, month, 1) + 1;

  return { year, month, day };
};

const formatHijriDate = ({ date = new Date(), timeZone, locale }) => {
  const resolvedLocale = locale || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  const resolvedTimeZone = timeZone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined);
  const region = getRegionFromLocale(resolvedLocale) || getRegionFromTimeZone(resolvedTimeZone);

  const candidates = getHijriCalendarCandidates({ region });
  for (const calendar of candidates) {
    try {
      const dtf = new Intl.DateTimeFormat(resolvedLocale, {
        calendar,
        timeZone: resolvedTimeZone,
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

      const parts = typeof dtf.formatToParts === 'function' ? dtf.formatToParts(date) : null;
      const dayPart = parts ? parts.find((p) => p.type === 'day')?.value : null;
      const monthPart = parts ? parts.find((p) => p.type === 'month')?.value : null;
      const yearPart = parts ? parts.find((p) => p.type === 'year')?.value : null;
      const yearNumber = yearPart ? Number(String(yearPart).replace(/[^0-9]/g, '')) : NaN;

      const dayNumber = dayPart ? Number(String(dayPart).replace(/[^0-9]/g, '')) : NaN;

      // Heuristic: Hijri year should be ~14xx. If we get ~20xx it's probably Gregorian fallback.
      if (Number.isFinite(yearNumber) && yearNumber > 1700) continue;

      return {
        ok: true,
        formatted: dtf.format(date),
        calendar,
        timeZone: resolvedTimeZone,
        region: region || null,
        parts: {
          day: dayPart || null,
          month: monthPart || null,
          year: yearPart || null,
        },
        dayNumber: Number.isFinite(dayNumber) ? dayNumber : null,
      };
    } catch (e) {
      // try next candidate
    }
  }

  // Fallback: civil/tabular Hijri estimate (always available).
  try {
    const { y, m, d, timeZone: tz } = getGregorianYmdInTimeZone({ date, timeZone: resolvedTimeZone });
    const civil = gregorianToHijriCivil({ y, m, d });
    const monthName = hijriMonthNamesEn[(civil.month || 1) - 1] || 'Hijri';
    const formatted = `${monthName} ${civil.day}, ${civil.year} AH`;
    return {
      ok: true,
      formatted,
      calendar: 'islamic-civil-estimated',
      estimated: true,
      timeZone: tz,
      region: region || null,
      parts: {
        day: String(civil.day),
        month: monthName,
        year: String(civil.year),
      },
      dayNumber: Number.isFinite(civil.day) ? civil.day : null,
    };
  } catch (e) {
    return { ok: false, formatted: '', calendar: null, timeZone: resolvedTimeZone, region: region || null, parts: null, dayNumber: null };
  }
};

const getLunarPhaseInfo = (date = new Date()) => {
  // Best-effort astronomical phase (no API): compute moon age based on a known new moon epoch.
  // Source concept is widely used: synodic month ~ 29.53058867 days.
  const synodicMonthDays = 29.53058867;
  const knownNewMoonUtcMs = Date.UTC(2000, 0, 6, 18, 14, 0); // 2000-01-06 18:14 UTC
  const daysSince = (date.getTime() - knownNewMoonUtcMs) / (1000 * 60 * 60 * 24);
  const age = ((daysSince % synodicMonthDays) + synodicMonthDays) % synodicMonthDays; // 0..29.53
  const phase = age / synodicMonthDays; // 0..1
  const illumination = 0.5 * (1 - Math.cos(2 * Math.PI * phase)); // 0..1
  const waxing = phase < 0.5;

  let label = '—';
  if (age < 1.2 || age > synodicMonthDays - 1.2) label = 'New moon';
  else if (age < 7.4) label = 'Waxing crescent';
  else if (age < 8.8) label = 'First quarter';
  else if (age < 13.8) label = 'Waxing gibbous';
  else if (age < 16.0) label = 'Full moon';
  else if (age < 22.1) label = 'Waning gibbous';
  else if (age < 23.6) label = 'Last quarter';
  else label = 'Waning crescent';

  return {
    label,
    illumination,
    waxing,
    ageDays: Math.round(age * 10) / 10,
  };
};

const MoonPhaseIcon = ({ date = new Date(), size = 56 }) => {
  const info = getLunarPhaseInfo(date);
  const r = 18;
  const cx = 24;
  const cy = 24;

  // Reveal the lit portion by offsetting a dark mask circle.
  const k = r * (1 - Math.cos(2 * Math.PI * ((info.ageDays || 0) / 29.53058867)));
  const shadowCx = cx + (info.waxing ? -k : k);

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <clipPath id="moon-clip">
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>

        <radialGradient id="moon-lit" cx="30%" cy="30%" r="70%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="70%" stopColor="currentColor" stopOpacity="0.75" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
        </radialGradient>

        <radialGradient id="moon-dark" cx="60%" cy="60%" r="80%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.65" />
        </radialGradient>
      </defs>

      <g clipPath="url(#moon-clip)" className="text-primary">
        <circle cx={cx} cy={cy} r={r} fill="url(#moon-lit)" />
        <g className="text-foreground">
          <circle cx={shadowCx} cy={cy} r={r} fill="url(#moon-dark)" />
        </g>
      </g>

      <title>{`Moon illumination ${Math.round(info.illumination * 100)}%`}</title>
    </svg>
  );
};

const HijriDateCard = ({ variant = 'card', timeZone, locale }) => {
  const now = new Date();
  const hijri = formatHijriDate({ date: now, timeZone, locale });
  if (!hijri.ok) return null;

  if (variant === 'inline') {
    return (
      <div className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap">
        Hijri: <span className="text-foreground font-medium">{hijri.formatted}</span>
      </div>
    );
  }

  const lunar = getLunarPhaseInfo(now);
  const hijriDayLabel = hijri.dayNumber ? `Hijri day ${hijri.dayNumber}` : null;

  return (
    <div className="h-full bg-gradient-to-br from-primary/15 via-card to-card rounded-xl border border-primary/20 p-4 flex flex-col items-center justify-center text-center shadow-sm">
      <MoonPhaseIcon date={now} size={64} />
      <div className="mt-2 text-xs font-medium tracking-wide text-muted-foreground">Hijri date</div>
      <div className="mt-1 text-lg font-semibold text-foreground leading-snug">{hijri.formatted}</div>
      <div className="mt-1 text-sm text-muted-foreground">{formatDateDDMMMYYYY(now)}</div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
        {hijri.estimated && (
          <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-muted-foreground">
            Estimated
          </span>
        )}
        {hijriDayLabel && (
          <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-primary">
            {hijriDayLabel}
          </span>
        )}
        <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-foreground">
          {lunar.label}
        </span>
        <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-muted-foreground">
          {Math.round(lunar.illumination * 100)}% lit
        </span>
      </div>
    </div>
  );
};

/**
 * DashboardHome
 * - One file containing Admin / Teacher / Guardian / Student dashboards
 */

const DashboardHome = ({ isActive = true }) => {
  const { user, isAdmin, isTeacher, isGuardian, isStudent } = useAuth();
  const [compactAdmin, setCompactAdmin] = React.useState(false);
  const [requestsTab, setRequestsTab] = React.useState('teachers');

  const userRole = user?.role;

  // --- UI / data state
  const [stats, setStats] = useState({ loading: true, data: {}, role: null, error: null });
  const statsRef = useRef({ loading: true, data: {}, role: null, error: null });
  const fetchStatsInFlightRef = useRef(false);
  const fetchStatsKeyRef = useRef('');
  const fetchStatsAbortRef = useRef(null);
  const fetchStatsRequestIdRef = useRef(0);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  // Fetch real dashboard stats from the server (extracted so we can retry)
  const fetchStats = React.useCallback(async () => {
    const requestSignature = JSON.stringify({ userId: user?._id, role: userRole || user?.role || null });
    if (fetchStatsInFlightRef.current && fetchStatsKeyRef.current === requestSignature) {
      return;
    }

    fetchStatsKeyRef.current = requestSignature;
    fetchStatsInFlightRef.current = true;

    const requestId = fetchStatsRequestIdRef.current + 1;
    fetchStatsRequestIdRef.current = requestId;

    if (fetchStatsAbortRef.current) {
      try {
        fetchStatsAbortRef.current.abort();
      } catch (e) {
        // ignore abort errors
      }
    }

    const controller = new AbortController();
    fetchStatsAbortRef.current = controller;

    const hasExisting = statsRef.current?.data && Object.keys(statsRef.current.data || {}).length > 0;
    if (!hasExisting) {
      setStats((s) => ({ ...s, loading: true, error: null }));
    }
    try {
      const cacheKey = makeCacheKey('dashboard:stats', user?._id || 'anon', { role: userRole || user?.role || 'unknown' });
      const cachedEntry = readCache(cacheKey, { deps: ['dashboard', 'classes', 'users'] });
      if (cachedEntry.hit && cachedEntry.value) {
        const payload = cachedEntry.value;
        const role = payload.role ?? userRole ?? null;
        const data = payload.stats || payload;
        setStats({ loading: false, data, role, error: null, cached: payload.cached ?? true });
        if (cachedEntry.ageMs < 60_000) {
          fetchStatsInFlightRef.current = false;
          return;
        }
      }

      const res = await api.get('/dashboard/stats', { signal: controller.signal });
      if (requestId !== fetchStatsRequestIdRef.current) {
        return;
      }
      const payload = res.data;
      if (!payload) {
        setStats({ loading: false, data: {}, role: null, error: 'No data' });
        return;
      }
      // payload shape: { success: true, role: 'teacher', stats: { ... } }
      const role = payload.role ?? userRole ?? null;
      const data = payload.stats || payload;
      setStats({ loading: false, data, role, error: null, cached: payload.cached ?? false });
      writeCache(cacheKey, payload, { ttlMs: 5 * 60_000, deps: ['dashboard', 'classes', 'users'] });
    } catch (err) {
      const isCanceled = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
      if (!isCanceled) {
        console.error('Failed to load dashboard stats', err);
        setStats({ loading: false, data: {}, role: null, error: err?.message || 'Failed to load' });
      }
    }
    fetchStatsInFlightRef.current = false;
  }, [userRole, user?._id, user?.role]);

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
    if (!isActive) return;
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
  }, [isActive, promptsLoading, firstClassPrompts, monthlyPrompts]);

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
    if (!isActive) return () => {};
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
  }, [isActive, showFirstClassModal, showMonthlyModal]);

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
            const formatDelta = (current, previous) => {
              const cur = Number(current || 0);
              const prev = Number(previous || 0);
              if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
              const pct = ((cur - prev) / prev) * 100;
              if (!Number.isFinite(pct)) return null;
              return {
                pct,
                label: `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% vs last 30d`,
                isUp: pct >= 0
              };
            };
            const formatHoursTwoDecimals = (value) => {
              const numeric = Number(value);
              return Number.isFinite(numeric) ? numeric.toFixed(2) : '-';
            };
            // Users: support many payload shapes from server.
            // Try multiple known keys and fall back to zeros.
            let totalUsers = 0, totalTeachers = 0;
            // Attempt common locations in order of likelihood
            const tryNumber = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
            const pickFirst = (vals) => { for (const v of vals) { const n = tryNumber(v); if (n != null) return n; } return 0; };
            const teacherRequestsUnopened = pickFirst([
              data.requests?.teachers?.unopenedCount,
              data.requests?.teachers?.unreadCount,
              data.teacherRequestsUnopened,
              data.teacherRequestsUnread,
              data.requestsTeachersUnopened
            ]);
            const guardianRequestsUnopened = pickFirst([
              data.requests?.guardians?.unopenedCount,
              data.requests?.guardians?.unreadCount,
              data.guardianRequestsUnopened,
              data.guardianRequestsUnread,
              data.requestsGuardiansUnopened
            ]);

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

            const activeTeachersTotal = pickFirst([
              data.activeTeachersTotal,
              data.teachers?.activeTeachersTotal,
              data.users?.activeTeachersTotal,
              data.summary?.teachers?.activeTeachersTotal,
              data.summary?.users?.activeTeachersTotal
            ]);

            const totalGuardians = pickFirst([
              data.totalGuardians,
              data.guardians?.totalGuardians,
              data.users?.totalGuardians,
              data.summary?.guardians?.totalGuardians,
              data.summary?.users?.totalGuardians
            ]);

            const activeGuardiansLast30 = pickFirst([
              data.activeGuardiansLast30,
              data.guardians?.activeGuardiansLast30,
              data.summary?.guardians?.activeGuardiansLast30
            ]);

            const activeGuardiansPrev30 = pickFirst([
              data.activeGuardiansPrev30,
              data.guardians?.activeGuardiansPrev30,
              data.summary?.guardians?.activeGuardiansPrev30
            ]);

            const totalStudents = pickFirst([
              data.totalStudents,
              data.students?.totalStudents,
              data.users?.totalStudents,
              data.summary?.students?.totalStudents,
              data.summary?.users?.totalStudents
            ]);

            const activeStudentsTotal = pickFirst([
              data.activeStudentsTotal,
              data.students?.activeStudentsTotal,
              data.users?.activeStudentsTotal,
              data.summary?.students?.activeStudentsTotal,
              data.summary?.users?.activeStudentsTotal
            ]);

            const activeTeachersLast30 = pickFirst([
              data.activeTeachersLast30,
              data.teachers?.activeTeachersLast30,
              data.summary?.teachers?.activeTeachersLast30
            ]);

            const activeTeachersPrev30 = pickFirst([
              data.activeTeachersPrev30,
              data.teachers?.activeTeachersPrev30,
              data.summary?.teachers?.activeTeachersPrev30
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

            // Daily unique dashboard users (count each user once per day)
            const dailyUniqueDashboardUsers = pickFirst([
              data.dailyUniqueDashboardUsers,
              data.dailyUniqueUsers,
              data.dailyUniqueDashboardUsersCount,
              data.summary?.usage?.dailyUniqueDashboardUsers,
              data.usage?.dailyUniqueUsers,
              data.dailyActiveUsers,
            ]);

            // Unique users in Thirty days (deduplicated)
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
            const timeseries = data.summary?.timeseries ?? data.timeseries ?? null;
            const past30Scheduled = Array.isArray(timeseries?.classesScheduled)
              ? timeseries.classesScheduled.reduce((sum, v) => sum + Number(v || 0), 0)
              : 0;
            const upcomingNext30 = pickFirst([
              data.classes?.upcomingNext30,
              data.upcomingClasses30,
              data.upcomingClasses
            ]);
            const expectedNext30 = pickFirst([
              data.classes?.expectedNext30,
              data.expectedClasses
            ]);
            const upcomingDelta = formatDelta(upcomingNext30, past30Scheduled);
            const expectedDelta = formatDelta(expectedNext30, past30Scheduled);
            const guardiansDelta = formatDelta(activeGuardiansLast30, activeGuardiansPrev30);
            const teachersDelta = formatDelta(activeTeachersLast30, activeTeachersPrev30);
            const inactiveStudentsAfterActivity = data.inactiveStudentsAfterActivity || data.students?.inactiveStudentsAfterActivity || data.summary?.students?.inactiveStudentsAfterActivity || [];

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
                    <HijriDateCard variant="inline" timeZone={user?.timezone} />
                    <div className="text-sm text-muted-foreground">
                      {stats.data && stats.data.timestamps && stats.data.timestamps.computedAt && (() => {
                        const d = new Date(stats.data.timestamps.computedAt);
                        if (Number.isNaN(d.getTime())) return null;
                        const date = `${d.getDate()}/${d.getMonth() + 1}`;
                        const hours = d.getHours() % 12 || 12;
                        const minutes = String(d.getMinutes()).padStart(2, '0');
                        const time = `${hours}:${minutes}`;
                        return <span>Updated {date} • {time}</span>;
                      })()}
                    </div>
                    <button
                      aria-label="Refresh"
                      title="Refresh"
                      className="ml-1 inline-flex items-center justify-center rounded-full text-white bg-gradient-to-r from-emerald-500 to-teal-500 shadow-sm hover:opacity-95 h-8 w-8"
                      onClick={async () => { try { await api.post('/dashboard/refresh'); await fetchStats(); } catch (e) { console.error(e); } }}
                    >
                      <RefreshCcw className="h-4 w-4" />
                    </button>

                  </div>
                </div>

                {/* Top area: three vertical columns for Classes, Users, Finance */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Classes column (single consolidated box) */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-foreground">Classes</div>
                    <div className="bg-gradient-to-br from-sky-50 via-card to-card rounded-xl p-4 border border-sky-100">
                      <div className="grid grid-cols-1 gap-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs text-muted-foreground">Upcoming classes (next 30 days)</div>
                            {upcomingDelta && (
                              <div className={`text-[11px] font-medium ${upcomingDelta.isUp ? 'text-emerald-600' : 'text-rose-600'}`}>{upcomingDelta.label}</div>
                            )}
                          </div>
                          <div className="text-base sm:text-lg font-semibold">{upcomingNext30}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs text-muted-foreground">Expected to end of month</div>
                            {expectedDelta && (
                              <div className={`text-[11px] font-medium ${expectedDelta.isUp ? 'text-emerald-600' : 'text-rose-600'}`}>{expectedDelta.label}</div>
                            )}
                          </div>
                          <div className="text-base sm:text-lg font-semibold">{expectedNext30}</div>
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
                          <div className="text-xs text-muted-foreground">Reported this month</div>
                          <div className="text-base sm:text-lg font-semibold">{Number(data.completedHoursThisMonth ?? 0).toFixed(2)} hrs</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Cancellations (month)</div>
                          <div className="text-base sm:text-lg font-semibold">{Number(data.cancelledHoursThisMonth ?? 0).toFixed(2)} hrs</div>
                        </div>

                      </div>
                    </div>
                  </div>

                  {/* Users column (single consolidated box) */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-foreground">Users</div>
                    <div className="bg-gradient-to-br from-emerald-50 via-card to-card rounded-xl p-4 border border-emerald-100">
                      <div className="grid grid-cols-1 gap-3">
                        

                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg bg-white/70 border border-emerald-100 p-2">
                            <div className="text-xs text-muted-foreground">Active students</div>
                            <div className="text-sm font-semibold">{activeStudentsTotal} <span className="text-xs text-muted-foreground">/ {totalStudents}</span></div>
                          </div>
                          <div className="rounded-lg bg-white/70 border border-emerald-100 p-2">
                            <div className="text-xs text-muted-foreground">Active teachers</div>
                            <div className="text-sm font-semibold">{activeTeachersTotal} <span className="text-xs text-muted-foreground">/ {totalTeachers}</span></div>
                            {teachersDelta && (
                              <div className={`text-[11px] font-medium ${teachersDelta.isUp ? 'text-emerald-600' : 'text-rose-600'}`}>{teachersDelta.label}</div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs text-muted-foreground">Active guardians (Thirty days)</div>
                            {guardiansDelta && (
                              <div className={`text-[11px] font-medium ${guardiansDelta.isUp ? 'text-emerald-600' : 'text-rose-600'}`}>{guardiansDelta.label}</div>
                            )}
                          </div>
                          <div className="text-base sm:text-lg font-semibold">{activeGuardiansLast30} <span className="text-xs text-muted-foreground">/ {totalGuardians}</span></div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">New users (this month)</div>
                          <div className="text-base sm:text-lg font-semibold">{newUsersThisMonth ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Unique devices (today)</div>
                          <div className="text-base sm:text-lg font-semibold">{dailyUniqueDashboardUsers ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Unique devices (Thirty days)</div>
                          <div className="text-base sm:text-lg font-semibold">{uniqueUsersLast30Days ?? 0}</div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Online now (dashboard)</div>
                          <div className="text-base sm:text-lg font-semibold">{currentActiveDashboardUsers ?? 0}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Finance column (single consolidated box) */}
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-foreground">Finance</div>
                    <div className="bg-gradient-to-br from-amber-50 via-card to-card rounded-xl p-4 border border-amber-100">
                      <div className="grid grid-cols-1 gap-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground">Revenue (month to date)</div>
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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
                    <DashboardChartCard title="Revenue (Thirty days)" subtitle="Daily revenue">
                      {(() => {
                        const ts = data.summary?.timeseries ?? data.timeseries ?? null;
                        const dates = (ts && ts.dates) ?? [];
                        const revenue = (ts && ts.revenue) ?? [];
                        const chartData = dates.map((d, i) => ({ date: d.slice(5), revenue: revenue[i] ?? 0 }));
                        return chartData.length === 0 ? (
                          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">No revenue data</div>
                        ) : (
                          <ResponsiveContainer height={140}>
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

                    <DashboardChartCard title="Classes (Thirty days)" subtitle="Scheduled vs completed">
                      {(() => {
                        const ts = data.summary?.timeseries ?? data.timeseries ?? null;
                        const dates = (ts && ts.dates) ?? [];
                        const scheduled = (ts && ts.classesScheduled) ?? [];
                        const completed = (ts && ts.classesCompleted) ?? [];
                        const chartData = dates.map((d, i) => ({ date: d.slice(5), scheduled: scheduled[i] ?? 0, completed: completed[i] ?? 0 }));
                        return chartData.length === 0 ? (
                          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">No class data</div>
                        ) : (
                          <ResponsiveContainer height={140}>
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
                  </div>

                  <div className="bg-card rounded-lg border border-border p-4 h-full flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Requests inbox</h3>
                        <p className="text-xs text-muted-foreground">Centralized messages for admins</p>
                      </div>
                      <div className="flex items-center gap-1 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setRequestsTab('teachers')}
                          className={`px-2 py-0.5 rounded-full border ${requestsTab === 'teachers' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted/40 text-muted-foreground border-border'}`}
                        >
                          Teachers
                          <span className={`ml-1 font-semibold ${teacherRequestsUnopened > 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>
                            ({teacherRequestsUnopened})
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setRequestsTab('guardians')}
                          className={`px-2 py-0.5 rounded-full border ${requestsTab === 'guardians' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted/40 text-muted-foreground border-border'}`}
                        >
                          Guardians
                          <span className={`ml-1 font-semibold ${guardianRequestsUnopened > 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>
                            ({guardianRequestsUnopened})
                          </span>
                        </button>
                      </div>
                    </div>
                    <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground flex-1 overflow-y-auto text-center">
                      <div className="min-h-[160px] flex items-center justify-center">
                        {requestsTab === 'teachers'
                          ? 'Teacher requests will appear here. This will replace WhatsApp with a structured request flow.'
                          : 'Guardian requests will appear here. This will replace WhatsApp with a structured request flow.'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Secondary lists placed side-by-side to reduce vertical length */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  <div className="bg-card rounded-lg border border-border p-4 lg:col-span-2">
                    <h3 className="text-sm font-semibold mb-2">Top owing guardians</h3>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      {(data.topOwingGuardians || data.guardians?.topOwingGuardians || []).slice(0,5).map((g, idx) => (
                        <div key={idx} className="flex items-center justify-between">
                          <div className="min-w-0 flex-1 truncate whitespace-nowrap pr-2">{g.guardian?.firstName ? `${g.guardian.firstName} ${g.guardian.lastName || ''}` : g.guardianId || 'Unknown'}</div>
                          <div className="font-semibold shrink-0">${g.totalOwed || 0}</div>
                        </div>
                      ))}
                      {((data.topOwingGuardians || data.guardians?.topOwingGuardians || []).length === 0) && <div className="text-xs text-muted-foreground">No outstanding balances</div>}
                    </div>
                  </div>

                  <div className="bg-card rounded-lg border border-border p-4 lg:col-span-2">
                    <h3 className="text-sm font-semibold mb-2">Guardians low on hours</h3>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      {(data.guardiansLowHours || data.guardians?.guardiansLowHours || []).slice(0,5).map((g, idx) => (
                        <div key={idx} className="flex items-center justify-between">
                          <div className="min-w-0 flex-1 truncate whitespace-nowrap pr-2">{g.firstName} {g.lastName}</div>
                          <div className="text-xs shrink-0">{formatHoursTwoDecimals(g.guardianInfo?.totalHours ?? g.totalHours)} hrs</div>
                        </div>
                      ))}
                      {((data.guardiansLowHours || data.guardians?.guardiansLowHours || []).length === 0) && <div className="text-xs text-muted-foreground">No guardians need topping up</div>}
                    </div>
                  </div>

                  <div className="bg-card rounded-lg border border-border p-4 lg:col-span-4">
                    <h3 className="text-sm font-semibold mb-2">New students (last 30 days)</h3>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      {(data.newStudentsLast30Days || data.students?.newStudentsLast30Days || []).slice(0, 6).map((s) => {
                        const firstAttendedAt = s.firstAttendedAt ? new Date(s.firstAttendedAt) : null;
                        const firstClassAt = s.firstScheduledAt ? new Date(s.firstScheduledAt) : null;
                        const now = new Date();
                        const dateToShow = firstAttendedAt || firstClassAt;
                        const isUpcoming = dateToShow && dateToShow > now;
                        const hoursUntil = isUpcoming ? (dateToShow.getTime() - now.getTime()) / (1000 * 60 * 60) : null;
                        const dateColor = isUpcoming
                          ? (hoursUntil != null && hoursUntil <= 24 ? 'text-amber-600' : 'text-emerald-600')
                          : 'text-muted-foreground';

                        return (
                          <div key={`${s.studentId || s.studentName}-${s.teacherId || s.teacherName}`} className="flex items-center justify-between">
                            <div className="min-w-0 flex-1 truncate whitespace-nowrap pr-2">{s.studentName || 'Student'}{s.teacherName ? ` • ${s.teacherName}` : ''}</div>
                            <div className={`text-xs shrink-0 ${dateColor}`}>{dateToShow ? formatDateDDMMMYYYY(dateToShow) : '—'}</div>
                          </div>
                        );
                      })}
                      {((data.newStudentsLast30Days || data.students?.newStudentsLast30Days || []).length === 0) && (
                        <div className="text-xs text-muted-foreground">No new students in the last 30 days</div>
                      )}
                    </div>
                  </div>

                  <div className="bg-card rounded-lg border border-border p-4 lg:col-span-2">
                    <h3 className="text-sm font-semibold mb-2">Inactive students (For 24h)</h3>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      {(inactiveStudentsAfterActivity || []).slice(0, 6).map((s) => (
                        <div key={s.studentId || s._id} className="flex items-center justify-between">
                          <div className="min-w-0 flex-1 truncate whitespace-nowrap pr-2">{s.studentName || 'Student'}</div>
                          <div className="text-xs shrink-0">{s.inactiveAt ? formatDateDDMMMYYYY(s.inactiveAt) : (s.lastClassAt ? formatDateDDMMMYYYY(s.lastClassAt) : '—')}</div>
                        </div>
                      ))}
                      {(!inactiveStudentsAfterActivity || inactiveStudentsAfterActivity.length === 0) && (
                        <div className="text-xs text-muted-foreground">No recent inactive students found</div>
                      )}
                    </div>
                  </div>

                  <div className="bg-card rounded-lg border border-border p-4 lg:col-span-2">
                    <h3 className="text-sm font-semibold mb-2">Users on vacation</h3>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      {(() => {
                        const teachers = (data.teachersOnVacationList || data.teachers?.teachersOnVacationList || []).map((t) => ({
                          key: `t:${t._id || t.id || `${t.firstName || ''}${t.lastName || ''}`}`,
                          label: `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'Teacher',
                          until: t.vacationEndDate || t.vacationEnd || t.endDate || null
                        }));
                        const students = (data.studentsOnVacationList || data.students?.studentsOnVacationList || []).map((s) => ({
                          key: `s:${s.studentId || s._id || s.id}`,
                          label: s.studentName || s.userName || 'Student',
                          until: s.endDate || s.effectiveEndDate || null
                        }));
                        const combined = [...teachers, ...students].slice(0, 8);

                        return combined.length === 0 ? (
                          <div className="text-xs text-muted-foreground">No users on vacation</div>
                        ) : (
                          combined.map((u) => (
                            <div key={u.key} className="flex items-center justify-between">
                              <div className="min-w-0 flex-1 truncate whitespace-nowrap pr-2">{u.label}</div>
                              <div className="text-xs shrink-0">{u.until ? `until ${formatDateDDMMMYYYY(u.until)}` : ''}</div>
                            </div>
                          ))
                        );
                      })()}
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-gradient-to-r from-primary/10 to-card rounded-xl p-3 sm:p-4 border border-primary/20 lg:col-span-2 shadow-sm">
            <h2 className="text-xl sm:text-2xl font-semibold mb-1 sm:mb-2 text-foreground">{greetingTitle}</h2>
            {greetingSubtitle ? (
              <p className="text-sm text-muted-foreground">{greetingSubtitle}</p>
            ) : (
              <p className="text-sm text-muted-foreground">You have <strong className="text-foreground">{upcomingCount}</strong> classes scheduled for today. Keep up the great work!</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Timezone: {user?.timezone || '—'}</span>
              <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-xs font-medium text-foreground">Upcoming: {upcomingCount}</span>
              <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground">Pending reports: {pendingTotal}</span>
            </div>
          </div>
          <div className="lg:col-span-1">
            <HijriDateCard timeZone={user?.timezone} />
          </div>
        </div>

        {Array.isArray(data.studentsOnVacationList) && data.studentsOnVacationList.length > 0 && (
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold mb-2">Currently on vacation</h3>
            <div className="space-y-2 text-sm text-muted-foreground">
              {data.studentsOnVacationList.slice(0, 6).map((s) => (
                <div key={s.studentId || s._id} className="flex items-center justify-between">
                  <div className="truncate">{s.studentName || 'Student'}</div>
                  <div className="text-xs">{s.endDate ? `until ${formatDateDDMMMYYYY(s.endDate)}` : ''}</div>
                </div>
              ))}
            </div>
          </div>
        )}

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

              <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="text-base sm:text-lg font-semibold text-foreground">Pending Reports</h3>
                  <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground">{pendingTotal || 0}</span>
                </div>
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
    const remainingHours = data.guardianHours ?? data.guardianInfo?.totalHours ?? 0;

    // (greeting computed globally as greetingTitle/greetingSubtitle)

    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 lg:grid-rows-2 gap-4">
          <div className="lg:col-span-2 lg:row-span-1 rounded-2xl border border-border bg-gradient-to-r from-sidebar-accent/45 via-sidebar-accent/25 to-primary/35 p-4 sm:p-5 shadow-sm">
            <h2 className="text-xl font-semibold mb-1 text-foreground">{greetingTitle}</h2>
            {greetingSubtitle ? (
              <p className="text-sm text-muted-foreground">{greetingSubtitle}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{lastLoginGlobal ? `Last visit: ${lastLoginGlobal ? formatClassDate(lastLoginGlobal) : '—'}` : `Welcome—this looks like your first visit.`}</p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-primary/20 bg-background/70 px-2 py-0.5 text-xs font-medium text-foreground">Timezone: {user?.timezone || '—'}</span>
              <span className="rounded-full border border-border bg-background/70 px-2 py-0.5 text-xs font-medium text-foreground">Students: {myChildrenCount}</span>
              <span className="rounded-full border border-border bg-background/70 px-2 py-0.5 text-xs font-medium text-foreground">Remaining: {remainingHours} hrs</span>
              {upcomingClass?.scheduledDate && (
                <span className="rounded-full border border-border bg-background/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">Next: {formatDateDDMMMYYYY(upcomingClass.scheduledDate)}</span>
              )}
            </div>
          </div>

          {/* Force placement: start at col 3 / row 1 so it can span both rows */}
          <div className="lg:col-start-3 lg:row-start-1 lg:row-span-2 h-full">
            <HijriDateCard timeZone={user?.timezone} />
          </div>

          <div className="lg:col-span-2 lg:row-span-1 rounded-2xl border border-yellow-300/70 bg-yellow-50 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between shadow-sm">
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-[0.25em] text-yellow-700 uppercase">Need a check-in?</p>
              <h3 className="text-base sm:text-lg font-semibold text-yellow-950">Schedule an admin follow-up</h3>
              <p className="text-sm text-yellow-900/80">Pick a yellow slot to review progress, billing, or future plans. One per student each month.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowGuardianFollowUpModal(true)}
              className="inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-95"
            >
              Schedule follow-up
            </button>
          </div>
        </div>

        {Array.isArray(data.studentsOnVacationList) && data.studentsOnVacationList.length > 0 && (
          <div className="bg-card rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold mb-2">Currently on vacation</h3>
            <div className="space-y-2 text-sm text-muted-foreground">
              {data.studentsOnVacationList.slice(0, 6).map((s) => (
                <div key={s.studentId || s._id} className="flex items-center justify-between">
                  <div className="truncate">{s.studentName || 'Student'}</div>
                  <div className="text-xs">{s.endDate ? `until ${formatDateDDMMMYYYY(s.endDate)}` : ''}</div>
                </div>
              ))}
            </div>
          </div>
        )}

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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <StatCard title="Remaining hours" value={`${(data.guardianHours ?? data.guardianInfo?.totalHours ?? 0)} hrs`} Icon={Clock} color="bg-primary/10 text-primary" />
          <StatCard title="My Students" value={myChildrenCount} Icon={Users} color="bg-sidebar-accent/25 text-sidebar-accent-foreground" />
          {/* Combined Hours card: total hours + small per-student list */}
          <div className="bg-gradient-to-br from-primary/5 via-card to-card rounded-lg border border-primary/15 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Consumed hours (last 30 days)</p>
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
                  <div className="mt-2 text-xs text-muted-foreground">No hours recorded in the Thirty days</div>
                )}
              </div>
              <div className="flex flex-col items-center">
                <div className="h-10 w-10 rounded-full flex items-center justify-center bg-primary/10 text-primary">
                  <Calendar className="h-5 w-5" />
                </div>
                {Array.isArray(data.recentStudentHours) && data.recentStudentHours.length > 0 && (
                  <button
                    className="mt-2 text-xs text-primary hover:underline"
                    onClick={() => navigate(isGuardian() ? '/dashboard/my-students' : '/dashboard/students')}
                  >
                    View all
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Custom Last Paid Hours card: larger hours, smaller timestamp, small message when none */}
          <div className="bg-gradient-to-br from-sidebar-accent/10 via-card to-card rounded-lg border border-sidebar-accent/25 p-4">
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-gradient-to-r from-primary/10 to-card rounded-xl p-3 sm:p-4 border border-primary/20 lg:col-span-2 shadow-sm">
          <h2 className="text-xl sm:text-2xl font-semibold mb-2 text-foreground">{greetingTitle}</h2>
          {greetingSubtitle ? (
            <p className="text-sm text-muted-foreground">{greetingSubtitle}</p>
          ) : (
            <p className="text-sm text-muted-foreground">You have <strong className="text-foreground">{stats.data.upcomingClasses || 0}</strong> classes coming up.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Timezone: {user?.timezone || '—'}</span>
            <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-xs font-medium text-foreground">Upcoming: {stats.data.upcomingClasses || 0}</span>
          </div>
        </div>
        <div className="lg:col-span-1">
          <HijriDateCard timeZone={user?.timezone} />
        </div>
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
    <div className="p-3 sm:p-4">
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
