import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Edit2, AlertTriangle, User, Phone, Shield } from 'lucide-react';
import api from '../api/client';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import toast from 'react-hot-toast';
import { format, differenceInDays } from 'date-fns';
import { useAuth } from '../App';

export default function Drivers() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [profileModal, setProfileModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const isManager = ['manager', 'admin'].includes(user?.role);

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get('/drivers').then(r => r.data),
  });

  const { data: staffList = [] } = useQuery({
    queryKey: ['staff-all'],
    queryFn: () => api.get('/staff', { params: { role: 'driver' } }).then(r => r.data),
    enabled: showModal,
  });

  const saveMutation = useMutation({
    mutationFn: data => editing ? api.put(`/drivers/${editing.id}`, data) : api.post('/drivers', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drivers'] });
      toast.success(editing ? 'Driver updated' : 'Driver profile created');
      setShowModal(false); setEditing(null);
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed'),
  });

  const { data: summary } = useQuery({
    queryKey: ['driver-summary', profileModal?.staff_id],
    queryFn: () => api.get(`/staff/${profileModal.staff_id}/attendance-summary`).then(r => r.data),
    enabled: !!profileModal,
  });

  const openEdit = (d) => {
    setEditing(d);
    setForm({
      ...d,
      license_expiration: d.license_expiration?.split('T')[0] || '',
      dob: d.dob?.split('T')[0] || '',
    });
    setShowModal(true);
  };

  const filtered = drivers.filter(d =>
    `${d.first_name} ${d.last_name} ${d.employee_id}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Driver Profiles</h1>
        {isManager && <button className="btn-primary" onClick={() => { setEditing(null); setForm({ license_class: 'D', license_state: 'FL' }); setShowModal(true); }}><Plus size={16} /> Add Driver Profile</button>}
      </div>

      <input type="text" className="input max-w-sm" placeholder="Search drivers…" value={search} onChange={e => setSearch(e.target.value)} />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="card h-40 animate-pulse bg-surface-hover" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(d => {
            const licExpDays = d.license_expiration ? differenceInDays(new Date(d.license_expiration), new Date()) : 999;
            return (
              <div key={d.id} className={`card cursor-pointer hover:border-primary/50 transition-colors ${licExpDays <= 60 ? 'border-yellow-500/30' : ''}`}
                onClick={() => setProfileModal(d)}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/20 text-primary font-bold text-sm flex items-center justify-center">
                      {d.first_name[0]}{d.last_name[0]}
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-100">{d.first_name} {d.last_name}</h3>
                      <p className="text-xs text-slate-500">{d.employee_id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge status={d.employment_status} />
                    {isManager && <button onClick={e => { e.stopPropagation(); openEdit(d); }} className="btn-ghost p-1.5 rounded-lg"><Edit2 size={14} /></button>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-slate-500">License</span><p className="text-slate-300 font-mono">{d.license_number || '—'}</p></div>
                  <div>
                    <span className="text-slate-500">License Exp.</span>
                    <p className={licExpDays <= 60 ? 'text-yellow-400' : 'text-slate-300'}>
                      {d.license_expiration ? format(new Date(d.license_expiration), 'MM/dd/yyyy') : '—'}
                      {licExpDays <= 60 && <AlertTriangle size={10} className="inline ml-1" />}
                    </p>
                  </div>
                  <div><span className="text-slate-500">State/Class</span><p className="text-slate-300">{d.license_state} — Class {d.license_class}</p></div>
                  <div><span className="text-slate-500">Transponder</span><p className="text-slate-300">{d.transponder_id || '—'}</p></div>
                  <div><span className="text-slate-500">Hire Date</span><p className="text-slate-300">{d.hire_date ? format(new Date(d.hire_date), 'MM/dd/yyyy') : '—'}</p></div>
                  <div><span className="text-slate-500">Phone</span><p className="text-slate-300">{d.phone || '—'}</p></div>
                </div>

                {d.emergency_contact_name && (
                  <div className="mt-3 pt-3 border-t border-surface-border text-xs">
                    <span className="text-slate-500">Emergency: </span>
                    <span className="text-slate-400">{d.emergency_contact_name} ({d.emergency_contact_relation}) {d.emergency_contact_phone}</span>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center py-16 text-slate-500">No driver profiles found</div>
          )}
        </div>
      )}

      {/* Profile Detail Modal */}
      <Modal isOpen={!!profileModal} onClose={() => setProfileModal(null)} title={`${profileModal?.first_name} ${profileModal?.last_name}`} size="lg">
        {profileModal && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <InfoRow icon={User} label="Employee ID" value={profileModal.employee_id} />
              <InfoRow icon={Shield} label="License #" value={profileModal.license_number} />
              <InfoRow label="License Expires" value={profileModal.license_expiration ? format(new Date(profileModal.license_expiration), 'MMM d, yyyy') : '—'} />
              <InfoRow label="State / Class" value={`${profileModal.license_state} — Class ${profileModal.license_class}`} />
              <InfoRow label="Date of Birth" value={profileModal.dob ? format(new Date(profileModal.dob), 'MMM d, yyyy') : '—'} />
              <InfoRow label="Transponder" value={profileModal.transponder_id} />
              <InfoRow label="Hire Date" value={profileModal.hire_date ? format(new Date(profileModal.hire_date), 'MMM d, yyyy') : '—'} />
              <InfoRow label="Email" value={profileModal.email} />
              <InfoRow icon={Phone} label="Phone" value={profileModal.phone} />
              <InfoRow label="Address" value={[profileModal.address, profileModal.city, profileModal.state, profileModal.zip].filter(Boolean).join(', ')} />
            </div>
            {profileModal.emergency_contact_name && (
              <div className="border-t border-surface-border pt-4">
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-2">Emergency Contact</p>
                <p className="text-slate-300">{profileModal.emergency_contact_name} — {profileModal.emergency_contact_relation}</p>
                <p className="text-slate-400">{profileModal.emergency_contact_phone}</p>
              </div>
            )}
            {summary && (
              <div className="border-t border-surface-border pt-4">
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-3">Attendance (90 days)</p>
                <div className="grid grid-cols-4 gap-3 text-center text-sm">
                  <Stat label="Present" value={summary.present_count} color="text-green-400" />
                  <Stat label="Called Out" value={summary.called_out_count} color="text-orange-400" />
                  <Stat label="NCNS" value={summary.ncns_count} color="text-red-400" />
                  <Stat label="Late" value={summary.late_count} color="text-yellow-400" />
                </div>
              </div>
            )}
            {profileModal.notes && (
              <div className="border-t border-surface-border pt-4">
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-1">Notes</p>
                <p className="text-slate-400 text-sm">{profileModal.notes}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Driver Profile' : 'Add Driver Profile'} size="lg">
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); saveMutation.mutate(form); }}>
          {!editing && (
            <div><label className="label">Staff Member *</label>
              <select className="select" required value={form.staff_id || ''} onChange={e => setForm(f => ({ ...f, staff_id: e.target.value }))}>
                <option value="">Select staff…</option>
                {staffList.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.employee_id})</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">License Number</label><input className="input" value={form.license_number || ''} onChange={e => setForm(f => ({ ...f, license_number: e.target.value }))} /></div>
            <div><label className="label">License Expiration</label><input type="date" className="input" value={form.license_expiration || ''} onChange={e => setForm(f => ({ ...f, license_expiration: e.target.value }))} /></div>
            <div><label className="label">State</label><input className="input" maxLength={2} value={form.license_state || ''} onChange={e => setForm(f => ({ ...f, license_state: e.target.value.toUpperCase() }))} /></div>
            <div><label className="label">Class</label><input className="input" value={form.license_class || ''} onChange={e => setForm(f => ({ ...f, license_class: e.target.value }))} /></div>
            <div><label className="label">Date of Birth</label><input type="date" className="input" value={form.dob || ''} onChange={e => setForm(f => ({ ...f, dob: e.target.value }))} /></div>
            <div><label className="label">Transponder ID</label><input className="input" value={form.transponder_id || ''} onChange={e => setForm(f => ({ ...f, transponder_id: e.target.value }))} /></div>
            <div><label className="label">Emergency Contact</label><input className="input" value={form.emergency_contact_name || ''} onChange={e => setForm(f => ({ ...f, emergency_contact_name: e.target.value }))} placeholder="Full name" /></div>
            <div><label className="label">Contact Phone</label><input className="input" value={form.emergency_contact_phone || ''} onChange={e => setForm(f => ({ ...f, emergency_contact_phone: e.target.value }))} /></div>
            <div><label className="label">Relation</label><input className="input" value={form.emergency_contact_relation || ''} onChange={e => setForm(f => ({ ...f, emergency_contact_relation: e.target.value }))} placeholder="Spouse, Parent…" /></div>
          </div>
          <div><label className="label">Notes</label><textarea className="input min-h-16 resize-none" value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setShowModal(false)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={saveMutation.isPending}>{saveMutation.isPending ? 'Saving…' : editing ? 'Update' : 'Add'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-500 flex items-center gap-1">{Icon && <Icon size={11} />}{label}</p>
      <p className="text-slate-300">{value || '—'}</p>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="card py-2">
      <p className={`text-xl font-bold ${color}`}>{value || 0}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
