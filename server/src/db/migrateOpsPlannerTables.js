/**
 * migrateOpsPlannerTables — startup-safe version of migrateOpsPlanner.js
 * Both tables are already in schema.sql; this is a safety net for environments
 * where schema.sql was applied before these tables were added.
 */
const pool = require('./pool');

async function migrateOpsPlannerTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops_planner_sessions (
      id              SERIAL PRIMARY KEY,
      plan_date       DATE NOT NULL UNIQUE,
      rows            JSONB NOT NULL DEFAULT '[]',
      route_summary   JSONB,
      station_summary JSONB,
      volume_summary  JSONB,
      created_by      INT REFERENCES staff(id),
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS week_schedules (
      id          SERIAL PRIMARY KEY,
      week_start  DATE NOT NULL UNIQUE,
      file_name   VARCHAR(255),
      rows        JSONB NOT NULL DEFAULT '[]',
      created_by  INT REFERENCES staff(id),
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  console.log('[migrateOpsPlannerTables] Done — ops_planner_sessions, week_schedules');
}

module.exports = migrateOpsPlannerTables;
