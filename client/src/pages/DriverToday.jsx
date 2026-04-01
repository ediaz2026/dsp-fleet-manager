import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek, addDays } from 'date-fns';
import { useNavigate, useLocation } from 'react-router-dom';
import { MapPin, Clock, Truck, Package, Layers, Navigation, Info, Lock, CalendarDays, Calendar, ClipboardCheck, Star } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { resolveColor, buildShiftTypeMap } from '../utils/shiftColors';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function titleCase(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

const DAYS = ['S','M','T','W','T','F','S'];

// Bottom tab bar for driver portal
function BottomTabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const tabs = [
    { to: '/today', icon: CalendarDays, label: 'Today' },
    { to: '/my-schedule', icon: Calendar, label: 'Schedule' },
    { to: '/my-attendance', icon: ClipboardCheck, label: 'Attendance' },
    { to: '/my-scorecard', icon: Star, label: 'Scorecard' },
  ];
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 px-2 pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around max-w-lg mx-auto">
        {tabs.map(t => {
          const active = location.pathname === t.to;
          return (
            <button
              key={t.to}
              onClick={() => navigate(t.to)}
              className={`flex flex-col items-center gap-0.5 py-2 px-3 min-w-[60px] transition-colors ${active ? 'text-[#1a3a5c]' : 'text-slate-400'}`}
            >
              <t.icon size={20} strokeWidth={active ? 2.5 : 1.5} />
              <span className={`text-[10px] font-semibold ${active ? 'text-[#1a3a5c]' : 'text-slate-400'}`}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DriverToday() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = format(new Date(), 'yyyy-MM-dd');
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 0 });

  // ── Data queries ──────────────────────────────────────────────────
  const { data: assignment } = useQuery({
    queryKey: ['my-assignment'],
    queryFn: () => api.get('/ops/my-assignment').then(r => r.data),
    staleTime: 2 * 60 * 1000,
  });

  const { data: pickList } = useQuery({
    queryKey: ['my-picklist', user?.id],
    queryFn: () => api.get('/ops/my-picklist').then(r => r.data),
    staleTime: 2 * 60 * 1000,
  });

  const { data: announcements = [] } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api.get('/announcements').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr = format(addDays(weekStart, 6), 'yyyy-MM-dd');
  const { data: shifts = [] } = useQuery({
    queryKey: ['my-shifts', weekStartStr, user?.id],
    queryFn: () => api.get('/shifts', { params: { start: weekStartStr, end: weekEndStr, staff_id: user?.id } }).then(r => r.data),
    enabled: !!user?.id,
  });

  const { data: shiftTypes = [] } = useQuery({
    queryKey: ['shift-types'],
    queryFn: () => api.get('/schedule/shift-types').then(r => r.data),
  });

  const shiftTypeMap = useMemo(() => buildShiftTypeMap(shiftTypes), [shiftTypes]);

  // Build week data
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStart, i);
    const dateStr = format(day, 'yyyy-MM-dd');
    const shift = shifts.find(s => (s.shift_date?.split('T')[0] || s.shift_date) === dateStr);
    return { day, dateStr, shift, isToday: dateStr === today };
  });

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`;
  const [showBags, setShowBags] = useState(false);

  // Pick list data
  const plLocked = pickList?.locked;
  const plData = pickList && !pickList.locked ? pickList : null;

  return (
    <>
      <div className="min-h-screen bg-[#F1F5F9] pb-24" style={{ paddingTop: 0, marginTop: 0 }}>
        {/* ── Header — flush to top, no gap ───────────────────────────── */}
        <div className="bg-[#1a3a5c] text-white px-5 pt-[max(env(safe-area-inset-top),20px)] pb-8 rounded-b-3xl">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-blue-200 font-medium">{format(new Date(), 'EEEE, MMMM d')}</p>
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
              {initials}
            </div>
          </div>
          <h1 className="text-2xl font-bold">{getGreeting()}, {titleCase(user?.firstName)}!</h1>
        </div>

        <div className="px-4 -mt-4 space-y-4">

          {/* ── Announcements ──────────────────────────────────────────── */}
          {announcements.length > 0 && (
            <div className="space-y-3 mb-4">
              {announcements.map(a => (
                <div key={a.id} className="bg-blue-50 border-l-4 border-blue-400 rounded-xl p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-blue-600 mb-1">Announcement</p>
                  <p className="text-sm text-blue-900">{a.message}</p>
                </div>
              ))}
            </div>
          )}

          {/* ── Today's Assignment ──────────────────────────────────────── */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-[#1a3a5c] px-4 py-3">
              <p className="text-white font-bold text-sm">Today's Assignment</p>
            </div>
            {assignment ? (
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[#F8FAFC] rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <MapPin size={13} className="text-slate-400" />
                      <p className="text-[10px] font-semibold text-slate-400 uppercase">Route</p>
                    </div>
                    <p className="text-xl font-bold text-[#111827]">{assignment.route_code || '—'}</p>
                  </div>
                  <div className="bg-[#F8FAFC] rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Clock size={13} className="text-slate-400" />
                      <p className="text-[10px] font-semibold text-slate-400 uppercase">Wave Time</p>
                    </div>
                    <p className="text-xl font-bold text-[#111827]">{assignment.wave_time || '—'}</p>
                  </div>
                  <div className="bg-[#F8FAFC] rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Layers size={13} className="text-slate-400" />
                      <p className="text-[10px] font-semibold text-slate-400 uppercase">Staging</p>
                    </div>
                    <p className="text-lg font-bold text-[#111827]">{assignment.staging || '—'}</p>
                  </div>
                  <div className="bg-[#F8FAFC] rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Navigation size={13} className="text-slate-400" />
                      <p className="text-[10px] font-semibold text-slate-400 uppercase">Canopy</p>
                    </div>
                    <p className={`text-lg font-bold ${assignment.canopy === 'SOUTH' ? 'text-amber-600' : 'text-blue-600'}`}>
                      {assignment.canopy || '—'}
                    </p>
                  </div>
                </div>
                {/* Vehicle */}
                <div className="bg-[#F8FAFC] rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Truck size={16} className="text-slate-400" />
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase">Vehicle</p>
                      <p className="text-lg font-bold text-[#111827]">{assignment.vehicle_name || '—'}</p>
                    </div>
                  </div>
                  {assignment.vehicle_name && (
                    <span className="text-[10px] font-bold uppercase bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Assigned</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-6 text-center">
                <p className="text-sm text-slate-400">No route assigned yet — check back later</p>
              </div>
            )}
          </div>

          {/* ── Pick List ──────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <button
              className="w-full bg-[#166534] px-4 py-3 flex items-center justify-between"
              onClick={() => plData && setShowBags(v => !v)}
            >
              <p className="text-white font-bold text-sm">Pick List</p>
              {plData && <span className="text-green-200 text-xs font-semibold">{showBags ? 'Hide' : 'View'} details ›</span>}
            </button>
            {plLocked ? (
              <div className="p-6 text-center">
                <Lock size={24} className="mx-auto text-slate-300 mb-2" />
                <p className="text-sm font-semibold text-slate-500">Pick list not available yet</p>
                <p className="text-xs text-slate-400 mt-1">Available at {pickList.available_at}</p>
              </div>
            ) : plData ? (
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-[#F8FAFC] rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-[#111827]">{plData.bags}</p>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase">Bags</p>
                  </div>
                  <div className="bg-[#F8FAFC] rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-[#111827]">{plData.total_packages}</p>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase">Packages</p>
                  </div>
                  <div className={`rounded-xl p-3 text-center ${plData.overflow > 0 ? 'bg-orange-50' : 'bg-[#F8FAFC]'}`}>
                    <p className={`text-2xl font-bold ${plData.overflow > 0 ? 'text-orange-600' : 'text-[#111827]'}`}>{plData.overflow}</p>
                    <p className={`text-[10px] font-semibold uppercase ${plData.overflow > 0 ? 'text-orange-500' : 'text-slate-400'}`}>Overflow</p>
                  </div>
                </div>
                {plData.commercial_packages > 0 && (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <Info size={13} className="text-amber-500 flex-shrink-0" />
                    <p className="text-xs text-amber-700">{plData.commercial_packages} commercial packages — check staging area</p>
                  </div>
                )}
                {showBags && (plData.bag_details?.length > 0 || plData.overflow_details?.length > 0) && (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    {(plData.bag_details || []).map((b, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 min-h-[44px] border-b border-slate-100 last:border-0"
                        style={{ backgroundColor: BAG_BG[b.color?.toLowerCase()] || '#F8FAFC' }}>
                        <span className="font-bold text-sm w-6 text-center text-slate-700">{b.bag}</span>
                        <span className="font-semibold text-sm text-slate-700 flex-1">{b.zone}</span>
                        <span className="text-xs text-slate-400">{b.color}</span>
                        <span className="font-bold text-sm text-slate-700">{b.pkgs}</span>
                      </div>
                    ))}
                    {(plData.overflow_details || []).map((b, i) => (
                      <div key={`ov-${i}`} className="flex items-center gap-3 px-3 min-h-[44px] border-b border-amber-100 last:border-0 bg-amber-50">
                        <span className="font-bold text-sm w-6 text-center text-amber-700">{b.bag}</span>
                        <span className="font-semibold text-sm text-amber-700 flex-1">{b.zone}</span>
                        <span className="text-xs text-amber-500">Overflow</span>
                        <span className="font-bold text-sm text-amber-700">{b.pkgs}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center">
                <p className="text-sm text-slate-400">Pick list not available yet</p>
              </div>
            )}
          </div>

          {/* ── This Week ──────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between">
              <p className="font-bold text-sm text-[#111827]">This Week</p>
              <button onClick={() => navigate('/my-schedule')} className="text-xs text-blue-600 font-semibold">View full ›</button>
            </div>
            <div className="px-4 pb-4 flex justify-between">
              {weekDays.map((wd, i) => {
                const hasShift = !!wd.shift;
                const hex = hasShift ? resolveColor(shiftTypeMap[wd.shift.shift_type]?.color) : null;
                const abbr = wd.shift?.shift_type?.slice(0, 3).toUpperCase() || '';
                return (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <span className="text-[10px] font-semibold text-slate-400">{DAYS[i]}</span>
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-[10px] font-bold
                        ${wd.isToday ? 'bg-[#1a3a5c] text-white ring-2 ring-blue-300' :
                          hasShift ? 'text-white' : 'bg-slate-100 text-slate-300'}`}
                      style={hasShift && !wd.isToday ? { backgroundColor: hex } : {}}
                    >
                      {wd.isToday ? 'NOW' : hasShift ? abbr : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Tab Bar ──────────────────────────────────────────── */}
      <BottomTabBar />
    </>
  );
}

const BAG_BG = {
  orange: '#FFF3E0', green: '#E8F5E9', navy: '#E3F2FD', blue: '#E3F2FD',
  yellow: '#FFFDE7', black: '#F5F5F5', red: '#FFEBEE', purple: '#F3E5F5', white: '#FAFAFA',
};
