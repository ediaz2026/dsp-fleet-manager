const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// Ensure removed_from_ops column exists (idempotent — safe to run on every startup)
pool.query(`ALTER TABLE ops_assignments ADD COLUMN IF NOT EXISTS removed_from_ops BOOLEAN NOT NULL DEFAULT FALSE`)
  .catch(() => {});

// ─── Ops Planner Sessions ──────────────────────────────────────────────────────

// GET /api/ops-planner?date=YYYY-MM-DD
router.get('/', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query param required' });

  const result = await pool.query(
    'SELECT * FROM ops_planner_sessions WHERE plan_date = $1',
    [date]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'No session for this date' });
  res.json(result.rows[0]);
});

// POST /api/ops-planner — upsert session for plan_date
router.post('/', authMiddleware, async (req, res) => {
  const { plan_date, rows, route_summary, station_summary, volume_summary } = req.body;
  if (!plan_date) return res.status(400).json({ error: 'plan_date required' });

  const result = await pool.query(
    `INSERT INTO ops_planner_sessions
       (plan_date, rows, route_summary, station_summary, volume_summary, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (plan_date) DO UPDATE SET
       rows            = EXCLUDED.rows,
       route_summary   = EXCLUDED.route_summary,
       station_summary = EXCLUDED.station_summary,
       volume_summary  = EXCLUDED.volume_summary,
       updated_at      = NOW()
     RETURNING *`,
    [
      plan_date,
      JSON.stringify(rows || []),
      route_summary ? JSON.stringify(route_summary) : null,
      station_summary ? JSON.stringify(station_summary) : null,
      volume_summary ? JSON.stringify(volume_summary) : null,
      req.user?.id || null,
    ]
  );
  res.json(result.rows[0]);
});

// ─── Week Schedules ────────────────────────────────────────────────────────────

// GET /api/ops-planner/week-schedule?date=YYYY-MM-DD
// Returns the week_schedule whose week_start <= date <= week_start + 6
router.get('/week-schedule', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query param required' });

  const result = await pool.query(
    `SELECT * FROM week_schedules
     WHERE week_start <= $1::date
       AND week_start + INTERVAL '6 days' >= $1::date
     ORDER BY week_start DESC
     LIMIT 1`,
    [date]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'No week schedule found for this date' });
  res.json(result.rows[0]);
});

// POST /api/ops-planner/week-schedule — upsert by week_start
router.post('/week-schedule', authMiddleware, async (req, res) => {
  const { week_start, file_name, rows } = req.body;
  if (!week_start) return res.status(400).json({ error: 'week_start required' });

  const result = await pool.query(
    `INSERT INTO week_schedules (week_start, file_name, rows, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (week_start) DO UPDATE SET
       file_name  = EXCLUDED.file_name,
       rows       = EXCLUDED.rows
     RETURNING *`,
    [
      week_start,
      file_name || null,
      JSON.stringify(rows || []),
      req.user?.id || null,
    ]
  );
  res.json(result.rows[0]);
});

// ─── DELETE /api/ops-planner?date=YYYY-MM-DD ───────────────────────────────────
// Clear and remove all data for a given day
router.delete('/', authMiddleware, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  await pool.query('DELETE FROM ops_planner_sessions WHERE plan_date = $1', [date]);
  res.json({ ok: true });
});

// DELETE /api/ops-planner/clear-day?date=YYYY-MM-DD
// Wipes all assignments + clears routes/loadout file data for a single date
router.delete('/clear-day', authMiddleware, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  await pool.query('DELETE FROM ops_assignments WHERE plan_date = $1', [date]);
  await pool.query(`UPDATE ops_daily_routes SET routes='[]'::jsonb, file_name=NULL, updated_at=NOW() WHERE plan_date=$1`, [date]);
  await pool.query(`UPDATE ops_loadout     SET loadout='[]'::jsonb, file_name=NULL, updated_at=NOW() WHERE plan_date=$1`, [date]);
  res.json({ ok: true });
});

// ─── Ops Planner v2: Step 1 — Daily Roster ─────────────────────────────────────

// GET /api/ops-planner/roster?date=YYYY-MM-DD
router.get('/roster', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  const { rows } = await pool.query('SELECT * FROM ops_roster WHERE plan_date = $1', [date]);
  if (!rows.length) return res.json({ drivers_by_date: {}, available_dates: [], file_name: null });
  res.json(rows[0]);
});

// POST /api/ops-planner/roster
router.post('/roster', authMiddleware, async (req, res) => {
  const { plan_date, file_name, drivers_by_date, available_dates } = req.body;
  if (!plan_date) return res.status(400).json({ error: 'plan_date required' });
  const { rows } = await pool.query(
    `INSERT INTO ops_roster (plan_date, file_name, drivers_by_date, available_dates, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (plan_date) DO UPDATE SET
       file_name       = EXCLUDED.file_name,
       drivers_by_date = EXCLUDED.drivers_by_date,
       available_dates = EXCLUDED.available_dates,
       updated_at      = NOW()
     RETURNING *`,
    [plan_date, file_name || null, JSON.stringify(drivers_by_date || {}), JSON.stringify(available_dates || []), req.user?.id]
  );
  res.json(rows[0]);
});

// ─── Ops Planner v2: Step 2 — Routes ──────────────────────────────────────────

// GET /api/ops-planner/daily-routes?date=YYYY-MM-DD
router.get('/daily-routes', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  const { rows } = await pool.query('SELECT * FROM ops_daily_routes WHERE plan_date = $1', [date]);
  if (!rows.length) return res.json({ routes: [], file_name: null });
  res.json(rows[0]);
});

// POST /api/ops-planner/daily-routes
router.post('/daily-routes', authMiddleware, async (req, res) => {
  const { plan_date, file_name, routes } = req.body;
  if (!plan_date) return res.status(400).json({ error: 'plan_date required' });
  const { rows } = await pool.query(
    `INSERT INTO ops_daily_routes (plan_date, file_name, routes, created_by, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (plan_date) DO UPDATE SET
       file_name  = EXCLUDED.file_name,
       routes     = EXCLUDED.routes,
       updated_at = NOW()
     RETURNING *`,
    [plan_date, file_name || null, JSON.stringify(routes || []), req.user?.id]
  );
  res.json(rows[0]);
});

// ─── Ops Planner v2: Step 3 — DMF5 Loadout ────────────────────────────────────

// GET /api/ops-planner/loadout?date=YYYY-MM-DD
router.get('/loadout', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  const { rows } = await pool.query('SELECT * FROM ops_loadout WHERE plan_date = $1', [date]);
  if (!rows.length) return res.json({ loadout: [], file_name: null });
  res.json(rows[0]);
});

// POST /api/ops-planner/loadout
router.post('/loadout', authMiddleware, async (req, res) => {
  const { plan_date, file_name, loadout } = req.body;
  if (!plan_date) return res.status(400).json({ error: 'plan_date required' });
  const { rows } = await pool.query(
    `INSERT INTO ops_loadout (plan_date, file_name, loadout, created_by, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (plan_date) DO UPDATE SET
       file_name  = EXCLUDED.file_name,
       loadout    = EXCLUDED.loadout,
       updated_at = NOW()
     RETURNING *`,
    [plan_date, file_name || null, JSON.stringify(loadout || []), req.user?.id]
  );
  res.json(rows[0]);
});

// ─── Ops Planner v2: Step 4 — Assignments ─────────────────────────────────────

// GET /api/ops-planner/assignments?date=YYYY-MM-DD
router.get('/assignments', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  const { rows } = await pool.query(
    `SELECT oa.*, v.vehicle_name, v.license_plate
     FROM ops_assignments oa
     LEFT JOIN vehicles v   ON v.id  = oa.vehicle_id
     JOIN  staff        st  ON st.id = oa.staff_id
     WHERE oa.plan_date = $1
       AND st.status NOT IN ('terminated', 'deleted')`,
    [date]
  );
  res.json(rows);
});

// POST /api/ops-planner/assignments (upsert one driver's assignment)
const OPS_EXCLUDED_TYPES = ['ON CALL', 'UTO', 'PTO', 'SUSPENSION', 'TRAINING', 'TRAINER'];

router.post('/assignments', authMiddleware, async (req, res) => {
  const { plan_date, staff_id, vehicle_id, device_id, notes, shift_type, route_code, name_override } = req.body;
  if (!plan_date || !staff_id) return res.status(400).json({ error: 'plan_date and staff_id required' });

  // Block assignment if driver has a non-working shift type for this date
  try {
    const { rows: shiftRows } = await pool.query(
      `SELECT shift_type FROM shifts WHERE staff_id = $1 AND shift_date = $2 LIMIT 1`,
      [staff_id, plan_date]
    );
    if (shiftRows.length > 0 && OPS_EXCLUDED_TYPES.includes(shiftRows[0].shift_type?.toUpperCase())) {
      return res.json({ skipped: true, reason: shiftRows[0].shift_type });
    }
  } catch (e) { /* non-fatal — allow assignment if check fails */ }

  // Clear this route from any other driver first (prevents duplicates on reassign)
  if (route_code) {
    await pool.query(
      `UPDATE ops_assignments SET route_code = NULL, updated_at = NOW() WHERE route_code = $1 AND plan_date = $2 AND staff_id != $3`,
      [route_code, plan_date, staff_id]
    ).catch(() => {});
  }

  const { rows } = await pool.query(
    `INSERT INTO ops_assignments (plan_date, staff_id, vehicle_id, device_id, notes, shift_type, route_code, name_override, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (plan_date, staff_id) DO UPDATE SET
       vehicle_id    = COALESCE(EXCLUDED.vehicle_id,    ops_assignments.vehicle_id),
       device_id     = COALESCE(EXCLUDED.device_id,     ops_assignments.device_id),
       notes         = COALESCE(EXCLUDED.notes,         ops_assignments.notes),
       shift_type    = COALESCE(EXCLUDED.shift_type,    ops_assignments.shift_type),
       route_code    = COALESCE(EXCLUDED.route_code,    ops_assignments.route_code),
       name_override = COALESCE(EXCLUDED.name_override, ops_assignments.name_override),
       updated_at    = NOW()
     RETURNING *`,
    [plan_date, staff_id, vehicle_id || null, device_id || null, notes || null,
     shift_type || null, route_code || null, name_override || null]
  );
  res.json(rows[0]);
});

// PATCH /api/ops-planner/assignments/:staff_id — partial update (for inline edits that should clear a field)
router.patch('/assignments/:staff_id', authMiddleware, async (req, res) => {
  const { plan_date, ...fields } = req.body;
  if (!plan_date) return res.status(400).json({ error: 'plan_date required' });
  const staff_id = req.params.staff_id;
  const allowed = ['vehicle_id', 'device_id', 'notes', 'shift_type', 'route_code', 'name_override',
                   'wave_override', 'staging_override', 'canopy_override', 'launchpad_override',
                   'finish_time', 'rts_time', 'removed_from_ops'];
  const sets = []; const vals = [plan_date, staff_id];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) { sets.push(`${k}=$${vals.length + 1}`); vals.push(v ?? null); }
  }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  const { rows } = await pool.query(
    `UPDATE ops_assignments SET ${sets.join(', ')}, updated_at=NOW()
     WHERE plan_date=$1 AND staff_id=$2 RETURNING *`,
    vals
  );
  if (!rows.length) return res.status(404).json({ error: 'Assignment not found' });
  res.json(rows[0]);
});

// POST /api/ops-planner/remove-driver — upsert an assignment marking the driver as removed
// Clears route_code and sets removed_from_ops=true; does NOT touch the internal shift/schedule
router.post('/remove-driver', authMiddleware, async (req, res) => {
  const { plan_date, staff_id } = req.body;
  if (!plan_date || !staff_id) return res.status(400).json({ error: 'plan_date and staff_id required' });
  const { rows } = await pool.query(
    `INSERT INTO ops_assignments (plan_date, staff_id, removed_from_ops, route_code, updated_at)
     VALUES ($1, $2, true, null, NOW())
     ON CONFLICT (plan_date, staff_id) DO UPDATE SET
       removed_from_ops = true,
       route_code       = null,
       updated_at       = NOW()
     RETURNING *`,
    [plan_date, staff_id]
  );
  res.json(rows[0]);
});

module.exports = router;
