import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { Download, CheckCircle, XCircle, Clock, AlertCircle, ChevronDown } from 'lucide-react';
import api from '../api/client';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import toast from 'react-hot-toast';
import { useAuth } from '../App';

const STATUS_OPTS = [
  { value: 'present', label: 'Present', icon: CheckCircle, color: 'text-green-400' },
  { value: 'late', label: 'Late', icon: Clock, color: 'text-yellow-400' },
  { value: 'called_out', label: 'Called Out', icon: AlertCircle, color: 'text-orange-400' },
  { value: 'ncns', label: 'NCNS', icon: XCircle, color: 'text-red-400' },
];

export default function Attendance() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState('log');
  const [dateFilter, setDateFilter] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [exportStart, setExportStart] = useState(format(subDays(new Date(), 14), 'yyyy-MM-dd'));
  const [exportEnd, setExportEnd] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState({});

  const isManager = ['manager', 'admin', 'dispatcher'].includes(user?.role);

  const { data: attendance = [], isLoading } = useQuery({
    queryKey: ['attendance', dateFilter],
    queryFn: () => api.get('/attendance', { params: { date: dateFilter } }).then(r => r.data),
  });

  const { data: violations = [] } = useQuery({
    queryKey: ['violations'],
    queryFn: () => api.get('/staff').then(async staff => {
      const all = await Promise.all(
        staff.data.filter(s => s.role === 'driver').map(s =>
          api.get(`/staff/${s.id}/violations`).then(r => r.data.map(v => ({ ...v, staff: s })))
        )
      );
      return all.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }),
    enabled: tab === 'violations',
  });

  const { data: exportData = [] } = useQuery({
    queryKey: ['attendance-export', exportStart, exportEnd],
    queryFn: () => api.get('/attendance/export', { params: { start: exportStart, end: exportEnd } }).then(r => r.data),
    enabled: tab === 'export',
  });

  const markMutation = useMutation({
    mutationFn: ({ attendanceId, payload }) =>
      attendanceId ? api.put(`/attendance/${attendanceId}`, payload) : api.post('/attendance', payload),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      const { consequences = [] } = res.data;
      if (consequences.length > 0) {
        consequences.forEach(c => toast(`⚠️ Rule triggered: ${c.rule} → ${c.action}`, { duration: 5000 }));
      } else {
        toast.success('Attendance updated');
      }
      setEditModal(null);
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed'),
  });

  const openEdit = (row) => {
    setEditForm({
      staff_id: row.staff_id,
      shift_id: row.shift_id,
      attendance_date: dateFilter,
      status: row.attendance_status || row.status || 'present',
      call_out_reason: row.call_out_reason || '',
      late_minutes: row.late_minutes || 0,
      notes: row.notes || '',
      clock_in: row.clock_in ? format(new Date(row.clock_in), "yyyy-MM-dd'T'HH:mm") : '',
      clock_out: row.clock_out ? format(new Date(row.clock_out), "yyyy-MM-dd'T'HH:mm") : '',
    });
    setEditModal(row);
  };

  const quickMark = (row, status) => {
    const payload = {
      staff_id: row.staff_id || row.id,
      shift_id: row.shift_id || row.id,
      attendance_date: dateFilter,
      status,
    };
    markMutation.mutate({ attendanceId: row.attendance_id || null, payload });
  };

  // Today's schedule view for marking
  const { data: todayShifts = [] } = useQuery({
    queryKey: ['shifts-today-attendance', dateFilter],
    queryFn: () => api.get('/shifts', { params: { start: dateFilter, end: dateFilter } }).then(r => r.data),
    enabled: tab === 'log',
  });

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
      <div className="flex gap-1 p-1 bg-surface-card rounded-xl border border-surface-border w-fit">
        {[['log', 'Daily Log'], ['violations', 'Violations'], ['export', 'Export']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === v ? 'bg-primary text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'log' && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <input type="date" className="input w-auto" value={dateFilter}
              onChange={e => setDateFilter(e.target.value)} />
            <span className="text-slate-400 text-sm">{todayShifts.length} shifts scheduled</span>
          </div>

          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border text-xs text-slate-400">
                  <th className="text-left px-4 py-3">Driver</th>
                  <th className="text-left px-4 py-3">Shift</th>
                  <th className="text-left px-4 py-3">Clock In</th>
                  <th className="text-left px-4 py-3">Clock Out</th>
                  <th className="text-left px-4 py-3">Hours</th>
                  <th className="text-left px-4 py-3">Status</th>
                  {isManager && <th className="text-left px-4 py-3">Quick Mark</th>}
                </tr>
              </thead>
              <tbody>
                {todayShifts.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-10 text-slate-500">No shifts on this date</td></tr>
                ) : todayShifts.map(row => (
                  <tr key={row.id} className="table-row">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-200">{row.first_name} {row.last_name}</p>
                      <p className="text-xs text-slate-500">{row.employee_id}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{row.start_time?.slice(0,5)} – {row.end_time?.slice(0,5)}</td>
                    <td className="px-4 py-3 text-slate-400">{row.clock_in ? format(new Date(row.clock_in), 'h:mm a') : '—'}</td>
                    <td className="px-4 py-3 text-slate-400">{row.clock_out ? format(new Date(row.clock_out), 'h:mm a') : '—'}</td>
                    <td className="px-4 py-3 text-slate-400">{row.hours_worked ? `${parseFloat(row.hours_worked).toFixed(1)}h` : '—'}</td>
                    <td className="px-4 py-3"><Badge status={row.attendance_status || 'scheduled'} /></td>
                    {isManager && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {STATUS_OPTS.map(opt => (
                            <button key={opt.value} onClick={() => quickMark(row, opt.value)}
                              title={opt.label}
                              className={`p-1.5 rounded-lg border border-surface-border hover:bg-surface-hover transition-colors ${row.attendance_status === opt.value ? 'bg-surface-hover ring-1 ring-primary' : ''}`}>
                              <opt.icon size={14} className={opt.color} />
                            </button>
                          ))}
                          <button onClick={() => openEdit(row)}
                            className="p-1.5 rounded-lg border border-surface-border hover:bg-surface-hover text-slate-400">
                            <ChevronDown size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'violations' && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-xs text-slate-400">
                <th className="text-left px-4 py-3">Employee</th>
                <th className="text-left px-4 py-3">Rule</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Action</th>
                <th className="text-left px-4 py-3">Notes</th>
                <th className="text-left px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {violations.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-500">No violations recorded</td></tr>
              ) : violations.map(v => (
                <tr key={v.id} className="table-row">
                  <td className="px-4 py-3 font-medium text-slate-200">{v.staff?.first_name} {v.staff?.last_name}</td>
                  <td className="px-4 py-3 text-slate-400">{v.rule_name}</td>
                  <td className="px-4 py-3"><Badge status={v.violation_type} /></td>
                  <td className="px-4 py-3"><Badge status={v.action_taken} /></td>
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-xs truncate">{v.notes}</td>
                  <td className="px-4 py-3 text-slate-500">{format(new Date(v.created_at), 'MMM d, yyyy')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                <tr className="border-b border-surface-border text-xs text-slate-400">
                  <th className="text-left px-4 py-3">Employee ID</th>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-center px-4 py-3">Present</th>
                  <th className="text-center px-4 py-3">Called Out</th>
                  <th className="text-center px-4 py-3">NCNS</th>
                  <th className="text-center px-4 py-3">Late</th>
                  <th className="text-center px-4 py-3">Total Hours</th>
                </tr>
              </thead>
              <tbody>
                {exportData.map(r => (
                  <tr key={r.employee_id} className="table-row">
                    <td className="px-4 py-3 text-slate-500">{r.employee_id}</td>
                    <td className="px-4 py-3 font-medium text-slate-200">{r.first_name} {r.last_name}</td>
                    <td className="px-4 py-3 text-center text-green-400">{r.present}</td>
                    <td className="px-4 py-3 text-center text-orange-400">{r.called_out}</td>
                    <td className="px-4 py-3 text-center text-red-400">{r.ncns}</td>
                    <td className="px-4 py-3 text-center text-yellow-400">{r.late}</td>
                    <td className="px-4 py-3 text-center text-slate-300 font-medium">{parseFloat(r.total_hours).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      <Modal isOpen={!!editModal} onClose={() => setEditModal(null)} title="Edit Attendance">
        <form className="space-y-4" onSubmit={e => {
          e.preventDefault();
          markMutation.mutate({ attendanceId: editModal?.attendance_id || null, payload: editForm });
        }}>
          <div>
            <label className="label">Status</label>
            <select className="select" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}>
              {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {editForm.status === 'late' && (
            <div>
              <label className="label">Minutes Late</label>
              <input type="number" className="input" value={editForm.late_minutes}
                onChange={e => setEditForm(f => ({ ...f, late_minutes: e.target.value }))} min="0" />
            </div>
          )}
          {['called_out', 'ncns'].includes(editForm.status) && (
            <div>
              <label className="label">Reason</label>
              <input type="text" className="input" value={editForm.call_out_reason}
                onChange={e => setEditForm(f => ({ ...f, call_out_reason: e.target.value }))} placeholder="Optional reason" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Clock In</label>
              <input type="datetime-local" className="input" value={editForm.clock_in}
                onChange={e => setEditForm(f => ({ ...f, clock_in: e.target.value }))} />
            </div>
            <div>
              <label className="label">Clock Out</label>
              <input type="datetime-local" className="input" value={editForm.clock_out}
                onChange={e => setEditForm(f => ({ ...f, clock_out: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <input type="text" className="input" value={editForm.notes}
              onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setEditModal(null)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={markMutation.isPending}>
              {markMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
