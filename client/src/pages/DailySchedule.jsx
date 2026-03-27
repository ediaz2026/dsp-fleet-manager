import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  format, addDays, parseISO, isToday, startOfMonth, isSameDay, isSameMonth,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, ChevronDown, Plus, X, Check, Search,
} from 'lucide-react';
import api from '../api/client';
import Modal from '../components/Modal';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useSyncService } from '../services/syncService';
import { getShiftStyle, buildShiftTypeMap } from '../utils/shiftColors';

// ─── Main Component ────────────────────────────────────────────────────────────
export default function DailySchedule() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { notifyScheduleChanged } = useSyncService();
  const isManager = ['manager', 'admin', 'dispatcher'].includes(user?.role);

  // ── Date state ────────────────────────────────────────────────────────────
  const [dailyDate, setDailyDate] = useState(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarViewMonth, setCalendarViewMonth] = useState(() => startOfMonth(new Date()));
  const calendarRef = useRef(null);

  // ── Organize by ───────────────────────────────────────────────────────────
  const [organizeBy, setOrganizeBy] = useState('name'); // 'name'|'route'|'shift_type'|'start_time'

  // ── Filter state ──────────────────────────────────────────────────────────
  const [filterShiftTypes, setFilterShiftTypes] = useState([]);
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const [filterDropOpen, setFilterDropOpen] = useState(false);
  const filterDropRef = useRef(null);

  // ── Multi-driver chip search ───────────────────────────────────────────────
  const [driverChips, setDriverChips]     = useState([]);
  const [chipInput, setChipInput]         = useState('');
  const [chipDropOpen, setChipDropOpen]   = useState(false);
  const chipInputRef     = useRef();
  const chipContainerRef = useRef();

  // ── Shift type dropdown per row ────────────────────────────────────────────
  const [dailyShiftTypeDrop, setDailyShiftTypeDrop] = useState(null); // staffId | null
  const dailyShiftTypeDropRef = useRef(null);
  const dailyMouseDownPosRef  = useRef({});

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  const dragShiftRef = useRef(null);
  const [dragShift, setDragShift]   = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  // ── Add shift modal ───────────────────────────────────────────────────────
  const [addShiftModal, setAddShiftModal]       = useState(null); // { staff_id, date }
  const [shiftForm, setShiftForm]               = useState({ shift_type: 'EDV', start_time: '07:00', end_time: '17:00', notes: '' });
  const [addShiftKeyIndex, setAddShiftKeyIndex] = useState(0);
  const addShiftKeyIndexRef = useRef(0);
  const addShiftFormRef     = useRef(null);

  // ── Edit shift modal ──────────────────────────────────────────────────────
  const [editShiftModal, setEditShiftModal]             = useState(null);
  const [editForm, setEditForm]                         = useState({ shift_type: 'EDV', start_time: '07:00', end_time: '17:00', notes: '' });
  const [editAttendanceStatus, setEditAttendanceStatus] = useState(null);
  const [editAttendanceNotes, setEditAttendanceNotes]   = useState('');

  // ─────────────────────────────────────────────────────────────────────────
  const dateStr = format(dailyDate, 'yyyy-MM-dd');

  // ── Data Fetching ─────────────────────────────────────────────────────────
  const { data: shifts = [], isLoading: shiftsLoading } = useQuery({
    queryKey: ['shifts-daily', dateStr],
    queryFn: () => api.get('/shifts', { params: { start: dateStr, end: dateStr } }).then(r => r.data),
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

  // Ops planner session — for route-code sort
  const { data: opsPlanSession } = useQuery({
    queryKey: ['ops-plan-session', dateStr],
    queryFn: () => api.get(`/ops-planner?date=${dateStr}`).then(r => r.data).catch(() => null),
    enabled: organizeBy === 'route',
  });

  // ── Shift map ─────────────────────────────────────────────────────────────
  const shiftMap = useMemo(() => {
    const map = {};
    shifts.forEach(s => {
      const ds = s.shift_date?.split('T')[0] || s.shift_date;
      const key = `${s.staff_id}-${ds}`;
      if (!map[key]) map[key] = [];
      map[key].push(s);
    });
    return map;
  }, [shifts]);

  // ── Route code map (from ops planner session) ─────────────────────────────
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

  // ── Deduplicated shift types ───────────────────────────────────────────────
  const uniqueShiftTypes = useMemo(
    () => shiftTypes.filter((t, i, arr) =>
      arr.findIndex(x => x.name.trim().toLowerCase() === t.name.trim().toLowerCase()) === i
    ),
    [shiftTypes]
  );

  // ── Chip suggestions ───────────────────────────────────────────────────────
  const chipSuggestions = useMemo(() => {
    if (!chipInput.trim()) return [];
    const q = chipInput.toLowerCase();
    return staff
      .filter(s => !driverChips.some(c => c.id === s.id))
      .filter(s => `${s.first_name} ${s.last_name}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [staff, driverChips, chipInput]);

  // ── Filtered drivers ──────────────────────────────────────────────────────
  const filteredStaff = useMemo(() => {
    let list = staff;
    if (driverChips.length > 0) {
      list = list.filter(s => driverChips.some(c => c.id === s.id));
    } else if (chipInput.trim()) {
      const q = chipInput.toLowerCase();
      list = list.filter(s => `${s.first_name} ${s.last_name}`.toLowerCase().includes(q));
    }
    if (!showUnscheduled) {
      list = list.filter(s => shiftMap[`${s.id}-${dateStr}`]?.length > 0);
    }
    if (filterShiftTypes.length > 0) {
      list = list.filter(s => shiftMap[`${s.id}-${dateStr}`]?.some(sh => filterShiftTypes.includes(sh.shift_type)));
    }
    return list;
  }, [staff, driverChips, chipInput, showUnscheduled, filterShiftTypes, shiftMap, dateStr]);

  // ── Sorted drivers ────────────────────────────────────────────────────────
  const sortedStaff = useMemo(() => {
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
        const sa = shiftMap[`${a.id}-${dateStr}`]?.[0]?.shift_type || '';
        const sb = shiftMap[`${b.id}-${dateStr}`]?.[0]?.shift_type || '';
        const ia = ORDER.indexOf(sa); const ib = ORDER.indexOf(sb);
        if (ia === -1 && ib === -1) return sa.localeCompare(sb);
        if (ia === -1) return 1; if (ib === -1) return -1;
        return ia - ib;
      });
    } else if (organizeBy === 'start_time') {
      list.sort((a, b) => {
        const ta = shiftMap[`${a.id}-${dateStr}`]?.[0]?.start_time || '99:99';
        const tb = shiftMap[`${b.id}-${dateStr}`]?.[0]?.start_time || '99:99';
        return ta.localeCompare(tb);
      });
    } else {
      list.sort((a, b) =>
        `${a.last_name} ${a.first_name}`.toLowerCase().localeCompare(`${b.last_name} ${b.first_name}`.toLowerCase())
      );
    }
    return list;
  }, [filteredStaff, organizeBy, dateStr, shiftMap, routeCodeMap]);

  // ── Helper ────────────────────────────────────────────────────────────────
  const getShiftTypeDefaults = useCallback((typeName) => {
    const t = shiftTypes.find(t => t.name === typeName);
    return { start_time: t?.default_start_time?.slice(0, 5) || '07:00', end_time: t?.default_end_time?.slice(0, 5) || '17:00' };
  }, [shiftTypes]);

  const invalidateShifts = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['shifts-daily', dateStr] });
    qc.invalidateQueries({ queryKey: ['shifts'] }); // also updates weekly view
    notifyScheduleChanged(dateStr);
  }, [qc, dateStr, notifyScheduleChanged]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createShift = useMutation({
    mutationFn: data => api.post('/shifts', data),
    onSuccess: () => { invalidateShifts(); toast.success('Shift added'); setAddShiftModal(null); },
    onError: err => toast.error(err.response?.data?.error || 'Failed to add shift'),
  });

  const deleteShift = useMutation({
    mutationFn: id => api.delete(`/shifts/${id}`),
    onSuccess: () => { invalidateShifts(); toast.success('Shift removed'); setEditShiftModal(null); },
  });

  const updateShift = useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/shifts/${id}`, data),
    onSuccess: () => { invalidateShifts(); toast.success('Shift updated'); setEditShiftModal(null); },
    onError: err => toast.error(err.response?.data?.error || 'Failed to update shift'),
  });

  const markAttendance = useMutation({
    mutationFn: ({ shiftId, status, notes }) => {
      const s = shifts.find(x => x.id === shiftId);
      return api.post('/attendance', {
        staff_id: s?.staff_id,
        shift_id: shiftId,
        attendance_date: s?.shift_date?.split('T')[0],
        status,
        notes: notes || '',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts-daily', dateStr] });
      qc.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Attendance updated');
    },
  });

  const moveShift = useMutation({
    mutationFn: ({ id, staff_id, shift_date }) =>
      api.post(`/shifts/${id}/move`, { staff_id, shift_date }).then(r => r.data),
    onSuccess: () => { invalidateShifts(); toast.success('Shift moved'); },
    onError: err => toast.error(err.response?.data?.error || 'Failed to move shift'),
  });

  // ── Drag-and-drop: drop handler ────────────────────────────────────────────
  const moveShiftRef = useRef(null);
  moveShiftRef.current = moveShift;

  const handleDropOnCell = useCallback((staffId) => {
    const ds = dragShiftRef.current;
    if (!ds) return;
    dragShiftRef.current = null;
    setDragShift(null);
    setDropTarget(null);
    if (ds.staffId === staffId) return; // same row — no-op

    const targetShift = shiftMap[`${staffId}-${dateStr}`]?.[0];
    if (targetShift) {
      // Swap both shifts on the same date
      Promise.all([
        moveShiftRef.current.mutateAsync({ id: ds.id, staff_id: staffId, shift_date: dateStr }),
        moveShiftRef.current.mutateAsync({ id: targetShift.id, staff_id: ds.staffId, shift_date: dateStr }),
      ]).catch(() => {});
    } else {
      moveShiftRef.current.mutate({ id: ds.id, staff_id: staffId, shift_date: dateStr });
    }
  }, [shiftMap, dateStr]);

  // ── Open modals ───────────────────────────────────────────────────────────
  const openAddShift = useCallback((staffId) => {
    const defaults = getShiftTypeDefaults('EDV');
    setShiftForm({ shift_type: 'EDV', ...defaults, notes: '' });
    setAddShiftKeyIndex(0);
    addShiftKeyIndexRef.current = 0;
    setAddShiftModal({ staff_id: staffId, date: dateStr });
  }, [dateStr, getShiftTypeDefaults]);

  const openEditShift = useCallback((shift) => {
    setEditForm({
      shift_type: shift.shift_type,
      start_time: shift.start_time?.slice(0, 5) || '07:00',
      end_time:   shift.end_time?.slice(0, 5)   || '17:00',
      notes:      shift.notes || '',
    });
    setEditAttendanceStatus(shift.attendance_status && shift.attendance_status !== 'present' ? shift.attendance_status : null);
    setEditAttendanceNotes(shift.attendance_notes || '');
    setEditShiftModal({ shift });
  }, []);

  // ── Keyboard: arrow keys in Add Shift modal ───────────────────────────────
  useEffect(() => { addShiftKeyIndexRef.current = addShiftKeyIndex; }, [addShiftKeyIndex]);

  useEffect(() => {
    if (!addShiftModal) return;
    const capture = (e) => {
      const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
      const isEnter = e.key === 'Enter';
      if (!isArrow && !isEnter) return;
      e.preventDefault();
      e.stopPropagation();
      if (isEnter) { addShiftFormRef.current?.requestSubmit(); return; }
      const len = uniqueShiftTypes.length;
      if (len === 0) return;
      const isNext = e.key === 'ArrowDown' || e.key === 'ArrowRight';
      const next = isNext
        ? (addShiftKeyIndexRef.current + 1) % len
        : (addShiftKeyIndexRef.current - 1 + len) % len;
      addShiftKeyIndexRef.current = next;
      setAddShiftKeyIndex(next);
      const t = uniqueShiftTypes[next];
      if (t) {
        const found = shiftTypes.find(s => s.name === t.name);
        setShiftForm(f => ({
          ...f,
          shift_type: t.name,
          start_time: found?.default_start_time?.slice(0, 5) || '07:00',
          end_time:   found?.default_end_time?.slice(0, 5)   || '17:00',
        }));
      }
    };
    document.addEventListener('keydown', capture, { capture: true });
    return () => document.removeEventListener('keydown', capture, { capture: true });
  }, [addShiftModal, uniqueShiftTypes, shiftTypes]);

  // ── Keyboard: arrow keys for day navigation (when no modal open) ──────────
  useEffect(() => {
    const onKeyDown = (e) => {
      if (addShiftModal || editShiftModal) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); setDailyDate(d => addDays(d, -1)); }
      if (e.key === 'ArrowRight') { e.preventDefault(); setDailyDate(d => addDays(d, 1)); }
      if (e.key === 'Escape') { setCalendarOpen(false); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [addShiftModal, editShiftModal]);

  // ── Close calendar on outside click ──────────────────────────────────────
  useEffect(() => {
    if (!calendarOpen) return;
    const handler = (e) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target)) setCalendarOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [calendarOpen]);

  // ── Close shift type dropdown on outside click ────────────────────────────
  useEffect(() => {
    if (!dailyShiftTypeDrop) return;
    const handler = (e) => {
      if (dailyShiftTypeDropRef.current && !dailyShiftTypeDropRef.current.contains(e.target)) {
        setDailyShiftTypeDrop(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dailyShiftTypeDrop]);

  // ── Close chip dropdown + filter dropdown on outside click ────────────────
  useEffect(() => {
    const handler = (e) => {
      if (chipContainerRef.current && !chipContainerRef.current.contains(e.target)) setChipDropOpen(false);
      if (filterDropRef.current && !filterDropRef.current.contains(e.target)) setFilterDropOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Clear drag state on dragend ───────────────────────────────────────────
  useEffect(() => {
    const onDragEnd = () => { dragShiftRef.current = null; setDragShift(null); setDropTarget(null); };
    document.addEventListener('dragend', onDragEnd);
    return () => document.removeEventListener('dragend', onDragEnd);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full relative">

      {/* ── Header row ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4 min-w-0">

        {/* View tab toggle */}
        <div className="flex bg-white border border-card-border rounded-lg p-0.5 shadow-sm flex-shrink-0">
          <button
            onClick={() => navigate('/schedule')}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition-all text-content-muted hover:text-content"
          >
            Weekly
          </button>
          <button className="px-3 py-1.5 rounded-md text-sm font-medium transition-all bg-primary text-white shadow-sm">
            Daily
          </button>
          <button
            onClick={() => navigate('/operational-planner')}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition-all text-content-muted hover:text-content"
          >
            Ops Planner
          </button>
        </div>

        {/* Date navigator */}
        <div className="flex-1 flex items-center justify-center gap-1 min-w-0">
          <button
            onClick={() => setDailyDate(d => addDays(d, -1))}
            className="p-2 rounded-lg text-[#374151] hover:text-[#2563EB] transition-colors flex-shrink-0"
            aria-label="Previous day"
          >
            <ChevronLeft size={22} strokeWidth={2.5} />
          </button>

          {/* Date button — opens calendar */}
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
              const gridStart = (() => {
                const d = new Date(monthStart);
                d.setDate(d.getDate() - d.getDay());
                return d;
              })();
              const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
              const weeks = Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7));
              return (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-white rounded-xl shadow-xl border border-slate-200 p-4 z-50 w-72 select-none">
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
                  <div className="grid grid-cols-7 mb-1">
                    {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                      <span key={d} className="text-center text-[11px] font-semibold text-slate-400 py-1">{d}</span>
                    ))}
                  </div>
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
                              sel ? 'bg-blue-600 text-white' : inMonth ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 hover:bg-slate-50'
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
        </div>

        {/* Today button */}
        {!isToday(dailyDate) && (
          <button
            onClick={() => setDailyDate(new Date())}
            className="btn-secondary text-xs flex-shrink-0"
          >
            Today
          </button>
        )}
      </div>

      {/* ── Body: filter panel + list ─────────────────────────────────────── */}
      <div className="flex gap-2 flex-1 min-h-0 -ml-6">

        {/* Left filter panel */}
        <div className="w-52 flex-shrink-0 flex flex-col gap-2">

          {/* Driver chip search */}
          <div
            ref={chipContainerRef}
            className="relative bg-white border border-card-border rounded-r-xl shadow-sm cursor-text"
            onClick={() => chipInputRef.current?.focus()}
          >
            <div className="flex flex-wrap gap-1 p-2 min-h-[2.5rem]">
              <Search size={14} className="text-content-subtle mt-1 flex-shrink-0" />
              {driverChips.map(c => (
                <span key={c.id} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-medium">
                  {c.name.split(' ')[0]}
                  <button
                    type="button"
                    className="hover:text-red-500 transition-colors"
                    onClick={e => { e.stopPropagation(); setDriverChips(chips => chips.filter(x => x.id !== c.id)); }}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              <input
                ref={chipInputRef}
                value={chipInput}
                onChange={e => { setChipInput(e.target.value); setChipDropOpen(true); }}
                onFocus={() => { if (chipInput.trim()) setChipDropOpen(true); }}
                placeholder={driverChips.length === 0 ? 'Search drivers…' : ''}
                className="flex-1 min-w-[60px] bg-transparent text-xs outline-none text-content placeholder:text-content-subtle"
              />
            </div>
            {chipDropOpen && chipSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-card-border rounded-xl shadow-xl z-30 py-1">
                {chipSuggestions.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 text-content"
                    onMouseDown={e => {
                      e.preventDefault();
                      setDriverChips(chips => [...chips, { id: s.id, name: `${s.first_name} ${s.last_name}` }]);
                      setChipInput('');
                      setChipDropOpen(false);
                    }}
                  >
                    {s.first_name} {s.last_name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Shift type filter */}
          <div ref={filterDropRef} className="relative">
            <button
              onClick={() => setFilterDropOpen(o => !o)}
              className="w-full flex items-center justify-between gap-2 bg-white border border-card-border rounded-r-xl shadow-sm px-3 py-2 text-xs text-content-muted hover:text-content transition-colors"
            >
              <span className="font-medium truncate">
                {filterShiftTypes.length === 0 ? 'All Shift Types' : `${filterShiftTypes.length} type${filterShiftTypes.length !== 1 ? 's' : ''}`}
              </span>
              <ChevronDown size={12} className={`flex-shrink-0 transition-transform ${filterDropOpen ? 'rotate-180' : ''}`} />
            </button>
            {filterDropOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-card-border rounded-xl shadow-xl z-30 py-1">
                {filterShiftTypes.length > 0 && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 font-medium"
                    onClick={() => { setFilterShiftTypes([]); setFilterDropOpen(false); }}
                  >
                    Clear filter
                  </button>
                )}
                {uniqueShiftTypes.map(t => {
                  const active = filterShiftTypes.includes(t.name);
                  return (
                    <button
                      key={t.id}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-slate-50 ${active ? 'text-primary font-semibold' : 'text-content'}`}
                      onClick={() => setFilterShiftTypes(arr =>
                        active ? arr.filter(x => x !== t.name) : [...arr, t.name]
                      )}
                    >
                      {active && <Check size={10} className="text-primary flex-shrink-0" />}
                      {!active && <span className="w-2.5 flex-shrink-0" />}
                      {t.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Show unscheduled toggle */}
          <button
            onClick={() => setShowUnscheduled(v => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-r-xl border shadow-sm text-xs font-medium transition-all ${
              showUnscheduled
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'bg-white border-card-border text-content-muted hover:text-content'
            }`}
          >
            <span className={`w-3 h-3 rounded-sm border-2 flex items-center justify-center flex-shrink-0 ${showUnscheduled ? 'bg-primary border-primary' : 'border-slate-300'}`}>
              {showUnscheduled && <Check size={8} className="text-white" />}
            </span>
            Show unscheduled
          </button>

          {/* Summary */}
          <div className="bg-white border border-card-border rounded-r-xl shadow-sm p-3 text-xs space-y-1">
            <p className="font-semibold text-content-muted uppercase tracking-wide text-[10px] mb-2">Today's Summary</p>
            {['EDV', 'STEP VAN', 'HELPER', 'EXTRA'].map(type => {
              const count = shifts.filter(s => s.shift_type === type).length;
              return count > 0 ? (
                <div key={type} className="flex justify-between items-center">
                  <span className="text-content-muted">{type}</span>
                  <span className="font-bold text-content">{count}</span>
                </div>
              ) : null;
            })}
            <div className="border-t border-card-border pt-1 mt-1 flex justify-between">
              <span className="text-content-muted">Total scheduled</span>
              <span className="font-bold text-content">{sortedStaff.filter(s => shiftMap[`${s.id}-${dateStr}`]?.length).length}</span>
            </div>
          </div>
        </div>

        {/* ── Main content ──────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto bg-white border border-card-border rounded-xl shadow-sm">
          {/* Organize by */}
          <div className="flex items-center justify-end gap-2 px-4 pt-3 pb-2 border-b border-card-border">
            <label className="text-xs font-medium text-content-muted whitespace-nowrap">Organize by</label>
            <select
              className="select text-sm py-1 w-36"
              value={organizeBy}
              onChange={e => setOrganizeBy(e.target.value)}
            >
              <option value="name">Driver Name</option>
              <option value="route">Route Code</option>
              <option value="shift_type">Shift Type</option>
              <option value="start_time">Start Time</option>
            </select>
          </div>

          {organizeBy === 'route' && !opsPlanSession?.rows?.length && (
            <p className="text-xs text-amber-600 px-4 py-2">
              No Ops Planner session found for this date — upload routes in Ops Planner first.
            </p>
          )}

          {/* Driver rows */}
          {shiftsLoading ? (
            <div className="flex items-center justify-center py-16 text-content-muted text-sm">Loading…</div>
          ) : sortedStaff.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-content-muted text-sm">
              {showUnscheduled ? 'No drivers found' : 'No shifts scheduled — toggle "Show unscheduled" to see all drivers'}
            </div>
          ) : (
            <div className="space-y-1.5 p-4">
              {sortedStaff.map(s => {
                const shift = shiftMap[`${s.id}-${dateStr}`]?.[0];
                const routeCode = routeCodeMap[s.id];
                const isDropping = dropTarget?.staffId === s.id;
                const isDraggingThis = dragShift?.staffId === s.id;
                const attStatus = shift?.attendance_status;
                const shiftCellStyle = getShiftStyle(shiftTypeMap[shift?.shift_type]?.color);
                const isDraft = shift && (shift.publish_status === 'draft' || !shift.publish_status);
                const isShiftTypeDropOpen = dailyShiftTypeDrop === s.id;

                return (
                  <div
                    key={s.id}
                    className={`flex items-center gap-3 px-3 py-2.5 bg-white border rounded-xl transition-colors ${
                      isDropping ? 'border-primary bg-primary-50/40 shadow-sm' : 'border-card-border hover:border-primary/30'
                    }`}
                    onDragOver={isManager ? (e) => {
                      if (!dragShiftRef.current) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDropTarget({ staffId: s.id });
                    } : undefined}
                    onDragLeave={isManager ? () => {
                      setDropTarget(prev => prev?.staffId === s.id ? null : prev);
                    } : undefined}
                    onDrop={isManager ? (e) => {
                      e.preventDefault();
                      handleDropOnCell(s.id);
                    } : undefined}
                  >
                    {/* Driver info */}
                    <div className="w-36 flex-shrink-0">
                      <p className="font-semibold text-sm text-content leading-tight">{s.first_name} {s.last_name}</p>
                      <p className="text-xs text-content-subtle">{s.employee_id}</p>
                      {organizeBy === 'route' && routeCode && (
                        <p className="text-xs font-mono font-semibold text-primary">{routeCode}</p>
                      )}
                      {organizeBy === 'route' && !routeCode && (
                        <p className="text-[10px] text-slate-400 italic">No Route</p>
                      )}
                    </div>

                    {/* Shift bar */}
                    <div className="flex-1 flex items-center gap-2 min-w-0">
                      {shift ? (
                        <>
                          {/* Shift card */}
                          <div className={`relative flex-1 rounded-lg border px-2.5 py-1.5 ${isDraggingThis ? 'opacity-40' : ''} min-w-0`} style={shiftCellStyle}>
                            {isManager && isDraft && (
                              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none z-10 shadow-sm pointer-events-none select-none" title="Draft — not published">!</span>
                            )}
                            <div className="flex items-center gap-1.5">
                              {/* Draggable / clickable content */}
                              <div
                                className={`flex-1 min-w-0 ${isManager ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
                                draggable={isManager ? true : undefined}
                                onMouseDown={e => { dailyMouseDownPosRef.current[s.id] = { x: e.clientX, y: e.clientY }; }}
                                onClick={() => { if (isManager) openEditShift(shift); }}
                                onDragStart={isManager ? e => {
                                  const p = dailyMouseDownPosRef.current[s.id];
                                  if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) {
                                    e.preventDefault(); return;
                                  }
                                  e.stopPropagation();
                                  e.dataTransfer.effectAllowed = 'move';
                                  e.dataTransfer.setData('text/plain', String(shift.id));
                                  const ds = { id: shift.id, staffId: s.id, dateStr };
                                  dragShiftRef.current = ds;
                                  setDragShift(ds);
                                } : undefined}
                                onDragEnd={() => { dragShiftRef.current = null; setDragShift(null); setDropTarget(null); }}
                              >
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-bold truncate">{shift.shift_type}</span>
                                  <span className="text-[10px] opacity-70 whitespace-nowrap">{shift.start_time?.slice(0,5)}–{shift.end_time?.slice(0,5)}</span>
                                  {attStatus && attStatus !== 'present' && (
                                    <span className={`text-[10px] font-bold uppercase px-1 py-0.5 rounded ${
                                      attStatus === 'called_out' ? 'bg-yellow-200 text-yellow-800' :
                                      attStatus === 'ncns'       ? 'bg-red-200 text-red-800' :
                                      attStatus === 'late'       ? 'bg-orange-200 text-orange-800' : ''
                                    }`}>{attStatus.replace('_',' ')}</span>
                                  )}
                                </div>
                              </div>

                              {/* Shift type dropdown arrow */}
                              {isManager && (
                                <div className="relative flex-shrink-0" ref={isShiftTypeDropOpen ? dailyShiftTypeDropRef : null}>
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); setDailyShiftTypeDrop(isShiftTypeDropOpen ? null : s.id); }}
                                    className="p-0.5 rounded hover:bg-black/10 transition-colors opacity-60 hover:opacity-100"
                                    title="Change shift type"
                                  >
                                    <ChevronDown size={12} />
                                  </button>
                                  {isShiftTypeDropOpen && (
                                    <div className="absolute right-0 top-full mt-1 bg-white border border-card-border rounded-lg shadow-xl z-50 py-1 min-w-[130px]">
                                      {uniqueShiftTypes.map(t => (
                                        <button
                                          key={t.id}
                                          type="button"
                                          onClick={e => {
                                            e.stopPropagation();
                                            const d = getShiftTypeDefaults(t.name);
                                            updateShift.mutate({ id: shift.id, shift_type: t.name, start_time: d.start_time, end_time: d.end_time, notes: shift.notes || '' });
                                            setDailyShiftTypeDrop(null);
                                          }}
                                          className={`w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 transition-colors ${shift.shift_type === t.name ? 'text-primary bg-primary-50' : 'text-content'}`}
                                        >
                                          {t.name}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Attendance buttons — FAR RIGHT */}
                          {isManager && (
                            <div className="flex items-center gap-1 flex-shrink-0 ml-auto">
                              {[
                                { key: 'called_out', label: 'CO',   activeClass: 'bg-yellow-500 text-white border-yellow-500', inactiveClass: 'bg-white text-yellow-600 border-yellow-300 hover:bg-yellow-50' },
                                { key: 'ncns',       label: 'NCNS', activeClass: 'bg-red-500 text-white border-red-500',        inactiveClass: 'bg-white text-red-600 border-red-300 hover:bg-red-50' },
                                { key: 'late',       label: 'LATE', activeClass: 'bg-orange-500 text-white border-orange-500',  inactiveClass: 'bg-white text-orange-600 border-orange-300 hover:bg-orange-50' },
                              ].map(btn => {
                                const isActive = attStatus === btn.key;
                                return (
                                  <button
                                    key={btn.key}
                                    type="button"
                                    onClick={() => markAttendance.mutate({ shiftId: shift.id, status: isActive ? 'present' : btn.key, notes: '' })}
                                    className={`px-1.5 py-0.5 rounded border text-[10px] font-bold transition-all select-none ${isActive ? btn.activeClass : btn.inactiveClass}`}
                                    title={btn.key.replace('_', ' ')}
                                  >
                                    {btn.label}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </>
                      ) : (
                        isManager ? (
                          <div
                            onClick={() => openAddShift(s.id)}
                            className="flex-1 min-h-[2.2rem] rounded-lg border border-dashed border-slate-200 text-slate-300 text-lg flex items-center justify-center cursor-pointer hover:border-primary hover:bg-primary-50 hover:text-primary transition-all select-none"
                          >
                            <Plus size={16} />
                          </div>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          ADD SHIFT MODAL
      ═══════════════════════════════════════════════════════════════════ */}
      <Modal isOpen={!!addShiftModal} onClose={() => setAddShiftModal(null)} title="Add Shift">
        {addShiftModal && (
          <form
            ref={addShiftFormRef}
            className="space-y-4"
            onSubmit={e => {
              e.preventDefault();
              createShift.mutate({ staff_id: addShiftModal.staff_id, shift_date: addShiftModal.date, ...shiftForm });
            }}
            onKeyDown={e => {
              if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault(); e.stopPropagation();
              }
            }}
          >
            <div className="text-[#111827] text-[15px] font-medium bg-slate-50 rounded-lg p-3">
              {format(parseISO(addShiftModal.date), 'EEEE, MMMM d')}
            </div>
            <p className="text-[10px] text-content-muted -mt-1">
              ↑ ↓ ← → to navigate · Enter to confirm · Esc to cancel
            </p>

            <div>
              <label className="modal-label">Shift Type</label>
              <div className="grid grid-cols-3 gap-2">
                {uniqueShiftTypes.map((t, idx) => {
                  const isSelected = shiftForm.shift_type === t.name;
                  const isKeyFocused = addShiftKeyIndex === idx;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        const found = shiftTypes.find(s => s.name === t.name);
                        setShiftForm(f => ({
                          ...f,
                          shift_type: t.name,
                          start_time: found?.default_start_time?.slice(0, 5) || '07:00',
                          end_time:   found?.default_end_time?.slice(0, 5)   || '17:00',
                        }));
                        setAddShiftKeyIndex(idx);
                      }}
                      className={`px-2 py-2 rounded-lg border text-xs font-semibold transition-all ${
                        isSelected
                          ? 'bg-primary text-white border-primary shadow-sm'
                          : isKeyFocused
                            ? 'border-primary/50 bg-primary/5 text-primary'
                            : 'border-card-border text-content hover:border-primary/30 hover:bg-primary-50/30'
                      }`}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="modal-label">Start Time</label>
                <input
                  type="time"
                  className="input"
                  value={shiftForm.start_time}
                  onChange={e => setShiftForm(f => ({ ...f, start_time: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="modal-label">End Time</label>
                <input
                  type="time"
                  className="input"
                  value={shiftForm.end_time}
                  onChange={e => setShiftForm(f => ({ ...f, end_time: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div>
              <label className="modal-label">Notes (optional)</label>
              <input type="text" className="input" value={shiftForm.notes} onChange={e => setShiftForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            <div className="flex gap-2 pt-2">
              <button type="button" className="btn-secondary flex-1" onClick={() => setAddShiftModal(null)}>Cancel</button>
              <button type="submit" className="btn-primary flex-1" disabled={createShift.isPending}>
                {createShift.isPending ? 'Adding…' : 'Add Shift'}
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
          <div className="space-y-4">
            <div className="text-[#111827] text-[15px] font-medium bg-slate-50 rounded-lg p-3">
              {editShiftModal.shift.first_name} {editShiftModal.shift.last_name} —{' '}
              {(() => { try { return format(parseISO(editShiftModal.shift.shift_date?.split('T')[0]), 'EEEE, MMMM d'); } catch { return dateStr; } })()}
            </div>

            <div>
              <label className="modal-label">Shift Type</label>
              <div className="grid grid-cols-3 gap-2">
                {uniqueShiftTypes.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      const found = shiftTypes.find(s => s.name === t.name);
                      setEditForm(f => ({
                        ...f,
                        shift_type: t.name,
                        start_time: found?.default_start_time?.slice(0, 5) || f.start_time,
                        end_time:   found?.default_end_time?.slice(0, 5)   || f.end_time,
                      }));
                    }}
                    className={`px-2 py-2 rounded-lg border text-xs font-semibold transition-all ${
                      editForm.shift_type === t.name
                        ? 'bg-primary text-white border-primary shadow-sm'
                        : 'border-card-border text-content hover:border-primary/30 hover:bg-primary-50/30'
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="modal-label">Start Time</label>
                <input type="time" className="input" value={editForm.start_time} onChange={e => setEditForm(f => ({ ...f, start_time: e.target.value }))} />
              </div>
              <div>
                <label className="modal-label">End Time</label>
                <input type="time" className="input" value={editForm.end_time} onChange={e => setEditForm(f => ({ ...f, end_time: e.target.value }))} />
              </div>
            </div>

            <div>
              <label className="modal-label">Notes</label>
              <input type="text" className="input" value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {/* Attendance */}
            <div>
              <label className="modal-label">Attendance</label>
              <div className="flex gap-2">
                {[
                  { key: 'called_out', label: 'Called Out' },
                  { key: 'ncns',       label: 'NCNS' },
                  { key: 'late',       label: 'Late' },
                ].map(btn => (
                  <button
                    key={btn.key}
                    type="button"
                    onClick={() => setEditAttendanceStatus(s => s === btn.key ? null : btn.key)}
                    className={`flex-1 px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                      editAttendanceStatus === btn.key
                        ? 'bg-red-500 text-white border-red-500'
                        : 'border-card-border text-content-muted hover:border-red-300 hover:text-red-500'
                    }`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
              {editAttendanceStatus && (
                <input
                  type="text"
                  className="input mt-2"
                  placeholder="Attendance notes (optional)"
                  value={editAttendanceNotes}
                  onChange={e => setEditAttendanceNotes(e.target.value)}
                />
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                className="btn-secondary text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => deleteShift.mutate(editShiftModal.shift.id)}
                disabled={deleteShift.isPending}
              >
                Delete
              </button>
              <button type="button" className="btn-secondary flex-1" onClick={() => setEditShiftModal(null)}>Cancel</button>
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={updateShift.isPending}
                onClick={() => {
                  if (editAttendanceStatus) {
                    markAttendance.mutate({ shiftId: editShiftModal.shift.id, status: editAttendanceStatus, notes: editAttendanceNotes });
                  }
                  updateShift.mutate({ id: editShiftModal.shift.id, ...editForm });
                }}
              >
                {updateShift.isPending ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
