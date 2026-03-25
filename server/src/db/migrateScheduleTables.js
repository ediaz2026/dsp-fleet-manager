/**
 * migrateScheduleTables — startup-safe version of migrateSchedule.js
 * Exported as a function; uses the shared pool; never calls pool.end() or process.exit().
 */
const pool = require('./pool');

async function migrateScheduleTables() {
  // Shift types — also in schema.sql; IF NOT EXISTS makes this a no-op if already present
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shift_types (
      id                 SERIAL PRIMARY KEY,
      name               VARCHAR(50) UNIQUE NOT NULL,
      default_start_time TIME DEFAULT '07:00',
      default_end_time   TIME DEFAULT '17:00',
      color              VARCHAR(30) DEFAULT 'blue',
      is_active          BOOLEAN DEFAULT TRUE,
      sort_order         INTEGER DEFAULT 0,
      created_at         TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Recurring schedule templates
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recurring_schedules (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100) NOT NULL,
      is_active  BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Recurring schedule entries
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recurring_schedule_entries (
      id          SERIAL PRIMARY KEY,
      schedule_id INTEGER REFERENCES recurring_schedules(id) ON DELETE CASCADE,
      staff_id    INTEGER REFERENCES staff(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
      shift_type  VARCHAR(50) DEFAULT 'EDV',
      start_time  TIME DEFAULT '07:00',
      end_time    TIME DEFAULT '17:00',
      UNIQUE(schedule_id, staff_id, day_of_week)
    )
  `);

  // Route commitments per week (includes daily_targets to avoid the separate ALTER)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS route_commitments (
      id             SERIAL PRIMARY KEY,
      week_start     DATE UNIQUE NOT NULL,
      amazon_week    INTEGER,
      edv_count      INTEGER DEFAULT 0,
      step_van_count INTEGER DEFAULT 0,
      total_routes   INTEGER DEFAULT 0,
      notes          TEXT,
      daily_targets  JSONB DEFAULT '{}',
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Also add daily_targets to any existing table that predates this migration
  await pool.query(`ALTER TABLE route_commitments ADD COLUMN IF NOT EXISTS daily_targets JSONB DEFAULT '{}'`);

  // Driver hours tracking
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_hours (
      id             SERIAL PRIMARY KEY,
      staff_id       INTEGER REFERENCES staff(id) ON DELETE CASCADE,
      transponder_id VARCHAR(50),
      week_start     DATE NOT NULL,
      hours_worked   DECIMAL(5,2) DEFAULT 0,
      source         VARCHAR(30) DEFAULT 'manual',
      uploaded_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(staff_id, week_start)
    )
  `);

  // Seed schedule settings (idempotent)
  await pool.query(`
    INSERT INTO settings (setting_key, setting_value, setting_type)
    VALUES
      ('schedule_weeks_ahead', '4', 'number'),
      ('schedule_week_start',  '0', 'number')
    ON CONFLICT (setting_key) DO NOTHING
  `);

  // Seed default shift types (idempotent)
  const shiftTypes = [
    { name: 'EDV',        start: '07:00', end: '17:00', color: 'blue',   order: 1 },
    { name: 'STEP VAN',   start: '07:00', end: '17:00', color: 'purple', order: 2 },
    { name: 'ON CALL',    start: '06:00', end: '18:00', color: 'yellow', order: 3 },
    { name: 'EXTRA',      start: '07:00', end: '17:00', color: 'green',  order: 4 },
    { name: 'SUSPENSION', start: '00:00', end: '00:00', color: 'red',    order: 5 },
    { name: 'UTO',        start: '00:00', end: '00:00', color: 'orange', order: 6 },
    { name: 'PTO',        start: '00:00', end: '00:00', color: 'teal',   order: 7 },
    { name: 'TRAINING',   start: '08:00', end: '16:00', color: 'indigo', order: 8 },
  ];
  for (const t of shiftTypes) {
    await pool.query(
      `INSERT INTO shift_types (name, default_start_time, default_end_time, color, sort_order)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (name) DO NOTHING`,
      [t.name, t.start, t.end, t.color, t.order]
    );
  }

  console.log('[migrateScheduleTables] Done — recurring_schedules, recurring_schedule_entries, route_commitments, driver_hours');
}

module.exports = migrateScheduleTables;
