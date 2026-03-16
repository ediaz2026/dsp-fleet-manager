import { Menu, Bell, LogOut, User } from 'lucide-react';
import { useAuth } from '../App';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';

export default function Header({ onMenuClick }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);

  const { data: alerts } = useQuery({
    queryKey: ['fleet-alerts'],
    queryFn: () => api.get('/vehicles/alerts').then(r => r.data),
    refetchInterval: 60000,
  });

  const alertCount = alerts?.length || 0;

  return (
    <header className="h-16 bg-surface-card border-b border-surface-border flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-4">
        <button onClick={onMenuClick} className="btn-ghost p-2 rounded-lg">
          <Menu size={20} />
        </button>
        <div className="text-sm text-slate-400">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Alerts bell */}
        <button
          onClick={() => navigate('/vehicles')}
          className="relative btn-ghost p-2 rounded-lg"
          title="Fleet Alerts"
        >
          <Bell size={18} />
          {alertCount > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
              {alertCount > 9 ? '9+' : alertCount}
            </span>
          )}
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(m => !m)}
            className="flex items-center gap-2 btn-ghost px-3 py-2 rounded-lg"
          >
            <div className="w-7 h-7 rounded-full bg-primary/30 flex items-center justify-center text-primary text-xs font-bold">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-medium text-slate-200 leading-tight">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-slate-400 capitalize">{user?.role}</p>
            </div>
          </button>

          {showMenu && (
            <div className="absolute right-0 top-12 w-48 bg-surface-card border border-surface-border rounded-xl shadow-xl z-50 py-1">
              <div className="px-3 py-2 border-b border-surface-border">
                <p className="text-sm font-medium text-slate-200">{user?.firstName} {user?.lastName}</p>
                <p className="text-xs text-slate-400">{user?.email}</p>
              </div>
              <button
                onClick={() => { setShowMenu(false); navigate('/settings'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-surface-hover"
              >
                <User size={14} /> Profile & Settings
              </button>
              <button
                onClick={() => { logout(); navigate('/login'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-surface-hover"
              >
                <LogOut size={14} /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>

      {showMenu && <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />}
    </header>
  );
}
