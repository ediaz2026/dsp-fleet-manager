import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Bell, LogOut, User, LayoutDashboard, Calendar, ClipboardCheck,
  DollarSign, Car, Users, Search, Cpu, Settings,
  ChevronDown, Star, Lock, AlertTriangle, X, BarChart2, Check, CalendarDays,
} from 'lucide-react';
import companyLogo from '../assets/logo.png';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { formatDistanceToNow } from 'date-fns';

// ─── Dropdown group config ────────────────────────────────────────────────────
const navGroups = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true, mgmtOnly: true },
  { to: '/schedule', icon: Calendar, label: 'Schedule', mgmtOnly: true },
  { to: '/drivers', icon: Users, label: 'Drivers', mgmtOnly: true },
  { to: '/vehicles', icon: Car, label: 'Fleet', mgmtOnly: true },
  { to: '/scorecard', icon: Star, label: 'Scorecard' },
  { to: '/attendance', icon: ClipboardCheck, label: 'Attendance', adminOnly: true },
  { to: '/analytics', icon: BarChart2, label: 'Analytics', mgmtOnly: true },
  { to: '/payroll', icon: DollarSign, label: 'Payroll', adminOnly: true },
  { to: '/management', icon: Settings, label: 'Management', adminOnly: true },
];

const ROLE_BADGE = {
  admin:      'bg-red-500/20 text-red-200',
  manager:    'bg-blue-500/20 text-blue-200',
  dispatcher: 'bg-blue-500/20 text-blue-200',
  driver:     'bg-slate-500/20 text-slate-300',
};
const ROLE_LABEL = {
  admin: 'Admin',
  manager: 'Dispatcher',
  dispatcher: 'Dispatcher',
  driver: 'Driver',
};

// ─── Dropdown wrapper ─────────────────────────────────────────────────────────
function NavDropdown({ group }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const location = useLocation();

  const isChildActive = group.children.some(c => location.pathname.startsWith(c.to));

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
          isChildActive
            ? 'bg-[#2563EB] text-white font-semibold'
            : 'text-white/80 hover:text-white hover:bg-white/10'
        }`}
      >
        {group.label}
        <ChevronDown size={13} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5">
          {group.children.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-600 font-semibold'
                    : 'text-slate-600 hover:bg-blue-50 hover:text-blue-600'
                }`
              }
            >
              <item.icon size={15} />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main TopNav ──────────────────────────────────────────────────────────────
export default function TopNav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const userMenuRef = useRef();
  const alertsRef = useRef();

  // Persisted acknowledged alert IDs
  const [ackedAlerts, setAckedAlerts] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('dsp_acked_alerts') || '[]')); }
    catch { return new Set(); }
  });

  const isDriver = user?.role === 'driver';
  const isMgmt = ['manager', 'admin', 'dispatcher'].includes(user?.role);
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();

  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef();

  // Driver notification bell
  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => r.data),
    refetchInterval: 30000,
    enabled: isDriver,
  });
  const notifications = notifData?.notifications || [];
  const unreadCount   = notifData?.unread || 0;

  const markRead = useMutation({
    mutationFn: (id) => api.put(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAllRead = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['fleet-alerts'],
    queryFn: () => api.get('/vehicles/alerts').then(r => r.data),
    refetchInterval: 60000,
    enabled: !isDriver,
  });

  const { data: inactiveVehicles = [] } = useQuery({
    queryKey: ['inactive-vehicles'],
    queryFn: () => api.get('/vehicles', { params: { status: 'inactive' } }).then(r => r.data),
    refetchInterval: 120000,
    enabled: !isDriver,
  });

  // Build unified alert list
  const allAlerts = useMemo(() => {
    const result = [];
    alerts.forEach(a => result.push({
      id: `alert-${a.id || a.vehicle_id || Math.random()}`,
      type: 'alert',
      text: a.message || a.description || 'Vehicle alert',
    }));
    inactiveVehicles.forEach(v => result.push({
      id: `inactive-${v.id}`,
      type: 'inactive',
      text: `${[v.year, v.make, v.model].filter(Boolean).join(' ')}${v.plate ? ` (${v.plate})` : ''} is inactive`,
    }));
    return result;
  }, [alerts, inactiveVehicles]);

  const unackedCount = allAlerts.filter(a => !ackedAlerts.has(a.id)).length;

  const handleAck = (id) => {
    const next = new Set([...ackedAlerts, id]);
    setAckedAlerts(next);
    localStorage.setItem('dsp_acked_alerts', JSON.stringify([...next]));
  };

  const handleAckAll = () => {
    const next = new Set([...ackedAlerts, ...allAlerts.map(a => a.id)]);
    setAckedAlerts(next);
    localStorage.setItem('dsp_acked_alerts', JSON.stringify([...next]));
  };

  useEffect(() => {
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setShowUserMenu(false);
      if (alertsRef.current && !alertsRef.current.contains(e.target)) setShowAlerts(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifications(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Filter nav items based on role
  const visibleNavGroups = navGroups.filter(g => {
    if (g.adminOnly) return isAdmin;
    if (g.mgmtOnly) return isMgmt;
    return true;
  });

  // Drivers get a minimal nav
  const driverNav = [
    { to: '/today', icon: CalendarDays, label: 'Today' },
    { to: '/my-schedule', icon: Calendar, label: 'Schedule' },
    { to: '/my-attendance', icon: ClipboardCheck, label: 'Attendance' },
    { to: '/my-scorecard', icon: Star, label: 'Scorecard' },
  ];

  const activeNavItems = isDriver ? driverNav : visibleNavGroups;

  return (
    <header className="bg-[#1E3A5F] sticky top-0 z-40 flex-shrink-0 shadow-md">
      <div className="max-w-screen-2xl mx-auto px-4 h-14 flex items-center justify-between gap-4">

        {/* ── Brand ───────────────────────────────────────────────── */}
        <NavLink
          to={isDriver ? '/today' : '/'}
          className="flex items-center flex-shrink-0"
        >
          <img
            src={companyLogo}
            alt="Last Mile DSP"
            className="h-8 sm:h-10 w-auto object-contain"
          />
        </NavLink>

        {/* ── Nav items ───────────────────────────────────────────── */}
        <nav className="flex items-center gap-0.5 flex-1 justify-center overflow-x-auto scrollbar-hide">
          {activeNavItems.map((group, i) => {
            if (group.children) {
              return <NavDropdown key={i} group={group} />;
            }
            const Icon = group.icon;
            return (
              <NavLink
                key={group.to}
                to={group.to}
                end={group.exact}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-2 sm:px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 whitespace-nowrap flex-shrink-0 ${
                    isActive
                      ? 'bg-[#2563EB] text-white font-semibold'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`
                }
              >
                {isDriver && Icon && <Icon size={16} className="sm:hidden flex-shrink-0" />}
                <span className={isDriver ? 'hidden sm:inline' : ''}>{group.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* ── Right side ──────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-shrink-0">

          {/* Driver notification bell — visible for drivers only */}
          {isDriver && (
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setShowNotifications(o => !o)}
                className="relative p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Notifications"
              >
                <Bell size={17} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold leading-none">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 top-full mt-1.5 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                  {/* Header */}
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                    <div className="flex items-center gap-2">
                      <Bell size={14} className="text-slate-500" />
                      <p className="font-semibold text-slate-800 text-sm">Notifications</p>
                      {unreadCount > 0 && (
                        <span className="bg-red-100 text-red-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{unreadCount} new</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {unreadCount > 0 && (
                        <button
                          onClick={() => markAllRead.mutate()}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                        >
                          Mark all read
                        </button>
                      )}
                      <button onClick={() => setShowNotifications(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Notification list */}
                  {notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <Bell size={24} className="text-slate-200 mx-auto mb-2" />
                      <p className="text-sm text-slate-400">No notifications yet</p>
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                      {notifications.slice(0, 10).map(n => (
                        <div
                          key={n.id}
                          onClick={() => { if (!n.is_read) markRead.mutate(n.id); }}
                          className={`px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer
                            ${n.is_read ? 'opacity-50 bg-slate-50' : 'hover:bg-blue-50/50'}`}
                        >
                          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.is_read ? 'bg-slate-300' : 'bg-blue-500'}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm leading-snug ${n.is_read ? 'text-slate-500 font-normal' : 'text-slate-800 font-semibold'}`}>
                              {n.title}
                            </p>
                            {n.message && (
                              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{n.message}</p>
                            )}
                            <p className="text-[10px] text-slate-400 mt-1">
                              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                            </p>
                          </div>
                          {!n.is_read && (
                            <Check size={12} className="text-blue-400 flex-shrink-0 mt-1" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Footer */}
                  {notifications.length > 0 && (
                    <div className="px-4 py-2 border-t border-slate-100 bg-slate-50">
                      <p className="text-[11px] text-slate-400 text-center">
                        {notifications.length} notification{notifications.length !== 1 ? 's' : ''} · {notifications.length - unreadCount} read
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Fleet alerts bell — hidden for drivers */}
          {!isDriver && (
            <div className="relative" ref={alertsRef}>
              <button
                onClick={() => setShowAlerts(o => !o)}
                className="relative p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Fleet Alerts"
              >
                <Bell size={17} />
                {unackedCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold leading-none">
                    {unackedCount > 9 ? '9+' : unackedCount}
                  </span>
                )}
              </button>

              {showAlerts && (
                <div className="absolute right-0 top-full mt-1.5 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                  {/* Header */}
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                    <div className="flex items-center gap-2">
                      <Bell size={14} className="text-slate-500" />
                      <p className="font-semibold text-slate-800 text-sm">Fleet Alerts</p>
                      {unackedCount > 0 && (
                        <span className="bg-red-100 text-red-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{unackedCount} new</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {unackedCount > 0 && (
                        <button onClick={handleAckAll} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                          Ack all
                        </button>
                      )}
                      <button onClick={() => setShowAlerts(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Alert list */}
                  {allAlerts.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <Bell size={24} className="text-slate-200 mx-auto mb-2" />
                      <p className="text-sm text-slate-400">No alerts at this time</p>
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                      {allAlerts.map(alert => {
                        const isAcked = ackedAlerts.has(alert.id);
                        return (
                          <div
                            key={alert.id}
                            className={`px-4 py-3 flex items-start gap-3 transition-colors ${isAcked ? 'opacity-40 bg-slate-50' : 'hover:bg-amber-50/50'}`}
                          >
                            <AlertTriangle
                              size={14}
                              className={`flex-shrink-0 mt-0.5 ${isAcked ? 'text-slate-300' : 'text-amber-500'}`}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-slate-700 leading-snug">{alert.text}</p>
                              {isAcked && <p className="text-[11px] text-slate-400 mt-0.5">Acknowledged</p>}
                            </div>
                            {!isAcked && (
                              <button
                                onClick={() => handleAck(alert.id)}
                                className="flex-shrink-0 text-[11px] font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full transition-colors whitespace-nowrap"
                              >
                                Acknowledge
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Footer */}
                  {allAlerts.length > 0 && (
                    <div className="px-4 py-2 border-t border-slate-100 bg-slate-50">
                      <p className="text-[11px] text-slate-400 text-center">{allAlerts.length} alert{allAlerts.length !== 1 ? 's' : ''} · {allAlerts.length - unackedCount} acknowledged</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* User menu */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu(m => !m)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-xs font-semibold text-white leading-tight">{user?.firstName} {user?.lastName}</p>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide ${ROLE_BADGE[user?.role] || ROLE_BADGE.driver}`}>
                  {ROLE_LABEL[user?.role] || user?.role}
                </span>
              </div>
              <ChevronDown size={12} className="text-white/50" />
            </button>

            {showUserMenu && (
              <div className="absolute right-0 top-full mt-1.5 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5">
                <div className="px-4 py-2.5 border-b border-slate-100">
                  <p className="text-sm font-semibold text-slate-800">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-slate-500">{user?.email}</p>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => { setShowUserMenu(false); navigate('/management'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    <User size={14} /> Management
                  </button>
                )}
                <button
                  onClick={() => { setShowUserMenu(false); navigate('/change-password'); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                >
                  <Lock size={14} /> Change Password
                </button>
                <button
                  onClick={() => { logout(); navigate('/login'); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
