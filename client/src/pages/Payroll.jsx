import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { RefreshCw, Download, DollarSign, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import api from '../api/client';
import toast from 'react-hot-toast';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

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
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center"><Clock size={20} className="text-blue-400" /></div>
          <div><p className="text-xs text-slate-400">Scheduled Hours</p><p className="text-2xl font-bold text-slate-100">{totalScheduled.toFixed(0)}</p></div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center"><DollarSign size={20} className="text-green-400" /></div>
          <div><p className="text-xs text-slate-400">Actual Hours</p><p className="text-2xl font-bold text-slate-100">{totalActual.toFixed(0)}</p></div>
        </div>
        <div className="card flex items-center gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${variance >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
            {variance >= 0 ? <TrendingUp size={20} className="text-green-400" /> : <TrendingDown size={20} className="text-red-400" />}
          </div>
          <div>
            <p className="text-xs text-slate-400">Variance</p>
            <p className={`text-2xl font-bold ${variance >= 0 ? 'text-green-400' : 'text-red-400'}`}>{variance >= 0 ? '+' : ''}{variance.toFixed(0)}h</p>
          </div>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-slate-200 mb-4">Hours: Scheduled vs. Actual</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barSize={12}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }} />
              <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
              <Bar dataKey="scheduled" fill="#3b82f6" radius={[4,4,0,0]} name="Scheduled" />
              <Bar dataKey="actual" fill="#22c55e" radius={[4,4,0,0]} name="Actual" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border text-xs text-slate-400">
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-right px-4 py-3">Scheduled</th>
              <th className="text-right px-4 py-3">Actual</th>
              <th className="text-right px-4 py-3">Variance</th>
              <th className="text-center px-4 py-3">Days Present</th>
              <th className="text-center px-4 py-3">NCNS</th>
              <th className="text-center px-4 py-3">Call-Outs</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-10 text-slate-500">Loading…</td></tr>
            ) : summary.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-slate-500">No payroll data for this period</td></tr>
            ) : summary.map(r => {
              const sched = parseFloat(r.scheduled_hours || 0);
              const actual = parseFloat(r.actual_hours || 0);
              const v = actual - sched;
              return (
                <tr key={r.employee_id} className="table-row">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-200">{r.first_name} {r.last_name}</p>
                    <p className="text-xs text-slate-500">{r.employee_id}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300">{sched.toFixed(1)}h</td>
                  <td className="px-4 py-3 text-right text-slate-300 font-medium">{actual.toFixed(1)}h</td>
                  <td className={`px-4 py-3 text-right font-medium ${v >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {v >= 0 ? '+' : ''}{v.toFixed(1)}h
                  </td>
                  <td className="px-4 py-3 text-center text-slate-300">{r.days_present}</td>
                  <td className="px-4 py-3 text-center text-red-400 font-medium">{r.ncns_count}</td>
                  <td className="px-4 py-3 text-center text-orange-400">{r.callout_count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
