import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import * as XLSX from 'xlsx';
import {
  ChevronLeft, ChevronRight, Download, X, TrendingUp, TrendingDown, Minus,
  Star, AlertTriangle,
} from 'lucide-react';
import { format, addDays, subDays, parseISO, startOfWeek, getWeek } from 'date-fns';
import api from '../api/client';
import toast from 'react-hot-toast';

// ── Metric config ─────────────────────────────────────────────────────────────
const METRICS = [
  { key: 'dcr',  label: 'DCR',  pct: true,  higherBetter: true,  green: 98,  yellow: 96 },
  { key: 'pod',  label: 'POD',  pct: true,  higherBetter: true,  green: 98,  yellow: 96 },
  { key: 'cc',   label: 'CC',   pct: true,  higherBetter: false, green: 1,   yellow: 2  },
  { key: 'ce',   label: 'CE',   pct: true,  higherBetter: false, green: 0.5, yellow: 1  },
  { key: 'dnr',  label: 'DNR',  pct: true,  higherBetter: false, green: 0.5, yellow: 1  },
  { key: 'ssd',  label: 'SSD',  pct: false, higherBetter: true,  green: 800, yellow: 750 },
];

function metricColor(metric, value) {
  if (value === null || value === '' || value === undefined) return '';
  const v = parseFloat(value);
  if (isNaN(v)) return '';
  const { higherBetter, green, yellow } = metric;
  if (higherBetter) {
    if (v >= green)  return 'bg-emerald-100 text-emerald-800';
    if (v >= yellow) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  } else {
    if (v <= green)  return 'bg-emerald-100 text-emerald-800';
    if (v <= yellow) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  }
}

function scoreColor(score) {
  if (score === null || score === undefined) return 'text-slate-400';
  const v = parseFloat(score);
  if (v >= 85) return 'text-emerald-700 font-bold';
  if (v >= 70) return 'text-yellow-700 font-bold';
  return 'text-red-700 font-bold';
}

function scoreBg(score) {
  if (score === null || score === undefined) return '';
  const v = parseFloat(score);
  if (v >= 85) return 'bg-emerald-100 text-emerald-800';
  if (v >= 70) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

// Weighted score calculation — matches backend expectations
export function calcWeekScore({ dcr, pod, cc, ce, dnr, ssd }) {
  const parts = [];
  const v = (x) => (x !== null && x !== '' && x !== undefined) ? parseFloat(x) : null;

  const vDcr = v(dcr); if (vDcr !== null && !isNaN(vDcr)) parts.push({ w: 0.40, n: Math.min(100, Math.max(0, vDcr)) });
  const vPod = v(pod); if (vPod !== null && !isNaN(vPod)) parts.push({ w: 0.20, n: Math.min(100, Math.max(0, vPod)) });
  const vCc  = v(cc);  if (vCc  !== null && !isNaN(vCc))  parts.push({ w: 0.15, n: Math.max(0, 100 - vCc  * 50)  });
  const vCe  = v(ce);  if (vCe  !== null && !isNaN(vCe))  parts.push({ w: 0.10, n: Math.max(0, 100 - vCe  * 100) });
  const vDnr = v(dnr); if (vDnr !== null && !isNaN(vDnr)) parts.push({ w: 0.10, n: Math.max(0, 100 - vDnr * 100) });
  const vSsd = v(ssd); if (vSsd !== null && !isNaN(vSsd)) parts.push({ w: 0.05, n: Math.min(100, vSsd / 10)      });

  if (!parts.length) return null;
  const totalW = parts.reduce((s, p) => s + p.w, 0);
  return Math.round((parts.reduce((s, p) => s + p.n * p.w, 0) / totalW) * 10) / 10;
}

// ── Week navigation helpers ───────────────────────────────────────────────────
function getWeekStart(date = new Date()) {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}
function weekLabel(weekStart) {
  const d = parseISO(weekStart);
  const wn = getWeek(d, { weekStartsOn: 1 });
  const end = addDays(d, 6);
  return `Week ${wn}  (${format(d, 'MMM d')} – ${format(end, 'MMM d, yyyy')})`;
}

// ── Editable scorecard cell ───────────────────────────────────────────────────
function ScoreCell({ value, onChange, onBlur, colorClass, placeholder }) {
  return (
    <input
      type="number"
      step="0.01"
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      className={`w-[68px] text-center text-xs font-semibold px-1 py-1 rounded-lg border border-transparent focus:outline-none focus:border-primary focus:bg-white transition-all ${colorClass || 'bg-slate-50 text-slate-700'}`}
    />
  );
}

// ── Driver history modal ──────────────────────────────────────────────────────
function HistoryModal({ driver, onClose }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['scorecard-history', driver.staff_id],
    queryFn: () => api.get(`/scorecard/history/${driver.staff_id}?weeks=24`).then(r => r.data),
  });

  const chartData = [...history]
    .reverse()
    .map(h => ({
      week: format(parseISO(String(h.week_start).slice(0, 10)), 'MMM d'),
      score: h.week_score ? parseFloat(h.week_score) : null,
      dcr:   h.dcr  ? parseFloat(h.dcr)  : null,
      pod:   h.pod  ? parseFloat(h.pod)  : null,
    }))
    .filter(d => d.score !== null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-card-border">
          <div>
            <h2 className="font-bold text-lg text-content">{driver.first_name} {driver.last_name}</h2>
            <p className="text-sm text-content-muted">Scorecard history — last 24 weeks</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-6">
          {isLoading && <p className="text-center text-content-muted py-8">Loading history…</p>}

          {!isLoading && chartData.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-content-muted uppercase tracking-wide mb-3">Week Score Over Time</p>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={v => `${v?.toFixed(1)}`} />
                  <ReferenceLine y={85} stroke="#10b981" strokeDasharray="4 2" label={{ value: '85 ✓', position: 'right', fontSize: 10, fill: '#10b981' }} />
                  <ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '70', position: 'right', fontSize: 10, fill: '#f59e0b' }} />
                  <Line type="monotone" dataKey="score" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Week Score" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {!isLoading && history.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] font-semibold text-content-muted uppercase">
                    <th className="pb-2 text-left">Week</th>
                    {METRICS.map(m => <th key={m.key} className="pb-2 text-center">{m.label}</th>)}
                    <th className="pb-2 text-center">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {history.map((h, i) => {
                    const ws = String(h.week_start).slice(0, 10);
                    return (
                      <tr key={ws} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                        <td className="py-2 pr-3 font-medium">{format(parseISO(ws), 'MMM d')}</td>
                        {METRICS.map(m => (
                          <td key={m.key} className="py-2 text-center">
                            {h[m.key] != null ? (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${metricColor(m, h[m.key])}`}>
                                {parseFloat(h[m.key]).toFixed(m.key === 'ssd' ? 0 : 2)}{m.pct && m.key !== 'ssd' ? '%' : ''}
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                        ))}
                        <td className="py-2 text-center">
                          {h.week_score != null ? (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${scoreBg(h.week_score)}`}>
                              {parseFloat(h.week_score).toFixed(1)}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && history.length === 0 && (
            <p className="text-center text-content-muted py-8">No scorecard history yet for this driver.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Scorecard Page ───────────────────────────────────────────────────────
export default function Scorecard() {
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(getWeekStart);
  const [historyDriver, setHistoryDriver] = useState(null);
  const [localRows, setLocalRows] = useState({}); // { [staff_id]: { dcr, pod, ... } }
  const [dirtyIds, setDirtyIds] = useState(new Set());

  const prevWeek = () => setWeekStart(ws => format(subDays(parseISO(ws), 7), 'yyyy-MM-dd'));
  const nextWeek = () => setWeekStart(ws => format(addDays(parseISO(ws), 7), 'yyyy-MM-dd'));
  const weekEnd  = format(addDays(parseISO(weekStart), 6), 'yyyy-MM-dd');

  // Previous week start (for trend)
  const prevWeekStart = format(subDays(parseISO(weekStart), 7), 'yyyy-MM-dd');

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: ['scorecard', weekStart],
    queryFn: () => api.get(`/scorecard?week_start=${weekStart}`).then(r => r.data),
  });

  const { data: prevDrivers = [] } = useQuery({
    queryKey: ['scorecard', prevWeekStart],
    queryFn: () => api.get(`/scorecard?week_start=${prevWeekStart}`).then(r => r.data),
  });

  // Initialize / reset local rows when server data loads or week changes
  useEffect(() => {
    if (!drivers.length) return;
    const m = {};
    for (const d of drivers) {
      m[d.staff_id] = {
        dcr:   d.dcr   ?? '', pod: d.pod ?? '',
        cc:    d.cc    ?? '', ce:  d.ce  ?? '',
        dnr:   d.dnr   ?? '', ssd: d.ssd ?? '',
        notes: d.notes ?? '',
      };
    }
    setLocalRows(m);
    setDirtyIds(new Set());
  }, [drivers, weekStart]);

  // Build prev-week score map for trend
  const prevScoreMap = useMemo(() => {
    const m = {};
    for (const d of prevDrivers) m[d.staff_id] = d.week_score != null ? parseFloat(d.week_score) : null;
    return m;
  }, [prevDrivers]);

  const saveScore = useMutation({
    mutationFn: ({ staffId }) => {
      const row = localRows[staffId] || {};
      const score = calcWeekScore(row);
      return api.put('/scorecard', {
        staff_id:   staffId,
        week_start: weekStart,
        dcr:   row.dcr  !== '' ? parseFloat(row.dcr)  : null,
        pod:   row.pod  !== '' ? parseFloat(row.pod)  : null,
        cc:    row.cc   !== '' ? parseFloat(row.cc)   : null,
        ce:    row.ce   !== '' ? parseFloat(row.ce)   : null,
        dnr:   row.dnr  !== '' ? parseFloat(row.dnr)  : null,
        ssd:   row.ssd  !== '' ? parseInt(row.ssd)    : null,
        week_score: score,
        notes: row.notes || null,
      });
    },
    onSuccess: (_, { staffId }) => {
      setDirtyIds(prev => { const n = new Set(prev); n.delete(staffId); return n; });
      qc.invalidateQueries({ queryKey: ['scorecard', weekStart] });
    },
    onError: () => toast.error('Failed to save'),
  });

  const updateField = useCallback((staffId, field, value) => {
    setLocalRows(prev => {
      const row = { ...prev[staffId], [field]: value };
      return { ...prev, [staffId]: row };
    });
    setDirtyIds(prev => new Set([...prev, staffId]));
  }, []);

  const handleBlur = (staffId) => {
    if (dirtyIds.has(staffId)) {
      saveScore.mutate({ staffId });
    }
  };

  const handleExport = () => {
    if (!drivers.length) return;
    const rows = drivers.map(d => {
      const local = localRows[d.staff_id] || {};
      const score = calcWeekScore(local);
      return {
        'Driver':     `${d.first_name} ${d.last_name}`,
        'DCR (%)':    local.dcr !== '' ? local.dcr : '',
        'POD (%)':    local.pod !== '' ? local.pod : '',
        'CC (%)':     local.cc  !== '' ? local.cc  : '',
        'CE (%)':     local.ce  !== '' ? local.ce  : '',
        'DNR (%)':    local.dnr !== '' ? local.dnr : '',
        'SSD':        local.ssd !== '' ? local.ssd : '',
        'Week Score': score != null ? score.toFixed(1) : '',
        'Notes':      local.notes || '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 26 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Scorecard ${weekStart}`);
    XLSX.writeFile(wb, `Scorecard_${weekStart}.xlsx`);
    toast.success('Exported');
  };

  // Summary stats for top bar
  const summary = useMemo(() => {
    let green = 0, yellow = 0, red = 0, total = 0;
    for (const d of drivers) {
      const local = localRows[d.staff_id] || {};
      const sc = calcWeekScore(local);
      if (sc === null) continue;
      total++;
      if (sc >= 85) green++;
      else if (sc >= 70) yellow++;
      else red++;
    }
    return { green, yellow, red, total };
  }, [drivers, localRows]);

  // At-risk drivers
  const atRisk = useMemo(() => {
    return drivers
      .map(d => {
        const local = localRows[d.staff_id] || {};
        const sc = calcWeekScore(local);
        return { ...d, computedScore: sc };
      })
      .filter(d => d.computedScore !== null && d.computedScore < 70)
      .sort((a, b) => a.computedScore - b.computedScore)
      .slice(0, 3);
  }, [drivers, localRows]);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-content">Scorecard</h1>
          <p className="text-sm text-content-muted mt-0.5">Weekly Amazon delivery metrics per driver</p>
        </div>
        <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-card-border bg-white text-xs font-semibold text-content-muted hover:text-primary hover:border-primary transition-all">
          <Download size={13} /> Export Week
        </button>
      </div>

      {/* Week navigation */}
      <div className="flex items-center gap-3 bg-white border border-card-border rounded-xl px-4 py-3">
        <button onClick={prevWeek} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
          <ChevronLeft size={16} />
        </button>
        <span className="font-semibold text-sm text-content flex-1 text-center">{weekLabel(weekStart)}</span>
        <button onClick={nextWeek} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Summary bar */}
      {summary.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Green 🟢', value: summary.green,  cls: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
            { label: 'Yellow 🟡', value: summary.yellow, cls: 'bg-yellow-50 border-yellow-200 text-yellow-800' },
            { label: 'Red 🔴',   value: summary.red,    cls: 'bg-red-50 border-red-200 text-red-800' },
            { label: 'Scored',   value: `${summary.total} / ${drivers.length}`, cls: 'bg-slate-50 border-slate-200 text-slate-700' },
          ].map(s => (
            <div key={s.label} className={`rounded-xl border px-4 py-2.5 flex items-center justify-between ${s.cls}`}>
              <span className="text-xs font-semibold">{s.label}</span>
              <span className="text-lg font-bold">{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* At-risk callout */}
      {atRisk.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-bold text-red-700 mb-1">⚠️ At-Risk Drivers This Week</p>
            <div className="flex flex-wrap gap-2">
              {atRisk.map(d => (
                <button key={d.staff_id} onClick={() => setHistoryDriver(d)}
                  className="px-2 py-1 bg-red-100 text-red-800 rounded-lg text-xs font-semibold hover:bg-red-200 transition-colors">
                  {d.first_name} {d.last_name} ({d.computedScore?.toFixed(1)})
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-card-border shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-slate-100 bg-slate-50">
            <tr className="text-[10px] font-semibold text-content-muted uppercase tracking-wide">
              <th className="px-4 py-3 text-left sticky left-0 bg-slate-50 z-10 min-w-[160px]">Driver</th>
              {METRICS.map(m => (
                <th key={m.key} className="px-2 py-3 text-center w-20" title={m.key === 'ssd' ? 'Safe & Secure Delivery Score (higher better, ≥800)' : m.higherBetter ? `${m.label} — higher is better, ≥${m.green}%` : `${m.label} — lower is better, <${m.green}%`}>
                  {m.label}
                  <span className="block text-[8px] font-normal opacity-60">{m.higherBetter ? `≥${m.green}${m.pct && m.key !== 'ssd' ? '%' : ''}` : `<${m.green}${m.pct && m.key !== 'ssd' ? '%' : ''}`}</span>
                </th>
              ))}
              <th className="px-3 py-3 text-center w-20">Score</th>
              <th className="px-3 py-3 text-center w-16">Trend</th>
              <th className="px-4 py-3 text-left min-w-[160px]">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="px-4 py-3"><div className="h-3 bg-slate-200 rounded w-32" /></td>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-2 py-3"><div className="h-3 bg-slate-200 rounded w-12 mx-auto" /></td>
                  ))}
                </tr>
              ))
            ) : drivers.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-content-muted">No active drivers found</td></tr>
            ) : drivers.map((d, idx) => {
              const local = localRows[d.staff_id] || {};
              const score = calcWeekScore(local);
              const prevScore = prevScoreMap[d.staff_id];
              const delta = score != null && prevScore != null ? score - prevScore : null;
              const dirty = dirtyIds.has(d.staff_id);

              return (
                <tr key={d.staff_id} className={`transition-colors hover:bg-slate-50 ${idx % 2 === 1 ? 'bg-slate-50/30' : ''}`}>
                  {/* Driver name (clickable → history) */}
                  <td className="px-4 py-2 sticky left-0 bg-white z-10">
                    <button onClick={() => setHistoryDriver(d)}
                      className="font-semibold text-content hover:text-primary text-left transition-colors">
                      {d.first_name} {d.last_name}
                    </button>
                    {dirty && <span className="ml-1.5 text-[9px] text-amber-500 font-bold">●</span>}
                  </td>

                  {/* Metric cells */}
                  {METRICS.map(m => {
                    const val = local[m.key] ?? '';
                    const cls = metricColor(m, val);
                    return (
                      <td key={m.key} className="px-1 py-1.5 text-center">
                        <ScoreCell
                          value={val}
                          onChange={v => updateField(d.staff_id, m.key, v)}
                          onBlur={() => handleBlur(d.staff_id)}
                          colorClass={cls}
                          placeholder={m.key === 'ssd' ? '0' : '0.00'}
                        />
                      </td>
                    );
                  })}

                  {/* Week Score */}
                  <td className="px-2 py-2 text-center">
                    {score != null ? (
                      <span className={`px-2 py-1 rounded-full text-[11px] font-bold ${scoreBg(score)}`}>
                        {score.toFixed(1)}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>

                  {/* Trend */}
                  <td className="px-2 py-2 text-center">
                    {delta === null ? (
                      <span className="text-slate-300"><Minus size={13} /></span>
                    ) : delta >= 2 ? (
                      <TrendingUp size={14} className="text-emerald-600 inline" title={`+${delta.toFixed(1)} vs prev week`} />
                    ) : delta <= -2 ? (
                      <TrendingDown size={14} className="text-red-500 inline" title={`${delta.toFixed(1)} vs prev week`} />
                    ) : (
                      <Minus size={13} className="text-slate-400 inline" title="Stable" />
                    )}
                  </td>

                  {/* Notes */}
                  <td className="px-2 py-2">
                    <input
                      type="text"
                      value={local.notes || ''}
                      onChange={e => updateField(d.staff_id, 'notes', e.target.value)}
                      onBlur={() => handleBlur(d.staff_id)}
                      placeholder="Optional notes…"
                      className="w-full text-xs border border-transparent rounded px-2 py-1 focus:outline-none focus:border-primary focus:bg-white bg-slate-50 text-slate-600 placeholder-slate-300 transition-all"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-[10px] text-content-muted px-1">
        <span className="font-semibold uppercase tracking-wide">Thresholds:</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-200 inline-block"/> Green = meets Amazon standard</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-yellow-200 inline-block"/> Yellow = approaching threshold</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-200 inline-block"/> Red = below standard</span>
        <span className="ml-auto text-primary/70">Click a driver name to view full history</span>
      </div>

      {/* History modal */}
      {historyDriver && (
        <HistoryModal driver={historyDriver} onClose={() => setHistoryDriver(null)} />
      )}
    </div>
  );
}
