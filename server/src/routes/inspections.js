const router = require('express').Router();
const pool = require('../db/pool');
const { photoUpload } = require('../middleware/upload');
const { analyzeVehicleDamage } = require('../services/aiAnalysis');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/inspections
router.get('/', async (req, res) => {
  const { vehicle_id, driver_id, status, ai_status, limit = 50 } = req.query;
  let q = `
    SELECT i.*, v.vehicle_name, v.license_plate,
           s.first_name as driver_first, s.last_name as driver_last,
           COUNT(ip.id) as photo_count
    FROM inspections i
    JOIN vehicles v ON v.id = i.vehicle_id
    LEFT JOIN staff s ON s.id = i.driver_id
    LEFT JOIN inspection_photos ip ON ip.inspection_id = i.id
    WHERE 1=1`;
  const params = [];
  if (vehicle_id) { params.push(vehicle_id); q += ` AND i.vehicle_id = $${params.length}`; }
  if (driver_id) { params.push(driver_id); q += ` AND i.driver_id = $${params.length}`; }
  if (status) { params.push(status); q += ` AND i.status = $${params.length}`; }
  if (ai_status) { params.push(ai_status); q += ` AND i.ai_analysis_status = $${params.length}`; }
  q += ` GROUP BY i.id, v.vehicle_name, v.license_plate, s.first_name, s.last_name ORDER BY i.inspection_date DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

// GET /api/inspections/flagged
router.get('/flagged', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.*, v.vehicle_name, v.license_plate,
            s.first_name as driver_first, s.last_name as driver_last
     FROM inspections i
     JOIN vehicles v ON v.id = i.vehicle_id
     LEFT JOIN staff s ON s.id = i.driver_id
     WHERE i.ai_analysis_status = 'flagged' OR i.damage_detected = true
     ORDER BY i.inspection_date DESC`
  );
  res.json(rows);
});

// GET /api/inspections/:id
router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.*, v.vehicle_name, v.license_plate, s.first_name as driver_first, s.last_name as driver_last
     FROM inspections i
     JOIN vehicles v ON v.id = i.vehicle_id
     LEFT JOIN staff s ON s.id = i.driver_id
     WHERE i.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Inspection not found' });

  const photos = await pool.query(
    'SELECT * FROM inspection_photos WHERE inspection_id = $1 ORDER BY created_at',
    [req.params.id]
  );
  res.json({ ...rows[0], photos: photos.rows });
});

// POST /api/inspections - start new inspection
router.post('/', async (req, res) => {
  const { vehicle_id, inspection_type = 'pre_trip', notes } = req.body;
  const driver_id = req.user.id;

  const { rows } = await pool.query(
    `INSERT INTO inspections (vehicle_id, driver_id, inspection_type, status, notes)
     VALUES ($1,$2,$3,'in_progress',$4) RETURNING *`,
    [vehicle_id, driver_id, inspection_type, notes]
  );
  res.status(201).json(rows[0]);
});

// POST /api/inspections/:id/photos - upload photos
router.post('/:id/photos', photoUpload.single('photo'), async (req, res) => {
  const { photo_angle } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

  const filePath = `/uploads/inspections/${req.file.filename}`;
  const { rows } = await pool.query(
    `INSERT INTO inspection_photos (inspection_id, photo_angle, file_path, file_name)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.id, photo_angle, filePath, req.file.originalname]
  );
  res.status(201).json(rows[0]);
});

// POST /api/inspections/:id/complete - finalize inspection + trigger AI
router.post('/:id/complete', async (req, res) => {
  const { overall_condition, notes, damage_detected = false } = req.body;

  await pool.query(
    `UPDATE inspections SET status='completed', overall_condition=$1, notes=$2,
     damage_detected=$3, updated_at=NOW() WHERE id=$4`,
    [overall_condition, notes, damage_detected, req.params.id]
  );

  // Get current inspection photos
  const insp = await pool.query('SELECT * FROM inspections WHERE id = $1', [req.params.id]);
  const newPhotos = await pool.query('SELECT * FROM inspection_photos WHERE inspection_id = $1', [req.params.id]);

  // Get previous inspection photos for same vehicle
  const prevInsp = await pool.query(
    `SELECT ip.* FROM inspection_photos ip
     JOIN inspections i ON i.id = ip.inspection_id
     WHERE i.vehicle_id = $1 AND i.id != $2 AND i.status = 'completed'
     ORDER BY i.inspection_date DESC LIMIT 10`,
    [insp.rows[0].vehicle_id, req.params.id]
  );

  // Run AI analysis
  const aiResult = await analyzeVehicleDamage(newPhotos.rows, prevInsp.rows);

  // Update inspection with AI result
  const finalStatus = aiResult.flagged ? 'flagged' : 'analyzed';
  await pool.query(
    `UPDATE inspections SET ai_analysis_status=$1, ai_analysis_notes=$2,
     damage_detected = CASE WHEN $3 THEN true ELSE damage_detected END
     WHERE id=$4`,
    [finalStatus, aiResult.notes, aiResult.flagged, req.params.id]
  );

  if (aiResult.flagged) {
    // Mark flagged photos
    for (const angle of (aiResult.flaggedAngles || [])) {
      await pool.query(
        `UPDATE inspection_photos SET ai_flagged=true, ai_confidence=$1
         WHERE inspection_id=$2 AND photo_angle=$3`,
        [aiResult.confidence, req.params.id, angle]
      );
    }
    // Create fleet alert
    await pool.query(
      `INSERT INTO fleet_alerts (vehicle_id, alert_type, alert_message, severity)
       VALUES ($1, 'damage_flag', $2, 'warning')`,
      [insp.rows[0].vehicle_id, `Potential new damage detected (${Math.round(aiResult.confidence || 0)}% confidence): ${aiResult.notes}`]
    );
    // Update vehicle inspection date
    await pool.query(
      `UPDATE vehicles SET last_inspection_date=CURRENT_DATE WHERE id=$1`,
      [insp.rows[0].vehicle_id]
    );
  }

  const updated = await pool.query('SELECT * FROM inspections WHERE id = $1', [req.params.id]);
  res.json({ inspection: updated.rows[0], aiAnalysis: aiResult });
});

// GET /api/inspections/:id/comparison - get before/after photos
router.get('/:id/comparison', async (req, res) => {
  const insp = await pool.query('SELECT * FROM inspections WHERE id = $1', [req.params.id]);
  if (!insp.rows[0]) return res.status(404).json({ error: 'Not found' });

  const currentPhotos = await pool.query(
    'SELECT * FROM inspection_photos WHERE inspection_id = $1 ORDER BY created_at',
    [req.params.id]
  );

  const prevInsp = await pool.query(
    `SELECT i.*, ip.* FROM inspections i
     JOIN inspection_photos ip ON ip.inspection_id = i.id
     WHERE i.vehicle_id = $1 AND i.id != $2 AND i.status = 'completed'
     ORDER BY i.inspection_date DESC LIMIT 10`,
    [insp.rows[0].vehicle_id, req.params.id]
  );

  res.json({ current: currentPhotos.rows, previous: prevInsp.rows, inspection: insp.rows[0] });
});

// PUT /api/inspections/:id/dismiss-flag
router.put('/:id/dismiss-flag', async (req, res) => {
  await pool.query(
    `UPDATE inspections SET ai_analysis_status='cleared', damage_detected=false WHERE id=$1`,
    [req.params.id]
  );
  await pool.query(
    `UPDATE fleet_alerts SET is_resolved=true, resolved_at=NOW()
     WHERE vehicle_id=(SELECT vehicle_id FROM inspections WHERE id=$1) AND alert_type='damage_flag'`,
    [req.params.id]
  );
  res.json({ message: 'Flag dismissed' });
});

module.exports = router;
