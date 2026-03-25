/**
 * migrateRepairsTables — startup-safe version of migrateRepairs.js
 * Both tables are already in schema.sql; this is a safety net plus ensures
 * all performance indexes exist.
 */
const pool = require('./pool');

async function migrateRepairsTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS repairs (
      id             SERIAL PRIMARY KEY,
      vehicle_id     INT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      van_status     VARCHAR(10) NOT NULL DEFAULT 'active'  CHECK (van_status    IN ('active','inactive')),
      amazon_status  VARCHAR(10) NOT NULL DEFAULT 'active'  CHECK (amazon_status IN ('active','inactive')),
      priority       VARCHAR(10) NOT NULL DEFAULT 'low'     CHECK (priority      IN ('low','medium','severe')),
      description    TEXT NOT NULL,
      scheduled_date DATE,
      vendor         VARCHAR(255),
      status         VARCHAR(20) NOT NULL DEFAULT 'open'    CHECK (status        IN ('open','completed')),
      completed_at   TIMESTAMPTZ,
      completed_by   INT REFERENCES staff(id),
      reported_by    INT REFERENCES staff(id),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_reports (
      id                     SERIAL PRIMARY KEY,
      vehicle_id             INT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      driver_id              INT NOT NULL REFERENCES staff(id),
      description            TEXT NOT NULL,
      status                 VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','converted','dismissed')),
      dismiss_note           TEXT,
      converted_to_repair_id INT REFERENCES repairs(id),
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at            TIMESTAMPTZ,
      reviewed_by            INT REFERENCES staff(id)
    )
  `);

  // Indexes (idempotent — also in schema.sql)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_repairs_vehicle_id        ON repairs(vehicle_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_repairs_status            ON repairs(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_repairs_priority          ON repairs(priority)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_driver_reports_status     ON driver_reports(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_driver_reports_vehicle_id ON driver_reports(vehicle_id)`);

  console.log('[migrateRepairsTables] Done — repairs, driver_reports, indexes');
}

module.exports = migrateRepairsTables;
