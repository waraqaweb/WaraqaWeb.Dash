import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, ComposedChart
} from 'recharts';
import { fetchBusinessIntelligence } from '../../api/businessIntelligence';
import {
  X, Users, Clock, DollarSign, Target, BarChart3,
  Calendar, Lightbulb, ChevronDown, ChevronUp, RefreshCcw, AlertTriangle,
  Settings2, RotateCcw
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

const TZ_OPTIONS = [
  { value: 'EST', label: 'EST (UTC-5)', offset: -5 },
  { value: 'CST', label: 'CST (UTC-6)', offset: -6 },
  { value: 'PST', label: 'PST (UTC-8)', offset: -8 },
  { value: 'UTC', label: 'UTC', offset: 0 },
  { value: 'EET', label: 'Cairo (UTC+2)', offset: 2 },
  { value: 'GST', label: 'Dubai (UTC+4)', offset: 4 },
  { value: 'local', label: 'Local', offset: -(new Date().getTimezoneOffset() / 60) },
];

function getTzOffset(tz) {
  return TZ_OPTIONS.find(o => o.value === tz)?.offset ?? -5;
}
function convertHourUTC(hourUTC, tz) {
  const off = getTzOffset(tz);
  return ((hourUTC + off) % 24 + 24) % 24;
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

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Current Month Hours</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Completed" value={`${fmt(h.completedHours)} hrs`} sub={`${h.completedClasses} classes`} color="text-emerald-600" />
          <BigNumber label="Scheduled" value={`${fmt(h.scheduledHoursRemaining)} hrs`} sub={`${h.scheduledClasses} remaining`} color="text-blue-600" />
          <BigNumber label="Cancelled" value={`${fmt(h.cancelledHours)} hrs`} sub={`${h.cancelledClasses} classes (${fmtPct(h.cancellationRate)})`} color="text-rose-500" />
          <BigNumber label="Est. Total" value={`${fmt(h.estimatedTotalHours)} hrs`} sub={h.hoursChangeVsPrev != null ? `${h.hoursChangeVsPrev > 0 ? '+' : ''}${fmt(h.hoursChangeVsPrev, 1)}% vs prev` : 'Completed + scheduled'} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Students</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Active" value={s.activeStudents} sub={`/ ${s.totalStudents} total`} color="text-emerald-600" />
          <BigNumber label="New (30d)" value={s.newLast30Days} sub={`60d: ${s.newLast60Days} · 90d: ${s.newLast90Days}`} />
          <BigNumber label="At-Risk" value={s.atRiskStudents} sub="0 classes in 30d" color={s.atRiskStudents > 0 ? 'text-amber-600' : 'text-muted-foreground'} />
          <BigNumber label="Avg hrs/student" value={`${fmt(s.avgHoursPerStudent)} hrs`} sub="This month" />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Student Growth & Stoppage</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <BigNumber
            label="Net Growth (30d)"
            value={s.netGrowth30Days > 0 ? `+${s.netGrowth30Days}` : String(s.netGrowth30Days ?? 0)}
            color={s.netGrowth30Days > 0 ? 'text-emerald-600' : s.netGrowth30Days < 0 ? 'text-rose-500' : 'text-muted-foreground'}
            sub={`New: ${s.newLast30Days} · Stopped: ${s.stoppedLast30Days}`}
          />
          <BigNumber label="Stopped (90d)" value={s.stoppedLast90Days} color={s.stoppedLast90Days > 2 ? 'text-rose-500' : 'text-muted-foreground'} sub={`Total recent: ${s.totalStoppedRecent}`} />
          <BigNumber
            label="Revenue vs Prev"
            value={data.financial?.revenueChangeVsPrev != null ? `${data.financial.revenueChangeVsPrev > 0 ? '+' : ''}${fmt(data.financial.revenueChangeVsPrev, 1)}%` : '—'}
            sub="Month-over-month"
            color={data.financial?.revenueChangeVsPrev > 0 ? 'text-emerald-600' : data.financial?.revenueChangeVsPrev < 0 ? 'text-rose-500' : 'text-muted-foreground'}
          />
          <BigNumber label="Est. Revenue" value={fmtUSD((hourRate || 0) * (h.estimatedTotalHours || 0))} sub={`${fmt(h.estimatedTotalHours)} hrs × ${fmtUSD(hourRate)}`} />
        </div>

        {growth.length > 0 && (
          <div className="h-52 bg-card rounded-xl border border-border p-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={growth}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="newStudents" fill="#22c55e" name="New" radius={[4, 4, 0, 0]} />
                <Bar dataKey="stopped" fill="#ef4444" name="Stopped" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="netGrowth" stroke="#6366f1" name="Net Growth" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {s.recentlyStoppedStudents && s.recentlyStoppedStudents.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-muted-foreground mb-1">Recently stopped:</p>
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

      <div>
        <h3 className="text-sm font-semibold mb-2">Historical Summary ({summary.totalMonths} months)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Avg Monthly Hours" value={fmt(summary.avgMonthlyHours)} />
          <BigNumber label="Peak Hours" value={fmt(summary.peakHours)} />
          <BigNumber label="Avg Profit" value={fmtUSD(summary.avgMonthlyProfit)} />
          <BigNumber label="Avg Profit %" value={fmtPct(summary.avgProfitPercent)} />
        </div>
      </div>

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
function CapacityTab({ data, timezone }) {
  const cap = data.teacherCapacity || {};
  const teachers = cap.teachers || [];
  const timeDist = data.timeDistribution || [];
  const tzLabel = TZ_OPTIONS.find(o => o.value === timezone)?.label || timezone;

  const heatmap = {};
  let maxCount = 0;
  timeDist.forEach(t => {
    const ch = convertHourUTC(t.hourUTC, timezone);
    const key = `${t.dayOfWeek}-${ch}`;
    heatmap[key] = (heatmap[key] || 0) + t.classCount;
    if (heatmap[key] > maxCount) maxCount = heatmap[key];
  });

  const visibleHours = Array.from({ length: 18 }, (_, i) => i + 6); // 6..23
  const days = [1, 2, 3, 4, 5, 6, 7];

  const getHeatColor = (count) => {
    if (!count) return 'bg-muted/20';
    const intensity = count / Math.max(maxCount, 1);
    if (intensity > 0.75) return 'bg-indigo-600 text-white';
    if (intensity > 0.5) return 'bg-indigo-400 text-white';
    if (intensity > 0.25) return 'bg-indigo-200';
    return 'bg-indigo-100';
  };

  const peakMap = {};
  timeDist.forEach(t => {
    const ch = convertHourUTC(t.hourUTC, timezone);
    const key = `${t.dayOfWeek}-${ch}`;
    if (!peakMap[key]) peakMap[key] = { dayOfWeek: t.dayOfWeek, hour: ch, classCount: 0 };
    peakMap[key].classCount += t.classCount;
  });
  const peakSlots = Object.values(peakMap).sort((a, b) => b.classCount - a.classCount).slice(0, 5);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Capacity Overview</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Active Teachers" value={cap.activeTeachers} />
          <BigNumber label="Total Hours" value={`${fmt(cap.totalHoursThisMonth)} hrs`} sub="This month" />
          <BigNumber label="Avg/Teacher" value={`${fmt(cap.avgHoursPerTeacher)} hrs/mo`} sub={`${fmt(cap.avgHoursPerTeacherWeekly)} hrs/wk`} />
          <BigNumber label="Max Teacher" value={`${fmt(cap.maxTeacherHours)} hrs`} sub="Highest this month" />
        </div>
      </div>

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
                <th className="text-right px-3 py-2">Rate</th>
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
                  <td className="px-3 py-2 text-right">{t.hasCustomRate ? <span className="text-amber-600">{fmtUSD(t.customRateUSD)}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Demand Heatmap ({tzLabel})</h3>
        <p className="text-[11px] text-muted-foreground mb-2">Last 3 months. Darker = more classes. Change timezone above.</p>
        <div className="overflow-x-auto">
          <div className="inline-block">
            <div className="flex">
              <div className="w-10" />
              {visibleHours.map(h => (
                <div key={h} className="w-8 text-center text-[9px] text-muted-foreground">{h}:00</div>
              ))}
            </div>
            {days.map(d => (
              <div key={d} className="flex items-center">
                <div className="w-10 text-[10px] text-muted-foreground pr-1 text-right">{DAY_NAMES[d]}</div>
                {visibleHours.map(h => {
                  const count = heatmap[`${d}-${h}`] || 0;
                  return (
                    <div key={h} className={`w-8 h-6 border border-background text-[8px] flex items-center justify-center rounded-sm ${getHeatColor(count)}`} title={`${DAY_NAMES[d]} ${h}:00 ${timezone} — ${count} classes`}>
                      {count || ''}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {peakSlots.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Lightbulb className="h-4 w-4 text-indigo-600" />
            <span className="text-sm font-semibold text-indigo-900">Hiring Recommendation</span>
          </div>
          <p className="text-xs text-indigo-800">
            Peak demand ({timezone}): {peakSlots.map((s, i) => (
              <span key={i} className="inline-block bg-indigo-100 rounded px-1.5 py-0.5 mr-1 mb-0.5 font-medium">
                {DAY_NAMES[s.dayOfWeek]} {s.hour}:00
              </span>
            ))}
          </p>
          <p className="text-xs text-indigo-700 mt-1">Prioritize new teachers who can cover these slots.</p>
        </div>
      )}
    </div>
  );
}

// ─── Financial Tab ──────────────────────────────────────────────────
function FinancialTab({ data, hourRate, teacherRateOverride, overheadOverride }) {
  const fin = data.financial || {};
  const be = data.breakEven || {};
  const hist = data.historicalTrend || [];

  const rate = hourRate ?? fin.chargeRatePerHour ?? 0;
  const tRate = teacherRateOverride ?? fin.currentAvgTeacherRate ?? 0;
  const overhead = overheadOverride ?? fin.monthlyOverhead ?? 0;
  const curHours = be.currentHours ?? 0;
  const isCustom = (hourRate != null && hourRate !== fin.chargeRatePerHour) ||
    (teacherRateOverride != null && teacherRateOverride !== fin.currentAvgTeacherRate) ||
    (overheadOverride != null && overheadOverride !== fin.monthlyOverhead);

  const overheadPerHour = curHours > 0 ? overhead / curHours : 0;
  const profitPerHour = rate - tRate - overheadPerHour;
  const estRevenue = rate * curHours;
  const estProfit = estRevenue - (tRate * curHours) - overhead;

  const targetRate = 4.00;
  const profitAtTarget = rate - targetRate - overheadPerHour;
  const currentProfitTotal = profitPerHour * curHours;
  const hoursNeededAt4 = profitAtTarget > 0 ? currentProfitTotal / profitAtTarget : null;
  const additionalHrs = hoursNeededAt4 != null ? Math.max(0, hoursNeededAt4 - curHours) : null;
  const avgHrsPerStudent = data.students?.avgHoursPerStudent || 8;
  const addlStudents = additionalHrs != null ? Math.ceil(additionalHrs / Math.max(avgHrsPerStudent, 1)) : null;
  const canAfford = hoursNeededAt4 != null && curHours >= hoursNeededAt4;

  const profitTrend = hist.map(h => ({
    period: h.period,
    revenue: h.currentMonthFees,
    expenses: h.moneyOut,
    profit: h.netProfitUSD,
    profitPct: h.profitPercent
  }));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Current Month P&L {isCustom && <OverrideTag />}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Revenue (actual)" value={fmtUSD(fin.revenueThisMonth)} color="text-emerald-600" sub={isCustom ? `Custom: ${fmtUSD(estRevenue)}` : undefined} />
          <BigNumber label="Teacher Costs" value={fmtUSD(fin.teacherCostsThisMonth)} color="text-rose-500" sub={isCustom ? `Custom: ${fmtUSD(tRate * curHours)}` : undefined} />
          <BigNumber label="Overhead" value={fmtUSD(overhead)} sub="Admin + Hosting" />
          <BigNumber label={isCustom ? 'Profit (custom)' : 'Est. Profit'} value={fmtUSD(isCustom ? estProfit : fin.estimatedProfitThisMonth)} color={estProfit >= 0 ? 'text-emerald-600' : 'text-rose-500'} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Rate Structure {isCustom && <OverrideTag />}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BigNumber label="Charge Rate" value={fmtUSD(rate)} sub={isCustom ? `DB: ${fmtUSD(fin.chargeRatePerHour)}` : (fin.chargeRateSource || 'Per student hour')} />
          <BigNumber label="Teacher Rate" value={fmtUSD(tRate)} sub={fin.weightedTeacherRate3Mo ? `3mo avg: ${fmtUSD(fin.weightedTeacherRate3Mo)}` : undefined} />
          <BigNumber label="Profit/Hour" value={fmtUSD(profitPerHour)} sub="After all costs" color={profitPerHour > 0 ? 'text-emerald-600' : 'text-rose-500'} />
          <BigNumber label="Exchange Rate" value={`${fmt(fin.currentExchangeRate)} EGP`} sub="Per USD" />
        </div>
        {fin.chargeRateDetail && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            Invoice range: {fmtUSD(fin.chargeRateDetail.min)} – {fmtUSD(fin.chargeRateDetail.max)} (avg {fmtUSD(fin.chargeRateDetail.avg)}, {fin.chargeRateDetail.sampleSize} items)
            {fin.guardianRates && <span> · Guardian avg: {fmtUSD(fin.guardianRates.avg)} ({fin.guardianRates.guardianCount} guardians)</span>}
          </div>
        )}
      </div>

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

      <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <h3 className="text-sm font-bold text-amber-900">Break-Even: Teacher Rate → $4/hr {isCustom && <OverrideTag />}</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-amber-800 font-medium mb-1">Current</div>
            <div className="space-y-0.5 text-amber-900">
              <div>Charge: <strong>{fmtUSD(rate)}</strong>/hr</div>
              <div>Teacher: <strong>{fmtUSD(tRate)}</strong>/hr</div>
              <div>Hours: <strong>{fmt(curHours)}</strong></div>
              <div>Profit/hr: <strong>{fmtUSD(profitPerHour)}</strong></div>
              <div>Est. profit: <strong>{fmtUSD(currentProfitTotal)}</strong></div>
            </div>
          </div>
          <div>
            <div className="text-amber-800 font-medium mb-1">At $4/hr Teacher</div>
            <div className="space-y-0.5 text-amber-900">
              <div>Profit/hr: <strong>{fmtUSD(profitAtTarget)}</strong></div>
              <div>Hours needed: <strong>{hoursNeededAt4 ? fmt(hoursNeededAt4) : '—'}</strong></div>
              <div>Additional hrs: <strong>{additionalHrs != null ? fmt(additionalHrs) : '—'}</strong></div>
              <div>Additional students: <strong>{addlStudents ?? '—'}</strong></div>
            </div>
          </div>
        </div>
        <div className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${canAfford ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
          {canAfford
            ? '✓ You can afford $4/hr NOW at current volume without reducing profit.'
            : `✗ Need ${additionalHrs != null ? fmt(additionalHrs) : '?'} more hrs/mo (≈${addlStudents ?? '?'} students) to maintain profit at $4/hr.`
          }
        </div>
      </div>

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

      <div>
        <h3 className="text-sm font-semibold mb-2">Profit % Trend</h3>
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
function CampaignTab({ data, hourRate, budget }) {
  const fin = data.financial || {};
  const cp = data.campaignProjections || {};
  const seasonal = data.seasonalPatterns || [];

  const rate = hourRate ?? fin.chargeRatePerHour ?? 9.53;
  const teacherRate = fin.currentAvgTeacherRate ?? 3.13;
  const avgHrs = cp.avgHoursPerStudent || (data.students?.avgHoursPerStudent || 8);
  const revenuePerStudent = rate * avgHrs;
  const profitPerStudent = (rate - teacherRate) * avgHrs;
  const isCustom = (hourRate != null && hourRate !== fin.chargeRatePerHour) || budget !== 100;

  const budgetScale = budget / 100;
  const channels = {
    googleAds: { name: 'Google Ads', budget: Math.round(budget * 0.40), cpc: 2.00 },
    facebookInstagram: { name: 'Facebook/IG', budget: Math.round(budget * 0.25), cpm: 10 },
    seo: { name: 'SEO / Content', budget: Math.round(budget * 0.20) },
    tiktok: { name: 'TikTok', budget: Math.round(budget * 0.15) },
  };
  const gClicks = Math.round(channels.googleAds.budget / 2);
  const gLeads = +(gClicks * 0.08).toFixed(1);
  const fbImpressions = Math.round(channels.facebookInstagram.budget / 10 * 1000);
  const fbClicks = Math.round(fbImpressions * 0.02);
  const fbLeads = +(fbClicks * 0.04).toFixed(1);
  const ttImpressions = Math.round(5000 * budgetScale);
  const ttClicks = Math.round(ttImpressions * 0.01);
  const ttLeads = +(ttClicks * 0.02).toFixed(1);
  const totalLeads = gLeads + fbLeads + ttLeads;

  const m1 = Math.max(1, Math.round(totalLeads * 0.35));
  const m3 = Math.round(m1 * 2.5);
  const m6 = Math.round(m1 * 5);
  const m12 = Math.round(m1 * 9);

  const projections = [
    { period: 'Mo 1', students: m1, revenue: +(revenuePerStudent * m1).toFixed(2) },
    { period: 'Mo 3', students: m3, revenue: +(revenuePerStudent * m3).toFixed(2) },
    { period: 'Mo 6', students: m6, revenue: +(revenuePerStudent * m6).toFixed(2) },
    { period: 'Mo 12', students: m12, revenue: +(revenuePerStudent * m12).toFixed(2) },
  ];

  const budgetData = Object.values(channels).map(ch => ({ name: ch.name, value: ch.budget }));
  const bestMonths = [...seasonal].sort((a, b) => b.avgHours - a.avgHours).slice(0, 3);

  const channelDetails = [
    { ...channels.googleAds, clicks: gClicks, leads: gLeads },
    { ...channels.facebookInstagram, impressions: fbImpressions, clicks: fbClicks, leads: fbLeads },
    { ...channels.seo, note: `Content tools · Organic leads mo3: ~${Math.round(2 * budgetScale)}, mo6: ~${Math.round(5 * budgetScale)}` },
    { ...channels.tiktok, impressions: ttImpressions, clicks: ttClicks, leads: ttLeads },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Budget: {fmtUSD(budget)}/mo {isCustom && <OverrideTag />}</h3>
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
            {channelDetails.map((ch, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-2 text-xs">
                <div className="font-medium">{ch.name} — ${ch.budget}/mo</div>
                <div className="text-muted-foreground mt-0.5">
                  {ch.clicks != null && <span>~{ch.clicks} clicks · </span>}
                  {ch.leads != null && <span>~{ch.leads} leads · </span>}
                  {ch.impressions != null && !ch.cpc && <span>~{ch.impressions.toLocaleString()} impressions</span>}
                  {ch.note && <span>{ch.note}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Growth Projections {isCustom && <OverrideTag />}</h3>
        <div className="h-48 bg-card rounded-xl border border-border p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={projections}>
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
          Revenue/student ≈ {fmtUSD(revenuePerStudent)}/mo ({fmt(avgHrs, 0)} hrs × {fmtUSD(rate)}) · Profit/student ≈ {fmtUSD(profitPerStudent)}/mo
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-semibold text-blue-900">Best Time to Launch?</span>
        </div>
        <div className="text-xs text-blue-800 space-y-1">
          <p><strong>Best months historically</strong>: {bestMonths.map(m => MONTH_NAMES[m.month]).join(', ')} (avg {fmt(bestMonths[0]?.avgHours)} hrs)</p>
          <p><strong>Now (Apr–May)</strong>: Mixed — exams pause some students, but less ad competition = cheaper clicks.</p>
          <p><strong>Recommendation</strong>: Start SEO/content NOW. Start paid ads in July for Aug–Sep back-to-school.</p>
          <p><strong>Ramadan</strong>: Strong enrollment period. Plan a special campaign 2 months before.</p>
        </div>
      </div>

      <Collapsible title="AI Tools for Campaign Management" defaultOpen>
        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { name: 'Claude (Anthropic)', use: 'Content writing, ad copy, campaign strategy.' },
              { name: 'Surfer SEO / NeuronWriter', use: 'Optimize articles for Google ranking.' },
              { name: 'Canva AI', use: 'Social media graphics, ad creatives.' },
              { name: 'Google Ads Smart Bidding', use: 'AI bid optimization. Set target CPA.' },
              { name: 'Meta Advantage+', use: 'Automated Facebook/Instagram campaigns.' },
              { name: 'Opus Clip / CapCut', use: 'Auto-clip videos into TikTok/Reels.' },
              { name: 'ChatGPT + DALL-E', use: 'Visuals, social posts, ad copy variations.' },
              { name: 'Google Search Console', use: 'Free keyword tracking, page indexing.' },
            ].map((tool, i) => (
              <div key={i} className="rounded-lg border border-border p-2">
                <div className="font-medium text-foreground">{tool.name}</div>
                <div className="text-muted-foreground mt-0.5">{tool.use}</div>
              </div>
            ))}
          </div>
        </div>
      </Collapsible>

      <Collapsible title="SEO & Content Strategy">
        <div className="space-y-2 text-xs text-foreground">
          <p><strong>Can AI create SEO content?</strong> Yes, but add personal stories, testimonials, teacher bios.</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Google E-E-A-T: prioritize real experience content.</li>
            <li>Publish 2–4 articles/week on target keywords.</li>
            <li>Include EducationalOrganization schema markup.</li>
          </ul>
          <p className="font-medium mt-2">Target keywords:</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {['online Quran classes', 'learn Quran online', 'Quran tutor for kids', 'online Quran teacher', 'Quran classes USA', 'tajweed classes online', 'Arabic Quran lessons', 'Quran memorization online'].map((kw, i) => (
              <span key={i} className="bg-muted rounded px-2 py-0.5">{kw}</span>
            ))}
          </div>
        </div>
      </Collapsible>

      <Collapsible title="Step-by-Step: First 30 Days">
        <div className="text-xs space-y-1.5">
          {[
            { week: 'Week 1', tasks: ['Set up Google Business Profile', `Google Ads with $${channels.googleAds.budget} budget`, 'Write 3 SEO articles', 'Set up Search Console'] },
            { week: 'Week 2', tasks: ['Create Facebook Page', `Meta Ads with $${channels.facebookInstagram.budget} budget`, 'Publish articles', 'TikTok: post 2 clips'] },
            { week: 'Week 3', tasks: ['Analyze ad data', 'Scale winners, pause losers', '2 more articles', 'YouTube: first video'] },
            { week: 'Week 4', tasks: ['Review channels', 'Optimize CTR', '2 more articles', 'Plan next month'] },
          ].map((w, i) => (
            <div key={i} className="rounded-lg border border-border p-2">
              <div className="font-medium text-foreground mb-1">{w.week}</div>
              <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                {w.tasks.map((t, j) => <li key={j}>{t}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Collapsible>

      <Collapsible title="YouTube & Video Strategy">
        <div className="text-xs space-y-1.5">
          <ul className="list-disc pl-4 space-y-0.5">
            <li><strong>Short lessons (3-5 min)</strong>: One Tajweed rule. TikTok/Reels.</li>
            <li><strong>Student journey (5-10 min)</strong>: Progress over weeks.</li>
            <li><strong>Parent testimonials (2-3 min)</strong>: Real parent review.</li>
            <li><strong>Teacher intros (1-2 min)</strong>: Build trust.</li>
            <li><strong>Q&A / FAQ (5 min)</strong>: Common questions.</li>
          </ul>
          <p className="mt-2"><strong>Tools</strong>: Zoom/Meet to record. CapCut to edit. Opus Clip for auto-subtitles.</p>
        </div>
      </Collapsible>

      <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4">
        <h3 className="text-sm font-bold text-emerald-900 mb-2">Expected Results — {fmtUSD(budget)}/mo {isCustom && <OverrideTag />}</h3>
        <div className="grid grid-cols-3 gap-3 text-center text-xs">
          <div>
            <div className="text-lg font-bold text-emerald-700">Month 1–2</div>
            <div className="text-emerald-800">{Math.round(totalLeads * 0.7)}–{Math.round(totalLeads * 1.8)} leads</div>
            <div className="text-emerald-800">{m1}–{Math.round(m1 * 2.5)} students</div>
            <div className="text-emerald-600 font-medium">+{fmtUSD(revenuePerStudent * m1)}–{fmtUSD(revenuePerStudent * m1 * 2.5)}/mo</div>
          </div>
          <div>
            <div className="text-lg font-bold text-emerald-700">Month 3–6</div>
            <div className="text-emerald-800">SEO kicks in</div>
            <div className="text-emerald-800">{m3}–{m6} students</div>
            <div className="text-emerald-600 font-medium">+{fmtUSD(revenuePerStudent * m3)}–{fmtUSD(revenuePerStudent * m6)}/mo</div>
          </div>
          <div>
            <div className="text-lg font-bold text-emerald-700">Month 6–12</div>
            <div className="text-emerald-800">Compounds</div>
            <div className="text-emerald-800">{m6}–{m12} students</div>
            <div className="text-emerald-600 font-medium">+{fmtUSD(revenuePerStudent * m6)}–{fmtUSD(revenuePerStudent * m12)}/mo</div>
          </div>
        </div>
        <p className="text-[11px] text-emerald-700 mt-2">
          Each new student ≈ {fmtUSD(revenuePerStudent)}/mo revenue, {fmtUSD(profitPerStudent)}/mo profit. ROI positive by month 3–4.
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

  const [timezone, setTimezone] = useState('EST');
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
    setTimezone('EST');
  };

  const hasOverrides = data && (
    hourRate !== Number(data.financial?.chargeRatePerHour) ||
    teacherRateOverride !== Number(data.financial?.currentAvgTeacherRate) ||
    overheadOverride !== Number(data.financial?.monthlyOverhead) ||
    budget !== 100 ||
    timezone !== 'EST'
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
        <div className="flex flex-wrap gap-x-4 gap-y-2 items-center px-5 py-2 border-b border-border bg-muted/30">
          <div className="flex items-center gap-1.5">
            <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">Adjust</span>
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="font-medium">Timezone</span>
            <select className="rounded border border-border bg-background px-2 py-1 text-xs" value={timezone} onChange={e => setTimezone(e.target.value)}>
              {TZ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="font-medium">Charge $/hr</span>
            <input type="number" min="0.5" step="0.25" className="rounded border border-border bg-background px-2 py-1 text-xs w-[72px]" value={hourRate ?? ''} onChange={e => setHourRate(e.target.value ? Number(e.target.value) : null)} />
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="font-medium">Teacher $/hr</span>
            <input type="number" min="0.5" step="0.25" className="rounded border border-border bg-background px-2 py-1 text-xs w-[72px]" value={teacherRateOverride ?? ''} onChange={e => setTeacherRateOverride(e.target.value ? Number(e.target.value) : null)} />
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="font-medium">Overhead</span>
            <input type="number" min="0" step="5" className="rounded border border-border bg-background px-2 py-1 text-xs w-[72px]" value={overheadOverride ?? ''} onChange={e => setOverheadOverride(e.target.value ? Number(e.target.value) : null)} />
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="font-medium">Budget $/mo</span>
            <input type="number" min="10" step="10" className="rounded border border-border bg-background px-2 py-1 text-xs w-[72px]" value={budget} onChange={e => setBudget(Number(e.target.value) || 0)} />
          </label>
          {hasOverrides && (
            <button onClick={resetAll} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium ml-auto">
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-2 border-b border-border">
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
