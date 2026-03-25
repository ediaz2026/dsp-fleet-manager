const pool = require('./pool');

async function migrateScorecard() {
  // Driver scorecard entries — one row per driver per week
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_scorecards (
      id         SERIAL PRIMARY KEY,
      staff_id   INT  NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      week_start DATE NOT NULL,
      dcr        NUMERIC(5,2),
      pod        NUMERIC(5,2),
      cc         NUMERIC(5,2),
      ce         NUMERIC(5,2),
      dnr        NUMERIC(5,2),
      ssd        INT,
      week_score NUMERIC(5,2),
      notes      TEXT,
      created_by INT  REFERENCES staff(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(staff_id, week_start)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_scorecards_week       ON driver_scorecards(week_start)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_scorecards_staff      ON driver_scorecards(staff_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_scorecards_staff_week ON driver_scorecards(staff_id, week_start)`);

  // Route profiles — stores manual notes / score overrides; computed stats come from rescue/assignment data
  await pool.query(`
    CREATE TABLE IF NOT EXISTS route_profiles (
      id             SERIAL PRIMARY KEY,
      route_code     VARCHAR(50) NOT NULL UNIQUE,
      notes          TEXT,
      score_override INT CHECK (score_override BETWEEN 1 AND 5),
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Add reason column to ops_rescues (idempotent)
  await pool.query(`ALTER TABLE ops_rescues ADD COLUMN IF NOT EXISTS reason VARCHAR(100)`);

  console.log('[migrateScorecard] Done — driver_scorecards, route_profiles, ops_rescues.reason');
}

module.exports = migrateScorecard;
