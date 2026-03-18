const pool = require('./pool');

async function migrate() {
  // Staff: add Paycom employee code field
  await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS employee_code VARCHAR(50)`);

  // Vehicles: add fleet import columns
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS service_type VARCHAR(50)`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS status_note TEXT`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_provider VARCHAR(100)`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_type_label VARCHAR(100)`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_type_code VARCHAR(50)`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_start_date DATE`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_end_date DATE`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registered_state VARCHAR(10)`);

  console.log('Management migration complete.');
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
