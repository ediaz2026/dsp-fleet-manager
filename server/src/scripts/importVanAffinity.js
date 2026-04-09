/**
 * Van Affinity Import v2: uses exact staff IDs and correct vehicle names.
 * Only updates primary_driver_2_id where provided — preserves existing p1 values.
 *
 * Run via temporary API endpoint on Railway (DATABASE_URL is injected).
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

const assignments = [
  { vehicle: 'SV36', p1_id: null, p2_id: 382 },
  { vehicle: 'SV38', p1_id: null, p2_id: 369 },
  { vehicle: 'SV39', p1_id: null, p2_id: 457 },
  { vehicle: 'SV40', p1_id: null, p2_id: null },
  { vehicle: 'SV41', p1_id: null, p2_id: null },
  { vehicle: 'SV42', p1_id: null, p2_id: 351 },
  { vehicle: 'SV43', p1_id: null, p2_id: null },
  { vehicle: 'SV44', p1_id: null, p2_id: 367 },
  { vehicle: 'SV45', p1_id: null, p2_id: null },
  { vehicle: 'SV46', p1_id: null, p2_id: 370 },
  { vehicle: 'EV 01', p1_id: null, p2_id: null },
  { vehicle: 'EV 02', p1_id: null, p2_id: 371 },
  { vehicle: 'EV 03', p1_id: null, p2_id: null },
  { vehicle: 'EV 04', p1_id: null, p2_id: null },
  { vehicle: 'EV 05', p1_id: null, p2_id: null },
  { vehicle: 'EV 06', p1_id: null, p2_id: null },
  { vehicle: 'EV 07', p1_id: null, p2_id: null },
  { vehicle: 'EV 08', p1_id: null, p2_id: null },
  { vehicle: 'EV 09', p1_id: null, p2_id: null },
  { vehicle: 'EV 10', p1_id: null, p2_id: 369 },
  { vehicle: 'EV 11', p1_id: null, p2_id: null },
  { vehicle: 'EV 12', p1_id: null, p2_id: null },
  { vehicle: 'EV 13', p1_id: null, p2_id: null },
  { vehicle: 'EV 14', p1_id: null, p2_id: null },
  { vehicle: 'EV 15', p1_id: null, p2_id: 372 },
  { vehicle: 'EV 16', p1_id: 354, p2_id: null },
  { vehicle: 'EV 17', p1_id: null, p2_id: null },
  { vehicle: 'EV 18', p1_id: 348, p2_id: 356 },
  { vehicle: 'EV 19', p1_id: null, p2_id: 374 },
  { vehicle: 'EV 20', p1_id: null, p2_id: 361 },
  { vehicle: 'EV 21', p1_id: null, p2_id: null },
  { vehicle: 'EV 22', p1_id: null, p2_id: null },
  { vehicle: 'EV 23', p1_id: null, p2_id: null },
  { vehicle: 'EV 24', p1_id: null, p2_id: 368 },
  { vehicle: 'EV 25', p1_id: null, p2_id: null },
  { vehicle: 'EV 26', p1_id: null, p2_id: null },
  { vehicle: 'EV 27', p1_id: null, p2_id: 454 },
  { vehicle: 'EV 28', p1_id: null, p2_id: 358 },
  { vehicle: 'EV 29', p1_id: null, p2_id: null },
  { vehicle: 'EV 30', p1_id: 384, p2_id: null },
  { vehicle: 'EV 31', p1_id: null, p2_id: null },
  { vehicle: 'EV 32', p1_id: 359, p2_id: 373 },
  { vehicle: 'EV 33', p1_id: 357, p2_id: null },
  { vehicle: 'EV 34', p1_id: null, p2_id: null },
  { vehicle: 'EV 35', p1_id: null, p2_id: null },
  { vehicle: 'EV 36', p1_id: null, p2_id: null },
  { vehicle: 'EV 37', p1_id: null, p2_id: null },
  { vehicle: 'EV 38', p1_id: null, p2_id: null },
];

async function main() {
  console.log('=== Van Affinity Import v2 (exact IDs) ===\n');

  let vehiclesMatched = 0, vehiclesMissed = 0;
  const missedVehicles = [];
  let updated = 0, skippedNoChange = 0;

  for (const a of assignments) {
    // Exact vehicle_name match
    const { rows } = await pool.query(
      `SELECT id, vehicle_name FROM vehicles WHERE vehicle_name = $1`, [a.vehicle]
    );
    if (!rows.length) {
      console.log(`✗ Vehicle "${a.vehicle}" — NOT FOUND`);
      vehiclesMissed++;
      missedVehicles.push(a.vehicle);
      continue;
    }
    vehiclesMatched++;
    const vehicle = rows[0];

    // Skip if nothing to update
    if (a.p1_id === null && a.p2_id === null) {
      console.log(`- Vehicle "${a.vehicle}" (id=${vehicle.id}) — no driver IDs to set, skipping`);
      skippedNoChange++;
      continue;
    }

    // Build dynamic SET clause — only update fields that have values
    const sets = [];
    const vals = [vehicle.id];
    let paramIdx = 2;

    if (a.p1_id !== null) {
      sets.push(`primary_driver_1_id = $${paramIdx}`);
      vals.push(a.p1_id);
      paramIdx++;
    }
    if (a.p2_id !== null) {
      sets.push(`primary_driver_2_id = $${paramIdx}`);
      vals.push(a.p2_id);
      paramIdx++;
    }
    sets.push('updated_at = NOW()');

    await pool.query(`
      INSERT INTO van_affinity (vehicle_id, ${a.p1_id !== null ? 'primary_driver_1_id,' : ''} ${a.p2_id !== null ? 'primary_driver_2_id,' : ''} updated_at)
      VALUES ($1, ${a.p1_id !== null ? `$${vals.indexOf(a.p1_id) + 1},` : ''} ${a.p2_id !== null ? `$${vals.indexOf(a.p2_id) + 1},` : ''} NOW())
      ON CONFLICT (vehicle_id) DO UPDATE SET ${sets.join(', ')}
    `, vals);

    updated++;
    console.log(`✓ Vehicle "${a.vehicle}" (id=${vehicle.id}) — set ${a.p1_id !== null ? `p1_id=${a.p1_id} ` : ''}${a.p2_id !== null ? `p2_id=${a.p2_id}` : ''}`);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Vehicles matched: ${vehiclesMatched} / ${assignments.length}`);
  console.log(`Vehicles NOT found: ${vehiclesMissed}${missedVehicles.length ? ' — ' + missedVehicles.join(', ') : ''}`);
  console.log(`Rows updated: ${updated}`);
  console.log(`Skipped (no driver IDs): ${skippedNoChange}`);

  await pool.end();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
