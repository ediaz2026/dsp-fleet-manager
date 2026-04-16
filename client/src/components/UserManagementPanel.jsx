import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { format } from 'date-fns';
import api from '../api/client';
import toast from 'react-hot-toast';
import Modal from './Modal';
import Badge from './Badge';

const CARD = 'bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-5 space-y-4';

export default function UserManagementPanel({ enabled = true }) {
  const qc = useQueryClient();

  const [showAddUser, setShowAddUser] = useState(false);
  const [editUser,    setEditUser]    = useState(null);
  const [uForm,       setUForm]       = useState({ first_name:'', last_name:'', email:'', role:'dispatcher', password:'', must_change_password:true });
  const [editUForm,   setEditUForm]   = useState({ role:'', status:'', password:'' });

  const { data: userList = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/auth/users').then(r => r.data),
    enabled,
  });

  const createUser = useMutation({
    mutationFn: d => api.post('/auth/users', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowAddUser(false);
      setUForm({ first_name:'', last_name:'', email:'', role:'dispatcher', password:'', must_change_password:true });
      toast.success('User created');
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to create user'),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, ...d }) => api.put(`/auth/users/${id}`, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditUser(null);
      toast.success('User updated');
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to update user'),
  });

  const openEditUser = (u) => { setEditUser(u); setEditUForm({ role: u.role, status: u.status, password: '' }); };

  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
          <p className="text-sm text-slate-500 mt-1">Manage admin, manager, and dispatcher accounts. Driver accounts are managed from the <span className="font-medium text-blue-600">Driver Profile</span>.</p>
        </div>
        <button className="btn-primary text-xs shrink-0 ml-4" onClick={() => setShowAddUser(true)}><UserPlus size={14} /> Add User</button>
      </div>
      <section className={CARD + ' !p-0 overflow-hidden'}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-slate-50">
              <th className="th text-left px-4 py-3">Name</th>
              <th className="th text-left px-3 py-3">Email</th>
              <th className="th text-center px-3 py-3">Role</th>
              <th className="th text-center px-3 py-3">Last Login</th>
              <th className="th text-center px-3 py-3">Status</th>
              <th className="th px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {userList.map(u => {
              const isDriverRole = u.role === 'driver';
              return (
                <tr key={u.id} className={`border-b border-[#E2E8F0] transition-colors ${isDriverRole ? 'bg-slate-50/60' : 'hover:bg-blue-50/40'}`}>
                  <td className="px-4 py-2.5 font-medium text-[#111827]">
                    {u.first_name} {u.last_name}
                    {!isDriverRole && u.must_change_password && <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Temp PW</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[#475569]">{u.email}</td>
                  <td className="px-3 py-2.5 text-center"><Badge status={u.role === 'manager' ? 'dispatcher' : u.role} label={u.role === 'manager' ? 'Dispatcher' : u.role} /></td>
                  <td className="px-3 py-2.5 text-center text-xs text-[#475569]">{u.last_login ? format(new Date(u.last_login), 'MM/dd/yy h:mm a') : 'Never'}</td>
                  <td className="px-3 py-2.5 text-center"><span className={`badge text-xs ${u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{u.status}</span></td>
                  <td className="px-3 py-2.5 text-right">
                    {isDriverRole
                      ? <span className="text-[11px] text-[#94a3b8] italic">Manage from Driver Profile</span>
                      : <button className="btn-ghost text-xs" onClick={() => openEditUser(u)}>Edit</button>
                    }
                  </td>
                </tr>
              );
            })}
            {userList.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-[#94a3b8]">No users found</td></tr>}
          </tbody>
        </table>
      </section>

      {/* Add User Modal */}
      <Modal isOpen={showAddUser} onClose={() => setShowAddUser(false)} title="Add New User">
        <form onSubmit={e => { e.preventDefault(); createUser.mutate(uForm); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="modal-label">First Name</label><input className="input" value={uForm.first_name} onChange={e => setUForm(f => ({ ...f, first_name: e.target.value }))} /></div>
            <div><label className="modal-label">Last Name</label><input className="input" value={uForm.last_name} onChange={e => setUForm(f => ({ ...f, last_name: e.target.value }))} /></div>
          </div>
          <div><label className="modal-label">Email *</label><input type="email" className="input" required value={uForm.email} onChange={e => setUForm(f => ({ ...f, email: e.target.value }))} /></div>
          <div><label className="modal-label">Role *</label>
            <select className="select" required value={uForm.role} onChange={e => setUForm(f => ({ ...f, role: e.target.value }))}>
              <option value="dispatcher">Dispatcher</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div><label className="modal-label">Temporary Password *</label><input type="password" className="input" required minLength={6} value={uForm.password} onChange={e => setUForm(f => ({ ...f, password: e.target.value }))} /></div>
          <label className="flex items-center gap-2 text-sm text-[#374151] cursor-pointer select-none">
            <input type="checkbox" className="rounded accent-[#2563EB]" checked={uForm.must_change_password} onChange={e => setUForm(f => ({ ...f, must_change_password: e.target.checked }))} />
            Require password change on first login
          </label>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setShowAddUser(false)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={createUser.isPending}>{createUser.isPending ? 'Creating…' : 'Create User'}</button>
          </div>
        </form>
      </Modal>

      {/* Edit User Modal */}
      <Modal isOpen={!!editUser} onClose={() => setEditUser(null)} title={editUser ? `Edit — ${editUser.first_name} ${editUser.last_name}` : ''}>
        <form onSubmit={e => { e.preventDefault(); const payload = { id: editUser.id, role: editUForm.role, status: editUForm.status }; if (editUForm.password) payload.password = editUForm.password; updateUser.mutate(payload); }} className="space-y-4">
          <div><label className="modal-label">Role</label>
            <select className="select" value={editUForm.role} onChange={e => setEditUForm(f => ({ ...f, role: e.target.value }))}>
              <option value="dispatcher">Dispatcher</option><option value="manager">Manager</option><option value="admin">Admin</option>
            </select>
          </div>
          <div><label className="modal-label">Status</label>
            <select className="select" value={editUForm.status} onChange={e => setEditUForm(f => ({ ...f, status: e.target.value }))}>
              <option value="active">Active</option><option value="inactive">Inactive</option>
            </select>
          </div>
          <div><label className="modal-label">Reset Password (optional)</label>
            <input type="password" className="input" minLength={6} value={editUForm.password} onChange={e => setEditUForm(f => ({ ...f, password: e.target.value }))} placeholder="Leave blank to keep current" />
            {editUForm.password && <p className="text-xs text-amber-600 mt-1">User will be required to change this password on next login.</p>}
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setEditUser(null)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={updateUser.isPending}>{updateUser.isPending ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
