const router = require('express').Router();
const pool   = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/scorecard/available-weeks  — weeks that have any scorecard data
router.get('/available-weeks', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT week_start FROM driver_scorecards ORDER BY week_start DESC LIMIT 52`
    );
    res.json(rows.map(r => String(r.week_start).slice(0, 10)));
  } catch (err) {
    console.error('[scorecard/available-weeks]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scorecard/summary?week_start=YYYY-MM-DD  — dashboard widget
router.get('/summary', async (req, res) => {
  try {
    const { week_start } = req.query;
    if (!week_start) return res.status(400).json({ error: 'week_start required' });

    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE week_score >= 85)::int            AS green_count,
        COUNT(*) FILTER (WHERE week_score >= 70 AND week_score < 85)::int AS yellow_count,
        COUNT(*) FILTER (WHERE week_score < 70)::int             AS red_count,
        COUNT(*) FILTER (WHERE week_score IS NOT NULL)::int      AS total_with_data,
        ROUND(AVG(dcr)::numeric, 1)                              AS avg_dcr,
        ROUND(AVG(pod)::numeric, 1)                              AS avg_pod,
        ROUND(AVG(week_score)::numeric, 1)                       AS avg_week_score
      FROM driver_scorecards
      WHERE week_start = $1
    `, [week_start]);

    const atRisk = await pool.query(`
      SELECT s.first_name || ' ' || s.last_name AS name,
             sc.week_score, sc.dcr, sc.pod
      FROM driver_scorecards sc
      JOIN staff s ON s.id = sc.staff_id
      WHERE sc.week_start = $1 AND sc.week_score IS NOT NULL
      ORDER BY sc.week_score ASC
      LIMIT 3
    `, [week_start]);

    res.json({ ...(rows[0] || {}), at_risk: atRisk.rows });
  } catch (err) {
    console.error('[scorecard/summary]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scorecard/history/:staff_id?weeks=12
router.get('/history/:staff_id', async (req, res) => {
  try {
    const weeks = Math.min(parseInt(req.query.weeks) || 12, 52);
    const { rows } = await pool.query(`
      SELECT week_start, dcr, pod, cc, ce, dnr, ssd, week_score, notes
      FROM driver_scorecards
      WHERE staff_id = $1
      ORDER BY week_start DESC
      LIMIT $2
    `, [req.params.staff_id, weeks]);
    res.json(rows);
  } catch (err) {
    console.error('[scorecard/history]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scorecard?week_start=YYYY-MM-DD  — all drivers for a week (managers); own record (drivers)
router.get('/', async (req, res) => {
  try {
    const { week_start } = req.query;
    if (!week_start) return res.status(400).json({ error: 'week_start required' });

    // Drivers see only their own scorecard row
    if (req.user.role === 'driver') {
      const { rows } = await pool.query(`
        SELECT s.id AS staff_id,
               s.first_name, s.last_name,
               sc.id AS scorecard_id,
               sc.dcr, sc.pod, sc.cc, sc.ce, sc.dnr, sc.ssd,
               sc.week_score, sc.notes, sc.updated_at
        FROM staff s
        LEFT JOIN driver_scorecards sc ON sc.staff_id = s.id AND sc.week_start = $1
        WHERE s.id = $2
      `, [week_start, req.user.id]);
      return res.json(rows);
    }

    const { rows } = await pool.query(`
      SELECT s.id AS staff_id,
             s.first_name, s.last_name,
             sc.id          AS scorecard_id,
             sc.dcr, sc.pod, sc.cc, sc.ce, sc.dnr, sc.ssd,
             sc.week_score, sc.notes,
             sc.updated_at
      FROM staff s
      LEFT JOIN driver_scorecards sc
             ON sc.staff_id = s.id AND sc.week_start = $1
      WHERE s.role = 'driver' AND s.status = 'active'
      ORDER BY s.last_name, s.first_name
    `, [week_start]);

    res.json(rows);
  } catch (err) {
    console.error('[scorecard GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/scorecard  — upsert one driver's entry for a week
router.put('/', authMiddleware, async (req, res) => {
  try {
    const { staff_id, week_start, dcr, pod, cc, ce, dnr, ssd, week_score, notes } = req.body;
    if (!staff_id || !week_start) return res.status(400).json({ error: 'staff_id and week_start required' });

    const { rows } = await pool.query(`
      INSERT INTO driver_scorecards
        (staff_id, week_start, dcr, pod, cc, ce, dnr, ssd, week_score, notes, created_by, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      ON CONFLICT (staff_id, week_start) DO UPDATE SET
        dcr        = EXCLUDED.dcr,
        pod        = EXCLUDED.pod,
        cc         = EXCLUDED.cc,
        ce         = EXCLUDED.ce,
        dnr        = EXCLUDED.dnr,
        ssd        = EXCLUDED.ssd,
        week_score = EXCLUDED.week_score,
        notes      = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING *
    `, [
      staff_id, week_start,
      dcr  ?? null, pod ?? null, cc ?? null,
      ce   ?? null, dnr ?? null, ssd ?? null,
      week_score ?? null, notes ?? null,
      req.user?.id || null,
    ]);

    res.json(rows[0]);
  } catch (err) {
    console.error('[scorecard PUT]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
