import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  format, addDays, startOfWeek, endOfWeek, getWeek, parseISO, isToday, addWeeks, subWeeks,
  startOfMonth, endOfMonth, isSameDay, isSameMonth
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, ChevronDown, Plus, Trash2, Settings, Download,
  Search, RefreshCw, Upload, Clock, BarChart2, RepeatIcon, X, Check, AlertTriangle, ClipboardList,
  Send, EyeOff, Pencil, Filter
} from 'lucide-react';
import api from '../api/client';
import Modal from '../components/Modal';
import toast from 'react-hot-toast';
import { useAuth } from '../App';
import * as XLSX from 'xlsx';
import OperationalPlanner from './OperationalPlanner';

// ─── Constants ───────────────────────────────────────────────────────────────
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SHIFT_COLORS = {
  'EDV':        'bg-blue-100   text-blue-800   border-blue-200',
  'STEP VAN':   'bg-indigo-100 text-indigo-800 border-indigo-200',
  'ON CALL':    'bg-yellow-100 text-amber-800  border-yellow-200',
  'EXTRA':      'bg-green-100  text-green-800  border-green-200',
  'SUSPENSION': 'bg-red-100    text-red-800    border-red-200',
  'UTO':        'bg-purple-100 text-purple-800 border-purple-200',
  'PTO':        'bg-teal-100   text-teal-800   border-teal-200',
  'TRAINING':   'bg-orange-100 text-orange-800 border-orange-200',
  'HELPER':     'bg-amber-100  text-amber-800  border-amber-200',
};

const SHIFT_COLORS_SELECTED = {
  'EDV':        'bg-blue-600    text-white border-blue-600',
  'STEP VAN':   'bg-indigo-800  text-white border-indigo-800',
  'ON CALL':    'bg-yellow-500  text-white border-yellow-500',
  'EXTRA':      'bg-green-600   text-white border-green-600',
  'SUSPENSION': 'bg-red-600     text-white border-red-600',
  'UTO':        'bg-purple-600  text-white border-purple-600',
  'PTO':        'bg-teal-600    text-white border-teal-600',
  'TRAINING':   'bg-orange-500  text-white border-orange-500',
  'HELPER':     'bg-amber-500   text-white border-amber-500',
};

const ATTENDANCE_DOT = {
  ncns:       'bg-red-500',
  called_out: 'bg-orange-500',
  late:       'bg-yellow-500',
  present:    'bg-green-500',
};

// ─── Multi-select helpers ─────────────────────────────────────────────────────
const cellKey    = (staffId, dateStr) => `${staffId}|${dateStr}`;
const parseCellKey = key => { const i = key.indexOf('|'); return { staffId: parseInt(key.slice(0, i)), dateStr: key.slice(i + 1) }; };

function getCellsInRect(anchor, corner, staffList, days) {
  const ri = id => staffList.findIndex(x => x.id === id);
  const ci = ds => days.findIndex(d => format(d, 'yyyy-MM-dd') === ds);
  const r1 = Math.min(ri(anchor.staffId), ri(corner.staffId));
  const r2 = Math.max(ri(anchor.staffId), ri(corner.staffId));
  const c1 = Math.min(ci(anchor.dateStr), ci(corner.dateStr));
  const c2 = Math.max(ci(anchor.dateStr), ci(corner.dateStr));
  const cells = new Set();
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      if (staffList[r] && days[c]) cells.add(cellKey(staffList[r].id, format(days[c], 'yyyy-MM-dd')));
    }
  }
  return cells;
}

// Amazon-style week number (Sunday-based, week 1 = week containing Jan 1)
function getAmazonWeek(date) {
  return getWeek(date, { weekStartsOn: 0, firstWeekContainsDate: 1 });
}

function getSunday(date) {
  return startOfWeek(date, { weekStartsOn: 0 });
}

// ─── Shift Cell ───────────────────────────────────────────────────────────────
// ShiftCell is purely visual — all interaction is handled by the parent <td>
function ShiftCell({ shift, isManager }) {
  if (!shift) {
    if (!isManager) return <span className="text-slate-300 text-xs">—</span>;
    return (
      <div className="w-full min-h-[2.5rem] rounded-lg border border-dashed border-slate-200 text-slate-300 text-lg flex items-center justify-center cursor-pointer hover:border-primary hover:bg-primary-50 hover:text-primary transition-all select-none">
        +
      </div>
    );
  }

  const isDraft = shift.publish_status === 'draft' || !shift.publish_status;
  const baseColor = SHIFT_COLORS[shift.shift_type] || 'bg-slate-100 text-slate-700 border-slate-200';
  const attDot = ATTENDANCE_DOT[shift.attendance_status];

  return (
    <div className="relative">
      {isManager && isDraft && (
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none z-10 shadow-sm pointer-events-none select-none">!</span>
      )}
      <div className={`w-full rounded-lg border px-2 py-1.5 text-left ${baseColor} ${isManager ? 'cursor-pointer hover:shadow-sm' : 'cursor-default'} transition-shadow`}>
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-bold truncate">{shift.shift_type}</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            {attDot && <span className={`w-2 h-2 rounded-full ${attDot}`} />}
          </div>
        </div>
        <p className="text-[10px] opacity-70 mt-0.5">
          {shift.start_time?.slice(0,5)}–{shift.end_time?.slice(0,5)}
        </p>
        {shift.attendance_status && shift.attendance_status !== 'present' && (
          <p className="text-[10px] font-semibold mt-0.5 uppercase opacity-80">
            {shift.attendance_status.replace('_', ' ')}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function Schedule() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isManager = ['manager', 'admin', 'dispatcher'].includes(user?.role);
  const [searchParams] = useSearchParams();

  // View state — 'weekly' | 'daily' | 'ops'
  const [activeView, setActiveView] = useState(() => {
    const tab = searchParams.get('tab');
    if (tab === 'ops') return 'ops';
    return 'weekly';
  });
  const [weekStart, setWeekStart] = useState(getSunday(new Date()));
  const [dailyDate, setDailyDate] = useState(new Date()); // shared: daily view ↔ ops planner
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarViewMonth, setCalendarViewMonth] = useState(() => startOfMonth(new Date()));
  const calendarRef = useRef(null);
  const activeViewRef = useRef('weekly');

  // Filter state
  const [filterShiftTypes, setFilterShiftTypes] = useState([]);
  const [showUnscheduled, setShowUnscheduled] = useState(false); // default OFF — daily view shows only scheduled
  const [organizeBy, setOrganizeBy] = useState('name'); // 'name'|'route'|'shift_type'|'start_time'

  // Multi-driver chip search
  const [driverChips, setDriverChips] = useState([]);   // [{ id, name }]
  const [chipInput, setChipInput]     = useState('');
  const [chipDropOpen, setChipDropOpen] = useState(false);
  const chipInputRef    = useRef();
  const chipContainerRef = useRef();

  // Per-day column filter (weekly view)
  const [dayColFilter, setDayColFilter]       = useState(null);  // { dateStr, mode } | null
  const [dayFilterDropOpen, setDayFilterDropOpen] = useState(null); // dateStr of open dropdown | null

  // Modal state
  const [addShiftModal, setAddShiftModal] = useState(null); // { staff_id, date }
  const [settingsModal, setSettingsModal] = useState(false);
  const [hoursUploadModal, setHoursUploadModal] = useState(false);

  // Rotating driver weekly prompt
  const [rotatingPromptOpen, setRotatingPromptOpen] = useState(false);
  const [rotatingAssignments, setRotatingAssignments] = useState({}); // { [staffId]: rowId }

  // Edit shift state
  const [editShiftModal, setEditShiftModal] = useState(null); // { shift } | null
  const [editForm, setEditForm] = useState({ shift_type: 'EDV', start_time: '07:00', end_time: '17:00', notes: '' });

  // Publish state
  const [publishModal, setPublishModal] = useState(false);
  const [selectedLogIds, setSelectedLogIds] = useState(new Set()); // IDs from change log to publish

  // Driver sort
  const [driverSort, setDriverSort] = useState('last-asc'); // last-asc | last-desc | first-asc | first-desc

  // ── Multi-select state ─────────────────────────────────────────────────────
  const [selectedCells, setSelectedCells] = useState(new Set()); // "staffId|dateStr"
  const [selectionAnchor, setSelectionAnchor] = useState(null);  // { staffId, dateStr }
  const [bulkShiftType, setBulkShiftType] = useState('');
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [removeRecurringChecked, setRemoveRecurringChecked] = useState(false);
  const [selectionInProgress, setSelectionInProgress] = useState(false); // true while dragging/clicking
  // Drag tracking refs (no re-renders during drag)
  // active=false until mouse enters a DIFFERENT cell while held
  const dragRef = useRef({ active: false, startStaffId: null, startDateStr: null });
  const justDraggedRef = useRef(false);

  // Add shift form
  const [shiftForm, setShiftForm] = useState({ shift_type: 'EDV', start_time: '07:00', end_time: '17:00', notes: '' });

  // Route commitment form
  const [rcForm, setRcForm] = useState({ edv_count: '', step_van_count: '', total_routes: '', notes: '' });

  // Hours upload
  const [hoursFile, setHoursFile] = useState(null);

  // ── Fixed bottom bar: column position tracking ─────────────────────────────
  const dayColRefs = useRef([]);          // refs to each day <th>
  const tableContainerRef = useRef();     // ref to the overflow-auto table wrapper
  const [dayColRects, setDayColRects] = useState([]); // [{left, width}]

  const syncDayColRects = useCallback(() => {
    const rects = dayColRefs.current
      .filter(Boolean)
      .map(el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, width: r.width };
      });
    setDayColRects(rects);
  }, []);

  useLayoutEffect(() => {
    if (activeView !== 'weekly') return;
    // Fire synchronously after DOM commit so refs are guaranteed populated
    syncDayColRects();
    const el = tableContainerRef.current;
    if (!el) return;
    el.addEventListener('scroll', syncDayColRects, { passive: true });
    window.addEventListener('resize', syncDayColRects, { passive: true });
    return () => {
      el.removeEventListener('scroll', syncDayColRects);
      window.removeEventListener('resize', syncDayColRects);
    };
  }, [activeView, syncDayColRects, weekStart]);

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const amazonWeek = getAmazonWeek(weekStart);

  // ── Data Fetching ─────────────────────────────────────────────────────────
  const { data: shifts = [], isLoading: shiftsLoading } = useQuery({
    queryKey: ['shifts', weekStartStr],
    queryFn: () => api.get('/shifts', { params: { start: weekStartStr, end: format(weekEnd, 'yyyy-MM-dd') } }).then(r => r.data),
  });

  const { data: staff = [] } = useQuery({
    queryKey: ['staff', 'drivers'],
    queryFn: () => api.get('/staff', { params: { role: 'driver', status: 'active' } }).then(r => r.data),
  });

  const { data: shiftTypes = [] } = useQuery({
    queryKey: ['shift-types'],
    queryFn: () => api.get('/schedule/shift-types').then(r => r.data),
  });

  // Rotating drivers overview (only loaded for managers)
  const { data: rotatingOverview = [] } = useQuery({
    queryKey: ['driver-recurring-overview'],
    queryFn: () => api.get('/drivers/recurring-overview').then(r => r.data),
    enabled: isManager,
  });

  const { data: routeCommitment } = useQuery({
    queryKey: ['route-commitment', weekStartStr],
    queryFn: () => api.get('/schedule/route-commitments', { params: { week_start: weekStartStr, weeks: 1 } })
      .then(r => r.data?.[0] || null),
  });

  const { data: driverHours = [] } = useQuery({
    queryKey: ['driver-hours', weekStartStr],
    queryFn: () => api.get('/schedule/hours', { params: { week_start: weekStartStr } }).then(r => r.data),
  });

  const { data: inactiveCount = 0 } = useQuery({
    queryKey: ['inactive-vehicle-count'],
    queryFn: () => api.get('/vehicles').then(r =>
      r.data.filter(v => ['inactive', 'maintenance'].includes(v.status)).length
    ).catch(() => 0),
    refetchInterval: 60000,
  });

  // ── Ops Planner session for daily route-code sort ──────────────────────────
  const dailyDateStr = format(dailyDate, 'yyyy-MM-dd');
  const { data: opsPlanSession } = useQuery({
    queryKey: ['ops-plan-session', dailyDateStr],
    queryFn: () => api.get(`/ops-planner?date=${dailyDateStr}`).then(r => r.data).catch(() => null),
    enabled: activeView === 'daily' && organizeBy === 'route',
  });
  const routeCodeMap = useMemo(() => {
    const map = {};
    if (!opsPlanSession?.rows) return map;
    opsPlanSession.rows.forEach(row => {
      if (row.matchedDriver && row.routeCode) {
        const id = row.matchedDriver.staff_id || row.matchedDriver.id;
        if (id) map[id] = row.routeCode;
      }
    });
    return map;
  }, [opsPlanSession]);

  // Week publish status (manager only)
  const { data: weekStatus = { status: 'empty', published: 0, draft: 0, total: 0 } } = useQuery({
    queryKey: ['week-status', weekStartStr],
    queryFn: () => api.get('/shifts/week-status', { params: { week_start: weekStartStr } }).then(r => r.data),
    enabled: isManager,
  });

  // Change log for pre-publish review modal
  const { data: changeLog = [], refetch: refetchChangeLog } = useQuery({
    queryKey: ['change-log', weekStartStr],
    queryFn: () => api.get('/shifts/change-log', { params: { week_start: weekStartStr } }).then(r => r.data),
    enabled: isManager && publishModal,
  });

  // Route codes for per-day weekly column filter (route mode)
  const { data: dayFilterPlan } = useQuery({
    queryKey: ['day-filter-routes', dayColFilter?.dateStr],
    queryFn: () =>
      api.get('/ops-planner', { params: { date: dayColFilter.dateStr } })
        .then(r => r.data)
        .catch(() => null),
    enabled: !!dayColFilter?.dateStr && dayColFilter?.mode === 'route',
  });
  const dayFilterRouteMap = useMemo(() => {
    const map = {};
    dayFilterPlan?.rows?.forEach(row => {
      if (row.matchedDriver && row.routeCode) {
        const id = row.matchedDriver.staff_id || row.matchedDriver.id;
        if (id) map[id] = row.routeCode || '';
      }
    });
    return map;
  }, [dayFilterPlan]);

  // Day-recurring patterns (for recurring conflict warning on bulk delete)
  const { data: dayRecurring = [] } = useQuery({
    queryKey: ['day-recurring'],
    queryFn: () => api.get('/schedule/day-recurring').then(r => r.data),
    enabled: isManager,
  });
  // Build a Set of "staffId|dow" for fast recurring lookup
  const recurringSet = useMemo(() => {
    const s = new Set();
    dayRecurring.forEach(d => (d.drivers || []).forEach(dr => s.add(`${dr.staff_id}|${d.day_of_week}`)));
    return s;
  }, [dayRecurring]);

  // Settings for driver visibility
  const { data: appSettings = {} } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
  });

  // ── Shift Map ─────────────────────────────────────────────────────────────
  const shiftMap = useMemo(() => {
    const map = {};
    shifts.forEach(s => {
      const dateStr = s.shift_date?.split('T')[0] || s.shift_date;
      const key = `${s.staff_id}-${dateStr}`;
      if (!map[key]) map[key] = [];
      map[key].push(s);
    });
    return map;
  }, [shifts]);

  const hoursMap = useMemo(() => {
    const map = {};
    driverHours.forEach(h => { map[h.staff_id] = h.hours_worked; });
    return map;
  }, [driverHours]);

  // ── Chip suggestions (drivers matching chipInput, not already added) ────────
  const chipSuggestions = useMemo(() => {
    if (!chipInput.trim()) return [];
    const q = chipInput.toLowerCase();
    return staff
      .filter(s => !driverChips.some(c => c.id === s.id))
      .filter(s => `${s.first_name} ${s.last_name}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [staff, driverChips, chipInput]);

  // ── Filtered Drivers ──────────────────────────────────────────────────────
  const filteredStaff = useMemo(() => {
    let list = staff;

    // Multi-chip filter: if chips present, show ONLY those drivers
    if (driverChips.length > 0) {
      list = list.filter(s => driverChips.some(c => c.id === s.id));
    } else if (chipInput.trim()) {
      // No chips yet but typing — filter by input text as preview
      const q = chipInput.toLowerCase();
      list = list.filter(s => `${s.first_name} ${s.last_name}`.toLowerCase().includes(q));
    }

    // Show/hide unscheduled (view-aware)
    if (!showUnscheduled) {
      if (activeView === 'daily') {
        const ds = format(dailyDate, 'yyyy-MM-dd');
        list = list.filter(s => shiftMap[`${s.id}-${ds}`]?.length > 0);
      } else {
        list = list.filter(s => weekDays.some(d => shiftMap[`${s.id}-${format(d, 'yyyy-MM-dd')}`]?.length > 0));
      }
    }

    if (filterShiftTypes.length > 0) {
      list = list.filter(s => weekDays.some(d => {
        const key = `${s.id}-${format(d, 'yyyy-MM-dd')}`;
        return shiftMap[key]?.some(sh => filterShiftTypes.includes(sh.shift_type));
      }));
    }
    return list;
  }, [staff, driverChips, chipInput, showUnscheduled, filterShiftTypes, shiftMap, weekDays, dailyDate, activeView]);

  // ── Summary counts ────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const counts = { EDV: 0, 'STEP VAN': 0, EXTRA: 0, HELPER: 0 };
    shifts.forEach(s => {
      if (counts[s.shift_type] !== undefined) counts[s.shift_type]++;
    });
    return counts;
  }, [shifts]);

  // ── Per-day summary ───────────────────────────────────────────────────────
  const daySummary = useMemo(() => {
    const map = {};
    shifts.forEach(s => {
      const dateStr = s.shift_date?.split('T')[0] || s.shift_date;
      if (!map[dateStr]) map[dateStr] = {};
      map[dateStr][s.shift_type] = (map[dateStr][s.shift_type] || 0) + 1;
    });
    return map;
  }, [shifts]);

  // ── Sorted staff ──────────────────────────────────────────────────────────
  const sortedStaff = useMemo(() => {
    const SHIFT_ORDER = ['EDV','STEP VAN','HELPER','EXTRA','ON CALL','UTO','PTO','TRAINING','SUSPENSION'];

    let list = [...filteredStaff].sort((a, b) => {
      const la = (a.last_name  || a.name?.split(' ').pop() || '').toLowerCase();
      const fa = (a.first_name || a.name?.split(' ')[0]   || '').toLowerCase();
      const lb = (b.last_name  || b.name?.split(' ').pop() || '').toLowerCase();
      const fb = (b.first_name || b.name?.split(' ')[0]   || '').toLowerCase();
      if (driverSort === 'last-asc')  return la.localeCompare(lb);
      if (driverSort === 'last-desc') return lb.localeCompare(la);
      if (driverSort === 'first-asc') return fa.localeCompare(fb);
      return fb.localeCompare(fa);
    });

    // Per-day column secondary sort — overrides name sort for the selected day
    if (dayColFilter?.mode && dayColFilter.mode !== 'all') {
      const ds = dayColFilter.dateStr;
      if (dayColFilter.mode === 'shift_type') {
        list.sort((a, b) => {
          const sa = shiftMap[`${a.id}-${ds}`]?.[0]?.shift_type || '';
          const sb = shiftMap[`${b.id}-${ds}`]?.[0]?.shift_type || '';
          const ia = SHIFT_ORDER.indexOf(sa); const ib = SHIFT_ORDER.indexOf(sb);
          if (ia === -1 && ib === -1) return sa.localeCompare(sb);
          if (ia === -1) return 1; if (ib === -1) return -1;
          return ia - ib;
        });
      } else if (dayColFilter.mode === 'start_time') {
        list.sort((a, b) => {
          const ta = shiftMap[`${a.id}-${ds}`]?.[0]?.start_time || '99:99';
          const tb = shiftMap[`${b.id}-${ds}`]?.[0]?.start_time || '99:99';
          return ta.localeCompare(tb);
        });
      } else if (dayColFilter.mode === 'route') {
        list.sort((a, b) => {
          const ra = dayFilterRouteMap[a.id] || '';
          const rb = dayFilterRouteMap[b.id] || '';
          if (!ra && !rb) return 0;
          if (!ra) return 1; if (!rb) return -1;
          return ra.localeCompare(rb);
        });
      }
    }

    return list;
  }, [filteredStaff, driverSort, dayColFilter, shiftMap, dayFilterRouteMap]);

  const cycleDriverSort = () => {
    setDriverSort(s => s === 'last-asc' ? 'last-desc' : s === 'last-desc' ? 'first-asc' : s === 'first-asc' ? 'first-desc' : 'last-asc');
  };

  // ── Daily-view sorted staff (supports organizeBy) ─────────────────────────
  const dailySortedStaff = useMemo(() => {
    const ds = format(dailyDate, 'yyyy-MM-dd');
    let list = [...filteredStaff];
    if (organizeBy === 'route') {
      list.sort((a, b) => {
        const ra = routeCodeMap[a.id] || '';
        const rb = routeCodeMap[b.id] || '';
        if (!ra && !rb) return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
        if (!ra) return 1;
        if (!rb) return -1;
        return ra.localeCompare(rb);
      });
    } else if (organizeBy === 'shift_type') {
      const ORDER = ['EDV', 'STEP VAN', 'HELPER', 'EXTRA', 'ON CALL', 'UTO', 'PTO', 'TRAINING', 'SUSPENSION'];
      list.sort((a, b) => {
        const sa = shiftMap[`${a.id}-${ds}`]?.[0]?.shift_type || '';
        const sb = shiftMap[`${b.id}-${ds}`]?.[0]?.shift_type || '';
        const ia = ORDER.indexOf(sa); const ib = ORDER.indexOf(sb);
        if (ia === -1 && ib === -1) return sa.localeCompare(sb);
        if (ia === -1) return 1; if (ib === -1) return -1;
        return ia - ib;
      });
    } else if (organizeBy === 'start_time') {
      list.sort((a, b) => {
        const ta = shiftMap[`${a.id}-${ds}`]?.[0]?.start_time || '99:99';
        const tb = shiftMap[`${b.id}-${ds}`]?.[0]?.start_time || '99:99';
        return ta.localeCompare(tb);
      });
    } else {
      list.sort((a, b) =>
        `${a.last_name} ${a.first_name}`.toLowerCase().localeCompare(`${b.last_name} ${b.first_name}`.toLowerCase())
      );
    }
    return list;
  }, [filteredStaff, organizeBy, dailyDate, shiftMap, routeCodeMap]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createShift = useMutation({
    mutationFn: data => api.post('/shifts', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Shift added');
      setAddShiftModal(null);
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to add shift'),
  });

  const deleteShift = useMutation({
    mutationFn: id => api.delete(`/shifts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shifts'] }); toast.success('Shift removed'); setEditShiftModal(null); },
  });

  const updateShift = useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/shifts/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shifts'] }); toast.success('Shift updated'); setEditShiftModal(null); },
    onError: err => toast.error(err.response?.data?.error || 'Failed to update shift'),
  });

  const markAttendance = useMutation({
    mutationFn: ({ shiftId, status }) => api.post('/attendance', {
      staff_id: shifts.find(s => s.id === shiftId)?.staff_id,
      shift_id: shiftId,
      attendance_date: shifts.find(s => s.id === shiftId)?.shift_date?.split('T')[0],
      status,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shifts'] }); toast.success('Attendance updated'); },
  });

  const saveRouteCommitment = useMutation({
    mutationFn: data => api.post('/schedule/route-commitments', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['route-commitment'] });
      toast.success('Route commitment saved');
    },
  });

  const uploadHours = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', hoursFile);
      fd.append('week_start', weekStartStr);
      return api.post('/schedule/hours/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ['driver-hours'] });
      toast.success(`Matched ${res.data.matched}/${res.data.total} drivers`);
      setHoursFile(null);
    },
    onError: err => toast.error(err.response?.data?.error || 'Upload failed'),
  });

  const publishWeek = useMutation({
    mutationFn: () => api.post('/shifts/publish-week', { week_start: weekStartStr }),
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['week-status'] });
      qc.invalidateQueries({ queryKey: ['change-log'] });
      toast.success(`Published ${res.data.published} shifts — drivers can now see Week ${amazonWeek}`);
      setPublishModal(false);
    },
    onError: () => toast.error('Failed to publish schedule'),
  });

  const publishSelected = useMutation({
    mutationFn: (logIds) => {
      const shiftIds = [...new Set(
        changeLog.filter(c => logIds.has(c.id)).map(c => c.shift_id).filter(Boolean)
      )];
      return api.post('/shifts/publish-selected', { shift_ids: shiftIds }).then(r => r.data);
    },
    onSuccess: data => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['week-status'] });
      qc.invalidateQueries({ queryKey: ['change-log'] });
      toast.success(`${data.published} shift${data.published !== 1 ? 's' : ''} published successfully`);
      setPublishModal(false);
    },
    onError: () => toast.error('Failed to publish'),
  });

  const unpublishWeek = useMutation({
    mutationFn: () => api.post('/shifts/unpublish-week', { week_start: weekStartStr }),
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['week-status'] });
      toast.success(`Week ${amazonWeek} pulled back to draft`);
    },
    onError: () => toast.error('Failed to unpublish'),
  });

  // ── Multi-select: bulk mutations ──────────────────────────────────────────
  const bulkApply = useMutation({
    mutationFn: data => api.post('/shifts/bulk-apply', data).then(r => r.data),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['change-log'] });
      qc.invalidateQueries({ queryKey: ['week-status'] });
      toast.success(`Applied ${vars.shift_type} to ${data.created + data.updated} cell${data.created + data.updated !== 1 ? 's' : ''}`);
      setSelectedCells(new Set()); setSelectionAnchor(null); setBulkShiftType('');
    },
    onError: (err) => toast.error(`Bulk apply failed: ${err?.response?.data?.error || err?.message || 'Unknown'}`),
  });

  const bulkDelete = useMutation({
    mutationFn: ids => api.post('/shifts/bulk-delete', { shift_ids: ids }).then(r => r.data),
    onSuccess: data => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['change-log'] });
      qc.invalidateQueries({ queryKey: ['week-status'] });
      toast.success(`Deleted ${data.deleted} shift${data.deleted !== 1 ? 's' : ''}`);
      setBulkDeleteConfirm(false);
      setSelectedCells(new Set()); setSelectionAnchor(null);
    },
    onError: () => toast.error('Bulk delete failed'),
  });

  const handleBulkApply = useCallback(() => {
    console.log('[bulkApply] called, bulkShiftType=', bulkShiftType, 'selectedCells.size=', selectedCells.size);
    if (!bulkShiftType || selectedCells.size === 0) return;
    const defaults = getShiftTypeDefaults(bulkShiftType);
    const cells = [...selectedCells].map(key => {
      const { staffId, dateStr } = parseCellKey(key);
      const shift = shiftMap[`${staffId}-${dateStr}`]?.[0];
      return { staff_id: staffId, shift_date: dateStr, shift_id: shift?.id || null };
    });
    bulkApply.mutate({ cells, shift_type: bulkShiftType, ...defaults });
  }, [bulkShiftType, selectedCells, shiftMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const executeBulkDelete = useCallback(async () => {
    const ids = [...selectedCells]
      .map(key => { const { staffId, dateStr } = parseCellKey(key); return shiftMap[`${staffId}-${dateStr}`]?.[0]?.id; })
      .filter(Boolean);
    if (ids.length === 0) { setSelectedCells(new Set()); setBulkDeleteConfirm(false); return; }

    if (removeRecurringChecked) {
      const seen = new Set();
      const uniquePairs = [...selectedCells]
        .map(key => {
          const { staffId, dateStr } = parseCellKey(key);
          if (!shiftMap[`${staffId}-${dateStr}`]?.[0]) return null;
          const dow = new Date(dateStr + 'T00:00:00').getDay();
          if (!recurringSet.has(`${staffId}|${dow}`)) return null;
          const k = `${staffId}|${dow}`;
          if (seen.has(k)) return null;
          seen.add(k);
          return { staffId, dow };
        })
        .filter(Boolean);
      await Promise.all(uniquePairs.map(({ staffId, dow }) =>
        api.delete(`/schedule/day-recurring/${dow}/drivers/${staffId}`).catch(() => {})
      ));
      qc.invalidateQueries(['day-recurring']);
    }

    bulkDelete.mutate(ids);
  }, [selectedCells, shiftMap, removeRecurringChecked, recurringSet]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBulkDeleteRequest = useCallback(() => {
    setRemoveRecurringChecked(false);
    setBulkDeleteConfirm(true);
  }, []);

  // ── Multi-select: global mouseup + keydown ────────────────────────────────
  useEffect(() => {
    const onMouseUp = () => {
      const wasActive = dragRef.current.active;
      dragRef.current = { active: false, startStaffId: null, startDateStr: null };
      setSelectionInProgress(false);
      if (wasActive) {
        justDraggedRef.current = true;
        setTimeout(() => { justDraggedRef.current = false; }, 150);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { setSelectedCells(new Set()); setSelectionAnchor(null); setSelectionInProgress(false); }
      // Arrow key navigation — skip when an input/select is focused
      const tag = document.activeElement?.tagName;
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (!isEditing) {
        const view = activeViewRef.current;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          if (view === 'daily' || view === 'ops') { setDailyDate(d => addDays(d, -1)); }
          else { setWeekStart(d => subWeeks(d, 1)); }
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          if (view === 'daily' || view === 'ops') { setDailyDate(d => addDays(d, 1)); }
          else {
            setWeekStart(d => {
              const visibilityDays = parseInt(appSettings.schedule_visibility_days || 14);
              const maxDateForDriver = new Date();
              maxDateForDriver.setDate(maxDateForDriver.getDate() + visibilityDays);
              const next = addWeeks(d, 1);
              return (isManager || next <= maxDateForDriver) ? next : d;
            });
          }
        }
      }
    };
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mouseup', onMouseUp); document.removeEventListener('keydown', onKeyDown); };
  }, []);

  // ── Keep activeViewRef current so keydown closure has fresh value ─────────
  useEffect(() => { activeViewRef.current = activeView; }, [activeView]);

  // ── Close calendar when clicking outside ─────────────────────────────────
  useEffect(() => {
    if (!calendarOpen) return;
    const handleOutside = (e) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target)) setCalendarOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [calendarOpen]);

  // ── Multi-select: auto-scroll when dragging near top/bottom ──────────────
  const autoScrollRef = useRef({ dir: 0, speed: 0 });
  useEffect(() => {
    let rafId;
    const handleMouseMove = (e) => {
      const container = tableContainerRef.current;
      if (!container || !dragRef.current.active) { autoScrollRef.current = { dir: 0, speed: 0 }; return; }
      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const ZONE = 80;
      if (y >= 0 && y < ZONE) {
        autoScrollRef.current = { dir: -1, speed: Math.max(1, Math.ceil((1 - y / ZONE) * 6)) };
      } else if (y > rect.height - ZONE && y <= rect.height) {
        autoScrollRef.current = { dir: 1, speed: Math.max(1, Math.ceil((1 - (rect.height - y) / ZONE) * 6)) };
      } else {
        autoScrollRef.current = { dir: 0, speed: 0 };
      }
    };
    const tick = () => {
      const { dir, speed } = autoScrollRef.current;
      const container = tableContainerRef.current;
      if (dir !== 0 && speed > 0 && dragRef.current.active && container) {
        container.scrollTop += dir * speed;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    document.addEventListener('mousemove', handleMouseMove);
    return () => { document.removeEventListener('mousemove', handleMouseMove); cancelAnimationFrame(rafId); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Initialize selectedLogIds when publish modal opens ────────────────────
  useEffect(() => {
    if (publishModal && changeLog.length > 0) {
      setSelectedLogIds(new Set(changeLog.map(c => c.id)));
    }
  }, [publishModal, changeLog.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close chip dropdown + day filter on outside click ─────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (chipContainerRef.current && !chipContainerRef.current.contains(e.target)) {
        setChipDropOpen(false);
      }
      // Close day filter dropdown if click is outside any th
      setDayFilterDropOpen(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Auto-apply recurring for current/future weeks (silent) ────────────────
  useEffect(() => {
    if (!weekStart || !isManager) return;
    const todayWeekStart = format(startOfWeek(new Date(), { weekStartsOn: 0 }), 'yyyy-MM-dd');
    if (weekStartStr < todayWeekStart) return; // skip past weeks
    api.post('/schedule/day-recurring/apply', { week_start: weekStartStr })
      .then(r => { if (r.data?.created > 0) qc.invalidateQueries({ queryKey: ['shifts'] }); })
      .catch(() => {}); // silent
  }, [weekStartStr, isManager]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rotating driver prompt — show on current/future week when rotating drivers exist ─
  useEffect(() => {
    if (!isManager || !weekStart) return;
    const todayWeekStart = format(startOfWeek(new Date(), { weekStartsOn: 0 }), 'yyyy-MM-dd');
    if (weekStartStr < todayWeekStart) return; // skip past weeks
    const rotatingDrivers = rotatingOverview.filter(d => d.is_rotating && d.recurring_rows.length >= 2);
    if (rotatingDrivers.length === 0) return;
    const storageKey = `rotating_prompt_${weekStartStr}`;
    if (sessionStorage.getItem(storageKey) === 'dismissed') return;
    // Initialize assignments with first row for each driver
    const initial = {};
    rotatingDrivers.forEach(d => { initial[d.staff_id] = d.recurring_rows[0]?.id; });
    setRotatingAssignments(initial);
    setRotatingPromptOpen(true);
  }, [weekStartStr, rotatingOverview.length, isManager]); // eslint-disable-line react-hooks/exhaustive-deps

  const rotatingApply = useMutation({
    mutationFn: ({ week_start, assignments }) =>
      api.post('/schedule/rotating-apply', { week_start, assignments }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      toast.success(`Applied ${res.data.created} shift${res.data.created !== 1 ? 's' : ''} for rotating drivers`);
      sessionStorage.setItem(`rotating_prompt_${weekStartStr}`, 'dismissed');
      setRotatingPromptOpen(false);
    },
    onError: () => toast.error('Failed to apply rotating schedules'),
  });

  // ── Shift type helper ─────────────────────────────────────────────────────
  const getShiftTypeDefaults = (typeName) => {
    const t = shiftTypes.find(t => t.name === typeName);
    return { start_time: t?.default_start_time?.slice(0,5) || '07:00', end_time: t?.default_end_time?.slice(0,5) || '17:00' };
  };

  const handleShiftTypeChange = (type) => {
    const defaults = getShiftTypeDefaults(type);
    setShiftForm(f => ({ ...f, shift_type: type, ...defaults }));
  };

  // ── Export to Excel ───────────────────────────────────────────────────────
  const exportToExcel = () => {
    const rows = [
      ['Driver', 'ID', ...DAYS.map((d, i) => format(addDays(weekStart, i), 'EEE M/d')), 'Total Hrs'],
    ];
    filteredStaff.forEach(s => {
      const cells = weekDays.map(d => {
        const key = `${s.id}-${format(d, 'yyyy-MM-dd')}`;
        const sh = shiftMap[key]?.[0];
        if (!sh) return '';
        return `${sh.shift_type} ${sh.start_time?.slice(0,5)}-${sh.end_time?.slice(0,5)}${sh.attendance_status && sh.attendance_status !== 'present' ? ` (${sh.attendance_status})` : ''}`;
      });
      rows.push([`${s.first_name} ${s.last_name}`, s.employee_id, ...cells, hoursMap[s.id] || '']);
    });
    rows.push([]);
    rows.push(['Summary', '', ...weekDays.map(() => ''), '']);
    rows.push(['EDV', summary['EDV'], ...weekDays.map(() => ''), '']);
    rows.push(['STEP VAN', summary['STEP VAN'], ...weekDays.map(() => ''), '']);
    rows.push(['EXTRA', summary['EXTRA'], ...weekDays.map(() => ''), '']);
    if (routeCommitment) rows.push(['Route Commitment', routeCommitment.total_routes, ...weekDays.map(() => ''), '']);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 24 }, { wch: 14 }, ...Array(7).fill({ wch: 22 }), { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, `Week ${amazonWeek}`);
    XLSX.writeFile(wb, `Schedule_Week${amazonWeek}_${weekStartStr}.xlsx`);
    toast.success('Schedule exported!');
  };

  // ── Open edit-shift modal ─────────────────────────────────────────────────
  const openEditShift = (shift) => {
    setEditForm({
      shift_type: shift.shift_type,
      start_time: shift.start_time?.slice(0, 5) || '07:00',
      end_time:   shift.end_time?.slice(0, 5)   || '17:00',
      notes:      shift.notes || '',
    });
    setEditShiftModal({ shift });
  };

  // ── Open add-shift modal ──────────────────────────────────────────────────
  const openAddShift = (staffId, dateStr) => {
    const defaults = getShiftTypeDefaults('EDV');
    setShiftForm({ shift_type: 'EDV', ...defaults, notes: '' });
    setAddShiftModal({ staff_id: staffId, date: dateStr });
  };

  // ─────────────────────────────────────────────────────────────────────────
  const canGoForward = (() => {
    const visibilityDays = parseInt(appSettings.schedule_visibility_days || 14);
    const maxDateForDriver = new Date();
    maxDateForDriver.setDate(maxDateForDriver.getDate() + visibilityDays);
    return isManager || addWeeks(weekStart, 1) <= maxDateForDriver;
  })();

  return (
    <div className="flex flex-col h-full relative">

      {/* ── Single-row header ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4 min-w-0">

        {/* Left: view toggle */}
        <div className="flex bg-white border border-card-border rounded-lg p-0.5 shadow-sm flex-shrink-0">
          {[['weekly','Weekly'],['daily','Daily'],['ops','Ops Planner']].map(([v,l]) => (
            <button key={v} onClick={() => setActiveView(v)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeView === v ? 'bg-primary text-white shadow-sm' : 'text-content-muted hover:text-content'}`}>
              {l}
            </button>
          ))}
        </div>

        {/* Center: date nav — fills all remaining space */}
        <div className="flex-1 flex items-center justify-center gap-1 min-w-0">

          {/* ── Weekly navigator ── */}
          {activeView === 'weekly' && (
            <>
              <button
                onClick={() => setWeekStart(d => subWeeks(d, 1))}
                className="p-2 rounded-lg text-[#374151] hover:text-[#2563EB] transition-colors flex-shrink-0"
                aria-label="Previous week"
              >
                <ChevronLeft size={22} strokeWidth={2.5} />
              </button>
              <div className="text-center px-2 min-w-0">
                <p className="font-semibold text-content text-sm leading-tight whitespace-nowrap">
                  {format(weekStart, 'MMMM d')} – {format(weekEnd, 'MMMM d, yyyy')}
                </p>
                <p className="text-xs text-content-muted leading-tight">Week {amazonWeek}</p>
              </div>
              <button
                onClick={() => canGoForward && setWeekStart(d => addWeeks(d, 1))}
                disabled={!canGoForward}
                className={`p-2 rounded-lg transition-colors flex-shrink-0 ${canGoForward ? 'text-[#374151] hover:text-[#2563EB]' : 'text-slate-300 cursor-not-allowed'}`}
                aria-label="Next week"
              >
                <ChevronRight size={22} strokeWidth={2.5} />
              </button>
            </>
          )}

          {/* ── Daily / Ops Planner navigator ── */}
          {(activeView === 'daily' || activeView === 'ops') && (
            <>
              <button
                onClick={() => setDailyDate(d => addDays(d, -1))}
                className="p-2 rounded-lg text-[#374151] hover:text-[#2563EB] transition-colors flex-shrink-0"
                aria-label="Previous day"
              >
                <ChevronLeft size={22} strokeWidth={2.5} />
              </button>

              {/* Date button — opens calendar dropdown */}
              <div className="relative" ref={calendarRef}>
                <button
                  onClick={() => { setCalendarViewMonth(startOfMonth(dailyDate)); setCalendarOpen(o => !o); }}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg hover:bg-slate-100 transition-colors group"
                >
                  <div className="text-center">
                    <p className="font-semibold text-content text-sm leading-tight whitespace-nowrap">
                      {format(dailyDate, 'EEEE, MMMM d, yyyy')}
                    </p>
                  </div>
                  <ChevronDown size={13} className={`text-slate-400 group-hover:text-slate-600 transition-transform ${calendarOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Calendar popup */}
                {calendarOpen && (() => {
                  const monthStart = startOfMonth(calendarViewMonth);
                  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
                  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
                  const weeks = Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7));
                  return (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-white rounded-xl shadow-xl border border-slate-200 p-4 z-50 w-72 select-none">
                      {/* Month header */}
                      <div className="flex items-center justify-between mb-3">
                        <button
                          onClick={() => setCalendarViewMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
                        >
                          <ChevronLeft size={15} strokeWidth={2.5} />
                        </button>
                        <span className="text-sm font-semibold text-slate-800">
                          {format(calendarViewMonth, 'MMMM yyyy')}
                        </span>
                        <button
                          onClick={() => setCalendarViewMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
                        >
                          <ChevronRight size={15} strokeWidth={2.5} />
                        </button>
                      </div>
                      {/* Day-of-week headers */}
                      <div className="grid grid-cols-7 mb-1">
                        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                          <span key={d} className="text-center text-[11px] font-semibold text-slate-400 py-1">{d}</span>
                        ))}
                      </div>
                      {/* Day grid */}
                      {weeks.map((week, wi) => (
                        <div key={wi} className="grid grid-cols-7">
                          {week.map((day, di) => {
                            const sel = isSameDay(day, dailyDate);
                            const inMonth = isSameMonth(day, calendarViewMonth);
                            const tod = isToday(day);
                            return (
                              <button
                                key={di}
                                onClick={() => { setDailyDate(day); setCalendarOpen(false); }}
                                className={`relative flex flex-col items-center justify-center h-8 w-full rounded-lg text-xs font-medium transition-colors ${
                                  sel
                                    ? 'bg-blue-600 text-white'
                                    : inMonth
                                      ? 'text-slate-700 hover:bg-slate-100'
                                      : 'text-slate-300 hover:bg-slate-50'
                                }`}
                              >
                                {format(day, 'd')}
                                {tod && !sel && (
                                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-500" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <button
                onClick={() => setDailyDate(d => addDays(d, 1))}
                className="p-2 rounded-lg text-[#374151] hover:text-[#2563EB] transition-colors flex-shrink-0"
                aria-label="Next day"
              >
                <ChevronRight size={22} strokeWidth={2.5} />
              </button>
            </>
          )}

        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {(activeView === 'weekly' || activeView === 'daily') && isManager && (
            <>
              {weekStatus.draft > 0 && (
                <button
                  onClick={() => setPublishModal(true)}
                  className="text-xs text-amber-600 hover:text-amber-700 font-medium hover:underline underline-offset-2 transition-colors"
                >
                  {weekStatus.draft} unpublished
                </button>
              )}
              {weekStatus.status === 'published' ? (
                <button onClick={() => unpublishWeek.mutate()} disabled={unpublishWeek.isPending}
                  className="btn-secondary flex items-center gap-1.5 text-amber-600 border-amber-300 hover:bg-amber-50">
                  <EyeOff size={14} /> {unpublishWeek.isPending ? 'Pulling back…' : 'Unpublish'}
                </button>
              ) : (
                <button onClick={() => setPublishModal(true)}
                  className="btn-primary flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 border-emerald-600">
                  <Send size={14} /> Publish Schedule
                </button>
              )}
            </>
          )}
          {activeView === 'weekly' && (
            <>
              {isManager && (
                <>
                  <button onClick={() => setSettingsModal(true)} className="btn-secondary"><Settings size={14} /></button>
                  <button onClick={() => setHoursUploadModal(true)} className="btn-secondary flex items-center gap-1.5">
                    <Clock size={14} /> Hours
                  </button>
                </>
              )}
              <button onClick={exportToExcel} className="btn-secondary">
                <Download size={14} /> Export
              </button>
            </>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SCHEDULE (WEEKLY / DAILY)
      ═══════════════════════════════════════════════════════════════════ */}
      {(activeView === 'weekly' || activeView === 'daily') && (
        <div className="flex gap-2 flex-1 min-h-0 -ml-6">

          {/* ── Left filter panel — flush to left edge ──────────────── */}
          <div className="w-52 flex-shrink-0 flex flex-col gap-2">

            {/* Driver chip search */}
            <div
              ref={chipContainerRef}
              className="relative bg-white border border-card-border rounded-r-xl shadow-sm cursor-text"
              onClick={() => chipInputRef.current?.focus()}
            >
              {/* Search input */}
              <div className="px-2 pt-2 pb-1">
                <input
                  ref={chipInputRef}
                  className="w-full text-xs bg-transparent outline-none placeholder-content-subtle text-content"
                  placeholder="Search drivers…"
                  value={chipInput}
                  onChange={e => { setChipInput(e.target.value); setChipDropOpen(true); }}
                  onFocus={() => { if (chipInput) setChipDropOpen(true); }}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { setChipDropOpen(false); setChipInput(''); }
                    if (e.key === 'Backspace' && !chipInput && driverChips.length > 0)
                      setDriverChips(prev => prev.slice(0, -1));
                  }}
                />
              </div>

              {/* Selected driver chips — stacked vertically, full width */}
              {driverChips.length > 0 && (
                <div className="px-2 pb-2 flex flex-col gap-1 border-t border-slate-100 pt-1.5">
                  {driverChips.map(c => (
                    <span key={c.id} className="flex items-center justify-between bg-[#2563EB] text-white text-[11px] font-medium px-2 py-1 rounded-lg w-full">
                      <span className="break-words leading-tight mr-1">{c.name}</span>
                      <button
                        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setDriverChips(prev => prev.filter(x => x.id !== c.id)); }}
                        className="hover:opacity-70 transition-opacity leading-none flex-shrink-0"
                      ><X size={10} /></button>
                    </span>
                  ))}
                  {/* Clear All */}
                  <button
                    onMouseDown={e => { e.preventDefault(); setDriverChips([]); setChipInput(''); }}
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors mt-0.5 self-start"
                  >
                    <X size={9} /> Clear all
                  </button>
                </div>
              )}

              {/* Autocomplete dropdown */}
              {chipDropOpen && chipSuggestions.length > 0 && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-card-border rounded-xl shadow-lg w-full max-h-48 overflow-y-auto">
                  {chipSuggestions.map(s => (
                    <button
                      key={s.id}
                      onMouseDown={e => {
                        e.preventDefault();
                        setDriverChips(prev => [...prev, { id: s.id, name: `${s.first_name} ${s.last_name}` }]);
                        setChipInput('');
                        chipInputRef.current?.focus();
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 text-content transition-colors"
                    >
                      {s.first_name} {s.last_name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Filters */}
            <div className="bg-white border border-card-border rounded-r-xl px-3 py-2.5 shadow-sm space-y-3">

              {/* Shift type multi-select checkboxes */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Shift Type</span>
                  {filterShiftTypes.length > 0 && (
                    <button
                      onClick={() => setFilterShiftTypes([])}
                      className="text-[10px] text-blue-500 hover:text-blue-700 font-medium transition-colors"
                    >Clear</button>
                  )}
                </div>
                <div className="space-y-0.5">
                  {shiftTypes.map(t => (
                    <label key={t.id} className="flex items-center gap-1.5 cursor-pointer py-0.5 group">
                      <input
                        type="checkbox"
                        checked={filterShiftTypes.includes(t.name)}
                        onChange={e => setFilterShiftTypes(prev =>
                          e.target.checked ? [...prev, t.name] : prev.filter(n => n !== t.name)
                        )}
                        className="w-3 h-3 rounded accent-primary flex-shrink-0"
                      />
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: t.color || '#3B82F6' }} />
                      <span className="text-xs text-content group-hover:text-primary transition-colors leading-tight">{t.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Show unscheduled toggle */}
              <label className="flex items-center gap-1.5 cursor-pointer border-t border-slate-100 pt-2">
                <input type="checkbox" checked={showUnscheduled} onChange={e => setShowUnscheduled(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-primary" />
                <span className="text-xs text-content">Show Unscheduled</span>
              </label>
            </div>

            {/* Driver count */}
            <div className="bg-white border border-card-border rounded-r-xl px-3 py-2 shadow-sm text-center">
              <p className="text-xl font-bold text-primary">{filteredStaff.length}</p>
              <p className="text-[10px] text-content-muted">drivers</p>
            </div>
          </div>

          {/* ── Schedule Grid ───────────────────────────────────────────── */}
          <div ref={tableContainerRef} className="flex-1 min-w-0 overflow-auto bg-white border border-card-border rounded-xl shadow-sm pb-12">
            {activeView === 'weekly' ? (
              <table className="w-full text-sm min-w-[780px]">
                <thead className="sticky top-0 bg-white z-10 shadow-sm">
                  <tr className="border-b border-[#CBD5E1]">
                    <th className="text-left px-4 py-3 text-content-muted font-semibold w-44 text-xs uppercase tracking-wide">
                      <div className="flex items-center gap-1">
                        Driver
                        <button onClick={cycleDriverSort} className="text-[10px] text-slate-400 hover:text-primary transition-colors px-1 py-0.5 rounded">
                          {driverSort === 'last-asc' ? '↑Z' : driverSort === 'last-desc' ? '↓Z' : driverSort === 'first-asc' ? '↑A' : '↓A'}
                        </button>
                      </div>
                    </th>
                    <th className="text-left px-3 py-3 text-content-muted font-semibold w-16 text-xs uppercase tracking-wide">Hrs</th>
                    {weekDays.map((d, i) => {
                      const today = isToday(d);
                      const ds = format(d, 'yyyy-MM-dd');
                      const isFiltered = dayColFilter?.dateStr === ds && dayColFilter?.mode !== 'all';
                      return (
                        <th
                          key={i}
                          ref={el => { dayColRefs.current[i] = el; }}
                          className={`text-center px-2 py-3 font-medium w-24 ${today ? 'bg-primary-50' : ''}`}
                        >
                          <div className="flex items-center justify-center gap-0.5">
                            <p className={`text-xs font-semibold ${today ? 'text-primary' : 'text-content-muted'}`}>
                              {DAYS[i]} {format(d, 'd')}
                            </p>
                            {/* Per-day column filter */}
                            <div className="relative">
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  setDayFilterDropOpen(prev => prev === ds ? null : ds);
                                }}
                                className={`p-0.5 rounded transition-colors ${isFiltered ? 'text-[#2563EB]' : 'text-slate-300 hover:text-slate-500'}`}
                                title="Sort this column"
                              >
                                <ChevronDown size={10} />
                              </button>
                              {dayFilterDropOpen === ds && (
                                <div
                                  className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 w-44 py-1 text-left"
                                  onMouseDown={e => e.stopPropagation()}
                                >
                                  {[
                                    { label: 'All (default)', mode: 'all' },
                                    { label: 'By Route Code', mode: 'route' },
                                    { label: 'By Shift Type', mode: 'shift_type' },
                                    { label: 'By Start Time', mode: 'start_time' },
                                  ].map(opt => {
                                    const active = opt.mode === 'all'
                                      ? !isFiltered
                                      : dayColFilter?.dateStr === ds && dayColFilter?.mode === opt.mode;
                                    return (
                                      <button
                                        key={opt.mode}
                                        className={`w-full text-left px-3 py-2 text-xs transition-colors ${active ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
                                        onClick={() => {
                                          setDayColFilter(opt.mode === 'all' ? null : { dateStr: ds, mode: opt.mode });
                                          setDayFilterDropOpen(null);
                                        }}
                                      >
                                        {opt.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {shiftsLoading ? (
                    <tr><td colSpan={9} className="text-center py-16 text-content-muted">Loading schedule…</td></tr>
                  ) : sortedStaff.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-16 text-content-muted">No drivers match your filter</td></tr>
                  ) : sortedStaff.map((s, idx) => (
                    <tr key={s.id} className={`border-b border-[#CBD5E1] ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-blue-50/30 transition-colors`}>
                      <td className="px-4 py-2">
                        <p className="font-semibold text-content text-sm flex items-center gap-1.5">
                          {s.first_name} {s.last_name}
                          {s.is_rotating && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0" title="Rotating Driver">
                              <RefreshCw size={8} />ROT
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-content-subtle">{s.employee_id}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs font-semibold text-content-muted">{hoursMap[s.id] ? `${hoursMap[s.id]}h` : '—'}</span>
                      </td>
                      {weekDays.map((d, di) => {
                        const dateStr = format(d, 'yyyy-MM-dd');
                        const key = `${s.id}-${dateStr}`;
                        const shift = shiftMap[key]?.[0];
                        const ck = cellKey(s.id, dateStr);
                        const isSel = selectedCells.has(ck);
                        return (
                          <td
                            key={di}
                            className={`px-1.5 py-1.5 select-none ${isToday(d) ? 'bg-primary-50/50' : ''}`}
                            style={isSel ? { boxShadow: 'inset 0 0 0 2px #2563EB', background: 'rgba(37,99,235,0.07)' } : {}}
                            onMouseDown={isManager ? (e) => {
                              if (e.button !== 0) return;
                              e.preventDefault(); // prevent text-select, browser drag, and click event
                              setSelectionInProgress(true);
                              if (e.shiftKey && selectionAnchor) {
                                setSelectedCells(getCellsInRect(selectionAnchor, { staffId: s.id, dateStr }, sortedStaff, weekDays));
                                return;
                              }
                              dragRef.current = { active: false, startStaffId: s.id, startDateStr: dateStr };
                            } : undefined}
                            onMouseEnter={isManager ? (e) => {
                              const d = dragRef.current;
                              if (!d.startStaffId) return;
                              if (!(e.buttons & 1)) return; // left button must be held
                              if (s.id === d.startStaffId && dateStr === d.startDateStr) return;
                              if (!d.active) d.active = true;
                              setSelectionAnchor({ staffId: d.startStaffId, dateStr: d.startDateStr });
                              setSelectedCells(getCellsInRect(
                                { staffId: d.startStaffId, dateStr: d.startDateStr },
                                { staffId: s.id, dateStr },
                                sortedStaff, weekDays
                              ));
                            } : undefined}
                            onMouseUp={isManager ? () => {
                              const d = dragRef.current;
                              if (d.startStaffId && !d.active) {
                                // Pure single click — open popup directly
                                setSelectedCells(new Set());
                                setSelectionAnchor(null);
                                if (shift) openEditShift(shift);
                                else openAddShift(s.id, dateStr);
                              }
                            } : undefined}
                          >
                            <ShiftCell shift={shift} isManager={isManager} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              // ── Daily view ──────────────────────────────────────────────
              <div className="p-4">
                <div className="flex items-center justify-end gap-2 mb-3">
                  <label className="text-xs font-medium text-content-muted whitespace-nowrap">Organize by</label>
                  <select className="select text-sm py-1 w-36" value={organizeBy} onChange={e => setOrganizeBy(e.target.value)}>
                    <option value="name">Driver Name</option>
                    <option value="route">Route Code</option>
                    <option value="shift_type">Shift Type</option>
                    <option value="start_time">Start Time</option>
                  </select>
                </div>
                {organizeBy === 'route' && !opsPlanSession?.rows?.length && (
                  <p className="text-xs text-amber-600 mb-2">No Ops Planner session found for this date — upload routes in Ops Planner first.</p>
                )}
                <div className="space-y-2">
                  {dailySortedStaff.map(s => {
                    const dateStr = format(dailyDate, 'yyyy-MM-dd');
                    const key = `${s.id}-${dateStr}`;
                    const shift = shiftMap[key]?.[0];
                    const routeCode = routeCodeMap[s.id];
                    return (
                      <div key={s.id} className="flex items-center gap-3 p-3 bg-white border border-card-border rounded-xl hover:border-primary/30 transition-colors">
                        <div className="w-36 flex-shrink-0">
                          <p className="font-semibold text-sm text-content">{s.first_name} {s.last_name}</p>
                          <p className="text-xs text-content-subtle">{s.employee_id}</p>
                          {organizeBy === 'route' && routeCode && (
                            <p className="text-xs font-mono font-semibold text-primary">{routeCode}</p>
                          )}
                          {organizeBy === 'route' && !routeCode && (
                            <p className="text-[10px] text-slate-400 italic">No Route</p>
                          )}
                        </div>
                        <div className="flex-1">
                          <ShiftCell
                            shift={shift}
                            isManager={isManager}
                            date={dateStr}
                            onAdd={() => openAddShift(s.id, dateStr)}
                            onEdit={openEditShift}
                            onDelete={id => deleteShift.mutate(id)}
                            onMarkAttendance={(shift, status) => markAttendance.mutate({ shiftId: shift.id, status })}
                          />
                        </div>
                        <div className="text-xs text-content-subtle w-12 text-right">
                          {hoursMap[s.id] ? `${hoursMap[s.id]}h` : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          OPS PLANNER (always mounted — display:none preserves state)
          Shares dailyDate with Daily view
      ═══════════════════════════════════════════════════════════════════ */}
      <div style={{ display: activeView === 'ops' ? '' : 'none' }} className="-mx-1">
        <OperationalPlanner
          embedded
          drivers={staff}
          planDate={format(dailyDate, 'yyyy-MM-dd')}
          onDateChange={dateStr => setDailyDate(parseISO(dateStr))}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          HOURS UPLOAD MODAL
      ═══════════════════════════════════════════════════════════════════ */}
      <Modal isOpen={hoursUploadModal} onClose={() => setHoursUploadModal(false)} title={`Upload Hours — Week ${amazonWeek}`}>
        <div className="space-y-4">
          <p className="text-sm text-content-muted">
            Upload a CSV or Excel file with columns: <strong>Transponder ID</strong> (or Badge ID) and <strong>Hours</strong>. Drivers are matched by Transponder ID.
          </p>
          <div className="space-y-3">
            <label className="block w-full border-2 border-dashed border-card-border rounded-xl p-6 text-center cursor-pointer hover:border-primary hover:bg-primary-50/30 transition-all">
              {hoursFile ? (
                <div>
                  <Check size={20} className="text-primary mx-auto mb-1" />
                  <p className="text-sm font-medium text-content">{hoursFile.name}</p>
                  <p className="text-xs text-content-muted">{(hoursFile.size/1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <Upload size={20} className="text-content-subtle mx-auto mb-1" />
                  <p className="text-sm text-content-muted">Click to select CSV or Excel file</p>
                </div>
              )}
              <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => setHoursFile(e.target.files?.[0] || null)} />
            </label>
            <button className="btn-primary w-full" disabled={!hoursFile || uploadHours.isPending} onClick={() => uploadHours.mutate()}>
              {uploadHours.isPending ? 'Uploading…' : 'Upload & Match Hours'}
            </button>
          </div>

          {/* Hours table */}
          {driverHours.length > 0 && (
            <div className="border border-card-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-slate-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-content-muted uppercase tracking-wide">Driver</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-content-muted uppercase tracking-wide">Transponder</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-content-muted uppercase tracking-wide">Hours</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-content-muted uppercase tracking-wide">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {driverHours.map(h => (
                    <tr key={h.id} className="table-row">
                      <td className="px-4 py-2 font-medium text-content">{h.first_name} {h.last_name}</td>
                      <td className="px-4 py-2 text-content-muted font-mono text-xs">{h.transponder_id || h.driver_transponder || '—'}</td>
                      <td className="px-4 py-2 text-right font-bold text-content">{h.hours_worked}h</td>
                      <td className="px-4 py-2 text-right">
                        <span className={`badge ${h.source === 'upload' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{h.source}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════
          ADD SHIFT MODAL
      ═══════════════════════════════════════════════════════════════════ */}
      <Modal isOpen={!!addShiftModal} onClose={() => setAddShiftModal(null)} title="Add Shift">
        {addShiftModal && (
          <form className="space-y-4" onSubmit={e => {
            e.preventDefault();
            createShift.mutate({ staff_id: addShiftModal.staff_id, shift_date: addShiftModal.date, ...shiftForm });
          }}>
            <div className="text-[#111827] text-[15px] font-medium bg-slate-50 rounded-lg p-3">
              {format(parseISO(addShiftModal.date), 'EEEE, MMMM d')}
            </div>
            <div>
              <label className="modal-label">Shift Type</label>
              <div className="grid grid-cols-3 gap-2">
                {shiftTypes.map(t => (
                  <button key={t.id} type="button"
                    onClick={() => handleShiftTypeChange(t.name)}
                    className={`py-2 px-1 rounded-lg border-2 text-xs font-semibold transition-all ${
                      shiftForm.shift_type === t.name
                        ? `${SHIFT_COLORS_SELECTED[t.name] || 'bg-blue-600 text-white border-blue-600'} scale-105 shadow-sm`
                        : 'bg-white border-[#D1D5DB] text-[#374151] hover:border-slate-400'
                    }`}
                  >{t.name}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="modal-label">Start Time</label>
                <input type="time" className="input" value={shiftForm.start_time} onChange={e => setShiftForm(f => ({ ...f, start_time: e.target.value }))} required />
              </div>
              <div>
                <label className="modal-label">End Time</label>
                <input type="time" className="input" value={shiftForm.end_time} onChange={e => setShiftForm(f => ({ ...f, end_time: e.target.value }))} required />
              </div>
            </div>
            <div>
              <label className="modal-label">Notes (optional)</label>
              <input type="text" className="input bg-[#F9FAFB]" value={shiftForm.notes} onChange={e => setShiftForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional note" />
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" className="btn-secondary flex-1" onClick={() => setAddShiftModal(null)}>Cancel</button>
              <button type="submit" className="btn-primary flex-1" disabled={createShift.isPending}>
                {createShift.isPending ? 'Saving…' : 'Add Shift'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════
          EDIT SHIFT MODAL
      ═══════════════════════════════════════════════════════════════════ */}
      <Modal isOpen={!!editShiftModal} onClose={() => setEditShiftModal(null)} title="Edit Shift">
        {editShiftModal && (
          <form className="space-y-4" onSubmit={e => {
            e.preventDefault();
            updateShift.mutate({ id: editShiftModal.shift.id, ...editForm });
          }}>
            <div className="text-[#111827] text-[15px] font-medium bg-slate-50 rounded-lg p-3">
              {editShiftModal.shift.shift_date
                ? format(parseISO(editShiftModal.shift.shift_date.split('T')[0]), 'EEEE, MMMM d')
                : ''}
            </div>
            <div>
              <label className="modal-label">Shift Type</label>
              <div className="grid grid-cols-3 gap-2">
                {shiftTypes.map(t => (
                  <button key={t.id} type="button"
                    onClick={() => {
                      const defaults = getShiftTypeDefaults(t.name);
                      setEditForm(f => ({ ...f, shift_type: t.name, ...defaults }));
                    }}
                    className={`py-2 px-1 rounded-lg border-2 text-xs font-semibold transition-all ${
                      editForm.shift_type === t.name
                        ? `${SHIFT_COLORS_SELECTED[t.name] || 'bg-blue-600 text-white border-blue-600'} scale-105 shadow-sm`
                        : 'bg-white border-[#D1D5DB] text-[#374151] hover:border-slate-400'
                    }`}
                  >{t.name}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="modal-label">Start Time</label>
                <input type="time" className="input" value={editForm.start_time} onChange={e => setEditForm(f => ({ ...f, start_time: e.target.value }))} required />
              </div>
              <div>
                <label className="modal-label">End Time</label>
                <input type="time" className="input" value={editForm.end_time} onChange={e => setEditForm(f => ({ ...f, end_time: e.target.value }))} required />
              </div>
            </div>
            <div>
              <label className="modal-label">Notes (optional)</label>
              <input type="text" className="input bg-[#F9FAFB]" value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional note" />
            </div>
            <div>
              <label className="modal-label">Attendance</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { status: 'called_out', label: 'Call Out', sel: 'bg-[#EF4444] text-white border-[#EF4444]' },
                  { status: 'ncns',       label: 'NCNS',     sel: 'bg-[#991B1B] text-white border-[#991B1B]' },
                  { status: 'late',       label: 'Late',     sel: 'bg-[#F59E0B] text-white border-[#F59E0B]' },
                  { status: 'present',    label: 'Present',  sel: 'bg-[#22C55E] text-white border-[#22C55E]' },
                ].map(({ status, label, sel }) => (
                  <button key={status} type="button"
                    onClick={() => markAttendance.mutate({ shiftId: editShiftModal.shift.id, status })}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                      editShiftModal.shift.attendance_status === status
                        ? sel
                        : 'bg-white border-[#D1D5DB] text-[#374151] hover:border-slate-400'
                    }`}
                  >{label}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" className="btn-danger text-sm px-3 py-1.5" onClick={() => deleteShift.mutate(editShiftModal.shift.id)}>
                <Trash2 size={13} /> Delete
              </button>
              <button type="button" className="btn-secondary flex-1" onClick={() => setEditShiftModal(null)}>Cancel</button>
              <button type="submit" className="btn-primary flex-1" disabled={updateShift.isPending}>
                {updateShift.isPending ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════
          PRE-PUBLISH REVIEW MODAL
      ═══════════════════════════════════════════════════════════════════ */}
      <Modal isOpen={publishModal} onClose={() => setPublishModal(false)} title="Review Changes Before Publishing" size="lg">
        <div className="space-y-4">
          {changeLog.length === 0 ? (
            <div className="text-center py-10">
              <Send size={28} className="text-content-subtle mx-auto mb-3" />
              <p className="text-content font-medium">No tracked changes this week</p>
              <p className="text-content-muted text-sm mt-1">
                Publish Week {amazonWeek} — all {weekStatus.draft} draft shift{weekStatus.draft !== 1 ? 's' : ''} will become visible to drivers.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-content-muted">
                  Publishing <strong className="text-content">{selectedLogIds.size}</strong> of <strong className="text-content">{changeLog.length}</strong> changes
                </p>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => setSelectedLogIds(
                    selectedLogIds.size === changeLog.length
                      ? new Set()
                      : new Set(changeLog.map(c => c.id))
                  )}
                >
                  {selectedLogIds.size === changeLog.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="border border-card-border rounded-xl overflow-hidden max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-card-border sticky top-0">
                    <tr>
                      <th className="px-3 py-2 w-8"></th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-content-muted uppercase tracking-wide">Driver</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-content-muted uppercase tracking-wide">Date</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-content-muted uppercase tracking-wide">Change</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-content-muted uppercase tracking-wide">By</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-content-muted uppercase tracking-wide">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-card-border">
                    {changeLog.map(entry => {
                      const checked = selectedLogIds.has(entry.id);
                      const shiftDateStr = entry.shift_date
                        ? String(entry.shift_date).slice(0, 10)
                        : null;
                      return (
                        <tr key={entry.id} className={`transition-opacity ${!checked ? 'opacity-40' : ''}`}>
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={e => setSelectedLogIds(prev => {
                                const next = new Set(prev);
                                e.target.checked ? next.add(entry.id) : next.delete(entry.id);
                                return next;
                              })}
                              className="rounded accent-primary w-3.5 h-3.5"
                            />
                          </td>
                          <td className="px-3 py-2.5 font-medium text-content whitespace-nowrap">{entry.staff_name}</td>
                          <td className="px-3 py-2.5 text-content-muted whitespace-nowrap text-xs">
                            {shiftDateStr ? format(parseISO(shiftDateStr), 'EEE MMM d') : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-content">{entry.description}</td>
                          <td className="px-3 py-2.5 text-content-muted text-xs whitespace-nowrap">{entry.changed_by_name}</td>
                          <td className="px-3 py-2.5 text-content-muted text-xs whitespace-nowrap">
                            {entry.created_at ? format(parseISO(entry.created_at), 'h:mm a') : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="flex gap-3 pt-1">
            <button className="btn-secondary flex-1" onClick={() => setPublishModal(false)}>Cancel</button>
            <button
              className="btn-primary flex-1 bg-emerald-600 hover:bg-emerald-700 border-emerald-600 flex items-center justify-center gap-1.5"
              disabled={publishWeek.isPending || publishSelected.isPending || (changeLog.length > 0 && selectedLogIds.size === 0)}
              onClick={() => {
                if (changeLog.length === 0) {
                  publishWeek.mutate();
                } else {
                  publishSelected.mutate(selectedLogIds);
                }
              }}
            >
              <Send size={14} />
              {(publishWeek.isPending || publishSelected.isPending) ? 'Publishing…'
                : changeLog.length === 0
                  ? `Publish Week ${amazonWeek}`
                  : `Publish ${selectedLogIds.size} Change${selectedLogIds.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════
          SETTINGS MODAL
      ═══════════════════════════════════════════════════════════════════ */}
      <Modal isOpen={settingsModal} onClose={() => setSettingsModal(false)} title="Scheduler Settings">
        <div className="space-y-5">
          <div>
            <h3 className="font-semibold text-content mb-3 flex items-center gap-2 text-sm uppercase tracking-wide text-content-muted">
              Shift Types
            </h3>
            <div className="space-y-2">
              {shiftTypes.map(t => (
                <div key={t.id} className="flex items-center gap-3 p-2.5 bg-slate-50 border border-card-border rounded-lg">
                  <span className={`badge ${SHIFT_COLORS[t.name] || 'bg-slate-100 text-slate-700'}`}>{t.name}</span>
                  <span className="text-xs text-content-muted flex-1">{t.default_start_time?.slice(0,5)} – {t.default_end_time?.slice(0,5)}</span>
                  <span className={`w-3 h-3 rounded-full ${t.is_active ? 'bg-green-400' : 'bg-slate-300'}`} title={t.is_active ? 'Active' : 'Inactive'} />
                </div>
              ))}
            </div>
            <p className="text-xs text-content-muted mt-2">Shift type defaults can be edited via the API. Full editor coming soon.</p>
          </div>
        </div>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════
          MULTI-SELECT CENTER POPUP
      ═══════════════════════════════════════════════════════════════════ */}
      {isManager && activeView === 'weekly' && selectedCells.size > 0 && !selectionInProgress && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
        >
          <div
            className="pointer-events-auto bg-white rounded-2xl shadow-2xl border border-slate-200 w-80 overflow-hidden"
            onMouseDown={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
              <span className="text-sm font-semibold text-slate-800">
                {selectedCells.size} cell{selectedCells.size !== 1 ? 's' : ''} selected
              </span>
              <button
                onClick={() => { setSelectedCells(new Set()); setSelectionAnchor(null); }}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                title="Clear selection (Esc)"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-3">
              {/* Shift type apply */}
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5 block">Change Shift Type</label>
                <div className="flex gap-2">
                  <select
                    value={bulkShiftType}
                    onChange={e => setBulkShiftType(e.target.value)}
                    className="select flex-1 text-sm"
                  >
                    <option value="">Select type…</option>
                    {shiftTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                  <button
                    onClick={handleBulkApply}
                    disabled={!bulkShiftType || bulkApply.isPending}
                    className="btn-primary text-sm px-4 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {bulkApply.isPending ? 'Applying…' : 'Apply'}
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-slate-100" />

              {/* Delete */}
              <button
                onClick={handleBulkDeleteRequest}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium transition-colors"
              >
                <Trash2 size={14} />
                Delete Selected Shifts
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          BULK DELETE CONFIRM MODAL
      ═══════════════════════════════════════════════════════════════════ */}
      <Modal isOpen={bulkDeleteConfirm} onClose={() => setBulkDeleteConfirm(false)} title="Delete Shifts">
        <div className="space-y-4">
          {(() => {
            const cnt = [...selectedCells].filter(k => {
              const { staffId, dateStr } = parseCellKey(k);
              return !!shiftMap[`${staffId}-${dateStr}`]?.[0];
            }).length;
            const recurringCnt = [...selectedCells].filter(k => {
              const { staffId, dateStr } = parseCellKey(k);
              if (!shiftMap[`${staffId}-${dateStr}`]?.[0]) return false;
              const dow = new Date(dateStr + 'T00:00:00').getDay();
              return recurringSet.has(`${staffId}|${dow}`);
            }).length;
            return (
              <>
                <p className="text-sm text-content-muted">
                  Delete <strong className="text-content">{cnt}</strong> shift{cnt !== 1 ? 's' : ''}? This cannot be undone.
                </p>
                {recurringCnt > 0 && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <p className="text-sm text-slate-600">
                      <strong>{recurringCnt}</strong> of the selected shift{recurringCnt !== 1 ? 's are' : ' is'} part of a recurring schedule.
                    </p>
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={removeRecurringChecked}
                        onChange={e => setRemoveRecurringChecked(e.target.checked)}
                        className="mt-0.5 accent-red-500"
                      />
                      <span className="text-sm text-slate-700">
                        Also remove {recurringCnt !== 1 ? 'these drivers' : 'this driver'} from their recurring schedule permanently
                      </span>
                    </label>
                  </div>
                )}
              </>
            );
          })()}
          <div className="flex gap-3 pt-1">
            <button className="btn-secondary flex-1" onClick={() => setBulkDeleteConfirm(false)}>Cancel</button>
            <button className="btn-danger flex-1" disabled={bulkDelete.isPending} onClick={executeBulkDelete}>
              {bulkDelete.isPending ? 'Deleting…' : 'Delete Shifts'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Rotating Driver Weekly Prompt ──────────────────────────────── */}
      {(() => {
        const rotatingDrivers = rotatingOverview.filter(d => d.is_rotating && d.recurring_rows.length >= 2);
        if (rotatingDrivers.length === 0) return null;
        return (
          <Modal isOpen={rotatingPromptOpen}
            onClose={() => { sessionStorage.setItem(`rotating_prompt_${weekStartStr}`, 'dismissed'); setRotatingPromptOpen(false); }}
            title="Set This Week's Role" size="md">
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Select the shift type for each rotating driver for the week of <strong>{format(weekStart, 'MMM d')}</strong>.
              </p>
              <div className="space-y-4">
                {rotatingDrivers.map(driver => (
                  <div key={driver.staff_id} className="p-3 border border-slate-200 rounded-xl space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 font-bold text-xs flex items-center justify-center flex-shrink-0">
                        {driver.first_name[0]}{driver.last_name[0]}
                      </div>
                      <span className="font-semibold text-sm text-slate-800">{driver.first_name} {driver.last_name}</span>
                      <span className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                        <RefreshCw size={8} /> ROT
                      </span>
                    </div>
                    <div className="space-y-1.5 pl-9">
                      {driver.recurring_rows.map(row => {
                        const days = DAYS.filter((_, i) => row[['sun','mon','tue','wed','thu','fri','sat'][i]]).join(', ');
                        return (
                          <label key={row.id} className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="radio"
                              name={`rotating_${driver.staff_id}`}
                              value={row.id}
                              checked={rotatingAssignments[driver.staff_id] === row.id}
                              onChange={() => setRotatingAssignments(a => ({ ...a, [driver.staff_id]: row.id }))}
                              className="accent-primary"
                            />
                            <span className="text-xs text-slate-700 font-medium">{row.shift_type}</span>
                            <span className="text-xs text-slate-400">{row.start_time?.slice(0,5)}–{row.end_time?.slice(0,5)}</span>
                            {days && <span className="text-xs text-slate-400">({days})</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 pt-1">
                <button className="btn-secondary flex-1" onClick={() => {
                  sessionStorage.setItem(`rotating_prompt_${weekStartStr}`, 'dismissed');
                  setRotatingPromptOpen(false);
                }}>
                  Skip This Week
                </button>
                <button className="btn-primary flex-1" disabled={rotatingApply.isPending}
                  onClick={() => {
                    const assignments = Object.entries(rotatingAssignments)
                      .filter(([, rowId]) => rowId != null)
                      .map(([staff_id, row_id]) => ({ staff_id: parseInt(staff_id), row_id }));
                    rotatingApply.mutate({ week_start: weekStartStr, assignments });
                  }}>
                  {rotatingApply.isPending ? 'Applying…' : 'Apply Roles'}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════════
          FIXED BOTTOM SUMMARY BAR — weekly view only
          Pinned to viewport bottom, columns aligned to day <th> positions
      ═══════════════════════════════════════════════════════════════════ */}
      {activeView === 'weekly' && dayColRects.length === 7 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#E2E8F0]"
          style={{ height: '44px', boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }}
        >
          {weekDays.map((d, i) => {
            const rect = dayColRects[i];
            if (!rect) return null;
            const ds = daySummary[format(d, 'yyyy-MM-dd')] || {};
            const edv = ds['EDV']       || 0;
            const sv  = ds['STEP VAN']  || 0;
            const h   = ds['HELPER']    || 0;
            const e   = ds['EXTRA']     || 0;
            const tot = edv + sv + h + e;
            return (
              <div
                key={i}
                style={{ position: 'absolute', left: rect.left, width: rect.width, top: 0, bottom: 0 }}
                className="flex items-center justify-center group"
              >
                {/* Total count */}
                <span className="text-[15px] font-bold text-[#111827] cursor-default select-none">
                  ({tot}R)
                </span>

                {/* Hover tooltip */}
                <div
                  className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block
                    bg-white border border-[#E2E8F0] text-[#111827] text-[13px] leading-relaxed
                    whitespace-nowrap z-10 pointer-events-none"
                  style={{ borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.10)', padding: '10px 14px' }}
                >
                  <div>EDV: <strong>{edv}</strong></div>
                  <div>Step Van: <strong>{sv}</strong></div>
                  <div>Helper: <strong>{h}</strong></div>
                  {e > 0 && <div>Extra: <strong>{e}</strong></div>}
                  <div style={{ borderTop: '1px solid #E2E8F0', marginTop: '6px', paddingTop: '6px' }}>
                    <strong>Total: {tot} DAs</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
