import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Users, Calendar, AlertTriangle, Plus, Edit2, Trash2, ChevronRight,
  Search, X, Save, ChevronDown, ChevronUp, RefreshCw, RotateCcw, Check,
  AlertCircle, Clock, Shield, FileText, User, ChevronsUpDown,
  Mail, Key, LogIn
} from 'lucide-react';
import api from '../api/client';
import toast from 'react-hot-toast';
import { useSort } from '../hooks/useSort';
import { format, differenceInDays, parseISO, isValid } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useLocation, useSearchParams } from 'react-router-dom';
import UserManagementPanel from '../components/UserManagementPanel';
import InvitationsPanel from '../components/InvitationsPanel';

// ─── Constants ────────────────────────────────────────────────────────────────
const SIDEBAR = [
  { id: 'all-drivers',  label: 'All Drivers',        icon: Users },
  { id: 'recurring',    label: 'Recurring Schedules', icon: Calendar },
  { id: 'alerts',       label: 'Driver Alerts',       icon: AlertTriangle },
];

const STATUS_TABS = ['all', 'active', 'inactive', 'suspended', 'terminated'];
const STATUS_LABEL = { all: 'All', active: 'Active', inactive: 'Inactive', suspended: 'Suspended', terminated: 'Terminated' };
const STATUS_COLOR = {
  active:     'bg-emerald-100 text-emerald-700',
  inactive:   'bg-amber-100 text-amber-700',
  suspended:  'bg-orange-100 text-orange-700',
  terminated: 'bg-red-100 text-red-700',
};

const ROLES = ['driver', 'dispatcher', 'manager', 'admin'];
const ROLE_LABEL = { driver: 'Driver', dispatcher: 'Dispatcher', manager: 'Manager', admin: 'Admin' };
const ROLE_COLOR = {
  driver:     'bg-slate-100 text-slate-600',
  dispatcher: 'bg-cyan-100 text-cyan-700',
  manager:    'bg-purple-100 text-purple-700',
  admin:      'bg-red-100 text-red-700',
};

const DAYS_COL  = ['sun','mon','tue','wed','thu','fri','sat'];
const DAYS_ABBR = ['Su','Mo','Tu','We','Th','Fr','Sa'];

const SHIFT_TYPES = ['EDV','STEP VAN','HELPER','ON CALL','EXTRA','DISPATCH AM','DISPATCH PM','SUSPENSION','UTO','PTO','TRAINING'];
const SHIFT_COLORS = {
  'EDV':         'bg-blue-500',  'STEP VAN':    'bg-orange-600',
  'HELPER':      'bg-amber-500', 'ON CALL':     'bg-yellow-500',
  'EXTRA':       'bg-green-500', 'DISPATCH AM': 'bg-cyan-500',
  'DISPATCH PM': 'bg-sky-600',   'SUSPENSION':  'bg-red-500',
  'UTO':         'bg-purple-500','PTO':          'bg-teal-500',
  'TRAINING':    'bg-orange-500',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  try { return format(parseISO(String(d).slice(0, 10)), 'MM/dd/yyyy'); } catch { return d; }
}
function licenseExpClass(d) {
  if (!d) return 'text-slate-400';
  try {
    const days = differenceInDays(parseISO(String(d).slice(0, 10)), new Date());
    if (days < 0) return 'text-red-600 font-semibold';
    if (days <= 60) return 'text-amber-600 font-semibold';
    return 'text-slate-700';
  } catch { return 'text-slate-400'; }
}
function hasRecurring(driver) {
  return Array.isArray(driver.recurring_rows) && driver.recurring_rows.length > 0;
}
function getPortalStatus(d) {
  if (d.last_login) return 'active';
  if (d.invitation_sent_at) return 'invited';
  return 'not_sent';
}

// ─── ConfirmModal ─────────────────────────────────────────────────────────────
function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-800 mb-2">{title}</h3>
        <p className="text-sm text-slate-600 mb-5">{message}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RecurringGrid (embedded in profile + recurring section) ─────────────────
function RecurringGrid({ staffId, locked = false }) {
  const qc = useQueryClient();

  // refetchOnWindowFocus: false is critical — prevents tab-switch from triggering
  // a background refetch that wipes the user's unsaved edits via useEffect below
  const { data: serverRows = [], isLoading } = useQuery({
    queryKey: ['recurring', staffId],
    queryFn: () => api.get(`/drivers/${staffId}/recurring`).then(r => r.data),
    enabled: !!staffId,
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  // Shift type defaults for auto-fill (retry:false — table may not exist yet)
  const { data: shiftTypesData = [] } = useQuery({
    queryKey: ['shift-types'],
    queryFn: () => api.get('/schedule/shift-types').then(r => r.data),
    retry: false,
    staleTime: 300000,
    refetchOnWindowFocus: false,
  });
  const shiftTypeDefaults = useMemo(() => {
    const map = {};
    shiftTypesData.forEach(st => { map[st.name] = st; });
    return map;
  }, [shiftTypesData]);

  // Local state — lifted from individual rows for batch save
  const [localRows, setLocalRows] = useState([]);
  const [dirtyIds, setDirtyIds] = useState(new Set());
  const [applyCurrentWeek, setApplyCurrentWeek] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasChanges = dirtyIds.size > 0;
  const isExisting = serverRows.length > 0; // has server-persisted rows
  // Can save whenever we have rows (even no changes — user may want to re-apply schedule)
  const canSave = !saving && localRows.length > 0;

  // Sync from server — safe because refetchOnWindowFocus:false means serverRows
  // only changes on initial mount or after an explicit invalidateQueries (post-save)
  useEffect(() => {
    setLocalRows(serverRows);
    setDirtyIds(new Set());
  }, [serverRows]);

  const updateLocalRow = (rowId, changes) => {
    setLocalRows(prev => prev.map(r => r.id === rowId ? { ...r, ...changes } : r));
    setDirtyIds(prev => new Set([...prev, rowId]));
  };

  const addRowMut = useMutation({
    mutationFn: () => {
      const def = shiftTypeDefaults['EDV'];
      return api.post(`/drivers/${staffId}/recurring`, {
        shift_type: 'EDV',
        start_time: def?.default_start_time || '07:00',
        end_time:   def?.default_end_time   || '17:00',
      });
    },
    onSuccess: (res) => {
      // Add directly to local state — do NOT invalidate ['recurring', staffId]
      // which would fire useEffect and clear dirtyIds
      setLocalRows(prev => [...prev, res.data]);
      setDirtyIds(prev => new Set([...prev, res.data.id]));
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to add shift row');
    },
  });

  const deleteRowMut = useMutation({
    mutationFn: (rowId) => api.delete(`/drivers/${staffId}/recurring/${rowId}`),
    onSuccess: (_, rowId) => {
      setLocalRows(prev => prev.filter(r => r.id !== rowId));
      setDirtyIds(prev => { const s = new Set(prev); s.delete(rowId); return s; });
      qc.invalidateQueries(['drivers-overview']);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to remove shift row');
    },
  });

  const handleSave = async () => {
    if (localRows.length === 0) { toast.error('Add at least one shift row first'); return; }
    setSaving(true);
    try {
      // Save all dirty rows first
      if (dirtyIds.size > 0) {
        await Promise.all(
          localRows
            .filter(r => dirtyIds.has(r.id))
            .map(r => api.put(`/drivers/${staffId}/recurring/${r.id}`, r))
        );
      }
      // Then apply recurring schedule to upcoming weeks
      const result = await api.post(`/drivers/${staffId}/recurring/apply-weekly`, { applyCurrentWeek });
      const created = result.data?.created ?? 0;
      toast.success(created > 0
        ? `Saved! Applied ${created} shift${created !== 1 ? 's' : ''} to upcoming weeks`
        : 'Recurring schedule saved');
      setDirtyIds(new Set());
      setApplyCurrentWeek(false);
      qc.invalidateQueries(['recurring', staffId]);
      qc.invalidateQueries(['drivers-overview']);
      qc.invalidateQueries(['shifts']);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save recurring schedule');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <div className="text-xs text-slate-400 py-2">Loading schedule…</div>;

  return (
    <div className="flex flex-col gap-2">
      {/* Scrollable rows area — capped so Save button never goes off-screen */}
      <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
        {localRows.length === 0 && !addRowMut.isPending && (
          <p className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
            ⚠️ No recurring schedule configured — click "+ Add shift row" below
          </p>
        )}
        {localRows.map(row => (
          <RecurringRowEditor
            key={row.id}
            row={row}
            locked={locked}
            isDirty={dirtyIds.has(row.id)}
            shiftTypeDefaults={shiftTypeDefaults}
            onChange={(changes) => updateLocalRow(row.id, changes)}
            onDelete={() => deleteRowMut.mutate(row.id)}
          />
        ))}
      </div>

      {/* Footer — always visible */}
      {!locked && (
        <div className="space-y-2.5">
          <button
            onClick={() => addRowMut.mutate()}
            disabled={addRowMut.isPending}
            className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 px-2 py-1.5 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            <Plus size={13} /> {addRowMut.isPending ? 'Adding…' : 'Add shift row'}
          </button>

          <div className="pt-2 border-t border-slate-200 space-y-2.5">
            {isExisting && (
              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={applyCurrentWeek}
                  onChange={e => setApplyCurrentWeek(e.target.checked)}
                  className="rounded accent-blue-600"
                />
                Also apply changes to current week
              </label>
            )}
            <button
              onClick={handleSave}
              disabled={!canSave}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                canSave
                  ? hasChanges
                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                    : 'bg-slate-600 text-white hover:bg-slate-700 shadow-sm'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              <Save size={14} />
              {saving ? 'Saving…' : hasChanges ? 'Save Changes' : 'Apply to Schedule'}
            </button>
            {hasChanges && (
              <p className="text-xs text-blue-500 font-medium">● Unsaved changes</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RecurringRowEditor({ row, locked, isDirty, shiftTypeDefaults, onChange, onDelete }) {
  if (locked) {
    const activeDays = DAYS_COL.filter(d => row[d]);
    return (
      <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded text-white ${SHIFT_COLORS[row.shift_type] || 'bg-slate-400'}`}>{row.shift_type}</span>
        <span className="text-slate-400">{row.start_time?.slice(0,5)}–{row.end_time?.slice(0,5)}</span>
        <span className="ml-1">{activeDays.map(d => DAYS_ABBR[DAYS_COL.indexOf(d)]).join(' ')}</span>
      </div>
    );
  }

  const handleShiftTypeChange = (newType) => {
    const def = shiftTypeDefaults?.[newType];
    const changes = { shift_type: newType };
    if (def?.default_start_time) changes.start_time = def.default_start_time;
    if (def?.default_end_time)   changes.end_time   = def.default_end_time;
    onChange(changes);
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border flex-wrap transition-colors ${
      isDirty ? 'border-blue-300 bg-blue-50/30' : 'bg-slate-50 border-slate-200'
    }`}>
      <select
        value={row.shift_type}
        onChange={e => handleShiftTypeChange(e.target.value)}
        className="text-xs border border-slate-300 rounded px-1.5 py-1 bg-white focus:ring-1 focus:ring-blue-500 outline-none"
      >
        {SHIFT_TYPES.map(t => <option key={t}>{t}</option>)}
      </select>
      <input
        type="time"
        value={row.start_time?.slice(0,5) || '07:00'}
        onChange={e => onChange({ start_time: e.target.value })}
        className="text-xs border border-slate-300 rounded px-1.5 py-1 w-24 bg-white focus:ring-1 focus:ring-blue-500 outline-none"
      />
      <span className="text-slate-400 text-xs">–</span>
      <input
        type="time"
        value={row.end_time?.slice(0,5) || '17:00'}
        onChange={e => onChange({ end_time: e.target.value })}
        className="text-xs border border-slate-300 rounded px-1.5 py-1 w-24 bg-white focus:ring-1 focus:ring-blue-500 outline-none"
      />
      <div className="flex items-center gap-1 ml-1">
        {DAYS_COL.map((d, i) => (
          <button
            key={d}
            onClick={() => onChange({ [d]: !row[d] })}
            className={`w-6 h-6 text-[10px] font-bold rounded transition-colors ${row[d] ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 border border-slate-300 hover:border-blue-400'}`}
          >{DAYS_ABBR[i]}</button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 ml-auto">
        {isDirty && <span className="text-[10px] text-blue-500 font-semibold">Modified</span>}
        <button onClick={onDelete} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors" title="Remove">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Driver Profile Modal ─────────────────────────────────────────────────────
function DriverProfile({ driver, onClose, onStatusChange, onDelete, onSaved, initialTab = 'personal' }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState(driver._initialTab || initialTab);
  const [form, setForm] = useState({
    first_name: driver.first_name || '',
    last_name: driver.last_name || '',
    email: driver.email || '',
    personal_email: driver.personal_email || '',
    phone: driver.phone || '',
    role: driver.role || 'driver',
    hire_date: driver.hire_date ? String(driver.hire_date).slice(0,10) : '',
    employee_code: driver.employee_code || '',
    transponder_id: driver.transponder_id || '',
    license_number: driver.license_number || '',
    license_expiration: driver.license_expiration ? String(driver.license_expiration).slice(0,10) : '',
    license_state: driver.license_state || '',
    dob: driver.dob ? String(driver.dob).slice(0,10) : '',
    notes: driver.notes || '',
  });
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [tempPassword, setTempPassword] = useState(null);
  const isTerminated = driver.employment_status === 'terminated';

  const { data: attendance = [] } = useQuery({
    queryKey: ['driver-attendance', driver.staff_id],
    queryFn: () => api.get(`/drivers/${driver.staff_id}/attendance`).then(r => r.data),
    enabled: tab === 'attendance',
  });

  const saveMut = useMutation({
    mutationFn: () => api.put(`/drivers/${driver.staff_id}/profile`, form),
    onSuccess: () => {
      toast.success('Profile saved');
      setDirty(false);
      qc.invalidateQueries(['drivers']);
      qc.invalidateQueries(['drivers-overview']);
      onSaved?.();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const resetPasswordMut = useMutation({
    mutationFn: () => api.post(`/drivers/${driver.staff_id}/reset-password`),
    onSuccess: (res) => {
      setTempPassword(res.data.temp_password);
      qc.invalidateQueries(['drivers']);
      toast.success('Temporary password generated');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Reset failed'),
  });

  const sendInviteMut = useMutation({
    mutationFn: () => api.post(`/auth/resend-invitation/${driver.staff_id}`),
    onSuccess: () => {
      qc.invalidateQueries(['drivers']);
      toast.success('Invitation email sent');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to send invitation'),
  });

  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setDirty(true); };

  const passwordSet = driver.has_password && !driver.must_change_password;
  const passwordTemp = driver.has_password && driver.must_change_password;
  const noLogin = !driver.has_password;

  const TABS = [
    { id: 'personal',    label: 'Personal Info',  icon: User },
    { id: 'account',     label: 'Login Account',  icon: LogIn },
    { id: 'id',          label: 'Identification', icon: Shield },
    { id: 'schedule',    label: 'Schedule',       icon: Calendar },
    { id: 'attendance',  label: 'Attendance',     icon: Clock },
    { id: 'notes',       label: 'Notes',          icon: FileText },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              {driver.first_name} {driver.last_name}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[driver.employment_status] || 'bg-slate-100 text-slate-600'}`}>
                {STATUS_LABEL[driver.employment_status] || driver.employment_status}
              </span>
              {driver.employee_code && <span className="text-xs text-slate-500">Code: {driver.employee_code}</span>}
              {isTerminated && <span className="text-xs text-red-500 font-medium">Profile locked</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isTerminated && dirty && (
              <button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                <Save size={14} /> {saveMut.isPending ? 'Saving...' : 'Save'}
              </button>
            )}
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Status actions */}
        {!isTerminated && (
          <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-slate-500 mr-1">Change status:</span>
            {STATUS_TABS.filter(s => s !== 'all' && s !== driver.employment_status).map(s => (
              <button
                key={s}
                onClick={() => setConfirm({ type: 'status', newStatus: s })}
                className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                  s === 'terminated' ? 'border-red-300 text-red-600 hover:bg-red-50' :
                  s === 'inactive'   ? 'border-amber-300 text-amber-600 hover:bg-amber-50' :
                  s === 'suspended'  ? 'border-orange-300 text-orange-600 hover:bg-orange-50' :
                                       'border-emerald-300 text-emerald-600 hover:bg-emerald-50'
                }`}
              >
                → {STATUS_LABEL[s]}
              </button>
            ))}
            <button
              onClick={() => setConfirm({ type: 'delete' })}
              className="ml-auto text-xs px-3 py-1 rounded-full font-medium border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
            >
              Delete Driver
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-slate-100 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                tab === t.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-6 space-y-4">

          {/* ── Personal Info ── */}
          {tab === 'personal' && (
            <div className="grid grid-cols-2 gap-4">
              {[
                ['first_name', 'First Name', 'text'],
                ['last_name',  'Last Name',  'text'],
              ].map(([k, label, type]) => (
                <div key={k}>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">{label}</label>
                  <input type={type} value={form[k]} onChange={e => set(k, e.target.value)} disabled={isTerminated}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Phone Number</label>
                <input type="text" value={form.phone} onChange={e => set('phone', e.target.value)} disabled={isTerminated}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Personal Email</label>
                <input type="email" value={form.personal_email} onChange={e => set('personal_email', e.target.value)} disabled={isTerminated}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Date of Birth</label>
                <input type="date" value={form.dob} onChange={e => set('dob', e.target.value)} disabled={isTerminated}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Hire Date</label>
                <input type="date" value={form.hire_date} onChange={e => set('hire_date', e.target.value)} disabled={isTerminated}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Employee Code</label>
                <input value={form.employee_code} onChange={e => set('employee_code', e.target.value)} disabled={isTerminated}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Employment Status</label>
                <span className={`inline-flex items-center px-3 py-2 rounded-lg text-sm font-medium ${STATUS_COLOR[driver.employment_status] || ''}`}>
                  {STATUS_LABEL[driver.employment_status] || driver.employment_status}
                </span>
              </div>
            </div>
          )}

          {/* ── Login Account ── */}
          {tab === 'account' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Work Email <span className="font-normal text-slate-400">(used to log in)</span></label>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)} disabled={isTerminated}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Role</label>
                  <select value={form.role} onChange={e => set('role', e.target.value)} disabled={isTerminated}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white disabled:bg-slate-50 disabled:text-slate-400">
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Last Login</label>
                  <div className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-600 bg-slate-50">
                    {driver.last_login
                      ? format(new Date(driver.last_login), 'MM/dd/yyyy h:mm a')
                      : <span className="text-slate-400">Never logged in</span>}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Login Status</label>
                  <div className="border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 flex items-center gap-2">
                    {driver.employment_status === 'active'
                      ? <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Login Enabled</span>
                      : <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Login Disabled</span>}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Password</label>
                  <div className="border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 flex items-center gap-2">
                    {passwordSet
                      ? <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">✓ Password Set</span>
                      : passwordTemp
                        ? <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">⚠ Temp Password (must change)</span>
                        : <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">✗ No Password Set</span>}
                  </div>
                </div>
              </div>

              {/* Account actions */}
              {!isTerminated && (
                <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Account Actions</p>
                  <div className="flex gap-2 flex-wrap items-center">
                    <button
                      onClick={() => resetPasswordMut.mutate()}
                      disabled={resetPasswordMut.isPending}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                      <Key size={12} />
                      {resetPasswordMut.isPending ? 'Resetting...' : 'Reset Password'}
                    </button>
                    <button
                      onClick={() => sendInviteMut.mutate()}
                      disabled={sendInviteMut.isPending || !!driver.last_login}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 border border-blue-300 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
                    >
                      <Mail size={12} />
                      {sendInviteMut.isPending ? 'Sending…' : (driver.invitation_sent_at ? 'Resend Invitation' : 'Send Invitation')}
                    </button>
                    {driver.invitation_sent_at && (
                      <span className="text-[11px] text-slate-400">
                        Last sent {format(new Date(driver.invitation_sent_at), 'MM/dd/yy')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">Reset Password generates a temporary password to share directly. Send Invitation emails a secure link for the driver to set their own password.</p>
                </div>
              )}

              {/* Temp password display */}
              {tempPassword && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-xs font-bold text-amber-700 mb-2 flex items-center gap-1.5"><Key size={12} /> Temporary Password Generated</p>
                  <p className="font-mono text-base font-bold text-amber-900 bg-white border border-amber-300 rounded-lg px-4 py-2.5 select-all tracking-wider">{tempPassword}</p>
                  <p className="text-xs text-amber-600 mt-2">Share this with the driver. They will be prompted to change it on first login.</p>
                  <button onClick={() => setTempPassword(null)} className="mt-2 text-xs text-amber-700 hover:text-amber-900 underline">Dismiss</button>
                </div>
              )}
            </div>
          )}

          {/* ── Identification ── */}
          {tab === 'id' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-500 mb-1">Transporter ID (DAProviderID)</label>
                <input value={form.transponder_id} onChange={e => set('transponder_id', e.target.value)} disabled={isTerminated}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Driver's License Number</label>
                <input value={form.license_number} onChange={e => set('license_number', e.target.value)} disabled={isTerminated}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">License State</label>
                <input value={form.license_state} onChange={e => set('license_state', e.target.value)} disabled={isTerminated}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400" placeholder="e.g. FL" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">License Expiration</label>
                <input type="date" value={form.license_expiration} onChange={e => set('license_expiration', e.target.value)} disabled={isTerminated}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400" />
              </div>
            </div>
          )}

          {/* ── Recurring Schedule ── */}
          {tab === 'schedule' && (
            <div>
              <p className="text-xs text-slate-500 mb-3">Set a recurring weekly pattern. Select shift type, days, and times — then click <strong>Save Changes</strong> to save and push to the upcoming schedule.</p>
              <RecurringGrid staffId={driver.staff_id} locked={isTerminated} />
            </div>
          )}

          {/* ── Attendance History ── */}
          {tab === 'attendance' && (
            <div>
              {attendance.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No attendance records found.</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {attendance.map(a => (
                    <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                      <span className="text-xs text-slate-500 w-20 flex-shrink-0">{fmtDate(a.attendance_date)}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                        a.status === 'ncns' ? 'bg-red-100 text-red-700' :
                        a.status === 'called_out' ? 'bg-amber-100 text-amber-700' :
                        a.status === 'late' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-emerald-100 text-emerald-700'
                      }`}>
                        {a.status === 'called_out' ? 'Called Out' :
                         a.status === 'ncns' ? 'NCNS' :
                         a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                      </span>
                      {a.call_out_reason && <span className="text-xs text-slate-500 truncate">{a.call_out_reason}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Notes ── */}
          {tab === 'notes' && (
            <div>
              <textarea
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                disabled={isTerminated}
                rows={6}
                placeholder="Add notes about this driver..."
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400 resize-none"
              />
            </div>
          )}
        </div>

        {/* Confirm sub-modal */}
        {confirm && (
          <ConfirmModal
            title={confirm.type === 'delete' ? 'Delete Driver?' : `Change status to ${STATUS_LABEL[confirm.newStatus]}?`}
            message={
              confirm.type === 'delete'
                ? `Permanently delete ${driver.first_name} ${driver.last_name}? This cannot be undone.`
                : confirm.newStatus === 'terminated'
                  ? `This will disable ${driver.first_name}'s login, remove them from the schedule, and permanently delete their recurring schedule.`
                  : confirm.newStatus === 'inactive'
                    ? `${driver.first_name}'s login will be disabled and they will be hidden from scheduling.`
                    : confirm.newStatus === 'suspended'
                      ? `${driver.first_name}'s login will be disabled. They remain visible in the schedule with a Suspended flag.`
                      : `${driver.first_name} will return to the active roster with full login access.`
            }
            confirmLabel={confirm.type === 'delete' ? 'Delete Forever' : `Set ${STATUS_LABEL[confirm.newStatus] || ''}`}
            danger={confirm.type === 'delete' || confirm.newStatus === 'terminated'}
            onClose={() => setConfirm(null)}
            onConfirm={() => {
              setConfirm(null);
              if (confirm.type === 'delete') onDelete(driver.staff_id);
              else onStatusChange(driver.staff_id, confirm.newStatus);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Add Driver Modal ─────────────────────────────────────────────────────────
function AddDriverModal({ onClose, onSaved }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    first_name: '', last_name: '',
    email: '', personal_email: '', phone: '',
    role: 'driver', hire_date: '', employee_code: '',
    transponder_id: '', dob: '',
    license_number: '', license_expiration: '', license_state: '',
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const createMut = useMutation({
    mutationFn: () => api.post('/drivers/create', form),
    onSuccess: (res) => {
      toast.success('Driver created! Use Reset Password to set a temporary login password.');
      qc.invalidateQueries(['drivers']);
      qc.invalidateQueries(['drivers-overview']);
      onSaved?.();
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to create driver'),
  });

  const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-800">Add New Driver</h2>
            <p className="text-xs text-slate-400 mt-0.5">Creates driver profile + login account in one step</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-400"><X size={16} /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* ── Driver Identity ── */}
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Driver Info</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">First Name *</label>
                <input type="text" value={form.first_name} onChange={e => set('first_name', e.target.value)} className={inp} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Last Name *</label>
                <input type="text" value={form.last_name} onChange={e => set('last_name', e.target.value)} className={inp} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Hire Date</label>
                <input type="date" value={form.hire_date} onChange={e => set('hire_date', e.target.value)} className={inp} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Date of Birth</label>
                <input type="date" value={form.dob} onChange={e => set('dob', e.target.value)} className={inp} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Employee Code</label>
                <input type="text" value={form.employee_code} onChange={e => set('employee_code', e.target.value)} className={inp} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Transporter ID</label>
                <input type="text" value={form.transponder_id} onChange={e => set('transponder_id', e.target.value)} className={inp} />
              </div>
            </div>
          </div>

          {/* ── License ── */}
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Driver's License</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="block text-xs font-semibold text-slate-500 mb-1">License Number</label>
                <input type="text" value={form.license_number} onChange={e => set('license_number', e.target.value)} className={inp} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">State</label>
                <input type="text" value={form.license_state} onChange={e => set('license_state', e.target.value)} className={inp} placeholder="FL" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Expiration</label>
                <input type="date" value={form.license_expiration} onChange={e => set('license_expiration', e.target.value)} className={inp} />
              </div>
            </div>
          </div>

          {/* ── Login Account ── */}
          <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
            <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <LogIn size={11} /> Login Account
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Work Email * <span className="font-normal text-slate-400">(used to log in)</span></label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inp} placeholder="driver@company.com" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Role</label>
                <select value={form.role} onChange={e => set('role', e.target.value)} className={inp + ' bg-white'}>
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Personal Email</label>
                <input type="email" value={form.personal_email} onChange={e => set('personal_email', e.target.value)} className={inp} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Phone Number</label>
                <input type="text" value={form.phone} onChange={e => set('phone', e.target.value)} className={inp} />
              </div>
            </div>
            <p className="text-xs text-blue-500 mt-2.5">After creating, go to the driver's profile → Account tab → Reset Password to set a temporary login password.</p>
          </div>
        </div>

        <div className="px-6 pb-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
          <button
            onClick={() => createMut.mutate()}
            disabled={!form.first_name || !form.last_name || !form.email || createMut.isPending}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {createMut.isPending ? 'Creating...' : 'Create Driver'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SortableHeader ───────────────────────────────────────────────────────────
function SortableHeader({ label, col, sortKey, sortDir, onToggle, align = 'left' }) {
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

// ─── All Drivers Section ──────────────────────────────────────────────────────
function AllDriversSection({ onOpenProfile, initialStatus }) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState(() => initialStatus || localStorage.getItem('drivers_status') || 'active');
  const [search, setSearch] = useState('');
  const [licenseFilter, setLicenseFilter] = useState('all');
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const filter = searchParams.get('filter');
    if (filter === 'license') setLicenseFilter('expiring');
  }, []);
  const [addOpen, setAddOpen] = useState(false);

  const saveFilter = (s) => { setStatusFilter(s); localStorage.setItem('drivers_status', s); };
  const hasActiveFilters = licenseFilter !== 'all';
  const clearFilters = () => { setLicenseFilter('all'); };

  const sendInviteMutation = useMutation({
    mutationFn: (staffId) => api.post(`/auth/resend-invitation/${staffId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drivers'] });
      toast.success('Invitation sent!');
    },
    onError: () => toast.error('Failed to send invitation'),
  });

  const { data: allDrivers = [], isLoading } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get('/drivers').then(r => r.data),
  });
  const { data: overview = [] } = useQuery({
    queryKey: ['drivers-overview'],
    queryFn: () => api.get('/drivers/recurring-overview').then(r => r.data),
  });

  // Merge recurring info + computed fields for sorting
  const drivers = allDrivers.map(d => {
    const ov = overview.find(o => o.staff_id === d.staff_id);
    const recurring_rows = ov?.recurring_rows || [];
    return { ...d, recurring_rows, has_recurring: recurring_rows.length > 0 ? 1 : 0 };
  });

  const filtered = drivers
    .filter(d => statusFilter === 'all' ? true : d.employment_status === statusFilter)
    .filter(d => {
      if (!search) return true;
      const q = search.toLowerCase();
      return `${d.first_name} ${d.last_name}`.toLowerCase().includes(q)
        || (d.transponder_id || '').toLowerCase().includes(q)
        || (d.employee_code || '').toLowerCase().includes(q)
        || (d.email || '').toLowerCase().includes(q);
    })
    .filter(d => {
      if (licenseFilter === 'all') return true;
      if (!d.license_expiration) return false;
      const days = differenceInDays(parseISO(String(d.license_expiration).slice(0, 10)), new Date());
      if (licenseFilter === 'expired') return days < 0;
      if (licenseFilter === 'expiring') return days >= 0 && days <= 60;
      return true;
    });

  const { sorted: displayedDrivers, sortKey, sortDir, toggle, setSortKey, setSortDir } = useSort(filtered, 'last_name', 'asc');

  const counts = STATUS_TABS.reduce((acc, s) => {
    acc[s] = s === 'all' ? drivers.length : drivers.filter(d => d.employment_status === s).length;
    return acc;
  }, {});

  const LicensePill = ({ val, label }) => (
    <button
      onClick={() => setLicenseFilter(val)}
      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
        licenseFilter === val
          ? 'bg-blue-600 text-white border-blue-600'
          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
      }`}
    >{label}</button>
  );
  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
          {STATUS_TABS.map(s => (
            <button
              key={s}
              onClick={() => saveFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${statusFilter === s ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {STATUS_LABEL[s]} <span className="ml-1 text-xs opacity-60">{counts[s] || 0}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-1 justify-end">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search drivers…"
              className="pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none w-52"
            />
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={14} /> Add Driver
          </button>
        </div>
      </div>

      {/* Filter + Sort row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">License</span>
        <LicensePill val="all" label="All" />
        <LicensePill val="expiring" label="Expiring Soon" />
        <LicensePill val="expired" label="Expired" />

        <span className="w-px h-4 bg-slate-200" />

        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sort</span>
        <select
          value={`${sortKey}-${sortDir}`}
          onChange={e => {
            const [key, dir] = e.target.value.split('-');
            setSortKey(key);
            setSortDir(dir);
          }}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        >
          <option value="last_name-asc">Last Name A→Z</option>
          <option value="last_name-desc">Last Name Z→A</option>
          <option value="first_name-asc">First Name A→Z</option>
          <option value="first_name-desc">First Name Z→A</option>
          <option value="hire_date-asc">Hire Date (Oldest first)</option>
          <option value="hire_date-desc">Hire Date (Newest first)</option>
          <option value="license_expiration-asc">License Expiring Soon</option>
        </select>

        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
            <X size={11} /> Clear Filters
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400">{displayedDrivers.length} driver{displayedDrivers.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="text-center py-16 text-slate-400">Loading drivers…</div>
        ) : displayedDrivers.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            {search || hasActiveFilters ? 'No drivers match the current filters' : `No ${statusFilter === 'all' ? '' : statusFilter + ' '}drivers`}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-3 py-2.5 font-semibold text-slate-500 text-xs">First Name</th>
                <th className="text-left px-3 py-2.5 font-semibold text-slate-500 text-xs">Last Name / Email</th>
                <th className="text-left px-3 py-2.5 font-semibold text-slate-500 text-xs">Transporter ID</th>
                <SortableHeader label="Hire Date"    col="hire_date"           sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <SortableHeader label="License Exp"  col="license_expiration"  sortKey={sortKey} sortDir={sortDir} onToggle={toggle} />
                <th className="text-center px-3 py-2.5 font-semibold text-slate-500 text-xs">Account</th>
                <th className="text-left px-3 py-2.5 font-semibold text-slate-500 text-xs">Portal</th>
                <SortableHeader label="Status"       col="employment_status"   sortKey={sortKey} sortDir={sortDir} onToggle={toggle} align="center" />
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedDrivers.map(d => {
                const expired = d.license_expiration
                  ? differenceInDays(parseISO(String(d.license_expiration).slice(0,10)), new Date()) < 0
                  : false;
                const hasRec = hasRecurring(d);
                return (
                  <tr
                    key={d.staff_id}
                    className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                    onClick={() => onOpenProfile(d)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-800">{d.first_name}</div>
                      {d.employee_code && <div className="text-xs text-slate-400">{d.employee_code}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-800">{d.last_name}</div>
                      {d.email && !d.email.includes('@import.local') && (
                        <div className="text-xs text-slate-400 truncate max-w-[160px]" title={d.email}>{d.email}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-xs text-slate-600">{d.transponder_id || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{fmtDate(d.hire_date)}</td>
                    <td className="px-3 py-2.5">
                      <span className={licenseExpClass(d.license_expiration)}>
                        {fmtDate(d.license_expiration)}
                        {expired && ' ⚠'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {d.has_password && !d.must_change_password
                        ? <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">Active</span>
                        : d.has_password
                          ? <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">Temp</span>
                          : <span className="text-xs bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full font-medium">No Login</span>
                      }
                    </td>
                    <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      {(() => {
                        const status = getPortalStatus(d);
                        if (status === 'active') return (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">Active</span>
                        );
                        if (status === 'invited') return (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">Invited</span>
                            <button
                              onClick={() => sendInviteMutation.mutate(d.staff_id)}
                              className="text-[11px] text-blue-600 hover:underline"
                            >Resend</button>
                          </div>
                        );
                        return (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700">Not Sent</span>
                            <button
                              onClick={() => sendInviteMutation.mutate(d.staff_id)}
                              className="text-[11px] text-blue-600 hover:underline font-medium"
                            >Send</button>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[d.employment_status] || ''}`}>
                        {STATUS_LABEL[d.employment_status] || d.employment_status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={e => { e.stopPropagation(); onOpenProfile(d); }}
                        className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {addOpen && <AddDriverModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}

// ─── Recurring Schedules Section ──────────────────────────────────────────────
function RecurringSection({ onOpenProfile }) {
  const [search,    setSearch]    = useState('');
  const [sortBy,    setSortBy]    = useState('last_name');
  const [groupView, setGroupView] = useState('all'); // 'all' | 'unassigned' | 'assigned'

  const { data: overview = [], isLoading } = useQuery({
    queryKey: ['drivers-overview'],
    queryFn: () => api.get('/drivers/recurring-overview').then(r => r.data),
  });
  const { data: allDrivers = [] } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get('/drivers').then(r => r.data),
  });

  const enriched = overview.map(o => {
    const d = allDrivers.find(d => d.staff_id === o.staff_id) || {};
    return { ...o, employment_status: d.employment_status, hire_date: d.hire_date, transponder_id: d.transponder_id };
  }).filter(o => o.employment_status === 'active');

  // Apply search
  const searched = enriched.filter(d =>
    !search || `${d.first_name} ${d.last_name}`.toLowerCase().includes(search.toLowerCase())
  );

  // Sort comparator (applied within each group)
  const sortFn = (a, b) => {
    if (sortBy === 'first_name') return (a.first_name || '').localeCompare(b.first_name || '') || (a.last_name || '').localeCompare(b.last_name || '');
    if (sortBy === 'hire_date')  return (a.hire_date || '').localeCompare(b.hire_date || '');
    if (sortBy === 'status')     return (a.employment_status || '').localeCompare(b.employment_status || '');
    // default: last_name
    return (a.last_name || '').localeCompare(b.last_name || '') || (a.first_name || '').localeCompare(b.first_name || '');
  };

  const unassigned = searched.filter(d => (d.recurring_rows || []).length === 0).sort(sortFn);
  const assigned   = searched.filter(d => (d.recurring_rows || []).length >  0).sort(sortFn);

  // Raw counts (ignore search for header numbers)
  const totalUnassigned = enriched.filter(d => (d.recurring_rows || []).length === 0).length;
  const totalAssigned   = enriched.filter(d => (d.recurring_rows || []).length >  0).length;

  const showUnassigned = groupView !== 'assigned';
  const showAssigned   = groupView !== 'unassigned';

  if (isLoading) return <div className="text-center py-16 text-slate-400">Loading…</div>;

  return (
    <div className="h-full flex flex-col">

      {/* ── Controls ── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search driver…"
            className="pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none w-full bg-white"
          />
        </div>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
        >
          <option value="last_name">Sort: Last Name</option>
          <option value="first_name">Sort: First Name</option>
          <option value="hire_date">Sort: Hire Date</option>
          <option value="status">Sort: Status</option>
        </select>

        {/* Filter toggle */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white text-sm font-medium">
          {[
            { key: 'all',        label: 'Show All' },
            { key: 'unassigned', label: 'Unassigned' },
            { key: 'assigned',   label: 'Assigned' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setGroupView(f.key)}
              className={`px-3 py-2 transition-colors ${
                groupView === f.key
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <span className="text-xs text-slate-400 ml-auto">
          {searched.length} driver{searched.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-auto space-y-2">

        {/* Awaiting Setup group */}
        {showUnassigned && (
          <>
            <div className="flex items-center gap-2 sticky top-0 bg-slate-50 py-2 z-10">
              <span className="text-xs font-bold text-amber-700 uppercase tracking-wide">
                Awaiting Setup
              </span>
              <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
                {totalUnassigned}
              </span>
              {search && unassigned.length !== totalUnassigned && (
                <span className="text-[10px] text-slate-400">({unassigned.length} shown)</span>
              )}
            </div>

            {unassigned.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-sm">
                {search ? 'No unassigned drivers match' : '✅ All drivers have schedules configured'}
              </div>
            ) : unassigned.map(d => (
              <div key={d.staff_id} className="border border-amber-200 bg-amber-50/30 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onOpenProfile({ ...d }, 'schedule')}
                      className="font-semibold text-slate-800 hover:text-blue-600 transition-colors text-sm"
                    >
                      {d.first_name} {d.last_name}
                    </button>
                    <span className="text-xs text-amber-600 font-medium">Not configured</span>
                  </div>
                  {d.hire_date && (
                    <span className="text-xs text-slate-400">Hired {fmtDate(d.hire_date)}</span>
                  )}
                </div>
                <RecurringGrid staffId={d.staff_id} />
              </div>
            ))}
          </>
        )}

        {/* Divider between groups */}
        {showUnassigned && showAssigned && (
          <div className="flex items-center gap-3 py-3">
            <div className="flex-1 h-px bg-slate-200" />
          </div>
        )}

        {/* Scheduled group */}
        {showAssigned && (
          <>
            <div className="flex items-center gap-2 sticky top-0 bg-slate-50 py-2 z-10">
              <span className="text-xs font-bold text-blue-700 uppercase tracking-wide">
                Scheduled
              </span>
              <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">
                {totalAssigned}
              </span>
              {search && assigned.length !== totalAssigned && (
                <span className="text-[10px] text-slate-400">({assigned.length} shown)</span>
              )}
            </div>

            {assigned.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-sm">
                {search ? 'No scheduled drivers match' : 'No drivers have schedules yet'}
              </div>
            ) : assigned.map(d => (
              <div key={d.staff_id} className="border border-slate-200 bg-white rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => onOpenProfile({ ...d }, 'schedule')}
                    className="font-semibold text-slate-800 hover:text-blue-600 transition-colors text-sm"
                  >
                    {d.first_name} {d.last_name}
                  </button>
                  {d.hire_date && (
                    <span className="text-xs text-slate-400">Hired {fmtDate(d.hire_date)}</span>
                  )}
                </div>
                <RecurringGrid staffId={d.staff_id} />
              </div>
            ))}
          </>
        )}

      </div>
    </div>
  );
}

// ─── Driver Alerts Section ────────────────────────────────────────────────────
function AlertsSection({ onOpenProfile }) {
  const { data: allDrivers = [], isLoading } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get('/drivers').then(r => r.data),
  });
  const { data: overview = [] } = useQuery({
    queryKey: ['drivers-overview'],
    queryFn: () => api.get('/drivers/recurring-overview').then(r => r.data),
  });

  const active = allDrivers.filter(d => d.employment_status === 'active');
  const enriched = active.map(d => {
    const ov = overview.find(o => o.staff_id === d.staff_id);
    return { ...d, recurring_rows: ov?.recurring_rows || [] };
  });

  const today = new Date();
  const noSchedule = enriched.filter(d => (d.recurring_rows || []).length === 0);
  const licExpired = enriched.filter(d => d.license_expiration &&
    differenceInDays(parseISO(String(d.license_expiration).slice(0,10)), today) < 0);
  const licExpiring = enriched.filter(d => d.license_expiration && (() => {
    const days = differenceInDays(parseISO(String(d.license_expiration).slice(0,10)), today);
    return days >= 0 && days <= 60;
  })());

  const AlertRow = ({ driver, label, color, icon, openTab }) => (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl border hover:shadow-sm transition-all cursor-pointer bg-white"
      onClick={() => onOpenProfile(driver, openTab)}
    >
      <span className="text-lg">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-800 text-sm">{driver.first_name} {driver.last_name}</p>
        <p className={`text-xs ${color}`}>{label}</p>
      </div>
      <button className="text-xs px-3 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors flex-shrink-0">
        View Profile
      </button>
    </div>
  );

  const Section = ({ title, items, color, icon, emptyMsg, openTab }) => (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{icon}</span>
        <h3 className="font-semibold text-slate-700 text-sm">{title}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${items.length > 0 ? color : 'bg-slate-100 text-slate-400'}`}>
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400 px-4 py-2">{emptyMsg}</p>
      ) : (
        <div className="space-y-2">
          {items.map(d => (
            <AlertRow
              key={d.staff_id}
              driver={d}
              icon={icon}
              openTab={openTab}
              color={color.replace('bg-', 'text-').replace(/100|50/, '600')}
              label={
                title.includes('Schedule') ? 'No recurring schedule set'
                : title.includes('Expired') ? `Expired ${fmtDate(d.license_expiration)}`
                : `Expires ${fmtDate(d.license_expiration)} (${differenceInDays(parseISO(String(d.license_expiration).slice(0,10)), today)} days)`
              }
            />
          ))}
        </div>
      )}
    </div>
  );

  if (isLoading) return <div className="text-center py-16 text-slate-400">Loading…</div>;

  return (
    <div>
      <Section title="No Recurring Schedule" items={noSchedule} icon="🔴" color="bg-red-100 text-red-700" emptyMsg="All active drivers have a schedule configured." openTab="schedule" />
      <Section title="License Expired" items={licExpired} icon="🔴" color="bg-red-100 text-red-700" emptyMsg="No expired licenses." openTab="id" />
      <Section title="License Expiring Within 60 Days" items={licExpiring} icon="🟡" color="bg-amber-100 text-amber-700" emptyMsg="No licenses expiring soon." openTab="id" />
    </div>
  );
}

// ─── Main Drivers Page ────────────────────────────────────────────────────────
export default function Drivers() {
  const qc = useQueryClient();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [section, setSection] = useState(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'user-management' || tabParam === 'invitations') return tabParam;
    if (location.state?.section) return location.state.section;
    return localStorage.getItem('drivers_section') || 'all-drivers';
  });
  const [profileDriver, setProfileDriver] = useState(null);
  const initialStatus = location.state?.status || null;

  // Sync ?tab= URL param (deep links from Management redirects)
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'user-management' || tabParam === 'invitations') {
      setSection(tabParam);
    }
  }, [searchParams]);

  const { data: allDrivers = [] } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api.get('/drivers').then(r => r.data),
  });
  const notSentCount = allDrivers.filter(d => !d.invitation_sent_at && !d.last_login).length;

  const saveSection = (s) => {
    setSection(s);
    // Only persist the three core driver sections in localStorage
    if (s === 'all-drivers' || s === 'recurring' || s === 'alerts') {
      localStorage.setItem('drivers_section', s);
    }
    // Clear any ?tab= param when switching sections manually
    if (searchParams.get('tab')) {
      setSearchParams({}, { replace: true });
    }
  };

  const statusMut = useMutation({
    mutationFn: ({ staffId, status }) => api.put(`/drivers/${staffId}/status`, { status }),
    onSuccess: (_, { status }) => {
      qc.invalidateQueries(['drivers']);
      qc.invalidateQueries(['drivers-overview']);
      toast.success(`Driver status updated to ${status}`);
      setProfileDriver(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Status change failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (staffId) => api.delete(`/drivers/${staffId}`),
    onSuccess: () => {
      toast.success('Driver deleted');
      qc.invalidateQueries(['drivers']);
      qc.invalidateQueries(['drivers-overview']);
      setProfileDriver(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Delete failed'),
  });

  const openProfile = useCallback((driver, tab) => {
    setProfileDriver(tab ? { ...driver, _initialTab: tab } : driver);
  }, []);

  return (
    <div className="flex -mt-6 -mx-6 -mb-6" style={{ minHeight: 'calc(100vh - 3.5rem)' }}>

      {/* ── Left Sidebar ── */}
      <div className="w-52 bg-slate-900 flex-shrink-0 flex flex-col">
        <div className="px-4 pt-5 pb-3">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Drivers</p>
        </div>
        <nav className="flex-1 px-2 space-y-0.5">
          {SIDEBAR.map(item => (
            <button
              key={item.id}
              onClick={() => saveSection(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                section === item.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/60'
              }`}
            >
              <item.icon size={15} />
              <span className="flex-1 text-left">{item.label}</span>
              {item.id === 'all-drivers' && notSentCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                  {notSentCount}
                </span>
              )}
            </button>
          ))}

          <div className="my-2 border-t border-slate-700/50" />
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-3 pb-1">People Ops</p>

          <button
            onClick={() => saveSection('user-management')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              section === 'user-management'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/60'
            }`}
          >
            <Users size={15} className="flex-shrink-0" />
            <span className="flex-1 text-left">User Management</span>
          </button>

          <button
            onClick={() => saveSection('invitations')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              section === 'invitations'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/60'
            }`}
          >
            <Mail size={15} className="flex-shrink-0" />
            <span className="flex-1 text-left">Invitations</span>
            {notSentCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white leading-none">{notSentCount}</span>
            )}
          </button>
        </nav>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-auto bg-slate-50 p-6">
        {section === 'all-drivers'     && <AllDriversSection onOpenProfile={openProfile} initialStatus={initialStatus} />}
        {section === 'recurring'       && <RecurringSection onOpenProfile={openProfile} />}
        {section === 'alerts'          && <AlertsSection onOpenProfile={openProfile} />}
        {section === 'user-management' && <div className="space-y-5"><UserManagementPanel enabled={section === 'user-management'} /></div>}
        {section === 'invitations'     && <div className="space-y-5"><InvitationsPanel enabled={section === 'invitations'} /></div>}
      </div>

      {/* ── Driver Profile Modal ── */}
      {profileDriver && (
        <DriverProfile
          driver={profileDriver}
          onClose={() => setProfileDriver(null)}
          onStatusChange={(staffId, status) => statusMut.mutate({ staffId, status })}
          onDelete={(staffId) => deleteMut.mutate(staffId)}
          onSaved={() => {
            qc.invalidateQueries(['drivers']);
            qc.invalidateQueries(['drivers-overview']);
          }}
        />
      )}
    </div>
  );
}
