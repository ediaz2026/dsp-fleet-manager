import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Save, Plus, Trash2, Shield, Bell, Cpu, DollarSign, Cloud, ToggleLeft, ToggleRight,
  Tag, RepeatIcon, X, ChevronDown, ChevronUp, Search, Users, UserPlus, RefreshCw,
  Settings, Calendar, Upload, CheckCircle, AlertCircle, ChevronRight, GripVertical,
  Download, FileSpreadsheet, ClipboardList,
} from 'lucide-react';
import { format } from 'date-fns';
import api from '../api/client';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import { useAuth } from '../context/AuthContext';

/* ─── Constants ───────────────────────────────────────────────────────────── */
const DAYS_OF_WEEK = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const VIOLATION_TYPES   = [
  { value: 'ncns',       label: 'NCNS (No Call No Show)' },
  { value: 'called_out', label: 'Call-Out' },
  { value: 'late',       label: 'Late Arrival' },
];
const CONSEQUENCE_ACTIONS = [
  { value: 'verbal_warning',    label: 'Verbal Warning' },
  { value: 'written_warning',   label: 'Written Warning' },
  { value: 'suspension',        label: 'Suspension' },
  { value: 'termination_review',label: 'Termination Review' },
];
const SHIFT_DOT_COLORS = {
  'EDV':'bg-blue-500','STEP VAN':'bg-indigo-700','HELPER':'bg-amber-500',
  'ON CALL':'bg-yellow-500','EXTRA':'bg-green-500',
  'DISPATCH AM':'bg-cyan-500','DISPATCH PM':'bg-sky-600',
  'SUSPENSION':'bg-red-500','UTO':'bg-purple-500','PTO':'bg-teal-500','TRAINING':'bg-orange-500',
};
const DR_DAYS_COL  = ['sun','mon','tue','wed','thu','fri','sat'];
const DR_DAYS_HEAD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DR_DAYS_BTN  = ['S','M','T','W','T','F','S'];

const SH   = 'text-[16px] font-bold text-[#1E3A5F] flex items-center gap-2';
const FL   = 'block text-[13px] font-medium text-[#374151] mb-1.5';
const CARD = 'bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-5 space-y-4';

const STATUS_COLORS = {
  active:     'bg-green-100 text-green-700',
  inactive:   'bg-yellow-100 text-yellow-700',
  terminated: 'bg-red-100 text-red-700',
};

/* ─── Sidebar config ──────────────────────────────────────────────────────── */
const SIDEBAR = [
  {
    group: 'SCHEDULE',
    items: [
      { id: 'scheduler-settings', label: 'Scheduler Settings',       icon: Calendar },
      { id: 'shift-types',        label: 'Shift Types',              icon: Tag },
      { id: 'rules',              label: 'Rules',                    icon: Shield },
    ],
  },
  {
    group: 'INTEGRATIONS',
    items: [
      { id: 'api-connections', label: 'API Connections', icon: Cloud },
    ],
  },
  {
    group: 'SYSTEM',
    items: [
      { id: 'general',           label: 'General Settings',  icon: Settings },
      { id: 'users',             label: 'User Management',   icon: Users },
      { id: 'send-invitations',  label: 'Send Invitations',  icon: RefreshCw },
      { id: 'bulk-import',       label: 'Bulk Import',       icon: FileSpreadsheet },
      { id: 'audit-log',     label: 'Audit Log',        icon: ClipboardList },
      { id: 'notifications', label: 'Notifications',    icon: Bell },
    ],
  },
];

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function Management() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const [activeSection, setActiveSection] = useState(
    () => {
      const saved = localStorage.getItem('mgmt_active_section');
      // migrate away from removed driver sections
      if (!saved || saved === 'drivers' || saved === 'add-driver' || saved === 'driver-recurring') return 'scheduler-settings';
      return saved;
    }
  );
  const setSection = (id) => {
    setActiveSection(id);
    localStorage.setItem('mgmt_active_section', id);
  };

  /* ── General Settings ─────────────────────────────────────────────────── */
  const [settings, setSettings] = useState({});
  const { data: rawSettings = {} } = useQuery({
    queryKey: ['settings'],
    queryFn:  () => api.get('/settings').then(r => r.data),
  });
  useEffect(() => { setSettings(rawSettings); }, [JSON.stringify(rawSettings)]);
  const saveSettings = useMutation({
    mutationFn: () => api.put('/settings', settings),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Settings saved'); },
  });

  /* ── Consequence Rules ────────────────────────────────────────────────── */
  const [ruleModal, setRuleModal] = useState(false);
  const [editRule,  setEditRule]  = useState(null);
  const [ruleForm,  setRuleForm]  = useState({
    rule_name: '', violation_type: 'ncns', threshold: 3, time_period_days: 90, consequence_action: 'written_warning',
  });
  const { data: rules = [] } = useQuery({
    queryKey: ['consequence-rules'],
    queryFn:  () => api.get('/settings/consequence-rules').then(r => r.data),
  });
  const saveRule   = useMutation({ mutationFn: () => editRule ? api.put(`/settings/consequence-rules/${editRule.id}`, ruleForm) : api.post('/settings/consequence-rules', ruleForm), onSuccess: () => { qc.invalidateQueries({ queryKey: ['consequence-rules'] }); toast.success(editRule ? 'Rule updated' : 'Rule created'); setRuleModal(false); setEditRule(null); } });
  const deleteRule = useMutation({ mutationFn: id => api.delete(`/settings/consequence-rules/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['consequence-rules'] }); toast.success('Rule deleted'); } });
  const toggleRule = useMutation({ mutationFn: ({ id, is_active, ...rest }) => api.put(`/settings/consequence-rules/${id}`, { ...rest, is_active: !is_active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['consequence-rules'] }) });
  const openAddRule  = () => { setEditRule(null); setRuleForm({ rule_name:'', violation_type:'ncns', threshold:3, time_period_days:90, consequence_action:'written_warning' }); setRuleModal(true); };
  const openEditRule = (r) => { setEditRule(r); setRuleForm(r); setRuleModal(true); };

  /* ── Shift Types ──────────────────────────────────────────────────────── */
  const [shiftTypeModal, setShiftTypeModal] = useState(null);
  const [stForm, setStForm] = useState({ name:'', color:'#3B82F6', is_active:true, default_start_time:'07:00', default_end_time:'17:00' });
  const { data: shiftTypes = [] } = useQuery({ queryKey: ['shift-types'], queryFn: () => api.get('/schedule/shift-types').then(r => r.data) });
  const createShiftType  = useMutation({ mutationFn: data => api.post('/schedule/shift-types', data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['shift-types'] }); toast.success('Shift type created'); setShiftTypeModal(null); } });
  const updateShiftType  = useMutation({ mutationFn: ({ id, ...data }) => api.put(`/schedule/shift-types/${id}`, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['shift-types'] }); toast.success('Shift type updated'); setShiftTypeModal(null); } });
  const deleteShiftType  = useMutation({ mutationFn: id => api.delete(`/schedule/shift-types/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['shift-types'] }); toast.success('Shift type deleted'); } });
  const reorderShiftType = useMutation({ mutationFn: order => api.put('/schedule/shift-types/reorder', { order }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['shift-types'] }); toast.success('Order saved'); } });

  /* ── Shift type drag-and-drop ─────────────────────────────────────────── */
  const [localShiftTypes, setLocalShiftTypes] = useState([]);
  const [dragId, setDragId] = useState(null);
  useEffect(() => { setLocalShiftTypes(shiftTypes); }, [shiftTypes]);

  const stDragStart = (e, id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const stDragOver = (e, id) => {
    e.preventDefault();
    if (dragId == null || dragId === id) return;
    setLocalShiftTypes(prev => {
      const list = [...prev];
      const from = list.findIndex(s => s.id === dragId);
      const to   = list.findIndex(s => s.id === id);
      if (from === -1 || to === -1) return prev;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      return list;
    });
  };
  const stDrop = (e) => {
    e.preventDefault();
    const order = localShiftTypes.map((s, i) => ({ id: s.id, sort_order: i + 1 }));
    reorderShiftType.mutate(order);
    setDragId(null);
  };
  const stDragEnd = () => setDragId(null);

  /* ── Day-based Recurring Schedules ───────────────────────────────────── */
  const [expandedDay,       setExpandedDay]       = useState(null);
  const [dayDriverSearch,   setDayDriverSearch]   = useState('');
  const [dayFormEdits,      setDayFormEdits]       = useState({});
  const { data: dayRecurring = [] } = useQuery({ queryKey: ['day-recurring'], queryFn: () => api.get('/schedule/day-recurring').then(r => r.data) });
  const { data: allStaff   = [] } = useQuery({ queryKey: ['staff','drivers'], queryFn: () => api.get('/staff', { params: { role:'driver', status:'active' } }).then(r => r.data) });
  const updateDayConfig = useMutation({ mutationFn: ({ day, ...data }) => api.put(`/schedule/day-recurring/${day}`, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['day-recurring'] }); toast.success('Saved'); } });
  const addDayDriver    = useMutation({ mutationFn: ({ day, staff_id }) => api.post(`/schedule/day-recurring/${day}/drivers`, { staff_id }), onSuccess: () => qc.invalidateQueries({ queryKey: ['day-recurring'] }) });
  const removeDayDriver = useMutation({ mutationFn: ({ day, staff_id }) => api.delete(`/schedule/day-recurring/${day}/drivers/${staff_id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['day-recurring'] }) });

  /* ── Per-Driver Recurring Schedules ──────────────────────────────────── */
  const [drSearch,            setDrSearch]            = useState('');
  const [drFilterDay,         setDrFilterDay]         = useState('');
  const [drFilterType,        setDrFilterType]        = useState('');
  const [drFilterRotating,    setDrFilterRotating]    = useState('');
  const [drFilterNoRecurring, setDrFilterNoRecurring] = useState(false);
  const [drExpandedId,        setDrExpandedId]        = useState(null);
  const { data: driverRecurringOverview = [], isLoading: drLoading } = useQuery({
    queryKey: ['driver-recurring-overview'],
    queryFn:  () => api.get('/drivers/recurring-overview').then(r => r.data),
    enabled: isAdmin,
  });
  const drAddRow       = useMutation({ mutationFn: ({ staffId }) => api.post(`/drivers/${staffId}/recurring`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['driver-recurring-overview'] }), onError: () => toast.error('Failed to add shift row') });
  const drUpdateRow    = useMutation({ mutationFn: row => api.put(`/drivers/${row.staff_id}/recurring/${row.id}`, row), onSuccess: () => qc.invalidateQueries({ queryKey: ['driver-recurring-overview'] }), onError: () => toast.error('Failed to update shift') });
  const drDeleteRow    = useMutation({ mutationFn: ({ staffId, rowId }) => api.delete(`/drivers/${staffId}/recurring/${rowId}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['driver-recurring-overview'] }), onError: () => toast.error('Failed to remove row') });
  const drToggleRotating = useMutation({ mutationFn: ({ staffId, is_rotating }) => api.put(`/drivers/${staffId}/rotating`, { is_rotating }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['driver-recurring-overview'] }); qc.invalidateQueries({ queryKey: ['drivers'] }); }, onError: () => toast.error('Failed to update rotating status') });

  /* ── User Management ──────────────────────────────────────────────────── */
  const [showAddUser, setShowAddUser] = useState(false);
  const [editUser,    setEditUser]    = useState(null);
  const [uForm,       setUForm]       = useState({ first_name:'', last_name:'', email:'', role:'dispatcher', password:'', must_change_password:true });
  const [editUForm,   setEditUForm]   = useState({ role:'', status:'', password:'' });
  const { data: userList = [] } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/auth/users').then(r => r.data), enabled: isAdmin });
  const createUser = useMutation({ mutationFn: d => api.post('/auth/users', d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setShowAddUser(false); setUForm({ first_name:'', last_name:'', email:'', role:'dispatcher', password:'', must_change_password:true }); toast.success('User created'); }, onError: err => toast.error(err.response?.data?.error || 'Failed to create user') });
  const updateUser = useMutation({ mutationFn: ({ id, ...d }) => api.put(`/auth/users/${id}`, d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setEditUser(null); toast.success('User updated'); }, onError: err => toast.error(err.response?.data?.error || 'Failed to update user') });
  const openEditUser = (u) => { setEditUser(u); setEditUForm({ role: u.role, status: u.status, password: '' }); };

  /* ── Send Invitations ─────────────────────────────────────────────────── */
  const [inviteFilter,      setInviteFilter]      = useState('all'); // 'all' | 'not_sent' | 'invited' | 'active'
  const [inviteSearch,      setInviteSearch]      = useState('');
  const [selectedIds,       setSelectedIds]       = useState(new Set());
  const [showInviteConfirm, setShowInviteConfirm] = useState(false);
  const [inviteResults,     setInviteResults]     = useState(null);

  const { data: driverList = [], refetch: refetchDrivers } = useQuery({
    queryKey: ['invite-drivers'],
    queryFn: () => api.get('/auth/users').then(r => r.data.filter(u => u.role === 'driver')),
    enabled: isAdmin && activeSection === 'send-invitations',
  });

  const sendInvitations = useMutation({
    mutationFn: (staffIds) => api.post('/auth/send-invitations', { staffIds }).then(r => r.data),
    onSuccess: (data) => {
      setInviteResults(data.results);
      setSelectedIds(new Set());
      setShowInviteConfirm(false);
      refetchDrivers();
      const sent = data.results.filter(r => r.success).length;
      const failed = data.results.filter(r => !r.success).length;
      if (sent > 0) toast.success(`${sent} invitation${sent !== 1 ? 's' : ''} sent`);
      if (failed > 0) toast.error(`${failed} failed to send`);
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to send invitations'),
  });

  const resendInvitation = useMutation({
    mutationFn: (staffId) => api.post(`/auth/resend-invitation/${staffId}`).then(r => r.data),
    onSuccess: (data) => { toast.success(`Invitation resent to ${data.name}`); refetchDrivers(); },
    onError: err => toast.error(err.response?.data?.error || 'Failed to resend invitation'),
  });

  const getDriverInviteStatus = (d) => {
    if (d.last_login) return 'active';
    if (d.invitation_sent_at) return 'invited';
    return 'not_sent';
  };

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

  /* ── Audit Log ────────────────────────────────────────────────────────── */
  const [auditFilters, setAuditFilters] = useState({ date_from: '', date_to: '', user_id: '', action_type: '', entity_type: '', search: '' });
  const [auditPage, setAuditPage] = useState(1);
  const auditQuery = useQuery({
    queryKey: ['audit-log', auditFilters, auditPage],
    queryFn: () => api.get('/audit-log', { params: { ...auditFilters, page: auditPage, limit: 50 } }).then(r => r.data),
    enabled: isAdmin && activeSection === 'audit-log',
  });
  const { data: auditUsers = [] } = useQuery({
    queryKey: ['audit-users'],
    queryFn: () => api.get('/audit-log/users').then(r => r.data),
    enabled: isAdmin && activeSection === 'audit-log',
  });
  const auditData = auditQuery.data || { rows: [], total: 0, page: 1, limit: 50 };
  const setAuditFilter = (key, val) => { setAuditFilters(f => ({ ...f, [key]: val })); setAuditPage(1); };

  const ACTION_COLORS = {
    LOGIN:           'bg-green-100 text-green-700',
    FAILED_LOGIN:    'bg-red-100 text-red-700',
    ACCOUNT_LOCKED:  'bg-red-200 text-red-800',
    LOGOUT:          'bg-slate-100 text-slate-500',
    CREATE_DRIVER:   'bg-blue-100 text-blue-700',
    CREATE_USER:     'bg-blue-100 text-blue-700',
    EDIT_DRIVER:     'bg-amber-100 text-amber-700',
    UPDATE_USER:     'bg-amber-100 text-amber-700',
    STATUS_CHANGE:   'bg-orange-100 text-orange-700',
    RESET_PASSWORD:  'bg-purple-100 text-purple-700',
    CHANGE_PASSWORD: 'bg-purple-100 text-purple-700',
    DELETE:          'bg-red-100 text-red-700',
    IMPORT:          'bg-teal-100 text-teal-700',
    UNAUTHORIZED:    'bg-red-200 text-red-800',
  };

  const exportAuditLog = () => {
    if (!auditData.rows.length) return;
    const ws = XLSX.utils.json_to_sheet(auditData.rows.map(r => ({
      Timestamp: r.timestamp ? new Date(r.timestamp).toLocaleString() : '',
      User: r.user_name || '',
      Role: r.user_role || '',
      Action: r.action_type || '',
      Entity: r.entity_type || '',
      'Entity ID': r.entity_id || '',
      Description: r.entity_description || '',
      IP: r.ip_address || '',
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit Log');
    XLSX.writeFile(wb, `audit-log-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  /* ── Driver Management (ASSOCIATES) ───────────────────────────────────── */
  const [driverStatusFilter, setDriverStatusFilter] = useState(
    () => localStorage.getItem('mgmt_driver_status') || 'active'
  );
  const setDriverFilter = (s) => { setDriverStatusFilter(s); localStorage.setItem('mgmt_driver_status', s); };
  const [driverSearch,  setDriverSearch]  = useState('');
  const [importResult,  setImportResult]  = useState(null);
  const [fleetImportResult, setFleetImportResult] = useState(null);
  const [driverPreview,  setDriverPreview]  = useState(null); // { rows, previewRows, headers, totalRows, warnings }
  const [vehiclePreview, setVehiclePreview] = useState(null);
  const [statusModal,   setStatusModal]   = useState(null); // { driver, newStatus }
  const driverImportRef = useRef();
  const fleetImportRef  = useRef();

  // Add driver form (inline in Management)
  const [addDriverForm, setAddDriverForm] = useState({ staff_id: '', license_number: '', license_expiration: '', license_state: '', license_class: 'D', dob: '', transponder_id: '' });

  const { data: allDriversMgmt = [], isLoading: driversLoading } = useQuery({
    queryKey: ['drivers-mgmt'],
    queryFn:  () => api.get('/drivers').then(r => r.data),
    enabled: isAdmin,
  });

  const { data: staffAll = [] } = useQuery({
    queryKey: ['staff-all-mgmt'],
    queryFn:  () => api.get('/staff', { params: { role: 'driver' } }).then(r => r.data),
    enabled:  activeSection === 'add-driver',
  });

  const updateDriverStatus = useMutation({
    mutationFn: ({ staffId, status }) => api.put(`/drivers/${staffId}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['drivers-mgmt'] }); qc.invalidateQueries({ queryKey: ['drivers'] }); toast.success('Status updated'); setStatusModal(null); },
    onError: () => toast.error('Failed to update status'),
  });

  const addDriverMutation = useMutation({
    mutationFn: data => api.post('/drivers', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['drivers-mgmt'] }); toast.success('Driver profile created'); setAddDriverForm({ staff_id:'', license_number:'', license_expiration:'', license_state:'', license_class:'D', dob:'', transponder_id:'' }); setSection('drivers'); },
    onError: err => toast.error(err.response?.data?.error || 'Failed'),
  });

  const importDriversMutation = useMutation({
    mutationFn: rows => api.post('/drivers/import', { rows }),
    onSuccess: (res) => { setImportResult(res.data); qc.invalidateQueries({ queryKey: ['drivers-mgmt'] }); qc.invalidateQueries({ queryKey: ['drivers'] }); },
    onError: () => toast.error('Import failed'),
  });

  const importVehiclesMutation = useMutation({
    mutationFn: rows => api.post('/vehicles/import', { rows }),
    onSuccess: (res) => { setFleetImportResult(res.data); qc.invalidateQueries({ queryKey: ['vehicles'] }); },
    onError: () => toast.error('Fleet import failed'),
  });

  const parseXlsxFile = (file, onRows) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'binary', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { raw: false });
        onRows(rows);
      } catch (err) {
        toast.error('Failed to parse file: ' + err.message);
      }
    };
    reader.readAsBinaryString(file);
  };

  const DRIVER_REQUIRED_COLS  = ['DAProviderID', 'Legal_Firstname', 'Legal_Lastname'];
  const DRIVER_OPTIONAL_COLS  = ['Employee_Code', 'DriversLicense', 'Birth_Date_(MM/DD/YYYY)', 'DLExpirationDate', 'Hire_Date'];
  const VEHICLE_REQUIRED_COLS = ['vin'];
  const VEHICLE_OPTIONAL_COLS = ['vehicleName','licensePlateNumber','make','model','year','serviceType','operationalStatus','registrationExpiryDate','registeredState','vehicleProvider','type','ownershipType','ownershipStartDate','ownershipEndDate','statusReasonMessage'];

  const validateColumns = (rows, required) => {
    if (!rows.length) return ['File is empty or has no data rows'];
    const cols = Object.keys(rows[0]);
    return required.filter(c => !cols.some(k => k.trim() === c)).map(c => `Missing required column: ${c}`);
  };

  const handleDriverImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    parseXlsxFile(file, rows => {
      const warnings = validateColumns(rows, DRIVER_REQUIRED_COLS);
      setDriverPreview({ rows, previewRows: rows.slice(0, 5), headers: Object.keys(rows[0] || {}), totalRows: rows.length, warnings });
      setImportResult(null);
    });
  };

  const handleFleetImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    parseXlsxFile(file, rows => {
      const warnings = validateColumns(rows, VEHICLE_REQUIRED_COLS);
      setVehiclePreview({ rows, previewRows: rows.slice(0, 5), headers: Object.keys(rows[0] || {}), totalRows: rows.length, warnings });
      setFleetImportResult(null);
    });
  };

  const downloadTemplate = (type) => {
    let data, filename;
    if (type === 'drivers') {
      data = [
        ['DAProviderID', 'Legal_Firstname', 'Legal_Lastname', 'Email', 'Employee_Code', 'DriversLicense', 'Birth_Date_(MM/DD/YYYY)', 'DLExpirationDate', 'Hire_Date'],
        ['DA123456789', 'John', 'Smith', 'john.smith@lsmddsp.com', 'EMP001', 'D12345678', '01/15/1990', '12/31/2026', '03/01/2024'],
        ['DA987654321', 'Maria', 'Garcia', 'maria.garcia@lsmddsp.com', 'EMP002', 'G87654321', '06/20/1992', '08/15/2027', '01/15/2023'],
      ];
      filename = 'drivers-import-template.xlsx';
    } else {
      data = [
        ['vin','vehicleName','licensePlateNumber','make','model','year','serviceType','operationalStatus','vehicleProvider','ownershipType','ownershipStartDate','ownershipEndDate','registrationExpiryDate','registeredState','statusReasonMessage'],
        ['1HGBH41JXMN109186','VAN-001','ABC1234','Mercedes','Sprinter','2022','Standard Parcel Step Van - US','OPERATIONAL','Last Mile DSP','OWNED','01/01/2022','','12/31/2026','FL',''],
        ['2T1BURHE0JC042951','VAN-002','XYZ5678','Rivian','EDV','2023','Standard Parcel Electric - Rivian MEDIUM','OPERATIONAL','Last Mile DSP','OWNED','06/01/2023','','06/30/2027','FL',''],
      ];
      filename = 'vehicles-import-template.xlsx';
    }
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, type === 'drivers' ? 'Drivers' : 'Vehicles');
    XLSX.writeFile(wb, filename);
  };

  /* ── Filtered drivers list ─────────────────────────────────────────────── */
  const filteredDrivers = allDriversMgmt.filter(d => {
    if (driverStatusFilter !== 'all' && d.employment_status !== driverStatusFilter) return false;
    if (driverSearch) {
      const q = driverSearch.toLowerCase();
      if (!`${d.first_name} ${d.last_name} ${d.employee_id} ${d.transponder_id || ''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  /* ═══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="flex gap-0 -mt-6 -mx-6 -mb-6" style={{ minHeight: 'calc(100vh - 3.5rem)' }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="w-56 flex-shrink-0 bg-white border-r border-slate-200 pt-6 pb-10 overflow-y-auto">
        <p className="px-5 pb-3 text-xs font-bold text-slate-400 tracking-widest uppercase">Management</p>
        {SIDEBAR.map(group => (
          <div key={group.group} className="mb-5">
            <p className="px-5 pb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">{group.group}</p>
            {group.items.map(item => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  className={`w-full flex items-center gap-2.5 px-5 py-2.5 text-sm font-medium transition-colors text-left ${
                    active
                      ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-600'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon size={15} />
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="flex-1 p-6 overflow-y-auto space-y-6 max-w-4xl">

        {/* Drivers section moved to /drivers tab */}
        {(activeSection === 'drivers' || activeSection === 'add-driver' || activeSection === 'driver-recurring') && (
          <div className="text-center py-20 text-slate-400">
            <p className="text-lg font-medium">Drivers have moved to the <strong className="text-slate-600">Drivers</strong> tab in the top navigation.</p>
          </div>
        )}

        {/* ══ DRIVERS (old — hidden sentinel) ══════════════════════════════ */}
        {activeSection === '_drivers_removed' && (
          <>
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold text-slate-900">Drivers</h1>
              <div className="flex items-center gap-2">
                <input ref={driverImportRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleDriverImport} />
                <button
                  onClick={() => driverImportRef.current?.click()}
                  disabled={importDriversMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
                >
                  <Upload size={14} /> {importDriversMutation.isPending ? 'Importing…' : 'Import Drivers'}
                </button>
                <button
                  onClick={() => setSection('add-driver')}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus size={14} /> Add Driver
                </button>
              </div>
            </div>

            {/* Import result banner */}
            {importResult && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
                <CheckCircle size={18} className="text-green-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 text-sm">
                  <p className="font-semibold text-green-800">Import complete</p>
                  <p className="text-green-700">{importResult.created} created · {importResult.updated} updated · {importResult.skipped} skipped</p>
                  {importResult.errors?.length > 0 && (
                    <details className="mt-1">
                      <summary className="text-red-600 cursor-pointer text-xs">{importResult.errors.length} errors</summary>
                      <ul className="mt-1 text-xs text-red-600 space-y-0.5">
                        {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
                <button onClick={() => setImportResult(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
              </div>
            )}

            {/* Status filter + search */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white text-sm font-medium">
                {['all','active','inactive','terminated'].map(s => (
                  <button
                    key={s}
                    onClick={() => setDriverFilter(s)}
                    className={`px-4 py-2 capitalize transition-colors ${driverStatusFilter === s ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                  >{s}</button>
                ))}
              </div>
              <div className="relative flex-1 max-w-xs">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="input pl-8 text-sm py-2 w-full"
                  placeholder="Search name, ID, transporter ID…"
                  value={driverSearch}
                  onChange={e => setDriverSearch(e.target.value)}
                />
              </div>
              <span className="text-xs text-slate-400">{filteredDrivers.length} driver{filteredDrivers.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Driver table */}
            <div className={CARD + ' !p-0 overflow-hidden'}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="th text-left px-4 py-3">Name</th>
                    <th className="th text-left px-3 py-3">Emp Code</th>
                    <th className="th text-left px-3 py-3">Transporter ID</th>
                    <th className="th text-center px-3 py-3">Status</th>
                    <th className="th text-left px-3 py-3">Hire Date</th>
                    <th className="th text-left px-3 py-3">License Exp</th>
                    <th className="th px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {driversLoading ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">Loading…</td></tr>
                  ) : filteredDrivers.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">No drivers found</td></tr>
                  ) : filteredDrivers.map(d => (
                    <tr key={d.id} className="border-b border-slate-100 hover:bg-blue-50/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center flex-shrink-0">
                            {d.first_name?.[0]}{d.last_name?.[0]}
                          </div>
                          {d.first_name} {d.last_name}
                          {d.is_rotating && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                              <RefreshCw size={8} />ROT
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 ml-9">{d.employee_id}</p>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{d.employee_code || <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-3 text-slate-600 font-mono text-xs">{d.transponder_id || <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[d.employment_status] || 'bg-slate-100 text-slate-600'}`}>
                          {d.employment_status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-600 text-xs">
                        {d.hire_date ? format(new Date(d.hire_date), 'MM/dd/yyyy') : '—'}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {d.license_expiration ? (
                          <span className={d.license_expiring ? 'text-red-600 font-semibold' : 'text-slate-600'}>
                            {format(new Date(d.license_expiration), 'MM/dd/yyyy')}
                            {d.license_expiring && ' ⚠'}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="relative inline-block">
                          <select
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-600 cursor-pointer hover:border-blue-400 transition-colors focus:outline-none"
                            value={d.employment_status}
                            onChange={e => setStatusModal({ staffId: d.staff_id, name: `${d.first_name} ${d.last_name}`, newStatus: e.target.value, current: d.employment_status })}
                          >
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                            <option value="terminated">Terminated</option>
                          </select>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ══ ADD NEW DRIVER (removed — use /drivers tab) ══════════════════ */}
        {activeSection === '_add-driver_removed' && (
          <>
            <div className="flex items-center gap-3">
              <button onClick={() => setSection('drivers')} className="text-slate-400 hover:text-slate-600 transition-colors">
                <ChevronRight size={18} className="rotate-180" />
              </button>
              <h1 className="text-2xl font-bold text-slate-900">Add New Driver</h1>
            </div>
            <div className={CARD}>
              <p className="text-sm text-slate-500">
                Select a staff member and enter their driver details. Staff members can be created via User Management (SYSTEM).
              </p>
              <form className="space-y-4" onSubmit={e => { e.preventDefault(); addDriverMutation.mutate(addDriverForm); }}>
                <div>
                  <label className={FL}>Staff Member *</label>
                  <select className="select" required value={addDriverForm.staff_id} onChange={e => setAddDriverForm(f => ({ ...f, staff_id: e.target.value }))}>
                    <option value="">Select staff…</option>
                    {staffAll.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.employee_id})</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className={FL}>License Number</label>
                    <input className="input" value={addDriverForm.license_number} onChange={e => setAddDriverForm(f => ({ ...f, license_number: e.target.value }))} /></div>
                  <div><label className={FL}>License Expiration</label>
                    <input type="date" className="input" value={addDriverForm.license_expiration} onChange={e => setAddDriverForm(f => ({ ...f, license_expiration: e.target.value }))} /></div>
                  <div><label className={FL}>License State</label>
                    <input className="input" maxLength={2} value={addDriverForm.license_state} onChange={e => setAddDriverForm(f => ({ ...f, license_state: e.target.value }))} /></div>
                  <div><label className={FL}>License Class</label>
                    <input className="input" value={addDriverForm.license_class} onChange={e => setAddDriverForm(f => ({ ...f, license_class: e.target.value }))} /></div>
                  <div><label className={FL}>Date of Birth</label>
                    <input type="date" className="input" value={addDriverForm.dob} onChange={e => setAddDriverForm(f => ({ ...f, dob: e.target.value }))} /></div>
                  <div><label className={FL}>Transporter ID (DAProviderID)</label>
                    <input className="input" value={addDriverForm.transponder_id} onChange={e => setAddDriverForm(f => ({ ...f, transponder_id: e.target.value }))} /></div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" className="btn-secondary flex-1" onClick={() => setSection('drivers')}>Cancel</button>
                  <button type="submit" className="btn-primary flex-1" disabled={addDriverMutation.isPending}>
                    {addDriverMutation.isPending ? 'Creating…' : 'Create Driver Profile'}
                  </button>
                </div>
              </form>
            </div>
          </>
        )}

        {/* ══ SCHEDULER SETTINGS ═══════════════════════════════════════════ */}
        {activeSection === 'scheduler-settings' && (
          <>
            <h1 className="text-2xl font-bold text-slate-900">Scheduler Settings</h1>
            <section className={CARD}>
              <h2 className={SH + ' pb-3 border-b border-[#E2E8F0]'}>
                <RepeatIcon size={18} className="text-[#2563EB]" /> Schedule Visibility
              </h2>
              <div>
                <label className={FL}>How far in advance can drivers see the schedule?</label>
                <p className="text-xs text-[#6B7280] mb-3">Managers and admins always see all weeks. This only limits driver-level users.</p>
                <div className="flex items-center gap-3 flex-wrap">
                  {[{ label:'1 week', days:'7' },{ label:'2 weeks', days:'14' },{ label:'3 weeks', days:'21' }].map(({ label, days }) => (
                    <button key={days} type="button"
                      onClick={() => setSettings(s => ({ ...s, schedule_visibility_days: days }))}
                      className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${String(settings.schedule_visibility_days || '14') === days ? 'bg-[#2563EB] text-white border-[#2563EB]' : 'bg-white text-[#374151] border-[#D1D5DB] hover:border-[#2563EB] hover:text-[#2563EB]'}`}
                    >{label}</button>
                  ))}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#374151]">Custom:</span>
                    <input type="number" min="1" max="365" className="input w-20 text-sm py-1.5"
                      value={settings.schedule_visibility_days || '14'}
                      onChange={e => setSettings(s => ({ ...s, schedule_visibility_days: e.target.value }))} />
                    <span className="text-sm text-[#374151]">days</span>
                  </div>
                </div>
              </div>
              <button className="btn-primary" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
                <Save size={16} /> {saveSettings.isPending ? 'Saving…' : 'Save'}
              </button>
            </section>
          </>
        )}

        {/* ══ SHIFT TYPES ══════════════════════════════════════════════════ */}
        {activeSection === 'shift-types' && (
          <>
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold text-slate-900">Shift Types</h1>
              <button className="btn-primary" onClick={() => { setStForm({ name:'', color:'#3B82F6', is_active:true, default_start_time:'07:00', default_end_time:'17:00' }); setShiftTypeModal({ mode:'create' }); }}>
                <Plus size={15} /> Add Type
              </button>
            </div>
            <section className={CARD}>
              <p className="text-xs text-slate-400 mb-3 flex items-center gap-1.5">
                <GripVertical size={13} className="text-slate-300" />
                Drag rows to reorder — order applies to all shift selectors throughout the app
              </p>
              <div className="space-y-2">
                {localShiftTypes.map(st => (
                  <div
                    key={st.id}
                    draggable
                    onDragStart={e => stDragStart(e, st.id)}
                    onDragOver={e => stDragOver(e, st.id)}
                    onDrop={stDrop}
                    onDragEnd={stDragEnd}
                    className={`flex items-center justify-between px-3 py-3 rounded-xl border transition-all select-none ${
                      dragId === st.id
                        ? 'border-blue-400 bg-blue-50 shadow-md opacity-60 scale-[1.01]'
                        : st.is_active
                          ? 'border-[#E2E8F0] bg-white hover:border-slate-300'
                          : 'border-[#E2E8F0] bg-[#F9FAFB] opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Drag handle */}
                      <GripVertical
                        size={16}
                        className="text-slate-300 hover:text-slate-500 flex-shrink-0 cursor-grab active:cursor-grabbing"
                      />
                      <span className="w-4 h-4 rounded-full border border-[#D1D5DB] flex-shrink-0" style={{ backgroundColor: st.color || '#3B82F6' }} />
                      <div>
                        <p className="font-medium text-[#111827] text-sm">{st.name}</p>
                        <p className="text-xs text-[#6B7280]">{st.default_start_time?.slice(0,5)} – {st.default_end_time?.slice(0,5)}</p>
                      </div>
                      {!st.is_active && <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Inactive</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateShiftType.mutate({ id: st.id, is_active: !st.is_active })} className="text-xs text-[#6B7280] hover:text-[#111827] px-2 py-1 rounded hover:bg-blue-50">{st.is_active ? 'Deactivate' : 'Activate'}</button>
                      <button onClick={() => { setStForm({ name: st.name, color: st.color || '#3B82F6', is_active: st.is_active, default_start_time: st.default_start_time?.slice(0,5) || '07:00', default_end_time: st.default_end_time?.slice(0,5) || '17:00' }); setShiftTypeModal({ mode:'edit', item: st }); }} className="text-xs text-[#2563EB] hover:underline">Edit</button>
                      <button onClick={() => deleteShiftType.mutate(st.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                    </div>
                  </div>
                ))}
                {localShiftTypes.length === 0 && <p className="text-[#6B7280] text-sm text-center py-4">No shift types configured</p>}
              </div>
            </section>
          </>
        )}

        {/* ══ DRIVER RECURRING SCHEDULES (removed — use /drivers tab) ══════ */}
        {activeSection === '_driver-recurring_removed' && (
          <>
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold text-slate-900">Driver Recurring Schedules</h1>
              <span className="text-xs text-slate-400">{driverRecurringOverview.length} drivers</span>
            </div>
            <p className="text-sm text-slate-500">Configure each driver's recurring weekly schedule. Checked days are automatically scheduled every week. Rotating drivers require manual weekly role selection.</p>

            {/* Filters */}
            <div className="bg-[#F9FAFB] border border-[#E2E8F0] rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">Filters</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-5">
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                  <input className="input pl-7 text-sm py-1.5 w-full" placeholder="Driver name…" value={drSearch} onChange={e => setDrSearch(e.target.value)} />
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
                  <input type="checkbox" className="rounded accent-[#2563EB]" checked={drFilterNoRecurring} onChange={e => setDrFilterNoRecurring(e.target.checked)} />
                  <span className="text-xs text-[#374151]">No schedule set</span>
                </label>
              </div>
              {(drSearch || drFilterDay || drFilterType || drFilterRotating || drFilterNoRecurring) && (
                <button className="text-xs text-[#2563EB] hover:underline" onClick={() => { setDrSearch(''); setDrFilterDay(''); setDrFilterType(''); setDrFilterRotating(''); setDrFilterNoRecurring(false); }}>Clear filters</button>
              )}
            </div>

            {/* Driver list */}
            {drLoading ? (
              <div className="text-sm text-slate-400 py-4 text-center">Loading…</div>
            ) : (
              <div className="space-y-2">
                {driverRecurringOverview
                  .filter(driver => {
                    if (drSearch && !`${driver.first_name} ${driver.last_name} ${driver.employee_id}`.toLowerCase().includes(drSearch.toLowerCase())) return false;
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
                        <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50/60 transition-colors" onClick={() => setDrExpandedId(isExpanded ? null : driver.staff_id)}>
                          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
                            {driver.first_name[0]}{driver.last_name[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-[#111827]">{driver.first_name} {driver.last_name}</span>
                              <span className="text-xs text-[#9CA3AF]">{driver.employee_id}</span>
                              {driver.is_rotating && (
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                  <RefreshCw size={8} /> ROT
                                </span>
                              )}
                            </div>
                            {!isExpanded && driver.recurring_rows.length > 0 && (
                              <p className="text-xs text-[#6B7280] truncate mt-0.5">{driver.recurring_rows.map(r => `${r.shift_type} (${DR_DAYS_COL.filter(d => r[d]).map(d => d[0].toUpperCase()).join('')})`).join(' · ')}</p>
                            )}
                            {!isExpanded && driver.recurring_rows.length === 0 && <p className="text-xs text-[#9CA3AF] mt-0.5">No recurring schedule</p>}
                          </div>
                          {isExpanded ? <ChevronUp size={16} className="text-[#9CA3AF] flex-shrink-0" /> : <ChevronDown size={16} className="text-[#9CA3AF] flex-shrink-0" />}
                        </div>

                        {isExpanded && (
                          <div className="border-t border-[#E2E8F0] px-4 pb-4 pt-3 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-[#6B7280] font-medium">Rotating Driver</span>
                              <button onClick={() => drToggleRotating.mutate({ staffId: driver.staff_id, is_rotating: !driver.is_rotating })} disabled={drToggleRotating.isPending}
                                className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${driver.is_rotating ? 'bg-amber-400' : 'bg-slate-200'}`}>
                                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${driver.is_rotating ? 'translate-x-4' : 'translate-x-0.5'}`} />
                              </button>
                            </div>
                            <div className="overflow-x-auto rounded-xl border border-slate-200">
                              <table className="w-full text-xs border-collapse">
                                <thead>
                                  <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="w-7 px-2 py-2" />
                                    <th className="text-left px-3 py-2 text-slate-500 font-semibold">Shift Type</th>
                                    <th className="text-left px-2 py-2 text-slate-500 font-semibold" colSpan={3}>Times</th>
                                    {DR_DAYS_HEAD.map(d => <th key={d} className="text-center px-1.5 py-2 text-slate-500 font-semibold w-9">{d}</th>)}
                                  </tr>
                                </thead>
                                <tbody>
                                  {driver.recurring_rows.length === 0 ? (
                                    <tr><td colSpan={11} className="text-center py-5 text-slate-400 text-xs">No rows yet. Click "+ Add Shift" below.</td></tr>
                                  ) : driver.recurring_rows.map(row => (
                                    <MgmtRecurringRow key={row.id} row={row} shiftTypes={shiftTypes}
                                      onUpdate={r => drUpdateRow.mutate(r)}
                                      onDelete={id => drDeleteRow.mutate({ staffId: driver.staff_id, rowId: id })} />
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <button onClick={() => drAddRow.mutate({ staffId: driver.staff_id })} disabled={drAddRow.isPending}
                              className="flex items-center gap-1.5 text-xs text-primary hover:text-blue-700 font-semibold transition-colors">
                              <Plus size={13} />Add Shift
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </>
        )}

        {/* ══ RULES ════════════════════════════════════════════════════════ */}
        {activeSection === 'rules' && (
          <>
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold text-slate-900">Consequence Rules</h1>
              <button className="btn-primary" onClick={openAddRule}><Plus size={15} /> Add Rule</button>
            </div>
            <p className="text-sm text-slate-500">Rules automatically trigger when attendance thresholds are reached. Applied in order of severity.</p>
            <section className={CARD}>
              <div className="space-y-2">
                {rules.map(r => (
                  <div key={r.id} className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${r.is_active ? 'border-[#E2E8F0] bg-white' : 'border-[#E2E8F0] bg-[#F9FAFB] opacity-60'}`}>
                    <div className="flex-1">
                      <p className="font-medium text-[#111827] text-sm">{r.rule_name}</p>
                      <p className="text-xs text-[#6B7280] mt-0.5">{r.threshold}+ <span className="capitalize">{r.violation_type.replace('_',' ')}</span> incidents in {r.time_period_days} days → <span className="text-amber-600 font-medium">{r.consequence_action.replace(/_/g,' ')}</span></p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge status={r.is_active ? 'active' : 'inactive'} label={r.is_active ? 'Active' : 'Disabled'} />
                      <button onClick={() => toggleRule.mutate(r)} className="text-xs text-[#6B7280] hover:text-[#111827] px-2 py-1 rounded hover:bg-blue-50">{r.is_active ? 'Disable' : 'Enable'}</button>
                      <button onClick={() => openEditRule(r)} className="text-xs text-[#2563EB] hover:underline">Edit</button>
                      <button onClick={() => deleteRule.mutate(r.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                    </div>
                  </div>
                ))}
                {rules.length === 0 && <p className="text-[#6B7280] text-sm text-center py-4">No rules configured</p>}
              </div>
            </section>
          </>
        )}

        {/* ══ API CONNECTIONS ══════════════════════════════════════════════ */}
        {activeSection === 'api-connections' && (
          <>
            <h1 className="text-2xl font-bold text-slate-900">API Connections</h1>

            {/* Payroll Integration */}
            <section className={CARD}>
              <h2 className={SH + ' pb-3 border-b border-[#E2E8F0]'}>
                <DollarSign size={18} className="text-[#2563EB]" /> Payroll Integration
              </h2>
              <div className="grid grid-cols-2 gap-6">
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

            {/* Cortex */}
            <section className={CARD}>
              <h2 className={SH + ' pb-3 border-b border-[#E2E8F0]'}>
                <Cloud size={18} className="text-[#2563EB]" /> Cortex Auto-Sync
              </h2>
              <p className="text-xs text-[#6B7280]">Configure your DSP identity for the Cortex Auto-Sync workflow. These values are used when Claude downloads files from Amazon Logistics.</p>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={FL}>DSP Name</label><input className="input" value={settings.cortex_dsp_name || ''} onChange={e => setSettings(s => ({ ...s, cortex_dsp_name: e.target.value }))} placeholder="Last Mile DSP LLC" /></div>
                <div><label className={FL}>DSP Short Code</label><input className="input" value={settings.cortex_dsp_code || ''} onChange={e => setSettings(s => ({ ...s, cortex_dsp_code: e.target.value }))} placeholder="LSMD" /></div>
                <div><label className={FL}>Station Code</label><input className="input" value={settings.cortex_station_code || ''} onChange={e => setSettings(s => ({ ...s, cortex_station_code: e.target.value }))} placeholder="DMF5" /></div>
                <div><label className={FL}>Default Download Folder</label><input className="input" value={settings.cortex_download_folder || ''} onChange={e => setSettings(s => ({ ...s, cortex_download_folder: e.target.value }))} /></div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <button type="button" onClick={() => setSettings(s => ({ ...s, cortex_skip_week_if_uploaded: String(s.cortex_skip_week_if_uploaded !== 'true') }))} className="flex-shrink-0">
                  {settings.cortex_skip_week_if_uploaded === 'true' ? <ToggleRight size={28} className="text-[#2563EB]" /> : <ToggleLeft size={28} className="text-[#D1D5DB]" />}
                </button>
                <div>
                  <p className="text-sm text-[#374151]">Auto-skip Week Schedule if already uploaded this week</p>
                  <p className="text-xs text-[#6B7280]">Skips downloading the week schedule if it was already uploaded in the current Amazon week.</p>
                </div>
              </label>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 space-y-1">
                <p className="font-semibold text-blue-800">🔒 Security Note</p>
                <p>Cortex credentials are never stored in this app. You must be logged into Cortex in your browser before running a sync.</p>
              </div>
            </section>

            {/* Fleet Import */}
            <section className={CARD}>
              <h2 className={SH + ' pb-3 border-b border-[#E2E8F0]'}>
                <Upload size={18} className="text-[#2563EB]" /> Fleet Data Import
              </h2>
              <p className="text-xs text-[#6B7280]">Import vehicle data from the Amazon fleet export Excel file. Matches by VIN — updates existing vehicles or creates new ones.</p>
              <input ref={fleetImportRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFleetImport} />
              <button
                onClick={() => fleetImportRef.current?.click()}
                disabled={importVehiclesMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
              >
                <Upload size={14} /> {importVehiclesMutation.isPending ? 'Importing…' : 'Import Fleet Excel'}
              </button>
              {fleetImportResult && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
                  <CheckCircle size={18} className="text-green-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 text-sm">
                    <p className="font-semibold text-green-800">Fleet import complete</p>
                    <p className="text-green-700">{fleetImportResult.created} created · {fleetImportResult.updated} updated · {fleetImportResult.skipped} skipped</p>
                    {fleetImportResult.errors?.length > 0 && (
                      <details className="mt-1"><summary className="text-red-600 cursor-pointer text-xs">{fleetImportResult.errors.length} errors</summary>
                        <ul className="mt-1 text-xs text-red-600 space-y-0.5">{fleetImportResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                      </details>
                    )}
                  </div>
                  <button onClick={() => setFleetImportResult(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                </div>
              )}
            </section>

            <button className="btn-primary" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
              <Save size={16} /> {saveSettings.isPending ? 'Saving…' : 'Save API Settings'}
            </button>
          </>
        )}

        {/* ══ GENERAL SETTINGS ═════════════════════════════════════════════ */}
        {activeSection === 'general' && (
          <>
            <h1 className="text-2xl font-bold text-slate-900">General Settings</h1>
            <section className={CARD}>
              <h2 className={SH + ' pb-3 border-b border-[#E2E8F0]'}><Bell size={18} className="text-[#2563EB]" /> General</h2>
              <div>
                <label className={FL}>Company Name</label>
                <input className="input" value={settings.company_name || ''} onChange={e => setSettings(s => ({ ...s, company_name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={FL}>Default Shift Start</label><input type="time" className="input" value={settings.default_shift_start || '07:00'} onChange={e => setSettings(s => ({ ...s, default_shift_start: e.target.value }))} /></div>
                <div><label className={FL}>Default Shift End</label><input type="time" className="input" value={settings.default_shift_end || '17:00'} onChange={e => setSettings(s => ({ ...s, default_shift_end: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className={FL}>Insurance Alert (days)</label><input type="number" className="input" value={settings.alert_days_insurance || 30} onChange={e => setSettings(s => ({ ...s, alert_days_insurance: e.target.value }))} /></div>
                <div><label className={FL}>Registration Alert (days)</label><input type="number" className="input" value={settings.alert_days_registration || 30} onChange={e => setSettings(s => ({ ...s, alert_days_registration: e.target.value }))} /></div>
                <div><label className={FL}>Inspection Alert (days)</label><input type="number" className="input" value={settings.alert_days_inspection || 14} onChange={e => setSettings(s => ({ ...s, alert_days_inspection: e.target.value }))} /></div>
              </div>
            </section>
            <section className={CARD}>
              <h2 className={SH + ' pb-3 border-b border-[#E2E8F0]'}><Cpu size={18} className="text-[#2563EB]" /> AI Damage Detection</h2>
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
          </>
        )}

        {/* ══ USER MANAGEMENT ══════════════════════════════════════════════ */}
        {activeSection === 'users' && (
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
          </>
        )}

        {/* ══ SEND INVITATIONS ═════════════════════════════════════════════ */}
        {activeSection === 'send-invitations' && (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Send Invitations</h1>
                <p className="text-sm text-slate-500 mt-1">Select drivers to send portal invitation emails. Drivers receive a 7-day link to set their password.</p>
              </div>
              {selectedIds.size > 0 && (
                <button
                  className="btn-primary text-xs shrink-0 ml-4"
                  onClick={() => setShowInviteConfirm(true)}
                >
                  <RefreshCw size={14} /> Send to {selectedIds.size} Selected
                </button>
              )}
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
                {inviteResults.map(r => (
                  <p key={r.id} className={`text-xs flex items-center gap-1.5 ${r.success ? 'text-green-700' : 'text-red-600'}`}>
                    {r.success ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                    {r.name || `ID ${r.id}`} — {r.success ? 'Sent' : r.error}
                  </p>
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
                            disabled={invStatus === 'active'}
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
                          {invStatus !== 'active' && (
                            <button
                              className="btn-ghost text-xs"
                              disabled={resendInvitation.isPending}
                              onClick={() => resendInvitation.mutate(d.id)}
                            >
                              {invStatus === 'invited' ? 'Resend' : 'Send'}
                            </button>
                          )}
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
        )}

        {/* ══ BULK IMPORT ══════════════════════════════════════════════════ */}
        {activeSection === 'bulk-import' && (
          <>
            <h1 className="text-2xl font-bold text-slate-900">Bulk Import</h1>
            <p className="text-sm text-slate-500">Upload a Paycom driver export or Amazon fleet export. Preview the data before importing — existing records will be updated, new ones created.</p>

            <div className="grid grid-cols-2 gap-5">

              {/* ── LEFT: Import Drivers ───────────────────────────────── */}
              <section className={CARD}>
                <h2 className={SH + ' pb-3 border-b border-[#E2E8F0]'}>
                  <Users size={18} className="text-[#2563EB]" /> Import Drivers
                </h2>
                <p className="text-xs text-[#6B7280]">
                  Matched by <strong>DAProviderID</strong>. New drivers get an auto-generated work email
                  (<code className="bg-slate-100 px-1 rounded">firstname.lastname@lastmiledsp.com</code>) and a temporary login account.
                </p>

                {/* Column reference */}
                <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 space-y-1">
                  <p className="font-semibold text-slate-700">Required columns (exact Paycom names):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {['DAProviderID','Legal_Firstname','Legal_Lastname'].map(c => (
                      <code key={c} className="bg-white border border-red-200 text-red-700 px-1.5 py-0.5 rounded text-[11px]">{c}</code>
                    ))}
                  </div>
                  <p className="font-semibold text-slate-700 pt-1">Optional columns:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {['Employee_Code','DriversLicense','Birth_Date_(MM/DD/YYYY)','DLExpirationDate','Hire_Date'].map(c => (
                      <code key={c} className="bg-white border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[11px]">{c}</code>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => downloadTemplate('drivers')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-300 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    <Download size={13} /> Download Template
                  </button>
                  <input ref={driverImportRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleDriverImport} />
                  <button
                    onClick={() => { setDriverPreview(null); setImportResult(null); driverImportRef.current?.click(); }}
                    disabled={importDriversMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
                  >
                    <Upload size={13} /> Select File
                  </button>
                </div>

                {/* Preview */}
                {driverPreview && !importResult && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-700">
                        Preview — {driverPreview.totalRows} row{driverPreview.totalRows !== 1 ? 's' : ''} detected
                        {driverPreview.totalRows > 5 && <span className="text-slate-400 font-normal"> (showing first 5)</span>}
                      </p>
                      <button onClick={() => setDriverPreview(null)} className="text-slate-400 hover:text-slate-600"><X size={13} /></button>
                    </div>

                    {driverPreview.warnings.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-800 space-y-0.5">
                        {driverPreview.warnings.map((w, i) => (
                          <p key={i} className="flex items-center gap-1.5"><AlertCircle size={12} className="flex-shrink-0" /> {w}</p>
                        ))}
                      </div>
                    )}

                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-[11px]">
                        <thead className="bg-slate-50">
                          <tr>
                            {['DAProviderID','Legal_Firstname','Legal_Lastname','DLExpirationDate','Hire_Date'].map(h => (
                              <th key={h} className="px-2 py-1.5 text-left font-semibold text-slate-500 whitespace-nowrap border-b border-slate-200">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {driverPreview.previewRows.map((row, i) => (
                            <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                              <td className="px-2 py-1 font-mono text-slate-600">{row['DAProviderID'] || '—'}</td>
                              <td className="px-2 py-1 text-slate-700">{row['Legal_Firstname'] || '—'}</td>
                              <td className="px-2 py-1 text-slate-700">{row['Legal_Lastname'] || '—'}</td>
                              <td className="px-2 py-1 text-slate-500">{row['DLExpirationDate'] || '—'}</td>
                              <td className="px-2 py-1 text-slate-500">{row['Hire_Date'] || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { importDriversMutation.mutate(driverPreview.rows); setDriverPreview(null); }}
                        disabled={importDriversMutation.isPending || driverPreview.warnings.some(w => w.startsWith('Missing required'))}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[#1E3A5F] text-white rounded-lg hover:bg-[#162d4a] disabled:opacity-50 transition-colors"
                      >
                        <CheckCircle size={14} /> {importDriversMutation.isPending ? 'Importing…' : `Confirm Import (${driverPreview.totalRows} rows)`}
                      </button>
                      <button onClick={() => setDriverPreview(null)} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
                    </div>
                  </div>
                )}

                {/* Result */}
                {importResult && (
                  <div className={`rounded-xl p-4 flex items-start gap-3 ${importResult.errors?.length > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
                    <CheckCircle size={18} className={`flex-shrink-0 mt-0.5 ${importResult.errors?.length > 0 ? 'text-amber-500' : 'text-green-500'}`} />
                    <div className="flex-1 text-sm">
                      <p className="font-semibold text-slate-800">Driver import complete</p>
                      <p className="text-slate-700">
                        <span className="text-green-700 font-semibold">{importResult.created} created</span>
                        {importResult.accounts_created > 0 && <span className="text-blue-700 font-semibold"> · {importResult.accounts_created} accounts created</span>}
                        <span> · {importResult.updated} updated · {importResult.skipped} skipped</span>
                      </p>
                      {importResult.accounts_created > 0 && (
                        <p className="text-xs text-blue-600 mt-1">New drivers can log in with their work email and the default temporary password. They will be prompted to change it on first login.</p>
                      )}
                      {importResult.errors?.length > 0 && (
                        <details className="mt-1">
                          <summary className="text-red-600 cursor-pointer text-xs">{importResult.errors.length} error{importResult.errors.length !== 1 ? 's' : ''}</summary>
                          <ul className="mt-1 text-xs text-red-600 space-y-0.5">{importResult.errors.map((e, i) => <li key={i}>• {e}</li>)}</ul>
                        </details>
                      )}
                    </div>
                    <button onClick={() => setImportResult(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                  </div>
                )}
              </section>

              {/* ── RIGHT: Import Vehicles ─────────────────────────────── */}
              <section className={CARD}>
                <h2 className={SH + ' pb-3 border-b border-[#E2E8F0]'}>
                  <FileSpreadsheet size={18} className="text-[#2563EB]" /> Import Vehicles
                </h2>
                <p className="text-xs text-[#6B7280]">
                  Matched by <strong>VIN</strong>. Service type is mapped automatically:
                  Step Van → <strong>STEP VAN</strong>, Rivian / Electric → <strong>EDV</strong>.
                </p>

                {/* Column reference */}
                <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 space-y-1">
                  <p className="font-semibold text-slate-700">Required columns:</p>
                  <div className="flex flex-wrap gap-1.5">
                    <code className="bg-white border border-red-200 text-red-700 px-1.5 py-0.5 rounded text-[11px]">vin</code>
                  </div>
                  <p className="font-semibold text-slate-700 pt-1">Optional (Amazon fleet export names):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {['vehicleName','licensePlateNumber','make','model','year','serviceType','operationalStatus','registrationExpiryDate','registeredState','vehicleProvider','ownershipType','ownershipStartDate','ownershipEndDate'].map(c => (
                      <code key={c} className="bg-white border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[11px]">{c}</code>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => downloadTemplate('vehicles')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-300 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    <Download size={13} /> Download Template
                  </button>
                  <input ref={fleetImportRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFleetImport} />
                  <button
                    onClick={() => { setVehiclePreview(null); setFleetImportResult(null); fleetImportRef.current?.click(); }}
                    disabled={importVehiclesMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
                  >
                    <Upload size={13} /> Select File
                  </button>
                </div>

                {/* Preview */}
                {vehiclePreview && !fleetImportResult && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-700">
                        Preview — {vehiclePreview.totalRows} row{vehiclePreview.totalRows !== 1 ? 's' : ''} detected
                        {vehiclePreview.totalRows > 5 && <span className="text-slate-400 font-normal"> (showing first 5)</span>}
                      </p>
                      <button onClick={() => setVehiclePreview(null)} className="text-slate-400 hover:text-slate-600"><X size={13} /></button>
                    </div>

                    {vehiclePreview.warnings.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-800 space-y-0.5">
                        {vehiclePreview.warnings.map((w, i) => (
                          <p key={i} className="flex items-center gap-1.5"><AlertCircle size={12} className="flex-shrink-0" /> {w}</p>
                        ))}
                      </div>
                    )}

                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-[11px]">
                        <thead className="bg-slate-50">
                          <tr>
                            {['vin','vehicleName','make','model','serviceType','operationalStatus'].map(h => (
                              <th key={h} className="px-2 py-1.5 text-left font-semibold text-slate-500 whitespace-nowrap border-b border-slate-200">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {vehiclePreview.previewRows.map((row, i) => (
                            <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                              <td className="px-2 py-1 font-mono text-slate-600 text-[10px]">{(row['vin'] || '—').slice(0, 17)}</td>
                              <td className="px-2 py-1 text-slate-700">{row['vehicleName'] || '—'}</td>
                              <td className="px-2 py-1 text-slate-600">{row['make'] || '—'}</td>
                              <td className="px-2 py-1 text-slate-600">{row['model'] || '—'}</td>
                              <td className="px-2 py-1 text-slate-500 text-[10px]">{row['serviceType'] || '—'}</td>
                              <td className="px-2 py-1">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${(row['operationalStatus'] || '').toUpperCase() === 'OPERATIONAL' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                  {row['operationalStatus'] || '—'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { importVehiclesMutation.mutate(vehiclePreview.rows); setVehiclePreview(null); }}
                        disabled={importVehiclesMutation.isPending || vehiclePreview.warnings.some(w => w.startsWith('Missing required'))}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[#1E3A5F] text-white rounded-lg hover:bg-[#162d4a] disabled:opacity-50 transition-colors"
                      >
                        <CheckCircle size={14} /> {importVehiclesMutation.isPending ? 'Importing…' : `Confirm Import (${vehiclePreview.totalRows} rows)`}
                      </button>
                      <button onClick={() => setVehiclePreview(null)} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
                    </div>
                  </div>
                )}

                {/* Result */}
                {fleetImportResult && (
                  <div className={`rounded-xl p-4 flex items-start gap-3 ${fleetImportResult.errors?.length > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
                    <CheckCircle size={18} className={`flex-shrink-0 mt-0.5 ${fleetImportResult.errors?.length > 0 ? 'text-amber-500' : 'text-green-500'}`} />
                    <div className="flex-1 text-sm">
                      <p className="font-semibold text-slate-800">Vehicle import complete</p>
                      <p className="text-slate-700">
                        <span className="text-green-700 font-semibold">{fleetImportResult.created} created</span>
                        <span> · {fleetImportResult.updated} updated · {fleetImportResult.skipped} skipped</span>
                      </p>
                      {fleetImportResult.errors?.length > 0 && (
                        <details className="mt-1">
                          <summary className="text-red-600 cursor-pointer text-xs">{fleetImportResult.errors.length} error{fleetImportResult.errors.length !== 1 ? 's' : ''}</summary>
                          <ul className="mt-1 text-xs text-red-600 space-y-0.5">{fleetImportResult.errors.map((e, i) => <li key={i}>• {e}</li>)}</ul>
                        </details>
                      )}
                    </div>
                    <button onClick={() => setFleetImportResult(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                  </div>
                )}
              </section>

            </div>
          </>
        )}

        {/* ══ NOTIFICATIONS ════════════════════════════════════════════════ */}
        {activeSection === 'notifications' && (
          <>
            <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
            <section className={CARD}>
              <div className="py-8 text-center">
                <Bell size={32} className="text-slate-200 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">Notification preferences coming soon.</p>
              </div>
            </section>
          </>
        )}

        {/* ══ AUDIT LOG ════════════════════════════════════════════════ */}
        {activeSection === 'audit-log' && (
          <>
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold text-slate-900">Audit Log</h1>
              <button onClick={exportAuditLog} className="btn-secondary flex items-center gap-2 text-sm" disabled={!auditData.rows.length}>
                <Download size={14} /> Export Excel
              </button>
            </div>

            {/* Filters */}
            <section className={CARD}>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={FL}>From Date</label>
                  <input type="date" className="input" value={auditFilters.date_from} onChange={e => setAuditFilter('date_from', e.target.value)} />
                </div>
                <div>
                  <label className={FL}>To Date</label>
                  <input type="date" className="input" value={auditFilters.date_to} onChange={e => setAuditFilter('date_to', e.target.value)} />
                </div>
                <div>
                  <label className={FL}>User</label>
                  <select className="select" value={auditFilters.user_id} onChange={e => setAuditFilter('user_id', e.target.value)}>
                    <option value="">All Users</option>
                    {auditUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.user_name} ({u.user_role})</option>)}
                  </select>
                </div>
                <div>
                  <label className={FL}>Action Type</label>
                  <select className="select" value={auditFilters.action_type} onChange={e => setAuditFilter('action_type', e.target.value)}>
                    <option value="">All Actions</option>
                    {Object.keys(ACTION_COLORS).map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className={FL}>Entity Type</label>
                  <select className="select" value={auditFilters.entity_type} onChange={e => setAuditFilter('entity_type', e.target.value)}>
                    <option value="">All Entities</option>
                    {['staff','drivers','vehicles','shifts','attendance'].map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
                <div>
                  <label className={FL}>Search</label>
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input className="input pl-7" placeholder="Search description, user…" value={auditFilters.search} onChange={e => setAuditFilter('search', e.target.value)} />
                  </div>
                </div>
              </div>
              {Object.values(auditFilters).some(Boolean) && (
                <button className="text-xs text-blue-600 hover:text-blue-700 font-medium mt-1" onClick={() => { setAuditFilters({ date_from:'', date_to:'', user_id:'', action_type:'', entity_type:'', search:'' }); setAuditPage(1); }}>
                  Clear filters
                </button>
              )}
            </section>

            {/* Table */}
            <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Timestamp</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">User</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Action</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Entity</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Description</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditQuery.isLoading ? (
                      <tr><td colSpan={6} className="py-12 text-center text-slate-400 text-sm">Loading…</td></tr>
                    ) : auditData.rows.length === 0 ? (
                      <tr><td colSpan={6} className="py-12 text-center text-slate-400 text-sm">No audit entries found</td></tr>
                    ) : auditData.rows.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                          {r.timestamp ? new Date(r.timestamp).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <p className="text-xs font-medium text-slate-700">{r.user_name || '—'}</p>
                          <p className="text-[11px] text-slate-400 capitalize">{r.user_role || ''}</p>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ACTION_COLORS[r.action_type] || 'bg-slate-100 text-slate-600'}`}>
                            {(r.action_type || '').replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                          {r.entity_type}{r.entity_id ? ` #${r.entity_id}` : ''}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600 max-w-xs truncate" title={r.entity_description}>
                          {r.entity_description || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-400 font-mono whitespace-nowrap">
                          {r.ip_address || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {auditData.total > auditData.limit && (
                <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50">
                  <p className="text-xs text-slate-500">
                    Showing {((auditData.page - 1) * auditData.limit) + 1}–{Math.min(auditData.page * auditData.limit, auditData.total)} of {auditData.total} entries
                  </p>
                  <div className="flex items-center gap-2">
                    <button className="btn-secondary text-xs py-1 px-2.5" disabled={auditData.page <= 1} onClick={() => setAuditPage(p => p - 1)}>Prev</button>
                    <span className="text-xs text-slate-600">Page {auditData.page}</span>
                    <button className="btn-secondary text-xs py-1 px-2.5" disabled={auditData.page * auditData.limit >= auditData.total} onClick={() => setAuditPage(p => p + 1)}>Next</button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}

      </main>

      {/* ── Modals ──────────────────────────────────────────────────────── */}

      {/* Shift Type Modal */}
      <Modal isOpen={!!shiftTypeModal} onClose={() => setShiftTypeModal(null)} title={shiftTypeModal?.mode === 'create' ? 'Add Shift Type' : 'Edit Shift Type'} size="sm">
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); shiftTypeModal?.mode === 'create' ? createShiftType.mutate(stForm) : updateShiftType.mutate({ id: shiftTypeModal.item.id, ...stForm }); }}>
          <div><label className="modal-label">Name *</label><input className="input" required value={stForm.name} onChange={e => setStForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., HELPER" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="modal-label">Default Start</label><input type="time" className="input" value={stForm.default_start_time} onChange={e => setStForm(f => ({ ...f, default_start_time: e.target.value }))} /></div>
            <div><label className="modal-label">Default End</label><input type="time" className="input" value={stForm.default_end_time} onChange={e => setStForm(f => ({ ...f, default_end_time: e.target.value }))} /></div>
          </div>
          <div><label className="modal-label">Color</label>
            <div className="flex items-center gap-3">
              <input type="color" value={stForm.color} onChange={e => setStForm(f => ({ ...f, color: e.target.value }))} className="w-10 h-9 rounded cursor-pointer border border-[#D1D5DB] bg-transparent" />
              <span className="text-sm text-[#6B7280] font-mono">{stForm.color}</span>
              <div className="flex-1 h-8 rounded-lg border flex items-center justify-center text-xs font-semibold" style={{ backgroundColor: stForm.color + '33', color: stForm.color, borderColor: stForm.color + '66' }}>{stForm.name || 'Preview'}</div>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setShiftTypeModal(null)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1">{shiftTypeModal?.mode === 'create' ? 'Create' : 'Save'}</button>
          </div>
        </form>
      </Modal>

      {/* Consequence Rule Modal */}
      <Modal isOpen={ruleModal} onClose={() => { setRuleModal(false); setEditRule(null); }} title={editRule ? 'Edit Rule' : 'Add Consequence Rule'} size="sm">
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); saveRule.mutate(); }}>
          <div><label className="modal-label">Rule Name *</label><input className="input" required value={ruleForm.rule_name} onChange={e => setRuleForm(f => ({ ...f, rule_name: e.target.value }))} placeholder="e.g., NCNS Termination Review" /></div>
          <div><label className="modal-label">Violation Type</label>
            <select className="select" value={ruleForm.violation_type} onChange={e => setRuleForm(f => ({ ...f, violation_type: e.target.value }))}>
              {VIOLATION_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="modal-label">Threshold *</label><input type="number" className="input" min="1" required value={ruleForm.threshold} onChange={e => setRuleForm(f => ({ ...f, threshold: parseInt(e.target.value) }))} /></div>
            <div><label className="modal-label">Within (days)</label><input type="number" className="input" min="1" value={ruleForm.time_period_days} onChange={e => setRuleForm(f => ({ ...f, time_period_days: parseInt(e.target.value) }))} /></div>
          </div>
          <div><label className="modal-label">Consequence Action</label>
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

      {/* Confirm status change */}
      <Modal isOpen={!!statusModal} onClose={() => setStatusModal(null)} title="Change Driver Status" size="sm">
        {statusModal && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Change <strong>{statusModal.name}</strong> from <span className={`inline-block px-1.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[statusModal.current]}`}>{statusModal.current}</span> to <span className={`inline-block px-1.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[statusModal.newStatus]}`}>{statusModal.newStatus}</span>?
            </p>
            {statusModal.newStatus === 'inactive' && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Setting to <strong>Inactive</strong> will pause this driver's recurring schedule and hide them from schedule assignments.</p>}
            {statusModal.newStatus === 'terminated' && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">Setting to <strong>Terminated</strong> will permanently remove this driver from scheduling. Their history will be preserved.</p>}
            <div className="flex gap-3 pt-2">
              <button className="btn-secondary flex-1" onClick={() => setStatusModal(null)}>Cancel</button>
              <button className="btn-primary flex-1" onClick={() => updateDriverStatus.mutate({ staffId: statusModal.staffId, status: statusModal.newStatus })} disabled={updateDriverStatus.isPending}>
                {updateDriverStatus.isPending ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ─── MgmtRecurringRow ───────────────────────────────────────────────────── */
function MgmtRecurringRow({ row, shiftTypes, onUpdate, onDelete }) {
  const [localTimes, setLocalTimes] = useState({
    start: row.start_time?.slice(0,5) || '07:00',
    end:   row.end_time?.slice(0,5)   || '17:00',
  });

  useEffect(() => {
    setLocalTimes({ start: row.start_time?.slice(0,5) || '07:00', end: row.end_time?.slice(0,5) || '17:00' });
  }, [row.start_time, row.end_time]);

  const handleShiftTypeChange = (newType) => {
    const t = shiftTypes.find(st => st.name === newType);
    const newStart = t?.default_start_time?.slice(0,5) || '07:00';
    const newEnd   = t?.default_end_time?.slice(0,5)   || '17:00';
    setLocalTimes({ start: newStart, end: newEnd });
    onUpdate({ ...row, shift_type: newType, start_time: newStart, end_time: newEnd });
  };

  const handleTimeBlur = () => {
    const sc = localTimes.start !== row.start_time?.slice(0,5);
    const ec = localTimes.end   !== row.end_time?.slice(0,5);
    if (sc || ec) onUpdate({ ...row, start_time: localTimes.start, end_time: localTimes.end });
  };

  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60 group">
      <td className="px-2 py-2">
        <button onClick={() => onDelete(row.id)} className="text-slate-300 hover:text-red-500 rounded p-0.5 transition-colors opacity-0 group-hover:opacity-100" title="Remove row"><Trash2 size={13} /></button>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${SHIFT_DOT_COLORS[row.shift_type] || 'bg-slate-400'}`} />
          <select value={row.shift_type} onChange={e => handleShiftTypeChange(e.target.value)}
            className="text-xs py-0.5 px-1.5 border border-slate-200 rounded-md bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" style={{ minWidth:'7rem' }}>
            {shiftTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </div>
      </td>
      <td className="px-1.5 py-2"><input type="time" value={localTimes.start} onChange={e => setLocalTimes(p => ({ ...p, start: e.target.value }))} onBlur={handleTimeBlur} className="text-xs py-0.5 px-1.5 border border-slate-200 rounded-md bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none w-[5.5rem]" /></td>
      <td className="py-2 text-slate-300 text-xs select-none">–</td>
      <td className="px-1.5 py-2"><input type="time" value={localTimes.end} onChange={e => setLocalTimes(p => ({ ...p, end: e.target.value }))} onBlur={handleTimeBlur} className="text-xs py-0.5 px-1.5 border border-slate-200 rounded-md bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none w-[5.5rem]" /></td>
      {DR_DAYS_COL.map((day, i) => (
        <td key={day} className="text-center px-1 py-2">
          <button onClick={() => onUpdate({ ...row, [day]: !row[day] })}
            className={`w-7 h-7 rounded-lg text-[11px] font-bold border transition-all ${row[day] ? 'bg-primary text-white border-primary shadow-sm' : 'bg-white text-slate-300 border-slate-200 hover:border-primary/60 hover:text-slate-500'}`}>
            {DR_DAYS_BTN[i]}
          </button>
        </td>
      ))}
    </tr>
  );
}
