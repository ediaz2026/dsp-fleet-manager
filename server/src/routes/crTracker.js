const router = require('express').Router();
const pool   = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middleware/auth');

router.use(authMiddleware);

function fmtDate(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function getWeekRange(weekStr) {
  // weekStr = '2026-W16' or just '16' with year param
  const [yearStr, wStr] = weekStr.includes('-W') ? weekStr.split('-W') : [new Date().getFullYear().toString(), weekStr];
  const year = parseInt(yearStr), weekNum = parseInt(wStr);
  const jan4 = new Date(year, 0, 4);
  const w1Mon = new Date(jan4);
  w1Mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const mon = new Date(w1Mon);
  mon.setDate(w1Mon.getDate() + (weekNum - 1) * 7);
  const sun = new Date(mon); sun.setDate(mon.getDate() - 1);
  const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
  return { start: fmtDate(sun), end: fmtDate(sat), weekNum, year };
}

// GET /api/cr-tracker?week=2026-W16
router.get('/', async (req, res) => {
  try {
    const week = req.query.week || `${new Date().getFullYear()}-W${Math.ceil((new Date() - new Date(new Date().getFullYear(), 0, 1)) / 604800000)}`;
    const { start, end, weekNum, year } = getWeekRange(week);

    // Manual entries
    const { rows: manualRows } = await pool.query(
      `SELECT * FROM cr_tracker WHERE plan_date BETWEEN $1 AND $2 ORDER BY plan_date`, [start, end]
    );

    // Completed routes from dsp_volume_share (LSMD column)
    const { rows: volRows } = await pool.query(
      `SELECT plan_date, (volume->>'LSMD')::int AS completed_routes FROM dsp_volume_share WHERE plan_date BETWEEN $1 AND $2 ORDER BY plan_date`, [start, end]
    );

    // Final scheduled from shifts
    const { rows: schedRows } = await pool.query(`
      SELECT shift_date, COUNT(*)::int AS final_scheduled
      FROM shifts
      WHERE shift_date BETWEEN $1 AND $2
        AND shift_type IN ('EDV','STEP VAN','EXTRA','HELPER')
        AND publish_status = 'published'
      GROUP BY shift_date ORDER BY shift_date
    `, [start, end]);

    // Build days
    const days = [];
    const cur = new Date(start + 'T12:00:00');
    const endD = new Date(end + 'T12:00:00');
    while (cur <= endD) {
      const ds = fmtDate(cur);
      const manual = manualRows.find(r => fmtDate(r.plan_date) === ds) || {};
      const vol = volRows.find(r => fmtDate(r.plan_date) === ds);
      const sched = schedRows.find(r => fmtDate(r.shift_date) === ds);

      const routeTarget = manual.route_target || null;
      const flexUp = routeTarget ? Math.ceil(routeTarget * 1.05) : null;
      const availCap = manual.available_capacity || null;
      const completed = vol?.completed_routes || 0;
      const finalSched = sched?.final_scheduled || 0;
      const amazonCancels = manual.amazon_paid_cancels || 0;
      const dspDropped = manual.dsp_dropped_routes || 0;

      let reliabilityTarget = null;
      if (routeTarget) {
        if (completed > routeTarget) reliabilityTarget = flexUp;
        else if (finalSched < routeTarget && availCap && finalSched < availCap) reliabilityTarget = finalSched;
        else reliabilityTarget = routeTarget;
      }

      const denom = (reliabilityTarget || 0) + dspDropped;
      const crScore = denom > 0 ? parseFloat(((completed + amazonCancels) / denom).toFixed(4)) : null;

      days.push({
        date: ds, route_target: routeTarget, flex_up_target: flexUp,
        available_capacity: availCap, final_scheduled: finalSched,
        completed_routes: completed, amazon_paid_cancels: amazonCancels,
        dsp_dropped_routes: dspDropped, reliability_target: reliabilityTarget,
        cr_score: crScore, notes: manual.notes || null, has_manual_entry: !!manual.route_target,
      });
      cur.setDate(cur.getDate() + 1);
    }

    const totC = days.reduce((s, d) => s + d.completed_routes, 0);
    const totA = days.reduce((s, d) => s + d.amazon_paid_cancels, 0);
    const totD = days.reduce((s, d) => s + d.dsp_dropped_routes, 0);
    const totR = days.reduce((s, d) => s + (d.reliability_target || 0), 0);
    const weeklyCR = (totR + totD) > 0 ? parseFloat(((totC + totA) / (totR + totD)).toFixed(4)) : null;

    res.json({ week, startDate: start, endDate: end, weekNum, year, days, totals: { totalCompleted: totC, totalAmazonCancels: totA, totalDspDropped: totD, totalReliabilityTarget: totR, weeklyCR } });
  } catch (err) {
    console.error('[cr-tracker]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cr-tracker/:date — save manual entries
router.put('/:date', adminOnly, async (req, res) => {
  try {
    const { route_target, available_capacity, amazon_paid_cancels, dsp_dropped_routes, notes } = req.body;
    await pool.query(`
      INSERT INTO cr_tracker (plan_date, route_target, available_capacity, amazon_paid_cancels, dsp_dropped_routes, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (plan_date) DO UPDATE SET
        route_target = EXCLUDED.route_target, available_capacity = EXCLUDED.available_capacity,
        amazon_paid_cancels = EXCLUDED.amazon_paid_cancels, dsp_dropped_routes = EXCLUDED.dsp_dropped_routes,
        notes = EXCLUDED.notes, updated_at = NOW()
    `, [req.params.date, route_target || null, available_capacity || null, amazon_paid_cancels || 0, dsp_dropped_routes || 0, notes || null]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cr-tracker/trailing?weeks=12 — trailing weekly CR scores
router.get('/trailing', async (req, res) => {
  try {
    const numWeeks = parseInt(req.query.weeks) || 12;
    const results = [];
    const now = new Date();
    for (let i = numWeeks - 1; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i * 7);
      const wk = Math.ceil((d - new Date(d.getFullYear(), 0, 1)) / 604800000);
      const weekStr = `${d.getFullYear()}-W${wk}`;
      const { start, end, weekNum } = getWeekRange(weekStr);

      const { rows: manualRows } = await pool.query(`SELECT * FROM cr_tracker WHERE plan_date BETWEEN $1 AND $2`, [start, end]);
      const { rows: volRows } = await pool.query(`SELECT plan_date, (volume->>'LSMD')::int AS completed FROM dsp_volume_share WHERE plan_date BETWEEN $1 AND $2`, [start, end]);

      let totC = 0, totR = 0, totA = 0, totD = 0;
      const cur = new Date(start + 'T12:00:00'); const endD = new Date(end + 'T12:00:00');
      while (cur <= endD) {
        const ds = fmtDate(cur);
        const m = manualRows.find(r => fmtDate(r.plan_date) === ds) || {};
        const v = volRows.find(r => fmtDate(r.plan_date) === ds);
        const rt = m.route_target || 0;
        const completed = v?.completed || 0;
        const flexUp = rt ? Math.ceil(rt * 1.05) : 0;
        const relTarget = rt ? (completed > rt ? flexUp : rt) : 0;
        totC += completed; totR += relTarget;
        totA += (m.amazon_paid_cancels || 0); totD += (m.dsp_dropped_routes || 0);
        cur.setDate(cur.getDate() + 1);
      }
      const cr = (totR + totD) > 0 ? parseFloat(((totC + totA) / (totR + totD)).toFixed(4)) : null;
      results.push({ week: weekStr, weekNum, cr, completed: totC, target: totR });
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
