import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek, addDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { MapPin, Clock, Truck, Layers, Navigation, Info, Lock, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { usePushNotifications } from '../hooks/usePushNotifications';
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

export default function DriverToday() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { supported: pushSupported, permission: pushPermission, isSubscribed: pushSubscribed, subscribe: pushSubscribe, loading: pushLoading } = usePushNotifications();
  const [pushDismissed, setPushDismissed] = useState(false);
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

  // Briefing release status
  const { data: briefingStatus } = useQuery({
    queryKey: ['briefing-status'],
    queryFn: () => api.get('/ops/briefing-status').then(r => r.data),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
  const briefingReleased = briefingStatus?.released !== false;

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`;
  const [showBags, setShowBags] = useState(false);

  // Pick list data
  const plLocked = pickList?.locked;
  const plData = pickList && !pickList.locked ? pickList : null;

  return (
      <div className="bg-[#F1F5F9]" style={{ paddingTop: 0, marginTop: 0 }}>
        {/* ── HEADER ────────────────────────────────── */}
        <div style={{
          background: '#1a2e4a',
          paddingTop: 'max(env(safe-area-inset-top), 0px)',
          paddingBottom: '20px',
          marginBottom: '20px',
          borderBottomLeftRadius: '24px',
          borderBottomRightRadius: '24px',
        }}>
          {/* Single row: Logo | Date | Avatar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{
              background: 'white',
              clipPath: 'polygon(0 0, 100% 0, 82% 100%, 0 100%)',
              paddingLeft: '14px', paddingRight: '52px',
              paddingTop: '10px', paddingBottom: '10px',
              display: 'inline-flex', alignItems: 'center', flexShrink: 0,
            }}>
              <img src="https://res.cloudinary.com/dbplnigog/image/upload/v1776289023/Screenshot_2026-04-15_at_5.29.06_PM_weocsl.png"
                alt="Last Mile DSP" style={{ height: '44px', width: 'auto', objectFit: 'contain' }} />
            </div>
            <div style={{ flex: 1, textAlign: 'center', padding: '0 8px' }}>
              <span style={{
                color: 'rgba(255,255,255,0.9)', fontSize: '12px', fontWeight: '500', whiteSpace: 'nowrap',
              }}>
                {format(new Date(), 'EEEE, MMMM d')}
              </span>
            </div>
            <div style={{ paddingRight: '14px', flexShrink: 0 }}>
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold text-white">
                {initials}
              </div>
            </div>
          </div>

          {/* Good morning message */}
          <div style={{ paddingLeft: '16px', paddingTop: '14px' }}>
            <h1 className="text-2xl font-bold text-white">{getGreeting()}, {titleCase(user?.firstName)}!</h1>
          </div>
        </div>

        <div className="px-4 -mt-4 space-y-4">

          {/* ── Push notification opt-in ─────────────────────────────── */}
          {pushSupported && pushPermission === 'default' && !pushDismissed && (
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div style={{ fontSize: '24px' }}>🔔</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a2e4a' }}>Enable Notifications</div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Get alerts for schedule changes, scorecard updates & more</div>
              </div>
              <button onClick={async () => { await pushSubscribe(); }} disabled={pushLoading}
                style={{ padding: '7px 14px', background: '#1a2e4a', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', opacity: pushLoading ? 0.6 : 1 }}>
                {pushLoading ? '...' : 'Turn On'}
              </button>
              <button onClick={() => setPushDismissed(true)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}>✕</button>
            </div>
          )}
          {pushSubscribed && !pushDismissed && (
            <div style={{ textAlign: 'center', fontSize: '11px', color: '#16a34a', marginBottom: '8px' }}>✓ Notifications enabled</div>
          )}

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

          {/* ── Briefing locked state ──────────────────────────────────── */}
          {!briefingReleased && (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="bg-[#1a3a5c] px-4 py-3">
                <p className="text-white font-bold text-sm">Today's Assignment</p>
              </div>
              <div className="p-8 text-center">
                <Lock size={36} className="mx-auto text-slate-300 mb-3" />
                <p className="font-bold text-[#374151] text-lg mb-1">Briefing Locked</p>
                <p className="text-sm text-[#6B7280]">
                  Your briefing will be available at <span className="font-bold text-[#2563EB]">{briefingStatus?.release_time || '6:00 AM'}</span>
                </p>
                <p className="text-xs text-[#94a3b8] mt-2">Check back then for your route, vehicle and pick list details</p>
              </div>
            </div>
          )}

          {/* ── Today's Assignment (released) ────────────────────────────── */}
          {briefingReleased && <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
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
          </div>}

          {/* ── Pick List ──────────────────────────────────────────────── */}
          {briefingReleased && <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
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
          </div>}

          {/* ── Report Vehicle Issue ────────────────────────────────────── */}
          {assignment && (
            <button onClick={() => navigate('/driver/report-issue')} className="w-full bg-orange-50 border border-orange-200 rounded-2xl p-4 flex items-center gap-3 hover:bg-orange-100 transition-colors text-left">
              <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={18} className="text-orange-600" />
              </div>
              <div>
                <p className="font-semibold text-orange-800 text-sm">Report a Vehicle Issue</p>
                <p className="text-xs text-orange-600">Tap to report a problem with your vehicle</p>
              </div>
            </button>
          )}

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
  );
}

const BAG_BG = {
  orange: '#FFF3E0', green: '#E8F5E9', navy: '#E3F2FD', blue: '#E3F2FD',
  yellow: '#FFFDE7', black: '#F5F5F5', red: '#FFEBEE', purple: '#F3E5F5', white: '#FAFAFA',
};
