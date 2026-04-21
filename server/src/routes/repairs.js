const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');

router.use(authMiddleware);

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Sync vehicles table when the fleet tracker changes a vehicle's status.
// repairs table uses: van_status = 'active'|'inactive', amazon_status = 'active'|'grounded'
// vehicles table uses: van_status = 'Active'|'Out of Service', amazon_status = 'Active'|'Grounded'
async function syncVehicleStatus(client, vehicleId, vanStatus, amazonStatus) {
  const newVanStatus    = vanStatus    === 'inactive' ? 'Out of Service' : 'Active';
  const newAmazonStatus = amazonStatus === 'grounded' ? 'Grounded'       : 'Active';
  await client.query(
    `UPDATE vehicles SET van_status = $1, amazon_status = $2, updated_at = NOW() WHERE id = $3`,
    [newVanStatus, newAmazonStatus, vehicleId]
  );
}

// ─── GET /api/repairs ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, priority, vehicle_id } = req.query;
    let q = `
      SELECT r.*,
             v.vehicle_name, v.vin,
             s.first_name || ' ' || s.last_name AS reported_by_name
      FROM repairs r
      JOIN vehicles v ON v.id = r.vehicle_id
      LEFT JOIN staff s ON s.id = r.reported_by
      WHERE 1=1
    `;
    const params = [];
    if (status)     { params.push(status);     q += ` AND r.status = $${params.length}`; }
    if (priority)   { params.push(priority);   q += ` AND r.priority = $${params.length}`; }
    if (vehicle_id) { params.push(vehicle_id); q += ` AND r.vehicle_id = $${params.length}`; }
    q += ` ORDER BY
      CASE r.priority WHEN 'severe' THEN 1 ELSE 2 END,
      r.created_at DESC`;
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/repairs/stats ───────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open')                                 AS open_total,
        COUNT(*) FILTER (WHERE status = 'open' AND priority = 'severe')        AS open_severe,
        COUNT(*) FILTER (WHERE status = 'open' AND priority = 'medium')        AS open_medium,
        COUNT(*) FILTER (WHERE status = 'open' AND priority = 'low')           AS open_low,
        COUNT(*) FILTER (WHERE status = 'completed')                           AS completed_total
      FROM repairs
    `);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/repairs ────────────────────────────────────────────────────────
router.post('/', managerOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      vehicle_id, van_status = 'active', amazon_status = 'active',
      priority = 'low', description, scheduled_date, vendor,
    } = req.body;

    if (!vehicle_id || !description) {
      return res.status(400).json({ error: 'vehicle_id and description are required' });
    }

    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO repairs
        (vehicle_id, van_status, amazon_status, priority, description, scheduled_date, vendor, reported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [vehicle_id, van_status, amazon_status, priority, description,
       scheduled_date || null, vendor || null, req.user.id]
    );

    // Sync vehicle status to vehicles table
    if (van_status === 'inactive' || amazon_status === 'grounded') {
      await syncVehicleStatus(client, vehicle_id, van_status, amazon_status);
    }

    await client.query('COMMIT');

    // Return with vehicle name joined
    const full = await pool.query(
      `SELECT r.*, v.vehicle_name, v.vin,
              s.first_name || ' ' || s.last_name AS reported_by_name
       FROM repairs r
       JOIN vehicles v ON v.id = r.vehicle_id
       LEFT JOIN staff s ON s.id = r.reported_by
       WHERE r.id = $1`,
      [rows[0].id]
    );
    res.status(201).json(full.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── PUT /api/repairs/:id ─────────────────────────────────────────────────────
router.put('/:id', managerOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      vehicle_id, van_status, amazon_status, priority,
      description, scheduled_date, vendor,
    } = req.body;

    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE repairs SET
         vehicle_id=$1, van_status=$2, amazon_status=$3, priority=$4,
         description=$5, scheduled_date=$6, vendor=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [vehicle_id, van_status, amazon_status, priority, description,
       scheduled_date || null, vendor || null, req.params.id]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }

    // Sync vehicle status to vehicles table
    await syncVehicleStatus(client, vehicle_id, van_status, amazon_status);

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── PUT /api/repairs/:id/complete ───────────────────────────────────────────
router.put('/:id/complete', managerOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE repairs SET status='completed', completed_at=NOW(), completed_by=$1, updated_at=NOW()
       WHERE id=$2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }

    // Completing a repair → return vehicle to active status
    if (rows[0].van_status === 'inactive' || rows[0].amazon_status === 'grounded') {
      await syncVehicleStatus(client, rows[0].vehicle_id, 'active', 'active');
    }

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── DELETE /api/repairs/:id ──────────────────────────────────────────────────
router.delete('/:id', managerOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM repairs WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
