import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import { fetchBusinessIntelligence } from '../../api/businessIntelligence';
import {
  X, TrendingUp, Users, Clock, DollarSign, Target, BarChart3,
  Calendar, Lightbulb, ChevronDown, ChevronUp, RefreshCcw, AlertTriangle
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
function OperationsTab({ data }) {
  const h = data.hours || {};
  const s = data.students || {};
  const hist = data.historicalTrend || [];
  const summary = data.historicalSummary || {};
  const seasonal = data.seasonalPatterns || [];
  const growth = s.growthByMonth || [];

  return (
    <div className="space-y-4">
      {/* Current month hours */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Current Month Hours</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Completed" value={`${fmt(h.completedHours)} hrs`} sub={`${h.completedClasses} classes`} color="text-emerald-600" />
          <BigNumber label="Scheduled" value={`${fmt(h.scheduledHoursRemaining)} hrs`} sub={`${h.scheduledClasses} remaining`} color="text-blue-600" />
          <BigNumber label="Cancelled" value={`${fmt(h.cancelledHours)} hrs`} sub={`${h.cancelledClasses} classes (${fmtPct(h.cancellationRate)})`} color="text-rose-500" />
          <BigNumber label="Est. Total" value={`${fmt(h.estimatedTotalHours)} hrs`} sub="Completed + scheduled" color="text-foreground" />
        </div>
      </div>

      {/* Students */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Students</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Active" value={s.activeStudents} sub={`/ ${s.totalStudents} total`} color="text-emerald-600" />
          <BigNumber label="New (30d)" value={s.newLast30Days} sub={`60d: ${s.newLast60Days} · 90d: ${s.newLast90Days}`} />
          <BigNumber label="At-Risk" value={s.atRiskStudents} sub="0 classes in 30d" color={s.atRiskStudents > 0 ? 'text-amber-600' : 'text-muted-foreground'} />
          <BigNumber label="Avg hrs/student" value={`${fmt(s.avgHoursPerStudent)} hrs`} sub="This month" />
        </div>
      </div>

      {/* Student Growth Tracking */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Student Growth & Stoppage</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <BigNumber
            label="Net Growth (30d)"
            value={s.netGrowth30Days > 0 ? `+${s.netGrowth30Days}` : s.netGrowth30Days}
            color={s.netGrowth30Days > 0 ? 'text-emerald-600' : s.netGrowth30Days < 0 ? 'text-rose-500' : 'text-muted-foreground'}
            sub={`New: ${s.newLast30Days} · Stopped: ${s.stoppedLast30Days}`}
          />
          <BigNumber
            label="Stopped (90d)"
            value={s.stoppedLast90Days}
            color={s.stoppedLast90Days > 2 ? 'text-rose-500' : 'text-muted-foreground'}
            sub={`Total recent: ${s.totalStoppedRecent}`}
          />
          <BigNumber
            label="Enrollment Rate"
            value={`${fmt(h.hoursChangeVsPrev, 1)}%`}
            sub="Hours vs prev month"
            color={h.hoursChangeVsPrev > 0 ? 'text-emerald-600' : h.hoursChangeVsPrev < 0 ? 'text-rose-500' : 'text-muted-foreground'}
          />
          <BigNumber
            label="Revenue vs Prev"
            value={data.financial?.revenueChangeVsPrev != null ? `${data.financial.revenueChangeVsPrev > 0 ? '+' : ''}${fmt(data.financial.revenueChangeVsPrev, 1)}%` : '—'}
            sub="Revenue change"
            color={data.financial?.revenueChangeVsPrev > 0 ? 'text-emerald-600' : data.financial?.revenueChangeVsPrev < 0 ? 'text-rose-500' : 'text-muted-foreground'}
          />
        </div>

        {/* Growth by month chart */}
        {growth.length > 0 && (
          <div className="h-52 bg-card rounded-xl border border-border p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={growth}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="newStudents" fill="#22c55e" name="New" radius={[4, 4, 0, 0]} />
                <Bar dataKey="stopped" fill="#ef4444" name="Stopped" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="netGrowth" stroke="#6366f1" name="Net Growth" strokeWidth={2} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Recently stopped students */}
        {s.recentlyStoppedStudents && s.recentlyStoppedStudents.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-muted-foreground mb-1">Recently stopped students:</p>
            <div className="flex flex-wrap gap-1">
              {s.recentlyStoppedStudents.map((st, i) => (
                <span key={i} className="inline-block bg-rose-50 text-rose-700 rounded px-2 py-0.5 text-[11px]">
                  {st.name} <span className="text-rose-400">({new Date(st.stoppedAt).toLocaleDateString()})</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Historical summary */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Historical Summary ({summary.totalMonths} months)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Avg Monthly Hours" value={fmt(summary.avgMonthlyHours)} />
          <BigNumber label="Peak Hours" value={fmt(summary.peakHours)} />
          <BigNumber label="Avg Profit" value={fmtUSD(summary.avgMonthlyProfit)} />
          <BigNumber label="Avg Profit %" value={fmtPct(summary.avgProfitPercent)} />
        </div>
      </div>

      {/* Hours trend chart */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Hours Trend (All Time)</h3>
        <div className="h-64 bg-card rounded-xl border border-border p-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={hist}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} interval={5} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="teachingHours" stroke="#6366f1" name="Hours" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Seasonal patterns */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Seasonal Patterns (Avg by Month)</h3>
        <div className="h-48 bg-card rounded-xl border border-border p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={seasonal}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tickFormatter={m => MONTH_NAMES[m] || m} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => fmt(v)} labelFormatter={m => MONTH_NAMES[m] || m} />
              <Bar dataKey="avgHours" fill="#6366f1" name="Avg Hours" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─── Teacher Capacity Tab ───────────────────────────────────────────
function CapacityTab({ data }) {
  const cap = data.teacherCapacity || {};
  const teachers = cap.teachers || [];
  const timeDist = data.timeDistribution || [];

  // Build heatmap grid
  const heatmap = {};
  let maxCount = 0;
  timeDist.forEach(t => {
    const key = `${t.dayOfWeek}-${t.hourEST}`;
    heatmap[key] = (heatmap[key] || 0) + t.classCount;
    if (heatmap[key] > maxCount) maxCount = heatmap[key];
  });

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const days = [1, 2, 3, 4, 5, 6, 7]; // Sun=1..Sat=7

  const getHeatColor = (count) => {
    if (!count) return 'bg-muted/20';
    const intensity = count / Math.max(maxCount, 1);
    if (intensity > 0.75) return 'bg-indigo-600 text-white';
    if (intensity > 0.5) return 'bg-indigo-400 text-white';
    if (intensity > 0.25) return 'bg-indigo-200';
    return 'bg-indigo-100';
  };

  // Find peak hours
  const peakSlots = timeDist
    .sort((a, b) => b.classCount - a.classCount)
    .slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Capacity Overview</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Active Teachers" value={cap.activeTeachers} />
          <BigNumber label="Total Hours" value={`${fmt(cap.totalHoursThisMonth)} hrs`} sub="This month" />
          <BigNumber label="Avg/Teacher" value={`${fmt(cap.avgHoursPerTeacher)} hrs/mo`} sub={`${fmt(cap.avgHoursPerTeacherWeekly)} hrs/wk`} />
          <BigNumber label="Max Teacher" value={`${fmt(cap.maxTeacherHours)} hrs`} sub="Highest this month" />
        </div>
      </div>

      {/* Per-teacher table */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Per-Teacher Breakdown</h3>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/30">
                <th className="text-left px-3 py-2">Teacher</th>
                <th className="text-right px-3 py-2">Hrs/Mo</th>
                <th className="text-right px-3 py-2">Hrs/Wk</th>
                <th className="text-right px-3 py-2">Classes</th>
                <th className="text-right px-3 py-2">Days</th>
                <th className="text-right px-3 py-2">Students</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t, i) => (
                <tr key={i} className="border-t border-border hover:bg-muted/10">
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className="px-3 py-2 text-right">{fmt(t.hoursThisMonth)}</td>
                  <td className="px-3 py-2 text-right">{fmt(t.hoursPerWeek)}</td>
                  <td className="px-3 py-2 text-right">{t.classCount}</td>
                  <td className="px-3 py-2 text-right">{t.daysActive}</td>
                  <td className="px-3 py-2 text-right">{t.studentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Time distribution heatmap */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Demand Heatmap (EST Timezone)</h3>
        <p className="text-[11px] text-muted-foreground mb-2">Based on last 3 months. Darker = more classes.</p>
        <div className="overflow-x-auto">
          <div className="inline-block">
            <div className="flex">
              <div className="w-10" />
              {hours.filter(h => h >= 6 && h <= 23).map(h => (
                <div key={h} className="w-8 text-center text-[9px] text-muted-foreground">{h}:00</div>
              ))}
            </div>
            {days.map(d => (
              <div key={d} className="flex items-center">
                <div className="w-10 text-[10px] text-muted-foreground pr-1 text-right">{DAY_NAMES[d]}</div>
                {hours.filter(h => h >= 6 && h <= 23).map(h => {
                  const count = heatmap[`${d}-${h}`] || 0;
                  return (
                    <div
                      key={h}
                      className={`w-8 h-6 border border-background text-[8px] flex items-center justify-center rounded-sm ${getHeatColor(count)}`}
                      title={`${DAY_NAMES[d]} ${h}:00 EST — ${count} classes`}
                    >
                      {count || ''}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Peak demand recommendation */}
      {peakSlots.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Lightbulb className="h-4 w-4 text-indigo-600" />
            <span className="text-sm font-semibold text-indigo-900">Hiring Recommendation</span>
          </div>
          <p className="text-xs text-indigo-800">
            Peak demand slots (EST): {peakSlots.map((s, i) => (
              <span key={i} className="inline-block bg-indigo-100 rounded px-1.5 py-0.5 mr-1 mb-0.5 font-medium">
                {DAY_NAMES[s.dayOfWeek]} {s.hourEST}:00
              </span>
            ))}
          </p>
          <p className="text-xs text-indigo-700 mt-1">
            Prioritize new teachers who can cover these time slots.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Financial Tab ──────────────────────────────────────────────────
function FinancialTab({ data }) {
  const fin = data.financial || {};
  const be = data.breakEven || {};
  const hist = data.historicalTrend || [];

  const profitTrend = hist.map(h => ({
    period: h.period,
    revenue: h.currentMonthFees,
    expenses: h.moneyOut,
    profit: h.netProfitUSD,
    profitPct: h.profitPercent
  }));

  return (
    <div className="space-y-4">
      {/* Current month P&L */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Current Month P&L</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Revenue" value={fmtUSD(fin.revenueThisMonth)} color="text-emerald-600" />
          <BigNumber label="Teacher Costs" value={fmtUSD(fin.teacherCostsThisMonth)} color="text-rose-500" />
          <BigNumber label="Overhead" value={fmtUSD(fin.monthlyOverhead)} sub="Admin + Hosting" />
          <BigNumber label="Est. Profit" value={fmtUSD(fin.estimatedProfitThisMonth)} color={fin.estimatedProfitThisMonth >= 0 ? 'text-emerald-600' : 'text-rose-500'} />
        </div>
      </div>

      {/* Rate breakdown */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Rate Structure</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Charge Rate" value={fmtUSD(fin.chargeRatePerHour)} sub={fin.chargeRateSource ? `Source: ${fin.chargeRateSource}` : 'Per student hour'} />
          <BigNumber label="Avg Teacher Rate" value={fmtUSD(fin.currentAvgTeacherRate)} sub={`3mo weighted: ${fmtUSD(fin.weightedTeacherRate3Mo)}`} />
          <BigNumber label="Profit/Hour" value={fmtUSD(fin.profitPerHour)} sub="After all costs" color={fin.profitPerHour > 0 ? 'text-emerald-600' : 'text-rose-500'} />
          <BigNumber label="Exchange Rate" value={`${fmt(fin.currentExchangeRate)} EGP`} sub="Per USD" />
        </div>
        {fin.chargeRateDetail && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            Invoice rate range: {fmtUSD(fin.chargeRateDetail.min)} – {fmtUSD(fin.chargeRateDetail.max)} (avg {fmtUSD(fin.chargeRateDetail.avg)}, {fin.chargeRateDetail.sampleSize} items)
            {fin.guardianRates && <span> · Guardian avg: {fmtUSD(fin.guardianRates.avg)} ({fin.guardianRates.guardianCount} guardians)</span>}
          </div>
        )}
      </div>

      {/* Rate partitions */}
      {fin.ratePartitions && fin.ratePartitions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Teacher Rate Tiers</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {fin.ratePartitions.map((p, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-2 text-xs">
                <div className="font-medium">{p.name}</div>
                <div className="text-muted-foreground">{p.minHours}–{p.maxHours >= 99999 ? '∞' : p.maxHours} hrs</div>
                <div className="text-sm font-semibold mt-0.5">{fmtUSD(p.rateUSD)}/hr</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Break-even analysis */}
      <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <h3 className="text-sm font-bold text-amber-900">Break-Even: Teacher Rate $3 → $4/hr</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-amber-800 font-medium mb-1">Current Situation</div>
            <div className="space-y-0.5 text-amber-900">
              <div>Teacher rate: <strong>{fmtUSD(be.currentTeacherRate)}</strong>/hr</div>
              <div>Monthly hours: <strong>{fmt(be.currentHours)}</strong></div>
              <div>Profit/hour: <strong>{fmtUSD(be.currentProfitPerHour)}</strong></div>
              <div>Est. profit: <strong>{fmtUSD(be.currentEstimatedProfit)}</strong></div>
            </div>
          </div>
          <div>
            <div className="text-amber-800 font-medium mb-1">At $4/hr Target</div>
            <div className="space-y-0.5 text-amber-900">
              <div>Profit/hour: <strong>{fmtUSD(be.profitPerHourAtTarget)}</strong></div>
              <div>Hours needed: <strong>{be.hoursNeededAt4USD ? fmt(be.hoursNeededAt4USD) : '—'}</strong></div>
              <div>Additional hours: <strong>{be.additionalHoursNeeded != null ? fmt(be.additionalHoursNeeded) : '—'}</strong></div>
              <div>Additional students: <strong>{be.additionalStudentsNeeded ?? '—'}</strong></div>
            </div>
          </div>
        </div>
        <div className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${be.canAffordNow ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
          {be.canAffordNow
            ? '✓ You can afford $4/hr NOW at current volume without reducing profit.'
            : `✗ Need ${be.additionalHoursNeeded != null ? fmt(be.additionalHoursNeeded) : '?'} more hours/mo (≈${be.additionalStudentsNeeded ?? '?'} students) to maintain profit at $4/hr.`
          }
        </div>
      </div>

      {/* Revenue vs Expenses trend */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Revenue vs Expenses (All Time)</h3>
        <div className="h-64 bg-card rounded-xl border border-border p-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={profitTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} interval={5} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={{ fontSize: 12 }} formatter={v => fmtUSD(v)} />
              <Line type="monotone" dataKey="revenue" stroke="#22c55e" name="Revenue" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="expenses" stroke="#ef4444" name="Expenses" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="profit" stroke="#6366f1" name="Profit" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Profit margin trend */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Profit Margin % Trend</h3>
        <div className="h-48 bg-card rounded-xl border border-border p-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={profitTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} interval={5} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[30, 90]} />
              <Tooltip contentStyle={{ fontSize: 12 }} formatter={v => fmtPct(v)} />
              <Line type="monotone" dataKey="profitPct" stroke="#8b5cf6" name="Profit %" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─── Campaign Tab ───────────────────────────────────────────────────
function CampaignTab({ data }) {
  const cp = data.campaignProjections || {};
  const channels = cp.channels || {};
  const projections = cp.projections || {};
  const seasonal = data.seasonalPatterns || [];
  const rate = data.financial?.chargeRatePerHour || 9.53;
  const teacherRate = data.financial?.currentAvgTeacherRate || 3.13;
  const avgHrs = cp.avgHoursPerStudent || 8;

  const budgetData = Object.entries(channels).map(([key, ch]) => ({
    name: key === 'googleAds' ? 'Google Ads' : key === 'facebookInstagram' ? 'Facebook/IG' : key === 'seo' ? 'SEO' : 'TikTok',
    value: ch.budget
  }));

  const projectionData = Object.entries(projections).map(([key, p]) => ({
    period: key.replace('month', 'Mo '),
    students: p.newStudents,
    revenue: p.additionalRevenue
  }));

  // Best months from seasonal (top 3 by avgHours)
  const bestMonths = [...seasonal].sort((a, b) => b.avgHours - a.avgHours).slice(0, 3);

  return (
    <div className="space-y-4">
      {/* Budget allocation */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Recommended Budget: $100/mo</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={budgetData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name} $${value}`}>
                  {budgetData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={v => `$${v}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {Object.entries(channels).map(([key, ch]) => (
              <div key={key} className="rounded-lg border border-border bg-card p-2 text-xs">
                <div className="font-medium">{key === 'googleAds' ? 'Google Ads' : key === 'facebookInstagram' ? 'Facebook/Instagram' : key === 'seo' ? 'SEO / Content' : 'TikTok'} — ${ch.budget}/mo</div>
                <div className="text-muted-foreground mt-0.5">
                  {ch.expectedClicks && <span>~{ch.expectedClicks} clicks · </span>}
                  {ch.expectedLeads && <span>~{fmt(ch.expectedLeads, 1)} leads · </span>}
                  {ch.expectedImpressions && <span>~{ch.expectedImpressions.toLocaleString()} impressions</span>}
                  {ch.note && <span>{ch.note}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Projections */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Growth Projections (Cumulative)</h3>
        <div className="h-48 bg-card rounded-xl border border-border p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={projectionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="students" fill="#6366f1" name="New Students" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="right" dataKey="revenue" fill="#22c55e" name="Add. Revenue/mo" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[11px] text-muted-foreground mt-1">
          Revenue per student ≈ {fmtUSD(cp.revenuePerStudentMonthly)}/mo ({fmt(avgHrs, 0)} hrs × {fmtUSD(rate)})
        </div>
      </div>

      {/* Timing analysis */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-semibold text-blue-900">Best Time to Launch?</span>
        </div>
        <div className="text-xs text-blue-800 space-y-1">
          <p><strong>Best months historically</strong>: {bestMonths.map(m => MONTH_NAMES[m.month]).join(', ')} (avg {fmt(bestMonths[0]?.avgHours)} hrs)</p>
          <p><strong>Now (Apr–May)</strong>: Mixed — exams mean some students pause, but reduced ad competition = cheaper clicks.</p>
          <p><strong>Recommendation</strong>: Start SEO and content NOW to build ranking before Aug–Sep back-to-school surge. Start paid ads in July.</p>
          <p><strong>Ramadan</strong>: Historically strong enrollment period. Plan a special campaign 2 months before.</p>
        </div>
      </div>

      {/* AI Tools Guide */}
      <Collapsible title="AI Tools for Campaign Management" defaultOpen>
        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { name: 'Claude (Anthropic)', use: 'Content writing, ad copy, article drafts, campaign strategy. Can control screen for hands-on campaign setup.' },
              { name: 'Surfer SEO / NeuronWriter', use: 'Optimize articles for Google ranking. Analyze competitor content and suggest improvements.' },
              { name: 'Canva AI', use: 'Social media graphics, ad creatives, video thumbnails. Free tier available.' },
              { name: 'Google Ads Smart Bidding', use: 'Built-in AI for bid optimization. Set target CPA and let Google optimize.' },
              { name: 'Meta Advantage+', use: 'Automated Facebook/Instagram campaigns. AI handles targeting, placement, creative.' },
              { name: 'Opus Clip / CapCut', use: 'Auto-clip long videos into TikTok/Reels. AI highlights key moments.' },
              { name: 'ChatGPT + DALL-E', use: 'Generate visuals, social posts, and variations of ad copy.' },
              { name: 'Google Search Console', use: 'Free. Track which keywords drive traffic. Submit new pages for indexing.' },
            ].map((tool, i) => (
              <div key={i} className="rounded-lg border border-border p-2">
                <div className="font-medium text-foreground">{tool.name}</div>
                <div className="text-muted-foreground mt-0.5">{tool.use}</div>
              </div>
            ))}
          </div>
        </div>
      </Collapsible>

      {/* SEO Content Strategy */}
      <Collapsible title="SEO & Content Strategy">
        <div className="space-y-2 text-xs text-foreground">
          <p><strong>Can AI create SEO content?</strong> Yes, but with caveats:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Google's E-E-A-T (Experience, Expertise, Authority, Trust) guidelines prioritize content showing real experience.</li>
            <li>AI-generated articles work as a base — add personal stories, real student testimonials, and teacher bios.</li>
            <li>Publish 2–4 articles/week on target keywords.</li>
            <li>Include schema markup for EducationalOrganization.</li>
          </ul>
          <p className="font-medium mt-2">Target keywords (English):</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {['online Quran classes', 'learn Quran online', 'Quran tutor for kids', 'online Quran teacher', 'Quran classes USA', 'tajweed classes online', 'Arabic Quran lessons', 'Quran memorization online'].map((kw, i) => (
              <span key={i} className="bg-muted rounded px-2 py-0.5">{kw}</span>
            ))}
          </div>
          <p className="font-medium mt-2">Content ideas:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>How to choose an online Quran teacher (comparison guide)</li>
            <li>Benefits of 1-on-1 Quran tutoring vs group classes</li>
            <li>Tajweed basics: a parent's guide</li>
            <li>Student success stories and progress updates</li>
            <li>Ramadan Quran goals for kids</li>
          </ul>
        </div>
      </Collapsible>

      {/* Practical Steps */}
      <Collapsible title="Step-by-Step: First 30 Days">
        <div className="text-xs space-y-2">
          <div className="space-y-1.5">
            {[
              { week: 'Week 1', tasks: ['Set up Google Business Profile (free)', 'Create Google Ads account with $40 budget', 'Write 3 SEO articles using Claude', 'Set up Google Search Console'] },
              { week: 'Week 2', tasks: ['Create Facebook Business Page', 'Set up Meta Ads with $25 budget (video ad of a demo lesson)', 'Publish articles to website', 'Create TikTok account, post 2 short educational clips'] },
              { week: 'Week 3', tasks: ['Analyze first week of ad data', 'Pause underperforming ads, increase budget on winners', 'Write 2 more articles', 'Create YouTube channel, upload first educational video'] },
              { week: 'Week 4', tasks: ['Review: which channel brought leads?', 'Optimize ad copy based on click-through rates', 'Publish 2 more articles', 'Plan next month\'s content calendar'] },
            ].map((w, i) => (
              <div key={i} className="rounded-lg border border-border p-2">
                <div className="font-medium text-foreground mb-1">{w.week}</div>
                <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                  {w.tasks.map((t, j) => <li key={j}>{t}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </Collapsible>

      {/* YouTube + Video Strategy */}
      <Collapsible title="YouTube & Video Strategy">
        <div className="text-xs space-y-1.5">
          <p><strong>Video types that work for Quran education:</strong></p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li><strong>Short lessons (3-5 min)</strong>: Teach one Tajweed rule. Great for TikTok/Reels.</li>
            <li><strong>Student journey (5-10 min)</strong>: Show a student's progress over weeks.</li>
            <li><strong>Parent testimonials (2-3 min)</strong>: Authentic review from a real parent.</li>
            <li><strong>Teacher introductions (1-2 min)</strong>: Build trust by showing your teachers.</li>
            <li><strong>Q&A / FAQ (5 min)</strong>: Answer common questions about online Quran learning.</li>
          </ul>
          <p className="mt-2"><strong>Tools</strong>: Record with Zoom/Google Meet (you already use these). Edit with CapCut (free). Auto-subtitle with Opus Clip.</p>
        </div>
      </Collapsible>

      {/* Expected Results Summary */}
      <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4">
        <h3 className="text-sm font-bold text-emerald-900 mb-2">Expected Results with $100/mo</h3>
        <div className="grid grid-cols-3 gap-3 text-center text-xs">
          <div>
            <div className="text-lg font-bold text-emerald-700">Month 1–2</div>
            <div className="text-emerald-800">3–8 leads</div>
            <div className="text-emerald-800">1–4 new students</div>
            <div className="text-emerald-600 font-medium">+{fmtUSD(rate * 8)}–{fmtUSD(rate * 32)}/mo</div>
          </div>
          <div>
            <div className="text-lg font-bold text-emerald-700">Month 3–6</div>
            <div className="text-emerald-800">SEO starts ranking</div>
            <div className="text-emerald-800">4–8 new students total</div>
            <div className="text-emerald-600 font-medium">+{fmtUSD(rate * 32)}–{fmtUSD(rate * 64)}/mo</div>
          </div>
          <div>
            <div className="text-lg font-bold text-emerald-700">Month 6–12</div>
            <div className="text-emerald-800">Organic growth compounds</div>
            <div className="text-emerald-800">10–15 new students total</div>
            <div className="text-emerald-600 font-medium">+{fmtUSD(rate * 80)}–{fmtUSD(rate * 120)}/mo</div>
          </div>
        </div>
        <p className="text-[11px] text-emerald-700 mt-2">
          ROI becomes positive by month 3–4. Each new student adds ~{fmtUSD(rate * avgHrs)}/mo revenue with ~{fmtUSD((rate - teacherRate) * avgHrs)}/mo profit.
        </p>
      </div>
    </div>
  );
}

// ─── Main Modal ─────────────────────────────────────────────────────
export default function BusinessIntelligenceModal({ open, onClose }) {
  const [tab, setTab] = useState('operations');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && !data) loadData();
  }, [open]);

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
      <div className="w-full max-w-6xl max-h-[95vh] mx-2 rounded-2xl bg-background shadow-2xl ring-1 ring-black/5 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-foreground">Business Intelligence</h2>
            {data && (
              <span className="text-[10px] text-muted-foreground">
                {new Date(data.generatedAt).toLocaleString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadData} disabled={loading} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 disabled:opacity-50" title="Refresh">
              <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={onClose} className="inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-2 border-b border-border">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition ${
                  tab === t.key
                    ? 'bg-card text-foreground border border-border border-b-transparent -mb-px'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && !data && (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <RefreshCcw className="h-8 w-8 text-muted-foreground animate-spin mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Loading business intelligence data...</p>
              </div>
            </div>
          )}
          {error && !data && (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <AlertTriangle className="h-8 w-8 text-rose-500 mx-auto mb-3" />
                <p className="text-sm text-rose-600 mb-3">{error}</p>
                <button onClick={loadData} className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-xs font-medium hover:bg-indigo-700">
                  Retry
                </button>
              </div>
            </div>
          )}
          {data && (
            <>
              {tab === 'operations' && <OperationsTab data={data} />}
              {tab === 'capacity' && <CapacityTab data={data} />}
              {tab === 'financial' && <FinancialTab data={data} />}
              {tab === 'campaign' && <CampaignTab data={data} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
