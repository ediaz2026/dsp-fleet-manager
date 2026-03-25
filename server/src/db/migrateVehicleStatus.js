/**
 * migrateVehicleStatus.js
 *
 * Adds van_status and amazon_status columns to vehicles table,
 * migrates existing status data, and drops the old single-status
 * filter dependency from dashboard/expiration queries.
 *
 * Idempotent — safe to run on every startup.
 */

const pool = require('./pool');

async function migrateVehicleStatus() {
  // ── Step 1: Add new columns ────────────────────────────────────────────────
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS van_status VARCHAR(50) DEFAULT 'Active'`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS amazon_status VARCHAR(50) DEFAULT 'Active'`);

  // ── Step 2: Migrate existing status data ──────────────────────────────────
  // OPERATIONAL or active → van Active + amazon Active
  await pool.query(`
    UPDATE vehicles
    SET van_status = 'Active', amazon_status = 'Active'
    WHERE (van_status IS NULL OR van_status = 'Active')
      AND status IN ('active', 'OPERATIONAL', 'Active')
  `);

  // inactive or out_of_service → van Out of Service + amazon Active
  await pool.query(`
    UPDATE vehicles
    SET van_status = 'Out of Service', amazon_status = 'Active'
    WHERE van_status = 'Active'
      AND status IN ('inactive', 'out_of_service', 'Inactive', 'Out of Service')
  `);

  // ── Step 3: Ensure NULL values are filled with defaults ──────────────────
  await pool.query(`UPDATE vehicles SET van_status    = 'Active' WHERE van_status    IS NULL`);
  await pool.query(`UPDATE vehicles SET amazon_status = 'Active' WHERE amazon_status IS NULL`);

  console.log('✅ migrateVehicleStatus done — van_status and amazon_status columns ready');
}

module.exports = migrateVehicleStatus;
