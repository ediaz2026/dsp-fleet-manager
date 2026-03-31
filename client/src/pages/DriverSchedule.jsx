import { useState, useMemo, useEffect, useRef, Component } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek, addDays, addWeeks } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar, X, Smartphone, Package, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { resolveColor, buildShiftTypeMap } from '../utils/shiftColors';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8 text-center">
          <p className="text-[#EF4444] font-semibold mb-1">Something went wrong loading your schedule.</p>
          <p className="text-sm text-[#94A3B8]">Please refresh the page. If the problem continues, contact your dispatcher.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Attendance pill styles
const ATT_BADGE = {
  present:    { label: 'Present',     bg: '#DCFCE7', color: '#15803D', border: '#BBF7D0' },
  late:       { label: 'Late',        bg: '#FEF3C7', color: '#B45309', border: '#FDE68A' },
  ncns:       { label: 'NCNS',        bg: '#FEE2E2', color: '#B91C1C', border: '#FECACA' },
  called_out: { label: 'Called Out',  bg: '#FEF9C3', color: '#A16207', border: '#FEF08A' },
};

// Bag color → CSS styles
const BAG_COLORS = {
  orange:  { bg: '#FFF3E0', border: '#FFB74D', text: '#E65100' },
  green:   { bg: '#E8F5E9', border: '#66BB6A', text: '#1B5E20' },
  navy:    { bg: '#E3F2FD', border: '#64B5F6', text: '#0D47A1' },
  blue:    { bg: '#E3F2FD', border: '#64B5F6', text: '#0D47A1' },
  yellow:  { bg: '#FFFDE7', border: '#FDD835', text: '#F57F17' },
  black:   { bg: '#F5F5F5', border: '#BDBDBD', text: '#212121' },
  red:     { bg: '#FFEBEE', border: '#EF5350', text: '#B71C1C' },
  purple:  { bg: '#F3E5F5', border: '#BA68C8', text: '#6A1B9A' },
  white:   { bg: '#FAFAFA', border: '#E0E0E0', text: '#424242' },
};
const DEFAULT_BAG_STYLE = { bg: '#F8FAFC', border: '#E2E8F0', text: '#475569' };

function getBagStyle(color) {
  if (!color) return DEFAULT_BAG_STYLE;
  return BAG_COLORS[color.toLowerCase()] || DEFAULT_BAG_STYLE;
}

function fmt12(time) {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── PWA Install Banner ──────────────────────────────────────────────────────
function PwaInstallBanner() {
  const [show, setShow] = useState(false);
  const deferredPrompt = useRef(null);

  useEffect(() => {
    if (localStorage.getItem('pwa_banner_dismissed')) return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (window.navigator.standalone === true) return;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile) return;
    setShow(true);
    const handler = (e) => { e.preventDefault(); deferredPrompt.current = e; };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => { setShow(false); localStorage.setItem('pwa_banner_dismissed', '1'); };
  if (!show) return null;

  return (
    <div className="mb-3 flex items-center gap-2 bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl px-3 py-2.5">
      <Smartphone size={16} className="text-[#2563EB] flex-shrink-0" />
      <p className="text-sm text-[#1E40AF] flex-1">Add to your home screen for quick access</p>
      <button onClick={dismiss} className="p-1 rounded-lg text-[#93C5FD] hover:text-[#2563EB] hover:bg-[#DBEAFE] transition-colors flex-shrink-0" aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}

// ─── Today's Pick List Component ─────────────────────────────────────────────
function TodaysPickList({ userId }) {
  const { data: pickList, isLoading } = useQuery({
    queryKey: ['my-picklist', userId],
    queryFn: () => api.get('/ops/my-picklist').then(r => r.data),
    enabled: !!userId,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000, // Auto-refresh every 60s so it unlocks automatically
  });

  if (isLoading) return (
    <div className="mt-4 rounded-xl border border-[#E2E8F0] bg-white p-4 text-center text-[#94a3b8]">Loading pick list…</div>
  );
  if (!pickList) return (
    <div className="mt-4 rounded-xl border border-[#E2E8F0] bg-white p-5 text-center">
      <Package size={28} className="mx-auto text-[#CBD5E1] mb-2" />
      <p className="text-sm text-[#94a3b8]">No pick list uploaded yet for today. Check back later.</p>
    </div>
  );

  // ── Locked state ──────────────────────────────────────────────
  if (pickList.locked) return (
    <div className="mt-5">
      <h2 className="text-base font-bold text-[#111827] mb-3 flex items-center gap-2">
        📦 Today's Pick List
      </h2>
      <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-8 text-center">
        <Lock size={36} className="mx-auto text-[#94a3b8] mb-3" />
        <p className="font-bold text-[#374151] text-lg mb-1">Pick List Locked</p>
        <p className="text-sm text-[#6B7280]">
          Your pick list will be available at <span className="font-bold text-[#2563EB]">{pickList.available_at}</span>
        </p>
        <p className="text-xs text-[#94a3b8] mt-2">
          Check back then to see your bag-by-bag loading details
        </p>
      </div>
    </div>
  );

  const { route_code, wave_time, bags, overflow, total_packages, commercial_packages, bag_details = [] } = pickList;

  return (
    <div className="mt-5">
      <h2 className="text-base font-bold text-[#111827] mb-3 flex items-center gap-2">
        📦 Today's Pick List
      </h2>

      <div className="rounded-xl border border-[#E2E8F0] overflow-hidden bg-white">
        {/* ── Sticky header with totals ──────────────────────────────── */}
        <div className="sticky top-0 z-10 bg-[#1E3A5F] text-white px-4 py-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-base">📍 {route_code}</span>
            <span className="text-sm font-semibold text-blue-200">🌊 {wave_time || '—'}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
            <span>🛍️ <strong>{bags}</strong> bags{overflow > 0 ? <span className="text-amber-300"> + {overflow} overflow</span> : ''}</span>
            <span>📬 <strong>{total_packages}</strong> pkgs{commercial_packages > 0 ? <span className="text-cyan-300"> · {commercial_packages} commercial</span> : ''}</span>
          </div>
        </div>

        {/* ── Bag details ────────────────────────────────────────────── */}
        {bag_details.length > 0 ? (
          <div className="divide-y divide-[#F1F5F9]">
            {bag_details.map((b, i) => {
              const style = getBagStyle(b.color);
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 px-4 min-h-[48px]"
                  style={{ backgroundColor: style.bg, borderLeft: `4px solid ${style.border}` }}
                >
                  <span className="font-bold text-base w-8 text-center" style={{ color: style.text }}>
                    {b.bag}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm" style={{ color: style.text }}>{b.zone}</span>
                    <span className="text-xs text-[#94a3b8] ml-2">{b.color}</span>
                    {b.code && <span className="text-xs text-[#94a3b8] ml-1">· {b.code}</span>}
                  </div>
                  <span className="font-bold text-sm whitespace-nowrap" style={{ color: style.text }}>
                    {b.pkgs} pkgs
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-[#94a3b8]">
            Bag details will appear here once the pick list format is parsed.
          </div>
        )}

        {/* ── Overflow section ───────────────────────────────────────── */}
        {overflow > 0 && (
          <div className="border-t border-[#E2E8F0] bg-[#FFFBEB] px-4 py-3">
            <p className="font-bold text-sm text-[#92400E]">
              📦 Overflow: {overflow} package{overflow !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-[#B45309] mt-0.5">
              These are loaded separately — check staging area
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main schedule ───────────────────────────────────────────────────────────
function DriverScheduleInner() {
  const { user } = useAuth();
  const [weekOffset, setWeekOffset] = useState(0);
  const todayRowRef = useRef(null);

  const weekStart  = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 0 });
  const weekEnd    = addDays(weekStart, 6);
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr   = format(weekEnd,   'yyyy-MM-dd');

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
    queryFn: () => api.get('/schedule/shift-types').then(r => r.data),
  });

  const shiftTypeMap = useMemo(() => buildShiftTypeMap(shiftTypes), [shiftTypes]);

  const today = format(new Date(), 'yyyy-MM-dd');

  // Check if driver has a shift today (for pick list section)
  const hasTodayShift = shifts.some(s => {
    const d = s.shift_date?.split('T')[0] || s.shift_date;
    return d === today;
  });

  // Group shifts by date
  const byDate = {};
  shifts.forEach(s => {
    const d = s.shift_date?.split('T')[0] || s.shift_date;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(s);
  });

  // Scroll to today on mount (current week only)
  useEffect(() => {
    if (weekOffset === 0 && todayRowRef.current) {
      todayRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [weekOffset, isLoading]);

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-2xl mx-auto">

      {/* ── PWA Install Banner ──────────────────────────────────────────────── */}
      <PwaInstallBanner />

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 sm:mb-5">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-[#111827]">My Schedule</h1>
          <p className="text-xs sm:text-sm text-[#6B7280] mt-0.5 truncate">Week of {weekLabel}</p>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
          <button
            onClick={() => setWeekOffset(o => o - 1)}
            className="p-2.5 sm:p-2 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#374151] transition-colors active:bg-[#F1F5F9]"
            aria-label="Previous week"
          >
            <ChevronLeft size={18} className="sm:w-[15px] sm:h-[15px]" />
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            className={`px-3 py-2 sm:py-1.5 rounded-lg border text-xs font-semibold transition-colors active:scale-95 ${
              weekOffset === 0
                ? 'bg-[#2563EB] border-[#2563EB] text-white'
                : 'bg-white border-[#E2E8F0] text-[#374151] hover:bg-[#F8FAFC]'
            }`}
          >
            This Week
          </button>
          <button
            onClick={() => setWeekOffset(o => o + 1)}
            className="p-2.5 sm:p-2 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#374151] transition-colors active:bg-[#F1F5F9]"
            aria-label="Next week"
          >
            <ChevronRight size={18} className="sm:w-[15px] sm:h-[15px]" />
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

            const rowHex = isScheduled
              ? resolveColor(shiftTypeMap[dayShifts[0].shift_type]?.color)
              : null;

            const rowStyle = {
              backgroundColor: isScheduled ? rowHex + '14' : '#ffffff',
              borderLeft: isScheduled
                ? `4px solid ${rowHex}`
                : isToday
                  ? '4px solid #2563EB'
                  : '4px solid transparent',
              boxShadow: isToday ? 'inset 0 2px 0 #BFDBFE, inset 0 -2px 0 #BFDBFE' : 'none',
            };

            return (
              <div
                key={i}
                ref={isToday ? todayRowRef : undefined}
                style={rowStyle}
                className="min-h-[64px] flex items-stretch"
              >
                <div className="flex flex-col sm:flex-row sm:items-center px-3 sm:px-4 py-3 gap-1.5 sm:gap-0 flex-1 min-w-0">

                  {/* ── Left: Day name + Date ───────────────────────────────── */}
                  <div className="flex items-center gap-2 sm:w-52 sm:flex-shrink-0">
                    <span className={`text-sm font-bold sm:hidden ${
                      isToday ? 'text-[#2563EB]' : 'text-[#111827]'
                    }`}>
                      {DAYS_SHORT[i]}
                    </span>
                    <span className={`text-sm font-bold w-24 hidden sm:inline ${
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
                      <span className="text-[9px] bg-[#2563EB] text-white px-1.5 py-0.5 rounded-full font-bold leading-none tracking-wide uppercase animate-pulse">
                        Today
                      </span>
                    )}
                  </div>

                  {/* ── Divider (desktop only) ─────────────────────────────── */}
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
                      <div className="flex flex-col gap-1.5">
                        {dayShifts.map(shift => {
                          const st      = shiftTypeMap[shift.shift_type];
                          const hex     = resolveColor(st?.color);
                          const att     = ATT_BADGE[shift.attendance_status];

                          return (
                            <div key={shift.id} className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-1 sm:gap-2">

                              {/* Shift type pill — bold and prominent */}
                              <span
                                className="text-xs font-extrabold px-2.5 py-1 rounded-full border leading-snug w-fit"
                                style={{
                                  backgroundColor: hex + '28',
                                  color:           hex,
                                  borderColor:     hex + '55',
                                }}
                              >
                                {shift.shift_type}
                              </span>

                              {/* Time range — on its own line on mobile */}
                              <span className="text-sm font-semibold text-[#374151]">
                                {fmt12(shift.start_time)}
                                {shift.start_time && shift.end_time && (
                                  <span className="text-[#9CA3AF] mx-1">–</span>
                                )}
                                {fmt12(shift.end_time)}
                              </span>

                              {/* Attendance pill */}
                              {att && shift.attendance_status !== 'present' && (
                                <span
                                  className="text-xs font-semibold px-2 py-0.5 rounded-full border leading-snug w-fit"
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

      {/* ── Today's Pick List ───────────────────────────────────────────────── */}
      {weekOffset === 0 && hasTodayShift && (
        <TodaysPickList userId={user?.id} />
      )}
    </div>
  );
}

export default function DriverSchedule() {
  return (
    <ErrorBoundary>
      <DriverScheduleInner />
    </ErrorBoundary>
  );
}
