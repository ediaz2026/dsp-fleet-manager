import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { CalendarDays, Calendar, ClipboardCheck, Star, User } from 'lucide-react';

const TABS = [
  { to: '/today', icon: CalendarDays, label: 'Today' },
  { to: '/my-schedule', icon: Calendar, label: 'Schedule' },
  { to: '/my-attendance', icon: ClipboardCheck, label: 'Attendance' },
  { to: '/my-scorecard', icon: Star, label: 'Scorecard' },
  { to: '/my-profile', icon: User, label: 'Profile' },
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
                className={`flex flex-col items-center justify-center gap-1 py-3 px-3 min-w-[64px] transition-colors ${active ? 'text-[#1a3a5c]' : 'text-slate-400'}`}
              >
                <t.icon size={26} strokeWidth={active ? 2.5 : 1.5} />
                <span className={`text-[13px] font-semibold ${active ? 'text-[#1a3a5c]' : 'text-slate-400'}`}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
