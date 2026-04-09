const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');

router.use(authMiddleware);

// Create table on startup
pool.query(`
  CREATE TABLE IF NOT EXISTS van_affinity (
    id SERIAL PRIMARY KEY,
    vehicle_id INT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    primary_driver_1_id INT REFERENCES staff(id) ON DELETE SET NULL,
    primary_driver_2_id INT REFERENCES staff(id) ON DELETE SET NULL,
    secondary_driver_1_id INT REFERENCES staff(id) ON DELETE SET NULL,
    secondary_driver_2_id INT REFERENCES staff(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(vehicle_id)
  )
`).catch(e => console.error('[van-affinity] Table error:', e.message));

// GET / — all affinity records with vehicle + driver names
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        v.id AS vehicle_id, v.vehicle_name, v.service_type,
        va.id AS affinity_id,
        va.primary_driver_1_id, va.primary_driver_2_id,
        va.secondary_driver_1_id, va.secondary_driver_2_id,
        p1.first_name || ' ' || p1.last_name AS primary_driver_1_name,
        p2.first_name || ' ' || p2.last_name AS primary_driver_2_name,
        s1.first_name || ' ' || s1.last_name AS secondary_driver_1_name,
        s2.first_name || ' ' || s2.last_name AS secondary_driver_2_name
      FROM vehicles v
      LEFT JOIN van_affinity va ON va.vehicle_id = v.id
      LEFT JOIN staff p1 ON p1.id = va.primary_driver_1_id
      LEFT JOIN staff p2 ON p2.id = va.primary_driver_2_id
      LEFT JOIN staff s1 ON s1.id = va.secondary_driver_1_id
      LEFT JOIN staff s2 ON s2.id = va.secondary_driver_2_id
      ORDER BY v.vehicle_name
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /vehicle/:vehicle_id — single vehicle affinity
router.get('/vehicle/:vehicle_id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT va.*,
        v.vehicle_name, v.service_type,
        p1.first_name AS p1_first, p1.last_name AS p1_last,
        p2.first_name AS p2_first, p2.last_name AS p2_last,
        s1.first_name AS s1_first, s1.last_name AS s1_last,
        s2.first_name AS s2_first, s2.last_name AS s2_last
      FROM van_affinity va
      JOIN vehicles v ON v.id = va.vehicle_id
      LEFT JOIN staff p1 ON p1.id = va.primary_driver_1_id
      LEFT JOIN staff p2 ON p2.id = va.primary_driver_2_id
      LEFT JOIN staff s1 ON s1.id = va.secondary_driver_1_id
      LEFT JOIN staff s2 ON s2.id = va.secondary_driver_2_id
      WHERE va.vehicle_id = $1
    `, [req.params.vehicle_id]);
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /vehicle/:vehicle_id — upsert affinity
router.put('/vehicle/:vehicle_id', managerOnly, async (req, res) => {
  try {
    const { primary_driver_1_id, primary_driver_2_id, secondary_driver_1_id, secondary_driver_2_id } = req.body;
    const { rows } = await pool.query(`
      INSERT INTO van_affinity (vehicle_id, primary_driver_1_id, primary_driver_2_id, secondary_driver_1_id, secondary_driver_2_id, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (vehicle_id) DO UPDATE SET
        primary_driver_1_id = EXCLUDED.primary_driver_1_id,
        primary_driver_2_id = EXCLUDED.primary_driver_2_id,
        secondary_driver_1_id = EXCLUDED.secondary_driver_1_id,
        secondary_driver_2_id = EXCLUDED.secondary_driver_2_id,
        updated_at = NOW()
      RETURNING *
    `, [req.params.vehicle_id, primary_driver_1_id || null, primary_driver_2_id || null, secondary_driver_1_id || null, secondary_driver_2_id || null]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auto-assign — auto-assign vehicles based on affinity + seniority
router.post('/auto-assign', managerOnly, async (req, res) => {
  const date = req.body.date;
  if (!date) return res.status(400).json({ error: 'date required' });
  console.log(`[auto-assign] Starting for date: ${date}`);

  try {
    // STEP 1 — Get all scheduled drivers for the date
    const { rows: drivers } = await pool.query(`
      SELECT DISTINCT s.id AS staff_id, s.first_name, s.last_name, s.hire_date,
        sh.shift_type,
        oa.id AS ops_id,
        oa.vehicle_id AS current_vehicle_id
      FROM shifts sh
      JOIN staff s ON s.id = sh.staff_id
      LEFT JOIN ops_assignments oa ON oa.staff_id = s.id
        AND oa.plan_date = $1
        AND oa.removed_from_ops IS NOT TRUE
      WHERE sh.shift_date = $1
        AND sh.shift_type NOT IN ('ON CALL','UTO','PTO','SUSPENSION','TRAINING','TRAINER','DISPATCH AM','DISPATCH PM')
      ORDER BY s.hire_date ASC NULLS LAST
    `, [date]);
    console.log(`[auto-assign] Found ${drivers.length} scheduled drivers`);

    // STEP 2 — Get all active vehicles
    const { rows: vehicles } = await pool.query(`
      SELECT id, vehicle_name, service_type FROM vehicles
      WHERE (van_status = 'Active' OR van_status IS NULL)
        AND (amazon_status != 'Grounded' OR amazon_status IS NULL)
    `);
    console.log(`[auto-assign] Found ${vehicles.length} active vehicles`);

    // STEP 3 — Get all van affinity records
    const { rows: affinityRecords } = await pool.query(`SELECT * FROM van_affinity`);
    console.log(`[auto-assign] Affinity records: ${affinityRecords.length}`);

    // STEP 4 — Run assignment algorithm
    const assignedVehicleIds = new Set();
    const results = [];

    for (const driver of drivers) {
      const isStepVan = driver.shift_type === 'STEP VAN';

      // Filter vehicles by type
      const rightTypeVehicles = vehicles.filter(v => {
        if (isStepVan) {
          return v.service_type?.toLowerCase().includes('step') ||
                 v.vehicle_name?.toUpperCase().startsWith('SV');
        } else {
          return v.service_type?.toLowerCase().includes('electric') ||
                 v.vehicle_name?.toUpperCase().startsWith('EV');
        }
      });

      // Find this driver's affinity record
      const affinity = affinityRecords.find(a =>
        a.primary_driver_1_id === driver.staff_id ||
        a.primary_driver_2_id === driver.staff_id
      );

      let assignedVehicle = null;
      let method = 'any';

      if (affinity) {
        // Try primary vehicle first
        const primaryVehicle = rightTypeVehicles.find(v =>
          v.id === affinity.vehicle_id && !assignedVehicleIds.has(v.id)
        );
        if (primaryVehicle) {
          assignedVehicle = primaryVehicle;
          method = affinity.primary_driver_1_id === driver.staff_id ? 'primary_1' : 'primary_2';
        }
      }

      // If no affinity vehicle available, take any available vehicle of right type
      if (!assignedVehicle) {
        assignedVehicle = rightTypeVehicles.find(v => !assignedVehicleIds.has(v.id));
        method = affinity ? 'fallback' : 'any';
      }

      if (assignedVehicle) {
        assignedVehicleIds.add(assignedVehicle.id);

        // Upsert into ops_assignments
        await pool.query(`
          INSERT INTO ops_assignments (staff_id, plan_date, shift_type, vehicle_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (plan_date, staff_id)
          DO UPDATE SET vehicle_id = EXCLUDED.vehicle_id
        `, [driver.staff_id, date, driver.shift_type, assignedVehicle.id]);

        console.log(`[auto-assign] ${driver.first_name} ${driver.last_name} → ${assignedVehicle.vehicle_name} (${method})`);
        results.push({
          driver_name: `${driver.first_name} ${driver.last_name}`,
          vehicle: assignedVehicle.vehicle_name,
          method,
          hire_date: driver.hire_date
        });
      } else {
        const reason = isStepVan ? 'No Step Van available' : 'No EDV available';
        console.log(`[auto-assign] ${driver.first_name} ${driver.last_name} — ${reason}`);
        results.push({
          driver_name: `${driver.first_name} ${driver.last_name}`,
          vehicle: null,
          method: 'unassigned',
          reason
        });
      }
    }

    const assigned = results.filter(r => r.vehicle).length;
    const skipped = results.filter(r => !r.vehicle).length;
    console.log(`[auto-assign] Done: ${assigned} assigned, ${skipped} skipped out of ${drivers.length}`);
    res.json({ assigned, skipped, details: results });
  } catch (err) {
    console.error('[van-affinity/auto-assign]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
