/**
 * migrateImportColumns — startup-safe migration.
 * Ensures vehicles has all Amazon-fleet-export columns and
 * staff has invitation tracking columns.
 */
const pool = require('./pool');

async function migrateImportColumns() {
  // ── Vehicles: Amazon fleet export columns ─────────────────────────────────
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS service_type         VARCHAR(50)`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS status_note          TEXT`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_provider     VARCHAR(100)`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_type_label VARCHAR(100)`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_type_code  VARCHAR(50)`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_start_date DATE`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_end_date   DATE`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registered_state     VARCHAR(10)`);

  // ── Vehicles: expand column sizes that were too small on existing Railway DBs ─
  await pool.query(`ALTER TABLE vehicles ALTER COLUMN vin                   TYPE VARCHAR(50)`);
  await pool.query(`ALTER TABLE vehicles ALTER COLUMN vehicle_name          TYPE VARCHAR(100)`);
  await pool.query(`ALTER TABLE vehicles ALTER COLUMN license_plate         TYPE VARCHAR(20)`);
  await pool.query(`ALTER TABLE vehicles ALTER COLUMN make                  TYPE VARCHAR(100)`);
  await pool.query(`ALTER TABLE vehicles ALTER COLUMN model                 TYPE VARCHAR(100)`);
  await pool.query(`ALTER TABLE vehicles ALTER COLUMN vehicle_provider      TYPE VARCHAR(100)`);
  await pool.query(`ALTER TABLE vehicles ALTER COLUMN ownership_type_label  TYPE VARCHAR(100)`);
  await pool.query(`ALTER TABLE vehicles ALTER COLUMN registered_state      TYPE VARCHAR(50)`);

  // ── Shifts: pending changes columns (driver sees original until re-published) ─
  await pool.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS pending_shift_type VARCHAR(50)`);
  await pool.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS pending_start_time TIME`);
  await pool.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS pending_end_time   TIME`);
  await pool.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS has_pending_changes BOOLEAN DEFAULT FALSE`);

  // ── Driver notifications table ─────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         SERIAL PRIMARY KEY,
      staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      title      VARCHAR(255) NOT NULL,
      message    TEXT,
      type       VARCHAR(50) DEFAULT 'info',
      is_read    BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_staff_id ON notifications(staff_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_is_read  ON notifications(staff_id, is_read)`);

  // ── Staff: employee code (Paycom) ─────────────────────────────────────────
  await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS employee_code VARCHAR(50)`);

  // ── Staff: invitation tracking ────────────────────────────────────────────
  await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS invitation_sent    BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ`);

  console.log('✅ migrateImportColumns done');
}

module.exports = migrateImportColumns;
