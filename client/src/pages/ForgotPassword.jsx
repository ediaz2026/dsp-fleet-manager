import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import toast from 'react-hot-toast';
import { Truck, ArrowLeft } from 'lucide-react';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch {
      toast.error('Something went wrong. Please try again.');
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
          <p className="text-blue-300 text-sm mt-1">Reset your password</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
          {sent ? (
            <div className="space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm text-slate-700 font-medium">Check your email</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                If <strong>{email}</strong> is registered, you'll receive a password reset link shortly. The link expires in 24 hours.
              </p>
              <Link to="/login" className="btn-primary w-full justify-center py-2.5 text-sm flex items-center gap-2">
                <ArrowLeft size={14} /> Back to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-slate-600">
                Enter your work email address and we'll send you a link to reset your password.
              </p>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1.5">Work Email</label>
                <input
                  type="email"
                  className="input"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@dspfleet.com"
                  required
                  autoFocus
                />
              </div>
              <button type="submit" className="btn-primary w-full justify-center py-2.5 text-base" disabled={loading}>
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
              <Link to="/login" className="flex items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-slate-700">
                <ArrowLeft size={12} /> Back to Login
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
