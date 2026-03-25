const router = require('express').Router();
const pool   = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// ── Volume Share ──────────────────────────────────────────────────────────────

// GET /api/analytics/volume-share              → list of dates (no params)
// GET /api/analytics/volume-share?date=…      → single date record
// GET /api/analytics/volume-share?start=&end= → range with full volume data
router.get('/volume-share', async (req, res) => {
  try {
    const { date, start, end } = req.query;
    if (start && end) {
      const { rows } = await pool.query(
        `SELECT plan_date, volume, total_routes FROM dsp_volume_share WHERE plan_date BETWEEN $1 AND $2 ORDER BY plan_date`,
        [start, end]
      );
      return res.json(rows);
    }
    if (!date) {
      const { rows } = await pool.query(
        `SELECT plan_date, total_routes FROM dsp_volume_share ORDER BY plan_date DESC LIMIT 120`
      );
      return res.json(rows);
    }
    const { rows } = await pool.query(
      `SELECT * FROM dsp_volume_share WHERE plan_date = $1`, [date]
    );
    if (!rows.length) return res.status(404).json({ error: 'No volume share data for this date' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[analytics/volume-share GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analytics/volume-share  — upsert volume share for a date
router.post('/volume-share', authMiddleware, async (req, res) => {
  try {
    const { plan_date, volume, total_routes } = req.body;
    if (!plan_date || !volume) return res.status(400).json({ error: 'plan_date and volume required' });
    const { rows } = await pool.query(
      `INSERT INTO dsp_volume_share (plan_date, volume, total_routes, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (plan_date) DO UPDATE SET
         volume       = EXCLUDED.volume,
         total_routes = EXCLUDED.total_routes,
         updated_at   = NOW()
       RETURNING *`,
      [plan_date, JSON.stringify(volume), total_routes || 0]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[analytics/volume-share POST]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Rescues ───────────────────────────────────────────────────────────────────

// GET /api/analytics/rescues?date=YYYY-MM-DD
router.get('/rescues', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date required' });
    const { rows } = await pool.query(
      `SELECT * FROM ops_rescues WHERE plan_date = $1 ORDER BY created_at`,
      [date]
    );
    res.json(rows);
  } catch (err) {
    console.error('[analytics/rescues GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analytics/rescues
router.post('/rescues', authMiddleware, async (req, res) => {
  try {
    const {
      plan_date, rescued_staff_id, rescued_name, rescued_route,
      rescuer_staff_id, rescuer_name, rescue_time, packages_rescued, reason, notes,
    } = req.body;
    if (!plan_date || !rescued_name || !rescuer_name)
      return res.status(400).json({ error: 'plan_date, rescued_name, and rescuer_name required' });
    const { rows } = await pool.query(
      `INSERT INTO ops_rescues
         (plan_date, rescued_staff_id, rescued_name, rescued_route,
          rescuer_staff_id, rescuer_name, rescue_time, packages_rescued, reason, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        plan_date,
        rescued_staff_id  || null,
        rescued_name,
        rescued_route     || null,
        rescuer_staff_id  || null,
        rescuer_name,
        rescue_time       || null,
        packages_rescued  || 0,
        reason            || null,
        notes             || null,
        req.user?.id      || null,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[analytics/rescues POST]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/analytics/rescues/:id
router.delete('/rescues/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query(`DELETE FROM ops_rescues WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[analytics/rescues DELETE]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Route Stats ───────────────────────────────────────────────────────────────

// GET /api/analytics/route-stats?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/route-stats', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end required' });
    const { rows } = await pool.query(
      `SELECT
         rescued_route                      AS route_code,
         COUNT(*)::int                      AS rescue_count,
         COUNT(DISTINCT plan_date)::int     AS days_rescued,
         SUM(packages_rescued)::int         AS total_packages_rescued
       FROM ops_rescues
       WHERE plan_date BETWEEN $1 AND $2
         AND rescued_route IS NOT NULL
       GROUP BY rescued_route
       ORDER BY rescue_count DESC`,
      [start, end]
    );
    res.json(rows);
  } catch (err) {
    console.error('[analytics/route-stats]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Driver Stats ──────────────────────────────────────────────────────────────

// GET /api/analytics/driver-stats?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/driver-stats', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end required' });

    const rescued = await pool.query(
      `SELECT rescued_name AS name, rescued_staff_id AS staff_id,
              COUNT(*)::int AS rescues_received,
              SUM(packages_rescued)::int AS packages_rescued
       FROM ops_rescues
       WHERE plan_date BETWEEN $1 AND $2
       GROUP BY rescued_name, rescued_staff_id`,
      [start, end]
    );

    const rescuer = await pool.query(
      `SELECT rescuer_name AS name, rescuer_staff_id AS staff_id,
              COUNT(*)::int AS rescues_given,
              SUM(packages_rescued)::int AS packages_assisted
       FROM ops_rescues
       WHERE plan_date BETWEEN $1 AND $2
       GROUP BY rescuer_name, rescuer_staff_id`,
      [start, end]
    );

    const map = {};
    for (const r of rescued.rows) {
      map[r.name] = {
        name: r.name, staff_id: r.staff_id,
        rescues_received: r.rescues_received,
        packages_rescued: r.packages_rescued || 0,
        rescues_given: 0,
        packages_assisted: 0,
      };
    }
    for (const r of rescuer.rows) {
      if (!map[r.name]) map[r.name] = { name: r.name, staff_id: r.staff_id, rescues_received: 0, packages_rescued: 0, rescues_given: 0, packages_assisted: 0 };
      map[r.name].rescues_given    = r.rescues_given;
      map[r.name].packages_assisted = r.packages_assisted || 0;
    }

    const result = Object.values(map).sort(
      (a, b) => (b.rescues_given + b.rescues_received) - (a.rescues_given + a.rescues_received)
    );
    res.json(result);
  } catch (err) {
    console.error('[analytics/driver-stats]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Route Profiles (difficulty scores, computed + manual overrides) ───────────

// GET /api/analytics/route-profiles
router.get('/route-profiles', async (req, res) => {
  try {
    // Aggregate rescues per route
    const rescues = await pool.query(`
      SELECT rescued_route        AS route_code,
             COUNT(*)::int        AS total_rescues,
             COUNT(DISTINCT plan_date)::int AS days_rescued,
             SUM(packages_rescued)::int     AS total_packages
      FROM ops_rescues
      WHERE rescued_route IS NOT NULL
      GROUP BY rescued_route
    `);

    // Aggregate assignments per route
    const asgns = await pool.query(`
      SELECT route_code,
             COUNT(*)::int AS total_assigned
      FROM ops_assignments
      WHERE route_code IS NOT NULL
      GROUP BY route_code
    `);

    // Manual overrides / notes
    const overrides = await pool.query(`SELECT route_code, notes, score_override FROM route_profiles`);
    const ovMap = {};
    for (const r of overrides.rows) ovMap[r.route_code] = r;

    // Build merged map
    const map = {};
    for (const r of rescues.rows) {
      map[r.route_code] = { route_code: r.route_code, total_rescues: r.total_rescues, days_rescued: r.days_rescued, total_packages: r.total_packages, total_assigned: 0 };
    }
    for (const a of asgns.rows) {
      if (!map[a.route_code]) map[a.route_code] = { route_code: a.route_code, total_rescues: 0, days_rescued: 0, total_packages: 0, total_assigned: 0 };
      map[a.route_code].total_assigned = a.total_assigned;
    }

    const result = Object.values(map).map(r => {
      const rate = r.total_assigned > 0 ? r.total_rescues / r.total_assigned : 0;
      let score = 1;
      if      (r.total_rescues >= 3)  score = 5;
      else if (r.total_rescues >= 2)  score = 4;
      else if (rate >= 0.15)          score = 3;
      else if (rate >= 0.05)          score = 2;
      const ov = ovMap[r.route_code];
      if (ov?.score_override) score = ov.score_override;
      return {
        route_code:          r.route_code,
        difficulty_score:    score,
        total_rescues:       r.total_rescues,
        days_rescued:        r.days_rescued,
        total_packages:      r.total_packages || 0,
        total_times_assigned: r.total_assigned,
        heavy_flag:          score >= 4,
        notes:               ov?.notes || null,
      };
    });

    result.sort((a, b) => b.difficulty_score - a.difficulty_score);
    res.json(result);
  } catch (err) {
    console.error('[analytics/route-profiles GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/analytics/route-profiles/:code  — update notes / manual score override
router.patch('/route-profiles/:code', authMiddleware, async (req, res) => {
  try {
    const { notes, score_override } = req.body;
    await pool.query(`
      INSERT INTO route_profiles (route_code, notes, score_override, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (route_code) DO UPDATE SET
        notes          = COALESCE(EXCLUDED.notes, route_profiles.notes),
        score_override = EXCLUDED.score_override,
        updated_at     = NOW()
    `, [req.params.code, notes ?? null, score_override ?? null]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Driver Workload ───────────────────────────────────────────────────────────

// GET /api/analytics/driver-workload?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/driver-workload', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end required' });

    // Pre-compute rescue counts per route for difficulty
    const rescueCounts = await pool.query(
      `SELECT rescued_route, COUNT(*)::int AS cnt FROM ops_rescues WHERE rescued_route IS NOT NULL GROUP BY rescued_route`
    );
    const rescueByRoute = {};
    for (const r of rescueCounts.rows) rescueByRoute[r.rescued_route] = r.cnt;

    // Manual score overrides
    const overrides = await pool.query(`SELECT route_code, score_override FROM route_profiles WHERE score_override IS NOT NULL`);
    const ovScore = {};
    for (const r of overrides.rows) ovScore[r.route_code] = r.score_override;

    // Assignments in range with driver info
    const asgns = await pool.query(`
      SELECT oa.plan_date, oa.route_code, oa.staff_id,
             oa.finish_time, oa.rts_time,
             s.first_name || ' ' || s.last_name AS driver_name
      FROM ops_assignments oa
      JOIN staff s ON s.id = oa.staff_id
      WHERE oa.plan_date BETWEEN $1 AND $2
        AND oa.route_code IS NOT NULL
      ORDER BY oa.plan_date
    `, [start, end]);

    const driverMap = {};
    for (const a of asgns.rows) {
      if (!driverMap[a.staff_id]) {
        driverMap[a.staff_id] = {
          staff_id: a.staff_id, name: a.driver_name,
          assignments: [], total_difficulty: 0,
        };
      }
      const rescues = rescueByRoute[a.route_code] || 0;
      let score = ovScore[a.route_code] || (rescues >= 3 ? 5 : rescues >= 2 ? 4 : rescues >= 1 ? 2 : 1);
      driverMap[a.staff_id].assignments.push({
        plan_date: a.plan_date, route_code: a.route_code,
        difficulty: score, rts_time: a.rts_time, finish_time: a.finish_time,
      });
      driverMap[a.staff_id].total_difficulty += score;
    }

    const result = Object.values(driverMap).map(d => ({
      staff_id:       d.staff_id,
      name:           d.name,
      days_assigned:  d.assignments.length,
      avg_difficulty: d.assignments.length > 0 ? +(d.total_difficulty / d.assignments.length).toFixed(2) : 0,
      assignments:    d.assignments,
    })).sort((a, b) => b.avg_difficulty - a.avg_difficulty);

    res.json(result);
  } catch (err) {
    console.error('[analytics/driver-workload]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Full Rescue Log (with filters) ───────────────────────────────────────────

// GET /api/analytics/rescue-log?start=&end=&driver=&route=&reason=
router.get('/rescue-log', async (req, res) => {
  try {
    const { start, end, driver, route, reason } = req.query;
    const where = []; const vals = [];
    if (start) { where.push(`plan_date >= $${vals.length+1}`); vals.push(start); }
    if (end)   { where.push(`plan_date <= $${vals.length+1}`); vals.push(end); }
    if (driver) { where.push(`(rescued_name ILIKE $${vals.length+1} OR rescuer_name ILIKE $${vals.length+1})`); vals.push(`%${driver}%`); }
    if (route)  { where.push(`rescued_route ILIKE $${vals.length+1}`); vals.push(`%${route}%`); }
    if (reason) { where.push(`reason = $${vals.length+1}`); vals.push(reason); }
    const sql = `SELECT * FROM ops_rescues ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY plan_date DESC, created_at DESC LIMIT 500`;
    const { rows } = await pool.query(sql, vals);
    res.json(rows);
  } catch (err) {
    console.error('[analytics/rescue-log]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
