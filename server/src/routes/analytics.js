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

// ── Driver Workload helpers ──────────────────────────────────────────────────
function fmtDate(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// GET /api/analytics/driver-workload — reads from driver_daily_workload table
// Supports ?range=weekly (7 days) or ?range=biweekly (14 days, default).
router.get('/driver-workload', async (req, res) => {
  try {
    const rangeDays = req.query.range === 'weekly' ? 7 : 14;
    const todayRow = await pool.query(`SELECT (NOW() AT TIME ZONE 'America/New_York')::date AS d`);
    const today = fmtDate(todayRow.rows[0].d);
    const yesterday = fmtDate(new Date(new Date(today + 'T12:00:00').getTime() - 86400000));
    const start = req.query.start || fmtDate(new Date(new Date(yesterday + 'T12:00:00').getTime() - (rangeDays - 1) * 86400000));
    const end   = req.query.end   || yesterday;

    const dateRange = [];
    for (let d = new Date(start + 'T12:00:00'); d <= new Date(end + 'T12:00:00'); d.setDate(d.getDate() + 1)) {
      dateRange.push(fmtDate(d));
    }

    // Read snapshots from driver_daily_workload
    const { rows: snapshots } = await pool.query(`
      SELECT work_date, staff_id, driver_name, route_code, shift_type,
             wave_time, duration_minutes, eft_time, eft_color
      FROM driver_daily_workload
      WHERE work_date BETWEEN $1 AND $2
      ORDER BY work_date
    `, [start, end]);

    // Build per-driver grid
    const driverMap = {};
    for (const s of snapshots) {
      const dateKey = fmtDate(s.work_date);
      if (!driverMap[s.staff_id]) {
        driverMap[s.staff_id] = { staff_id: s.staff_id, name: s.driver_name, days: {} };
      }
      driverMap[s.staff_id].days[dateKey] = {
        color: s.eft_color || 'none',
        eft: s.eft_time,
        route: s.route_code || '—',
        duration: s.duration_minutes || 0,
        wave: s.wave_time,
      };
    }

    // Compute summaries and sort
    const drivers = Object.values(driverMap).map(d => {
      const summary = { green: 0, orange: 0, yellow: 0, red: 0, none: 0 };
      for (const dateKey of dateRange) {
        const day = d.days[dateKey];
        if (day) summary[day.color] = (summary[day.color] || 0) + 1;
      }
      return { ...d, summary };
    }).sort((a, b) => {
      const aColored = a.summary.green + a.summary.orange + a.summary.yellow + a.summary.red;
      const bColored = b.summary.green + b.summary.orange + b.summary.yellow + b.summary.red;
      if (bColored !== aColored) return bColored - aColored;
      if (b.summary.red !== a.summary.red) return b.summary.red - a.summary.red;
      return b.summary.yellow - a.summary.yellow;
    });

    res.json({ dateRange, drivers });
  } catch (err) {
    console.error('[analytics/driver-workload]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── TEMP DIAGNOSTIC — remove after use ──────────────────────────────────────
router.get('/diag-recurring', async (req, res) => {
  try {
    const q1 = await pool.query(`
      SELECT drs.*, s.first_name, s.last_name
      FROM driver_recurring_shifts drs
      JOIN staff s ON s.id = drs.staff_id
      WHERE LOWER(s.first_name) IN ('mario', 'manel', 'fernando')
      ORDER BY s.first_name, drs.id
    `);
    const q2 = await pool.query(`
      SELECT sh.shift_date::text, sh.shift_type, sh.start_time, sh.end_time,
             sh.status, sh.publish_status, s.first_name, s.last_name
      FROM shifts sh
      JOIN staff s ON s.id = sh.staff_id
      WHERE LOWER(s.first_name) IN ('mario', 'manel', 'fernando')
        AND sh.shift_date >= '2026-04-13'
      ORDER BY s.first_name, sh.shift_date
    `);
    const q3 = await pool.query(`
      SELECT drs.shift_type, COUNT(*)::int AS cnt
      FROM driver_recurring_shifts drs
      GROUP BY drs.shift_type
      ORDER BY cnt DESC
    `);
    res.json({
      recurring_rows: q1.rows,
      upcoming_shifts: q2.rows,
      shift_type_distribution: q3.rows,
    });
  } catch (err) {
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

// ── Daily Routes Summary ─────────────────────────────────────────────────────

// GET /api/analytics/daily-routes-summary?week_start=YYYY-MM-DD&station=DMF5
router.get('/daily-routes-summary', async (req, res) => {
  try {
    const { week_start, station = 'DMF5' } = req.query;
    if (!week_start) return res.status(400).json({ error: 'week_start required' });

    const wsDate = new Date(week_start + 'T12:00:00Z');
    const weDate = new Date(wsDate);
    weDate.setDate(wsDate.getDate() + 6);
    const weekEnd = weDate.toISOString().split('T')[0];

    // Run all queries in parallel
    const [asgnRes, routesRes, pickRes, manualRes] = await Promise.all([
      // Scheduled drivers, helpers, extras from ops_assignments
      pool.query(`
        SELECT plan_date,
          COUNT(*) FILTER (WHERE removed_from_ops IS NOT TRUE
            AND COALESCE(shift_type,'') NOT IN ('ON CALL','UTO','PTO','SUSPENSION','TRAINING','TRAINER','DISPATCH AM','DISPATCH PM','HELPER','EXTRA')) as scheduled_d,
          COUNT(*) FILTER (WHERE removed_from_ops IS NOT TRUE AND shift_type = 'HELPER') as helpers_h,
          COUNT(*) FILTER (WHERE removed_from_ops IS NOT TRUE AND shift_type = 'EXTRA') as extras_v
        FROM ops_assignments
        WHERE plan_date BETWEEN $1 AND $2
        GROUP BY plan_date
      `, [week_start, weekEnd]),

      // Route type breakdown from Amazon routes JSONB
      pool.query(`
        SELECT plan_date,
          COUNT(*) FILTER (WHERE route->>'routeCode' NOT LIKE 'AT%'
            AND route->>'routeCode' NOT LIKE 'AX%'
            AND route->>'routeCode' NOT LIKE 'AV%'
            AND route->>'routeCode' NOT LIKE 'HZA%') as cortex_no_flex_e,
          COUNT(*) FILTER (WHERE route->>'routeCode' LIKE 'AT%'
            OR route->>'routeCode' LIKE 'AX%'
            OR route->>'routeCode' LIKE 'AV%') as flex_f,
          COUNT(*) FILTER (WHERE route->>'routeCode' LIKE 'HZA%') as hza_g
        FROM ops_daily_routes, jsonb_array_elements(routes) as route
        WHERE plan_date BETWEEN $1 AND $2
        GROUP BY plan_date
      `, [week_start, weekEnd]),

      // Total packages from pick list
      pool.query(`
        SELECT date as plan_date, SUM(total_packages)::int as total_packages_t
        FROM pick_list_data
        WHERE date BETWEEN $1 AND $2
        GROUP BY date
      `, [week_start, weekEnd]),

      // Manual inputs
      pool.query(`
        SELECT * FROM daily_routes_manual
        WHERE plan_date BETWEEN $1 AND $2 AND station = $3
      `, [week_start, weekEnd, station]),
    ]);

    // Index results by date string
    const byDate = (rows, key = 'plan_date') => {
      const m = {};
      rows.forEach(r => {
        const d = r[key] instanceof Date ? r[key].toISOString().split('T')[0] : String(r[key]).split('T')[0];
        m[d] = r;
      });
      return m;
    };

    const asgnMap = byDate(asgnRes.rows);
    const routesMap = byDate(routesRes.rows);
    const pickMap = byDate(pickRes.rows);
    const manualMap = byDate(manualRes.rows);

    // Build 7 day objects
    const days = [];
    const weeklyTotals = {
      scheduled_d: 0, helpers_h: 0, extras_v: 0,
      cortex_no_flex_e: 0, flex_f: 0, hza_g: 0,
      cx_routes_i: 0, routes_dispatched_k: 0,
      okami_l: 0, amazon_canceled_m: 0,
      total_dispatched_n: 0, scheduled_vs_total_o: 0, routes_owed_p: 0,
      wst_completed_q: 0, wst_cancelled_r: 0, routes_to_dispute_s: 0,
      total_packages_t: 0, spr_u: null,
      training_day: 0, ero_count: 0,
    };

    for (let i = 0; i < 7; i++) {
      const dt = new Date(wsDate);
      dt.setDate(wsDate.getDate() + i);
      const dateStr = dt.toISOString().split('T')[0];

      const a = asgnMap[dateStr] || {};
      const r = routesMap[dateStr] || {};
      const p = pickMap[dateStr] || {};
      const m = manualMap[dateStr] || {};

      const D = parseInt(a.scheduled_d) || 0;
      const H = parseInt(a.helpers_h) || 0;
      const V = parseInt(a.extras_v) || 0;
      const E = parseInt(r.cortex_no_flex_e) || 0;
      const F = parseInt(r.flex_f) || 0;
      const G = parseInt(r.hza_g) || 0;
      const L = parseInt(m.okami_count) || 0;
      const M = parseInt(m.amazon_canceled) || 0;
      const Q = parseInt(m.wst_completed) || 0;
      const R = parseInt(m.wst_cancelled) || 0;
      const pkgOverride = m.total_packages_override != null ? parseInt(m.total_packages_override) : null;
      const T = pkgOverride != null ? pkgOverride : (parseInt(p.total_packages_t) || 0);
      const training = parseInt(m.training_day) || 0;
      const ero = parseInt(m.ero_count) || 0;

      // Formula columns
      const I = E - F - G;               // cx_routes
      const K = E + F;                   // routes_dispatched
      const N = K + L + H;               // total_dispatched
      const O = N - D;                   // scheduled_vs_total
      const P = N - H + M;               // routes_owed
      const S = -Q - R + P;              // routes_to_dispute
      const U = P > 0 ? +(T / P).toFixed(1) : null;  // spr

      const day = {
        date: dateStr,
        day_of_week: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getUTCDay()],
        // Auto data
        scheduled_d: D, helpers_h: H, extras_v: V,
        cortex_no_flex_e: E, flex_f: F, hza_g: G,
        total_packages_t: T,
        // Manual data
        okami_l: L, amazon_canceled_m: M,
        wst_completed_q: Q, wst_cancelled_r: R,
        training_day: training, ero_count: ero,
        // Formulas
        cx_routes_i: I, routes_dispatched_k: K,
        total_dispatched_n: N, scheduled_vs_total_o: O,
        routes_owed_p: P, routes_to_dispute_s: S,
        spr_u: U,
      };
      days.push(day);

      // Accumulate weekly totals
      for (const key of Object.keys(weeklyTotals)) {
        if (key === 'spr_u') continue;
        weeklyTotals[key] += day[key] || 0;
      }
    }

    // Weekly SPR
    weeklyTotals.spr_u = weeklyTotals.routes_owed_p > 0
      ? +(weeklyTotals.total_packages_t / weeklyTotals.routes_owed_p).toFixed(1)
      : null;

    res.json({ week_start, station, days, weeklyTotals });
  } catch (err) {
    console.error('[analytics/daily-routes-summary]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/analytics/daily-routes-summary/:date
router.put('/daily-routes-summary/:date', authMiddleware, async (req, res) => {
  try {
    const { date } = req.params;
    const { station = 'DMF5', okami_count, ero_count, amazon_canceled, training_day, wst_completed, wst_cancelled, total_packages_override } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO daily_routes_manual (plan_date, station, okami_count, ero_count, amazon_canceled, training_day, wst_completed, wst_cancelled, total_packages_override, created_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (plan_date, station) DO UPDATE SET
        okami_count = EXCLUDED.okami_count,
        ero_count = EXCLUDED.ero_count,
        amazon_canceled = EXCLUDED.amazon_canceled,
        training_day = EXCLUDED.training_day,
        wst_completed = EXCLUDED.wst_completed,
        wst_cancelled = EXCLUDED.wst_cancelled,
        total_packages_override = EXCLUDED.total_packages_override,
        updated_at = NOW()
      RETURNING *
    `, [date, station,
        okami_count || 0, ero_count || 0, amazon_canceled || 0,
        training_day || 0, wst_completed || 0, wst_cancelled || 0,
        total_packages_override != null ? total_packages_override : null,
        req.user?.id || null]);

    res.json(rows[0]);
  } catch (err) {
    console.error('[analytics/daily-routes-manual]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
