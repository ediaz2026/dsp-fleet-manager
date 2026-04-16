import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Search, RefreshCw, X, CheckCircle, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import api from '../api/client';
import toast from 'react-hot-toast';
import Modal from './Modal';

const CARD = 'bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-5 space-y-4';

const getDriverInviteStatus = (d) => {
  if (d.last_login) return 'active';
  if (d.invitation_sent_at) return 'invited';
  return 'not_sent';
};

export default function InvitationsPanel({ enabled = true }) {
  const [inviteFilter,      setInviteFilter]      = useState('all'); // 'all' | 'not_sent' | 'invited' | 'active'
  const [inviteSearch,      setInviteSearch]      = useState('');
  const [selectedIds,       setSelectedIds]       = useState(new Set());
  const [showInviteConfirm, setShowInviteConfirm] = useState(false);
  const [inviteResults,     setInviteResults]     = useState(null);
  const [resendingId,       setResendingId]       = useState(null);

  const { data: driverList = [], refetch: refetchDrivers } = useQuery({
    queryKey: ['invite-drivers'],
    queryFn: () => api.get('/auth/users').then(r => r.data.filter(u => u.role === 'driver')),
    enabled,
  });

  const sendInvitations = useMutation({
    mutationFn: (staffIds) => api.post('/auth/send-invitations', { staffIds }).then(r => r.data),
    onSuccess: (data) => {
      setInviteResults(data.results);
      setSelectedIds(new Set());
      setShowInviteConfirm(false);
      refetchDrivers();
      const sent = data.results.filter(r => r.success).length;
      const skipped = data.results.filter(r => r.skipped).length;
      const failed = data.results.filter(r => !r.success && !r.skipped).length;
      if (sent > 0) toast.success(`${sent} invitation${sent !== 1 ? 's' : ''} sent${skipped > 0 ? `, ${skipped} skipped (no email)` : ''}`);
      if (failed > 0) toast.error(`${failed} failed — email service may not be configured. Invitation links are shown below.`);
      if (sent === 0 && skipped > 0) toast(`${skipped} driver${skipped !== 1 ? 's' : ''} skipped — no email address`, { icon: '⚠️' });
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to send invitations'),
  });

  const resendInvitation = useMutation({
    mutationFn: (staffId) => {
      setResendingId(staffId);
      return api.post(`/auth/resend-invitation/${staffId}`).then(r => r.data);
    },
    onSuccess: (data) => {
      setResendingId(null);
      refetchDrivers();
      if (data.emailSent) {
        toast.success(`Invitation sent to ${data.name}`);
      } else {
        toast(`Link saved for ${data.name} — copy it below (email not sent)`, { icon: '⚠️' });
        setInviteResults([{ id: 0, success: false, name: data.name, error: 'Email not sent', inviteUrl: data.inviteUrl }]);
      }
    },
    onError: (err) => {
      setResendingId(null);
      toast.error(err.response?.data?.error || 'Failed to resend invitation');
    },
  });

  const inviteDrivers = driverList.filter(d => {
    const status = getDriverInviteStatus(d);
    if (inviteFilter !== 'all' && status !== inviteFilter) return false;
    if (inviteSearch) {
      const q = inviteSearch.toLowerCase();
      return `${d.first_name} ${d.last_name} ${d.email}`.toLowerCase().includes(q);
    }
    return true;
  });

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleSelectAll = () => {
    if (selectedIds.size === inviteDrivers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(inviteDrivers.map(d => d.id)));
    }
  };

  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Send Invitations</h1>
          <p className="text-sm text-slate-500 mt-1">Select drivers to send portal invitation emails. Drivers receive a 7-day link to set their password.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <button
            className="btn-ghost text-xs"
            onClick={() => setSelectedIds(new Set(driverList.filter(d => getDriverInviteStatus(d) === 'not_sent').map(d => d.id)))}
          >
            Select All Not Sent
          </button>
          {selectedIds.size > 0 && (
            <button
              className="btn-primary text-xs"
              onClick={() => setShowInviteConfirm(true)}
            >
              <RefreshCw size={14} /> Send to {selectedIds.size} Selected
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-8 py-1.5 text-sm"
            placeholder="Search drivers…"
            value={inviteSearch}
            onChange={e => setInviteSearch(e.target.value)}
          />
        </div>
        {['all','not_sent','invited','active'].map(f => (
          <button
            key={f}
            onClick={() => setInviteFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              inviteFilter === f
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {{ all: 'All', not_sent: 'Not Sent', invited: 'Invited', active: 'Active' }[f]}
            <span className="ml-1.5 opacity-70">
              {f === 'all' ? driverList.length : driverList.filter(d => getDriverInviteStatus(d) === f).length}
            </span>
          </button>
        ))}
      </div>

      {/* Results banner */}
      {inviteResults && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-blue-800">Invitation results</p>
            <button onClick={() => setInviteResults(null)} className="text-blue-400 hover:text-blue-600"><X size={14} /></button>
          </div>
          {inviteResults.map((r, i) => (
            <div key={i} className={`text-xs ${r.success ? 'text-green-700' : 'text-amber-700'}`}>
              <p className="flex items-center gap-1.5">
                {r.success ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                {r.name || `ID ${r.id}`} — {r.success ? 'Email sent' : r.error}
              </p>
              {!r.success && r.inviteUrl && (
                <div className="mt-1 ml-4 flex items-center gap-2">
                  <input readOnly value={r.inviteUrl} className="flex-1 text-[10px] bg-white border border-amber-200 rounded px-2 py-0.5 font-mono text-amber-800 truncate" onClick={e => e.target.select()} />
                  <button className="text-[10px] text-blue-600 hover:underline whitespace-nowrap" onClick={() => { navigator.clipboard.writeText(r.inviteUrl); toast.success('Link copied'); }}>Copy</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Driver table */}
      <section className={CARD + ' !p-0 overflow-hidden'}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-slate-50">
              <th className="px-4 py-3 w-8">
                <input
                  type="checkbox"
                  className="rounded accent-blue-600"
                  checked={inviteDrivers.length > 0 && selectedIds.size === inviteDrivers.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="th text-left px-3 py-3">Name</th>
              <th className="th text-left px-3 py-3">Email</th>
              <th className="th text-center px-3 py-3">Status</th>
              <th className="th text-center px-3 py-3">Invited</th>
              <th className="th text-center px-3 py-3">Last Login</th>
              <th className="th px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {inviteDrivers.map(d => {
              const invStatus = getDriverInviteStatus(d);
              const statusBadge = {
                not_sent: <span className="badge bg-slate-100 text-slate-500 text-[10px]">Not Sent</span>,
                invited:  <span className="badge bg-amber-100 text-amber-700 text-[10px]">Invited</span>,
                active:   <span className="badge bg-green-100 text-green-700 text-[10px]">Active</span>,
              }[invStatus];
              return (
                <tr key={d.id} className="border-b border-[#E2E8F0] hover:bg-blue-50/30 transition-colors">
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      className="rounded accent-blue-600"
                      checked={selectedIds.has(d.id)}
                      onChange={() => toggleSelect(d.id)}
                    />
                  </td>
                  <td className="px-3 py-2.5 font-medium text-[#111827]">{d.first_name} {d.last_name}</td>
                  <td className="px-3 py-2.5 text-[#475569] text-xs">{d.email}</td>
                  <td className="px-3 py-2.5 text-center">{statusBadge}</td>
                  <td className="px-3 py-2.5 text-center text-xs text-[#475569]">
                    {d.invitation_sent_at ? format(new Date(d.invitation_sent_at), 'MM/dd/yy') : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs text-[#475569]">
                    {d.last_login ? format(new Date(d.last_login), 'MM/dd/yy') : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {d.invitation_sent_at && (
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">Sent {format(new Date(d.invitation_sent_at), 'M/d')}</span>
                      )}
                      <button
                        className="btn-ghost text-xs"
                        disabled={resendingId === d.id}
                        onClick={() => resendInvitation.mutate(d.id)}
                      >
                        {resendingId === d.id ? 'Sending…' : d.invitation_sent_at ? 'Resend' : 'Send'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {inviteDrivers.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-[#94a3b8]">No drivers match the current filter</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Confirm modal */}
      <Modal isOpen={showInviteConfirm} onClose={() => setShowInviteConfirm(false)} title="Confirm Send Invitations">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Send portal invitation emails to <strong>{selectedIds.size}</strong> driver{selectedIds.size !== 1 ? 's' : ''}? Each driver will receive a unique link valid for 7 days.
          </p>
          <div className="bg-slate-50 rounded-lg p-3 max-h-40 overflow-y-auto space-y-1">
            {[...selectedIds].map(id => {
              const d = driverList.find(x => x.id === id);
              return d ? <p key={id} className="text-xs text-slate-700">• {d.first_name} {d.last_name} <span className="text-slate-400">({d.email})</span></p> : null;
            })}
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost text-sm" onClick={() => setShowInviteConfirm(false)}>Cancel</button>
            <button
              className="btn-primary text-sm"
              disabled={sendInvitations.isPending}
              onClick={() => sendInvitations.mutate([...selectedIds])}
            >
              {sendInvitations.isPending ? 'Sending…' : `Send ${selectedIds.size} Invitation${selectedIds.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
