const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

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

module.exports = router;
