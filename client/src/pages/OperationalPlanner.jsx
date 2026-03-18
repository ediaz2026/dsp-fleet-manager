import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  Upload, Download, AlertTriangle, CheckCircle, X, Info,
  FileSpreadsheet, RefreshCw, User, Plus, Trash2, ChevronRight, ChevronDown, ChevronLeft,
  Truck, BarChart2, Eye, EyeOff, Save, Calendar,
  Cloud, Zap, WifiOff
} from 'lucide-react';
import api from '../api/client';
import toast from 'react-hot-toast';
import { format, startOfWeek, addDays, subDays, parseISO } from 'date-fns';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function norm(s) {
  return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function findCol(keys, ...candidates) {
  for (const c of candidates) {
    const cn = norm(c);
    const k = keys.find(k => norm(k).includes(cn));
    if (k) return k;
  }
  return null;
}

function findSecondOrFirst(keys, ...candidates) {
  const base = findCol(keys, ...candidates);
  if (!base) return null;
  const second = keys.find(k => k === base + '_1');
  return second || base;
}

function matchDriver(transponderId, drivers) {
  if (transponderId) {
    const t = norm(transponderId);
    const d = drivers.find(d => {
      const dt = norm(d.transponder_id);
      const de = norm(d.employee_id);
      return (dt && dt === t) || (de && de === t);
    });
    if (d) return { driver: d, confidence: 'transponder' };
  }
  return { driver: null, confidence: 'unmatched' };
}

function inferShiftType(dst) {
  const s = String(dst || '').toLowerCase();
  if (s.includes('helper')) return 'HELPER';
  if (s.includes('step van') || s.includes('stepvan') || s.includes('cargo van')) return 'STEP VAN';
  return 'EDV';
}

// ─── Parse Cortex Route Export ───────────────────────────────────────────────
function parseCortexFile(records, drivers, weekMap) {
  const warnings = [];
  const allRows = [];
  const matchedDriverIds = new Set();

  const firstRecord = records[0];
  if (!firstRecord) return { rows: [], conflicts: [], matched: 0, unmatched: 0, warnings: ['File is empty'], matchedDriverIds };

  const keys = Object.keys(firstRecord);
  const routeKey  = findCol(keys, 'route', 'routecode', 'routeid', 'code');
  const transpKey = findSecondOrFirst(keys, 'transporter', 'transponder', 'badge', 'transporterid', 'associateid');
  const nameKey   = findSecondOrFirst(keys, 'driver', 'name', 'associate', 'fullname');
  const dstKey    = findCol(keys, 'delivery', 'service', 'type', 'dst', 'deliveryservice');

  if (!routeKey) {
    warnings.push(`Could not detect Route Code column. Found: ${keys.slice(0, 6).join(', ')}`);
  }
  if (transpKey?.endsWith('_1') || nameKey?.endsWith('_1')) {
    warnings.push(`Duplicate columns detected — using 2nd occurrence: ${[transpKey, nameKey].filter(Boolean).join(', ')}`);
  }

  for (const record of records) {
    const routeCode     = String(record[routeKey] || '').trim();
    const transponderId = String(record[transpKey] || '').trim();
    const driverName    = String(record[nameKey]   || '').trim();
    const dst           = String(record[dstKey]    || '').trim();

    if (!routeCode) continue;

    const { driver, confidence } = matchDriver(transponderId, drivers);
    if (driver) matchedDriverIds.add(driver.staff_id || driver.id);

    if (!driver && transponderId) {
      warnings.push(`Route ${routeCode}: Transponder ID "${transponderId}" not found in system`);
    } else if (!driver && !transponderId) {
      warnings.push(`Route ${routeCode}: no Transponder ID in file`);
    }

    const onWeekSchedule = weekMap ? weekMap.has(norm(transponderId)) : null;

    allRows.push({
      id: routeCode + '-' + allRows.length,
      routeCode,
      cortexDriverName:    driverName || '',
      cortexTransponderId: transponderId || '',
      matchedDriver:       driver,
      matchConfidence:     confidence,
      deliveryServiceType: dst,
      shiftType:           inferShiftType(dst),
      wave:    '',
      staging: '',
      launchpad: '',
      canopy:    '',
      waveTime:  '',
      notes:     '',
      status:    driver ? 'matched' : 'missing_driver',
      isExtra:   false,
      onWeekSchedule,
    });
  }

  // Detect duplicate route codes → conflicts
  const routeGroups = {};
  for (const row of allRows) {
    if (!routeGroups[row.routeCode]) routeGroups[row.routeCode] = [];
    routeGroups[row.routeCode].push(row);
  }
  const conflicts = Object.entries(routeGroups)
    .filter(([, group]) => group.length > 1)
    .map(([routeCode, options]) => ({ routeCode, options }));
  const rows = Object.entries(routeGroups)
    .filter(([, g]) => g.length === 1)
    .map(([, g]) => g[0]);

  const matched   = rows.filter(r => r.matchedDriver).length;
  const unmatched = rows.filter(r => !r.matchedDriver).length;
  return { rows, conflicts, matched, unmatched, warnings, matchedDriverIds };
}

// ─── Parse DMF5 Loadout File (complex multi-row header) ──────────────────────
function parseLoadoutFile(wb, existingRows) {
  const warnings = [];
  const ws = wb.Sheets[wb.SheetNames[0]];

  // Get raw 2D array (no header inference)
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (!raw.length) {
    return { updatedRows: existingRows, matched: 0, unmatched: 0, warnings: ['File is empty'], volumeMap: {} };
  }

  // Step 1: Find the data header row (contains 'DSP' or 'Route')
  let hRow = -1;
  let dspCol = -1, routeCol = -1, stagingCol = -1, launchpadCol = -1;

  for (let r = 0; r < Math.min(raw.length, 15); r++) {
    const row = raw[r];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || '').trim().toUpperCase();
      if (cell === 'DSP') { hRow = r; dspCol = c; break; }
    }
    if (hRow >= 0) break;
  }

  if (hRow < 0) {
    // Fallback: try searching for LSMD anywhere
    warnings.push('Could not find DSP header row — attempting LSMD row scan');
    const lsmdRows = raw.filter(row => row.some(v => String(v).toUpperCase().includes('LSMD')));
    if (!lsmdRows.length) {
      return { updatedRows: existingRows, matched: 0, unmatched: 0, warnings: ['No LSMD rows found in loadout file'], volumeMap: {} };
    }
    // Use simple column detection on LSMD rows
    const records = lsmdRows.map(row => {
      const obj = {};
      row.forEach((v, i) => { obj[`col_${i}`] = v; });
      return obj;
    });
    const keys = Object.keys(records[0] || {});
    const stationMap = {};
    const routeK = findCol(keys, 'route', 'routecode');
    const waveK  = findCol(keys, 'wave');
    const stagK  = findCol(keys, 'staging', 'stage', 'location', 'area');
    const lpadK  = findCol(keys, 'launchpad', 'launch', 'pad');
    for (const rec of records) {
      const code = String(rec[routeK] || '').trim().toUpperCase();
      if (!code) continue;
      stationMap[code] = {
        wave:      String(rec[waveK]  || '').trim(),
        staging:   String(rec[stagK]  || '').trim(),
        launchpad: String(rec[lpadK]  || '').trim(),
        canopy:    '',
        waveTime:  '',
      };
    }
    return mergeStation(stationMap, {}, existingRows, warnings);
  }

  // Step 2: Find ALL section base columns by scanning for every 'DSP' occurrence
  // The loadout has a repeating pattern: [L, #, DSP, Route, Staging] every 5 columns
  // Each repetition = one wave/canopy section. DSP is at base+2, Route at base+3, Staging at base+4.
  const headerRow = raw[hRow];
  const sectionBases = []; // column index of each section's L column (base)
  for (let c = 0; c < headerRow.length; c++) {
    if (String(headerRow[c] || '').trim().toUpperCase() === 'DSP') {
      sectionBases.push(c - 2); // L is 2 cols before DSP
    }
  }
  if (!sectionBases.length) sectionBases.push(dspCol - 2 >= 0 ? dspCol - 2 : 0);

  // Step 3: For each section, determine WAVE number and NORTH/SOUTH canopy
  // Scan rows above hRow: WAVE labels propagate left-to-right, NORTH/SOUTH alternate by section
  const waveTimeMap = {}; // wave number string → start-time string

  // Assign wave and canopy to each section by scanning rows 0..hRow-1
  const sectionWave = {};   // sectionBase → wave number string
  const sectionCanopy = {}; // sectionBase → 'NORTH'|'SOUTH'

  for (let r = 0; r < hRow; r++) {
    const row = raw[r];
    let currentWave = null;
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || '').trim().toUpperCase();
      const waveMatch = cell.match(/WAVE\s*(\d+)/i);
      if (waveMatch) {
        currentWave = waveMatch[1];
        // Look for a time string in the next row at the same column
        if (r + 1 < hRow && !waveTimeMap[currentWave]) {
          const timeCell = String(raw[r + 1]?.[c] || '').trim();
          if (/\d+:\d+/i.test(timeCell)) waveTimeMap[currentWave] = timeCell;
        }
        // Assign this wave to every section whose base is covered by this column
        for (const base of sectionBases) {
          if (!sectionWave[base] && c >= base && c < base + 5) {
            sectionWave[base] = currentWave;
          }
        }
      }
      if (cell.includes('NORTH')) {
        for (const base of sectionBases) {
          if (!sectionCanopy[base] && c >= base && c < base + 5) sectionCanopy[base] = 'NORTH';
        }
      }
      if (cell.includes('SOUTH')) {
        for (const base of sectionBases) {
          if (!sectionCanopy[base] && c >= base && c < base + 5) sectionCanopy[base] = 'SOUTH';
        }
      }
    }
  }
  // Fallback: alternate NORTH/SOUTH by section index for any unassigned sections
  sectionBases.forEach((base, i) => {
    if (!sectionCanopy[base]) sectionCanopy[base] = i % 2 === 0 ? 'NORTH' : 'SOUTH';
    if (!sectionWave[base])   sectionWave[base]   = String(Math.floor(i / 2) + 1);
  });

  // Step 4: Build volumeMap and stationMap scanning ALL sections in every data row
  const stationMap = {};
  const volumeMap = {};

  for (let r = hRow + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!row || !row.length) continue;

    for (const base of sectionBases) {
      const dspVal    = String(row[base + 2] || '').trim().toUpperCase(); // DSP
      if (!dspVal) continue;

      volumeMap[dspVal] = (volumeMap[dspVal] || 0) + 1;
    }
  }

  // Build stationMap from ALL sections, ALL DSPs — mergeStation only uses codes
  // present in the Cortex rows, so other DSPs' entries are harmlessly ignored.
  // Track last-seen launchpad label per section (Excel merges these cells, so only
  // the first row of each launchpad group has a value — carry it forward).
  const lastLaunchpad = {};

  for (let r = hRow + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!row || !row.length) continue;

    for (const base of sectionBases) {
      // Propagate launchpad label (appears only at group start)
      const lVal = String(row[base + 0] || '').trim();
      if (lVal.toUpperCase().includes('LAUNCHPAD') || lVal.toUpperCase().includes('SIDELINE')) {
        lastLaunchpad[base] = lVal;
      }

      const dspVal    = String(row[base + 2] || '').trim().toUpperCase();
      if (!dspVal) continue;

      const routeCode = String(row[base + 3] || '').trim().toUpperCase(); // Route
      if (!routeCode) continue;

      const staging   = String(row[base + 4] || '').trim(); // Staging Location
      const launchpad = lastLaunchpad[base] || '';
      const wave      = sectionWave[base]   || '';
      const canopy    = sectionCanopy[base] || '';
      const waveTime  = wave ? (waveTimeMap[wave] || '') : '';

      stationMap[routeCode] = { staging, launchpad, canopy, wave, waveTime };
    }
  }

  if (!Object.keys(stationMap).length) {
    warnings.push('No routes found in loadout file — check that the file format is correct');
  }

  return mergeStation(stationMap, volumeMap, existingRows, warnings);
}

function mergeStation(stationMap, volumeMap, existingRows, warnings) {
  let matched = 0, unmatched = 0;
  const updatedRows = existingRows.map(row => {
    const code = row.routeCode.toUpperCase();
    const station = stationMap[code];
    if (station) {
      matched++;
      return {
        ...row,
        wave:      station.wave      || row.wave,
        staging:   station.staging   || row.staging,
        launchpad: station.launchpad || row.launchpad,
        canopy:    station.canopy    || row.canopy,
        waveTime:  station.waveTime  || row.waveTime,
        status:    row.status === 'missing_driver' ? 'missing_driver' : 'matched',
      };
    } else {
      if (row.status !== 'extra') unmatched++;
      return row;
    }
  });

  for (const code of Object.keys(stationMap)) {
    if (!existingRows.find(r => r.routeCode.toUpperCase() === code)) {
      warnings.push(`Loadout route ${code} not found in ops planner rows`);
    }
  }

  return { updatedRows, matched, unmatched, warnings, volumeMap };
}

// ─── Parse Week Schedule (Rostered Work Blocks) ───────────────────────────────
function parseWeekSchedule(wb) {
  // Find "Rostered Work Blocks" sheet or use first sheet
  const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('rostered') || n.toLowerCase().includes('work')) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return { weekMap: new Map(), weekStart: null, warnings: ['Sheet not found'] };

  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const warnings = [];

  // Find header row containing "Transporter ID"
  let hRow = -1, nameCol = -1, transponderCol = -1;
  const dayColumns = []; // {col, day} where day 0=Sun ... 6=Sat

  for (let r = 0; r < Math.min(raw.length, 10); r++) {
    const row = raw[r];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || '').trim().toLowerCase();
      if (cell.includes('transporter') || cell.includes('transponder')) {
        hRow = r;
        transponderCol = c;
      }
      if ((cell.includes('associate') || cell.includes('name')) && hRow === r) {
        nameCol = c;
      }
    }
    if (hRow >= 0) {
      // Detect day columns in this row
      const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      for (let c = 0; c < row.length; c++) {
        const cell = String(row[c] || '').trim().toLowerCase().slice(0, 3);
        const dayIdx = days.indexOf(cell);
        if (dayIdx >= 0) dayColumns.push({ col: c, day: dayIdx });
      }
      break;
    }
  }

  if (hRow < 0) {
    warnings.push('Could not find header row with "Transporter ID" in week schedule');
    return { weekMap: new Map(), weekStart: null, warnings };
  }

  const weekMap = new Map();

  for (let r = hRow + 1; r < raw.length; r++) {
    const row = raw[r];
    const transponderId = norm(row[transponderCol] || '');
    const name = String(row[nameCol] || '').trim();
    if (!transponderId && !name) continue;

    const days = {};
    for (const { col, day } of dayColumns) {
      const cell = String(row[col] || '').trim();
      if (cell) {
        // Parse "Standard Parcel Electric - Rivian MEDIUM\n11:40am • 10 hrs"
        const parts = cell.split('\n');
        const dst = parts[0] || '';
        const timeHours = parts[1] || '';
        const timeMatch = timeHours.match(/(\d+:\d+(?:am|pm)?)\s*•\s*(\d+)\s*hrs?/i);
        days[day] = {
          shiftType: inferShiftType(dst),
          dst,
          startTime: timeMatch ? timeMatch[1] : '',
          hours:     timeMatch ? parseInt(timeMatch[2]) : 0,
        };
      }
    }

    if (transponderId) {
      weekMap.set(transponderId, { name, days });
    }
  }

  // Determine week_start (Sunday) — find the first Sunday heading if available
  let weekStart = null;
  for (let r = 0; r < hRow; r++) {
    const row = raw[r];
    for (const cell of row) {
      const s = String(cell || '');
      // Look for a date string
      if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(s) || /\d{4}-\d{2}-\d{2}/.test(s)) {
        try {
          const d = new Date(s);
          if (!isNaN(d.getTime())) {
            weekStart = format(startOfWeek(d, { weekStartsOn: 0 }), 'yyyy-MM-dd');
          }
        } catch { /* ignore */ }
        break;
      }
    }
    if (weekStart) break;
  }

  return { weekMap, weekStart, warnings };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatusBadge({ status, confidence, onWeekSchedule }) {
  if (status === 'awaiting')       return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700">⏳ Awaiting Routes</span>;
  if (status === 'not_on_roster')  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-orange-100 text-orange-700">⚠ Not on Roster</span>;
  if (status === 'matched' && confidence === 'manual')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700">✎ Assigned</span>;
  if (status === 'matched')        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">✓ Matched</span>;
  if (status === 'missing_driver') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700">✗ No Driver</span>;
  if (status === 'extra')          return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-100 text-purple-700">+ Extra</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">—</span>;
}

// ─── Searchable Driver Picker ─────────────────────────────────────────────────
function AssignDriverCell({ row, drivers, onAssign }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef();

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = drivers.filter(d => {
    const q = search.toLowerCase();
    return (
      `${d.first_name} ${d.last_name}`.toLowerCase().includes(q) ||
      (d.transponder_id || '').toLowerCase().includes(q) ||
      (d.employee_id || '').toLowerCase().includes(q)
    );
  }).slice(0, 12);

  const hasDriver   = !!row.matchedDriver;
  const isUnmatched = row.status === 'missing_driver' || row.status === 'extra';
  const displayName = hasDriver
    ? `${row.matchedDriver.first_name} ${row.matchedDriver.last_name}`
    : row.cortexDriverName || '';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setSearch(''); setOpen(o => !o); }}
        className={`w-full text-left rounded px-1 py-0.5 transition-all group ${
          isUnmatched
            ? 'hover:bg-red-50 hover:ring-1 hover:ring-red-300'
            : 'hover:bg-primary-50 hover:ring-1 hover:ring-primary/30'
        }`}
      >
        <div className="flex items-center justify-between gap-1">
          <span className={`text-sm font-medium truncate ${isUnmatched ? 'text-red-600' : 'text-content'}`}>
            {displayName || <span className="text-red-400 italic text-xs">Click to assign driver…</span>}
          </span>
          <User size={11} className={`flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity ${isUnmatched ? 'text-red-400' : 'text-primary'}`} />
        </div>
        {hasDriver && (
          <p className="text-[10px] text-content-muted font-mono mt-0.5">
            {row.matchedDriver.transponder_id || row.matchedDriver.employee_id || ''}
            {row.matchConfidence === 'manual' && <span className="ml-1 text-blue-500">· manually assigned</span>}
          </p>
        )}
        {!hasDriver && row.cortexTransponderId && (
          <p className="text-[10px] text-red-400 mt-0.5">ID: {row.cortexTransponderId} — not in system</p>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-72 bg-white border border-card-border rounded-xl shadow-2xl">
          <div className="p-2 border-b border-card-border">
            <p className="text-[10px] font-semibold text-content-muted uppercase tracking-wide mb-1.5">
              Assign driver — Route {row.routeCode || '?'}
            </p>
            <input
              autoFocus
              className="w-full px-2.5 py-1.5 text-sm border border-card-border rounded-lg bg-base text-content placeholder-content-subtle focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              placeholder="Search by name or transponder ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-content-muted text-center py-3">No drivers found</p>
            ) : filtered.map(d => (
              <button
                key={d.staff_id || d.id}
                onClick={() => { onAssign(d); setOpen(false); }}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-primary-50 text-left transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-content">{d.first_name} {d.last_name}</p>
                  <p className="text-[10px] text-content-muted font-mono">{d.transponder_id || d.employee_id || 'No ID'}</p>
                </div>
                {hasDriver && (row.matchedDriver.staff_id || row.matchedDriver.id) === (d.staff_id || d.id) && (
                  <CheckCircle size={14} className="text-primary flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
          {hasDriver && (
            <div className="border-t border-card-border p-1">
              <button
                onClick={() => { onAssign(null); setOpen(false); }}
                className="w-full text-xs text-red-500 hover:bg-red-50 rounded-lg px-3 py-1.5 text-left transition-colors"
              >
                ✕ Clear assignment
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UploadCard({ step, title, description, onUpload, loading, summary, disabled, accept, done, inputId, highlight }) {
  const fileRef = useRef();
  const hasData = done || !!summary;

  return (
    <div className={`card flex-1 min-w-0 transition-all ${disabled ? 'opacity-60' : ''} ${highlight ? 'ring-2 ring-primary ring-offset-2 shadow-lg' : ''}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${hasData ? 'bg-emerald-100 text-emerald-700' : 'bg-primary/10 text-primary'}`}>
          {hasData ? <CheckCircle size={16} /> : step}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-content text-sm">{title}</p>
          <p className="text-xs text-content-muted mt-0.5">{description}</p>
        </div>
      </div>

      {!hasData ? (
        <label className={`block w-full border-2 border-dashed rounded-xl p-5 text-center transition-all ${disabled ? 'cursor-not-allowed border-slate-200' : 'cursor-pointer border-card-border hover:border-primary hover:bg-primary-50/30'}`}>
          {loading ? (
            <div className="flex flex-col items-center gap-2">
              <RefreshCw size={20} className="text-primary animate-spin" />
              <p className="text-sm text-content-muted">Processing…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload size={20} className={disabled ? 'text-slate-300' : 'text-content-subtle'} />
              <p className={`text-sm ${disabled ? 'text-slate-300' : 'text-content-muted'}`}>
                {disabled ? 'Upload Routes first' : 'Click to select CSV or Excel file'}
              </p>
            </div>
          )}
          <input
            id={inputId}
            ref={fileRef}
            type="file"
            accept={accept}
            className="hidden"
            disabled={disabled || loading}
            onChange={e => { onUpload(e.target.files?.[0]); if (fileRef.current) fileRef.current.value = ''; }}
          />
        </label>
      ) : (
        <div className="space-y-2">
          {summary && (
            <div className="flex items-center justify-between text-sm">
              <div className="flex gap-4">
                <span className="text-emerald-600 font-semibold">✓ {summary.matched} matched</span>
                {summary.unmatched > 0 && <span className="text-red-600 font-semibold">✗ {summary.unmatched} unmatched</span>}
              </div>
              <span className="text-content-muted text-xs">{summary.total} total</span>
            </div>
          )}
          {summary?.warnings?.length > 0 && (
            <details className="text-xs">
              <summary className="text-amber-600 cursor-pointer font-medium flex items-center gap-1">
                <AlertTriangle size={12} /> {summary.warnings.length} warning{summary.warnings.length > 1 ? 's' : ''}
              </summary>
              <ul className="mt-1 space-y-0.5 pl-4 text-content-muted max-h-24 overflow-y-auto">
                {summary.warnings.map((w, i) => <li key={i}>• {w}</li>)}
              </ul>
            </details>
          )}
          <label className="block w-full border border-dashed border-card-border rounded-lg p-2 text-center cursor-pointer hover:border-primary transition-all">
            <p className="text-xs text-content-muted">Re-upload to replace</p>
            <input
              id={inputId}
              ref={fileRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={e => { onUpload(e.target.files?.[0]); if (fileRef.current) fileRef.current.value = ''; }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

// ─── Editable Cell ────────────────────────────────────────────────────────────
function EditableCell({ value, onSave, className = '', placeholder = '' }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);

  const commit = () => { setEditing(false); onSave(val); };

  if (editing) {
    return (
      <input
        autoFocus
        className="w-full px-1 py-0.5 text-xs border border-primary rounded bg-white text-content focus:outline-none"
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      />
    );
  }

  return (
    <div
      onClick={() => { setVal(value); setEditing(true); }}
      className={`cursor-pointer rounded px-1 py-0.5 hover:bg-primary-50 hover:ring-1 hover:ring-primary/30 transition-all min-h-[1.5rem] ${className}`}
    >
      {value || <span className="text-slate-300 text-xs italic">{placeholder}</span>}
    </div>
  );
}

// ─── Shift Type Select Cell ────────────────────────────────────────────────────
const SHIFT_TYPES = ['EDV', 'STEP VAN', 'HELPER', 'ON CALL'];
const SHIFT_COLORS = {
  'EDV':     'bg-blue-100 text-blue-800',
  'STEP VAN':'bg-indigo-100 text-indigo-800',
  'HELPER':  'bg-amber-100 text-amber-800',
  'ON CALL': 'bg-yellow-100 text-amber-800',
};

function ShiftTypeCell({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        autoFocus
        className="text-xs border border-primary rounded px-1 py-0.5 focus:outline-none"
        value={value}
        onChange={e => { onSave(e.target.value); setEditing(false); }}
        onBlur={() => setEditing(false)}
      >
        {SHIFT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    );
  }
  return (
    <div
      onClick={() => setEditing(true)}
      className={`cursor-pointer inline-flex px-1.5 py-0.5 rounded text-[11px] font-semibold ${SHIFT_COLORS[value] || 'bg-slate-100 text-slate-700'}`}
    >
      {value || '—'}
    </div>
  );
}

// ─── Cortex Sync Modal ────────────────────────────────────────────────────────
const SYNC_STEP_LABELS = [
  'Connecting to Cortex...',
  'Downloading Routes File...',
  'Downloading Week Schedule...',
  'Processing data...',
  'Populating Ops Planner...',
  'Cross-referencing with Schedule...',
  'Complete!',
];

function CortexSyncModal({ isOpen, onClose, onConfirm, sessionId, onFallback }) {
  const [phase, setPhase] = useState('confirm'); // confirm | progress | error
  const [sseState, setSseState] = useState({
    steps: SYNC_STEP_LABELS.map(label => ({ label, status: 'pending' })),
    currentStep: 0,
    status: 'pending',
    summary: null,
    error: null,
  });
  const [confirming, setConfirming] = useState(false);
  const esRef = useRef(null);

  // Reset to confirm phase when reopened
  useEffect(() => {
    if (isOpen && !sessionId) {
      setPhase('confirm');
      setConfirming(false);
      setSseState({
        steps: SYNC_STEP_LABELS.map(label => ({ label, status: 'pending' })),
        currentStep: 0, status: 'pending', summary: null, error: null,
      });
    }
  }, [isOpen, sessionId]);

  // Connect SSE once we have a sessionId
  useEffect(() => {
    if (!sessionId) return;
    setPhase('progress');

    const token = localStorage.getItem('dsp_token');
    const es = new EventSource(
      `/api/cortex-sync/${sessionId}/events?token=${encodeURIComponent(token)}`
    );
    esRef.current = es;

    const handleEvent = (raw) => {
      try {
        const data = JSON.parse(raw);
        setSseState({
          steps: SYNC_STEP_LABELS.map((label, i) => ({
            label,
            status: data.steps?.[i]?.status || 'pending',
          })),
          currentStep: data.currentStep ?? 0,
          status: data.status || 'pending',
          summary: data.summary || null,
          error: data.error || null,
        });
        if (data.status === 'error') setPhase('error');
      } catch { /* ignore parse errors */ }
    };

    es.addEventListener('state', e => handleEvent(e.data));
    es.addEventListener('update', e => handleEvent(e.data));
    es.addEventListener('cancelled', () => { es.close(); onClose(); });
    es.onerror = () => es.close();

    return () => { es.close(); esRef.current = null; };
  }, [sessionId]);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = async () => {
    if (esRef.current) esRef.current.close();
    if (sessionId) {
      try { await api.delete(`/cortex-sync/${sessionId}`); } catch { /* silent */ }
    }
    onClose();
  };

  if (!isOpen) return null;

  const { steps, currentStep, status, summary, error } = sseState;
  const isComplete = status === 'complete';
  const isError    = phase === 'error';

  const StepIcon = ({ s }) => {
    if (s.status === 'complete') return <CheckCircle size={16} className="text-emerald-500 flex-shrink-0" />;
    if (s.status === 'running')  return <RefreshCw size={16} className="text-primary animate-spin flex-shrink-0" />;
    if (s.status === 'error')    return <X size={16} className="text-red-500 flex-shrink-0" />;
    return <span className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0 block" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-r from-[#1E3A5F] to-[#2563EB] px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                <Cloud size={18} className="text-white" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Cortex Auto-Sync</h3>
                <p className="text-[11px] text-white/70">Last Mile DSP LLC · DMF5</p>
              </div>
            </div>
            {(isComplete || isError) && (
              <button onClick={handleCancel} className="text-white/60 hover:text-white transition-colors">
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────────── */}
        <div className="p-6 space-y-5">

          {/* CONFIRM PHASE */}
          {phase === 'confirm' && (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                <p className="text-sm font-semibold text-blue-800">Before you continue:</p>
                <p className="text-sm text-blue-700">
                  Claude will open Cortex and automatically download today's Routes and Week Schedule.
                  Make sure you are <strong>logged into Cortex</strong> in your browser before proceeding.
                </p>
              </div>
              <div className="space-y-2 text-sm text-slate-600">
                <p className="font-medium text-slate-700">Claude will:</p>
                <ul className="space-y-1.5 text-slate-600">
                  {['Navigate to logistics.amazon.com', 'Download today\'s Routes export', 'Download this week\'s Rostered Work Blocks', 'Populate and cross-reference the Ops Planner'].map((item, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {/* PROGRESS PHASE */}
          {phase === 'progress' && (
            <>
              <div className="space-y-3">
                {steps.map((step, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 transition-all duration-300 ${
                      i > currentStep && !isComplete ? 'opacity-35' : ''
                    }`}
                  >
                    <StepIcon s={step} />
                    <span className={`text-sm transition-colors ${
                      step.status === 'complete' ? 'text-emerald-700 font-medium' :
                      step.status === 'running'  ? 'text-primary font-semibold' :
                      step.status === 'error'    ? 'text-red-600 font-medium' :
                      'text-slate-400'
                    }`}>
                      {step.label}
                    </span>
                    {step.status === 'running' && (
                      <span className="ml-auto text-[10px] text-primary animate-pulse font-medium">in progress</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Waiting for automation to start */}
              {status === 'pending' && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                    <Zap size={12} /> Waiting for Claude in Chrome...
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    The <strong>Cortex Auto-Sync</strong> workflow has been queued. Claude will begin automatically.
                  </p>
                </div>
              )}

              {/* Complete summary */}
              {isComplete && summary && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-bold text-emerald-800">✅ Sync Complete — Morning Summary:</p>
                  <div className="space-y-1 text-sm">
                    <p className="text-emerald-700">✅ <strong>{summary.matched}</strong> drivers matched and rostered</p>
                    {summary.notScheduled > 0 && <p className="text-amber-600">⚠️ <strong>{summary.notScheduled}</strong> drivers not on internal schedule</p>}
                    {summary.missingDrivers > 0 && <p className="text-red-600">🔴 <strong>{summary.missingDrivers}</strong> routes missing a driver</p>}
                    {summary.extras > 0 && <p className="text-purple-600">⭐ <strong>{summary.extras}</strong> extra drivers available</p>}
                    {summary.conflicts > 0 && <p className="text-orange-600">⚡ <strong>{summary.conflicts}</strong> split routes need your attention</p>}
                  </div>
                </div>
              )}

              {/* Next step prompt after success */}
              {isComplete && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-blue-800">One step remaining:</p>
                  <p className="text-xs text-blue-700 mt-0.5">
                    Upload the <strong>DMF5 Loadout</strong> file to get Wave, Staging, and Launchpad info. The upload card is highlighted below.
                  </p>
                </div>
              )}
            </>
          )}

          {/* ERROR PHASE */}
          {isError && (
            <div className="space-y-3">
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-red-800 flex items-center gap-1.5">
                  <WifiOff size={14} /> Auto-sync failed at step {currentStep + 1}
                </p>
                {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
              </div>
              <button
                onClick={() => { onFallback(); handleCancel(); }}
                className="w-full btn-secondary text-sm"
              >
                Upload files manually instead
              </button>
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <div className="px-6 pb-5 flex gap-3">
          {phase === 'confirm' && (
            <>
              <button onClick={handleCancel} className="btn-secondary flex-1 text-sm">Cancel</button>
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="btn-primary flex-1 text-sm flex items-center justify-center gap-2"
              >
                {confirming ? <><RefreshCw size={14} className="animate-spin" /> Starting…</> : <><Cloud size={14} /> Confirm &amp; Start Sync</>}
              </button>
            </>
          )}
          {phase === 'progress' && !isComplete && !isError && (
            <button onClick={handleCancel} className="btn-secondary flex-1 text-sm">Cancel Sync</button>
          )}
          {(isComplete || isError) && (
            <button onClick={handleCancel} className="btn-primary flex-1 text-sm">
              {isComplete ? 'Done' : 'Dismiss'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Conflict Resolution Modal ────────────────────────────────────────────────
function ConflictResolutionModal({ conflicts, onResolve, onClose }) {
  const [selections, setSelections] = useState({});
  const allResolved = conflicts.every(c => selections[c.routeCode] !== undefined);

  const confirm = () => {
    const resolvedRows = [];
    for (const conflict of conflicts) {
      const chosenIdx = selections[conflict.routeCode];
      conflict.options.forEach((opt, idx) => {
        if (idx === chosenIdx) {
          resolvedRows.push(opt);
        } else {
          resolvedRows.push({ ...opt, id: opt.id + '-extra', status: 'extra', isExtra: true });
        }
      });
    }
    onResolve(resolvedRows);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle size={20} className="text-amber-500" />
              Route Conflicts — {conflicts.length} route{conflicts.length > 1 ? 's' : ''} need review
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">Select one driver per route. The other will be added as EXTRA.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {conflicts.map(conflict => (
            <div key={conflict.routeCode} className="border border-slate-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-slate-700 mb-3">
                Route <span className="font-mono text-primary">{conflict.routeCode}</span> — select one driver:
              </p>
              <div className="grid grid-cols-2 gap-3">
                {conflict.options.map((opt, idx) => {
                  const isSelected = selections[conflict.routeCode] === idx;
                  const dName = opt.matchedDriver
                    ? `${opt.matchedDriver.first_name} ${opt.matchedDriver.last_name}`
                    : opt.cortexDriverName || 'Unknown';
                  const transponder = opt.matchedDriver?.transponder_id || opt.cortexTransponderId || '—';
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelections(s => ({ ...s, [conflict.routeCode]: idx }))}
                      className={`text-left p-3 rounded-xl border-2 transition-all ${isSelected ? 'border-primary bg-primary-50 ring-2 ring-primary/20' : 'border-slate-200 hover:border-primary/50 hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-semibold text-sm text-slate-800">{dName}</p>
                        {isSelected && <CheckCircle size={16} className="text-primary flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-slate-500 font-mono">{transponder}</p>
                      {opt.cortexDriverName && <p className="text-xs text-slate-400 mt-0.5">Cortex: {opt.cortexDriverName}</p>}
                      {!opt.matchedDriver && <span className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-600">No match in system</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button
            onClick={confirm}
            disabled={!allResolved}
            className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {allResolved ? 'Confirm Assignments' : `${conflicts.filter(c => selections[c.routeCode] === undefined).length} conflict(s) remaining`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function OperationalPlanner({ embedded = false, drivers: propDrivers = null, planDate: planDateProp = null, onDateChange = null }) {
  const qc = useQueryClient();

  // ── State ─────────────────────────────────────────────────────────────────
  const [localPlanDate, setLocalPlanDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const planDate = planDateProp ?? localPlanDate;

  // Sync when parent-controlled date prop changes
  useEffect(() => {
    if (planDateProp && planDateProp !== localPlanDate) {
      setLocalPlanDate(planDateProp);
    }
  }, [planDateProp]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSetPlanDate = (d) => {
    setLocalPlanDate(d);
    onDateChange?.(d);
  };
  const [syncModal, setSyncModal]         = useState(false);
  const [syncSessionId, setSyncSessionId] = useState(null);
  const [syncDone, setSyncDone]           = useState(false); // highlight loadout after sync
  const [loadOut, setLoadOut]             = useState([]);
  const [routeSummary, setRouteSummary]   = useState(null);
  const [stationSummary, setStationSummary] = useState(null);
  const [volumeSummary, setVolumeSummary] = useState(null);
  const [showVolume, setShowVolume]       = useState(false);
  const [routeLoading, setRouteLoading]   = useState(false);
  const [stationLoading, setStationLoading] = useState(false);
  const [weekLoading, setWeekLoading]     = useState(false);
  const [conflicts, setConflicts]         = useState([]);
  const [showConflicts, setShowConflicts] = useState(false);
  const [weekMap, setWeekMap]             = useState(null);
  const [weekFileName, setWeekFileName]   = useState('');
  const [isSaving, setIsSaving]           = useState(false);
  const [lastSaved, setLastSaved]         = useState(null);
  const [clearConfirm, setClearConfirm]   = useState(false);

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: fetchedDrivers = [] } = useQuery({
    queryKey: ['drivers-for-planner'],
    queryFn: () => api.get('/drivers').then(r => r.data),
    enabled: !propDrivers,
  });
  const drivers = propDrivers || fetchedDrivers;

  const { data: inactiveCount = 0 } = useQuery({
    queryKey: ['inactive-vehicle-count'],
    queryFn: () => api.get('/vehicles').then(r =>
      r.data.filter(v => ['inactive', 'maintenance'].includes(v.status)).length
    ).catch(() => 0),
    refetchInterval: 60000,
  });

  // Day shifts for pre-populate (drivers scheduled that day who aren't in loadout)
  const { data: dayShifts = [] } = useQuery({
    queryKey: ['day-shifts-for-ops', planDate],
    queryFn: () => api.get('/shifts', { params: { start: planDate, end: planDate } })
      .then(r => Array.isArray(r.data) ? r.data : (r.data.shifts || [])),
    enabled: !!planDate,
  });

  // ── Load saved session on planDate change ─────────────────────────────────
  useQuery({
    queryKey: ['ops-planner', planDate],
    queryFn: () => api.get(`/ops-planner?date=${planDate}`).then(r => r.data).catch(() => null),
    onSuccess: (session) => {
      if (session?.rows?.length) {
        setLoadOut(session.rows);
        setRouteSummary(session.route_summary || null);
        setStationSummary(session.station_summary || null);
        setVolumeSummary(session.volume_summary || null);
        setConflicts([]);
        setLastSaved(new Date(session.updated_at));
      } else {
        // New date — clear everything
        setLoadOut([]);
        setRouteSummary(null);
        setStationSummary(null);
        setVolumeSummary(null);
        setConflicts([]);
        setLastSaved(null);
      }
    },
  });

  // ── Auto-save ─────────────────────────────────────────────────────────────
  const saveSession = useCallback(async () => {
    if (!loadOut.length) return;
    setIsSaving(true);
    try {
      await api.post('/ops-planner', {
        plan_date: planDate,
        rows: loadOut,
        route_summary: routeSummary,
        station_summary: stationSummary,
        volume_summary: volumeSummary,
      });
      setLastSaved(new Date());
    } catch { /* silent fail */ }
    finally { setIsSaving(false); }
  }, [loadOut, planDate, routeSummary, stationSummary, volumeSummary]);

  useEffect(() => {
    if (!loadOut.length) return;
    const timer = setTimeout(saveSession, 2000);
    return () => clearTimeout(timer);
  }, [loadOut, routeSummary, stationSummary, volumeSummary]);

  // ── Cortex Sync ───────────────────────────────────────────────────────────
  // Ref for sync session ID so upload handlers can read it without stale closures
  const syncSessionRef = useRef(null);
  useEffect(() => { syncSessionRef.current = syncSessionId; }, [syncSessionId]);

  const reportSyncStep = useCallback(async (step, status = 'complete', extra = {}) => {
    const sid = syncSessionRef.current;
    if (!sid) return;
    try {
      await api.post(`/cortex-sync/${sid}/update`, { step, status, ...extra });
    } catch { /* non-critical */ }
  }, []);

  const handleConfirmSync = useCallback(async () => {
    const { data } = await api.post('/cortex-sync/start');
    setSyncSessionId(data.id);
    syncSessionRef.current = data.id;
  }, []);

  const handleSyncClose = useCallback(() => {
    setSyncModal(false);
    setSyncSessionId(null);
    syncSessionRef.current = null;
  }, []);

  const handleSyncFallback = useCallback(() => {
    // Scroll upload cards into view
    document.querySelector('#sync-week-input')?.closest('.card')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // ── Handle Week Schedule Upload ───────────────────────────────────────────
  const handleWeekUpload = useCallback(async (file) => {
    if (!file) return;
    setWeekLoading(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const { weekMap: newMap, weekStart, warnings } = parseWeekSchedule(wb);

      if (!newMap.size) {
        toast.error('No drivers found in week schedule file');
        return;
      }

      setWeekMap(newMap);
      setWeekFileName(file.name);

      // Cross-reference existing rows
      if (loadOut.length) {
        setLoadOut(prev => prev.map(row => ({
          ...row,
          onWeekSchedule: newMap.has(norm(row.cortexTransponderId)),
        })));
      }

      // Save week schedule to backend
      if (weekStart) {
        try {
          await api.post('/ops-planner/week-schedule', {
            week_start: weekStart,
            file_name: file.name,
            rows: Array.from(newMap.entries()).map(([id, v]) => ({ transponderId: id, ...v })),
          });
        } catch { /* non-critical */ }
      }

      const notOnRosterCount = weekStart && loadOut.length
        ? loadOut.filter(r => r.cortexTransponderId && !newMap.has(norm(r.cortexTransponderId))).length
        : 0;

      toast.success(`Week schedule loaded — ${newMap.size} drivers${notOnRosterCount > 0 ? `, ${notOnRosterCount} not on Amazon roster` : ''}`);
      if (warnings.length) warnings.forEach(w => toast(w, { icon: '⚠️' }));
    } catch (err) {
      toast.error('Failed to parse week schedule: ' + err.message);
    } finally {
      setWeekLoading(false);
    }
  }, [loadOut]);

  // ── Handle Cortex Route Upload ─────────────────────────────────────────────
  const handleRouteUpload = useCallback(async (file) => {
    if (!file) return;
    setRouteLoading(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const records = XLSX.utils.sheet_to_json(ws, { defval: '' });

      if (!records.length) { toast.error('No data found in file'); return; }

      const { rows, conflicts: newConflicts, matched, unmatched, warnings } = parseCortexFile(records, drivers, weekMap);

      // Pre-populate: append scheduled drivers not in the routes file as 'extra'
      const transpondersInLoadout = new Set(rows.map(r => norm(r.cortexTransponderId)));
      const schedExtras = (dayShifts || [])
        .filter(s => s.transporter_id && !transpondersInLoadout.has(norm(s.transporter_id)))
        .map(s => ({
          id: `SCHED-${s.id || Date.now()}-${Math.random().toString(36).slice(2)}`,
          routeCode:           '',
          cortexDriverName:    `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.name || '',
          cortexTransponderId: s.transporter_id || '',
          matchedDriver:       drivers.find(d => norm(d.transponder_id) === norm(s.transporter_id)) || null,
          matchConfidence:     'schedule',
          deliveryServiceType: '',
          shiftType:           s.shift_type || 'EDV',
          wave: '', staging: '', launchpad: '', canopy: '', waveTime: '',
          notes: 'From schedule',
          status: 'extra',
          isExtra: true,
          onWeekSchedule: weekMap ? weekMap.has(norm(s.transporter_id)) : null,
        }));

      const allRows = schedExtras.length > 0 ? [...rows, ...schedExtras] : rows;

      setLoadOut(allRows);
      setConflicts(newConflicts);
      setRouteSummary({
        matched, unmatched,
        total: allRows.length + newConflicts.reduce((s, c) => s + c.options.length, 0),
        warnings: [
          ...warnings,
          ...(schedExtras.length > 0 ? [`${schedExtras.length} scheduled driver${schedExtras.length > 1 ? 's' : ''} added from today's schedule`] : []),
        ],
        conflictCount: newConflicts.length,
      });
      setStationSummary(null);
      setVolumeSummary(null);

      if (newConflicts.length > 0) {
        setShowConflicts(true);
        toast(`${newConflicts.length} route conflict${newConflicts.length > 1 ? 's' : ''} detected — review required`, { icon: '⚠️', duration: 5000 });
      } else {
        matched > 0
          ? toast.success(`Routes loaded: ${matched}/${rows.length} drivers matched`)
          : toast.error('No drivers matched — check column names in file');
      }

      // Report sync progress: step 3 = Processing, step 4 = Populating
      await reportSyncStep(3);
      const extras     = rows.filter(r => r.status === 'extra').length;
      const notSched   = rows.filter(r => r.onWeekSchedule === false).length;
      await reportSyncStep(4, 'complete', {
        summary: {
          matched,
          missingDrivers: rows.length - matched - extras,
          extras,
          conflicts: newConflicts.length,
          notScheduled: notSched,
        },
      });
      // Step 5 = Cross-reference — mark running
      await reportSyncStep(5, 'running');
      await reportSyncStep(5, 'complete');
      // Step 6 = Complete
      await reportSyncStep(6, 'complete');
      setSyncDone(true); // highlight loadout upload card
    } catch (err) {
      toast.error('Failed to parse file: ' + err.message);
      await reportSyncStep(3, 'error', { error: err.message });
    } finally {
      setRouteLoading(false);
    }
  }, [drivers, weekMap, reportSyncStep]);

  // ── Handle DMF5 Loadout Upload ────────────────────────────────────────────
  const handleStationUpload = useCallback(async (file) => {
    if (!file) return;
    if (!loadOut.length) { toast.error('Upload Routes first'); return; }
    setStationLoading(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });

      const { updatedRows, matched, unmatched, warnings, volumeMap } = parseLoadoutFile(wb, loadOut);
      setLoadOut(updatedRows);
      setStationSummary({ matched, unmatched, total: updatedRows.length, warnings });

      // Build volume summary
      if (Object.keys(volumeMap).length) {
        const total = Object.values(volumeMap).reduce((s, c) => s + c, 0);
        const rows = Object.entries(volumeMap)
          .sort(([, a], [, b]) => b - a)
          .map(([dsp, count]) => ({ dsp, count, pct: total > 0 ? ((count / total) * 100).toFixed(1) : '0.0' }));
        setVolumeSummary({ rows, total });
        setShowVolume(true);
      }

      matched > 0
        ? toast.success(`Loadout: ${matched} routes updated with wave/staging info`)
        : toast.error('No routes updated — check LSMD rows in file');
      if (warnings.length > 0) warnings.slice(0, 3).forEach(w => toast(w, { icon: '⚠️' }));
    } catch (err) {
      toast.error('Failed to parse loadout file: ' + err.message);
    } finally {
      setStationLoading(false);
    }
  }, [loadOut]);

  // ── Row operations ────────────────────────────────────────────────────────
  const updateRow = useCallback((rowId, field, value) => {
    setLoadOut(rows => rows.map(r => r.id === rowId ? { ...r, [field]: value } : r));
  }, []);

  const addExtraRow = () => {
    const id = `EXTRA-${Date.now()}`;
    setLoadOut(rows => [...rows, {
      id, routeCode: '', cortexDriverName: '', cortexTransponderId: '',
      matchedDriver: null, matchConfidence: 'unmatched',
      deliveryServiceType: '', shiftType: 'EDV',
      wave: '', staging: '', launchpad: '', canopy: '', waveTime: '',
      notes: '', status: 'extra', isExtra: true, onWeekSchedule: null,
    }]);
  };

  const removeRow = (rowId) => setLoadOut(rows => rows.filter(r => r.id !== rowId));

  const resolveConflicts = useCallback((resolvedRows) => {
    setLoadOut(prev => [...prev, ...resolvedRows]);
    setConflicts([]);
    setShowConflicts(false);
    const extraCount = resolvedRows.filter(r => r.status === 'extra').length;
    toast.success(`Conflicts resolved — ${resolvedRows.length - extraCount} routes added, ${extraCount} moved to EXTRA`);
  }, []);

  const assignDriver = useCallback((rowId, driver) => {
    setLoadOut(rows => rows.map(r => {
      if (r.id !== rowId) return r;
      if (!driver) return { ...r, matchedDriver: null, matchConfidence: 'unmatched', status: 'missing_driver' };
      return { ...r, matchedDriver: driver, matchConfidence: 'manual', status: 'matched' };
    }));
  }, []);

  // ── Export ────────────────────────────────────────────────────────────────
  const exportToExcel = () => {
    const headers = [
      '#', 'Route Code', 'Driver Name', 'Transponder ID',
      'Shift Type', 'Delivery Service Type',
      'Wave', 'Canopy', 'Staging', 'Launchpad',
      'Status', 'Notes',
    ];
    const data = loadOut.map((r, i) => [
      i + 1,
      r.routeCode,
      r.matchedDriver ? `${r.matchedDriver.first_name} ${r.matchedDriver.last_name}` : r.cortexDriverName || '',
      r.matchedDriver?.transponder_id || r.matchedDriver?.employee_id || r.cortexTransponderId || '',
      r.shiftType || '',
      r.deliveryServiceType || '',
      r.wave || '',
      r.canopy || '',
      r.staging || '',
      r.launchpad || '',
      r.status === 'missing_driver' ? 'MISSING DRIVER' : r.status === 'extra' ? 'EXTRA' : (r.matchConfidence || '').toUpperCase(),
      r.notes || '',
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = [
      { wch: 4 }, { wch: 14 }, { wch: 26 }, { wch: 16 },
      { wch: 12 }, { wch: 32 },
      { wch: 8 }, { wch: 8 }, { wch: 16 }, { wch: 12 },
      { wch: 16 }, { wch: 24 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Load Out');
    XLSX.writeFile(wb, `LoadOut_${planDate}.xlsx`);
    toast.success('Load Out exported!');
  };

  // ── Pre-populate from day shifts when no routes file uploaded ─────────────
  const prePopulatedRows = useMemo(() => {
    if (loadOut.length > 0) return [];
    return dayShifts.map((s, i) => ({
      id: `PRE-${s.id || i}`,
      routeCode: '',
      cortexDriverName: `${s.first_name || ''} ${s.last_name || ''}`.trim(),
      cortexTransponderId: s.transponder_id || s.transporter_id || '',
      matchedDriver: s.staff_id ? {
        staff_id: s.staff_id,
        first_name: s.first_name || '',
        last_name: s.last_name || '',
        transponder_id: s.transponder_id || s.transporter_id || '',
      } : null,
      matchConfidence: 'schedule',
      shiftType: s.shift_type || 'EDV',
      wave: '', staging: '', launchpad: '', canopy: '', waveTime: '',
      notes: '', status: 'awaiting', isExtra: false, onWeekSchedule: null,
    }));
  }, [loadOut, dayShifts]);

  const displayRows = prePopulatedRows.length > 0 ? prePopulatedRows : loadOut;

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total         = loadOut.length;
    const matched       = loadOut.filter(r => r.matchedDriver).length;
    const missingDriver = loadOut.filter(r => r.status === 'missing_driver').length;
    const notOnRoster   = loadOut.filter(r => r.onWeekSchedule === false).length;
    const noStaging     = loadOut.filter(r => !r.wave && r.status !== 'extra').length;
    const extras        = loadOut.filter(r => r.status === 'extra').length;
    return { total, matched, missingDriver, notOnRoster, noStaging, extras };
  }, [loadOut]);

  const hasData = displayRows.length > 0;

  // ── Workflow steps ────────────────────────────────────────────────────────
  const steps = [
    { n: 1, label: 'Week Schedule', done: !!weekMap, optional: true },
    { n: 2, label: 'Select Date',   done: !!planDate },
    { n: 3, label: 'Upload Routes', done: !!routeSummary },
    { n: 4, label: 'Conflicts',     done: conflicts.length === 0 && !!routeSummary, warn: conflicts.length > 0, hidden: conflicts.length === 0 && !routeSummary },
    { n: 5, label: 'Upload Loadout',done: !!stationSummary },
    { n: 6, label: 'Volume',        done: !!volumeSummary },
    { n: 7, label: 'Export',        done: false },
  ].filter(s => !s.hidden);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={`space-y-5 ${embedded ? '' : 'pb-8'}`}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      {!embedded && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-content flex items-center gap-2">
              <Truck size={24} className="text-primary" />
              Operational Planner
            </h1>
            <p className="text-sm text-content-muted mt-0.5">Morning Load Out</p>
          </div>
        </div>
      )}

      {/* ── Top controls: date + action buttons ─────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <Calendar size={16} className="text-content-muted mr-1" />
            <label className="text-sm font-medium text-content mr-1">Date:</label>
            <button
              onClick={() => handleSetPlanDate(format(subDays(parseISO(planDate), 1), 'yyyy-MM-dd'))}
              className="p-1 rounded hover:bg-slate-100 text-content-muted hover:text-content transition-colors"
              title="Previous day"
            >
              <ChevronLeft size={16} />
            </button>
            <input
              type="date"
              className="input py-1.5 w-40 text-sm"
              value={planDate}
              onChange={e => handleSetPlanDate(e.target.value)}
            />
            <button
              onClick={() => handleSetPlanDate(format(addDays(parseISO(planDate), 1), 'yyyy-MM-dd'))}
              className="p-1 rounded hover:bg-slate-100 text-content-muted hover:text-content transition-colors"
              title="Next day"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {hasData && (
            <button
              onClick={() => setClearConfirm(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 transition-all"
            >
              <Trash2 size={12} /> Clear Day
            </button>
          )}

          {/* ── Cortex Auto-Sync Button ───────────────────────────────────── */}
          <button
            onClick={() => setSyncModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100 hover:border-blue-400 transition-all shadow-sm"
          >
            <Cloud size={15} />
            Sync from Cortex
          </button>

          {isSaving && <span className="text-xs text-content-muted flex items-center gap-1"><RefreshCw size={11} className="animate-spin" /> Saving…</span>}
          {!isSaving && lastSaved && <span className="text-xs text-emerald-600 flex items-center gap-1"><Save size={11} /> Saved {format(lastSaved, 'HH:mm')}</span>}
        </div>

        {hasData && (
          <div className="flex gap-2">
            {conflicts.length > 0 && (
              <button onClick={() => setShowConflicts(true)} className="btn-secondary text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100">
                <AlertTriangle size={14} /> {conflicts.length} Conflict{conflicts.length > 1 ? 's' : ''} — Review
              </button>
            )}
            <button onClick={addExtraRow} className="btn-secondary">
              <Plus size={14} /> Add Extra Driver
            </button>
            <button
              onClick={exportToExcel}
              disabled={conflicts.length > 0}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              title={conflicts.length > 0 ? 'Resolve all conflicts before exporting' : ''}
            >
              <Download size={14} /> {conflicts.length > 0 ? `Resolve ${conflicts.length} Conflict${conflicts.length > 1 ? 's' : ''} First` : 'Export Load Out'}
            </button>
          </div>
        )}
      </div>

      {/* Inactive vehicle alerts are surfaced via the bell notification system in TopNav */}

      {/* ── Workflow Steps ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs text-content-muted flex-wrap">
        {steps.map((step, i, arr) => (
          <div key={step.n} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 font-medium ${step.warn ? 'text-amber-600' : step.done ? 'text-emerald-600' : 'text-content-muted'}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${step.warn ? 'bg-amber-100 text-amber-700' : step.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {step.done && !step.warn ? '✓' : step.n}
              </span>
              {step.label}{step.optional ? ' (opt)' : ''}
            </div>
            {i < arr.length - 1 && <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />}
          </div>
        ))}
      </div>

      {/* ── Upload Cards ─────────────────────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap lg:flex-nowrap">
        <UploadCard
          step={1}
          title="Week Schedule (Optional)"
          description="Upload the Amazon Rostered Work Blocks file. Used to flag drivers not on roster."
          onUpload={handleWeekUpload}
          loading={weekLoading}
          summary={null}
          done={!!weekMap}
          disabled={false}
          accept=".xlsx,.xls"
          inputId="sync-week-input"
        />
        <UploadCard
          step={2}
          title="Upload Routes (Cortex Export)"
          description="Download from Amazon Cortex. Drivers matched by Transponder ID. Shift type inferred from Delivery Service Type."
          onUpload={handleRouteUpload}
          loading={routeLoading}
          summary={routeSummary}
          disabled={false}
          accept=".csv,.xlsx,.xls"
          inputId="sync-routes-input"
        />
        <UploadCard
          step={3}
          title="Upload DMF5 Loadout"
          description="Upload the station loadout sheet. Wave, Staging, Launchpad & Canopy are auto-populated for LSMD routes."
          onUpload={handleStationUpload}
          loading={stationLoading}
          summary={stationSummary}
          disabled={!hasData}
          accept=".csv,.xlsx,.xls"
          inputId="sync-loadout-input"
          highlight={syncDone && !stationSummary}
        />
      </div>

      {/* ── Post-Sync DMF5 Loadout Prompt ────────────────────────────────── */}
      {syncDone && !stationSummary && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <Zap size={16} className="text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-blue-800">Auto-Sync Complete — Final Step</p>
            <p className="text-xs text-blue-600 mt-0.5">Upload the <strong>DMF5 Loadout</strong> file above to add Wave, Staging, and Launchpad information. The Ops Planner will then be 100% complete.</p>
          </div>
          <label
            htmlFor="sync-loadout-input"
            className="flex-shrink-0 btn-primary text-sm cursor-pointer"
          >
            <Upload size={13} /> Upload Loadout
          </label>
        </div>
      )}

      {/* ── Volume Summary Card ───────────────────────────────────────────── */}
      {volumeSummary && (
        <div className="card p-0 overflow-hidden">
          <button
            onClick={() => setShowVolume(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
          >
            <span className="font-semibold text-content text-sm flex items-center gap-2">
              <BarChart2 size={16} className="text-primary" />
              Volume Summary — {volumeSummary.total} total routes
            </span>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${showVolume ? 'rotate-180' : ''}`} />
          </button>
          {showVolume && (
            <div className="px-4 pb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="th text-left">DSP</th>
                    <th className="th text-right">Routes</th>
                    <th className="th text-right">% of Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {volumeSummary.rows.map((r, idx) => (
                    <tr key={r.dsp} className={`border-b border-slate-100 ${idx === 0 ? 'bg-blue-50 font-semibold' : 'hover:bg-slate-50'}`}>
                      <td className="px-3 py-2 text-content">{r.dsp}</td>
                      <td className="px-3 py-2 text-right text-content">{r.count}</td>
                      <td className="px-3 py-2 text-right text-content-muted">{r.pct}%</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right">{volumeSummary.total}</td>
                    <td className="px-3 py-2 text-right">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Stats Bar ────────────────────────────────────────────────────── */}
      {hasData && (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-3 flex flex-wrap gap-6 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span className="text-sm text-content-muted">Matched: <strong className="text-content">{stats.matched}</strong></span>
          </div>
          {stats.missingDriver > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
              <span className="text-sm text-content-muted">Missing Driver: <strong className="text-red-600">{stats.missingDriver}</strong></span>
            </div>
          )}
          {stats.notOnRoster > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-400" />
              <span className="text-sm text-content-muted">Not on Roster: <strong className="text-orange-600">{stats.notOnRoster}</strong></span>
            </div>
          )}
          {stats.noStaging > 0 && stationSummary && (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
              <span className="text-sm text-content-muted">No Staging: <strong className="text-blue-600">{stats.noStaging}</strong></span>
            </div>
          )}
          {stats.extras > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-400" />
              <span className="text-sm text-content-muted">Extra: <strong className="text-purple-600">{stats.extras}</strong></span>
            </div>
          )}
          {conflicts.length > 0 && (
            <button
              onClick={() => setShowConflicts(true)}
              className="flex items-center gap-2 px-3 py-1 rounded-lg bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors"
            >
              <AlertTriangle size={13} className="text-amber-500" />
              <span className="text-sm text-amber-700 font-semibold">{conflicts.length} Conflict{conflicts.length > 1 ? 's' : ''} Need Review</span>
            </button>
          )}
          <div className="ml-auto text-sm text-content-muted">
            <strong className="text-content">{stats.total}</strong> total routes
          </div>
        </div>
      )}

      {/* ── Load Out Table ───────────────────────────────────────────────── */}
      {hasData && (
        <div className="card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
            <h2 className="font-semibold text-content flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-primary" />
              Load Out — {planDate}
              <span className="text-xs font-normal text-content-muted ml-1">({loadOut.length > 0 ? loadOut.length : displayRows.length} {loadOut.length > 0 ? 'routes' : 'scheduled'})</span>
            </h2>
            <p className="text-xs text-content-muted italic">Click any cell to edit</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100 text-xs font-medium text-gray-700 uppercase tracking-wide">
                  <th className="px-2 py-2.5 text-left w-8">#</th>
                  <th className="px-2 py-2.5 text-left w-24">Route</th>
                  <th className="px-2 py-2.5 text-left min-w-[160px]">Driver</th>
                  <th className="px-2 py-2.5 text-left w-28">Transponder</th>
                  <th className="px-2 py-2.5 text-left w-20">Shift</th>
                  <th className="px-2 py-2.5 text-left w-36">DST</th>
                  <th className="px-2 py-2.5 text-left w-16">Wave</th>
                  <th className="px-2 py-2.5 text-left w-16">Canopy</th>
                  <th className="px-2 py-2.5 text-left w-28">Staging</th>
                  <th className="px-2 py-2.5 text-left w-24">Launchpad</th>
                  <th className="px-2 py-2.5 text-left w-28">Status</th>
                  <th className="px-2 py-2.5 text-left">Notes</th>
                  <th className="px-2 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {displayRows.map((row, i) => {
                  const isProblematic = row.status === 'missing_driver';
                  const isExtra       = row.status === 'extra';
                  const notOnRoster   = row.onWeekSchedule === false;
                  const transponderId = row.matchedDriver?.transponder_id
                    || row.matchedDriver?.employee_id
                    || row.cortexTransponderId || '';

                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors hover:bg-blue-50 ${
                        isProblematic ? 'bg-red-50' :
                        isExtra       ? 'bg-purple-50' :
                        notOnRoster   ? 'bg-orange-50' : 'even:bg-slate-50'
                      }`}
                    >
                      <td className="px-2 py-2 text-content-muted text-xs font-mono">{i + 1}</td>

                      <td className="px-2 py-2 font-mono text-xs font-semibold">
                        <EditableCell value={row.routeCode} placeholder="LSMD0000"
                          onSave={v => updateRow(row.id, 'routeCode', v)}
                          className="font-mono font-semibold text-content text-xs"
                        />
                      </td>

                      <td className="px-2 py-2 min-w-[160px]">
                        <AssignDriverCell row={row} drivers={drivers}
                          onAssign={driver => assignDriver(row.id, driver)}
                        />
                      </td>

                      <td className="px-2 py-2 font-mono text-xs text-content-muted">
                        {transponderId || <span className="text-slate-300">—</span>}
                      </td>

                      <td className="px-2 py-2">
                        <ShiftTypeCell value={row.shiftType}
                          onSave={v => updateRow(row.id, 'shiftType', v)}
                        />
                      </td>

                      <td className="px-2 py-2 text-xs text-content-muted max-w-[144px]">
                        <span className="block truncate" title={row.deliveryServiceType}>
                          {row.deliveryServiceType || <span className="text-slate-300">—</span>}
                        </span>
                      </td>

                      <td className="px-2 py-2 text-xs">
                        <EditableCell value={row.wave} placeholder="—"
                          onSave={v => updateRow(row.id, 'wave', v)}
                          className="text-content text-xs"
                        />
                      </td>

                      <td className="px-2 py-2 text-xs text-content-muted">
                        {row.canopy || <span className="text-slate-300">—</span>}
                      </td>

                      <td className="px-2 py-2 text-xs">
                        <EditableCell value={row.staging} placeholder="—"
                          onSave={v => updateRow(row.id, 'staging', v)}
                          className="text-content text-xs font-mono"
                        />
                      </td>

                      <td className="px-2 py-2 text-xs text-content-muted font-mono">
                        {row.launchpad || <span className="text-slate-300">—</span>}
                      </td>

                      <td className="px-2 py-2">
                        <StatusBadge
                          status={notOnRoster && row.status !== 'missing_driver' ? 'not_on_roster' : row.status}
                          confidence={row.matchConfidence}
                          onWeekSchedule={row.onWeekSchedule}
                        />
                      </td>

                      <td className="px-2 py-2 text-xs">
                        <EditableCell value={row.notes} placeholder="Add note…"
                          onSave={v => updateRow(row.id, 'notes', v)}
                          className="text-content-muted text-xs"
                        />
                      </td>

                      <td className="px-2 py-2">
                        <button onClick={() => removeRow(row.id)}
                          className="p-1 text-slate-300 hover:text-red-500 transition-colors rounded" title="Remove row">
                          <X size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-2.5 border-t border-slate-200 bg-white flex items-center justify-between">
            <button onClick={addExtraRow} className="text-xs text-primary hover:text-primary-hover flex items-center gap-1 font-medium transition-colors">
              <Plus size={12} /> Add Extra Driver Row
            </button>
            <div className="flex items-center gap-4 text-xs text-content-muted">
              {stats.missingDriver > 0 && (
                <span className="flex items-center gap-1 text-red-600">
                  <AlertTriangle size={12} /> {stats.missingDriver} missing driver{stats.missingDriver > 1 ? 's' : ''}
                </span>
              )}
              <span>{displayRows.length} {loadOut.length > 0 ? 'routes' : 'scheduled'} total</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Empty State ───────────────────────────────────────────────────── */}
      {!hasData && conflicts.length === 0 && (
        <div className="card text-center py-16">
          <FileSpreadsheet size={48} className="text-slate-200 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-content mb-2">No Load Out Data</h3>
          <p className="text-content-muted text-sm max-w-sm mx-auto">
            Start by uploading your Cortex route export above. Then upload the DMF5 Loadout sheet to fill in wave, staging, and launchpad data.
          </p>
          <div className="mt-6 text-xs text-content-muted space-y-1">
            <p><strong>Cortex export</strong> needs: Route Code + Transporter ID + Delivery Service Type</p>
            <p><strong>DMF5 Loadout</strong> needs: DSP + Route + Staging + Launchpad columns</p>
            <p><strong>Week Schedule</strong> needs: "Rostered Work Blocks" sheet with Transporter ID</p>
          </div>
        </div>
      )}

      {/* ── Conflict Resolution Modal ─────────────────────────────────────── */}
      {showConflicts && conflicts.length > 0 && (
        <ConflictResolutionModal
          conflicts={conflicts}
          onResolve={resolveConflicts}
          onClose={() => setShowConflicts(false)}
        />
      )}

      {/* ── Cortex Sync Modal ─────────────────────────────────────────────── */}
      <CortexSyncModal
        isOpen={syncModal}
        onClose={handleSyncClose}
        onConfirm={handleConfirmSync}
        sessionId={syncSessionId}
        onFallback={handleSyncFallback}
      />

      {/* ── Clear Day Confirmation Modal ──────────────────────────────────── */}
      {clearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-2">Clear Day</h3>
            <p className="text-sm text-slate-600 mb-5">
              Remove all {loadOut.length} route rows for <strong>{planDate}</strong>?
              This also deletes the saved session from the database.
            </p>
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setClearConfirm(false)}>Cancel</button>
              <button
                className="btn-danger flex-1"
                onClick={async () => {
                  try {
                    await api.delete(`/ops-planner?date=${planDate}`);
                    setLoadOut([]);
                    setRouteSummary(null);
                    setStationSummary(null);
                    setVolumeSummary(null);
                    setWeekMap(null);
                    setWeekFileName('');
                    setConflicts([]);
                    setLastSaved(null);
                    toast.success('Day cleared');
                  } catch {
                    toast.error('Failed to clear day');
                  } finally {
                    setClearConfirm(false);
                  }
                }}
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
