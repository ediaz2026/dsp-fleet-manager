/**
 * migrateImportColumns — startup-safe migration.
 * Ensures vehicles has all Amazon-fleet-export columns and
 * staff has invitation tracking columns.
 */
const pool = require('./pool');

async function migrateImportColumns() {
  // ── Vehicles: Amazon fleet export columns ─────────────────────────────────
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS service_type        VARCHAR(50)`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS status_note         TEXT`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_provider    VARCHAR(100)`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_type_label VARCHAR(100)`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_start_date DATE`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_end_date   DATE`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registered_state     VARCHAR(10)`);

  // ── Staff: employee code (Paycom) ─────────────────────────────────────────
  await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS employee_code VARCHAR(50)`);

  // ── Staff: invitation tracking ────────────────────────────────────────────
  await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS invitation_sent    BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ`);

  console.log('✅ migrateImportColumns done');
}

module.exports = migrateImportColumns;
