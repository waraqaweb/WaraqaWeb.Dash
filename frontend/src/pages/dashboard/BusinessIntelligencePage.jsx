import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ResponsiveContainer, LineChart, BarChart, ComposedChart,
  Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { fetchBIHub } from '../../api/businessIntelligence';
import {
  RefreshCcw, DollarSign, Users, TrendingUp, TrendingDown, Minus,
  Target, BarChart3, Award, Lightbulb, AlertTriangle,
  Download, Edit3, Check, BookOpen, Layers,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview',   label: 'Overview',   icon: BarChart3  },
  { id: 'people',     label: 'People',     icon: Users      },
  { id: 'financial',  label: 'Financial',  icon: DollarSign },
  { id: 'history',    label: 'History',    icon: Layers     },
];

const PERIODS = [
  { value: 'thisMonth',    label: 'This month'    },
  { value: 'prevMonth',    label: 'Last month'    },
  { value: 'ytd',          label: 'Year to date'  },
  { value: 'last12months', label: '12-month view' },
  { value: 'custom',       label: 'Custom'        },
];

const TARGETS_KEY = 'waraqa.bi.targets.v4';
const DEFAULT_TARGETS = {
  hours: 150, revenue: 1500, grossProfit: 500, netProfit: 300,
  activeStudents: 30, activeGuardians: 25, newStudents: 5,
  retentionRate: 90, teacherHours: 30, ownerSalary: 400, otherExpenses: 100,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const N   = (v, d = 1) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(d) : '—'; };
const $$  = v => { const n = Number(v); return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'; };
const PCT = v => { const n = Number(v); return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—'; };
const delta = (curr, prev) => prev && prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : null;
const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, Number(v) || 0));

const loadTargets = () => {
  try { const r = localStorage.getItem(TARGETS_KEY); if (r) return { ...DEFAULT_TARGETS, ...JSON.parse(r) }; } catch { }
  return { ...DEFAULT_TARGETS };
};
const saveTargets = t => { try { localStorage.setItem(TARGETS_KEY, JSON.stringify(t)); } catch { } };

const applyWhatIf = (critical, wi) => {
  if (!critical) return null;
  const hrs   = wi.hours ?? critical.completedHours;
  const rph   = wi.revenuePerHour ?? critical.revenuePerHour;
  const tcph  = wi.teacherCostPerHour ?? critical.teacherCostPerHour;
  const ppPct = (wi.paypalRate ?? 3.5) / 100;
  const own   = wi.ownerSalary ?? 0;
  const oth   = wi.otherExpenses ?? 0;
  const rev   = hrs * rph;
  const tSal  = hrs * tcph;
  const pp    = rev * ppPct;
  const gp    = rev - tSal - pp;
  const np    = gp - own - oth;
  return {
    completedHours: hrs, revenue: rev, teacherSalaries: tSal, paypalFees: pp,
    grossProfit: gp, ownerSalary: own, otherExpenses: oth, netProfit: np,
    grossMargin: rev > 0 ? (gp / rev) * 100 : 0,
    netMargin:   rev > 0 ? (np / rev) * 100 : 0,
    revenuePerHour: rph, teacherCostPerHour: tcph,
    profitPerHour:    hrs > 0 ? gp / hrs : 0,
    netProfitPerHour: hrs > 0 ? np / hrs : 0,
    activeStudents: critical.activeStudents,
    activeTeachers: critical.activeTeachers,
    activePayingGuardians: critical.activePayingGuardians,
    prev: critical.prev,
  };
};

const generateInsights = (computed, data, targets) => {
  if (!computed || !data) return [];
  const c = computed; const sh = data.studentHealth; const gh = data.guardianHealth;
  const g = data.growth; const insights = [];
  const prevRev = c.prev?.revenue ?? 0; const prevHrs = c.prev?.completedHours ?? 0;
  const wins = [];
  if (prevRev > 0 && c.revenue > prevRev) wins.push({ text: `Revenue up ${N(delta(c.revenue, prevRev), 1)}% — $${N(c.revenue - prevRev, 0)} gain`, score: c.revenue - prevRev });
  if (prevHrs > 0 && c.completedHours > prevHrs) wins.push({ text: `${N(c.completedHours - prevHrs, 1)} more teaching hours than previous period`, score: (c.completedHours - prevHrs) * 10 });
  if (sh?.retentionRate >= 90) wins.push({ text: `${N(sh.retentionRate, 0)}% student retention`, score: sh.retentionRate });
  if (g?.newStudents > 3)      wins.push({ text: `${g.newStudents} new students enrolled`, score: g.newStudents * 15 });
  wins.sort((a, b) => b.score - a.score);
  if (wins.length) insights.push({ type: 'win', label: 'Biggest win', text: wins[0].text });

  const risks = [];
  if (sh?.lostStudents > 2) risks.push({ text: `${sh.lostStudents} students went inactive — follow up`, score: sh.lostStudents * 10 });
  if (sh?.retentionRate < 80) risks.push({ text: `Retention at ${N(sh.retentionRate, 0)}% — below healthy range`, score: (80 - sh.retentionRate) * 2 });
  if (c.grossProfit < 0) risks.push({ text: `Gross profit is negative — costs exceed revenue`, score: 100 });
  if (sh?.cancellationRate > 20) risks.push({ text: `Cancellation rate ${N(sh.cancellationRate, 0)}% — high`, score: sh.cancellationRate * 2 });
  risks.sort((a, b) => b.score - a.score);
  if (risks.length) insights.push({ type: 'risk', label: 'Biggest risk', text: risks[0].text });

  if (prevRev > 0 && c.revenue !== prevRev) {
    const hDiff = c.completedHours - prevHrs;
    if (c.revenue > prevRev) insights.push({ type: 'explain', label: 'Revenue up because', text: hDiff > 0 ? `${N(hDiff, 1)} more completed hours` : `Higher effective rate per hour` });
    else insights.push({ type: 'explain', label: 'Revenue down because', text: hDiff < 0 ? `${N(Math.abs(hDiff), 1)} fewer hours delivered` : `Lower effective rate per hour` });
  }
  const prevGP = c.prev?.grossProfit ?? 0;
  if (prevGP !== 0 && c.grossProfit !== prevGP) {
    if (c.grossProfit > prevGP) insights.push({ type: 'explain', label: 'Profit improved', text: `Gross margin is ${PCT(c.grossMargin)}` });
    else insights.push({ type: 'explain', label: 'Profit dropped', text: `Higher teacher costs or lower revenue per hour` });
  }
  const tp = data.teacherPerformance;
  if (tp?.teachers) {
    const near = tp.teachers.filter(t => t.hours >= 25 && t.hours < 30);
    if (near.length) insights.push({ type: 'action', label: 'Teachers near tier threshold', text: near.map(t => `${t.name} (${N(t.hours, 0)} hrs)`).join(', ') });
  }
  if (sh?.retentionRate < 85 && sh?.lostStudents > 0)
    insights.push({ type: 'action', label: 'Students at risk', text: `${sh.lostStudents} inactive students — check for disengagement` });
  const actions = [];
  if (targets.hours && c.completedHours < targets.hours * 0.8)
    actions.push(`Only ${N(c.completedHours / targets.hours * 100, 0)}% of hours target — ${N(targets.hours - c.completedHours, 0)} hrs needed`);
  if (targets.revenue && c.revenue < targets.revenue * 0.8)
    actions.push(`Revenue at ${N(c.revenue / targets.revenue * 100, 0)}% of target`);
  if (sh?.cancellationRate > 15) actions.push(`Cancellation rate ${N(sh.cancellationRate, 0)}% — investigate`);
  if (actions.length) insights.push({ type: 'actions', label: 'Recommended actions', list: actions });
  return insights;
};

// ─── Shared sub-components ────────────────────────────────────────────────────
function TrendBadge({ curr, prev }) {
  if (prev == null || prev === 0) return null;
  const d = delta(curr, prev); if (d == null) return null;
  const up = d > 0;
  const Icon = up ? TrendingUp : d < 0 ? TrendingDown : Minus;
  const cls = up ? 'text-emerald-600' : d < 0 ? 'text-rose-500' : 'text-muted-foreground';
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${cls}`}>
      <Icon className="h-3 w-3" />{up ? '+' : ''}{N(d, 1)}% vs prev
    </span>
  );
}

function KPICard({ label, value, sub, target, prev, warn, highlight, className = '', onEditTarget }) {
  const numVal = Number(String(value).replace(/[^0-9.-]/g, '')) || 0;
  const toTarget = target ? delta(numVal, target) : null;
  const isRed = warn ? warn(numVal) : false;
  return (
    <div className={`rounded-xl border border-border bg-card p-2.5 flex flex-col gap-0.5 ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground leading-tight">{label}</div>
      <div className={`text-xl font-bold leading-none ${isRed ? 'text-rose-500' : highlight ? 'text-emerald-600' : 'text-foreground'}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground leading-tight">{sub}</div>}
      {prev != null && <TrendBadge curr={numVal} prev={prev} />}
      {target != null && (
        <div className="flex items-center gap-1 mt-0.5">
          <div className={`text-[11px] font-medium ${toTarget != null && toTarget < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
            {toTarget != null ? (toTarget >= 0 ? `+${N(toTarget, 1)}%` : `${N(toTarget, 1)}%`) : ''} vs target {target}
          </div>
          {onEditTarget && (
            <button type="button" onClick={onEditTarget} className="ml-auto p-0.5 text-muted-foreground hover:text-foreground rounded">
              <Edit3 className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ value, target, label, sub }) {
  const pct = target > 0 ? clamp((value / target) * 100) : 0;
  const over = target > 0 && value > target;
  return (
    <div className="space-y-1">
      {label && (
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground">{sub || `${value} / ${target}`}</span>
        </div>
      )}
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${over ? 'bg-emerald-500' : pct >= 80 ? 'bg-emerald-400' : pct >= 60 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{N(pct, 0)}%</span>
        <span>{over ? 'Target reached' : `${N(target - value, 1)} to go`}</span>
      </div>
    </div>
  );
}

function InlineEdit({ value, onSave, prefix = '', suffix = '' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const open = () => { setDraft(String(value)); setEditing(true); };
  const save = () => { const n = Number(draft); if (!isNaN(n)) onSave(n); setEditing(false); };
  if (editing) return (
    <span className="inline-flex items-center gap-1">
      {prefix}
      <input type="number" value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        className="w-20 rounded border border-primary px-1 py-0.5 text-xs bg-background" autoFocus />
      {suffix}
      <button type="button" onClick={save} className="text-emerald-600"><Check className="h-3 w-3" /></button>
    </span>
  );
  return (
    <button type="button" onClick={open} className="text-xs text-muted-foreground hover:text-foreground border-b border-dashed border-muted-foreground">
      {prefix}{value}{suffix}
    </button>
  );
}

function ScoreGauge({ score, label }) {
  const s = clamp(Number(score) || 0);
  const cls  = s >= 75 ? 'text-emerald-600' : s >= 50 ? 'text-amber-500' : 'text-rose-500';
  const ring = s >= 75 ? 'stroke-emerald-500' : s >= 50 ? 'stroke-amber-400' : 'stroke-rose-400';
  const r = 32; const circ = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
        <circle cx="40" cy="40" r={r} strokeWidth="8" fill="none" className="stroke-muted" />
        <circle cx="40" cy="40" r={r} strokeWidth="8" fill="none" className={ring}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - s / 100)} strokeLinecap="round" />
      </svg>
      <div className={`-mt-14 text-xl font-bold ${cls}`}>{s}</div>
      <div className="mt-7 text-[11px] text-center text-muted-foreground font-medium">{label}</div>
    </div>
  );
}

function SH({ title, sub }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function Grid({ cols = 2, children }) {
  const cn = cols === 3 ? 'grid-cols-2 sm:grid-cols-3' : cols === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2';
  return <div className={`grid ${cn} gap-2`}>{children}</div>;
}

function HistoryBar({ data, dataKey, color = '#6366f1', height = 80 }) {
  if (!data?.length) return null;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <Bar dataKey={dataKey} fill={color} radius={[2, 2, 0, 0]} />
          <Tooltip contentStyle={{ fontSize: 10 }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Tab: Overview ────────────────────────────────────────────────────────────
function TabOverview({ computed, data, targets, setTargets, wi, setWI, wiMode, setWIMode }) {
  const c    = computed;
  const prev = c.prev || {};
  const hist = data.monthlyHistory || [];
  const sb   = data.scoreboard;
  const actual = data.critical;
  const insights = useMemo(() => generateInsights(computed, data, targets), [computed, data, targets]);
  const ut = (k, v) => { const t = { ...targets, [k]: v }; setTargets(t); saveTargets(t); };

  const insightStyles = {
    win:     { Icon: Award,         bg: 'bg-emerald-50', border: 'border-emerald-200', title: 'text-emerald-800', text: 'text-emerald-700' },
    risk:    { Icon: AlertTriangle, bg: 'bg-rose-50',    border: 'border-rose-200',    title: 'text-rose-800',    text: 'text-rose-700'    },
    explain: { Icon: Lightbulb,     bg: 'bg-blue-50',    border: 'border-blue-200',    title: 'text-blue-800',    text: 'text-blue-700'    },
    action:  { Icon: Target,        bg: 'bg-amber-50',   border: 'border-amber-200',   title: 'text-amber-800',   text: 'text-amber-700'   },
    actions: { Icon: BookOpen,      bg: 'bg-indigo-50',  border: 'border-indigo-200',  title: 'text-indigo-800',  text: 'text-indigo-700'  },
  };

  return (
    <div className="space-y-4">
      {/* ── Scoreboard ── */}
      {sb && (
        <section>
          <SH title="Business Health Scoreboard" sub="0–100 each — based on actual vs previous period" />
          <div className="rounded-xl border border-border bg-card p-3 mb-2 text-center">
            <div className={`text-6xl font-black ${sb.overall >= 75 ? 'text-emerald-600' : sb.overall >= 50 ? 'text-amber-500' : 'text-rose-500'}`}>{sb.overall}</div>
            <div className="text-2xl font-semibold text-muted-foreground mt-1">{sb.overall >= 80 ? 'Excellent' : sb.overall >= 65 ? 'Good' : sb.overall >= 50 ? 'Fair' : 'Needs work'}</div>
            <div className="text-sm text-muted-foreground">Overall business health score</div>
          </div>
          <div className="grid grid-cols-5 gap-2 mb-2">
            {[['Hours', sb.hours], ['Revenue', sb.revenue], ['Profit', sb.profit], ['Retention', sb.retention], ['Growth', sb.growth]].map(([l, s]) => (
              <ScoreGauge key={l} score={s} label={l} />
            ))}
          </div>
          <div className="rounded-xl border border-border bg-card p-2.5 space-y-1.5">
            {[
              { label: 'Hours',     score: sb.hours,     desc: `${N(c.completedHours, 1)} hrs vs ${N(c.prev?.completedHours ?? 0, 1)} prev` },
              { label: 'Revenue',   score: sb.revenue,   desc: `${$$(c.revenue)} vs ${$$(c.prev?.revenue ?? 0)} prev` },
              { label: 'Profit',    score: sb.profit,    desc: `Gross margin ${PCT(c.grossMargin)} · 40% = 100 pts` },
              { label: 'Retention', score: sb.retention, desc: `${PCT(data.studentHealth?.retentionRate ?? 0)} student retention` },
              { label: 'Growth',    score: sb.growth,    desc: `${data.studentHealth?.newStudents ?? 0} new, ${data.studentHealth?.lostStudents ?? 0} lost` },
            ].map(({ label, score, desc }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="w-24 text-xs font-medium shrink-0">{label}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full ${score >= 75 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${score}%` }} />
                </div>
                <span className={`w-8 text-xs font-bold text-right ${score >= 75 ? 'text-emerald-600' : score >= 50 ? 'text-amber-500' : 'text-rose-500'}`}>{score}</span>
                <span className="text-[10px] text-muted-foreground hidden sm:block w-48 truncate">{desc}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Critical Numbers ── */}
      <section>
        <SH title="Critical Numbers" sub={`Completed teaching hours only — ${data.periodLabel}`} />
        {/* What-if calculator */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 mb-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-amber-900">What-if calculator</div>
              <div className="text-xs text-amber-700">Adjust inputs to see projected outcomes.</div>
            </div>
            <button type="button" onClick={() => setWIMode(!wiMode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${wiMode ? 'bg-amber-500 text-white' : 'bg-white border border-amber-300 text-amber-800'}`}>
              {wiMode ? 'Custom ON' : 'Enable what-if'}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { label: 'Hours',            key: 'hours',             act: actual.completedHours },
              { label: 'Revenue/hr',       key: 'revenuePerHour',    act: actual.revenuePerHour },
              { label: 'Teacher cost/hr',  key: 'teacherCostPerHour',act: actual.teacherCostPerHour },
              { label: 'Owner salary',     key: 'ownerSalary',       act: 0 },
              { label: 'Other expenses',   key: 'otherExpenses',     act: 0 },
            ].map(({ label, key, act }) => (
              <label key={key} className="block text-xs">
                <span className="text-muted-foreground">{label}</span>
                <input type="number" value={wi[key] != null ? wi[key] : act}
                  onChange={e => { setWI(p => ({ ...p, [key]: Number(e.target.value) })); if (!wiMode) setWIMode(true); }}
                  className={`mt-0.5 w-full rounded border px-2 py-1 text-xs ${wi[key] != null && wi[key] !== act ? 'border-amber-400 bg-amber-50' : 'border-border bg-background'}`} />
              </label>
            ))}
          </div>
          {wiMode && (
            <button type="button" onClick={() => { setWI({ ownerSalary: 0, otherExpenses: 0, paypalRate: 3.5 }); setWIMode(false); }}
              className="mt-2 text-xs text-amber-700 underline">Reset to actuals</button>
          )}
        </div>
        <Grid cols={4}>
          <KPICard label="Completed hours" value={`${N(c.completedHours, 1)} hrs`} target={targets.hours} prev={prev.completedHours} highlight={c.completedHours >= (targets.hours || 0)} onEditTarget={() => { const v = prompt('Hours target:', targets.hours); if (v) ut('hours', Number(v)); }} />
          <KPICard label="Revenue" value={$$(c.revenue)} target={targets.revenue} prev={prev.revenue} highlight={c.revenue >= (targets.revenue || 0)} onEditTarget={() => { const v = prompt('Revenue target:', targets.revenue); if (v) ut('revenue', Number(v)); }} />
          <KPICard label="Gross profit" value={$$(c.grossProfit)} target={targets.grossProfit} prev={prev.grossProfit} highlight={c.grossProfit >= 0} warn={v => v < 0} onEditTarget={() => { const v = prompt('Gross profit target:', targets.grossProfit); if (v) ut('grossProfit', Number(v)); }} />
          <KPICard label="Net profit" value={$$(c.netProfit ?? c.grossProfit - (wi.ownerSalary || 0) - (wi.otherExpenses || 0))} warn={v => v < 0} sub={`Owner $${wi.ownerSalary || 0} + Other $${wi.otherExpenses || 0}`} />
        </Grid>
        <div className="mt-2 mb-2">
          <Grid cols={4}>
            <KPICard label="Active paying guardians" value={c.activePayingGuardians} target={targets.activeGuardians} prev={prev.activePayingGuardians} onEditTarget={() => { const v = prompt('Guardians target:', targets.activeGuardians); if (v) ut('activeGuardians', Number(v)); }} />
            <KPICard label="Active students" value={c.activeStudents} target={targets.activeStudents} prev={prev.activeStudents} onEditTarget={() => { const v = prompt('Students target:', targets.activeStudents); if (v) ut('activeStudents', Number(v)); }} />
            <KPICard label="Active teachers" value={c.activeTeachers} sub="Taught at least 1 completed class" />
            <KPICard label="Teacher salaries" value={$$(c.teacherSalaries)} prev={prev.teacherSalaries} sub={`${$$(c.teacherCostPerHour)}/hr`} />
          </Grid>
        </div>
        <Grid cols={3}>
          <KPICard label="Revenue per hour" value={$$(c.revenuePerHour)} sub="Avg charge rate" />
          <KPICard label="Teacher cost per hour" value={$$(c.teacherCostPerHour)} />
          <KPICard label="Gross profit per hour" value={$$(c.profitPerHour)} highlight={c.profitPerHour > 0} warn={v => v < 0} sub="After teacher costs and PayPal" />
        </Grid>
        {hist.length > 1 && (
          <div className="rounded-xl border border-border bg-card p-2.5 mt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">12-month trend</div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={hist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                  <YAxis yAxisId="l" tick={{ fontSize: 9 }} width={36} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9 }} width={48} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="completedHours" fill="#6366f1" name="Hours" radius={[2, 2, 0, 0]} opacity={0.8} />
                  <Line yAxisId="r" type="monotone" dataKey="revenue" stroke="#22c55e" name="Revenue" strokeWidth={2} dot={false} />
                  <Line yAxisId="r" type="monotone" dataKey="grossProfit" stroke="#f59e0b" name="Profit" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>

      {/* ── Owner Insights ── */}
      <section>
        <SH title="Owner Insights" sub="Auto-generated signals. No fluff." />
        {!insights.length && <div className="text-muted-foreground text-sm">No insights available for this period.</div>}
        <div className="space-y-2">
          {insights.map((ins, i) => {
            const { Icon, bg, border, title, text } = insightStyles[ins.type] || insightStyles.explain;
            return (
              <div key={i} className={`rounded-xl border ${border} ${bg} p-2.5`}>
                <div className={`flex items-center gap-2 font-semibold text-sm ${title} mb-1`}><Icon className="h-4 w-4" />{ins.label}</div>
                {ins.text && <p className={`text-sm ${text}`}>{ins.text}</p>}
                {ins.list && <ul className={`mt-1 space-y-1 text-sm ${text}`}>{ins.list.map((item, j) => (
                  <li key={j} className="flex items-start gap-1.5"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />{item}</li>
                ))}</ul>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ─── Tab: People ──────────────────────────────────────────────────────────────
function TabPeople({ data, targets, setTargets }) {
  const sh = data.studentHealth;
  const gh = data.guardianHealth;
  const tp = data.teacherPerformance;
  const v  = data.vacationAnalytics;
  const hist = data.monthlyHistory || [];
  const teachers = tp.teachers || [];
  const maxH = teachers.length ? Math.max(...teachers.map(t => t.hours)) : 0;
  const minH = teachers.length ? Math.min(...teachers.map(t => t.hours)) : 0;
  const ut = (k, val) => { const t = { ...targets, [k]: val }; setTargets(t); saveTargets(t); };

  return (
    <div className="space-y-4">
      {/* ── Student Health ── */}
      <section>
        <SH title="Student Health" />
        <Grid cols={4}>
          <KPICard label="Active students" value={sh.activeStudents} target={targets.activeStudents} highlight={sh.activeStudents >= (targets.activeStudents || 0)} onEditTarget={() => { const val = prompt('Active students target:', targets.activeStudents); if (val) ut('activeStudents', Number(val)); }} />
          <KPICard label="New students"    value={sh.newStudents}    highlight={sh.newStudents > 0} />
          <KPICard label="Lost students"   value={sh.lostStudents}   warn={v => v > 2} sub="Active prev period, not this" />
          <KPICard label="Retention rate"  value={PCT(sh.retentionRate)} highlight={sh.retentionRate >= 85} warn={v => v < 80} />
        </Grid>
        <div className="mt-2">
          <Grid cols={3}>
            <KPICard label="Avg hrs / student"      value={`${N(sh.avgHoursPerStudent, 1)} hrs`} />
            <KPICard label="Revenue / student"      value={$$(sh.revenuePerStudent)} />
            <KPICard label="Gross profit / student" value={$$(sh.grossProfitPerStudent)} highlight={sh.grossProfitPerStudent > 0} />
          </Grid>
        </div>
        <div className="mt-2">
          <Grid cols={3}>
            <KPICard label="Attendance rate"   value={PCT(sh.attendanceRate)} highlight={sh.attendanceRate >= 85} warn={v => v < 75} sub="Completed ÷ (completed + cancelled)" />
            <KPICard label="Cancellation rate" value={PCT(sh.cancellationRate)} warn={v => v > 20} sub={`${sh.cancelledClasses} of ${sh.totalClasses}`} />
            <KPICard label="Completed classes" value={sh.completedClasses} sub={`${sh.totalClasses} total`} />
          </Grid>
        </div>
        {hist.length > 1 && (
          <div className="rounded-xl border border-border bg-card p-2.5 mt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Active students · 12 months</div>
            <HistoryBar data={hist} dataKey="activeStudents" color="#6366f1" height={100} />
          </div>
        )}
      </section>

      {/* ── Guardian Health ── */}
      <section>
        <SH title="Guardian Health" />
        <Grid cols={4}>
          <KPICard label="Active paying guardians" value={gh.activePayingGuardians} highlight={gh.activePayingGuardians > 0} />
          <KPICard label="New guardians"           value={gh.newGuardians}           highlight={gh.newGuardians > 0} />
          <KPICard label="Lost guardians"          value={gh.lostGuardians}          warn={v => v > 2} />
          <KPICard label="Retention rate"          value={PCT(gh.retentionRate)}     highlight={gh.retentionRate >= 85} warn={v => v < 80} />
        </Grid>
        <div className="mt-2">
          <Grid cols={2}>
            <KPICard label="Avg revenue / guardian" value={$$(gh.avgRevenuePerGuardian)} />
            <KPICard label="Avg hours / guardian"   value={`${N(gh.avgHoursPerGuardian, 1)} hrs`} />
          </Grid>
        </div>
        {gh.topByRevenue?.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            {[['Top 10 by revenue', gh.topByRevenue, g => $$(g.revenue)], ['Top 10 by hours', gh.topByHours, g => `${N(g.hours, 1)} hrs`]].map(([title, list, fmt]) => (
              <div key={title} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-3 py-1.5 bg-muted/30 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
                <div className="divide-y divide-border">
                  {list.map((g, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs hover:bg-muted/10">
                      <span className="font-medium">{i + 1}. {g.name}</span>
                      <span className="font-semibold text-emerald-600">{fmt(g)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {hist.length > 1 && (
          <div className="rounded-xl border border-border bg-card p-2.5 mt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Active guardians · 12 months</div>
            <HistoryBar data={hist} dataKey="activeGuardians" color="#22c55e" height={80} />
          </div>
        )}
        <div className="mt-2">
          <Grid cols={2}>
            <KPICard label="Guardians on vacation" value={gh.guardiansOnVacation} />
            <KPICard label="Students on vacation"  value={gh.studentsOnVacation} />
          </Grid>
        </div>
      </section>

      {/* ── Teacher Performance ── */}
      <section>
        <SH title="Teacher Performance" sub="Completed hours only" />
        <Grid cols={4}>
          <KPICard label="Active teachers"     value={tp.activeTeachers} />
          <KPICard label="Total teacher hours" value={`${N(tp.totalTeacherHours, 1)} hrs`} />
          <KPICard label="Avg hours / teacher" value={`${N(tp.avgTeacherHours, 1)} hrs`} />
          <KPICard label="Avg hourly rate"     value={$$(tp.avgHourlyRate)} />
        </Grid>
        <div className="mt-2">
          <Grid cols={2}>
            <KPICard label="Total salary cost"       value={$$(tp.salaryCost)} />
            <KPICard label="Cost per teaching hour"  value={$$(tp.costPerTeachingHour)} />
          </Grid>
        </div>
        {teachers.length > 0 && (
          <div className="rounded-xl border border-border bg-card overflow-hidden mt-2">
            <div className="px-3 py-1.5 bg-muted/30 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per-teacher</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    {['Teacher', 'Hours', 'Classes', 'Students', 'Rate/hr', 'Est. cost'].map(h => (
                      <th key={h} className={`px-3 py-2 font-medium text-muted-foreground ${h === 'Teacher' ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teachers.map((t, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/10">
                      <td className="px-3 py-2 font-medium">{t.name}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${t.hours === maxH ? 'text-emerald-600' : t.hours === minH && teachers.length > 1 ? 'text-rose-500' : ''}`}>{N(t.hours, 1)}</td>
                      <td className="px-3 py-2 text-right">{t.classes}</td>
                      <td className="px-3 py-2 text-right">{t.studentCount}</td>
                      <td className="px-3 py-2 text-right">{t.rateUSD != null ? $$(t.rateUSD) : '—'}</td>
                      <td className="px-3 py-2 text-right">{t.estimatedCost != null ? $$(t.estimatedCost) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/20 font-semibold">
                    <td className="px-3 py-2 text-muted-foreground">Totals</td>
                    <td className="px-3 py-2 text-right">{N(tp.totalTeacherHours, 1)}</td>
                    <td className="px-3 py-2 text-right">{teachers.reduce((s, t) => s + t.classes, 0)}</td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{$$(tp.avgHourlyRate)} avg</td>
                    <td className="px-3 py-2 text-right">{$$(tp.salaryCost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
        {hist.length > 1 && (
          <div className="rounded-xl border border-border bg-card p-2.5 mt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Completed hours · 12 months</div>
            <HistoryBar data={hist} dataKey="completedHours" color="#8b5cf6" height={80} />
          </div>
        )}
      </section>

      {/* ── Vacations ── */}
      <section>
        <SH title="Vacation Analytics" />
        <Grid cols={2}>
          <KPICard label="Students on vacation"  value={v.studentsOnVacation} />
          <KPICard label="Guardians on vacation" value={v.guardiansOnVacation} />
        </Grid>
      </section>
    </div>
  );
}

// ─── Tab: Financial ───────────────────────────────────────────────────────────
function TabFinancial({ computed, data, targets, setTargets }) {
  const c    = computed;
  const fin  = data.financial;
  const g    = data.growth;
  const sh   = data.studentHealth;
  const hist = data.monthlyHistory || [];
  const own  = c.ownerSalary ?? 0;
  const oth  = c.otherExpenses ?? 0;
  const np   = c.grossProfit - own - oth;
  const netMargin = c.revenue > 0 ? (np / c.revenue) * 100 : 0;
  const ut = (k, v) => { const t = { ...targets, [k]: v }; setTargets(t); saveTargets(t); };

  const targetRows = [
    { key: 'hours',           label: 'Monthly hours',           value: c.completedHours,        prefix: '', suffix: ' hrs' },
    { key: 'revenue',         label: 'Monthly revenue',         value: c.revenue,               prefix: '$', suffix: '' },
    { key: 'grossProfit',     label: 'Monthly gross profit',    value: c.grossProfit,           prefix: '$', suffix: '' },
    { key: 'activeStudents',  label: 'Active students',         value: c.activeStudents,        prefix: '', suffix: '' },
    { key: 'activeGuardians', label: 'Active guardians',        value: c.activePayingGuardians, prefix: '', suffix: '' },
    { key: 'ownerSalary',     label: 'Owner salary',            value: null,                    prefix: '$', suffix: '' },
    { key: 'otherExpenses',   label: 'Other expenses',          value: null,                    prefix: '$', suffix: '' },
  ];

  return (
    <div className="space-y-4">
      {/* ── Income statement ── */}
      <section>
        <SH title="Financial Analytics" sub="Revenue = paid invoices only" />
        <div className="rounded-xl border border-border bg-card overflow-hidden mb-2">
          <div className="px-3 py-1.5 bg-muted/30 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Income statement</div>
          <div className="divide-y divide-border text-sm">
            {[
              { l: 'Revenue',              v: c.revenue,          cls: 'text-foreground font-semibold' },
              { l: '— Teacher salaries',   v: -c.teacherSalaries, cls: 'text-rose-500 pl-4' },
              { l: '— PayPal fees (3.5%)', v: -c.paypalFees,      cls: 'text-rose-500 pl-4' },
              { l: 'Gross profit',         v: c.grossProfit,      cls: c.grossProfit >= 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold', border: true },
              { l: '— Owner salary',       v: -own,               cls: 'text-rose-500 pl-4' },
              { l: '— Other expenses',     v: -oth,               cls: 'text-rose-500 pl-4' },
              { l: 'Net profit',           v: np,                 cls: np >= 0 ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold', border: true },
            ].map(({ l, v, cls, border }) => (
              <div key={l} className={`flex items-center justify-between px-3 py-1.5 ${border ? 'border-t-2 border-border bg-muted/10' : ''}`}>
                <span className="text-muted-foreground">{l}</span>
                <span className={cls}>{$$(v)}</span>
              </div>
            ))}
          </div>
        </div>
        <Grid cols={4}>
          <KPICard label="Gross margin"   value={PCT(c.grossMargin)} highlight={c.grossMargin > 30} warn={v => v < 10} />
          <KPICard label="Net margin"     value={PCT(netMargin)} highlight={netMargin > 20} warn={v => v < 0} />
          <KPICard label="Revenue growth" value={fin.revenueGrowth != null ? `${fin.revenueGrowth > 0 ? '+' : ''}${N(fin.revenueGrowth, 1)}%` : '—'} highlight={(fin.revenueGrowth ?? 0) > 0} />
          <KPICard label="Profit growth"  value={fin.profitGrowth != null ? `${fin.profitGrowth > 0 ? '+' : ''}${N(fin.profitGrowth, 1)}%` : '—'} highlight={(fin.profitGrowth ?? 0) > 0} />
        </Grid>
        {hist.length > 1 && (
          <div className="rounded-xl border border-border bg-card p-2.5 mt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Revenue vs gross profit</div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={hist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} width={48} />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={v => $$(v)} />
                  <Bar dataKey="revenue" fill="#22c55e" name="Revenue" radius={[2, 2, 0, 0]} opacity={0.8} />
                  <Bar dataKey="grossProfit" fill="#6366f1" name="Gross profit" radius={[2, 2, 0, 0]} opacity={0.8} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>

      {/* ── Target Tracker ── */}
      <section>
        <SH title="Target Tracker" sub="Click any target to edit inline." />
        <div className="space-y-2.5">
          {targetRows.map(({ key, label, value, prefix, suffix }) => (
            <div key={key} className="rounded-xl border border-border bg-card p-2.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">
                  Target: <InlineEdit value={targets[key] || 0} prefix={prefix} suffix={suffix} onSave={v => ut(key, v)} />
                </span>
              </div>
              {value != null && targets[key] > 0 && (
                <ProgressBar value={+N(value, 1)} target={targets[key]} sub={`${prefix}${N(value, 1)} / ${prefix}${targets[key]}${suffix}`} />
              )}
              {value == null && <div className="text-xs text-muted-foreground">Set target to track</div>}
            </div>
          ))}
        </div>
      </section>

      {/* ── Growth ── */}
      <section>
        <SH title="Growth Analytics" />
        <Grid cols={4}>
          <KPICard label="New students"        value={g.newStudents}  highlight={g.newStudents > 0} />
          <KPICard label="New guardians"       value={g.newGuardians} highlight={g.newGuardians > 0} />
          <KPICard label="Student growth rate" value={PCT(g.studentGrowthRate)} highlight={(g.studentGrowthRate ?? 0) > 0} sub="New ÷ total active" />
          <KPICard label="Student retention"   value={PCT(sh?.retentionRate ?? 0)} highlight={(sh?.retentionRate ?? 0) >= 85} warn={v => v < 80} />
        </Grid>
        <div className="mt-2">
          <Grid cols={3}>
            <KPICard label="Hours MoM"   value={g.hoursGrowthMoM != null ? `${g.hoursGrowthMoM > 0 ? '+' : ''}${N(g.hoursGrowthMoM, 1)}%` : '—'} highlight={(g.hoursGrowthMoM ?? 0) > 0} />
            <KPICard label="Revenue MoM" value={g.revenueGrowthMoM != null ? `${g.revenueGrowthMoM > 0 ? '+' : ''}${N(g.revenueGrowthMoM, 1)}%` : '—'} highlight={(g.revenueGrowthMoM ?? 0) > 0} />
            <KPICard label="Profit MoM"  value={g.profitGrowthMoM != null ? `${g.profitGrowthMoM > 0 ? '+' : ''}${N(g.profitGrowthMoM, 1)}%` : '—'} highlight={(g.profitGrowthMoM ?? 0) > 0} />
          </Grid>
        </div>
        <div className="mt-2">
          <Grid cols={3}>
            <KPICard label="Avg 3-month revenue"   value={$$(g.rolling3MonthRevenue)} />
            <KPICard label="3-month growth"         value={g.rolling3MonthGrowth != null ? `${g.rolling3MonthGrowth > 0 ? '+' : ''}${N(g.rolling3MonthGrowth, 1)}%` : '—'} highlight={(g.rolling3MonthGrowth ?? 0) > 0} />
            <KPICard label="12-month hours total"   value={`${N(g.rolling12MonthHours, 1)} hrs`} />
          </Grid>
        </div>
        {hist.length > 1 && (
          <div className="rounded-xl border border-border bg-card p-2.5 mt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Monthly revenue</div>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} width={48} />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={v => $$(v)} />
                  <Bar dataKey="revenue" radius={[3, 3, 0, 0]} name="Revenue">
                    {hist.map((mo, i) => {
                      const prev = hist[i - 1]?.revenue || 0;
                      return <Cell key={i} fill={!prev || mo.revenue >= prev ? '#22c55e' : '#ef4444'} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Tab: History ─────────────────────────────────────────────────────────────
function TabHistory({ data }) {
  const hist = data.monthlyHistory || [];
  const exportCSV = () => {
    const headers = ['Month', 'Hrs', 'Revenue', 'Teacher Cost', 'PayPal', 'Gross Profit', 'Students', 'Guardians', 'Teachers', 'New Students', 'Avg Hrs/Stu', 'Rev/Hr', 'Profit/Hr'];
    const rows = hist.map(m => [m.label, m.completedHours, (m.revenue || 0).toFixed(2), (m.teacherCost || 0).toFixed(2), (m.paypalFees || 0).toFixed(2), (m.grossProfit || 0).toFixed(2), m.activeStudents || 0, m.activeGuardians || 0, m.activeTeachers || 0, m.newStudents || 0, m.avgStudentHours || 0, m.revenuePerHour || 0, m.profitPerHour || 0]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    a.download = `waraqa-history-${new Date().toISOString().slice(0, 7)}.csv`;
    a.click();
  };
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Monthly History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Last 12+ months · completed hours only</p>
        </div>
        <button type="button" onClick={exportCSV}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted/50">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>
      {!hist.length ? (
        <div className="text-muted-foreground text-sm">No history data.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['Month', 'Hrs', 'Revenue', 'Teacher cost', 'PayPal', 'Gross profit', 'Students', 'Guardians', 'Teachers', 'New', 'Avg hrs', 'Rev/hr', 'Profit/hr'].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...hist].reverse().map((m, i) => (
                <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/10">
                  <td className="px-3 py-2 font-semibold">{m.label}</td>
                  <td className="px-3 py-2 text-indigo-600 font-semibold">{N(m.completedHours, 1)}</td>
                  <td className="px-3 py-2 text-emerald-600 font-semibold">{$$(m.revenue || 0)}</td>
                  <td className="px-3 py-2 text-rose-500">{$$(m.teacherCost || 0)}</td>
                  <td className="px-3 py-2 text-rose-400">{$$(m.paypalFees || 0)}</td>
                  <td className={`px-3 py-2 font-semibold ${(m.grossProfit || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{$$(m.grossProfit || 0)}</td>
                  <td className="px-3 py-2">{m.activeStudents || 0}</td>
                  <td className="px-3 py-2">{m.activeGuardians || 0}</td>
                  <td className="px-3 py-2">{m.activeTeachers || 0}</td>
                  <td className="px-3 py-2">{m.newStudents || 0}</td>
                  <td className="px-3 py-2">{N(m.avgStudentHours, 1)}</td>
                  <td className="px-3 py-2">{$$(m.revenuePerHour || 0)}</td>
                  <td className={`px-3 py-2 ${(m.profitPerHour || 0) >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{$$(m.profitPerHour || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Period Picker ─────────────────────────────────────────────────────────────
function PeriodPicker({ period, setPeriod, customRange, setCustomRange }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select value={period} onChange={e => setPeriod(e.target.value)}
        className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-medium">
        {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      {period === 'custom' && (
        <>
          <input type="date" value={customRange.start} onChange={e => setCustomRange(p => ({ ...p, start: e.target.value }))} className="rounded border border-border bg-background px-2 py-1 text-xs" />
          <span className="text-muted-foreground text-xs">–</span>
          <input type="date" value={customRange.end} onChange={e => setCustomRange(p => ({ ...p, end: e.target.value }))} className="rounded border border-border bg-background px-2 py-1 text-xs" />
        </>
      )}
    </div>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────
export default function BusinessIntelligencePage({ isActive, embedded = false, controlledTab = null }) {
  const [period,      setPeriod]      = useState('thisMonth');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [tabState,    setTab]         = useState('overview');
  const tab = controlledTab || tabState;
  const [targets,     setTargets]     = useState(() => loadTargets());
  const [wi,          setWI]          = useState({ ownerSalary: 0, otherExpenses: 0, paypalRate: 3.5 });
  const [wiMode,      setWIMode]      = useState(false);

  useEffect(() => {
    if (data && !wiMode) {
      setWI(p => ({
        ...p,
        revenuePerHour:     data.critical?.revenuePerHour     ?? p.revenuePerHour,
        teacherCostPerHour: data.critical?.teacherCostPerHour ?? p.teacherCostPerHour,
      }));
    }
  }, [data]);

  const computed = useMemo(() => applyWhatIf(data?.critical ?? null, wi), [data, wi]);

  const fetchData = useCallback(() => {
    if (period === 'custom' && (!customRange.start || !customRange.end)) return;
    let cancelled = false;
    setLoading(true); setError(null);
    fetchBIHub({ period, startDate: customRange.start, endDate: customRange.end })
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(e => { if (!cancelled) setError(e?.response?.data?.message || e?.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, customRange]);

  useEffect(() => { if (isActive) return fetchData(); }, [isActive, period, customRange]);

  const sp = { computed, data, targets, setTargets, wi, setWI, wiMode, setWIMode };

  return (
    <div className={`flex flex-col h-full ${embedded ? 'bg-transparent' : 'bg-background'}`}>
      {/* ── Page header ── */}
      <div className={`${embedded ? 'px-0 pt-0 pb-1.5' : 'px-3 sm:px-4 pt-3 pb-2 border-b border-border bg-background'} shrink-0`}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            {!embedded ? (
              <h1 className="text-xl font-bold flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Business Intelligence
              </h1>
            ) : (controlledTab ? null : (
              <h2 className="text-base font-semibold text-foreground">Business Intelligence</h2>
            ))}
            {data?.periodLabel && <p className="text-sm text-muted-foreground mt-0.5">{data.periodLabel}</p>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <PeriodPicker period={period} setPeriod={setPeriod} customRange={customRange} setCustomRange={setCustomRange} />
            <button type="button" onClick={fetchData}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              disabled={loading} title="Refresh">
              <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        {/* ── Tabs ── */}
        {!controlledTab && (
          <div className="flex gap-1 -mb-px overflow-x-auto pb-1">
            {TABS.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} type="button" onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-t-lg border-b-2 transition-colors whitespace-nowrap ${active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'}`}>
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Tab content ── */}
      <div className={`flex-1 overflow-y-auto ${embedded ? 'px-0 py-1.5' : 'px-3 sm:px-4 py-3'}`}>
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 mb-4">
            <AlertTriangle className="inline h-4 w-4 mr-1.5 mb-0.5" />{error}
          </div>
        )}
        {loading && !data && (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            <RefreshCcw className="h-5 w-5 animate-spin mr-2" />Loading data…
          </div>
        )}
        {!loading && !data && !error && (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            Select a period and click refresh to load data.
          </div>
        )}
        {data && computed && (
          <>
            {tab === 'overview'  && <TabOverview  {...sp} />}
            {tab === 'people'    && <TabPeople    data={data} targets={targets} setTargets={setTargets} />}
            {tab === 'financial' && <TabFinancial {...sp} />}
            {tab === 'history'   && <TabHistory   data={data} />}
          </>
        )}
      </div>
    </div>
  );
}
