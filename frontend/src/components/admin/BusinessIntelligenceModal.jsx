import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, ComposedChart, ReferenceLine
} from 'recharts';
import { fetchBusinessIntelligence } from '../../api/businessIntelligence';
import { TIMEZONE_LIST } from '../../utils/timezoneUtils';
import {
  X, Users, Clock, DollarSign, Target, BarChart3,
  Calendar, Lightbulb, ChevronDown, ChevronUp, RefreshCcw, AlertTriangle,
  Settings2, RotateCcw, Download, TrendingUp, TrendingDown, Info
} from 'lucide-react';

const TABS = [
  { key: 'operations', label: 'Operations', icon: Clock },
  { key: 'capacity', label: 'Teachers & Hiring', icon: Users },
  { key: 'financial', label: 'Financial', icon: DollarSign },
  { key: 'campaign', label: 'Campaign Plan', icon: Target },
];

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

// DST-aware IANA timezone offset
function getIANAOffset(iana) {
  try {
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: iana,
      timeZoneName: 'longOffset'
    });
    const parts = formatter.formatToParts(new Date());
    const offsetStr = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+0';
    const m = offsetStr.match(/GMT([+-]?)(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    const h = parseInt(m[2] || '0', 10);
    const mins = parseInt(m[3] || '0', 10);
    return sign * (h + mins / 60);
  } catch {
    return 0;
  }
}
function convertHourUTC(hourUTC, iana) {
  const off = getIANAOffset(iana);
  return ((hourUTC + Math.round(off)) % 24 + 24) % 24;
}

function fmt(v, d = 2) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : '—';
}
function fmtUSD(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}
function fmtPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}

function BigNumber({ label, value, sub, color = 'text-foreground', className = '' }) {
  return (
    <div className={`rounded-xl border border-border bg-card p-3 ${className}`}>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold ${color} mt-0.5`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function OverrideTag() {
  return <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 rounded px-1 py-0.5 font-medium align-middle">CUSTOM</span>;
}

function Collapsible({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition text-left">
        <span className="font-medium text-sm">{title}</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && <div className="px-4 py-3 text-sm leading-relaxed">{children}</div>}
    </div>
  );
}

// ─── Operations Tab ─────────────────────────────────────────────────
function OperationsTab({ data, hourRate }) {
  const h = data.hours || {};
  const s = data.students || {};
  const hist = data.historicalTrend || [];
  const summary = data.historicalSummary || {};
  const seasonal = data.seasonalPatterns || [];
  const growth = s.growthByMonth || [];
  const fin = data.financial || {};
  const revenueThis = fin.revenueThisMonth ?? 0;
  const revenuePrev = fin.prevMonthRevenue ?? 0;
  const revenueChange = fin.revenueChangeVsPrev;
  const peakLabel = summary.peakHoursYear && summary.peakHoursMonth
    ? `${MONTH_NAMES[summary.peakHoursMonth]} ${summary.peakHoursYear}`
    : 'all-time';

  return (
    <div className="space-y-5">

      {/* ── This Month ── */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">This Month</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Completed" value={`${fmt(h.completedHours)} hrs`} sub={`${h.completedClasses} classes`} color="text-emerald-600" />
          <BigNumber label="Scheduled" value={`${fmt(h.scheduledHoursRemaining)} hrs`} sub={`${h.scheduledClasses} remaining`} color="text-blue-600" />
          <BigNumber label="Cancelled" value={`${fmt(h.cancelledHours)} hrs`} sub={`${h.cancelledClasses} classes · ${fmtPct(h.cancellationRate)}`} color="text-rose-500" />
          <BigNumber label="Est. Total" value={`${fmt(h.estimatedTotalHours)} hrs`} sub={h.hoursChangeVsPrev != null ? `${h.hoursChangeVsPrev > 0 ? '+' : ''}${fmt(h.hoursChangeVsPrev, 1)}% vs prev month` : 'Completed + scheduled'} />
        </div>
      </section>

      {/* ── Students ── */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Students</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Active" value={s.activeStudents} sub={`of ${s.totalStudents} total enrolled`} color="text-emerald-600" />
          <BigNumber label="New Enrollments" value={s.newLast30Days} sub={`60d: ${s.newLast60Days} · 90d: ${s.newLast90Days}`} />
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">At-Risk</div>
            <div className={`text-xl font-bold mt-0.5 ${s.atRiskStudents > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>{s.atRiskStudents}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Active students with no</div>
            <div className="text-[11px] text-muted-foreground">completed class in 30 days</div>
          </div>
          <BigNumber label="Avg hrs/student" value={`${fmt(s.avgHoursPerStudent)} hrs`} sub="This month · active students" />
        </div>
      </section>

      {/* ── Growth, Stoppage & Revenue ── */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Growth, Stoppage &amp; Revenue</h3>
        <div className="grid grid-cols-3 gap-2 mb-3">

          {/* Net Growth 3mo */}
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Net Growth (3 months)</div>
            <div className={`text-xl font-bold mt-0.5 ${(s.netGrowth3Months ?? 0) > 0 ? 'text-emerald-600' : (s.netGrowth3Months ?? 0) < 0 ? 'text-rose-500' : 'text-muted-foreground'}`}>
              {(s.netGrowth3Months ?? 0) > 0 ? '+' : ''}{s.netGrowth3Months ?? 0}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              <span className="text-emerald-600 font-medium">+{s.newByClass3Mo ?? 0}</span> had first class
            </div>
            <div className="text-[11px] text-muted-foreground">
              <span className="text-rose-500 font-medium">−{s.stoppedByClass3Mo ?? 0}</span> last class in period
            </div>
            <div className="text-[10px] text-muted-foreground/60 mt-1">Based on completed classes · 3-month window</div>
          </div>

          {/* Stopped 90d */}
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Stopped (90 days)</div>
            <div className={`text-xl font-bold mt-0.5 ${(s.stoppedLast90Days ?? 0) > 2 ? 'text-rose-500' : 'text-muted-foreground'}`}>
              {s.stoppedLast90Days ?? 0} students
            </div>
            {s.stoppedHoursLast90Days > 0 && (
              <div className="text-[11px] text-muted-foreground mt-1">
                ~{fmt(s.stoppedHoursLast90Days, 0)} hrs/mo capacity freed
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">{s.totalStoppedRecent ?? 0} total inactive (had classes)</div>
            <div className="text-[10px] text-muted-foreground/60 mt-1">Stopped and not resumed with any teacher</div>
          </div>

          {/* Revenue vs Prev */}
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Revenue vs Prev Month</div>
            {revenueChange != null ? (
              <>
                <div className={`text-xl font-bold mt-0.5 ${revenueChange > 0 ? 'text-emerald-600' : revenueChange < 0 ? 'text-rose-500' : 'text-muted-foreground'}`}>
                  {revenueChange > 0 ? '▲' : revenueChange < 0 ? '▼' : '='} {Math.abs(revenueChange).toFixed(1)}%
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">This: {fmtUSD(revenueThis)}</div>
                <div className="text-[11px] text-muted-foreground">Prev: {fmtUSD(revenuePrev)}</div>
                <div className={`text-[11px] font-semibold mt-0.5 ${revenueChange > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {revenueChange > 0 ? '+' : ''}{fmtUSD(revenueThis - revenuePrev)}
                </div>
              </>
            ) : (
              <>
                <div className="text-xl font-bold mt-0.5 text-muted-foreground">—</div>
                <div className="text-[11px] text-muted-foreground mt-1">This month: {fmtUSD(revenueThis)}</div>
                <div className="text-[10px] text-muted-foreground/60 mt-1">No previous month paid invoices yet</div>
              </>
            )}
          </div>
        </div>

        {growth.length > 0 && (
          <div className="h-44 bg-card rounded-xl border border-border p-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={growth} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="period" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} width={28} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="newStudents" fill="#22c55e" name="New" radius={[2, 2, 0, 0]} />
                <Bar dataKey="stopped" fill="#ef4444" name="Stopped" radius={[2, 2, 0, 0]} />
                <Line type="monotone" dataKey="netGrowth" stroke="#6366f1" name="Net" strokeWidth={1.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {s.recentlyStoppedStudents && s.recentlyStoppedStudents.length > 0 && (
          <div className="mt-2 rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2 bg-muted/30 flex items-center gap-2 border-b border-border">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Recently Stopped</span>
              <span className="text-[11px] text-muted-foreground">— date = last completed class</span>
            </div>
            <div className="divide-y divide-border">
              {s.recentlyStoppedStudents.map((st, i) => {
                const lastDate = st.stoppedAt ? new Date(st.stoppedAt) : null;
                const isValid = lastDate && !isNaN(lastDate.getTime());
                return (
                  <div key={i} className="flex items-center justify-between px-3 py-1.5 hover:bg-muted/10">
                    <span className="text-xs font-medium">{st.name || '—'}</span>
                    <div className="flex items-center gap-3">
                      {st.totalHours > 0 && (
                        <span className="text-[11px] text-muted-foreground">{fmt(st.totalHours, 0)} hrs total</span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {isValid ? lastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No class on record'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── Historical Summary ── */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Historical Summary · {summary.totalMonths} months on record
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Avg Monthly Hours</div>
            <div className="text-xl font-bold mt-0.5">{fmt(summary.avgMonthlyHours)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">All-time average</div>
            {summary.avgMonthlyHours3Mo != null && (
              <div className={`text-sm font-semibold mt-1 ${summary.avgMonthlyHours3Mo >= summary.avgMonthlyHours ? 'text-emerald-600' : 'text-rose-500'}`}>
                {fmt(summary.avgMonthlyHours3Mo)} <span className="text-[10px] font-normal text-muted-foreground">last 3 months</span>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Peak Hours</div>
            <div className="text-xl font-bold text-indigo-600 mt-0.5">{fmt(summary.peakHours)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Highest single month</div>
            {summary.peakHoursMonth && summary.peakHoursYear && (
              <div className="text-[11px] text-indigo-500/80">reached {MONTH_NAMES[summary.peakHoursMonth]} {summary.peakHoursYear}</div>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Avg Monthly Profit</div>
            <div className="text-xl font-bold mt-0.5">{fmtUSD(summary.avgMonthlyProfit)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">All-time average</div>
            {summary.avgMonthlyProfit3Mo != null && (
              <div className={`text-sm font-semibold mt-1 ${summary.avgMonthlyProfit3Mo >= summary.avgMonthlyProfit ? 'text-emerald-600' : 'text-rose-500'}`}>
                {fmtUSD(summary.avgMonthlyProfit3Mo)} <span className="text-[10px] font-normal text-muted-foreground">last 3 months</span>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Avg Profit %</div>
            <div className="text-xl font-bold text-emerald-600 mt-0.5">{fmtPct(summary.avgProfitPercent)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">All-time average margin</div>
          </div>
        </div>
      </section>

      {/* ── Charts side-by-side ── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Hours Trend (All Time)</h3>
          <div className="h-48 bg-card rounded-xl border border-border p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="period" tick={{ fontSize: 9 }} interval={Math.max(1, Math.floor((hist.length || 1) / 8))} />
                <YAxis tick={{ fontSize: 9 }} width={32} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="teachingHours" stroke="#6366f1" name="Hours" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
                {summary.peakHours > 0 && (
                  <ReferenceLine y={summary.peakHours} stroke="#f59e0b" strokeDasharray="4 2"
                    label={{ value: `Peak · ${peakLabel}`, position: 'insideTopRight', fontSize: 8, fill: '#92400e' }} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Seasonal Avg (by Month)</h3>
          <div className="h-48 bg-card rounded-xl border border-border p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={seasonal} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tickFormatter={m => MONTH_NAMES[m] || m} tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} width={32} />
                <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => [fmt(v), 'Avg Hours']} labelFormatter={m => MONTH_NAMES[m] || m} />
                <Bar dataKey="avgHours" name="Avg Hours" radius={[3, 3, 0, 0]}>
                  {seasonal.map((entry, index) => {
                    const maxHrs = Math.max(...seasonal.map(se => se.avgHours || 0));
                    return <Cell key={index} fill={entry.avgHours === maxHrs ? '#f59e0b' : '#6366f1'} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Teacher Capacity Tab ───────────────────────────────────────────
function CapacityTab({ data, timezone }) {
  const cap = data.teacherCapacity || {};
  const teachers = cap.teachers || [];
  const timeDist = data.timeDistribution || [];

  // DST-aware timezone label (short form from IANA)
  const tzLabelFull = TIMEZONE_LIST.find(o => o.value === timezone)?.label || timezone;
  const tzCity = TIMEZONE_LIST.find(o => o.value === timezone)?.city || timezone;

  // Month range label
  const monthStart = cap.monthStartDate ? new Date(cap.monthStartDate) : null;
  const today = new Date();
  const monthRangeLabel = monthStart
    ? `${monthStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'This month';

  // Build per-cell heatmap (converted to selected timezone)
  const heatmap = {};
  let maxCount = 0;
  timeDist.forEach(t => {
    const ch = convertHourUTC(t.hourUTC, timezone);
    const key = `${t.dayOfWeek}-${ch}`;
    heatmap[key] = (heatmap[key] || 0) + t.classCount;
    if (heatmap[key] > maxCount) maxCount = heatmap[key];
  });

  // Group into 3-hour slots for demand bands: 6-8, 9-11, 12-14, 15-17, 18-20, 21-23
  const HOUR_BANDS = [
    { start: 6,  end: 8,  label: '6–8 AM'   },
    { start: 9,  end: 11, label: '9–11 AM'  },
    { start: 12, end: 14, label: '12–2 PM'  },
    { start: 15, end: 17, label: '3–5 PM'   },
    { start: 18, end: 20, label: '6–8 PM'   },
    { start: 21, end: 23, label: '9–11 PM'  },
  ];
  const days = [1, 2, 3, 4, 5, 6, 7]; // Sun=1 ... Sat=7

  // Aggregate counts per band per day
  const bandMatrix = days.map(d => ({
    day: d,
    bands: HOUR_BANDS.map(band => {
      let count = 0;
      for (let h = band.start; h <= band.end; h++) count += heatmap[`${d}-${h}`] || 0;
      return { ...band, count };
    })
  }));

  // Global max across all bands (for color scaling)
  let bandMax = 0;
  bandMatrix.forEach(row => row.bands.forEach(b => { if (b.count > bandMax) bandMax = b.count; }));

  const getBandColor = (count) => {
    if (!count) return { bg: 'bg-muted/15', text: 'text-muted-foreground/40' };
    const intensity = count / Math.max(bandMax, 1);
    if (intensity > 0.75) return { bg: 'bg-indigo-600', text: 'text-white' };
    if (intensity > 0.5)  return { bg: 'bg-indigo-400', text: 'text-white' };
    if (intensity > 0.25) return { bg: 'bg-indigo-200', text: 'text-indigo-900' };
    return { bg: 'bg-indigo-100', text: 'text-indigo-700' };
  };

  // Compute total demand per band (across all days) for hiring recommendations
  const bandTotals = HOUR_BANDS.map((band, bi) => ({
    ...band,
    totalCount: bandMatrix.reduce((sum, row) => sum + row.bands[bi].count, 0),
    topDays: [...bandMatrix]
      .sort((a, b) => b.bands[bi].count - a.bands[bi].count)
      .slice(0, 3)
      .filter(row => row.bands[bi].count > 0)
      .map(row => DAY_NAMES[row.day])
  })).sort((a, b) => b.totalCount - a.totalCount);

  // Per-teacher table: compute min/max for coloring
  const hoursValues = teachers.map(t => t.hoursThisMonth).filter(v => v != null);
  const classValues = teachers.map(t => t.classCount).filter(v => v != null);
  const studentValues = teachers.map(t => t.studentCount).filter(v => v != null);
  const maxHours = Math.max(...hoursValues);
  const minHours = Math.min(...hoursValues);
  const maxClasses = Math.max(...classValues);
  const minClasses = Math.min(...classValues);
  const maxStudents = Math.max(...studentValues);
  const minStudents = Math.min(...studentValues);

  function cellColor(val, max, min, good = 'text-emerald-600', bad = 'text-rose-500') {
    if (val == null || max === min) return '';
    if (val === max) return good;
    if (val === min) return bad;
    return '';
  }

  // Rate sort: show rate from invoice or custom override
  const rateValues = teachers.map(t => t.rateUSD).filter(v => v != null);
  const maxRate = rateValues.length ? Math.max(...rateValues) : null;
  const minRate = rateValues.length ? Math.min(...rateValues) : null;

  return (
    <div className="space-y-5">

      {/* ── Capacity Overview ── */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Capacity Overview
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Active Teachers" value={cap.activeTeachers} sub="With classes this month" />
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Total Hours</div>
            <div className="text-xl font-bold mt-0.5">{fmt(cap.totalHoursThisMonth)} hrs</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{monthRangeLabel}</div>
            <div className="text-[10px] text-muted-foreground/60">Completed + scheduled remaining</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Avg per Teacher</div>
            <div className="text-xl font-bold mt-0.5">{fmt(cap.avgHoursPerTeacher)} <span className="text-sm font-normal">hrs/mo</span></div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{fmt(cap.avgHoursPerTeacherWeekly)} hrs/wk avg</div>
            <div className="text-[10px] text-muted-foreground/60">{monthRangeLabel}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Busiest Teacher</div>
            <div className="text-xl font-bold mt-0.5">{fmt(cap.maxTeacherHours)} <span className="text-sm font-normal">hrs</span></div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{teachers[0]?.name || '—'}</div>
            <div className="text-[10px] text-muted-foreground/60">{monthRangeLabel}</div>
          </div>
        </div>
      </section>

      {/* ── Per-Teacher Breakdown ── */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Per-Teacher Breakdown
          <span className="ml-2 normal-case font-normal text-muted-foreground/60">{monthRangeLabel}</span>
        </h3>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/30">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Teacher</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Hrs/Mo</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Hrs/Wk</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Classes</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Days</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Students</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Rate/hr</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t, i) => (
                <tr key={i} className="border-t border-border hover:bg-muted/10">
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${cellColor(t.hoursThisMonth, maxHours, minHours)}`}>
                    {fmt(t.hoursThisMonth)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{fmt(t.hoursPerWeek)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${cellColor(t.classCount, maxClasses, minClasses)}`}>
                    {t.classCount}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{t.daysActive}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${cellColor(t.studentCount, maxStudents, minStudents)}`}>
                    {t.studentCount}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {t.rateUSD != null ? (
                      <span className={`font-semibold ${
                        t.hasCustomRate ? 'text-amber-600' :
                        (maxRate !== null && minRate !== null && maxRate !== minRate && t.rateUSD === maxRate) ? 'text-rose-500' :
                        (maxRate !== null && minRate !== null && maxRate !== minRate && t.rateUSD === minRate) ? 'text-emerald-600' : ''
                      }`}>
                        {fmtUSD(t.rateUSD)}
                        {t.hasCustomRate && <span className="ml-0.5 text-[9px] font-normal opacity-70">★</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {teachers.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/20">
                  <td className="px-3 py-2 font-semibold text-muted-foreground">Total / Avg</td>
                  <td className="px-3 py-2 text-right font-bold">{fmt(cap.totalHoursThisMonth)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-muted-foreground">{fmt(cap.avgHoursPerTeacherWeekly)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-muted-foreground">
                    {teachers.reduce((s, t) => s + (t.classCount || 0), 0)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                  <td className="px-3 py-2 text-right font-semibold text-muted-foreground">
                    {rateValues.length
                      ? fmtUSD(rateValues.reduce((a, b) => a + b, 0) / rateValues.length)
                      : '—'}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="flex gap-3 mt-1.5 text-[10px] text-muted-foreground">
          <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />Highest in column</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-rose-500 mr-1" />Lowest in column</span>
          <span><span className="text-amber-600 font-bold mr-1">★</span>Custom rate override</span>
        </div>
      </section>

      {/* ── Demand Heatmap ── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Weekly Demand by Time Band
          </h3>
          <span className="text-[10px] text-muted-foreground bg-muted/40 rounded px-2 py-0.5">
            Last 3 months · {tzCity} time · 3-hour windows
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/30">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-14">Day</th>
                {HOUR_BANDS.map(b => (
                  <th key={b.label} className="text-center px-2 py-2 font-medium text-muted-foreground">{b.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bandMatrix.map(row => (
                <tr key={row.day} className="border-t border-border">
                  <td className="px-3 py-1.5 font-semibold text-muted-foreground">{DAY_NAMES[row.day]}</td>
                  {row.bands.map((band, bi) => {
                    const { bg, text } = getBandColor(band.count);
                    return (
                      <td key={bi} className="px-1 py-1 text-center">
                        <div className={`rounded-lg ${bg} ${text} py-1.5 px-1 mx-0.5 transition-all`}
                          title={`${DAY_NAMES[row.day]} ${band.label} — ${band.count} classes`}>
                          <div className="font-bold text-sm leading-tight">{band.count || <span className="opacity-30">·</span>}</div>
                          {band.count > 0 && <div className="text-[9px] opacity-70 leading-tight">classes</div>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
          <span className="font-medium">Demand:</span>
          {[
            { bg: 'bg-muted/20', label: 'None' },
            { bg: 'bg-indigo-100', label: 'Low' },
            { bg: 'bg-indigo-200', label: 'Moderate' },
            { bg: 'bg-indigo-400', label: 'High' },
            { bg: 'bg-indigo-600', label: 'Peak' },
          ].map(item => (
            <span key={item.label} className="flex items-center gap-1">
              <span className={`inline-block w-3 h-3 rounded ${item.bg}`} />
              {item.label}
            </span>
          ))}
        </div>
      </section>

      {/* ── Hiring Recommendations ── */}
      {bandTotals.some(b => b.totalCount > 0) && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Hiring Recommendations
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {bandTotals.slice(0, 3).map((band, i) => (
              <div key={band.label} className={`rounded-xl border p-3 ${
                i === 0 ? 'border-indigo-300 bg-indigo-50' :
                i === 1 ? 'border-blue-200 bg-blue-50' :
                'border-slate-200 bg-slate-50'
              }`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    i === 0 ? 'bg-indigo-600 text-white' :
                    i === 1 ? 'bg-blue-500 text-white' :
                    'bg-slate-400 text-white'
                  }`}>#{i + 1}</span>
                  <span className={`text-sm font-bold ${
                    i === 0 ? 'text-indigo-900' : i === 1 ? 'text-blue-900' : 'text-slate-700'
                  }`}>{band.label}</span>
                  <span className="ml-auto text-[10px] font-medium text-muted-foreground">{band.totalCount} classes</span>
                </div>
                <p className={`text-[11px] ${i === 0 ? 'text-indigo-800' : i === 1 ? 'text-blue-800' : 'text-slate-600'}`}>
                  {band.topDays.length > 0
                    ? <>Busiest days: <strong>{band.topDays.join(', ')}</strong></>
                    : 'Spread across all days'}
                </p>
                <p className={`text-[11px] mt-1 ${i === 0 ? 'text-indigo-700' : i === 1 ? 'text-blue-700' : 'text-slate-500'}`}>
                  Hire teachers available <strong>{band.label}</strong>
                  {band.topDays.length > 0 && <>, especially on <strong>{band.topDays[0]}</strong></>}.
                </p>
              </div>
            ))}
          </div>
          {bandTotals.length > 3 && (
            <div className="mt-2 rounded-xl border border-border bg-card p-3">
              <div className="text-[11px] text-muted-foreground font-medium mb-1.5">Secondary demand slots</div>
              <div className="flex flex-wrap gap-2">
                {bandTotals.slice(3).filter(b => b.totalCount > 0).map(band => (
                  <span key={band.label} className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-[11px]">
                    <span className="font-medium">{band.label}</span>
                    <span className="text-muted-foreground">· {band.totalCount} classes</span>
                    {band.topDays.length > 0 && <span className="text-muted-foreground/70">({band.topDays[0]})</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ─── Financial Tab ──────────────────────────────────────────────────
function FinancialTab({ data, hourRate, teacherRateOverride, overheadOverride }) {
  const fin = data.financial || {};
  const be = data.breakEven || {};
  const hist = data.historicalTrend || [];

  // Effective values (overrides take priority over DB values)
  const rate        = hourRate          ?? fin.chargeRatePerHour      ?? 0;
  const tRate       = teacherRateOverride ?? fin.currentAvgTeacherRate ?? 0;
  const overhead    = overheadOverride  ?? fin.monthlyOverhead         ?? 0;
  const isCustom    = (hourRate != null && hourRate !== fin.chargeRatePerHour)
    || (teacherRateOverride != null && teacherRateOverride !== fin.currentAvgTeacherRate)
    || (overheadOverride    != null && overheadOverride    !== fin.monthlyOverhead);

  // Hours
  const completedHrs = fin.completedHoursThisMonth ?? be.currentHours ?? 0;
  const scheduledHrs = fin.scheduledHoursThisMonth ?? 0;
  const totalHrs     = completedHrs + scheduledHrs;

  // Revenue breakdown
  const earnedRev    = isCustom ? rate * completedHrs : (fin.earnedRevenueThisMonth ?? rate * completedHrs);
  const projectedRev = isCustom ? rate * totalHrs     : (fin.earnedRevenueThisMonth ?? 0) + (fin.scheduledRevenueThisMonth ?? 0);
  const collectedRev = fin.revenueThisMonth ?? 0;
  const prevCollected = fin.prevMonthRevenue ?? 0;

  // Costs
  const teacherCosts = fin.teacherCostsThisMonth ?? 0;

  // Profit
  const earnedProfit  = earnedRev - teacherCosts - overhead;
  const projectedProfit = projectedRev - teacherCosts - overhead;
  const profitMargin  = earnedRev > 0 ? (earnedProfit / earnedRev * 100) : 0;

  // Per-hour
  const overheadPerHr = totalHrs > 0 ? overhead / totalHrs : 0;
  const profitPerHr   = rate - tRate - overheadPerHr;

  // Break-even at $4/hr teacher
  const curHours     = be.currentHours ?? totalHrs;
  const targetRate   = 4.00;
  const profitAtTarget = rate - targetRate - overheadPerHr;
  const curTotalProfit = profitPerHr * curHours;
  const hoursNeeded  = be.hoursNeededAt4USD ?? (profitAtTarget > 0 ? curTotalProfit / profitAtTarget : null);
  const addlHrs      = be.additionalHoursNeeded ?? (hoursNeeded != null ? Math.max(0, hoursNeeded - curHours) : null);
  const addlStudents = be.additionalStudentsNeeded ?? (addlHrs != null ? Math.ceil(addlHrs / Math.max(data.students?.avgHoursPerStudent || 8, 1)) : null);
  const canAfford    = hoursNeeded != null && curHours >= hoursNeeded;

  const profitTrend = hist.map(h => ({
    period: h.period,
    revenue: h.currentMonthFees,
    expenses: h.moneyOut,
    profit: h.netProfitUSD,
    profitPct: h.profitPercent
  }));

  // Current tier from rate partitions
  const currentTier = fin.ratePartitions?.find(p => tRate >= p.minHours && tRate <= p.maxHours);

  function PnLRow({ label, earned, projected, collected, highlight, indent, note }) {
    const isNeg = earned < 0;
    return (
      <div className={`flex items-start gap-2 py-2 ${highlight ? 'border-t-2 border-border font-semibold' : 'border-t border-border/50'} ${indent ? 'pl-4 text-[11px] text-muted-foreground' : 'text-sm'}`}>
        <span className="flex-1">{label}{note && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/70">({note})</span>}</span>
        <span className={`w-28 text-right font-mono ${isNeg ? 'text-rose-500' : highlight && earned > 0 ? 'text-emerald-600' : ''}`}>{fmtUSD(earned)}</span>
        {projected != null && <span className="w-28 text-right font-mono text-muted-foreground">{fmtUSD(projected)}</span>}
        {collected != null && <span className="w-28 text-right font-mono text-muted-foreground/60">{fmtUSD(collected)}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── P&L Statement ── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Monthly P&amp;L — {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            {isCustom && <OverrideTag />}
          </h3>
          <div className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
            <Info className="h-3 w-3" />
            Earned = completed hrs × rate · Projected = all hrs × rate
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Column headers */}
          <div className="flex gap-2 px-4 py-2 bg-muted/30 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            <span className="flex-1"></span>
            <span className="w-28 text-right">Earned so far</span>
            <span className="w-28 text-right">Full month (est.)</span>
            <span className="w-28 text-right">Collected (paid)</span>
          </div>
          <div className="px-4">
            {/* Revenue */}
            <div className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest pt-3 pb-1">Income</div>
            <PnLRow
              label="Revenue"
              note={`${fmt(completedHrs)} hrs × ${fmtUSD(rate)}/hr`}
              earned={earnedRev}
              projected={projectedRev}
              collected={collectedRev}
            />
            {collectedRev === 0 && (
              <div className="pb-2 text-[11px] text-amber-600 flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                No paid invoices this month yet — collected shows $0 until guardians pay.
              </div>
            )}

            {/* Expenses */}
            <div className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest pt-3 pb-1">Expenses</div>
            <PnLRow
              label="Teacher Costs"
              note={`${fin.teacherCostsThisMonth != null ? 'from invoices' : 'estimated'}`}
              earned={teacherCosts}
              projected={teacherCosts}
              collected={teacherCosts}
            />
            <PnLRow
              label="Fixed Costs"
              note="admin + hosting + internet"
              earned={overhead}
              projected={overhead}
              collected={overhead}
              indent
            />

            {/* Profit */}
            <PnLRow
              label="Net Profit"
              earned={earnedProfit}
              projected={projectedProfit}
              collected={collectedRev - teacherCosts - overhead}
              highlight
            />
            <div className="flex gap-2 py-2 border-t border-border/50 text-[11px] text-muted-foreground">
              <span className="flex-1">Profit Margin</span>
              <span className={`w-28 text-right font-semibold ${profitMargin > 50 ? 'text-emerald-600' : profitMargin > 30 ? 'text-amber-600' : 'text-rose-500'}`}>
                {fmt(profitMargin)}%
              </span>
              <span className="w-28 text-right text-muted-foreground">
                {projectedRev > 0 ? `${fmt(projectedProfit / projectedRev * 100)}%` : '—'}
              </span>
              <span className="w-28 text-right text-muted-foreground/60">
                {collectedRev > 0 ? `${fmt((collectedRev - teacherCosts - overhead) / collectedRev * 100)}%` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* vs Previous month */}
        {prevCollected > 0 && (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs">
            {collectedRev >= prevCollected
              ? <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              : <TrendingDown className="h-3.5 w-3.5 text-rose-500" />}
            <span className="text-muted-foreground">
              Prev month collected: <strong>{fmtUSD(prevCollected)}</strong>
              {fin.revenueChangeVsPrev != null && (
                <span className={`ml-2 font-semibold ${fin.revenueChangeVsPrev >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  ({fin.revenueChangeVsPrev >= 0 ? '+' : ''}{fin.revenueChangeVsPrev}%)
                </span>
              )}
            </span>
          </div>
        )}
      </section>

      {/* ── Rate Structure ── */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Rate Structure {isCustom && <OverrideTag />}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Charge Rate</div>
            <div className="text-xl font-bold mt-0.5">{fmtUSD(rate)}<span className="text-xs font-normal">/hr</span></div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{fin.chargeRateSource || 'guardian settings'}</div>
            {fin.chargeRateDetail && (
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                Range: {fmtUSD(fin.chargeRateDetail.min)}–{fmtUSD(fin.chargeRateDetail.max)} ({fin.chargeRateDetail.sampleSize} items)
              </div>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Teacher Rate (avg)</div>
            <div className="text-xl font-bold mt-0.5">{fmtUSD(tRate)}<span className="text-xs font-normal">/hr</span></div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {fin.weightedTeacherRate3Mo ? `3mo avg: ${fmtUSD(fin.weightedTeacherRate3Mo)}` : 'weighted avg'}
            </div>
            <div className="text-[10px] text-muted-foreground/60 mt-0.5">Across all teachers</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Net Margin / hr</div>
            <div className={`text-xl font-bold mt-0.5 ${profitPerHr > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
              {fmtUSD(profitPerHr)}<span className="text-xs font-normal">/hr</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">After teacher + fixed costs</div>
            <div className="text-[10px] text-muted-foreground/60 mt-0.5">
              = {fmtUSD(rate)} − {fmtUSD(tRate)} − {fmtUSD(overheadPerHr)} overhead
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Exchange Rate</div>
            <div className="text-xl font-bold mt-0.5">{fmt(fin.currentExchangeRate)} <span className="text-sm font-normal">EGP</span></div>
            <div className="text-[11px] text-muted-foreground mt-0.5">per USD</div>
            <div className="text-[10px] text-muted-foreground/60 mt-0.5">Teacher costs in EGP basis</div>
          </div>
        </div>
      </section>

      {/* ── Teacher Rate Tiers ── */}
      {fin.ratePartitions && fin.ratePartitions.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Teacher Rate Tiers
            <span className="ml-2 normal-case font-normal text-muted-foreground/60">
              Current avg teacher rate: <strong className="text-foreground">{fmtUSD(tRate)}/hr</strong>
            </span>
          </h3>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/30">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Tier</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Hours Range</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Rate / hr</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Your Margin</th>
                  <th className="text-center px-3 py-2 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {fin.ratePartitions.map((p, i) => {
                  const margin = rate - p.rateUSD - overheadPerHr;
                  const isActive = tRate >= p.rateUSD - 0.01 && tRate <= p.rateUSD + 0.01;
                  const isNext = !isActive && p.rateUSD > tRate && (i === 0 || fin.ratePartitions[i-1].rateUSD <= tRate);
                  return (
                    <tr key={i} className={`border-t border-border ${isActive ? 'bg-indigo-50' : ''}`}>
                      <td className={`px-3 py-2 font-medium ${isActive ? 'text-indigo-700' : ''}`}>{p.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {p.minHours}–{p.maxHours >= 99999 ? '∞' : p.maxHours} hrs
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold ${isActive ? 'text-indigo-700' : ''}`}>
                        {fmtUSD(p.rateUSD)}
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold ${margin > 5 ? 'text-emerald-600' : margin > 3 ? 'text-amber-600' : 'text-rose-500'}`}>
                        {fmtUSD(margin)}/hr
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isActive ? (
                          <span className="inline-block text-[10px] bg-indigo-600 text-white rounded-full px-2 py-0.5 font-semibold">Current avg</span>
                        ) : isNext ? (
                          <span className="inline-block text-[10px] bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">Next tier</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Break-Even Analysis ── */}
      <section>
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <h3 className="text-sm font-bold text-amber-900">
              Break-Even Scenario — If Teacher Rate Rises to $4/hr {isCustom && <OverrideTag />}
            </h3>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Current state */}
              <div className="rounded-xl bg-white border border-amber-200 p-3">
                <div className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-2">Current State</div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Charge Rate</span>
                    <span className="font-semibold">{fmtUSD(rate)}/hr</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Teacher Rate (avg)</span>
                    <span className="font-semibold">{fmtUSD(tRate)}/hr</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fixed Costs / hr</span>
                    <span className="font-semibold">{fmtUSD(overheadPerHr)}/hr</span>
                  </div>
                  <div className="flex justify-between border-t border-amber-100 pt-2">
                    <span className="text-muted-foreground">Profit / hr</span>
                    <span className={`font-bold ${profitPerHr >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmtUSD(profitPerHr)}/hr</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Monthly Hours</span>
                    <span className="font-semibold">{fmt(curHours)} hrs</span>
                  </div>
                  <div className="flex justify-between border-t border-amber-100 pt-2">
                    <span className="text-muted-foreground">Est. Monthly Profit</span>
                    <span className={`font-bold text-base ${earnedProfit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmtUSD(earnedProfit)}</span>
                  </div>
                </div>
              </div>
              {/* At $4/hr scenario */}
              <div className="rounded-xl bg-white border border-amber-200 p-3">
                <div className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-2">At $4.00/hr Teacher Rate</div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Charge Rate</span>
                    <span className="font-semibold">{fmtUSD(rate)}/hr</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Teacher Rate</span>
                    <span className="font-semibold text-amber-700">{fmtUSD(targetRate)}/hr</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fixed Costs / hr</span>
                    <span className="font-semibold">{fmtUSD(overheadPerHr)}/hr</span>
                  </div>
                  <div className="flex justify-between border-t border-amber-100 pt-2">
                    <span className="text-muted-foreground">New Profit / hr</span>
                    <span className={`font-bold ${profitAtTarget >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{fmtUSD(profitAtTarget)}/hr</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Hrs needed (same profit)</span>
                    <span className="font-semibold">{hoursNeeded != null ? fmt(hoursNeeded) : '—'} hrs</span>
                  </div>
                  <div className="flex justify-between border-t border-amber-100 pt-2">
                    <span className="text-muted-foreground">Extra hrs / students needed</span>
                    <span className={`font-bold text-base ${canAfford ? 'text-emerald-600' : 'text-amber-700'}`}>
                      {addlHrs != null ? `+${fmt(addlHrs)} hrs` : '—'}
                      {addlStudents != null && <span className="text-sm font-normal"> ≈ {addlStudents} students</span>}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            {/* Verdict */}
            <div className={`mt-3 rounded-xl px-4 py-3 text-sm font-semibold flex items-start gap-2 ${canAfford ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
              <span className="text-lg leading-none mt-0.5">{canAfford ? '✓' : '✗'}</span>
              <span>
                {canAfford
                  ? `At current volume (${fmt(curHours)} hrs/mo), you can already afford a $4/hr teacher rate without losing profit.`
                  : `You need ${addlHrs != null ? fmt(addlHrs) : '?'} more hours/mo (≈ ${addlStudents ?? '?'} new students) to maintain the same profit if teacher rates rise to $4/hr.`}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Historical Charts ── */}
      {profitTrend.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">All-Time Revenue vs Expenses</h3>
          <div className="h-56 bg-card rounded-xl border border-border p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={profitTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} interval={5} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={{ fontSize: 12 }} formatter={v => fmtUSD(v)} />
                <Line type="monotone" dataKey="revenue"  stroke="#22c55e" name="Revenue"  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="expenses" stroke="#ef4444" name="Expenses" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="profit"   stroke="#6366f1" name="Profit"   strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Report Generator ───────────────────────────────────────────────
function generateTabReport(tab, data, opts = {}) {
  const { hourRate, teacherRateOverride, overheadOverride, budget, timezone } = opts;
  const fin = data.financial || {};
  const be  = data.breakEven || {};
  const cap = data.teacherCapacity || {};
  const stu = data.students || {};
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const rate     = hourRate ?? fin.chargeRatePerHour ?? 0;
  const tRate    = teacherRateOverride ?? fin.currentAvgTeacherRate ?? 0;
  const overhead = overheadOverride ?? fin.monthlyOverhead ?? 0;
  const completedHrs = fin.completedHoursThisMonth ?? be.currentHours ?? 0;
  const totalHrs = completedHrs + (fin.scheduledHoursThisMonth ?? 0);
  const earnedRev = fin.earnedRevenueThisMonth ?? (rate * completedHrs);
  const teacherCosts = fin.teacherCostsThisMonth ?? 0;
  const earnedProfit = earnedRev - teacherCosts - overhead;

  const header = `# Waraqa Business Intelligence Report — ${today}
## Tab: ${tab.toUpperCase()}
> Generated from live data. Send this report to Claude/ChatGPT for analysis and implementation.

### Business Snapshot
- **Active Students**: ${stu.activeStudents ?? '?'}
- **Total Students (DB)**: ${stu.totalStudents ?? '?'}
- **Active Teachers**: ${cap.activeTeachers ?? '?'}
- **Completed hrs this month**: ${fmt(completedHrs)} hrs
- **Projected total hrs**: ${fmt(totalHrs)} hrs
- **Charge Rate**: ${fmtUSD(rate)}/hr
- **Avg Teacher Rate**: ${fmtUSD(tRate)}/hr
- **Exchange Rate**: ${fmt(fin.currentExchangeRate)} EGP/USD
`;

  if (tab === 'financial') {
    return header + `
---
## FINANCIAL ANALYSIS

### This Month P&L (Accrual / Earned Basis)
| Line Item              | Amount     | Notes                        |
|------------------------|------------|------------------------------|
| Revenue Earned         | ${fmtUSD(earnedRev)}  | ${fmt(completedHrs)} hrs × ${fmtUSD(rate)}/hr |
| Revenue Collected      | ${fmtUSD(fin.revenueThisMonth ?? 0)} | Paid invoices only |
| Teacher Costs          | ${fmtUSD(teacherCosts)} | From published/paid invoices |
| Fixed Costs (Overhead) | ${fmtUSD(overhead)}   | Admin + hosting + internet   |
| **Net Profit (Earned)**| **${fmtUSD(earnedProfit)}** | Margin: ${fmt(earnedRev > 0 ? earnedProfit/earnedRev*100 : 0)}% |

### Rate Structure
- Charge Rate: ${fmtUSD(rate)}/hr (source: ${fin.chargeRateSource || 'guardian settings'})
- Teacher Rate: ${fmtUSD(tRate)}/hr (3mo avg: ${fmtUSD(fin.weightedTeacherRate3Mo ?? tRate)})
- Profit per Hour: ${fmtUSD(rate - tRate - (totalHrs > 0 ? overhead/totalHrs : 0))}/hr after all costs
- Exchange: ${fmt(fin.currentExchangeRate)} EGP/USD

### Teacher Rate Tiers
${(fin.ratePartitions || []).map(p => `- **${p.name}**: ${p.minHours}–${p.maxHours >= 99999 ? '∞' : p.maxHours} hrs → ${fmtUSD(p.rateUSD)}/hr (margin: ${fmtUSD(rate - p.rateUSD - (totalHrs > 0 ? overhead/totalHrs : 0))}/hr)`).join('\n')}

### Break-Even (if teacher rate rises to $4/hr)
- Current profit/hr: ${fmtUSD(rate - tRate - (totalHrs > 0 ? overhead/totalHrs : 0))}/hr at ${fmt(be.currentHours ?? totalHrs)} hrs/mo
- At $4/hr: profit/hr = ${fmtUSD(rate - 4 - (totalHrs > 0 ? overhead/totalHrs : 0))}/hr
- Hours needed to maintain profit: ${fmt(be.hoursNeededAt4USD ?? 0)} hrs/mo
- Additional hours/students needed: ${fmt(be.additionalHoursNeeded ?? 0)} hrs ≈ ${be.additionalStudentsNeeded ?? 0} students
- **Verdict**: ${(be.additionalHoursNeeded ?? 1) <= 0 ? 'Can afford $4/hr now at current volume.' : `Need ${fmt(be.additionalHoursNeeded ?? 0)} more hrs/mo to maintain profit.`}

### AI Instructions
You are a financial analyst for "Waraqa" — an online Quran teaching platform.
Based on the data above:
1. Identify risks and opportunities in the current financial structure
2. Suggest pricing adjustments if margin is too thin
3. Calculate the impact of teacher rate increases on profitability
4. Recommend at what student/hour volume the platform should raise prices
`;
  }

  if (tab === 'campaign') {
    const avgHrs = data.students?.avgHoursPerStudent || 8;
    const revPerStudent = rate * avgHrs;
    const profitPerStudent = (rate - tRate) * avgHrs;
    const channelBudgets = {
      google: Math.round(budget * 0.40),
      meta: Math.round(budget * 0.25),
      seo: Math.round(budget * 0.20),
      tiktok: Math.round(budget * 0.15),
    };
    return header + `
---
## MARKETING CAMPAIGN PLAN

### Campaign Budget: ${fmtUSD(budget)}/month
### Business Economics
- Revenue per new student: ${fmtUSD(revPerStudent)}/mo (${fmt(avgHrs)} hrs × ${fmtUSD(rate)}/hr)
- Profit per new student: ${fmtUSD(profitPerStudent)}/mo
- Break-even new students (cover ad spend): ${Math.ceil(budget / profitPerStudent)} students

### Channel Allocation
| Channel         | Budget    | % | Primary Goal                         |
|-----------------|-----------|---|--------------------------------------|
| Google Ads      | ${fmtUSD(channelBudgets.google)}/mo | 40% | Search intent — "online Quran classes" |
| Facebook/IG     | ${fmtUSD(channelBudgets.meta)}/mo | 25% | Awareness + retargeting parents      |
| SEO / Content   | ${fmtUSD(channelBudgets.seo)}/mo | 20% | Long-term organic — 3–6 month payoff |
| TikTok          | ${fmtUSD(channelBudgets.tiktok)}/mo | 15% | Brand awareness, teacher credibility |

### Realistic Projections
- Month 1: ~${Math.round(budget * 0.25)} leads → ~${Math.round(budget * 0.25 * 0.35)} enrolled students → ${fmtUSD(revPerStudent * Math.round(budget * 0.25 * 0.35))}/mo added revenue
- Month 3: Compounding. Expect 2–3× Month 1 results with SEO kicking in
- Month 6: SEO + retargeting delivering sustained leads with lower CPL

### Target Keywords (SEO + Google Ads)
online Quran classes, learn Quran online, Quran tutor for kids, Quran classes for children USA, online tajweed lessons, Quran memorization online, Islamic school online, Arabic Quran teacher

### AI Campaign Implementation Instructions
You are a digital marketing specialist helping "Waraqa" — an online Quran teaching platform — grow its student base.
**Context**:
- Current: ${stu.activeStudents ?? '?'} active students, ${fmt(totalHrs)} hrs/mo, ${fmtUSD(rate)}/hr charge rate
- Monthly ad budget: ${fmtUSD(budget)}
- Revenue per student acquired: ${fmtUSD(revPerStudent)}/mo
- Profit per student: ${fmtUSD(profitPerStudent)}/mo

**Your tasks**:
1. Write 3 Google Ads headlines + 2 descriptions for "online Quran classes" keyword group
2. Write 1 Facebook ad for parents of young children (5–12 year olds)
3. Suggest 5 TikTok video concepts to build trust with the Quran teaching niche
4. Create a 30-day content calendar with blog topics for SEO
5. Design a referral program structure that incentivizes existing guardians to refer friends
6. Calculate expected CAC (customer acquisition cost) and LTV (lifetime value) based on the numbers above
7. Recommend A/B test ideas for the enrollment landing page
`;
  }

  if (tab === 'operations') {
    const hist = data.historicalSummary || {};
    return header + `
---
## OPERATIONS ANALYSIS

### This Month
- Completed Classes: ${data.thisMonth?.completedClasses ?? '?'}
- Completed Hours: ${fmt(completedHrs)} hrs
- Scheduled Remaining: ${fmt(fin.scheduledHoursThisMonth ?? 0)} hrs
- Active Students: ${stu.activeStudents ?? '?'}

### Student Health
- New Students (30d): ${stu.newStudents30 ?? '?'}
- Net Growth (3mo): ${stu.netGrowth3Months ?? '?'} students
- Stopped (90d): ${stu.stoppedLast90Days ?? '?'} students
- Hours lost (stopped, 90d): ${fmt(stu.stoppedHoursLast90Days ?? 0)} hrs/mo lost

### Historical Benchmarks
- Avg Monthly Hours (all-time): ${fmt(hist.avgMonthlyHours ?? 0)} hrs
- Avg Monthly Hours (last 3mo): ${fmt(hist.avgMonthlyHours3Mo ?? 0)} hrs
- Peak Hours: ${fmt(hist.peakHours ?? 0)} hrs in ${hist.peakHoursMonth ? MONTH_NAMES[hist.peakHoursMonth] : '?'} ${hist.peakHoursYear ?? ''}
- Avg Monthly Profit (all-time): ${fmtUSD(hist.avgMonthlyProfit ?? 0)}

### AI Instructions
Analyze the operations data above for "Waraqa" (online Quran teaching platform).
1. Identify operational bottlenecks or warning signs
2. Explain why students are stopping and suggest retention strategies
3. Compare current hours to peak/average and suggest how to reach peak again
4. Recommend operational improvements to increase completed class rate
`;
  }

  if (tab === 'capacity') {
    const teachers = cap.teachers || [];
    return header + `
---
## TEACHER CAPACITY & HIRING

### Capacity This Month
- Active Teachers: ${cap.activeTeachers ?? '?'}
- Total Hours: ${fmt(cap.totalHoursThisMonth ?? 0)} hrs
- Avg Hours/Teacher: ${fmt(cap.avgHoursPerTeacher ?? 0)} hrs/mo (${fmt(cap.avgHoursPerTeacherWeekly ?? 0)} hrs/wk)

### Per-Teacher Summary
${teachers.map(t => `- **${t.name}**: ${fmt(t.hoursThisMonth)} hrs, ${t.classCount} classes, ${t.studentCount} students, rate: ${t.rateUSD != null ? fmtUSD(t.rateUSD)+'/hr' : 'unknown'}${t.hasCustomRate ? ' (custom)' : ''}`).join('\n')}

### AI Instructions
You are an HR/staffing specialist for "Waraqa" — an online Quran teaching platform.
1. Assess teacher workload balance (who is overloaded vs underutilized?)
2. Identify which time slots (from the heatmap) need new teacher coverage most urgently
3. Write a job description for a new Quran teacher position (part-time, online)
4. Suggest onboarding process for new teachers
5. Recommend how to structure teacher compensation to incentivize peak-hour availability
`;
  }

  return header + `\n(No specific analysis available for this tab.)\n`;
}

function downloadReport(tab, data, opts) {
  const content = generateTabReport(tab, data, opts);
  const blob = new Blob([content], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `waraqa-${tab}-report-${new Date().toISOString().slice(0,10)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Campaign Tab ───────────────────────────────────────────────────
function CampaignTab({ data, hourRate, budget }) {
  const fin      = data.financial || {};
  const cp       = data.campaignProjections || {};
  const seasonal = data.seasonalPatterns || [];
  const stu      = data.students || {};

  const rate           = hourRate ?? fin.chargeRatePerHour ?? 9.53;
  const teacherRate    = fin.currentAvgTeacherRate ?? 3.13;
  const completedHrs   = fin.completedHoursThisMonth ?? 0;
  const avgHrs         = cp.avgHoursPerStudent || (data.students?.avgHoursPerStudent || 8);
  const revenuePerStu  = rate * avgHrs;
  const profitPerStu   = (rate - teacherRate) * avgHrs;
  const breakEvenStus  = profitPerStu > 0 ? Math.ceil(budget / profitPerStu) : '?';
  const isCustom       = (hourRate != null && hourRate !== fin.chargeRatePerHour) || budget !== 100;

  // Channel budgets (always recalculate from budget)
  const chs = [
    {
      key:   'google',
      name:  'Google Ads',
      share: 0.40,
      color: '#4285F4',
      icon:  '🔍',
      goal:  'Capture high-intent parents actively searching',
      metrics: (b) => {
        const clicks  = Math.round(b / 2);
        const leads   = Math.round(clicks * 0.08);
        const studs   = Math.round(leads * 0.35);
        return { clicks, leads, studs, cpc: '$2.00', ctr: '8% conv.' };
      },
      actions: [
        'Target: "online Quran classes", "Quran tutor for kids", "learn Quran online USA"',
        'Schedule ads during peak hours: 6–8 PM, 9–11 AM (from heatmap)',
        'Use callout extensions: "Free Trial Class", "Certified Teachers", "Ages 5+"',
        'Landing page must show teacher photos, parent reviews, and a demo booking form',
      ],
    },
    {
      key:   'meta',
      name:  'Facebook & Instagram',
      share: 0.25,
      color: '#1877F2',
      icon:  '📱',
      goal:  "Reach parents who don't know they need Quran education yet",
      metrics: (b) => {
        const impressions = Math.round(b / 10 * 1000);
        const clicks      = Math.round(impressions * 0.02);
        const leads       = Math.round(clicks * 0.04);
        const studs       = Math.round(leads * 0.30);
        return { impressions: impressions.toLocaleString(), clicks, leads, studs, cpm: '$10' };
      },
      actions: [
        'Audience: Parents 25–45 with interests in Islam, education, Quran, children',
        'Ad format: Short video (15–30s) showing a real child learning with a teacher',
        'Retarget website visitors from Google Ads — they\'re warm leads',
        'Use Meta Advantage+ campaign type for automatic optimization',
        'Run in Arabic + English (separate ad sets for each language)',
      ],
    },
    {
      key:   'seo',
      name:  'SEO & Content',
      share: 0.20,
      color: '#22c55e',
      icon:  '📝',
      goal:  'Build long-term organic traffic (payoff in 3–6 months)',
      metrics: (b) => ({ note: 'Long-term', visits3mo: Math.round(b * 3), leads3mo: Math.round(b * 0.3), studs: Math.round(b * 0.1) }),
      actions: [
        'Publish 2–4 articles/week: tajweed rules, Quran for beginners, how to choose a Quran teacher',
        'Add EducationalOrganization schema markup to site pages',
        'Register on Google Business Profile (free, boosts local searches)',
        'Build backlinks by getting listed on Islamic directories and parenting sites',
        'Use Surfer SEO or NeuronWriter for AI-assisted keyword optimization',
      ],
    },
    {
      key:   'tiktok',
      name:  'TikTok / Reels',
      share: 0.15,
      color: '#000000',
      icon:  '🎬',
      goal:  'Brand awareness & teacher credibility for younger parents',
      metrics: (b) => {
        const views = Math.round(b * 500);
        const leads = Math.round(views * 0.002);
        const studs = Math.round(leads * 0.25);
        return { views: views.toLocaleString(), leads, studs, note: 'Organic reach × paid boost' };
      },
      actions: [
        'Post 3–5 videos/week: short tajweed tips, student progress clips, teacher introductions',
        'Boost top-performing organic videos with a small daily budget ($5–10/day)',
        'Use hashtags: #QuranForKids #LearnQuran #IslamicEducation #TajweedTips',
        'Tool: Opus Clip to auto-cut Zoom session recordings into short vertical clips',
        'Collaborate with Islamic influencers for 1–2 shoutouts per month',
      ],
    },
  ];

  const bestMonths = [...seasonal].sort((a, b) => b.avgHours - a.avgHours).slice(0, 3);

  // 30-day action plan
  const weeks = [
    {
      week: 'Week 1',
      tasks: [
        `Set up Google Business Profile (free)`,
        `Launch Google Ads — ${fmtUSD(Math.round(budget * 0.40))}/mo budget, "online Quran classes" campaign`,
        `Write 3 SEO articles targeting long-tail keywords`,
        `Install Google Search Console & Analytics`,
      ],
    },
    {
      week: 'Week 2',
      tasks: [
        `Create Facebook Page & Instagram — post 3 pieces of content`,
        `Launch Meta Ads — ${fmtUSD(Math.round(budget * 0.25))}/mo, video ad targeting parents`,
        `Publish Week 1 articles, submit sitemap to Google`,
        `Record first TikTok: "What is tajweed?" (30-second explainer)`,
      ],
    },
    {
      week: 'Week 3',
      tasks: [
        `Review Google Ads: pause low-CTR keywords, scale high-performers`,
        `A/B test 2 Meta ad creatives — parent testimonial vs child progress video`,
        `Publish 2 more SEO articles + 1 video tutorial on YouTube`,
        `Follow up with all trial class leads from weeks 1–2`,
      ],
    },
    {
      week: 'Week 4',
      tasks: [
        `Full channel performance review — CPC, CPL, enrolled vs leads`,
        `Reallocate budget: shift 10% from weakest channel to strongest`,
        `Launch retargeting campaign on Meta for website visitors`,
        `Plan month 2: scale winners, consider referral program`,
      ],
    },
  ];

  return (
    <div className="space-y-5">

      {/* ── Budget Overview ── */}
      <section>
        <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs text-indigo-700 font-semibold uppercase tracking-wide">Monthly Campaign Budget {isCustom && <OverrideTag />}</div>
              <div className="text-3xl font-bold text-indigo-900 mt-0.5">{fmtUSD(budget)}<span className="text-base font-normal text-indigo-700">/mo</span></div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-white rounded-xl border border-indigo-200 px-4 py-2">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Revenue / student</div>
                <div className="text-lg font-bold text-indigo-800 mt-0.5">{fmtUSD(revenuePerStu)}</div>
                <div className="text-[10px] text-muted-foreground">{fmt(avgHrs, 0)} hrs × {fmtUSD(rate)}/hr</div>
              </div>
              <div className="bg-white rounded-xl border border-indigo-200 px-4 py-2">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Profit / student</div>
                <div className="text-lg font-bold text-emerald-700 mt-0.5">{fmtUSD(profitPerStu)}</div>
                <div className="text-[10px] text-muted-foreground">after teacher costs</div>
              </div>
              <div className="bg-white rounded-xl border border-indigo-200 px-4 py-2">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Break-even students</div>
                <div className="text-lg font-bold text-amber-700 mt-0.5">{breakEvenStus}</div>
                <div className="text-[10px] text-muted-foreground">to cover ad spend</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Channel Cards ── */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Channel Breakdown</h3>
        <div className="space-y-3">
          {chs.map(ch => {
            const chBudget = Math.round(budget * ch.share);
            const m        = ch.metrics(chBudget);
            return (
              <div key={ch.key} className="rounded-xl border border-border bg-card overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/20">
                  <span className="text-lg">{ch.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{ch.name}</span>
                      <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                        {fmtUSD(chBudget)}/mo · {Math.round(ch.share * 100)}%
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{ch.goal}</div>
                  </div>
                  {/* Budget bar */}
                  <div className="hidden sm:flex items-center gap-2 min-w-[120px]">
                    <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${ch.share * 100}%`, backgroundColor: ch.color }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{Math.round(ch.share * 100)}%</span>
                  </div>
                </div>
                {/* Body */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
                  {/* Metrics */}
                  <div>
                    <div className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest mb-2">Expected Monthly Metrics</div>
                    <div className="space-y-1.5 text-sm">
                      {m.clicks     != null && <div className="flex justify-between"><span className="text-muted-foreground">Clicks</span><span className="font-semibold">~{m.clicks.toLocaleString()}</span></div>}
                      {m.impressions != null && <div className="flex justify-between"><span className="text-muted-foreground">Impressions</span><span className="font-semibold">~{m.impressions}</span></div>}
                      {m.views      != null && <div className="flex justify-between"><span className="text-muted-foreground">Views</span><span className="font-semibold">~{m.views}</span></div>}
                      {m.leads      != null && <div className="flex justify-between"><span className="text-muted-foreground">Estimated Leads</span><span className="font-semibold text-indigo-600">~{m.leads}</span></div>}
                      {m.leads3mo   != null && <div className="flex justify-between"><span className="text-muted-foreground">Leads by month 3</span><span className="font-semibold text-indigo-600">~{m.leads3mo}</span></div>}
                      {m.studs != null && m.studs > 0 && <div className="flex justify-between border-t border-border/50 pt-1.5 mt-1"><span className="text-muted-foreground">New Students (est.)</span><span className="font-bold text-emerald-600">~{m.studs}</span></div>}
                      {m.studs != null && m.studs > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Revenue impact</span><span className="font-semibold text-emerald-700">+{fmtUSD(revenuePerStu * m.studs)}/mo</span></div>}
                      {m.note && <div className="text-[11px] text-muted-foreground mt-1">{m.note}</div>}
                      {m.cpc && <div className="text-[11px] text-muted-foreground">CPC: {m.cpc} · {m.ctr}</div>}
                      {m.cpm && <div className="text-[11px] text-muted-foreground">CPM: {m.cpm}</div>}
                    </div>
                  </div>
                  {/* Actions */}
                  <div>
                    <div className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest mb-2">Key Actions</div>
                    <ul className="space-y-1.5">
                      {ch.actions.map((a, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs">
                          <span className="mt-0.5 shrink-0 w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                          <span className="text-muted-foreground">{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Growth Projections ── */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Growth Projections</h3>
        {(() => {
          const totalLeads = chs.reduce((s, ch) => s + (ch.metrics(Math.round(budget * ch.share)).leads || ch.metrics(Math.round(budget * ch.share)).leads3mo || 0), 0);
          const m1  = Math.max(1, Math.round(totalLeads * 0.35));
          const m3  = Math.round(m1 * 2.2);
          const m6  = Math.round(m1 * 4.5);
          const m12 = Math.round(m1 * 8);
          const projRows = [
            { period: 'Month 1',   studs: m1,  rev: revenuePerStu * m1,  profit: profitPerStu * m1,  note: 'Ads live, first conversions' },
            { period: 'Month 3',   studs: m3,  rev: revenuePerStu * m3,  profit: profitPerStu * m3,  note: 'SEO starting, retargeting' },
            { period: 'Month 6',   studs: m6,  rev: revenuePerStu * m6,  profit: profitPerStu * m6,  note: 'SEO compounding, brand built' },
            { period: 'Month 12',  studs: m12, rev: revenuePerStu * m12, profit: profitPerStu * m12, note: 'Full organic + paid engine' },
          ];
          return (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Period</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">New Students</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">Added Revenue/mo</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">Added Profit/mo</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs hidden sm:table-cell">Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {projRows.map((r, i) => (
                    <tr key={i} className="border-t border-border hover:bg-muted/10">
                      <td className="px-4 py-2 font-semibold">{r.period}</td>
                      <td className="px-4 py-2 text-right font-bold text-indigo-600">{r.studs}</td>
                      <td className="px-4 py-2 text-right font-semibold text-emerald-600">{fmtUSD(r.rev)}</td>
                      <td className="px-4 py-2 text-right font-semibold text-emerald-700">{fmtUSD(r.profit)}</td>
                      <td className="px-4 py-2 text-[11px] text-muted-foreground hidden sm:table-cell">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/20 border-t-2 border-border">
                    <td colSpan={5} className="px-4 py-2 text-[11px] text-muted-foreground">
                      ROI turns positive at month ~2–3. Each enrolled student earns back ad spend in &lt;{Math.ceil(budget / (profitPerStu * m1))} month(s).
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })()}
      </section>

      {/* ── Seasonal Timing ── */}
      {bestMonths.length > 0 && (
        <section className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-bold text-blue-900">Best Launch Windows</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-blue-800">
            <div>
              <p className="font-semibold mb-1">Historically highest-demand months:</p>
              <p>{bestMonths.map(m => `${MONTH_NAMES[m.month]} (avg ${fmt(m.avgHours)} hrs)`).join(' · ')}</p>
            </div>
            <div>
              <p className="font-semibold mb-1">Strategy:</p>
              <ul className="space-y-0.5 list-disc pl-4">
                <li>Start SEO content NOW — it takes 3 months to rank</li>
                <li>Launch paid ads in July targeting Aug/Sep back-to-school</li>
                <li>Ramadan campaign: run 6 weeks before Ramadan starts</li>
                <li>April/May: lower competition → cheaper Google Ads CPCs now</li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* ── 30-Day Action Plan ── */}
      <Collapsible title="30-Day Launch Plan" defaultOpen={false}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {weeks.map((w, i) => (
            <div key={i} className="rounded-xl border border-border p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-block bg-indigo-600 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">{i + 1}</span>
                <span className="text-sm font-semibold">{w.week}</span>
              </div>
              <ul className="space-y-1.5">
                {w.tasks.map((t, j) => (
                  <li key={j} className="flex items-start gap-1.5 text-xs">
                    <span className="mt-0.5 text-indigo-400">▸</span>
                    <span className="text-muted-foreground">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Collapsible>

      {/* ── AI Tools ── */}
      <Collapsible title="Recommended AI Tools" defaultOpen={false}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {[
            { name: 'Claude (Anthropic)',         use: 'Campaign strategy, ad copy, full content briefs. Use the downloaded report to brief it.' },
            { name: 'ChatGPT + DALL-E',            use: 'Ad copy variations, social post ideas, image generation for ads.' },
            { name: 'Google Ads Smart Bidding',    use: 'Set target CPA = half your profit-per-student. Let Google optimize bids.' },
            { name: 'Meta Advantage+',             use: 'Automated campaign type — just upload creative assets, Meta does the rest.' },
            { name: 'Surfer SEO / NeuronWriter',   use: 'Write SEO articles that rank. Analyze competitors and optimize content score.' },
            { name: 'Opus Clip / CapCut',          use: 'Auto-cut Zoom sessions into TikTok/Reels clips with subtitles.' },
            { name: 'Google Search Console',       use: 'Free. Shows which queries bring traffic. Essential for SEO tracking.' },
            { name: 'Hotjar / Microsoft Clarity',  use: 'Free heatmaps on your enrollment page. Find where users drop off.' },
          ].map((t, i) => (
            <div key={i} className="rounded-lg border border-border p-2">
              <div className="font-semibold text-foreground">{t.name}</div>
              <div className="text-muted-foreground mt-0.5">{t.use}</div>
            </div>
          ))}
        </div>
      </Collapsible>
    </div>
  );
}

// ─── Main Modal ─────────────────────────────────────────────────────
export default function BusinessIntelligenceModal({ open, onClose }) {
  const [tab, setTab] = useState('operations');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [timezone, setTimezone] = useState('America/New_York');
  const [hourRate, setHourRate] = useState(null);
  const [budget, setBudget] = useState(100);
  const [teacherRateOverride, setTeacherRateOverride] = useState(null);
  const [overheadOverride, setOverheadOverride] = useState(null);

  useEffect(() => {
    if (open && !data) loadData();
  }, [open]);

  useEffect(() => {
    if (data) {
      if (hourRate == null && data.financial?.chargeRatePerHour) setHourRate(Number(data.financial.chargeRatePerHour));
      if (teacherRateOverride == null && data.financial?.currentAvgTeacherRate) setTeacherRateOverride(Number(data.financial.currentAvgTeacherRate));
      if (overheadOverride == null && data.financial?.monthlyOverhead) setOverheadOverride(Number(data.financial.monthlyOverhead));
    }
  }, [data]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchBusinessIntelligence();
      if (res.success) setData(res.data);
      else setError(res.message || 'Failed to load data');
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const resetAll = () => {
    if (data) {
      setHourRate(Number(data.financial?.chargeRatePerHour) || null);
      setTeacherRateOverride(Number(data.financial?.currentAvgTeacherRate) || null);
      setOverheadOverride(Number(data.financial?.monthlyOverhead) || null);
    }
    setBudget(100);
    setTimezone('America/New_York');
  };

  const hasOverrides = data && (
    hourRate !== Number(data.financial?.chargeRatePerHour) ||
    teacherRateOverride !== Number(data.financial?.currentAvgTeacherRate) ||
    overheadOverride !== Number(data.financial?.monthlyOverhead) ||
    budget !== 100 ||
    timezone !== 'America/New_York'
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
      <div className="w-full max-w-6xl max-h-[95vh] mx-2 rounded-2xl bg-background shadow-2xl ring-1 ring-black/5 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-foreground">Business Intelligence</h2>
            {data && <span className="text-[10px] text-muted-foreground">{new Date(data.generatedAt).toLocaleString()}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadData} disabled={loading} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 disabled:opacity-50">
              <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={onClose} className="inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Controls Bar */}
        <div className="border-b border-border bg-muted/20">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide shrink-0">
              <Settings2 className="h-3.5 w-3.5" /> Configure
            </div>
            <div className="h-4 w-px bg-border hidden sm:block" />
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground font-medium">Timezone</span>
              <select className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium focus:ring-1 focus:ring-indigo-400 outline-none max-w-[180px]" value={timezone} onChange={e => setTimezone(e.target.value)}>
                {Object.entries(
                  TIMEZONE_LIST.reduce((groups, tz) => {
                    const r = tz.region || 'Other';
                    if (!groups[r]) groups[r] = [];
                    groups[r].push(tz);
                    return groups;
                  }, {})
                ).map(([region, zones]) => (
                  <optgroup key={region} label={region}>
                    {zones.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="h-4 w-px bg-border hidden sm:block" />
            <span className="text-[11px] text-muted-foreground font-medium hidden sm:inline">Financial overrides:</span>
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Charge $/hr</span>
              <input type="number" min="0.5" step="0.25" className="rounded-md border border-border bg-background px-2 py-1 text-xs w-[68px] focus:ring-1 focus:ring-indigo-400 outline-none" value={hourRate ?? ''} onChange={e => setHourRate(e.target.value ? Number(e.target.value) : null)} />
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Teacher $/hr</span>
              <input type="number" min="0.5" step="0.25" className="rounded-md border border-border bg-background px-2 py-1 text-xs w-[68px] focus:ring-1 focus:ring-indigo-400 outline-none" value={teacherRateOverride ?? ''} onChange={e => setTeacherRateOverride(e.target.value ? Number(e.target.value) : null)} />
            </label>
            <label className="flex items-center gap-1.5 text-xs" title="Monthly fixed costs: admin tools, hosting, internet">
              <span className="text-muted-foreground">Fixed costs $/mo</span>
              <input type="number" min="0" step="5" className="rounded-md border border-border bg-background px-2 py-1 text-xs w-[68px] focus:ring-1 focus:ring-indigo-400 outline-none" value={overheadOverride ?? ''} onChange={e => setOverheadOverride(e.target.value ? Number(e.target.value) : null)} />
            </label>
            <div className="h-4 w-px bg-border hidden sm:block" />
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Campaign budget $/mo</span>
              <input type="number" min="10" step="10" className="rounded-md border border-border bg-background px-2 py-1 text-xs w-[68px] focus:ring-1 focus:ring-indigo-400 outline-none" value={budget} onChange={e => setBudget(Number(e.target.value) || 0)} />
            </label>
            {hasOverrides && (
              <button onClick={resetAll} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 transition ml-auto">
                <RotateCcw className="h-3 w-3" /> Reset to defaults
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-5 pt-2 border-b border-border">
          <div className="flex gap-1 flex-1">
            {TABS.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition ${tab === t.key ? 'bg-card text-foreground border border-border border-b-transparent -mb-px' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}>
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
          {data && (
            <button
              onClick={() => downloadReport(tab, data, { hourRate, teacherRateOverride, overheadOverride, budget, timezone })}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition mb-0.5"
              title="Download this tab as a Markdown report ready to send to Claude or ChatGPT"
            >
              <Download className="h-3.5 w-3.5" />
              Download Report
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && !data && (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <RefreshCcw className="h-8 w-8 text-muted-foreground animate-spin mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Loading...</p>
              </div>
            </div>
          )}
          {error && !data && (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <AlertTriangle className="h-8 w-8 text-rose-500 mx-auto mb-3" />
                <p className="text-sm text-rose-600 mb-3">{error}</p>
                <button onClick={loadData} className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-xs font-medium hover:bg-indigo-700">Retry</button>
              </div>
            </div>
          )}
          {data && (
            <>
              {tab === 'operations' && <OperationsTab data={data} hourRate={hourRate} />}
              {tab === 'capacity' && <CapacityTab data={data} timezone={timezone} />}
              {tab === 'financial' && <FinancialTab data={data} hourRate={hourRate} teacherRateOverride={teacherRateOverride} overheadOverride={overheadOverride} />}
              {tab === 'campaign' && <CampaignTab data={data} hourRate={hourRate} budget={budget} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
