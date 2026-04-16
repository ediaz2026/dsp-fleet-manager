import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend, LineChart, Line, ReferenceLine,
} from 'recharts';
import * as XLSX from 'xlsx';
import {
  ChevronLeft, ChevronRight, Download, BarChart2, TrendingUp,
  AlertTriangle, Users, Shield, X, Filter, ClipboardList,
} from 'lucide-react';
import { format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, addWeeks, addMonths, subMonths, subDays, getDaysInMonth } from 'date-fns';
import api from '../api/client';
import toast from 'react-hot-toast';

// ── Colour helpers ────────────────────────────────────────────────────────────
const DSP_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#F97316','#EC4899','#14B8A6','#84CC16','#6366F1','#A855F7'];
const LSMD_COLOR = '#2563EB';
const DIFF_DOT   = { 1: { dot: '🟢', cls: 'text-emerald-700 bg-emerald-50' }, 2: { dot: '🟡', cls: 'text-yellow-700 bg-yellow-50' }, 3: { dot: '🟠', cls: 'text-orange-700 bg-orange-50' }, 4: { dot: '🔴', cls: 'text-red-700 bg-red-100' }, 5: { dot: '⛔', cls: 'text-red-900 bg-red-200' } };
const RESCUE_REASONS = ['Heavy Route', 'Performance', 'Vehicle Issue', 'Personal Emergency', 'Weather', 'Other'];

function pct(n, total) { return total ? ((n / total) * 100).toFixed(1) : '0.0'; }

function Card({ title, icon: Icon, children, className = '', action }) {
  return (
    <div className={`bg-white rounded-2xl border border-card-border shadow-sm ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-card-border">
          <div className="flex items-center gap-2">
            {Icon && <Icon size={16} className="text-primary" />}
            {title && <h3 className="font-semibold text-sm text-content">{title}</h3>}
          </div>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

function ExportBtn({ onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-card-border text-xs font-semibold text-content-muted hover:text-primary hover:border-primary transition-all disabled:opacity-40">
      <Download size={13} /> Export
    </button>
  );
}

function RangeBar({ range, setRange, cStart, setCStart, cEnd, setCEnd, start, end }) {
  return (
    <div className="flex items-center gap-3 flex-wrap bg-white rounded-xl border border-card-border px-4 py-2.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-content-muted">Range:</span>
      {['week', 'month', 'custom'].map(r => (
        <button key={r} onClick={() => setRange(r)}
          className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-all ${range === r ? 'bg-primary text-white' : 'bg-slate-100 text-content-muted hover:bg-slate-200'}`}>
          {r}
        </button>
      ))}
      {range === 'custom' && (
        <>
          <input type="date" value={cStart} onChange={e => setCStart(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary" />
          <span className="text-content-muted text-xs">→</span>
          <input type="date" value={cEnd} onChange={e => setCEnd(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary" />
        </>
      )}
      {start && end && (
        <span className="text-xs text-content-muted ml-auto">
          {format(parseISO(start), 'MMM d')} — {format(parseISO(end), 'MMM d, yyyy')}
        </span>
      )}
    </div>
  );
}

function useRange() {
  const [range, setRange]   = useState('week');
  const [cStart, setCStart] = useState('');
  const [cEnd, setCEnd]     = useState('');
  const { start, end } = useMemo(() => {
    const today = new Date();
    if (range === 'week')  return { start: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'), end: format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd') };
    if (range === 'month') return { start: format(startOfMonth(today), 'yyyy-MM-dd'), end: format(endOfMonth(today), 'yyyy-MM-dd') };
    return { start: cStart, end: cEnd };
  }, [range, cStart, cEnd]);
  return { range, setRange, cStart, setCStart, cEnd, setCEnd, start, end };
}

// ══ SUB-SECTION 1: VOLUME SHARE ═════════════════════════════════════════════
function VolumeShareTab() {
  const today = format(new Date(), 'yyyy-MM-dd');

  // Persisted state — remember last view and position per view
  const [vsView, setVsViewRaw] = useState(() => localStorage.getItem('vs_view') || 'day');
  const [vsDate, setVsDateRaw] = useState(() => localStorage.getItem('vs_day_date') || today);
  const [vsWeekStart, setVsWeekStartRaw] = useState(() => {
    const stored = localStorage.getItem('vs_week_start');
    return stored || format(startOfWeek(new Date(), { weekStartsOn: 0 }), 'yyyy-MM-dd');
  });
  const [vsMonth, setVsMonthRaw] = useState(() => localStorage.getItem('vs_month') || format(new Date(), 'yyyy-MM'));
  const [chartType, setChartType] = useState('bar');

  const setVsView      = v => { setVsViewRaw(v);      localStorage.setItem('vs_view', v); };
  const setVsDate      = v => { setVsDateRaw(v);      localStorage.setItem('vs_day_date', v); };
  const setVsWeekStart = v => { setVsWeekStartRaw(v); localStorage.setItem('vs_week_start', v); };
  const setVsMonth     = v => { setVsMonthRaw(v);     localStorage.setItem('vs_month', v); };

  // Derived ranges
  const weekEnd    = format(endOfWeek(parseISO(vsWeekStart), { weekStartsOn: 0 }), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(parseISO(vsMonth + '-01')), 'yyyy-MM-dd');
  const monthEnd   = format(endOfMonth(parseISO(vsMonth + '-01')), 'yyyy-MM-dd');
  const daysInMo   = getDaysInMonth(parseISO(vsMonth + '-01'));

  // Queries
  const { data: dateList = [] } = useQuery({
    queryKey: ['volume-share-dates'],
    queryFn: () => api.get('/analytics/volume-share').then(r => r.data),
  });

  const { data: vsData, isLoading: dayLoading } = useQuery({
    queryKey: ['volume-share', vsDate],
    queryFn: () => api.get(`/analytics/volume-share?date=${vsDate}`).then(r => r.data).catch(() => null),
    enabled: vsView === 'day',
  });

  const rangeKey = vsView === 'week' ? vsWeekStart : vsMonth;
  const { data: rangeData = [], isLoading: rangeLoading } = useQuery({
    queryKey: ['volume-share-range', vsView, rangeKey],
    queryFn: () => {
      const start = vsView === 'week' ? vsWeekStart : monthStart;
      const end   = vsView === 'week' ? weekEnd     : monthEnd;
      return api.get('/analytics/volume-share', { params: { start, end } }).then(r => r.data);
    },
    enabled: vsView === 'week' || vsView === 'month',
  });

  // Trend data — last 30 days for line chart
  const trendStart = format(subDays(new Date(), 30), 'yyyy-MM-dd');
  const trendEnd = format(new Date(), 'yyyy-MM-dd');
  const { data: trendRaw = [] } = useQuery({
    queryKey: ['volume-share-trend', trendStart],
    queryFn: () => api.get('/analytics/volume-share', { params: { start: trendStart, end: trendEnd } }).then(r => r.data),
    enabled: chartType === 'line',
    staleTime: 5 * 60 * 1000,
  });

  // Build trend line data
  const { trendLineData, trendDsps, trendInsight } = useMemo(() => {
    if (!trendRaw.length) return { trendLineData: [], trendDsps: [], trendInsight: '' };
    const allDsps = new Set();
    for (const rec of trendRaw) {
      const vol = typeof rec.volume === 'string' ? JSON.parse(rec.volume) : (rec.volume || {});
      for (const dsp of Object.keys(vol)) allDsps.add(dsp);
    }
    const dsps = [...allDsps].sort((a, b) => a === 'LSMD' ? -1 : b === 'LSMD' ? 1 : a.localeCompare(b));
    const lineData = trendRaw.map(rec => {
      const vol = typeof rec.volume === 'string' ? JSON.parse(rec.volume) : (rec.volume || {});
      const point = { date: format(parseISO(String(rec.plan_date).slice(0, 10)), 'M/d') };
      for (const dsp of dsps) point[dsp] = vol[dsp] || 0;
      return point;
    });
    // Insight — compare LSMD first half vs second half
    let insight = '';
    if (lineData.length >= 4) {
      const mid = Math.floor(lineData.length / 2);
      const first = lineData.slice(0, mid).reduce((s, p) => s + (p.LSMD || 0), 0) / mid;
      const second = lineData.slice(mid).reduce((s, p) => s + (p.LSMD || 0), 0) / (lineData.length - mid);
      const change = first > 0 ? ((second - first) / first * 100).toFixed(1) : 0;
      insight = `LSMD averaged ${second.toFixed(0)} routes over the last ${lineData.length - mid} days (${change > 0 ? '+' : ''}${change}% vs prior period).`;
    }
    return { trendLineData: lineData, trendDsps: dsps, trendInsight: insight };
  }, [trendRaw]);

  // Trend arrows for table — compare current period vs previous
  const trendArrows = useMemo(() => {
    if (trendRaw.length < 4) return {};
    const mid = Math.floor(trendRaw.length / 2);
    const arrows = {};
    const allDsps = new Set();
    const firstHalf = {}, secondHalf = {};
    for (let i = 0; i < trendRaw.length; i++) {
      const vol = typeof trendRaw[i].volume === 'string' ? JSON.parse(trendRaw[i].volume) : (trendRaw[i].volume || {});
      for (const [dsp, count] of Object.entries(vol)) {
        allDsps.add(dsp);
        const target = i < mid ? firstHalf : secondHalf;
        target[dsp] = (target[dsp] || 0) + Number(count);
      }
    }
    for (const dsp of allDsps) {
      const prev = (firstHalf[dsp] || 0) / mid;
      const curr = (secondHalf[dsp] || 0) / (trendRaw.length - mid);
      const changePct = prev > 0 ? ((curr - prev) / prev * 100) : 0;
      arrows[dsp] = { pct: changePct.toFixed(1), dir: changePct > 5 ? 'up' : changePct < -5 ? 'down' : 'flat' };
    }
    return arrows;
  }, [trendRaw]);

  // Day view navigation
  const dateStrs = dateList.map(d => String(d.plan_date).slice(0, 10)).sort();
  const curIdx   = dateStrs.indexOf(vsDate);
  const prevDate = curIdx > 0 ? dateStrs[curIdx - 1] : null;
  const nextDate = curIdx < dateStrs.length - 1 ? dateStrs[curIdx + 1] : null;

  // Day view sorted DSPs
  const daySortedDsps = useMemo(() => {
    if (!vsData?.volume) return [];
    const vol = typeof vsData.volume === 'string' ? JSON.parse(vsData.volume) : vsData.volume;
    const total = vsData.total_routes || Object.values(vol).reduce((a, b) => a + b, 0);
    return Object.entries(vol)
      .map(([dsp, count]) => ({ dsp, count: Number(count), pct: parseFloat(pct(Number(count), total)) }))
      .sort((a, b) => b.count - a.count);
  }, [vsData]);
  const dayTotal = vsData?.total_routes || daySortedDsps.reduce((s, r) => s + r.count, 0);

  // Week/month aggregation
  const { aggregatedDsps, aggTotal, daysWithData, totalDays } = useMemo(() => {
    if (!rangeData.length) return { aggregatedDsps: [], aggTotal: 0, daysWithData: 0, totalDays: vsView === 'week' ? 7 : daysInMo };
    const dspTotals = {};
    let daysWithData = 0;
    for (const record of rangeData) {
      if (!record.volume) continue;
      const vol = typeof record.volume === 'string' ? JSON.parse(record.volume) : record.volume;
      daysWithData++;
      for (const [dsp, count] of Object.entries(vol)) {
        dspTotals[dsp] = (dspTotals[dsp] || 0) + Number(count);
      }
    }
    const total = Object.values(dspTotals).reduce((s, v) => s + v, 0);
    const dsps = Object.entries(dspTotals)
      .map(([dsp, count]) => ({ dsp, count, pct: parseFloat(pct(count, total)) }))
      .sort((a, b) => b.count - a.count);
    return { aggregatedDsps: dsps, aggTotal: total, daysWithData, totalDays: vsView === 'week' ? 7 : daysInMo };
  }, [rangeData, vsView, daysInMo]);

  // Unified active data
  const isLoading   = vsView === 'day' ? dayLoading    : rangeLoading;
  const activeDsps  = vsView === 'day' ? daySortedDsps : aggregatedDsps;
  const activeTotal = vsView === 'day' ? dayTotal       : aggTotal;
  const hasData     = vsView === 'day' ? !!vsData       : aggregatedDsps.length > 0;

  // Period label
  const periodLabel = useMemo(() => {
    if (vsView === 'day')   return format(parseISO(vsDate), 'EEE, MMM d yyyy');
    if (vsView === 'week')  return `${format(parseISO(vsWeekStart), 'MMM d')} – ${format(parseISO(weekEnd), 'MMM d, yyyy')}`;
    return format(parseISO(vsMonth + '-01'), 'MMMM yyyy');
  }, [vsView, vsDate, vsWeekStart, weekEnd, vsMonth]);

  // Chart data
  const chartData = activeDsps.map((r, i) => ({
    name: r.dsp, value: r.count,
    fill: r.dsp === 'LSMD' ? LSMD_COLOR : DSP_COLORS[i % DSP_COLORS.length],
  }));

  // Navigation
  const nextDisabled = useMemo(() => {
    if (vsView === 'day')   return !nextDate;
    if (vsView === 'week')  return vsWeekStart >= format(startOfWeek(new Date(), { weekStartsOn: 0 }), 'yyyy-MM-dd');
    return vsMonth >= format(new Date(), 'yyyy-MM');
  }, [vsView, nextDate, vsWeekStart, vsMonth]);

  const handlePrev = () => {
    if (vsView === 'day')   { prevDate && setVsDate(prevDate); }
    else if (vsView === 'week')  { setVsWeekStart(format(subWeeks(parseISO(vsWeekStart), 1), 'yyyy-MM-dd')); }
    else                         { setVsMonth(format(subMonths(parseISO(vsMonth + '-01'), 1), 'yyyy-MM')); }
  };
  const handleNext = () => {
    if (nextDisabled) return;
    if (vsView === 'day')   { nextDate && setVsDate(nextDate); }
    else if (vsView === 'week')  { setVsWeekStart(format(addWeeks(parseISO(vsWeekStart), 1), 'yyyy-MM-dd')); }
    else                         { setVsMonth(format(addMonths(parseISO(vsMonth + '-01'), 1), 'yyyy-MM')); }
  };

  const handleExport = () => {
    if (!activeDsps.length) return;
    const rows = [
      ...activeDsps.map(r => ({ DSP: r.dsp, Routes: r.count, Percentage: `${r.pct}%` })),
      { DSP: 'TOTAL', Routes: activeTotal, Percentage: '100%' },
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 10 }, { wch: 10 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    const sheetName = `VS ${vsView === 'day' ? vsDate : vsView === 'week' ? vsWeekStart : vsMonth}`;
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    XLSX.writeFile(wb, `VolumeShare_${vsView}_${vsView === 'day' ? vsDate : vsView === 'week' ? vsWeekStart : vsMonth}.xlsx`);
    toast.success('Exported');
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Day / Week / Month toggle */}
        <div className="flex border border-card-border rounded-lg overflow-hidden">
          {[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([v, label]) => (
            <button key={v} onClick={() => setVsView(v)}
              className={`px-3 py-1.5 text-xs font-semibold transition-all ${vsView === v ? 'bg-primary text-white' : 'bg-white text-content-muted hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Navigation */}
        <button onClick={handlePrev} disabled={vsView === 'day' && !prevDate}
          className="p-1.5 rounded-lg border border-card-border bg-white hover:bg-slate-50 disabled:opacity-30">
          <ChevronLeft size={16} />
        </button>

        {vsView === 'day' ? (
          <select value={vsDate} onChange={e => setVsDate(e.target.value)}
            className="border border-card-border rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:border-primary bg-white">
            {dateStrs.length === 0 && <option value={vsDate}>{vsDate}</option>}
            {dateStrs.map(d => <option key={d} value={d}>{format(parseISO(d), 'EEE, MMM d yyyy')}</option>)}
          </select>
        ) : (
          <span className="px-4 py-2 text-sm font-semibold text-content bg-white border border-card-border rounded-xl min-w-[200px] text-center">
            {periodLabel}
          </span>
        )}

        <button onClick={handleNext} disabled={nextDisabled}
          className="p-1.5 rounded-lg border border-card-border bg-white hover:bg-slate-50 disabled:opacity-30">
          <ChevronRight size={16} />
        </button>

        {/* Bar / Pie toggle */}
        <div className="flex border border-card-border rounded-lg overflow-hidden ml-2">
          {['bar', 'pie', 'line'].map(t => (
            <button key={t} onClick={() => setChartType(t)}
              className={`px-3 py-1.5 text-xs font-semibold capitalize transition-all ${chartType === t ? 'bg-primary text-white' : 'bg-white text-content-muted hover:bg-slate-50'}`}>
              {t}
            </button>
          ))}
        </div>
        <ExportBtn onClick={handleExport} disabled={!activeDsps.length} />
      </div>

      {isLoading && <p className="text-center text-content-muted py-12">Loading…</p>}
      {!isLoading && !hasData && (
        <div className="bg-white rounded-2xl border border-card-border py-14 text-center">
          <BarChart2 size={40} className="text-slate-200 mx-auto mb-3" />
          <p className="text-content font-semibold">No volume share data for this period</p>
          <p className="text-content-muted text-sm mt-1">Upload a DMF5 Loadout file in the Ops Planner to generate data</p>
        </div>
      )}
      {!isLoading && hasData && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <Card title={`Volume Share — ${periodLabel}`} icon={BarChart2} className="xl:col-span-2">
            <div className="mb-3 flex items-center justify-between text-xs text-content-muted">
              <span>Total routes: <strong className="text-content">{activeTotal}</strong></span>
              {vsView !== 'day'
                ? <span className="text-[10px] italic">Based on {daysWithData} of {totalDays} days</span>
                : <span className="text-[10px] italic">LSMD highlighted</span>
              }
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-semibold text-content-muted uppercase">
                  <th className="pb-2 text-left">DSP</th>
                  <th className="pb-2 text-right">Routes</th>
                  <th className="pb-2 text-right">Share</th>
                  <th className="pb-2 text-right">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {activeDsps.map((r, i) => (
                  <tr key={r.dsp} className={r.dsp === 'LSMD' ? 'bg-blue-50' : i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                    <td className={`py-2 pr-2 font-bold ${r.dsp === 'LSMD' ? 'text-blue-700' : 'text-content'}`}>{r.dsp}</td>
                    <td className="py-2 text-right font-semibold">{r.count}</td>
                    <td className="py-2 text-right">
                      <span className={`font-bold ${r.dsp === 'LSMD' ? 'text-blue-600' : 'text-content-muted'}`}>{r.pct}%</span>
                    </td>
                    <td className="py-2 text-right text-[10px] pl-1 whitespace-nowrap">
                      {trendArrows[r.dsp] && (() => {
                        const t = trendArrows[r.dsp];
                        const color = t.dir === 'up' ? 'text-green-600' : t.dir === 'down' ? 'text-red-500' : 'text-slate-400';
                        const arrow = t.dir === 'up' ? '↑' : t.dir === 'down' ? '↓' : '→';
                        return <span className={`font-semibold ${color}`}>{arrow} {t.pct > 0 ? '+' : ''}{t.pct}%</span>;
                      })()}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 font-bold">
                  <td className="py-2">TOTAL</td>
                  <td className="py-2 text-right">{activeTotal}</td>
                  <td className="py-2 text-right">100%</td>
                </tr>
              </tbody>
            </table>
          </Card>
          <Card className="xl:col-span-3" title={`Chart — ${periodLabel}`}>
            {chartType === 'bar' ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 24 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, n, p) => [`${v} routes (${pct(v, activeTotal)}%)`, p.payload.name]} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>{chartData.map((c, i) => <Cell key={i} fill={c.fill} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : chartType === 'pie' ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100}>
                    {chartData.map((c, i) => <Cell key={i} fill={c.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [`${v} routes (${pct(v, activeTotal)}%)`, n]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trendLineData} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={Math.max(0, Math.floor(trendLineData.length / 8))} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    {trendDsps.map((dsp, i) => (
                      <Line key={dsp} type="monotone" dataKey={dsp} dot={false}
                        stroke={dsp === 'LSMD' ? LSMD_COLOR : DSP_COLORS[i % DSP_COLORS.length]}
                        strokeWidth={dsp === 'LSMD' ? 3 : 1.5}
                        strokeOpacity={dsp === 'LSMD' ? 1 : 0.5} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
                {trendInsight && <p className="text-xs text-content-muted mt-2 italic">{trendInsight}</p>}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

// ══ SUB-SECTION 2: ROUTE INTELLIGENCE ══════════════════════════════════════
function RouteIntelligenceTab() {
  const qc = useQueryClient();
  const [filterScore, setFilterScore] = useState('');
  const [sortCol, setSortCol]         = useState('difficulty_score');
  const [sortDir, setSortDir]         = useState('desc');
  const [editRoute, setEditRoute]     = useState(null);
  const [editNotes, setEditNotes]     = useState('');

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['route-profiles'],
    queryFn: () => api.get('/analytics/route-profiles').then(r => r.data),
  });

  const saveNotes = useMutation({
    mutationFn: ({ code, notes }) => api.patch(`/analytics/route-profiles/${code}`, { notes }),
    onSuccess: () => { qc.invalidateQueries(['route-profiles']); setEditRoute(null); toast.success('Notes saved'); },
  });

  const filtered = useMemo(() => {
    let list = [...profiles];
    if (filterScore) list = list.filter(r => String(r.difficulty_score) === filterScore);
    list.sort((a, b) => {
      const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0;
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
    return list;
  }, [profiles, filterScore, sortCol, sortDir]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const handleExport = () => {
    if (!filtered.length) return;
    const ws = XLSX.utils.json_to_sheet(filtered.map(r => ({
      'Route Code': r.route_code, 'Difficulty': r.difficulty_score,
      'Total Rescues': r.total_rescues, 'Times Assigned': r.total_times_assigned,
      'Heavy Flag': r.heavy_flag ? 'Yes' : 'No', 'Notes': r.notes || '',
    })));
    ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 30 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Route Intelligence');
    XLSX.writeFile(wb, 'RouteIntelligence.xlsx'); toast.success('Exported');
  };

  const Th = ({ col, label }) => (
    <th onClick={() => handleSort(col)} className="px-3 py-2 text-left cursor-pointer hover:bg-slate-100 whitespace-nowrap select-none">
      {label} {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : <span className="opacity-25">↕</span>}
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap bg-white border border-card-border rounded-xl px-4 py-2.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-content-muted flex items-center gap-1"><Filter size={11} /> Filter:</span>
        <select value={filterScore} onChange={e => setFilterScore(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none">
          <option value="">All Difficulties</option>
          <option value="1">🟢 1 — Easy</option>
          <option value="2">🟡 2 — Light</option>
          <option value="3">🟠 3 — Medium</option>
          <option value="4">🔴 4 — Hard</option>
          <option value="5">⛔ 5 — Heavy</option>
        </select>
        <span className="text-xs text-content-muted">{filtered.length} routes</span>
        <ExportBtn onClick={handleExport} disabled={!filtered.length} />
      </div>

      <div className="bg-white rounded-2xl border border-card-border shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-semibold text-content-muted uppercase">
            <tr>
              <Th col="route_code" label="Route Code" />
              <Th col="difficulty_score" label="Difficulty" />
              <Th col="total_rescues" label="Rescues" />
              <Th col="total_times_assigned" label="Times Assigned" />
              <Th col="heavy_flag" label="Heavy" />
              <th className="px-3 py-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {isLoading && Array.from({ length: 6 }).map((_, i) => <tr key={i} className="animate-pulse"><td colSpan={6} className="px-3 py-3"><div className="h-3 bg-slate-200 rounded w-full" /></td></tr>)}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-content-muted">
                {profiles.length === 0 ? 'No route data yet — log rescues or assign routes in the Ops Planner' : 'No routes match filter'}
              </td></tr>
            )}
            {!isLoading && filtered.map((r, i) => {
              const dot = DIFF_DOT[r.difficulty_score] || DIFF_DOT[1];
              return (
                <tr key={r.route_code} className={`${r.heavy_flag ? 'bg-red-50/60' : i % 2 === 1 ? 'bg-slate-50/40' : ''}`}>
                  <td className="px-3 py-2 font-bold font-mono text-content">{r.route_code}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${dot.cls}`}>
                      {dot.dot} {r.difficulty_score}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center font-semibold">{r.total_rescues}</td>
                  <td className="px-3 py-2 text-center text-content-muted">{r.total_times_assigned}</td>
                  <td className="px-3 py-2 text-center">{r.heavy_flag ? <span className="text-red-600 font-bold">🔴</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2">
                    {editRoute === r.route_code ? (
                      <div className="flex gap-1">
                        <input autoFocus value={editNotes} onChange={e => setEditNotes(e.target.value)}
                          className="border border-primary rounded px-2 py-0.5 text-xs flex-1 focus:outline-none"
                          onKeyDown={e => { if (e.key === 'Enter') saveNotes.mutate({ code: r.route_code, notes: editNotes }); if (e.key === 'Escape') setEditRoute(null); }} />
                        <button onClick={() => saveNotes.mutate({ code: r.route_code, notes: editNotes })} className="text-xs text-primary font-semibold px-1">✓</button>
                        <button onClick={() => setEditRoute(null)} className="text-xs text-slate-400 px-1">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditRoute(r.route_code); setEditNotes(r.notes || ''); }}
                        className="text-xs text-content-muted hover:text-primary transition-colors truncate max-w-[200px] text-left">
                        {r.notes || <span className="italic opacity-40">Add note…</span>}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Difficulty legend */}
      <div className="flex flex-wrap gap-3 text-[10px] text-content-muted px-1">
        {Object.entries(DIFF_DOT).map(([score, { dot, cls }]) => (
          <span key={score} className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${cls} font-semibold`}>
            {dot} {score === '1' ? 'Easy' : score === '2' ? 'Light' : score === '3' ? 'Medium' : score === '4' ? 'Hard' : 'Heavy'}
          </span>
        ))}
        <span className="ml-2 italic opacity-60">Click "Notes" cell to add/edit route notes</span>
      </div>
    </div>
  );
}

// ══ SUB-SECTION 3: DRIVER WORKLOAD (EFT heatmap grid) ═══════════════════════
const CELL_COLORS = {
  green:  { bg: '#dcfce7', border: '#22c55e', text: '#15803d' },
  orange: { bg: '#ffedd5', border: '#f97316', text: '#c2410c' },
  yellow: { bg: '#fef9c3', border: '#eab308', text: '#a16207' },
  red:    { bg: '#fee2e2', border: '#ef4444', text: '#b91c1c' },
  none:   { bg: '#f1f5f9', border: '#e2e8f0', text: '#94a3b8' },
};
const LEGEND_ITEMS = [
  { color: '#22c55e', bg: '#f0fdf4', label: 'Easy', sub: 'Before 3 PM' },
  { color: '#f97316', bg: '#fff7ed', label: 'Slightly Heavy', sub: '3–5 PM' },
  { color: '#eab308', bg: '#fefce8', label: 'Moderate', sub: '5–7 PM' },
  { color: '#ef4444', bg: '#fef2f2', label: 'Heavy', sub: 'After 7 PM' },
  { color: '#e2e8f0', bg: '#f8fafc', label: 'Off / No Route', sub: '' },
];
function fmt12h(t) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${((h % 12) || 12)}:${String(m).padStart(2, '0')} ${ampm}`;
}

function DriverPerformanceTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['driver-workload-grid'],
    queryFn: () => api.get('/analytics/driver-workload').then(r => r.data),
  });

  const dateRange = data?.dateRange || [];
  const drivers   = data?.drivers   || [];
  const todayStr  = new Date().toISOString().slice(0, 10);

  const handleExport = () => {
    if (!drivers.length) return;
    const rows = drivers.map(d => {
      const row = { Driver: d.name };
      for (const dt of dateRange) {
        const day = d.days[dt];
        row[dt] = day ? `${day.route} (${fmt12h(day.eft)})` : '';
      }
      row['Red'] = d.summary.red; row['Yellow'] = d.summary.yellow;
      row['Orange'] = d.summary.orange; row['Green'] = d.summary.green;
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Driver Workload');
    XLSX.writeFile(wb, `DriverWorkload_${dateRange[0]}_to_${dateRange[dateRange.length - 1]}.xlsx`);
    toast.success('Exported');
  };

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', padding: '12px 0', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>Route Difficulty (EFT):</span>
        {LEGEND_ITEMS.map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '14px', height: '14px', background: item.bg, border: `2px solid ${item.color}`, borderRadius: '3px' }} />
            <span style={{ fontSize: '12px', color: '#374151' }}>{item.label}</span>
            {item.sub && <span style={{ fontSize: '11px', color: '#9ca3af' }}>{item.sub}</span>}
          </div>
        ))}
      </div>

      <Card title="Driver Workload — 14 Day EFT Grid" icon={Users} action={<ExportBtn onClick={handleExport} disabled={!drivers.length} />}>
        {isLoading && <p className="text-center text-content-muted py-6">Loading…</p>}
        {!isLoading && !drivers.length && <p className="text-center text-content-muted py-6">No assignment data in this range</p>}
        {!isLoading && drivers.length > 0 && (
          <div style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '900px' }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', left: 0, background: 'white', zIndex: 2, padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 600, borderBottom: '2px solid #e2e8f0', minWidth: '180px' }}>
                    Driver
                  </th>
                  {dateRange.map(date => {
                    const d = new Date(date + 'T12:00:00');
                    const isToday = date === todayStr;
                    return (
                      <th key={date} style={{
                        padding: '6px 2px', textAlign: 'center', fontSize: '11px', fontWeight: 600,
                        borderBottom: '2px solid #e2e8f0', minWidth: '52px',
                        background: isToday ? '#eff6ff' : 'white', color: isToday ? '#2563eb' : '#374151',
                      }}>
                        <div>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]}</div>
                        <div style={{ fontWeight: 400, color: isToday ? '#2563eb' : '#9ca3af' }}>
                          {d.getMonth() + 1}/{d.getDate()}
                        </div>
                      </th>
                    );
                  })}
                  <th style={{ padding: '6px 8px', fontSize: '11px', fontWeight: 600, borderBottom: '2px solid #e2e8f0', minWidth: '100px' }}>
                    Summary
                  </th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((drv, i) => (
                  <tr key={drv.staff_id}>
                    <td style={{ position: 'sticky', left: 0, background: i % 2 ? '#f8fafc' : 'white', zIndex: 1, padding: '6px 12px', fontSize: '13px', fontWeight: 500, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
                      {drv.name}
                    </td>
                    {dateRange.map(date => {
                      const dayData = drv.days[date];
                      const colors = dayData ? CELL_COLORS[dayData.color] || CELL_COLORS.none : CELL_COLORS.none;
                      const isToday = date === todayStr;
                      return (
                        <td
                          key={date}
                          title={dayData ? `${dayData.route} — EFT: ${fmt12h(dayData.eft)} (${dayData.duration ? Math.round(dayData.duration / 60 * 10) / 10 : 0}h)` : 'No route'}
                          style={{
                            background: isToday && !dayData ? '#eff6ff' : colors.bg,
                            borderBottom: `3px solid ${colors.border}`,
                            color: colors.text, fontSize: '11px', fontWeight: 600,
                            textAlign: 'center', padding: '4px 2px', minWidth: '52px', cursor: 'default',
                          }}
                        >
                          {dayData ? fmt12h(dayData.eft) : '—'}
                        </td>
                      );
                    })}
                    <td style={{ padding: '4px 8px', fontSize: '11px', whiteSpace: 'nowrap', borderBottom: '1px solid #f1f5f9' }}>
                      {drv.summary.red > 0 && <span style={{ color: '#ef4444', marginRight: '4px' }}>🔴{drv.summary.red}</span>}
                      {drv.summary.yellow > 0 && <span style={{ color: '#ca8a04', marginRight: '4px' }}>🟡{drv.summary.yellow}</span>}
                      {drv.summary.orange > 0 && <span style={{ color: '#ea580c', marginRight: '4px' }}>🟠{drv.summary.orange}</span>}
                      {drv.summary.green > 0 && <span style={{ color: '#16a34a' }}>🟢{drv.summary.green}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ══ SUB-SECTION 4: RESCUE & WORKLOAD ════════════════════════════════════════
function RescueWorkloadTab() {
  const rangeState = useRange();
  const { range, setRange, cStart, setCStart, cEnd, setCEnd, start, end } = rangeState;
  const enabled = !!(start && end);

  // Filters for rescue log
  const [logDriver, setLogDriver]   = useState('');
  const [logRoute, setLogRoute]     = useState('');
  const [logReason, setLogReason]   = useState('');

  const { data: driverStats = [], isLoading: dsLoading } = useQuery({
    queryKey: ['driver-stats', start, end],
    queryFn: () => api.get(`/analytics/driver-stats?start=${start}&end=${end}`).then(r => r.data),
    enabled,
  });
  const { data: routeStats = [], isLoading: rsLoading } = useQuery({
    queryKey: ['route-stats', start, end],
    queryFn: () => api.get(`/analytics/route-stats?start=${start}&end=${end}`).then(r => r.data),
    enabled,
  });
  const { data: rescueLog = [], isLoading: logLoading } = useQuery({
    queryKey: ['rescue-log', start, end, logDriver, logRoute, logReason],
    queryFn: () => {
      const params = new URLSearchParams();
      if (start) params.set('start', start);
      if (end)   params.set('end', end);
      if (logDriver) params.set('driver', logDriver);
      if (logRoute)  params.set('route', logRoute);
      if (logReason) params.set('reason', logReason);
      return api.get(`/analytics/rescue-log?${params}`).then(r => r.data);
    },
    enabled,
  });

  const mostRescued  = driverStats.filter(d => d.rescues_received > 0).sort((a,b) => b.rescues_received - a.rescues_received);
  const topRescuers  = driverStats.filter(d => d.rescues_given > 0).sort((a,b) => b.rescues_given - a.rescues_given);
  const totalRescues = rescueLog.length;

  // Flag logic: same driver different routes = driver issue; same route different drivers = route issue
  const getDriverFlag = (d) => {
    const myRescues = rescueLog.filter(r => r.rescued_name === d.name);
    const routes = new Set(myRescues.map(r => r.rescued_route).filter(Boolean));
    if (myRescues.length >= 3 && routes.size > 1) return { flag: 'Driver', cls: 'bg-red-100 text-red-700' };
    if (myRescues.length >= 3) return { flag: 'Route', cls: 'bg-orange-100 text-orange-700' };
    return null;
  };

  const handleExportLog = () => {
    if (!rescueLog.length) return;
    const ws = XLSX.utils.json_to_sheet(rescueLog.map(r => ({
      'Date': String(r.plan_date).slice(0,10), 'Rescued Driver': r.rescued_name, 'Route': r.rescued_route || '',
      'Rescuing Driver': r.rescuer_name, 'Reason': r.reason || '', 'Packages': r.packages_rescued || 0,
      'Time': r.rescue_time || '', 'Notes': r.notes || '',
    })));
    ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 30 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Rescue Log');
    XLSX.writeFile(wb, `RescueLog_${start}_${end}.xlsx`); toast.success('Exported');
  };

  return (
    <div className="space-y-4">
      <RangeBar range={range} setRange={setRange} cStart={cStart} setCStart={setCStart} cEnd={cEnd} setCEnd={setCEnd} start={start} end={end} />

      {/* Leaderboard: two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Most Rescued */}
        <Card title="🚨 Most Rescued — Watch List" icon={AlertTriangle}>
          {dsLoading && <p className="text-center text-content-muted py-4">Loading…</p>}
          {!dsLoading && mostRescued.length === 0 && <p className="text-center text-content-muted py-4 text-sm">No rescue data in this range</p>}
          {!dsLoading && mostRescued.length > 0 && (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-100 text-[10px] font-semibold text-content-muted uppercase">
                <th className="pb-2 text-left">Driver</th><th className="pb-2 text-center">Rescues</th><th className="pb-2 text-center">Pkgs</th><th className="pb-2 text-center">Flag</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {mostRescued.map((d, i) => {
                  const flag = getDriverFlag(d);
                  return (
                    <tr key={d.name} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                      <td className="py-2 font-semibold">{d.name}</td>
                      <td className="py-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded font-bold ${d.rescues_received >= 3 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>{d.rescues_received}</span>
                      </td>
                      <td className="py-2 text-center text-content-muted">{d.packages_rescued || 0}</td>
                      <td className="py-2 text-center">
                        {flag ? <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${flag.cls}`}>{flag.flag}</span> : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        {/* Top Rescuers */}
        <Card title="💪 Top Rescuers — Recognition" icon={Shield}>
          {dsLoading && <p className="text-center text-content-muted py-4">Loading…</p>}
          {!dsLoading && topRescuers.length === 0 && <p className="text-center text-content-muted py-4 text-sm">No rescue data in this range</p>}
          {!dsLoading && topRescuers.length > 0 && (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-100 text-[10px] font-semibold text-content-muted uppercase">
                <th className="pb-2 text-left">Driver</th><th className="pb-2 text-center">Rescues Given</th><th className="pb-2 text-center">Pkgs Assisted</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {topRescuers.map((d, i) => (
                  <tr key={d.name} className={`${i === 0 ? 'bg-emerald-50' : i % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                    <td className="py-2 font-semibold text-content">{i === 0 && <span className="mr-1">⭐</span>}{d.name}</td>
                    <td className="py-2 text-center"><span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">{d.rescues_given}</span></td>
                    <td className="py-2 text-center text-content-muted">{d.packages_assisted || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Route rescue chart */}
      {!rsLoading && routeStats.length > 0 && (
        <Card title="Rescue Frequency by Route" icon={TrendingUp}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={routeStats.slice(0, 15)} margin={{ top: 4, right: 8, left: -20, bottom: 24 }}>
              <XAxis dataKey="route_code" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="rescue_count" name="Rescues" radius={[4,4,0,0]}>
                {routeStats.slice(0,15).map((r, i) => <Cell key={i} fill={r.rescue_count >= 2 ? '#EF4444' : '#F97316'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Rescue Log Table */}
      <Card title="Full Rescue Log" icon={AlertTriangle}
        action={<ExportBtn onClick={handleExportLog} disabled={!rescueLog.length} />}>
        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4 pb-4 border-b border-slate-100">
          <input value={logDriver} onChange={e => setLogDriver(e.target.value)} placeholder="Filter by driver…" className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary w-36" />
          <input value={logRoute} onChange={e => setLogRoute(e.target.value)} placeholder="Route…" className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary w-24" />
          <select value={logReason} onChange={e => setLogReason(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none">
            <option value="">All Reasons</option>
            {RESCUE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {(logDriver || logRoute || logReason) && (
            <button onClick={() => { setLogDriver(''); setLogRoute(''); setLogReason(''); }} className="flex items-center gap-1 text-xs text-content-muted hover:text-red-600 px-2 py-1 rounded-lg border border-slate-200"><X size={11} /> Clear</button>
          )}
          <span className="text-xs text-content-muted self-center">{rescueLog.length} records</span>
        </div>
        {logLoading && <p className="text-center text-content-muted py-4">Loading…</p>}
        {!logLoading && rescueLog.length === 0 && <p className="text-center text-content-muted py-6 text-sm">No rescue records in this range</p>}
        {!logLoading && rescueLog.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-100 text-[10px] font-semibold text-content-muted uppercase">
                <th className="pb-2 text-left">Date</th><th className="pb-2 text-left">Rescued</th><th className="pb-2 text-left">Route</th>
                <th className="pb-2 text-left">Rescuer</th><th className="pb-2 text-left">Reason</th>
                <th className="pb-2 text-center">Pkgs</th><th className="pb-2 text-center">Time</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {rescueLog.map((r, i) => (
                  <tr key={r.id} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                    <td className="py-2 font-mono text-content-muted">{String(r.plan_date).slice(0,10)}</td>
                    <td className="py-2 font-semibold text-content">{r.rescued_name}</td>
                    <td className="py-2 font-mono font-bold">{r.rescued_route || '—'}</td>
                    <td className="py-2 text-emerald-700 font-semibold">{r.rescuer_name}</td>
                    <td className="py-2"><span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px]">{r.reason || '—'}</span></td>
                    <td className="py-2 text-center text-content-muted">{r.packages_rescued || 0}</td>
                    <td className="py-2 text-center font-mono text-content-muted">{r.rescue_time || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ══ MAIN ANALYTICS PAGE ═════════════════════════════════════════════════════
const TABS = [
  { id: 'volume',        label: 'Volume Share',        icon: BarChart2      },
  { id: 'routes',        label: 'Route Intelligence',  icon: TrendingUp     },
  { id: 'performance',   label: 'Driver Workload',     icon: Users          },
  { id: 'rescue',        label: 'Rescue',              icon: AlertTriangle  },
  { id: 'daily-summary', label: 'Daily Routes Summary', icon: ClipboardList },
];

// ── Daily Routes Summary row config ──────────────────────────────────────────
const SUMMARY_ROWS = [
  { key: 'okami_l',              label: 'C — Route Commitment',   field: 'okami_count',    manual: true,  color: 'bg-blue-50' },
  { key: 'scheduled_d',         label: 'D — Scheduled Routes',   manual: false, color: '' },
  { key: 'cortex_no_flex_e',    label: 'E — Cortex (no Flex)',   manual: false, color: '' },
  { key: 'flex_f',              label: 'F — Flex / Recycle',     manual: false, color: '' },
  { key: 'hza_g',               label: 'G — HZA Step Vans',     manual: false, color: '' },
  { key: 'helpers_h',           label: 'H — Helper Routes',     manual: false, color: '' },
  { key: 'cx_routes_i',         label: 'I — CX Routes',         manual: false, color: 'bg-slate-50', formula: true },
  { key: 'ero_count',           label: 'J — ERO',               field: 'ero_count',      manual: true,  color: 'bg-blue-50' },
  { key: 'routes_dispatched_k', label: 'K — Routes Dispatched', manual: false, color: 'bg-slate-50', formula: true },
  { key: 'amazon_canceled_m',   label: 'L — Amazon Canceled',   field: 'amazon_canceled', manual: true,  color: 'bg-blue-50' },
  { key: 'training_day',        label: 'M — Training Day',      field: 'training_day',   manual: true,  color: 'bg-blue-50' },
  { key: 'total_dispatched_n',  label: 'N — Total Dispatched',  manual: false, color: 'bg-slate-50', formula: true },
  { key: 'scheduled_vs_total_o', label: 'O — Sched vs Total',   manual: false, color: 'bg-slate-50', formula: true },
  { key: 'routes_owed_p',       label: 'P — Routes Owed DSP',   manual: false, color: 'bg-amber-50', formula: true },
  { key: 'wst_completed_q',     label: 'Q — WST Completed',     field: 'wst_completed',  manual: true,  color: 'bg-blue-50' },
  { key: 'wst_cancelled_r',     label: 'R — WST Cancelled',     field: 'wst_cancelled',  manual: true,  color: 'bg-blue-50' },
  { key: 'routes_to_dispute_s', label: 'S — Routes to Dispute', manual: false, color: 'bg-red-50', formula: true },
  { key: 'total_packages_t',    label: 'T — Total Packages',    field: 'total_packages_override', manual: true, color: 'bg-blue-50' },
  { key: 'spr_u',               label: 'U — SPR',               manual: false, color: 'bg-slate-50', formula: true },
  { key: 'extras_v',            label: 'V — Extra Drivers',     manual: false, color: '' },
];

function getSundayStr() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  return sunday.toISOString().split('T')[0];
}

export default function Analytics() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return t && ['volume', 'routes', 'performance', 'rescue', 'daily-summary'].includes(t) ? t : 'volume';
  });

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && t !== tab && ['volume', 'routes', 'performance', 'rescue', 'daily-summary'].includes(t)) setTab(t);
  }, [searchParams]);

  // Daily Routes Summary state
  const [summaryWeekStart, setSummaryWeekStart] = useState(getSundayStr);
  const [summaryStation] = useState('DMF5');

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['daily-routes-summary', summaryWeekStart, summaryStation],
    queryFn: () => api.get(`/analytics/daily-routes-summary?week_start=${summaryWeekStart}&station=${summaryStation}`).then(r => r.data),
    enabled: tab === 'daily-summary',
  });

  const saveSummaryMutation = useMutation({
    mutationFn: ({ date, ...data }) => api.put(`/analytics/daily-routes-summary/${date}`, { station: summaryStation, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-routes-summary'] });
      toast.success('Saved');
    },
    onError: () => toast.error('Failed to save'),
  });

  const prevSummaryWeek = () => { const d = new Date(summaryWeekStart + 'T12:00:00Z'); d.setDate(d.getDate() - 7); setSummaryWeekStart(d.toISOString().split('T')[0]); };
  const nextSummaryWeek = () => { const d = new Date(summaryWeekStart + 'T12:00:00Z'); d.setDate(d.getDate() + 7); setSummaryWeekStart(d.toISOString().split('T')[0]); };
  const goToCurrentWeek = () => setSummaryWeekStart(getSundayStr());

  const fmtWeekDate = (offset) => {
    const d = new Date(summaryWeekStart + 'T12:00:00Z');
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(offset === 6 ? { year: 'numeric' } : {}) });
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-content">Analytics</h1>
        <p className="text-sm text-content-muted mt-0.5">Volume share, route intelligence, driver workload & rescue metrics</p>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap bg-white border border-card-border rounded-xl p-1 shadow-sm gap-1 w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t.id ? 'bg-primary text-white shadow-sm' : 'text-content-muted hover:text-content'}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'volume'      && <VolumeShareTab />}
      {tab === 'routes'      && <RouteIntelligenceTab />}
      {tab === 'performance' && <DriverPerformanceTab />}
      {tab === 'rescue'      && <RescueWorkloadTab />}

      {tab === 'daily-summary' && (
        <div className="space-y-4">
          {/* Header + Week Navigation */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Daily Routes Summary</h2>
              <p className="text-sm text-slate-500">DMF5 — Auto-populated from Ops Planner. Manual fields are editable.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={prevSummaryWeek} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600">&#8249;</button>
              <span className="text-sm font-semibold text-slate-700 min-w-[180px] text-center">
                {fmtWeekDate(0)} – {fmtWeekDate(6)}
              </span>
              <button onClick={nextSummaryWeek} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600">&#8250;</button>
              <button onClick={goToCurrentWeek} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50">Today</button>
            </div>
          </div>

          {summaryLoading ? (
            <div className="card h-48 animate-pulse bg-slate-100 rounded-xl" />
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto overflow-y-visible">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="px-3 py-2.5 text-left font-semibold sticky left-0 bg-slate-800 z-10 min-w-[180px]">Field</th>
                    {summaryData?.days?.map(d => (
                      <th key={d.date} className="px-2 py-2.5 text-center font-semibold min-w-[80px]">
                        <div>{d.day_of_week}</div>
                        <div className="text-slate-300 text-[10px]">{new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</div>
                      </th>
                    ))}
                    <th className="px-2 py-2.5 text-center font-semibold bg-slate-700 min-w-[80px]">Week Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {SUMMARY_ROWS.map(row => (
                    <tr key={row.key} className={row.color}>
                      <td className={`px-3 py-1.5 font-medium sticky left-0 z-10 ${row.color || 'bg-white'} ${row.formula ? 'text-slate-500 italic' : 'text-slate-800'}`}>
                        {row.label}
                        {row.manual && <span className="ml-1 text-[9px] text-blue-500 font-bold">EDIT</span>}
                      </td>
                      {summaryData?.days?.map(d => (
                        <td key={d.date} className="px-1 py-1 text-center">
                          {row.manual ? (
                            <input
                              type="number"
                              min="0"
                              defaultValue={d[row.key] ?? 0}
                              key={`${d.date}-${row.key}-${d[row.key]}`}
                              onBlur={e => {
                                const val = parseInt(e.target.value) || 0;
                                if (val !== (d[row.key] ?? 0)) {
                                  saveSummaryMutation.mutate({ date: d.date, [row.field]: val });
                                }
                              }}
                              className="w-14 text-center text-xs border border-blue-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-blue-400 focus:outline-none"
                            />
                          ) : (
                            <span className={`font-medium ${
                              row.key === 'routes_to_dispute_s' && (d[row.key] ?? 0) > 0 ? 'text-red-600 font-bold' :
                              row.key === 'routes_owed_p' ? 'text-amber-700' :
                              row.formula ? 'text-slate-500' : 'text-slate-800'
                            }`}>
                              {row.key === 'spr_u'
                                ? (d[row.key] != null ? Number(d[row.key]).toFixed(1) : '—')
                                : row.key === 'total_packages_t'
                                  ? (d[row.key] > 0 ? d[row.key].toLocaleString() : '—')
                                  : (d[row.key] ?? 0)}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-1 text-center font-bold text-slate-700 bg-slate-50">
                        {row.key === 'spr_u' ? (
                          summaryData?.weeklyTotals?.[row.key] != null
                            ? Number(summaryData.weeklyTotals[row.key]).toFixed(1)
                            : '—'
                        ) : row.key === 'total_packages_t' ? (
                          (summaryData?.weeklyTotals?.[row.key] ?? 0).toLocaleString()
                        ) : (
                          summaryData?.weeklyTotals?.[row.key] ?? 0
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center gap-4 text-[10px] text-slate-400">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-100 border border-blue-200 inline-block" /> Manual input</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-100 border border-slate-200 inline-block" /> Auto-calculated formula</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-white border border-slate-200 inline-block" /> Auto from Ops Planner</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
