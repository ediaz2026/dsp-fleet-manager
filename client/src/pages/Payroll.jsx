import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { RefreshCw, Download, DollarSign, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import api from '../api/client';
import toast from 'react-hot-toast';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useSort } from '../hooks/useSort';
import SortableHeader from '../components/SortableHeader';

export default function Payroll() {
  const qc = useQueryClient();
  const [start, setStart] = useState(format(subDays(new Date(), 14), 'yyyy-MM-dd'));
  const [end, setEnd] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [syncing, setSyncing] = useState(null);

  const { data: summary = [], isLoading } = useQuery({
    queryKey: ['payroll-summary', start, end],
    queryFn: () => api.get('/payroll/summary', { params: { start, end } }).then(r => r.data),
  });

  const { data: settings = {} } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
  });

  const syncMutation = useMutation({
    mutationFn: (provider) => api.post(`/payroll/sync/${provider}`, { pay_period_start: start, pay_period_end: end }),
    onMutate: (p) => setSyncing(p),
    onSuccess: (_, provider) => {
      qc.invalidateQueries({ queryKey: ['payroll-summary'] });
      toast.success(`${provider.toUpperCase()} sync complete`);
      setSyncing(null);
    },
    onError: (err, provider) => {
      toast.error(err.response?.data?.error || `${provider} sync failed`);
      setSyncing(null);
    },
  });

  // Add variance as a sortable field
  const summaryWithVariance = useMemo(() =>
    summary.map(r => ({
      ...r,
      variance: parseFloat(r.actual_hours || 0) - parseFloat(r.scheduled_hours || 0),
    })),
    [summary]
  );

  const { sorted, sortKey, sortDir, toggle } = useSort(summaryWithVariance, 'last_name');

  const totalScheduled = summary.reduce((s, r) => s + parseFloat(r.scheduled_hours || 0), 0);
  const totalActual = summary.reduce((s, r) => s + parseFloat(r.actual_hours || 0), 0);
  const variance = totalActual - totalScheduled;

  const chartData = summary.slice(0, 10).map(r => ({
    name: `${r.first_name.charAt(0)}. ${r.last_name}`,
    scheduled: parseFloat(r.scheduled_hours || 0).toFixed(1),
    actual: parseFloat(r.actual_hours || 0).toFixed(1),
  }));

  const exportCSV = () => {
    const headers = ['Employee ID', 'Name', 'Scheduled Hours', 'Actual Hours', 'Variance', 'NCNS', 'Call Outs'];
    const rows = summary.map(r => [
      r.employee_id, `${r.first_name} ${r.last_name}`,
      parseFloat(r.scheduled_hours || 0).toFixed(2),
      parseFloat(r.actual_hours || 0).toFixed(2),
      (parseFloat(r.actual_hours || 0) - parseFloat(r.scheduled_hours || 0)).toFixed(2),
      r.ncns_count, r.callout_count
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `payroll_${start}_${end}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Payroll</h1>
        <div className="flex gap-2">
          {settings.paycom_enabled === 'true' && (
            <button className="btn-secondary" onClick={() => syncMutation.mutate('paycom')} disabled={!!syncing}>
              <RefreshCw size={15} className={syncing === 'paycom' ? 'animate-spin' : ''} /> Sync Paycom
            </button>
          )}
          {settings.adp_enabled === 'true' && (
            <button className="btn-secondary" onClick={() => syncMutation.mutate('adp')} disabled={!!syncing}>
              <RefreshCw size={15} className={syncing === 'adp' ? 'animate-spin' : ''} /> Sync ADP
            </button>
          )}
          {settings.paycom_enabled !== 'true' && settings.adp_enabled !== 'true' && (
            <span className="text-xs text-slate-500 flex items-center">Enable Paycom/ADP in Settings to sync</span>
          )}
          <button className="btn-secondary" onClick={exportCSV}><Download size={15} /> Export</button>
        </div>
      </div>

      {/* Date range */}
      <div className="card flex items-end gap-4 flex-wrap">
        <div><label className="label">Pay Period Start</label><input type="date" className="input w-auto" value={start} onChange={e => setStart(e.target.value)} /></div>
        <div><label className="label">Pay Period End</label><input type="date" className="input w-auto" value={end} onChange={e => setEnd(e.target.value)} /></div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center"><Clock size={20} className="text-blue-600" /></div>
          <div><p className="text-xs text-slate-500">Scheduled Hours</p><p className="text-2xl font-bold text-slate-900">{totalScheduled.toFixed(0)}</p></div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center"><DollarSign size={20} className="text-emerald-600" /></div>
          <div><p className="text-xs text-slate-500">Actual Hours</p><p className="text-2xl font-bold text-slate-900">{totalActual.toFixed(0)}</p></div>
        </div>
        <div className="card flex items-center gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${variance >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
            {variance >= 0 ? <TrendingUp size={20} className="text-emerald-600" /> : <TrendingDown size={20} className="text-red-600" />}
          </div>
          <div>
            <p className="text-xs text-slate-500">Variance</p>
            <p className={`text-2xl font-bold ${variance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{variance >= 0 ? '+' : ''}{variance.toFixed(0)}h</p>
          </div>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-slate-800 mb-4">Hours: Scheduled vs. Actual</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barSize={12}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, color: '#0f172a' }} />
              <Legend wrapperStyle={{ color: '#64748b', fontSize: 12 }} />
              <Bar dataKey="scheduled" fill="#3b82f6" radius={[4,4,0,0]} name="Scheduled" />
              <Bar dataKey="actual" fill="#10b981" radius={[4,4,0,0]} name="Actual" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100">
              <SortableHeader label="Employee" sortKey="last_name" currentKey={sortKey} direction={sortDir} onSort={toggle} className="text-left" />
              <SortableHeader label="Scheduled" sortKey="scheduled_hours" currentKey={sortKey} direction={sortDir} onSort={toggle} className="text-right" />
              <SortableHeader label="Actual" sortKey="actual_hours" currentKey={sortKey} direction={sortDir} onSort={toggle} className="text-right" />
              <SortableHeader label="Variance" sortKey="variance" currentKey={sortKey} direction={sortDir} onSort={toggle} className="text-right" />
              <SortableHeader label="Days Present" sortKey="days_present" currentKey={sortKey} direction={sortDir} onSort={toggle} className="text-center" />
              <SortableHeader label="NCNS" sortKey="ncns_count" currentKey={sortKey} direction={sortDir} onSort={toggle} className="text-center" />
              <SortableHeader label="Call-Outs" sortKey="callout_count" currentKey={sortKey} direction={sortDir} onSort={toggle} className="text-center" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-10 text-slate-500">Loading…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-slate-500">No payroll data for this period</td></tr>
            ) : sorted.map(r => {
              const sched = parseFloat(r.scheduled_hours || 0);
              const actual = parseFloat(r.actual_hours || 0);
              const v = actual - sched;
              return (
                <tr key={r.employee_id} className="table-row even:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{r.first_name} {r.last_name}</p>
                    <p className="text-xs text-slate-500">{r.employee_id}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">{sched.toFixed(1)}h</td>
                  <td className="px-4 py-3 text-right text-slate-700 font-medium">{actual.toFixed(1)}h</td>
                  <td className={`px-4 py-3 text-right font-medium ${v >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {v >= 0 ? '+' : ''}{v.toFixed(1)}h
                  </td>
                  <td className="px-4 py-3 text-center text-slate-700">{r.days_present}</td>
                  <td className="px-4 py-3 text-center text-red-600 font-medium">{r.ncns_count}</td>
                  <td className="px-4 py-3 text-center text-orange-600">{r.callout_count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
