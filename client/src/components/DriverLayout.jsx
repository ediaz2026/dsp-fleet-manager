import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { CalendarDays, Calendar, ClipboardCheck, Star, User } from 'lucide-react';

const TABS = [
  { to: '/today',         icon: CalendarDays,   label: 'Today',      color: '#2563eb', bg: '#eff6ff' },
  { to: '/my-schedule',   icon: Calendar,       label: 'Schedule',   color: '#16a34a', bg: '#f0fdf4' },
  { to: '/my-attendance', icon: ClipboardCheck, label: 'Attendance', color: '#d97706', bg: '#fef3c7' },
  { to: '/my-scorecard',  icon: Star,           label: 'Scorecard',  color: '#7c3aed', bg: '#f5f3ff' },
  { to: '/my-profile',    icon: User,           label: 'Profile',    color: '#e11d48', bg: '#fff1f2' },
];

export default function DriverLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[#F1F5F9] flex flex-col">
      {/* Content — no top nav, scrollable */}
      <main className="flex-1 pb-24">
        <Outlet />
      </main>

      {/* Bottom tab bar — always visible */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 px-2"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}
      >
        <div className="flex justify-around max-w-lg mx-auto" style={{ minHeight: '80px' }}>
          {TABS.map(t => {
            const active = location.pathname === t.to;
            return (
              <button
                key={t.to}
                onClick={() => navigate(t.to)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', gap: '3px', minWidth: '64px',
                  padding: active ? '6px 12px' : '6px 10px',
                  background: active ? t.bg : 'transparent',
                  borderRadius: active ? '12px' : 0,
                  transition: 'background 0.15s',
                }}
              >
                <t.icon
                  size={26}
                  strokeWidth={active ? 2 : 1.8}
                  color={active ? t.color : '#1a1a1a'}
                  fill={active ? t.color : 'none'}
                />
                <span style={{
                  fontSize: '13px',
                  fontWeight: active ? 700 : 500,
                  color: active ? t.color : '#1a1a1a',
                }}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
