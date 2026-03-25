const pool = require('./pool');

async function migrateAnalytics() {
  // DSP Volume Share table — one row per date, stores all DSP route counts
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dsp_volume_share (
      id           SERIAL PRIMARY KEY,
      plan_date    DATE NOT NULL UNIQUE,
      volume       JSONB NOT NULL DEFAULT '{}',
      total_routes INT   DEFAULT 0,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Rescue log — one row per rescue event
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops_rescues (
      id                SERIAL PRIMARY KEY,
      plan_date         DATE NOT NULL,
      rescued_staff_id  INT  REFERENCES staff(id) ON DELETE SET NULL,
      rescued_name      VARCHAR(255),
      rescued_route     VARCHAR(50),
      rescuer_staff_id  INT  REFERENCES staff(id) ON DELETE SET NULL,
      rescuer_name      VARCHAR(255),
      rescue_time       VARCHAR(10),
      packages_rescued  INT  DEFAULT 0,
      notes             TEXT,
      created_by        INT  REFERENCES staff(id) ON DELETE SET NULL,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ops_rescues_date ON ops_rescues(plan_date)`);

  // Add finish_time and rts_time columns to ops_assignments
  await pool.query(`ALTER TABLE ops_assignments ADD COLUMN IF NOT EXISTS finish_time VARCHAR(10)`);
  await pool.query(`ALTER TABLE ops_assignments ADD COLUMN IF NOT EXISTS rts_time    VARCHAR(10)`);

  console.log('[migrateAnalytics] Done — dsp_volume_share, ops_rescues, ops_assignments columns');
}

module.exports = migrateAnalytics;
