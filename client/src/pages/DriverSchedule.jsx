import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek, addDays, addWeeks } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { resolveColor, buildShiftTypeMap } from '../utils/shiftColors';

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Attendance pill styles — spec: Late=orange, NCNS=red, Called Out=yellow
const ATT_BADGE = {
  present:    { label: 'Present',     bg: '#DCFCE7', color: '#15803D', border: '#BBF7D0' },
  late:       { label: 'Late',        bg: '#FEF3C7', color: '#B45309', border: '#FDE68A' },
  ncns:       { label: 'NCNS',        bg: '#FEE2E2', color: '#B91C1C', border: '#FECACA' },
  called_out: { label: 'Called Out',  bg: '#FEF9C3', color: '#A16207', border: '#FEF08A' },
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

  const weekStart  = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 0 });
  const weekEnd    = addDays(weekStart, 6);
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr   = format(weekEnd,   'yyyy-MM-dd');

  // "Week of Mar 22 – Mar 28, 2026"
  const weekLabel = `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`;

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['my-shifts', weekStartStr, user?.id],
    queryFn: () => api.get('/shifts', {
      params: { start: weekStartStr, end: weekEndStr, staff_id: user?.id },
    }).then(r => r.data),
    enabled: !!user?.id,
  });

  const { data: shiftTypes = [] } = useQuery({
    queryKey: ['shift-types'],
    queryFn: () => api.get('/shift-types').then(r => r.data),
  });

  const shiftTypeMap = useMemo(() => buildShiftTypeMap(shiftTypes), [shiftTypes]);

  const today = format(new Date(), 'yyyy-MM-dd');

  // Group shifts by date
  const byDate = {};
  shifts.forEach(s => {
    const d = s.shift_date?.split('T')[0] || s.shift_date;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(s);
  });

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-[#111827]">My Schedule</h1>
          <p className="text-sm text-[#6B7280] mt-0.5">Week of {weekLabel}</p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setWeekOffset(o => o - 1)}
            className="p-2 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#374151] transition-colors"
            aria-label="Previous week"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
              weekOffset === 0
                ? 'bg-[#2563EB] border-[#2563EB] text-white'
                : 'bg-white border-[#E2E8F0] text-[#374151] hover:bg-[#F8FAFC]'
            }`}
          >
            This Week
          </button>
          <button
            onClick={() => setWeekOffset(o => o + 1)}
            className="p-2 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#374151] transition-colors"
            aria-label="Next week"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* ── Day rows ────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex justify-center py-16 text-[#94a3b8]">Loading…</div>
      ) : (
        <div className="rounded-xl overflow-hidden border border-[#E2E8F0] divide-y divide-[#E2E8F0]">
          {Array.from({ length: 7 }, (_, i) => {
            const day         = addDays(weekStart, i);
            const dateStr     = format(day, 'yyyy-MM-dd');
            const dayShifts   = byDate[dateStr] || [];
            const isToday     = dateStr === today;
            const isScheduled = dayShifts.length > 0;

            // Row background: light tint of first shift's color, or white
            const rowHex = isScheduled
              ? resolveColor(shiftTypeMap[dayShifts[0].shift_type]?.color)
              : null;

            const rowStyle = {
              backgroundColor: isScheduled ? rowHex + '14' : '#ffffff',
              // Left accent bar: shift color if scheduled, blue if today+unscheduled, grey otherwise
              borderLeft: isScheduled
                ? `3px solid ${rowHex}`
                : isToday
                  ? '3px solid #2563EB'
                  : '3px solid transparent',
              // Today gets a subtle top/bottom highlight via box-shadow
              boxShadow: isToday ? 'inset 0 1px 0 #BFDBFE, inset 0 -1px 0 #BFDBFE' : 'none',
            };

            return (
              <div key={i} style={rowStyle}>
                {/*
                  Desktop: single row — [Day][Date][│][Status]
                  Mobile:  two lines — [Day Date] then [Status]
                */}
                <div className="flex flex-col sm:flex-row sm:items-center px-4 py-3 gap-1 sm:gap-0">

                  {/* ── Left: Day name + Date ───────────────────────────────── */}
                  <div className="flex items-baseline gap-2 sm:w-52 sm:flex-shrink-0">
                    <span className={`text-sm font-bold w-24 ${
                      isToday ? 'text-[#2563EB]' : 'text-[#111827]'
                    }`}>
                      {DAYS_FULL[i]}
                    </span>
                    <span className={`text-sm ${
                      isToday ? 'text-[#2563EB]' : 'text-[#6B7280]'
                    }`}>
                      {format(day, 'MMM d')}
                    </span>
                    {isToday && (
                      <span className="text-[9px] bg-[#2563EB] text-white px-1.5 py-0.5 rounded-full font-bold leading-none tracking-wide uppercase">
                        Today
                      </span>
                    )}
                  </div>

                  {/* ── Divider │ (desktop only) ─────────────────────────────── */}
                  <span
                    className="hidden sm:block text-[#D1D5DB] select-none mx-4 text-base"
                    aria-hidden="true"
                  >
                    │
                  </span>

                  {/* ── Right: Shift status ──────────────────────────────────── */}
                  <div className="flex-1 min-w-0">
                    {!isScheduled ? (
                      <span className="text-sm text-[#CBD5E1] font-medium">Day Off</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {dayShifts.map(shift => {
                          const st      = shiftTypeMap[shift.shift_type];
                          const hex     = resolveColor(st?.color);
                          const att     = ATT_BADGE[shift.attendance_status];

                          return (
                            <div key={shift.id} className="flex flex-wrap items-center gap-2">

                              {/* Shift type pill */}
                              <span
                                className="text-xs font-bold px-2.5 py-0.5 rounded-full border leading-snug"
                                style={{
                                  backgroundColor: hex + '28',
                                  color:           hex,
                                  borderColor:     hex + '55',
                                }}
                              >
                                {shift.shift_type}
                              </span>

                              {/* Time range */}
                              <span className="text-sm font-medium text-[#374151]">
                                {fmt12(shift.start_time)}
                                {shift.start_time && shift.end_time && (
                                  <span className="text-[#9CA3AF] mx-1">–</span>
                                )}
                                {fmt12(shift.end_time)}
                              </span>

                              {/* Attendance pill (only if not present) */}
                              {att && shift.attendance_status !== 'present' && (
                                <span
                                  className="text-xs font-semibold px-2 py-0.5 rounded-full border leading-snug"
                                  style={{
                                    backgroundColor: att.bg,
                                    color:           att.color,
                                    borderColor:     att.border,
                                  }}
                                >
                                  {att.label}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!isLoading && shifts.length === 0 && (
        <div className="mt-4 text-center py-12 bg-white border border-[#E2E8F0] rounded-xl">
          <Calendar size={36} className="mx-auto text-[#94a3b8] mb-3" />
          <p className="text-[#475569] font-medium">No shifts published for this week</p>
          <p className="text-sm text-[#94a3b8] mt-1">
            Check back once your manager publishes the schedule
          </p>
        </div>
      )}
    </div>
  );
}
