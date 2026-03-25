import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

const STATUS_STYLE = {
  present:    'bg-green-100 text-green-700',
  late:       'bg-amber-100 text-amber-700',
  ncns:       'bg-red-100 text-red-700',
  called_out: 'bg-orange-100 text-orange-700',
  excused:    'bg-blue-100 text-blue-700',
  off:        'bg-slate-100 text-slate-500',
};

function getMonthRange(year, month) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const fmt = d => d.toISOString().split('T')[0];
  return { start: fmt(start), end: fmt(end) };
}

export default function DriverAttendance() {
  const { user } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const { start, end } = getMonthRange(year, month);
  const monthLabel = new Date(year, month, 1).toLocaleString('default', { month: 'long', year: 'numeric' });

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['my-attendance', user?.id, start, end],
    queryFn: () => api.get('/attendance', { params: { staff_id: user?.id, date_from: start, date_to: end } }).then(r => r.data),
    enabled: !!user?.id,
  });

  const prev = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const next = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  const counts = records.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
          <ClipboardCheck size={18} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">My Attendance</h1>
          <p className="text-sm text-slate-500">Your attendance records</p>
        </div>
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prev} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
          <ChevronLeft size={16} />
        </button>
        <span className="font-semibold text-slate-700 text-sm">{monthLabel}</span>
        <button onClick={next} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-5">
        {Object.entries(counts).map(([status, count]) => (
          <span key={status} className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${STATUS_STYLE[status] || 'bg-slate-100 text-slate-600'}`}>
            {status.replace('_', ' ')}: {count}
          </span>
        ))}
        {records.length === 0 && !isLoading && (
          <span className="text-xs text-slate-400">No records for this month</span>
        )}
      </div>

      {/* Records list */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {records.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">No attendance records found</div>
          ) : (
            records.map(r => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-700">
                    {new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                  {r.notes && <p className="text-xs text-slate-400 mt-0.5">{r.notes}</p>}
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${STATUS_STYLE[r.status] || 'bg-slate-100 text-slate-600'}`}>
                  {r.status?.replace('_', ' ') || 'unknown'}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
