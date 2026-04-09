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

  try {
    // Get all ops assignments for this date with driver info
    const { rows: assignments } = await pool.query(`
      SELECT oa.staff_id, oa.shift_type, oa.route_code, oa.vehicle_id AS current_vehicle_id,
             s.first_name, s.last_name, s.hire_date
      FROM ops_assignments oa
      JOIN staff s ON s.id = oa.staff_id
      WHERE oa.plan_date = $1 AND oa.removed_from_ops IS NOT TRUE
      ORDER BY s.hire_date ASC NULLS LAST
    `, [date]);

    // Also get drivers from shifts who may not have ops_assignments yet
    const asgnStaffIds = new Set(assignments.map(a => a.staff_id));

    // Get active vehicles
    const { rows: allVehicles } = await pool.query(`
      SELECT id, vehicle_name, service_type, van_status, amazon_status
      FROM vehicles
      WHERE status = 'active'
        AND (van_status IS NULL OR UPPER(van_status) NOT IN ('OUT OF SERVICE','INACTIVE'))
        AND (amazon_status IS NULL OR UPPER(amazon_status) != 'GROUNDED')
    `);

    // Get all affinity records
    const { rows: affinities } = await pool.query(`SELECT * FROM van_affinity`);

    // Build affinity lookups
    const affinityByVehicle = {};
    for (const a of affinities) affinityByVehicle[a.vehicle_id] = a;

    // Build driver → affinity lookups
    const primaryVehicleForDriver = {};  // staff_id → [vehicle_ids]
    const secondaryVehicleForDriver = {};
    for (const a of affinities) {
      for (const did of [a.primary_driver_1_id, a.primary_driver_2_id]) {
        if (did) { if (!primaryVehicleForDriver[did]) primaryVehicleForDriver[did] = []; primaryVehicleForDriver[did].push(a.vehicle_id); }
      }
      for (const did of [a.secondary_driver_1_id, a.secondary_driver_2_id]) {
        if (did) { if (!secondaryVehicleForDriver[did]) secondaryVehicleForDriver[did] = []; secondaryVehicleForDriver[did].push(a.vehicle_id); }
      }
    }

    const isStepVan = (v) => /step/i.test(v.service_type || '') || /^SV/i.test(v.vehicle_name || '') || /^HZA/i.test(v.vehicle_name || '');
    const isEdv = (v) => /electric/i.test(v.service_type || '') || /^EV/i.test(v.vehicle_name || '');

    const takenVehicleIds = new Set();
    const details = [];
    let assigned = 0, skipped = 0;

    // Sort by hire_date ASC (senior first)
    const sortedDrivers = [...assignments].sort((a, b) => {
      if (!a.hire_date && !b.hire_date) return 0;
      if (!a.hire_date) return 1;
      if (!b.hire_date) return -1;
      return new Date(a.hire_date) - new Date(b.hire_date);
    });

    for (const driver of sortedDrivers) {
      const shiftType = (driver.shift_type || '').toUpperCase();
      // Skip non-route drivers
      if (['ON CALL','UTO','PTO','SUSPENSION','TRAINING','TRAINER','DISPATCH AM','DISPATCH PM'].includes(shiftType)) {
        skipped++;
        details.push({ name: `${driver.first_name} ${driver.last_name}`, reason: `Skipped (${shiftType})` });
        continue;
      }

      const needsStepVan = shiftType === 'STEP VAN';
      const eligible = allVehicles.filter(v => {
        if (takenVehicleIds.has(v.id)) return false;
        return needsStepVan ? isStepVan(v) : isEdv(v);
      });

      let chosen = null;

      // 1. Try primary affinity
      const primaryIds = primaryVehicleForDriver[driver.staff_id] || [];
      for (const vid of primaryIds) {
        const v = eligible.find(e => e.id === vid);
        if (v) { chosen = v; break; }
      }

      // 2. Try secondary affinity
      if (!chosen) {
        const secondaryIds = secondaryVehicleForDriver[driver.staff_id] || [];
        for (const vid of secondaryIds) {
          const v = eligible.find(e => e.id === vid);
          if (v) { chosen = v; break; }
        }
      }

      // 3. Any available vehicle of the right type
      if (!chosen && eligible.length > 0) {
        chosen = eligible[0];
      }

      if (chosen) {
        takenVehicleIds.add(chosen.id);
        await pool.query(
          `UPDATE ops_assignments SET vehicle_id = $1, updated_at = NOW() WHERE staff_id = $2 AND plan_date = $3`,
          [chosen.id, driver.staff_id, date]
        );
        assigned++;
        details.push({
          name: `${driver.first_name} ${driver.last_name}`,
          vehicle: chosen.vehicle_name,
          method: primaryIds.includes(chosen.id) ? 'primary' : secondaryVehicleForDriver[driver.staff_id]?.includes(chosen.id) ? 'secondary' : 'available',
        });
      } else {
        skipped++;
        details.push({ name: `${driver.first_name} ${driver.last_name}`, reason: `No ${needsStepVan ? 'Step Van' : 'EDV'} available` });
      }
    }

    res.json({ assigned, skipped, total: sortedDrivers.length, details });
  } catch (err) {
    console.error('[van-affinity/auto-assign]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
