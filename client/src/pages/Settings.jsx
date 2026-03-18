import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Save, Plus, Trash2, Shield, Bell, Cpu, DollarSign, Cloud, ToggleLeft, ToggleRight, Tag, RepeatIcon, X, ChevronDown, ChevronUp, Search, Users, UserPlus, RefreshCw } from 'lucide-react';
import { format, startOfWeek } from 'date-fns';
import api from '../api/client';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import { useAuth } from '../App';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const VIOLATION_TYPES = [
  { value: 'ncns', label: 'NCNS (No Call No Show)' },
  { value: 'called_out', label: 'Call-Out' },
  { value: 'late', label: 'Late Arrival' },
];

const CONSEQUENCE_ACTIONS = [
  { value: 'verbal_warning', label: 'Verbal Warning' },
  { value: 'written_warning', label: 'Written Warning' },
  { value: 'suspension', label: 'Suspension' },
  { value: 'termination_review', label: 'Termination Review' },
];

const SHIFT_DOT_COLORS = {
  'EDV': 'bg-blue-500', 'STEP VAN': 'bg-indigo-700', 'HELPER': 'bg-amber-500',
  'ON CALL': 'bg-yellow-500', 'EXTRA': 'bg-green-500',
  'DISPATCH AM': 'bg-cyan-500', 'DISPATCH PM': 'bg-sky-600',
  'SUSPENSION': 'bg-red-500', 'UTO': 'bg-purple-500', 'PTO': 'bg-teal-500', 'TRAINING': 'bg-orange-500',
};
const DR_DAYS_COL  = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DR_DAYS_HEAD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DR_DAYS_BTN  = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Shared style constants
const SH = 'text-[16px] font-bold text-[#1E3A5F] flex items-center gap-2';
const FL = 'block text-[13px] font-medium text-[#374151] mb-1.5';
const CARD = 'bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-5 space-y-4';

export default function Settings() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/management', { replace: true }); }, []);
  return null;

  // eslint-disable-next-line no-unreachable
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';
  const [settings, setSettings] = useState({});
  const [ruleModal, setRuleModal] = useState(false);
  const [editRule, setEditRule] = useState(null);
  const [ruleForm, setRuleForm] = useState({ rule_name: '', violation_type: 'ncns', threshold: 3, time_period_days: 90, consequence_action: 'written_warning' });

  // Shift type CRUD state
  const [shiftTypeModal, setShiftTypeModal] = useState(null); // null | { mode:'create'|'edit', item? }
  const [stForm, setStForm] = useState({ name: '', color: '#3B82F6', is_active: true, default_start_time: '07:00', default_end_time: '17:00' });

  // Day-based recurring schedule state
  const [expandedDay, setExpandedDay]     = useState(null); // 0-6 | null
  const [dayDriverSearch, setDayDriverSearch] = useState('');
  const [dayFormEdits, setDayFormEdits]   = useState({}); // { [day]: { shift_type, start_time, end_time } }

  // Recurring schedule filters (day-based)
  const [recurringDriverSearch, setRecurringDriverSearch] = useState('');
  const [recurringFilterDay, setRecurringFilterDay]       = useState(''); // '' | '0'-'6'
  const [recurringFilterType, setRecurringFilterType]     = useState('');
  const [recurringShowUnassigned, setRecurringShowUnassigned] = useState(false);

  // Per-driver recurring schedule state
  const [drSearch, setDrSearch]                   = useState('');
  const [drFilterDay, setDrFilterDay]             = useState(''); // '' | 'sun'|'mon'|...
  const [drFilterType, setDrFilterType]           = useState('');
  const [drFilterRotating, setDrFilterRotating]   = useState(''); // '' | 'rotating' | 'static'
  const [drFilterNoRecurring, setDrFilterNoRecurring] = useState(false);
  const [drExpandedId, setDrExpandedId]           = useState(null); // expanded staff_id

  const { data: rawSettings = {} } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
  });

  const { data: rules = [] } = useQuery({
    queryKey: ['consequence-rules'],
    queryFn: () => api.get('/settings/consequence-rules').then(r => r.data),
  });

  useEffect(() => { setSettings(rawSettings); }, [JSON.stringify(rawSettings)]);

  const saveSettings = useMutation({
    mutationFn: () => api.put('/settings', settings),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Settings saved'); },
  });

  const saveRule = useMutation({
    mutationFn: () => editRule ? api.put(`/settings/consequence-rules/${editRule.id}`, ruleForm) : api.post('/settings/consequence-rules', ruleForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['consequence-rules'] }); toast.success(editRule ? 'Rule updated' : 'Rule created'); setRuleModal(false); setEditRule(null); },
  });

  const deleteRule = useMutation({
    mutationFn: id => api.delete(`/settings/consequence-rules/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['consequence-rules'] }); toast.success('Rule deleted'); },
  });

  const toggleRule = useMutation({
    mutationFn: ({ id, is_active, ...rest }) => api.put(`/settings/consequence-rules/${id}`, { ...rest, is_active: !is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consequence-rules'] }),
  });

  const openAddRule = () => { setEditRule(null); setRuleForm({ rule_name: '', violation_type: 'ncns', threshold: 3, time_period_days: 90, consequence_action: 'written_warning' }); setRuleModal(true); };
  const openEditRule = (r) => { setEditRule(r); setRuleForm(r); setRuleModal(true); };

  // ── Shift Types ────────────────────────────────────────────────────────────
  const { data: shiftTypes = [] } = useQuery({
    queryKey: ['shift-types'],
    queryFn: () => api.get('/schedule/shift-types').then(r => r.data),
  });

  const createShiftType = useMutation({
    mutationFn: data => api.post('/schedule/shift-types', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shift-types'] }); toast.success('Shift type created'); setShiftTypeModal(null); },
  });

  const updateShiftType = useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/schedule/shift-types/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shift-types'] }); toast.success('Shift type updated'); setShiftTypeModal(null); },
  });

  const deleteShiftType = useMutation({
    mutationFn: id => api.delete(`/schedule/shift-types/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shift-types'] }); toast.success('Shift type deleted'); },
  });

  // ── Day-based Recurring Schedules ─────────────────────────────────────────
  const { data: dayRecurring = [] } = useQuery({
    queryKey: ['day-recurring'],
    queryFn: () => api.get('/schedule/day-recurring').then(r => r.data),
  });

  const { data: allStaff = [] } = useQuery({
    queryKey: ['staff', 'drivers'],
    queryFn: () => api.get('/staff', { params: { role: 'driver', status: 'active' } }).then(r => r.data),
  });

  const updateDayConfig = useMutation({
    mutationFn: ({ day, ...data }) => api.put(`/schedule/day-recurring/${day}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['day-recurring'] }); toast.success('Saved'); },
  });

  const addDayDriver = useMutation({
    mutationFn: ({ day, staff_id }) => api.post(`/schedule/day-recurring/${day}/drivers`, { staff_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['day-recurring'] }),
  });

  const removeDayDriver = useMutation({
    mutationFn: ({ day, staff_id }) => api.delete(`/schedule/day-recurring/${day}/drivers/${staff_id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['day-recurring'] }),
  });

  const applyDayRecurring = useMutation({
    mutationFn: (week_start) => api.post('/schedule/day-recurring/apply', { week_start }),
    onSuccess: (res) => { toast.success(`Applied ${res.data.created} shifts (${res.data.skipped} skipped)`); qc.invalidateQueries(['shifts']); },
    onError: () => toast.error('Failed to apply recurring schedules'),
  });

  // ── Per-Driver Recurring Schedules ────────────────────────────────────────
  const { data: driverRecurringOverview = [], isLoading: drLoading } = useQuery({
    queryKey: ['driver-recurring-overview'],
    queryFn: () => api.get('/drivers/recurring-overview').then(r => r.data),
    enabled: isAdmin,
  });

  const drAddRow = useMutation({
    mutationFn: ({ staffId }) => api.post(`/drivers/${staffId}/recurring`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver-recurring-overview'] }),
    onError: () => toast.error('Failed to add shift row'),
  });
  const drUpdateRow = useMutation({
    mutationFn: row => api.put(`/drivers/${row.staff_id}/recurring/${row.id}`, row),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver-recurring-overview'] }),
    onError: () => toast.error('Failed to update shift'),
  });
  const drDeleteRow = useMutation({
    mutationFn: ({ staffId, rowId }) => api.delete(`/drivers/${staffId}/recurring/${rowId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver-recurring-overview'] }),
    onError: () => toast.error('Failed to remove row'),
  });
  const drToggleRotating = useMutation({
    mutationFn: ({ staffId, is_rotating }) => api.put(`/drivers/${staffId}/rotating`, { is_rotating }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver-recurring-overview'] });
      qc.invalidateQueries({ queryKey: ['drivers'] });
    },
    onError: () => toast.error('Failed to update rotating status'),
  });

  // ── User Management (admin only) ────────────────────────────────────────────
  const [showAddUser, setShowAddUser] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [uForm, setUForm] = useState({ first_name: '', last_name: '', email: '', role: 'driver', password: '', must_change_password: true });
  const [editUForm, setEditUForm] = useState({ role: '', status: '', password: '' });

  const { data: userList = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/auth/users').then(r => r.data),
    enabled: isAdmin,
  });

  const createUser = useMutation({
    mutationFn: d => api.post('/auth/users', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setShowAddUser(false); setUForm({ first_name: '', last_name: '', email: '', role: 'driver', password: '', must_change_password: true }); toast.success('User created'); },
    onError: err => toast.error(err.response?.data?.error || 'Failed to create user'),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, ...d }) => api.put(`/auth/users/${id}`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setEditUser(null); toast.success('User updated'); },
    onError: err => toast.error(err.response?.data?.error || 'Failed to update user'),
  });

  const openEditUser = (u) => {
    setEditUser(u);
    setEditUForm({ role: u.role, status: u.status, password: '' });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-[24px] font-bold text-[#111827]">Settings</h1>

      {/* ── General ─────────────────────────────────────────────────────── */}
      <section className={CARD}>
        <h2 className={SH + ' pb-3 border-b border-[#E2E8F0]'}>
          <Bell size={18} className="text-[#2563EB]" /> General
        </h2>
        <div>
          <label className={FL}>Company Name</label>
          <input className="input" value={settings.company_name || ''} onChange={e => setSettings(s => ({ ...s, company_name: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={FL}>Default Shift Start</label>
            <input type="time" className="input" value={settings.default_shift_start || '07:00'} onChange={e => setSettings(s => ({ ...s, default_shift_start: e.target.value }))} />
          </div>
          <div>
            <label className={FL}>Default Shift End</label>
            <input type="time" className="input" value={settings.default_shift_end || '17:00'} onChange={e => setSettings(s => ({ ...s, default_shift_end: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={FL}>Insurance Alert (days)</label>
            <input type="number" className="input" value={settings.alert_days_insurance || 30} onChange={e => setSettings(s => ({ ...s, alert_days_insurance: e.target.value }))} />
          </div>
          <div>
            <label className={FL}>Registration Alert (days)</label>
            <input type="number" className="input" value={settings.alert_days_registration || 30} onChange={e => setSettings(s => ({ ...s, alert_days_registration: e.target.value }))} />
          </div>
          <div>
            <label className={FL}>Inspection Alert (days)</label>
            <input type="number" className="input" value={settings.alert_days_inspection || 14} onChange={e => setSettings(s => ({ ...s, alert_days_inspection: e.target.value }))} />
          </div>
        </div>
      </section>

      {/* ── Payroll Integration ──────────────────────────────────────────── */}
      <section className={CARD}>
        <h2 className={SH + ' pb-3 border-b border-[#E2E8F0]'}>
          <DollarSign size={18} className="text-[#2563EB]" /> Payroll Integration
        </h2>
        <div className="grid grid-cols-2 gap-6">
          {/* Paycom */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[#1E3A5F] text-[15px]">Paycom</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={settings.paycom_enabled === 'true'} onChange={e => setSettings(s => ({ ...s, paycom_enabled: String(e.target.checked) }))} className="rounded accent-[#2563EB]" />
                <span className="text-sm text-[#111827]">Enabled</span>
              </label>
            </div>
            <div>
              <label className={FL}>API Key</label>
              <input type="password" className="input" value={settings.paycom_api_key || ''} onChange={e => setSettings(s => ({ ...s, paycom_api_key: e.target.value }))} placeholder="Paycom API key" />
            </div>
          </div>
          {/* ADP */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[#1E3A5F] text-[15px]">ADP</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={settings.adp_enabled === 'true'} onChange={e => setSettings(s => ({ ...s, adp_enabled: String(e.target.checked) }))} className="rounded accent-[#2563EB]" />
                <span className="text-sm text-[#111827]">Enabled</span>
              </label>
            </div>
            <div>
              <label className={FL}>Client ID</label>
              <input className="input" value={settings.adp_client_id || ''} onChange={e => setSettings(s => ({ ...s, adp_client_id: e.target.value }))} />
            </div>
            <div>
              <label className={FL}>Client Secret</label>
              <input type="password" className="input" value={settings.adp_client_secret || ''} onChange={e => setSettings(s => ({ ...s, adp_client_secret: e.target.value }))} />
            </div>
          </div>
        </div>
      </section>

      {/* ── AI Damage Detection ──────────────────────────────────────────── */}
      <section className={CARD}>
        <h2 className={SH + ' pb-3 border-b border-[#E2E8F0]'}>
          <Cpu size={18} className="text-[#2563EB]" /> AI Damage Detection
        </h2>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={settings.ai_damage_detection === 'true'} onChange={e => setSettings(s => ({ ...s, ai_damage_detection: String(e.target.checked) }))} className="w-4 h-4 rounded accent-[#2563EB]" />
          <div>
            <p className="text-sm text-[#374151]">Enable AI damage analysis on vehicle inspections</p>
            <p className="text-xs text-[#6B7280]">Requires ANTHROPIC_API_KEY in server .env file</p>
          </div>
        </label>
      </section>

      <button className="btn-primary" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
        <Save size={16} /> {saveSettings.isPending ? 'Saving…' : 'Save Settings'}
      </button>

      {/* ── Cortex Auto-Sync Settings ────────────────────────────────────── */}
      <section className={CARD}>
        <h2 className={SH + ' pb-3 border-b border-[#E2E8F0]'}>
          <Cloud size={18} className="text-[#2563EB]" /> Cortex Auto-Sync
        </h2>
        <p className="text-xs text-[#6B7280]">
          Configure your DSP identity for the Cortex Auto-Sync workflow. These values are used when Claude downloads files from Amazon Logistics.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={FL}>DSP Name</label>
            <input className="input" value={settings.cortex_dsp_name || ''} onChange={e => setSettings(s => ({ ...s, cortex_dsp_name: e.target.value }))} placeholder="Last Mile DSP LLC" />
          </div>
          <div>
            <label className={FL}>DSP Short Code</label>
            <input className="input" value={settings.cortex_dsp_code || ''} onChange={e => setSettings(s => ({ ...s, cortex_dsp_code: e.target.value }))} placeholder="LSMD" />
          </div>
          <div>
            <label className={FL}>Station Code</label>
            <input className="input" value={settings.cortex_station_code || ''} onChange={e => setSettings(s => ({ ...s, cortex_station_code: e.target.value }))} placeholder="DMF5" />
          </div>
          <div>
            <label className={FL}>Default Download Folder</label>
            <input className="input" value={settings.cortex_download_folder || ''} onChange={e => setSettings(s => ({ ...s, cortex_download_folder: e.target.value }))} placeholder="e.g. C:\Users\you\Downloads" />
          </div>
        </div>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <button
            type="button"
            onClick={() => setSettings(s => ({ ...s, cortex_skip_week_if_uploaded: String(s.cortex_skip_week_if_uploaded !== 'true') }))}
            className="flex-shrink-0"
          >
            {settings.cortex_skip_week_if_uploaded === 'true'
              ? <ToggleRight size={28} className="text-[#2563EB]" />
              : <ToggleLeft size={28} className="text-[#D1D5DB]" />}
          </button>
          <div>
            <p className="text-sm text-[#374151]">Auto-skip Week Schedule if already uploaded this week</p>
            <p className="text-xs text-[#6B7280]">When enabled, the sync workflow skips downloading the week schedule if it was already uploaded in the current Amazon week.</p>
          </div>
        </label>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 space-y-1">
          <p className="font-semibold text-blue-800">🔒 Security Note</p>
          <p>Cortex credentials are never stored in this app. You must be logged into Cortex in your browser before running a sync. The automation only reads downloaded files — it never logs in on your behalf.</p>
        </div>
      </section>

      {/* ── Scheduler Settings ────────────────────────────────────────────── */}
      {isAdmin && (
        <section className={CARD}>
          <h2 className={SH + ' pb-3 border-b border-[#E2E8F0]'}>
            <RepeatIcon size={18} className="text-[#2563EB]" /> Scheduler Settings
          </h2>
          <div>
            <label className={FL}>How far in advance can drivers see the schedule?</label>
            <p className="text-xs text-[#6B7280] mb-3">Managers and admins always see all weeks. This only limits driver-level users.</p>
            <div className="flex items-center gap-3 flex-wrap">
              {[
                { label: '1 week', days: '7' },
                { label: '2 weeks', days: '14' },
                { label: '3 weeks', days: '21' },
              ].map(({ label, days }) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setSettings(s => ({ ...s, schedule_visibility_days: days }))}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                    String(settings.schedule_visibility_days || '14') === days
                      ? 'bg-[#2563EB] text-white border-[#2563EB]'
                      : 'bg-white text-[#374151] border-[#D1D5DB] hover:border-[#2563EB] hover:text-[#2563EB]'
                  }`}
                >{label}</button>
              ))}
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#374151]">Custom:</span>
                <input
                  type="number" min="1" max="365"
                  className="input w-20 text-sm py-1.5"
                  value={settings.schedule_visibility_days || '14'}
                  onChange={e => setSettings(s => ({ ...s, schedule_visibility_days: e.target.value }))}
                />
                <span className="text-sm text-[#374151]">days</span>
              </div>
            </div>
          </div>
          <button className="btn-primary" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
            <Save size={16} /> {saveSettings.isPending ? 'Saving…' : 'Save Scheduler Settings'}
          </button>
        </section>
      )}

      {/* ── Consequence Rules ────────────────────────────────────────────── */}
      <section className={CARD}>
        <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
          <h2 className={SH}><Shield size={18} className="text-[#2563EB]" /> Consequence Rules</h2>
          {isAdmin && <button className="btn-primary" onClick={openAddRule}><Plus size={15} /> Add Rule</button>}
        </div>
        <p className="text-xs text-[#6B7280]">Rules automatically trigger when attendance thresholds are reached. Applied in order of severity.</p>
        <div className="space-y-2">
          {rules.map(r => (
            <div key={r.id} className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${r.is_active ? 'border-[#E2E8F0] bg-white' : 'border-[#E2E8F0] bg-[#F9FAFB] opacity-60'}`}>
              <div className="flex-1">
                <p className="font-medium text-[#111827] text-sm">{r.rule_name}</p>
                <p className="text-xs text-[#6B7280] mt-0.5">
                  {r.threshold}+ <span className="capitalize">{r.violation_type.replace('_', ' ')}</span> incidents
                  in {r.time_period_days} days → <span className="text-amber-600 font-medium">{r.consequence_action.replace(/_/g, ' ')}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge status={r.is_active ? 'active' : 'inactive'} label={r.is_active ? 'Active' : 'Disabled'} />
                {isAdmin && (
                  <>
                    <button onClick={() => toggleRule.mutate(r)} className="text-xs text-[#6B7280] hover:text-[#111827] px-2 py-1 rounded hover:bg-blue-50">
                      {r.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => openEditRule(r)} className="text-xs text-[#2563EB] hover:underline">Edit</button>
                    <button onClick={() => deleteRule.mutate(r.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {rules.length === 0 && <p className="text-[#6B7280] text-sm text-center py-4">No rules configured</p>}
        </div>
      </section>

      {/* ── Shift Types ──────────────────────────────────────────────────── */}
      {isAdmin && (
        <section className={CARD}>
          <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
            <h2 className={SH}><Tag size={18} className="text-[#2563EB]" /> Shift Types</h2>
            <button className="btn-primary" onClick={() => {
              setStForm({ name: '', color: '#3B82F6', is_active: true, default_start_time: '07:00', default_end_time: '17:00' });
              setShiftTypeModal({ mode: 'create' });
            }}><Plus size={15} /> Add Type</button>
          </div>
          <div className="space-y-2">
            {shiftTypes.map(st => (
              <div key={st.id} className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${st.is_active ? 'border-[#E2E8F0] bg-white' : 'border-[#E2E8F0] bg-[#F9FAFB] opacity-60'}`}>
                <div className="flex items-center gap-3">
                  <span className="w-4 h-4 rounded-full border border-[#D1D5DB] flex-shrink-0"
                    style={{ backgroundColor: st.color || '#3B82F6' }} />
                  <div>
                    <p className="font-medium text-[#111827] text-sm">{st.name}</p>
                    <p className="text-xs text-[#6B7280]">{st.default_start_time?.slice(0,5)} – {st.default_end_time?.slice(0,5)}</p>
                  </div>
                  {!st.is_active && <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Inactive</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => updateShiftType.mutate({ id: st.id, is_active: !st.is_active })}
                    className="text-xs text-[#6B7280] hover:text-[#111827] px-2 py-1 rounded hover:bg-blue-50">
                    {st.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => {
                    setStForm({ name: st.name, color: st.color || '#3B82F6', is_active: st.is_active, default_start_time: st.default_start_time?.slice(0,5) || '07:00', default_end_time: st.default_end_time?.slice(0,5) || '17:00' });
                    setShiftTypeModal({ mode: 'edit', item: st });
                  }} className="text-xs text-[#2563EB] hover:underline">Edit</button>
                  <button onClick={() => deleteShiftType.mutate(st.id)}
                    className="text-xs text-red-500 hover:text-red-700">Delete</button>
                </div>
              </div>
            ))}
            {shiftTypes.length === 0 && <p className="text-[#6B7280] text-sm text-center py-4">No shift types configured</p>}
          </div>
        </section>
      )}

      {/* ── Recurring Schedules (Day-based) ─────────────────────────────── */}
      {isAdmin && (
        <section className={CARD}>
          <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
            <h2 className={SH}>
              <RepeatIcon size={18} className="text-[#2563EB]" /> Recurring Schedules
            </h2>
          </div>
          <p className="text-xs text-[#6B7280]">
            Drivers added to a day block are automatically scheduled every future week on that day — no dispatcher action required.
          </p>

          {/* ── Filters ── */}
          <div className="bg-[#F9FAFB] border border-[#E2E8F0] rounded-xl p-3 space-y-2">
            <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">Filters</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                <input
                  className="input pl-7 text-sm py-1.5 w-full"
                  placeholder="Driver name…"
                  value={recurringDriverSearch}
                  onChange={e => setRecurringDriverSearch(e.target.value)}
                />
              </div>
              <select className="select text-sm py-1.5" value={recurringFilterDay} onChange={e => setRecurringFilterDay(e.target.value)}>
                <option value="">All Days</option>
                {DAYS_OF_WEEK.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
              </select>
              <select className="select text-sm py-1.5" value={recurringFilterType} onChange={e => setRecurringFilterType(e.target.value)}>
                <option value="">All Types</option>
                {shiftTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              <label className="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded-lg bg-white border border-[#E2E8F0] select-none">
                <input type="checkbox" checked={recurringShowUnassigned} onChange={e => setRecurringShowUnassigned(e.target.checked)} className="rounded accent-[#2563EB]" />
                <span className="text-xs text-[#374151]">Unassigned only</span>
              </label>
            </div>
            {(recurringDriverSearch || recurringFilterDay !== '' || recurringFilterType || recurringShowUnassigned) && (
              <button className="text-xs text-[#2563EB] hover:underline mt-1" onClick={() => {
                setRecurringDriverSearch(''); setRecurringFilterDay(''); setRecurringFilterType(''); setRecurringShowUnassigned(false);
              }}>Clear filters</button>
            )}
          </div>

          <div className="space-y-2">
            {DAYS_OF_WEEK.map((dayName, dayIdx) => {
              const cfg = dayRecurring.find(d => d.day_of_week === dayIdx) || { day_of_week: dayIdx, shift_type: 'EDV', start_time: '07:00', end_time: '17:00', enabled: false, drivers: [] };

              if (recurringFilterDay !== '' && String(dayIdx) !== recurringFilterDay) return null;
              if (recurringFilterType && cfg.shift_type !== recurringFilterType) return null;
              const drivers = cfg.drivers || [];
              if (recurringDriverSearch) {
                const q = recurringDriverSearch.toLowerCase();
                const hasMatch = drivers.some(d => `${d.first_name} ${d.last_name}`.toLowerCase().includes(q));
                if (!hasMatch) return null;
              }
              if (recurringShowUnassigned && drivers.length > 0) return null;

              const isExpanded = expandedDay === dayIdx;
              const formEdit = dayFormEdits[dayIdx] || { shift_type: cfg.shift_type, start_time: cfg.start_time?.slice(0,5) || '07:00', end_time: cfg.end_time?.slice(0,5) || '17:00' };
              const addedIds = new Set(drivers.map(d => d.staff_id));
              const searchQ = dayDriverSearch.toLowerCase();
              const driverResults = isExpanded && dayDriverSearch.length > 0
                ? allStaff.filter(s => !addedIds.has(s.id) && `${s.first_name} ${s.last_name}`.toLowerCase().includes(searchQ)).slice(0, 6)
                : [];

              return (
                <div key={dayIdx} className={`border rounded-xl transition-all ${cfg.enabled ? 'border-blue-200 bg-blue-50/30' : 'border-[#E2E8F0] bg-white'}`}>
                  <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => { setExpandedDay(isExpanded ? null : dayIdx); setDayDriverSearch(''); }}>
                    <button
                      type="button"
                      className="flex-shrink-0"
                      onClick={e => { e.stopPropagation(); updateDayConfig.mutate({ day: dayIdx, shift_type: cfg.shift_type, start_time: cfg.start_time?.slice(0,5) || '07:00', end_time: cfg.end_time?.slice(0,5) || '17:00', enabled: !cfg.enabled }); }}
                    >
                      {cfg.enabled
                        ? <ToggleRight size={24} className="text-[#2563EB]" />
                        : <ToggleLeft size={24} className="text-[#D1D5DB]" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className={`font-semibold text-sm ${cfg.enabled ? 'text-[#111827]' : 'text-[#6B7280]'}`}>{dayName}</span>
                      {cfg.enabled && (
                        <span className="ml-2 text-xs text-[#6B7280]">
                          {cfg.shift_type} · {cfg.start_time?.slice(0,5)}–{cfg.end_time?.slice(0,5)} · {drivers.length} driver{drivers.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {!cfg.enabled && <span className="ml-2 text-xs text-[#9CA3AF]">(disabled)</span>}
                    </div>
                    {isExpanded ? <ChevronUp size={16} className="text-[#9CA3AF] flex-shrink-0" /> : <ChevronDown size={16} className="text-[#9CA3AF] flex-shrink-0" />}
                  </div>

                  {isExpanded && (
                    <div className="border-t border-[#E2E8F0] px-4 pb-4 pt-3 space-y-3">
                      <div className="flex items-end gap-3 flex-wrap">
                        <div className="flex-1 min-w-[120px]">
                          <label className={FL}>Shift Type</label>
                          <select className="select text-sm py-1.5"
                            value={formEdit.shift_type}
                            onChange={e => setDayFormEdits(prev => ({ ...prev, [dayIdx]: { ...formEdit, shift_type: e.target.value } }))}>
                            {shiftTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={FL}>Start</label>
                          <input type="time" className="input text-sm py-1.5 w-32"
                            value={formEdit.start_time}
                            onChange={e => setDayFormEdits(prev => ({ ...prev, [dayIdx]: { ...formEdit, start_time: e.target.value } }))} />
                        </div>
                        <div>
                          <label className={FL}>End</label>
                          <input type="time" className="input text-sm py-1.5 w-32"
                            value={formEdit.end_time}
                            onChange={e => setDayFormEdits(prev => ({ ...prev, [dayIdx]: { ...formEdit, end_time: e.target.value } }))} />
                        </div>
                        <button
                          type="button"
                          className="btn-primary text-sm py-1.5"
                          disabled={updateDayConfig.isPending}
                          onClick={() => updateDayConfig.mutate({ day: dayIdx, shift_type: formEdit.shift_type, start_time: formEdit.start_time, end_time: formEdit.end_time, enabled: cfg.enabled })}
                        >
                          Save
                        </button>
                      </div>

                      <div>
                        <label className={FL}>Drivers</label>
                        {drivers.length === 0 && <p className="text-xs text-[#9CA3AF] mb-2">No drivers assigned yet.</p>}
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {drivers.map(d => (
                            <span key={d.staff_id} className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 rounded-full px-2.5 py-0.5 text-xs font-medium">
                              {d.first_name} {d.last_name}
                              <button type="button" className="ml-0.5 hover:text-red-600 transition-colors" onClick={() => removeDayDriver.mutate({ day: dayIdx, staff_id: d.staff_id })}>
                                <X size={11} />
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="relative">
                          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                          <input
                            className="input pl-8 text-sm py-1.5"
                            placeholder="Search to add a driver…"
                            value={dayDriverSearch}
                            onChange={e => setDayDriverSearch(e.target.value)}
                          />
                          {driverResults.length > 0 && (
                            <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-[#E2E8F0] rounded-xl shadow-lg w-full max-h-40 overflow-y-auto">
                              {driverResults.map(s => (
                                <button key={s.id} type="button"
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 text-[#374151] transition-colors"
                                  onMouseDown={() => { addDayDriver.mutate({ day: dayIdx, staff_id: s.id }); setDayDriverSearch(''); }}
                                >
                                  {s.first_name} {s.last_name}
                                  <span className="ml-1 text-xs text-[#9CA3AF]">{s.employee_id}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Driver Recurring Schedules ──────────────────────────────────── */}
      {isAdmin && (
        <section className={CARD} style={{ maxWidth: 'none' }}>
          <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
            <h2 className={SH}>
              <RepeatIcon size={18} className="text-[#2563EB]" /> Driver Recurring Schedules
            </h2>
            <span className="text-xs text-slate-400">{driverRecurringOverview.length} drivers</span>
          </div>
          <p className="text-xs text-[#6B7280]">
            Configure each driver's recurring weekly schedule. Checked days are automatically scheduled every week.
            Rotating drivers require manual weekly role selection.
          </p>

          {/* Filters */}
          <div className="bg-[#F9FAFB] border border-[#E2E8F0] rounded-xl p-3 space-y-2">
            <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">Filters</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-5">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                <input className="input pl-7 text-sm py-1.5 w-full" placeholder="Driver name…"
                  value={drSearch} onChange={e => setDrSearch(e.target.value)} />
              </div>
              <select className="select text-sm py-1.5" value={drFilterDay} onChange={e => setDrFilterDay(e.target.value)}>
                <option value="">All Days</option>
                {DR_DAYS_COL.map((col, i) => <option key={col} value={col}>{DR_DAYS_HEAD[i]}</option>)}
              </select>
              <select className="select text-sm py-1.5" value={drFilterType} onChange={e => setDrFilterType(e.target.value)}>
                <option value="">All Shift Types</option>
                {shiftTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              <select className="select text-sm py-1.5" value={drFilterRotating} onChange={e => setDrFilterRotating(e.target.value)}>
                <option value="">All Drivers</option>
                <option value="rotating">Rotating Only</option>
                <option value="static">Non-Rotating Only</option>
              </select>
              <label className="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded-lg bg-white border border-[#E2E8F0] select-none">
                <input type="checkbox" className="rounded accent-[#2563EB]"
                  checked={drFilterNoRecurring} onChange={e => setDrFilterNoRecurring(e.target.checked)} />
                <span className="text-xs text-[#374151]">No schedule set</span>
              </label>
            </div>
            {(drSearch || drFilterDay || drFilterType || drFilterRotating || drFilterNoRecurring) && (
              <button className="text-xs text-[#2563EB] hover:underline" onClick={() => {
                setDrSearch(''); setDrFilterDay(''); setDrFilterType(''); setDrFilterRotating(''); setDrFilterNoRecurring(false);
              }}>Clear filters</button>
            )}
          </div>

          {/* Driver list */}
          {drLoading ? (
            <div className="text-sm text-slate-400 py-4 text-center">Loading…</div>
          ) : (
            <div className="space-y-2">
              {driverRecurringOverview
                .filter(driver => {
                  if (drSearch) {
                    const q = drSearch.toLowerCase();
                    if (!`${driver.first_name} ${driver.last_name} ${driver.employee_id}`.toLowerCase().includes(q)) return false;
                  }
                  if (drFilterRotating === 'rotating' && !driver.is_rotating) return false;
                  if (drFilterRotating === 'static'   &&  driver.is_rotating) return false;
                  if (drFilterNoRecurring && driver.recurring_rows.length > 0) return false;
                  if (drFilterType && !driver.recurring_rows.some(r => r.shift_type === drFilterType)) return false;
                  if (drFilterDay  && !driver.recurring_rows.some(r => r[drFilterDay])) return false;
                  return true;
                })
                .map(driver => {
                  const isExpanded = drExpandedId === driver.staff_id;
                  return (
                    <div key={driver.staff_id} className="border border-[#E2E8F0] rounded-xl overflow-hidden">
                      {/* Collapsed header */}
                      <div
                        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50/60 transition-colors"
                        onClick={() => setDrExpandedId(isExpanded ? null : driver.staff_id)}
                      >
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
                          {driver.first_name[0]}{driver.last_name[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-[#111827]">
                              {driver.first_name} {driver.last_name}
                            </span>
                            <span className="text-xs text-[#9CA3AF]">{driver.employee_id}</span>
                            {driver.is_rotating && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                <RefreshCw size={8} /> ROT
                              </span>
                            )}
                          </div>
                          {!isExpanded && driver.recurring_rows.length > 0 && (
                            <p className="text-xs text-[#6B7280] truncate mt-0.5">
                              {driver.recurring_rows.map(r =>
                                `${r.shift_type} (${DR_DAYS_COL.filter(d => r[d]).map(d => d[0].toUpperCase()).join('')})`
                              ).join(' · ')}
                            </p>
                          )}
                          {!isExpanded && driver.recurring_rows.length === 0 && (
                            <p className="text-xs text-[#9CA3AF] mt-0.5">No recurring schedule</p>
                          )}
                        </div>
                        {isExpanded ? <ChevronUp size={16} className="text-[#9CA3AF] flex-shrink-0" /> : <ChevronDown size={16} className="text-[#9CA3AF] flex-shrink-0" />}
                      </div>

                      {/* Expanded grid */}
                      {isExpanded && (
                        <div className="border-t border-[#E2E8F0] px-4 pb-4 pt-3 space-y-3">
                          {/* Rotating toggle */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-[#6B7280] font-medium">Rotating Driver</span>
                            <button
                              onClick={() => drToggleRotating.mutate({ staffId: driver.staff_id, is_rotating: !driver.is_rotating })}
                              disabled={drToggleRotating.isPending}
                              className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${driver.is_rotating ? 'bg-amber-400' : 'bg-slate-200'}`}
                            >
                              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${driver.is_rotating ? 'translate-x-4' : 'translate-x-0.5'}`} />
                            </button>
                          </div>

                          {/* Grid */}
                          <div className="overflow-x-auto rounded-xl border border-slate-200">
                            <table className="w-full text-xs border-collapse">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                  <th className="w-7 px-2 py-2" />
                                  <th className="text-left px-3 py-2 text-slate-500 font-semibold">Shift Type</th>
                                  <th className="text-left px-2 py-2 text-slate-500 font-semibold" colSpan={3}>Times</th>
                                  {DR_DAYS_HEAD.map(d => (
                                    <th key={d} className="text-center px-1.5 py-2 text-slate-500 font-semibold w-9">{d}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {driver.recurring_rows.length === 0 ? (
                                  <tr>
                                    <td colSpan={11} className="text-center py-5 text-slate-400 text-xs">
                                      No rows yet. Click "+ Add Shift" below.
                                    </td>
                                  </tr>
                                ) : (
                                  driver.recurring_rows.map(row => (
                                    <SettingsRecurringRow
                                      key={row.id}
                                      row={row}
                                      shiftTypes={shiftTypes}
                                      onUpdate={r => drUpdateRow.mutate(r)}
                                      onDelete={id => drDeleteRow.mutate({ staffId: driver.staff_id, rowId: id })}
                                    />
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>

                          <button
                            onClick={() => {
                              const t = shiftTypes[0];
                              drAddRow.mutate({ staffId: driver.staff_id, defaults: t ? {
                                shift_type: t.name,
                                start_time: t.default_start_time?.slice(0, 5) || '07:00',
                                end_time:   t.default_end_time?.slice(0, 5)   || '17:00',
                              } : {} });
                            }}
                            disabled={drAddRow.isPending}
                            className="flex items-center gap-1.5 text-xs text-primary hover:text-blue-700 font-semibold transition-colors"
                          >
                            <Plus size={13} />Add Shift
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              {driverRecurringOverview.filter(driver => {
                if (drSearch && !`${driver.first_name} ${driver.last_name}`.toLowerCase().includes(drSearch.toLowerCase())) return false;
                if (drFilterRotating === 'rotating' && !driver.is_rotating) return false;
                if (drFilterRotating === 'static'   &&  driver.is_rotating) return false;
                if (drFilterNoRecurring && driver.recurring_rows.length > 0) return false;
                if (drFilterType && !driver.recurring_rows.some(r => r.shift_type === drFilterType)) return false;
                if (drFilterDay  && !driver.recurring_rows.some(r => r[drFilterDay])) return false;
                return true;
              }).length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">No drivers match your filters</p>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Shift Type Modal ─────────────────────────────────────────────── */}
      <Modal isOpen={!!shiftTypeModal} onClose={() => setShiftTypeModal(null)}
        title={shiftTypeModal?.mode === 'create' ? 'Add Shift Type' : 'Edit Shift Type'} size="sm">
        <form className="space-y-4" onSubmit={e => {
          e.preventDefault();
          if (shiftTypeModal?.mode === 'create') createShiftType.mutate(stForm);
          else updateShiftType.mutate({ id: shiftTypeModal.item.id, ...stForm });
        }}>
          <div><label className="modal-label">Name *</label>
            <input className="input" required value={stForm.name} onChange={e => setStForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., HELPER" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="modal-label">Default Start</label>
              <input type="time" className="input" value={stForm.default_start_time} onChange={e => setStForm(f => ({ ...f, default_start_time: e.target.value }))} />
            </div>
            <div><label className="modal-label">Default End</label>
              <input type="time" className="input" value={stForm.default_end_time} onChange={e => setStForm(f => ({ ...f, default_end_time: e.target.value }))} />
            </div>
          </div>
          <div><label className="modal-label">Color</label>
            <div className="flex items-center gap-3">
              <input type="color" value={stForm.color} onChange={e => setStForm(f => ({ ...f, color: e.target.value }))}
                className="w-10 h-9 rounded cursor-pointer border border-[#D1D5DB] bg-transparent" />
              <span className="text-sm text-[#6B7280] font-mono">{stForm.color}</span>
              <div className="flex-1 h-8 rounded-lg border flex items-center justify-center text-xs font-semibold"
                style={{ backgroundColor: stForm.color + '33', color: stForm.color, borderColor: stForm.color + '66' }}>
                {stForm.name || 'Preview'}
              </div>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setShiftTypeModal(null)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1">
              {shiftTypeModal?.mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── User Management (admin only) ─────────────────────────────────── */}
      {isAdmin && (
        <section className={CARD}>
          <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
            <h2 className={SH}><Users size={18} className="text-[#2563EB]" /> User Management</h2>
            <button className="btn-primary text-xs" onClick={() => setShowAddUser(true)}>
              <UserPlus size={14} /> Add User
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8F0]">
                  <th className="th text-left">Name</th>
                  <th className="th text-left">Email</th>
                  <th className="th text-center">Role</th>
                  <th className="th text-center">Last Login</th>
                  <th className="th text-center">Status</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {userList.map(u => (
                  <tr key={u.id} className="border-b border-[#E2E8F0] hover:bg-blue-50/40 transition-colors">
                    <td className="px-3 py-2.5 font-medium text-[#111827]">
                      {u.first_name} {u.last_name}
                      {u.must_change_password && (
                        <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                          Temp PW
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[#475569]">{u.email}</td>
                    <td className="px-3 py-2.5 text-center">
                      <Badge status={u.role === 'manager' ? 'dispatcher' : u.role} label={u.role === 'manager' ? 'Dispatcher' : u.role} />
                    </td>
                    <td className="px-3 py-2.5 text-center text-xs text-[#475569]">
                      {u.last_login ? format(new Date(u.last_login), 'MM/dd/yy h:mm a') : 'Never'}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`badge text-xs ${u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button className="btn-ghost text-xs" onClick={() => openEditUser(u)}>Edit</button>
                    </td>
                  </tr>
                ))}
                {userList.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-[#94a3b8]">No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Add User Modal ────────────────────────────────────────────────── */}
      <Modal isOpen={showAddUser} onClose={() => setShowAddUser(false)} title="Add New User">
        <form onSubmit={e => { e.preventDefault(); createUser.mutate(uForm); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="modal-label">First Name</label>
              <input className="input" value={uForm.first_name} onChange={e => setUForm(f => ({ ...f, first_name: e.target.value }))} placeholder="First name" />
            </div>
            <div>
              <label className="modal-label">Last Name</label>
              <input className="input" value={uForm.last_name} onChange={e => setUForm(f => ({ ...f, last_name: e.target.value }))} placeholder="Last name" />
            </div>
          </div>
          <div>
            <label className="modal-label">Email *</label>
            <input type="email" className="input" required value={uForm.email} onChange={e => setUForm(f => ({ ...f, email: e.target.value }))} placeholder="user@dspfleet.com" />
          </div>
          <div>
            <label className="modal-label">Role *</label>
            <select className="select" required value={uForm.role} onChange={e => setUForm(f => ({ ...f, role: e.target.value }))}>
              <option value="driver">Driver</option>
              <option value="dispatcher">Dispatcher</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="modal-label">Temporary Password *</label>
            <input type="password" className="input" required minLength={6} value={uForm.password} onChange={e => setUForm(f => ({ ...f, password: e.target.value }))} placeholder="At least 6 characters" />
          </div>
          <label className="flex items-center gap-2 text-sm text-[#374151] cursor-pointer select-none">
            <input type="checkbox" className="rounded accent-[#2563EB]" checked={uForm.must_change_password} onChange={e => setUForm(f => ({ ...f, must_change_password: e.target.checked }))} />
            Require password change on first login
          </label>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setShowAddUser(false)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={createUser.isPending}>
              {createUser.isPending ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Edit User Modal ───────────────────────────────────────────────── */}
      <Modal isOpen={!!editUser} onClose={() => setEditUser(null)} title={editUser ? `Edit — ${editUser.first_name} ${editUser.last_name}` : ''}>
        <form onSubmit={e => {
          e.preventDefault();
          const payload = { id: editUser.id, role: editUForm.role, status: editUForm.status };
          if (editUForm.password) payload.password = editUForm.password;
          updateUser.mutate(payload);
        }} className="space-y-4">
          <div>
            <label className="modal-label">Role</label>
            <select className="select" value={editUForm.role} onChange={e => setEditUForm(f => ({ ...f, role: e.target.value }))}>
              <option value="driver">Driver</option>
              <option value="dispatcher">Dispatcher</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="modal-label">Status</label>
            <select className="select" value={editUForm.status} onChange={e => setEditUForm(f => ({ ...f, status: e.target.value }))}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="modal-label">Reset Password (optional)</label>
            <input type="password" className="input" minLength={6} value={editUForm.password} onChange={e => setEditUForm(f => ({ ...f, password: e.target.value }))} placeholder="Leave blank to keep current" />
            {editUForm.password && <p className="text-xs text-amber-600 mt-1">User will be required to change this password on next login.</p>}
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setEditUser(null)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={updateUser.isPending}>
              {updateUser.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Consequence Rules Modal ─────────────────────────────────────── */}
      <Modal isOpen={ruleModal} onClose={() => { setRuleModal(false); setEditRule(null); }} title={editRule ? 'Edit Rule' : 'Add Consequence Rule'} size="sm">
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); saveRule.mutate(); }}>
          <div><label className="modal-label">Rule Name *</label>
            <input className="input" required value={ruleForm.rule_name} onChange={e => setRuleForm(f => ({ ...f, rule_name: e.target.value }))} placeholder="e.g., NCNS Termination Review" />
          </div>
          <div><label className="modal-label">Violation Type</label>
            <select className="select" value={ruleForm.violation_type} onChange={e => setRuleForm(f => ({ ...f, violation_type: e.target.value }))}>
              {VIOLATION_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="modal-label">Threshold (count) *</label>
              <input type="number" className="input" min="1" required value={ruleForm.threshold} onChange={e => setRuleForm(f => ({ ...f, threshold: parseInt(e.target.value) }))} />
            </div>
            <div><label className="modal-label">Within (days)</label>
              <input type="number" className="input" min="1" value={ruleForm.time_period_days} onChange={e => setRuleForm(f => ({ ...f, time_period_days: parseInt(e.target.value) }))} />
            </div>
          </div>
          <div><label className="modal-label">Consequence Action</label>
            <select className="select" value={ruleForm.consequence_action} onChange={e => setRuleForm(f => ({ ...f, consequence_action: e.target.value }))}>
              {CONSEQUENCE_ACTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => { setRuleModal(false); setEditRule(null); }}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={saveRule.isPending}>
              {saveRule.isPending ? 'Saving…' : editRule ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ── SettingsRecurringRow ──────────────────────────────────────────────────────
function SettingsRecurringRow({ row, shiftTypes, onUpdate, onDelete }) {
  const [localTimes, setLocalTimes] = useState({
    start: row.start_time?.slice(0, 5) || '07:00',
    end:   row.end_time?.slice(0, 5)   || '17:00',
  });

  useEffect(() => {
    setLocalTimes({
      start: row.start_time?.slice(0, 5) || '07:00',
      end:   row.end_time?.slice(0, 5)   || '17:00',
    });
  }, [row.start_time, row.end_time]);

  const handleShiftTypeChange = (newType) => {
    const t = shiftTypes.find(st => st.name === newType);
    const newStart = t?.default_start_time?.slice(0, 5) || '07:00';
    const newEnd   = t?.default_end_time?.slice(0, 5)   || '17:00';
    setLocalTimes({ start: newStart, end: newEnd });
    onUpdate({ ...row, shift_type: newType, start_time: newStart, end_time: newEnd });
  };

  const handleTimeBlur = () => {
    const sc = localTimes.start !== row.start_time?.slice(0, 5);
    const ec = localTimes.end   !== row.end_time?.slice(0, 5);
    if (sc || ec) onUpdate({ ...row, start_time: localTimes.start, end_time: localTimes.end });
  };

  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60 group">
      <td className="px-2 py-2">
        <button onClick={() => onDelete(row.id)}
          className="text-slate-300 hover:text-red-500 rounded p-0.5 transition-colors opacity-0 group-hover:opacity-100"
          title="Remove row">
          <Trash2 size={13} />
        </button>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${SHIFT_DOT_COLORS[row.shift_type] || 'bg-slate-400'}`} />
          <select value={row.shift_type} onChange={e => handleShiftTypeChange(e.target.value)}
            className="text-xs py-0.5 px-1.5 border border-slate-200 rounded-md bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
            style={{ minWidth: '7rem' }}>
            {shiftTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </div>
      </td>
      <td className="px-1.5 py-2">
        <input type="time" value={localTimes.start}
          onChange={e => setLocalTimes(p => ({ ...p, start: e.target.value }))}
          onBlur={handleTimeBlur}
          className="text-xs py-0.5 px-1.5 border border-slate-200 rounded-md bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none w-[5.5rem]" />
      </td>
      <td className="py-2 text-slate-300 text-xs select-none">–</td>
      <td className="px-1.5 py-2">
        <input type="time" value={localTimes.end}
          onChange={e => setLocalTimes(p => ({ ...p, end: e.target.value }))}
          onBlur={handleTimeBlur}
          className="text-xs py-0.5 px-1.5 border border-slate-200 rounded-md bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none w-[5.5rem]" />
      </td>
      {DR_DAYS_COL.map((day, i) => (
        <td key={day} className="text-center px-1 py-2">
          <button onClick={() => onUpdate({ ...row, [day]: !row[day] })}
            className={`w-7 h-7 rounded-lg text-[11px] font-bold border transition-all ${
              row[day]
                ? 'bg-primary text-white border-primary shadow-sm'
                : 'bg-white text-slate-300 border-slate-200 hover:border-primary/60 hover:text-slate-500'
            }`}>
            {DR_DAYS_BTN[i]}
          </button>
        </td>
      ))}
    </tr>
  );
}
