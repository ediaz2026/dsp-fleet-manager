const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');
const { csvUpload } = require('../middleware/upload');
const csv = require('csv-parse/sync');
const xlsx = require('xlsx');
const fs = require('fs');

router.use(authMiddleware);

/* ─────────────────────────────────────────
   SHIFT TYPES
───────────────────────────────────────── */
router.get('/shift-types', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM shift_types ORDER BY sort_order, name');
  res.json(rows);
});

router.post('/shift-types', managerOnly, async (req, res) => {
  const { name, default_start_time, default_end_time, color, sort_order } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO shift_types (name, default_start_time, default_end_time, color, sort_order)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, default_start_time || '07:00', default_end_time || '17:00', color || 'blue', sort_order || 99]
  );
  res.status(201).json(rows[0]);
});

router.put('/shift-types/reorder', managerOnly, async (req, res) => {
  const { order } = req.body; // [{ id, sort_order }]
  if (!Array.isArray(order) || order.length === 0)
    return res.status(400).json({ error: 'order array required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { id, sort_order } of order) {
      await client.query('UPDATE shift_types SET sort_order=$1 WHERE id=$2', [sort_order, id]);
    }
    await client.query('COMMIT');
    res.json({ message: 'Order saved' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.put('/shift-types/:id', managerOnly, async (req, res) => {
  const { name, default_start_time, default_end_time, color, is_active, sort_order } = req.body;
  const { rows } = await pool.query(
    `UPDATE shift_types SET name=$1, default_start_time=$2, default_end_time=$3,
     color=$4, is_active=$5, sort_order=$6 WHERE id=$7 RETURNING *`,
    [name, default_start_time, default_end_time, color, is_active, sort_order, req.params.id]
  );
  res.json(rows[0]);
});

router.delete('/shift-types/:id', managerOnly, async (req, res) => {
  await pool.query('DELETE FROM shift_types WHERE id=$1', [req.params.id]);
  res.json({ message: 'Deleted' });
});

/* ─────────────────────────────────────────
   RECURRING SCHEDULES
───────────────────────────────────────── */
router.get('/recurring', async (req, res) => {
  const { rows: schedules } = await pool.query(
    'SELECT * FROM recurring_schedules ORDER BY name'
  );
  const { rows: entries } = await pool.query(
    `SELECT rse.*, s.first_name, s.last_name, s.employee_id
     FROM recurring_schedule_entries rse
     JOIN staff s ON s.id = rse.staff_id
     ORDER BY rse.day_of_week, s.last_name`
  );
  const result = schedules.map(sch => ({
    ...sch,
    entries: entries.filter(e => e.schedule_id === sch.id),
  }));
  res.json(result);
});

router.post('/recurring', managerOnly, async (req, res) => {
  const { name } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO recurring_schedules (name) VALUES ($1) RETURNING *', [name]
  );
  res.status(201).json(rows[0]);
});

router.put('/recurring/:id', managerOnly, async (req, res) => {
  const { name, is_active } = req.body;
  const { rows } = await pool.query(
    'UPDATE recurring_schedules SET name=$1, is_active=$2 WHERE id=$3 RETURNING *',
    [name, is_active, req.params.id]
  );
  res.json(rows[0]);
});

router.delete('/recurring/:id', managerOnly, async (req, res) => {
  await pool.query('DELETE FROM recurring_schedules WHERE id=$1', [req.params.id]);
  res.json({ message: 'Deleted' });
});

// Add entry to recurring schedule
router.post('/recurring/:id/entries', managerOnly, async (req, res) => {
  const { staff_id, day_of_week, shift_type, start_time, end_time } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO recurring_schedule_entries (schedule_id, staff_id, day_of_week, shift_type, start_time, end_time)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (schedule_id, staff_id, day_of_week) DO UPDATE
       SET shift_type=EXCLUDED.shift_type, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time
     RETURNING *`,
    [req.params.id, staff_id, day_of_week, shift_type || 'EDV', start_time || '07:00', end_time || '17:00']
  );
  res.status(201).json(rows[0]);
});

router.delete('/recurring/:scheduleId/entries/:entryId', managerOnly, async (req, res) => {
  await pool.query(
    'DELETE FROM recurring_schedule_entries WHERE id=$1 AND schedule_id=$2',
    [req.params.entryId, req.params.scheduleId]
  );
  res.json({ message: 'Deleted' });
});

// Safe shift types that can be auto-deleted when recurring pattern changes
const AUTO_SHIFT_TYPES = ['EDV', 'STEP VAN', 'EXTRA', 'HELPER'];

// Maximum weeks ahead for schedule apply
const MAX_WEEKS_AHEAD = 8;
function checkWeekLimit(weekStart) {
  const max = new Date();
  max.setDate(max.getDate() + MAX_WEEKS_AHEAD * 7);
  if (new Date(weekStart) > max) {
    return { error: 'Cannot apply schedule more than 8 weeks in advance', maxDate: max.toISOString().split('T')[0] };
  }
  return null;
}

// Apply recurring schedule to a week
router.post('/recurring/apply', managerOnly, async (req, res) => {
  const { schedule_id, week_start } = req.body; // week_start = Sunday date string
  if (!schedule_id || !week_start) return res.status(400).json({ error: 'schedule_id and week_start required' });
  const weekLimitErr = checkWeekLimit(week_start);
  if (weekLimitErr) return res.status(400).json(weekLimitErr);

  const { rows: entries } = await pool.query(
    'SELECT * FROM recurring_schedule_entries WHERE schedule_id=$1', [schedule_id]
  );

  const weekDate = new Date(week_start + 'T00:00:00');
  const weekEnd = new Date(weekDate);
  weekEnd.setDate(weekDate.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split('T')[0];
  let created = 0, deleted = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if any shifts in this week are published — if so, skip cleanup
    const { rows: pubCheck } = await client.query(
      `SELECT 1 FROM shifts WHERE shift_date BETWEEN $1 AND $2 AND publish_status = 'published' LIMIT 1`,
      [week_start, weekEndStr]
    );
    const weekIsPublished = pubCheck.length > 0;

    // Build per-staff enabled DOWs from entries
    if (!weekIsPublished) {
      const staffDOWs = {};
      for (const entry of entries) {
        if (!staffDOWs[entry.staff_id]) staffDOWs[entry.staff_id] = new Set();
        staffDOWs[entry.staff_id].add(entry.day_of_week);
      }
      // Delete stale shifts for each staff member on days no longer in pattern
      for (const [staffId, enabledDOWs] of Object.entries(staffDOWs)) {
        const dows = Array.from(enabledDOWs);
        if (dows.length === 7) continue; // all days enabled, nothing to delete
        const placeholders = dows.map((_, i) => `$${i + 3}`).join(',');
        const { rowCount } = await client.query(
          `DELETE FROM shifts
           WHERE staff_id = $1
             AND shift_date BETWEEN $2 AND '${weekEndStr}'
             AND EXTRACT(DOW FROM shift_date)::int NOT IN (${placeholders})
             AND UPPER(shift_type) IN ('EDV','STEP VAN','EXTRA','HELPER')`,
          [parseInt(staffId), week_start, ...dows]
        );
        deleted += rowCount;
      }
    }

    for (const entry of entries) {
      const shiftDate = new Date(weekDate);
      shiftDate.setDate(weekDate.getDate() + entry.day_of_week);
      const dateStr = shiftDate.toISOString().split('T')[0];

      await client.query(
        `INSERT INTO shifts (staff_id, shift_date, start_time, end_time, shift_type, status)
         VALUES ($1,$2,$3,$4,$5,'scheduled')
         ON CONFLICT DO NOTHING`,
        [entry.staff_id, dateStr, entry.start_time, entry.end_time, entry.shift_type]
      );
      created++;
    }
    await client.query('COMMIT');
    res.json({ created, deleted, message: `Applied ${created} shifts, removed ${deleted} stale shifts` });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/* ─────────────────────────────────────────
   ROUTE COMMITMENTS
───────────────────────────────────────── */
router.get('/route-commitments', async (req, res) => {
  const { week_start, weeks = 8 } = req.query;
  let q = 'SELECT * FROM route_commitments';
  const params = [];
  if (week_start) {
    params.push(week_start);
    q += ` WHERE week_start >= $1 ORDER BY week_start LIMIT ${parseInt(weeks)}`;
  } else {
    q += ' ORDER BY week_start DESC LIMIT ' + parseInt(weeks);
  }
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

router.post('/route-commitments', managerOnly, async (req, res) => {
  const { week_start, amazon_week, edv_count, step_van_count, total_routes, notes, daily_targets } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO route_commitments (week_start, amazon_week, edv_count, step_van_count, total_routes, notes, daily_targets)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (week_start) DO UPDATE
       SET amazon_week=EXCLUDED.amazon_week, edv_count=EXCLUDED.edv_count,
           step_van_count=EXCLUDED.step_van_count, total_routes=EXCLUDED.total_routes,
           notes=EXCLUDED.notes, daily_targets=EXCLUDED.daily_targets, updated_at=NOW()
     RETURNING *`,
    [week_start, amazon_week, edv_count || 0, step_van_count || 0, total_routes || 0, notes,
     JSON.stringify(daily_targets || {})]
  );
  res.status(201).json(rows[0]);
});

/* ─────────────────────────────────────────
   DRIVER HOURS
───────────────────────────────────────── */
router.get('/hours', async (req, res) => {
  const { week_start } = req.query;
  if (!week_start) return res.status(400).json({ error: 'week_start required' });
  const { rows } = await pool.query(
    `SELECT dh.*, s.first_name, s.last_name, s.employee_id,
            d.transponder_id as driver_transponder
     FROM driver_hours dh
     JOIN staff s ON s.id = dh.staff_id
     LEFT JOIN drivers d ON d.staff_id = s.id
     WHERE dh.week_start = $1
     ORDER BY s.last_name, s.first_name`,
    [week_start]
  );
  res.json(rows);
});

router.post('/hours/manual', managerOnly, async (req, res) => {
  const { staff_id, week_start, hours_worked } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO driver_hours (staff_id, week_start, hours_worked, source)
     VALUES ($1,$2,$3,'manual')
     ON CONFLICT (staff_id, week_start) DO UPDATE
       SET hours_worked=EXCLUDED.hours_worked, source='manual', uploaded_at=NOW()
     RETURNING *`,
    [staff_id, week_start, hours_worked]
  );
  res.json(rows[0]);
});

// Upload hours via CSV/Excel matched by Transponder ID
router.post('/hours/upload', managerOnly, csvUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { week_start } = req.body;
  if (!week_start) return res.status(400).json({ error: 'week_start required' });

  const filePath = req.file.path;
  let records = [];

  try {
    if (req.file.originalname.endsWith('.csv')) {
      let content = fs.readFileSync(filePath, 'utf8');
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      records = csv.parse(content, { columns: true, skip_empty_lines: true, trim: true });
    } else {
      const wb = xlsx.readFile(filePath);
      records = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    }
  } catch (err) {
    return res.status(400).json({ error: 'Failed to parse file: ' + err.message });
  }

  // Get all staff with their transponder IDs
  const { rows: staffRows } = await pool.query(
    `SELECT s.id, s.first_name, s.last_name, s.employee_id, d.transponder_id
     FROM staff s LEFT JOIN drivers d ON d.staff_id = s.id
     WHERE s.status = 'active'`
  );
  const transponderMap = {};
  staffRows.forEach(s => {
    if (s.transponder_id) transponderMap[s.transponder_id.toUpperCase()] = s;
    if (s.employee_id) transponderMap[s.employee_id.toUpperCase()] = s;
  });

  let matched = 0, unmatched = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of records) {
      const keys = Object.keys(row);
      // Try to find transponder ID and hours columns
      const findVal = (...names) => {
        for (const n of names) {
          const k = keys.find(k => k.toLowerCase().replace(/[^a-z]/g,'').includes(n.toLowerCase().replace(/[^a-z]/g,'')));
          if (k && row[k] !== undefined && row[k] !== '') return row[k]?.toString().trim();
        }
        return null;
      };
      const transponderId = findVal('transponder', 'badge', 'transporter', 'id');
      const hoursRaw = findVal('hours', 'workedhours', 'totalhours', 'hrs');
      if (!transponderId || !hoursRaw) { unmatched++; continue; }
      const hours = parseFloat(hoursRaw);
      if (isNaN(hours)) { unmatched++; continue; }
      const staff = transponderMap[transponderId.toUpperCase()];
      if (!staff) { unmatched++; continue; }
      await client.query(
        `INSERT INTO driver_hours (staff_id, transponder_id, week_start, hours_worked, source)
         VALUES ($1,$2,$3,$4,'upload')
         ON CONFLICT (staff_id, week_start) DO UPDATE
           SET hours_worked=EXCLUDED.hours_worked, source='upload', uploaded_at=NOW()`,
        [staff.id, transponderId, week_start, hours]
      );
      matched++;
    }
    await client.query('COMMIT');
    res.json({ matched, unmatched, total: records.length });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    fs.unlinkSync(filePath);
  }
});

/* ─────────────────────────────────────────
   DAY-BASED RECURRING SCHEDULES
───────────────────────────────────────── */

// GET all 7 day configs with their assigned drivers
router.get('/day-recurring', async (req, res) => {
  const { rows: days } = await pool.query(
    'SELECT * FROM day_schedules ORDER BY day_of_week'
  );
  const { rows: driverRows } = await pool.query(
    `SELECT dsd.*, s.first_name, s.last_name, s.employee_id
     FROM day_schedule_drivers dsd
     JOIN staff s ON s.id = dsd.staff_id
     ORDER BY dsd.day_of_week, s.last_name, s.first_name`
  );
  const result = days.map(d => ({
    ...d,
    drivers: driverRows.filter(dr => dr.day_of_week === d.day_of_week),
  }));
  res.json(result);
});

// PUT update a day's config (shift_type, start_time, end_time, enabled)
router.put('/day-recurring/:day', managerOnly, async (req, res) => {
  const day = parseInt(req.params.day);
  if (day < 0 || day > 6) return res.status(400).json({ error: 'Invalid day_of_week' });
  const { shift_type, start_time, end_time, enabled } = req.body;
  const { rows } = await pool.query(
    `UPDATE day_schedules
     SET shift_type=$1, start_time=$2, end_time=$3, enabled=$4, updated_at=NOW()
     WHERE day_of_week=$5 RETURNING *`,
    [shift_type, start_time, end_time, enabled, day]
  );
  if (!rows.length) return res.status(404).json({ error: 'Day not found — run db:setup to seed' });
  res.json(rows[0]);
});

// POST add a driver to a day
router.post('/day-recurring/:day/drivers', managerOnly, async (req, res) => {
  const day = parseInt(req.params.day);
  const { staff_id } = req.body;
  if (!staff_id) return res.status(400).json({ error: 'staff_id required' });
  const { rows } = await pool.query(
    `INSERT INTO day_schedule_drivers (day_of_week, staff_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [day, staff_id]
  );
  res.status(201).json(rows[0] || { day_of_week: day, staff_id });
});

// DELETE remove a driver from a day
router.delete('/day-recurring/:day/drivers/:staffId', managerOnly, async (req, res) => {
  const day = parseInt(req.params.day);
  const staffId = parseInt(req.params.staffId);
  await pool.query(
    'DELETE FROM day_schedule_drivers WHERE day_of_week=$1 AND staff_id=$2',
    [day, staffId]
  );
  res.json({ ok: true });
});

// POST apply recurring schedules to a given week
router.post('/day-recurring/apply', managerOnly, async (req, res) => {
  const { week_start } = req.body; // Sunday of target week (yyyy-MM-dd)
  if (!week_start) return res.status(400).json({ error: 'week_start required' });
  const weekLimitErr = checkWeekLimit(week_start);
  if (weekLimitErr) return res.status(400).json(weekLimitErr);

  // Get all enabled day configs with drivers
  const { rows: days } = await pool.query(
    'SELECT * FROM day_schedules WHERE enabled=TRUE'
  );
  const { rows: driverRows } = await pool.query(
    'SELECT * FROM day_schedule_drivers'
  );

  const weekDate = new Date(week_start + 'T12:00:00Z');
  let created = 0;
  let skipped = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get any SUSPENSION/UTO/PTO shifts this week (to skip those drivers)
    const weekEnd = new Date(weekDate);
    weekEnd.setDate(weekDate.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    const { rows: absenceShifts } = await client.query(
      `SELECT staff_id FROM shifts
       WHERE shift_date BETWEEN $1 AND $2
         AND shift_type IN ('SUSPENSION','UTO','PTO')`,
      [week_start, weekEndStr]
    );
    const absentStaffIds = new Set(absenceShifts.map(s => s.staff_id));

    // Check if any shifts this week are published — skip cleanup if so
    const { rows: pubCheck } = await client.query(
      `SELECT 1 FROM shifts WHERE shift_date BETWEEN $1 AND $2 AND publish_status = 'published' LIMIT 1`,
      [week_start, weekEndStr]
    );
    const weekIsPublished = pubCheck.length > 0;
    let deleted = 0;

    // ── 1. Per-driver recurring shifts (specific config, highest priority) ──
    const { rows: perDriverRows } = await client.query(
      'SELECT * FROM driver_recurring_shifts'
    );
    const DAY_COLS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

    // Clean up stale shifts for drivers whose pattern changed (unpublished weeks only)
    // Aggregate ALL enabled DOWs across ALL of a driver's recurring rows so dual-role
    // drivers (e.g. EDV some days + DISPATCH other days) don't lose valid shifts.
    if (!weekIsPublished) {
      const driverEnabledDOWs = {};
      for (const row of perDriverRows) {
        if (absentStaffIds.has(row.staff_id)) continue;
        if (!driverEnabledDOWs[row.staff_id]) driverEnabledDOWs[row.staff_id] = new Set();
        for (let dow = 0; dow <= 6; dow++) {
          if (row[DAY_COLS[dow]]) driverEnabledDOWs[row.staff_id].add(dow);
        }
      }
      for (const [staffId, dowSet] of Object.entries(driverEnabledDOWs)) {
        const dows = Array.from(dowSet);
        if (dows.length === 0 || dows.length === 7) continue;
        const placeholders = dows.map((_, i) => `$${i + 3}`).join(',');
        const { rowCount } = await client.query(
          `DELETE FROM shifts
           WHERE staff_id = $1
             AND shift_date BETWEEN $2 AND '${weekEndStr}'
             AND EXTRACT(DOW FROM shift_date)::int NOT IN (${placeholders})
             AND UPPER(shift_type) IN ('EDV','STEP VAN','EXTRA','HELPER')`,
          [parseInt(staffId), week_start, ...dows]
        );
        deleted += rowCount;
      }
    }

    for (const row of perDriverRows) {
      if (absentStaffIds.has(row.staff_id)) continue;

      for (let dow = 0; dow <= 6; dow++) {
        if (!row[DAY_COLS[dow]]) continue;

        const targetDate = new Date(weekDate);
        targetDate.setDate(weekDate.getDate() + dow);
        const dateStr = targetDate.toISOString().split('T')[0];

        // Skip if manager explicitly deleted this shift for this date
        const { rows: skipCheck } = await client.query(
          'SELECT 1 FROM recurring_skip WHERE staff_id=$1 AND skip_date=$2',
          [row.staff_id, dateStr]
        );
        if (skipCheck.length > 0) { skipped++; continue; }

        const { rowCount } = await client.query(
          `INSERT INTO shifts (staff_id, shift_date, start_time, end_time, shift_type, status, publish_status)
           VALUES ($1,$2,$3,$4,$5,'scheduled','draft')
           ON CONFLICT (staff_id, shift_date) DO NOTHING`,
          [row.staff_id, dateStr, row.start_time, row.end_time, row.shift_type]
        );
        if (rowCount > 0) created++; else skipped++;
      }
    }

    // ── 2. Global day-schedule pool (fills gaps for drivers not in per-driver config) ──
    for (const day of days) {
      const dayDrivers = driverRows.filter(dr => dr.day_of_week === day.day_of_week);
      if (!dayDrivers.length) continue;

      const targetDate = new Date(weekDate);
      targetDate.setDate(weekDate.getDate() + day.day_of_week);
      const dateStr = targetDate.toISOString().split('T')[0];

      for (const dr of dayDrivers) {
        if (absentStaffIds.has(dr.staff_id)) { skipped++; continue; }

        // Skip if manager explicitly deleted this shift for this date
        const { rows: skipCheck } = await client.query(
          'SELECT 1 FROM recurring_skip WHERE staff_id=$1 AND skip_date=$2',
          [dr.staff_id, dateStr]
        );
        if (skipCheck.length > 0) { skipped++; continue; }

        const { rowCount } = await client.query(
          `INSERT INTO shifts (staff_id, shift_date, start_time, end_time, shift_type, status, publish_status)
           VALUES ($1,$2,$3,$4,$5,'scheduled','draft')
           ON CONFLICT (staff_id, shift_date) DO NOTHING`,
          [dr.staff_id, dateStr, day.start_time, day.end_time, day.shift_type]
        );
        if (rowCount > 0) created++; else skipped++;
      }
    }

    await client.query('COMMIT');
    res.json({ created, skipped, deleted });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/* ─────────────────────────────────────────
   ROTATING DRIVER WEEKLY APPLY
───────────────────────────────────────── */

// POST /schedule/rotating-apply
// Body: { week_start, assignments: [{staff_id, row_id}] }
router.post('/rotating-apply', managerOnly, async (req, res) => {
  const { week_start, assignments } = req.body;
  if (!week_start || !Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({ error: 'week_start and assignments required' });
  }
  const weekLimitErr = checkWeekLimit(week_start);
  if (weekLimitErr) return res.status(400).json(weekLimitErr);

  const weekDate = new Date(week_start + 'T12:00:00Z');
  const weekEnd = new Date(weekDate);
  weekEnd.setDate(weekDate.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split('T')[0];
  const DAY_COLS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  let created = 0, skipped = 0, deleted = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if any shifts this week are published — skip cleanup if so
    const { rows: pubCheck } = await client.query(
      `SELECT 1 FROM shifts WHERE shift_date BETWEEN $1 AND $2 AND publish_status = 'published' LIMIT 1`,
      [week_start, weekEndStr]
    );
    const weekIsPublished = pubCheck.length > 0;

    for (const { staff_id, row_id } of assignments) {
      const { rows: rowData } = await client.query(
        'SELECT * FROM driver_recurring_shifts WHERE id=$1 AND staff_id=$2',
        [row_id, staff_id]
      );
      if (!rowData[0]) continue;
      const row = rowData[0];

      // Clean up stale shifts for this driver (unpublished weeks only)
      if (!weekIsPublished) {
        const enabledDOWs = [];
        for (let dow = 0; dow <= 6; dow++) {
          if (row[DAY_COLS[dow]]) enabledDOWs.push(dow);
        }
        if (enabledDOWs.length > 0 && enabledDOWs.length < 7) {
          const placeholders = enabledDOWs.map((_, i) => `$${i + 3}`).join(',');
          const { rowCount } = await client.query(
            `DELETE FROM shifts
             WHERE staff_id = $1
               AND shift_date BETWEEN $2 AND '${weekEndStr}'
               AND EXTRACT(DOW FROM shift_date)::int NOT IN (${placeholders})
               AND UPPER(shift_type) IN ('EDV','STEP VAN','EXTRA','HELPER')`,
            [staff_id, week_start, ...enabledDOWs]
          );
          deleted += rowCount;
        }
      }

      for (let dow = 0; dow <= 6; dow++) {
        if (!row[DAY_COLS[dow]]) continue;

        const targetDate = new Date(weekDate);
        targetDate.setDate(weekDate.getDate() + dow);
        const dateStr = targetDate.toISOString().split('T')[0];

        const { rowCount } = await client.query(
          `INSERT INTO shifts (staff_id, shift_date, start_time, end_time, shift_type, status, publish_status)
           VALUES ($1,$2,$3,$4,$5,'scheduled','draft')
           ON CONFLICT (staff_id, shift_date) DO NOTHING`,
          [staff_id, dateStr, row.start_time, row.end_time, row.shift_type]
        );
        if (rowCount > 0) created++; else skipped++;
      }
    }

    await client.query('COMMIT');
    res.json({ created, skipped, deleted });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = router;
