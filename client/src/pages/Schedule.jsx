import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { format, addDays, startOfWeek, endOfWeek, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, Trash2, Clock } from 'lucide-react';
import api from '../api/client';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import toast from 'react-hot-toast';
import { useAuth } from '../App';

export default function Schedule() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ staff_id: '', shift_date: format(new Date(), 'yyyy-MM-dd'), start_time: '07:00', end_time: '17:00', shift_type: 'regular', notes: '' });

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const days = Array.from({ length: 6 }, (_, i) => addDays(weekStart, i)); // Mon-Sat

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['shifts', format(weekStart, 'yyyy-MM-dd')],
    queryFn: () => api.get('/shifts', { params: { start: format(weekStart, 'yyyy-MM-dd'), end: format(weekEnd, 'yyyy-MM-dd') } }).then(r => r.data),
  });

  const { data: staff = [] } = useQuery({
    queryKey: ['staff', 'drivers'],
    queryFn: () => api.get('/staff', { params: { role: 'driver', status: 'active' } }).then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: data => api.post('/shifts', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shifts'] }); toast.success('Shift created'); setShowModal(false); },
    onError: err => toast.error(err.response?.data?.error || 'Failed to create shift'),
  });

  const deleteMutation = useMutation({
    mutationFn: id => api.delete(`/shifts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shifts'] }); toast.success('Shift deleted'); },
  });

  // Group shifts by staff + date for grid view
  const shiftMap = {};
  shifts.forEach(s => {
    const key = `${s.staff_id}-${s.shift_date?.split('T')[0] || s.shift_date}`;
    shiftMap[key] = s;
  });

  // Unique staff who have shifts this week
  const weekStaff = staff.filter(s => s.status === 'active' && s.role === 'driver');

  const statusColors = {
    present: 'bg-green-500/20 text-green-300',
    late: 'bg-yellow-500/20 text-yellow-300',
    ncns: 'bg-red-500/20 text-red-300',
    called_out: 'bg-orange-500/20 text-orange-300',
    scheduled: 'bg-blue-500/20 text-blue-300',
    completed: 'bg-slate-500/20 text-slate-400',
    in_progress: 'bg-yellow-500/20 text-yellow-300',
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Schedule</h1>
        {['manager', 'dispatcher', 'admin'].includes(user?.role) && (
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> Add Shift
          </button>
        )}
      </div>

      {/* Week navigator */}
      <div className="card flex items-center justify-between py-3">
        <button className="btn-ghost" onClick={() => setWeekStart(d => addDays(d, -7))}>
          <ChevronLeft size={18} />
        </button>
        <h2 className="font-semibold text-slate-200">
          {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
        </h2>
        <button className="btn-ghost" onClick={() => setWeekStart(d => addDays(d, 7))}>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Grid */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-surface-border">
              <th className="text-left px-4 py-3 text-slate-400 font-medium w-40">Driver</th>
              {days.map(d => (
                <th key={d.toISOString()} className={`text-center px-2 py-3 text-slate-400 font-medium ${format(d, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') ? 'text-primary' : ''}`}>
                  <p className="text-xs">{format(d, 'EEE')}</p>
                  <p className={`text-base font-bold ${format(d, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') ? 'text-primary' : 'text-slate-200'}`}>{format(d, 'd')}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-500">Loading schedule…</td></tr>
            ) : weekStaff.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-500">No drivers found</td></tr>
            ) : weekStaff.map(s => (
              <tr key={s.id} className="table-row">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-200">{s.first_name} {s.last_name}</p>
                  <p className="text-xs text-slate-500">{s.employee_id}</p>
                </td>
                {days.map(d => {
                  const dateStr = format(d, 'yyyy-MM-dd');
                  const shift = shiftMap[`${s.id}-${dateStr}`];
                  return (
                    <td key={dateStr} className="px-2 py-2 text-center">
                      {shift ? (
                        <div className={`rounded-lg px-2 py-1.5 text-xs group relative ${statusColors[shift.attendance_status || shift.status] || 'bg-blue-500/20 text-blue-300'}`}>
                          <p className="font-semibold">{shift.start_time?.slice(0,5)}–{shift.end_time?.slice(0,5)}</p>
                          <p className="capitalize opacity-70">{shift.attendance_status || shift.status}</p>
                          {['manager', 'dispatcher', 'admin'].includes(user?.role) && (
                            <button
                              onClick={() => deleteMutation.mutate(shift.id)}
                              className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full hidden group-hover:flex items-center justify-center"
                            >
                              <Trash2 size={8} className="text-white" />
                            </button>
                          )}
                        </div>
                      ) : (
                        ['manager', 'dispatcher', 'admin'].includes(user?.role) ? (
                          <button
                            onClick={() => { setForm(f => ({ ...f, staff_id: s.id, shift_date: dateStr })); setShowModal(true); }}
                            className="w-full h-10 rounded-lg border border-dashed border-surface-border hover:border-primary hover:bg-primary/5 text-slate-600 hover:text-primary text-xs transition-all"
                          >+</button>
                        ) : <span className="text-slate-700">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(statusColors).map(([k, v]) => (
          <span key={k} className={`px-2 py-1 rounded-full ${v} capitalize`}>{k.replace('_', ' ')}</span>
        ))}
      </div>

      {/* Add Shift Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Shift">
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); createMutation.mutate(form); }}>
          <div>
            <label className="label">Driver</label>
            <select className="select" value={form.staff_id} onChange={e => setForm(f => ({ ...f, staff_id: e.target.value }))} required>
              <option value="">Select driver…</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.employee_id})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={form.shift_date} onChange={e => setForm(f => ({ ...f, shift_date: e.target.value }))} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Start Time</label>
              <input type="time" className="input" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} required />
            </div>
            <div>
              <label className="label">End Time</label>
              <input type="time" className="input" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} required />
            </div>
          </div>
          <div>
            <label className="label">Type</label>
            <select className="select" value={form.shift_type} onChange={e => setForm(f => ({ ...f, shift_type: e.target.value }))}>
              <option value="regular">Regular</option>
              <option value="overtime">Overtime</option>
              <option value="split">Split</option>
            </select>
          </div>
          <div>
            <label className="label">Notes</label>
            <input type="text" className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setShowModal(false)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Saving…' : 'Create Shift'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
