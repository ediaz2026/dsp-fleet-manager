import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import React, { useState, useEffect } from 'react';
import {
  Plus, QrCode, AlertTriangle, CheckCircle, Wrench, Edit2, RefreshCw,
  Trash2, Check, X, ChevronDown, Car, ClipboardList, MessageSquareWarning,
  ChevronUp, ChevronsUpDown, Bell, Search as SearchIcon, Building2,
} from 'lucide-react';

const VENDOR_TYPE_LABELS = {
  mechanic: 'Mechanic',
  body_shop: 'Body Shop',
  tire_shop: 'Tire Shop',
  cleaning: 'Cleaning',
  parts_supplier: 'Parts Supplier',
  other: 'Other',
};
import api from '../api/client';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import SortableHeader from '../components/SortableHeader';
import { useSort } from '../hooks/useSort';
import toast from 'react-hot-toast';
import { format, differenceInDays } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useSearchParams, useLocation } from 'react-router-dom';

// ─── Vehicle SortableHeader ───────────────────────────────────────────────────
function VSortableHeader({ label, col, sortKey, sortDir, onToggle, align = 'left' }) {
  const active = sortKey === col;
  return (
    <th
      className={`px-3 py-2.5 font-semibold text-slate-500 text-xs cursor-pointer select-none hover:text-slate-700 text-${align}`}
      onClick={() => onToggle(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active
          ? sortDir === 'asc' ? <ChevronUp size={11} className="text-blue-500" /> : <ChevronDown size={11} className="text-blue-500" />
          : <ChevronsUpDown size={11} className="opacity-30" />
        }
      </span>
    </th>
  );
}

// ─── DaysLeft ────────────────────────────────────────────────────────────────
function DaysLeft({ date, warnDays = 30 }) {
  if (!date) return <span className="text-slate-400">—</span>;
  const days = differenceInDays(new Date(date), new Date());
  const color = days <= 7 ? 'text-red-500' : days <= warnDays ? 'text-amber-600' : 'text-emerald-600';
  return <span className={`${color} font-medium text-xs`}>{days <= 0 ? 'Expired' : `${days}d`}</span>;
}

// ─── Priority badge ───────────────────────────────────────────────────────────
function PriorityBadge({ priority }) {
  const map = {
    severe: 'bg-red-100 text-red-700 border border-red-200',
    low:    'bg-slate-100 text-slate-600 border border-slate-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${map[priority] || map.low}`}>
      {priority?.charAt(0).toUpperCase() + priority?.slice(1)}
    </span>
  );
}

// ─── Van / Amazon Status badge ───────────────────────────────────────────────
function StatusPill({ value }) {
  const v = (value || '').toLowerCase();
  if (v === 'active') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">Active</span>;
  if (v === 'out of service') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700 border border-red-200">Out of Service</span>;
  if (v === 'grounded') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-orange-100 text-orange-700 border border-orange-200">Grounded</span>;
  if (v === 'inactive') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700 border border-red-200">Inactive</span>;
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">{value || '—'}</span>;
}

// ─── Repair Form Modal ────────────────────────────────────────────────────────
const emptyRepair = {
  vehicle_id: '', van_status: 'active', amazon_status: 'active',
  priority: 'low', description: '', scheduled_date: '', vendor: '', case_number: '',
};

function RepairModal({ isOpen, onClose, vehicles, editing, prefill, onSuccess, vendors = [], viewOnly = false }) {
  const [form, setForm] = useState(emptyRepair);
  const [showQuickVendor, setShowQuickVendor] = useState(false);
  const [qvForm, setQvForm] = useState({ name: '', vendor_type: 'mechanic' });
  const qc = useQueryClient();

  useEffect(() => {
    if (isOpen) {
      if (editing) {
        setForm({
          vehicle_id:     String(editing.vehicle_id),
          van_status:     editing.van_status,
          amazon_status:  editing.amazon_status,
          priority:       editing.priority === 'medium' ? 'low' : editing.priority,
          description:    editing.description,
          scheduled_date: editing.scheduled_date?.split('T')[0] || '',
          vendor:         editing.vendor || '',
          case_number:    editing.case_number || '',
        });
      } else if (prefill) {
        setForm({ ...emptyRepair, ...prefill });
      } else {
        setForm(emptyRepair);
      }
      setShowQuickVendor(false);
    }
  }, [isOpen, editing, prefill]);

  const selectedVehicle = vehicles.find(v => String(v.id) === String(form.vehicle_id));
  const vin6 = selectedVehicle?.vin?.slice(-6) || '';

  const saveMutation = useMutation({
    mutationFn: data => editing
      ? api.put(`/repairs/${editing.id}`, data)
      : api.post('/repairs', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repairs'] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(editing ? 'Repair updated' : 'Repair report created');
      onSuccess?.();
      onClose();
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  const quickVendorMutation = useMutation({
    mutationFn: data => api.post('/vendors', data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['vendors'] });
      setForm(prev => ({ ...prev, vendor: res.data.name }));
      setShowQuickVendor(false);
      setQvForm({ name: '', vendor_type: 'mechanic' });
      toast.success('Vendor added');
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to add vendor'),
  });

  const f = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const modalTitle = viewOnly ? 'Repair Details' : editing ? 'Edit Repair Report' : 'New Repair Report';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size="lg">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!viewOnly) saveMutation.mutate({ ...form, vehicle_id: Number(form.vehicle_id) }); }}>

        {/* 1. Vehicle */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="modal-label">Vehicle</label>
            {viewOnly ? (
              <p className="input bg-slate-50 text-slate-700">{selectedVehicle?.vehicle_name || editing?.vehicle_name || '—'}</p>
            ) : (
              <select className="select" required value={form.vehicle_id} onChange={f('vehicle_id')}>
                <option value="">Select vehicle…</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.vehicle_name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="modal-label">Last 6 of VIN</label>
            <input className="input bg-slate-50" readOnly value={viewOnly ? (editing?.vin?.slice(-6) || '—') : vin6} placeholder="Auto-filled" />
          </div>
        </div>

        {/* 2. Statuses */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="modal-label">DSP Status</label>
            {viewOnly ? (
              <StatusPill value={form.van_status} activeLabel="Active" inactiveLabel="Inactive (Out of Service)" />
            ) : (
              <>
                <select className="select" value={form.van_status} onChange={f('van_status')}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive (Out of Service)</option>
                </select>
                {form.van_status === 'inactive' && (
                  <p className="text-xs text-amber-600 mt-1">⚠ Vehicle will be marked out of service in the fleet</p>
                )}
              </>
            )}
          </div>
          <div>
            <label className="modal-label">Amazon Status</label>
            {viewOnly ? (
              <StatusPill value={form.amazon_status} />
            ) : (
              <select className="select" value={form.amazon_status} onChange={f('amazon_status')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            )}
          </div>
        </div>

        {/* 3. Priority */}
        <div>
          <label className="modal-label">Priority</label>
          {viewOnly ? (
            <PriorityBadge priority={form.priority} />
          ) : (
            <div className="flex gap-3">
              {['low', 'severe'].map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, priority: p }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-all ${
                    form.priority === p
                      ? p === 'severe' ? 'bg-red-600 text-white border-red-600'
                      : 'bg-slate-600 text-white border-slate-600'
                      : 'bg-white text-[#374151] border-[#D1D5DB] hover:border-slate-400'
                  }`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 4. Description */}
        <div>
          <label className="modal-label">Repair Description</label>
          {viewOnly ? (
            <p className="input bg-slate-50 text-slate-700 min-h-16 whitespace-pre-wrap">{form.description || '—'}</p>
          ) : (
            <textarea className="input min-h-20 resize-none" required value={form.description} onChange={f('description')} placeholder="Describe the repair needed…" />
          )}
        </div>

        {/* 4b. Case Number */}
        <div>
          <label className="modal-label">Case / Ticket Number <span className="text-slate-400 text-xs font-normal">(optional)</span></label>
          {viewOnly ? (
            <p className="input bg-slate-50 text-slate-700">{form.case_number || '—'}</p>
          ) : (
            <input className="input" value={form.case_number || ''} onChange={f('case_number')} placeholder="e.g. AMZ-2026-00412" />
          )}
        </div>

        {/* 5. Date + Vendor */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="modal-label">Scheduled Repair Date</label>
            {viewOnly ? (
              <p className="input bg-slate-50 text-slate-700">{form.scheduled_date || '—'}</p>
            ) : (
              <input type="date" className="input" value={form.scheduled_date} onChange={f('scheduled_date')} />
            )}
          </div>
          <div>
            <label className="modal-label">Vendor/Shop</label>
            {viewOnly ? (
              <p className="input bg-slate-50 text-slate-700">{form.vendor || '—'}</p>
            ) : showQuickVendor ? (
              <div className="border border-blue-200 rounded-lg p-3 bg-blue-50 space-y-2">
                <p className="text-xs font-semibold text-blue-700">Quick-Add Vendor</p>
                <input
                  className="input text-sm"
                  placeholder="Vendor name *"
                  value={qvForm.name}
                  onChange={e => setQvForm(f => ({ ...f, name: e.target.value }))}
                />
                <select className="select text-sm" value={qvForm.vendor_type} onChange={e => setQvForm(f => ({ ...f, vendor_type: e.target.value }))}>
                  {Object.entries(VENDOR_TYPE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!qvForm.name || quickVendorMutation.isPending}
                    onClick={() => quickVendorMutation.mutate(qvForm)}
                    className="flex-1 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {quickVendorMutation.isPending ? 'Saving…' : 'Save Vendor'}
                  </button>
                  <button type="button" onClick={() => setShowQuickVendor(false)} className="flex-1 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <select
                className="select"
                value={form.vendor}
                onChange={e => {
                  if (e.target.value === '__add__') { setShowQuickVendor(true); }
                  else { f('vendor')(e); }
                }}
              >
                <option value="">No vendor selected</option>
                {vendors.filter(v => v.status === 'active').map(v => (
                  <option key={v.id} value={v.name}>
                    {v.name}{v.vendor_type ? ` – ${VENDOR_TYPE_LABELS[v.vendor_type] || v.vendor_type}` : ''}
                  </option>
                ))}
                <option value="__add__">+ Add New Vendor</option>
              </select>
            )}
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          {viewOnly ? (
            <button type="button" className="btn-secondary flex-1" onClick={onClose}>Close</button>
          ) : (
            <>
              <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-primary flex-1" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : editing ? 'Update Repair' : 'Create Repair Report'}
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const emptyVehicle = {
  vehicle_name: '', license_plate: '', vin: '', make: '', model: '',
  year: new Date().getFullYear(), color: 'White', transponder_id: '',
  insurance_expiration: '', registration_expiration: '',
  last_inspection_date: '', next_inspection_date: '',
  van_status: 'Active', amazon_status: 'Active', notes: '',
};

const FLEET_SIDEBAR = [
  { id: 'vehicles',       label: 'Vehicles',         icon: Car },
  { id: 'repairs',        label: 'Vehicle Tracker',  icon: Wrench },
  { id: 'driver-reports', label: 'Driver Reports',   icon: MessageSquareWarning },
  { id: 'fleet-alerts',   label: 'Fleet Alerts',     icon: Bell },
  { id: 'vendors',        label: 'Vendors',          icon: Building2 },
  { id: 'van-affinity',   label: 'Van Affinity',     icon: Car },
];

function VanAffinityRow({ row, staff, onSave, isSaving }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    primary_driver_1_id: row.primary_driver_1_id || '',
    primary_driver_2_id: row.primary_driver_2_id || '',
    secondary_driver_1_id: row.secondary_driver_1_id || '',
    secondary_driver_2_id: row.secondary_driver_2_id || '',
  });
  const driverName = (id) => { const s = staff.find(x => String(x.id) === String(id)); return s ? `${s.first_name} ${s.last_name}` : '—'; };
  const drivers = staff.filter(s => s.role === 'driver' && s.status === 'active');

  if (!editing) {
    return (
      <tr className="hover:bg-blue-50/30 transition-colors">
        <td className="px-3 py-2.5 font-medium text-slate-900">{row.vehicle_name}</td>
        <td className="px-3 py-2.5"><span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{row.service_type || '—'}</span></td>
        <td className="px-3 py-2.5 text-slate-700">{driverName(row.primary_driver_1_id)}</td>
        <td className="px-3 py-2.5 text-slate-700">{driverName(row.primary_driver_2_id)}</td>
        <td className="px-3 py-2.5 text-slate-500">{driverName(row.secondary_driver_1_id)}</td>
        <td className="px-3 py-2.5 text-slate-500">{driverName(row.secondary_driver_2_id)}</td>
        <td className="px-3 py-2.5"><button onClick={() => setEditing(true)} className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-blue-600 hover:bg-blue-50">Edit</button></td>
      </tr>
    );
  }
  return (
    <tr className="bg-blue-50/40">
      <td className="px-3 py-2 font-medium text-slate-900">{row.vehicle_name}</td>
      <td className="px-3 py-2"><span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{row.service_type || '—'}</span></td>
      {['primary_driver_1_id','primary_driver_2_id','secondary_driver_1_id','secondary_driver_2_id'].map(field => (
        <td key={field} className="px-3 py-2">
          <select className="select text-xs w-full" value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value || null }))}>
            <option value="">— None</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.first_name} {d.last_name}</option>)}
          </select>
        </td>
      ))}
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <button onClick={() => { onSave(form); setEditing(false); }} disabled={isSaving} className="text-xs px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700">Save</button>
          <button onClick={() => setEditing(false)} className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">✕</button>
        </div>
      </td>
    </tr>
  );
}

export default function Vehicles() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const qc = useQueryClient();
  const isManager = ['manager', 'admin', 'dispatcher'].includes(user?.role);

  // Determine initial section from URL or location state
  const urlTab = searchParams.get('tab');
  const [activeSection, setActiveSection] = useState(() => {
    if (urlTab === 'repairs') return 'repairs';
    if (urlTab === 'driver-reports') return 'driver-reports';
    if (urlTab === 'fleet-alerts') return 'fleet-alerts';
    return localStorage.getItem('fleet_section') || 'vehicles';
  });
  // Keep backward-compat alias
  const activeTab = activeSection;
  const setActiveTab = (s) => { setActiveSection(s); localStorage.setItem('fleet_section', s); };

  // ── Fleet state
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [vehicleForm, setVehicleForm] = useState(emptyVehicle);
  const [qrVehicle, setQrVehicle] = useState(null);
  const [showAlertsOnly, setShowAlertsOnly] = useState(() => !!location.state?.showAlertsOnly);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [vanStatusFilter, setVanStatusFilter] = useState(() => {
    const s = location.state?.statusFilter || location.state?.vanStatusFilter;
    if (s === 'active') return 'Active';
    if (s === 'inactive') return 'Out of Service';
    return s || 'all';
  });
  const [amazonStatusFilter, setAmazonStatusFilter] = useState('all');
  const [vehicleSearch, setVehicleSearch] = useState('');

  // Sync filter when navigating here from another page (e.g. Dashboard widgets)
  useEffect(() => {
    const s = location.state?.statusFilter || location.state?.vanStatusFilter;
    if (s === 'active')   { setVanStatusFilter('Active'); }
    else if (s === 'inactive') { setVanStatusFilter('Out of Service'); }
    else if (s)           { setVanStatusFilter(s); }
  }, [location.state?.statusFilter, location.state?.vanStatusFilter]);

  // ── Repair state
  const [showRepairModal, setShowRepairModal] = useState(false);
  const [editingRepair, setEditingRepair] = useState(null);
  const [viewingRepair, setViewingRepair] = useState(null);
  const [repairPrefill, setRepairPrefill] = useState(null);
  const [filterPriority, setFilterPriority] = useState('');
  const [filterVanStatus, setFilterVanStatus] = useState('');
  const [filterAmazonStatus, setFilterAmazonStatus] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [confirmDeleteRepairId, setConfirmDeleteRepairId] = useState(null);

  // ── Vendor state
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState(null);
  const [vendorForm, setVendorForm] = useState({ name: '', vendor_type: 'mechanic', phone: '', email: '', address: '', notes: '', status: 'active' });
  const [confirmDeleteVendorId, setConfirmDeleteVendorId] = useState(null);
  const [confirmDeleteVendorName, setConfirmDeleteVendorName] = useState('');

  // ── Driver report state
  const [dismissId, setDismissId] = useState(null);
  const [dismissNote, setDismissNote] = useState('');
  const [convertId, setConvertId] = useState(null);
  const [convertForm, setConvertForm] = useState({ priority: 'low', scheduled_date: '', vendor: '', van_status: 'active', amazon_status: 'active', case_number: '' });
  const [viewingPhotos, setViewingPhotos] = useState(null);
  const [convertVehicleId, setConvertVehicleId] = useState(null);
  const [convertDescription, setConvertDescription] = useState('');

  // ── Queries
  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => api.get('/vehicles').then(r => r.data),
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['fleet-alerts'],
    queryFn: () => api.get('/vehicles/alerts').then(r => r.data),
  });

  const { data: repairs = [], isLoading: repairsLoading } = useQuery({
    queryKey: ['repairs'],
    queryFn: () => api.get('/repairs').then(r => r.data),
    enabled: activeSection === 'repairs',
  });

  const { data: driverReports = [], isLoading: reportsLoading } = useQuery({
    queryKey: ['driver-reports'],
    queryFn: () => api.get('/driver-reports').then(r => r.data),
    enabled: activeSection === 'driver-reports',
  });

  const { data: vendors = [], isLoading: vendorsLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => api.get('/vendors').then(r => r.data),
  });

  const { data: staff = [] } = useQuery({
    queryKey: ['staff'],
    queryFn: () => api.get('/staff').then(r => r.data),
  });

  const { data: vanAffinity = [], isLoading: affinityLoading } = useQuery({
    queryKey: ['van-affinity'],
    queryFn: () => api.get('/van-affinity').then(r => r.data),
    enabled: activeSection === 'van-affinity',
  });

  const saveAffinityMutation = useMutation({
    mutationFn: ({ vehicle_id, ...data }) => api.put(`/van-affinity/vehicle/${vehicle_id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['van-affinity'] }); toast.success('Van affinity saved'); },
    onError: err => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  const pendingCount = driverReports.filter(r => r.status === 'pending').length;

  // ── Vehicle delete confirm state
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState('');

  // ── Vehicle mutations
  const saveVehicleMutation = useMutation({
    mutationFn: data => editingVehicle ? api.put(`/vehicles/${editingVehicle.id}`, data) : api.post('/vehicles', data),
    onSuccess: async () => {
      await qc.cancelQueries({ queryKey: ['vehicles'] });
      await qc.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success(editingVehicle ? 'Vehicle updated' : 'Vehicle added');
      setShowVehicleModal(false); setEditingVehicle(null);
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed'),
  });

  const deleteVehicleMutation = useMutation({
    mutationFn: id => api.delete(`/vehicles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Vehicle deleted');
      setConfirmDeleteId(null);
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to delete'),
  });

  const statusVehicleMutation = useMutation({
    mutationFn: ({ id, van_status, amazon_status }) =>
      api.patch(`/vehicles/${id}/status`, { van_status, amazon_status }),
    onSuccess: (_, { van_status, amazon_status }) => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['fleet-alerts'] });
      qc.invalidateQueries({ queryKey: ['inactive-vehicles'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['repairs'] });
      if (van_status    !== undefined) toast.success('DSP status updated');
      if (amazon_status !== undefined) toast.success('Amazon status updated');
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to update status'),
  });

  const checkExpMutation = useMutation({
    mutationFn: () => api.post('/vehicles/check-expirations'),
    onSuccess: data => { qc.invalidateQueries({ queryKey: ['fleet-alerts'] }); toast.success(data.data.message); },
  });

  // ── Repair mutations
  const completeMutation = useMutation({
    mutationFn: async (r) => {
      await api.put(`/repairs/${r.id}/complete`);
      await api.patch(`/vehicles/${r.vehicle_id}/status`, { van_status: 'Active', amazon_status: 'Active' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repairs'] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Repair complete — vehicle set to Active');
    },
  });

  const deleteRepairMutation = useMutation({
    mutationFn: id => api.delete(`/repairs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repairs'] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Repair deleted');
      setConfirmDeleteRepairId(null);
    },
  });

  const saveVendorMutation = useMutation({
    mutationFn: data => editingVendor ? api.put(`/vendors/${editingVendor.id}`, data) : api.post('/vendors', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendors'] });
      toast.success(editingVendor ? 'Vendor updated' : 'Vendor added');
      setShowVendorModal(false); setEditingVendor(null);
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed'),
  });

  const deleteVendorMutation = useMutation({
    mutationFn: id => api.delete(`/vendors/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendors'] });
      toast.success('Vendor deleted');
      setConfirmDeleteVendorId(null);
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to delete'),
  });

  // ── Driver report mutations
  const dismissMutation = useMutation({
    mutationFn: ({ id, note }) => api.put(`/driver-reports/${id}/dismiss`, { dismiss_note: note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver-reports'] });
      toast.success('Report dismissed');
      setDismissId(null); setDismissNote('');
    },
  });

  const convertMutation = useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/driver-reports/${id}/convert`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver-reports'] });
      qc.invalidateQueries({ queryKey: ['repairs'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Converted to repair report');
      setConvertId(null);
    },
  });

  // ── Fleet filtering + sorting
  const displayed = vehicles.filter(v => {
    if (showAlertsOnly && !(v.insurance_expiring || v.registration_expiring || v.inspection_due)) return false;
    if (categoryFilter !== 'all' && v.service_type !== categoryFilter) return false;
    if (vanStatusFilter    !== 'all' && (v.van_status    || 'Active') !== vanStatusFilter)    return false;
    if (amazonStatusFilter !== 'all' && (v.amazon_status || 'Active') !== amazonStatusFilter) return false;
    if (vehicleSearch) {
      const q = vehicleSearch.toLowerCase();
      return (v.vehicle_name || '').toLowerCase().includes(q)
        || (v.license_plate || '').toLowerCase().includes(q)
        || (v.vin || '').toLowerCase().includes(q)
        || (v.transponder_id || '').toLowerCase().includes(q);
    }
    return true;
  });

  // ── Repair filtering + sorting
  const filteredRepairs = repairs.filter(r => {
    if (filterPriority && r.priority !== filterPriority) return false;
    if (filterVanStatus && r.van_status !== filterVanStatus) return false;
    if (filterAmazonStatus && r.amazon_status !== filterAmazonStatus) return false;
    return true;
  });
  const openRepairs = filteredRepairs.filter(r => r.status === 'open');
  const completedRepairs = filteredRepairs.filter(r => r.status === 'completed');

  const { sorted: sortedRepairs, sortKey: rKey, sortDir: rDir, toggle: rToggle } = useSort(openRepairs, 'priority');
  const { sorted: sortedDR, sortKey: drKey, sortDir: drDir, toggle: drToggle } = useSort(driverReports, 'created_at', 'desc');
  const { sorted: sortedVehicles, sortKey: vKey, sortDir: vDir, toggle: vToggle } = useSort(displayed, 'vehicle_name');

  const priorityOrder = { severe: 1, low: 2 };

  // When using priority sort we need custom comparator — inject a numeric key
  const repairsWithOrder = sortedRepairs.map(r => ({ ...r, _p: priorityOrder[r.priority] || 9 }));

  const openVehicleEdit = (v) => {
    setEditingVehicle(v);
    setVehicleForm({
      ...v,
      insurance_expiration:   v.insurance_expiration?.split('T')[0] || '',
      registration_expiration: v.registration_expiration?.split('T')[0] || '',
      last_inspection_date:   v.last_inspection_date?.split('T')[0] || '',
      next_inspection_date:   v.next_inspection_date?.split('T')[0] || '',
    });
    setShowVehicleModal(true);
  };

  // ── Fleet Alerts computed data
  const fleetAlertItems = (() => {
    const items = [];
    const today = new Date();
    vehicles.forEach(v => {
      if ((v.van_status || 'Active') === 'Out of Service') {
        items.push({ id: `oos-${v.id}`, vehicle: v, type: 'out_of_service', label: 'Out of Service', urgency: 0, color: 'red' });
      }
      if ((v.amazon_status || 'Active') === 'Grounded') {
        items.push({ id: `grounded-${v.id}`, vehicle: v, type: 'amazon_grounded', label: 'Amazon Grounded', urgency: 0, color: 'orange' });
      }
      [
        { key: 'insurance_expiration',    label: 'Insurance',    urgency: 1 },
        { key: 'registration_expiration', label: 'Registration', urgency: 2 },
        { key: 'next_inspection_date',    label: 'Inspection',   urgency: 3 },
      ].forEach(({ key, label, urgency }) => {
        if (!v[key]) return;
        const days = differenceInDays(new Date(v[key]), today);
        if (days <= 30) {
          items.push({ id: `${key}-${v.id}`, vehicle: v, type: label, label: days < 0 ? `${label} Expired` : `${label} Expiring`, days, urgency: days < 0 ? 0 : urgency, color: days < 0 ? 'red' : 'amber' });
        }
      });
    });
    return items.sort((a, b) => a.urgency - b.urgency || (a.days ?? -999) - (b.days ?? -999));
  })();

  // ─────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="flex -mt-6 -mx-6 -mb-6" style={{ minHeight: 'calc(100vh - 3.5rem)' }}>

      {/* ── Left Sidebar ── */}
      <div className="group w-14 hover:w-52 bg-slate-900 flex-shrink-0 flex flex-col transition-all duration-200 overflow-hidden">
        <div className="px-4 pt-5 pb-3 hidden group-hover:block">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Fleet</p>
        </div>
        <nav className="flex-1 px-2 space-y-0.5 pt-3 group-hover:pt-0">
          {FLEET_SIDEBAR.map(item => {
            const badge =
              item.id === 'vehicles'       ? vehicles.length :
              item.id === 'repairs'        ? openRepairs.length :
              item.id === 'driver-reports' ? pendingCount :
              item.id === 'fleet-alerts'   ? fleetAlertItems.length : 0;
            const badgeDanger = item.id === 'driver-reports' && pendingCount > 0;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all justify-center group-hover:justify-start ${
                  activeSection === item.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/60'
                }`}
              >
                <item.icon size={15} className="flex-shrink-0" />
                <span className="flex-1 text-left leading-snug hidden group-hover:block">{item.label}</span>
                {badge > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none hidden group-hover:inline-flex ${
                    badgeDanger ? 'bg-red-500 text-white' :
                    activeSection === item.id ? 'bg-white/20 text-white' : 'bg-slate-700 text-slate-300'
                  }`}>{badge}</span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-auto bg-slate-50 p-6 space-y-5">

      {/* ══════════════════════════════════════════════════════════════
          SECTION: VEHICLES
      ══════════════════════════════════════════════════════════════ */}
      {activeSection === 'vehicles' && (
        <>
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-bold text-slate-900">Vehicles</h1>
            <div className="flex gap-2">
              {isManager && (
                <>
                  <button className="btn-secondary" onClick={() => checkExpMutation.mutate()} disabled={checkExpMutation.isPending}>
                    <RefreshCw size={14} className={checkExpMutation.isPending ? 'animate-spin' : ''} /> Check Expirations
                  </button>
                  <button className="btn-primary" onClick={() => { setEditingVehicle(null); setVehicleForm(emptyVehicle); setShowVehicleModal(true); }}>
                    <Plus size={15} /> Add Vehicle
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Filter + Search bar */}
          <div className="flex flex-wrap items-center gap-2">
            {[
              { key: 'all',      label: 'All',       count: vehicles.length },
              { key: 'EDV',      label: 'EDV',        count: vehicles.filter(v => v.service_type === 'EDV').length },
              { key: 'STEP VAN', label: 'Step Van',   count: vehicles.filter(v => v.service_type === 'STEP VAN').length },
              { key: 'OTHER',    label: 'Other',      count: vehicles.filter(v => v.service_type === 'OTHER').length },
            ].map(f => (
              <button key={f.key} onClick={() => setCategoryFilter(f.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  categoryFilter === f.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                }`}
              >
                {f.label}
                <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ${categoryFilter === f.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{f.count}</span>
              </button>
            ))}
            <div className="relative ml-auto">
              <SearchIcon size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={vehicleSearch} onChange={e => setVehicleSearch(e.target.value)}
                placeholder="Search vehicles…"
                className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none w-44" />
            </div>
            <span className="text-xs text-slate-400">{displayed.length} vehicle{displayed.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Vehicle table */}
          {vehiclesLoading ? (
            <div className="card h-40 animate-pulse bg-slate-100" />
          ) : displayed.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Car size={32} className="mx-auto mb-2 opacity-30" />
              No vehicles match the current filters
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <VSortableHeader label="Vehicle"       col="vehicle_name"          sortKey={vKey} sortDir={vDir} onToggle={vToggle} />
                    <VSortableHeader label="Type"          col="service_type"          sortKey={vKey} sortDir={vDir} onToggle={vToggle} />
                    <VSortableHeader label="Make / Model"  col="make"                  sortKey={vKey} sortDir={vDir} onToggle={vToggle} />
                    <VSortableHeader label="Plate"         col="license_plate"         sortKey={vKey} sortDir={vDir} onToggle={vToggle} />
                    <VSortableHeader label="Transponder"   col="transponder_id"        sortKey={vKey} sortDir={vDir} onToggle={vToggle} />
                    <VSortableHeader label="Insurance Exp" col="insurance_expiration"  sortKey={vKey} sortDir={vDir} onToggle={vToggle} />
                    <VSortableHeader label="Reg. Exp"      col="registration_expiration" sortKey={vKey} sortDir={vDir} onToggle={vToggle} />
                    <VSortableHeader label="Next Insp."    col="next_inspection_date"  sortKey={vKey} sortDir={vDir} onToggle={vToggle} />
                    <VSortableHeader label="Amazon Status" col="amazon_status"         sortKey={vKey} sortDir={vDir} onToggle={vToggle} />
                    <VSortableHeader label="DSP Status"    col="van_status"            sortKey={vKey} sortDir={vDir} onToggle={vToggle} />
                    {isManager && <th className="px-3 py-2.5 w-20" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedVehicles.map(v => {
                    const isOOS      = (v.van_status    || 'Active') === 'Out of Service';
                    const isGrounded = (v.amazon_status || 'Active') === 'Grounded';
                    const hasAlert   = v.insurance_expiring || v.registration_expiring || v.inspection_due;
                    return (
                      <tr key={v.id} className={`hover:bg-blue-50/40 transition-colors ${isOOS ? 'bg-red-50/30' : isGrounded ? 'bg-orange-50/30' : ''}`}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            {isOOS
                              ? <AlertTriangle size={12} className="text-red-500 flex-shrink-0" />
                              : isGrounded
                                ? <AlertTriangle size={12} className="text-orange-500 flex-shrink-0" />
                                : hasAlert
                                  ? <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
                                  : <CheckCircle size={12} className="text-emerald-500 flex-shrink-0" />
                            }
                            <span className="font-medium text-slate-800">{v.vehicle_name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">{v.service_type || '—'}</span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{[v.year, v.make, v.model].filter(Boolean).join(' ') || '—'}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{v.license_plate || '—'}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{v.transponder_id || '—'}</td>
                        <td className="px-3 py-2.5"><DaysLeft date={v.insurance_expiration} /> {v.insurance_expiration && <span className="text-[11px] text-slate-400 ml-1">{format(new Date(v.insurance_expiration), 'MM/dd/yy')}</span>}</td>
                        <td className="px-3 py-2.5"><DaysLeft date={v.registration_expiration} /> {v.registration_expiration && <span className="text-[11px] text-slate-400 ml-1">{format(new Date(v.registration_expiration), 'MM/dd/yy')}</span>}</td>
                        <td className="px-3 py-2.5"><DaysLeft date={v.next_inspection_date} warnDays={14} /> {v.next_inspection_date && <span className="text-[11px] text-slate-400 ml-1">{format(new Date(v.next_inspection_date), 'MM/dd/yy')}</span>}</td>
                        {/* Amazon Status first */}
                        <td className="px-3 py-2.5">
                          {isManager ? (
                            <select
                              value={v.amazon_status || 'Active'}
                              onChange={e => {
                                const newAmazon = e.target.value;
                                statusVehicleMutation.mutate({ id: v.id, amazon_status: newAmazon, ...(newAmazon === 'Grounded' ? { van_status: 'Out of Service' } : {}) });
                                if (newAmazon === 'Grounded') toast('DSP Status auto-set to inactive', { icon: '🔒' });
                              }}
                              className={`text-xs border rounded-lg px-2 py-1 bg-white cursor-pointer hover:border-blue-400 transition-colors focus:outline-none ${
                                (v.amazon_status || 'Active') === 'Grounded'
                                  ? 'border-orange-300 text-orange-700'
                                  : 'border-slate-200 text-slate-600'
                              }`}
                            >
                              <option value="Active">Active</option>
                              <option value="Grounded">Grounded</option>
                            </select>
                          ) : (
                            <StatusPill value={v.amazon_status || 'Active'} />
                          )}
                        </td>
                        {/* DSP Status — locked when Amazon inactive */}
                        <td className="px-3 py-2.5">
                          {isManager ? (
                            isGrounded ? (
                              <div className="flex items-center gap-1" title="Locked — Amazon status is inactive">
                                <span className="text-xs text-red-500 font-semibold">Out of Service</span>
                                <span className="text-slate-400">🔒</span>
                              </div>
                            ) : (
                              <select
                                value={v.van_status || 'Active'}
                                onChange={e => statusVehicleMutation.mutate({ id: v.id, van_status: e.target.value })}
                                className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-600 cursor-pointer hover:border-blue-400 transition-colors focus:outline-none"
                              >
                                <option value="Active">Active</option>
                                <option value="Out of Service">Out of Service</option>
                              </select>
                            )
                          ) : (
                            <StatusPill value={v.van_status || 'Active'} />
                          )}
                        </td>
                        {isManager && (
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1">
                              <button onClick={() => openVehicleEdit(v)} className="p-1.5 rounded hover:bg-blue-50 text-blue-500 transition-colors" title="Edit"><Edit2 size={13} /></button>
                              <button onClick={() => setQrVehicle(v)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 transition-colors" title="QR Code"><QrCode size={13} /></button>
                              <button onClick={() => { setConfirmDeleteId(v.id); setConfirmDeleteName(v.vehicle_name); }} className="p-1.5 rounded hover:bg-red-50 text-red-400 transition-colors" title="Delete"><Trash2 size={13} /></button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          SECTION: VEHICLE TRACKER
      ══════════════════════════════════════════════════════════════ */}
      {activeSection === 'repairs' && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-slate-900">Vehicle Tracker</h1>
            {isManager && (
              <button className="btn-primary" onClick={() => { setEditingRepair(null); setRepairPrefill(null); setShowRepairModal(true); }}>
                <Plus size={15} /> Add New
              </button>
            )}
          </div>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <select className="select w-auto" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
              <option value="">All Priorities</option>
              <option value="severe">Severe</option>
              <option value="low">Low</option>
            </select>
            <select className="select w-auto" value={filterVanStatus} onChange={e => setFilterVanStatus(e.target.value)}>
              <option value="">All DSP Statuses</option>
              <option value="active">Van Active</option>
              <option value="inactive">Van Inactive</option>
            </select>
            <select className="select w-auto" value={filterAmazonStatus} onChange={e => setFilterAmazonStatus(e.target.value)}>
              <option value="">All Amazon Statuses</option>
              <option value="active">Amazon Active</option>
              <option value="inactive">Amazon Inactive</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-600 ml-auto cursor-pointer">
              <input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} className="rounded" />
              Show completed
            </label>
          </div>

          {/* Open Repairs Table */}
          {repairsLoading ? (
            <div className="card h-40 animate-pulse bg-slate-100" />
          ) : (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 bg-white flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Open Repairs ({openRepairs.length})</h2>
              </div>
              {openRepairs.length === 0 ? (
                <div className="py-12 text-center">
                  <CheckCircle size={32} className="text-emerald-400 mx-auto mb-2" />
                  <p className="text-slate-500 text-sm">No open repair reports</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100">
                      <tr>
                        <SortableHeader label="Vehicle"        sortKey="vehicle_name"   currentKey={rKey} direction={rDir} onSort={rToggle} className="text-left" />
                        <SortableHeader label="DSP Status"     sortKey="van_status"     currentKey={rKey} direction={rDir} onSort={rToggle} className="text-left" />
                        <SortableHeader label="Amazon Status"  sortKey="amazon_status"  currentKey={rKey} direction={rDir} onSort={rToggle} className="text-left" />
                        <SortableHeader label="Priority"       sortKey="priority"       currentKey={rKey} direction={rDir} onSort={rToggle} className="text-left" />
                        <SortableHeader label="Repair Needed"  sortKey="description"    currentKey={rKey} direction={rDir} onSort={rToggle} className="text-left" />
                        <SortableHeader label="Sched. Date"    sortKey="scheduled_date" currentKey={rKey} direction={rDir} onSort={rToggle} className="text-left" />
                        <SortableHeader label="Vendor"         sortKey="vendor"         currentKey={rKey} direction={rDir} onSort={rToggle} className="text-left" />
                        <SortableHeader label="Reported"       sortKey="created_at"     currentKey={rKey} direction={rDir} onSort={rToggle} className="text-left" />
                        <th className="px-3 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {sortedRepairs.map(r => (
                        <tr
                          key={r.id}
                          onClick={() => { setEditingRepair(r); setRepairPrefill(null); setShowRepairModal(true); }}
                          className={r.priority === 'severe'
                            ? 'cursor-pointer hover:bg-blue-50/40 transition-colors border-l-4 border-l-red-400 bg-red-50/40'
                            : 'cursor-pointer hover:bg-blue-50/40 transition-colors border-l-4 border-l-slate-200'
                          }
                        >
                          <td className="px-3 py-2.5 font-medium text-slate-900 whitespace-nowrap">{r.vehicle_name}</td>
                          <td className="px-3 py-2.5"><StatusPill value={r.van_status} /></td>
                          <td className="px-3 py-2.5"><StatusPill value={r.amazon_status} activeLabel="Active" inactiveLabel="Inactive" /></td>
                          <td className="px-3 py-2.5"><PriorityBadge priority={r.priority} /></td>
                          <td className="px-3 py-2.5 max-w-xs">
                            <p className="truncate text-slate-700">{r.description}</p>
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                            {r.scheduled_date ? format(new Date(r.scheduled_date), 'MM/dd/yy') : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">{r.vendor || '—'}</td>
                          <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap text-xs">
                            {format(new Date(r.created_at), 'MM/dd/yy')}
                          </td>
                          <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => completeMutation.mutate(r)} title="Mark complete" className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-200 transition-colors"><Check size={16} /></button>
                              <button onClick={() => setConfirmDeleteRepairId(r.id)} title="Delete" className="flex items-center justify-center w-9 h-9 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 border border-red-200 transition-colors"><Trash2 size={16} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Completed Repairs */}
          {showCompleted && completedRepairs.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-emerald-50 flex items-center gap-2">
                <CheckCircle size={15} className="text-emerald-600" />
                <h2 className="font-semibold text-emerald-800">Completed Repairs ({completedRepairs.length})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-700 uppercase bg-slate-100">Vehicle</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-700 uppercase bg-slate-100">Priority</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-700 uppercase bg-slate-100">Description</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-700 uppercase bg-slate-100">Vendor</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-700 uppercase bg-slate-100">Completed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {completedRepairs.map(r => (
                      <tr key={r.id} className="hover:bg-blue-50 opacity-70 even:bg-slate-50">
                        <td className="px-3 py-2.5 text-slate-700">{r.vehicle_name}</td>
                        <td className="px-3 py-2.5"><PriorityBadge priority={r.priority} /></td>
                        <td className="px-3 py-2.5 text-slate-600 max-w-sm truncate">{r.description}</td>
                        <td className="px-3 py-2.5 text-slate-500">{r.vendor || '—'}</td>
                        <td className="px-3 py-2.5 text-slate-500 text-xs">{r.completed_at ? format(new Date(r.completed_at), 'MM/dd/yy') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          SECTION: DRIVER REPORTS
      ══════════════════════════════════════════════════════════════ */}
      {activeSection === 'driver-reports' && (
        <>
          <h1 className="text-xl font-bold text-slate-900">Driver Reports Queue</h1>
          {pendingCount > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <MessageSquareWarning size={16} className="text-blue-600 flex-shrink-0" />
              <p className="text-sm text-blue-800"><strong>{pendingCount}</strong> new driver report{pendingCount > 1 ? 's' : ''} need review</p>
            </div>
          )}

          {reportsLoading ? (
            <div className="card h-40 animate-pulse bg-slate-100" />
          ) : (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 bg-white">
                <h2 className="font-semibold text-slate-900">Driver Reports</h2>
              </div>
              {driverReports.length === 0 ? (
                <div className="py-12 text-center">
                  <MessageSquareWarning size={32} className="text-slate-300 mx-auto mb-2" />
                  <p className="text-slate-500 text-sm">No driver reports submitted</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100">
                      <tr>
                        <SortableHeader label="Vehicle"       sortKey="vehicle_name" currentKey={drKey} direction={drDir} onSort={drToggle} className="text-left" />
                        <SortableHeader label="Driver"        sortKey="driver_name"  currentKey={drKey} direction={drDir} onSort={drToggle} className="text-left" />
                        <SortableHeader label="Date Reported" sortKey="created_at"   currentKey={drKey} direction={drDir} onSort={drToggle} className="text-left" />
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-700 uppercase bg-slate-100 tracking-wide">Description</th>
                        <SortableHeader label="Status"        sortKey="status"       currentKey={drKey} direction={drDir} onSort={drToggle} className="text-left" />
                        <th className="px-3 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {sortedDR.map(r => (<React.Fragment key={r.id}>
                        <tr className={`hover:bg-blue-50/30 transition-colors ${r.status === 'pending' ? 'bg-amber-50/40' : 'opacity-60'}`}>
                          <td className="px-3 py-3 font-medium text-slate-900">{r.vehicle_name}</td>
                          <td className="px-3 py-3 text-slate-700">{r.driver_name}</td>
                          <td className="px-3 py-3 text-slate-500 text-xs whitespace-nowrap">{format(new Date(r.created_at), 'MM/dd/yy h:mm a')}</td>
                          <td className="px-3 py-3 text-slate-600 max-w-xs">
                            <p className="truncate">{r.description}</p>
                            {r.photo_urls?.length > 0 && (
                              <button onClick={e => { e.stopPropagation(); setViewingPhotos(r.photo_urls); }} className="mt-1 text-xs text-blue-600 hover:underline flex items-center gap-1">
                                📷 View {r.photo_urls.length} photo{r.photo_urls.length > 1 ? 's' : ''}
                              </button>
                            )}
                            {r.status === 'dismissed' && r.dismiss_note && (
                              <p className="text-xs text-slate-400 mt-0.5 italic">Dismissed: {r.dismiss_note}</p>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                              r.status === 'pending'   ? 'bg-amber-100 text-amber-700' :
                              r.status === 'converted' ? 'bg-blue-100 text-blue-700' :
                              'bg-slate-100 text-slate-500'
                            }`}>
                              {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            {r.status === 'pending' && isManager && (
                              <div className="flex gap-2">
                                {convertId !== r.id && (
                                  <button onClick={() => { setConvertId(r.id); setConvertForm({ priority: 'low', scheduled_date: '', vendor: '', van_status: 'active', amazon_status: 'active', case_number: '' }); }} className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-2.5 py-1 rounded-lg hover:bg-blue-100 font-medium">
                                    Convert to Repair
                                  </button>
                                )}

                                {/* Dismiss */}
                                {dismissId === r.id ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      autoFocus
                                      className="input text-xs py-1 w-40"
                                      placeholder="Dismiss note…"
                                      value={dismissNote}
                                      onChange={e => setDismissNote(e.target.value)}
                                    />
                                    <button onClick={() => dismissMutation.mutate({ id: r.id, note: dismissNote })} className="text-xs text-slate-500 hover:text-red-500">Dismiss</button>
                                    <button onClick={() => { setDismissId(null); setDismissNote(''); }} className="text-xs text-slate-400"><X size={12} /></button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setDismissId(r.id)}
                                    className="text-xs bg-slate-50 text-slate-500 border border-slate-200 px-2.5 py-1 rounded-lg hover:bg-slate-100 font-medium"
                                  >
                                    Dismiss
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                        {convertId === r.id && (
                          <tr><td colSpan={6} className="px-3 py-0 bg-blue-50/50">
                            <div className="p-3 border border-blue-200 rounded-xl space-y-3 my-2 bg-blue-50" onClick={e => e.stopPropagation()}>
                              <p className="text-xs font-semibold text-blue-700">Create Repair Record</p>
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                <div><label className="text-[10px] font-semibold text-slate-500 uppercase">Priority</label><select className="select text-sm w-full" value={convertForm.priority} onChange={e => setConvertForm(f => ({...f, priority: e.target.value}))}><option value="low">Low</option><option value="severe">Severe</option></select></div>
                                <div><label className="text-[10px] font-semibold text-slate-500 uppercase">Scheduled Date</label><input type="date" className="input text-sm w-full" value={convertForm.scheduled_date} onChange={e => setConvertForm(f => ({...f, scheduled_date: e.target.value}))} /></div>
                                <div><label className="text-[10px] font-semibold text-slate-500 uppercase">Vendor</label><select className="select text-sm w-full" value={convertForm.vendor} onChange={e => setConvertForm(f => ({...f, vendor: e.target.value}))}><option value="">No vendor</option>{vendors.filter(v => v.status === 'active').map(v => <option key={v.id} value={v.name}>{v.name}</option>)}</select></div>
                                <div><label className="text-[10px] font-semibold text-slate-500 uppercase">DSP Status</label><select className="select text-sm w-full" value={convertForm.van_status} onChange={e => setConvertForm(f => ({...f, van_status: e.target.value}))}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
                                <div><label className="text-[10px] font-semibold text-slate-500 uppercase">Amazon Status</label><select className="select text-sm w-full" value={convertForm.amazon_status || 'active'} onChange={e => setConvertForm(f => ({...f, amazon_status: e.target.value}))}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
                                <div><label className="text-[10px] font-semibold text-slate-500 uppercase">Case Number</label><input className="input text-sm w-full" placeholder="e.g. AMZ-2026-00412" value={convertForm.case_number || ''} onChange={e => setConvertForm(f => ({...f, case_number: e.target.value}))} /></div>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => convertMutation.mutate({ id: r.id, ...convertForm })} disabled={convertMutation.isPending} className="flex-1 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{convertMutation.isPending ? 'Creating…' : 'Confirm & Create Repair'}</button>
                                <button onClick={() => setConvertId(null)} className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
                              </div>
                            </div>
                          </td></tr>
                        )}
                      </React.Fragment>))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          SECTION: FLEET ALERTS
      ══════════════════════════════════════════════════════════════ */}
      {activeSection === 'fleet-alerts' && (
        <>
          <h1 className="text-xl font-bold text-slate-900">Fleet Alerts</h1>
          {fleetAlertItems.length === 0 ? (
            <div className="text-center py-20">
              <CheckCircle size={40} className="text-emerald-400 mx-auto mb-3" />
              <p className="text-slate-500 font-medium">All clear — no fleet alerts</p>
              <p className="text-slate-400 text-sm mt-1">All vehicles are active with valid documents</p>
            </div>
          ) : (
            <>
              {/* Summary counts */}
              <div className="flex gap-3 flex-wrap">
                {[
                  { label: 'Out of Service',  count: fleetAlertItems.filter(i => i.type === 'out_of_service').length,  color: 'bg-red-100 text-red-700 border-red-200' },
                  { label: 'Amazon Grounded', count: fleetAlertItems.filter(i => i.type === 'amazon_grounded').length, color: 'bg-orange-100 text-orange-700 border-orange-200' },
                  { label: 'Expired Docs',    count: fleetAlertItems.filter(i => i.days !== undefined && i.days < 0).length,  color: 'bg-red-100 text-red-700 border-red-200' },
                  { label: 'Expiring Soon',   count: fleetAlertItems.filter(i => i.days !== undefined && i.days >= 0).length, color: 'bg-amber-100 text-amber-700 border-amber-200' },
                ].filter(s => s.count > 0).map(s => (
                  <div key={s.label} className={`px-4 py-2 rounded-xl border text-sm font-semibold ${s.color}`}>
                    {s.count} {s.label}
                  </div>
                ))}
              </div>

              <div className="card p-0 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Vehicle</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Type</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Alert</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Status</th>
                      {isManager && <th className="px-4 py-2.5 w-20" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {fleetAlertItems.map(item => (
                      <tr key={item.id} className={`${item.color === 'red' ? 'bg-red-50/40' : item.color === 'orange' ? 'bg-orange-50/30' : 'bg-amber-50/30'} hover:bg-blue-50/40 transition-colors`}>
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-800">{item.vehicle.vehicle_name}</span>
                          <div className="text-xs text-slate-400">{item.vehicle.service_type}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{[item.vehicle.year, item.vehicle.make, item.vehicle.model].filter(Boolean).join(' ')}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${
                            item.color === 'red' ? 'bg-red-100 text-red-700' : item.color === 'orange' ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            <AlertTriangle size={11} />
                            {item.label}
                            {item.days !== undefined && ` (${item.days < 0 ? Math.abs(item.days) + 'd ago' : item.days + 'd left'})`}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <StatusPill value={item.vehicle.van_status || 'Active'} />
                            {(item.vehicle.amazon_status || 'Active') === 'Grounded' && (
                              <StatusPill value="Grounded" />
                            )}
                          </div>
                        </td>
                        {isManager && (
                          <td className="px-4 py-3">
                            <button onClick={() => openVehicleEdit(item.vehicle)} className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors">
                              Edit
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          SECTION: VENDORS
      ══════════════════════════════════════════════════════════════ */}
      {activeSection === 'vendors' && (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-slate-900">Vendors</h1>
            {isManager && (
              <button className="btn-primary" onClick={() => { setEditingVendor(null); setVendorForm({ name: '', vendor_type: 'mechanic', phone: '', email: '', address: '', notes: '', status: 'active' }); setShowVendorModal(true); }}>
                <Plus size={15} /> Add Vendor
              </button>
            )}
          </div>

          {vendorsLoading ? (
            <div className="card h-40 animate-pulse bg-slate-100" />
          ) : vendors.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Building2 size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No vendors yet. Add a vendor to get started.</p>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Vendor Name</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Type</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Phone</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Email</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Address</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Notes</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Status</th>
                    {isManager && <th className="px-3 py-2.5 w-20" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {vendors.map(v => (
                    <tr key={v.id} className="hover:bg-blue-50/40 transition-colors">
                      <td className="px-3 py-2.5 font-medium text-slate-900">{v.name}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium border border-blue-100">
                          {VENDOR_TYPE_LABELS[v.vendor_type] || v.vendor_type}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{v.phone || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600">{v.email || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-500 max-w-xs truncate">{v.address || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-400 max-w-xs truncate text-xs italic">{v.notes || '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${v.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {v.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      {isManager && (
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => { setEditingVendor(v); setVendorForm({ name: v.name, vendor_type: v.vendor_type, phone: v.phone || '', email: v.email || '', address: v.address || '', notes: v.notes || '', status: v.status }); setShowVendorModal(true); }}
                              className="p-1.5 rounded hover:bg-blue-50 text-blue-500 transition-colors" title="Edit"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              onClick={() => { setConfirmDeleteVendorId(v.id); setConfirmDeleteVendorName(v.name); }}
                              className="p-1.5 rounded hover:bg-red-50 text-red-400 transition-colors" title="Delete"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ═══ VAN AFFINITY ═══════════════════════════════════════════ */}
      {activeSection === 'van-affinity' && (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-slate-900">Van Affinity</h1>
            <p className="text-sm text-slate-500">Assign primary & secondary drivers to each vehicle</p>
          </div>
          {affinityLoading ? (
            <div className="card h-40 animate-pulse bg-slate-100" />
          ) : vanAffinity.length === 0 ? (
            <div className="card py-12 text-center">
              <Car size={32} className="text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">No van affinity records yet. Edit a vehicle row to set driver preferences.</p>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Vehicle</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Type</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Primary 1</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Primary 2</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Secondary 1</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">Secondary 2</th>
                    <th className="px-3 py-2.5 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {vanAffinity.map(row => (
                    <VanAffinityRow key={row.vehicle_id} row={row} staff={staff} onSave={data => saveAffinityMutation.mutate({ vehicle_id: row.vehicle_id, ...data })} isSaving={saveAffinityMutation.isPending} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      </div>{/* close main content */}
    </div>{/* close flex wrapper */}

    {/* ═══ MODALS — rendered outside the overflow-auto wrapper so
        position:fixed works in all browsers / stacking contexts ═══ */}

    {/* ── Vehicle Add/Edit Modal ───────────────────────────────── */}
    <Modal isOpen={showVehicleModal} onClose={() => { setShowVehicleModal(false); setEditingVehicle(null); }} title={editingVehicle ? `Edit ${editingVehicle.vehicle_name}` : 'Add Vehicle'} size="lg">
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); saveVehicleMutation.mutate(vehicleForm); }}>
          {editingVehicle && (
            <div className="grid grid-cols-2 gap-4 pb-1">
              <div>
                <label className="modal-label">DSP Status</label>
                <select
                  className="select"
                  value={vehicleForm.van_status || 'Active'}
                  onChange={e => {
                    setVehicleForm(f => ({ ...f, van_status: e.target.value }));
                    statusVehicleMutation.mutate({ id: editingVehicle.id, van_status: e.target.value });
                  }}
                >
                  <option value="Active">Active</option>
                  <option value="Out of Service">Out of Service</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-0.5">Saves instantly</p>
              </div>
              <div>
                <label className="modal-label">Amazon Status</label>
                <select
                  className="select"
                  value={vehicleForm.amazon_status || 'Active'}
                  onChange={e => {
                    setVehicleForm(f => ({ ...f, amazon_status: e.target.value }));
                    statusVehicleMutation.mutate({ id: editingVehicle.id, amazon_status: e.target.value });
                  }}
                >
                  <option value="Active">Active</option>
                  <option value="Grounded">Grounded</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-0.5">Saves instantly · auto-creates fleet alert</p>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div><label className="modal-label">Vehicle Name *</label><input className="input" required value={vehicleForm.vehicle_name} onChange={e => setVehicleForm(f => ({ ...f, vehicle_name: e.target.value }))} placeholder="VAN-001" /></div>
            <div><label className="modal-label">License Plate</label><input className="input" value={vehicleForm.license_plate} onChange={e => setVehicleForm(f => ({ ...f, license_plate: e.target.value }))} /></div>
            <div><label className="modal-label">VIN</label><input className="input" value={vehicleForm.vin} onChange={e => setVehicleForm(f => ({ ...f, vin: e.target.value }))} /></div>
            <div><label className="modal-label">Make</label><input className="input" value={vehicleForm.make} onChange={e => setVehicleForm(f => ({ ...f, make: e.target.value }))} /></div>
            <div><label className="modal-label">Model</label><input className="input" value={vehicleForm.model} onChange={e => setVehicleForm(f => ({ ...f, model: e.target.value }))} /></div>
            <div><label className="modal-label">Year</label><input type="number" className="input" value={vehicleForm.year} onChange={e => setVehicleForm(f => ({ ...f, year: e.target.value }))} /></div>
            <div><label className="modal-label">Color</label><input className="input" value={vehicleForm.color} onChange={e => setVehicleForm(f => ({ ...f, color: e.target.value }))} /></div>
            <div><label className="modal-label">Transponder ID</label><input className="input" value={vehicleForm.transponder_id} onChange={e => setVehicleForm(f => ({ ...f, transponder_id: e.target.value }))} /></div>
            <div><label className="modal-label">Insurance Exp.</label><input type="date" className="input" value={vehicleForm.insurance_expiration} onChange={e => setVehicleForm(f => ({ ...f, insurance_expiration: e.target.value }))} /></div>
            <div><label className="modal-label">Registration Exp.</label><input type="date" className="input" value={vehicleForm.registration_expiration} onChange={e => setVehicleForm(f => ({ ...f, registration_expiration: e.target.value }))} /></div>
            <div><label className="modal-label">Last Inspection</label><input type="date" className="input" value={vehicleForm.last_inspection_date} onChange={e => setVehicleForm(f => ({ ...f, last_inspection_date: e.target.value }))} /></div>
            <div><label className="modal-label">Next Inspection</label><input type="date" className="input" value={vehicleForm.next_inspection_date} onChange={e => setVehicleForm(f => ({ ...f, next_inspection_date: e.target.value }))} /></div>
          </div>
          {!editingVehicle && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="modal-label">DSP Status</label>
                <select className="select" value={vehicleForm.van_status || 'Active'} onChange={e => setVehicleForm(f => ({ ...f, van_status: e.target.value }))}>
                  <option value="Active">Active</option>
                  <option value="Out of Service">Out of Service</option>
                </select>
              </div>
              <div>
                <label className="modal-label">Amazon Status</label>
                <select className="select" value={vehicleForm.amazon_status || 'Active'} onChange={e => setVehicleForm(f => ({ ...f, amazon_status: e.target.value }))}>
                  <option value="Active">Active</option>
                  <option value="Grounded">Grounded</option>
                </select>
              </div>
            </div>
          )}
          <div><label className="modal-label">Notes</label><textarea className="input min-h-16 resize-none" value={vehicleForm.notes} onChange={e => setVehicleForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setShowVehicleModal(false)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={saveVehicleMutation.isPending}>{saveVehicleMutation.isPending ? 'Saving…' : editingVehicle ? 'Update' : 'Add Vehicle'}</button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Confirm Modal ─────────────────────────────────── */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={() => setConfirmDeleteId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-800 mb-2">Delete Vehicle</h3>
            <p className="text-sm text-slate-600 mb-5">Are you sure you want to permanently delete <strong>{confirmDeleteName}</strong>? This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
              <button
                onClick={() => deleteVehicleMutation.mutate(confirmDeleteId)}
                disabled={deleteVehicleMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors"
              >
                {deleteVehicleMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Repair Delete Confirm ───────────────────────────────── */}
      {confirmDeleteRepairId && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={() => setConfirmDeleteRepairId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-800 mb-2">Delete this record?</h3>
            <p className="text-sm text-slate-600 mb-5">This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDeleteRepairId(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
              <button
                onClick={() => deleteRepairMutation.mutate(confirmDeleteRepairId)}
                disabled={deleteRepairMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors"
              >
                {deleteRepairMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Repair View Modal ───────────────────────────────────── */}
      <RepairModal
        isOpen={!!viewingRepair}
        onClose={() => setViewingRepair(null)}
        vehicles={vehicles}
        editing={viewingRepair}
        vendors={vendors}
        viewOnly
      />

      {/* ── Repair Add/Edit Modal ────────────────────────────────── */}
      <RepairModal
        isOpen={showRepairModal}
        onClose={() => { setShowRepairModal(false); setEditingRepair(null); setRepairPrefill(null); }}
        vehicles={vehicles}
        editing={editingRepair}
        prefill={repairPrefill}
        vendors={vendors}
      />

      {/* ── Vendor Add/Edit Modal ────────────────────────────────── */}
      <Modal isOpen={showVendorModal} onClose={() => { setShowVendorModal(false); setEditingVendor(null); }} title={editingVendor ? `Edit ${editingVendor.name}` : 'Add Vendor'} size="md">
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); saveVendorMutation.mutate(vendorForm); }}>
          <div>
            <label className="modal-label">Vendor Name *</label>
            <input className="input" required value={vendorForm.name} onChange={e => setVendorForm(f => ({ ...f, name: e.target.value }))} placeholder="AutoShop Miami" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="modal-label">Vendor Type</label>
              <select className="select" value={vendorForm.vendor_type} onChange={e => setVendorForm(f => ({ ...f, vendor_type: e.target.value }))}>
                {Object.entries(VENDOR_TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="modal-label">Status</label>
              <select className="select" value={vendorForm.status} onChange={e => setVendorForm(f => ({ ...f, status: e.target.value }))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="modal-label">Phone</label>
              <input className="input" value={vendorForm.phone} onChange={e => setVendorForm(f => ({ ...f, phone: e.target.value }))} placeholder="305-555-0100" />
            </div>
            <div>
              <label className="modal-label">Email</label>
              <input type="email" className="input" value={vendorForm.email} onChange={e => setVendorForm(f => ({ ...f, email: e.target.value }))} placeholder="contact@shop.com" />
            </div>
          </div>
          <div>
            <label className="modal-label">Address</label>
            <input className="input" value={vendorForm.address} onChange={e => setVendorForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St, Miami FL 33101" />
          </div>
          <div>
            <label className="modal-label">Notes</label>
            <textarea className="input min-h-16 resize-none" value={vendorForm.notes} onChange={e => setVendorForm(f => ({ ...f, notes: e.target.value }))} placeholder="Preferred contact, hours, etc…" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => { setShowVendorModal(false); setEditingVendor(null); }}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={saveVendorMutation.isPending}>
              {saveVendorMutation.isPending ? 'Saving…' : editingVendor ? 'Update Vendor' : 'Add Vendor'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Vendor Delete Confirm ───────────────────────────────── */}
      {confirmDeleteVendorId && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={() => setConfirmDeleteVendorId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-800 mb-2">Delete Vendor</h3>
            <p className="text-sm text-slate-600 mb-5">Delete <strong>{confirmDeleteVendorName}</strong>? This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDeleteVendorId(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
              <button
                onClick={() => deleteVendorMutation.mutate(confirmDeleteVendorId)}
                disabled={deleteVendorMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors"
              >
                {deleteVendorMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── QR Code Modal ────────────────────────────────────────── */}
      <Modal isOpen={!!qrVehicle} onClose={() => setQrVehicle(null)} title={`QR Code — ${qrVehicle?.vehicle_name}`} size="sm">
        <div className="text-center space-y-4">
          <div className="bg-white rounded-xl p-4 border border-slate-100 inline-block">
            <img src={`/api/vehicles/${qrVehicle?.id}/qr`} alt="QR Code" className="w-48 h-48 object-contain" />
          </div>
          <p className="text-sm text-slate-500">Scan to open inspection form for {qrVehicle?.vehicle_name}</p>
          <a href={`/api/vehicles/${qrVehicle?.id}/qr`} download={`${qrVehicle?.vehicle_name}_qr.png`} className="btn-secondary inline-flex">Download QR</a>
        </div>
      </Modal>

      {/* Photo lightbox */}
      {viewingPhotos && (
        <div className="fixed inset-0 bg-black/80 z-[200] flex items-center justify-center p-4" onClick={() => setViewingPhotos(null)}>
          <div className="bg-white rounded-2xl p-4 max-w-2xl w-full space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-slate-800">Driver Photos</h3>
              <button onClick={() => setViewingPhotos(null)} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {viewingPhotos.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                  <img src={url} className="w-full rounded-lg object-cover border border-slate-200 hover:opacity-90 transition-opacity" alt={`Photo ${i + 1}`} />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
