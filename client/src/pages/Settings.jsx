import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { Save, Plus, Trash2, Shield, Bell, Cpu, DollarSign } from 'lucide-react';
import api from '../api/client';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import { useAuth } from '../App';

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

export default function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = ['manager', 'admin'].includes(user?.role);
  const [settings, setSettings] = useState({});
  const [ruleModal, setRuleModal] = useState(false);
  const [editRule, setEditRule] = useState(null);
  const [ruleForm, setRuleForm] = useState({ rule_name: '', violation_type: 'ncns', threshold: 3, time_period_days: 90, consequence_action: 'written_warning' });

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

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="page-title">Settings</h1>

      {/* Company */}
      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-100 flex items-center gap-2"><Bell size={18} className="text-primary" /> General</h2>
        <div>
          <label className="label">Company Name</label>
          <input className="input" value={settings.company_name || ''} onChange={e => setSettings(s => ({ ...s, company_name: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">Default Shift Start</label><input type="time" className="input" value={settings.default_shift_start || '07:00'} onChange={e => setSettings(s => ({ ...s, default_shift_start: e.target.value }))} /></div>
          <div><label className="label">Default Shift End</label><input type="time" className="input" value={settings.default_shift_end || '17:00'} onChange={e => setSettings(s => ({ ...s, default_shift_end: e.target.value }))} /></div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div><label className="label">Insurance Alert (days)</label><input type="number" className="input" value={settings.alert_days_insurance || 30} onChange={e => setSettings(s => ({ ...s, alert_days_insurance: e.target.value }))} /></div>
          <div><label className="label">Registration Alert (days)</label><input type="number" className="input" value={settings.alert_days_registration || 30} onChange={e => setSettings(s => ({ ...s, alert_days_registration: e.target.value }))} /></div>
          <div><label className="label">Inspection Alert (days)</label><input type="number" className="input" value={settings.alert_days_inspection || 14} onChange={e => setSettings(s => ({ ...s, alert_days_inspection: e.target.value }))} /></div>
        </div>
      </section>

      {/* Payroll Integration */}
      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-100 flex items-center gap-2"><DollarSign size={18} className="text-primary" /> Payroll Integration</h2>
        <div className="grid grid-cols-2 gap-6">
          {/* Paycom */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-slate-300">Paycom</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={settings.paycom_enabled === 'true'} onChange={e => setSettings(s => ({ ...s, paycom_enabled: String(e.target.checked) }))} className="rounded" />
                <span className="text-sm text-slate-400">Enabled</span>
              </label>
            </div>
            <div><label className="label">API Key</label><input type="password" className="input" value={settings.paycom_api_key || ''} onChange={e => setSettings(s => ({ ...s, paycom_api_key: e.target.value }))} placeholder="Paycom API key" /></div>
          </div>
          {/* ADP */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-slate-300">ADP</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={settings.adp_enabled === 'true'} onChange={e => setSettings(s => ({ ...s, adp_enabled: String(e.target.checked) }))} className="rounded" />
                <span className="text-sm text-slate-400">Enabled</span>
              </label>
            </div>
            <div><label className="label">Client ID</label><input className="input" value={settings.adp_client_id || ''} onChange={e => setSettings(s => ({ ...s, adp_client_id: e.target.value }))} /></div>
            <div><label className="label">Client Secret</label><input type="password" className="input" value={settings.adp_client_secret || ''} onChange={e => setSettings(s => ({ ...s, adp_client_secret: e.target.value }))} /></div>
          </div>
        </div>
      </section>

      {/* AI */}
      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-100 flex items-center gap-2"><Cpu size={18} className="text-primary" /> AI Damage Detection</h2>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={settings.ai_damage_detection === 'true'} onChange={e => setSettings(s => ({ ...s, ai_damage_detection: String(e.target.checked) }))} className="w-4 h-4 rounded" />
          <div>
            <p className="text-sm text-slate-300">Enable AI damage analysis on vehicle inspections</p>
            <p className="text-xs text-slate-500">Requires ANTHROPIC_API_KEY in server .env file</p>
          </div>
        </label>
      </section>

      <button className="btn-primary" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
        <Save size={16} /> {saveSettings.isPending ? 'Saving…' : 'Save Settings'}
      </button>

      {/* Consequence Rules */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-100 flex items-center gap-2"><Shield size={18} className="text-primary" /> Consequence Rules</h2>
          {isAdmin && <button className="btn-primary" onClick={openAddRule}><Plus size={15} /> Add Rule</button>}
        </div>
        <p className="text-xs text-slate-500">Rules automatically trigger when attendance thresholds are reached. Applied in order of severity.</p>

        <div className="space-y-2">
          {rules.map(r => (
            <div key={r.id} className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${r.is_active ? 'border-surface-border bg-surface' : 'border-surface-border bg-surface/50 opacity-50'}`}>
              <div className="flex-1">
                <p className="font-medium text-slate-200 text-sm">{r.rule_name}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {r.threshold}+ <span className="capitalize">{r.violation_type.replace('_', ' ')}</span> incidents
                  in {r.time_period_days} days → <span className="text-yellow-400">{r.consequence_action.replace(/_/g, ' ')}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge status={r.is_active ? 'active' : 'inactive'} label={r.is_active ? 'Active' : 'Disabled'} />
                {isAdmin && (
                  <>
                    <button onClick={() => toggleRule.mutate(r)} className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-surface-hover">
                      {r.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => openEditRule(r)} className="text-xs text-primary hover:underline">Edit</button>
                    <button onClick={() => deleteRule.mutate(r.id)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {rules.length === 0 && <p className="text-slate-500 text-sm text-center py-4">No rules configured</p>}
        </div>
      </section>

      {/* Rule modal */}
      <Modal isOpen={ruleModal} onClose={() => { setRuleModal(false); setEditRule(null); }} title={editRule ? 'Edit Rule' : 'Add Consequence Rule'} size="sm">
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); saveRule.mutate(); }}>
          <div><label className="label">Rule Name *</label><input className="input" required value={ruleForm.rule_name} onChange={e => setRuleForm(f => ({ ...f, rule_name: e.target.value }))} placeholder="e.g., NCNS Termination Review" /></div>
          <div><label className="label">Violation Type</label>
            <select className="select" value={ruleForm.violation_type} onChange={e => setRuleForm(f => ({ ...f, violation_type: e.target.value }))}>
              {VIOLATION_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Threshold (count) *</label><input type="number" className="input" min="1" required value={ruleForm.threshold} onChange={e => setRuleForm(f => ({ ...f, threshold: parseInt(e.target.value) }))} /></div>
            <div><label className="label">Within (days)</label><input type="number" className="input" min="1" value={ruleForm.time_period_days} onChange={e => setRuleForm(f => ({ ...f, time_period_days: parseInt(e.target.value) }))} /></div>
          </div>
          <div><label className="label">Consequence Action</label>
            <select className="select" value={ruleForm.consequence_action} onChange={e => setRuleForm(f => ({ ...f, consequence_action: e.target.value }))}>
              {CONSEQUENCE_ACTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => { setRuleModal(false); setEditRule(null); }}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={saveRule.isPending}>{saveRule.isPending ? 'Saving…' : editRule ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
