import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { Download, CheckCircle, XCircle, Clock, AlertCircle, ChevronDown } from 'lucide-react';
import api from '../api/client';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import toast from 'react-hot-toast';
import { useAuth } from '../App';
import { useSort } from '../hooks/useSort';
import SortableHeader from '../components/SortableHeader';

const STATUS_OPTS = [
  { value: 'present', label: 'Present', icon: CheckCircle, color: 'text-green-600' },
  { value: 'late', label: 'Late', icon: Clock, color: 'text-yellow-600' },
  { value: 'called_out', label: 'Called Out', icon: AlertCircle, color: 'text-orange-600' },
  { value: 'ncns', label: 'NCNS', icon: XCircle, color: 'text-red-600' },
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

  const { data: todayShifts = [] } = useQuery({
    queryKey: ['shifts-today-attendance', dateFilter],
    queryFn: () => api.get('/shifts', { params: { start: dateFilter, end: dateFilter } }).then(r => r.data),
    enabled: tab === 'log',
  });

  const { sorted: sortedShifts, sortKey: sKey, sortDir: sDir, toggle: sToggle } = useSort(todayShifts, 'first_name');
  const { sorted: sortedViolations, sortKey: vKey, sortDir: vDir, toggle: vToggle } = useSort(violations, 'created_at', 'desc');
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
        {[['log', 'Daily Log'], ['violations', 'Violations'], ['export', 'Export']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === v ? 'bg-primary text-white' : 'text-slate-500 hover:text-slate-700'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'log' && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <input type="date" className="input w-auto" value={dateFilter}
              onChange={e => setDateFilter(e.target.value)} />
            <span className="text-slate-500 text-sm">{todayShifts.length} shifts scheduled</span>
          </div>

          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100">
                  <SortableHeader label="Driver" sortKey="first_name" currentKey={sKey} direction={sDir} onSort={sToggle} className="text-left" />
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-700 uppercase tracking-wide bg-slate-100">Shift</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-700 uppercase tracking-wide bg-slate-100">Clock In</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-700 uppercase tracking-wide bg-slate-100">Clock Out</th>
                  <SortableHeader label="Hours" sortKey="hours_worked" currentKey={sKey} direction={sDir} onSort={sToggle} className="text-left" />
                  <SortableHeader label="Status" sortKey="attendance_status" currentKey={sKey} direction={sDir} onSort={sToggle} className="text-left" />
                  {isManager && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-700 uppercase tracking-wide bg-slate-100">Quick Mark</th>}
                </tr>
              </thead>
              <tbody>
                {sortedShifts.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-10 text-slate-500">No shifts on this date</td></tr>
                ) : sortedShifts.map(row => (
                  <tr key={row.id} className="table-row even:bg-slate-50">
                    <td className="px-3 py-3">
                      <p className="font-medium text-slate-800">{row.first_name} {row.last_name}</p>
                      <p className="text-xs text-slate-500">{row.employee_id}</p>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{row.start_time?.slice(0,5)} – {row.end_time?.slice(0,5)}</td>
                    <td className="px-3 py-3 text-slate-600">{row.clock_in ? format(new Date(row.clock_in), 'h:mm a') : '—'}</td>
                    <td className="px-3 py-3 text-slate-600">{row.clock_out ? format(new Date(row.clock_out), 'h:mm a') : '—'}</td>
                    <td className="px-3 py-3 text-slate-600">{row.hours_worked ? `${parseFloat(row.hours_worked).toFixed(1)}h` : '—'}</td>
                    <td className="px-3 py-3"><Badge status={row.attendance_status || 'scheduled'} /></td>
                    {isManager && (
                      <td className="px-3 py-3">
                        <div className="flex gap-1">
                          {STATUS_OPTS.map(opt => (
                            <button key={opt.value} onClick={() => quickMark(row, opt.value)}
                              title={opt.label}
                              className={`p-1.5 rounded-lg border border-slate-200 hover:bg-blue-50 transition-colors ${row.attendance_status === opt.value ? 'bg-blue-50 ring-1 ring-primary' : ''}`}>
                              <opt.icon size={14} className={opt.color} />
                            </button>
                          ))}
                          <button onClick={() => openEdit(row)}
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500">
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
              <tr className="border-b border-slate-200 bg-slate-100">
                <SortableHeader label="Employee" sortKey="first_name" currentKey={vKey} direction={vDir} onSort={vToggle} className="text-left" />
                <SortableHeader label="Rule" sortKey="rule_name" currentKey={vKey} direction={vDir} onSort={vToggle} className="text-left" />
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-700 uppercase tracking-wide bg-slate-100">Type</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-700 uppercase tracking-wide bg-slate-100">Action</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-700 uppercase tracking-wide bg-slate-100">Notes</th>
                <SortableHeader label="Date" sortKey="created_at" currentKey={vKey} direction={vDir} onSort={vToggle} className="text-left" />
              </tr>
            </thead>
            <tbody>
              {sortedViolations.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-500">No violations recorded</td></tr>
              ) : sortedViolations.map(v => (
                <tr key={v.id} className="table-row even:bg-slate-50">
                  <td className="px-3 py-3 font-medium text-slate-800">{v.staff?.first_name} {v.staff?.last_name}</td>
                  <td className="px-3 py-3 text-slate-600">{v.rule_name}</td>
                  <td className="px-3 py-3"><Badge status={v.violation_type} /></td>
                  <td className="px-3 py-3"><Badge status={v.action_taken} /></td>
                  <td className="px-3 py-3 text-slate-500 text-xs max-w-xs truncate">{v.notes}</td>
                  <td className="px-3 py-3 text-slate-500">{format(new Date(v.created_at), 'MMM d, yyyy')}</td>
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

      {/* Edit Modal */}
      <Modal isOpen={!!editModal} onClose={() => setEditModal(null)} title="Edit Attendance">
        <form className="space-y-4" onSubmit={e => {
          e.preventDefault();
          markMutation.mutate({ attendanceId: editModal?.attendance_id || null, payload: editForm });
        }}>
          <div>
            <label className="modal-label">Status</label>
            <select className="select" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}>
              {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {editForm.status === 'late' && (
            <div>
              <label className="modal-label">Minutes Late</label>
              <input type="number" className="input" value={editForm.late_minutes}
                onChange={e => setEditForm(f => ({ ...f, late_minutes: e.target.value }))} min="0" />
            </div>
          )}
          {['called_out', 'ncns'].includes(editForm.status) && (
            <div>
              <label className="modal-label">Reason</label>
              <input type="text" className="input" value={editForm.call_out_reason}
                onChange={e => setEditForm(f => ({ ...f, call_out_reason: e.target.value }))} placeholder="Optional reason" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="modal-label">Clock In</label>
              <input type="datetime-local" className="input" value={editForm.clock_in}
                onChange={e => setEditForm(f => ({ ...f, clock_in: e.target.value }))} />
            </div>
            <div>
              <label className="modal-label">Clock Out</label>
              <input type="datetime-local" className="input" value={editForm.clock_out}
                onChange={e => setEditForm(f => ({ ...f, clock_out: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="modal-label">Notes</label>
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
