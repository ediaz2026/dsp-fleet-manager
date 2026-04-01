import { useNavigate } from 'react-router-dom';
import { Lock, LogOut, Mail, Phone, User, Shield, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

function titleCase(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export default function DriverProfile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const firstName = titleCase(user?.firstName);
  const lastName = titleCase(user?.lastName);
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`;

  return (
    <div className="bg-[#F1F5F9]">
      {/* Header */}
      <div className="bg-[#1a3a5c] text-white px-5 pt-[max(env(safe-area-inset-top),20px)] pb-8 rounded-b-3xl">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-xl font-bold">
            {initials}
          </div>
          <div>
            <h1 className="text-xl font-bold">{firstName} {lastName}</h1>
            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold uppercase tracking-wide bg-white/15 text-blue-200 px-2 py-0.5 rounded-full">
              <Shield size={10} /> Driver
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 -mt-4 space-y-4 pb-8">
        {/* My Info */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="font-bold text-sm text-[#111827]">My Info</p>
          </div>
          <div className="divide-y divide-slate-100">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <User size={16} className="text-slate-400 flex-shrink-0" />
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase">Name</p>
                <p className="text-sm font-medium text-[#111827]">{firstName} {lastName}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3.5">
              <Mail size={16} className="text-slate-400 flex-shrink-0" />
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase">Work Email</p>
                <p className="text-sm font-medium text-[#111827]">{user?.email || '—'}</p>
              </div>
            </div>
            {user?.phone && (
              <div className="flex items-center gap-3 px-4 py-3.5">
                <Phone size={16} className="text-slate-400 flex-shrink-0" />
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase">Phone</p>
                  <p className="text-sm font-medium text-[#111827]">{user.phone}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Account */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="font-bold text-sm text-[#111827]">Account</p>
          </div>
          <div className="divide-y divide-slate-100">
            <button
              onClick={() => navigate('/change-password')}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors"
            >
              <Lock size={16} className="text-slate-400" />
              <p className="text-sm font-medium text-[#111827]">Change Password</p>
            </button>
            <button
              onClick={() => { logout(); navigate('/login'); }}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-50 transition-colors"
            >
              <LogOut size={16} className="text-red-500" />
              <p className="text-sm font-medium text-red-600">Log Out</p>
            </button>
          </div>
        </div>

        {/* App Info */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="font-bold text-sm text-[#111827]">App Info</p>
          </div>
          <div className="divide-y divide-slate-100">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <Info size={16} className="text-slate-400 flex-shrink-0" />
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase">Version</p>
                <p className="text-sm font-medium text-[#111827]">1.0.0</p>
              </div>
            </div>
            <div className="px-4 py-3.5 text-center">
              <p className="text-xs text-slate-400">Powered by <span className="font-semibold text-slate-500">EZ Dashboard</span></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
