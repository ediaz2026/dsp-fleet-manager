import { useQuery } from '@tanstack/react-query';
import {
  Users, Car, AlertTriangle, CheckCircle, XCircle, Eye,
  Wrench, FileWarning, ClipboardList, AlertCircle, MapPin, ChevronRight
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import Badge from '../components/Badge';
import { format } from 'date-fns';

function StatCard({ title, value, subtitle, icon: Icon, color = 'blue', extra, onClick }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    green:  'bg-emerald-50 text-emerald-600',
    slate:  'bg-slate-100 text-slate-600',
    red:    'bg-red-50 text-red-600',
    amber:  'bg-amber-50 text-amber-600',
    orange: 'bg-orange-50 text-orange-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    purple: 'bg-purple-50 text-purple-600',
  };
  return (
    <div
      className={`card relative flex items-start gap-4 transition-all ${
        onClick
          ? 'cursor-pointer hover:border-blue-300 hover:shadow-md hover:bg-blue-50/20 group'
          : ''
      }`}
      onClick={onClick}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</p>
        <p className="text-2xl font-bold text-slate-900 mt-0.5">{value}</p>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        {extra && <div className="mt-1">{extra}</div>}
      </div>
      {onClick && (
        <span className="absolute bottom-3 right-3 flex items-center gap-0.5 text-[11px] text-slate-400 group-hover:text-blue-500 transition-colors font-medium">
          View all <ChevronRight size={11} />
        </span>
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(r => r.data),
    refetchInterval: 30000,
  });

  if (isLoading) return <LoadingState />;

  const {
    todayShifts = [], fleetAlerts = [], attendanceIssues = [],
    flaggedInspections = [], upcomingExpirations = [],
    recentViolations = [], staffStats = {},
    vehicleStats = {}, repairStats = {}, pendingDriverReports = 0,
    routes_today = 0, driverAlerts = { d30: 0, d60: 0, d90: 0 },
  } = data || {};

  const scheduledToday = todayShifts.length;

  const repairExtra = (
    <div className="flex gap-2 flex-wrap">
      {repairStats.open_severe > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">{repairStats.open_severe} Severe</span>}
      {repairStats.open_medium > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{repairStats.open_medium} Medium</span>}
      {repairStats.open_low > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{repairStats.open_low} Low</span>}
    </div>
  );

  const driverAlertExtra = (
    <div className="flex gap-2 flex-wrap">
      {driverAlerts.d30 > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">{driverAlerts.d30} in 30d</span>}
      {driverAlerts.d60 > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">{driverAlerts.d60} in 60d</span>}
      {driverAlerts.d90 > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">{driverAlerts.d90} in 90d</span>}
    </div>
  );

  const totalDriverAlerts = (driverAlerts.d30 || 0) + (driverAlerts.d60 || 0) + (driverAlerts.d90 || 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <span className="text-slate-500 text-sm">{format(new Date(), 'EEEE, MMMM d, yyyy')}</span>
      </div>

      {/* ── Row 1: Operational stats ───────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Drivers Scheduled"
          value={scheduledToday}
          subtitle="today"
          icon={Users}
          color="blue"
          onClick={() => navigate('/schedule')}
        />
        <StatCard
          title="Routes Today"
          value={routes_today}
          subtitle="in ops planner"
          icon={MapPin}
          color="indigo"
          onClick={() => navigate('/schedule?tab=ops')}
        />
        <StatCard
          title="Active Drivers"
          value={staffStats.active_drivers || 0}
          subtitle="on roster"
          icon={Users}
          color="green"
          onClick={() => navigate('/drivers', { state: { section: 'all-drivers', status: 'active' } })}
        />
        <StatCard
          title="Active Vehicles"
          value={vehicleStats.active_vehicles || 0}
          subtitle="in service"
          icon={Car}
          color="slate"
          onClick={() => navigate('/vehicles')}
        />
      </div>

      {/* ── Row 2: Fleet & alert stats ─────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Inactive Vehicles"
          value={vehicleStats.inactive_vehicles || 0}
          subtitle="out of service"
          icon={Wrench}
          color={(vehicleStats.inactive_vehicles || 0) > 0 ? 'red' : 'green'}
          onClick={() => navigate('/vehicles', { state: { statusFilter: 'grounded' } })}
        />
        <StatCard
          title="Open Repairs"
          value={repairStats.open_total || 0}
          subtitle="repair tickets"
          icon={FileWarning}
          color={(repairStats.open_severe || 0) > 0 ? 'red' : (repairStats.open_medium || 0) > 0 ? 'amber' : 'blue'}
          extra={Number(repairStats.open_total) > 0 ? repairExtra : null}
          onClick={() => navigate('/vehicles?tab=repairs')}
        />
        <StatCard
          title="Fleet Alerts"
          value={fleetAlerts.length}
          subtitle="unresolved"
          icon={AlertTriangle}
          color={fleetAlerts.length > 0 ? 'orange' : 'green'}
          onClick={() => navigate('/vehicles', { state: { showAlertsOnly: true } })}
        />
        <StatCard
          title="Driver Alerts"
          value={totalDriverAlerts}
          subtitle="license expiring"
          icon={AlertCircle}
          color={driverAlerts.d30 > 0 ? 'red' : driverAlerts.d60 > 0 ? 'orange' : totalDriverAlerts > 0 ? 'yellow' : 'green'}
          extra={totalDriverAlerts > 0 ? driverAlertExtra : null}
          onClick={() => navigate('/drivers', { state: { section: 'driver-alerts' } })}
        />
      </div>

      {/* ── Detail widgets ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attendance Issues */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Recent Attendance Issues</h2>
            <Link to="/attendance" className="text-xs text-primary hover:underline">View →</Link>
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {attendanceIssues.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-4">No issues in last 7 days</p>
            ) : attendanceIssues.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-2">
                <XCircle size={14} className={a.status === 'ncns' ? 'text-red-500' : 'text-orange-500'} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 truncate">{a.first_name} {a.last_name}</p>
                  <p className="text-xs text-slate-400">{format(new Date(a.attendance_date), 'MMM d')}</p>
                </div>
                <Badge status={a.status} />
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Expirations */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Upcoming Expirations</h2>
            <Link to="/vehicles" className="text-xs text-primary hover:underline">View →</Link>
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {upcomingExpirations.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-4">No upcoming expirations</p>
            ) : upcomingExpirations.map((v, i) => {
              const dates = [
                v.insurance_expiration && { label: 'Insurance', date: v.insurance_expiration },
                v.registration_expiration && { label: 'Registration', date: v.registration_expiration },
                v.next_inspection_date && { label: 'Inspection', date: v.next_inspection_date },
              ].filter(Boolean);
              return dates.map((d, j) => {
                const daysLeft = Math.round((new Date(d.date) - new Date()) / 86400000);
                return (
                  <div key={`${i}-${j}`} className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${daysLeft <= 7 ? 'bg-red-400' : 'bg-amber-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-700 truncate">{v.vehicle_name} — {d.label}</p>
                    </div>
                    <span className={`text-xs font-medium ${daysLeft <= 7 ? 'text-red-500' : 'text-amber-600'}`}>{daysLeft}d</span>
                  </div>
                );
              });
            })}
          </div>
        </div>

        {/* AI Flagged */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">AI Damage Flags</h2>
            <Link to="/ai-monitor" className="text-xs text-primary hover:underline">Review →</Link>
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {flaggedInspections.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-emerald-500">
                <CheckCircle size={32} className="mb-2 opacity-50" />
                <p className="text-sm">No damage flags</p>
              </div>
            ) : flaggedInspections.map(f => (
              <div key={f.id} className="flex items-center gap-3 py-2">
                <Eye size={14} className="text-red-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 truncate">{f.vehicle_name}</p>
                  <p className="text-xs text-slate-400">{format(new Date(f.inspection_date), 'MMM d, h:mm a')}</p>
                </div>
                <Badge status="flagged" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Violations */}
      {recentViolations.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Recent Policy Violations</h2>
            <Link to="/attendance" className="text-xs text-primary hover:underline">View all →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-100">
                  <th className="text-left pb-3 pr-4">Employee</th>
                  <th className="text-left pb-3 pr-4">Rule Triggered</th>
                  <th className="text-left pb-3 pr-4">Action</th>
                  <th className="text-left pb-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentViolations.map(v => (
                  <tr key={v.id} className="table-row">
                    <td className="py-2.5 pr-4 text-slate-800 font-medium">{v.first_name} {v.last_name}</td>
                    <td className="py-2.5 pr-4 text-slate-600">{v.rule_name}</td>
                    <td className="py-2.5 pr-4"><Badge status={v.action_taken} /></td>
                    <td className="py-2.5 text-slate-500">{format(new Date(v.created_at), 'MMM d')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="card h-24 animate-pulse bg-slate-100" />)}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="card h-24 animate-pulse bg-slate-100" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {[...Array(3)].map((_, i) => <div key={i} className="card h-56 animate-pulse bg-slate-100" />)}
      </div>
    </div>
  );
}
