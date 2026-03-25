import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import toast from 'react-hot-toast';
import { Lock, Eye, EyeOff } from 'lucide-react';

export default function ChangePassword() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const isForcedChange = user?.mustChangePassword;

  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    if (form.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      toast.success('Password changed successfully');
      // Clear the mustChangePassword flag from localStorage user
      const updatedUser = { ...user, mustChangePassword: false };
      localStorage.setItem('dsp_user', JSON.stringify(updatedUser));
      // Navigate to role home
      const role = user?.role;
      if (role === 'driver') navigate('/my-schedule', { replace: true });
      else if (role === 'manager' || role === 'dispatcher') navigate('/schedule', { replace: true });
      else navigate('/', { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-md mx-auto">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[#E2E8F0]">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
            <Lock size={18} className="text-[#2563EB]" />
          </div>
          <div>
            <h1 className="text-[18px] font-bold text-[#1E3A5F]">
              {isForcedChange ? 'Set a New Password' : 'Change Password'}
            </h1>
            {isForcedChange && (
              <p className="text-sm text-[#475569]">Your administrator requires you to set a new password.</p>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Current password — skip for forced changes */}
          {!isForcedChange && (
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1.5">
                Current Password
              </label>
              <div className="relative">
                <input
                  type={showCurrent ? 'text' : 'password'}
                  className="input pr-10"
                  value={form.currentPassword}
                  onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))}
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1.5">
              New Password
            </label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                className="input pr-10"
                value={form.newPassword}
                onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}
                placeholder="At least 6 characters"
                required
              />
              <button
                type="button"
                onClick={() => setShowNew(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1.5">
              Confirm New Password
            </label>
            <input
              type="password"
              className="input"
              value={form.confirmPassword}
              onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
              placeholder="••••••••"
              required
            />
          </div>

          <div className="flex gap-3 pt-2">
            {!isForcedChange && (
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="btn-secondary flex-1 justify-center"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="btn-primary flex-1 justify-center"
              disabled={loading}
            >
              {loading ? 'Saving…' : 'Change Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
