const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');
const cloudinary = require('../config/cloudinary');

router.use(authMiddleware);

// Ensure photo_urls column exists
pool.query(`ALTER TABLE driver_reports ADD COLUMN IF NOT EXISTS photo_urls TEXT[] DEFAULT '{}'`).catch(() => {});

const SELECT_FULL = `
  SELECT
    dr.*,
    v.vehicle_name,
    v.vin,
    s.first_name || ' ' || s.last_name AS driver_name,
    s.employee_id AS driver_employee_id,
    rv.first_name || ' ' || rv.last_name AS reviewed_by_name
  FROM driver_reports dr
  JOIN vehicles v ON v.id = dr.vehicle_id
  JOIN staff s ON s.id = dr.driver_id
  LEFT JOIN staff rv ON rv.id = dr.reviewed_by
`;

// ─── GET /api/driver-reports ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    let q = SELECT_FULL + ' WHERE 1=1';
    const params = [];
    if (status) { params.push(status); q += ` AND dr.status = $${params.length}`; }
    q += ' ORDER BY dr.created_at DESC';
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/driver-reports/count ───────────────────────────────────────────
router.get('/count', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count FROM driver_reports WHERE status = 'pending'`
    );
    res.json({ count: parseInt(rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/driver-reports ─────────────────────────────────────────────────
// Any authenticated user (driver or manager) can submit a report
router.post('/', async (req, res) => {
  try {
    const { vehicle_id, description, photo_urls } = req.body;
    if (!vehicle_id || !description) {
      return res.status(400).json({ error: 'vehicle_id and description are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO driver_reports (vehicle_id, driver_id, description, photo_urls)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [vehicle_id, req.user.id, description, photo_urls || []]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/driver-reports/upload-photo ────────────────────────────────────
router.post('/upload-photo', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'image required' });
    const result = await cloudinary.uploader.upload(image, {
      folder: 'dsp_repairs',
    });
    res.json({ url: result.secure_url });
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    res.status(500).json({ error: 'Photo upload failed' });
  }
});

// ─── PUT /api/driver-reports/:id/convert ─────────────────────────────────────
// Convert a driver report into a formal repair record
router.put('/:id/convert', managerOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    // Fetch the driver report
    const { rows: drRows } = await client.query(
      `SELECT * FROM driver_reports WHERE id = $1`,
      [req.params.id]
    );
    if (!drRows[0]) return res.status(404).json({ error: 'Not found' });
    const dr = drRows[0];

    const {
      van_status = 'active', amazon_status = 'active',
      priority = 'low', scheduled_date, vendor,
    } = req.body;

    await client.query('BEGIN');

    // Create repair record
    const { rows: repairRows } = await client.query(
      `INSERT INTO repairs
        (vehicle_id, van_status, amazon_status, priority, description, scheduled_date, vendor, reported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [dr.vehicle_id, van_status, amazon_status, priority, dr.description,
       scheduled_date || null, vendor || null, req.user.id]
    );
    const repair = repairRows[0];

    // Mark driver report as converted
    await client.query(
      `UPDATE driver_reports SET
         status='converted', converted_to_repair_id=$1,
         reviewed_at=NOW(), reviewed_by=$2
       WHERE id=$3`,
      [repair.id, req.user.id, req.params.id]
    );

    // Sync vehicle status if inactive
    if (van_status === 'inactive') {
      await client.query(
        `UPDATE vehicles SET status='maintenance', updated_at=NOW() WHERE id=$1`,
        [dr.vehicle_id]
      );
    }

    await client.query('COMMIT');
    res.json({ repair, message: 'Converted to repair' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── PUT /api/driver-reports/:id/dismiss ─────────────────────────────────────
router.put('/:id/dismiss', managerOnly, async (req, res) => {
  try {
    const { dismiss_note = '' } = req.body;
    const { rows } = await pool.query(
      `UPDATE driver_reports SET
         status='dismissed', dismiss_note=$1,
         reviewed_at=NOW(), reviewed_by=$2
       WHERE id=$3 RETURNING *`,
      [dismiss_note, req.user.id, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
