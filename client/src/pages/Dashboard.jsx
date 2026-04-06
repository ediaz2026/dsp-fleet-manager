import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Users, Car, AlertTriangle, CheckCircle, XCircle, Eye,
  Wrench, AlertCircle, MapPin, ChevronRight,
  MessageSquareWarning, BarChart2, Shield, Calendar,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import Badge from '../components/Badge';
import { format, differenceInDays, parseISO, startOfWeek } from 'date-fns';

// ─── Group Section Header ─────────────────────────────────────────────────────
function GroupHeader({ label }) {
  return (
    <div className="flex items-center gap-3 pt-0.5">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex-shrink-0">{label}</span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ title, value, subtitle, icon: Icon, tint = 'neutral', extra, onClick, viewLabel = 'View all', hero = false }) {
  const tintCls = {
    danger:  'bg-red-50/70 border-red-100',
    success: 'bg-emerald-50/50 border-emerald-100',
    warning: 'bg-amber-50/60 border-amber-100',
    info:    'bg-indigo-50/50 border-indigo-100',
    neutral: 'bg-white border-slate-200',
  }[tint] || 'bg-white border-slate-200';
  const iconCls = {
    danger:  'bg-red-100 text-red-600',
    success: 'bg-emerald-100 text-emerald-600',
    warning: 'bg-amber-100 text-amber-600',
    info:    'bg-indigo-100 text-indigo-600',
    neutral: 'bg-slate-100 text-slate-500',
  }[tint] || 'bg-slate-100 text-slate-500';

  return (
    <div
      className={`relative rounded-xl border shadow-sm p-3.5 transition-all flex flex-col gap-1.5 ${tintCls} ${
        onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 group' : ''
      }`}
      onClick={onClick}
    >
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${iconCls}`}>
        <Icon size={14} />
      </div>
      <div className="flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0">{title}</p>
        <p className="font-black text-slate-900 leading-none text-[1.75rem]">{value}</p>
        {subtitle && <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">{subtitle}</p>}
        {extra && <div className="mt-1">{extra}</div>}
      </div>
      {onClick && (
        <span className="absolute bottom-2.5 right-3 flex items-center gap-0.5 text-[10px] text-slate-400 group-hover:text-blue-500 transition-colors font-medium">
          {viewLabel} <ChevronRight size={10} />
        </span>
      )}
    </div>
  );
}

// ─── Insight List Card ────────────────────────────────────────────────────────
function InsightCard({ title, icon: Icon, iconClass, to, onNavigate, navigateLabel = 'View all', children, tint = 'neutral' }) {
  const tintCls = {
    danger:  'bg-red-50/40 border-red-100',
    warning: 'bg-amber-50/40 border-amber-100',
    success: 'bg-emerald-50/30 border-emerald-100',
    neutral: 'bg-white border-slate-200',
  }[tint] || 'bg-white border-slate-200';
  return (
    <div className={`rounded-xl border shadow-sm p-3 flex flex-col gap-1.5 ${tintCls}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${iconClass}`}>
            <Icon size={12} />
          </div>
          <p className="text-[12px] font-semibold text-slate-700">{title}</p>
        </div>
        {to && (
          <Link to={to} className="text-[10px] font-medium text-blue-600 hover:text-blue-700 flex items-center gap-0.5 flex-shrink-0">
            {navigateLabel} <ChevronRight size={9} />
          </Link>
        )}
        {onNavigate && (
          <button onClick={onNavigate} className="text-[10px] font-medium text-blue-600 hover:text-blue-700 flex items-center gap-0.5 flex-shrink-0">
            {navigateLabel} <ChevronRight size={9} />
          </button>
        )}
      </div>
      <div className="overflow-y-auto max-h-44 space-y-0">
        {children}
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(r => r.data),
    staleTime: 30 * 1000,
    refetchInterval: 30000,
  });

  const { data: pendingReports = [] } = useQuery({
    queryKey: ['driver-reports'],
    queryFn: () => api.get('/driver-reports').then(r => r.data),
    refetchInterval: 30000,
  });

  const todayStr  = format(new Date(), 'yyyy-MM-dd');
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

  const { data: vsToday } = useQuery({
    queryKey: ['volume-share', todayStr],
    queryFn: () => api.get(`/analytics/volume-share?date=${todayStr}`).then(r => r.data).catch(() => null),
    staleTime: 5 * 60 * 1000,
  });

  const { data: rescuesToday = [] } = useQuery({
    queryKey: ['rescues-today', todayStr],
    queryFn: () => api.get(`/analytics/rescues?date=${todayStr}`).then(r => r.data).catch(() => []),
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: opsRoutesData } = useQuery({
    queryKey: ['ops-daily-routes-dash', todayStr],
    queryFn: () => api.get(`/ops-planner/daily-routes?date=${todayStr}`).then(r => r.data).catch(() => ({ routes: [] })),
    refetchInterval: 60000,
  });

  const { data: opsAssignments = [] } = useQuery({
    queryKey: ['ops-assignments-dash', todayStr],
    queryFn: () => api.get(`/ops-planner/assignments?date=${todayStr}`).then(r => r.data).catch(() => []),
    refetchInterval: 60000,
  });

  if (isLoading) return <LoadingState />;

  const {
    todayShifts = [], fleetAlerts = [], attendanceIssues = [],
    flaggedInspections = [], upcomingExpirations = [],
    recentViolations = [], vehicleStats = {},
    routes_today = 0, blocks_today = 0, helpers_today = 0,
    driverAlerts = { d30: 0, d60: 0, d90: 0 },
    driversScheduled = {},
    hoursSummary = {},
  } = data || {};

  // ── Unassigned routes
  const todayRoutes    = opsRoutesData?.routes || [];
  const assignedCodes  = new Set(
    (opsAssignments || []).filter(a => a.route_code && !a.removed_from_ops).map(a => a.route_code)
  );
  const unassignedCount  = todayRoutes.filter(r => r.routeCode && !assignedCodes.has(r.routeCode)).length;
  const totalRouteCount  = todayRoutes.length;

  // ── Schedule published status
  const publishedToday   = todayShifts.filter(s => s.publish_status === 'published').length;
  const draftToday       = todayShifts.filter(s => s.publish_status !== 'published').length;
  const totalTodayShifts = todayShifts.length;
  const scheduleStatus   = totalTodayShifts === 0 ? 'none'
    : draftToday === 0    ? 'published'
    : publishedToday === 0 ? 'unpublished'
    : 'partial';
  const publishedPct = totalTodayShifts === 0 ? null
    : Math.round((publishedToday / totalTodayShifts) * 100);

  // ── Weekly attendance
  const present_count    = parseInt(hoursSummary?.present_count    || 0, 10);
  const ncns_count       = parseInt(hoursSummary?.ncns_count       || 0, 10);
  const called_out_count = parseInt(hoursSummary?.called_out_count || 0, 10);
  const late_count       = parseInt(hoursSummary?.late_count       || 0, 10);
  const attendTotal = present_count + late_count + ncns_count + called_out_count;
  const attendRate  = attendTotal > 0 ? Math.round(((present_count + late_count) / attendTotal) * 100) : null;
  const attendExtra = attendTotal > 0 ? (
    <div className="flex gap-1.5 flex-wrap">
      {called_out_count > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">CO: {called_out_count}</span>}
      {ncns_count > 0       && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">NCNS: {ncns_count}</span>}
      {late_count > 0       && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Late: {late_count}</span>}
    </div>
  ) : null;

  // ── Consequence alerts
  const conseqByDriver = recentViolations.reduce((acc, v) => {
    if (!acc[v.staff_id]) acc[v.staff_id] = { name: `${v.first_name} ${v.last_name}`, action_taken: v.action_taken, count: 0 };
    acc[v.staff_id].count++;
    const rank = { termination_review: 0, final_warning: 1, written_warning: 2, verbal_warning: 3, warning: 4 };
    if ((rank[v.action_taken] ?? 9) < (rank[acc[v.staff_id].action_taken] ?? 9)) acc[v.staff_id].action_taken = v.action_taken;
    return acc;
  }, {});
  const conseqList = Object.values(conseqByDriver).sort((a, b) => {
    const rank = { termination_review: 0, final_warning: 1, written_warning: 2, verbal_warning: 3, warning: 4 };
    return (rank[a.action_taken] ?? 9) - (rank[b.action_taken] ?? 9);
  });
  const terminationCount  = conseqList.filter(d => d.action_taken === 'termination_review').length;
  const finalWarningCount = conseqList.filter(d => d.action_taken === 'final_warning').length;
  const warningCount      = conseqList.filter(d => ['written_warning','verbal_warning','warning'].includes(d.action_taken)).length;

  // ── Driver alerts
  const totalDriverAlerts = (driverAlerts.d30 || 0) + (driverAlerts.d60 || 0) + (driverAlerts.d90 || 0);
  const driverAlertExtra = totalDriverAlerts > 0 ? (
    <div className="flex gap-1.5 flex-wrap">
      {driverAlerts.d30 > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">{driverAlerts.d30} in 30d</span>}
      {driverAlerts.d60 > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">{driverAlerts.d60} in 60d</span>}
      {driverAlerts.d90 > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">{driverAlerts.d90} in 90d</span>}
    </div>
  ) : null;

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">

      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pb-0.5">
        <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
        <span className="text-slate-400 text-xs">{format(new Date(), 'EEEE, MMMM d, yyyy')}</span>
      </div>

      {/* ════════════════════════════════════════════════════════════
          GROUP 1 — OPERATIONS
      ════════════════════════════════════════════════════════════ */}
      <GroupHeader label="Operations" />
      <div className="grid grid-cols-2 md:grid-cols-12 gap-2.5">

        {/* Routes Today */}
        <div
          className="col-span-2 md:col-span-4 relative rounded-xl border border-indigo-100 bg-indigo-50/50 shadow-sm p-3.5 flex flex-col gap-1.5 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all group"
          onClick={() => navigate('/operational-planner')}
        >
          <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
            <MapPin size={14} />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0">Routes Today</p>
            <p className="text-[1.75rem] font-black text-slate-900 leading-none">{totalRouteCount || routes_today || 0}<span className="text-lg text-slate-400 font-bold">/{blocks_today || (totalRouteCount || 0)}</span></p>
            <p className="text-[12px] text-slate-500 mt-0.5">routes / blocks</p>
          </div>
          <span className="absolute bottom-2.5 right-3 flex items-center gap-0.5 text-[10px] text-slate-400 group-hover:text-indigo-500 font-medium transition-colors">
            View all <ChevronRight size={10} />
          </span>
        </div>

        {/* Unassigned Routes */}
        <div
          className={`col-span-2 md:col-span-2 relative rounded-xl border shadow-sm p-3.5 flex flex-col gap-1.5 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all group ${
            totalRouteCount === 0  ? 'bg-white border-slate-200'
            : unassignedCount === 0 ? 'bg-emerald-50/50 border-emerald-100'
            : 'bg-red-50/70 border-red-100'
          }`}
          onClick={() => navigate('/operational-planner')}
        >
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
            totalRouteCount === 0  ? 'bg-slate-100 text-slate-400'
            : unassignedCount === 0 ? 'bg-emerald-100 text-emerald-600'
            : 'bg-red-100 text-red-600'
          }`}>
            <AlertCircle size={14} />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0">Unassigned</p>
            <p className="text-[1.75rem] font-black text-slate-900 leading-none">
              {totalRouteCount === 0 ? '—' : unassignedCount}
            </p>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {totalRouteCount === 0 ? 'no routes loaded'
              : unassignedCount === 0 ? '✅ all covered'
              : `of ${totalRouteCount} routes`}
            </p>
          </div>
          <span className="absolute bottom-2.5 right-3 flex items-center gap-0.5 text-[10px] text-slate-400 group-hover:text-blue-500 font-medium transition-colors">
            View all <ChevronRight size={10} />
          </span>
        </div>

        {/* Schedule Status — HERO */}
        {(() => {
          const tintCls = {
            published:   'bg-emerald-50/60 border-emerald-100',
            partial:     'bg-amber-50/60 border-amber-100',
            unpublished: 'bg-red-50/60 border-red-100',
            none:        'bg-white border-slate-200',
          }[scheduleStatus];
          const iconBg = {
            published:   'bg-emerald-100 text-emerald-600',
            partial:     'bg-amber-100 text-amber-600',
            unpublished: 'bg-red-100 text-red-600',
            none:        'bg-slate-100 text-slate-400',
          }[scheduleStatus];
          const numColor = {
            published:   'text-emerald-700',
            partial:     'text-amber-700',
            unpublished: 'text-red-700',
            none:        'text-slate-400',
          }[scheduleStatus];
          const statusLabel = scheduleStatus === 'published' ? 'Fully published'
            : scheduleStatus === 'partial'     ? `${draftToday} shifts pending`
            : scheduleStatus === 'unpublished' ? 'Not published'
            : 'No shifts today';
          return (
            <div
              className={`col-span-2 md:col-span-4 relative rounded-xl border shadow-sm p-3.5 flex flex-col gap-1.5 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all group ${tintCls}`}
              onClick={() => navigate('/schedule', { state: { openPublishModal: true } })}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconBg}`}>
                <CheckCircle size={14} />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0">Schedule Status</p>
                <p className={`text-[1.75rem] font-black leading-none ${numColor}`}>
                  {publishedPct !== null ? `${publishedPct}%` : '—'}
                </p>
                <p className={`text-[12px] mt-0.5 font-semibold ${numColor}`}>{statusLabel}</p>
                {totalTodayShifts > 0 && (
                  <p className="text-[11px] text-slate-400 mt-0">{publishedToday} of {totalTodayShifts} shifts</p>
                )}
              </div>
              <span className="absolute bottom-2.5 right-3 flex items-center gap-0.5 text-[10px] text-slate-400 group-hover:text-blue-500 font-medium transition-colors">
                {scheduleStatus !== 'published' ? 'Publish' : 'View'} <ChevronRight size={10} />
              </span>
            </div>
          );
        })()}

        {/* Rescues Today */}
        <div
          className={`col-span-2 md:col-span-2 relative rounded-xl border shadow-sm p-3.5 flex flex-col gap-1.5 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all group ${
            rescuesToday.length > 0 ? 'bg-orange-50/60 border-orange-100' : 'bg-emerald-50/40 border-emerald-100'
          }`}
          onClick={() => navigate('/analytics?tab=performance')}
        >
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
            rescuesToday.length > 0 ? 'bg-orange-100 text-orange-600' : 'bg-emerald-100 text-emerald-600'
          }`}>
            <AlertTriangle size={14} />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0">Rescues Today</p>
            <p className="text-[1.75rem] font-black text-slate-900 leading-none">{rescuesToday.length}</p>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {rescuesToday.length === 0 ? '✅ none today' : `rescue${rescuesToday.length !== 1 ? 's' : ''} logged`}
            </p>
          </div>
          <span className="absolute bottom-2.5 right-3 flex items-center gap-0.5 text-[10px] text-slate-400 group-hover:text-blue-500 font-medium transition-colors">
            View all <ChevronRight size={10} />
          </span>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════
          GROUP 2 — FLEET
      ════════════════════════════════════════════════════════════ */}
      <GroupHeader label="Fleet" />
      <div className="grid grid-cols-3 gap-2.5">
        <StatCard
          title="Active Vehicles"
          value={vehicleStats.active_vehicles || 0}
          subtitle={
            (vehicleStats.grounded_by_amazon || 0) > 0
              ? `${vehicleStats.grounded_by_amazon} grounded by Amazon`
              : 'in service'
          }
          icon={Car}
          tint={(vehicleStats.grounded_by_amazon || 0) > 0 ? 'warning' : 'success'}
          onClick={() => navigate('/vehicles', { state: { statusFilter: 'active' } })}
        />
        <StatCard
          title="Out of Service"
          value={vehicleStats.inactive_vehicles || 0}
          subtitle="van out of service"
          icon={Wrench}
          tint={(vehicleStats.inactive_vehicles || 0) > 0 ? 'danger' : 'neutral'}
          onClick={() => navigate('/vehicles', { state: { statusFilter: 'inactive' } })}
        />
        <StatCard
          title="Fleet Alerts"
          value={fleetAlerts.length}
          subtitle="unresolved"
          icon={AlertTriangle}
          tint={fleetAlerts.length > 0 ? 'warning' : 'success'}
          onClick={() => navigate('/vehicles?tab=fleet-alerts')}
        />
      </div>

      {/* ════════════════════════════════════════════════════════════
          GROUP 3 — PEOPLE
      ════════════════════════════════════════════════════════════ */}
      <GroupHeader label="People" />
      <div className="grid grid-cols-5 gap-2.5">

        {/* Rostered */}
        {(() => {
          const ds = driversScheduled;
          const rostered = parseInt(ds.edv||0) + parseInt(ds.step_van||0) + parseInt(ds.helper||0) + parseInt(ds.extra||0);
          const parts = [];
          if (parseInt(ds.edv||0)) parts.push(`EDV: ${ds.edv}`);
          if (parseInt(ds.step_van||0)) parts.push(`SV: ${ds.step_van}`);
          if (parseInt(ds.helper||0)) parts.push(`Helper: ${ds.helper}`);
          if (parseInt(ds.extra||0)) parts.push(`Extra: ${ds.extra}`);
          return <StatCard title="Rostered" value={rostered} subtitle="rostered today" icon={Users}
            tint={rostered > 0 ? 'success' : 'neutral'} extra={parts.join(' | ') || null} onClick={() => navigate('/schedule')} />;
        })()}

        {/* Dispatchers */}
        {(() => {
          const initials = s => `${s.first_name?.[0] || ''}${s.last_name?.[0] || ''}`;
          const am = todayShifts.filter(s => s.shift_type === 'DISPATCH AM');
          const pm = todayShifts.filter(s => s.shift_type === 'DISPATCH PM');
          const total = am.length + pm.length;
          const extra = `AM: ${am.map(initials).join('/') || '—'}  PM: ${pm.map(initials).join('/') || '—'}`;
          return <StatCard title="Dispatchers" value={total} subtitle="on duty today" icon={Users}
            tint={total > 0 ? 'success' : 'neutral'} extra={extra} onClick={() => navigate('/schedule')} />;
        })()}

        {/* Weekly Attendance */}
        <StatCard
          title="Weekly Attendance"
          value={attendRate !== null ? `${attendRate}%` : '—'}
          subtitle={attendTotal > 0 ? `${attendTotal} shifts recorded` : 'no records yet this week'}
          icon={Users}
          tint={attendRate === null ? 'neutral' : attendRate >= 95 ? 'success' : attendRate >= 88 ? 'warning' : 'danger'}
          extra={attendExtra}
          onClick={() => navigate('/attendance')}
        />

        {/* Consequence Alerts */}
        <div
          className={`relative rounded-xl border shadow-sm p-3.5 flex flex-col gap-1.5 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all group ${
            conseqList.length > 0 ? 'bg-red-50/60 border-red-100' : 'bg-emerald-50/40 border-emerald-100'
          }`}
          onClick={() => navigate('/drivers', { state: { section: 'all-drivers' } })}
        >
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${conseqList.length > 0 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
            <Shield size={14} />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0">Consequence Alerts</p>
            <p className="text-[1.75rem] font-black text-slate-900 leading-none">{conseqList.length}</p>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {conseqList.length > 0 ? 'drivers flagged (30d)' : 'no violations (30d)'}
            </p>
            {conseqList.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mt-1">
                {terminationCount  > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">🔴 {terminationCount} Term.</span>}
                {finalWarningCount > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">🟠 {finalWarningCount} Final</span>}
                {warningCount      > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700">🟡 {warningCount} Warning</span>}
              </div>
            )}
          </div>
          <span className="absolute bottom-2.5 right-3 flex items-center gap-0.5 text-[10px] text-slate-400 group-hover:text-blue-500 font-medium transition-colors">
            View <ChevronRight size={10} />
          </span>
        </div>

        {/* Driver Alerts */}
        <StatCard
          title="Driver Alerts"
          value={totalDriverAlerts}
          subtitle="license expiring"
          icon={AlertCircle}
          tint={driverAlerts.d30 > 0 ? 'danger' : driverAlerts.d60 > 0 ? 'warning' : totalDriverAlerts > 0 ? 'warning' : 'success'}
          extra={driverAlertExtra}
          onClick={() => navigate('/drivers', { state: { section: 'driver-alerts' } })}
        />
      </div>

      {/* ════════════════════════════════════════════════════════════
          GROUP 4 — INSIGHTS
      ════════════════════════════════════════════════════════════ */}
      <GroupHeader label="Insights" />
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2.5">

        {/* Volume Share — col-span-2, admin only */}
        {isAdmin && <div
          className="col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm p-3 flex flex-col gap-1.5 cursor-pointer hover:shadow-md hover:border-blue-200 transition-all group"
          onClick={() => navigate('/analytics')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-md bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                <BarChart2 size={12} />
              </div>
              <p className="text-[12px] font-semibold text-slate-700">Volume Share</p>
            </div>
            <span className="text-[10px] font-medium text-blue-600 group-hover:text-blue-700 flex items-center gap-0.5 flex-shrink-0">
              View in Analytics <ChevronRight size={9} />
            </span>
          </div>
          {vsToday ? (
            <>
              <p className="text-[10px] text-slate-400">Today · {vsToday.total_routes} total routes</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">DSP</th>
                    <th className="text-right pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Routes</th>
                    <th className="text-right pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(vsToday.volume || {})
                    .sort(([,a],[,b]) => b - a)
                    .slice(0, 8)
                    .map(([dsp, cnt]) => {
                      const pct = vsToday.total_routes ? ((cnt / vsToday.total_routes) * 100).toFixed(1) : '0.0';
                      const isUs = dsp === 'LSMD';
                      return (
                        <tr key={dsp} className={isUs ? 'bg-blue-50/70' : ''}>
                          <td className={`py-0.5 pl-1 font-bold rounded-l text-[11px] ${isUs ? 'text-blue-700' : 'text-slate-700'}`}>{dsp}</td>
                          <td className={`py-0.5 text-right tabular-nums text-[11px] ${isUs ? 'text-blue-700' : 'text-slate-600'}`}>{cnt}</td>
                          <td className={`py-0.5 pr-1 text-right tabular-nums rounded-r text-[11px] ${isUs ? 'text-blue-700 font-bold' : 'text-slate-500'}`}>{pct}%</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </>
          ) : (
            <p className="text-[12px] text-slate-400 py-4 text-center">No volume data for today</p>
          )}
        </div>}

        {/* Recent Attendance Issues */}
        <InsightCard
          title="Attendance Issues"
          icon={XCircle}
          iconClass="bg-red-100 text-red-600"
          to="/attendance"
          tint={attendanceIssues.length > 0 ? 'danger' : 'neutral'}
        >
          {attendanceIssues.length === 0 ? (
            <div className="flex flex-col items-center py-3 text-emerald-500">
              <CheckCircle size={20} className="mb-1 opacity-60" />
              <p className="text-xs text-slate-400">No issues in last 7 days</p>
            </div>
          ) : attendanceIssues.slice(0, 7).map(a => (
            <div key={a.id} className="flex items-center gap-1.5 py-0.5 border-b border-slate-50 last:border-0">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                a.status === 'ncns' ? 'bg-red-500'
                : a.status === 'called_out' ? 'bg-orange-400'
                : 'bg-amber-400'
              }`} />
              <p className="text-xs text-slate-700 truncate flex-1">{a.first_name} {a.last_name}</p>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                a.status === 'ncns'       ? 'bg-red-100 text-red-700'
                : a.status === 'called_out' ? 'bg-orange-100 text-orange-700'
                : 'bg-amber-100 text-amber-700'
              }`}>
                {(a.status || '').toUpperCase().replace(/_/g, ' ')}
              </span>
              <span className="text-[10px] text-slate-400 flex-shrink-0">{format(new Date(a.attendance_date), 'M/d')}</span>
            </div>
          ))}
        </InsightCard>

        {/* Upcoming Expirations */}
        <InsightCard
          title="Expirations"
          icon={Calendar}
          iconClass="bg-amber-100 text-amber-600"
          to="/vehicles"
          tint={upcomingExpirations.length > 0 ? 'warning' : 'neutral'}
        >
          {upcomingExpirations.length === 0 ? (
            <div className="flex flex-col items-center py-3 text-emerald-500">
              <CheckCircle size={20} className="mb-1 opacity-60" />
              <p className="text-xs text-slate-400">No upcoming expirations</p>
            </div>
          ) : upcomingExpirations.flatMap((v, i) =>
              [
                v.insurance_expiration    && { label: 'Ins', date: v.insurance_expiration },
                v.registration_expiration && { label: 'Reg', date: v.registration_expiration },
                v.next_inspection_date    && { label: 'Insp', date: v.next_inspection_date },
              ].filter(Boolean).map((d, j) => {
                const daysLeft = Math.round((new Date(d.date) - new Date()) / 86400000);
                return (
                  <div key={`${i}-${j}`} className="flex items-center gap-1.5 py-0.5 border-b border-slate-50 last:border-0">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${daysLeft <= 7 ? 'bg-red-500' : 'bg-amber-400'}`} />
                    <p className="text-xs text-slate-700 truncate flex-1">{v.vehicle_name}</p>
                    <span className="text-[10px] text-slate-400 flex-shrink-0">{d.label}</span>
                    <span className={`text-[10px] font-bold flex-shrink-0 ${daysLeft <= 7 ? 'text-red-600' : 'text-amber-600'}`}>{daysLeft}d</span>
                  </div>
                );
              })
            ).slice(0, 8)
          }
        </InsightCard>

        {/* AI Damage Flags */}
        <InsightCard
          title="AI Damage Flags"
          icon={Eye}
          iconClass="bg-purple-100 text-purple-600"
          to="/ai-monitor"
          navigateLabel="Review"
          tint={flaggedInspections.length > 0 ? 'warning' : 'neutral'}
        >
          {flaggedInspections.length === 0 ? (
            <div className="flex flex-col items-center py-3 text-emerald-500">
              <CheckCircle size={20} className="mb-1 opacity-60" />
              <p className="text-xs text-slate-400">No damage flags</p>
            </div>
          ) : flaggedInspections.slice(0, 7).map(f => (
            <div key={f.id} className="flex items-center gap-1.5 py-0.5 border-b border-slate-50 last:border-0">
              <Eye size={12} className="text-purple-500 flex-shrink-0" />
              <p className="text-xs text-slate-700 truncate flex-1">{f.vehicle_name}</p>
              <span className="text-[10px] text-slate-400 flex-shrink-0">{format(new Date(f.inspection_date), 'M/d')}</span>
            </div>
          ))}
        </InsightCard>

        {/* Driver Reports Queue */}
        <InsightCard
          title="Driver Reports"
          icon={MessageSquareWarning}
          iconClass="bg-orange-100 text-orange-600"
          onNavigate={() => navigate('/vehicles?tab=driver-reports')}
          tint={pendingReports.filter(r => r.status === 'pending').length > 0 ? 'warning' : 'neutral'}
        >
          {(() => {
            const pending = pendingReports
              .filter(r => r.status === 'pending')
              .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            return pending.length === 0 ? (
              <div className="flex flex-col items-center py-3 text-emerald-500">
                <CheckCircle size={20} className="mb-1 opacity-60" />
                <p className="text-xs text-slate-400">No pending reports</p>
              </div>
            ) : pending.slice(0, 7).map(r => (
              <div key={r.id} className="flex items-center gap-1.5 py-0.5 border-b border-slate-50 last:border-0">
                <MessageSquareWarning size={12} className="text-orange-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-700 truncate">{r.driver_name || 'Unknown Driver'}</p>
                  {r.vehicle_name && <p className="text-[10px] text-slate-400 truncate">{r.vehicle_name}</p>}
                </div>
                <span className="text-[10px] text-slate-400 flex-shrink-0">
                  {r.created_at ? format(new Date(r.created_at), 'M/d') : ''}
                </span>
              </div>
            ));
          })()}
        </InsightCard>
      </div>

    </div>
  );
}

// ─── Loading State ────────────────────────────────────────────────────────────
function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 bg-slate-100 rounded-lg animate-pulse" />
      <div className="h-px bg-slate-200" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="rounded-2xl bg-slate-100 h-36 animate-pulse" />)}
      </div>
      <div className="h-px bg-slate-200 mt-2" />
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <div key={i} className="rounded-2xl bg-slate-100 h-32 animate-pulse" />)}
      </div>
      <div className="h-px bg-slate-200 mt-2" />
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <div key={i} className="rounded-2xl bg-slate-100 h-32 animate-pulse" />)}
      </div>
      <div className="h-px bg-slate-200 mt-2" />
      <div className="grid grid-cols-6 gap-4">
        <div className="col-span-2 rounded-2xl bg-slate-100 h-52 animate-pulse" />
        {[...Array(4)].map((_, i) => <div key={i} className="rounded-2xl bg-slate-100 h-52 animate-pulse" />)}
      </div>
    </div>
  );
}
