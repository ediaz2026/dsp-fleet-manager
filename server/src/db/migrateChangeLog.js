const pool = require('./pool');

async function migrate() {
  console.log('Running change log migration…');

  await pool.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS publish_status VARCHAR(20) DEFAULT 'draft'`);
  console.log('✓ publish_status column ensured on shifts');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shift_change_log (
      id               SERIAL PRIMARY KEY,
      shift_id         INTEGER REFERENCES shifts(id) ON DELETE CASCADE,
      staff_id         INTEGER,
      staff_name       VARCHAR(200),
      changed_by_id    INTEGER,
      changed_by_name  VARCHAR(200),
      change_type      VARCHAR(30) NOT NULL,
      description      TEXT NOT NULL,
      previous_value   TEXT,
      new_value        TEXT,
      shift_date       DATE,
      week_start       DATE,
      publish_status   VARCHAR(20) DEFAULT 'draft',
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('✓ shift_change_log table created');

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_change_log_week  ON shift_change_log(week_start)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_change_log_shift ON shift_change_log(shift_id)`);
  console.log('✓ indexes created');

  console.log('Migration complete.');
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
