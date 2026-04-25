const router = require('express').Router();
const pool   = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/route-targets?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end required' });
    const { rows } = await pool.query(
      `SELECT target_date, route_target, CEIL(route_target * 1.05)::int AS flex_up_target, notes
       FROM route_targets WHERE target_date BETWEEN $1 AND $2 ORDER BY target_date`,
      [start, end]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/route-targets — bulk upsert
router.post('/', adminOnly, async (req, res) => {
  try {
    const { targets } = req.body;
    if (!Array.isArray(targets)) return res.status(400).json({ error: 'targets array required' });
    for (const t of targets) {
      if (!t.date || !t.route_target) continue;
      await pool.query(`
        INSERT INTO route_targets (target_date, route_target, notes)
        VALUES ($1, $2, $3)
        ON CONFLICT (target_date) DO UPDATE SET
          route_target = EXCLUDED.route_target, notes = EXCLUDED.notes, updated_at = NOW()
      `, [t.date, t.route_target, t.notes || null]);
    }
    res.json({ success: true, saved: targets.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
