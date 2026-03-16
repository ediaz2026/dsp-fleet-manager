import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, QrCode, AlertTriangle, CheckCircle, Wrench, Edit2, RefreshCw } from 'lucide-react';
import api from '../api/client';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import toast from 'react-hot-toast';
import { format, differenceInDays } from 'date-fns';
import { useAuth } from '../App';

const emptyVehicle = {
  vehicle_name: '', license_plate: '', vin: '', make: '', model: '', year: new Date().getFullYear(),
  color: 'White', transponder_id: '', insurance_expiration: '', registration_expiration: '',
  last_inspection_date: '', next_inspection_date: '', status: 'active', notes: '',
};

function DaysLeft({ date, warnDays = 30 }) {
  if (!date) return <span className="text-slate-500">—</span>;
  const days = differenceInDays(new Date(date), new Date());
  const color = days <= 7 ? 'text-red-400' : days <= warnDays ? 'text-yellow-400' : 'text-green-400';
  return <span className={`${color} font-medium text-xs`}>{days <= 0 ? 'Expired' : `${days}d`}</span>;
}

export default function Vehicles() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyVehicle);
  const [qrVehicle, setQrVehicle] = useState(null);
  const [showAlertsOnly, setShowAlertsOnly] = useState(false);
  const isManager = ['manager', 'admin'].includes(user?.role);

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => api.get('/vehicles').then(r => r.data),
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['fleet-alerts'],
    queryFn: () => api.get('/vehicles/alerts').then(r => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: data => editing ? api.put(`/vehicles/${editing.id}`, data) : api.post('/vehicles', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success(editing ? 'Vehicle updated' : 'Vehicle added');
      setShowModal(false); setEditing(null);
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed'),
  });

  const checkExpMutation = useMutation({
    mutationFn: () => api.post('/vehicles/check-expirations'),
    onSuccess: data => { qc.invalidateQueries({ queryKey: ['fleet-alerts'] }); toast.success(data.data.message); },
  });

  const resolveAlert = useMutation({
    mutationFn: id => api.put(`/vehicles/alerts/${id}/resolve`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fleet-alerts'] }); toast.success('Alert resolved'); },
  });

  const openAdd = () => { setEditing(null); setForm(emptyVehicle); setShowModal(true); };
  const openEdit = (v) => { setEditing(v); setForm({ ...v, insurance_expiration: v.insurance_expiration?.split('T')[0] || '', registration_expiration: v.registration_expiration?.split('T')[0] || '', last_inspection_date: v.last_inspection_date?.split('T')[0] || '', next_inspection_date: v.next_inspection_date?.split('T')[0] || '' }); setShowModal(true); };

  const displayed = showAlertsOnly
    ? vehicles.filter(v => v.insurance_expiring || v.registration_expiring || v.inspection_due)
    : vehicles;

  const statusIcon = (v) => {
    if (v.status === 'maintenance') return <Wrench size={14} className="text-orange-400" />;
    if (v.insurance_expiring || v.registration_expiring || v.inspection_due) return <AlertTriangle size={14} className="text-yellow-400" />;
    return <CheckCircle size={14} className="text-green-400" />;
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Vehicle Fleet</h1>
        <div className="flex gap-2">
          {isManager && (
            <>
              <button className="btn-secondary" onClick={() => checkExpMutation.mutate()} disabled={checkExpMutation.isPending}>
                <RefreshCw size={15} className={checkExpMutation.isPending ? 'animate-spin' : ''} /> Check Expirations
              </button>
              <button className="btn-primary" onClick={openAdd}><Plus size={16} /> Add Vehicle</button>
            </>
          )}
        </div>
      </div>

      {/* Alerts banner */}
      {alerts.length > 0 && (
        <div className="card border-yellow-500/30 bg-yellow-500/5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-yellow-400 flex items-center gap-2"><AlertTriangle size={16} /> {alerts.length} Active Alert{alerts.length > 1 ? 's' : ''}</h2>
          </div>
          <div className="space-y-2">
            {alerts.map(a => (
              <div key={a.id} className="flex items-center justify-between gap-4 bg-black/20 rounded-lg px-3 py-2">
                <div>
                  <span className={`text-xs font-bold mr-2 ${a.severity === 'critical' ? 'text-red-400' : 'text-yellow-400'}`}>{a.severity.toUpperCase()}</span>
                  <span className="text-sm text-slate-300">{a.alert_message}</span>
                </div>
                {isManager && (
                  <button onClick={() => resolveAlert.mutate(a.id)} className="text-xs text-slate-400 hover:text-green-400 whitespace-nowrap">Resolve</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
          <input type="checkbox" checked={showAlertsOnly} onChange={e => setShowAlertsOnly(e.target.checked)} className="rounded" />
          Show alerts only
        </label>
        <span className="text-slate-600">|</span>
        <span className="text-sm text-slate-500">{displayed.length} vehicle{displayed.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Vehicle grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="card h-48 animate-pulse bg-surface-hover" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {displayed.map(v => (
            <div key={v.id} className={`card space-y-3 ${v.status === 'maintenance' ? 'border-orange-500/30' : v.insurance_expiring || v.registration_expiring ? 'border-yellow-500/30' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {statusIcon(v)}
                  <h3 className="font-semibold text-slate-100">{v.vehicle_name}</h3>
                </div>
                <div className="flex items-center gap-1">
                  <Badge status={v.status} />
                  {isManager && (
                    <>
                      <button onClick={() => openEdit(v)} className="btn-ghost p-1.5 rounded-lg"><Edit2 size={14} /></button>
                      <button onClick={() => setQrVehicle(v)} className="btn-ghost p-1.5 rounded-lg" title="View QR Code"><QrCode size={14} /></button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-slate-500">Make/Model</span><p className="text-slate-300">{v.year} {v.make} {v.model}</p></div>
                <div><span className="text-slate-500">Plate</span><p className="text-slate-300 font-mono">{v.license_plate || '—'}</p></div>
                <div><span className="text-slate-500">VIN</span><p className="text-slate-400 font-mono truncate">{v.vin || '—'}</p></div>
                <div><span className="text-slate-500">Transponder</span><p className="text-slate-300">{v.transponder_id || '—'}</p></div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs border-t border-surface-border pt-3">
                <div className="text-center">
                  <p className="text-slate-500 mb-1">Insurance</p>
                  <DaysLeft date={v.insurance_expiration} />
                  {v.insurance_expiration && <p className="text-slate-600 mt-0.5">{format(new Date(v.insurance_expiration), 'MM/dd/yy')}</p>}
                </div>
                <div className="text-center">
                  <p className="text-slate-500 mb-1">Registration</p>
                  <DaysLeft date={v.registration_expiration} />
                  {v.registration_expiration && <p className="text-slate-600 mt-0.5">{format(new Date(v.registration_expiration), 'MM/dd/yy')}</p>}
                </div>
                <div className="text-center">
                  <p className="text-slate-500 mb-1">Inspection</p>
                  <DaysLeft date={v.next_inspection_date} warnDays={14} />
                  {v.next_inspection_date && <p className="text-slate-600 mt-0.5">{format(new Date(v.next_inspection_date), 'MM/dd/yy')}</p>}
                </div>
              </div>

              {v.notes && <p className="text-xs text-slate-500 border-t border-surface-border pt-2">{v.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditing(null); }} title={editing ? `Edit ${editing.vehicle_name}` : 'Add Vehicle'} size="lg">
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); saveMutation.mutate(form); }}>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Vehicle Name *</label><input className="input" required value={form.vehicle_name} onChange={e => setForm(f => ({ ...f, vehicle_name: e.target.value }))} placeholder="VAN-001" /></div>
            <div><label className="label">Status</label>
              <select className="select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="active">Active</option><option value="maintenance">Maintenance</option><option value="inactive">Inactive</option>
              </select>
            </div>
            <div><label className="label">License Plate</label><input className="input" value={form.license_plate} onChange={e => setForm(f => ({ ...f, license_plate: e.target.value }))} /></div>
            <div><label className="label">VIN</label><input className="input" value={form.vin} onChange={e => setForm(f => ({ ...f, vin: e.target.value }))} /></div>
            <div><label className="label">Make</label><input className="input" value={form.make} onChange={e => setForm(f => ({ ...f, make: e.target.value }))} /></div>
            <div><label className="label">Model</label><input className="input" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} /></div>
            <div><label className="label">Year</label><input type="number" className="input" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} /></div>
            <div><label className="label">Color</label><input className="input" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} /></div>
            <div><label className="label">Transponder ID</label><input className="input" value={form.transponder_id} onChange={e => setForm(f => ({ ...f, transponder_id: e.target.value }))} /></div>
            <div><label className="label">Insurance Exp.</label><input type="date" className="input" value={form.insurance_expiration} onChange={e => setForm(f => ({ ...f, insurance_expiration: e.target.value }))} /></div>
            <div><label className="label">Registration Exp.</label><input type="date" className="input" value={form.registration_expiration} onChange={e => setForm(f => ({ ...f, registration_expiration: e.target.value }))} /></div>
            <div><label className="label">Last Inspection</label><input type="date" className="input" value={form.last_inspection_date} onChange={e => setForm(f => ({ ...f, last_inspection_date: e.target.value }))} /></div>
            <div><label className="label">Next Inspection</label><input type="date" className="input" value={form.next_inspection_date} onChange={e => setForm(f => ({ ...f, next_inspection_date: e.target.value }))} /></div>
          </div>
          <div><label className="label">Notes</label><textarea className="input min-h-16 resize-none" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setShowModal(false)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={saveMutation.isPending}>{saveMutation.isPending ? 'Saving…' : editing ? 'Update' : 'Add Vehicle'}</button>
          </div>
        </form>
      </Modal>

      {/* QR Code Modal */}
      <Modal isOpen={!!qrVehicle} onClose={() => setQrVehicle(null)} title={`QR Code — ${qrVehicle?.vehicle_name}`} size="sm">
        <div className="text-center space-y-4">
          <div className="bg-white rounded-xl p-4 inline-block">
            <img src={`/api/vehicles/${qrVehicle?.id}/qr`} alt="QR Code" className="w-48 h-48 object-contain" />
          </div>
          <p className="text-sm text-slate-400">Scan to open inspection form for {qrVehicle?.vehicle_name}</p>
          <a href={`/api/vehicles/${qrVehicle?.id}/qr`} download={`${qrVehicle?.vehicle_name}_qr.png`} className="btn-secondary inline-flex">Download QR</a>
        </div>
      </Modal>
    </div>
  );
}
