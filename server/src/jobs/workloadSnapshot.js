const pool = require('../db/pool');

// ── Helpers (same formulas as OperationalPlanner.jsx) ────────────────────────
function parseDurationToMinutes(dur) {
  if (!dur) return 0;
  if (typeof dur === 'number') return dur < 24 ? Math.round(dur * 60) : Math.round(dur);
  const s = String(dur).trim();
  if (!s) return 0;
  if (s.includes(':')) {
    const parts = s.split(':');
    return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
  }
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return n < 24 ? Math.round(n * 60) : Math.round(n);
}

function addMinutesToTime(timeStr, minutes) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  const h = parseInt(parts[0]) || 0;
  const m = parseInt(parts[1]) || 0;
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function getEftColor(eftTime) {
  if (!eftTime) return 'none';
  const [h, m] = eftTime.split(':').map(Number);
  const totalMin = h * 60 + m;
  if (totalMin < 15 * 60) return 'green';   // Before 3:00 PM
  if (totalMin < 17 * 60) return 'orange';  // 3:00–5:00 PM
  if (totalMin < 19 * 60) return 'yellow';  // 5:00–7:00 PM
  return 'red';                              // After 7:00 PM
}

function fmtDate(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// ── Main snapshot function ───────────────────────────────────────────────────
async function snapshotWorkloadForDate(targetDate) {
  // Default to yesterday in Eastern time
  const dateRes = await pool.query(
    `SELECT ((NOW() AT TIME ZONE 'America/New_York') - INTERVAL '1 day')::date AS d`
  );
  const dateStr = targetDate || fmtDate(dateRes.rows[0].d);
  console.log(`[WorkloadSnapshot] Running for ${dateStr}`);

  // 1. ALL ops_assignments for that date (with driver info + TID)
  const { rows: assignments } = await pool.query(`
    SELECT oa.staff_id, oa.shift_type, oa.route_code,
           s.first_name, s.last_name, d.transponder_id
    FROM ops_assignments oa
    JOIN staff s ON s.id = oa.staff_id
    LEFT JOIN drivers d ON d.staff_id = oa.staff_id
    WHERE oa.plan_date = $1
      AND (oa.removed_from_ops = false OR oa.removed_from_ops IS NULL)
  `, [dateStr]);

  if (!assignments.length) {
    console.log(`[WorkloadSnapshot] No assignments for ${dateStr}`);
    return 0;
  }

  // 2. Routes JSONB for that date — build TID→route + name→route maps
  const { rows: drRows } = await pool.query(
    `SELECT routes FROM ops_daily_routes WHERE plan_date = $1`, [dateStr]
  );
  const routesArray = drRows[0]?.routes || [];

  const tidToRoute = {};   // { TID: { routeCode, duration, shiftType } }
  const nameToRoute = {};  // { "firstname lastname" (lower): { routeCode, duration, shiftType } }
  for (const r of routesArray) {
    if (!r.routeCode) continue;
    const info = {
      routeCode: r.routeCode,
      duration: parseDurationToMinutes(r.duration),
      shiftType: r.shiftType || null,
    };
    // TID mapping
    const tids = [...(r.transponderIds || [])];
    if (r.primaryTransponderId && !tids.includes(r.primaryTransponderId)) {
      tids.push(r.primaryTransponderId);
    }
    for (const tid of tids) {
      if (tid) tidToRoute[tid] = info;
    }
    // Name mapping
    for (const dn of (r.driverNames || [])) {
      if (dn) nameToRoute[dn.toLowerCase().trim()] = info;
    }
  }

  // 3. Wave times from ops_loadout (per route code)
  const { rows: loRows } = await pool.query(
    `SELECT loadout FROM ops_loadout WHERE plan_date = $1`, [dateStr]
  );
  const waveByRoute = {};
  for (const entry of (loRows[0]?.loadout || [])) {
    if (entry.routeCode && entry.waveTime) {
      waveByRoute[entry.routeCode] = entry.waveTime;
    }
  }

  // 4. Shift start times as fallback
  const { rows: shiftRows } = await pool.query(
    `SELECT staff_id, start_time FROM shifts WHERE shift_date = $1`, [dateStr]
  );
  const shiftStartMap = {};
  for (const sh of shiftRows) {
    if (sh.start_time) shiftStartMap[sh.staff_id] = sh.start_time.slice(0, 5);
  }

  // 5. Match each driver → route → EFT
  const NON_ROUTE = ['EXTRA', 'HELPER', 'ON CALL', 'DISPATCH AM', 'DISPATCH PM',
                     'SUSPENSION', 'PTO', 'UTO', 'TRAINING', 'TRAINER'];
  const snapshots = [];

  for (const a of assignments) {
    // Skip non-route shift types if we know the type
    if (a.shift_type && NON_ROUTE.includes(a.shift_type.toUpperCase())) continue;

    // Match via: explicit route_code → TID → driver name
    let routeInfo = null;
    let routeCode = a.route_code || null;

    if (routeCode) {
      // Check if it's in the routes JSONB
      const match = routesArray.find(r => r.routeCode === routeCode);
      if (match) {
        routeInfo = { routeCode, duration: parseDurationToMinutes(match.duration), shiftType: match.shiftType };
      }
    }

    if (!routeInfo && a.transponder_id) {
      routeInfo = tidToRoute[a.transponder_id] || null;
    }

    if (!routeInfo) {
      const fullName = `${a.first_name} ${a.last_name}`.toLowerCase().trim();
      routeInfo = nameToRoute[fullName] || null;
    }

    // Skip if matched route is non-delivery type
    if (routeInfo?.shiftType && NON_ROUTE.includes(routeInfo.shiftType.toUpperCase())) continue;

    const rc = routeInfo?.routeCode || routeCode || null;
    const durationMin = routeInfo?.duration || 0;

    // Wave time: loadout for route → shift start → default
    const waveTime = (rc && waveByRoute[rc]) || shiftStartMap[a.staff_id] || '11:05';
    const departTime = addMinutesToTime(waveTime, 30);
    const eftTime = durationMin ? addMinutesToTime(departTime, durationMin) : null;
    const eftColor = getEftColor(eftTime);

    snapshots.push([
      dateStr, a.staff_id,
      `${a.first_name} ${a.last_name}`.toUpperCase(),
      rc, a.shift_type || routeInfo?.shiftType || null,
      waveTime, durationMin || null, eftTime, eftColor,
    ]);
  }

  // 6. Upsert
  for (const s of snapshots) {
    await pool.query(`
      INSERT INTO driver_daily_workload
        (work_date, staff_id, driver_name, route_code, shift_type, wave_time, duration_minutes, eft_time, eft_color)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (work_date, staff_id) DO UPDATE SET
        driver_name = EXCLUDED.driver_name,
        route_code = EXCLUDED.route_code,
        shift_type = EXCLUDED.shift_type,
        wave_time = EXCLUDED.wave_time,
        duration_minutes = EXCLUDED.duration_minutes,
        eft_time = EXCLUDED.eft_time,
        eft_color = EXCLUDED.eft_color
    `, s);
  }

  console.log(`[WorkloadSnapshot] Saved ${snapshots.length} records for ${dateStr}`);
  return snapshots.length;
}

module.exports = { snapshotWorkloadForDate };
