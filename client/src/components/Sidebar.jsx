import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Calendar, ClipboardCheck, DollarSign, Truck,
  Car, Users, Search, Cpu, Settings, ChevronLeft, ChevronRight, Package
} from 'lucide-react';
import clsx from 'clsx';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { to: '/schedule', icon: Calendar, label: 'Schedule' },
  { to: '/attendance', icon: ClipboardCheck, label: 'Attendance' },
  { to: '/payroll', icon: DollarSign, label: 'Payroll' },
  { to: '/amazon-routes', icon: Package, label: 'Amazon Routes' },
  { divider: true },
  { to: '/vehicles', icon: Car, label: 'Vehicles' },
  { to: '/drivers', icon: Users, label: 'Drivers' },
  { to: '/inspections', icon: Search, label: 'Inspections' },
  { to: '/ai-monitor', icon: Cpu, label: 'AI Monitor' },
  { divider: true },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar({ open, onToggle }) {
  return (
    <aside
      className={clsx(
        'bg-sidebar flex flex-col border-r border-surface-border transition-all duration-200',
        open ? 'w-56' : 'w-16'
      )}
    >
      {/* Logo */}
      <div className={clsx('flex items-center gap-3 px-4 h-16 border-b border-surface-border', !open && 'justify-center px-0')}>
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <Truck size={16} className="text-white" />
        </div>
        {open && (
          <div>
            <p className="text-sm font-bold text-white leading-tight">DSP Fleet</p>
            <p className="text-xs text-slate-400">Manager</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
        {navItems.map((item, i) => {
          if (item.divider) {
            return <div key={i} className="my-2 mx-3 border-t border-surface-border" />;
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 mx-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 group relative',
                  isActive
                    ? 'bg-primary/20 text-primary'
                    : 'text-slate-400 hover:bg-surface-hover hover:text-slate-200',
                  !open && 'justify-center px-0 mx-2'
                )
              }
              title={!open ? item.label : undefined}
            >
              <item.icon size={18} className="flex-shrink-0" />
              {open && <span>{item.label}</span>}
              {!open && (
                <span className="absolute left-14 bg-sidebar border border-surface-border text-slate-200 text-xs px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
                  {item.label}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Toggle */}
      <button
        onClick={onToggle}
        className="flex items-center justify-center h-10 border-t border-surface-border text-slate-400 hover:text-slate-200 hover:bg-surface-hover transition-colors"
      >
        {open ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>
    </aside>
  );
}
