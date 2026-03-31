import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { Truck, Eye, EyeOff } from 'lucide-react';

export default function AcceptInvitation() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [status, setStatus] = useState('verifying'); // verifying | valid | invalid | used | expired
  const [firstName, setFirstName] = useState('');
  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get(`/auth/verify-invitation/${token}`)
      .then(({ data }) => {
        if (data.valid) {
          setFirstName(data.firstName || '');
          setStatus('valid');
        } else if (data.reason === 'expired') {
          setStatus('expired');
        } else {
          setStatus('used');
        }
      })
      .catch(() => setStatus('invalid'));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      return toast.error('Passwords do not match');
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/accept-invitation', { token, newPassword: form.newPassword });
      login(data.user, data.token);
      toast.success(`Welcome, ${data.user.firstName}!`);
      navigate('/my-schedule', { replace: true });
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not set up account. Contact your manager.';
      toast.error(msg);
      // If the token was consumed or expired during form fill, update the UI
      if (err.response?.status === 400 && msg.includes('expired')) setStatus('expired');
      else if (err.response?.status === 400 && (msg.includes('no longer valid') || msg.includes('already been used'))) setStatus('used');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1E3A5F] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#2563EB] mb-4 shadow-lg">
            <Truck size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">DSP Fleet Manager</h1>
          <p className="text-blue-300 text-sm mt-1">Set up your account</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          {status === 'verifying' && (
            <p className="text-sm text-slate-500 text-center py-4">Loading your invitation…</p>
          )}

          {status === 'expired' && (
            <div className="space-y-3 text-center py-2">
              <p className="text-sm font-medium text-red-600">This invitation link has expired.</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Invitation links are valid for 7 days. Please contact your manager or dispatcher to send a new invitation.
              </p>
            </div>
          )}

          {status === 'used' && (
            <div className="space-y-3 text-center py-2">
              <p className="text-sm font-medium text-amber-600">This invitation link has already been used.</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                If you already set up your password, you can <a href="/login" className="text-blue-600 font-semibold hover:underline">log in here</a>.
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                If you're having trouble logging in, contact your manager to send a new invitation.
              </p>
            </div>
          )}

          {status === 'invalid' && (
            <div className="space-y-3 text-center py-2">
              <p className="text-sm font-medium text-red-600">This invitation link is not valid.</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Please contact your manager or dispatcher to receive a new invitation.
              </p>
            </div>
          )}

          {status === 'valid' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {firstName && (
                <div className="text-center pb-1">
                  <p className="text-lg font-semibold text-slate-800">Welcome, {firstName}!</p>
                  <p className="text-xs text-slate-500 mt-1">Choose a password to access your schedule.</p>
                </div>
              )}
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1.5">New Password</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    className="input pr-10"
                    value={form.newPassword}
                    onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}
                    placeholder="At least 6 characters"
                    required
                    autoFocus
                    minLength={6}
                  />
                  <button type="button" onClick={() => setShowPass(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1.5">Confirm Password</label>
                <input
                  type={showPass ? 'text' : 'password'}
                  className="input"
                  value={form.confirmPassword}
                  onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                  placeholder="Repeat your password"
                  required
                />
              </div>
              <button type="submit" className="btn-primary w-full justify-center py-2.5 text-base" disabled={loading}>
                {loading ? 'Setting up…' : 'Set Up My Account'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
