const router = require('express').Router();
const pool = require('../db/pool');
const QRCode = require('qrcode');
const path = require('path');
const { authMiddleware, managerOnly } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/vehicles
router.get('/', async (req, res) => {
  const { status, search } = req.query;
  let q = `SELECT v.*,
    CASE WHEN v.insurance_expiration <= CURRENT_DATE + 30 THEN true ELSE false END as insurance_expiring,
    CASE WHEN v.registration_expiration <= CURRENT_DATE + 30 THEN true ELSE false END as registration_expiring,
    CASE WHEN v.next_inspection_date <= CURRENT_DATE + 14 THEN true ELSE false END as inspection_due
    FROM vehicles v WHERE 1=1`;
  const params = [];
  if (status) { params.push(status); q += ` AND v.status = $${params.length}`; }
  if (search) {
    params.push(`%${search}%`);
    q += ` AND (v.vehicle_name ILIKE $${params.length} OR v.license_plate ILIKE $${params.length} OR v.vin ILIKE $${params.length})`;
  }
  q += ' ORDER BY v.vehicle_name';
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

// GET /api/vehicles/alerts
router.get('/alerts', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT fa.*, v.vehicle_name, v.license_plate
     FROM fleet_alerts fa
     JOIN vehicles v ON v.id = fa.vehicle_id
     WHERE fa.is_resolved = false
     ORDER BY CASE fa.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, fa.created_at DESC`
  );
  res.json(rows);
});

// GET /api/vehicles/:id
router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM vehicles WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Vehicle not found' });
  res.json(rows[0]);
});

// GET /api/vehicles/:id/qr
router.get('/:id/qr', async (req, res) => {
  const { rows } = await pool.query('SELECT id, vehicle_name FROM vehicles WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Vehicle not found' });

  const baseUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const url = `${baseUrl}/inspect/${rows[0].id}`;
  const qrPath = path.join(__dirname, '../../uploads/qrcodes', `vehicle_${rows[0].id}.png`);

  await QRCode.toFile(qrPath, url, { width: 400, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });
  await pool.query(`UPDATE vehicles SET qr_code_url = $1 WHERE id = $2`, [`/uploads/qrcodes/vehicle_${rows[0].id}.png`, rows[0].id]);

  res.sendFile(qrPath);
});

// POST /api/vehicles
router.post('/', managerOnly, async (req, res) => {
  const { vehicle_name, license_plate, vin, make, model, year, color, transponder_id,
    insurance_expiration, registration_expiration, last_inspection_date, next_inspection_date, status, notes } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO vehicles (vehicle_name, license_plate, vin, make, model, year, color, transponder_id,
      insurance_expiration, registration_expiration, last_inspection_date, next_inspection_date, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [vehicle_name, license_plate, vin, make, model, year, color, transponder_id,
     insurance_expiration, registration_expiration, last_inspection_date, next_inspection_date, status || 'active', notes]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/vehicles/:id
router.put('/:id', managerOnly, async (req, res) => {
  const { vehicle_name, license_plate, vin, make, model, year, color, transponder_id,
    insurance_expiration, registration_expiration, last_inspection_date, next_inspection_date, status, notes } = req.body;
  const { rows } = await pool.query(
    `UPDATE vehicles SET vehicle_name=$1, license_plate=$2, vin=$3, make=$4, model=$5, year=$6, color=$7,
     transponder_id=$8, insurance_expiration=$9, registration_expiration=$10, last_inspection_date=$11,
     next_inspection_date=$12, status=$13, notes=$14, updated_at=NOW() WHERE id=$15 RETURNING *`,
    [vehicle_name, license_plate, vin, make, model, year, color, transponder_id,
     insurance_expiration, registration_expiration, last_inspection_date, next_inspection_date, status, notes, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// DELETE /api/vehicles/:id
router.delete('/:id', managerOnly, async (req, res) => {
  await pool.query("UPDATE vehicles SET status='retired', updated_at=NOW() WHERE id=$1", [req.params.id]);
  res.json({ message: 'Vehicle retired' });
});

// POST /api/vehicles/:id/alerts
router.post('/:id/alerts', managerOnly, async (req, res) => {
  const { alert_type, alert_message, severity = 'warning' } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO fleet_alerts (vehicle_id, alert_type, alert_message, severity) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.id, alert_type, alert_message, severity]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/vehicles/alerts/:alertId/resolve
router.put('/alerts/:alertId/resolve', managerOnly, async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE fleet_alerts SET is_resolved=true, resolved_at=NOW() WHERE id=$1 RETURNING *`,
    [req.params.alertId]
  );
  res.json(rows[0]);
});

// POST /api/vehicles/import  — bulk upsert from fleet Excel data
router.post('/import', managerOnly, async (req, res) => {
  const { rows: importRows = [] } = req.body;
  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  const parseDate = (d) => {
    if (!d) return null;
    try {
      const s = String(d).trim();
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
        const [m, day, yr] = s.split('/');
        return `${yr}-${m.padStart(2,'0')}-${day.padStart(2,'0')}`;
      }
      const dt = new Date(s);
      if (!isNaN(dt)) return dt.toISOString().slice(0, 10);
    } catch {}
    return null;
  };

  const parseServiceType = (raw) => {
    if (!raw) return null;
    const s = raw.toLowerCase();
    if (s.includes('step van')) return 'STEP VAN';
    if (s.includes('electric') || s.includes('rivian') || s.includes('edv')) return 'EDV';
    return raw.toUpperCase();
  };

  for (const row of importRows) {
    try {
      const vin = String(row['vin'] || '').trim();
      if (!vin) { skipped++; continue; }

      const service_type   = parseServiceType(row['serviceType'] || row['type']);
      const status         = (row['operationalStatus'] || '').toUpperCase() === 'OPERATIONAL' ? 'active' : 'inactive';
      const vehicle_name   = row['vehicleName']          || vin;
      const license_plate  = row['licensePlateNumber']   || null;
      const make           = row['make']                 || null;
      const model          = row['model']                || null;
      const year           = row['year']                 ? parseInt(row['year']) : null;
      const status_note    = row['statusReasonMessage']  || null;
      const vehicle_provider = row['vehicleProvider']    || null;
      const ownership_type_label = row['ownershipType']  || null;
      const ownership_start_date = parseDate(row['ownershipStartDate']);
      const ownership_end_date   = parseDate(row['ownershipEndDate']);
      const registration_expiration = parseDate(row['registrationExpiryDate']);
      const registered_state = row['registeredState']    || null;

      const { rows: existing } = await pool.query('SELECT id FROM vehicles WHERE vin = $1', [vin]);

      if (existing[0]) {
        await pool.query(
          `UPDATE vehicles SET vehicle_name=$1, license_plate=$2, make=$3, model=$4, year=$5,
           service_type=$6, status=$7, status_note=$8, vehicle_provider=$9,
           ownership_type_label=$10, ownership_start_date=$11, ownership_end_date=$12,
           registration_expiration=$13, registered_state=$14, updated_at=NOW()
           WHERE vin=$15`,
          [vehicle_name, license_plate, make, model, year, service_type, status, status_note,
           vehicle_provider, ownership_type_label, ownership_start_date, ownership_end_date,
           registration_expiration, registered_state, vin]
        );
        updated++;
      } else {
        await pool.query(
          `INSERT INTO vehicles (vehicle_name, license_plate, vin, make, model, year,
           service_type, status, status_note, vehicle_provider,
           ownership_type_label, ownership_start_date, ownership_end_date,
           registration_expiration, registered_state)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [vehicle_name, license_plate, vin, make, model, year, service_type, status, status_note,
           vehicle_provider, ownership_type_label, ownership_start_date, ownership_end_date,
           registration_expiration, registered_state]
        );
        created++;
      }
    } catch (e) {
      errors.push(`${row['vin'] || '?'}: ${e.message}`);
    }
  }

  res.json({ created, updated, skipped, errors });
});

// Auto-generate alerts for expiring documents
router.post('/check-expirations', managerOnly, async (req, res) => {
  const vehicles = await pool.query(
    `SELECT id, vehicle_name,
       insurance_expiration, registration_expiration, next_inspection_date
     FROM vehicles WHERE status = 'active'`
  );

  let created = 0;
  for (const v of vehicles.rows) {
    const checks = [
      { field: 'insurance_expiration', type: 'insurance_expiry', label: 'insurance', days: 30 },
      { field: 'registration_expiration', type: 'registration_expiry', label: 'registration', days: 30 },
      { field: 'next_inspection_date', type: 'inspection_due', label: 'inspection', days: 14 },
    ];
    for (const c of checks) {
      if (!v[c.field]) continue;
      const daysLeft = Math.round((new Date(v[c.field]) - new Date()) / 86400000);
      if (daysLeft <= c.days) {
        const severity = daysLeft <= 7 ? 'critical' : 'warning';
        const existing = await pool.query(
          `SELECT id FROM fleet_alerts WHERE vehicle_id=$1 AND alert_type=$2 AND is_resolved=false`,
          [v.id, c.type]
        );
        if (existing.rows.length === 0) {
          await pool.query(
            `INSERT INTO fleet_alerts (vehicle_id, alert_type, alert_message, severity) VALUES ($1,$2,$3,$4)`,
            [v.id, c.type, `${v.vehicle_name} ${c.label} expires in ${daysLeft} days`, severity]
          );
          created++;
        }
      }
    }
  }
  res.json({ message: `Generated ${created} alerts` });
});

module.exports = router;
