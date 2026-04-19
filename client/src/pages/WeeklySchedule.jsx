import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  format, addDays, startOfWeek, endOfWeek, getWeek, parseISO, isToday, addWeeks, subWeeks,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, ChevronDown, Plus, Trash2, Settings, Download,
  Search, RefreshCw, Upload, Clock, BarChart2, RepeatIcon, X, Check, AlertTriangle,
  Send, EyeOff, Pencil, Filter, Copy,
} from 'lucide-react';
import api from '../api/client';
import Modal from '../components/Modal';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import * as XLSX from 'xlsx';
import { resolveColor, getShiftStyle, getShiftStyleSelected, buildShiftTypeMap } from '../utils/shiftColors';

// ─── Constants ────────────────────────────────────────────────────────────────
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ATTENDANCE_DOT = {
  ncns:       'bg-red-500',
  called_out: 'bg-orange-500',
  late:       'bg-yellow-500',
  present:    'bg-green-500',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

function getAmazonWeek(date) {
  return getWeek(date, { weekStartsOn: 0, firstWeekContainsDate: 1 });
}

// ─── Driver chip helpers (avatar color, initials, highlight) ─────────────────
const AVATAR_PALETTE = ['#2563eb','#16a34a','#7c3aed','#d97706','#e11d48','#0891b2','#65a30d'];
function avatarColor(id) {
  const n = typeof id === 'number' ? id : Number(id) || 0;
  return AVATAR_PALETTE[Math.abs(n) % AVATAR_PALETTE.length];
}
function initials(firstName, lastName) {
  const f = (firstName || '').trim().charAt(0).toUpperCase();
  const l = (lastName  || '').trim().charAt(0).toUpperCase();
  return `${f}${l}` || '?';
}
// Split a name into [prefix, match, suffix] for the first case-insensitive
// occurrence of `query`. If not found, returns [name, '', ''].
function highlightParts(name, query) {
  if (!query) return [name, '', ''];
  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return [name, '', ''];
  return [name.slice(0, idx), name.slice(idx, idx + query.length), name.slice(idx + query.length)];
}

function getSunday(date) {
  return startOfWeek(date, { weekStartsOn: 0 });
}

// ─── Auto-scroll speed curve ──────────────────────────────────────────────────
// pos      : mouse clientY (vertical) or clientX (horizontal), in viewport coords
// size     : window.innerHeight (vertical) or window.innerWidth (horizontal)
// startPad : height of fixed element at the top / left (e.g. TopNav height)
// endPad   : height of fixed element at the bottom / right (e.g. summary bar height)
// Returns px/frame — negative = scroll backward (up/left), positive = forward (down/right)
// Zones (measured inward from the fixed element's inner edge):
//   0-40 px → fast (8 px/frame)   40-80 px → slow (3 px/frame)   >80 px → 0
function calcScrollSpeed(pos, size, startPad, endPad) {
  const nearStart = pos - startPad;          // distance past the top/left fixed element
  const nearEnd   = (size - endPad) - pos;   // distance before the bottom/right fixed element
  if (nearStart < 80) return nearStart < 40 ? -8 : -3;
  if (nearEnd   < 80) return nearEnd   < 40 ?  8 :  3;
  return 0;
}

// ─── Shift Cell ───────────────────────────────────────────────────────────────
function ShiftCell({ shift, isManager, onShiftDragStart, isDragging, shiftTypeMap }) {
  if (!shift) {
    if (!isManager) return <span className="text-slate-300 text-xs">—</span>;
    return (
      <div className="w-full min-h-[2.5rem] rounded-lg border border-dashed border-slate-200 text-slate-300 text-lg flex items-center justify-center cursor-pointer hover:border-primary hover:bg-primary-50 hover:text-primary transition-all select-none">
        +
      </div>
    );
  }

  const isDraft              = shift.publish_status === 'draft' || !shift.publish_status;
  const hasPending           = isManager && !!shift.has_pending_changes;
  // NEW = never published before; CHANGED = was published, now modified (old draft path)
  const isNewUnpublished     = isManager && isDraft && !shift.was_published;
  const isChangedUnpublished = isManager && isDraft && !!shift.was_published;
  const showDot              = isManager && (isDraft || hasPending);
  // Use pending values for display when admin has unsaved changes
  const displayType  = hasPending && shift.pending_shift_type ? shift.pending_shift_type  : shift.shift_type;
  const displayStart = hasPending && shift.pending_start_time ? shift.pending_start_time  : shift.start_time;
  const displayEnd   = hasPending && shift.pending_end_time   ? shift.pending_end_time    : shift.end_time;
  const colorRaw     = shiftTypeMap?.[displayType]?.color;
  const cellStyle    = getShiftStyle(colorRaw);
  const attDot       = ATTENDANCE_DOT[shift.attendance_status];

  return (
    <div className="relative">
      {showDot && (
        <span
          className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-yellow-400 rounded-full border-2 border-white z-10 shadow-sm pointer-events-none select-none"
          title={hasPending ? 'Pending change — not yet published to drivers' : isChangedUnpublished ? 'Changed — pending re-publish' : 'New shift — unpublished'}
        />
      )}
      <div
        data-shift-drag="true"
        draggable={isManager ? true : undefined}
        onDragStart={isManager && onShiftDragStart ? e => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(shift.id));
          onShiftDragStart();
        } : undefined}
        className={`w-full rounded-lg px-2 py-1.5 text-left ${isManager ? 'cursor-grab active:cursor-grabbing hover:shadow-sm' : 'cursor-default'} transition-shadow ${isDragging ? 'opacity-40 scale-95' : ''} ${isNewUnpublished ? 'ring-2 ring-red-500' : (isChangedUnpublished || hasPending) ? 'ring-2 ring-amber-400' : ''}`}
        style={{ backgroundColor: (cellStyle.backgroundColor || '#f8fafc'), borderLeft: `3px solid ${cellStyle.color || '#94a3b8'}`, ...(isNewUnpublished ? { opacity: 0.78 } : {}) }}
      >
        <div className="flex items-center justify-between gap-1">
          <span className={`text-xs font-bold truncate ${isNewUnpublished ? 'italic' : ''}`} style={{ color: cellStyle.color }}>{displayType}</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            {attDot && <span className={`w-2 h-2 rounded-full ${attDot}`} />}
          </div>
        </div>
        <p className="text-[10px] text-slate-400 mt-0.5">
          {displayStart?.slice(0,5)}–{displayEnd?.slice(0,5)}
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
export default function WeeklySchedule() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const isManager = ['manager', 'admin', 'dispatcher'].includes(user?.role);

  // Week state
  const [weekStart, setWeekStart] = useState(getSunday(new Date()));

  // Filter state
  const [filterShiftTypes, setFilterShiftTypes] = useState([]);
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const shiftType = searchParams.get('shiftType');
    if (shiftType === 'DISPATCH') setFilterShiftTypes(['DISPATCH AM', 'DISPATCH PM']);
  }, []);
  const [showUnscheduled, setShowUnscheduled] = useState(false);

  // Multi-driver chip search
  const [driverChips, setDriverChips]           = useState([]);
  const [chipInput, setChipInput]               = useState('');
  const [chipDropOpen, setChipDropOpen]         = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  // Dropdown is rendered with position: fixed so it can escape any ancestor
  // overflow clipping. Coordinates are recomputed from the search wrapper's
  // bounding rect on open / query change / scroll / resize.
  const [dropdownPos, setDropdownPos]           = useState({ top: 0, left: 0, width: 0 });
  const chipInputRef     = useRef();   // the <input> element (focus target)
  const chipInputRowRef  = useRef();   // the search-input row (used to anchor the dropdown below the input, not below chips)
  const chipContainerRef = useRef();   // the full wrapper card (used for outside-click)

  // Per-day column filter (sort by route, shift type, or start time)
  const [dayColFilter, setDayColFilter]         = useState(null);  // { dateStr, mode } | null
  const [dayFilterDropOpen, setDayFilterDropOpen] = useState(null); // dateStr of open dropdown

  // Modal state
  const [addShiftModal, setAddShiftModal]     = useState(null); // { staff_id, date } | { bulkCells }
  const [addShiftKeyIndex, setAddShiftKeyIndex] = useState(0);
  const [editShiftKeyIndex, setEditShiftKeyIndex] = useState(0);
  const [settingsModal, setSettingsModal]     = useState(false);
  const [hoursUploadModal, setHoursUploadModal] = useState(false);

  // Rotating driver weekly prompt
  const [rotatingPromptOpen, setRotatingPromptOpen]     = useState(false);
  const [rotatingAssignments, setRotatingAssignments]   = useState({});

  // Edit shift state
  const [editShiftModal, setEditShiftModal]           = useState(null);
  const [editForm, setEditForm]                       = useState({ shift_type: 'EDV', start_time: '07:00', end_time: '17:00', notes: '' });
  const [editAttendanceStatus, setEditAttendanceStatus] = useState(null);
  const [editAttendanceNotes, setEditAttendanceNotes]   = useState('');

  // Publish state
  const [publishModal, setPublishModal]         = useState(false);
  const [selectedShiftIds, setSelectedShiftIds] = useState(new Set());
  const [rejectedShiftIds, setRejectedShiftIds] = useState(new Set());

  // Auto-open publish modal when navigated here from Dashboard
  useEffect(() => {
    if (location.state?.openPublishModal) {
      setPublishModal(true);
      // Clear state so back-navigation doesn't re-open it
      window.history.replaceState({}, '');
    }
  }, [location.key]); // eslint-disable-line

  // Driver sort
  const [driverSort, setDriverSort] = useState('first-asc');
  const [sortOpen, setSortOpen] = useState(false);

  // ── Multi-select state ─────────────────────────────────────────────────────
  const [selectedCells, setSelectedCells]         = useState(new Set());
  const [selectionAnchor, setSelectionAnchor]     = useState(null);
  const [bulkShiftType, setBulkShiftType]         = useState('');
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [removeRecurringChecked, setRemoveRecurringChecked] = useState(false);
  const [selectionInProgress, setSelectionInProgress] = useState(false);
  const dragRef       = useRef({ active: false, startStaffId: null, startDateStr: null });
  const justDraggedRef = useRef(false);

  // ── Keyboard cell selection ────────────────────────────────────────────────
  const [selectedCell, setSelectedCell] = useState(null);
  const [shiftHeld, setShiftHeld]       = useState(false);
  const selectedCellRef      = useRef(null);
  const selectedCellsRef     = useRef(new Set());
  const sortedStaffRef       = useRef([]);
  const weekDaysRef          = useRef([]);
  const shiftMapRef          = useRef({});
  const openEditShiftRef     = useRef(null);
  const openAddShiftRef      = useRef(null);
  const openBulkAddShiftRef  = useRef(null);

  // Shift type filter dropdown
  const [filterDropOpen, setFilterDropOpen] = useState(false);
  const filterDropRef = useRef(null);

  // ── Popup keyboard handler refs (updated each render, read in effects) ─────
  const editShiftKeyIndexRef  = useRef(0);
  const editShiftFormRef      = useRef(null);
  const uniqueShiftTypesRef   = useRef([]);
  const shiftTypesRef         = useRef([]);
  const selectedShiftIdsRef   = useRef(new Set());
  const executeBulkDeleteRef  = useRef(null);
  const publishSelectedRef    = useRef(null);
  const weekStartStrRef       = useRef('');
  const rotatingApplyRef      = useRef(null);
  const anyModalOpenRef       = useRef(false);

  // Drag-and-drop
  const dragShiftRef = useRef(null);
  const [dragShift, setDragShift]   = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  // Add shift form
  const [shiftForm, setShiftForm] = useState({ shift_type: 'EDV', start_time: '07:00', end_time: '17:00', notes: '' });

  // Route commitment
  const [rcForm, setRcForm]       = useState({ edv_count: '', step_van_count: '', total_routes: '', notes: '' });
  const [rcEditDay, setRcEditDay] = useState(null);
  const [rcEditValue, setRcEditValue] = useState('');

  const skipPublishResetRef = useRef(false);
  const [hoursFile, setHoursFile] = useState(null);

  // ── Fixed bottom bar: column position tracking ─────────────────────────────
  const dayColRefs        = useRef([]);
  const tableContainerRef = useRef();
  const [dayColRects, setDayColRects] = useState([]);

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
    syncDayColRects();
    const el = tableContainerRef.current;
    if (!el) return;
    el.addEventListener('scroll', syncDayColRects, { passive: true });
    window.addEventListener('resize', syncDayColRects, { passive: true });
    return () => {
      el.removeEventListener('scroll', syncDayColRects);
      window.removeEventListener('resize', syncDayColRects);
    };
  }, [syncDayColRects, weekStart]);

  const weekEnd      = endOfWeek(weekStart, { weekStartsOn: 0 });
  const weekDays     = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const amazonWeek   = getAmazonWeek(weekStart);

  // ── Data Fetching ──────────────────────────────────────────────────────────
  const { data: shifts = [], isLoading: shiftsLoading } = useQuery({
    queryKey: ['shifts', weekStartStr],
    queryFn: () => api.get('/shifts', { params: { start: weekStartStr, end: format(weekEnd, 'yyyy-MM-dd') } }).then(r => r.data),
  });

  const { data: staff = [] } = useQuery({
    queryKey: ['staff', 'drivers'],
    queryFn: () => api.get('/staff', { params: { role: 'driver', status: 'active' } }).then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: shiftTypes = [] } = useQuery({
    queryKey: ['shift-types'],
    queryFn: () => api.get('/schedule/shift-types').then(r => r.data),
    staleTime: 10 * 60 * 1000,
  });

  const shiftTypeMap = useMemo(() => buildShiftTypeMap(shiftTypes), [shiftTypes]);

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

  // Derived from the shifts cache — always in sync, updates instantly on any cache change.
  // Replaced the old separate /shifts/week-status API call because createShift & updateShift
  // never invalidated that query, causing the publish-button count to lag until a page refresh.
  const weekStatus = useMemo(() => {
    const draft     = shifts.filter(s => s.publish_status === 'draft' || !s.publish_status || !!s.has_pending_changes).length;
    const published = shifts.filter(s => s.publish_status === 'published' && !s.has_pending_changes).length;
    const total     = shifts.length;
    return {
      draft,
      published,
      total,
      status: total === 0 ? 'empty' : draft === 0 ? 'published' : 'draft',
    };
  }, [shifts]);

  const draftShifts = useMemo(
    () => shifts.filter(s => s.publish_status === 'draft' || !s.publish_status || !!s.has_pending_changes),
    [shifts]
  );

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

  // Day-recurring for bulk delete warning
  const { data: dayRecurring = [] } = useQuery({
    queryKey: ['day-recurring'],
    queryFn: () => api.get('/schedule/day-recurring').then(r => r.data),
    enabled: isManager,
  });
  const recurringSet = useMemo(() => {
    const s = new Set();
    dayRecurring.forEach(d => (d.drivers || []).forEach(dr => s.add(`${dr.staff_id}|${d.day_of_week}`)));
    return s;
  }, [dayRecurring]);

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

  // ── Chip suggestions ───────────────────────────────────────────────────────
  // Rank: first-name starts-with (0) → first-name contains (1) → last-name
  // starts-with (2) → last-name contains (3). Excludes non-matches.
  const chipSuggestions = useMemo(() => {
    if (!chipInput.trim()) return [];
    const q = chipInput.toLowerCase();
    const ranked = [];
    for (const s of staff) {
      if (driverChips.some(c => c.id === s.id)) continue;
      const first = (s.first_name || '').toLowerCase();
      const last  = (s.last_name  || '').toLowerCase();
      let rank = -1;
      if      (first.startsWith(q)) rank = 0;
      else if (first.includes(q))   rank = 1;
      else if (last.startsWith(q))  rank = 2;
      else if (last.includes(q))    rank = 3;
      if (rank === -1) continue;
      ranked.push({ s, rank });
    }
    ranked.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const af = `${a.s.first_name || ''} ${a.s.last_name || ''}`.toLowerCase();
      const bf = `${b.s.first_name || ''} ${b.s.last_name || ''}`.toLowerCase();
      return af.localeCompare(bf);
    });
    return ranked.slice(0, 8).map(r => r.s);
  }, [staff, driverChips, chipInput]);

  // ── Filtered Drivers ───────────────────────────────────────────────────────
  const filteredStaff = useMemo(() => {
    let list = staff;
    if (driverChips.length > 0) {
      list = list.filter(s => driverChips.some(c => c.id === s.id));
    } else if (chipInput.trim()) {
      const q = chipInput.toLowerCase();
      list = list.filter(s => {
        const first = (s.first_name || '').toLowerCase();
        const last  = (s.last_name  || '').toLowerCase();
        return first.includes(q) || last.includes(q);
      });
    }
    if (!showUnscheduled) {
      list = list.filter(s => weekDays.some(d => shiftMap[`${s.id}-${format(d, 'yyyy-MM-dd')}`]?.length > 0));
    }
    if (filterShiftTypes.length > 0) {
      list = list.filter(s => weekDays.some(d => {
        const key = `${s.id}-${format(d, 'yyyy-MM-dd')}`;
        return shiftMap[key]?.some(sh => filterShiftTypes.includes(sh.shift_type));
      }));
    }
    return list;
  }, [staff, driverChips, chipInput, showUnscheduled, filterShiftTypes, shiftMap, weekDays]);

  // ── Deduplicated shift types ───────────────────────────────────────────────
  const uniqueShiftTypes = useMemo(
    () => shiftTypes.filter((t, i, arr) =>
      arr.findIndex(x => x.name.trim().toLowerCase() === t.name.trim().toLowerCase()) === i
    ),
    [shiftTypes]
  );

  // ── Summary counts ─────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const counts = { EDV: 0, 'STEP VAN': 0, EXTRA: 0, HELPER: 0 };
    shifts.forEach(s => {
      if (counts[s.shift_type] !== undefined) counts[s.shift_type]++;
    });
    return counts;
  }, [shifts]);

  const daySummary = useMemo(() => {
    const map = {};
    shifts.forEach(s => {
      const dateStr = s.shift_date?.split('T')[0] || s.shift_date;
      if (!map[dateStr]) map[dateStr] = {};
      map[dateStr][s.shift_type] = (map[dateStr][s.shift_type] || 0) + 1;
    });
    return map;
  }, [shifts]);

  // ── Sorted staff ───────────────────────────────────────────────────────────
  const sortedStaff = useMemo(() => {
    const SHIFT_ORDER = ['EDV','STEP VAN','HELPER','EXTRA','ON CALL','UTO','PTO','TRAINING','SUSPENSION'];
    let list = [...filteredStaff].sort((a, b) => {
      const la = (a.last_name  || '').toLowerCase();
      const fa = (a.first_name || '').toLowerCase();
      const lb = (b.last_name  || '').toLowerCase();
      const fb = (b.first_name || '').toLowerCase();
      if (driverSort === 'last-asc')  return la.localeCompare(lb) || fa.localeCompare(fb);
      if (driverSort === 'last-desc') return lb.localeCompare(la) || fb.localeCompare(fa);
      if (driverSort === 'first-desc') return fb.localeCompare(fa) || lb.localeCompare(la);
      if (driverSort === 'shift-type') {
        // Sort by most common shift type this week
        const getType = (s) => {
          for (const d of weekDays) {
            const sh = shiftMap[`${s.id}-${format(d, 'yyyy-MM-dd')}`]?.[0];
            if (sh?.shift_type) return sh.shift_type;
          }
          return 'ZZZ';
        };
        const ia = SHIFT_ORDER.indexOf(getType(a)); const ib = SHIFT_ORDER.indexOf(getType(b));
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || fa.localeCompare(fb);
      }
      if (driverSort === 'hours-desc') {
        const ha = parseFloat(hoursMap[a.id]) || 0; const hb = parseFloat(hoursMap[b.id]) || 0;
        return hb - ha || fa.localeCompare(fb);
      }
      // default: first-asc
      return fa.localeCompare(fb) || la.localeCompare(lb);
    });
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
  }, [filteredStaff, driverSort, dayColFilter, shiftMap, dayFilterRouteMap, hoursMap, weekDays]);

  // Reset sort to default on week change
  useEffect(() => { setDriverSort('first-asc'); setSortOpen(false); }, [weekStartStr]);
  useEffect(() => { if (!sortOpen) return; const h = () => setSortOpen(false); document.addEventListener('click', h); return () => document.removeEventListener('click', h); }, [sortOpen]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidateShifts = () => {
    qc.invalidateQueries({ queryKey: ['shifts'] });
  };

  const createShift = useMutation({
    mutationFn: data => api.post('/shifts', data),
    // Optimistic: inject a temp shift into the cache so the grid + publish count update instantly.
    // Uses a negative temp ID; replaced by the real row after the background refetch.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['shifts', weekStartStr] });
      const prev = qc.getQueryData(['shifts', weekStartStr]);
      const optimistic = {
        id:             -(Date.now()),
        staff_id:       vars.staff_id,
        shift_date:     vars.shift_date,
        shift_type:     vars.shift_type,
        start_time:     vars.start_time,
        end_time:       vars.end_time,
        notes:          vars.notes || '',
        publish_status: 'draft',
        was_published:  false,
        // Pull name from the already-loaded staff list for the publish modal
        first_name: staff.find(s => s.id === vars.staff_id)?.first_name || '',
        last_name:  staff.find(s => s.id === vars.staff_id)?.last_name  || '',
      };
      qc.setQueryData(['shifts', weekStartStr], (old = []) => [...old, optimistic]);
      return { prev };
    },
    onSuccess: () => { invalidateShifts(); toast.success('Shift added'); setAddShiftModal(null); },
    onError: (err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['shifts', weekStartStr], ctx.prev);
      toast.error(err.response?.data?.error || 'Failed to add shift');
    },
  });

  const deleteShift = useMutation({
    mutationFn: id => api.delete(`/shifts/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['shifts', weekStartStr] });
      const prev = qc.getQueryData(['shifts', weekStartStr]);
      qc.setQueryData(['shifts', weekStartStr], (old = []) => (old || []).filter(s => s.id !== id));
      return { prev };
    },
    onSuccess: () => { invalidateShifts(); toast.success('Shift removed'); setEditShiftModal(null); },
    onError: (err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['shifts', weekStartStr], ctx.prev);
    },
  });

  const updateShift = useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/shifts/${id}`, data),
    // Optimistic: apply changes + mark draft immediately so the amber/red ring shows at once.
    onMutate: async ({ id, ...updates }) => {
      await qc.cancelQueries({ queryKey: ['shifts', weekStartStr] });
      const prev = qc.getQueryData(['shifts', weekStartStr]);
      qc.setQueryData(['shifts', weekStartStr], (old = []) =>
        (old || []).map(s => {
          if (s.id !== id) return s;
          return {
            ...s,
            ...updates,
            publish_status:  'draft',
            // If it was previously published, flag it as changed so the amber ring appears
            was_published:   s.publish_status === 'published' ? true : !!s.was_published,
            prev_shift_type: s.publish_status === 'published' ? s.shift_type : s.prev_shift_type,
          };
        })
      );
      return { prev };
    },
    onSuccess: (resp) => {
      invalidateShifts();
      const data = resp?.data || resp;
      if (data?.ops_removed) toast('Driver removed from Ops Planner', { icon: '🔒' });
      else toast.success('Shift updated');
      setEditShiftModal(null);
    },
    onError: (err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['shifts', weekStartStr], ctx.prev);
      toast.error(err.response?.data?.error || 'Failed to update shift');
    },
  });

  const markAttendance = useMutation({
    mutationFn: ({ shiftId, status, notes }) => api.post('/attendance', {
      staff_id: shifts.find(s => s.id === shiftId)?.staff_id,
      shift_id: shiftId,
      attendance_date: shifts.find(s => s.id === shiftId)?.shift_date?.split('T')[0],
      status,
      notes: notes || '',
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shifts'] }); toast.success('Attendance updated'); },
  });

  const saveRouteCommitment = useMutation({
    mutationFn: data => api.post('/schedule/route-commitments', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['route-commitment'] }); toast.success('Route commitment saved'); },
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
      toast.success(`Published ${res.data.published} shifts — drivers can now see Week ${amazonWeek}`);
      setPublishModal(false);
    },
    onError: () => toast.error('Failed to publish schedule'),
  });

  const publishSelected = useMutation({
    mutationFn: ({ shiftIds, notify }) =>
      api.post('/shifts/publish-selected', { shift_ids: [...shiftIds], notify }).then(r => r.data),
    // Optimistic: flip selected shifts to published status immediately so rings/dots vanish at once.
    onMutate: async ({ shiftIds }) => {
      await qc.cancelQueries({ queryKey: ['shifts', weekStartStr] });
      const prev = qc.getQueryData(['shifts', weekStartStr]);
      const ids = new Set([...shiftIds]);
      qc.setQueryData(['shifts', weekStartStr], (old = []) =>
        (old || []).map(s => ids.has(s.id) ? {
          ...s,
          publish_status:     'published',
          was_published:      true,
          has_pending_changes: false,
          // Promote pending values to main so the cell reflects the published state
          shift_type: s.has_pending_changes ? (s.pending_shift_type || s.shift_type) : s.shift_type,
          start_time: s.has_pending_changes ? (s.pending_start_time || s.start_time) : s.start_time,
          end_time:   s.has_pending_changes ? (s.pending_end_time   || s.end_time)   : s.end_time,
          pending_shift_type: null,
          pending_start_time: null,
          pending_end_time:   null,
        } : s)
      );
      return { prev };
    },
    onSuccess: (data, { notify }) => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      const base = `${data.published} shift${data.published !== 1 ? 's' : ''} published`;
      const extra = notify && data.notified > 0
        ? ` · ${data.notified} driver${data.notified !== 1 ? 's' : ''} notified 📲`
        : '';
      toast.success(base + extra);
      setPublishModal(false);
    },
    onError: (err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['shifts', weekStartStr], ctx.prev);
      toast.error('Failed to publish');
    },
  });

  // Reject a shift from the publish modal:
  //   • NEW shift (was_published=false) → DELETE the shift entirely
  //   • CHANGED shift (was_published=true) → restore all original fields, mark published
  const rejectShift = useMutation({
    mutationFn: (shift) => api.post(`/shifts/${shift.id}/reject`),
    // Optimistic: apply the rejection in the cache immediately so the grid + count update at once.
    onMutate: async (shift) => {
      await qc.cancelQueries({ queryKey: ['shifts', weekStartStr] });
      const prev = qc.getQueryData(['shifts', weekStartStr]);
      if (shift.has_pending_changes) {
        // Pending change on a live shift — discard pending, keep original published values
        qc.setQueryData(['shifts', weekStartStr], (old = []) =>
          (old || []).map(s => s.id !== shift.id ? s : {
            ...s,
            has_pending_changes: false,
            pending_shift_type:  null,
            pending_start_time:  null,
            pending_end_time:    null,
          })
        );
      } else if (shift.was_published) {
        // Revert all fields to previously published state (old draft path)
        qc.setQueryData(['shifts', weekStartStr], (old = []) =>
          (old || []).map(s => s.id !== shift.id ? s : {
            ...s,
            shift_type:      shift.prev_shift_type  || s.shift_type,
            start_time:      shift.prev_start_time  || s.start_time,
            end_time:        shift.prev_end_time    || s.end_time,
            publish_status:  'published',
            prev_shift_type: null,
            prev_start_time: null,
            prev_end_time:   null,
          })
        );
      } else {
        // New shift — remove from cache entirely
        qc.setQueryData(['shifts', weekStartStr], (old = []) =>
          (old || []).filter(s => s.id !== shift.id)
        );
      }
      return { prev };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
    },
    onError: (err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['shifts', weekStartStr], ctx.prev);
      toast.error('Failed to reject shift');
    },
  });

  const unpublishWeek = useMutation({
    mutationFn: () => api.post('/shifts/unpublish-week', { week_start: weekStartStr }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['week-status'] });
      toast.success(`Week ${amazonWeek} pulled back to draft`);
    },
    onError: () => toast.error('Failed to unpublish'),
  });

  const copyLastWeek = useMutation({
    mutationFn: () => api.post('/shifts/copy-last-week', { week_start: weekStartStr }).then(r => r.data),
    onSuccess: async data => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['week-status'] });
      toast.success(`Copied ${data.created} shift${data.created !== 1 ? 's' : ''} from last week as drafts`);
      try {
        const lastWeekStart = format(subWeeks(weekStart, 1), 'yyyy-MM-dd');
        const lastRc = await api.get('/schedule/route-commitments', { params: { week_start: lastWeekStart, weeks: 1 } }).then(r => r.data?.[0]);
        if (lastRc?.daily_targets && Object.keys(lastRc.daily_targets).length > 0) {
          const shifted = {};
          for (const [dateStr, val] of Object.entries(lastRc.daily_targets)) {
            const newDate = format(addDays(parseISO(dateStr), 7), 'yyyy-MM-dd');
            shifted[newDate] = val;
          }
          await api.post('/schedule/route-commitments', {
            week_start: weekStartStr,
            daily_targets: shifted,
            total_routes: Object.values(shifted).reduce((s, v) => s + (v || 0), 0),
            edv_count: lastRc.edv_count || 0,
            step_van_count: lastRc.step_van_count || 0,
          });
          qc.invalidateQueries({ queryKey: ['route-commitment', weekStartStr] });
        }
      } catch (_) { /* silent */ }
    },
    onError: err => toast.error(err.response?.data?.error || 'Failed to copy schedule'),
  });

  const moveShiftRef = useRef(null);
  const moveShift = useMutation({
    mutationFn: ({ id, staff_id, shift_date }) =>
      api.post(`/shifts/${id}/move`, { staff_id, shift_date }).then(r => r.data),
    onMutate: async ({ id, staff_id, shift_date }) => {
      await qc.cancelQueries({ queryKey: ['shifts', weekStartStr] });
      const prev = qc.getQueryData(['shifts', weekStartStr]);
      qc.setQueryData(['shifts', weekStartStr], (old = []) =>
        old.map(s => s.id === id ? { ...s, staff_id, shift_date } : s)
      );
      setDragShift(null); setDropTarget(null);
      return { prev };
    },
    onSuccess: () => { invalidateShifts(); qc.invalidateQueries({ queryKey: ['week-status'] }); toast.success('Shift moved'); },
    onError: (err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['shifts', weekStartStr], ctx.prev);
      toast.error(err.response?.data?.error || 'Failed to move shift');
      setDragShift(null); setDropTarget(null);
    },
  });

  const bulkApply = useMutation({
    mutationFn: data => api.post('/shifts/bulk-apply', data).then(r => r.data),
    onSuccess: (data, vars) => {
      invalidateShifts();
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
      qc.invalidateQueries({ queryKey: ['week-status'] });
      toast.success(`Deleted ${data.deleted} shift${data.deleted !== 1 ? 's' : ''}`);
      setBulkDeleteConfirm(false);
      setSelectedCells(new Set()); setSelectionAnchor(null);
    },
    onError: () => toast.error('Bulk delete failed'),
  });

  const handleBulkApply = useCallback(() => {
    if (!bulkShiftType || selectedCells.size === 0) return;
    const defaults = getShiftTypeDefaults(bulkShiftType);
    const cells = [...selectedCells].map(key => {
      const { staffId, dateStr } = parseCellKey(key);
      const shift = shiftMap[`${staffId}-${dateStr}`]?.[0];
      return { staff_id: staffId, shift_date: dateStr, shift_id: shift?.id || null };
    });
    bulkApply.mutate({ cells, shift_type: bulkShiftType, ...defaults });
  }, [bulkShiftType, selectedCells, shiftMap]); // eslint-disable-line

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
  }, [selectedCells, shiftMap, removeRecurringChecked, recurringSet]); // eslint-disable-line

  const handleBulkDeleteRequest = useCallback(() => {
    setRemoveRecurringChecked(false);
    setBulkDeleteConfirm(true);
  }, []);

  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  const handleDropOnCell = useCallback((staffId, dateStr) => {
    const ds = dragShiftRef.current;
    if (!ds) return;
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 300);
    dragShiftRef.current = null;
    setDragShift(null);
    setDropTarget(null);
    if (ds.staffId === staffId && ds.dateStr === dateStr) return;
    const targetShift = shiftMapRef.current[`${staffId}-${dateStr}`]?.[0];
    if (targetShift) {
      Promise.all([
        moveShiftRef.current.mutateAsync({ id: ds.id, staff_id: staffId, shift_date: dateStr }),
        moveShiftRef.current.mutateAsync({ id: targetShift.id, staff_id: ds.staffId, shift_date: ds.dateStr }),
      ]).catch(() => {});
    } else {
      moveShiftRef.current.mutate({ id: ds.id, staff_id: staffId, shift_date: dateStr });
    }
  }, []);

  // ── Global mouseup + keydown ───────────────────────────────────────────────
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
      // Bail immediately when any popup/modal is open — capture-phase handlers take over
      if (anyModalOpenRef.current) return;

      if (e.key === 'Escape') {
        setSelectedCells(new Set()); setSelectionAnchor(null); setSelectionInProgress(false);
        setSelectedCell(null);
      }
      const tag = document.activeElement?.tagName;
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (isEditing) return;

      const sc = selectedCellRef.current;
      if (sc) {
        const staff = sortedStaffRef.current;
        const days  = weekDaysRef.current;
        const rIdx  = staff.findIndex(x => x.id === sc.staffId);
        const cIdx  = days.findIndex(d => format(d, 'yyyy-MM-dd') === sc.dateStr);

        if (e.key === 'ArrowUp')    { e.preventDefault(); const newR = Math.max(0, rIdx - 1); if (staff[newR]) setSelectedCell({ staffId: staff[newR].id, dateStr: sc.dateStr }); return; }
        if (e.key === 'ArrowDown')  { e.preventDefault(); const newR = Math.min(staff.length - 1, rIdx + 1); if (staff[newR]) setSelectedCell({ staffId: staff[newR].id, dateStr: sc.dateStr }); return; }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); if (cIdx > 0 && days[cIdx - 1]) setSelectedCell({ staffId: sc.staffId, dateStr: format(days[cIdx - 1], 'yyyy-MM-dd') }); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); if (cIdx < days.length - 1 && days[cIdx + 1]) setSelectedCell({ staffId: sc.staffId, dateStr: format(days[cIdx + 1], 'yyyy-MM-dd') }); return; }
        if (e.key === 'Enter') {
          e.preventDefault();
          const shift = shiftMapRef.current[`${sc.staffId}-${sc.dateStr}`]?.[0];
          if (shift) openEditShiftRef.current?.(shift);
          else openAddShiftRef.current?.(sc.staffId, sc.dateStr);
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          const shift = shiftMapRef.current[`${sc.staffId}-${sc.dateStr}`]?.[0];
          if (shift) openEditShiftRef.current?.(shift);
          return;
        }
      }

      // Week navigation (no cell selected)
      const visibilityDays = parseInt(appSettings.schedule_visibility_days || 14);
      if (e.key === 'ArrowLeft')  { e.preventDefault(); setWeekStart(d => subWeeks(d, 1)); }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setWeekStart(d => {
          const maxDate = new Date();
          maxDate.setDate(maxDate.getDate() + visibilityDays);
          const next = addWeeks(d, 1);
          return (isManager || next <= maxDate) ? next : d;
        });
      }
    };
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mouseup', onMouseUp); document.removeEventListener('keydown', onKeyDown); };
  }, []); // eslint-disable-line

  // ── Shift key tracking (multi-select bulk modal on release) ───────────────
  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Shift') setShiftHeld(true); };
    const onKeyUp   = (e) => {
      if (e.key === 'Shift') {
        setShiftHeld(false);
        if (selectedCellsRef.current.size > 0) {
          openBulkAddShiftRef.current?.(selectedCellsRef.current);
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup',   onKeyUp);
    return () => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('keyup', onKeyUp); };
  }, []);

  // ── Keep refs current ──────────────────────────────────────────────────────
  selectedCellRef.current  = selectedCell;
  selectedCellsRef.current = selectedCells;
  sortedStaffRef.current   = sortedStaff;
  weekDaysRef.current      = weekDays;
  shiftMapRef.current      = shiftMap;
  moveShiftRef.current     = moveShift;

  // Live popup keyboard refs (no stale closures in effects)
  uniqueShiftTypesRef.current  = uniqueShiftTypes;
  shiftTypesRef.current        = shiftTypes;
  selectedShiftIdsRef.current  = selectedShiftIds;
  executeBulkDeleteRef.current = executeBulkDelete;
  publishSelectedRef.current   = publishSelected;
  weekStartStrRef.current      = weekStartStr;
  editShiftKeyIndexRef.current = editShiftKeyIndex;
  anyModalOpenRef.current      = !!(addShiftModal || editShiftModal || publishModal || bulkDeleteConfirm || settingsModal || hoursUploadModal || rotatingPromptOpen);
  rotatingApplyRef.current     = () => {
    const assignments = Object.entries(rotatingAssignments)
      .filter(([, rowId]) => rowId != null)
      .map(([staff_id, row_id]) => ({ staff_id: parseInt(staff_id), row_id }));
    rotatingApply.mutate({ week_start: weekStartStrRef.current, assignments });
  };

  // ── Popup keyboard focus traps (capture phase = fires before grid handlers) ─
  // Each effect installs a capture-phase listener ONLY while that modal is open.
  // stopPropagation() in capture phase prevents bubbling-phase grid nav from firing.
  const addShiftKeyIndexRef = useRef(0);
  const addShiftFormRef     = useRef(null);
  useEffect(() => { addShiftKeyIndexRef.current = addShiftKeyIndex; }, [addShiftKeyIndex]);

  // ── Add Shift modal ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!addShiftModal) return;
    const handler = (e) => {
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setAddShiftModal(null); return; }
      if (e.key === 'Enter')  { addShiftFormRef.current?.requestSubmit(); return; }
      const types = uniqueShiftTypesRef.current;
      if (!types.length) return;
      const COLS = 3;
      const total = types.length;
      const idx = addShiftKeyIndexRef.current;
      let next = idx;
      if (e.key === 'ArrowRight') {
        next = (idx + 1) % total;
      } else if (e.key === 'ArrowLeft') {
        next = (idx - 1 + total) % total;
      } else if (e.key === 'ArrowDown') {
        const candidate = idx + COLS;
        next = candidate < total ? candidate : idx % COLS;
      } else if (e.key === 'ArrowUp') {
        const candidate = idx - COLS;
        if (candidate >= 0) {
          next = candidate;
        } else {
          const col = idx % COLS;
          const lastRow = Math.floor((total - 1) / COLS);
          const lastInCol = lastRow * COLS + col;
          next = lastInCol < total ? lastInCol : lastInCol - COLS;
        }
      }
      addShiftKeyIndexRef.current = next;
      setAddShiftKeyIndex(next);
      setTimeout(() => document.querySelector(`[data-shift-idx="${next}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
      const t = types[next];
      if (t) {
        const found = shiftTypesRef.current.find(s => s.name === t.name);
        setShiftForm(f => ({ ...f, shift_type: t.name, start_time: found?.default_start_time?.slice(0,5) || '07:00', end_time: found?.default_end_time?.slice(0,5) || '17:00' }));
      }
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [addShiftModal]); // eslint-disable-line

  // ── Edit Shift modal ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!editShiftModal) return;
    const handler = (e) => {
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape'].includes(e.key)) return;
      // Always block grid navigation
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); setEditShiftModal(null); return; }
      // Enter submits only when not in a text/time input
      const tag = document.activeElement?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.key === 'Enter' && !isTyping) { e.preventDefault(); editShiftFormRef.current?.requestSubmit(); return; }
      // Arrows navigate shift types (only when not typing)
      if (isTyping) return;
      e.preventDefault();
      const types = uniqueShiftTypesRef.current;
      if (!types.length) return;
      const COLS = 3;
      const total = types.length;
      const idx = editShiftKeyIndexRef.current;
      let next = idx;
      if (e.key === 'ArrowRight') {
        next = (idx + 1) % total;
      } else if (e.key === 'ArrowLeft') {
        next = (idx - 1 + total) % total;
      } else if (e.key === 'ArrowDown') {
        const candidate = idx + COLS;
        next = candidate < total ? candidate : idx % COLS;
      } else if (e.key === 'ArrowUp') {
        const candidate = idx - COLS;
        if (candidate >= 0) {
          next = candidate;
        } else {
          const col = idx % COLS;
          const lastRow = Math.floor((total - 1) / COLS);
          const lastInCol = lastRow * COLS + col;
          next = lastInCol < total ? lastInCol : lastInCol - COLS;
        }
      }
      editShiftKeyIndexRef.current = next;
      setEditShiftKeyIndex(next);
      setTimeout(() => document.querySelector(`[data-edit-shift-idx="${next}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
      const t = types[next];
      if (t) {
        const found = shiftTypesRef.current.find(s => s.name === t.name);
        setEditForm(f => ({ ...f, shift_type: t.name, start_time: found?.default_start_time?.slice(0,5) || f.start_time, end_time: found?.default_end_time?.slice(0,5) || f.end_time }));
      }
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [editShiftModal]); // eslint-disable-line

  // ── Bulk Delete confirm ────────────────────────────────────────────────────
  useEffect(() => {
    if (!bulkDeleteConfirm) return;
    const handler = (e) => {
      if (!['Enter','Escape'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setBulkDeleteConfirm(false); return; }
      if (e.key === 'Enter')  { executeBulkDeleteRef.current?.(); return; }
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [bulkDeleteConfirm]);

  // ── Publish modal ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!publishModal) return;
    const handler = (e) => {
      if (!['Enter','Escape'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setPublishModal(false); return; }
      if (e.key === 'Enter') {
        const ids = selectedShiftIdsRef.current;
        if (ids.size > 0) publishSelectedRef.current.mutate({ shiftIds: ids, notify: false });
        return;
      }
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [publishModal]); // eslint-disable-line

  // ── Settings modal ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!settingsModal) return;
    const handler = (e) => {
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape'].includes(e.key)) return;
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); setSettingsModal(false); }
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [settingsModal]);

  // ── Hours Upload modal ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!hoursUploadModal) return;
    const handler = (e) => {
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape'].includes(e.key)) return;
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); setHoursUploadModal(false); }
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [hoursUploadModal]);

  // ── Rotating Driver prompt ─────────────────────────────────────────────────
  useEffect(() => {
    if (!rotatingPromptOpen) return;
    const handler = (e) => {
      if (!['Enter','Escape'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') {
        sessionStorage.setItem(`rotating_prompt_${weekStartStrRef.current}`, 'dismissed');
        setRotatingPromptOpen(false);
        return;
      }
      if (e.key === 'Enter') { rotatingApplyRef.current?.(); return; }
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [rotatingPromptOpen]); // eslint-disable-line

  // ── Driver-search dropdown position (position: fixed, viewport coords) ────
  // Anchors to the INPUT row, not the whole card — so adding chips (which
  // grow the card downward) doesn't push the dropdown below the chips.
  useEffect(() => {
    if (!chipDropOpen || chipInput.trim().length < 2) return;
    const updatePos = () => {
      const el = chipInputRowRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    };
    updatePos();
    window.addEventListener('scroll', updatePos, true); // capture — catches ancestor scrolls
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [chipDropOpen, chipInput]);

  // ── Outside click handlers ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (chipContainerRef.current && !chipContainerRef.current.contains(e.target)) {
        setChipDropOpen(false);
        setChipInput('');
        setHighlightedIndex(-1);
      }
      if (filterDropRef.current && !filterDropRef.current.contains(e.target)) setFilterDropOpen(false);
      setDayFilterDropOpen(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Clear drag state on drag cancel ───────────────────────────────────────
  useEffect(() => {
    const onDragEnd = () => {
      dragShiftRef.current = null; setDragShift(null); setDropTarget(null);
      dragRef.current = { active: false, startStaffId: null, startDateStr: null };
    };
    document.addEventListener('dragend', onDragEnd);
    return () => document.removeEventListener('dragend', onDragEnd);
  }, []);

  // ── Auto-scroll during rect-select drag AND HTML5 drag-and-drop ────────────
  // The layout uses min-h-screen so the WINDOW is the vertical scroll container.
  // tableContainerRef uses overflow-auto only for horizontal (table min-w-[780px]).
  // Vertical  → window.scrollBy()          (accounts for TopNav + summary bar)
  // Horizontal → container.scrollLeft +=   (container scroll only)
  // Edge zones (measured from the inner edge of each fixed element):
  //   0-40 px → fast (8 px/frame)   40-80 px → slow (3 px/frame)
  const autoScrollStateRef = useRef({ x: 0, y: 0 });
  const dndDragActiveRef   = useRef(false); // true while an HTML5 drag is live

  useEffect(() => {
    let rafId;
    // Read fixed-element heights at setup time; re-read in tick for accuracy after resize
    const getNavH     = () => document.querySelector('header')?.offsetHeight ?? 56;
    const SUMMARY_H   = 52; // fixed bottom bar (height: 52px in inline style)

    const updateState = (cx, cy) => {
      autoScrollStateRef.current = {
        x: calcScrollSpeed(cx, window.innerWidth,  0,          0),
        y: calcScrollSpeed(cy, window.innerHeight, getNavH(),  SUMMARY_H),
      };
    };

    // rect-select drag: mousemove fires normally
    const handleMouseMove = (e) => {
      if (dragRef.current.active) updateState(e.clientX, e.clientY);
      else autoScrollStateRef.current = { x: 0, y: 0 };
    };

    // HTML5 drag-and-drop: mousemove is suppressed by the browser during native drag;
    // dragover fires on every frame the dragged item is over a valid drop target
    const handleDragOver  = (e) => { if (dndDragActiveRef.current) updateState(e.clientX, e.clientY); };
    const handleDragStart = ()  => { dndDragActiveRef.current = true; };
    const handleDragEnd   = ()  => { dndDragActiveRef.current = false; autoScrollStateRef.current = { x: 0, y: 0 }; };

    const tick = () => {
      const { x, y } = autoScrollStateRef.current;
      const isActive  = dragRef.current.active || dndDragActiveRef.current;
      if (isActive) {
        if (Math.abs(y) > 0.05) window.scrollBy(0, y);                                          // vertical → page scroll
        const container = tableContainerRef.current;
        if (container && Math.abs(x) > 0.05) container.scrollLeft += x;                         // horizontal → container
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('dragover',  handleDragOver,  { passive: true });
    document.addEventListener('dragstart', handleDragStart, { passive: true });
    document.addEventListener('dragend',   handleDragEnd,   { passive: true });
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('dragover',  handleDragOver);
      document.removeEventListener('dragstart', handleDragStart);
      document.removeEventListener('dragend',   handleDragEnd);
    };
  }, []); // eslint-disable-line

  // ── Arrow-key navigation: keep selected cell fully in view ───────────────
  // Fires whenever selectedCell changes (arrow key press or mouse click).
  //
  // Vertical: scrolls the WINDOW, accounting for:
  //   • TopNav (sticky top, ~56 px) — cell must not disappear behind it
  //   • Summary bar (fixed bottom, 52 px) — cell must not disappear behind it
  //   Uses smooth scrollBy so the jump isn't jarring.
  //
  // Horizontal: scrolls the grid container (overflow-auto), with 24 px padding.
  useEffect(() => {
    if (!selectedCell) return;
    const container = tableContainerRef.current;
    if (!container) return;
    const ck = `${selectedCell.staffId}|${selectedCell.dateStr}`;
    const el = container.querySelector(`[data-cell-key="${ck}"]`);
    if (!el) return;

    const navH    = document.querySelector('header')?.offsetHeight ?? 56;
    const sumH    = 52;   // fixed bottom summary bar height
    const PAD     = 8;    // extra breathing room
    const rect    = el.getBoundingClientRect();
    const safeTop = navH + PAD;
    const safeBot = window.innerHeight - sumH - PAD;

    // Vertical: scroll the page
    if (rect.top < safeTop) {
      window.scrollBy({ top: rect.top - safeTop, behavior: 'smooth' });
    } else if (rect.bottom > safeBot) {
      window.scrollBy({ top: rect.bottom - safeBot, behavior: 'smooth' });
    }

    // Horizontal: scroll the grid container
    const cr   = container.getBoundingClientRect();
    const HPAD = 24;
    if (rect.left  < cr.left  + HPAD) container.scrollLeft -= cr.left  + HPAD - rect.left;
    if (rect.right > cr.right - HPAD) container.scrollLeft += rect.right - (cr.right - HPAD);
  }, [selectedCell]);

  // ── Publish modal init ─────────────────────────────────────────────────────
  useEffect(() => {
    if (publishModal) {
      if (skipPublishResetRef.current) { skipPublishResetRef.current = false; return; }
      setSelectedShiftIds(new Set(draftShifts.map(s => s.id)));
      setRejectedShiftIds(new Set());
    }
  }, [publishModal]); // eslint-disable-line

  // ── Auto-apply recurring ───────────────────────────────────────────────────
  useEffect(() => {
    if (!weekStart || !isManager) return;
    const todayWeekStart = format(startOfWeek(new Date(), { weekStartsOn: 0 }), 'yyyy-MM-dd');
    if (weekStartStr < todayWeekStart) return;
    api.post('/schedule/day-recurring/apply', { week_start: weekStartStr })
      .then(r => { if (r.data?.created > 0) qc.invalidateQueries({ queryKey: ['shifts'] }); })
      .catch(() => {});
  }, [weekStartStr, isManager]); // eslint-disable-line

  // ── Rotating driver prompt ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isManager || !weekStart) return;
    const todayWeekStart = format(startOfWeek(new Date(), { weekStartsOn: 0 }), 'yyyy-MM-dd');
    if (weekStartStr < todayWeekStart) return;
    const rotatingDrivers = rotatingOverview.filter(d => d.is_rotating && d.recurring_rows.length >= 2);
    if (rotatingDrivers.length === 0) return;
    const storageKey = `rotating_prompt_${weekStartStr}`;
    if (sessionStorage.getItem(storageKey) === 'dismissed') return;
    const initial = {};
    rotatingDrivers.forEach(d => { initial[d.staff_id] = d.recurring_rows[0]?.id; });
    setRotatingAssignments(initial);
    setRotatingPromptOpen(true);
  }, [weekStartStr, rotatingOverview.length, isManager]); // eslint-disable-line

  const rotatingApply = useMutation({
    mutationFn: ({ week_start, assignments }) => api.post('/schedule/rotating-apply', { week_start, assignments }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      toast.success(`Applied ${res.data.created} shift${res.data.created !== 1 ? 's' : ''} for rotating drivers`);
      sessionStorage.setItem(`rotating_prompt_${weekStartStr}`, 'dismissed');
      setRotatingPromptOpen(false);
    },
    onError: () => toast.error('Failed to apply rotating schedules'),
  });

  // ── Shift type helpers ─────────────────────────────────────────────────────
  const getShiftTypeDefaults = (typeName) => {
    const types = shiftTypesRef.current.length ? shiftTypesRef.current : shiftTypes;
    const t = types.find(t => t.name === typeName);
    return { start_time: t?.default_start_time?.slice(0,5) || '07:00', end_time: t?.default_end_time?.slice(0,5) || '17:00' };
  };

  const handleShiftTypeChange = (type) => {
    const defaults = getShiftTypeDefaults(type);
    setShiftForm(f => ({ ...f, shift_type: type, ...defaults }));
  };

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportToExcel = () => {
    const rows = [['Driver', 'ID', ...DAYS.map((d, i) => format(addDays(weekStart, i), 'EEE M/d')), 'Total Hrs']];
    filteredStaff.forEach(s => {
      const cells = weekDays.map(d => {
        const sh = shiftMap[`${s.id}-${format(d, 'yyyy-MM-dd')}`]?.[0];
        if (!sh) return '';
        return `${sh.shift_type} ${sh.start_time?.slice(0,5)}-${sh.end_time?.slice(0,5)}${sh.attendance_status && sh.attendance_status !== 'present' ? ` (${sh.attendance_status})` : ''}`;
      });
      rows.push([`${s.first_name} ${s.last_name}`, s.employee_id, ...cells, hoursMap[s.id] || '']);
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 24 }, { wch: 14 }, ...Array(7).fill({ wch: 22 }), { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, `Week ${amazonWeek}`);
    XLSX.writeFile(wb, `Schedule_Week${amazonWeek}_${weekStartStr}.xlsx`);
    toast.success('Schedule exported!');
  };

  // ── Open modals ────────────────────────────────────────────────────────────
  const openEditShift = useCallback((shift) => {
    setEditForm({ shift_type: shift.shift_type, start_time: shift.start_time?.slice(0, 5) || '07:00', end_time: shift.end_time?.slice(0, 5) || '17:00', notes: shift.notes || '' });
    setEditAttendanceStatus(shift.attendance_status && shift.attendance_status !== 'present' ? shift.attendance_status : null);
    setEditAttendanceNotes(shift.attendance_notes || '');
    // Auto-highlight current shift type for keyboard nav
    const idx = uniqueShiftTypesRef.current.findIndex(t => t.name === shift.shift_type);
    const safeIdx = Math.max(0, idx);
    setEditShiftKeyIndex(safeIdx);
    editShiftKeyIndexRef.current = safeIdx;
    setEditShiftModal({ shift });
  }, []);

  const openAddShift = useCallback((staffId, dateStr) => {
    const defaults = getShiftTypeDefaults('EDV');
    setShiftForm({ shift_type: 'EDV', ...defaults, notes: '' });
    setAddShiftKeyIndex(0);
    setAddShiftModal({ staff_id: staffId, date: dateStr });
  }, []); // eslint-disable-line

  const openBulkAddShift = useCallback((cellsSet) => {
    const defaults = getShiftTypeDefaults('EDV');
    setShiftForm({ shift_type: 'EDV', ...defaults, notes: '' });
    setAddShiftKeyIndex(0);
    const bulkCells = [...cellsSet].map(key => {
      const { staffId, dateStr } = parseCellKey(key);
      const shift = shiftMapRef.current[`${staffId}-${dateStr}`]?.[0];
      return { staff_id: staffId, shift_date: dateStr, shift_id: shift?.id || null };
    });
    // Clear selection BEFORE opening modal — prevents double-open on second Shift release
    setSelectedCells(new Set());
    setSelectionAnchor(null);
    setAddShiftModal({ bulkCells });
  }, []); // eslint-disable-line

  openEditShiftRef.current    = openEditShift;
  openAddShiftRef.current     = openAddShift;
  openBulkAddShiftRef.current = openBulkAddShift;

  const canGoForward = (() => {
    const visibilityDays = parseInt(appSettings.schedule_visibility_days || 14);
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + visibilityDays);
    return isManager || addWeeks(weekStart, 1) <= maxDate;
  })();

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col relative -mt-6 -mx-6 -mb-6 px-6 pt-6 overflow-hidden" style={{ height: 'calc(100vh - 3.5rem)' }}>

      {/* ── Single-row header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4 min-w-0">

        {/* Left: view toggle */}
        <div className="flex bg-white border border-card-border rounded-lg p-0.5 shadow-sm flex-shrink-0">
          <button className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-white shadow-sm transition-all">
            Weekly
          </button>
          <button
            onClick={() => navigate('/schedule?tab=daily')}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition-all text-content-muted hover:text-content"
          >
            Daily
          </button>
          <button
            onClick={() => navigate('/operational-planner')}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition-all text-content-muted hover:text-content"
          >
            Ops Planner
          </button>
        </div>

        {/* Center: week navigation */}
        <div className="flex-1 flex items-center justify-center gap-1 min-w-0">
          <button onClick={() => setWeekStart(d => subWeeks(d, 1))} className="p-2 rounded-lg text-[#374151] hover:text-[#2563EB] transition-colors flex-shrink-0" aria-label="Previous week">
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
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isManager && (
            <>
              {weekStatus.draft > 0 && (
                <button onClick={() => setPublishModal(true)} className="text-xs text-amber-600 hover:text-amber-700 font-medium hover:underline underline-offset-2 transition-colors">
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
              <button onClick={() => copyLastWeek.mutate()} disabled={copyLastWeek.isPending}
                className="btn-secondary flex items-center gap-1.5" title="Copy last week's schedule as drafts">
                <Copy size={14} /> {copyLastWeek.isPending ? 'Copying…' : 'Copy Last Week'}
              </button>
              <button onClick={() => setSettingsModal(true)} className="btn-secondary"><Settings size={14} /></button>
              <button onClick={() => setHoursUploadModal(true)} className="btn-secondary flex items-center gap-1.5">
                <Clock size={14} /> Hours
              </button>
            </>
          )}
          <button onClick={exportToExcel} className="btn-secondary">
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* ── Main content area ──────────────────────────────────────────────── */}
      <div className="flex gap-2 flex-1 min-h-0 -ml-6 overflow-hidden">

        {/* ── Left filter panel ───────────────────────────────────────────── */}
        {/* overflow-visible so the driver-search dropdown can float above the
            filter cards below without being clipped. */}
        <div className="w-52 flex-shrink-0 flex flex-col gap-2 overflow-visible">

          {/* Driver chip search */}
          <div ref={chipContainerRef} className="relative bg-white border border-card-border rounded-r-xl shadow-sm">
            {/* Search input */}
            <div ref={chipInputRowRef} className="px-2 pt-2 pb-2 flex items-center gap-1 cursor-text" onClick={() => chipInputRef.current?.focus()}>
              <Search size={11} className="text-slate-400 flex-shrink-0" />
              <input
                ref={chipInputRef}
                className="flex-1 min-w-0 text-xs bg-transparent outline-none placeholder-content-subtle text-content"
                placeholder="Search by first name..."
                value={chipInput}
                onChange={e => {
                  setChipInput(e.target.value);
                  setHighlightedIndex(-1); // reset when the query changes
                  if (e.target.value.trim().length >= 2) setChipDropOpen(true);
                  else setChipDropOpen(false);
                }}
                onFocus={() => { if (chipInput.trim().length >= 2) setChipDropOpen(true); }}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (chipSuggestions.length === 0) return;
                    setChipDropOpen(true);
                    setHighlightedIndex(i => Math.min(i + 1, chipSuggestions.length - 1));
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (chipSuggestions.length === 0) return;
                    setHighlightedIndex(i => Math.max(i - 1, 0));
                    return;
                  }
                  if (e.key === 'Enter' && highlightedIndex >= 0 && chipSuggestions[highlightedIndex]) {
                    e.preventDefault();
                    const s = chipSuggestions[highlightedIndex];
                    setDriverChips(prev => [...prev, { id: s.id, first_name: s.first_name || '', last_name: s.last_name || '' }]);
                    setChipInput('');
                    setHighlightedIndex(-1);
                    setChipDropOpen(false);
                    return;
                  }
                  if (e.key === 'Escape') {
                    setChipDropOpen(false);
                    setChipInput('');
                    setHighlightedIndex(-1);
                    return;
                  }
                  if (e.key === 'Backspace' && !chipInput && driverChips.length > 0) {
                    setDriverChips(prev => prev.slice(0, -1));
                  }
                }}
              />
              {chipInput && (
                <button
                  onMouseDown={e => { e.preventDefault(); setChipInput(''); setChipDropOpen(false); chipInputRef.current?.focus(); }}
                  className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
                  title="Clear search"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Selected driver chips */}
            {driverChips.length > 0 && (
              <div className="px-2 pb-2 border-t border-slate-100 pt-2">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '6px' }}>
                  {driverChips.map(c => (
                    <div
                      key={c.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        background: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: '20px',
                        padding: '3px 8px 3px 4px',
                      }}
                    >
                      <div style={{
                        width: '20px', height: '20px', borderRadius: '50%',
                        background: avatarColor(c.id),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '8px', fontWeight: 700, color: 'white', flexShrink: 0,
                        letterSpacing: '0.5px',
                      }}>
                        {initials(c.first_name, c.last_name)}
                      </div>
                      <span style={{ color: '#e2e8f0', fontSize: '11px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {c.first_name}{c.last_name ? ` ${c.last_name.charAt(0)}.` : ''}
                      </span>
                      <svg
                        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setDriverChips(prev => prev.filter(x => x.id !== c.id)); }}
                        width="10" height="10" viewBox="0 0 24 24" fill="none"
                        style={{ cursor: 'pointer', flexShrink: 0 }}
                      >
                        <path d="M18 6L6 18M6 6l12 12" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" />
                      </svg>
                    </div>
                  ))}
                </div>
                <button
                  onMouseDown={e => { e.preventDefault(); setDriverChips([]); setChipInput(''); }}
                  className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors self-start"
                >
                  <X size={9} /> Clear all
                </button>
              </div>
            )}

            {/* Typeahead dropdown (only while typing 2+ chars) */}
            {/* position: fixed + computed coords so the dropdown escapes every
                ancestor's overflow:hidden and floats above all page chrome. */}
            {chipDropOpen && chipInput.trim().length >= 2 && (
              <div
                className="shadow-xl"
                style={{
                  position: 'fixed',
                  top: dropdownPos.top,
                  left: dropdownPos.left,
                  width: dropdownPos.width,
                  zIndex: 9999,
                  background: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  maxHeight: '240px',
                  overflowY: 'auto',
                }}
              >
                {chipSuggestions.length === 0 ? (
                  <div style={{ padding: '10px 12px', color: '#9ca3af', fontSize: '12px' }}>
                    No drivers found
                  </div>
                ) : chipSuggestions.map((s, idx) => {
                  const [fp, fm, fs] = highlightParts(s.first_name || '', chipInput);
                  const [lp, lm, ls] = highlightParts(s.last_name  || '', chipInput);
                  const isHighlighted = idx === highlightedIndex;
                  return (
                    <div
                      key={s.id}
                      onMouseDown={e => {
                        e.preventDefault();
                        setDriverChips(prev => [...prev, { id: s.id, first_name: s.first_name || '', last_name: s.last_name || '' }]);
                        setChipInput('');
                        setHighlightedIndex(-1);
                        setChipDropOpen(false);
                        chipInputRef.current?.focus();
                      }}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      style={{
                        padding: '7px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        borderBottom: idx < chipSuggestions.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none',
                        background: isHighlighted ? 'rgba(255,255,255,0.06)' : 'transparent',
                      }}
                    >
                      <div style={{
                        width: '24px', height: '24px', borderRadius: '50%',
                        background: avatarColor(s.id),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '9px', fontWeight: 700, color: 'white', flexShrink: 0,
                        letterSpacing: '0.5px',
                      }}>
                        {initials(s.first_name, s.last_name)}
                      </div>
                      <div style={{ color: 'white', fontSize: '12px', fontWeight: 500, lineHeight: 1.2 }}>
                        <span>{fp}</span>
                        {fm && <span style={{ color: '#60a5fa', fontWeight: 700 }}>{fm}</span>}
                        <span>{fs}</span>
                        {s.last_name && <span> </span>}
                        <span>{lp}</span>
                        {lm && <span style={{ color: '#60a5fa', fontWeight: 700 }}>{lm}</span>}
                        <span>{ls}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="bg-white border border-card-border rounded-r-xl px-3 py-2.5 shadow-sm space-y-3">
            {/* Shift type multi-select */}
            <div ref={filterDropRef}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Shift Type</span>
                {filterShiftTypes.length > 0 && (
                  <button onClick={() => setFilterShiftTypes([])} className="text-[10px] text-blue-500 hover:text-blue-700 font-medium transition-colors">Clear</button>
                )}
              </div>
              <div className="relative">
                <button onClick={() => setFilterDropOpen(o => !o)} className="w-full flex items-center justify-between px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white hover:border-slate-300 transition-colors">
                  <span className="text-slate-600 truncate">
                    {filterShiftTypes.length === 0 ? 'All Types' : filterShiftTypes.length === 1 ? filterShiftTypes[0] : `${filterShiftTypes.length} selected`}
                  </span>
                  <ChevronDown size={11} className={`text-slate-400 flex-shrink-0 ml-1 transition-transform ${filterDropOpen ? 'rotate-180' : ''}`} />
                </button>
                {filterDropOpen && (
                  <div className="absolute top-full left-0 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1 max-h-52 overflow-y-auto">
                    {uniqueShiftTypes.map(t => (
                      <label key={t.id} className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-slate-50 transition-colors">
                        <input type="checkbox" checked={filterShiftTypes.includes(t.name)} onChange={e => setFilterShiftTypes(prev => e.target.checked ? [...prev, t.name] : prev.filter(n => n !== t.name))} className="w-3 h-3 rounded accent-primary flex-shrink-0" />
                        <span className="text-xs text-content">{t.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Show unscheduled toggle */}
            <label className="flex items-center gap-1.5 cursor-pointer border-t border-slate-100 pt-2">
              <input type="checkbox" checked={showUnscheduled} onChange={e => setShowUnscheduled(e.target.checked)} className="w-3.5 h-3.5 rounded accent-primary" />
              <span className="text-xs text-content">Show Unscheduled</span>
            </label>
          </div>

          {/* Driver count */}
          <div className="bg-white border border-card-border rounded-r-xl px-3 py-2 shadow-sm text-center">
            <p className="text-xl font-bold text-primary">{driverChips.length > 0 ? driverChips.length : filteredStaff.length}</p>
            <p className="text-[10px] text-content-muted">
              {driverChips.length > 0
                ? `driver${driverChips.length === 1 ? '' : 's'} selected`
                : `driver${filteredStaff.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        {/* ── Weekly Grid ─────────────────────────────────────────────────── */}
        <div ref={tableContainerRef} className="flex-1 min-w-0 overflow-auto bg-white border border-card-border rounded-xl shadow-sm pb-12">
          <table className="w-full text-sm min-w-[780px]">
            <thead className="sticky top-0 bg-white z-20 shadow-sm">
              <tr className="border-b border-[#CBD5E1]">
                <th className="text-left px-4 py-3 text-content-muted font-semibold w-44 text-xs uppercase tracking-wide sticky left-0 z-30 bg-white">
                  <div className="flex items-center gap-1 relative">
                    Driver
                    <button onClick={() => setSortOpen(o => !o)} className="text-[10px] text-slate-400 hover:text-primary transition-colors px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200">
                      {driverSort === 'first-asc' ? '↑A' : driverSort === 'first-desc' ? '↓A' : driverSort === 'last-asc' ? '↑Z' : driverSort === 'last-desc' ? '↓Z' : driverSort === 'shift-type' ? '⬡' : '⏱'} ▾
                    </button>
                    {sortOpen && (
                      <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1 text-left normal-case tracking-normal font-normal" onClick={e => e.stopPropagation()}>
                        {[
                          { key: 'first-asc',   label: 'First Name A→Z',  toggle: 'first-desc' },
                          { key: 'first-desc',  label: 'First Name Z→A',  toggle: 'first-asc' },
                          { key: 'last-asc',    label: 'Last Name A→Z',   toggle: 'last-desc' },
                          { key: 'last-desc',   label: 'Last Name Z→A',   toggle: 'last-asc' },
                          { key: 'shift-type',  label: 'Shift Type' },
                          { key: 'hours-desc',  label: 'Hours (High→Low)' },
                        ].map(opt => (
                          <button key={opt.key} onClick={() => {
                            if (driverSort === opt.key && opt.toggle) setDriverSort(opt.toggle);
                            else setDriverSort(opt.key);
                            setSortOpen(false);
                          }} className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2 ${driverSort === opt.key ? 'text-blue-600 font-semibold' : 'text-slate-600'}`}>
                            {driverSort === opt.key && <span className="text-blue-600">✓</span>}
                            <span>{opt.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </th>
                <th className="text-center px-1 py-3 text-content-subtle font-semibold w-10 text-[10px] uppercase tracking-wide sticky left-44 z-20 bg-white">Hrs</th>
                {weekDays.map((d, i) => {
                  const today = isToday(d);
                  const ds = format(d, 'yyyy-MM-dd');
                  const isFiltered = dayColFilter?.dateStr === ds && dayColFilter?.mode !== 'all';
                  return (
                    <th key={i} ref={el => { dayColRefs.current[i] = el; }} className={`text-center px-2 py-3 font-medium w-24 ${today ? 'bg-blue-50' : ''}`}>
                      <div className="flex flex-col items-center gap-0.5">
                        <p className={`text-xs font-semibold ${today ? 'text-blue-700' : 'text-content-muted'}`}>
                          {DAYS[i]} {format(d, 'd')}
                        </p>
                        {today && <span className="text-[8px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full uppercase">Today</span>}
                        <div className="relative">
                          <button
                            onClick={e => { e.stopPropagation(); setDayFilterDropOpen(prev => prev === ds ? null : ds); }}
                            className={`p-0.5 rounded transition-colors ${isFiltered ? 'text-[#2563EB]' : 'text-slate-300 hover:text-slate-500'}`}
                            title="Sort this column"
                          >
                            <ChevronDown size={10} />
                          </button>
                          {dayFilterDropOpen === ds && (
                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 w-44 py-1 text-left" onMouseDown={e => e.stopPropagation()}>
                              {[
                                { label: 'All (default)', mode: 'all' },
                                { label: 'By Route Code', mode: 'route' },
                                { label: 'By Shift Type', mode: 'shift_type' },
                                { label: 'By Start Time', mode: 'start_time' },
                              ].map(opt => {
                                const active = opt.mode === 'all' ? !isFiltered : dayColFilter?.dateStr === ds && dayColFilter?.mode === opt.mode;
                                return (
                                  <button key={opt.mode} className={`w-full text-left px-3 py-2 text-xs transition-colors ${active ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
                                    onClick={() => { setDayColFilter(opt.mode === 'all' ? null : { dateStr: ds, mode: opt.mode }); setDayFilterDropOpen(null); }}>
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
                Array.from({ length: 12 }).map((_, i) => (
                  <tr key={i} className={`border-b border-[#CBD5E1] animate-pulse ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                    <td className="px-4 py-3"><div className="h-3.5 bg-slate-200 rounded w-32 mb-1" /><div className="h-2.5 bg-slate-100 rounded w-16" /></td>
                    <td className="px-3 py-3"><div className="h-3 bg-slate-100 rounded w-8" /></td>
                    {weekDays.map((_, di) => (
                      <td key={di} className="px-1.5 py-1.5">{(i + di) % 3 !== 0 ? <div className="h-8 bg-slate-100 rounded-lg" /> : null}</td>
                    ))}
                  </tr>
                ))
              ) : sortedStaff.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-16 text-content-muted">No drivers match your filter</td></tr>
              ) : sortedStaff.map((s, idx) => (
                <tr key={s.id} className={`border-b border-[#CBD5E1] ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-blue-50/30 transition-colors group`}>
                  <td className={`px-4 py-2 sticky left-0 z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'} group-hover:bg-blue-50/30`}>
                    <p className="font-semibold text-content text-sm flex items-center gap-1.5">
                      {s.first_name} {s.last_name}
                      {s.is_rotating && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0" title="Rotating Driver">
                          <RefreshCw size={8} />ROT
                        </span>
                      )}
                    </p>
                    {/* transponder hidden — cleaner layout */}
                  </td>
                  <td className={`px-1 py-2 text-center sticky left-44 z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'} group-hover:bg-blue-50/30`}>
                    <span className="text-[10px] text-content-subtle">{hoursMap[s.id] ? `${hoursMap[s.id]}h` : '—'}</span>
                  </td>
                  {weekDays.map((d, di) => {
                    const dateStr = format(d, 'yyyy-MM-dd');
                    const key = `${s.id}-${dateStr}`;
                    const shift = shiftMap[key]?.[0];
                    const ck = cellKey(s.id, dateStr);
                    const isSel   = selectedCells.has(ck);
                    const isKbSel = selectedCell?.staffId === s.id && selectedCell?.dateStr === dateStr;
                    const isDrop  = dropTarget?.staffId === s.id && dropTarget?.dateStr === dateStr;
                    return (
                      <td
                        key={di}
                        data-cell-key={ck}
                        className={`px-1.5 py-1.5 select-none transition-colors ${isToday(d) ? 'bg-blue-50/70' : ''}`}
                        style={
                          isDrop  ? { boxShadow: 'inset 0 0 0 2px #16a34a', background: 'rgba(22,163,74,0.10)' } :
                          isSel   ? { boxShadow: 'inset 0 0 0 2px #2563EB', background: 'rgba(37,99,235,0.07)' } :
                          isKbSel ? { boxShadow: 'inset 0 0 0 2px #7c3aed', background: 'rgba(124,58,237,0.07)' } : {}
                        }
                        onMouseDown={isManager ? (e) => {
                          if (e.button !== 0) return;
                          if (!e.target.closest('[data-shift-drag]')) e.preventDefault();
                          setSelectionInProgress(true);
                          dragRef.current = { active: false, startStaffId: s.id, startDateStr: dateStr };
                        } : undefined}
                        onMouseEnter={isManager ? (e) => {
                          const dr = dragRef.current;
                          if (!dr.startStaffId) return;
                          if (!(e.buttons & 1)) return;
                          if (s.id === dr.startStaffId && dateStr === dr.startDateStr) return;
                          if (!dr.active) dr.active = true;
                          setSelectionAnchor({ staffId: dr.startStaffId, dateStr: dr.startDateStr });
                          setSelectedCells(getCellsInRect(
                            { staffId: dr.startStaffId, dateStr: dr.startDateStr },
                            { staffId: s.id, dateStr },
                            sortedStaff, weekDays
                          ));
                        } : undefined}
                        onMouseUp={isManager ? (e) => {
                          if (justDraggedRef.current) return;
                          const dr = dragRef.current;
                          if (dr.startStaffId && !dr.active) {
                            if (e.shiftKey) {
                              setSelectedCells(prev => {
                                const next = new Set(prev);
                                if (next.has(ck)) next.delete(ck); else next.add(ck);
                                return next;
                              });
                              setSelectionAnchor({ staffId: s.id, dateStr });
                            } else {
                              setSelectedCells(new Set());
                              setSelectionAnchor(null);
                              if (!shift) openAddShift(s.id, dateStr);
                              else openEditShift(shift);
                            }
                          }
                          // Always update keyboard-nav cell on plain click
                          if (!e.shiftKey && !dragRef.current.active) setSelectedCell({ staffId: s.id, dateStr });
                        } : undefined}
                        onDragOver={isManager ? (e) => {
                          if (!dragShiftRef.current) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setDropTarget({ staffId: s.id, dateStr });
                        } : undefined}
                        onDragLeave={isManager ? () => {
                          setDropTarget(prev => prev?.staffId === s.id && prev?.dateStr === dateStr ? null : prev);
                        } : undefined}
                        onDrop={isManager ? (e) => { e.preventDefault(); handleDropOnCell(s.id, dateStr); } : undefined}
                      >
                        <ShiftCell
                          shift={shift}
                          isManager={isManager}
                          isDragging={dragShift?.staffId === s.id && dragShift?.dateStr === dateStr}
                          shiftTypeMap={shiftTypeMap}
                          onShiftDragStart={shift ? () => {
                            const ds = { id: shift.id, staffId: s.id, dateStr };
                            dragShiftRef.current = ds;
                            setDragShift(ds);
                          } : undefined}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══ HOURS UPLOAD MODAL ═══════════════════════════════════════════════ */}
      <Modal isOpen={hoursUploadModal} onClose={() => setHoursUploadModal(false)} title={`Upload Hours — Week ${amazonWeek}`}>
        <div className="space-y-4">
          <p className="text-sm text-content-muted">Upload a CSV or Excel file with columns: <strong>Transponder ID</strong> and <strong>Hours</strong>.</p>
          <label className="block w-full border-2 border-dashed border-card-border rounded-xl p-6 text-center cursor-pointer hover:border-primary hover:bg-primary-50/30 transition-all">
            {hoursFile ? (
              <div><Check size={20} className="text-primary mx-auto mb-1" /><p className="text-sm font-medium text-content">{hoursFile.name}</p></div>
            ) : (
              <div><Upload size={20} className="text-content-subtle mx-auto mb-1" /><p className="text-sm text-content-muted">Click to select CSV or Excel file</p></div>
            )}
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => setHoursFile(e.target.files?.[0] || null)} />
          </label>
          <button className="btn-primary w-full" disabled={!hoursFile || uploadHours.isPending} onClick={() => uploadHours.mutate()}>
            {uploadHours.isPending ? 'Uploading…' : 'Upload & Match Hours'}
          </button>
          {driverHours.length > 0 && (
            <div className="border border-card-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-card-border bg-slate-50"><th className="text-left px-4 py-3 text-xs font-semibold text-content-muted uppercase tracking-wide">Driver</th><th className="text-left px-4 py-3 text-xs font-semibold text-content-muted uppercase tracking-wide">Transponder</th><th className="text-right px-4 py-3 text-xs font-semibold text-content-muted uppercase tracking-wide">Hours</th></tr></thead>
                <tbody>{driverHours.map(h => (<tr key={h.id} className="table-row"><td className="px-4 py-2 font-medium text-content">{h.first_name} {h.last_name}</td><td className="px-4 py-2 text-content-muted font-mono text-xs">{h.transponder_id || '—'}</td><td className="px-4 py-2 text-right font-bold text-content">{h.hours_worked}h</td></tr>))}</tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {/* ═══ ADD SHIFT MODAL ══════════════════════════════════════════════════ */}
      <Modal isOpen={!!addShiftModal} onClose={() => setAddShiftModal(null)} title="Add Shift">
        {addShiftModal && (
          <form ref={addShiftFormRef} className="space-y-4"
            onSubmit={e => {
              e.preventDefault();
              if (addShiftModal.bulkCells) {
                bulkApply.mutate({ cells: addShiftModal.bulkCells, shift_type: shiftForm.shift_type, start_time: shiftForm.start_time, end_time: shiftForm.end_time });
                setAddShiftModal(null);
                setSelectedCells(new Set());
                setSelectionAnchor(null);
              } else {
                createShift.mutate({ staff_id: addShiftModal.staff_id, shift_date: addShiftModal.date, ...shiftForm });
              }
            }}
            onKeyDown={e => { if (['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); } }}
          >
            <div className="text-[#111827] text-[15px] font-medium bg-slate-50 rounded-lg p-3">
              {addShiftModal.bulkCells
                ? `Apply to ${addShiftModal.bulkCells.length} cell${addShiftModal.bulkCells.length !== 1 ? 's' : ''}`
                : format(parseISO(addShiftModal.date), 'EEEE, MMMM d')}
            </div>
            <p className="text-[10px] text-content-muted -mt-1">↑ ↓ ← → to navigate · Enter to confirm · Esc to cancel</p>
            <div>
              <label className="modal-label">Shift Type</label>
              <div className="grid grid-cols-3 gap-2">
                {uniqueShiftTypes.map((t, idx) => (
                  <button key={t.id} type="button" data-shift-idx={idx} onClick={() => { setAddShiftKeyIndex(idx); handleShiftTypeChange(t.name); }}
                    className={`py-2 px-1 rounded-lg border-2 text-xs font-semibold transition-all text-center ${
                      shiftForm.shift_type === t.name
                        ? 'scale-105 shadow-sm'
                        : addShiftKeyIndex === idx
                          ? 'border-blue-400 bg-blue-50 text-blue-700'
                          : 'bg-white border-[#D1D5DB] text-[#374151] hover:border-slate-400'
                    }`}
                    style={shiftForm.shift_type === t.name ? getShiftStyleSelected(shiftTypeMap[t.name]?.color) : undefined}
                  >{t.name}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="modal-label">Start Time</label><input type="time" className="input" value={shiftForm.start_time} onChange={e => setShiftForm(f => ({ ...f, start_time: e.target.value }))} required /></div>
              <div><label className="modal-label">End Time</label><input type="time" className="input" value={shiftForm.end_time} onChange={e => setShiftForm(f => ({ ...f, end_time: e.target.value }))} required /></div>
            </div>
            <div><label className="modal-label">Notes (optional)</label><input type="text" className="input bg-[#F9FAFB]" value={shiftForm.notes} onChange={e => setShiftForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional note" /></div>
            <div className="flex gap-3 pt-1">
              <button type="button" className="btn-secondary flex-1" onClick={() => setAddShiftModal(null)}>Cancel</button>
              <button type="submit" className="btn-primary flex-1" disabled={createShift.isPending || bulkApply.isPending}>
                {createShift.isPending || bulkApply.isPending ? 'Saving…' : addShiftModal.bulkCells ? `Apply to ${addShiftModal.bulkCells.length} cell${addShiftModal.bulkCells.length !== 1 ? 's' : ''}` : 'Add Shift'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ═══ EDIT SHIFT MODAL ════════════════════════════════════════════════ */}
      <Modal isOpen={!!editShiftModal} onClose={() => setEditShiftModal(null)} title="Edit Shift">
        {editShiftModal && (
          <form ref={editShiftFormRef} onSubmit={e => { e.preventDefault(); updateShift.mutate({ id: editShiftModal.shift.id, ...editForm }); }}>
            <div className="text-[#111827] text-sm font-semibold bg-slate-50 rounded-lg px-3 py-2.5 mb-2">
              {editShiftModal.shift.shift_date ? format(parseISO(editShiftModal.shift.shift_date.split('T')[0]), 'EEEE, MMMM d') : ''}
              {editShiftModal.shift.first_name && <span className="text-content-muted font-normal"> — {editShiftModal.shift.first_name} {editShiftModal.shift.last_name}</span>}
            </div>
            <p className="text-[10px] text-content-muted mb-3">↑ ↓ ← → to change type · Enter to save · Esc to cancel</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-content-muted mb-2">Shift Details</p>
            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {uniqueShiftTypes.map((t, idx) => (
                <button key={t.id} type="button" data-edit-shift-idx={idx}
                  onClick={() => { const d = getShiftTypeDefaults(t.name); setEditForm(f => ({ ...f, shift_type: t.name, ...d })); setEditShiftKeyIndex(idx); editShiftKeyIndexRef.current = idx; }}
                  className={`py-1.5 px-1 rounded-lg border-2 text-[10px] font-semibold transition-all text-center ${
                    editForm.shift_type === t.name
                      ? 'scale-105 shadow-sm'
                      : editShiftKeyIndex === idx
                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                        : 'bg-white border-[#D1D5DB] text-[#374151] hover:border-slate-400'
                  }`}
                  style={editForm.shift_type === t.name ? getShiftStyleSelected(shiftTypeMap[t.name]?.color) : undefined}
                >{t.name}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div><label className="modal-label">Start</label><input type="time" className="input" value={editForm.start_time} onChange={e => setEditForm(f => ({ ...f, start_time: e.target.value }))} required /></div>
              <div><label className="modal-label">End</label><input type="time" className="input" value={editForm.end_time} onChange={e => setEditForm(f => ({ ...f, end_time: e.target.value }))} required /></div>
            </div>
            <div className="border-t border-card-border mb-4" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-content-muted mb-2">Attendance</p>
            <div className="flex gap-2 mb-2">
              {[
                { status: 'called_out', label: 'Call Out', activeCls: 'bg-orange-500 text-white border-orange-500' },
                { status: 'ncns',       label: 'NCNS',     activeCls: 'bg-red-700   text-white border-red-700'   },
                { status: 'late',       label: 'Late',     activeCls: 'bg-amber-400 text-white border-amber-400' },
              ].map(({ status, label, activeCls }) => {
                const isActive = editAttendanceStatus === status;
                return (
                  <button key={status} type="button" disabled={markAttendance.isPending}
                    onClick={() => {
                      const next = isActive ? null : status;
                      setEditAttendanceStatus(next);
                      markAttendance.mutate({ shiftId: editShiftModal.shift.id, status: next || 'present', notes: editAttendanceNotes });
                    }}
                    className={`flex-1 py-2 rounded-lg border-2 text-xs font-semibold transition-all ${isActive ? activeCls : 'bg-white border-[#D1D5DB] text-[#374151] hover:border-slate-400'}`}
                  >{label}</button>
                );
              })}
            </div>
            {editShiftModal.shift.attendance_marked_at && (
              <p className="text-[10px] text-content-muted italic mb-2">
                Marked by {editShiftModal.shift.attendance_marked_by_first} {editShiftModal.shift.attendance_marked_by_last}{' on '}
                {(() => { try { return format(new Date(editShiftModal.shift.attendance_marked_at), 'MMM d, h:mm a'); } catch { return ''; } })()}
              </p>
            )}
            <div className="mb-4">
              <label className="modal-label">Notes</label>
              <input type="text" className="input bg-[#F9FAFB]" value={editAttendanceNotes} onChange={e => setEditAttendanceNotes(e.target.value)} placeholder="Reason or context…" />
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" className="btn-danger text-sm px-3 py-1.5 flex items-center gap-1" onClick={() => deleteShift.mutate(editShiftModal.shift.id)} disabled={deleteShift.isPending}>
                <Trash2 size={13} /> Delete
              </button>
              <button type="button" className="btn-secondary flex-1" onClick={() => setEditShiftModal(null)}>Cancel</button>
              <button type="submit" className="btn-primary flex-1" disabled={updateShift.isPending}>{updateShift.isPending ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        )}
      </Modal>

      {/* ═══ PUBLISH MODAL ════════════════════════════════════════════════════ */}
      <Modal isOpen={publishModal} onClose={() => setPublishModal(false)} title="Publish Schedule" size="lg">
        {(() => {
          // Filter out optimistically-rejected shifts so they disappear immediately
          const visibleNew     = draftShifts.filter(s => !s.was_published  && !rejectedShiftIds.has(s.id));
          const visibleChanged = draftShifts.filter(s => !!s.was_published && !rejectedShiftIds.has(s.id));
          const visibleAll     = [...visibleNew, ...visibleChanged];

          const handleRejectShift = (s) => {
            // Optimistic: hide from modal + uncheck immediately
            setRejectedShiftIds(prev => { const n = new Set(prev); n.add(s.id); return n; });
            setSelectedShiftIds(prev => { const n = new Set(prev); n.delete(s.id); return n; });
            rejectShift.mutate(s);
          };
          const handleRejectAll = () => {
            visibleAll.forEach(s => handleRejectShift(s));
          };

          const sortFn = (a, b) => {
            const da = (a.shift_date || '').toString().slice(0, 10);
            const db = (b.shift_date || '').toString().slice(0, 10);
            if (da !== db) return da.localeCompare(db);
            return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
          };

          const renderRow = (s) => {
            const checked = selectedShiftIds.has(s.id);
            const dateStr = (s.shift_date || '').toString().slice(0, 10);
            return (
              <tr key={s.id} className={`transition-opacity ${!checked ? 'opacity-40' : ''}`}>
                <td className="px-3 py-2.5">
                  <input type="checkbox" checked={checked}
                    onChange={e => setSelectedShiftIds(prev => { const next = new Set(prev); e.target.checked ? next.add(s.id) : next.delete(s.id); return next; })}
                    className="rounded accent-primary w-3.5 h-3.5" />
                </td>
                <td className="px-3 py-2.5 font-medium text-content whitespace-nowrap">{s.first_name} {s.last_name}</td>
                <td className="px-3 py-2.5 text-content-muted whitespace-nowrap text-xs">{dateStr ? format(parseISO(dateStr), 'EEE MMM d') : '—'}</td>
                <td className="px-3 py-2.5">
                  {(() => {
                    // pending path: original → pending value
                    const fromType = s.has_pending_changes ? s.shift_type       : s.prev_shift_type;
                    const toType   = s.has_pending_changes ? (s.pending_shift_type || s.shift_type) : s.shift_type;
                    const hasChange = fromType && fromType !== toType;
                    return hasChange ? (
                      <span className="flex items-center gap-1 text-[11px]">
                        <span className="badge" style={getShiftStyle(shiftTypeMap[fromType]?.color)}>{fromType}</span>
                        <span className="text-slate-400">→</span>
                        <span className="badge" style={getShiftStyle(shiftTypeMap[toType]?.color)}>{toType}</span>
                      </span>
                    ) : (
                      <span className="badge text-[11px]" style={getShiftStyle(shiftTypeMap[toType]?.color)}>{toType}</span>
                    );
                  })()}
                </td>
                <td className="px-3 py-2.5 text-content-muted text-xs whitespace-nowrap">
                  {(() => {
                    const fromStart = s.has_pending_changes ? s.start_time : s.prev_start_time;
                    const fromEnd   = s.has_pending_changes ? s.end_time   : s.prev_end_time;
                    const toStart   = s.has_pending_changes ? (s.pending_start_time || s.start_time) : s.start_time;
                    const toEnd     = s.has_pending_changes ? (s.pending_end_time   || s.end_time)   : s.end_time;
                    const hasChange = fromStart && (fromStart?.slice(0,5) !== toStart?.slice(0,5) || fromEnd?.slice(0,5) !== toEnd?.slice(0,5));
                    return hasChange ? (
                      <span className="flex items-center gap-1">
                        <span className="line-through opacity-50">{fromStart?.slice(0,5)}–{fromEnd?.slice(0,5)}</span>
                        <span className="text-slate-400">→</span>
                        <span>{toStart?.slice(0,5)}–{toEnd?.slice(0,5)}</span>
                      </span>
                    ) : (
                      <span>{toStart?.slice(0,5)}–{toEnd?.slice(0,5)}</span>
                    );
                  })()}
                </td>
                <td className="px-2 py-2.5 text-right">
                  <button
                    onClick={() => handleRejectShift(s)}
                    className="text-[11px] text-red-400 hover:text-red-600 font-semibold px-2 py-0.5 rounded border border-red-200 hover:bg-red-50 transition-colors whitespace-nowrap"
                    title={s.was_published ? 'Revert to previously published shift' : 'Delete this shift entirely'}
                  >
                    Reject
                  </button>
                </td>
              </tr>
            );
          };

          const tableHeader = (
            <thead className="bg-slate-50 border-b border-card-border sticky top-0">
              <tr>
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-content-muted uppercase tracking-wide">Driver</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-content-muted uppercase tracking-wide">Date</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-content-muted uppercase tracking-wide">Shift</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-content-muted uppercase tracking-wide">Time</th>
                <th className="px-2 py-2 text-right text-xs font-semibold text-content-muted uppercase tracking-wide">Action</th>
              </tr>
            </thead>
          );

          return (
            <div className="space-y-4">
              {visibleAll.length === 0 && rejectedShiftIds.size === 0 ? (
                <div className="text-center py-10">
                  <Check size={28} className="text-emerald-500 mx-auto mb-3" />
                  <p className="text-content font-medium">Nothing to publish</p>
                  <p className="text-content-muted text-sm mt-1">All shifts for Week {amazonWeek} are already published.</p>
                </div>
              ) : visibleAll.length === 0 ? (
                <div className="text-center py-10">
                  <Check size={28} className="text-slate-400 mx-auto mb-3" />
                  <p className="text-content font-medium">All pending shifts rejected</p>
                  <p className="text-content-muted text-sm mt-1">{rejectedShiftIds.size} shift{rejectedShiftIds.size !== 1 ? 's' : ''} rejected — nothing left to publish.</p>
                </div>
              ) : (
                <>
                  {/* Header controls */}
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-content-muted">
                      <strong className="text-content">{selectedShiftIds.size}</strong> of <strong className="text-content">{visibleAll.length}</strong> shift{visibleAll.length !== 1 ? 's' : ''} selected
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        className="text-xs text-red-500 hover:text-red-700 font-semibold hover:underline transition-colors"
                        onClick={handleRejectAll}
                        title="Reject all — new shifts are deleted, changed shifts are reverted"
                      >
                        Reject All
                      </button>
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={() => setSelectedShiftIds(selectedShiftIds.size === visibleAll.length ? new Set() : new Set(visibleAll.map(s => s.id)))}
                      >
                        {selectedShiftIds.size === visibleAll.length ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {visibleNew.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">New Shifts ({visibleNew.length})</span>
                          <button className="text-[11px] text-slate-400 hover:text-slate-600" onClick={() => setSelectedShiftIds(prev => { const next = new Set(prev); visibleNew.forEach(s => next.add(s.id)); return next; })}>Select all</button>
                        </div>
                        <div className="border border-card-border rounded-xl overflow-hidden">
                          <table className="w-full text-sm">{tableHeader}<tbody className="divide-y divide-card-border">{[...visibleNew].sort(sortFn).map(renderRow)}</tbody></table>
                        </div>
                      </div>
                    )}
                    {visibleChanged.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">Changed Shifts ({visibleChanged.length})</span>
                          <button className="text-[11px] text-slate-400 hover:text-slate-600" onClick={() => setSelectedShiftIds(prev => { const next = new Set(prev); visibleChanged.forEach(s => next.add(s.id)); return next; })}>Select all</button>
                        </div>
                        <div className="border border-card-border rounded-xl overflow-hidden">
                          <table className="w-full text-sm">{tableHeader}<tbody className="divide-y divide-card-border">{[...visibleChanged].sort(sortFn).map(renderRow)}</tbody></table>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="flex gap-2.5 pt-1">
                <button className="btn-secondary" onClick={() => setPublishModal(false)}>
                  Cancel <span className="text-[10px] text-content-subtle ml-1">Esc</span>
                </button>
                {visibleAll.length > 0 && (<>
                  {/* Silent publish */}
                  <button
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm transition-colors disabled:opacity-50"
                    disabled={publishSelected.isPending || selectedShiftIds.size === 0}
                    onClick={() => publishSelected.mutate({ shiftIds: selectedShiftIds, notify: false })}
                    title="Shifts go live silently — drivers see it when they log in"
                  >
                    <Send size={13} />
                    {publishSelected.isPending
                      ? 'Publishing…'
                      : `Publish ${selectedShiftIds.size} Without Notifying`}
                    <span className="text-[10px] opacity-50 ml-0.5">↵</span>
                  </button>

                  {/* Notify publish */}
                  <button
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition-colors disabled:opacity-50"
                    disabled={publishSelected.isPending || selectedShiftIds.size === 0}
                    onClick={() => publishSelected.mutate({ shiftIds: selectedShiftIds, notify: true })}
                    title="Publish and send each driver an email with their shifts"
                  >
                    <span>📲</span>
                    {publishSelected.isPending
                      ? 'Publishing…'
                      : `Publish ${selectedShiftIds.size} & Notify Drivers`}
                  </button>
                </>)}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ═══ SETTINGS MODAL ═══════════════════════════════════════════════════ */}
      <Modal isOpen={settingsModal} onClose={() => setSettingsModal(false)} title="Scheduler Settings">
        <div className="space-y-5">
          <div>
            <h3 className="font-semibold text-content mb-3 text-sm uppercase tracking-wide text-content-muted">Shift Types</h3>
            <div className="space-y-2">
              {shiftTypes.map(t => (
                <div key={t.id} className="flex items-center gap-3 p-2.5 bg-slate-50 border border-card-border rounded-lg">
                  <span className="badge" style={getShiftStyle(t.color)}>{t.name}</span>
                  <span className="text-xs text-content-muted flex-1">{t.default_start_time?.slice(0,5)} – {t.default_end_time?.slice(0,5)}</span>
                  <span className={`w-3 h-3 rounded-full ${t.is_active ? 'bg-green-400' : 'bg-slate-300'}`} title={t.is_active ? 'Active' : 'Inactive'} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* ═══ MULTI-SELECT POPUP ════════════════════════════════════════════════ */}
      {isManager && selectedCells.size > 0 && !selectionInProgress && !shiftHeld && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto bg-white rounded-2xl shadow-2xl border border-slate-200 w-80 overflow-hidden" onMouseDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
              <span className="text-sm font-semibold text-slate-800">{selectedCells.size} cell{selectedCells.size !== 1 ? 's' : ''} selected</span>
              <button onClick={() => { setSelectedCells(new Set()); setSelectionAnchor(null); }} className="text-slate-400 hover:text-slate-600 transition-colors" title="Clear selection (Esc)"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5 block">Change Shift Type</label>
                <div className="flex gap-2">
                  <select value={bulkShiftType} onChange={e => setBulkShiftType(e.target.value)} className="select flex-1 text-sm">
                    <option value="">Select type…</option>
                    {shiftTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                  <button onClick={handleBulkApply} disabled={!bulkShiftType || bulkApply.isPending} className="btn-primary text-sm px-4 disabled:opacity-40 disabled:cursor-not-allowed">
                    {bulkApply.isPending ? 'Applying…' : 'Apply'}
                  </button>
                </div>
              </div>
              <div className="border-t border-slate-100" />
              {(() => {
                const cellDraftIds = new Set(
                  [...selectedCells].map(key => { const { staffId, dateStr } = parseCellKey(key); return shiftMap[`${staffId}-${dateStr}`]?.[0]; })
                    .filter(s => s && (s.publish_status === 'draft' || !s.publish_status))
                    .map(s => s.id)
                );
                if (cellDraftIds.size === 0) return null;
                return (
                  <button
                    onClick={() => { skipPublishResetRef.current = true; setSelectedShiftIds(cellDraftIds); setPublishModal(true); }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-sm font-medium transition-colors"
                  >
                    <Send size={14} /> Publish Selected Shifts ({cellDraftIds.size})
                  </button>
                );
              })()}
              <button onClick={handleBulkDeleteRequest} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium transition-colors">
                <Trash2 size={14} /> Delete Selected Shifts
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ BULK DELETE CONFIRM ══════════════════════════════════════════════ */}
      <Modal isOpen={bulkDeleteConfirm} onClose={() => setBulkDeleteConfirm(false)} title="Delete Shifts">
        <div className="space-y-4">
          {(() => {
            const cnt = [...selectedCells].filter(k => { const { staffId, dateStr } = parseCellKey(k); return !!shiftMap[`${staffId}-${dateStr}`]?.[0]; }).length;
            const recurringCnt = [...selectedCells].filter(k => {
              const { staffId, dateStr } = parseCellKey(k);
              if (!shiftMap[`${staffId}-${dateStr}`]?.[0]) return false;
              const dow = new Date(dateStr + 'T00:00:00').getDay();
              return recurringSet.has(`${staffId}|${dow}`);
            }).length;
            return (
              <>
                <p className="text-sm text-content-muted">Delete <strong className="text-content">{cnt}</strong> shift{cnt !== 1 ? 's' : ''}? This cannot be undone.</p>
                {recurringCnt > 0 && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <p className="text-sm text-slate-600"><strong>{recurringCnt}</strong> of the selected shift{recurringCnt !== 1 ? 's are' : ' is'} part of a recurring schedule.</p>
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={removeRecurringChecked} onChange={e => setRemoveRecurringChecked(e.target.checked)} className="mt-0.5 accent-red-500" />
                      <span className="text-sm text-slate-700">Also remove {recurringCnt !== 1 ? 'these drivers' : 'this driver'} from their recurring schedule permanently</span>
                    </label>
                  </div>
                )}
              </>
            );
          })()}
          <div className="flex gap-3 pt-1">
            <button className="btn-secondary flex-1" onClick={() => setBulkDeleteConfirm(false)}>Cancel <span className="text-[10px] text-content-subtle ml-1">Esc</span></button>
            <button className="btn-danger flex-1" disabled={bulkDelete.isPending} onClick={executeBulkDelete}>{bulkDelete.isPending ? 'Deleting…' : <><span>Delete Shifts</span><span className="text-[10px] opacity-70 ml-1">↵</span></>}</button>
          </div>
        </div>
      </Modal>

      {/* ═══ ROTATING DRIVER PROMPT ═══════════════════════════════════════════ */}
      {(() => {
        const rotatingDrivers = rotatingOverview.filter(d => d.is_rotating && d.recurring_rows.length >= 2);
        if (rotatingDrivers.length === 0) return null;
        return (
          <Modal isOpen={rotatingPromptOpen}
            onClose={() => { sessionStorage.setItem(`rotating_prompt_${weekStartStr}`, 'dismissed'); setRotatingPromptOpen(false); }}
            title="Set This Week's Role" size="md">
            <div className="space-y-4">
              <p className="text-sm text-slate-500">Select the shift type for each rotating driver for the week of <strong>{format(weekStart, 'MMM d')}</strong>.</p>
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
                            <input type="radio" name={`rotating_${driver.staff_id}`} value={row.id} checked={rotatingAssignments[driver.staff_id] === row.id} onChange={() => setRotatingAssignments(a => ({ ...a, [driver.staff_id]: row.id }))} className="accent-primary" />
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
                <button className="btn-secondary flex-1" onClick={() => { sessionStorage.setItem(`rotating_prompt_${weekStartStr}`, 'dismissed'); setRotatingPromptOpen(false); }}>Skip <span className="text-[10px] opacity-60 ml-1">Esc</span></button>
                <button className="btn-primary flex-1" disabled={rotatingApply.isPending}
                  onClick={() => {
                    const assignments = Object.entries(rotatingAssignments)
                      .filter(([, rowId]) => rowId != null)
                      .map(([staff_id, row_id]) => ({ staff_id: parseInt(staff_id), row_id }));
                    rotatingApply.mutate({ week_start: weekStartStr, assignments });
                  }}>
                  {rotatingApply.isPending ? 'Applying…' : <><span>Apply Roles</span><span className="text-[10px] opacity-70 ml-1">↵</span></>}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* ═══ FIXED BOTTOM SUMMARY BAR — R/RC per day ═════════════════════════ */}
      {dayColRects.length === 7 && (() => {
        const dailyTargets = routeCommitment?.daily_targets || {};
        const dayData = weekDays.map(d => {
          const dateStr = format(d, 'yyyy-MM-dd');
          const ds = daySummary[dateStr] || {};
          const r   = (ds['EDV'] || 0) + (ds['STEP VAN'] || 0) + (ds['HELPER'] || 0) + (ds['EXTRA'] || 0);
          const rc  = dailyTargets[dateStr] != null ? parseInt(dailyTargets[dateStr]) : null;
          return { dateStr, r, rc, edv: ds['EDV']||0, sv: ds['STEP VAN']||0, h: ds['HELPER']||0, e: ds['EXTRA']||0 };
        });
        const weeklyR    = dayData.reduce((s, d) => s + d.r, 0);
        const weeklyRC   = dayData.reduce((s, d) => s + (d.rc ?? 0), 0);
        const weeklyRCSet = dayData.some(d => d.rc != null);
        const weeklyMet  = weeklyRCSet ? weeklyR >= weeklyRC : null;

        const saveDailyRc = (dateStr) => {
          const val = parseInt(rcEditValue);
          const newTargets = { ...dailyTargets };
          if (!isNaN(val) && val >= 0) newTargets[dateStr] = val;
          else delete newTargets[dateStr];
          saveRouteCommitment.mutate({
            week_start: weekStartStr,
            daily_targets: newTargets,
            total_routes: Object.values(newTargets).reduce((s, v) => s + (v || 0), 0),
            edv_count: routeCommitment?.edv_count || 0,
            step_van_count: routeCommitment?.step_van_count || 0,
          });
          setRcEditDay(null);
        };

        return (
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#E2E8F0]" style={{ height: '52px', boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }}>
            <div className="absolute left-2 top-0 bottom-0 flex items-center pl-1">
              <div className="text-center">
                {/* Single-line: 21R/20RC — RED=below, YELLOW=equal or +1, GREEN=+2 or more */}
                <div className={`text-[15px] font-bold tabular-nums leading-none whitespace-nowrap ${
                  !weeklyRCSet           ? 'text-slate-500'
                  : weeklyR < weeklyRC   ? 'text-red-500'
                  : weeklyR >= weeklyRC + 2 ? 'text-emerald-600'
                  :                        'text-yellow-500'
                }`}>
                  {weeklyR}R{weeklyRCSet ? `/${weeklyRC}RC` : ''}
                </div>
                <div className="text-[9px] text-slate-400 leading-none mt-0.5">WEEK</div>
              </div>
            </div>
            {dayData.map(({ dateStr, r, rc, edv, sv, h, e }, i) => {
              const rect = dayColRects[i];
              if (!rect) return null;
              const isEditing = rcEditDay === dateStr;
              // Color: RED=below RC, YELLOW=equal or +1, GREEN=+2 or more above RC
              const dayColor = rc == null         ? 'text-[#111827]'
                             : r < rc             ? 'text-red-500'
                             : r >= rc + 2        ? 'text-emerald-600'
                             :                      'text-yellow-500';
              const label = rc != null ? `${r}R/${rc}RC` : `${r}R`;
              return (
                <div key={i} style={{ position: 'absolute', left: rect.left, width: rect.width, top: 0, bottom: 0 }} className="flex flex-col items-center justify-center group gap-0">
                  {isEditing ? (
                    /* Inline RC editor — show r count + input on one row */
                    <div className="flex items-center gap-0.5">
                      <span className={`text-[15px] font-bold tabular-nums leading-none ${dayColor}`}>{r}R/</span>
                      <input
                        autoFocus type="number" min="0" value={rcEditValue}
                        onChange={e => setRcEditValue(e.target.value)}
                        onBlur={() => saveDailyRc(dateStr)}
                        onKeyDown={e => { if (e.key === 'Enter') saveDailyRc(dateStr); if (e.key === 'Escape') setRcEditDay(null); e.stopPropagation(); }}
                        className="w-12 text-[13px] border border-blue-300 rounded px-1 py-0 text-center focus:outline-none leading-none font-bold"
                        style={{ height: '20px' }}
                      />
                    </div>
                  ) : isManager ? (
                    /* Single-line clickable label for managers */
                    <button
                      onClick={() => { setRcEditValue(rc != null ? String(rc) : ''); setRcEditDay(dateStr); }}
                      className={`text-[15px] font-bold tabular-nums leading-none whitespace-nowrap ${dayColor} hover:opacity-70 transition-opacity`}
                      title="Click to set daily route commitment"
                    >
                      {label}
                    </button>
                  ) : (
                    /* Read-only for non-managers */
                    <span className={`text-[15px] font-bold tabular-nums leading-none whitespace-nowrap ${dayColor}`}>
                      {label}
                    </span>
                  )}
                  {/* Hover tooltip */}
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block bg-white border border-[#E2E8F0] text-[#111827] text-[13px] leading-relaxed whitespace-nowrap z-10 pointer-events-none" style={{ borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.10)', padding: '10px 14px' }}>
                    <div>EDV: <strong>{edv}</strong></div>
                    <div>Step Van: <strong>{sv}</strong></div>
                    <div>Helper: <strong>{h}</strong></div>
                    {e > 0 && <div>Extra: <strong>{e}</strong></div>}
                    <div style={{ borderTop: '1px solid #E2E8F0', marginTop: '6px', paddingTop: '6px' }}>
                      <strong>Total: {r} DAs</strong>
                      {rc != null && <span className={`ml-2 font-semibold ${r >= rc ? 'text-emerald-600' : 'text-red-500'}`}>({rc} target — {r >= rc ? '✅ met' : `${rc - r} short`})</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
