import { useQuery } from '@tanstack/react-query';
import { Users, Car, AlertTriangle, Clock, CheckCircle, XCircle, TrendingUp, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import { format } from 'date-fns';

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(r => r.data),
    refetchInterval: 30000,
  });

  if (isLoading) return <LoadingState />;

  const { todayShifts = [], fleetAlerts = [], attendanceIssues = [],
    hoursSummary = {}, flaggedInspections = [], upcomingExpirations = [],
    recentViolations = [], staffStats = {} } = data || {};

  const scheduledToday = todayShifts.length;
  const clockedIn = todayShifts.filter(s => s.clock_in && !s.clock_out).length;
  const issues = todayShifts.filter(s => ['ncns', 'called_out'].includes(s.attendance_status)).length;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <span className="text-slate-400 text-sm">{format(new Date(), 'EEEE, MMMM d, yyyy')}</span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Scheduled Today" value={scheduledToday} subtitle={`${clockedIn} clocked in`} icon={Users} color="blue" />
        <StatCard title="Active Fleet" value={staffStats.active_drivers || 0} subtitle="active drivers" icon={Car} color="green" />
        <StatCard title="Fleet Alerts" value={fleetAlerts.length} subtitle="unresolved" icon={AlertTriangle} color={fleetAlerts.length > 0 ? 'red' : 'green'} />
        <StatCard title="Hours This Week" value={parseFloat(hoursSummary.total_hours || 0).toFixed(0)} subtitle={`${hoursSummary.present_count || 0} shifts completed`} icon={Clock} color="purple" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Schedule */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-100">Today's Schedule</h2>
            <Link to="/schedule" className="text-xs text-primary hover:underline">View all →</Link>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {todayShifts.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-6">No shifts scheduled today</p>
            ) : todayShifts.map(s => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface hover:bg-surface-hover transition-colors">
                <div className="w-8 h-8 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">
                  {s.first_name[0]}{s.last_name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{s.first_name} {s.last_name}</p>
                  <p className="text-xs text-slate-500">{s.start_time} – {s.end_time}</p>
                </div>
                <Badge status={s.attendance_status || 'scheduled'} />
              </div>
            ))}
          </div>
        </div>

        {/* Fleet Alerts */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-100">Fleet Alerts</h2>
            <Link to="/vehicles" className="text-xs text-primary hover:underline">Manage →</Link>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {fleetAlerts.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-green-400">
                <CheckCircle size={32} className="mb-2 opacity-50" />
                <p className="text-sm">All clear</p>
              </div>
            ) : fleetAlerts.map(a => (
              <div key={a.id} className={`px-3 py-2 rounded-lg border-l-2 ${a.severity === 'critical' ? 'border-red-500 bg-red-500/5' : 'border-yellow-500 bg-yellow-500/5'}`}>
                <p className="text-xs font-semibold text-slate-300">{a.vehicle_name}</p>
                <p className="text-xs text-slate-400 mt-0.5">{a.alert_message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attendance Issues */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-100">Recent Attendance Issues</h2>
            <Link to="/attendance" className="text-xs text-primary hover:underline">View →</Link>
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {attendanceIssues.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">No issues in last 7 days</p>
            ) : attendanceIssues.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-2">
                <XCircle size={14} className={a.status === 'ncns' ? 'text-red-400' : 'text-orange-400'} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-300 truncate">{a.first_name} {a.last_name}</p>
                  <p className="text-xs text-slate-500">{format(new Date(a.attendance_date), 'MMM d')}</p>
                </div>
                <Badge status={a.status} />
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Expirations */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-100">Upcoming Expirations</h2>
            <Link to="/vehicles" className="text-xs text-primary hover:underline">View →</Link>
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {upcomingExpirations.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">No upcoming expirations</p>
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
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${daysLeft <= 7 ? 'bg-red-400' : 'bg-yellow-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-300 truncate">{v.vehicle_name} — {d.label}</p>
                    </div>
                    <span className={`text-xs font-medium ${daysLeft <= 7 ? 'text-red-400' : 'text-yellow-400'}`}>{daysLeft}d</span>
                  </div>
                );
              });
            })}
          </div>
        </div>

        {/* AI Flagged */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-100">AI Damage Flags</h2>
            <Link to="/ai-monitor" className="text-xs text-primary hover:underline">Review →</Link>
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {flaggedInspections.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-green-400">
                <CheckCircle size={32} className="mb-2 opacity-50" />
                <p className="text-sm">No damage flags</p>
              </div>
            ) : flaggedInspections.map(f => (
              <div key={f.id} className="flex items-center gap-3 py-2">
                <Eye size={14} className="text-red-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-300 truncate">{f.vehicle_name}</p>
                  <p className="text-xs text-slate-500">{format(new Date(f.inspection_date), 'MMM d, h:mm a')}</p>
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
            <h2 className="font-semibold text-slate-100">Recent Policy Violations</h2>
            <Link to="/attendance" className="text-xs text-primary hover:underline">View all →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 border-b border-surface-border">
                  <th className="text-left pb-3 pr-4">Employee</th>
                  <th className="text-left pb-3 pr-4">Rule Triggered</th>
                  <th className="text-left pb-3 pr-4">Action</th>
                  <th className="text-left pb-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentViolations.map(v => (
                  <tr key={v.id} className="table-row">
                    <td className="py-2.5 pr-4 text-slate-300 font-medium">{v.first_name} {v.last_name}</td>
                    <td className="py-2.5 pr-4 text-slate-400">{v.rule_name}</td>
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
        {[...Array(4)].map((_, i) => <div key={i} className="card h-24 animate-pulse bg-surface-hover" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {[...Array(3)].map((_, i) => <div key={i} className="card h-64 animate-pulse bg-surface-hover" />)}
      </div>
    </div>
  );
}
