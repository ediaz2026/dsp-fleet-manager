import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  Upload, FileSpreadsheet, Car, Save, RefreshCw, AlertTriangle, CheckCircle,
  ChevronLeft, ChevronRight, Calendar, X, UserPlus, Download, ClipboardList, Copy,
  MessageCircle,
} from 'lucide-react';
import api from '../api/client';
import toast from 'react-hot-toast';
import { format, addDays, subDays, parseISO } from 'date-fns';

// Shift types that should never appear in Ops Planner
const OPS_EXCLUDED_TYPES = new Set(['ON CALL', 'UTO', 'PTO', 'SUSPENSION', 'TRAINING']);

// ══ SHIFT TYPE MAPPING ════════════════════════════════════════════════════════
const AMAZON_DST_MAP = {
  'STANDARD PARCEL ELECTRIC - RIVIAN MEDIUM':             'EDV',
  'STANDARD PARCEL - STEP VAN - DA ROUNDTABLE (HZA)':    'STEP VAN',
  'STANDARD PARCEL STEP VAN - US WITH HELPER':            'STEP VAN',
  'STANDARD PARCEL STEP VAN - US WITH HELPER: HELPER':   'HELPER',
  'STANDARD PARCEL ELECTRIC - RIVIAN SMALL':              'EDV',
  'NURSERY ROUTE LEVEL 1 - ELECTRIC VEHICLE':             'EDV',
};

function mapAmazonShiftType(dst) {
  const upper = String(dst || '').toUpperCase().trim();
  if (AMAZON_DST_MAP[upper]) return AMAZON_DST_MAP[upper];
  if (upper.includes('HELPER'))                                           return 'HELPER';
  if (upper.includes('HZA') || upper.includes('STEP VAN'))               return 'STEP VAN';
  if (upper.includes('RIVIAN') || upper.includes('ELECTRIC') || upper.includes('EDV')) return 'EDV';
  return 'EDV';
}

function norm(s) {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
}

// "LAUNCHPAD A" → "A", "LAUNCHPAD D" → "D", etc. Falls back to original string if no match.
function shortLaunchpad(str) {
  if (!str) return '';
  const m = String(str).toUpperCase().match(/LAUNCHPAD\s+([A-Z])/);
  return m ? m[1] : str;
}

// ── Time utilities ────────────────────────────────────────────────────────────
function parseDurationToMinutes(dur) {
  if (!dur) return null;
  const s = String(dur).trim();
  if (!s) return null;
  if (s.includes(':')) {
    const parts = s.split(':');
    const h = parseInt(parts[0]) || 0;
    const m = parseInt(parts[1]) || 0;
    return h * 60 + m;
  }
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return n < 24 ? Math.round(n * 60) : Math.round(n);
}

function addMinutesToTime(timeStr, minutes) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  const h = parseInt(parts[0]) || 0;
  const m = parseInt(parts[1]) || 0;
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

function diffTimeMinutes(t1, t2) {
  if (!t1 || !t2) return null;
  const [h1, m1] = t1.split(':').map(Number);
  const [h2, m2] = t2.split(':').map(Number);
  let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

function formatTime12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function minutesToHrMin(mins) {
  if (mins === null || mins === undefined) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

const DIFF_DOT = { 1: '🟢', 2: '🟡', 3: '🟠', 4: '🔴', 5: '⛔' };
const RESCUE_REASONS = ['Heavy Route', 'Performance', 'Vehicle Issue', 'Personal Emergency', 'Weather', 'Other'];

function parseDateHeader(header) {
  // "Sun 15/Mar", "Mon 16/Mar", "Tue 17/Mar" …
  const match = String(header).match(/(\d{1,2})[\/\-](\w{3})/);
  if (!match) return null;
  const day = parseInt(match[1]);
  const monthStr = match[2].toLowerCase();
  const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const month = months[monthStr];
  if (month === undefined) return null;
  const now  = new Date();
  const year = now.getFullYear();
  const date = new Date(year, month, day);
  if (date.getTime() < now.getTime() - 180 * 86400000) date.setFullYear(year + 1);
  return format(date, 'yyyy-MM-dd');
}

// ══ FILE PARSERS ══════════════════════════════════════════════════════════════

function parseWeekScheduleFile(wb) {
  const sheetName =
    wb.SheetNames.find(n => /rostered|work\s*block/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return { driversByDate: {}, availableDates: [], warnings: ['Sheet not found'] };

  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!raw.length) return { driversByDate: {}, availableDates: [], warnings: ['Empty file'] };

  const warnings = [];

  // File has 3 metadata rows before the real header:
  //   Row 0: "Time Stamp", "Company", "Station"
  //   Row 1: timestamp, "Last Mile DSP LLC", "DMF5"
  //   Row 2: empty
  //   Row 3: "Associate Name", "Transporter ID", "Sun, 15/Mar", …  ← real header
  //   Row 4: "Total Rostered", null, 33, 52, …                     ← totals (skip)
  //   Row 5+: driver data
  let hRowIdx = -1;
  for (let r = 0; r < Math.min(raw.length, 15); r++) {
    const hasAssociate   = raw[r].some(c => /associate/i.test(String(c)));
    const hasTransporter = raw[r].some(c => /transporter/i.test(String(c)));
    if (hasAssociate && hasTransporter) { hRowIdx = r; break; }
  }
  if (hRowIdx < 0) {
    warnings.push('Could not find header row — expected "Associate Name" and "Transporter ID" columns');
    return { driversByDate: {}, availableDates: [], warnings };
  }

  const headerRow = raw[hRowIdx];
  let nameCol = 0, transponderCol = 1;
  const dateColumns = []; // [{ col, label, dateStr }]

  for (let c = 0; c < headerRow.length; c++) {
    const cell = String(headerRow[c] || '').trim().toLowerCase();
    if (cell.includes('associate') || (cell.includes('name') && !cell.includes('driver'))) nameCol = c;
    if (cell.includes('transporter') || cell.includes('transponder')) transponderCol = c;
    const dateStr = parseDateHeader(headerRow[c]);
    if (dateStr) dateColumns.push({ col: c, label: String(headerRow[c]).trim(), dateStr });
  }

  if (!dateColumns.length) warnings.push('No date columns detected — expected format: "Sun, 15/Mar"');

  const driversByDate = {};
  // Data starts at hRowIdx + 2: skip header row (hRowIdx) and totals row (hRowIdx + 1)
  for (let r = hRowIdx + 2; r < raw.length; r++) {
    const row = raw[r];
    const name          = String(row[nameCol]        || '').trim();
    const transponderId = String(row[transponderCol] || '').trim();
    if (!name && !transponderId) continue;
    // Skip any stray summary/total rows
    if (/total|rostered|scheduled/i.test(name)) continue;

    for (const { col, dateStr } of dateColumns) {
      const cell = String(row[col] || '').trim();
      if (!cell) continue; // not rostered this day

      // Cell format: "Standard Parcel Electric - Rivian MEDIUM\n11:40am • 10 hrs"
      const parts     = cell.split(/\n/);
      const dst       = parts[0]?.trim() || '';
      const timeStr   = parts[1]?.trim() || '';
      const timeMatch = timeStr.match(/(\d+:\d+(?:\s*[ap]m)?)\s*[•·]\s*(\d+)\s*hr/i);

      if (!driversByDate[dateStr]) driversByDate[dateStr] = [];
      driversByDate[dateStr].push({
        name,
        transponderId,
        amazonDst:       dst,
        amazonShiftType: mapAmazonShiftType(dst),
        startTime:       timeMatch ? timeMatch[1] : '',
        hours:           timeMatch ? parseInt(timeMatch[2]) : 0,
      });
    }
  }

  return { driversByDate, availableDates: dateColumns, warnings };
}

function parseRoutesFile(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { routes: [], warnings: ['Sheet not found'] };

  const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (!raw.length) return { routes: [], warnings: ['Empty file'] };

  const warnings = [];
  const keys = Object.keys(raw[0]);
  const fc = (...cands) => {
    for (const c of cands) {
      const k = keys.find(k => norm(k).includes(norm(c)));
      if (k) return k;
    }
    return null;
  };

  const routeCol    = fc('routecode', 'route');
  const dspCol      = fc('dsp');
  const transpCol   = fc('transporterid', 'transporter');
  const driverCol   = fc('drivername', 'driver', 'associate');
  const dstCol      = fc('deliveryservicetype', 'deliveryservice', 'servicetype');
  const progressCol = fc('routeprogress', 'progress');
  const durationCol = fc('routeduration', 'duration');
  const allStopsCol = fc('allstops', 'stops');
  const completeCol = fc('stopscomplete', 'complete');

  if (!routeCol) warnings.push('Route Code column not found');
  if (!transpCol) warnings.push('Transporter ID column not found');

  const rawRoutes = [];
  for (const row of raw) {
    const dsp = String(row[dspCol] || '').trim();
    // Filter: Last Mile DSP LLC rows only
    if (dspCol && dsp && !dsp.toLowerCase().includes('last mile')) continue;

    const routeCode = String(row[routeCol] || '').trim().toUpperCase();
    if (!routeCode) continue;

    // Handle pipe-separated multiple transporter IDs and driver names
    const transpStr      = String(row[transpCol]  || '').trim();
    const driverStr      = String(row[driverCol]  || '').trim();
    const transponderIds = transpStr.split('|').map(s => s.trim()).filter(Boolean);
    const driverNames    = driverStr.split('|').map(s => s.trim()).filter(Boolean);
    const dst            = String(row[dstCol] || '').trim();

    rawRoutes.push({
      routeCode,
      transponderIds,
      driverNames,
      primaryTransponderId: transponderIds[0] || '',
      deliveryServiceType:  dst,
      shiftType:            mapAmazonShiftType(dst),
      progress:             String(row[progressCol] || '').trim(),
      duration:             String(row[durationCol] || '').trim(),
      allStops:             parseInt(row[allStopsCol]) || 0,
      stopsComplete:        parseInt(row[completeCol])  || 0,
    });
  }

  // Deduplicate by routeCode — merge transponder IDs and driver names from duplicate rows
  const routeMap = new Map();
  for (const r of rawRoutes) {
    if (!routeMap.has(r.routeCode)) {
      routeMap.set(r.routeCode, { ...r, transponderIds: [...r.transponderIds], driverNames: [...r.driverNames] });
    } else {
      const existing = routeMap.get(r.routeCode);
      for (const tid of r.transponderIds) {
        if (!existing.transponderIds.includes(tid)) existing.transponderIds.push(tid);
      }
      for (const dn of r.driverNames) {
        if (!existing.driverNames.includes(dn)) existing.driverNames.push(dn);
      }
    }
  }
  const routes = [...routeMap.values()].map(r => ({
    ...r,
    primaryTransponderId: r.transponderIds[0] || '',
    hasMultipleDAs: r.transponderIds.length > 1,
  }));

  return { routes, warnings };
}

function parseLoadoutFile(wb) {
  const warnings = [];
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!raw.length) return { loadout: [], warnings: ['Empty file'] };

  // Locate header row: first row containing a cell that equals 'DSP'
  let hRow = -1, dspCol = -1;
  for (let r = 0; r < Math.min(raw.length, 30); r++) {
    for (let c = 0; c < raw[r].length; c++) {
      if (String(raw[r][c] || '').trim().toUpperCase() === 'DSP') {
        hRow = r; dspCol = c; break;
      }
    }
    if (hRow >= 0) break;
  }

  if (hRow < 0) {
    warnings.push('Could not find DSP header row in loadout file');
    return { loadout: [], warnings };
  }

  // Layout: repeating groups of 5 columns — [ Launchpad | # | DSP | Route | Staging ]
  // Each DSP cell is at base+2; find all bases.
  const headerRow   = raw[hRow];
  const sectionBases = [];
  for (let c = 0; c < headerRow.length; c++) {
    if (String(headerRow[c] || '').trim().toUpperCase() === 'DSP') {
      sectionBases.push(c - 2);
    }
  }
  if (!sectionBases.length) sectionBases.push(Math.max(0, dspCol - 2));

  // Scan pre-header rows for WAVE labels, wave times, and NORTH/SOUTH canopy labels
  const waveTimeMap  = {};   // waveNum → time string
  const sectionWave  = {};   // base → waveNum string
  const sectionCanopy = {};  // base → 'NORTH' | 'SOUTH'

  for (let r = 0; r < hRow; r++) {
    const row = raw[r];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || '').trim().toUpperCase();

      const wm = cell.match(/WAVE\s*(\d+)/);
      if (wm) {
        const wNum = wm[1];
        // Wave time row is immediately below the WAVE label row
        // Cell format: "Start Time 10:10 / Departure Time 10:40" — extract start time only
        if (r + 1 < hRow && !waveTimeMap[wNum]) {
          const tc = String(raw[r + 1]?.[c] || '').trim();
          const tm = tc.match(/\d+:\d+/);
          if (tm) waveTimeMap[wNum] = tm[0];
        }
        for (const base of sectionBases) {
          if (!sectionWave[base] && c >= base && c < base + 5) sectionWave[base] = wNum;
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

  // Fallback: alternate NORTH/SOUTH by section index, wave by pair
  sectionBases.forEach((base, i) => {
    if (!sectionCanopy[base]) sectionCanopy[base] = i % 2 === 0 ? 'NORTH' : 'SOUTH';
    if (!sectionWave[base])   sectionWave[base]   = String(Math.floor(i / 2) + 1);
  });

  // Scan data rows — collect LSMD rows + count all-DSP volume
  const loadout       = [];
  const volumeByDsp   = {};
  const lastLaunchpad = {}; // Excel merges launchpad cells — carry forward last seen value

  for (let r = hRow + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!row || !row.length) continue;

    for (const base of sectionBases) {
      // Propagate launchpad label (appears only on the first row of each launchpad group)
      const lVal = String(row[base] || '').trim();
      if (/launchpad|sideline|middle/i.test(lVal)) lastLaunchpad[base] = lVal;

      const dspVal = String(row[base + 2] || '').trim().toUpperCase();
      if (!dspVal) continue;

      const routeCode = String(row[base + 3] || '').trim().toUpperCase();
      if (!routeCode) continue;

      // Count ALL DSPs for volume share
      volumeByDsp[dspVal] = (volumeByDsp[dspVal] || 0) + 1;

      // Filter: LSMD only for the loadout table
      if (dspVal !== 'LSMD' && !dspVal.includes('LSMD')) continue;

      const staging   = String(row[base + 4] || '').trim();
      const launchpad = lastLaunchpad[base] || '';
      const wave      = sectionWave[base]   || '';
      const canopy    = sectionCanopy[base] || '';
      const waveTime  = waveTimeMap[wave]   || '';

      loadout.push({ routeCode, staging, canopy, wave, waveTime, launchpad });
    }
  }

  if (!loadout.length) warnings.push('No LSMD rows found — check that the DSP column contains "LSMD"');
  return { loadout, volumeByDsp, warnings };
}

// ══ UTILITIES ═════════════════════════════════════════════════════════════════

function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => { try { resolve(XLSX.read(e.target.result, { type: 'array' })); } catch (err) { reject(err); } };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ══ STATUS CONFIG ════════════════════════════════════════════════════════════
const STATUS_CFG = {
  fully_matched:    { label: '✅ Fully Matched',      icon: '✅', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  wrongly_rostered: { label: '❗ Not in DSP',         icon: '❗', cls: 'bg-red-100 text-red-800 border-red-200' },
  not_in_amazon:    { label: '⚠️ Not in Amazon',      icon: '⚠️', cls: 'bg-orange-100 text-orange-800 border-orange-200' },
  unassigned_route: { label: '🟡 Unassigned Route',   icon: '🟡', cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  multiple_das:     { label: '🚩 Multiple DAs',        icon: '🚩', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  helper_matched:   { label: '✅ Helper OK',            icon: '✅', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  // Legacy codes (used by old tab sub-components, kept for compatibility)
  scheduled:     { label: '✅ Scheduled',        icon: '✅', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  mismatch:      { label: '🔴 Type Mismatch',    icon: '🔴', cls: 'bg-red-100 text-red-800 border-red-200' },
  matched:       { label: '✓ Matched',           icon: '✅', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  no_driver:     { label: '✗ No Driver',         icon: '❌', cls: 'bg-red-100 text-red-700 border-red-200' },
  no_route:      { label: '🔶 No Route',         icon: '🔶', cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  no_loadout:    { label: '⚪ No Loadout Data',  icon: '⚪', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

// Icon-only status indicator with full label as tooltip
function StatusPill({ status }) {
  const cfg = STATUS_CFG[status] || { label: status, icon: '❓' };
  return (
    <span title={cfg.label} className="text-base leading-none cursor-default select-none" aria-label={cfg.label}>
      {cfg.icon}
    </span>
  );
}

// ══ SHARED SUB-COMPONENTS ════════════════════════════════════════════════════

function UploadButton({ onFile, accept, loading, label, fileName }) {
  const ref = useRef();
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {fileName && (
        <span className="text-[11px] text-content-muted truncate max-w-[180px] hidden sm:block">
          <FileSpreadsheet size={11} className="inline mr-1 opacity-60" />{fileName}
        </span>
      )}
      <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-all whitespace-nowrap ${
        loading
          ? 'bg-slate-50 text-slate-400 border-slate-200 pointer-events-none'
          : 'bg-white hover:bg-primary-50 border-card-border text-content hover:border-primary hover:text-primary'
      }`}>
        {loading ? <RefreshCw size={12} className="animate-spin" /> : <Upload size={12} />}
        {loading ? 'Processing…' : label}
        <input
          type="file" accept={accept} className="hidden" ref={ref} disabled={loading}
          onChange={e => { onFile(e.target.files?.[0]); if (ref.current) ref.current.value = ''; }}
        />
      </label>
    </div>
  );
}

function SectionHeader({ label, count, flagCount, color = 'blue' }) {
  const colors = {
    blue:   'bg-blue-50 border-blue-200 text-blue-800',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-800',
    amber:  'bg-amber-50 border-amber-200 text-amber-800',
    slate:  'bg-slate-50 border-slate-200 text-slate-700',
  };
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-wide ${colors[color] || colors.blue}`}>
      <span>{label}</span>
      <span className="font-semibold opacity-70">({count})</span>
      {flagCount > 0 && (
        <span className="ml-auto bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
          {flagCount} flag{flagCount > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

function SummaryBar({ children }) {
  return (
    <div className="flex items-center gap-4 flex-wrap px-4 py-2.5 bg-white rounded-xl border border-card-border text-xs">
      {children}
    </div>
  );
}

function EmptyState({ icon: Icon = FileSpreadsheet, title, subtitle, hint }) {
  return (
    <div className="card text-center py-14">
      <Icon size={40} className="text-slate-200 mx-auto mb-3" />
      <p className="text-content font-semibold">{title}</p>
      {subtitle && <p className="text-content-muted text-sm mt-1">{subtitle}</p>}
      {hint && <p className="text-[11px] text-content-muted mt-3 opacity-70">{hint}</p>}
    </div>
  );
}

// ══ STEP 1 TAB — Daily Roster Verification ═══════════════════════════════════

function Step1Tab({ planDate, rosterData, internalShifts, driverProfiles, allStaff, loading, onUpload, onDateSelect }) {

  const transpToProfile = useMemo(() => {
    const m = {};
    for (const dp of driverProfiles) {
      if (dp.transponder_id) m[norm(dp.transponder_id)] = dp;
      if (dp.employee_id)    m[norm(dp.employee_id)]    = dp;
    }
    return m;
  }, [driverProfiles]);

  const shiftByStaffId = useMemo(() => {
    const m = {};
    for (const s of internalShifts) m[s.staff_id] = s;
    return m;
  }, [internalShifts]);

  const amazonDrivers   = rosterData?.drivers_by_date?.[planDate] || [];
  const availableDates  = rosterData?.available_dates || [];

  const withStatus = useMemo(() => {
    const result = [];
    const covered = new Set();

    for (const d of amazonDrivers) {
      const profile = transpToProfile[norm(d.transponderId)];
      const iShift  = profile ? shiftByStaffId[profile.staff_id] : null;
      let status;
      if      (!profile)                                         status = 'not_in_system';
      else if (!iShift)                                          status = 'not_rostered';
      else if (iShift.shift_type !== d.amazonShiftType)          status = 'mismatch';
      else                                                       status = 'scheduled';
      if (profile) covered.add(profile.staff_id);
      result.push({ ...d, profile, internalShift: iShift, status, source: 'amazon' });
    }

    // Internal-only drivers (in schedule but not in Amazon file)
    for (const shift of internalShifts) {
      if (covered.has(shift.staff_id)) continue;
      const s = allStaff.find(x => x.id === shift.staff_id);
      result.push({
        name: s ? `${s.first_name} ${s.last_name}` : `Staff #${shift.staff_id}`,
        transponderId: '', amazonShiftType: null, amazonDst: '', startTime: '', hours: 0,
        profile: null, internalShift: shift, status: 'not_in_amazon', source: 'internal',
      });
    }
    return result;
  }, [amazonDrivers, transpToProfile, shiftByStaffId, internalShifts, allStaff]);

  const groups = useMemo(() => {
    const g = { EDV: [], 'STEP VAN': [], HELPER: [], other: [] };
    for (const d of withStatus) {
      const t = d.amazonShiftType || d.internalShift?.shift_type || 'other';
      (g[t] || g.other).push(d);
    }
    return g;
  }, [withStatus]);

  const counts = useMemo(() => ({
    total:        withStatus.length,
    scheduled:    withStatus.filter(d => d.status === 'scheduled').length,
    notRostered:  withStatus.filter(d => d.status === 'not_rostered').length,
    notInAmazon:  withStatus.filter(d => d.status === 'not_in_amazon').length,
    mismatch:     withStatus.filter(d => d.status === 'mismatch').length,
    notInSystem:  withStatus.filter(d => d.status === 'not_in_system').length,
  }), [withStatus]);

  const ROW_BG = {
    scheduled:     'hover:bg-slate-50',
    not_rostered:  'bg-amber-50 hover:bg-amber-100',
    not_in_amazon: 'bg-orange-50 hover:bg-orange-100',
    mismatch:      'bg-red-50 hover:bg-red-100',
    not_in_system: 'hover:bg-slate-50',
  };

  const DriverTable = ({ rows }) => (
    <div className="overflow-x-auto rounded-xl border border-card-border bg-white">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-semibold text-content-muted uppercase tracking-wide">
            <th className="px-3 py-2.5 text-left">Driver Name</th>
            <th className="px-3 py-2.5 text-left">Transporter ID</th>
            <th className="px-3 py-2.5 text-left">Amazon Type</th>
            <th className="px-3 py-2.5 text-left">Start Time</th>
            <th className="px-3 py-2.5 text-left">Internal Type</th>
            <th className="px-3 py-2.5 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((d, i) => (
            <tr key={i} className={`text-sm transition-colors ${ROW_BG[d.status] || ''}`}>
              <td className="px-3 py-2 font-medium text-content">
                {d.name || (d.profile ? `${d.profile.first_name} ${d.profile.last_name}` : '—')}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-content-muted">
                {d.transponderId || d.profile?.transponder_id || <span className="text-slate-300">—</span>}
              </td>
              <td className="px-3 py-2 text-xs">
                {d.amazonShiftType
                  ? <span className="font-semibold text-content">{d.amazonShiftType}</span>
                  : <span className="text-slate-300">—</span>}
              </td>
              <td className="px-3 py-2 text-xs text-content-muted">{d.startTime || '—'}</td>
              <td className="px-3 py-2 text-xs">
                {d.internalShift?.shift_type
                  ? <span className={`font-semibold ${d.status === 'mismatch' ? 'text-red-600' : 'text-content'}`}>{d.internalShift.shift_type}</span>
                  : <span className="text-slate-300">—</span>}
              </td>
              <td className="px-3 py-2"><StatusPill status={d.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderGroup = (label, color, rows) => {
    if (!rows.length) return null;
    const flags = rows.filter(d => d.status !== 'scheduled').length;
    return (
      <div key={label} className="space-y-1.5">
        <SectionHeader label={label} count={rows.length} flagCount={flags} color={color} />
        <DriverTable rows={rows} />
      </div>
    );
  };

  const hasData = amazonDrivers.length > 0 || withStatus.some(d => d.source === 'internal');

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-content">Daily Roster Verification</h3>
          <p className="text-xs text-content-muted mt-0.5">
            Compare Amazon's weekly roster against your internal schedule for <strong>{planDate}</strong>
          </p>
        </div>
        <UploadButton
          label="Upload Week Schedule"
          accept=".xlsx,.xls,.csv"
          loading={loading}
          fileName={rosterData?.file_name}
          onFile={onUpload}
        />
      </div>

      {/* Day selector — shown once a file has been uploaded */}
      {availableDates.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-content-muted font-medium flex-shrink-0">View day:</span>
          {availableDates.map(({ dateStr, label }) => (
            <button
              key={dateStr}
              onClick={() => onDateSelect(dateStr)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                dateStr === planDate
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'bg-white text-content-muted border-card-border hover:border-primary hover:text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Summary bar */}
      {hasData && (
        <SummaryBar>
          <span className="font-semibold text-content">{counts.total} drivers total</span>
          <span className="text-emerald-600">✅ {counts.scheduled} scheduled</span>
          {counts.notRostered  > 0 && <span className="text-amber-600">🚩 {counts.notRostered} not rostered</span>}
          {counts.notInAmazon  > 0 && <span className="text-orange-600">⚠ {counts.notInAmazon} not in Amazon</span>}
          {counts.mismatch     > 0 && <span className="text-red-600">🔴 {counts.mismatch} type mismatch</span>}
          {counts.notInSystem  > 0 && <span className="text-slate-500">❓ {counts.notInSystem} not in system</span>}
        </SummaryBar>
      )}

      {/* Driver groups */}
      {hasData ? (
        <div className="space-y-4">
          {renderGroup('EDV', 'blue', groups.EDV)}
          {renderGroup('Step Van', 'indigo', groups['STEP VAN'])}
          {renderGroup('Helper', 'amber', groups.HELPER)}
          {groups.other.length > 0 && renderGroup('Other', 'slate', groups.other)}
        </div>
      ) : (
        <EmptyState
          title={`No roster data for ${planDate}`}
          subtitle="Upload a Week Schedule file to begin"
          hint='Sheet: "Rostered Work Blocks" · Row 0: Associate Name | Transporter ID | Sun DD/Mon | …'
        />
      )}
    </div>
  );
}

// ══ STEP 2 TAB — Routes ══════════════════════════════════════════════════════

function Step2Tab({ planDate, routesData, driverProfiles, loading, onUpload }) {
  const transpToProfile = useMemo(() => {
    const m = {};
    for (const dp of driverProfiles) {
      if (dp.transponder_id) m[norm(dp.transponder_id)] = dp;
      if (dp.employee_id)    m[norm(dp.employee_id)]    = dp;
    }
    return m;
  }, [driverProfiles]);

  const routes = routesData?.routes || [];

  const matched = useMemo(() =>
    routes.map(r => {
      let profile = null;
      for (const tid of r.transponderIds) {
        profile = transpToProfile[norm(tid)];
        if (profile) break;
      }
      return { ...r, matchedProfile: profile, status: profile ? 'matched' : 'no_driver' };
    })
  , [routes, transpToProfile]);

  const groups = useMemo(() => {
    const g = { EDV: [], 'STEP VAN': [], HELPER: [] };
    for (const r of matched) (g[r.shiftType] || g.EDV).push(r);
    return g;
  }, [matched]);

  const matchedCount   = matched.filter(r => r.matchedProfile).length;
  const unmatchedCount = matched.filter(r => !r.matchedProfile).length;
  const hasData        = routes.length > 0;

  const RouteTable = ({ rows }) => (
    <div className="overflow-x-auto rounded-xl border border-card-border bg-white">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-semibold text-content-muted uppercase tracking-wide">
            <th className="px-3 py-2.5 text-left">Route</th>
            <th className="px-3 py-2.5 text-left">Driver</th>
            <th className="px-3 py-2.5 text-left">Transporter ID(s)</th>
            <th className="px-3 py-2.5 text-left">Delivery Service Type</th>
            <th className="px-3 py-2.5 text-left text-right">Stops</th>
            <th className="px-3 py-2.5 text-left">Progress</th>
            <th className="px-3 py-2.5 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((r, i) => (
            <tr key={i} className={`transition-colors ${!r.matchedProfile ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-slate-50'}`}>
              <td className="px-3 py-2 font-mono font-bold text-content">{r.routeCode}</td>
              <td className="px-3 py-2 font-medium text-content">
                {r.matchedProfile
                  ? `${r.matchedProfile.first_name} ${r.matchedProfile.last_name}`
                  : <span className="text-red-500 italic">{r.driverNames[0] || 'Unknown'}</span>}
              </td>
              <td className="px-3 py-2 font-mono text-content-muted text-[10px]">
                {r.transponderIds.join(' | ') || <span className="text-slate-300">—</span>}
              </td>
              <td className="px-3 py-2 text-content-muted max-w-[180px]">
                <span className="block truncate" title={r.deliveryServiceType}>
                  {r.deliveryServiceType || <span className="text-slate-300">—</span>}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-content-muted">{r.allStops || '—'}</td>
              <td className="px-3 py-2 text-content-muted">{r.progress || '—'}</td>
              <td className="px-3 py-2"><StatusPill status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderGroup = (label, color, rows) => {
    if (!rows.length) return null;
    const noDriver = rows.filter(r => !r.matchedProfile).length;
    return (
      <div key={label} className="space-y-1.5">
        <SectionHeader label={label} count={rows.length} flagCount={noDriver} color={color} />
        <RouteTable rows={rows} />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-content">Route Assignments</h3>
          <p className="text-xs text-content-muted mt-0.5">
            Filter: <strong>Last Mile DSP LLC</strong> · Match drivers by Transporter ID (pipe-separated values supported)
          </p>
        </div>
        <UploadButton
          label="Upload Routes File"
          accept=".xlsx,.xls,.csv"
          loading={loading}
          fileName={routesData?.file_name}
          onFile={onUpload}
        />
      </div>

      {hasData ? (
        <>
          <SummaryBar>
            <span className="font-semibold text-content">{matched.length} routes (Last Mile DSP LLC)</span>
            <span className="text-emerald-600">✓ {matchedCount} driver matched</span>
            {unmatchedCount > 0 && <span className="text-red-600">✗ {unmatchedCount} no driver match</span>}
          </SummaryBar>
          <div className="space-y-4">
            {renderGroup('EDV', 'blue', groups.EDV)}
            {renderGroup('Step Van', 'indigo', groups['STEP VAN'])}
            {renderGroup('Helper', 'amber', groups.HELPER)}
          </div>
        </>
      ) : (
        <EmptyState
          title={`No routes data for ${planDate}`}
          subtitle="Upload an Amazon Routes file to begin"
          hint="Columns: Route code | DSP | Transporter Id | Driver name | Delivery Service Type | …"
        />
      )}
    </div>
  );
}

// ══ STEP 3 TAB — DMF5 Loadout ════════════════════════════════════════════════

function Step3Tab({ planDate, loadoutData, routesData, rosterData, driverProfiles, loading, onUpload }) {
  const transpToProfile = useMemo(() => {
    const m = {};
    for (const dp of driverProfiles) {
      if (dp.transponder_id) m[norm(dp.transponder_id)] = dp;
      if (dp.employee_id)    m[norm(dp.employee_id)]    = dp;
    }
    return m;
  }, [driverProfiles]);

  const loadoutMap = useMemo(() => {
    const m = {};
    for (const item of (loadoutData?.loadout || [])) m[item.routeCode] = item;
    return m;
  }, [loadoutData]);

  const routeByTransponderId = useMemo(() => {
    const m = {};
    for (const r of (routesData?.routes || [])) {
      for (const tid of r.transponderIds) {
        if (tid) m[norm(tid)] = r;
      }
    }
    return m;
  }, [routesData]);

  // Build combined rows: start from Step 1 roster → merge Step 2 route → merge Step 3 loadout
  const combined = useMemo(() => {
    const amazonDrivers = rosterData?.drivers_by_date?.[planDate] || [];
    const rows = [];
    const seenTransp = new Set();

    for (const d of amazonDrivers) {
      const profile  = transpToProfile[norm(d.transponderId)];
      const route    = routeByTransponderId[norm(d.transponderId)];
      const loadout  = route ? loadoutMap[route.routeCode] : null;
      seenTransp.add(norm(d.transponderId));

      rows.push({
        name:          d.name || (profile ? `${profile.first_name} ${profile.last_name}` : '—'),
        transponderId: d.transponderId,
        shiftType:     d.amazonShiftType || 'EDV',
        routeCode:     route?.routeCode   || '',
        wave:          loadout?.wave      || '',
        waveTime:      loadout?.waveTime  || '',
        staging:       loadout?.staging   || '',
        canopy:        loadout?.canopy    || '',
        launchpad:     loadout?.launchpad || '',
        profile,
        loadoutStatus: loadout ? 'matched' : (route ? 'no_loadout' : 'no_route'),
      });
    }

    // Also include routes whose driver isn't in the roster (extra routes)
    for (const r of (routesData?.routes || [])) {
      if (r.transponderIds.every(tid => seenTransp.has(norm(tid)))) continue;
      const profile  = transpToProfile[norm(r.primaryTransponderId)];
      const loadout  = loadoutMap[r.routeCode];
      rows.push({
        name:          profile ? `${profile.first_name} ${profile.last_name}` : (r.driverNames[0] || '—'),
        transponderId: r.primaryTransponderId,
        shiftType:     r.shiftType || 'EDV',
        routeCode:     r.routeCode,
        wave:          loadout?.wave      || '',
        waveTime:      loadout?.waveTime  || '',
        staging:       loadout?.staging   || '',
        canopy:        loadout?.canopy    || '',
        launchpad:     loadout?.launchpad || '',
        profile,
        loadoutStatus: loadout ? 'matched' : 'no_loadout',
      });
    }

    return rows;
  }, [rosterData, routesData, loadoutData, planDate, transpToProfile, routeByTransponderId, loadoutMap]);

  const groups = useMemo(() => {
    const g = { EDV: [], 'STEP VAN': [], HELPER: [] };
    for (const r of combined) (g[r.shiftType] || g.EDV).push(r);
    return g;
  }, [combined]);

  const loadoutCount   = (loadoutData?.loadout || []).length;
  const matchedCount   = combined.filter(r => r.loadoutStatus === 'matched').length;
  const noLoadoutCount = combined.filter(r => r.loadoutStatus === 'no_loadout').length;
  const hasAnyData     = combined.length > 0;

  const LoadoutTable = ({ rows }) => (
    <div className="overflow-x-auto rounded-xl border border-card-border bg-white">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-semibold text-content-muted uppercase tracking-wide">
            <th className="px-3 py-2.5 text-left">Driver</th>
            <th className="px-3 py-2.5 text-left">Transponder ID</th>
            <th className="px-3 py-2.5 text-left">Route</th>
            <th className="px-3 py-2.5 text-left">Wave</th>
            <th className="px-3 py-2.5 text-left">Wave Time</th>
            <th className="px-3 py-2.5 text-left">Staging</th>
            <th className="px-3 py-2.5 text-left">Canopy</th>
            <th className="px-3 py-2.5 text-left">Pad</th>
            <th className="px-3 py-2.5 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((r, i) => (
            <tr key={i} className={`transition-colors ${r.loadoutStatus === 'matched' ? 'hover:bg-blue-50' : 'bg-slate-50 hover:bg-slate-100'}`}>
              <td className="px-3 py-2 font-medium text-content">{r.name}</td>
              <td className="px-3 py-2 font-mono text-content-muted text-[10px]">{r.transponderId || <span className="text-slate-300">—</span>}</td>
              <td className="px-3 py-2 font-mono font-bold text-content">{r.routeCode || <span className="text-slate-300 font-normal">—</span>}</td>
              <td className="px-3 py-2 font-semibold text-content">{r.wave || <span className="text-slate-300 font-normal">—</span>}</td>
              <td className="px-3 py-2 text-content-muted">{r.waveTime || <span className="text-slate-300">—</span>}</td>
              <td className="px-3 py-2 font-mono text-content-muted">{r.staging || <span className="text-slate-300">—</span>}</td>
              <td className="px-3 py-2">
                {r.canopy
                  ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${r.canopy === 'NORTH' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{r.canopy}</span>
                  : <span className="text-slate-300">—</span>}
              </td>
              <td className="px-3 py-2 text-content-muted text-[10px]">{r.launchpad || <span className="text-slate-300">—</span>}</td>
              <td className="px-3 py-2"><StatusPill status={r.loadoutStatus} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderGroup = (label, color, rows) => {
    if (!rows.length) return null;
    const flags = rows.filter(r => r.loadoutStatus !== 'matched').length;
    return (
      <div key={label} className="space-y-1.5">
        <SectionHeader label={label} count={rows.length} flagCount={flags} color={color} />
        <LoadoutTable rows={rows} />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-content">DMF5 Loadout</h3>
          <p className="text-xs text-content-muted mt-0.5">
            Filter: <strong>LSMD</strong> rows only · Matched to Step 2 routes by Route Code
          </p>
        </div>
        <UploadButton
          label="Upload DMF5 Loadout"
          accept=".xlsx,.xls"
          loading={loading}
          fileName={loadoutData?.file_name}
          onFile={onUpload}
        />
      </div>

      {loadoutCount > 0 && (
        <SummaryBar>
          <span className="font-semibold text-content">{loadoutCount} LSMD routes in loadout</span>
          <span className="text-emerald-600">✓ {matchedCount} matched to drivers</span>
          {noLoadoutCount > 0 && <span className="text-slate-500">⚪ {noLoadoutCount} no loadout data</span>}
        </SummaryBar>
      )}

      {hasAnyData ? (
        <div className="space-y-4">
          {renderGroup('EDV', 'blue', groups.EDV)}
          {renderGroup('Step Van', 'indigo', groups['STEP VAN'])}
          {renderGroup('Helper', 'amber', groups.HELPER)}
        </div>
      ) : (
        <EmptyState
          icon={FileSpreadsheet}
          title="Complete Steps 1 & 2 first, then upload the DMF5 Loadout"
          subtitle="Loadout data will be matched to routes by Route Code"
          hint="Filter: DSP = LSMD · Extracts: Route | Staging Location | Canopy | Wave | Wave Time | Launchpad"
        />
      )}
    </div>
  );
}

// ══ STEP 4 TAB — Vehicle & Device Assignment ══════════════════════════════════

function AssignmentRow({ driver, staffId, assignment, vehicles, onSave }) {
  const [vehicleId, setVehicleId] = useState(String(assignment.vehicle_id || ''));
  const [deviceId,  setDeviceId]  = useState(assignment.device_id  || '');
  const [notes,     setNotes]     = useState(assignment.notes       || '');
  const [dirty,     setDirty]     = useState(false);

  useEffect(() => {
    setVehicleId(String(assignment.vehicle_id || ''));
    setDeviceId(assignment.device_id  || '');
    setNotes(assignment.notes || '');
    setDirty(false);
  }, [assignment.vehicle_id, assignment.device_id, assignment.notes]);

  const handleSave = () => {
    if (!staffId) return;
    onSave({ vehicle_id: vehicleId ? parseInt(vehicleId) : null, device_id: deviceId || null, notes: notes || null });
    setDirty(false);
  };

  const activeVehicles = vehicles.filter(v => v.status === 'active');

  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-4 py-2.5 font-medium text-content text-sm">{driver.name}</td>
      <td className="px-4 py-2.5 text-xs text-content-muted">{driver.shiftType || '—'}</td>
      <td className="px-4 py-2.5 font-mono text-xs text-content-muted">{driver.routeCode || '—'}</td>
      <td className="px-4 py-2.5 w-56">
        {staffId ? (
          <select
            className="select text-xs py-1 w-full"
            value={vehicleId}
            onChange={e => { setVehicleId(e.target.value); setDirty(true); }}
          >
            <option value="">— No vehicle —</option>
            {activeVehicles.map(v => (
              <option key={v.id} value={v.id}>
                {v.vehicle_name}{v.license_plate ? ` (${v.license_plate})` : ''}
              </option>
            ))}
          </select>
        ) : <span className="text-slate-300 text-xs">No driver profile</span>}
      </td>
      <td className="px-4 py-2.5 w-36">
        {staffId ? (
          <input
            className="input text-xs py-1 w-full"
            placeholder="Device ID"
            value={deviceId}
            onChange={e => { setDeviceId(e.target.value); setDirty(true); }}
            onBlur={() => { if (dirty) handleSave(); }}
          />
        ) : <span className="text-slate-300 text-xs">—</span>}
      </td>
      <td className="px-4 py-2.5">
        {staffId ? (
          <div className="flex items-center gap-2">
            <input
              className="input text-xs py-1 flex-1 min-w-0"
              placeholder="Notes…"
              value={notes}
              onChange={e => { setNotes(e.target.value); setDirty(true); }}
              onBlur={() => { if (dirty) handleSave(); }}
            />
            {dirty && (
              <button onClick={handleSave} className="flex-shrink-0 text-primary hover:text-primary-hover" title="Save">
                <Save size={13} />
              </button>
            )}
          </div>
        ) : <span className="text-slate-300 text-xs">—</span>}
      </td>
    </tr>
  );
}

function Step4Tab({ planDate, combinedDrivers, vehicles, assignments, onSaveAssignment }) {
  if (!combinedDrivers.length) {
    return (
      <EmptyState
        icon={Car}
        title="No drivers to assign yet"
        subtitle="Complete Step 1 to see drivers for this date"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-content">Vehicle & Device Assignment</h3>
        <p className="text-xs text-content-muted mt-0.5">
          Assign a vehicle and scanning device to each driver for <strong>{planDate}</strong>
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-card-border bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-semibold text-content-muted uppercase tracking-wide">
              <th className="px-4 py-2.5 text-left">Driver</th>
              <th className="px-4 py-2.5 text-left">Shift Type</th>
              <th className="px-4 py-2.5 text-left">Route</th>
              <th className="px-4 py-2.5 text-left w-56">Vehicle Assigned</th>
              <th className="px-4 py-2.5 text-left w-36">Device ID</th>
              <th className="px-4 py-2.5 text-left">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {combinedDrivers.map((d, i) => {
              const staffId = d.profile?.staff_id;
              const asgn    = staffId ? (assignments[staffId] || {}) : {};
              return (
                <AssignmentRow
                  key={i}
                  driver={d}
                  staffId={staffId}
                  assignment={asgn}
                  vehicles={vehicles}
                  onSave={data => onSaveAssignment(staffId, data)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══ INLINE SHIFT TYPE (click to change, saves to shifts API) ════════════════

const SHIFT_TYPES = [
  'EDV', 'STEP VAN', 'HELPER', 'ON CALL', 'EXTRA',
  'DISPATCH AM', 'DISPATCH PM', 'UTO', 'PTO', 'TRAINING', 'SUSPENSION',
];

function InlineShiftType({ currentType, onSave }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-[11px] font-semibold text-content hover:text-blue-600 hover:underline transition-colors cursor-pointer"
        title="Click to change shift type"
      >
        {currentType || <span className="text-slate-300 font-normal">—</span>}
      </button>
    );
  }
  return (
    <select
      autoFocus
      value={currentType || ''}
      onChange={e => { onSave(e.target.value); setEditing(false); }}
      onBlur={() => setEditing(false)}
      className="text-[11px] border border-blue-400 rounded px-1 py-0.5 bg-white focus:outline-none"
    >
      <option value="">— type</option>
      {SHIFT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

// ══ INLINE ROUTE CODE (free-text combobox with reassign detection) ════════════

function InlineRouteCode({ currentCode, allRouteCodes = [], assignedRouteMap, myName, onSave, onRequestReassign }) {
  const [editing, setEditing]   = useState(false);
  const [inputVal, setInputVal] = useState(currentCode || '');
  const [showList, setShowList] = useState(false);
  const ref      = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) setInputVal(currentCode || '');
  }, [currentCode, editing]);

  useEffect(() => {
    if (!editing) return;
    const handler = e => {
      if (ref.current && !ref.current.contains(e.target)) handleCommit(inputVal);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editing, inputVal]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestions = useMemo(() => {
    const q = (inputVal || '').trim().toUpperCase();
    const matches = q ? allRouteCodes.filter(rc => rc.toUpperCase().includes(q)) : [...allRouteCodes];
    // Sort: unassigned routes first, then taken routes
    matches.sort((a, b) => {
      const aTaken = !!assignedRouteMap[a] && assignedRouteMap[a] !== myName;
      const bTaken = !!assignedRouteMap[b] && assignedRouteMap[b] !== myName;
      if (aTaken !== bTaken) return aTaken ? 1 : -1;
      return a.localeCompare(b);
    });
    return matches.slice(0, 40);
  }, [inputVal, allRouteCodes, assignedRouteMap, myName]);

  const handleSelect = (rc) => {
    const code = rc.toUpperCase().trim();
    setEditing(false); setShowList(false);
    if (!code || code === (currentCode || '').toUpperCase()) return;
    const takenBy = assignedRouteMap[code];
    const isTaken = !!takenBy && takenBy !== myName;
    if (isTaken) onRequestReassign(code, takenBy);
    else onSave(code);
  };

  const handleCommit = (val) => {
    const code = (val || '').trim().toUpperCase();
    setEditing(false); setShowList(false);
    if (!code) { onSave(null); return; }
    if (code === (currentCode || '').toUpperCase()) return;
    const takenBy = assignedRouteMap[code];
    const isTaken = !!takenBy && takenBy !== myName;
    if (isTaken) onRequestReassign(code, takenBy);
    else onSave(code);
  };

  if (!editing) {
    const isCustom = currentCode && !allRouteCodes.includes(currentCode.toUpperCase());
    return (
      <button
        onClick={() => { setEditing(true); setInputVal(currentCode || ''); setShowList(true); }}
        className="text-[11px] font-mono font-bold text-content hover:text-blue-600 hover:underline transition-colors cursor-pointer flex items-center gap-1"
        title={isCustom ? `Custom route: ${currentCode} (not in Routes file)` : 'Click to assign route — type any code or pick from list'}
      >
        {currentCode ? (
          <>
            {currentCode}
            {isCustom && (
              <span className="text-[8px] bg-violet-100 text-violet-600 px-1 py-0.5 rounded font-sans font-bold leading-none">FLEX</span>
            )}
          </>
        ) : <span className="text-slate-300 font-normal font-sans">—</span>}
      </button>
    );
  }

  const typedUpper = (inputVal || '').trim().toUpperCase();
  const typedIsNew = typedUpper && !allRouteCodes.includes(typedUpper);

  return (
    <div ref={ref} className="relative">
      <input
        ref={inputRef}
        autoFocus
        value={inputVal}
        onChange={e => { setInputVal(e.target.value.toUpperCase()); setShowList(true); }}
        onFocus={() => setShowList(true)}
        onKeyDown={e => {
          if (e.key === 'Enter')  { handleCommit(inputVal); e.stopPropagation(); }
          if (e.key === 'Escape') { setEditing(false); setShowList(false); e.stopPropagation(); }
          e.stopPropagation();
        }}
        placeholder="Route…"
        className="text-[11px] font-mono border border-blue-400 rounded px-1 py-0.5 bg-white focus:outline-none w-20"
      />
      {showList && (
        <div className="absolute top-full left-0 mt-0.5 bg-white border border-slate-200 rounded-lg shadow-lg z-30 max-h-48 overflow-y-auto min-w-[180px]">
          {/* Clear option */}
          <button onMouseDown={() => { onSave(null); setEditing(false); setShowList(false); }}
            className="w-full text-left px-3 py-1 text-[11px] text-slate-400 hover:bg-slate-50 border-b border-slate-100">
            — clear route
          </button>
          {/* Custom FLEX route entry */}
          {typedIsNew && (
            <button onMouseDown={() => handleSelect(typedUpper)}
              className="w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-violet-50 flex items-center gap-2 border-b border-violet-100">
              <span className="text-[9px] bg-violet-100 text-violet-700 px-1 rounded font-sans font-bold">FLEX</span>
              <span className="text-violet-700 font-bold">{typedUpper}</span>
              <span className="text-[10px] text-slate-400 font-sans font-normal ml-auto">custom route</span>
            </button>
          )}
          {/* Matching routes */}
          {suggestions.map(rc => {
            const takenBy = assignedRouteMap[rc];
            const isMine  = takenBy === myName;
            const isTaken = !!takenBy && !isMine;
            return (
              <button key={rc} onMouseDown={() => handleSelect(rc)}
                className={`w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-blue-50 flex items-center justify-between gap-3 ${isTaken ? 'text-amber-600' : 'text-content'}`}>
                <span>{rc}</span>
                {isTaken && <span className="text-[10px] font-sans text-amber-500 truncate max-w-[80px]" title={takenBy}>{takenBy}</span>}
                {isMine  && <span className="text-[10px] font-sans text-emerald-500">mine</span>}
              </button>
            );
          })}
          {suggestions.length === 0 && !typedIsNew && (
            <div className="px-3 py-2 text-[11px] text-slate-400">No routes found</div>
          )}
        </div>
      )}
    </div>
  );
}

// ══ INLINE VEHICLE / DEVICE CELLS ════════════════════════════════════════════

function InlineAssignment({ staffId, assignment, vehicles, assignedVehicleMap, myName, onSave }) {
  const [vehicleId, setVehicleId] = useState(String(assignment?.vehicle_id || ''));
  const [deviceId,  setDeviceId]  = useState(assignment?.device_id || '');

  useEffect(() => {
    setVehicleId(String(assignment?.vehicle_id || ''));
    setDeviceId(assignment?.device_id || '');
  }, [assignment?.vehicle_id, assignment?.device_id]);

  const activeVehicles = vehicles.filter(v => v.status === 'active');

  const handleVehicleChange = (e) => {
    const val = e.target.value;
    setVehicleId(val);
    onSave({ vehicle_id: val ? parseInt(val) : null, device_id: deviceId || null });
  };

  const handleDeviceBlur = () => {
    onSave({ vehicle_id: vehicleId ? parseInt(vehicleId) : null, device_id: deviceId || null });
  };

  if (!staffId) {
    return (
      <>
        <td className="px-2 py-1.5"><span className="text-slate-300 text-[10px]">—</span></td>
        <td className="px-2 py-1.5"><span className="text-slate-300 text-[10px]">—</span></td>
      </>
    );
  }

  return (
    <>
      <td className="px-2 py-1.5">
        <select
          value={vehicleId}
          onChange={handleVehicleChange}
          className="text-[11px] border border-slate-200 rounded px-1.5 py-0.5 bg-white text-content w-28 max-w-full"
        >
          <option value="">— Vehicle</option>
          {activeVehicles.map(v => {
            const takenBy = assignedVehicleMap?.[v.id];
            const isMine  = takenBy === myName;
            const isTaken = !!takenBy && !isMine;
            const label   = `${v.vehicle_name || v.license_plate || `#${v.id}`}${isTaken ? ` (${takenBy})` : ''}`;
            return (
              <option key={v.id} value={String(v.id)} disabled={isTaken} style={isTaken ? { color: '#9ca3af' } : {}}>
                {label}
              </option>
            );
          })}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <input
          type="text"
          value={deviceId}
          onChange={e => setDeviceId(e.target.value)}
          onBlur={handleDeviceBlur}
          placeholder="Device ID"
          className="text-[11px] border border-slate-200 rounded px-1.5 py-0.5 bg-white w-24 max-w-full"
        />
      </td>
    </>
  );
}

// ══ INLINE TEXT EDIT (click to edit any text field, saves on blur/enter) ══════

function InlineTextEdit({ value, override, onSave, placeholder, mono, width = 'w-16' }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(override ?? value ?? '');

  useEffect(() => {
    if (!editing) setLocal(override ?? value ?? '');
  }, [override, value, editing]);

  const displayVal = override != null ? override : value;
  const isOverridden = override != null && override !== '' && override !== value;

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        title="Click to edit"
        className={`text-[11px] hover:underline hover:text-blue-600 transition-colors cursor-pointer leading-none ${
          mono ? 'font-mono font-bold' : 'font-medium'
        } ${isOverridden ? 'text-amber-700' : 'text-content'}`}
      >
        {displayVal || <span className="text-slate-300 font-normal font-sans">—</span>}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="text"
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { onSave(local || null); setEditing(false); }}
      onKeyDown={e => {
        if (e.key === 'Enter') { onSave(local || null); setEditing(false); }
        if (e.key === 'Escape') { setLocal(override ?? value ?? ''); setEditing(false); }
        e.stopPropagation();
      }}
      placeholder={placeholder}
      className={`text-[11px] border border-blue-400 rounded px-1 py-0 bg-white focus:outline-none ${width} ${mono ? 'font-mono' : ''}`}
      style={{ height: '20px' }}
    />
  );
}

function InlineCanopyEdit({ value, override, onSave }) {
  const [editing, setEditing] = useState(false);
  const displayVal = override != null ? override : value;
  const isOverridden = override != null && override !== '' && override !== value;

  if (!editing) {
    if (!displayVal) {
      return (
        <button onClick={() => setEditing(true)} className="text-slate-300 text-[11px] hover:text-blue-400 transition-colors">
          —
        </button>
      );
    }
    return (
      <button onClick={() => setEditing(true)} title="Click to edit">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer hover:opacity-80 ${
          displayVal === 'NORTH' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
        } ${isOverridden ? 'ring-1 ring-amber-400' : ''}`}>
          {displayVal}
        </span>
      </button>
    );
  }
  return (
    <select
      autoFocus
      value={displayVal || ''}
      onChange={e => { onSave(e.target.value || null); setEditing(false); }}
      onBlur={() => setEditing(false)}
      className="text-[11px] border border-blue-400 rounded px-1 py-0 bg-white focus:outline-none"
      style={{ height: '20px' }}
    >
      <option value="">— none</option>
      <option value="NORTH">NORTH</option>
      <option value="SOUTH">SOUTH</option>
    </select>
  );
}

// ══ INLINE TIME CELL ══════════════════════════════════════════════════════════

function InlineTimeCell({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value || '');

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft || null);
  };

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(value || ''); setEditing(true); }}
        className={`font-mono text-[11px] px-1.5 py-0.5 rounded hover:bg-blue-50 transition-colors ${value ? 'text-content font-semibold' : 'text-slate-300'}`}
        title="Click to edit"
      >
        {value || '—'}
      </button>
    );
  }

  return (
    <input
      type="time"
      autoFocus
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      className="text-[11px] border border-blue-400 rounded px-1 py-0 bg-white focus:outline-none w-24"
    />
  );
}

// ══ DRIVER SEARCH DROPDOWN ════════════════════════════════════════════════════

function DriverSearchDropdown({ currentName, allDrivers = [], excludeStaffIds = new Set(), onSelect, placeholder = 'Search driver…', inModal = false }) {
  const [open, setOpen]       = useState(false);
  const [search, setSearch]   = useState('');
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 240 });
  const wrapRef               = useRef(null);
  const btnRef                = useRef(null);
  const inputRef              = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = e => {
      const inWrap = wrapRef.current?.contains(e.target);
      // For portal dropdowns, check data-dsd-portal attribute
      const inPortal = e.target.closest('[data-dsd-portal]');
      if (!inWrap && !inPortal) { setOpen(false); setSearch(''); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const calcPos = (el) => {
    const rect = el.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 240) });
  };

  const handleOpen = () => {
    setOpen(true);
    setTimeout(() => {
      if (inModal && btnRef.current) calcPos(btnRef.current);
      inputRef.current?.focus();
    }, 10);
  };

  const filtered = useMemo(() => {
    const available = allDrivers.filter(d => !excludeStaffIds.has(d.id));
    if (!search.trim()) return available;
    const q = search.toLowerCase();
    return available.filter(d =>
      d.name.toLowerCase().includes(q) ||
      (d.transponderId || '').toLowerCase().includes(q)
    );
  }, [allDrivers, excludeStaffIds, search]);

  const dropdownContent = (() => {
    if (filtered.length > 0) {
      return (
        <div
          data-dsd-portal
          style={inModal ? { position: 'fixed', top: dropPos.top, left: dropPos.left, minWidth: dropPos.width, zIndex: 9999 } : {}}
          className={`${inModal ? '' : 'absolute top-full left-0 mt-0.5 z-30'} bg-white border border-slate-200 rounded-lg shadow-xl max-h-52 overflow-y-auto min-w-[240px]`}
        >
          {filtered.slice(0, 25).map(d => (
            <button
              key={d.id}
              onMouseDown={() => { onSelect(d); setOpen(false); setSearch(''); }}
              className="w-full text-left px-3 py-1.5 hover:bg-blue-50 flex items-center justify-between gap-3"
            >
              <span className="text-[11px] font-medium text-content">{d.name}</span>
              {d.transponderId && (
                <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">{d.transponderId}</span>
              )}
            </button>
          ))}
        </div>
      );
    }
    if (search.trim()) {
      return (
        <div
          data-dsd-portal
          style={inModal ? { position: 'fixed', top: dropPos.top, left: dropPos.left, minWidth: dropPos.width, zIndex: 9999 } : {}}
          className={`${inModal ? '' : 'absolute top-full left-0 mt-0.5 z-30'} bg-white border border-slate-200 rounded-lg shadow-xl px-3 py-2 text-[11px] text-slate-400 min-w-[200px]`}
        >
          No drivers found
        </div>
      );
    }
    return null;
  })();

  if (!open) {
    return (
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="text-[11px] font-medium text-content hover:text-blue-600 hover:underline transition-colors cursor-pointer text-left"
      >
        {currentName || <span className="text-slate-300 font-normal">—</span>}
      </button>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <div ref={btnRef} className="flex items-center gap-0.5 border border-blue-400 rounded bg-white">
        <input
          ref={inputRef}
          autoFocus
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            if (inModal && btnRef.current) calcPos(btnRef.current);
          }}
          placeholder={placeholder}
          className="text-[11px] px-1.5 py-0.5 bg-transparent focus:outline-none w-28"
          onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setSearch(''); } e.stopPropagation(); }}
        />
        <button onClick={() => { setOpen(false); setSearch(''); }} className="px-1 text-slate-300 hover:text-slate-500">
          <X size={10} />
        </button>
      </div>
      {inModal ? createPortal(dropdownContent, document.body) : dropdownContent}
    </div>
  );
}

// ══ MAIN COMPONENT ════════════════════════════════════════════════════════════

export default function OperationalPlanner({ embedded, planDate: planDateProp, onDateChange: onDateChangeProp }) {
  const qc       = useQueryClient();
  const navigate = useNavigate();

  // Standalone date state — used when NOT embedded in Schedule
  const [standaloneDate, setStandaloneDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  // Shadow the prop names so all downstream code works without changes
  const planDate    = planDateProp    ?? standaloneDate;
  const onDateChange = onDateChangeProp ?? setStandaloneDate;
  const [uploading, setUploading]   = useState({}); // { step1: bool, step2: bool, step3: bool }
  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerRef = useRef(null);
  const [resolvedMultiDAs, setResolvedMultiDAs] = useState({}); // routeCode → { id, name, transponderId }
  // Filter bar state — each key corresponds to a column; empty string = no filter
  const [filters, setFilters] = useState({
    driver: '', shiftType: '', routeCode: '', wave: '', waveTime: '',
    staging: '', canopy: '', launchpad: '', status: '',
  });
  const setFilter = (key, val) => setFilters(f => ({ ...f, [key]: val }));
  const clearFilters = () => setFilters({ driver: '', shiftType: '', routeCode: '', wave: '', waveTime: '', staging: '', canopy: '', launchpad: '', status: '' });
  const hasActiveFilters = Object.values(filters).some(Boolean);

  // Multi-column sort state — sortKeys is an ordered array of { col, dir }
  // Index 0 = primary sort (shown as ↑1), index 1 = tiebreaker (↑2), etc.
  const [sortKeys, setSortKeys] = useState([]);
  const handleSort = (col) => {
    setSortKeys(prev => {
      const idx = prev.findIndex(k => k.col === col);
      if (idx < 0) {
        // New column: add as primary (prepend), push others down
        return [{ col, dir: 'asc' }, ...prev];
      }
      if (prev[idx].dir === 'asc') {
        // Second click same column: flip to desc, keep position
        return prev.map(k => k.col === col ? { ...k, dir: 'desc' } : k);
      }
      // Third click same column: remove from sort stack
      return prev.filter(k => k.col !== col);
    });
  };

  // Reassign confirmation popup state
  const [reassignConfirm, setReassignConfirm] = useState(null);
  // { routeCode, fromDriverName, fromStaffId, toStaffId, toDriverName }

  // Schedule confirmation popup: fires before any shift create/update
  const [scheduleConfirm, setScheduleConfirm] = useState(null);
  // { driverName, shiftType, isUpdate, onYes, onNo }

  // Staff IDs where user chose "No, Ops Planner Only" (no schedule entry)
  const [opsOnlyStaffIds, setOpsOnlyStaffIds] = useState(new Set());

  // Add Driver modal state
  const [showAddDriverModal, setShowAddDriverModal] = useState(false);
  const [addDriverSelection, setAddDriverSelection] = useState(null); // { id, name, transponderId }
  const [addDriverShiftType, setAddDriverShiftType] = useState('EDV');
  const [addDriverRouteCode, setAddDriverRouteCode] = useState('');

  // Rescue modal state
  const [rescueModal, setRescueModal] = useState(null); // { staffId, displayName, effectiveRoute }
  const [rescueForm, setRescueForm] = useState({ rescuerId: null, rescuerName: '', rescueTime: '', packages: '', reason: '', notes: '' });

  // ── Data fetching ────────────────────────────────────────────────────────────

  const { data: driverProfiles = [] } = useQuery({
    queryKey: ['driver-profiles'],
    queryFn:  () => api.get('/drivers').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: allStaff = [] } = useQuery({
    queryKey: ['staff'],
    queryFn:  () => api.get('/staff').then(r => r.data).catch(() => []),
    staleTime: 5 * 60 * 1000,
  });

  const { data: internalShifts = [], isLoading: shiftsLoading } = useQuery({
    queryKey: ['shifts-daily', planDate],
    queryFn:  () => api.get('/shifts', { params: { start: planDate, end: planDate } }).then(r => r.data),
    enabled:  !!planDate,
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles'],
    queryFn:  () => api.get('/vehicles').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: rosterData }  = useQuery({
    queryKey: ['ops-roster', planDate],
    queryFn:  () => api.get('/ops-planner/roster',       { params: { date: planDate } }).then(r => r.data),
    enabled:  !!planDate,
  });
  const { data: routesData }  = useQuery({
    queryKey: ['ops-routes', planDate],
    queryFn:  () => api.get('/ops-planner/daily-routes', { params: { date: planDate } }).then(r => r.data),
    enabled:  !!planDate,
  });
  const { data: loadoutData } = useQuery({
    queryKey: ['ops-loadout', planDate],
    queryFn:  () => api.get('/ops-planner/loadout',      { params: { date: planDate } }).then(r => r.data),
    enabled:  !!planDate,
  });
  const { data: assignmentsArr = [] } = useQuery({
    queryKey: ['ops-assignments', planDate],
    queryFn:  () => api.get('/ops-planner/assignments',  { params: { date: planDate } }).then(r => r.data),
    enabled:  !!planDate,
  });

  const assignments = useMemo(() => {
    const m = {};
    for (const a of assignmentsArr) m[a.staff_id] = a;
    return m;
  }, [assignmentsArr]);

  // Pick list data
  const { data: pickListData = [] } = useQuery({
    queryKey: ['ops-picklist', planDate],
    queryFn:  () => api.get('/ops/picklist', { params: { date: planDate } }).then(r => r.data),
    enabled:  !!planDate,
  });
  const pickListMap = useMemo(() => {
    const m = {};
    for (const p of pickListData) {
      // Key by vehicle_id (CX93, HZA13) for matching, and also by route_code as fallback
      if (p.vehicle_id) m[p.vehicle_id.toUpperCase()] = p;
      if (p.route_code) m[p.route_code] = p;
    }
    return m;
  }, [pickListData]);
  const [pickListSummaryModal, setPickListSummaryModal] = useState(null); // { name, routeCode, pick } or 'all'
  const [pickListUploadResult, setPickListUploadResult] = useState(null); // upload validation result
  const [pickListDebug, setPickListDebug] = useState(null); // debug modal data
  const [whatsappConfirm, setWhatsappConfirm] = useState(false);
  const [whatsappSending, setWhatsappSending] = useState(false);
  const { data: picklistLockStatus } = useQuery({
    queryKey: ['picklist-lock-status'],
    queryFn: () => api.get('/ops/picklist-lock-status').then(r => r.data),
    staleTime: 60 * 1000,
  });

  const { data: rescues = [] } = useQuery({
    queryKey: ['analytics-rescues', planDate],
    queryFn:  () => api.get('/analytics/rescues', { params: { date: planDate } }).then(r => r.data),
    enabled:  !!planDate,
  });

  const rescueCountByName = useMemo(() => {
    const m = {};
    for (const r of rescues) m[r.rescued_name] = (m[r.rescued_name] || 0) + 1;
    return m;
  }, [rescues]);

  const creditCountByName = useMemo(() => {
    const m = {};
    for (const r of rescues) m[r.rescuer_name] = (m[r.rescuer_name] || 0) + 1;
    return m;
  }, [rescues]);

  // Route profiles (difficulty scores)
  const { data: routeProfilesList = [] } = useQuery({
    queryKey: ['route-profiles'],
    queryFn: () => api.get('/analytics/route-profiles').then(r => r.data),
    staleTime: 10 * 60 * 1000,
  });
  const routeProfileMap = useMemo(() => {
    const m = {};
    for (const p of routeProfilesList) m[p.route_code] = p;
    return m;
  }, [routeProfilesList]);

  // Route duration in minutes, keyed by route code
  const durationByRoute = useMemo(() => {
    const m = {};
    for (const r of (routesData?.routes || [])) {
      if (r.routeCode && r.duration) {
        const mins = parseDurationToMinutes(r.duration);
        if (mins) m[r.routeCode] = mins;
      }
    }
    return m;
  }, [routesData]);

  // ── Mutations ────────────────────────────────────────────────────────────────

  const saveAssignment = useMutation({
    mutationFn: ({ staffId, data }) =>
      api.post('/ops-planner/assignments', { plan_date: planDate, staff_id: staffId, ...data }),
    onMutate: async ({ staffId, data }) => {
      await qc.cancelQueries({ queryKey: ['ops-assignments', planDate] });
      const prev = qc.getQueryData(['ops-assignments', planDate]);
      qc.setQueryData(['ops-assignments', planDate], (old = []) => {
        const idx = old.findIndex(a => a.staff_id === staffId);
        if (idx >= 0) {
          const updated = [...old];
          updated[idx] = { ...updated[idx], ...data };
          return updated;
        }
        return [...old, { staff_id: staffId, plan_date: planDate, ...data }];
      });
      return { prev };
    },
    onError: (err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['ops-assignments', planDate], ctx.prev);
      toast.error('Failed to save assignment');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['ops-assignments', planDate] });
    },
  });

  // Create an internal shift for a driver (used when adding driver to Ops Planner)
  // source: 'ops_planner' marks it as published immediately
  const createShiftForDriver = useMutation({
    mutationFn: ({ staff_id, shift_type }) => api.post('/shifts', {
      staff_id, shift_date: planDate, shift_type,
      start_time: '11:00', end_time: '21:00', status: 'active',
      source: 'ops_planner',
    }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts-daily', planDate] });
      qc.invalidateQueries({ queryKey: ['shifts'] });
    },
    onError: () => toast.error('Failed to create shift'),
  });

  // Update shift type on an existing shift (inline editing in Ops Planner)
  // source: 'ops_planner' bypasses publish workflow — changes take effect immediately
  const updateShiftType = useMutation({
    mutationFn: ({ shiftId, shift_type, currentShift }) =>
      api.put(`/shifts/${shiftId}`, {
        shift_type,
        start_time: (currentShift?.start_time || '11:00:00').slice(0, 5),
        end_time:   (currentShift?.end_time   || '21:00:00').slice(0, 5),
        status:     currentShift?.status || 'active',
        notes:      currentShift?.notes  || null,
        source:     'ops_planner',
      }).then(r => r.data),
    onMutate: async ({ shiftId, shift_type }) => {
      await qc.cancelQueries({ queryKey: ['shifts-daily', planDate] });
      const prev = qc.getQueryData(['shifts-daily', planDate]);
      qc.setQueryData(['shifts-daily', planDate], (old = []) =>
        old.map(s => s.id === shiftId ? { ...s, shift_type } : s)
      );
      return { prev };
    },
    onError: (err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['shifts-daily', planDate], ctx.prev);
      toast.error('Failed to update shift type');
    },
    onSuccess: (data, vars) => {
      if (data?.ops_removed) {
        toast('Driver removed from Ops Planner', { icon: '🔒' });
        qc.invalidateQueries({ queryKey: ['ops-assignments', planDate] });
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['shifts-daily', planDate] });
      qc.invalidateQueries({ queryKey: ['shifts'] });
    },
  });

  // Patch a single field on an existing assignment (loadout overrides, etc.)
  const patchAssignment = useMutation({
    mutationFn: ({ staffId, data }) =>
      api.patch(`/ops-planner/assignments/${staffId}`, { plan_date: planDate, ...data }),
    onMutate: async ({ staffId, data }) => {
      await qc.cancelQueries({ queryKey: ['ops-assignments', planDate] });
      const prev = qc.getQueryData(['ops-assignments', planDate]);
      qc.setQueryData(['ops-assignments', planDate], (old = []) => {
        const idx = old.findIndex(a => a.staff_id === staffId);
        if (idx >= 0) {
          const updated = [...old];
          updated[idx] = { ...updated[idx], ...data };
          return updated;
        }
        return old;
      });
      return { prev };
    },
    onError: (err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['ops-assignments', planDate], ctx.prev);
      toast.error('Failed to save');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['ops-assignments', planDate] }),
  });

  const logRescue = useMutation({
    mutationFn: d => api.post('/analytics/rescues', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['analytics-rescues', planDate] });
      setRescueModal(null);
      toast.success('Rescue logged 🚨');
    },
    onError: () => toast.error('Failed to log rescue'),
  });

  const deleteRescue = useMutation({
    mutationFn: id => api.delete(`/analytics/rescues/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['analytics-rescues', planDate] }),
    onError: () => toast.error('Failed to delete rescue'),
  });

  const removeDriver = useMutation({
    mutationFn: ({ staffId }) => api.post('/ops-planner/remove-driver', { plan_date: planDate, staff_id: staffId }),
    onSuccess: (_, { displayName }) => {
      qc.invalidateQueries({ queryKey: ['ops-assignments', planDate] });
      setRemoveConfirm(null);
      toast.success(`${displayName || 'Driver'} removed from Ops Planner`);
    },
    onError: () => toast.error('Failed to remove driver'),
  });

  const clearDayData = useMutation({
    mutationFn: () => api.delete('/ops-planner/clear-day', { params: { date: planDate } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ops-assignments', planDate] });
      qc.invalidateQueries({ queryKey: ['ops-routes',      planDate] });
      qc.invalidateQueries({ queryKey: ['ops-loadout',     planDate] });
      setShowClearConfirm(false);
      toast.success(`Day data cleared for ${format(parseISO(planDate), 'MMMM d, yyyy')}`);
    },
    onError: () => toast.error('Failed to clear day data'),
  });

  // ── Build transponder → profile lookup (used in multiple tabs + upload handler) ──

  const transpToProfile = useMemo(() => {
    const m = {};
    for (const dp of driverProfiles) {
      if (dp.transponder_id) m[norm(dp.transponder_id)] = dp;
      if (dp.employee_id)    m[norm(dp.employee_id)]    = dp;
    }
    return m;
  }, [driverProfiles]);

  // ── File upload handler ──────────────────────────────────────────────────────

  const handleUpload = async (step, file) => {
    if (!file) return;
    setUploading(u => ({ ...u, [step]: true }));
    try {
      const wb = await readExcelFile(file);

      if (step === 'step1') {
        const { driversByDate, availableDates, warnings } = parseWeekScheduleFile(wb);
        if (warnings.length) warnings.forEach(w => toast(w, { icon: '⚠️' }));

        // Auto-select today's column if present, otherwise first available date
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const target   = availableDates.find(d => d.dateStr === planDate)
                      || availableDates.find(d => d.dateStr === todayStr)
                      || availableDates[0];

        // Save roster under EVERY date in the file so switching dates always finds the data
        for (const { dateStr } of availableDates) {
          await api.post('/ops-planner/roster', {
            plan_date:       dateStr,
            file_name:       file.name,
            drivers_by_date: driversByDate,
            available_dates: availableDates,
          });
        }
        // Invalidate all roster queries (any date)
        qc.invalidateQueries({ queryKey: ['ops-roster'] });

        // Switch to the best matching date after saving
        if (target && onDateChange && target.dateStr !== planDate) onDateChange(target.dateStr);

        const total = Object.values(driversByDate).flat().length;
        toast.success(`Roster loaded — ${total} driver-day entries across ${availableDates.length} days`);
      }

      if (step === 'step2') {
        const { routes, warnings } = parseRoutesFile(wb);
        if (warnings.length) warnings.forEach(w => toast(w, { icon: '⚠️' }));

        await api.post('/ops-planner/daily-routes', {
          plan_date: planDate,
          file_name: file.name,
          routes,
        });
        qc.invalidateQueries({ queryKey: ['ops-routes', planDate] });

        // Keep ops_planner_sessions in sync so Schedule.jsx routeCodeMap still works
        const sessionRows = routes
          .map(r => {
            const profile = transpToProfile[norm(r.primaryTransponderId)];
            return profile ? { routeCode: r.routeCode, matchedDriver: { staff_id: profile.staff_id } } : null;
          })
          .filter(Boolean);
        api.post('/ops-planner', { plan_date: planDate, rows: sessionRows }).catch(() => {});

        toast.success(`${routes.length} Last Mile DSP routes loaded`);
      }

      if (step === 'step3') {
        const { loadout, volumeByDsp, warnings } = parseLoadoutFile(wb);
        if (warnings.length) warnings.forEach(w => toast(w, { icon: '⚠️' }));

        await api.post('/ops-planner/loadout', {
          plan_date: planDate,
          file_name: file.name,
          loadout,
        });
        qc.invalidateQueries({ queryKey: ['ops-loadout', planDate] });

        // Auto-save volume share for Analytics
        if (volumeByDsp && Object.keys(volumeByDsp).length > 0) {
          const total = Object.values(volumeByDsp).reduce((a, b) => a + b, 0);
          api.post('/analytics/volume-share', {
            plan_date: planDate,
            volume: volumeByDsp,
            total_routes: total,
          }).catch(() => {});
          qc.invalidateQueries({ queryKey: ['volume-share-dates'] });
          qc.invalidateQueries({ queryKey: ['volume-share', planDate] });
        }

        toast.success(`${loadout.length} LSMD loadout rows loaded — volume share saved`);
      }
    } catch (err) {
      console.error('[OpsPlanner upload]', err);
      // Prefer the backend's JSON error message over the generic axios "Request failed" message
      const msg = err?.response?.data?.error || err?.response?.data?.message || err.message || 'Unknown error';
      toast.error('Upload failed: ' + msg);
    } finally {
      setUploading(u => ({ ...u, [step]: false }));
    }
  };

  // ── Pick list PDF upload ────────────────────────────────────────────────────
  const handlePickListUpload = async (file) => {
    if (!file) return;
    setUploading(u => ({ ...u, picklist: true }));
    try {
      const formData = new FormData();
      formData.append('picklist', file);
      const { data } = await api.post('/ops/upload-picklist', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      qc.invalidateQueries({ queryKey: ['ops-picklist', planDate] });
      if (data.lsmd_routes > 0) {
        setPickListUploadResult(data);
      } else {
        toast('No LSMD routes found in pick list', { icon: '⚠️' });
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Unknown error';
      toast.error('Pick list upload failed: ' + msg);
    } finally {
      setUploading(u => ({ ...u, picklist: false }));
    }
  };

  // ── New 3-section data model ─────────────────────────────────────────────────

  const loadoutMap = useMemo(() => {
    const m = {};
    for (const item of (loadoutData?.loadout || [])) m[item.routeCode] = item;
    return m;
  }, [loadoutData]);

  const shiftByStaffId = useMemo(() => {
    const m = {};
    for (const s of internalShifts) m[s.staff_id] = s;
    return m;
  }, [internalShifts]);

  // Amazon drivers for this date, keyed by normalized TID
  const amazonDriversByTid = useMemo(() => {
    const drivers = rosterData?.drivers_by_date?.[planDate] || [];
    const m = {};
    for (const d of drivers) {
      if (d.transponderId) m[norm(d.transponderId)] = d;
    }
    return m;
  }, [rosterData, planDate]);

  // Set of TIDs that appear in ANY route from Routes file
  const routedTids = useMemo(() => {
    const s = new Set();
    for (const r of (routesData?.routes || [])) {
      for (const tid of r.transponderIds) s.add(norm(tid));
    }
    return s;
  }, [routesData]);

  // ALL drivers from master database (not just scheduled ones)
  const allDrivers = useMemo(() =>
    allStaff
      .filter(s => s.role === 'driver' && s.status === 'active')
      .map(s => {
        const profile = driverProfiles.find(dp => dp.staff_id === s.id);
        return {
          id: s.id,
          name: `${s.first_name} ${s.last_name}`,
          transponderId: profile?.transponder_id || s.employee_id || '',
          profile,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  , [allStaff, driverProfiles]);

  // Staff IDs of drivers manually assigned via assignments table (route-based)
  const manuallyAssignedStaffIds = useMemo(() => {
    const s = new Set();
    for (const a of assignmentsArr) if (a.route_code && a.staff_id) s.add(a.staff_id);
    return s;
  }, [assignmentsArr]);

  // Manual assignments by route code (most recent wins)
  const assignmentByRouteCode = useMemo(() => {
    const m = {};
    for (const a of assignmentsArr) {
      if (a.route_code) m[a.route_code] = a;
    }
    return m;
  }, [assignmentsArr]);

  // ── Section 1: Routes (source of truth = Routes file) ────────────────────────

  const section1Rows = useMemo(() => {
    const routes = routesData?.routes || [];

    // Manually routed staff IDs — excludes removed drivers (route_code=null on remove)
    const manuallyRoutedStaffIds = new Set();
    for (const a of assignmentsArr) if (a.route_code && a.staff_id && !a.removed_from_ops) manuallyRoutedStaffIds.add(a.staff_id);

    return routes.map(route => {
      const { routeCode, transponderIds, hasMultipleDAs } = route;
      const loadout = loadoutMap[routeCode] || null;

      const manualAsgn = assignmentByRouteCode[routeCode];
      let profile, internalShift, amazonEntry, primaryTid, asgn;

      // An "active" manual assignment: exists, not removed, and driver is working
      let activeManualAsgn = null;

      if (manualAsgn?.staff_id && !manualAsgn.removed_from_ops) {
        const dp    = driverProfiles.find(p => p.staff_id === manualAsgn.staff_id);
        const st    = allStaff.find(s => s.id === manualAsgn.staff_id);
        const shift = shiftByStaffId[manualAsgn.staff_id] || null;

        if (!OPS_EXCLUDED_TYPES.has(shift?.shift_type)) {
          // Skip non-working shift types → fall through to TID match
          activeManualAsgn = manualAsgn;
          profile       = dp || null;
          primaryTid    = dp?.transponder_id || '';
          internalShift = shift;
          amazonEntry   = primaryTid ? amazonDriversByTid[norm(primaryTid)] : null;
          asgn          = { ...manualAsgn };
          if (!asgn.name_override && st) asgn.name_override = `${st.first_name} ${st.last_name}`;
        }
      }

      if (!activeManualAsgn) {
        // TID-based match (or ON CALL/removed manual → fall through)
        primaryTid = transponderIds[0] || '';
        const candidateProfile = primaryTid ? transpToProfile[norm(primaryTid)] : null;
        if (candidateProfile?.staff_id && manuallyRoutedStaffIds.has(candidateProfile.staff_id)) {
          // Claimed by another manual assignment on a different route
          profile = null; primaryTid = ''; internalShift = null; amazonEntry = null; asgn = {};
        } else {
          const candidateShift = candidateProfile ? (shiftByStaffId[candidateProfile.staff_id] || null) : null;
          const candidateAsgn  = candidateProfile ? (assignments[candidateProfile.staff_id] || {}) : {};
          // Skip non-working shift types or removed drivers from TID match
          if (OPS_EXCLUDED_TYPES.has(candidateShift?.shift_type) || candidateAsgn.removed_from_ops) {
            profile = null; primaryTid = ''; internalShift = null; amazonEntry = null; asgn = {};
          } else {
            profile       = candidateProfile;
            internalShift = candidateShift;
            amazonEntry   = primaryTid ? amazonDriversByTid[norm(primaryTid)] : null;
            asgn          = candidateAsgn;
          }
        }
      }

      // Fix #1: any scheduled driver on a route = fully matched (route = confirmed working)
      let status;
      if (hasMultipleDAs && !activeManualAsgn) {
        status = 'multiple_das';
      } else if (!primaryTid && !activeManualAsgn) {
        status = 'unassigned_route';
      } else if (internalShift) {
        status = 'fully_matched';
      } else if (!internalShift && amazonEntry) {
        status = 'wrongly_rostered';
      } else {
        status = 'unassigned_route';
      }

      const displayName = (asgn?.name_override)
        || (profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '')
        || amazonEntry?.name || '';

      return {
        section: 'route',
        routeCode,
        transponderIds,
        hasMultipleDAs: hasMultipleDAs && !activeManualAsgn,
        allTids: transponderIds,
        transponderId: primaryTid,
        name: displayName,
        shiftType: internalShift?.shift_type || null,
        wave: loadout?.wave || '',
        waveTime: loadout?.waveTime || '',
        staging: loadout?.staging || '',
        canopy: loadout?.canopy || '',
        launchpad: loadout?.launchpad || '',
        profile, internalShift, amazonEntry, loadout, asgn, status,
      };
    });
  }, [routesData, loadoutMap, transpToProfile, shiftByStaffId, amazonDriversByTid, assignments, assignmentByRouteCode, driverProfiles, allStaff, assignmentsArr]);

  // Staff IDs that are ACTUALLY showing as assigned in section1 (for section3 dedup)
  // Differs from routedTids: a TID may be in routes file but driver was reassigned away
  const effectivelyRoutedStaffIds = useMemo(() => {
    const s = new Set();
    for (const r of section1Rows) {
      if (r.profile?.staff_id && r.name && r.status !== 'unassigned_route' && r.status !== 'multiple_das') {
        s.add(r.profile.staff_id);
      }
    }
    return s;
  }, [section1Rows]);

  // ── Section 2: Helpers (from Amazon weekly schedule) ─────────────────────────

  const section2Rows = useMemo(() => {
    const amazonDrivers = rosterData?.drivers_by_date?.[planDate] || [];
    return amazonDrivers
      .filter(d => d.amazonShiftType === 'HELPER')
      .map(d => {
        const profile = d.transponderId ? transpToProfile[norm(d.transponderId)] : null;
        const internalShift = profile ? shiftByStaffId[profile.staff_id] : null;
        const asgn = profile ? (assignments[profile.staff_id] || {}) : {};
        // Fix #2: skip removed helpers; Fix #4: skip non-working helpers
        if (asgn.removed_from_ops) return null;
        if (OPS_EXCLUDED_TYPES.has(internalShift?.shift_type)) return null;
        return {
          section: 'helper',
          routeCode: '',
          transponderIds: d.transponderId ? [d.transponderId] : [],
          hasMultipleDAs: false,
          allTids: d.transponderId ? [d.transponderId] : [],
          transponderId: d.transponderId || '',
          name: profile ? `${profile.first_name} ${profile.last_name}` : (d.name || ''),
          shiftType: internalShift?.shift_type || null,
          wave: '', waveTime: '', staging: '', canopy: '', launchpad: '',
          profile, internalShift, amazonEntry: d, loadout: null, asgn,
          status: internalShift ? 'helper_matched' : 'wrongly_rostered',
        };
      })
      .filter(Boolean);
  }, [rosterData, planDate, transpToProfile, shiftByStaffId, assignments]);

  // ── Section 3: Unrouted drivers + DSP-only drivers ───────────────────────────

  const section3Rows = useMemo(() => {
    const amazonDrivers = rosterData?.drivers_by_date?.[planDate] || [];
    const rows = [];
    const coveredStaffIds = new Set();

    // Real route codes from the Routes file (custom/flex routes are NOT in here)
    const realRouteCodeSet = new Set((routesData?.routes || []).map(r => r.routeCode).filter(Boolean));

    for (const r of section1Rows) if (r.profile?.staff_id) coveredStaffIds.add(r.profile.staff_id);
    for (const r of section2Rows) if (r.profile?.staff_id) coveredStaffIds.add(r.profile.staff_id);
    // Only mark drivers as "covered" if they have a REAL route assignment (in the routes file).
    // Drivers with custom/flex routes still need to appear in section3 since there's no section1 row for them.
    for (const a of assignmentsArr) {
      if (a.route_code && a.staff_id && !a.removed_from_ops && realRouteCodeSet.has(a.route_code)) {
        coveredStaffIds.add(a.staff_id);
      }
    }

    // Amazon non-helpers with no effective route
    for (const d of amazonDrivers) {
      if (d.amazonShiftType === 'HELPER') continue;
      const profile = d.transponderId ? transpToProfile[norm(d.transponderId)] : null;
      // Skip if effectively assigned to a route in section1 — mark covered so DSP-only loop doesn't duplicate
      if (profile?.staff_id && effectivelyRoutedStaffIds.has(profile.staff_id)) { coveredStaffIds.add(profile.staff_id); continue; }
      // Skip if manually assigned to a REAL route (in Amazon routes file) — mark covered so DSP-only loop doesn't duplicate
      // Drivers with custom routes (AX44, FLEX) fall through to get a row in section3
      if (profile?.staff_id && manuallyAssignedStaffIds.has(profile.staff_id)) {
        const drvAsgn = assignmentsArr.find(a => a.staff_id === profile.staff_id && a.route_code);
        if (drvAsgn?.route_code && realRouteCodeSet.has(drvAsgn.route_code)) { coveredStaffIds.add(profile.staff_id); continue; }
      }
      // Skip if TID is in routes file but has no profile match (handled by section1)
      if (!profile && d.transponderId && routedTids.has(norm(d.transponderId))) continue;

      const internalShift = profile ? shiftByStaffId[profile.staff_id] : null;
      const asgn = profile ? (assignments[profile.staff_id] || {}) : {};

      // Fix #2: skip removed drivers — mark covered
      if (asgn.removed_from_ops) { if (profile?.staff_id) coveredStaffIds.add(profile.staff_id); continue; }
      // Fix #3: Amazon-only driver (no DSP shift) whose TID was in the routes file
      // → they're accounted for in section1; after reassignment they should disappear
      if (!internalShift && d.transponderId && routedTids.has(norm(d.transponderId))) continue;
      // Fix #4: skip non-working drivers — mark covered
      if (OPS_EXCLUDED_TYPES.has(internalShift?.shift_type)) { if (profile?.staff_id) coveredStaffIds.add(profile.staff_id); continue; }

      if (profile) coveredStaffIds.add(profile.staff_id);
      // Fix #1: if they have an internal shift + manual route = fully matched
      const rowStatus = !internalShift ? 'wrongly_rostered'
        : asgn.route_code ? 'fully_matched'
        : 'not_in_amazon';
      rows.push({
        section: 'unrouted',
        routeCode: '',
        transponderIds: d.transponderId ? [d.transponderId] : [],
        hasMultipleDAs: false,
        allTids: d.transponderId ? [d.transponderId] : [],
        transponderId: d.transponderId || '',
        name: profile ? `${profile.first_name} ${profile.last_name}` : (d.name || ''),
        shiftType: internalShift?.shift_type || null,
        wave: '', waveTime: '', staging: '', canopy: '', launchpad: '',
        profile, internalShift, amazonEntry: d, loadout: null, asgn,
        status: rowStatus,
      });
    }

    // DSP Fleet Planner drivers not shown anywhere (not in Amazon at all)
    for (const shift of internalShifts) {
      if (coveredStaffIds.has(shift.staff_id)) continue;
      // Fix #4: skip non-working drivers
      if (OPS_EXCLUDED_TYPES.has(shift.shift_type)) continue;
      const s    = allStaff.find(x => x.id === shift.staff_id);
      const dp   = driverProfiles.find(p => p.staff_id === shift.staff_id);
      const asgn = assignments[shift.staff_id] || {};
      // Fix #2: skip removed drivers
      if (asgn.removed_from_ops) continue;
      // Fix #1: has route code = fully matched
      const rowStatus = asgn.route_code ? 'fully_matched' : 'not_in_amazon';
      rows.push({
        section: 'not_in_amazon',
        routeCode: asgn.route_code || '',
        transponderIds: dp?.transponder_id ? [dp.transponder_id] : [],
        hasMultipleDAs: false,
        allTids: dp?.transponder_id ? [dp.transponder_id] : [],
        transponderId: dp?.transponder_id || '',
        name: s ? `${s.first_name} ${s.last_name}` : `Staff #${shift.staff_id}`,
        shiftType: shift.shift_type || null,
        wave: '', waveTime: '', staging: '', canopy: '', launchpad: '',
        profile: dp || null, internalShift: shift, amazonEntry: null, loadout: null, asgn,
        status: rowStatus,
      });
    }

    return rows;
  }, [rosterData, planDate, routesData, routedTids, transpToProfile, shiftByStaffId, assignments, assignmentsArr, internalShifts, allStaff, driverProfiles, section1Rows, section2Rows, manuallyAssignedStaffIds, effectivelyRoutedStaffIds]);

  // ── Combined flat list ────────────────────────────────────────────────────────
  // Order: routes with drivers → unassigned routes → section3 gaps
  const allRows = useMemo(() => {
    const routesWithDrivers = section1Rows.filter(r => r.name && r.status !== 'unassigned_route' && r.status !== 'multiple_das');
    const routesUnassigned  = section1Rows.filter(r => !r.name || r.status === 'unassigned_route' || r.status === 'multiple_das');
    const combined = [...routesWithDrivers, ...routesUnassigned, ...section2Rows, ...section3Rows];
    // Dedup by staff_id — safety net against logic race conditions causing a driver to appear twice
    const seen = new Set();
    return combined.filter(row => {
      const sid = row.profile?.staff_id;
      if (!sid) return true; // unassigned routes have no staff_id, always include
      if (seen.has(sid)) return false;
      seen.add(sid);
      return true;
    });
  }, [section1Rows, section2Rows, section3Rows]);

  const hasAnyData = allRows.length > 0;

  // Filtered rows (apply filter bar)
  const filteredRows = useMemo(() => {
    if (!hasActiveFilters) return allRows;
    return allRows.filter(row => {
      const loadout = loadoutMap[row.routeCode] || row.loadout || {};
      if (filters.driver    && !row.name.toLowerCase().includes(filters.driver.toLowerCase())) return false;
      if (filters.shiftType && row.shiftType !== filters.shiftType) return false;
      if (filters.routeCode && !row.routeCode.toLowerCase().includes(filters.routeCode.toLowerCase())) return false;
      if (filters.wave      && (loadout.wave || row.wave) !== filters.wave) return false;
      if (filters.waveTime  && (loadout.waveTime || row.waveTime) !== filters.waveTime) return false;
      if (filters.staging   && !(loadout.staging || row.staging || '').toLowerCase().includes(filters.staging.toLowerCase())) return false;
      if (filters.canopy    && (loadout.canopy || row.canopy) !== filters.canopy) return false;
      if (filters.launchpad && !(loadout.launchpad || row.launchpad || '').toLowerCase().includes(filters.launchpad.toLowerCase())) return false;
      if (filters.status    && row.status !== filters.status) return false;
      return true;
    });
  }, [allRows, filters, hasActiveFilters, loadoutMap]);

  // Multi-column sorted + filtered rows — used in renderTable
  const sortedRows = useMemo(() => {
    if (!sortKeys.length) return filteredRows;
    const getVal = (row, col) => {
      const l = loadoutMap[row.routeCode] || row.loadout || {};
      switch (col) {
        case 'name':          return (row.name || '').toLowerCase();
        case 'transponderId': return (row.transponderId || '').toLowerCase();
        case 'shiftType':     return (row.shiftType || '').toLowerCase();
        case 'routeCode':     return (row.routeCode || '').toLowerCase();
        case 'wave':          return String(l.wave || '');
        case 'waveTime':      return (l.waveTime || '');
        case 'staging':       return (l.staging || '').toLowerCase();
        case 'canopy':        return (l.canopy || '').toLowerCase();
        case 'launchpad':     return (l.launchpad || '').toLowerCase();
        case 'status':        return (row.status || '');
        case 'vehicle': {
          const asgn = row.asgn || {};
          const v = vehicles.find(v => v.id === asgn.vehicle_id);
          return (v?.vehicle_name || '').toLowerCase();
        }
        case 'device':        return (row.asgn?.device_id || '').toLowerCase();
        case 'rts':           return (row.asgn?.finish_time || '');
        case 'pickList': {
          const rc = (row.asgn?.route_code || row.routeCode || '').toUpperCase();
          const pl = pickListMap[rc];
          return pl ? String(pl.total_packages || 0).padStart(5, '0') : '';
        }
        case 'eft': {
          const effectiveRoute = row.asgn?.route_code || row.routeCode || '';
          const wt  = l.waveTime || null;
          const dur = effectiveRoute ? durationByRoute[effectiveRoute] : null;
          const dep = wt ? addMinutesToTime(wt, 30) : null;
          return (dep && dur) ? addMinutesToTime(dep, dur) : '';
        }
        default:              return '';
      }
    };
    return [...filteredRows].sort((a, b) => {
      for (const { col, dir } of sortKeys) {
        const cmp = getVal(a, col).localeCompare(getVal(b, col), undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }, [filteredRows, sortKeys, loadoutMap, vehicles, pickListMap]);

  // Unique values for filter dropdowns
  const filterOptions = useMemo(() => {
    const waves = new Set(), canopies = new Set(), waveTimesSet = new Set();
    for (const r of allRows) {
      const l = loadoutMap[r.routeCode] || r.loadout || {};
      if (l.wave) waves.add(l.wave);
      if (l.canopy) canopies.add(l.canopy);
      if (l.waveTime) waveTimesSet.add(l.waveTime);
    }
    return {
      waves: [...waves].sort(),
      canopies: [...canopies].sort(),
      waveTimes: [...waveTimesSet].sort(),
    };
  }, [allRows, loadoutMap]);

  // Route codes available for assignment (exclude already assigned)
  const assignedRouteCodes = useMemo(() => {
    const s = new Set();
    for (const r of section1Rows) {
      if (r.routeCode && r.status !== 'unassigned_route' && r.status !== 'multiple_das') s.add(r.routeCode);
    }
    for (const a of assignmentsArr) if (a.route_code) s.add(a.route_code);
    return s;
  }, [section1Rows, assignmentsArr]);

  const allRouteCodes = useMemo(() => {
    const codes = (routesData?.routes || []).map(r => r.routeCode).filter(Boolean);
    return [...new Set(codes)].sort();
  }, [routesData]);

  const assignedVehicleMap = useMemo(() => {
    const m = {};
    for (const a of assignmentsArr) {
      if (a.vehicle_id) {
        const s = allStaff.find(x => x.id === a.staff_id);
        m[a.vehicle_id] = s ? `${s.first_name} ${s.last_name}` : 'Driver';
      }
    }
    return m;
  }, [assignmentsArr, allStaff]);

  const totalLoadoutRoutes = (loadoutData?.loadout || []).length;

  const summaryCounts = useMemo(() => {
    // All rows with a route code (Amazon + custom/flex)
    const allWithRoute = allRows.filter(r => (r.asgn?.route_code || r.routeCode) && r.shiftType !== 'HELPER');
    const assignedRoutes = allWithRoute.filter(r => r.name && r.status !== 'unassigned_route' && r.status !== 'multiple_das').length;
    const totalRoutes = allWithRoute.length;
    return {
      totalBlocks: allRows.filter(r => r.shiftType !== 'DISPATCH AM' && r.shiftType !== 'DISPATCH PM').length,
      routes: totalRoutes,
      assignedRoutes,
      helpers: section2Rows.length,
      wronglyRostered: allRows.filter(r => r.status === 'wrongly_rostered').length,
      notInAmazon: allRows.filter(r => r.status === 'not_in_amazon').length,
      unassignedRoutes: section1Rows.filter(r => r.status === 'unassigned_route').length,
      multipleDAs: allRows.filter(r => r.status === 'multiple_das').length,
      flags: allRows.filter(r => r.status !== 'fully_matched' && r.status !== 'helper_matched').length,
    };
  }, [section1Rows, section2Rows, allRows]);

  const [showUnassignedPopup, setShowUnassignedPopup] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(null); // { staffId, displayName }
  const [rowActionMenu, setRowActionMenu] = useState(null); // key of open row menu
  useEffect(() => {
    if (!rowActionMenu) return;
    const h = () => setRowActionMenu(null);
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [rowActionMenu]);

  const availableDates = rosterData?.available_dates || [];

  // Set of staff IDs already assigned to routes (for driver dropdown exclusion)
  const assignedDriverStaffIds = useMemo(() => {
    const s = new Set();
    for (const r of section1Rows) {
      if (r.profile?.staff_id && r.status !== 'unassigned_route' && r.status !== 'multiple_das') {
        s.add(r.profile.staff_id);
      }
    }
    return s;
  }, [section1Rows]);

  // ── Sign-Out Sheet ──────────────────────────────────────────────────────────
  const handlePrintSignOut = () => { window.open(`/sign-out-sheet?date=${planDate}`, '_blank'); };

  const handleExport = async () => {
    try {
      const { data } = await api.get('/ops/sign-out-data', { params: { date: planDate } });
      const { rows, dispAM = [], dispPM = [] } = data;
      if (!rows?.length) { toast('No data to export', { icon: '⚠️' }); return; }
      const dateLabel = format(parseISO(planDate), 'EEEE, MMMM d, yyyy');
      const openN = dispAM.length ? dispAM.join(' \\ ') : '________';
      const closeN = dispPM.length ? dispPM.join(' \\ ') : '________';
      const aoa = [
        [dateLabel, '', '', 'Last Mile DSP — DMF5', '', '', '', '', '', `OPEN: ${openN}`, ''],
        ['', '', '', '', '', '', '', '', '', `CLOSING: ${closeN}`, ''],
        [],
        ['#','ROUTE','DELIVERY ASSOCIATE','VAN','DEV','PWR BNK','STG','SIGNATURE','RTS','STN','EXTRAS'],
      ];
      // Build extras cells for EXTRAS column
      const ex = data.extras || {};
      const extrasCells = [];
      // Top rows: EXTRA drivers + blank for manual notes
      const extraDrivers = ex.extraDrivers || [];
      const topCount = Math.max(6, extraDrivers.length);
      for (let j = 0; j < topCount; j++) extrasCells.push(extraDrivers[j] || '');
      const secs = [
        { label: 'CALL OUTS:', min: 5, items: ex.callOuts || [] },
        { label: 'NO CALL NO SHOW:', min: 5, items: ex.ncns || [] },
        { label: 'LATE:', min: 8, items: ex.lates || [] },
        { label: 'TRAINING:', min: 5, items: ex.training || [] },
      ];
      for (const sec of secs) {
        extrasCells.push(sec.label);
        const cnt = Math.max(sec.min, sec.items.length);
        for (let j = 0; j < cnt; j++) extrasCells.push(sec.items[j] || '');
      }

      // Merge driver rows with extras column
      const totalRows = Math.max(rows.length, extrasCells.length);
      for (let i = 0; i < totalRows; i++) {
        const r = rows[i];
        const ec = extrasCells[i] || '';
        if (r) {
          aoa.push([i + 1, r.route, r.name, r.van, r.device, '', r.staging, '', '', r.station, ec || r.att]);
        } else {
          aoa.push(['', '', '', '', '', '', '', '', '', '', ec]);
        }
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{wch:3},{wch:8},{wch:22},{wch:6},{wch:5},{wch:8},{wch:8},{wch:14},{wch:6},{wch:5},{wch:18}];
      ws['!rows'] = aoa.map((_,i) => ({ hpt: i < 3 ? 14 : i === 3 ? 16 : 18 }));
      ws['!freeze'] = { xSplit:0, ySplit:4, topLeftCell:'A5', activePane:'bottomLeft', state:'frozen' };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `SignOut ${planDate}`);
      XLSX.writeFile(wb, `SignOut_${planDate}.xlsx`);
      toast.success(`Exported sign-out sheet — ${rows.length} drivers`);
    } catch (err) {
      toast.error('Export failed: ' + (err?.response?.data?.error || err.message));
    }
  };

  // ── Add Driver to Ops Planner ───────────────────────────────────────────────
  const handleAddDriver = () => {
    if (!addDriverSelection) return;
    const d          = addDriverSelection;
    const staffId    = d.id;
    const shiftType  = addDriverShiftType;   // capture before modal reset
    const routeCode  = addDriverRouteCode;   // capture before modal reset
    const alreadyScheduled  = shiftByStaffId[staffId];
    const sameTypeAlready   = alreadyScheduled?.shift_type === shiftType;

    const closeModal = () => {
      setShowAddDriverModal(false);
      setAddDriverSelection(null);
      setAddDriverShiftType('EDV');
      setAddDriverRouteCode('');
    };

    const doSaveAssignment = () => {
      saveAssignment.mutate({ staffId, data: { route_code: routeCode || null, name_override: d.name } });
      toast.success(`${d.name} added to Ops Planner`);
    };

    if (alreadyScheduled && sameTypeAlready) {
      doSaveAssignment();
      closeModal();
      return;
    }

    closeModal(); // close modal before showing schedule confirm popup
    setScheduleConfirm({
      driverName: d.name,
      shiftType,
      isUpdate:   !!alreadyScheduled,
      onYes: () => {
        if (!alreadyScheduled) {
          createShiftForDriver.mutate(
            { staff_id: staffId, shift_type: shiftType },
            { onSuccess: () => toast.success(`${d.name} added to ${format(parseISO(planDate), 'EEEE MMMM d')} schedule`) }
          );
        } else {
          updateShiftType.mutate({ shiftId: alreadyScheduled.id, shift_type: shiftType, currentShift: alreadyScheduled });
        }
        doSaveAssignment();
        setOpsOnlyStaffIds(prev => { const n = new Set(prev); n.delete(staffId); return n; });
      },
      onNo: () => {
        doSaveAssignment();
        if (!alreadyScheduled) setOpsOnlyStaffIds(prev => new Set([...prev, staffId]));
      },
    });
  };

  const renderTable = () => {
    const ROW_BG = {
      fully_matched:    'hover:bg-slate-50',
      helper_matched:   'hover:bg-slate-50',
      wrongly_rostered: 'bg-red-50 hover:bg-red-100',
      not_in_amazon:    'bg-orange-50 hover:bg-orange-100',
      unassigned_route: 'bg-yellow-50 hover:bg-yellow-100',
      multiple_das:     'bg-red-50 hover:bg-red-100',
    };

    // Sortable column header — shows direction arrow + priority number for stacked sorts
    const SortHeader = ({ col, label, className = '' }) => {
      const idx = sortKeys.findIndex(k => k.col === col);
      const active = idx >= 0;
      const sk = active ? sortKeys[idx] : null;
      return (
        <th
          onClick={() => handleSort(col)}
          className={`px-3 py-2.5 text-left cursor-pointer select-none hover:bg-slate-100 transition-colors group ${className}`}
        >
          <span className="flex items-center gap-0.5 whitespace-nowrap">
            {label}
            {active ? (
              <span className="text-[9px] font-bold opacity-80 ml-0.5">
                {sk.dir === 'asc' ? '↑' : '↓'}{sortKeys.length > 1 ? <sup>{idx + 1}</sup> : ''}
              </span>
            ) : (
              <span className="text-[9px] opacity-20 group-hover:opacity-50 ml-0.5">↕</span>
            )}
          </span>
        </th>
      );
    };

    // Build route→driver map once for all rows
    const assignedRouteMap = {};
    for (const r of section1Rows) {
      const rc = r.asgn?.route_code || r.routeCode;
      if (rc && r.name) assignedRouteMap[rc] = r.name;
    }

    const renderRow = (row, key, rowNum) => {
      const staffId  = row.profile?.staff_id || null;
      const asgn     = row.asgn || (staffId ? (assignments[staffId] || {}) : {});
      const effectiveRoute = asgn.route_code || row.routeCode || '';
      const currentLoadout = loadoutMap[effectiveRoute] || row.loadout || {};
      const rowVehicle = vehicles.find(v => v.id === asgn.vehicle_id);

      const resolvedDA  = row.hasMultipleDAs ? resolvedMultiDAs[row.routeCode] : null;
      const isMultiFlag = row.hasMultipleDAs && !resolvedDA;
      const displayName = resolvedDA?.name || asgn.name_override || row.name;
      const displayTid  = resolvedDA?.transponderId || row.transponderId;
      const isRescued   = displayName && rescueCountByName[displayName] > 0;
      const attSt = staffId ? shiftByStaffId[staffId]?.attendance_status : null;
      const attBorder = attSt === 'ncns' ? 'border-l-4 border-red-500' : attSt === 'called_out' ? 'border-l-4 border-orange-400' : attSt === 'late' ? 'border-l-4 border-yellow-400' : '';
      const rowBg = isRescued
        ? 'bg-orange-50 hover:bg-orange-100'
        : (ROW_BG[row.status] || 'hover:bg-slate-50');

      // EFT & Running Hours
      const waveTime    = currentLoadout.waveTime || null;
      const durationMin = effectiveRoute ? durationByRoute[effectiveRoute] : null;
      const departTime  = waveTime ? addMinutesToTime(waveTime, 30) : null;
      const eftTime     = departTime && durationMin ? addMinutesToTime(departTime, durationMin) : null;
      // runMins removed (RTS/Hrs column hidden)

      // Route difficulty
      const profile     = effectiveRoute ? routeProfileMap[effectiveRoute] : null;
      const diffScore   = profile?.difficulty_score || 0;

      const handleDriverSelect = async (d) => {
        if (row.hasMultipleDAs) {
          setResolvedMultiDAs(prev => ({ ...prev, [row.routeCode]: d }));
        }
        const targetStaffId = d.id;
        if (!targetStaffId) return;

        const alreadyScheduled   = shiftByStaffId[targetStaffId];
        const desiredShiftType   = row.shiftType || 'EDV';
        const sameTypeAlready    = alreadyScheduled?.shift_type === desiredShiftType;

        const doSaveAssignment = () => saveAssignment.mutate({
          staffId: targetStaffId,
          data: { route_code: effectiveRoute || row.routeCode || null, name_override: d.name },
        });

        // Skip popup only when driver is ALREADY scheduled with the exact same shift type
        if (alreadyScheduled && sameTypeAlready) {
          doSaveAssignment();
          return;
        }

        // Show confirmation before touching the schedule
        setScheduleConfirm({
          driverName:  d.name,
          shiftType:   desiredShiftType,
          isUpdate:    !!alreadyScheduled,
          onYes: () => {
            if (!alreadyScheduled) {
              createShiftForDriver.mutate(
                { staff_id: targetStaffId, shift_type: desiredShiftType },
                { onSuccess: () => toast.success(`${d.name} added to ${format(parseISO(planDate), 'EEEE MMMM d')} schedule`) }
              );
            } else {
              updateShiftType.mutate({ shiftId: alreadyScheduled.id, shift_type: desiredShiftType, currentShift: alreadyScheduled });
            }
            doSaveAssignment();
            setOpsOnlyStaffIds(prev => { const n = new Set(prev); n.delete(targetStaffId); return n; });
          },
          onNo: () => {
            doSaveAssignment();
            if (!alreadyScheduled) {
              setOpsOnlyStaffIds(prev => new Set([...prev, targetStaffId]));
            }
          },
        });
      };

      const handleRouteChange = (newCode) => {
        if (!staffId) return;
        saveAssignment.mutate({ staffId, data: { route_code: newCode || null } });
      };

      // Route reassign: another driver already owns this route → show confirmation
      const handleRouteReassign = (routeCode, fromDriverName) => {
        const fromRow = [...section1Rows, ...section3Rows].find(r => {
          const rc = r.asgn?.route_code || r.routeCode;
          return rc === routeCode && r.profile?.staff_id && r.profile.staff_id !== staffId;
        });
        setReassignConfirm({
          routeCode,
          fromDriverName,
          fromStaffId: fromRow?.profile?.staff_id || null,
          toStaffId:   staffId,
          toDriverName: displayName,
        });
      };

      // Shift type change: confirm before touching the schedule
      const handleShiftTypeChange = (newType) => {
        if (!staffId) return;

        // Skip popup only when driver is ALREADY scheduled with the exact same type
        if (row.internalShift && row.internalShift.shift_type === newType) return;

        const doRouteClear = () => {
          if (newType === 'HELPER' && effectiveRoute) {
            saveAssignment.mutate({ staffId, data: { route_code: null } });
          }
        };

        setScheduleConfirm({
          driverName: displayName,
          shiftType:  newType,
          isUpdate:   !!row.internalShift,
          onYes: () => {
            if (row.internalShift) {
              updateShiftType.mutate({ shiftId: row.internalShift.id, shift_type: newType, currentShift: row.internalShift });
            } else {
              createShiftForDriver.mutate({ staff_id: staffId, shift_type: newType });
              setOpsOnlyStaffIds(prev => { const n = new Set(prev); n.delete(staffId); return n; });
            }
            doRouteClear();
          },
          onNo: () => {
            doRouteClear();
            if (!row.internalShift) {
              setOpsOnlyStaffIds(prev => new Set([...prev, staffId]));
            }
          },
        });
      };

      const excludeIds = new Set(assignedDriverStaffIds);
      if (staffId) excludeIds.delete(staffId);

      return (
        <tr key={key} className={`transition-colors text-xs group/row ${rowBg} ${attBorder}`}>
          <td className="px-2 py-2 text-center font-mono text-[10px] text-content-muted select-none">
            {staffId ? (
              <>
                <span className="group-hover/row:hidden">{rowNum}</span>
                <button
                  className="hidden group-hover/row:inline text-slate-300 hover:text-red-500 transition-colors text-sm leading-none"
                  onClick={() => setRemoveConfirm({ staffId, displayName })}
                  title={`Remove ${displayName} from today's Ops Planner`}
                >×</button>
              </>
            ) : rowNum}
          </td>
          <td className="px-3 py-2 min-w-[150px]">
            {isMultiFlag && (
              <div className="text-[9px] font-bold text-red-600 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded mb-1 truncate max-w-[200px]" title={`Multiple DAs: ${row.allTids.join(' | ')}`}>
                {row.allTids.join(' | ')} — select driver ↓
              </div>
            )}
            <DriverSearchDropdown
              currentName={displayName}
              allDrivers={allDrivers}
              excludeStaffIds={excludeIds}
              onSelect={handleDriverSelect}
            />
          </td>
          <td className="px-3 py-2">
            {staffId ? (
              <div className="flex flex-col gap-0.5">
                <InlineShiftType currentType={row.shiftType} onSave={handleShiftTypeChange} />
                {opsOnlyStaffIds.has(staffId) && (
                  <span className="text-[9px] text-slate-400 italic leading-none">Ops Planner Only</span>
                )}
              </div>
            ) : (
              <span className="text-slate-400">{row.shiftType || '—'}</span>
            )}
          </td>
          <td className="px-3 py-2">
            {(() => {
              const dspShiftType = row.internalShift?.shift_type || row.shiftType;
              const isHelper = dspShiftType === 'HELPER';
              return (
                <div className="flex items-center gap-1">
                  {diffScore > 0 && (
                    <span title={`Difficulty: ${diffScore}/5`} className="text-sm leading-none flex-shrink-0">
                      {DIFF_DOT[diffScore] || ''}
                    </span>
                  )}
                  {staffId && !isHelper ? (
                    <InlineRouteCode
                      currentCode={effectiveRoute}
                      allRouteCodes={allRouteCodes}
                      assignedRouteMap={assignedRouteMap}
                      myName={displayName}
                      onSave={handleRouteChange}
                      onRequestReassign={handleRouteReassign}
                    />
                  ) : (
                    <span className="font-mono font-bold text-content">{effectiveRoute || <span className="text-slate-300 font-normal">—</span>}</span>
                  )}
                </div>
              );
            })()}
          </td>
          {/* Loadout — READ ONLY */}
          <td className="px-3 py-2 font-semibold text-content">{currentLoadout.wave || <span className="text-slate-300">—</span>}</td>
          <td className="px-3 py-2 text-content-muted">{currentLoadout.waveTime || <span className="text-slate-300">—</span>}</td>
          <td className="px-3 py-2 font-mono text-content-muted">{currentLoadout.staging || <span className="text-slate-300">—</span>}</td>
          <td className="px-3 py-2">
            {currentLoadout.canopy
              ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${currentLoadout.canopy === 'NORTH' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{currentLoadout.canopy}</span>
              : <span className="text-slate-300">—</span>}
          </td>
          <td className="px-3 py-2 text-[10px] text-content-muted">{shortLaunchpad(currentLoadout.launchpad) || <span className="text-slate-300">—</span>}</td>
          <InlineAssignment
            staffId={staffId}
            assignment={asgn}
            vehicles={vehicles}
            assignedVehicleMap={assignedVehicleMap}
            myName={displayName}
            onSave={data => staffId && saveAssignment.mutate({ staffId, data })}
          />
          <td className="px-2 py-2 text-center w-10"><StatusPill status={row.status} /></td>

          {/* EFT — Expected Finish Time (auto-calculated) */}
          <td className="px-2 py-2 text-center whitespace-nowrap">
            {eftTime ? (
              <span className="text-[10px] font-mono font-semibold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded" title={`Wave ${waveTime} + 30min loading + ${durationMin}min route`}>
                {formatTime12h(eftTime)}
              </span>
            ) : <span className="text-slate-300 text-[10px]">—</span>}
          </td>

          {/* Actual Finish Time — click-to-edit */}
          <td className="px-2 py-2 text-center">
            <InlineTimeCell
              value={asgn.finish_time || ''}
              onSave={val => staffId && patchAssignment.mutate({ staffId, data: { finish_time: val || null } })}
            />
          </td>

          {/* Pick List cell */}
          {pickListData.length > 0 && (() => {
            const pick = pickListMap[effectiveRoute.toUpperCase()] || pickListMap[effectiveRoute];
            return (
              <td className="px-2 py-2 text-[10px] whitespace-nowrap">
                {pick ? (
                  <div className="flex items-center gap-1.5">
                    <div className="leading-tight">
                      <span className="font-semibold text-content">{pick.bags} bags</span>
                      {pick.overflow > 0 && <span className="text-amber-600 ml-1">+{pick.overflow} ovfl</span>}
                      <br />
                      <span className="text-content-muted">{pick.total_packages} pkgs</span>
                      {pick.commercial_packages > 0 && <span className="text-indigo-600 ml-1">{pick.commercial_packages} comm</span>}
                    </div>
                    <button
                      onClick={() => setPickListSummaryModal({ name: displayName, routeCode: effectiveRoute, pick })}
                      className="px-1 py-0.5 rounded hover:bg-indigo-100 transition-colors text-sm flex-shrink-0"
                      title="View pick list summary"
                    >📋</button>
                  </div>
                ) : <span className="text-slate-300">—</span>}
              </td>
            );
          })()}

          {/* Actions dropdown */}
          <td className="px-1 py-2 text-center whitespace-nowrap">
            <div className="relative inline-block">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setRowActionMenu(prev => prev === key ? null : key);
                }}
                className="px-1.5 py-0.5 rounded text-xs hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-700"
              >▼</button>
              {rowActionMenu === key && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1 text-left" onClick={e => e.stopPropagation()}>
                  <p className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase">Attendance</p>
                  {[{s:'late',l:'Late',ic:'🟡'},{s:'called_out',l:'Call Out',ic:'🟠'},{s:'ncns',l:'NCNS',ic:'🔴'}].map(({s,l,ic}) => {
                    const shift = staffId ? shiftByStaffId[staffId] : null;
                    const isActive = shift?.attendance_status === s;
                    return (
                      <button key={s} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 transition-colors"
                        onClick={async () => {
                          setRowActionMenu(null);
                          if (staffId && shift) {
                            const newStatus = isActive ? 'present' : s;
                            await api.post('/attendance', { staff_id: staffId, shift_id: shift.id, attendance_date: planDate, status: newStatus });
                            qc.invalidateQueries({ queryKey: ['shifts-daily', planDate] });
                            toast.success(isActive ? `Unmarked ${displayName}` : `Marked ${displayName} as ${l}`);
                          }
                        }}>
                        <span>{ic}</span><span>{l}</span>{isActive && <span className="ml-auto text-green-600">✓</span>}
                      </button>
                    );
                  })}
                  <div className="border-t border-slate-100 my-1" />
                  <button className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-orange-50 transition-colors"
                    onClick={() => { setRowActionMenu(null); setRescueModal({ staffId, displayName, effectiveRoute }); setRescueForm({ rescuerId: null, rescuerName: '', rescueTime: '', packages: '', reason: '', notes: '' }); }}>
                    <span>🚨</span><span>Log Rescue</span>
                    {rescueCountByName[displayName] > 0 && <span className="ml-auto text-[9px] font-bold text-orange-600">×{rescueCountByName[displayName]}</span>}
                  </button>
                  <div className="border-t border-slate-100 my-1" />
                  <button className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 transition-colors"
                    onClick={() => { setRowActionMenu(null); if (staffId) setRemoveConfirm({ staffId, displayName }); }}>
                    <span>🗑️</span><span>Remove Driver</span>
                  </button>
                </div>
              )}
            </div>
          </td>
        </tr>
      );
    };

    const rows = sortedRows.filter(r => r.shiftType !== 'DISPATCH AM' && r.shiftType !== 'DISPATCH PM');

    return (
      <div className="space-y-2">
        {/* ── Status legend (collapsible) ── */}
        <div className="bg-white border border-card-border rounded-xl overflow-hidden">
          <button
            onClick={() => setShowLegend(v => !v)}
            className="w-full flex items-center justify-center gap-3 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-content-muted hover:bg-slate-50 transition-colors"
          >
            <span className="flex items-center gap-3">
              <span>✅ Matched</span>
              <span>❗ Not in DSP</span>
              <span>⚠️ Not in Amazon</span>
              <span>🚩 Multiple DAs</span>
              <span>🟡 Unassigned</span>
            </span>
            <span className="ml-2 opacity-50">{showLegend ? '▲' : '▼'}</span>
          </button>
          {showLegend && (
            <div className="border-t border-slate-100 px-4 py-3 flex flex-wrap gap-4 justify-center">
              {[
                ['✅', 'Matched', 'Driver is in both DSP schedule and Amazon roster'],
                ['❗', 'Not in DSP', 'In Amazon roster but has no DSP internal shift'],
                ['⚠️', 'Not in Amazon', 'Has a DSP shift but not found in Amazon roster'],
                ['🚩', 'Multiple DAs', 'Route has multiple Amazon drivers — needs manual selection'],
                ['🟡', 'Unassigned', 'Route has no driver assigned yet'],
              ].map(([icon, label, desc]) => (
                <div key={label} className="flex items-start gap-2 max-w-[180px]">
                  <span className="text-lg leading-none flex-shrink-0">{icon}</span>
                  <div>
                    <p className="text-xs font-semibold text-content">{label}</p>
                    <p className="text-[10px] text-content-muted leading-tight">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Filter bar ── */}
        <div className="bg-white border border-card-border rounded-xl px-3 py-2 flex flex-wrap gap-2 items-center">
          <span className="text-[10px] font-bold uppercase tracking-wide text-content-muted flex-shrink-0">Filter:</span>

          <input
            type="text" value={filters.driver} placeholder="Driver name…"
            onChange={e => setFilter('driver', e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary w-32"
          />
          <select value={filters.shiftType} onChange={e => setFilter('shiftType', e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary">
            <option value="">All Types</option>
            {SHIFT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="text" value={filters.routeCode} placeholder="Route code…"
            onChange={e => setFilter('routeCode', e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary w-24"
          />
          <select value={filters.wave} onChange={e => setFilter('wave', e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary">
            <option value="">All Waves</option>
            {filterOptions.waves.map(w => <option key={w} value={w}>Wave {w}</option>)}
          </select>
          <select value={filters.waveTime} onChange={e => setFilter('waveTime', e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary">
            <option value="">All Times</option>
            {filterOptions.waveTimes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="text" value={filters.staging} placeholder="Staging…"
            onChange={e => setFilter('staging', e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary w-24"
          />
          <select value={filters.canopy} onChange={e => setFilter('canopy', e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary">
            <option value="">All Canopies</option>
            {filterOptions.canopies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            type="text" value={filters.launchpad} placeholder="Launchpad…"
            onChange={e => setFilter('launchpad', e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary w-24"
          />
          <select value={filters.status} onChange={e => setFilter('status', e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary">
            <option value="">All Statuses</option>
            <option value="fully_matched">✅ Matched</option>
            <option value="helper_matched">✅ Helper OK</option>
            <option value="wrongly_rostered">❗ Not in DSP</option>
            <option value="not_in_amazon">⚠️ Not in Amazon</option>
            <option value="unassigned_route">🟡 Unassigned Route</option>
            <option value="multiple_das">🚩 Multiple DAs</option>
          </select>

          {hasActiveFilters && (
            <button onClick={clearFilters}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-content-muted hover:text-red-600 hover:border-red-300 transition-all ml-auto">
              <X size={11} /> Clear Filters
            </button>
          )}

          {(hasActiveFilters || sortKeys.length > 0) && (
            <span className="text-[10px] text-content-muted">
              {rows.length} / {allRows.length} rows
              {sortKeys.length > 0 && (
                <span className="ml-1 text-primary">
                  · sorted by {sortKeys.map((k, i) => `${k.col} ${k.dir === 'asc' ? '↑' : '↓'}${sortKeys.length > 1 ? ` (${i+1})` : ''}`).join(', ')}
                </span>
              )}
            </span>
          )}
        </div>

        {/* ── Flat table ── */}
        <div className="overflow-x-auto rounded-xl border border-card-border bg-white">
          <table className="w-full text-xs">
            <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-semibold text-content-muted uppercase tracking-wide">
              <tr>
                <th className="px-2 py-2.5 text-center w-8 cursor-pointer hover:bg-slate-100 select-none group" onClick={() => handleSort('num')} title="Row #">
                  <span className="flex items-center justify-center gap-0.5">#
                    {(() => { const idx = sortKeys.findIndex(k => k.col === 'num'); return idx >= 0
                      ? <span className="text-[9px] font-bold opacity-80">{sortKeys[idx].dir === 'asc' ? '↑' : '↓'}{sortKeys.length > 1 ? <sup>{idx+1}</sup> : ''}</span>
                      : <span className="text-[9px] opacity-20 group-hover:opacity-50">↕</span>; })()}
                  </span>
                </th>
                <SortHeader col="name"      label="Driver Name" />
                <SortHeader col="shiftType" label="Shift" />
                <SortHeader col="routeCode" label="Route" />
                <SortHeader col="wave"      label="Wave ⓘ"      className="text-slate-400" />
                <SortHeader col="waveTime"  label="Wave Time ⓘ" className="text-slate-400" />
                <SortHeader col="staging"   label="Staging ⓘ"   className="text-slate-400" />
                <SortHeader col="canopy"    label="Canopy ⓘ"    className="text-slate-400" />
                <SortHeader col="launchpad" label="Pad ⓘ" className="text-slate-400" />
                <SortHeader col="vehicle" label="Vehicle" />
                <SortHeader col="device"  label="Device" className="w-[65px]" />
                <SortHeader col="status" label="St" className="text-center w-10" />
                {/* EFT — sortable, violet */}
                {(() => {
                  const col = 'eft';
                  const idx = sortKeys.findIndex(k => k.col === col);
                  const active = idx >= 0;
                  const sk = active ? sortKeys[idx] : null;
                  return (
                    <th
                      onClick={() => handleSort(col)}
                      className="px-2 py-2.5 text-center cursor-pointer select-none hover:bg-slate-100 transition-colors group whitespace-nowrap text-violet-600"
                    >
                      <span className="flex items-center justify-center gap-0.5">
                        EFT
                        {active ? (
                          <span className="text-[9px] font-bold opacity-80 ml-0.5">
                            {sk.dir === 'asc' ? '↑' : '↓'}{sortKeys.length > 1 ? <sup>{idx + 1}</sup> : ''}
                          </span>
                        ) : (
                          <span className="text-[9px] opacity-20 group-hover:opacity-50 ml-0.5">↕</span>
                        )}
                      </span>
                    </th>
                  );
                })()}
                <SortHeader col="rts" label="RTS" className="text-center" />
                {pickListData.length > 0 && <SortHeader col="pickList" label="Pick List" />}
                <th className="px-2 py-2.5 text-center w-10">▼</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.length > 0
                ? rows.map((row, i) => renderRow(row, row.profile?.staff_id ? `staff-${row.profile.staff_id}` : `${row.section}-${row.routeCode || i}`, i + 1))
                : <tr><td colSpan={pickListData.length > 0 ? 16 : 15} className="px-3 py-8 text-center text-content-muted">
                    {hasActiveFilters ? 'No rows match the current filters.' : 'Upload files to see data.'}
                  </td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className={embedded ? 'space-y-4' : 'p-6 space-y-4'}>

      {/* ── Standalone tab bar (only when not embedded in Schedule) ─────── */}
      {!embedded && (
        <div className="flex items-center gap-3 mb-2">
          <div className="flex bg-white border border-card-border rounded-lg p-0.5 shadow-sm">
            <button
              onClick={() => navigate('/schedule')}
              className="px-3 py-1.5 rounded-md text-sm font-medium text-content-muted hover:text-content transition-all"
            >
              Weekly
            </button>
            <button
              onClick={() => navigate('/schedule?tab=daily')}
              className="px-3 py-1.5 rounded-md text-sm font-medium text-content-muted hover:text-content transition-all"
            >
              Daily
            </button>
            <button className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-white shadow-sm transition-all">
              Ops Planner
            </button>
          </div>
        </div>
      )}

      {/* ── Date Navigation ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onDateChange(format(subDays(parseISO(planDate), 1), 'yyyy-MM-dd'))}
          className="p-1.5 rounded-lg border border-card-border bg-white hover:bg-slate-50 hover:border-primary text-content-muted hover:text-primary transition-all"
          title="Previous day"
        >
          <ChevronLeft size={16} />
        </button>

        <div className="relative" ref={datePickerRef}>
          <button
            onClick={() => setShowDatePicker(p => !p)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-card-border bg-white hover:border-primary text-content font-semibold text-sm transition-all shadow-sm"
          >
            <Calendar size={14} className="text-primary opacity-70" />
            {format(parseISO(planDate), 'EEEE, MMMM d, yyyy')}
          </button>
          {showDatePicker && (
            <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-card-border rounded-xl shadow-lg p-3">
              <input
                type="date"
                value={planDate}
                onChange={e => {
                  if (e.target.value) { onDateChange(e.target.value); setShowDatePicker(false); }
                }}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-primary"
              />
            </div>
          )}
        </div>

        <button
          onClick={() => onDateChange(format(addDays(parseISO(planDate), 1), 'yyyy-MM-dd'))}
          className="p-1.5 rounded-lg border border-card-border bg-white hover:bg-slate-50 hover:border-primary text-content-muted hover:text-primary transition-all"
          title="Next day"
        >
          <ChevronRight size={16} />
        </button>

        {planDate !== format(new Date(), 'yyyy-MM-dd') && (
          <button
            onClick={() => onDateChange(format(new Date(), 'yyyy-MM-dd'))}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-card-border bg-white hover:border-primary text-content-muted hover:text-primary transition-all"
          >
            Today
          </button>
        )}

        {/* ── Action buttons ─────────────────────────────────────────────── */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowAddDriverModal(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-blue-700 font-semibold transition-all shadow-sm"
          >
            <UserPlus size={14} /> + Add Driver
          </button>
          <button
            onClick={() => setShowClearConfirm(true)}
            disabled={!hasAnyData}
            title="Clear all assignments and uploaded file data for this date"
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-red-200 bg-white hover:border-red-400 hover:bg-red-50 text-red-500 hover:text-red-700 font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            🗑 Clear Day
          </button>
          <button
            onClick={handlePrintSignOut}
            disabled={sortedRows.length === 0}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-card-border bg-white hover:border-primary text-content-muted hover:text-primary font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            🖨️ Print
          </button>
          <button
            onClick={handleExport}
            disabled={sortedRows.length === 0}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-card-border bg-white hover:border-primary text-content-muted hover:text-primary font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* ── Upload buttons row ────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-start">
        <div className="card flex-1 min-w-[200px] p-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-content-muted">1 · Weekly Schedule</p>
          {rosterData?.file_name && (
            <p className="text-[11px] text-content-muted truncate">
              <FileSpreadsheet size={10} className="inline mr-1 opacity-60" />{rosterData.file_name}
              {rosterData.updated_at && <span className="ml-1 opacity-50">{format(new Date(rosterData.updated_at), 'MMM d, h:mma')}</span>}
            </p>
          )}
          <UploadButton label="Upload Week Schedule" accept=".xlsx,.xls,.csv" loading={!!uploading.step1} fileName={null} onFile={f => handleUpload('step1', f)} />
        </div>
        <div className="card flex-1 min-w-[200px] p-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-content-muted">2 · Routes File</p>
          {routesData?.file_name && (
            <p className="text-[11px] text-content-muted truncate">
              <FileSpreadsheet size={10} className="inline mr-1 opacity-60" />{routesData.file_name}
              {routesData.updated_at && <span className="ml-1 opacity-50">{format(new Date(routesData.updated_at), 'MMM d, h:mma')}</span>}
            </p>
          )}
          <UploadButton label="Upload Routes" accept=".xlsx,.xls,.csv" loading={!!uploading.step2} fileName={null} onFile={f => handleUpload('step2', f)} />
        </div>
        <div className="card flex-1 min-w-[200px] p-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-content-muted">3 · DMF5 Loadout</p>
          {loadoutData?.file_name && (
            <p className="text-[11px] text-content-muted truncate">
              <FileSpreadsheet size={10} className="inline mr-1 opacity-60" />{loadoutData.file_name}
              {loadoutData.updated_at && <span className="ml-1 opacity-50">{format(new Date(loadoutData.updated_at), 'MMM d, h:mma')}</span>}
            </p>
          )}
          <UploadButton label="Upload Loadout" accept=".xlsx,.xls" loading={!!uploading.step3} fileName={null} onFile={f => handleUpload('step3', f)} />
        </div>
        <div className="card flex-1 min-w-[200px] p-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-content-muted">4 · Pick List</p>
          {pickListData.length > 0 && (
            <p className="text-[11px] text-content-muted truncate">
              <ClipboardList size={10} className="inline mr-1 opacity-60" />{pickListData.length} routes loaded
            </p>
          )}
          <div className="flex items-center gap-1.5">
            <UploadButton label="Upload Pick List" accept=".pdf" loading={!!uploading.picklist} fileName={null} onFile={handlePickListUpload} />
            <button
              onClick={async () => {
                try {
                  const { data } = await api.get('/ops/picklist-debug', { params: { date: planDate } });
                  setPickListDebug(data);
                } catch (err) {
                  toast.error('Debug failed: ' + (err?.response?.data?.error || err.message));
                }
              }}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs hover:bg-slate-50 transition-colors"
              title="Debug pick list matching"
            >🔍</button>
          </div>
        </div>
      </div>

      {/* ── Dispatcher header bar ─────────────────────────────────────────── */}
      {hasAnyData && (() => {
        const dispAM = internalShifts.filter(s => s.shift_type === 'DISPATCH AM').map(s => `${s.first_name} ${s.last_name}`);
        const dispPM = internalShifts.filter(s => s.shift_type === 'DISPATCH PM').map(s => `${s.first_name} ${s.last_name}`);
        return (
          <div className="bg-[#1a3a5c] text-white rounded-xl px-5 py-2.5 flex items-center justify-between text-sm">
            <span><span className="font-bold">OPEN:</span> {dispAM.length ? dispAM.join(' / ') : '—'}</span>
            <span><span className="font-bold">CLOSE:</span> {dispPM.length ? dispPM.join(' / ') : '—'}</span>
          </div>
        );
      })()}

      {/* ── Summary bar ──────────────────────────────────────────────────── */}
      {hasAnyData && (
        <SummaryBar>
          <span className="font-semibold text-content">Blocks: {summaryCounts.totalBlocks}</span>
          {/* Routes X/Y — green when all assigned, red when some are missing */}
          <span className={`font-semibold ${summaryCounts.assignedRoutes === summaryCounts.routes ? 'text-emerald-600' : 'text-red-600'}`}>
            Routes: {summaryCounts.assignedRoutes}/{summaryCounts.routes}
          </span>
          <span className="text-amber-600">Helpers: {summaryCounts.helpers}</span>
          {summaryCounts.wronglyRostered > 0 && (
            <button
              onClick={() => setFilter('status', filters.status === 'wrongly_rostered' ? '' : 'wrongly_rostered')}
              className={`font-semibold px-2 py-0.5 rounded transition-colors ${filters.status === 'wrongly_rostered' ? 'bg-red-600 text-white' : 'text-red-600 bg-red-50 hover:bg-red-100'}`}
            >
              ❗ Not in DSP: {summaryCounts.wronglyRostered}
            </button>
          )}
          {summaryCounts.notInAmazon > 0 && (
            <button
              onClick={() => setFilter('status', filters.status === 'not_in_amazon' ? '' : 'not_in_amazon')}
              className={`font-semibold px-2 py-0.5 rounded transition-colors ${filters.status === 'not_in_amazon' ? 'bg-orange-500 text-white' : 'text-orange-600 bg-orange-50 hover:bg-orange-100'}`}
            >
              ⚠️ Not in Amazon: {summaryCounts.notInAmazon}
            </button>
          )}
          {summaryCounts.unassignedRoutes > 0 && (
            <button
              onClick={() => setShowUnassignedPopup(true)}
              className="font-semibold px-2 py-0.5 rounded transition-colors text-yellow-700 bg-yellow-50 hover:bg-yellow-100"
            >
              🟡 Unassigned Routes: {summaryCounts.unassignedRoutes}
            </button>
          )}
          {summaryCounts.multipleDAs > 0 && (
            <button
              onClick={() => setFilter('status', filters.status === 'multiple_das' ? '' : 'multiple_das')}
              className={`font-semibold px-2 py-0.5 rounded transition-colors ${filters.status === 'multiple_das' ? 'bg-blue-600 text-white' : 'text-blue-600 bg-blue-50 hover:bg-blue-100'}`}
            >
              🚩 Multiple DAs: {summaryCounts.multipleDAs}
            </button>
          )}
          {pickListData.length > 0 && (
            <button
              onClick={() => setPickListSummaryModal('all')}
              className="font-semibold px-2 py-0.5 rounded transition-colors text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
            >
              📋 Send All Summaries
            </button>
          )}
          {hasAnyData && (
            <button
              onClick={() => setWhatsappConfirm(true)}
              disabled={whatsappSending}
              className="font-semibold px-2 py-0.5 rounded transition-colors text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50 flex items-center gap-1"
            >
              <MessageCircle size={12} /> WhatsApp Briefing
            </button>
          )}
          {picklistLockStatus && !picklistLockStatus.locked ? null : (
            <button
              onClick={async () => {
                try {
                  await api.post('/ops/release-briefing');
                  toast.success('Briefing released — drivers can now see their assignment');
                  qc.invalidateQueries({ queryKey: ['picklist-lock-status'] });
                } catch { toast.error('Failed to release briefing'); }
              }}
              className="font-semibold px-2 py-0.5 rounded transition-colors text-green-700 bg-green-50 hover:bg-green-100"
            >
              📢 Release Briefing
            </button>
          )}
          <button
            onClick={async () => {
              try {
                const { data } = await api.post('/ops/cleanup-ops', { date: planDate });
                console.log('[cleanup debug]', data.debug);
                if (data.removed > 0) {
                  toast.success(`Removed ${data.removed} non-working driver${data.removed !== 1 ? 's' : ''}: ${data.names.join(', ')}`);
                  qc.invalidateQueries({ queryKey: ['ops-assignments', planDate] });
                } else {
                  // Show shift type breakdown so admin can see what's happening
                  const types = data.debug ? Object.entries(data.debug).map(([t, n]) => `${t}: ${n.length}`).join(', ') : '';
                  toast(`No non-working drivers to remove. Shift types: ${types || 'none'}`, { icon: '✅', duration: 5000 });
                }
              } catch (err) {
                toast.error('Cleanup failed: ' + (err?.response?.data?.error || err.message));
              }
            }}
            className="font-semibold px-2 py-0.5 rounded transition-colors text-slate-600 bg-slate-100 hover:bg-slate-200"
          >
            🧹 Clean Up
          </button>
          {summaryCounts.flags > 0
            ? <span className="ml-auto text-red-500 font-semibold">{summaryCounts.flags} flag{summaryCounts.flags !== 1 ? 's' : ''}</span>
            : hasAnyData && <span className="ml-auto text-emerald-600 font-semibold">✅ All matched</span>}
        </SummaryBar>
      )}


      {/* ── Unassigned Routes Popup ──────────────────────────────────────── */}
      {showUnassignedPopup && (() => {
        const unassignedRows = section1Rows.filter(r => r.status === 'unassigned_route');
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div>
                  <h2 className="font-bold text-content text-base">Unassigned Routes</h2>
                  <p className="text-xs text-content-muted mt-0.5">
                    {unassignedRows.length} route{unassignedRows.length !== 1 ? 's' : ''} need a driver — assign directly from here
                  </p>
                </div>
                <button onClick={() => setShowUnassignedPopup(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={16} /></button>
              </div>
              <div className="overflow-y-auto flex-1">
                {unassignedRows.length === 0 ? (
                  <p className="text-center text-emerald-600 font-semibold py-12">✅ All routes are assigned!</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-semibold text-content-muted uppercase tracking-wide">
                        <th className="px-3 py-2.5 text-left">Route</th>
                        <th className="px-3 py-2.5 text-left">Wave</th>
                        <th className="px-3 py-2.5 text-left">Wave Time</th>
                        <th className="px-3 py-2.5 text-left">Staging</th>
                        <th className="px-3 py-2.5 text-left">Canopy</th>
                        <th className="px-3 py-2.5 text-left">Pad</th>
                        <th className="px-3 py-2.5 text-left min-w-[200px]">Assign Driver</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {unassignedRows.map((r, i) => {
                        const lo = loadoutMap[r.routeCode] || {};
                        return (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono font-bold text-content">{r.routeCode}</td>
                            <td className="px-3 py-2 font-semibold">{lo.wave || <span className="text-slate-300">—</span>}</td>
                            <td className="px-3 py-2 text-content-muted">{lo.waveTime || <span className="text-slate-300">—</span>}</td>
                            <td className="px-3 py-2 font-mono text-[10px] text-content-muted">{lo.staging || <span className="text-slate-300">—</span>}</td>
                            <td className="px-3 py-2">
                              {lo.canopy
                                ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${lo.canopy === 'NORTH' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{lo.canopy}</span>
                                : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-3 py-2 text-[10px] text-content-muted">{shortLaunchpad(lo.launchpad) || <span className="text-slate-300">—</span>}</td>
                            <td className="px-3 py-2">
                              <DriverSearchDropdown
                                currentName=""
                                allDrivers={allDrivers}
                                excludeStaffIds={assignedDriverStaffIds}
                                placeholder="Search driver…"
                                inModal={true}
                                onSelect={d => {
                                  const alreadyScheduled = shiftByStaffId[d.id];
                                  const desiredType = r.shiftType || 'EDV';
                                  const sameTypeAlready = alreadyScheduled?.shift_type === desiredType;
                                  const doAssign = () => saveAssignment.mutate({
                                    staffId: d.id,
                                    data: { route_code: r.routeCode, name_override: d.name },
                                  });
                                  if (alreadyScheduled && sameTypeAlready) { doAssign(); return; }
                                  setScheduleConfirm({
                                    driverName: d.name,
                                    shiftType:  desiredType,
                                    isUpdate:   !!alreadyScheduled,
                                    onYes: () => {
                                      if (!alreadyScheduled) {
                                        createShiftForDriver.mutate(
                                          { staff_id: d.id, shift_type: desiredType },
                                          { onSuccess: () => toast.success(`${d.name} added to schedule`) }
                                        );
                                      } else {
                                        updateShiftType.mutate({ shiftId: alreadyScheduled.id, shift_type: desiredType, currentShift: alreadyScheduled });
                                      }
                                      doAssign();
                                      setOpsOnlyStaffIds(prev => { const n = new Set(prev); n.delete(d.id); return n; });
                                    },
                                    onNo: () => {
                                      doAssign();
                                      if (!alreadyScheduled) setOpsOnlyStaffIds(prev => new Set([...prev, d.id]));
                                    },
                                  });
                                }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
                <button onClick={() => setShowUnassignedPopup(false)}
                  className="px-4 py-2 text-sm border border-slate-200 rounded-xl text-content-muted hover:bg-slate-50 transition-colors">
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Add Driver Modal ─────────────────────────────────────────────── */}
      {showAddDriverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-content text-base">Add Driver to Ops Planner</h2>
                <p className="text-xs text-content-muted mt-0.5">{format(parseISO(planDate), 'EEEE, MMMM d, yyyy')}</p>
              </div>
              <button
                onClick={() => { setShowAddDriverModal(false); setAddDriverSelection(null); setAddDriverShiftType('EDV'); setAddDriverRouteCode(''); }}
                className="p-1.5 rounded-lg text-content-muted hover:text-content hover:bg-slate-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* Driver search */}
              <div>
                <label className="text-xs font-semibold text-content-muted block mb-1.5 uppercase tracking-wide">Driver *</label>
                <DriverSearchDropdown
                  currentName={addDriverSelection?.name || ''}
                  allDrivers={allDrivers}
                  excludeStaffIds={new Set()}
                  placeholder="Search driver by name…"
                  inModal={true}
                  onSelect={d => setAddDriverSelection(d)}
                />
                {addDriverSelection && (
                  <p className="text-[10px] text-content-muted mt-1 font-mono">{addDriverSelection.transponderId}</p>
                )}
              </div>

              {/* Shift type */}
              <div>
                <label className="text-xs font-semibold text-content-muted block mb-1.5 uppercase tracking-wide">Shift Type</label>
                <select
                  value={addDriverShiftType}
                  onChange={e => setAddDriverShiftType(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary bg-white"
                >
                  {SHIFT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* Route code (optional) */}
              <div>
                <label className="text-xs font-semibold text-content-muted block mb-1.5 uppercase tracking-wide">Route Code <span className="font-normal normal-case">(optional)</span></label>
                <select
                  value={addDriverRouteCode}
                  onChange={e => setAddDriverRouteCode(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary bg-white"
                >
                  <option value="">None — no route assigned</option>
                  {allRouteCodes.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex gap-3 justify-end">
              <button
                onClick={() => { setShowAddDriverModal(false); setAddDriverSelection(null); setAddDriverShiftType('EDV'); setAddDriverRouteCode(''); }}
                className="px-4 py-2 text-sm border border-slate-200 rounded-xl text-content-muted hover:bg-slate-50 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddDriver}
                disabled={!addDriverSelection}
                className="px-4 py-2.5 text-sm bg-primary text-white rounded-xl hover:bg-blue-700 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add to Ops Planner
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reassign Route Confirmation Modal ───────────────────────────── */}
      {reassignConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="font-bold text-content text-base">Reassign Route</h2>
            <p className="text-sm text-content-muted leading-relaxed">
              Route <span className="font-mono font-bold text-content">{reassignConfirm.routeCode}</span> is currently
              assigned to <span className="font-semibold text-content">{reassignConfirm.fromDriverName}</span>.
              <br />
              Do you want to reassign it to <span className="font-semibold text-primary">{reassignConfirm.toDriverName}</span>?
            </p>
            <p className="text-xs text-content-muted bg-slate-50 rounded-lg px-3 py-2">
              All loadout data (Wave, Wave Time, Staging, Canopy, Launchpad) will transfer automatically.
              <br />
              <span className="font-semibold text-content">{reassignConfirm.fromDriverName}</span> will become unassigned.
            </p>
            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={() => setReassignConfirm(null)}
                className="px-4 py-2 text-sm border border-slate-200 rounded-xl text-content-muted hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const { routeCode, fromStaffId, toStaffId } = reassignConfirm;
                  setReassignConfirm(null);
                  // Clear route from old driver
                  if (fromStaffId) {
                    try {
                      await api.patch(`/ops-planner/assignments/${fromStaffId}`, { plan_date: planDate, route_code: null });
                    } catch (_) { /* no existing assignment — that's fine */ }
                    qc.invalidateQueries({ queryKey: ['ops-assignments', planDate] });
                  }
                  // Assign to new driver
                  saveAssignment.mutate({ staffId: toStaffId, data: { route_code: routeCode } });
                  toast.success(`Route ${routeCode} reassigned to ${reassignConfirm.toDriverName}`);
                }}
                className="px-4 py-2 text-sm bg-primary text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold"
              >
                Reassign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Schedule Confirmation Modal ───────────────────────────────────── */}
      {scheduleConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-5">
              <h2 className="font-bold text-content text-base mb-1">
                {scheduleConfirm.isUpdate ? 'Update Schedule?' : 'Add to Schedule?'}
              </h2>
              <p className="text-sm text-content-muted mb-4 leading-relaxed">
                <span className="font-semibold text-content">{scheduleConfirm.driverName}</span>{' '}
                {scheduleConfirm.isUpdate
                  ? 'has a different shift type currently scheduled for'
                  : 'is not currently scheduled for'}{' '}
                <span className="font-semibold text-content">{format(parseISO(planDate), 'EEEE, MMMM d')}</span>.
                {' '}Would you like to {scheduleConfirm.isUpdate ? 'update their shift type in' : 'add them to'} the DSP Fleet Planner schedule?
              </p>
              <div className="bg-slate-50 rounded-xl px-4 py-2.5 mb-5 text-sm">
                <span className="text-content-muted">Shift Type: </span>
                <span className="font-bold text-content">{scheduleConfirm.shiftType}</span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { scheduleConfirm.onYes(); setScheduleConfirm(null); }}
                  className="flex-1 px-4 py-2.5 text-sm bg-primary text-white rounded-xl hover:bg-blue-700 font-semibold transition-colors"
                >
                  ✅ Yes, Add to Schedule
                </button>
                <button
                  onClick={() => { scheduleConfirm.onNo(); setScheduleConfirm(null); }}
                  className="flex-1 px-4 py-2.5 text-sm border border-slate-200 text-content-muted rounded-xl hover:bg-slate-50 font-medium transition-colors"
                >
                  No, Ops Planner Only
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Rescue Modal ─────────────────────────────────────────────────── */}
      {rescueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-3">
            <h2 className="font-bold text-content text-base flex items-center gap-2">🚨 Log Rescue</h2>

            {/* Rescued driver info */}
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-xl">
              <p className="font-semibold text-orange-800 text-sm">{rescueModal.displayName}</p>
              <p className="text-orange-600 text-xs mt-0.5">Route: <span className="font-bold font-mono">{rescueModal.effectiveRoute || '—'}</span></p>
            </div>

            {/* Rescuer picker */}
            <div>
              <label className="block text-xs font-semibold text-content-muted mb-1">Rescuer *</label>
              <DriverSearchDropdown
                currentName={rescueForm.rescuerName}
                allDrivers={allDrivers}
                onSelect={d => setRescueForm(f => ({ ...f, rescuerId: d.id, rescuerName: d.name }))}
                placeholder="Search rescuer…"
                inModal={true}
              />
            </div>

            {/* Time + Packages row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-content-muted mb-1">Rescue Time</label>
                <input
                  type="time"
                  value={rescueForm.rescueTime}
                  onChange={e => setRescueForm(f => ({ ...f, rescueTime: e.target.value }))}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-content-muted mb-1">Packages Rescued</label>
                <input
                  type="number" min="0"
                  value={rescueForm.packages}
                  onChange={e => setRescueForm(f => ({ ...f, packages: e.target.value }))}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-primary"
                  placeholder="0"
                />
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="block text-xs font-semibold text-content-muted mb-1">Reason</label>
              <select
                value={rescueForm.reason}
                onChange={e => setRescueForm(f => ({ ...f, reason: e.target.value }))}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-primary bg-white"
              >
                <option value="">— Select reason —</option>
                {RESCUE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold text-content-muted mb-1">Notes</label>
              <textarea
                value={rescueForm.notes} rows={2}
                onChange={e => setRescueForm(f => ({ ...f, notes: e.target.value }))}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-primary resize-none"
                placeholder="Optional notes…"
              />
            </div>

            {/* Rescue list for today */}
            {rescues.filter(r => r.rescued_name === rescueModal.displayName).length > 0 && (
              <div className="border border-orange-100 rounded-xl p-2 bg-orange-50/50 space-y-1">
                <p className="text-[10px] font-bold text-orange-700 uppercase tracking-wide">Prior rescues today</p>
                {rescues.filter(r => r.rescued_name === rescueModal.displayName).map(r => (
                  <div key={r.id} className="flex items-center justify-between text-xs">
                    <span className="text-content-muted">
                      By <strong>{r.rescuer_name}</strong>{r.rescue_time ? ` at ${r.rescue_time}` : ''}{r.packages_rescued ? ` · ${r.packages_rescued} pkgs` : ''}
                    </span>
                    <button
                      onClick={() => deleteRescue.mutate(r.id)}
                      className="text-red-400 hover:text-red-600 text-[10px] px-1"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setRescueModal(null)}
                className="flex-1 px-4 py-2.5 text-sm border border-slate-200 text-content-muted rounded-xl hover:bg-slate-50 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => logRescue.mutate({
                  plan_date:         planDate,
                  rescued_staff_id:  rescueModal.staffId,
                  rescued_name:      rescueModal.displayName,
                  rescued_route:     rescueModal.effectiveRoute,
                  rescuer_staff_id:  rescueForm.rescuerId,
                  rescuer_name:      rescueForm.rescuerName,
                  rescue_time:       rescueForm.rescueTime,
                  packages_rescued:  parseInt(rescueForm.packages) || 0,
                  reason:            rescueForm.reason || null,
                  notes:             rescueForm.notes,
                })}
                disabled={!rescueForm.rescuerName || logRescue.isPending}
                className="flex-1 px-4 py-2.5 text-sm bg-orange-500 text-white rounded-xl hover:bg-orange-600 font-semibold transition-colors disabled:opacity-50"
              >
                {logRescue.isPending ? 'Logging…' : 'Log Rescue 🚨'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove Driver Confirmation Modal ─────────────────────────── */}
      {removeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-bold text-content text-base">Remove from Ops Planner?</h2>
            <p className="text-sm text-content-muted leading-relaxed">
              Remove <span className="font-semibold text-content">{removeConfirm.displayName}</span> from today's Ops Planner?
              <br />
              <span className="text-xs mt-1 block text-content-muted">They will remain in the DSP schedule. This only removes them from today's operations view.</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setRemoveConfirm(null)}
                className="flex-1 px-4 py-2.5 text-sm border border-slate-200 text-content-muted rounded-xl hover:bg-slate-50 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => removeDriver.mutate({ staffId: removeConfirm.staffId, displayName: removeConfirm.displayName })}
                disabled={removeDriver.isPending}
                className="flex-1 px-4 py-2.5 text-sm bg-slate-700 text-white rounded-xl hover:bg-slate-800 font-semibold transition-colors disabled:opacity-50"
              >
                {removeDriver.isPending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Clear Day Confirmation Modal ──────────────────────────────── */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🗑</span>
              <div>
                <h2 className="font-bold text-content text-base">Clear Day Data?</h2>
                <p className="text-xs text-content-muted mt-0.5">{format(parseISO(planDate), 'EEEE, MMMM d, yyyy')}</p>
              </div>
            </div>
            <p className="text-sm text-content-muted leading-relaxed">
              This will permanently delete all <span className="font-semibold text-content">driver assignments</span> and
              clear the <span className="font-semibold text-content">Routes</span> and{' '}
              <span className="font-semibold text-content">Loadout</span> file data for this date.
            </p>
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              ⚠️ This action cannot be undone. The weekly schedule file will not be affected.
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 px-4 py-2.5 text-sm border border-slate-200 text-content-muted rounded-xl hover:bg-slate-50 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => clearDayData.mutate()}
                disabled={clearDayData.isPending}
                className="flex-1 px-4 py-2.5 text-sm bg-red-600 text-white rounded-xl hover:bg-red-700 font-semibold transition-colors disabled:opacity-50"
              >
                {clearDayData.isPending ? 'Clearing…' : '🗑 Yes, Clear Day'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main table ───────────────────────────────────────────────────── */}
      {hasAnyData ? (
        renderTable()
      ) : shiftsLoading && planDate ? (
        <div className="overflow-x-auto rounded-xl border border-card-border bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-semibold text-content-muted uppercase tracking-wide">
                {['#','Driver Name','Shift Type','Route Code','Wave','Wave Time','Staging','Canopy','Launchpad','Vehicle','Device','St','EFT','Actual Finish','Rescue'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-50 animate-pulse">
                  {Array.from({ length: 15 }).map((_, j) => (
                    <td key={j} className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-16" /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : rosterData && !hasAnyData ? (
        <EmptyState
          title={`No roster data for ${format(parseISO(planDate), 'EEEE, MMMM d')}`}
          subtitle="The uploaded file has no entries for this date. Try navigating to a different day."
          hint="Week Schedule covers Sun–Sat of the uploaded week"
        />
      ) : (
        <EmptyState
          title="Upload files to begin"
          subtitle="Upload the Weekly Schedule, Routes file, and DMF5 Loadout to build the operations workbook"
          hint="Files: 1· Weekly Schedule  2· Routes_DMF5  3· DMF5 Loadout"
        />
      )}

      {/* ── Pick List Debug Modal ──────────────────────────────────────────── */}
      {pickListDebug && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPickListDebug(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">🔍 Pick List Debug — {pickListDebug.date}</h2>
              <button onClick={() => setPickListDebug(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-blue-700">{pickListDebug.pick_list_in_db?.length || 0}</p>
                  <p className="text-[10px] uppercase font-semibold text-blue-500">In Pick List DB</p>
                </div>
                <div className="bg-indigo-50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-indigo-700">{pickListDebug.ops_routes_today?.length || 0}</p>
                  <p className="text-[10px] uppercase font-semibold text-indigo-500">In Ops Planner</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-green-700">{pickListDebug.matched?.length || 0}</p>
                  <p className="text-[10px] uppercase font-semibold text-green-500">Matched</p>
                </div>
              </div>

              {/* Matched */}
              {pickListDebug.matched?.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-green-600 mb-1">✅ Matched ({pickListDebug.matched.length})</p>
                  <p className="text-xs text-slate-500 font-mono">{pickListDebug.matched.join(', ')}</p>
                </div>
              )}

              {/* Unmatched */}
              {pickListDebug.unmatched_ops?.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-red-600 mb-1">🔴 In Ops but NOT in Pick List ({pickListDebug.unmatched_ops.length})</p>
                  <p className="text-xs text-red-700 font-mono">{pickListDebug.unmatched_ops.join(', ')}</p>
                </div>
              )}
              {pickListDebug.unmatched_pick_list?.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-600 mb-1">🟡 In Pick List but NOT in Ops ({pickListDebug.unmatched_pick_list.length})</p>
                  <p className="text-xs text-amber-700 font-mono">{pickListDebug.unmatched_pick_list.join(', ')}</p>
                </div>
              )}

              {/* Raw data tables */}
              <details>
                <summary className="text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-700">Pick List DB rows ({pickListDebug.pick_list_in_db?.length})</summary>
                <pre className="mt-2 text-[10px] bg-slate-50 rounded-lg p-3 overflow-x-auto max-h-48 border">{JSON.stringify(pickListDebug.pick_list_in_db, null, 2)}</pre>
              </details>
              <details>
                <summary className="text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-700">Ops Planner routes ({pickListDebug.ops_routes_today?.length})</summary>
                <pre className="mt-2 text-[10px] bg-slate-50 rounded-lg p-3 overflow-x-auto max-h-48 border">{JSON.stringify(pickListDebug.ops_routes_today, null, 2)}</pre>
              </details>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
              <button className="btn-secondary text-sm" onClick={() => setPickListDebug(null)}>Close</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Pick List Upload Results Modal ─────────────────────────────────── */}
      {pickListUploadResult && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPickListUploadResult(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-800 flex items-center gap-2">
                {(!pickListUploadResult.missing_from_picklist?.length && !pickListUploadResult.extra_in_picklist?.length)
                  ? <><CheckCircle size={18} className="text-green-600" /> Pick List Uploaded Successfully</>
                  : <><AlertTriangle size={18} className="text-amber-500" /> Pick List Uploaded — Review Required</>}
              </h2>
              <button onClick={() => setPickListUploadResult(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <p className="text-sm text-slate-600">
                <span className="font-bold">{pickListUploadResult.lsmd_routes}</span> LSMD routes found
                {pickListUploadResult.matched > 0 && <> — <span className="font-bold text-green-600">{pickListUploadResult.matched}</span> matched to today's drivers</>}
              </p>

              {pickListUploadResult.missing_from_picklist?.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-red-600 mb-2">Missing from pick list (in Ops but not in PDF)</p>
                  <div className="space-y-1">
                    {pickListUploadResult.missing_from_picklist.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                        <span className="text-red-500">🔴</span>
                        <span className="font-mono font-bold text-red-800">{m.vehicle_id}</span>
                        <span className="text-red-600">— {m.driver}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pickListUploadResult.extra_in_picklist?.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-600 mb-2">Extra in pick list (in PDF but not assigned)</p>
                  <div className="space-y-1">
                    {pickListUploadResult.extra_in_picklist.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                        <span className="text-amber-500">🟡</span>
                        <span className="font-mono font-bold text-amber-800">{m.vehicle_id}</span>
                        <span className="text-amber-600">— Not assigned to any driver</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!pickListUploadResult.missing_from_picklist?.length && !pickListUploadResult.extra_in_picklist?.length && (
                <p className="text-sm text-green-600 font-semibold">All routes matched to today's drivers!</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
              <button className="btn-primary text-sm" onClick={() => setPickListUploadResult(null)}>
                {pickListUploadResult.missing_from_picklist?.length ? 'Understood — Proceed Anyway' : 'Close'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Pick List Summary Modal ───────────────────────────────────────── */}
      {pickListSummaryModal && (() => {
        const buildMsg = (name, routeCode, pick) =>
          `Hi ${name}! Your pick list for today:\nRoute: ${routeCode} | Wave: ${pick.wave_time || '—'}\n🛍 Bags: ${pick.bags} bags${pick.overflow > 0 ? ` + ${pick.overflow} overflow` : ''}\n📦 Total packages: ${pick.total_packages}${pick.commercial_packages > 0 ? ` (${pick.commercial_packages} commercial)` : ''}\n- Last Mile DSP 🐕`;

        const isSingle = pickListSummaryModal !== 'all';

        // For "all" mode, build list of drivers with pick list data
        const allDriverPicks = !isSingle ? sortedRows
          .map(row => {
            const asgn = row.asgn || {};
            const route = asgn.route_code || row.routeCode || '';
            const pick = pickListMap[route.toUpperCase()] || pickListMap[route];
            const name = asgn.name_override || row.name || '';
            return pick && name ? { name, routeCode: route, pick } : null;
          })
          .filter(Boolean) : [];

        const copyAll = () => {
          const text = allDriverPicks.map(d => buildMsg(d.name, d.routeCode, d.pick)).join('\n\n─────────────────\n\n');
          navigator.clipboard.writeText(text).then(() => toast.success('All summaries copied'));
        };

        return createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPickListSummaryModal(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <h2 className="font-bold text-slate-800">{isSingle ? 'Pick List Summary' : 'All Driver Summaries'}</h2>
                <button onClick={() => setPickListSummaryModal(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {isSingle ? (() => {
                  const { name, routeCode, pick } = pickListSummaryModal;
                  return (
                    <div className="font-mono text-sm leading-relaxed bg-slate-50 rounded-xl p-4 border border-slate-200">
                      <p><span className="text-slate-500">Driver:</span> <span className="font-bold">{name}</span></p>
                      <p><span className="text-slate-500">Route:</span> <span className="font-bold">{routeCode}</span></p>
                      <p><span className="text-slate-500">Wave Time:</span> {pick.wave_time || '—'}</p>
                      <div className="border-t border-slate-300 my-2" />
                      <p>Bags to load: <span className="font-bold">{pick.bags} bags</span>{pick.overflow > 0 ? ` + ${pick.overflow} overflow` : ''}</p>
                      <p>Total packages: <span className="font-bold">{pick.total_packages}</span></p>
                      {pick.commercial_packages > 0 && <p>Commercial packages: <span className="font-bold">{pick.commercial_packages}</span></p>}
                    </div>
                  );
                })() : (
                  allDriverPicks.length > 0 ? allDriverPicks.map((d, i) => (
                    <div key={i} className="font-mono text-xs leading-relaxed bg-slate-50 rounded-xl p-3 border border-slate-200">
                      <p className="font-bold text-sm mb-1">{d.name} — {d.routeCode}</p>
                      <p>🛍 {d.pick.bags} bags{d.pick.overflow > 0 ? ` + ${d.pick.overflow} overflow` : ''} · 📦 {d.pick.total_packages} pkgs{d.pick.commercial_packages > 0 ? ` (${d.pick.commercial_packages} comm)` : ''}</p>
                    </div>
                  )) : <p className="text-slate-400 text-center py-4">No pick list data matched to drivers.</p>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
                {isSingle ? (
                  <button
                    className="btn-primary flex items-center gap-2 text-sm"
                    onClick={() => {
                      const { name, routeCode, pick } = pickListSummaryModal;
                      navigator.clipboard.writeText(buildMsg(name, routeCode, pick)).then(() => toast.success('Message copied'));
                    }}
                  >
                    <Copy size={14} /> Copy Message
                  </button>
                ) : (
                  <button className="btn-primary flex items-center gap-2 text-sm" onClick={copyAll}>
                    <Copy size={14} /> Copy All ({allDriverPicks.length})
                  </button>
                )}
                <button className="btn-secondary text-sm" onClick={() => setPickListSummaryModal(null)}>Close</button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {/* ── WhatsApp Briefing Confirmation Modal ──────────────────────────── */}
      {whatsappConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !whatsappSending && setWhatsappConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-800 flex items-center gap-2">
                <MessageCircle size={18} className="text-green-600" /> WhatsApp Morning Briefing
              </h2>
              {!whatsappSending && <button onClick={() => setWhatsappConfirm(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>}
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-slate-600">
                Send morning briefing via WhatsApp to all drivers with assigned routes for <span className="font-semibold">{planDate}</span>?
              </p>
              <p className="text-xs text-slate-400">
                Each driver will receive their route, vehicle, staging, wave, and pick list info.
              </p>
              {picklistLockStatus?.locked && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <span className="text-amber-500 flex-shrink-0 mt-0.5">⚠️</span>
                  <p className="text-xs text-amber-700">
                    Drivers won't be able to see their full pick list in the app until <span className="font-bold">{picklistLockStatus.available_at}</span>. You can still send the WhatsApp briefing now.
                  </p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
              <button
                className="btn-primary flex items-center gap-2 text-sm bg-green-600 hover:bg-green-700"
                disabled={whatsappSending}
                onClick={async () => {
                  setWhatsappSending(true);
                  try {
                    const { data } = await api.post('/ops/send-whatsapp-briefing', { date: planDate });
                    setWhatsappConfirm(false);
                    const parts = [];
                    if (data.sent > 0) parts.push(`Sent to ${data.sent} drivers`);
                    if (data.failed > 0) parts.push(`${data.failed} failed`);
                    if (data.sent > 0) toast.success(parts.join(' | '));
                    else toast.error(parts.join(' | ') || 'No messages sent');
                    if (data.errors?.length > 0) {
                      console.warn('[WhatsApp briefing errors]', data.errors);
                    }
                  } catch (err) {
                    toast.error(err?.response?.data?.error || 'Failed to send briefings');
                  } finally {
                    setWhatsappSending(false);
                  }
                }}
              >
                {whatsappSending ? <RefreshCw size={14} className="animate-spin" /> : <MessageCircle size={14} />}
                {whatsappSending ? 'Sending…' : 'Send All'}
              </button>
              <button className="btn-secondary text-sm" disabled={whatsappSending} onClick={() => setWhatsappConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
