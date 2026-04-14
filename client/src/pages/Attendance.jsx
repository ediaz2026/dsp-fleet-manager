import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { format, subDays, getWeek } from 'date-fns';
import { Download, CheckCircle, XCircle, Clock, AlertCircle, ChevronDown, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../api/client';
import Badge from '../components/Badge';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useSort } from '../hooks/useSort';
import SortableHeader from '../components/SortableHeader';

const STATUS_BADGE = {
  ncns:       { label: 'NCNS',      bg: 'bg-red-100',    text: 'text-red-700' },
  called_out: { label: 'Call Out',   bg: 'bg-orange-100', text: 'text-orange-700' },
  late:       { label: 'Late',       bg: 'bg-amber-100',  text: 'text-amber-700' },
  sent_home:  { label: 'Sent Home',  bg: 'bg-slate-100',  text: 'text-slate-600' },
};

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getSundayStr() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const sun = new Date(now);
  sun.setDate(now.getDate() - now.getDay());
  return localDateStr(sun);
}

function fmtWeekRange(ws) {
  const parts = ws.split('-').map(Number);
  const s = new Date(parts[0], parts[1] - 1, parts[2]);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function getWeekNumber(ws) {
  const parts = ws.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return getWeek(d, { weekStartsOn: 0, firstWeekContainsDate: 1 });
}

function shiftWeek(ws, delta) {
  const parts = ws.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + delta * 7);
  return localDateStr(d);
}

export default function Attendance() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState('week');
  const [exportStart, setExportStart] = useState(format(subDays(new Date(), 14), 'yyyy-MM-dd'));
  const [exportEnd, setExportEnd] = useState(format(new Date(), 'yyyy-MM-dd'));

  const isManager = ['manager', 'admin', 'dispatcher'].includes(user?.role);
  const currentSunday = getSundayStr();
  const [weekStart, setWeekStart] = useState(currentSunday);
  const isCurrentWeek = weekStart === currentSunday;

  // ── This Week tab data ────────────────────────────────────────────────────
  const { data: weeklyIssues = [], isLoading: weekLoading } = useQuery({
    queryKey: ['weekly-issues', weekStart],
    queryFn: () => api.get(`/attendance/weekly-issues?week_start=${weekStart}`).then(r => r.data),
    enabled: tab === 'week',
  });

  const excuseMutation = useMutation({
    mutationFn: ({ id, excused, excuse_reason }) =>
      api.put(`/attendance/${id}`, { excused, excuse_reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weekly-issues'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Saved');
    },
    onError: () => toast.error('Failed to save'),
  });

  // Group issues by date
  const groupedIssues = useMemo(() => {
    const map = {};
    weeklyIssues.forEach(i => {
      const d = (i.attendance_date || '').split('T')[0];
      if (!map[d]) map[d] = [];
      map[d].push(i);
    });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0])); // newest first
  }, [weeklyIssues]);

  // ── Violations tab data ───────────────────────────────────────────────────
  const { data: violations = [] } = useQuery({
    queryKey: ['violations'],
    queryFn: () => api.get('/attendance/violations').then(r => r.data),
    enabled: tab === 'violations',
  });

  const [dismissingId, setDismissingId] = useState(null);
  const [dismissReason, setDismissReason] = useState('');

  const violationMutation = useMutation({
    mutationFn: ({ id, status, dismiss_reason }) =>
      api.put(`/attendance/violations/${id}`, { status, dismiss_reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['violations'] });
      setDismissingId(null);
      setDismissReason('');
      toast.success('Violation updated');
    },
    onError: () => toast.error('Failed to update violation'),
  });

  // ── Export tab data ───────────────────────────────────────────────────────
  const { data: exportData = [] } = useQuery({
    queryKey: ['attendance-export', exportStart, exportEnd],
    queryFn: () => api.get('/attendance/export', { params: { start: exportStart, end: exportEnd } }).then(r => r.data),
    enabled: tab === 'export',
  });
  const { sorted: sortedExport, sortKey: eKey, sortDir: eDir, toggle: eToggle } = useSort(exportData, 'last_name');

  const exportCSV = () => {
    const headers = ['Employee ID', 'First Name', 'Last Name', 'Present', 'Called Out', 'NCNS', 'Late', 'Total Hours'];
    const rows = exportData.map(r => [r.employee_id, r.first_name, r.last_name, r.present, r.called_out, r.ncns, r.late, parseFloat(r.total_hours).toFixed(2)]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `attendance_${exportStart}_${exportEnd}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Attendance</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200 w-fit">
        {[['week', 'Attendance'], ['violations', 'Violations'], ['export', 'Export']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === v ? 'bg-primary text-white' : 'text-slate-500 hover:text-slate-700'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ── This Week ─────────────────────────────────────────────────────── */}
      {tab === 'week' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-bold text-slate-700">Week {getWeekNumber(weekStart)} · {fmtWeekRange(weekStart)}</p>
                <p className="text-xs text-slate-500 mt-1">
                  Showing NCNS, Call Outs, Late arrivals and Sent Home.
                  Excused absences do not count toward violations.
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setWeekStart(w => shiftWeek(w, -1))} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 transition-colors">
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setWeekStart(w => shiftWeek(w, 1))}
                  disabled={isCurrentWeek}
                  className={`p-1.5 rounded-lg border border-slate-200 transition-colors ${isCurrentWeek ? 'text-slate-300 cursor-not-allowed' : 'hover:bg-slate-50 text-slate-500'}`}
                >
                  <ChevronRight size={16} />
                </button>
                {!isCurrentWeek && (
                  <button onClick={() => setWeekStart(currentSunday)} className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors">
                    Today
                  </button>
                )}
              </div>
            </div>
          </div>

          {weekLoading ? (
            <div className="h-32 bg-slate-100 rounded-xl animate-pulse" />
          ) : weeklyIssues.length === 0 ? (
            <div className="bg-white border border-emerald-200 rounded-xl p-8 text-center shadow-sm">
              <Check size={28} className="text-emerald-500 mx-auto mb-2" />
              <p className="font-semibold text-slate-800">No attendance issues this week</p>
              <p className="text-sm text-slate-500 mt-1">All drivers showed up on time.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {groupedIssues.map(([dateStr, issues]) => {
                const d = new Date(dateStr + 'T12:00:00Z');
                const dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
                return (
                  <div key={dateStr}>
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-sm font-bold text-slate-700">{dayLabel}</p>
                      <span className="text-xs text-slate-400">— {issues.length} issue{issues.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="space-y-2">
                      {issues.map(issue => {
                        const badge = STATUS_BADGE[issue.status] || STATUS_BADGE.sent_home;
                        return (
                          <div
                            key={issue.id}
                            className={`bg-white border rounded-xl p-3 shadow-sm transition-colors ${
                              issue.excused ? 'border-emerald-200 bg-emerald-50/30 opacity-70' : 'border-slate-200'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div className="flex items-center gap-2.5">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${badge.bg} ${badge.text}`}>
                                  {badge.label}
                                </span>
                                <span className="font-semibold text-sm text-slate-800">{issue.driver_name}</span>
                                {issue.excused && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                                    Excused
                                  </span>
                                )}
                              </div>

                              {isManager && (
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-slate-400">Excused?</span>
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => excuseMutation.mutate({ id: issue.id, excused: false, excuse_reason: null })}
                                      className={`px-2 py-0.5 text-[11px] font-semibold rounded-lg border transition-colors ${
                                        !issue.excused ? 'bg-slate-800 text-white border-slate-800' : 'text-slate-400 border-slate-200 hover:border-slate-300'
                                      }`}
                                    >No</button>
                                    <button
                                      onClick={() => excuseMutation.mutate({ id: issue.id, excused: true, excuse_reason: issue.excuse_reason || '' })}
                                      className={`px-2 py-0.5 text-[11px] font-semibold rounded-lg border transition-colors ${
                                        issue.excused ? 'bg-emerald-600 text-white border-emerald-600' : 'text-slate-400 border-slate-200 hover:border-slate-300'
                                      }`}
                                    >Yes</button>
                                  </div>
                                </div>
                              )}
                            </div>

                            {issue.excused && isManager && (
                              <div className="mt-2 flex items-center gap-2">
                                <span className="text-[10px] text-slate-400 flex-shrink-0">Reason:</span>
                                <input
                                  type="text"
                                  defaultValue={issue.excuse_reason || ''}
                                  placeholder="Enter reason..."
                                  onBlur={e => {
                                    const val = e.target.value;
                                    if (val !== (issue.excuse_reason || '')) {
                                      excuseMutation.mutate({ id: issue.id, excused: true, excuse_reason: val });
                                    }
                                  }}
                                  className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                                />
                              </div>
                            )}

                            {issue.excused && (
                              <p className="text-[10px] text-emerald-600 mt-1.5">Not counted toward violations</p>
                            )}
                            {issue.notes && (
                              <p className="text-[10px] text-slate-400 mt-1">Note: {issue.notes}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Violations ────────────────────────────────────────────────────── */}
      {tab === 'violations' && (
        <div className="space-y-3">
          {violations.length === 0 ? (
            <div className="bg-white border border-emerald-200 rounded-xl p-8 text-center shadow-sm">
              <Check size={28} className="text-emerald-500 mx-auto mb-2" />
              <p className="font-semibold text-slate-800">No pending violations</p>
              <p className="text-sm text-slate-500 mt-1">All consequence rules are clear.</p>
            </div>
          ) : violations.map(v => {
            const actionColors = {
              written_warning:    { bg: 'bg-amber-100',  text: 'text-amber-700',  label: 'Written Warning' },
              suspension:         { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Suspension' },
              termination_review: { bg: 'bg-red-100',    text: 'text-red-700',    label: 'Termination Review' },
            };
            const ac = actionColors[v.action_taken || v.consequence_action] || { bg: 'bg-slate-100', text: 'text-slate-600', label: v.action_taken || v.consequence_action || '—' };
            const statusColors = {
              pending:   { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Pending' },
              confirmed: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Confirmed' },
              dismissed: { bg: 'bg-slate-100',   text: 'text-slate-500',   label: 'Dismissed' },
            };
            const sc = statusColors[v.status] || statusColors.pending;
            const isPending = !v.status || v.status === 'pending';

            return (
              <div key={v.id} className={`bg-white border rounded-xl p-4 shadow-sm ${isPending ? 'border-amber-200' : 'border-slate-200'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-slate-800">{v.first_name} {v.last_name}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${ac.bg} ${ac.text}`}>
                        {ac.label}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${sc.bg} ${sc.text}`}>
                        {sc.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{v.rule_name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{v.notes}</p>
                    {v.created_at && <p className="text-[10px] text-slate-400 mt-1">Triggered {format(new Date(v.created_at), 'MMM d, yyyy')}</p>}
                  </div>

                  {isPending && isManager && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => violationMutation.mutate({ id: v.id, status: 'confirmed' })}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                      >Confirm</button>
                      {dismissingId === v.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            autoFocus
                            placeholder="Reason..."
                            value={dismissReason}
                            onChange={e => setDismissReason(e.target.value)}
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1 w-36 focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                          <button
                            onClick={() => violationMutation.mutate({ id: v.id, status: 'dismissed', dismiss_reason: dismissReason })}
                            className="px-2 py-1 text-xs font-semibold rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-colors"
                          >Save</button>
                          <button
                            onClick={() => { setDismissingId(null); setDismissReason(''); }}
                            className="px-2 py-1 text-xs text-slate-400 hover:text-slate-600"
                          >Cancel</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setDismissingId(v.id); setDismissReason(''); }}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                        >Dismiss</button>
                      )}
                    </div>
                  )}
                </div>

                {v.status === 'confirmed' && v.reviewed_by_first && (
                  <p className="text-[10px] text-emerald-600 mt-2">
                    Confirmed by {v.reviewed_by_first} {v.reviewed_by_last}{v.reviewed_at ? ` on ${format(new Date(v.reviewed_at), 'MMM d, yyyy')}` : ''}
                  </p>
                )}
                {v.status === 'dismissed' && (
                  <p className="text-[10px] text-slate-400 mt-2">
                    Dismissed{v.dismiss_reason ? ` — ${v.dismiss_reason}` : ''}{v.reviewed_by_first ? ` by ${v.reviewed_by_first} ${v.reviewed_by_last}` : ''}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Export ─────────────────────────────────────────────────────────── */}
      {tab === 'export' && (
        <div className="space-y-4">
          <div className="card flex items-end gap-4 flex-wrap">
            <div>
              <label className="label">From</label>
              <input type="date" className="input w-auto" value={exportStart} onChange={e => setExportStart(e.target.value)} />
            </div>
            <div>
              <label className="label">To</label>
              <input type="date" className="input w-auto" value={exportEnd} onChange={e => setExportEnd(e.target.value)} />
            </div>
            <button className="btn-primary" onClick={exportCSV}>
              <Download size={16} /> Export CSV
            </button>
          </div>
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100">
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-700 uppercase tracking-wide bg-slate-100">Employee ID</th>
                  <SortableHeader label="Name" sortKey="last_name" currentKey={eKey} direction={eDir} onSort={eToggle} className="text-left" />
                  <SortableHeader label="Present" sortKey="present" currentKey={eKey} direction={eDir} onSort={eToggle} className="text-center" />
                  <SortableHeader label="Called Out" sortKey="called_out" currentKey={eKey} direction={eDir} onSort={eToggle} className="text-center" />
                  <SortableHeader label="NCNS" sortKey="ncns" currentKey={eKey} direction={eDir} onSort={eToggle} className="text-center" />
                  <SortableHeader label="Late" sortKey="late" currentKey={eKey} direction={eDir} onSort={eToggle} className="text-center" />
                  <SortableHeader label="Total Hours" sortKey="total_hours" currentKey={eKey} direction={eDir} onSort={eToggle} className="text-center" />
                </tr>
              </thead>
              <tbody>
                {sortedExport.map(r => (
                  <tr key={r.employee_id} className="table-row even:bg-slate-50">
                    <td className="px-3 py-3 text-slate-500">{r.employee_id}</td>
                    <td className="px-3 py-3 font-medium text-slate-800">{r.first_name} {r.last_name}</td>
                    <td className="px-3 py-3 text-center text-green-600">{r.present}</td>
                    <td className="px-3 py-3 text-center text-orange-600">{r.called_out}</td>
                    <td className="px-3 py-3 text-center text-red-600">{r.ncns}</td>
                    <td className="px-3 py-3 text-center text-yellow-600">{r.late}</td>
                    <td className="px-3 py-3 text-center text-slate-700 font-medium">{parseFloat(r.total_hours).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
