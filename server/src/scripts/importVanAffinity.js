/**
 * One-time import script: populate van_affinity from Cowork assignment plan.
 *
 * Usage (on Railway):
 *   node server/src/scripts/importVanAffinity.js
 *
 * Requires DATABASE_URL in the environment.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

const assignments = [
  { vehicle: '36', p1: 'JACSON DEY', p2: 'FERNANDO LEMUS' },
  { vehicle: '38', p1: 'ALDAIL ADAY', p2: 'KAREN LANGEBECK' },
  { vehicle: '39', p1: 'ALEJANDRO ROSSLER', p2: 'DANIEL BERMUDEZ' },
  { vehicle: '40', p1: 'MARIA CLARA LEON', p2: null },
  { vehicle: '41', p1: 'DANIEL BEJERANO', p2: 'ISMAEL RODRIGUEZ' },
  { vehicle: '42', p1: 'SEAN CURTIS', p2: 'IYANA JACKSON' },
  { vehicle: '43', p1: 'LAZARO HERNANDEZ', p2: null },
  { vehicle: '44', p1: 'ERNESTO DE LA PAZ', p2: 'ANGEL PAZOS' },
  { vehicle: '45', p1: 'RODOLFO GARCIA', p2: null },
  { vehicle: '46', p1: 'GLENDA TORRES', p2: 'MARLON ZAPATA' },
  { vehicle: 'EV 01', p1: 'GABRIELA GONZALEZ SOTO', p2: 'MANEL FERNANDEZ' },
  { vehicle: 'EV 02', p1: 'GABRIELA ZAYAS MILLAN', p2: 'JACKY SOTO' },
  { vehicle: 'EV 03', p1: 'MILADYS CAZORLA', p2: 'VERNANTE JACQUESLOUIS' },
  { vehicle: 'EV 04', p1: 'EDUARDO ZAMORA', p2: 'MARCELO BARROSO' },
  { vehicle: 'EV 05', p1: 'CARLOS TANO', p2: 'MIREN RULE' },
  { vehicle: 'EV 06', p1: 'DEVIN ESPINOSA', p2: 'LUCAS BORGES' },
  { vehicle: 'EV 07', p1: 'MARLON LAWRENCE', p2: null },
  { vehicle: 'EV 08', p1: 'DAYVEL GONZALEZ', p2: null },
  { vehicle: 'EV 09', p1: 'ISAIAH JOHNSON', p2: 'JEINS BAEZ' },
  { vehicle: 'EV 10', p1: 'JUAN QUINTANA', p2: 'EDUARDO TRAVIESO' },
  { vehicle: 'EV 11', p1: 'JAVIER MORICE', p2: null },
  { vehicle: 'EV 12', p1: 'LEOSBEY CONTRERAS', p2: null },
  { vehicle: 'EV 13', p1: 'CARLOS GONZALEZ RUIZ', p2: 'YEINIER JIMENEZ' },
  { vehicle: 'EV 14', p1: 'SAMUEL DEL RIO', p2: null },
  { vehicle: 'EV 15', p1: 'JESUS REY', p2: 'MAIKE MONTERO' },
  { vehicle: 'EV 16', p1: 'FRANK PONS', p2: null },
  { vehicle: 'EV 17', p1: 'RENE TAYLOR', p2: null },
  { vehicle: 'EV 18', p1: 'RAY HERNANDEZ', p2: 'KIONDAE WILSON' },
  { vehicle: 'EV 19', p1: 'NELSON AROCHE', p2: 'LAWRENCE KELLY' },
  { vehicle: 'EV 20', p1: 'JOSE L GONZALEZ', p2: 'DAYRON MARTIN' },
  { vehicle: 'EV 21', p1: 'RICARDO BONILLA', p2: null },
  { vehicle: 'EV 22', p1: 'JOSE DARIAS CRUZ', p2: null },
  { vehicle: 'EV 23', p1: 'DANIEL GONZALEZ', p2: null },
  { vehicle: 'EV 24', p1: 'DOMINIC DIAZ', p2: 'ROGER FONNEGRA' },
  { vehicle: 'EV 25', p1: 'JAVIER MORENO', p2: 'REYNIER BARRIOS' },
  { vehicle: 'EV 26', p1: 'JONATHAN ESTRADA', p2: null },
  { vehicle: 'EV 27', p1: 'BRYAN CABALLERO', p2: 'JULIAN BRITO' },
  { vehicle: 'EV 28', p1: 'CHRISTIAN GAVIDIA', p2: 'LAZARO ALMEIDA' },
  { vehicle: 'EV 29', p1: 'YLENA AROCHE', p2: null },
  { vehicle: 'EV 30', p1: 'EDUARDO HORTA', p2: null },
  { vehicle: 'EV 31', p1: 'ODALYS FERNANDEZ', p2: null },
  { vehicle: 'EV 32', p1: 'MELYSSE AGRELO', p2: 'DAVID RODRIGUEZ' },
  { vehicle: 'EV 33', p1: 'HECTOR DELGADO', p2: null },
  { vehicle: 'EV 34', p1: 'TEQUILA PIERCE', p2: null },
  { vehicle: 'EV 35', p1: 'MONICA LEYVA', p2: null },
  { vehicle: 'EV 36', p1: 'DAYRON PRATS', p2: null },
  { vehicle: 'EV 37', p1: 'DAYRON MORALES', p2: null },
  { vehicle: 'EV 38', p1: 'ROBERTO GARCIA', p2: null },
];

async function findVehicle(name) {
  // Try exact match first, then partial (vehicle_name contains the input)
  const { rows } = await pool.query(
    `SELECT id, vehicle_name FROM vehicles WHERE UPPER(vehicle_name) = UPPER($1)`,
    [name]
  );
  if (rows.length) return rows[0];

  // Partial: e.g. '36' matches 'SV 36' or 'HZA 36', 'EV 01' matches 'EV 01'
  const { rows: partial } = await pool.query(
    `SELECT id, vehicle_name FROM vehicles WHERE UPPER(vehicle_name) LIKE '%' || UPPER($1)`,
    [name]
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    console.log(`  ⚠ Multiple vehicles match "${name}": ${partial.map(v => v.vehicle_name).join(', ')} — using first`);
    return partial[0];
  }
  return null;
}

async function findDriver(name) {
  if (!name) return null;
  const { rows } = await pool.query(
    `SELECT id, first_name, last_name FROM staff
     WHERE UPPER(first_name || ' ' || last_name) = UPPER($1)`,
    [name]
  );
  if (rows.length) return rows[0];

  // Partial match — input name is contained in full name or vice versa
  const { rows: partial } = await pool.query(
    `SELECT id, first_name, last_name FROM staff
     WHERE UPPER(first_name || ' ' || last_name) LIKE '%' || UPPER($1) || '%'
        OR UPPER($1) LIKE '%' || UPPER(first_name || ' ' || last_name) || '%'`,
    [name]
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    console.log(`  ⚠ Multiple staff match "${name}": ${partial.map(s => `${s.first_name} ${s.last_name}`).join(', ')} — using first`);
    return partial[0];
  }
  return null;
}

async function main() {
  console.log('=== Van Affinity Import ===\n');

  let vehiclesMatched = 0, vehiclesMissed = 0;
  let driversMatched = 0, driversMissed = 0;
  const missedVehicles = [];
  const missedDrivers = [];
  let upserted = 0;

  for (const a of assignments) {
    const vehicle = await findVehicle(a.vehicle);
    if (!vehicle) {
      console.log(`✗ Vehicle "${a.vehicle}" — NOT FOUND`);
      vehiclesMissed++;
      missedVehicles.push(a.vehicle);
      continue;
    }
    vehiclesMatched++;
    console.log(`✓ Vehicle "${a.vehicle}" → ${vehicle.vehicle_name} (id=${vehicle.id})`);

    const p1 = await findDriver(a.p1);
    const p2 = await findDriver(a.p2);

    if (a.p1) {
      if (p1) { driversMatched++; console.log(`  ✓ P1 "${a.p1}" → ${p1.first_name} ${p1.last_name} (id=${p1.id})`); }
      else    { driversMissed++; missedDrivers.push(a.p1); console.log(`  ✗ P1 "${a.p1}" — NOT FOUND`); }
    }
    if (a.p2) {
      if (p2) { driversMatched++; console.log(`  ✓ P2 "${a.p2}" → ${p2.first_name} ${p2.last_name} (id=${p2.id})`); }
      else    { driversMissed++; missedDrivers.push(a.p2); console.log(`  ✗ P2 "${a.p2}" — NOT FOUND`); }
    }

    await pool.query(`
      INSERT INTO van_affinity (vehicle_id, primary_driver_1_id, primary_driver_2_id, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (vehicle_id) DO UPDATE SET
        primary_driver_1_id = EXCLUDED.primary_driver_1_id,
        primary_driver_2_id = EXCLUDED.primary_driver_2_id,
        updated_at = NOW()
    `, [vehicle.id, p1 ? p1.id : null, p2 ? p2.id : null]);
    upserted++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Vehicles matched: ${vehiclesMatched} / ${assignments.length}`);
  console.log(`Vehicles NOT found: ${vehiclesMissed}${missedVehicles.length ? ' — ' + missedVehicles.join(', ') : ''}`);
  console.log(`Drivers matched: ${driversMatched}`);
  console.log(`Drivers NOT found: ${driversMissed}${missedDrivers.length ? ' — ' + missedDrivers.join(', ') : ''}`);
  console.log(`Van affinity rows upserted: ${upserted}`);

  await pool.end();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
