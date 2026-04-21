const router = require('express').Router();
const pool   = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/raffle/leaderboard?period=2026-04
router.get('/leaderboard', async (req, res) => {
  const period = req.query.period || new Date().toISOString().slice(0, 7);
  try {
    const { rows } = await pool.query(`
      SELECT
        rt.staff_id,
        s.first_name || ' ' || s.last_name AS driver_name,
        SUM(rt.tickets_earned)::int AS total_tickets,
        COUNT(rt.rescue_id)::int AS rescues_given,
        SUM(r.packages_rescued)::int AS packages_rescued,
        RANK() OVER (ORDER BY SUM(rt.tickets_earned) DESC) AS rank
      FROM raffle_tickets rt
      JOIN staff s ON s.id = rt.staff_id
      JOIN ops_rescues r ON r.id = rt.rescue_id
      WHERE rt.period = $1
      GROUP BY rt.staff_id, s.first_name, s.last_name
      ORDER BY total_tickets DESC
    `, [period]);
    res.json({
      period,
      leaderboard: rows,
      totalTickets: rows.reduce((sum, r) => sum + parseInt(r.total_tickets), 0),
      totalParticipants: rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/raffle/my-tickets — driver sees own stats
router.get('/my-tickets', async (req, res) => {
  const period = new Date().toISOString().slice(0, 7);
  const staffId = req.user.id;
  try {
    const tq = await pool.query(`
      SELECT SUM(rt.tickets_earned)::int AS my_tickets,
             COUNT(rt.rescue_id)::int AS my_rescues,
             SUM(r.packages_rescued)::int AS my_packages
      FROM raffle_tickets rt
      JOIN ops_rescues r ON r.id = rt.rescue_id
      WHERE rt.staff_id = $1 AND rt.period = $2
    `, [staffId, period]);

    const rq = await pool.query(`
      SELECT rank::int FROM (
        SELECT staff_id, RANK() OVER (ORDER BY SUM(tickets_earned) DESC) AS rank
        FROM raffle_tickets WHERE period = $1
        GROUP BY staff_id
      ) ranks WHERE staff_id = $2
    `, [period, staffId]);

    const totals = await pool.query(`
      SELECT COUNT(DISTINCT staff_id)::int AS total_drivers,
             SUM(tickets_earned)::int AS total_tickets
      FROM raffle_tickets WHERE period = $1
    `, [period]);

    // Also fetch rescues given this month (for "Rescues I've Given" display)
    const rescuesGiven = await pool.query(`
      SELECT id, plan_date, rescued_name, rescued_route,
             packages_rescued, reason, rescue_time
      FROM ops_rescues
      WHERE rescuer_staff_id = $1
        AND plan_date >= date_trunc('month', CURRENT_DATE)
        AND plan_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
      ORDER BY plan_date DESC, rescue_time DESC
    `, [staffId]);

    res.json({
      period,
      staffId,
      myTickets: parseInt(tq.rows[0]?.my_tickets) || 0,
      myRescues: parseInt(tq.rows[0]?.my_rescues) || 0,
      myPackages: parseInt(tq.rows[0]?.my_packages) || 0,
      myRank: parseInt(rq.rows[0]?.rank) || null,
      totalDrivers: parseInt(totals.rows[0]?.total_drivers) || 0,
      totalTickets: parseInt(totals.rows[0]?.total_tickets) || 0,
      rescuesGiven: rescuesGiven.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/raffle/winner?period=2026-04
router.get('/winner', async (req, res) => {
  const period = req.query.period || new Date().toISOString().slice(0, 7);
  try {
    const { rows } = await pool.query(
      `SELECT * FROM raffle_draws WHERE period = $1 ORDER BY drawn_at DESC LIMIT 1`, [period]
    );
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/raffle/draw — admin only
router.post('/draw', adminOnly, async (req, res) => {
  const { period, notes } = req.body;
  if (!period) return res.status(400).json({ error: 'period required' });
  try {
    const { rows } = await pool.query(`
      SELECT staff_id, SUM(tickets_earned)::int AS tickets
      FROM raffle_tickets WHERE period = $1
      GROUP BY staff_id
    `, [period]);
    if (!rows.length) return res.status(400).json({ error: 'No tickets for this period' });

    const pool_ = [];
    rows.forEach(r => { for (let i = 0; i < r.tickets; i++) pool_.push(r.staff_id); });
    const winnerStaffId = pool_[Math.floor(Math.random() * pool_.length)];
    const winnerRow = rows.find(r => r.staff_id === winnerStaffId);

    const staffRes = await pool.query(
      `SELECT first_name || ' ' || last_name AS name FROM staff WHERE id = $1`, [winnerStaffId]
    );

    await pool.query(`
      INSERT INTO raffle_draws (period, winner_staff_id, winner_name, winner_tickets, total_participants, drawn_by, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [period, winnerStaffId, staffRes.rows[0].name, winnerRow.tickets, rows.length, req.user.id, notes || null]);

    res.json({
      winner: { staff_id: winnerStaffId, name: staffRes.rows[0].name, tickets: winnerRow.tickets },
      period, totalParticipants: rows.length, totalTickets: pool_.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/raffle/backfill — one-time seed from existing rescues
router.post('/backfill', async (req, res) => {
  try {
    const { rows: rescues } = await pool.query(`
      SELECT id, rescuer_staff_id, packages_rescued, plan_date
      FROM ops_rescues
      WHERE rescuer_staff_id IS NOT NULL AND packages_rescued >= 10
    `);
    let inserted = 0;
    for (const r of rescues) {
      const period = r.plan_date.toISOString().slice(0, 7);
      const tickets = Math.floor(r.packages_rescued / 10);
      const res2 = await pool.query(`
        INSERT INTO raffle_tickets (staff_id, period, rescue_id, tickets_earned)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (staff_id, rescue_id) DO NOTHING
      `, [r.rescuer_staff_id, period, r.id, tickets]);
      inserted += res2.rowCount;
    }
    res.json({ eligible: rescues.length, inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
