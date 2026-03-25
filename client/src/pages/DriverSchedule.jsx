import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek, addDays, addWeeks, subWeeks } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const SHIFT_COLORS = {
  'EDV':        'bg-blue-100 text-blue-800 border-blue-200',
  'STEP VAN':   'bg-indigo-100 text-indigo-800 border-indigo-200',
  'ON CALL':    'bg-yellow-100 text-amber-800 border-yellow-200',
  'EXTRA':      'bg-green-100 text-green-800 border-green-200',
  'SUSPENSION': 'bg-red-100 text-red-800 border-red-200',
  'UTO':        'bg-purple-100 text-purple-800 border-purple-200',
  'PTO':        'bg-teal-100 text-teal-800 border-teal-200',
  'TRAINING':   'bg-orange-100 text-orange-800 border-orange-200',
  'HELPER':     'bg-amber-100 text-amber-800 border-amber-200',
};

const ATTENDANCE_LABELS = {
  present:    { label: 'Present',    color: 'text-green-700' },
  called_out: { label: 'Called Out', color: 'text-red-600' },
  ncns:       { label: 'NCNS',       color: 'text-red-800' },
  late:       { label: 'Late',       color: 'text-amber-600' },
};

function fmt12(time) {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function DriverSchedule() {
  const { user } = useAuth();
  const [weekOffset, setWeekOffset] = useState(0);

  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 0 });
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr = format(addDays(weekStart, 6), 'yyyy-MM-dd');

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['my-shifts', weekStartStr, user?.id],
    queryFn: () => api.get('/shifts', {
      params: { start: weekStartStr, end: weekEndStr, staff_id: user?.id }
    }).then(r => r.data),
    enabled: !!user?.id,
  });

  const today = format(new Date(), 'yyyy-MM-dd');

  // Group shifts by date
  const byDate = {};
  shifts.forEach(s => {
    const d = s.shift_date?.split('T')[0] || s.shift_date;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(s);
  });

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">My Schedule</h1>
          <p className="text-sm text-[#475569] mt-0.5">
            Week of {format(weekStart, 'MMMM d, yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset(o => o - 1)}
            className="p-2 rounded-lg border border-[#E2E8F0] bg-white hover:bg-blue-50 text-[#374151] transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            className="px-3 py-1.5 rounded-lg border border-[#E2E8F0] bg-white text-sm text-[#374151] hover:bg-blue-50 transition-colors"
          >
            This Week
          </button>
          <button
            onClick={() => setWeekOffset(o => o + 1)}
            className="p-2 rounded-lg border border-[#E2E8F0] bg-white hover:bg-blue-50 text-[#374151] transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-[#94a3b8]">Loading…</div>
      ) : (
        <div className="space-y-3">
          {Array.from({ length: 7 }, (_, i) => {
            const day = addDays(weekStart, i);
            const dateStr = format(day, 'yyyy-MM-dd');
            const dayShifts = byDate[dateStr] || [];
            const isToday = dateStr === today;

            return (
              <div
                key={i}
                className={`bg-white border rounded-xl p-4 ${
                  isToday ? 'border-[#2563EB] shadow-sm' : 'border-[#E2E8F0]'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-[80px]">
                    <p className={`text-sm font-semibold ${isToday ? 'text-[#2563EB]' : 'text-[#374151]'}`}>
                      {DAYS[i]}
                    </p>
                    <p className={`text-lg font-bold leading-tight ${isToday ? 'text-[#2563EB]' : 'text-[#111827]'}`}>
                      {format(day, 'MMM d')}
                    </p>
                    {isToday && (
                      <span className="text-[10px] bg-[#2563EB] text-white px-1.5 py-0.5 rounded-full font-semibold">
                        TODAY
                      </span>
                    )}
                  </div>

                  <div className="flex-1">
                    {dayShifts.length === 0 ? (
                      <p className="text-sm text-[#94a3b8] py-1">No shift scheduled</p>
                    ) : (
                      dayShifts.map(shift => {
                        const attInfo = ATTENDANCE_LABELS[shift.attendance_status];
                        return (
                          <div key={shift.id} className="flex flex-wrap items-center gap-2">
                            <span className={`badge border text-xs ${SHIFT_COLORS[shift.shift_type] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                              {shift.shift_type}
                            </span>
                            <span className="text-sm text-[#374151]">
                              {fmt12(shift.start_time)} – {fmt12(shift.end_time)}
                            </span>
                            {attInfo && (
                              <span className={`text-xs font-medium ${attInfo.color}`}>
                                · {attInfo.label}
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && shifts.length === 0 && (
        <div className="mt-6 text-center py-12 bg-white border border-[#E2E8F0] rounded-xl">
          <Calendar size={36} className="mx-auto text-[#94a3b8] mb-3" />
          <p className="text-[#475569] font-medium">No shifts published for this week</p>
          <p className="text-sm text-[#94a3b8] mt-1">Check back once your manager publishes the schedule</p>
        </div>
      )}
    </div>
  );
}
