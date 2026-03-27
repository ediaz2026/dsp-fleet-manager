import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import { Truck, Eye, EyeOff, AlertCircle } from 'lucide-react';

const ERROR_MESSAGES = {
  EMAIL_NOT_FOUND:  'No account found with that email address.',
  WRONG_PASSWORD:   'Incorrect password. Please try again.',
  ACCOUNT_LOCKED:   null, // built dynamically below
  ACCOUNT_INACTIVE: 'Your account is inactive. Please contact your manager.',
};

function getErrorMessage(code, data) {
  if (code === 'ACCOUNT_LOCKED') {
    const mins = data?.minutesLeft || 30;
    return `Account locked due to too many failed attempts. Please try again in ${mins} minute${mins !== 1 ? 's' : ''} or contact your manager.`;
  }
  return ERROR_MESSAGES[code] || 'Sign in failed. Please try again.';
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState(null); // { message, attemptsLeft? }

  const handleChange = (field) => (e) => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email.trim() || !form.password) {
      setError({ message: 'Please enter your email and password.' });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post('/auth/login', { ...form, rememberMe });
      login(data.user, data.token);
      if (data.must_change_password) {
        navigate('/change-password', { replace: true });
        return;
      }
      const role = data.user.role;
      if (role === 'driver') navigate('/my-schedule', { replace: true });
      else if (role === 'manager' || role === 'dispatcher') navigate('/schedule', { replace: true });
      else navigate('/', { replace: true });
    } catch (err) {
      const code = err.response?.data?.error;
      const responseData = err.response?.data;
      setError({
        message: getErrorMessage(code, responseData),
        attemptsLeft: responseData?.attemptsLeft ?? null,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1E3A5F] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#2563EB] mb-4 shadow-lg">
            <Truck size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">DSP Fleet Manager</h1>
          <p className="text-blue-300 text-sm mt-1">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1.5">Email</label>
            <input
              type="email" className="input" value={form.email}
              onChange={handleChange('email')}
              placeholder="you@dspfleet.com" autoFocus
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'} className="input pr-10" value={form.password}
                onChange={handleChange('password')}
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPass(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-[#374151] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                className="rounded accent-[#2563EB]"
              />
              Remember me
            </label>
            <Link to="/forgot-password" className="text-xs text-[#2563EB] hover:text-[#1D4ED8]">
              Forgot password?
            </Link>
          </div>

          {/* Error box */}
          {error && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-700 leading-snug">
                <p>{error.message}</p>
                {error.attemptsLeft != null && error.attemptsLeft > 0 && (
                  <p className="mt-0.5 text-[12px] font-semibold text-red-600">
                    {error.attemptsLeft} attempt{error.attemptsLeft !== 1 ? 's' : ''} remaining before lockout.
                  </p>
                )}
              </div>
            </div>
          )}

          <button
            type="submit"
            className="btn-primary w-full justify-center py-2.5 text-base"
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
